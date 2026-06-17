# data/

Game content — authored as external **YAML** (the moddability source of truth), validated and
loaded through a typed registry. See `../../MODDING.md` for the full conversion plan.

## Layout

- `schema.ts` — the TS types for the token vocabulary + structures (traps, creatures, dungeons …).
  **The single source of truth for the content vocabulary.** Pure authoring-time checking; nothing
  at runtime. JSON Schemas are generated *from* this file.
- `content/*.yaml` — the actual content, one file per domain (`creatures`, `traps`, `drifts`,
  `variants`, `templates`, `dungeons`, `encounter`). **Edit these to add/change content.**
- `content/schema.json` — the whole-`GameData` JSON Schema (validation gate, used by `validate.ts`).
- `content/schemas/*.schema.json` — per-file JSON Schemas; each YAML file's `# yaml-language-server`
  header points at its one, giving **live autocomplete + inline validation** in editors (VS Code via
  the YAML extension).
- `game-data.ts` — a thin loader: imports the YAML, runs `registry.buildRegistry`, exports `GAMEDATA`
  (the unchanged public handle every engine/UI/test consumer imports).
- `registry.ts` — merge (mod-over-base by id) + referential link (`linkErrors`). **Pure TS, zero
  deps, runtime-safe** — the seam runtime user-mods will slot into.
- `validate.ts` — ajv schema validation. **Build/test-only** (imports ajv; never on the runtime path,
  so it's tree-shaken out and runtime deps stay empty).
- `classes.ts` — the 9 class loadouts (ability/passive ids). *(YAML conversion: MODDING.md Phase 1.)*

## Authoring workflow (no code needed)

1. Edit a `content/*.yaml` file. Your editor autocompletes fields + flags bad tokens (via `$schema`).
2. `pnpm test` — the round-trip + `registry` link + `validate` (ajv) checks run.
3. If you changed `schema.ts` (the vocabulary itself), run `pnpm gen:schema` to refresh the JSON
   Schemas; a drift guard test fails if you forget.

Adding a brand-new ability/passive/consumable *behavior* is NOT yet pure data — that needs the
effect-DSL (MODDING.md Phase 3). Everything in `content/` today is fully data-driven.
