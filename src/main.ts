import { systemRng } from './core/rng'
import { type Board, countSets } from './core/sets'
import { type GenConfig, genInitial } from './core/generate'

// Dev-scaffold entry. Proves the toolchain AND the ported core end-to-end in the browser by
// actually generating a board with the shipped combat config. The real app is built out here as
// engine/ and ui/ get extracted (TODO.md §A); prototype/set-combat.html stays the runnable oracle.

// The shipped combat board: 15 cards, shading (axis 2) dropped, easiest-k 1, 6 escape routes.
const cfg: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }
const board: Board = genInitial(cfg, systemRng)
const sets = countSets(board)
const ok = board.length === cfg.n && sets >= cfg.floor

const app = document.querySelector<HTMLDivElement>('#app')
if (app) {
  app.innerHTML = `
    <main style="font-family:ui-monospace,monospace;color:#e8ebf2;background:#0b0d12;min-height:100vh;padding:40px;line-height:1.65">
      <h1 style="font-size:18px;letter-spacing:.08em;margin:0 0 12px">set.core — dev scaffold</h1>
      <p style="color:#8b93a7;max-width:62ch">Vite + Vitest + TypeScript · framework-free. The single-file
        prototype (<code>prototype/set-combat.html</code>) remains the runnable behavioral oracle during migration.</p>
      <p style="margin-top:18px">core/ generator self-check —
        generated a <strong>${board.length}</strong>-card board with <strong>${sets}</strong> set${sets === 1 ? '' : 's'}:
        <strong style="color:${ok ? '#5eead4' : '#f0565b'}">${ok ? 'PASS' : 'FAIL'}</strong></p>
      <p style="color:#5b6175;margin-top:18px">Next: extract <code>engine/</code> (resolution, traps, tactics)
        behind the engine boundary (TODO.md §A, step 4).</p>
    </main>`
}
