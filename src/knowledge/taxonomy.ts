import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSimpleYaml } from './frontmatter.js';
import { keywordsFromQuery } from './indexer.js';
import { knowledgeRoot } from './paths.js';
import type { KnowledgeRoute, KnowledgeSourceType } from './types.js';

export interface KnowledgeTaxonomy {
  modules: Array<{ id: string; name: string; keywords: string[]; relatedModules: string[] }>;
  aliases: Array<{ alias: string; module?: string; term?: string }>;
  intents: Array<{ id: string; keywords: string[] }>;
  sourceTypes: Array<{ id: KnowledgeSourceType; weight?: number }>;
}

const defaultSourceTypes: KnowledgeSourceType[] = ['faq', 'runbook', 'solved_case', 'whitepaper', 'glossary', 'module_doc'];

export function loadKnowledgeTaxonomy(workspaceRoot: string): KnowledgeTaxonomy {
  const root = join(knowledgeRoot(workspaceRoot), '_taxonomy');
  return {
    modules: loadSimpleList(join(root, 'modules.yaml')).map((item) => ({
      id: String(item.id ?? item.module ?? 'general'),
      name: String(item.name ?? item.id ?? 'general'),
      keywords: toStringArray(item.keywords),
      relatedModules: toStringArray(item.related_modules ?? item.relatedModules),
    })),
    aliases: loadSimpleList(join(root, 'aliases.yaml')).map((item) => ({
      alias: String(item.alias ?? item.term ?? item.id ?? ''),
      module: optionalString(item.module ?? item.target_module ?? item.target),
      term: optionalString(item.term ?? item.target_term),
    })).filter((item) => item.alias),
    intents: loadSimpleList(join(root, 'intents.yaml')).map((item) => ({
      id: String(item.id ?? item.intent ?? 'troubleshooting'),
      keywords: toStringArray(item.keywords),
    })),
    sourceTypes: loadSimpleList(join(root, 'source-types.yaml')).map((item) => ({
      id: String(item.id ?? item.source_type ?? 'faq') as KnowledgeSourceType,
      weight: typeof item.weight === 'number' ? item.weight : undefined,
    })),
  };
}

export function routeKnowledgeQuestion(input: { workspaceRoot: string; question: string }): KnowledgeRoute {
  const taxonomy = loadKnowledgeTaxonomy(input.workspaceRoot);
  const normalizedQuestion = normalize(input.question);
  const baseKeywords = keywordsFromQuery(input.question);
  const moduleCandidates = new Set<string>();
  const intentCandidates = new Set<string>();
  const sourceTypes = new Set<KnowledgeSourceType>();

  for (const alias of taxonomy.aliases) {
    if (alias.alias && normalizedQuestion.includes(normalize(alias.alias))) {
      if (alias.module) {
        moduleCandidates.add(alias.module);
      }
      if (alias.term) {
        for (const keyword of keywordsFromQuery(alias.term)) {
          baseKeywords.push(keyword);
        }
      }
    }
  }

  for (const module of taxonomy.modules) {
    const terms = [module.id, module.name, ...module.keywords];
    if (terms.some((term) => normalizedQuestion.includes(normalize(term)))) {
      moduleCandidates.add(module.id);
    }
  }

  for (const intent of taxonomy.intents) {
    if ([intent.id, ...intent.keywords].some((term) => normalizedQuestion.includes(normalize(term)))) {
      intentCandidates.add(intent.id);
    }
  }

  const codeEscalationSignals = detectCodeEscalationSignals(input.question);
  const risks = detectRisks(input.question);
  if (/怎么|如何|哪里|入口|步骤/.test(input.question)) {
    sourceTypes.add('faq');
    sourceTypes.add('runbook');
  }
  if (/规则|为什么|说明|介绍|是什么/.test(input.question)) {
    sourceTypes.add('whitepaper');
    sourceTypes.add('module_doc');
  }
  if (/报错|失败|异常|500|接口|路径|代码/.test(input.question)) {
    sourceTypes.add('runbook');
    sourceTypes.add('solved_case');
  }

  return {
    normalizedQuestion,
    moduleCandidates: Array.from(moduleCandidates),
    intentCandidates: Array.from(intentCandidates),
    keywords: Array.from(new Set(baseKeywords)),
    sourceTypes: Array.from(sourceTypes.size ? sourceTypes : defaultSourceTypes),
    codeEscalationSignals,
    risks,
  };
}

function loadSimpleList(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) {
    return [];
  }
  const text = readFileSync(path, 'utf8');
  const blocks = extractListItemBlocks(text);
  if (blocks.length === 0) {
    const parsed = parseSimpleYaml(text);
    const entries = parsed.items ?? parsed.modules ?? parsed.aliases ?? parsed.intents ?? parsed.source_types;
    return Array.isArray(entries) ? entries as Array<Record<string, unknown>> : [];
  }
  return blocks.map((block) => parseSimpleYaml(block));
}

function extractListItemBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] | undefined;
  let itemIndent = 0;

  for (const line of text.split(/\r?\n/)) {
    const itemMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (itemMatch) {
      const indent = itemMatch[1]!.length;
      if (current && indent > itemIndent) {
        current.push(line.slice(Math.min(line.length, itemIndent + 2)));
        continue;
      }
      if (current) {
        blocks.push(current.join('\n').trim());
      }
      itemIndent = indent;
      current = [itemMatch[2] ?? ''];
      continue;
    }

    if (!current) {
      continue;
    }

    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent > itemIndent) {
      current.push(line.slice(Math.min(line.length, itemIndent + 2)));
      continue;
    }

    blocks.push(current.join('\n').trim());
    current = undefined;
  }

  if (current) {
    blocks.push(current.join('\n').trim());
  }

  return blocks.filter(Boolean);
}

function detectCodeEscalationSignals(question: string): string[] {
  const signals: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ['http_status', /\b[45]\d\d\b/],
    ['interface_path', /\/[A-Za-z0-9_\-/{}:?=&.]+/],
    ['file_path', /\b[\w.-]+\/[\w./-]+\b|\b[\w.-]+\.(ts|tsx|js|mjs|json|php|java|py|go|rb)\b/i],
    ['class_or_method', /\b[A-Z][A-Za-z0-9_]+(?:Service|Controller|Repository|Job|Task)\b/],
    ['table_or_config', /\b(table|config|env|schema|字段|表名|配置项)\b|配置/i],
    ['error_log', /error|exception|trace|stack|日志|报错|异常|失败/i],
    ['workspace_project', /当前项目|这个项目|项目里|工作区|workspace|代码库|仓库|repo/i],
    ['file_evidence', /文件证据|引用文件|代码文件|源码证据|页面路由|路由|配置加载|运行时拆分/i],
    ['follow_up_reference', /刚刚|上一轮|上次|之前说|这个设置|那个设置|这个页面|那个页面|设置的地方/],
    ['current_implementation', /当前实现|代码|调用链|为什么现在|源码|接口/i],
  ];
  for (const [name, pattern] of patterns) {
    if (pattern.test(question)) {
      signals.push(name);
    }
  }
  return signals;
}

function detectRisks(question: string): string[] {
  const risks: string[] = [];
  const riskPatterns: Array<[string, RegExp]> = [
    ['payment', /支付|订单|退款|交易/],
    ['permission', /权限|越权|角色|登录|账号安全/],
    ['security', /安全|漏洞|泄露|密钥|token|密码/],
    ['data_repair', /修复数据|改数据|补数据|删除|生产数据库/],
    ['production_incident', /生产|线上|故障|事故|宕机/],
  ];
  for (const [name, pattern] of riskPatterns) {
    if (pattern.test(question)) {
      risks.push(name);
    }
  }
  return risks;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?;:：；"'`~\s]/g, '').trim();
}
