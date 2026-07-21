export const errorCodes = [
  'QUOTA_EXHAUSTED',
  'RATE_LIMITED',
  'NOT_A_RECEIPT',
  'PROVIDER_DELAY',
  'VALIDATION_FAILED',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export type ContractError = {
  code: ErrorCode;
  message: string;
  payload?: unknown;
};
