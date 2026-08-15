/** B9 referral policy. Keep money/scan values here, never in UI or handlers. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 6;
export const REFERRER_REWARD_SCANS = 10;
export const REFERRED_REWARD_SCANS = 5;
export const USER_REFERRAL_MAX_REWARDS = 4;

export const REFERRAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export type ReferralEntryMethod = 'link' | 'code';

export type ReferralAttestationProof = {
  platform: 'ios' | 'android';
  token: string;
  key_id?: string;
  challenge?: string;
};

export type ReferralRedeemRequest = {
  code: string;
  entry_method: ReferralEntryMethod;
  attestation: ReferralAttestationProof;
};

export type ReferralRedeemResponse = {
  status: 200;
  granted: boolean;
  reason: 'released' | 'already_redeemed' | 'blocked';
  toast: string | null;
  rewards: { referrer: number; friend: number };
};

export type ReferralSummary = {
  code: string;
  rewarded: number;
  max_rewards: number;
  referred: boolean;
};

export function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isReferralCode(value: string): boolean {
  return REFERRAL_CODE_PATTERN.test(normalizeReferralCode(value));
}
