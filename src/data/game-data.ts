/* data/game-data — the live GAMEDATA registry, assembled from external YAML content.
   ------------------------------------------------------------------------------------
   The content itself lives in per-domain YAML files under `content/` (creatures, traps, drifts,
   variants, templates, dungeons, encounter) — the moddability source of truth (MODDING.md). This
   module is now a thin LOADER: it imports those files (parsed to objects at build time by the Vite
   YAML plugin), then `buildRegistry` merges + referentially links them into a typed GameData.

   The public `GAMEDATA` export is UNCHANGED, so every engine/UI/test consumer keeps importing it
   from here. Shape/vocabulary validation against the schema is a build/test gate (data/validate.ts +
   the round-trip test), kept out of this runtime path so ajv never enters the shipped bundle.

   To add/edit content: edit the YAML (editor autocomplete via the `$schema` header), then
   `pnpm test` re-runs the link + schema validation. No code change needed. */

import type { GameData, Trap, Creature, Variant, Template, Dungeon, Encounter } from './schema'
import { buildRegistry } from './registry'
import traps from './content/traps.yaml'
import drifts from './content/drifts.yaml'
import creatures from './content/creatures.yaml'
import variants from './content/variants.yaml'
import templates from './content/templates.yaml'
import dungeons from './content/dungeons.yaml'
import encounter from './content/encounter.yaml'

// The YAML imports are typed `unknown` (untrusted-shaped); cast to the collection types here, then
// buildRegistry verifies referential integrity (and CI validates the schema). The single `base`
// source becomes a list of layers once runtime user-mods land.
export const GAMEDATA: GameData = buildRegistry([
  {
    id: 'base',
    data: {
      traps: traps as Record<string, Trap>,
      drifts: drifts as Record<string, Trap>,
      creatures: creatures as Record<string, Creature>,
      variants: variants as Record<string, Variant>,
      templates: templates as Record<string, Template>,
      dungeons: dungeons as Record<string, Dungeon>,
      encounter: encounter as Encounter,
    },
  },
])
