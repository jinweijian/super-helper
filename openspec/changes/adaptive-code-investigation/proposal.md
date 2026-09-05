## Why

CC 默认继承高 effort 和无界搜索，简单排查延迟高。实施已批准的自适应排查设计，使用户能按当前消息选择自动、快速或深度。

## What Changes

- 增加当前消息偏好和重试恢复；Runtime 决定实际 profile 及一次升级。
- CC 显式配置 model/effort，支持脱敏流式进度和真实取消。
- 设置页管理 profiles；未校准配置保持兼容行为，真实评测后启用。

## Capabilities

### New Capabilities

- `adaptive-code-investigation`: 消息模式、Worker profiles、升级、进度与取消。

### Modified Capabilities

无；原有审核与表达合同继续生效。

## Impact

涉及 contracts、config/settings、sessions、runtime、workers、gateway 和 web。API 与 Case JSON 仅可选字段新增，旧记录缺省 auto；不新增依赖，不更换 Harness，不执行真实付费评测。
