# Security policy

Patuh handles compliance records that can describe personal data, so please report problems privately.

## Reporting a vulnerability

Email **support@miraz.id** with what you found, how to reproduce it and the version. Please do not open a public issue
for a vulnerability. You will get an answer within a few working days. This is a small project without a bug bounty;
we credit reporters who want it.

## Supported versions

Only the latest release (0.1.x) gets fixes.

## What Patuh already does

Passwords with scrypt; sessions as random tokens in HttpOnly SameSite cookies (only a hash is stored); a CSRF header on
every change; per-department access checks on every record; OIDC with PKCE, nonce and signature checks; an audit log of
changes, DPIA exports, library searches and AI chats (who and when, never the text); sign-in limits per email+IP, per IP
and per account; the AI key encrypted at rest (AES-256-GCM); an address guard for the AI endpoint (no link-local or
cloud-metadata targets, checked again at connect time, no redirects); security headers and a content security policy.

## Sign-in limits: the tradeoff

Three layers, in memory, per server process:

1. **Email + IP pair:** 5 wrong passwords lock that pair for 15 minutes. An outsider cannot lock your admin out from the admin's own address.
2. **IP:** 30 failures from one address (IPv6 grouped by /64) lock that address for 15 minutes.
3. **Account (existing accounts only):** after 10 failures from any address, every further try from an address that has not signed in as that
   account before must wait up to 30 s (answered with 429 and `Retry-After`), which makes spread-out guessing very slow. This is a pause, never a lock,
   and a pair that signed in successfully before is never held back by it. Failed tries count even when sent in parallel.

Accepted limits: an owner on a new address (travel, new network) may wait up to 30 s after an attack; unknown emails get no account state,
so after many failures the 429 for an account reveals that the account exists; when 10,000 accounts are being attacked at once, new ones
are not tracked and rely on layers 1 and 2; a distributed attacker with many addresses can still make one guess per 30 s per account.
State is lost on restart. For anything stricter use a reverse proxy or a shared store.

## Running it safely

- Listen on localhost, or put HTTPS in front and set `PATUH_PUBLIC_URL` to the https address.
- Set `PATUH_TRUST_PROXY=1` **only** behind a trusted reverse proxy that sets or overwrites `X-Forwarded-For`. If the
  app is reachable directly, anyone could forge that header and dodge the sign-in limits. The app uses the last `X-Forwarded-For` entry, so with two proxies in a row make the outer one overwrite the header.
- Back up the database together with `patuh.key` (or keep `PATUH_SECRET` safe); without it the stored AI key cannot be read.
- Process data and questions go to the AI provider you configure. Choose one that fits your own rules, or host a model yourself.
- Sign-in throttling is in memory: run one server process, or add a shared store.
- Known and accepted: the content security policy allows inline styles; sessions last 12 hours without rotation.
