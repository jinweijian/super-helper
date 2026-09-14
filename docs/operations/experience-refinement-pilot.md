# 工单经验萃取试用部署

本文用于部署当前下一可交付阶段：从 Redmine 导出 CSV，经过本地导入、显式 AI 萃取和独立审核，发布为带来源绑定的 Markdown 经验。当前阶段不包含 Cognee 构图，也不包含在线诊断中的“经验检索与代码排查并行”。

## 交付边界

本次可试用能力：

- 严格读取 UTF-8 或 GB18030 CSV，不通过 Redmine API 拉取数据；
- 先做无正文输出的 profile，再将原始快照和脱敏记录写入私有 store；
- 只有显式传入 `--enable-model true` 时才把受限脱敏字段发送给配置的模型；
- 生成、独立审核、最多一次内容修订，按固定调用预算断点续跑；
- 审核通过后原子发布 Markdown、sidecar 和审核记录，支持重复运行和受控锁恢复。

本次不应宣称：

- Cognee 已可用于生产构图或查询；
- 当前 Dashboard 已能操作工单萃取；
- 合成测试能够证明真实工单的语义质量；
- 正则脱敏能够替代上线前的数据发送范围确认和隐私审核。

## 环境准备

需要 Node.js `>=20.19.0`、pnpm `>=10.0.0`，以及一份已通过 Onboarding 配置好 Agent 模型的 `config.json`。经验 store 必须位于仓库外的私有本地目录，不要放进 Git 工作区或共享同步盘。

```sh
cd /absolute/path/super-helper
pnpm install --frozen-lockfile
pnpm acceptance:experience:release
```

发布机如果不安装开发依赖，应在构建机完成上面的验收和 `pnpm build`，再交付完整的 `dist/`、`src/agents/`、`package.json` 及生产依赖。试用期更推荐保留完整仓库，便于按同一版本复核和回滚。

创建私有 store，并确认权限：

```sh
mkdir -p /absolute/private/super-helper-experience
chmod 700 /absolute/private/super-helper-experience
```

不要在命令行传 API Key。模型密钥继续使用 Onboarding 写入的 SecretRef；部署前只检查配置和密钥文件存在、权限符合要求，不输出文件内容。

## 第一次试用

以下示例使用固定 scope、来源实例和 job。首次试用建议只导入同一项目、同一导出规则的一小份 CSV，确认质量后再处理完整导出。

1. 只读检查 CSV：

```sh
node dist/cli.js experience profile \
  --file /absolute/path/issues.csv \
  --encoding gb18030
```

检查列映射、记录数、重复身份、占位值和日期失败数量。命令不会输出工单正文。如果字段名不是标准别名，准备严格 UTF-8 JSON 映射文件，例如 `{"ticketId":"单号","title":"摘要","cause":"原因说明"}`，并在 import 时通过 `--mapping` 指定。

2. 导入私有 store：

```sh
node dist/cli.js experience import \
  --file /absolute/path/issues.csv \
  --encoding gb18030 \
  --store /absolute/private/super-helper-experience \
  --scope pilot-product-a \
  --source-instance redmine-export
```

保存返回的 `batchId`，随后只读核对：

```sh
node dist/cli.js experience status \
  --store /absolute/private/super-helper-experience \
  --scope pilot-product-a \
  --source-instance redmine-export \
  --batch <batchId>
```

3. 确认实际发送范围与调用上限后，小批量启用模型：

```sh
node dist/cli.js experience refine \
  --store /absolute/private/super-helper-experience \
  --scope pilot-product-a \
  --source-instance redmine-export \
  --job pilot-2026-09-11-a \
  --config /absolute/private/super-helper/config.json \
  --max-calls 20 \
  --enable-model true
```

`max-calls` 是该 job 的持久化总调用上限，不是每次运行补充的额度。命令退出码 `0` 表示本轮无暂停或模型失败；退出码 `2` 表示已安全暂停或存在模型失败，应先查询状态，不要更换 job 绕过原预算。

```sh
node dist/cli.js experience status \
  --store /absolute/private/super-helper-experience \
  --scope pilot-product-a \
  --source-instance redmine-export \
  --job pilot-2026-09-11-a
```

中断后用完全相同的 store、scope、source-instance、job 和 max-calls 重跑 refine。已保存的阶段和已发布记录不会重新消耗模型调用。

## 试用验收

一次可接受的试用至少满足：

- profile 数量和 CSV 导出预期一致，没有未解释的重复 ID 或日期失败；
- import/status 不回显正文，store 目录权限为 `0700`，文件权限为 `0600`；
- 小批量 job 的调用数不超过设定预算，中断后可用原 job 续跑；
- 抽查发布 Markdown 的问题、原因、处理和验证结论能在对应源记录中找到依据；
- 缺附件、仅有计划、原因不确定或版本信息冲突的记录被明确降级或隔离；
- 同一源和 job 重跑不产生重复经验，也不增加已完成记录的模型调用。

发布产物位于 store 内部的 vault 对象目录，但正式可见性以原子 publication manifest 为准。不要用脚本扫描 Markdown 文件替代仓库读取边界，也不要手工修改已发布对象。

## 故障处理与回滚

收到 `SIGINT` 或 `SIGTERM` 时，当前任务会在安全边界停止；先运行 job status，再使用原参数续跑。

如果提示 writer 或 runner 锁存在，先确认同一主机上的原进程已经退出。只有工具能明确判断记录的 PID 不存在时，才执行受控恢复：

```sh
node dist/cli.js experience recover \
  --store /absolute/private/super-helper-experience \
  --scope pilot-product-a \
  --source-instance redmine-export \
  --lock runner \
  --confirm true
```

根据错误类型把 `runner` 改成 `writer`。恢复会重命名并保留旧锁证据，不会删除数据；若 PID 存活、主机不匹配或状态不明，命令会拒绝恢复。

本阶段没有自动推送 Cognee 或在线查询消费者，因此停止试用不需要迁移线上索引。回滚步骤是：停止 refine 进程，保留整个私有 store 作为审计证据，切回上一已验收代码版本；不要删除或覆盖 store。需要重新开始试验时使用新的空私有目录和新的 scope，而不是修改旧发布对象。

## 下一阶段入口

本阶段验收后才进入 Cognee：只消费 publication repository 返回的有效发布版本，完成 dataset 代际构建、来源回读、精确撤回、真实查询和重建验收；之后再把经验查询与代码排查接入同一个诊断协调器并行执行。
