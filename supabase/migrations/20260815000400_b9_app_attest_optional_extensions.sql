-- App Attest launch-category and bundle-version extensions were added in iOS
-- 26. Keep core App Attest available to the app's supported older iOS versions
-- while recording and binding whether the enrolled key supplies extensions.

alter table public.app_attest_keys
  alter column validation_category drop not null,
  alter column bundle_version drop not null;

alter table public.app_attest_keys
  add column if not exists extensions_present boolean not null default false;

update public.app_attest_keys
   set extensions_present = true
 where validation_category is not null
   and bundle_version is not null;

alter table public.app_attest_keys
  drop constraint if exists app_attest_keys_extension_evidence_check;

alter table public.app_attest_keys
  add constraint app_attest_keys_extension_evidence_check check (
    (extensions_present and validation_category is not null and bundle_version is not null)
    or
    (not extensions_present and validation_category is null and bundle_version is null)
  );
