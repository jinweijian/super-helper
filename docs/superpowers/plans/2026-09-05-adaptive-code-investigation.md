# 自适应代码排查实施计划

> 执行方式：subagent-driven-development 按职责实施并审查，当前会话连续集成。

**目标：** 落实已批准的当前消息模式、运行策略、进度与取消。

**架构：** Gateway 传偏好，Runtime 决定策略，Worker 执行；Case 持久化偏好，安全进度驻留 Runtime 内存。

**技术栈：** TypeScript、Node 子进程、Vue、Node test、Vitest。

## 全局约束

手动 Fast 不升级；Auto 最多一次升级；Deep 无短时正常终止限制。AnswerGoal/Evidence Review/Presentation 不变。默认测试不联网。

## 执行任务

- [x] 合同与 Worker：src/contracts/investigation.ts；src/config/contracts.ts；src/settings/；src/workers/。接口 diagnose(request, { signal?, onProgress? })，进度只包含 stage/searchCount/filesRead/lastActivityAt。先用 fake 子进程验证参数和取消，再实现适配器。
- [x] Runtime：src/runtime/investigation-policy.ts、investigation-control.ts，接入 worker-diagnosis 与 case-investigation；测试自动升级次数、手动边界、无进展停止和旧配置。
- [x] Session/Gateway：CaseMessage.investigationPreference；DiagnosticRequest.investigation；POST /api/chat/cancel 和 GET /api/chat/progress 按 caseId/userMessageId 查询；端到端测试默认值、非法枚举和重试。
- [x] UI：web/src/dashboard/ChatPanel.vue、use-chat.ts、SettingsForm.vue；自动/快速/深度仅当前消息，发送失败保留选择，停止调用服务器；Vitest 组件验证。
- [x] 审查与收尾：pnpm test、pnpm test:web，记录未跑真实 benchmark，保持未校准 profiles 默认关闭。

每项任务以相关合同测试通过为交付边界；新行为先写可失败测试，最后统一构建和全量回归。权威细项见 openspec/changes/adaptive-code-investigation/tasks.md。
