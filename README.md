# Patuh

Open-source AI and data-protection compliance workspace for Indonesia, built to also satisfy GDPR.
*Patuh* means "compliant".

Every department registers its processes and AI use cases. Patuh screens whether a DPIA is required,
records the risks and the controls, and exports a ready-to-sign DPIA as a Word document in English or Indonesian.
A dashboard shows what is open across the whole organisation.

## Quick start

Needs Node 24+. No database server: data lives in one SQLite file (`data/patuh.db`).

```bash
npm install
npm run build                  # builds the web UI
npm run admin -- init          # asks for organisation, first admin, and whether to include demo data
npm start                      # http://127.0.0.1:8080
```

`init` can also run without questions (for scripts and Docker):

```bash
PATUH_NEW_PASSWORD='a long password' npm run admin -- init \
  --org "PT Example" --admin-email admin@example.id --admin-name "Admin" --demo   # or --no-demo
```

### Demo data and tutorials

Choose **demo data** at `init` and you get a fictional organisation: 6 departments, 11 processes (HR, customer service,
credit scoring, fraud, marketing, security, legal) with screening answers, risks, controls and DPIAs in different states,
plus **six interactive tutorials**. A tutorial moves through the app for you, glides a cursor to each part, scrolls
to it, and explains it. Some steps ask you to click. Tutorials only navigate and never change data. Replay any of them
from **Tutorials** in the menu, in English or Indonesian.

Choose **no demo** and the workspace starts empty with no tutorials. Add or remove the demo later:

```bash
npm run admin -- demo load
npm run admin -- demo remove   # removes only the demo; your own processes and departments stay
```

## AI assistant (optional)

Admins open **Settings** and enter any OpenAI-compatible service that supports tool calling (an API address such as `https://api.openai.com/v1` or `http://localhost:11434/v1`, a model name and, if needed, a key).

**The AI is never the source of truth.** It is an agent with tools: it can read the process record, run the DPIA screening rules, search and read the regulation library, propose changes and ask you questions. The server enforces the rest:

- **Answers are checked.** Every statement must cite something the server can verify: a library unit the agent actually opened (with a quote that really appears in it), the record, or the screening result. Anything else is deleted. If nothing is left, the assistant says it has no source and shows the closest library sections instead of guessing.
- **It proposes, you decide.** Edits arrive as before/after cards you accept, edit or reject. Nothing changes before that, and a proposal is refused if the field changed since the AI looked at it.
- **Drafts are marked.** Anything an AI wrote shows an "AI draft" or "Assumption" badge until a person confirms it. A process cannot be signed off while it has empty fields or unconfirmed AI drafts. The checklist at the top of each process shows what is left.
- **New process:** type a name and a few sentences; the AI drafts details, DPIA criteria, risks and controls as unconfirmed drafts.
- **Audit and quality:** every AI turn is logged (question, sources opened, outcome, tokens, time, and what you did with each proposal). Settings shows the quality numbers (answers with a checked source, dropped statements, acceptance rate, latency, ...) and the questions the library could not answer. Question text is blanked after 180 days (`ai_retention_days` setting); the numbers stay.
- **Privacy:** the question, the process record and the library units it opens are sent to the service you configure and may contain personal data. Choose a provider that fits your own rules, or host a model yourself. The API key is stored in the database file (permissions 0600) and never sent back to the browser.

## Regulation library

`library/*.md` is loaded into SQLite at start (changed files only) and searched with SQLite full-text search (FTS5) plus a trigram index for Indonesian word forms and an English/Indonesian term table. Open **Library** in the app to search it together with your own processes, read a section, and see the same topic in other laws.

| Source | Text | Checked against the official source |
|---|---|---|
| UU 27/2022 (selected articles) | official wording | yes |
| GDPR (selected articles and recitals) | official wording | yes |
| EU AI Act (selected articles, Annex III headings) | official wording | yes |
| NIST AI RMF 1.0 | official wording | yes |
| ISO/IEC 27001, 27701, 42001 | clause IDs and short own-words labels only (the standards are copyrighted) | no |
| PP 33/2026 | **not included**: it was reported as issued in July 2026, but no official text could be fetched. Add it by dropping the official text into `library/` in the same format. | n/a |

File format: front matter (`code`, `lang`, `title`, `text_kind`, `verified`, `url`, ...) and headings ending in an id, for example `## Pasal 34 {#34}`. Cross-law mappings live in `library/mappings.csv` (marked `draft-ai` until a person reviews them). A golden set (`eval/golden.jsonl`) checks that the right section is found; `npm test` fails if search quality drops below 85%.

## People and sign-in

| Role | Can do |
|---|---|
| `admin` | Everything, including departments and sign-off fields |
| `dpo` | Everything on processes, plus DPO advice and sign-off |
| `member` | Read and edit only the processes of their own department |
| `auditor` | Read everything, change nothing |

```bash
npm run admin -- user add --email a@x.id --name "Ayu" --role member --department "Human Resources"
npm run admin -- user add --email b@x.id --name "Budi" --role auditor --sso     # no password, signs in through your identity provider
npm run admin -- user list | passwd --email E | disable --email E | enable --email E | remove --email E
npm run admin -- audit --limit 100                                               # who changed what
```

Passwords are typed hidden (or `PATUH_NEW_PASSWORD` for scripts), at least 12 characters, stored with scrypt.

### Single sign-on (OpenID Connect)

Works with any provider that publishes `/.well-known/openid-configuration` and signs ID tokens with RS256
(Microsoft Entra ID, Okta, Keycloak, Google, Auth0, Authentik). Register `https://<your-host>/api/auth/oidc/callback`
as the redirect URI, then set:

| Variable | |
|---|---|
| `PATUH_OIDC_ISSUER` | Issuer URL of your provider |
| `PATUH_OIDC_CLIENT_ID`, `PATUH_OIDC_CLIENT_SECRET` | From your provider |
| `PATUH_PUBLIC_URL` | `https://<your-host>`, must be https (localhost allowed for testing) |
| `PATUH_OIDC_ALLOWED_DOMAINS` | Optional, e.g. `example.id,example.co.id` |

SSO signs in only users an admin created with `user add --sso` (no password). They are bound to the first identity-provider
account that signs in, so a different account with the same email is refused. Users with a password never sign in through SSO,
and SSO never creates users. ID tokens are verified in Patuh (signature, issuer, audience, expiry, nonce) and the flow uses PKCE.

## Other settings

| Variable | Default | |
|---|---|---|
| `PATUH_PORT` | `8080` | |
| `PATUH_HOST` | `127.0.0.1` | Localhost only. To share it, put HTTPS in front and set `PATUH_PUBLIC_URL` to the https address. |
| `PATUH_DB` | `data/patuh.db` | |

## One document, two laws

- **Screening** uses UU PDP No. 27/2022 Article 34(2): any one of the 7 high-risk categories requires a DPIA.
  The same questions carry the GDPR Art. 35 / EDPB criteria (two or more), plus "vulnerable people".
  Patuh applies the stricter rule.
- **The DPIA** follows the GDPR Art. 35(7) structure: description, necessity and proportionality, risks, measures,
  advice, review. The Indonesian version covers the same content, so one document serves both.
- **Residual high risk** flags that prior consultation with the authority is needed (GDPR Art. 36 / UU PDP).

## Status and honesty

Early version. This is a tool for your compliance team, **not legal advice**. PP 33/2026 (the UU PDP implementing
regulation, effective 16 January 2027) and the national AI regulation (not yet signed) may change what a DPIA must contain:
check the official text. The rules live in `src/core/screening.ts` so they are easy to update. Pull requests welcome.

Security notes: sessions are random tokens in HttpOnly, SameSite cookies (only a hash is stored); every change needs a
CSRF header; each record is checked against the signed-in user's department; every change is written to an audit log;
login attempts are throttled per account (5 wrong passwords lock the account for 15 minutes, so a determined attacker can
lock a known email out: add per-IP limits at your reverse proxy). Throttling is in memory, so run a single server, or add a
shared store if you scale out. Editing a signed-off process without sign-off rights withdraws the signature. The database
file is created readable by its owner only.

## Develop

```bash
npm run dev        # API with reload (port 8080)
npx vite web       # UI with hot reload, proxies /api to 8080
npm run check      # typecheck + tests
```

Stack: TypeScript, Hono, Node's built-in SQLite, React, Tailwind (shadcn/ui look), `docx`.

## Licence

Apache-2.0. Maintained by Rino Miraz.
