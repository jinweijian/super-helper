# 实施证据

## 范围与发布

已实现模式偏好、Runtime 策略、profiles、脱敏进度、真实取消、重试与设置页面。无新增依赖。运行在 codex/adaptive-code-investigation 独立 worktree。

profiles 保持默认关闭，Fast turn 数不设未经校准的默认值。真实 benchmark 没有执行：该测试会访问用户项目并调用模型产生费用，需显式 opt-in；当前交付不宣称已满足性能发布门槛。

## 验证记录

- 基线 pnpm test：569/569 通过。
- 实施 pnpm test：591/591 通过，包含 lint、TypeScript/Vue typecheck、前后端 build。
- 模式策略、控制器、Runtime 和 HTTP 联调：覆盖手动边界、一次升级、历史核验、按消息取消、脱敏进度和重试。
- Worker fake 进程测试：11 个新增案例与 7 个既有 Worker 回归通过。CLI 2.1.218 的 help 已本机检查；没有真实模型调用。
- 前端新增失败测试验证缺少选择器与 stop API，随后实现通过；覆盖接收成功复位和完整 profile 保存。

## 回头重新思考

- 初次实现仅杀父进程，审查复现后代持有输出管道导致取消挂起；已改专属进程组并添加忽略 TERM 的后代回归。
- 初次 trace 脱敏没有覆盖解析失败结果中的原始 evidence；已让 profile 解析失败返回固定安全 partial，并用 Fast/Deep sentinel 验证。
- 达到 turns 上限与模型故障分别处理：前者允许 Auto 升级，后者安全停止。
- 取消和导航分开：cancel 本地轮询不发送服务器停止；stop 明确请求当前 Case/message。旧回调不能修改新回合进度。
- 重复中断后的 retry 检查仅考虑该次中断后的日志，保留用户消息偏好。
- 旧配置/旧 Case 缺省字段继续兼容；新配置验证错误映射 HTTP 400。
- Windows taskkill 树终止实现存在，但本次测试环境为 macOS，未实测 Windows。

## 真实验收门槛

按 research-fast-code-investigation 的 opt-in 问题集比较现状/Fast/Deep/Auto。Fast L1 p50 降低至少 40%，validator 至少 80%；Auto 可审核率下降不超过 5 个百分点；Deep 人工质量下降不超过 0.3。记录具体模型路由和 Fast turns 后才能默认启用。
