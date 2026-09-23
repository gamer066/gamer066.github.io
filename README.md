# Salman.D.Life

A personal site that works as a private control room. The front page is public. Everything else sits behind one
invite-only sign-in.

- **Trading** – practice-money trading bots on Binance's test system, priced live in the browser.
- **Studies** – coursework, deadlines and documents.
- **Accounts** – a directory of which account uses which inbox. It never holds passwords.

## How it is built

- Static pages served by **Cloudflare Pages**, with **Pages Functions** (`functions/`) for sign-in and the private
  sections.
- **D1** (Cloudflare's SQLite) holds accounts, sessions and the private section data. **Workers KV** holds uploaded
  documents. Nothing personal is ever committed to this repository.
- Passwords are stored only as salted PBKDF2-SHA256 hashes. Sessions are random tokens kept as SHA-256 hashes, sent
  in an `HttpOnly; Secure; SameSite=Lax` cookie. Repeated wrong guesses are slowed down on every sign-in route.
- Optional **Sign in with Google** checks Google's signed ID token against Google's published keys. It needs no
  client secret, and it only signs in accounts that already exist.
- `_headers` sets a strict Content-Security-Policy, HSTS and related headers. `_routes.json` limits which paths
  run server code.

No API keys, secrets or `.env` files live here. Secrets (the invite code) exist only in Cloudflare's own settings.
