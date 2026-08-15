import { z } from 'zod';

import {
  captureModes,
  confirmedVia,
  exportArtifactKinds,
  exportFormats,
  exportJobStatuses,
  extractionModes,
  jobStatuses,
  ledgerReasons,
  providers,
  receiptStatuses,
  referralStatuses,
} from './enums';
import { errorCodes } from './errors';
import { offerings, terms, tiers } from './products';

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
export const exportJobStatusSchema = z.enum(exportJobStatuses);
export const exportArtifactKindSchema = z.enum(exportArtifactKinds);

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
  z.object({ status: z.literal(402), code: z.literal('QUOTA_EXHAUSTED'), paywall: z.enum(tiers) }),
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
  /**
   * The device's IANA timezone, used to render the generated timestamp on the
   * statement. Optional: an export without one is rendered in UTC rather than
   * refused, because a timezone the server cannot resolve is a display detail.
   */
  timezone: z.string().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/).optional(),
});

export const exportArtifactSchema = z.object({
  kind: exportArtifactKindSchema,
  file_name: z.string().min(1),
  file_path: z.string().min(1),
  byte_size: z.number().int().nonnegative(),
  receipt_count: z.number().int().nonnegative(),
  part: z.number().int().positive(),
  part_count: z.number().int().positive(),
});

export const exportJobSchema = z.object({
  id: uuidSchema,
  status: exportJobStatusSchema,
  format: exportFormatSchema,
  include_images: z.boolean(),
  filters: searchQuerySchema,
  artifacts: z.array(exportArtifactSchema),
  /** Rows that matched the filters, counted in SQL — null until the job runs. */
  receipt_count: z.number().int().nonnegative().nullable(),
  timezone: z.string().nullable(),
  error: z.string().nullable(),
  expires_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

/**
 * export is async by design (Blueprint §12): the call returns the job, and the
 * files arrive over Realtime on export_jobs. There is no 200-with-file variant
 * to fall back to, so the client only ever has one shape to handle.
 *
 * Not parsed at runtime: the server cannot run zod (no bare-specifier
 * resolution under Deno) and the client would have to reconcile PostgREST's
 * offset timestamps to gain nothing the screen does not already handle. It is
 * kept as the written description of what the endpoint returns, which the
 * function's own shape is reviewed against.
 */
export const exportResponseSchema = z.union([
  z.object({ status: z.literal(202), job: exportJobSchema }),
  z.object({ status: z.literal(400), code: z.literal('VALIDATION_FAILED'), message: z.string() }),
  z.object({ status: z.literal(429), code: z.literal('RATE_LIMITED') }),
]);

export const referralRedeemSchema = z.object({
  code: z.string().length(6),
  entry_method: z.enum(['link', 'code']),
});

/* ------------------------------------------------------------------ *
 * B8 — monetization & deletion
 * ------------------------------------------------------------------ */

export const tierSchema = z.enum(tiers);
export const termSchema = z.enum(terms);
export const offeringSchema = z.enum(offerings);

/**
 * RevenueCat webhook event types we act on.
 *
 * The list is open by design: `rcEventSchema` accepts an unknown `type` and the
 * webhook stores it verbatim, because an event we cannot classify is still
 * evidence and dropping it would lose the audit trail. Only the types below
 * change subscription state.
 */
export const rcEventTypes = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'CANCELLATION',
  'UNCANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'SUBSCRIPTION_PAUSED',
  'TRANSFER',
  'REFUND',
] as const;
export type RcEventType = (typeof rcEventTypes)[number];

/** Events that credit an influencer commission (Blueprint §11): real money in. */
export const rcRevenueEventTypes = ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE'] as const;

/** Events that reverse one. */
export const rcReversalEventTypes = ['REFUND'] as const;

/**
 * The subset of RevenueCat's payload the server relies on.
 *
 * Deliberately permissive: `.passthrough()` keeps every field RevenueCat sends
 * so `payment_events.raw` is the verbatim log the Blueprint asks for, and the
 * unknown-type case above stays representable. `app_user_id` is RevenueCat's
 * alias for our auth uid — set by the client at login, never guessed here.
 */
export const rcEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    app_user_id: z.string().min(1),
    product_id: z.string().min(1).nullish(),
    store: z.string().min(1).nullish(),
    /** Milliseconds since epoch, RevenueCat's format throughout. */
    event_timestamp_ms: z.number().int().nonnegative().nullish(),
    purchased_at_ms: z.number().int().nonnegative().nullish(),
    expiration_at_ms: z.number().int().nonnegative().nullish(),
    price: z.number().nullish(),
    price_in_purchased_currency: z.number().nullish(),
    currency: z.string().length(3).nullish(),
    is_trial_period: z.boolean().nullish(),
    cancel_reason: z.string().nullish(),
  })
  .passthrough();

export const rcWebhookSchema = z.object({
  api_version: z.string().optional(),
  event: rcEventSchema,
});

export const rcWebhookResponseSchema = z.union([
  /** Accepted and applied, or accepted and already known (replay). */
  z.object({ status: z.literal(200), applied: z.boolean(), reason: z.string().optional() }),
  z.object({ status: z.literal(401), code: z.literal('UNAUTHORIZED') }),
  z.object({ status: z.literal(400), code: z.literal('VALIDATION_FAILED'), message: z.string() }),
]);

/**
 * account-delete takes no body: the JWT identifies the account, and letting a
 * caller name the user to delete would be the whole vulnerability. The client
 * must have shown the interstitial first (Blueprint §13.2) — that is a UI
 * obligation the server cannot verify, which is why the copy lives in contracts
 * and the gate asserts the screen renders it.
 */
export const accountDeleteResponseSchema = z.union([
  z.object({
    status: z.literal(200),
    deleted: z.literal(true),
    /** True when Apple tokens were revoked; false when the user never used SIWA. */
    apple_revoked: z.boolean(),
    /** True when the RevenueCat subscriber was unlinked. */
    revenuecat_unlinked: z.boolean(),
    purge_financial_at: z.string().datetime(),
  }),
  z.object({ status: z.literal(401), code: z.literal('UNAUTHORIZED') }),
  z.object({ status: z.literal(500), code: z.literal('DELETE_FAILED'), message: z.string() }),
]);
