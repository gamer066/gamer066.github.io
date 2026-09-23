// TEMPORARY TEST (23 Sep 2026, trading): which Binance hosts will Cloudflare's network talk to?
//
// Background: GitHub Actions runners are US-based and Binance answers them HTTP 451 "restricted location", which
// killed running the bots in the cloud. Round one showed Cloudflare CAN reach testnet.binance.vision (200) but
// not data-api.binance.vision or demo-fapi.binance.com (403). The bots need BOTH a trading endpoint and a source
// of candles, so this round hunts for any candle source Cloudflare can read.
//
// Read-only public data: server time and recent candles. No keys, no orders, nothing signed.
export async function onRequest() {
  const targets = {
    "testnet (orders)": "https://testnet.binance.vision/api/v3/time",
    "testnet klines": "https://testnet.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3",
    "data-api.binance.vision": "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3",
    "api.binance.com": "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3",
    "api1.binance.com": "https://api1.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3",
    "api-gcp.binance.com": "https://api-gcp.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3",
    "api.binance.us": "https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3",
    "demo-fapi (shorts)": "https://demo-fapi.binance.com/fapi/v1/time",
    "fapi.binance.com": "https://fapi.binance.com/fapi/v1/time",
  };
  const out = {};
  await Promise.all(Object.entries(targets).map(async ([name, url]) => {
    try {
      const r = await fetch(url, { cf: { cacheTtl: 0 } });
      const body = (await r.text()).slice(0, 90);
      out[name] = r.ok ? { ok: true, status: r.status, sample: body } : { ok: false, status: r.status };
    } catch (e) {
      out[name] = { ok: false, error: String(e).slice(0, 90) };
    }
  }));
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
