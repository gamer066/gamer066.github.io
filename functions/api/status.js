/* The public home page's small status line (30 Sep 2026): how many bots, how many trades are open, and when.

WHY: those numbers came only from assets/status.js, which only the laptop publishes, so with the laptop off the home
page said "updated 9 hours ago". The cloud run already sends its numbers to /api/bots; this hands out just the
counts from that copy - never any money figure, since the home page is open to everyone.

  GET /api/status  -> { bots, openTrades, mode, updated }  or { empty: true }
*/

export async function onRequestGet({ env }) {
  try {
    if (!env.DB) return json({ empty: true });
    const row = await env.DB.prepare("SELECT value FROM store WHERE key = 'bots'").first();
    if (!row) return json({ empty: true });
    const s = JSON.parse(row.value);
    return json({
      bots: Array.isArray(s.bots) ? s.bots.length : null,
      openTrades: Array.isArray(s.positions) ? s.positions.length : null,
      mode: "Practice",
      updated: typeof s.updated === "string" ? s.updated : null
    });
  } catch (e) {
    return json({ empty: true });   // no table yet, or anything else: the page keeps the laptop's numbers
  }
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" }
  });
}
