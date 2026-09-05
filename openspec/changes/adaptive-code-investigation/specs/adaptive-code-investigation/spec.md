## ADDED Requirements

### Requirement: 当前消息模式
系统 SHALL 接受 auto/fast/deep，仅影响当前消息，缺省 auto，非法值 400，重试保留原值。

#### Scenario: 消息发送与重试
- **WHEN** 用户发送 fast 消息后选择其他模式并重试原消息
- **THEN** 原消息仍 fast，发送成功后的输入选择器恢复 auto

#### Scenario: 旧记录
- **WHEN** Case 缺少偏好字段
- **THEN** 读取为 auto，无批量改写

### Requirement: Runtime 路由与审核
系统 SHALL 以结构化信号选择 profile，不增加模型调用；手动 fast 不升级；auto fast 证据不足仅升级一次；deep 按进展控制 follow-up。

#### Scenario: 快速不足
- **WHEN** auto fast 未形成最终审核结论
- **THEN** 创建独立 deep Run 保持 AnswerGoal，手动 fast 同场景停止

#### Scenario: 复杂与重复任务
- **WHEN** 存在历史核验、冲突、多模块或无可靠候选
- **THEN** auto 直接 deep；无新证据的 deep 不重复追查

### Requirement: Worker profiles 和取消
系统 SHALL 显式传递 model/effort，fast 使用配置 maxTurns，deep 无短 turn cap；取消必须终止目标子进程。

#### Scenario: 参数与边界
- **WHEN** profiles 启用后派发 fast 或 deep
- **THEN** 参数来自设置且保留只读策略；max-turns partial 不会重跑同档

#### Scenario: 取消与流式隐私
- **WHEN** 收到流式事件或取消请求
- **THEN** 仅发布白名单阶段/计数/活动时间，拒绝路径正文和 reasoning，取消仅命中当前回合

#### Scenario: 旧配置及失败
- **WHEN** profiles 缺失或关闭
- **THEN** 保持原执行参数；启用后模型不可用安全失败而非切换模型

### Requirement: 验收发布
系统 SHALL 默认离线验证；真实 benchmark 显式 opt-in，未通过前不默认启用 profiles。

#### Scenario: 本地测试
- **WHEN** 执行 pnpm test
- **THEN** 不联网、不花费模型额度，覆盖旧合同和新行为
