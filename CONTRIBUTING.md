# Contributing

Pull requests are welcome. Keep changes small and focused.

1. Needs Node 24+. `npm ci`, then `npm run check` (type check and tests) must pass; `npm run build` must work.
2. Add a test for new logic. Server and core code live in `src/`, the UI in `web/`.
3. Every text shown to people exists in English and Indonesian (`web/i18n.ts`). Code and comments are in English.
4. Do not add a dependency for something a few lines or the standard library can do.
5. Regulation texts in `library/` must be copied from the official source. Never mark a text `verified: yes` without
   checking it, and note what you checked in `library/VERIFIED.md`. Standards that are copyrighted (ISO) get our own short labels only.
6. Security problems: see `SECURITY.md`, do not open a public issue.

By contributing you agree that your work is released under the Apache-2.0 licence.
