# 隔离启动探针

`startup-probe.py` 只启动/关闭 Cognee FastAPI lifespan，读取实际 OpenAPI 并验证匿名 datasets 请求被拒绝。不添加资料、不构图、不调用 LLM/embedding，不替代真实图后端与多用户 ACL 验收。

2026-09-10 已验证环境：仓库外 `/tmp/super-helper-cognee.N4WA17/venv`，Python 3.12.14，Cognee 1.5.4，Ladybug 0.19.0，LanceDB 0.38.0。该临时目录可能被系统清理；重建时使用独立 venv，禁止安装到系统 Python。完整环境依赖快照保留在实验目录 requirements.lock。

复现命令（目录必须是本实验专用，不指向现有业务 Cognee 存储）：

```sh
cd /tmp/super-helper-cognee.N4WA17
env -i PATH=/usr/bin:/bin \
  PYTHON_DOTENV_DISABLED=true TELEMETRY_DISABLED=1 \
  COGNEE_TRACING_ENABLED=false COGNEE_LOG_FILE=false CACHING=false \
  COGNEE_LOGS_DIR=/tmp/super-helper-cognee.N4WA17/logs \
  COGNEE_REPOS_DIR=/tmp/super-helper-cognee.N4WA17/repos \
  DATA_ROOT_DIRECTORY=/tmp/super-helper-cognee.N4WA17/data \
  SYSTEM_ROOT_DIRECTORY=/tmp/super-helper-cognee.N4WA17/system \
  CACHE_ROOT_DIRECTORY=/tmp/super-helper-cognee.N4WA17/cache \
  ENABLE_BACKEND_ACCESS_CONTROL=true \
  /tmp/super-helper-cognee.N4WA17/venv/bin/python \
  /Users/king/my/super-helper/openspec/changes/add-governed-cognee-experience-index/spikes/startup-probe.py
```

`env -i` 避免继承个人模型密钥；禁用 dotenv 防止库自动加载项目配置。cwd 也必须是隔离根，因为第三方 settings 可能读取当前目录 `.env`。不设置/覆盖 HOME。Cognee 会在隔离 SQLite 中执行迁移并初始化默认用户；TestClient 退出时关闭引擎，不留下监听端口。

运行结果应包含 version=1.5.4、startup=passed、anonymous_datasets_status=401（或403）。本次收到401。OpenAPI 生成时存在上游 Pydantic 默认值不可序列化警告，不能忽略其对实际字段默认值的影响；后续按实际请求逐项验收。

## 双用户 ACL 探针

上述命令末尾追加 `--acl`，通过真实注册和登录接口创建两个随机合成用户，再分别创建同名空 dataset。断言 dataset ID 不同、列表只含自己的 dataset、自己的 data 读取200、对方读取403或404。2026-09-10 实测双向均403；不是 mock 权限依赖。只证明空数据集的列表与读取隔离，尚不证明上传、构图、搜索及原文回读的权限链路。

探针在 import 前生成仅本进程使用的随机 `FASTAPI_USERS_JWT_SECRET`，不打印或保存 token/密码。上游缺配置时使用公开默认签名值，首次登录实验触发长度警告；正式部署必须通过 secret 管理显式配置稳定强密钥，不可照搬本探针的每次启动随机生成策略。

每次 ACL 执行会在专用临时 SQLite 中保留两个合成用户与两个空 dataset，不删除其他实验数据，也不调用全库删除。TestClient 无监听端口；该脚本不作为面向网络的服务启动入口。

## 合成导入探针（当前失败，不能当作已验收）

命令末尾追加 `--ingest`，包含 ACL 测试，再上传一份硬编码合成 MD，断言 external_metadata 中的 experience_id/revision/content_hash、原始字节一致性及其他用户原文读取拒绝。不读取业务文件。Python audit hook 拒绝 IPv4/IPv6 socket.connect；此保护只覆盖 Python 进程的 socket API，不等同于操作系统对子进程或原生扩展的网络沙箱。

导入模式显式设置测试占位密钥和上游支持的 `COGNEE_SKIP_CONNECTION_TEST=true`，仅跳过前置连通性探测；不 mock ingestion、ACL 或存储，也不证明真实模型配置可用。未设置跳过开关时，上游会执行 LLM 测试并重试，本实验的 Python 网络 guard 拦截了连接。

首次运行的失败点是 Ladybug worker 尝试创建 `/.lbdb/extension/0.19.0/osx_arm64/`。根因是清空环境后其连接级 home_directory 为空；不能通过覆盖 HOME 绕过隔离。Ladybug 0.19.0 已实测支持 `CALL home_directory = '<isolated cache>'`，并能从该目录加载 JSON 扩展；Cognee 1.5.4 GraphConfig 未暴露此项。

探针因此在 `--ingest` 模式禁用 graph subprocess，并仅在进程内包装 Ladybug Connection，第一条语句设置隔离 home_directory。这是验证上游数据库能力和后续适配方向的实验兼容层，不是生产实现。实际上传现已通过：add 200；data 列表以 camelCase 返回 `externalMetadata`，其中 experience_id/revision/content_hash 与请求一致；raw 回读字节与上传一致；另一用户 raw 回读403。安全响应形状见 `fixtures/ingest-readback.json`。构图、搜索、更新和撤回仍未验证。
