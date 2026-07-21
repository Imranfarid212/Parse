import * as SecureStore from 'expo-secure-store';

const keyFor = (userId: string) => `receiptflow.referral_prompt_seen.${userId}`;

export async function shouldShowReferralPrompt(userId: string) {
  return (await SecureStore.getItemAsync(keyFor(userId))) !== '1';
}

export async function markReferralPromptSeen(userId: string) {
  await SecureStore.setItemAsync(keyFor(userId), '1');
}
