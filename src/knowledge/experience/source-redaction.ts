import { redactSecretText } from '../../redaction.js';

/** Mechanical input minimization; independent privacy review remains mandatory. */
export function redactExperienceSourceText(value: string, identityTerms: string[]): string {
  let result = value;
  for (const term of [...new Set(identityTerms)].filter((term) => term.length >= 2).sort((a, b) => b.length - a.length)) {
    result = result.split(term).join('[已脱敏]');
  }
  result = redactSecretText(result).replaceAll('[REDACTED]', '[已脱敏]');
  return result
    .replace(/(?:密码|passwd|secret)["']?\s*[:=：]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '[已脱敏]')
    .replace(/https?:\/\/[^\s<>"'）。，；]+/gi, '[已脱敏]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[已脱敏]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[已脱敏]')
    .replace(/\b1[3-9]\d{9}\b/g, '[已脱敏]');
}
