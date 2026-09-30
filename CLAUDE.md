# Salman.D.Life

Salman's personal site on Cloudflare Pages (`https://salmandlife.pages.dev`). The home page is public; Trading,
Studies, Accounts and Profile sit behind an invite-only sign-in.

**This repository is public and every file in it is served as part of the website.** Nothing private goes here: no
keys, no invite codes, no personal data, no logs, no local test configs. Secrets and data live only in Cloudflare:
D1 database `DB`, KV store `DOCS`, variables `INVITE_CODE`, `RESET_CODE`, optional `GOOGLE_CLIENT_ID` and `OWNER_EMAIL`.

Write for Salman in plain words. Code comments here are written the same way: say what a thing does and why.

## How it fits together

- Static pages: `index.html`, `login/`, `profile/`, `trading/`, `study/`, `accounts/`, shared `assets/`.
- `functions/_middleware.js` is the gate: it works out who is signed in for every request and sends signed-out
  visitors from `PRIVATE` pages to `/login/`. A new private section goes in `PRIVATE` and in `_routes.json`.
- `functions/api/*.js`: one file per route, each self-contained (shared helpers are copied on purpose).
  Passwords are PBKDF2 hashes; sessions are random tokens stored as SHA-256 hashes; wrong guesses are rate-limited.
- `functions/trading/_middleware.js` fills the cloud bots' newer numbers (sent to `/api/bots` by
  gamer066/trading-bots, verified with GitHub's OIDC token) into the trading page as it is served.
- `trading/index.html` and `assets/status.js` are rebuilt by Salman's laptop publisher, which commits
  "Update dashboard" to `main`. Expect those commits; do not hand-edit numbers in those files.
- Cloudflare Pages deploys `main`. A push to `main` is a live deploy, so changes go on a branch and Salman merges.

## Testing locally, without touching the repo

Copy the tracked files to a scratch folder and put the test config there, never in this repository: a
`wrangler.toml` here would be served publicly and could override the Cloudflare project's own settings.

```
mkdir -p /tmp/sdl && git ls-files -z | xargs -0 -I{} cp --parents {} /tmp/sdl/
cat > /tmp/sdl/wrangler.toml <<'EOF'
name = "sdl-local-test"
pages_build_output_dir = "."
compatibility_date = "2025-01-01"
[[d1_databases]]
binding = "DB"
database_name = "sdl"
database_id = "00000000-0000-0000-0000-000000000000"
[[kv_namespaces]]
binding = "DOCS"
id = "00000000000000000000000000000000"
[vars]
INVITE_CODE = "invite-test-123"
RESET_CODE = "owner-reset-999"
EOF
cd /tmp/sdl && npx wrangler d1 execute sdl --local --file db/schema.sql
npx wrangler pages dev . --port 8788
```

Then check, signed out and signed in: sign up with the test invite code, sign in, wrong password, Keep me signed
in, rate limit (11th try is refused), reset (the first account needs `RESET_CODE`), name and password change,
devices list, photo upload, documents, and every private page redirecting when signed out. Also: a second
account gets "only for its owner" on Studies and Accounts and 403 from `/api/study`, `/api/accounts`, `/api/doc`
(OWNER-1), and a POST with `Origin: https://evil.example` is refused with 403 (SAME-1). Look at each page at
phone width in both themes: no script errors and no sideways scrolling.

## Rules

- The first account ever made is the owner; the invite code must never reset it (`functions/api/reset.js`).
- Salman's own data is owner-only, not just signed-in-only: `/api/study`, `/api/accounts` and `/api/doc` refuse
  everyone else (OWNER-1). The owner is `OWNER_EMAIL` if set, else the first account. Anyone with the invite code
  can make an account, so "signed in" never means "Salman".
- Error messages never reveal whether an email has an account, in wording or in timing.
- `/api/doc` must never serve or delete `avatar/` keys; photos belong to `/api/avatar`, one person each.
- Keep `_headers` strict (CSP, HSTS, frame-ancestors none). A new outside host needs a CSP entry and a reason.
- State-changing API calls must come from the site's own pages: `functions/_middleware.js` refuses a POST, PUT or
  DELETE whose Origin is another site (SAME-1). Server-to-server callers send no Origin and are unaffected.
