# Product Agents

`src/agents/` 是产品运行时 Agent 配置的唯一权威目录。

根目录 `AGENTS.md` 是仓库开发规范，不是产品 Agent 配置。

## Current Agents

- `main.md`: 主 Agent，负责完整用户回合和最终回复责任。
- `input-review.md`: 输入审核与 Preflight Gate Agent。
- `experience.md`: 历史经验复用 Agent。
- `knowledge-router.md`: 知识路由 Agent，负责模块、意图、关键词和升级信号识别。
- `evidence-judge.md`: 证据充分性 Agent，负责判断知识库证据是否足够或是否需要查代码。
- `case-curator.md`: Case 沉淀 Agent，负责生成待复核 solved case 草稿。
- `output-review.md`: 证据与输出审核 Agent。
- `presentation.md`: 美化输出 / persona-aware presentation Agent。
- `registry.json`: runtime stage 到 Agent 配置的配对表。

## Extension Rules

新增 Agent 时：

1. 在本目录新增 kebab-case markdown 配置。
2. 在 `registry.json` 增加 stage 配对。
3. 配置必须写明 role、responsibility、input contract、output contract、allowed dependencies，以及是否允许产生用户可见文本。
4. 不要把产品 Agent prompt 散落到 runtime、worker、docs 或根目录文件中。
