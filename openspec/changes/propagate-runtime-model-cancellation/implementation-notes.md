# 实施证据

## 2026-09-10 当前调用链检查

- InvestigationControl 已创建每回合 controller，Worker options 接收 signal；DiagnosticRuntime 在 Preflight 完成后才检查取消。
- preflight-service.ts 的 complete 只传 json，随后 AnswerGoal completeness 可能再次调用模型。全仓检索还定位到 RAG answerability、历史案例四阶段、coverage、visible safety 与 presentation 模型消费者。
- 因此本次先验证 Preflight 的真实入口延迟正文取消，再按 tasks 扩展其他消费者；尚未新增失败测试或修改运行时代码，不宣称取消修复完成。
- 复用当前 A/B adapter 可选 signal 合同，无新增外部服务或凭证。全部本地测试使用合成材料。

## 后续记录格式

### 浏览器停止与调用点收尾审计

- 新增 e2e/model-cancellation.spec.ts：单独随机端口 Gateway + 本地 HTTP 模型，正式配置/adapter/页面链路，不 mock 浏览器 API。服务仅返回响应头，正文不自动完成；页面点击停止后断言取消 HTTP 202、模型连接关闭、重试按钮、唯一绑定回复、零 Worker 和一次模型请求。用例首次通过，未声称红侧复现；旧缺陷红侧由 runtime HTTP 测试记录覆盖。
- 全部 `pnpm test:e2e` 7/7 通过，含生产构建。此前同代码后端 684/684、前端 57/57；本轮无生产代码修改，仅新增浏览器测试和文档。现有测试服务器未修改，无真实模型/工单访问。
- 调用点审计：runtime 11 处 complete 均支持显式 signal（其中 deprecated EvidenceCoverage 无生产调用）；装配只有 runtime-composition 创建/注入共享 model，无全局可变 signal。reviewAndFormat 全部生产调用（Worker 两次、Knowledge、Experience、历史、MCP）传递回合信号。Preflight 嵌套完整性审核、历史 query/rerank/analyze/verify 与 RAG evaluate 逐层接线已核对。
- 取消前冻结/取消后迟到分开：Coverage 取消不形成绑定；visible prompt 取消返回 unknown，presentation 不启动新请求并以已冻结 projection 渲染；Deep 捕获取消保留 previousReview。信号只在方法参数/context，不写 DiagnosticRequest/Case JSON；新增 fixture 仅合成数据，无客户正文或凭证。旧兼容测试保持，不放宽门禁。
- 审计限制明确回写 runtime 文档与总体计划：非模型 MCP/embedding 传输及 allSettled 等待仍未整体取消，属于 D5；真实云服务是否停止计费、诊断准确率和提速未验证。该 change 本地验收结束不代表 A/B 真实质量、Cognee 或总体目标完成。

### 并发隔离与前端门禁

- 新增真实 DiagnosticRuntime 双 Case 并发模型等待测试：不同 signal，取消 A 不取消 B；A 后续回合开始后旧 messageId 取消返回 false，新信号未中止；每条用户消息仅有一个绑定 helper，控制对象清理。测试先暴露 fixture 错误（误以为队列同步启动、误以为普通消息必走 ask_user），修正为显式等待模型开始并允许既有本地 dispatch；不把这些 fixture 失败冒充产品缺陷。
- `node --test test/runtime-model-cancellation.test.mjs` 12/12 通过，无运行时代码变化。该测试使用可控 fake provider；真实 HTTP 正文取消由同文件另一用例覆盖。
- `pnpm test:web` 14 文件/57 测试通过；`pnpm test:e2e` 6/6 通过（含生产构建）。现有浏览器用例覆盖模式、聊天与重试，但尚未直接覆盖模型处理中点击停止，因此保留 3.1—3.3 未完成，下一步补浏览器停止场景与调用链审计。没有真实外部模型调用。
- 本轮完整 `pnpm test` 684/684 通过，包含构建与类型门禁；随后仅追加本记录并补跑 lint/diff。下一浏览器验收需为测试服务器提供可控模型等待路径，不能用现有 900ms Worker fixture 冒充模型停止验收。

### 审核与表达取消接线

- review context 新增非持久化可选 signal，接入 Worker/Fast/Deep、Knowledge、Experience、历史案例和 MCP review 调用。Coverage 未完成时取消向上抛出；结果冻结后的 visible prompt 审查取消返回 unknown（不显示未审追问），presentation 取消不接受迟到计划且不再发模型，以安全 projection 确定性渲染。
- Deep review 的取消单独捕获，保留 previousReview；初次 review 无 accepted 结果时仍走 runtime 取消收尾。deprecated EvidenceCoverageService 无生产消费者，但可选取消合同同步补齐，不冒充新链路正在使用它。
- presentation 测试先复现 signalSeen 为 undefined，接线后通过。原有 Deep 失败/取消与唯一回复测试通过；追加 before_review_cancel（第二次 Worker 返回后、审核之前取消）13/13 通过。三类底层审核服务取消测试为实施后追加，未独立验证红侧。
- 完整 `pnpm test` 682/682 通过；随后只增加 before_review_cancel 测试，局部 investigation-runtime 13/13 通过。代码未再修改，记录更新后补跑 lint、strict/diff。3.1—3.3 跨 Case、生产接线审计与 web/e2e 仍未完成。

### 知识与历史案例取消接线

- 五个模型消费者新增前置、返回后、catch 取消检查，回合信号经过 KnowledgeTurn/CaseInvestigation/ParallelSourceCollector/RedmineBranch 显式传递；source collector 在 allSettled 后重新检查，不把取消降为普通 source failure 后派发 Worker。
- 五项模型阶段测试先以 Missing expected rejection 失败，修复后与既有收集测试 9/9 通过。追加实际 ParallelSourceCollector + RedmineBranch 测试验证同一信号传递及规划时取消后零 search；该追加测试首次即通过，不声称独立复现旧缺陷。
- 首次全量回归四项失败均为旧模型 options 精确断言：signal 未传时多出 undefined 字段。保留旧测试，改为仅有信号时添加字段，再运行完整门禁。
- 边界：仍保留旧 allSettled 等待其他非模型分支；取消不保证立刻中断进行中的 MCP/embedding 传输。Review/Presentation 和 Experience 主答仍待 2.2 贯通，不能宣布整体停止即时生效。
- 重跑 `pnpm test` 退出 0，678/678 通过，包含文档、类型与构建门禁；2.1 标记完成。记录更新后补跑 lint、OpenSpec strict 与 diff 检查。未访问真实工单或外部模型。

### Preflight 取消接线

- 新增 runtime-model-cancellation.test.mjs，两项初始失败：正式 runtime 停止仍等待 1 秒延迟正文；completeness review 未拒绝取消结果。修复显式 signal 传递及前后检查，取消不再进入普通模型失败日志/降级路径。
- `pnpm exec tsc -p tsconfig.build.json && node --test test/runtime-model-cancellation.test.mjs` 2/2 通过。HTTP 测试使用本地合成数据，断言正文尚未发送、仅一次模型请求、零 Worker、唯一 helper 与控制清理；不宣称真实远端计费停止。
- 首次 `pnpm test` 671/672 通过：既有 CLI API 连接失败测试的子进程触发自身 1000ms 超时；未修改该测试，按精确名称单跑 1/1 通过，随后重跑完整门禁。其他模型消费者及已冻结结果保留仍属未完成任务。
- 同版本重跑完整 `pnpm test` 退出 0，672/672 通过，包含文档、类型和构建门禁。OpenSpec strict 与 diff 检查通过；之后仅补充本验收记录，补跑 lint。尚未运行本 change 的 web/e2e 最终验收，不将 1.1/1.2 完成等同 D2 全部完成。

逐项记录任务编号、修改边界、失败命令及实际失败原因、成功命令及结果、兼容/隐私证据和未验证项。不得把 schema planning ready 当作行为完成。
