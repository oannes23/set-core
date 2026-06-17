/* data/validate — SCHEMA validation of content against the generated JSON Schemas (content/*.schema,
   derived from the TS types via `pnpm gen:schema`). Checks shape, the closed token vocabulary, the
   axis-correlated discriminated unions, and number/range structure.

   ⚠ BUILD/TEST-ONLY. This module imports `ajv`. It MUST NOT be imported by any runtime-reachable
   module (anything reachable from ui/app.ts) or ajv would be pulled into the shipped bundle and
   break the zero-runtime-dependency invariant (MODDING.md §0). Importers: tests + a build prebuild
   gate only. The runtime path uses registry.ts (link-only, zero-dep) instead.

   `makeValidator(schema)` is the reusable factory — one per content domain (GameData, classes, gear,
   loot, economy). Later (deferred runtime user-mod phase): ajv standalone mode compiles any of these
   schemas into a dependency-free JS validator we ship — so even runtime validation costs zero deps. */

import Ajv, { type ErrorObject } from 'ajv'
import type { GameData } from './schema'
import gameDataSchema from './content/schema.json'

export type ValidateResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] }

const fmt = (e: ErrorObject): string => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim()

/** Compile a JSON Schema into a validator. A fresh Ajv per schema avoids any cross-schema $id/def
 *  collisions between the per-domain schemas (all draft-07, local $refs). */
export function makeValidator<T>(schema: object): (obj: unknown) => ValidateResult<T> {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const validateFn = ajv.compile<T>(schema)
  return (obj: unknown): ValidateResult<T> =>
    validateFn(obj) ? { ok: true, data: obj as T } : { ok: false, errors: (validateFn.errors ?? []).map(fmt) }
}

/** Validate an untrusted content object against the whole-GameData schema. */
export const validateGameData = makeValidator<GameData>(gameDataSchema)
