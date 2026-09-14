# 实施证据

## 2026-09-10 环境与计划基线

- 旧 research-graph-assisted-knowledge-retrieval 是手册 Hybrid RAG 的多产品比较，不符合当前 CSV 发布经验主线；保留不改，按总体 C 建立独立 change。
- 本机系统 Python 3.9.6，不符合 Cognee 版本要求；Docker CLI 存在但 daemon socket 不存在，未擅自启动 Docker 应用。
- 应用依赖工具返回的 Python 3.12.14 可用；创建隔离目录 `/tmp/super-helper-cognee.N4WA17`，不修改系统 Python 或既有环境。仅准备依赖，不读取真实资料或默认调用模型。
- 官方版本与接口证据在 docs/architecture/cognee-integration-evidence.md。本阶段无能力勾选完成；依赖安装不等于图服务可用。
- Python 3.12.14 venv 下 `pip install --dry-run cognee==1.5.4` 依赖解析退出 0，随后隔离环境实际 `pip install cognee==1.5.4` 退出 0；安装日志保留在该临时根目录。未启动 Cognee、未 import 其初始化入口、未触发构图或查询。计划 strict、pnpm lint 与 diff 检查通过。
- 安装后 `pip check` 返回 No broken requirements found，metadata 确认 cognee 1.5.4、lancedb 0.38.0。尝试按旧文档假设查询 kuzu 分发包未找到；必须从当前安装版配置确认实际 graph backend，不能把旧版 Kuzu 描述当作已部署事实。

## 后续证据要求

### 隔离 import 与真实 API lifespan

- 安装版配置源码确认默认 graph provider 与 dataset handler 为 ladybug，实际分发包 ladybug 0.19.0；不再将缺少 kuzu 分发包视为安装失败。
- 使用清空继承环境、禁用 dotenv/遥测/tracing/file logging/会话缓存、显式隔离 data/system/cache/logs/repos 路径。import 确认实际 system 路径为 /private/tmp/super-helper-cognee.N4WA17/system，认证 required，multi-tenant enabled。
- 新增 spikes/startup-probe.py 与复现说明；真实 FastAPI TestClient lifespan 执行 SQLite 迁移、默认用户初始化与关闭。实际 OpenAPI 含 add/cognify/search/datasets；匿名 GET datasets 返回401。命令退出0，无外部模型凭证，无添加/构图/查询调用。
- 上游 OpenAPI 生成存在 Pydantic 非序列化默认值警告；启动通过不代表所有 DTO 正确。图/向量库实际建库、多用户 ACL、认证和六条路径尚未验收，1.1—1.3 保持未完成。探针首次即通过，不声称复现产品缺陷。

按任务记录执行命令、版本/hash、失败侧与成功侧、模型发送范围/调用上限、六条路径的实际响应、权限反例、未验证项。敏感值和完整企业文档不进入本文件或 fixture。

### 真实双用户认证与空 dataset 隔离

- `startup-probe.py --acl` 使用真实注册201、登录200和 dataset 创建200；同名 dataset 得到不同 ID，双方列表均不暴露对方 dataset，自己的空 data 返回200，对方返回403。真实 SQLite 与 ACL 实现，无模型、无 mock 用户依赖。
- 首次登录暴露上游默认 JWT 签名值过短警告。检查安装版 get_api_auth_backend.py/get_client_auth_backend.py，确认为缺 `FASTAPI_USERS_JWT_SECRET` 时的公开默认值。探针已改用 import 前生成的48字节随机密钥，不保存凭证；正式部署稳定密钥要求见 spikes/README.md。
- 此证据缩小认证和 dataset ACL 的未知范围，但不替代有数据时的 source 回读、图查询与写入隔离。1.2 保持未完成，下一步是合成 MD 上传、metadata 和原文一致性回读。

### 合成导入失败侧证据

- 新增 --ingest 路径与 Python socket 连接拦截。无凭证 add 返回500，安装版异常为 LLMAPIKeyNotSetError；设置占位值后实际启动 LLM connection test，连接被拦截并进入退避重试，已中断且进程终态130，无存活测试进程。
- 安装版 setup_and_check_environment.py 支持 COGNEE_SKIP_CONNECTION_TEST。探针显式启用后确认日志 Skipping LLM/embedding connection tests，继续进入真实 Ladybug worker，但扩展目录落到 /.lbdb/extension/0.19.0/osx_arm64/，只读目录导致 RuntimeError 和 add500。后一次复核同样失败，进程退出1。
- 这是隔离部署问题，不是来源映射验证通过；MD/raw 断言尚未到达，不勾选1.1/1.2。下一步验证上游扩展路径和 worker 环境的受支持配置，继续保留真实导入链路，不通过 mock 图后端制造成功。

### 合成导入与原文回读成功侧

- Ladybug 0.19.0 连接执行 `CALL home_directory = '<isolated cache>'` 后可安装并加载 JSON，加载位置确认在隔离 cache 下。Cognee 1.5.4 未暴露该设置；探针用进程内 Connection 包装且关闭 graph subprocess 验证方向，不把实验包装器当生产方案。
- 固定合成 MD 经真实 `/api/v1/add` 返回200；随后 data list 返回一个记录，HTTP 键为 camelCase `externalMetadata`，experience_id/revision/content_hash 完整保留。raw endpoint 返回字节与上传内容一致，另一个用户读取同一 raw endpoint 返回403。
- 结果证明正式 provider 可将本地发布身份写入远端 data metadata，并用 datasetId/dataId 回读源副本；仍必须以本地发布库为权威并校验本地 hash。add 成功不等于 cognify 完成，1.2继续保持未完成。
- 隔离版本、依赖快照、禁遥测/缓存/配置加载、真实启动关闭、认证与空 dataset ACL 已具备可复现证据，任务1.1完成。任务1.2尚缺构图状态、search references/source映射和跨 scope 写/查询反例。
