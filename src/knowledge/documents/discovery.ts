import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseMarkdownDocument } from '../frontmatter.js';
import { knowledgeRoot, relativeKnowledgePath } from '../paths.js';
import type { KnowledgeDocument, KnowledgeSourceDocument } from '../types.js';

export function discoverKnowledgeDocuments(workspaceRoot: string): KnowledgeDocument[] {
  const root = knowledgeRoot(workspaceRoot);
  if (!existsSync(root)) {
    return [];
  }

  return listMarkdownFiles(root)
    .filter((path) => !shouldSkipMarkdown(root, path))
    .flatMap((path) => {
      try {
        const parsed = parseMarkdownDocument(readFileSync(path, 'utf8'), relativeKnowledgePath(workspaceRoot, path));
        return [{
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          headings: extractHeadings(parsed.body),
          path,
          relativePath: relativeKnowledgePath(workspaceRoot, path),
        }];
      } catch {
        return [];
      }
    });
}

export function loadSourceDocuments(workspaceRoot: string): KnowledgeSourceDocument[] {
  const root = join(knowledgeRoot(workspaceRoot), '_sources');
  if (!existsSync(root)) {
    return [];
  }
  return listFiles(root)
    .filter((path) => path.endsWith('.meta.json'))
    .flatMap((path) => {
      try {
        return [JSON.parse(readFileSync(path, 'utf8')) as KnowledgeSourceDocument];
      } catch {
        return [];
      }
    });
}

function listMarkdownFiles(root: string): string[] {
  return listFiles(root).filter((path) => path.endsWith('.md'));
}

function listFiles(root: string): string[] {
  const entries = readdirSync(root).map((name) => join(root, name));
  return entries.flatMap((entry) => {
    const stat = statSync(entry);
    return stat.isDirectory() ? listFiles(entry) : [entry];
  });
}

function shouldSkipMarkdown(root: string, path: string): boolean {
  const relative = path.slice(root.length + 1).replaceAll('\\', '/');
  return (
    basename(path).toLowerCase() === 'readme.md' ||
    relative.startsWith('_pipeline/') ||
    relative.startsWith('_taxonomy/') ||
    relative.startsWith('_sources/') ||
    relative.startsWith('indexes/') ||
    relative.startsWith('reports/')
  );
}

function extractHeadings(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
    .filter((heading): heading is string => Boolean(heading));
}
