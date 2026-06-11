# SET.core — seed bundle

This is a project seed for a **Set**-based skill-minigame intended as the
action-resolution layer of a web RPG.

## Start here
1. **`CLAUDE.md`** — fast orientation for a Claude Code session.
2. **`PROJECT.md`** — full design context and rationale (the source of truth).
3. **`TODO.md`** — the live backlog: what's built + the **set.crawl** build plan.

## Run the game (modular client)
The live game is the modular TypeScript client under `src/` (engine + UI). Dev tooling
is build-time only — the shipped client is framework-free.
```
pnpm install
pnpm dev        # serve the app at http://localhost:5173/
pnpm test       # vitest (engine + data conformance)
pnpm typecheck  # tsc --noEmit
pnpm build      # -> dist/ (base-prefixed for the /set-core/ Pages subpath)
```
Live build: <https://oannes23.github.io/set-core/> (CI deploys `dist/` on push to `master`).

## Archived prototypes (the migration oracle)
The original single-file prototypes — `prototype/set-proto.html` (skill core + tuning
console) and `prototype/set-combat.html` (combat sandbox) — are **archived** under
`prototype/` (launcher at `prototype/index.html`). They were the behavioral oracle the
modular rebuild was diffed against; they run in any browser with no build step.

## Images
Diagnostic renders used during development — see `PROJECT.md` §10 for what each
one demonstrates.

## Repo layout
```
.
├── CLAUDE.md · PROJECT.md · GAME-DESIGN.md · CRAWL-DESIGN.md · TRAPS.md   # design docs
├── THEORYCRAFT.md                  # the whole design from first principles (historical tour)
├── TUNING.md                       # live engine constants (code is source of truth)
├── WRAPPERS.md                     # shipping decision: web + PWA (Tauri/Capacitor documented)
├── FABLE.md                        # 2026-06-09 full-repo review (bugs, risks, action list)
├── TODO.md                         # working backlog + the migration log (§A)
├── index.html                      # the modular client entry (Vite)
├── src/
│   ├── core/    # generation math (affine geometry, set-finding, RNG)
│   ├── data/    # typed game content (creatures/traps/dungeons/classes)
│   ├── engine/  # pure reduce(state,action) → {state,events}
│   └── ui/      # the client (board, HUD, abilities, coaching, polish)
├── prototype/   # ARCHIVED single-file prototypes (the migration oracle)
└── images/      # diagnostic renders (see PROJECT.md §10)
```
