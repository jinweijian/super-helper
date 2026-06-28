import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CaseMessage, CaseSession, DiagnosticLogEvent, DiagnosticRun } from '../domain.js';
import type { CaseRepository } from './case-repository.js';

export interface StoredCase extends CaseSession {
  createdAt: string;
  updatedAt: string;
}

export class FileMemoryStore implements CaseRepository {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.ensure();
  }

  ensure(): void {
    mkdirSync(this.casesDir, { recursive: true });
    mkdirSync(this.memoryDir, { recursive: true });
  }

  get casesDir(): string {
    return join(this.rootDir, 'cases');
  }

  get memoryDir(): string {
    return join(this.rootDir, 'memory');
  }

  get dailyMemoryPath(): string {
    return join(this.memoryDir, `${new Date().toISOString().slice(0, 10)}.md`);
  }

  casePath(caseId: string): string {
    return join(this.casesDir, `${caseId}.json`);
  }

  createCase(input: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    title: string;
  }): StoredCase {
    const now = new Date().toISOString();
    const caseSession: StoredCase = {
      id: `case_${randomUUID().slice(0, 8)}`,
      claudeSessionId: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      title: input.title,
      status: 'collecting_input',
      userPersona: 'operations',
      messages: [],
      runs: [],
      logs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.saveCase(caseSession);
    this.appendDailyMemory(`- ${now} Created ${caseSession.id}: ${input.title}`);
    return caseSession;
  }

  loadCase(caseId: string): StoredCase | undefined {
    const path = this.casePath(caseId);
    if (!existsSync(path)) {
      return undefined;
    }

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredCase;
    let migrated = false;
    if (!parsed.claudeSessionId) {
      parsed.claudeSessionId = randomUUID();
      migrated = true;
    }
    if (!parsed.logs) {
      parsed.logs = [];
      migrated = true;
    }
    if (!parsed.messages) {
      parsed.messages = [];
      migrated = true;
    }
    if (!parsed.runs) {
      parsed.runs = [];
      migrated = true;
    }
    if (!parsed.userPersona) {
      parsed.userPersona = 'operations';
      migrated = true;
    }
    if (migrated) {
      writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    }
    return parsed;
  }

  listCases(limit = 30): StoredCase[] {
    if (!existsSync(this.casesDir)) {
      return [];
    }

    return readdirSync(this.casesDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try {
          return this.loadCase(file.replace(/\.json$/, ''));
        } catch {
          return undefined;
        }
      })
      .filter((caseSession): caseSession is StoredCase => Boolean(caseSession))
      .sort((a, b) => {
        if (a.pinnedAt && !b.pinnedAt) return -1;
        if (!a.pinnedAt && b.pinnedAt) return 1;
        if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt);
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, limit);
  }

  saveCase(caseSession: StoredCase): void {
    caseSession.updatedAt = new Date().toISOString();
    writeFileSync(this.casePath(caseSession.id), `${JSON.stringify(caseSession, null, 2)}\n`, 'utf8');
  }

  addMessage(caseSession: StoredCase, message: Omit<CaseMessage, 'id' | 'createdAt'>): CaseMessage {
    const fullMessage: CaseMessage = {
      id: `msg_${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      ...message,
    };
    caseSession.messages.push(fullMessage);
    this.saveCase(caseSession);
    return fullMessage;
  }

  addRun(caseSession: StoredCase, run: DiagnosticRun): DiagnosticRun {
    caseSession.runs.push(run);
    this.saveCase(caseSession);
    return run;
  }

  addLogEvent(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent {
    const fullEvent: DiagnosticLogEvent = {
      id: `log_${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      ...event,
    };
    caseSession.logs ??= [];
    caseSession.logs.push(fullEvent);
    this.saveCase(caseSession);
    return fullEvent;
  }

  updateTitle(caseSession: StoredCase, title: string): StoredCase {
    caseSession.title = title;
    this.saveCase(caseSession);
    return caseSession;
  }

  pinCase(caseSession: StoredCase): StoredCase {
    caseSession.pinnedAt = new Date().toISOString();
    this.saveCase(caseSession);
    return caseSession;
  }

  unpinCase(caseSession: StoredCase): StoredCase {
    delete caseSession.pinnedAt;
    this.saveCase(caseSession);
    return caseSession;
  }

  archiveCase(caseSession: StoredCase): StoredCase {
    caseSession.archivedAt = new Date().toISOString();
    this.saveCase(caseSession);
    return caseSession;
  }

  deleteCase(caseId: string): boolean {
    const path = this.casePath(caseId);
    if (!existsSync(path)) {
      return false;
    }
    unlinkSync(path);
    return true;
  }

  appendDailyMemory(line: string): void {
    const existing = existsSync(this.dailyMemoryPath)
      ? readFileSync(this.dailyMemoryPath, 'utf8')
      : `# super helper memory ${new Date().toISOString().slice(0, 10)}\n\n`;
    writeFileSync(this.dailyMemoryPath, `${existing}${line}\n`, 'utf8');
  }
}
