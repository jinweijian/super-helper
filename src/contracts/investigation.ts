export type InvestigationPreference = 'auto' | 'fast' | 'deep';

export interface InvestigationExecution {
  requestedMode: InvestigationPreference;
  resolvedProfile: 'fast' | 'deep';
  attempt: 1 | 2;
  escalationAllowed: boolean;
}

export interface InvestigationProgress {
  stage: 'locating' | 'reading' | 'verifying' | 'summarizing';
  searchCount: number;
  filesRead: number;
  lastActivityAt: string;
}
