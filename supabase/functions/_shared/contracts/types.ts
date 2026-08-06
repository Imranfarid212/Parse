export type Category = {
  id: number;
  name: string;
  is_default: boolean;
  is_system: boolean;
};

export type OnboardingState = {
  user_id: string;
  country: string | null;
  default_currency: string;
  onboarding_complete: boolean;
  selected_category_ids: number[];
};

export type SessionShape = {
  user_id: string;
  email: string | null;
  access_token_expires_at: string | null;
};

export type ExtractAck = {
  status: 200 | 202;
  receipt_id: string;
  image_path: string;
  acked_at: string;
  extraction_mode?: 'balanced' | 'precise';
};

export type ExtractionLineItem = {
  name: string;
  qty: number;
  amount: number;
};

export type ExtractionResult = {
  merchant: string;
  txn_date: string;
  currency: string;
  total: number;
  line_items: ExtractionLineItem[];
  suggested_category: string;
  is_receipt: boolean;
};

export type ReceiptView = 'card' | 'list';

export type ExportArtifact = {
  kind: 'workbook' | 'statement' | 'images';
  file_name: string;
  file_path: string;
  byte_size: number;
  receipt_count: number;
  part: number;
  part_count: number;
};

export type ExportJob = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  format: 'xlsx' | 'pdf';
  include_images: boolean;
  filters: SearchQuery;
  artifacts: ExportArtifact[];
  receipt_count: number | null;
  timezone: string | null;
  error: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SearchQuery = {
  text?: string;
  date_from?: string;
  date_to?: string;
  category_ids?: number[];
  amount_min?: number;
  amount_max?: number;
  amount_currency?: string;
  view?: ReceiptView;
};
