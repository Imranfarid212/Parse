# App Review demo account

Apple reviewers cannot sign in with Google, and we cannot hand them an Apple ID.
The email path is the only one they can use, and it is a 6-digit code with no
password — so the reviewer needs an inbox they can open themselves.

## The account

| Field | Value |
| --- | --- |
| Email | `TODO@gmail.com` |
| Mailbox password | **not recorded here** — App Store Connect + a password manager only |
| Webmail | https://mail.google.com |
| Supabase project | `uhiqjbxqhhxjxnbznocc` (prod) |

The account must exist in **prod**, because the submitted build is cut with
`eas build --profile production`. Do not seed it from a staging build.

## Review Notes (paste into App Store Connect verbatim)

```
Parse signs in with a 6-digit code sent by email. There is no password on the
account itself; the password supplied above is for the mailbox.

1. On the first screen, tap "Use my email".
2. Enter TODO@gmail.com and tap "Send code".
3. In Safari, open https://mail.google.com and sign in with the same address
   and the password supplied above. Open the newest message from Parse and
   note the 6-digit code.
4. Return to Parse and enter the code, then tap "Verify code".

"Sign in with Google" and "Sign in with Apple" cannot be tested with shared
credentials and are not required to review the app; the email path reaches the
identical post-login experience.

To scan a receipt: tap the camera button on the home screen, point it at any
printed receipt, and the extracted total and line items appear in Recents.
```

## Checklist before submitting

- [ ] Mailbox created, **2-Step Verification left OFF** (a reviewer cannot pass it)
- [ ] Signed into Parse once with it, from a production-profile build
- [ ] 2-3 receipts scanned so Recents is not empty
- [ ] OTP email confirmed to arrive in the inbox, not spam
- [ ] App Store Connect -> Apps -> Parse -> version -> App Review Information:
      "Sign-in required" ticked, username/password/notes filled in
- [ ] Account left alive after approval (Apple re-tests it on every update)
