# Cognee 接入证据与待验证合同

核对日期：2026-09-10。服务于总体计划 C，不表示已部署或已通过真实构图验收。本文记录官方文档与固定版本源码观察，不代替后续 OpenSpec 实施合同。

## 固定候选版本

GitHub releases/latest 当日返回 **v1.5.4**，发布日期 2026-09-04；tag 对应 commit `20e0bd88746de2d96e99b4b122361dfc3dad21bc`。搜索缓存仍出现 v1.4.0，不能作为实际版本依据。

- [发布记录](https://github.com/topoteretes/cognee/releases/tag/v1.5.4)
- [固定版本项目元数据](https://github.com/topoteretes/cognee/blob/v1.5.4/pyproject.toml)：Python >=3.10,<3.15，license 字段 Apache-2.0。
- [固定版本 LICENSE](https://github.com/topoteretes/cognee/blob/v1.5.4/LICENSE)：Apache License 2.0。此核对仅针对 Cognee OSS 主项目；部署依赖、数据库及模型服务条款仍需按所选组合检查，不代表全部依赖已完成商业合规审查。

## 接口观察与接入约束

| 能力 | 固定版本观察 | SuperHelper 接入约束 |
| --- | --- | --- |
| 导入 | add router 接收 multipart 文件或 raw_data，datasetId/datasetName；返回 PipelineRunInfo | 优先上传发布 MD 字节，不授权远端读任意本地路径，不上传 private 快照；记录远端 dataset/data 与本地 id/revision/hash 映射 |
| 构图 | cognify 接收 dataset_ids、run_in_background；后台执行需追踪状态 | 上传成功不等于构图完成；只允许完成且回读验收通过的 generation 激活 |
| 查询 | SearchPayloadDTO 使用 query/search_type/dataset_ids/only_context/verbose/include_references | 参数显式设置，不用自动路由或默认完成模式替主 Agent 再做一次终稿；不向工具开放任意图查询 |
| 状态 | datasets/status 可返回 dataset 到状态或多 pipeline 状态映射 | 不能把 HTTP 200 或非空对象当作完成；适配器按固定协议解析终态 |
| 删除 | datasets router 提供单 dataset 及单 data 删除 | 只操作本应用记录的精确对象；禁止全库 delete_all；本地撤回优先，远端清理失败不恢复可见性 |

固定源码入口（已只读检查）：

- [add router](https://github.com/topoteretes/cognee/blob/v1.5.4/cognee/api/v1/add/routers/get_add_router.py)
- [cognify router](https://github.com/topoteretes/cognee/blob/v1.5.4/cognee/api/v1/cognify/routers/get_cognify_router.py)
- [search router](https://github.com/topoteretes/cognee/blob/v1.5.4/cognee/api/v1/search/routers/get_search_router.py)
- [datasets router](https://github.com/topoteretes/cognee/blob/v1.5.4/cognee/api/v1/datasets/routers/get_datasets_router.py)

## 两个不能忽略的风险

1. **引用不是默认保证。** 在线 search guide 描述 completion 默认附引用，但 v1.5.4 HTTP SearchPayloadDTO 的 include_references 字段默认 false，且同一源码说明文字仍写 true。必须显式开启并解析实际结果；图候选缺少可验证来源时拒绝进入证据包。only_context 能省去最后的回答生成，但不能据此声称整个查询零模型/零 embedding 调用。
2. **dataset 名称不是 ACL。** 官方权限说明强调开启后端访问控制；关闭时查询可能忽略 dataset 过滤。共享数据按 UUID 指定，并在服务端权限之外执行本地 scope/generation/撤回检查。未经配置与拒绝访问反例测试，不宣称多租户隔离有效。

来源：[Search Basics](https://docs.cognee.ai/guides/search-basics)、[Datasets 权限](https://docs.cognee.ai/core-concepts/multi-user-mode/permissions-system/datasets)。在线页面可能滚动更新，实际接入以固定版本源码和运行时响应验证为准。

## 下一实施入口

先建立独立 C 阶段 change，固定 v1.5.4 候选及实际隔离环境，再用合成发布 MD 验证：导入、构图、来源回读、修订替换、撤回、重建。必须包含同症状不同原因、旧版事实、跨 scope、缺引用、部分构图失败反例。

应用层仍以发布 MD/sidecar 为权威。Cognee 只返回候选，retrieval 通过本地清单回读原文，校验 id/revision/hash 和撤回状态，原文证据再交既有 Review。可回读能力未验证之前，不把模型生成的摘要或猜测的源 ID 当作证据。

尚未完成：安装/启动固定版本、选定数据库与 ACL 实测、认证生命周期、真实响应 fixture、六条路径和文本/图检索质量对比。尚未发送真实工单或调用外部模型；C 阶段首项保持未完成。没有证据要求改用另一套图产品，也没有证据证明 Cognee 已比文本检索更快或更准。
