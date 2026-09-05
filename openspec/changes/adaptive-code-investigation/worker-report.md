# Worker / config / settings 实施报告

- 新增调查偏好、执行、进度合同，以及可选 Worker signal/onProgress。
- profiles 缺省沿用旧参数；完整配置经校验保存，拒绝空模型、非法 effort 和非正整数；没有提供未校准默认值。
- Fast 显式模型、effort、turns，候选优先并限定一次搜索扩大；Deep 显式模型、effort、stream-json/verbose，支持反证且无短 turns 上限。
- stream 协议按行有界消费，Read/Grep/Glob 白名单，工具 ID 与真实 workspace 内文件去重，符号链接越界拒绝。只临时保留最终 result envelope，profile trace 不保存 stdout/stderr、prompt、请求或 cwd。
- 支持启动前、排队中、busy 重试等待和运行中取消；SIGTERM 宽限 1 秒后 SIGKILL。排队取消不会释放仍活动的前序会话锁。
- Fast error_max_turns 即使 exit=1 也转 partial；其他 profile 失败结果不带原始 provider 错误。
- 验证：`pnpm exec tsc -p tsconfig.build.json`、8 个 investigation-worker 测试、7 个现有 Claude Worker 回归、`pnpm lint` 通过。默认测试全部离线，未使用真实模型。全量 build/typecheck/test 由主代理统一执行，避免并发删除 dist。

发布限制：真实 benchmark 尚未执行，profiles 保持默认缺省关闭；不得宣称模型/turns 已校准或性能门槛已达标。

## 审查修复

- POSIX 使用 detached 专属进程组，对整个组发送 SIGTERM 与宽限后 SIGKILL，覆盖主进程退出后后代仍占用管道的情况。Windows 使用无 shell 的 taskkill /PID /T，强制阶段增加 /F；Windows 路径未在本机实测。
- 增加真实 fake Worker 后代进程测试，验证取消结束管道等待、释放同 session 队列；测试后代会自行到期退出，失败时也不留下长驻进程。
- profile 解析错误的 raw fallback 和未知 subtype 均脱敏，Fast/Deep malformed success 与未知 envelope 的 PRIVATE_FILE_BODY sentinel 不进入结果。
- Fast turns 上限视为有界完成（trace exitCode=0、error 缺省），保留 error_max_turns partial，使 Runtime 能区别于 provider failure。
- 导出 InvestigationProfilesError 供 Gateway 映射 400。
- 本机 `claude --help` 明确列出 `--prompt-suggestions [value]` 支持 false；未发起模型调用。
- 更新验证：11 个新增测试、7 个旧 Worker 回归、TypeScript build 与 lint 通过。
