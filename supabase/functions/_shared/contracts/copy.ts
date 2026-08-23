export const COPY_PROVIDER_DELAY =
  "Your receipt is being processed due to connectivity issues - we'll update you when it's complete. Check the Recents folder when you're back.";

export const TOAST_REFERRAL_PROMPT = 'Add your referral code under menu -> plan to get more free scans';

export const COPY_REFERRAL_BLOCKED = 'This referral could not be applied.';
export const COPY_REFERRAL_ALREADY_USED = 'A referral has already been applied to this account.';
export const COPY_REFERRAL_UNAVAILABLE = 'Referral verification is unavailable right now. Please try again.';

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

/* ------------------------------------------------------------------ *
 * Billing — managing an existing subscription
 *
 * Deliberately says nothing about a card. With IAP the store is the merchant of
 * record and never exposes the payment instrument to the app, so any copy that
 * implied Parse holds or shows card details would be false. Every string below
 * either states billing STATE or points at the store.
 * ------------------------------------------------------------------ */

/**
 * Header title for the manage screen, and the Settings row that opens it.
 *
 * "Billing" rather than "Subscription" for two reasons: the Plan tab already
 * headers itself "Subscription" and two screens under one word is a maze, and
 * this is also where a user with no subscription lands to find that out.
 */
export const COPY_BILLING_TITLE = 'Billing';

export const COPY_BILLING_ROW_LABEL = 'Billing';

export const COPY_BILLING_NO_SUBSCRIPTION =
  'You are on the free plan. Choose a plan to unlock unlimited scans.';

export const COPY_BILLING_MANAGE_CTA = 'Manage subscription';

/**
 * Shown under the CTA so leaving the app is never a surprise.
 *
 * Which one is used follows the store that BILLS the subscription, falling back
 * to the store on this device — NOT the device alone. Someone who subscribed on
 * an iPhone and opened the app on an Android tablet is sent to Apple, and
 * "opens Google Play" would then be a lie about where the button goes.
 */
export const COPY_BILLING_MANAGE_NOTE_IOS =
  'Opens the App Store, where you can change your plan, update your payment method, or cancel.';

export const COPY_BILLING_MANAGE_NOTE_ANDROID =
  'Opens Google Play, where you can change your plan, update your payment method, or cancel.';

/** Family Sharing: the member cannot manage what they did not buy. */
export const COPY_BILLING_FAMILY_SHARED =
  'You have access through Family Sharing. The family organiser manages this subscription.';

export const COPY_BILLING_BILLING_ISSUE_TITLE = 'Payment problem';

export const COPY_BILLING_GRACE_BODY =
  'The store could not take payment. Update your payment method to keep your plan.';

export const COPY_BILLING_BILLING_ISSUE_BODY =
  'The store could not take payment and your plan has stopped. Update your payment method to restore it.';

export const COPY_BILLING_PAUSED_BODY = 'Your subscription is paused.';

export const COPY_BILLING_REFUND_CTA = 'Request a refund';

/** Apple decides refunds, not us. The copy must not imply otherwise. */
export const COPY_BILLING_REFUND_SUBMITTED =
  'Apple has received your refund request and will email you their decision.';

export const COPY_BILLING_REFUND_FAILED =
  'That refund request could not be started. You can request one from the App Store instead.';

export const COPY_BILLING_MANAGE_FAILED =
  'Could not open the store. Check your connection and try again.';
