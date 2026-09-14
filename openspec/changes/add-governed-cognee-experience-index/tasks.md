## 1. 固定版本实验

- [x] 1.1 在仓库外隔离环境准备 Cognee v1.5.4，记录 Python/依赖/存储后端版本、权限与禁用遥测配置；在 spikes 提供可复现启动/停止说明，不修改系统环境。
- [ ] 1.2 通过固定版本实际 HTTP/OpenAPI 验证认证、导入、构图任务状态、引用字段及 source 回读，保存脱敏合成响应 fixture；证明跨 scope 拒绝，不猜测 API。
- [ ] 1.3 合成已发布 MD 验证导入/构图/查询/更新/撤回/重建，记录真实与 fake 模型的边界；外部模型必须显式 opt-in，不把技术连通性冒充质量验收。

## 2. 索引治理

- [ ] 2.1 在 contracts/experience-index.ts 固定中性端口，在 providers/experience-index 拆 factory/adapter/protocol；先写失败测试，覆盖鉴权失败、正文超时、取消、畸形和无来源响应，普通 pnpm test 不联网。
- [ ] 2.2 在 knowledge/experience 增加 generation/mapping 仓库，在 application/experience-index-service.ts 组合已发布输入、远端任务确认和原子激活；证明部分写入、重启、撤回和回滚不会发布旧事实。
- [ ] 2.3 在 retrieval/experience 实现本地原文回读证据包；测试跨 scope、假 revision、hash 变化、缺来源及共享节点残留。图返回文本不得成为用户最终回复。

## 3. 可交付入口与验收

- [ ] 3.1 增加显式配置/CLI 或 application probe 入口，复用 SecretRef，默认关闭；实际 CLI 合成闭环证明装配接线与失败退出码，保持旧 HTTP/Case shape。
- [ ] 3.2 对同批发布经验比较文本与图的候选正确性、版本区分、无命中和延迟；真实企业数据仅授权后验收。没有回读和撤回真实证据不得进入在线灰度。
- [ ] 3.3 回头重新思考：审计上传成功假装构图完成、无来源摘要、缓存串 scope、旧 generation 复活、任意远端删除/查询、秘密泄漏与默认付费；补反例并执行 pnpm test、OpenSpec strict 和 diff 检查。
- [ ] 3.4 更新总体计划 C 与实际架构文档，记录未完成的 D5/E 集成、真实质量验收和回退边界，不能以此 change 完成宣告整个目标完成。
