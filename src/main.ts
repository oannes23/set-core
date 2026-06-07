import { type Card, isSet, third } from './core/affine'

// Dev-scaffold entry. Proves the toolchain (Vite + TS + the first core module) end-to-end
// in the browser. The real app is built out here as engine/ and ui/ get extracted from the
// prototype (TODO.md §A). Until parity, prototype/set-combat.html stays the runnable oracle.

const a: Card = [0, 1, 2, 0]
const b: Card = [1, 1, 0, 2]
const corePass = isSet(a, b, third(a, b))

const app = document.querySelector<HTMLDivElement>('#app')
if (app) {
  app.innerHTML = `
    <main style="font-family:ui-monospace,monospace;color:#e8ebf2;background:#0b0d12;min-height:100vh;padding:40px;line-height:1.65">
      <h1 style="font-size:18px;letter-spacing:.08em;margin:0 0 12px">set.core — dev scaffold</h1>
      <p style="color:#8b93a7;max-width:60ch">Vite + Vitest + TypeScript · framework-free. The single-file
        prototype (<code>prototype/set-combat.html</code>) remains the runnable behavioral oracle during migration.</p>
      <p style="margin-top:18px">core self-check (<code>third</code> / <code>isSet</code>):
        <strong style="color:${corePass ? '#5eead4' : '#f0565b'}">${corePass ? 'PASS' : 'FAIL'}</strong></p>
      <p style="color:#5b6175;margin-top:18px">Next: port the generator into <code>src/core/</code> behind the
        invariant sim (TODO.md §A, step 2).</p>
    </main>`
}
