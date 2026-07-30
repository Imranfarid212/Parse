export const receiptStatuses = ['processing', 'needs_review', 'confirmed', 'rejected', 'failed'] as const;
export type ReceiptStatus = (typeof receiptStatuses)[number];

export const confirmedVia = ['user', 'auto'] as const;
export type ConfirmedVia = (typeof confirmedVia)[number];

export const captureModes = ['default', 'one_click'] as const;
export type CaptureMode = (typeof captureModes)[number];

export const extractionModes = ['balanced', 'precise'] as const;
export type ExtractionMode = (typeof extractionModes)[number];

export const providers = ['grok', 'gemini'] as const;
export type Provider = (typeof providers)[number];

export const jobStatuses = ['queued', 'running', 'done', 'dead'] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const ledgerReasons = ['signup', 'referral_bonus', 'referred_signup', 'scan_used', 'refund', 'admin'] as const;
export type LedgerReason = (typeof ledgerReasons)[number];

export const referralStatuses = ['pending', 'released', 'blocked'] as const;
export type ReferralStatus = (typeof referralStatuses)[number];

export const exportFormats = ['xlsx', 'pdf'] as const;
export type ExportFormat = (typeof exportFormats)[number];
