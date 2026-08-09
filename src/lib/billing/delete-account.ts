/**
 * Calling account-delete.
 *
 * Thin on purpose. The endpoint takes no body — the JWT names the account — so
 * there is nothing here to get wrong except error handling, and that matters:
 * the screen tells the user "nothing was removed" on failure, which is only true
 * because the server does the whole deletion in one transaction. If this ever
 * starts sending a partial-delete request, that copy becomes a lie.
 */
import { supabase } from '@/lib/auth/supabase';

export type DeleteAccountResult = {
  appleRevoked: boolean;
  revenueCatUnlinked: boolean;
  purgeFinancialAt: string | null;
};

export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { data, error } = await supabase.functions.invoke('account-delete', { body: {} });
  if (error) throw error;
  if (!data || data.deleted !== true) {
    throw new Error(typeof data?.message === 'string' ? data.message : 'Account deletion did not complete.');
  }
  return {
    appleRevoked: data.apple_revoked === true,
    revenueCatUnlinked: data.revenuecat_unlinked === true,
    purgeFinancialAt: typeof data.purge_financial_at === 'string' ? data.purge_financial_at : null,
  };
}
