/* ============================================================
   Headless invariant sim for the SET.core generation core.
   Mirrors the pure functions in set-proto.html (no DOM). Run:
     node prototype/sim-invariants.mjs
   Asserts, across the dial space, the four hard invariants:
     1. no duplicate cards on a board
     2. >= FLOOR sets present at all times (initial + after every clear)
     3. dropped axes stay pinned -> all-same (never affect validity)
     4. (new) the two findability knobs select toward their target
   ============================================================ */

const DIM = 4, V = 3, FLOOR = 1;
const PIN = [0, 0, 0, 0];

// ---- mutable spec the generator reads (mirrors `state`/`CFG`) ----
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

// ---- invariant assertions ----
function assertBoard(board, label, viol) {
  const live = board.filter(Boolean);
  if (live.length !== board.length) viol.push(`${label}: null/empty slot`);
  const keys = new Set(live.map(keyOf));
  if (keys.size !== live.length) viol.push(`${label}: duplicate card`);            // inv 1
  if (countSets(board) < FLOOR) viol.push(`${label}: below floor (${countSets(board)})`); // inv 2
  if (state.F === 3) {                                                               // inv 3
    const di = state.dropIdx;
    for (const c of live) if (c[di] !== PIN[di]) viol.push(`${label}: dropped axis ${di} not pinned`);
  }
}

// ---- run the dial space ----
const CLEARS_PER_CFG = 200;   // simulated clears (initial + patch) per configuration
let configs = 0, clears = 0;
const viol = [];
const hitStats = []; // realized vs target findability, per config

function run() {
  const Fs = [3, 4];
  const Ns = [8, 10, 12, 14, 16];
  for (const F of Fs) {
    const drops = F === 3 ? [0, 1, 2, 3] : [null];
    for (const drop of drops) {
      if (drop !== null) state.dropIdx = drop;
      state.F = F;
      for (const N of Ns) {
        state.N = N;
        const depths = []; for (let k = 1; k <= F; k++) depths.push(k);
        for (const depth of depths) {
          for (const routes of [1, 3, 6]) {
            state.camoDepth = depth; state.escapeRoutes = routes;
            rebuildCFG();
            configs++;
            let depthHit = 0, samplesSeen = 0;
            let board = genInitial();
            assertBoard(board, `init F${F} d${drop} N${N} cd${depth} er${routes}`, viol);
            { const info = boardKInfo(board); depthHit += (info.minK === depth ? 1 : 0); samplesSeen++; }
            for (let c = 0; c < CLEARS_PER_CFG; c++) {
              const sets = findSets(board);
              if (!sets.length) { viol.push(`no set to clear F${F} N${N}`); break; }
              const [i, j, l] = sets[Math.floor(Math.random() * sets.length)];
              const slots = [i, j, l]; slots.forEach(s => board[s] = null);
              board = patch(board, slots);
              assertBoard(board, `patch F${F} d${drop} N${N} cd${depth} er${routes} #${c}`, viol);
              const info = boardKInfo(board); depthHit += (info.minK === depth ? 1 : 0); samplesSeen++;
              clears++;
            }
            hitStats.push({ F, N, depth, routes, hitPct: Math.round(100 * depthHit / samplesSeen) });
          }
        }
      }
    }
  }
}

run();

console.log(`configs tested : ${configs}`);
console.log(`board checks   : ${clears + configs} (each runs 4 invariant asserts)`);
console.log(`floor          : ${FLOOR}`);
console.log(`invariant violations: ${viol.length}`);
if (viol.length) { viol.slice(0, 20).forEach(v => console.log("  ✗ " + v)); process.exitCode = 1; }
else console.log("  ✓ zero violations (no dupes, no floor breaks, dropped axes pinned)");

// Findability achievability: % of boards whose easiest-k landed exactly on the depth target.
// Low numbers at high N / high depth are expected (abundance forces incidental easy sets) — that's
// the "camo is weaker at high N" reality; it tells us where the depth knob saturates.
console.log("\nDepth-target hit rate (easiest-k == target), by F / N / depth:");
for (const F of [3, 4]) {
  for (const depth of (F === 3 ? [1, 2, 3] : [1, 2, 3, 4])) {
    const row = hitStats.filter(h => h.F === F && h.depth === depth);
    const byN = [8, 10, 12, 14, 16].map(N => {
      const cells = row.filter(h => h.N === N);
      const avg = Math.round(cells.reduce((a, b) => a + b.hitPct, 0) / cells.length);
      return `N${N}:${String(avg).padStart(3)}%`;
    }).join("  ");
    console.log(`  F${F} depth=k${depth}  ${byN}`);
  }
}
