# CLAUDE.md

Project context for Claude Code (web, desktop, CLI). Keep it short and factual — it is read on
every session start.

## What this is

**תורה ומציאות** (Torah U'Metziut) — a Hebrew, RTL study app that links Talmud sugyot (mainly
Bava Metzia) to rabbinic court rulings (*psakei din*) and modern cases. Originally scaffolded on
[Lovable](https://lovable.dev/projects/d7f25ac6-1ab9-4f6b-a99c-e38969c1566f); the GitHub repo is
the source of truth and Lovable commits back into it.

Stack: Vite + React 18 + TypeScript + Tailwind + shadcn/ui, Supabase (Postgres, auth, storage,
edge functions), deployed on Vercel.

## Commands

```sh
npm install          # install dependencies
npm run dev          # dev server (Vite)
npm run build        # production build
npm run lint         # ESLint
npm test             # Vitest unit tests (single run)
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright end-to-end
```

`npm run lint` currently reports ~463 pre-existing findings (mostly `no-explicit-any`); treat new
findings in files you touch as yours, the rest as backlog.

The `backup:*` scripts are PowerShell (`pwsh`) and are Windows-first; they do not run on a plain
Linux container.

## Layout

| Path | Contents |
| --- | --- |
| `src/pages/` | Routes: `Index`, `SugyaDetail`, `ShasManagerPage`, `EmbedPdfViewerPage`, `Auth`, `ResetPassword` |
| `src/components/` | ~230 feature components (Gemara panels, psak-din tabs, download/upload managers, AI tutor) |
| `src/stores/` | Zustand stores for long-running jobs (download, upload, delete, analysis, indexing) |
| `src/hooks/` | React hooks — controllers for those jobs, auth, preferences, Talmud references |
| `src/lib/` | Pure logic: parsing/analysis of psakei din, HTML templates, Hebrew numerals, OCR, caching, export (docx/pdf/csv) |
| `src/integrations/supabase/` | Supabase client + generated `types.ts` |
| `supabase/functions/` | ~20 Deno edge functions (AI tutor, analysis, search, Sefaria/Gemara fetch, migrations) |
| `supabase/migrations/` | 60+ SQL migrations, timestamp-prefixed |
| `scripts/` | Node/Python maintenance scripts: download, import, dedupe and style psakim corpora |
| `all-psakim/` | ~2 000 downloaded ruling HTML files (the corpus) |
| `e2e/`, `src/test/` | Playwright specs and Vitest tests |

## Conventions

- **The UI is Hebrew and RTL.** `index.html` sets `lang="he" dir="rtl"`. Keep user-facing strings
  in Hebrew and check that new layout works in RTL.
- Commit messages in this repo are written in both Hebrew and English — either is fine.
- Tailwind + shadcn/ui primitives live in `src/components/ui/`; prefer composing them over new CSS.
- Supabase edge functions that should be callable anonymously are listed with `verify_jwt = false`
  in `supabase/config.toml` — add new public functions there.
- Migrations are append-only: add a new timestamped file, never edit an applied one.
- **One document viewer.** Rulings open only through `useDocumentViewer().open(psak)`
  (`src/components/DocumentViewerProvider.tsx`), which shows `EmbedPdfViewerPage` in a dialog or
  full page. Engine settings live in `src/lib/embedPdfConfig.ts`. Don't add another viewer.

## Environment

`.env` holds the public (publishable) Supabase values consumed by Vite:
`VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`.
Service-role or admin credentials belong in `.env.migrations.local`, which is git-ignored.
Never commit a service-role key.

## Longer guides

`DEPLOYMENT_WORKFLOW_GUIDE.md`, `EMBEDPDF_SYSTEM_GUIDE.md`, `MIGRATION_RUNNER_GUIDE.md`,
`PSAKIM_SOURCES_PLAN.md`, `LOVABLE_FILE_DELETION_PROBLEM.md`, and `CLOUD_SYNC.md` (how this repo
syncs between the cloud and a desktop machine).
