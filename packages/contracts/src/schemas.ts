import { z } from 'zod';

import {
  captureModes,
  confirmedVia,
  exportFormats,
  extractionModes,
  jobStatuses,
  ledgerReasons,
  providers,
  receiptStatuses,
  referralStatuses,
} from './enums';
import { errorCodes } from './errors';

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/);

export const receiptStatusSchema = z.enum(receiptStatuses);
export const confirmedViaSchema = z.enum(confirmedVia);
export const captureModeSchema = z.enum(captureModes);
export const extractionModeSchema = z.enum(extractionModes);
export const providerSchema = z.enum(providers);
export const jobStatusSchema = z.enum(jobStatuses);
export const ledgerReasonSchema = z.enum(ledgerReasons);
export const referralStatusSchema = z.enum(referralStatuses);
export const errorCodeSchema = z.enum(errorCodes);
export const exportFormatSchema = z.enum(exportFormats);

export const categorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(80),
  is_default: z.boolean(),
  is_system: z.boolean(),
});

export const sessionShapeSchema = z.object({
  user_id: uuidSchema,
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int().positive(),
});

export const onboardingStateSchema = z.object({
  user_id: uuidSchema,
  country: z.string().min(2).max(2),
  default_currency: currencySchema,
  selected_category_ids: z.array(z.number().int().positive()).min(2),
  onboarding_complete: z.boolean(),
});

export const extractRequestSchema = z.object({
  capture_id: uuidSchema,
  mode: captureModeSchema,
  extraction_mode: extractionModeSchema.default('precise'),
  extracted_text: z.string().max(12_000).optional(),
  captured_at: z.string().datetime(),
  image: z.object({
    uri: z.string().min(1),
    content_type: z.literal('image/jpeg'),
    byte_size: z.number().int().positive().max(2_000_000),
  }),
});

export const extractAckSchema = z.object({
  status: z.union([z.literal(200), z.literal(202)]),
  receipt_id: uuidSchema,
  /**
   * Where the image is stored, or null when no image is stored yet.
   *
   * Nullable per DL-002. Precise holds the image at ack time and always has a
   * path. Balanced is text-first — the server never receives the image — so it
   * has nothing to point at until the separate upload lands. This used to be a
   * non-null string, which left Balanced no way to say "not yet" and so it
   * returned a path to an object that did not exist. Nothing consumed it, but
   * the contract entitled someone to.
   */
  image_path: z.string().min(1).nullable(),
  acked_at: z.string().datetime(),
});

export const extractionLineItemSchema = z.object({
  name: z.string().min(1).max(160),
  qty: z.number().positive().default(1),
  amount: z.number().nonnegative(),
});

export const extractionResultSchema = z.object({
  merchant: z.string().min(1).max(160),
  txn_date: isoDateSchema,
  currency: currencySchema,
  total: z.number().nonnegative(),
  line_items: z.array(extractionLineItemSchema),
  suggested_category: z.string().min(1).max(80),
  is_receipt: z.boolean(),
});

export const extractResponseSchema = z.union([
  extractAckSchema.extend({ status: z.literal(200), result: extractionResultSchema }),
  extractAckSchema.extend({
    status: z.literal(200),
    rejected: z.literal(true),
    result: extractionResultSchema.extend({
      is_receipt: z.literal(false),
      line_items: z.array(extractionLineItemSchema).length(0),
    }),
  }),
  extractAckSchema.extend({ status: z.literal(202), code: z.literal('PROVIDER_DELAY') }),
  z.object({ status: z.literal(402), code: z.literal('QUOTA_EXHAUSTED'), paywall: z.enum(['plus', 'unlimited']) }),
  z.object({ status: z.literal(429), code: z.literal('RATE_LIMITED') }),
]);

export const searchQuerySchema = z
  .object({
    text: z.string().trim().max(120).optional(),
    date_from: isoDateSchema.optional(),
    date_to: isoDateSchema.optional(),
    category_ids: z.array(z.number().int().positive()).max(100).optional(),
    amount_min: z.number().nonnegative().optional(),
    amount_max: z.number().nonnegative().optional(),
    amount_currency: currencySchema.optional(),
    view: z.enum(['card', 'list']).optional(),
  })
  .superRefine((query, ctx) => {
    if ((query.amount_min !== undefined || query.amount_max !== undefined) && !query.amount_currency) {
      ctx.addIssue({ code: 'custom', path: ['amount_currency'], message: 'Currency is required with amount filters' });
    }
    if (query.amount_min !== undefined && query.amount_max !== undefined && query.amount_min > query.amount_max) {
      ctx.addIssue({ code: 'custom', path: ['amount_max'], message: 'Maximum amount must be at least the minimum' });
    }
    if (query.date_from && query.date_to && query.date_from > query.date_to) {
      ctx.addIssue({ code: 'custom', path: ['date_to'], message: 'End date must be on or after start date' });
    }
  });

export const exportRequestSchema = z.object({
  filters: searchQuerySchema,
  format: exportFormatSchema,
  include_images: z.boolean(),
});

export const referralRedeemSchema = z.object({
  code: z.string().length(6),
  entry_method: z.enum(['link', 'code']),
});
