/**
 * Who the signed-in user is, as the Settings profile card needs to show them:
 * a name, an email, a picture if the provider gave us one, and initials for
 * when it did not.
 *
 * The shapes differ per provider and are not guaranteed:
 *
 *   Google  full_name / name / given_name / family_name, and the picture under
 *           BOTH `avatar_url` and `picture` — Supabase copies the OIDC claim
 *           into its own key and leaves the original in place.
 *   Apple   full_name only on the FIRST authorisation, and only if the user
 *           agreed to share it. Every later sign-in carries nothing, so a name
 *           we never captured is never coming back.
 *   OTP     nothing at all — email is the only fact.
 *
 * No provider sends initials; every avatar service that appears to show them is
 * deriving them the same way this does. So they are derived here rather than
 * fetched, which also means they work offline and cost no request.
 */
import type { User } from '@supabase/supabase-js';

/** 56pt circle at 3x, rounded to a size Google actually renders. */
const AVATAR_PX = 192;

export type Identity = {
  /** Best name available, falling back to the email handle. Never empty. */
  displayName: string;
  /** The email, or a neutral stand-in when the account has none (phone sign-in). */
  email: string;
  /** Remote picture, or null when the provider has none. */
  avatarUrl: string | null;
  /** One or two characters, or null when there is nothing to derive them from. */
  initials: string | null;
};

/** Metadata values arrive as `unknown`; only non-blank strings are usable. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Only http(s) is allowed through. Provider metadata is attacker-influenced in
 * principle — it is whatever the identity provider put in the token — and a
 * `javascript:` or `file:` URI handed to an image loader is not something to
 * find out about later.
 */
function httpUrl(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

/**
 * First letter-or-digit of a word, uppercased. Punctuation is skipped so a
 * quoted or bracketed name does not yield `"` as an initial; anything with no
 * letter or digit at all yields nothing.
 */
/**
 * Google hands back a 96px avatar (`…=s96-c`), which is soft in a 56pt circle
 * on any modern screen — that is 168 physical pixels at 3x. The trailing `=s<n>`
 * is a googleusercontent render directive, so asking for 192 gets a 192px
 * render rather than an upscale, for about 5KB more.
 *
 * Anchored to the end and to `lh3.googleusercontent.com`, so a provider that
 * happens to have `=s96-c` inside a path is left alone. A URL that does not
 * match is returned untouched rather than guessed at.
 */
function upscaleGoogleAvatar(url: string): string {
  if (!/^https:\/\/lh3\.googleusercontent\.com\//.test(url)) return url;
  return url.replace(/=s\d+(-c)?$/, `=s${AVATAR_PX}$1`);
}

function leadChar(word: string): string | null {
  for (const ch of word) {
    if (/[\p{L}\p{N}]/u.test(ch)) return ch.toLocaleUpperCase();
  }
  return null;
}

/**
 * Initials the way the platforms do it: first letter of the first word plus
 * first letter of the last — "Afi M" gives AM — and a single letter when there
 * is only one word, rather than padding it out to two.
 *
 * `.`, `_`, `+` and `-` count as separators so an email handle yields something
 * useful (john.doe gives JD) for OTP accounts that have no name at all. On a
 * real name this only affects hyphenated forms, where first-plus-last still
 * picks the right two letters.
 */
export function initialsFrom(source: string | null | undefined): string | null {
  const raw = str(source);
  if (!raw) return null;

  const words = raw
    .replace(/[._+\-]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return null;

  const first = leadChar(words[0]);
  const last = words.length > 1 ? leadChar(words[words.length - 1]) : null;

  // A last word that is pure punctuation must not silently drop the first
  // initial too, so the two are combined rather than required together.
  const initials = `${first ?? ''}${last ?? ''}`;
  return initials.length > 0 ? initials : null;
}

export function resolveIdentity(user: User | null | undefined): Identity {
  const meta: Record<string, unknown> = user?.user_metadata ?? {};
  const email = str(user?.email);

  // given + family before the email handle: a Google account that sent the
  // parts but not the whole still has a real name in it.
  const given = str(meta.given_name);
  const family = str(meta.family_name);
  const composed = given && family ? `${given} ${family}` : (given ?? family);

  const name = str(meta.full_name) ?? str(meta.name) ?? composed;
  // Google populates `avatar_url` and `picture` with the same value; other
  // providers may set only one, so both are tried.
  const avatarUrl = httpUrl(meta.avatar_url) ?? httpUrl(meta.picture);
  const handle = email ? email.split('@')[0] : null;

  return {
    displayName: name ?? handle ?? 'Parse user',
    email: email ?? 'Signed in',
    avatarUrl: avatarUrl ? upscaleGoogleAvatar(avatarUrl) : null,
    // Initials come from the NAME when there is one, and only fall back to the
    // handle otherwise — deriving them from `displayName` would be the same
    // thing by accident and would break the moment that fallback chain changed.
    initials: initialsFrom(name) ?? initialsFrom(handle),
  };
}
