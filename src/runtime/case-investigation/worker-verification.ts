import type { DiagnosticRequest } from '../../domain.js';
import type { WorkerDiagnosisService, WorkerEvidenceCollectionOutcome } from '../worker-diagnosis.js';
import type { HistoricalLead } from './contracts.js';

export type WorkerVerificationOutcome = WorkerEvidenceCollectionOutcome | { status: 'skipped' };

export class WorkerVerification {
  constructor(private readonly worker: Pick<WorkerDiagnosisService, 'collectEvidence'>) {}

  async collect(input: {
    request: DiagnosticRequest;
    leads: HistoricalLead[];
    needsFallbackWorker: boolean;
  }): Promise<WorkerVerificationOutcome> {
    if (input.leads.length === 0 && !input.needsFallbackWorker) return { status: 'skipped' };
    return this.worker.collectEvidence({ request: input.request, leads: input.leads });
  }
}
