/** Screening, not proof of anonymity. Independent privacy review is also required. */
export function hasSensitiveExperienceText(text: string): boolean {
  const normalized = text.replace(/\\(["'])/g, '$1').replace(/\\\[已脱敏\\\]/g, '[已脱敏]');
  if (/https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b1[3-9]\d{9}\b|bearer\s+[a-z0-9._-]+/i.test(normalized)) return true;
  const credentials = normalized.matchAll(/(?:password|passwd|secret|api[_ -]?key|token|密码)["']?\s*[:=：]\s*["']?([^\s,;}]+)/gi);
  return [...credentials].some((match) => !/^\[已脱敏\]["']?$/.test(match[1]));
}

export function escapeExperienceMarkdown(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+!|])/g, '\\$1').replace(/\r\n?/g, '\n').replace(/\n/g, ' ');
}
