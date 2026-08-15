export const COPY_PROVIDER_DELAY =
  "Your receipt is being processed due to connectivity issues - we'll update you when it's complete. Check the Recents folder when you're back.";

export const TOAST_REFERRAL_SUCCESS = 'Referral sign up complete, enjoy more free scans';

export const TOAST_REFERRAL_PROMPT = 'Add your referral code under menu -> plan to get more free scans';

export const COPY_QUOTA_EXHAUSTED_TITLE = 'Out of scans';

export const COPY_QUOTA_EXHAUSTED_BODY =
  "You've used all your free scans. Upgrade your plan to keep scanning receipts.";

/* ------------------------------------------------------------------ *
 * B8 — monetization & deletion
 *
 * Store review reads these strings. Blueprint §13.2 requires the deletion flow
 * to state in plain words that deleting the account does not stop billing, and
 * to offer both stores' manage-subscription routes; B10's compliance checklist
 * re-reads them. They live here so the screen cannot quietly reword them and so
 * the gate can assert the exact text.
 * ------------------------------------------------------------------ */

export const COPY_DELETE_ACCOUNT_TITLE = 'Delete your account';

export const COPY_DELETE_ACCOUNT_BILLING_WARNING =
  'Deleting your Parse account does not cancel your subscription. Billing continues until you cancel it with the store that charges you.';

export const COPY_DELETE_ACCOUNT_BODY =
  'This permanently removes your receipts, images and exports. This cannot be undone.';

/** Shown under the warning, next to the two manage-subscription links. */
export const COPY_DELETE_ACCOUNT_MANAGE_PROMPT = 'Cancel your subscription first:';

export const COPY_MANAGE_SUBSCRIPTION_APPLE = 'Manage on the App Store';
export const COPY_MANAGE_SUBSCRIPTION_GOOGLE = 'Manage on Google Play';

export const COPY_DELETE_ACCOUNT_CONFIRM = 'Delete my account';
export const COPY_DELETE_ACCOUNT_CANCEL = 'Keep my account';

/**
 * Retention is stated because the deletion is not total: financial records are
 * anonymised and held for tax and accounting, then hard-deleted (D17). Saying
 * "everything is gone" when payment rows survive would be false.
 */
export const COPY_DELETE_ACCOUNT_RETENTION =
  'Anonymous payment records are kept for tax and accounting purposes, then permanently deleted.';

export const COPY_DELETE_ACCOUNT_FAILED =
  'We could not delete your account. Nothing was removed — please try again.';

/** Paywall surfaces. Prices are never written here: they come from the store. */
export const COPY_PAYWALL_PRO_TITLE = 'Upgrade to Pro';
export const COPY_PAYWALL_MAX_TITLE = 'Upgrade to Max';

export const COPY_PAYWALL_PRO_BODY =
  "You've used all your free scans. Upgrade to keep scanning receipts.";

export const COPY_PAYWALL_MAX_BODY =
  "You've used every scan in your plan this month. Upgrade to Max for unlimited scans.";

export const COPY_RESTORE_PURCHASES = 'Restore Purchases';
export const COPY_RESTORE_PURCHASES_NONE = 'No previous purchases found for this account.';
export const COPY_RESTORE_PURCHASES_DONE = 'Your purchases have been restored.';

/**
 * Shown when a purchase completes but the entitlement has not appeared yet —
 * the webhook is in flight. The scan itself is still gated by can_scan(), so
 * this is the honest description of the gap rather than a fake success.
 */
export const COPY_PURCHASE_PENDING_ENTITLEMENT =
  'Purchase complete. Your new plan is being activated — this usually takes a few seconds.';
