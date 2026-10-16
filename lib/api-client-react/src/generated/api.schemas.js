export const ReportVersionKind = {
  original: 'original',
  manual: 'manual',
  ai_accepted: 'ai_accepted',
  restore: 'restore',
};
export const ReportInteractionInputKind = {
  discuss: 'discuss',
  revise: 'revise',
};
export const ReportInteractionKind = {
  discuss: 'discuss',
  revise: 'revise',
};
export const ReportInteractionStatus = {
  prepared: 'prepared',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  accepted: 'accepted',
  rejected: 'rejected',
};
export const AnalysisOperationStatus = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
};
export const AnalysisOperationFailureCode = {
  interrupted: 'interrupted',
  fixture_failure: 'fixture_failure',
  invalid_result: 'invalid_result',
  provider_error: 'provider_error',
  timeout: 'timeout',
  incomplete_response: 'incomplete_response',
  save_failed: 'save_failed',
  context_changed: 'context_changed',
  preparation_failed: 'preparation_failed',
  unsupported_input: 'unsupported_input',
  case_busy: 'case_busy',
};
export const AnalysisSourceBasis = {
  lawyer_statement: 'lawyer_statement',
  documented: 'documented',
};
export const UserRole = {
  lawyer: 'lawyer',
  admin: 'admin',
};
export const CaseInfoTaskType = {
  analysis: 'analysis',
};
export const LawyerClientFieldsType = {
  individual: 'individual',
  organization: 'organization',
};
export const CaseFeesCurrency = {
  SAR: 'SAR',
};
export const CaseAttachmentStatus = {
  pending: 'pending',
  ready: 'ready',
  rejected: 'rejected',
  removing: 'removing',
};
export const LegalDocumentKind = {
  terms: 'terms',
  usage: 'usage',
  privacy: 'privacy',
};
export const DocumentInputKind = {
  terms: 'terms',
  usage: 'usage',
  privacy: 'privacy',
};
export const ExportSavedReportFormat = {
  docx: 'docx',
  pdf: 'pdf',
};
