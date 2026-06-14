export const KNOWLEDGE_DIRECTORIES = [
  '_sources/whitepapers',
  '_pipeline/extracts',
  '_pipeline/normalized',
  '_pipeline/drafts',
  '_pipeline/repair-plans',
  '_pipeline/review',
  '_pipeline/publish',
  '_taxonomy',
  'modules',
  'faq',
  'runbooks',
  'tickets/solved-cases',
  'tickets/unresolved-cases',
  'whitepapers',
  'glossary/terms',
  'indexes',
  'reports',
] as const;

export const taxonomyTemplates: Record<string, string> = {
  'modules.yaml': `# Enterprise module taxonomy.
# Keep module ids stable. Runtime search uses these ids for routing.
modules:
  - id: general
    name: 通用知识
    owner: knowledge-admin
    keywords:
      - 通用
      - 帮助
    related_repos: []
    product_versions: []
`,
  'aliases.yaml': `# User-facing aliases mapped to canonical modules or terms.
aliases:
  - alias: 帮助中心
    module: general
  - alias: FAQ
    module: general
`,
  'intents.yaml': `# Supported user intents for knowledge routing.
intents:
  - id: troubleshooting
    name: 问题排查
  - id: how_to
    name: 操作流程
  - id: product_rule
    name: 产品规则
  - id: implementation_detail
    name: 实现细节
  - id: term_explanation
    name: 术语解释
  - id: module_explanation
    name: 模块说明
`,
  'source-types.yaml': `# Source types and MVP ranking weights.
source_types:
  - id: faq
    weight: 100
  - id: runbook
    weight: 95
  - id: solved_case
    weight: 90
  - id: whitepaper
    weight: 70
  - id: glossary
    weight: 50
  - id: module_doc
    weight: 45
  - id: unresolved_case
    weight: 10
`,
};

export const documentTemplates: Record<string, string> = {
  'faq/README.md': `---
id: kb_faq_general_example
title: 示例 FAQ
type: faq
module: general
intent: how_to
source_type: faq
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例 FAQ

## 问题

这里写用户常见问法。

## 答案

这里写可以被证据支持的答案。
`,
  'runbooks/README.md': `---
id: kb_runbook_general_example
title: 示例 Runbook
type: runbook
module: general
intent: troubleshooting
source_type: runbook
confidence: medium
status: draft
visibility: restricted
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例 Runbook

## 触发条件

## 快速判断

## 排查步骤
`,
  'whitepapers/README.md': `---
id: kb_whitepaper_general_example
title: 示例白皮书切片
type: whitepaper_slice
module: general
intent: product_rule
source_type: whitepaper
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
source_document: knowledge/_sources/whitepapers/example.pdf
source_document_id: src_whitepaper_example
source_pages: []
section_path: []
chunking_strategy: semantic-section-v1
---

# 示例白皮书切片

## 可回答的问题

- 这个切片适合回答什么问题？

## 核心规则

## 适用范围

## 不适用范围

## 原文来源
`,
  'tickets/solved-cases/README.md': `---
id: kb_case_solved_general_example
title: 示例已解决 Case
type: solved_case
module: general
intent: troubleshooting
source_type: solved_case
confidence: medium
status: review_required
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例已解决 Case

## 用户原始问题

## 归一化问题

## 使用过的证据

## 根因

## 解决方案

## 用户最终确认
`,
  'tickets/unresolved-cases/README.md': `---
id: kb_case_unresolved_general_example
title: 示例未解决 Case
type: unresolved_case
module: general
intent: troubleshooting
source_type: unresolved_case
confidence: low
status: review_required
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例未解决 Case

## 已知事实

## 未知项

## 阻塞原因
`,
  'modules/README.md': `---
id: kb_module_general_overview
title: 示例模块说明
type: module_overview
module: general
intent: module_explanation
source_type: module_doc
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例模块说明

## 模块职责

## 不负责什么

## 相关仓库
`,
  'glossary/terms/README.md': `---
id: kb_glossary_general_example
title: 示例术语
type: glossary_term
module: general
intent: term_explanation
source_type: glossary
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
aliases: []
---

# 示例术语

## 定义

## 常见别名
`,
};

export const sourceMetadataExample = `{
  "id": "src_whitepaper_example",
  "source_type": "whitepaper_pdf",
  "path": "knowledge/_sources/whitepapers/example.pdf",
  "sha256": "<file-hash>",
  "title": "Example Whitepaper",
  "downloaded_at": "2026-06-13T00:00:00.000Z",
  "source_url": "",
  "product_versions": [],
  "page_count": 0,
  "owner": "knowledge-admin",
  "ingest_tool_version": "manual-v1"
}
`;

export const evidenceChunkSchemaExample = `{"chunk_id":"chk_example_001","parent_id":"kb_whitepaper_general_example","source":"knowledge/whitepapers/README.md","source_document":"knowledge/_sources/whitepapers/example.pdf","source_document_id":"src_whitepaper_example","source_pages":[],"module":"general","intent":"product_rule","source_type":"whitepaper","status":"draft","confidence":"medium","headings":["示例白皮书切片","核心规则"],"keywords":["示例白皮书切片"],"text":"这里是派生检索 chunk 的文本。"}
`;
