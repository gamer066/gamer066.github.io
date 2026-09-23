// Binance relay for the trading bots (23 Sep 2026).
//
// WHY THIS EXISTS. The bots were moved to GitHub Actions so they would run with Salman's laptop off. Binance
// answers GitHub's US-based runners with HTTP 451 "Service unavailable from a restricted location" - policy, not
// a bug, and no key or code change gets round it. Cloudflare's network is NOT blocked for two Binance hosts, so
// the bots call this relay and it calls Binance: GitHub -> Cloudflare -> Binance.
//
// Measured 23 Sep from Cloudflare: testnet.binance.vision 200, api-gcp.binance.com 200; api.binance.com,
// api1.binance.com, data-api.binance.vision, fapi.binance.com and demo-fapi.binance.com all 403. So the short
// bot (futures demo) still cannot run in the cloud - that leg stays on the laptop.
//
// SAFETY, deliberately narrow:
//  - Only the two hosts below are reachable. Nothing else can be relayed, including real-money Binance.
//  - A shared token is required. Without it this would be an open relay on Salman's Cloudflare quota.
//  - No key is stored here. The bot's API key rides through in the X-MBX-APIKEY header and is never logged,
//    never written down, and never returned in a response.
//  - Responses are not cached, so a stale price can never be served to a live decision.
//
// Address shape:  /api/bx/<host-key>/<binance path>?<query>
// Example:        /api/bx/testnet/api/v3/account?timestamp=...&signature=...
const HOSTS = {
  testnet: "https://testnet.binance.vision",   // fake-money spot trading - where orders go
  data: "https://api-gcp.binance.com",         // real market candles - what the signals read
};

export async function onRequest(context) {
  const { request, env, params } = context;

  if (!env.BOT_RELAY_TOKEN) {
    return json({ error: "relay is not configured" }, 503);
  }
  if (request.headers.get("X-Bot-Token") !== env.BOT_RELAY_TOKEN) {
    // Same wording whether the token is missing or wrong, so this cannot be used to probe for a valid one.
    return json({ error: "not allowed" }, 403);
  }

  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const base = HOSTS[parts[0]];
  if (!base) {
    return json({ error: "unknown target", allowed: Object.keys(HOSTS) }, 400);
  }

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
    // Binance's own status and body are passed straight through, so the bots see exactly what Binance said -
    // including its error codes, which they already know how to read.
    return new Response(await r.text(), {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return json({ error: "relay could not reach Binance", detail: String(e).slice(0, 200) }, 502);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
