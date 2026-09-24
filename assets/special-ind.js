/* Technical indicators for the "Special bot trades" chart (/special/bot/). Pure maths: no page, no network.
 *
 * window.SDLInd. Each function takes plain arrays and returns NEW arrays lined up with its input (same length),
 * holding null wherever the indicator has no value yet (warm-up) or the input was bad.
 *
 * Bars are {time, open, high, low, close, v}, oldest first (time in seconds, v = volume).
 * Definitions follow TradingView's built-in indicators (the Pine ta.* functions):
 *   - EMA and Wilder's RMA are seeded with the SMA of their first n values. Standard deviation is the population
 *     one (TradingView's default), with float dust below 1e-10 treated as zero, so a flat series has width 0.
 *   - A bad value (null, NaN, text, a bar missing a price) is skipped, the way TradingView's built-ins ignore na:
 *     it gets null at its own index and the indicator carries on from the last good values.
 *   - A length left out takes the default shown below; fractions round down. A length below 1, not a number, or
 *     longer than the data gives all nulls. A multiplier that is not a finite number gives all nulls.
 * Cost: every function is a single pass (rolling windows keep only the last n values), so recomputing everything on
 * each live tick is cheap. emaNext / rmaNext advance one average by one value exactly the way ema() / rma() do.
 */
(function () {
  "use strict";

  /* ---- small checks ---- */
  function ok(v) { return typeof v === "number" && isFinite(v); }
  function list(x) { return Array.isArray(x) ? x : []; }
  function nulls(k) { var a = new Array(k); for (var i = 0; i < k; i++) a[i] = null; return a; }
  function okBar(b) { return !!b && ok(b.open) && ok(b.high) && ok(b.low) && ok(b.close); }
  /* A length: missing -> def; else a whole number >= 1 (fractions round down); 0 means "unusable". */
  function per(n, def) {
    if (n == null) n = def;
    n = Math.floor(Number(n));
    return n >= 1 ? n : 0;
  }
  /* A multiplier: missing -> def; else any finite number; NaN means "unusable". */
  function factor(x, def) {
    if (x == null) x = def;
    x = Number(x);
    return ok(x) ? x : NaN;
  }

  /* ---- price sources ---- */
  var PICK = {
    open: function (b) { return b.open; },
    high: function (b) { return b.high; },
    low: function (b) { return b.low; },
    close: function (b) { return b.close; },
    hl2: function (b) { return (b.high + b.low) / 2; },
    hlc3: function (b) { return (b.high + b.low + b.close) / 3; },
    ohlc4: function (b) { return (b.open + b.high + b.low + b.close) / 4; },
    hlcc4: function (b) { return (b.high + b.low + b.close + b.close) / 4; }
  };
  /* source(bars, "close"|"open"|"high"|"low"|"hl2"|"hlc3"|"ohlc4"|"hlcc4"|"v") -> values (null for a bad bar). */
  function source(bars, kind) {
    var B = list(bars), N = B.length, out = nulls(N), key = kind == null ? "close" : String(kind), i;
    if (key === "v" || key === "volume") {
      for (i = 0; i < N; i++) if (B[i] && ok(B[i].v)) out[i] = B[i].v;
      return out;
    }
    if (!Object.prototype.hasOwnProperty.call(PICK, key)) return out;
    for (i = 0; i < N; i++) if (okBar(B[i])) out[i] = PICK[key](B[i]);
    return out;
  }

  /* ---- rolling windows ----
     Walks the good values keeping the last n in a ring; once it is full, out[i] = take(ring, oldest, sum, n).
     The running sum is re-added from scratch each time the ring wraps, so float drift can never build up. */
  function roll(values, n, take) {
    var src = list(values), N = src.length, out = nulls(N);
    if (!n || n > N) return out;
    var ring = new Array(n), cnt = 0, pos = 0, sum = 0, i, j;
    for (i = 0; i < N; i++) {
      var v = src[i];
      if (!ok(v)) continue;
      if (cnt === n) sum -= ring[pos]; else cnt++;
      ring[pos] = v;
      sum += v;
      if (++pos === n) {
        pos = 0;
        if (cnt === n) { sum = 0; for (j = 0; j < n; j++) sum += ring[j]; }
      }
      if (cnt === n) out[i] = take(ring, pos, sum, n);
    }
    return out;
  }
  function sma(values, n) {
    return roll(values, per(n), function (r, o, s, p) { return s / p; });
  }
  /* Newest value weighs n, oldest weighs 1 (TradingView ta.wma). */
  function wma(values, n) {
    return roll(values, per(n), function (r, o, s, p) {
      var w = 0;
      for (var j = 0; j < p; j++) w += r[(o + j) % p] * (j + 1);
      return w / (p * (p + 1) / 2);
    });
  }
  /* Population standard deviation over n values (TradingView ta.stdev, biased = true). */
  function stdev(values, n) {
    return roll(values, per(n), function (r, o, s, p) {
      var m = s / p, eps = 1e-10 * Math.max(1, Math.abs(m)), q = 0;
      for (var j = 0; j < p; j++) {
        var d = r[j] - m;
        if (d < eps && d > -eps) d = 0;
        q += d * d;
      }
      return Math.sqrt(q / p);
    });
  }

  /* Highest / lowest of the last n good values, via a monotonic queue (O(1) per value). */
  function extreme(values, n, sign) {
    var src = list(values), N = src.length, out = nulls(N), p = per(n);
    if (!p || p > N) return out;
    var qv = [], qs = [], head = 0, seen = 0;
    for (var i = 0; i < N; i++) {
      var v = src[i];
      if (!ok(v)) continue;
      seen++;
      while (qv.length > head && sign * (v - qv[qv.length - 1]) >= 0) { qv.pop(); qs.pop(); }
      qv.push(v); qs.push(seen);
      while (qs[head] <= seen - p) head++;
      if (seen >= p) out[i] = qv[head];
    }
    return out;
  }
  function highest(values, n) { return extreme(values, n, 1); }
  function lowest(values, n) { return extreme(values, n, -1); }

  /* ---- exponential averages ----
     Seeded with the SMA of the first n good values, then alpha * value + (1 - alpha) * previous. */
  function smooth(values, n, alpha) {
    var src = list(values), N = src.length, out = nulls(N);
    if (!n || n > N) return out;
    var sum = 0, cnt = 0, prev = null;
    for (var i = 0; i < N; i++) {
      var v = src[i];
      if (!ok(v)) continue;
      if (prev !== null) prev = alpha * v + (1 - alpha) * prev;
      else if (++cnt < n) { sum += v; continue; }
      else prev = (sum + v) / n;
      out[i] = prev;
    }
    return out;
  }
  function ema(values, n) { var p = per(n); return smooth(values, p, 2 / (p + 1)); }
  /* Wilder's moving average (TradingView ta.rma), used by RSI, ATR and ADX. */
  function rma(values, n) { var p = per(n); return smooth(values, p, 1 / p); }
  /* One step of ema()/rma() for the live bar: gives exactly what the full arrays would hold. */
  function emaNext(prev, value, n) {
    var p = per(n);
    if (!p || !ok(prev) || !ok(value)) return null;
    var a = 2 / (p + 1);
    return a * value + (1 - a) * prev;
  }
  function rmaNext(prev, value, n) {
    var p = per(n);
    if (!p || !ok(prev) || !ok(value)) return null;
    var a = 1 / p;
    return a * value + (1 - a) * prev;
  }

  /* ---- bands ---- */
  /* Bollinger Bands (TradingView defaults 20, 2): SMA +/- mult * population stdev. */
  function bollinger(values, n, mult) {
    var p = per(n, 20), k = factor(mult, 2), mid = sma(values, p), N = mid.length, up = nulls(N), lo = nulls(N);
    if (!ok(k)) return { mid: nulls(N), upper: up, lower: lo };
    var sd = stdev(values, p);
    for (var i = 0; i < N; i++) {
      if (mid[i] === null) continue;
      up[i] = mid[i] + k * sd[i];
      lo[i] = mid[i] - k * sd[i];
    }
    return { mid: mid, upper: up, lower: lo };
  }
  /* Donchian Channels (default 20): highest high, lowest low, and their middle. */
  function donchian(bars, n) {
    var p = per(n, 20), H = highest(source(bars, "high"), p), L = lowest(source(bars, "low"), p), M = nulls(H.length);
    for (var i = 0; i < H.length; i++) if (H[i] !== null) M[i] = (H[i] + L[i]) / 2;
    return { upper: H, lower: L, mid: M };
  }
  /* Keltner Channels (TradingView defaults 20, 2, ATR 10): EMA of close +/- mult * ATR. */
  function keltner(bars, n, mult, atrN) {
    var k = factor(mult, 2), mid = ema(source(bars, "close"), per(n, 20)), N = mid.length, up = nulls(N), lo = nulls(N);
    if (!ok(k)) return { mid: nulls(N), upper: up, lower: lo };
    var A = atr(bars, per(atrN, 10));
    for (var i = 0; i < N; i++) {
      if (mid[i] === null || A[i] === null) continue;
      up[i] = mid[i] + k * A[i];
      lo[i] = mid[i] - k * A[i];
    }
    return { mid: mid, upper: up, lower: lo };
  }

  /* ---- oscillators ---- */
  /* RSI (default 14) with Wilder smoothing. TradingView's rule: average loss 0 -> 100, else average gain 0 -> 0,
     so a flat series reads 100, not 50. First value at index n. */
  function rsi(values, n) {
    var src = list(values), N = src.length, p = per(n, 14), up = nulls(N), dn = nulls(N), last = null, i;
    for (i = 0; i < N; i++) {
      var v = src[i];
      if (!ok(v)) continue;
      if (last !== null) {
        var c = v - last;
        up[i] = c > 0 ? c : 0;
        dn[i] = c < 0 ? -c : 0;
      }
      last = v;
    }
    var U = rma(up, p), D = rma(dn, p), out = nulls(N);
    for (i = 0; i < N; i++) {
      if (U[i] === null) continue;
      out[i] = D[i] === 0 ? 100 : U[i] === 0 ? 0 : 100 - 100 / (1 + U[i] / D[i]);
    }
    return out;
  }
  /* MACD (12, 26, 9): EMA(fast) - EMA(slow), signal = EMA of MACD, hist = MACD - signal. */
  function macd(values, fast, slow, signal) {
    var F = ema(values, per(fast, 12)), S = ema(values, per(slow, 26)), N = F.length, M = nulls(N), H = nulls(N), i;
    for (i = 0; i < N; i++) if (F[i] !== null && S[i] !== null) M[i] = F[i] - S[i];
    var G = ema(M, per(signal, 9));
    for (i = 0; i < N; i++) if (G[i] !== null) H[i] = M[i] - G[i];
    return { macd: M, signal: G, hist: H };
  }
  /* Stochastic RSI (14, 14, 3, 3): %K = SMA(k) of 100 * (RSI - lowest RSI) / (highest - lowest), %D = SMA(d) of %K.
     A window where RSI did not move at all has no stochastic value (null) instead of dividing by zero. */
  function stochRsi(values, rsiN, stochN, k, d) {
    var r = rsi(values, per(rsiN, 14)), s = per(stochN, 14), N = r.length, st = nulls(N);
    var hi = highest(r, s), lo = lowest(r, s);
    for (var i = 0; i < N; i++) {
      if (hi[i] === null) continue;
      var range = hi[i] - lo[i];
      if (range > 0) st[i] = 100 * (r[i] - lo[i]) / range;
    }
    var K = sma(st, per(k, 3));
    return { k: K, d: sma(K, per(d, 3)) };
  }

  /* ---- ranges and trend ---- */
  /* True range: the first good bar uses high - low, later bars also reach back to the previous close. */
  function trueRange(bars) {
    var B = list(bars), N = B.length, out = nulls(N), pc = null;
    for (var i = 0; i < N; i++) {
      var b = B[i];
      if (!okBar(b)) continue;
      var r = b.high - b.low;
      if (pc !== null) r = Math.max(r, Math.abs(b.high - pc), Math.abs(b.low - pc));
      out[i] = r;
      pc = b.close;
    }
    return out;
  }
  /* Average True Range (default 14), Wilder smoothing (TradingView ta.atr). First value at index n - 1. */
  function atr(bars, n) { return rma(trueRange(bars), per(n, 14)); }

  /* Supertrend (TradingView ta.supertrend, ATR 10, factor 3) on hl2.
     dir: 1 = up trend (line under price), -1 = down trend (line over price). NOTE: TradingView itself uses the
     opposite sign. up / down hold the line only while the trend is up / down (null otherwise), so two line series
     fed with toLine(bars, x, true) draw it green and red with breaks at each flip, like TradingView. */
  function supertrend(bars, n, mult) {
    var B = list(bars), N = B.length, f = factor(mult, 3);
    var line = nulls(N), dir = nulls(N), up = nulls(N), down = nulls(N);
    if (!ok(f)) return { line: line, dir: dir, up: up, down: down };
    var A = atr(B, per(n, 10)), started = false, pUp = 0, pLo = 0, pST = null, pC = null;
    for (var i = 0; i < N; i++) {
      var b = B[i], a = A[i];
      if (a === null) { if (okBar(b)) pC = b.close; continue; }
      var mid = (b.high + b.low) / 2, u = mid + f * a, l = mid - f * a;
      l = l > pLo || (pC !== null && pC < pLo) ? l : pLo;
      u = u < pUp || (pC !== null && pC > pUp) ? u : pUp;
      /* TradingView's direction: -1 = up, 1 = down; it starts at 1 on the first bar that has an ATR. */
      var d = !started ? 1 : pST === pUp ? (b.close > u ? -1 : 1) : (b.close < l ? 1 : -1);
      var st = d === -1 ? l : u;
      line[i] = st;
      dir[i] = -d;
      if (d === -1) up[i] = st; else down[i] = st;
      started = true; pUp = u; pLo = l; pST = st; pC = b.close;
    }
    return { line: line, dir: dir, up: up, down: down };
  }

  /* Directional Movement Index (TradingView "DMI", DI 14, ADX smoothing 14) -> {plus, minus, adx}.
     If the smoothed range is 0, +DI / -DI carry their last value (Pine fixnan). */
  function dmi(bars, n, adxN) {
    var B = list(bars), N = B.length, diL = per(n, 14), adL = per(adxN, 14);
    var P = nulls(N), M = nulls(N), X = nulls(N), tr = nulls(N), pd = nulls(N), md = nulls(N), prev = null, i;
    for (i = 0; i < N; i++) {
      var b = B[i];
      if (!okBar(b)) continue;
      if (prev !== null) {
        var upMove = b.high - prev.high, downMove = prev.low - b.low;
        pd[i] = upMove > downMove && upMove > 0 ? upMove : 0;
        md[i] = downMove > upMove && downMove > 0 ? downMove : 0;
        tr[i] = Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close));
      }
      prev = b;
    }
    var T = rma(tr, diL), PS = rma(pd, diL), MS = rma(md, diL), dx = nulls(N), lp = null, lm = null;
    for (i = 0; i < N; i++) {
      if (T[i] === null) continue;
      if (T[i] > 0) { lp = 100 * PS[i] / T[i]; lm = 100 * MS[i] / T[i]; }
      if (lp === null) continue;
      P[i] = lp;
      M[i] = lm;
      var s = lp + lm;
      dx[i] = Math.abs(lp - lm) / (s === 0 ? 1 : s);
    }
    var A = rma(dx, adL);
    for (i = 0; i < N; i++) if (A[i] !== null) X[i] = 100 * A[i];
    return { plus: P, minus: M, adx: X };
  }

  /* ---- volume ---- */
  /* VWAP of hlc3 that restarts at each day boundary, the day being floor((time + tzOffsetSeconds) / 86400).
     With plain UTC bar times, tz 0 gives TradingView's crypto session (00:00 UTC). If the page has already
     shifted bar times into local time, pass the opposite shift (e.g. -TZ) to keep UTC days. Bars with no volume
     yet in the day give null. mult > 0 also returns bands at +/- mult volume-weighted standard deviations. */
  function vwapCore(bars, tz, mult, bands) {
    var B = list(bars), N = B.length, off = Number(tz == null ? 0 : tz);
    var mid = nulls(N), hi = nulls(N), lo = nulls(N), res = { mid: mid, upper: hi, lower: lo };
    if (!ok(off) || (bands && !ok(mult))) return res;
    var day = null, pv = 0, vol = 0, mean = 0, s2 = 0;
    for (var i = 0; i < N; i++) {
      var b = B[i];
      if (!okBar(b) || !ok(b.v) || b.v < 0 || !ok(b.time)) continue;
      var key = Math.floor((b.time + off) / 86400);
      if (key !== day) { day = key; pv = 0; vol = 0; mean = 0; s2 = 0; }
      if (b.v > 0) {
        var x = (b.high + b.low + b.close) / 3, w = b.v;
        pv += x * w;
        vol += w;
        var dl = x - mean;           /* West's weighted update: stable variance without sum(x^2) cancellation */
        mean += dl * w / vol;
        s2 += w * dl * (x - mean);
      }
      if (vol <= 0) continue;
      var m = pv / vol;
      mid[i] = m;
      if (bands) {
        var sd = Math.sqrt(Math.max(s2 / vol, 0));
        hi[i] = m + mult * sd;
        lo[i] = m - mult * sd;
      }
    }
    return res;
  }
  function vwap(bars, tzOffsetSeconds) { return vwapCore(bars, tzOffsetSeconds, 0, false).mid; }
  function vwapBands(bars, tzOffsetSeconds, mult) { return vwapCore(bars, tzOffsetSeconds, factor(mult, 1), true); }

  /* On-Balance Volume: running total of volume, added on an up close, taken away on a down close. Starts at 0. */
  function obv(bars) {
    var B = list(bars), N = B.length, out = nulls(N), total = 0, pc = null;
    for (var i = 0; i < N; i++) {
      var b = B[i];
      if (!okBar(b) || !ok(b.v)) continue;
      if (pc !== null) total += b.close > pc ? b.v : b.close < pc ? -b.v : 0;
      pc = b.close;
      out[i] = total;
    }
    return out;
  }

  /* ---- candles ---- */
  /* Heikin Ashi (TradingView): close = ohlc4, open = average of the previous HA open and close (first bar:
     (open + close) / 2), high / low stretched to cover both. A bad bar comes back as {time} only, which
     Lightweight Charts draws as a gap. Keeps time and v. */
  function heikinAshi(bars) {
    var B = list(bars), N = B.length, out = new Array(N), po = null, pc = null;
    for (var i = 0; i < N; i++) {
      var b = B[i];
      if (!okBar(b)) { out[i] = { time: b ? b.time : null }; continue; }
      var c = (b.open + b.high + b.low + b.close) / 4, o = po === null ? (b.open + b.close) / 2 : (po + pc) / 2;
      out[i] = { time: b.time, open: o, high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), close: c, v: b.v };
      po = o;
      pc = c;
    }
    return out;
  }

  /* ---- signals ---- */
  /* Where fast crosses slow (TradingView ta.crossover / ta.crossunder): dir 1 when fast goes above slow, -1 when it
     goes below. Compares each point with the previous point where both had a value. */
  function crosses(fastArr, slowArr) {
    var a = list(fastArr), b = list(slowArr), N = Math.min(a.length, b.length), out = [], pa = null, pb = null;
    for (var i = 0; i < N; i++) {
      if (!ok(a[i]) || !ok(b[i])) continue;
      if (pa !== null) {
        if (a[i] > b[i] && pa <= pb) out.push({ index: i, dir: 1 });
        else if (a[i] < b[i] && pa >= pb) out.push({ index: i, dir: -1 });
      }
      pa = a[i];
      pb = b[i];
    }
    return out;
  }

  /* ---- ready for Lightweight Charts ---- */
  /* [{time, value}] for setData, skipping empty points. gaps = true puts {time} in their place instead, which breaks
     the line there (use it for supertrend.up / .down). */
  function toLine(bars, values, gaps) {
    var B = list(bars), V = list(values), N = Math.min(B.length, V.length), out = [];
    for (var i = 0; i < N; i++) {
      var b = B[i];
      if (!b || b.time == null) continue;
      if (ok(V[i])) out.push({ time: b.time, value: V[i] });
      else if (gaps) out.push({ time: b.time });
    }
    return out;
  }
  /* TradingView's MACD histogram colours: [above & rising, above & falling, below & rising, below & falling]. */
  var HIST = ["#26A69A", "#B2DFDB", "#FFCDD2", "#FF5252"];
  /* [{time, value, color}] for a HistogramSeries, coloured the way TradingView colours its MACD histogram. */
  function toHist(bars, values, colors) {
    var B = list(bars), V = list(values), C = Array.isArray(colors) && colors.length === 4 ? colors : HIST;
    var N = Math.min(B.length, V.length), out = [], prev = null;
    for (var i = 0; i < N; i++) {
      var b = B[i], v = V[i];
      if (!b || b.time == null || !ok(v)) continue;
      var rising = prev !== null && prev < v;
      out.push({ time: b.time, value: v, color: v >= 0 ? (rising ? C[0] : C[1]) : (rising ? C[2] : C[3]) });
      prev = v;
    }
    return out;
  }
  /* The last point as {time, value} for series.update() on a live tick, or null if it has no value. */
  function lastPoint(bars, values) {
    var B = list(bars), V = list(values), i = Math.min(B.length, V.length) - 1;
    return i >= 0 && B[i] && B[i].time != null && ok(V[i]) ? { time: B[i].time, value: V[i] } : null;
  }

  var SDLInd = {
    source: source, sma: sma, ema: ema, wma: wma, rma: rma, stdev: stdev, highest: highest, lowest: lowest,
    emaNext: emaNext, rmaNext: rmaNext,
    bollinger: bollinger, donchian: donchian, keltner: keltner,
    rsi: rsi, macd: macd, stochRsi: stochRsi,
    trueRange: trueRange, atr: atr, supertrend: supertrend, dmi: dmi,
    vwap: vwap, vwapBands: vwapBands, obv: obv,
    heikinAshi: heikinAshi, crosses: crosses,
    toLine: toLine, toHist: toHist, lastPoint: lastPoint, HIST_COLORS: HIST.slice()
  };
  if (typeof window !== "undefined") window.SDLInd = SDLInd;
  if (typeof module !== "undefined" && module.exports) module.exports = SDLInd;
})();
