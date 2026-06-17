# SET.crawl — docs wiki

Player/modder-facing reference for **SET.crawl**. All game content lives in external YAML under
`src/data/content/`; this wiki explains every configurable option. For the *why* behind the design,
see the root design docs (`PROJECT.md`, `GAME-DESIGN.md`, `CRAWL-DESIGN.md`, `TRAPS.md`); for the
conversion plan + architecture, see `MODDING.md`.

## Pages

- **[Glossary](glossary.md)** — the vocabulary: Set geometry, the board verbs, combat terms, the
  economy/progression terms.
- **[YAML: content registry](yaml-content.md)** — creatures, variants, templates, traps/tricks,
  drifts, dungeons, the sandbox encounter — plus the shared **trigger vocabulary** (conditions,
  effects, selectors, biases) that traps and tricks are built from.
- **[YAML: catalogs](yaml-catalogs.md)** — classes, gear base types, and affixes (incl. the affix
  **magnitude DSL**).
- **[YAML: tuning](yaml-tuning.md)** — loot, economy, progression, delve dials.

## Modding quickstart

1. **Edit a file** under `src/data/content/` (e.g. `creatures.yaml`). Each file carries a
   `# yaml-language-server: $schema=…` header, so an editor with the YAML extension (VS Code) gives
   **live autocomplete, hover docs, and inline validation** of every field + token.
2. **Run the checks:** `pnpm test`. The suite validates each file against its JSON Schema (shape +
   the closed token vocabulary), link-checks cross-references (every `foe`/`trap`/`variant`/`boss`
   id resolves), and round-trips the core registry. Malformed content fails loudly with a located
   message.
3. **Reference by id.** Content cross-references by string id (a dungeon's `enemy_table` names
   `creatures`; a creature's `traps` name `traps`; a class's `abilities` name engine abilities).
   Add the thing you reference, or the link-check rejects it.

## What is *not* YAML-authorable (yet)

New **ability / passive / consumable behavior** still lives in code (`src/engine/abilities.ts`,
`passives.ts`, `consumables.ts`): their effects are TypeScript closures. You can retune existing ones
in code and reference them by id from YAML (classes pick ability/passive ids), but authoring a
*brand-new* behavior needs the **effect-DSL** (MODDING.md Phase 3, not yet built). Everything else —
monsters, traps, dungeons, gear, affixes (incl. magnitudes), loot, economy, progression, delve — is
pure YAML.

## How the pipeline works (one paragraph)

YAML is parsed to plain objects **at build time** by a Vite plugin (a devDependency — it never ships
to the runtime bundle). A loader module per domain imports the object, an optional registry merges +
link-checks it, and the typed result feeds the engine. Schema validation (ajv) and the JSON-Schema
generation (`pnpm gen:schema`, derived from the TypeScript types in `src/data/schema.ts`) run only in
tests and tooling. The shipped game has **zero runtime dependencies**.
