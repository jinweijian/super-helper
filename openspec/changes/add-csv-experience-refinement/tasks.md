## 1. 输入和契约

- [x] 1.1 在 `src/knowledge/experience/csv/` 实现严格解析、显式字段映射、安全 profile；合成 fixture 覆盖多行、BOM、GB18030、错误编码、重复列/ID、占位文本及日期，先确认失败测试，再通过。
- [x] 1.2 在 `src/knowledge/experience/` 实现经验 schema、稳定身份、来源绑定与同源 MD/sidecar 渲染；覆盖伪造引用、根因/恢复等级、版本混淆和草稿隔离。
- [x] 1.3 实现受限 source snapshot、批次与修订 repository、锁和原子 checkpoint；证明重复/乱序/部分导出、取消恢复、路径越界和崩溃不破坏已发布数据。

## 2. 模型和审核

- [x] 2.1 修复 `src/providers/model/adapter.ts` 的正文读取超时、安全错误和可选取消；本地 HTTP 测试先复现正文延迟，验证取消和正常完成清理，不声称已贯通全部 runtime 消费者。
- [x] 2.2 注册提炼和审核产品 Agent；`src/application/experience-refinement/` 用同一脱敏源独立审核，终检不接受伪造来源；fake model 验证注入、未实施计划、缺附件和错误 JSON。
- [x] 2.3 实现一次修订上限、独立有界网络重试、预算、逐行续跑和发布清单；完整 MD/sidecar 从审定对象同源生成，终检脱敏且 hash 可复核。

## 3. 用户入口与验收

- [x] 3.1 `src/cli/command-experience.ts` 接入 profile/import/refine/status，入口保持薄；合成 CSV 通过真实 CLI 离线导入，refine 必须显式启用真实模型。
- [x] 3.2 创建 `.agents/skills/refine-ticket-csv/` 操作 Skill，复用 CLI 和权威 schema，不复制产品 prompt；更新架构与命令文档并验证 Skill。
- [ ] 3.3 使用用户 CSV 做真实本地 profile/import 验收，不提交源数据；明确可信 scope 与发送范围、调用预算后做真实模型小批量，再扩量，记录未验证部分。
- [x] 3.4 回头重新思考：独立审查源绑定、数据泄漏、虚假验证、部分发布、符号链接、恢复、实际 CLI 接线及错误明文；发现反例补测试，运行 `pnpm test` 并记录结果。

## 4. 全局衔接

- [x] 4.1 更新总体计划 A/B 证据与 C—E 下一阶段入口；本 change 完成不替代 Cognee、并行运行时、旧链路迁移与整体效果验收。
