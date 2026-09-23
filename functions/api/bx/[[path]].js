// Binance relay for the trading bots (23 Sep 2026).
//
// WHY THIS EXISTS. The bots run on GitHub Actions so they keep working with Salman's laptop off. Binance answers
// GitHub's US-based runners with HTTP 451 "Service unavailable from a restricted location" - policy, not a bug.
// Cloudflare is NOT blocked for two Binance hosts, so the bots call this relay and it calls Binance:
// GitHub -> Cloudflare -> Binance.
//
// Measured 23 Sep from Cloudflare: testnet.binance.vision 200 and api-gcp.binance.com 200; api.binance.com,
// api1.binance.com, data-api.binance.vision, fapi.binance.com and demo-fapi.binance.com all 403. So the short bot
// (futures demo) cannot be relayed and stays on the laptop.
//
// HOW IT KNOWS THE CALLER IS SALMAN'S REPO, with no shared password anywhere.
// GitHub Actions can mint a short-lived, signed identity token for a workflow run. This relay verifies that
// signature against GitHub's own public keys and checks the token was issued for THIS repository. Nobody can
// forge one, the token expires in minutes, and - the point - there is no secret for Salman to paste into two
// websites and no secret for me to type. If the signature or the repository does not match, nothing is relayed.
//
// SAFETY, deliberately narrow:
//  - Only the two hosts below are reachable. Real-money Binance is not among them and cannot be added by a caller.
//  - No Binance key is stored here. The bot's key rides through in X-MBX-APIKEY and is never logged or returned.
//  - Nothing is cached, so a stale price can never reach a live decision.
//
// Address shape:  /api/bx/<host-key>/<binance path>?<query>
const HOSTS = {
  testnet: "https://testnet.binance.vision",   // fake-money spot trading - where orders go
  data: "https://api-gcp.binance.com",         // real market candles - what the signals read
};
const ALLOWED_REPO = "gamer066/trading-bots";
const ISSUER = "https://token.actions.githubusercontent.com";

let jwksCache = null;
let jwksAt = 0;

export async function onRequest(context) {
  const { request, params } = context;

  const who = await verifyCaller(request);
  if (!who.ok) {
    // 23 Sep: the reason is now named. Every cloud run was rejected here and the single wording made it
    // impossible to tell WHICH check failed without a deploy per guess. A reason code cannot help anyone
    // forge a GitHub signature, so the cost is nil and the diagnostic value is the difference between
    // fixing this in one run and guessing for a day.
    return json({ error: "not allowed", why: who.why || "unknown" }, 403);
  }

  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const base = HOSTS[parts[0]];
  if (!base) return json({ error: "unknown target", allowed: Object.keys(HOSTS) }, 400);

  const url = new URL(request.url);
  const target = base + "/" + parts.slice(1).join("/") + url.search;

  const headers = new Headers();
  const key = request.headers.get("X-MBX-APIKEY");
  if (key) headers.set("X-MBX-APIKEY", key);
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  try {
    const r = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text(),
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    // Binance's own status and body pass straight through, so the bots see exactly what Binance said.
    return new Response(await r.text(), {
      status: r.status,
      headers: {
        "content-type": r.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return json({ error: "relay could not reach Binance", detail: String(e).slice(0, 200) }, 502);
  }
}

async function verifyCaller(request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false, why: "no-bearer-header" };

  const [h64, p64, s64] = token.split(".");
  if (!h64 || !p64 || !s64) return { ok: false, why: "not-three-part-jwt" };

  let header, claims;
  try {
    header = JSON.parse(b64urlToText(h64));
    claims = JSON.parse(b64urlToText(p64));
  } catch { return { ok: false, why: "undecodable" }; }

  if (claims.iss !== ISSUER) return { ok: false, why: `issuer:${claims.iss}` };
  if (claims.repository !== ALLOWED_REPO) return { ok: false, why: `repo:${claims.repository}` };
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) return { ok: false, why: `expired-by-${now - (claims.exp || 0)}s` };
  if (claims.nbf && claims.nbf > now + 60) return { ok: false, why: "not-yet-valid" };

  const jwk = await findKey(header.kid);
  if (!jwk) return { ok: false, why: `no-key-for-kid:${header.kid}` };

  try {
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key,
      b64urlToBytes(s64),
      new TextEncoder().encode(`${h64}.${p64}`));
    return { ok, why: ok ? "" : "signature-mismatch" };
  } catch (e) { return { ok: false, why: `verify-threw:${String(e).slice(0, 60)}` }; }
}

async function findKey(kid) {
  if (!jwksCache || Date.now() - jwksAt > 10 * 60 * 1000) {
    const r = await fetch(`${ISSUER}/.well-known/jwks`, { cf: { cacheTtl: 600 } });
    if (!r.ok) return null;
    jwksCache = await r.json();
    jwksAt = Date.now();
  }
  return (jwksCache.keys || []).find((k) => k.kid === kid) || null;
}

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function b64urlToText(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
