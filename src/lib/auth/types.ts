/** Shared auth shapes. Lives apart from auth-context so the offline snapshot
 *  cache can reference them without importing the provider. */

export type Profile = {
  id: string;
  country: string | null;
  default_currency: string;
  onboarding_complete: boolean;
};
