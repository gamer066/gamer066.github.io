// TEMPORARY TEST (23 Sep 2026, trading): does Cloudflare's network reach Binance?
//
// GitHub Actions runners are US-based and Binance answers them with HTTP 451 "Service unavailable from a
// restricted location", which killed the plan to run the bots in the cloud. If Cloudflare CAN reach Binance,
// then a small Cloudflare proxy in front of Binance fixes it: GitHub -> Cloudflare -> Binance.
//
// Read-only and public data only: this asks Binance for the server time and the BTC price. No keys, no orders,
// nothing signed. Delete this file once the question is answered.
export async function onRequest() {
  const targets = {
    spotTestnet: "https://testnet.binance.vision/api/v3/time",
    publicData: "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
    futuresDemo: "https://demo-fapi.binance.com/fapi/v1/time",
  };
  const out = {};
  for (const [name, url] of Object.entries(targets)) {
    try {
      const r = await fetch(url, { cf: { cacheTtl: 0 } });
      const body = (await r.text()).slice(0, 160);
      out[name] = { status: r.status, ok: r.ok, body };
    } catch (e) {
      out[name] = { error: String(e).slice(0, 160) };
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
