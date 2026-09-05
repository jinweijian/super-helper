## 1. 合同与 Worker

- [x] 1.1 在 contracts/investigation.ts 定义偏好、执行和进度；CaseMessage 与 DiagnosticRequest 可选新增字段，旧记录兼容。
- [x] 1.2 在 config/settings 添加可选 profiles 校验/合并/公开视图，默认关闭，启用需模型与正整数 Fast turns。
- [x] 1.3 Worker port 支持 signal/onProgress；CC 显式参数、stream-json 白名单统计、取消、强制结束兜底与 max-turns partial。测试真实 fake 子进程路径。

## 2. Runtime 与 API

- [x] 2.1 SessionLifecycle 保存偏好，request builder 按消息 ID 恢复，retry 保持模式；添加旧 Case/round-trip 测试。
- [x] 2.2 Runtime 独立 policy 实现结构化选择、手动 Fast 禁止追查、Auto 一次 Deep、Deep 进展门禁，历史分支接入。
- [x] 2.3 Runtime 管理按 Case/message 的控制器；Gateway 校验偏好并添加 progress/cancel transport；测试并发隔离和取消重试。

## 3. 页面与验收

- [x] 3.1 ChatPanel/use-chat 增加当前消息选择、成功复位、安全进度和真实停止；SettingsForm 管理 profiles；组件测试验证传播。
- [x] 3.2 回头重新思考：检查真实调用路径、历史分支、取消竞态、旧配置和 raw 输出泄漏；审查修复。
- [x] 3.3 执行 pnpm lint/typecheck/build/test/test:web 并填写 implementation-notes；保留真实 benchmark 显式 opt-in 发布门槛。
