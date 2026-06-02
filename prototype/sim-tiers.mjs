/* ============================================================
   Difficulty-tier sweep for the SET.core generation core.

   Reuses the validated pure generation functions from
   sim-invariants.mjs (randCard, third, findSets, boardKInfo,
   boardFindDist, genInitial, patch, plus the two-knob model with
   state.camoDepth + state.escapeRoutes). NO DOM, no deps. Run:

     node prototype/sim-tiers.mjs

   It Monte-Carlo samples many generated boards per config across
   the dial space (F, N, camoDepth, escapeRoutes), MEASURES the
   difficulty signals, synthesizes a transparent scalar difficulty
   index, and prints a readable report to stdout. It also recommends
   a tier ladder anchored at the f=3 / n=12 tuning base.

   This file is read-only against the core: it copies the same pure
   functions verbatim (the core is heavily validated; trust it).
   ============================================================ */

// ---------- copied core (mirrors set-proto.html / sim-invariants.mjs) ----------
const DIM = 4, V = 3, FLOOR = 1;
const PIN = [0, 0, 0, 0];

const state = { F: 3, N: 12, dropIdx: 2, camoDepth: 2, escapeRoutes: 3, encounter: "balanced" };
let CFG = {};
function rebuildCFG() {
  const F = state.F, N = state.N;
  const active = F === 4 ? [0, 1, 2, 3] : [0, 1, 2, 3].filter(i => i !== state.dropIdx);
  CFG = { F, N, active };
}

const ENC_W = { balanced: [1, 1, 1], power: [3, 1, 1], endurance: [1, 3, 1], speed: [1, 1, 3] };
const keyOf = c => c[0] * 27 + c[1] * 9 + c[2] * 3 + c[3];
const r3 = () => Math.floor(Math.random() * 3);
function dealColor() {
  const w = ENC_W[state.encounter], s = w[0] + w[1] + w[2];
  const r = Math.random(); let acc = 0;
  for (let i = 0; i < 3; i++) { acc += 0.5 * (1 / 3) + 0.5 * (w[i] / s); if (r < acc) return i; }
  return 2;
}
function randCard() {
  const c = PIN.slice();
  for (const i of CFG.active) c[i] = (i === 0) ? dealColor() : r3();
  return c;
}
function third(a, b) { const t = new Array(DIM); for (let i = 0; i < DIM; i++) t[i] = (3 - ((a[i] + b[i]) % 3)) % 3; return t; }
function findSets(board) {
  const idxByKey = new Map();
  board.forEach((c, i) => { if (c) idxByKey.set(keyOf(c), i); });
  const out = [];
  for (let i = 0; i < board.length; i++) { if (!board[i]) continue;
    for (let j = i + 1; j < board.length; j++) { if (!board[j]) continue;
      const t = third(board[i], board[j]); const k = idxByKey.get(keyOf(t));
      if (k !== undefined && k > j) out.push([i, j, k]);
    } }
  return out;
}
const countSets = b => findSets(b).length;
function kOfSet(cards) { let k = 0; for (const i of CFG.active) if (!(cards[0][i] === cards[1][i] && cards[1][i] === cards[2][i])) k++; return k; }
function boardKInfo(board) {
  const sets = findSets(board); const hist = {}; let minK = 99;
  for (const [i, j, l] of sets) { const k = kOfSet([board[i], board[j], board[l]]); hist[k] = (hist[k] || 0) + 1; if (k < minK) minK = k; }
  return { count: sets.length, minK: sets.length ? minK : 0, hist };
}
function boardFindDist(board) {
  const { minK, hist, count } = boardKInfo(board);
  if (!count) return Infinity;
  const kErr = Math.abs(minK - state.camoDepth);
  const rErr = Math.abs((hist[minK] || 0) - state.escapeRoutes);
  return kErr * 100 + rErr;
}
function distinctRandomBoard(n) {
  const seen = new Set(), out = [];
  while (out.length < n) { const c = randCard(), k = keyOf(c); if (!seen.has(k)) { seen.add(k); out.push(c); } }
  return out;
}
function genOnce() { for (let t = 0; t < 5000; t++) { const b = distinctRandomBoard(CFG.N); if (countSets(b) >= FLOOR) return b; } return distinctRandomBoard(CFG.N); }
function genInitial() {
  const samples = 140; let best = null, bestDist = Infinity;
  for (let s = 0; s < samples; s++) { const b = genOnce(); const d = boardFindDist(b); if (d < bestDist) { bestDist = d; best = b; } if (bestDist === 0) break; }
  return best || genOnce();
}
function patchOnce(board, slots) {
  const present = new Set(); board.forEach(c => { if (c) present.add(keyOf(c)); });
  for (let attempt = 0; attempt < 400; attempt++) {
    const nb = board.slice(); const seen = new Set(present); let ok = true;
    for (const s of slots) { let c, g = 0; do { c = randCard(); g++; if (g > 200) { ok = false; break; } } while (seen.has(keyOf(c))); if (!ok) break; seen.add(keyOf(c)); nb[s] = c; }
    if (ok && countSets(nb) >= FLOOR) return nb;
  }
  const nb = board.slice(); const seen = new Set(present);
  for (const s of slots) { let c; do { c = randCard(); } while (seen.has(keyOf(c))); seen.add(keyOf(c)); nb[s] = c; }
  let guard = 0;
  while (countSets(nb) < FLOOR && guard < 60) {
    const cards = nb.map((c, i) => [c, i]).filter(x => x[0]); let planted = false;
    for (let i = 0; i < cards.length && !planted; i++) for (let j = i + 1; j < cards.length && !planted; j++) {
      const t = third(cards[i][0], cards[j][0]);
      if (!seen.has(keyOf(t))) { const s = slots[guard % slots.length]; seen.delete(keyOf(nb[s])); nb[s] = t; seen.add(keyOf(t)); planted = true; }
    }
    if (!planted) break; guard++;
  }
  return nb;
}
function patch(board, slots) {
  const samples = 80; let best = null, bestDist = Infinity;
  for (let s = 0; s < samples; s++) { const b = patchOnce(board, slots); const d = boardFindDist(b); if (d < bestDist) { bestDist = d; best = b; } if (bestDist === 0) break; }
  return best || patchOnce(board, slots);
}

// ---------- difficulty index ----------
/*
  DIFFICULTY INDEX (transparent, documented). One scalar that fuses the
  three things that make a round hard to *win* (find sets fast):

    1. Realized easiest-k  -> how camouflaged the BEST available set is.
       This is the dominant findability term (PROJECT.md sec 2: k is the
       purest findability axis). A k=1 board has a gimme; a k=4 board has
       no preattentive cue anywhere. Contribution: CAMO_W * (easiestK - 1).

    2. Easy escape routes  -> how MANY sets sit at the easiest k. With one
       lone easy set you must find that needle; with six you trip over one.
       Fewer routes = harder. We use a saturating term so 1->2 routes
       matters far more than 6->7. Contribution:
       ROUTE_W * (1 / sqrt(easyRoutes)) (more routes -> smaller, capped).

    3. Per-card cognitive load from F -> verifying a candidate triple at
       f=4 means checking 4 axes, not 3, and the f=4-only k=4 tier has zero
       grouping cues at all. This is the "second independent reason f=4 >>
       f=3" from PROJECT.md sec 2. Contribution: LOAD_W * (F - 3).

    4. Scan load from board size N -> more cards = more pairs to eyeball.
       N is U-shaped on NET difficulty (sec 4), but raw scan-load is
       monotone in N; the availability side of the U is already captured by
       the realized easiest-k term (more cards -> easier-k sets appear,
       which LOWERS term 1). So we add only the raw scan-load here and let
       the index reconstruct the U: low N pushes term 1 up (hard to find),
       high N pushes term 1 down but term 4 up (hard to scan). Contribution:
       SCAN_W * max(0, N - 12) / 4   (zero at/below the base, grows above).

  Weights are chosen so realized-k dominates (it is THE findability signal),
  with F as a strong secondary, routes as the fine interpolator, and scan as
  a gentle high-N tax. The index is in arbitrary "DI" units; only the
  ORDERING and gaps matter for laddering tiers.
*/
const CAMO_W = 10;   // per step of easiest-k above 1
const LOAD_W = 9;    // per feature above 3
const ROUTE_W = 8;   // scaled by 1/sqrt(routes)
const SCAN_W = 4;    // per 4 cards of N above the base of 12

function difficultyIndex({ easiestK, easyRoutes, F, N }) {
  const camo = CAMO_W * (easiestK - 1);
  const load = LOAD_W * (F - 3);
  const routeTerm = ROUTE_W * (1 / Math.sqrt(Math.max(easyRoutes, 0.5)));
  const scan = SCAN_W * Math.max(0, N - 12) / 4;
  return camo + load + routeTerm + scan;
}

// ---------- per-config Monte-Carlo measurement ----------
const SAMPLES_PER_CFG = 300;  // boards generated per config (initial + a chain of patched boards)
const PATCH_CHAIN = 5;        // patches sampled per fresh genInitial, to mix initial + replenish stats

function measureConfig(F, N, depth, routes, drop = 2, encounter = "balanced") {
  state.F = F; state.N = N; state.camoDepth = depth; state.escapeRoutes = routes;
  state.dropIdx = drop; state.encounter = encounter;
  rebuildCFG();

  let total = 0, samples = 0;
  let sumSets = 0, sumEasiestK = 0, sumEasyRoutes = 0, sumDI = 0;
  const kHits = { 1: 0, 2: 0, 3: 0, 4: 0 };   // P(easiest set == this k)
  let depthHit = 0;                            // realized easiest-k == target depth

  function record(board) {
    const info = boardKInfo(board);
    if (!info.count) return; // floor guarantees this won't happen, but be safe
    sumSets += info.count;
    sumEasiestK += info.minK;
    const easyRoutes = info.hist[info.minK] || 0;
    sumEasyRoutes += easyRoutes;
    kHits[info.minK] = (kHits[info.minK] || 0) + 1;
    if (info.minK === depth) depthHit++;
    sumDI += difficultyIndex({ easiestK: info.minK, easyRoutes, F, N });
    samples++;
  }

  const fresh = Math.ceil(SAMPLES_PER_CFG / (1 + PATCH_CHAIN));
  for (let f = 0; f < fresh; f++) {
    let board = genInitial();
    record(board);
    total++;
    for (let c = 0; c < PATCH_CHAIN && samples < SAMPLES_PER_CFG; c++) {
      const sets = findSets(board);
      if (!sets.length) break;
      const [i, j, l] = sets[Math.floor(Math.random() * sets.length)];
      const slots = [i, j, l]; slots.forEach(s => board[s] = null);
      board = patch(board, slots);
      record(board);
    }
  }

  const pK = {};
  for (let k = 1; k <= F; k++) pK[k] = Math.round(100 * (kHits[k] || 0) / samples);
  return {
    F, N, depth, routes,
    avgSets: +(sumSets / samples).toFixed(1),
    avgEasiestK: +(sumEasiestK / samples).toFixed(2),
    avgEasyRoutes: +(sumEasyRoutes / samples).toFixed(1),
    achievPct: Math.round(100 * depthHit / samples),
    pK,
    DI: +(sumDI / samples).toFixed(1),
    samples,
  };
}

// ---------- sweep the dial space ----------
const Fs = [3, 4];
const Ns = [8, 10, 12, 14, 16];
const routeSet = [1, 2, 3, 4, 6];

console.log("=".repeat(78));
console.log("SET.core difficulty-tier sweep");
console.log(`samples/config: ${SAMPLES_PER_CFG}   (genInitial + ${PATCH_CHAIN}-patch chains)`);
console.log("DI = 10*(easiestK-1) + 9*(F-3) + 8/sqrt(routes) + 4*max(0,N-12)/4");
console.log("=".repeat(78));

const rows = [];
for (const F of Fs) {
  for (const N of Ns) {
    for (let depth = 1; depth <= F; depth++) {
      for (const routes of routeSet) {
        rows.push(measureConfig(F, N, depth, routes));
      }
    }
  }
}

// ---------- full table ----------
function pad(s, w) { s = String(s); return s.length >= w ? s : s + " ".repeat(w - s.length); }
function padL(s, w) { s = String(s); return s.length >= w ? s : " ".repeat(w - s.length) + s; }

console.log("\nFULL SWEEP (target depth/routes -> realized signals)\n");
console.log([
  pad("F", 2), pad("N", 3), pad("depthT", 7), pad("routeT", 7),
  padL("achiev%", 8), padL("avgSets", 8), padL("e-k", 6), padL("e-rt", 6),
  padL("Pk1", 5), padL("Pk2", 5), padL("Pk3", 5), padL("Pk4", 5), padL("DI", 7),
].join(" "));
console.log("-".repeat(86));
let lastKey = "";
for (const r of rows) {
  const key = `${r.F}-${r.N}`;
  if (key !== lastKey && lastKey !== "") console.log("");
  lastKey = key;
  console.log([
    pad(r.F, 2), pad(r.N, 3), pad("k" + r.depth, 7), pad(r.routes, 7),
    padL(r.achievPct + "%", 8), padL(r.avgSets, 8), padL(r.avgEasiestK, 6), padL(r.avgEasyRoutes, 6),
    padL((r.pK[1] ?? 0) + "%", 5), padL((r.pK[2] ?? 0) + "%", 5),
    padL((r.pK[3] ?? 0) + "%", 5), padL((r.pK[4] ?? "-") === "-" ? "-" : (r.pK[4] ?? 0) + "%", 5),
    padL(r.DI, 7),
  ].join(" "));
}

// ---------- achievability heatmap (realized easiest-k hit rate) ----------
console.log("\n\nACHIEVABILITY: % of boards whose realized easiest-k == target depth");
console.log("(low at high N/high depth = abundance forces incidental easy sets -> depth saturation)\n");
for (const F of Fs) {
  for (let depth = 1; depth <= F; depth++) {
    const cells = Ns.map(N => {
      const rs = rows.filter(r => r.F === F && r.N === N && r.depth === depth);
      const avg = Math.round(rs.reduce((a, b) => a + b.achievPct, 0) / rs.length);
      return `N${N}:${padL(avg + "%", 4)}`;
    }).join("  ");
    console.log(`  F${F} depth=k${depth}   ${cells}`);
  }
  console.log("");
}

// ---------- N's U-shape (hold a constant ACHIEVABLE depth, vary N) ----------
console.log("N TEXTURE CHECK: DI vs N at fixed depth=k2, routes=3 (watch for non-monotone / U-shape)\n");
for (const F of Fs) {
  const cells = Ns.map(N => {
    const r = rows.find(x => x.F === F && x.N === N && x.depth === 2 && x.routes === 3);
    return `N${N}: DI=${padL(r.DI, 5)} (e-k ${r.avgEasiestK}, sets ${r.avgSets})`;
  });
  console.log(`  F${F}:`);
  cells.forEach(c => console.log("     " + c));
  console.log("");
}

// ---------- recommended tier ladder ----------
/*
  We pick achievable configs (achiev% >= 60 OR the realized easiest-k is the
  honest target the slider would actually deliver) and lay them on a rising
  DI ladder, anchored so that the f=3/n=12 tuning base sits in the middle of
  the human-playable band. Pull the actual measured rows so the ladder is data,
  not assertion.
*/
function pick(F, N, depth, routes) {
  return rows.find(r => r.F === F && r.N === N && r.depth === depth && r.routes === routes);
}

const ladder = [
  { name: "Trivial / Warmup",      cfg: pick(3, 12, 1, 6), timer: 120, feel: "gimmes everywhere; teaches the verb" },
  { name: "Easy / Stroll",         cfg: pick(3, 12, 1, 3), timer: 90,  feel: "a gimme is always sitting there" },
  { name: "Standard / BASE",       cfg: pick(3, 12, 2, 3), timer: 60,  feel: "the f=3/n=12 tuning anchor" },
  { name: "Brisk / Pressed",       cfg: pick(3, 12, 2, 1), timer: 60,  feel: "one lone moderate set; less slack" },
  { name: "Tricky / Texture",      cfg: pick(3, 8, 2, 1),  timer: 45,  feel: "small tense board, real f=3 camo lives at low N" },
  { name: "Hard / Step Up",        cfg: pick(4, 12, 2, 3), timer: 60,  feel: "F-step: 4 axes to verify, k4 tier exists" },
  { name: "Severe / Camo",         cfg: pick(4, 12, 3, 2), timer: 45,  feel: "best set is deeply camouflaged" },
  { name: "Brutal / Mastery",      cfg: pick(4, 14, 3, 1), timer: 30,  feel: "lone camo set on a busy board, on the clock" },
];

console.log("=".repeat(78));
console.log("RECOMMENDED TIER LADDER (data-backed, anchored at f=3/n=12 = Standard/BASE)");
console.log("=".repeat(78));
console.log([
  pad("Tier", 20), pad("F", 2), pad("N", 3), pad("depth", 6), pad("rt", 3),
  pad("tmr", 4), padL("DI", 6), padL("achv", 6), padL("eK", 5), padL("sets", 5),
].join(" "));
console.log("-".repeat(78));
for (const t of ladder) {
  const c = t.cfg;
  console.log([
    pad(t.name, 20), pad(c.F, 2), pad(c.N, 3), pad("k" + c.depth, 6), pad(c.routes, 3),
    pad(t.timer + "s", 4), padL(c.DI, 6), padL(c.achievPct + "%", 6),
    padL(c.avgEasiestK, 5), padL(c.avgSets, 5),
  ].join(" "));
}
console.log("");
console.log("DI ordering check (should be roughly monotone up the ladder):");
console.log("  " + ladder.map(t => t.cfg.DI).join("  ->  "));
console.log("\nDone. See prototype/TIERS.md for the narrative ladder + lever guidance.");
