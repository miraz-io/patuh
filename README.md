# Patuh

Open-source AI and data-protection compliance workspace for Indonesia, built to also satisfy GDPR.
*Patuh* means "compliant".

Every department registers its processes and AI use cases. Patuh screens whether a DPIA is required,
records the risks and the controls, and exports a ready-to-sign DPIA as a Word document in English or Indonesian.
Dashboard shows what is open across the whole organisation.

## Quick start

Needs Node 24+. No database server: data lives in one SQLite file (`data/patuh.db`).

```bash
npm install
npm run build      # builds the web UI
npm start          # http://127.0.0.1:8080
```

| Variable | Default | |
|---|---|---|
| `PATUH_PORT` | `8080` | |
| `PATUH_HOST` | `127.0.0.1` | Localhost only. There is no login yet: to share it, put it behind your own SSO or reverse proxy. |
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

## Develop

```bash
npm run dev        # API with reload (port 8080)
npx vite web       # UI with hot reload, proxies /api to 8080
npm run check      # typecheck + tests
```

Stack: TypeScript, Hono, Node's built-in SQLite, React, Tailwind (shadcn/ui look), `docx`.

## Licence

Apache-2.0. Maintained by Rino Miraz.
