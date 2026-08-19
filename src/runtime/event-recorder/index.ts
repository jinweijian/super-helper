import type { CaseRepository } from '../../sessions/case-repository.js';
import type { RuntimeEventRecorder } from '../ports.js';
import { createEventRecorderSink } from './base.js';
import { createConversationEvents, type ConversationEvents } from './conversation.js';
import { createCuratorEvents, type CuratorEvents } from './curator.js';
import { createKnowledgeEvents, type KnowledgeEvents } from './knowledge.js';
import { createPreflightEvents, type PreflightEvents } from './preflight.js';
import { createReviewEvents, type ReviewEvents } from './review.js';
import { createWorkerEvents, type WorkerEvents } from './worker.js';
import { createCaseInvestigationEvents, type CaseInvestigationEvents } from './case-investigation.js';

export interface CaseRuntimeEventRecorder
  extends RuntimeEventRecorder, ConversationEvents, PreflightEvents, KnowledgeEvents, ReviewEvents, CuratorEvents, WorkerEvents, CaseInvestigationEvents {}

export class CaseRuntimeEventRecorder {
  constructor(cases: Pick<CaseRepository, 'addLogEvent'>) {
    const sink = createEventRecorderSink(cases);
    Object.assign(this, sink, createConversationEvents(sink), createPreflightEvents(sink), createKnowledgeEvents(sink), createReviewEvents(sink), createCuratorEvents(sink), createWorkerEvents(sink), createCaseInvestigationEvents(sink));
  }
}

export type { ModelPreflightParsed } from './preflight.js';
export type { ModelReviewParsed } from './review.js';
