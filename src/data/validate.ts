/* data/validate — SCHEMA validation of content against the generated JSON Schema (content/schema.json,
   derived from schema.ts via `pnpm gen:schema`). Checks shape, the closed token vocabulary, the
   axis-correlated discriminated unions, and number/range structure.

   ⚠ BUILD/TEST-ONLY. This module imports `ajv`. It MUST NOT be imported by any runtime-reachable
   module (anything reachable from ui/app.ts) or ajv would be pulled into the shipped bundle and
   break the zero-runtime-dependency invariant (MODDING.md §0). Importers: tests + a build prebuild
   gate only. The runtime path uses registry.ts (link-only, zero-dep) instead.

   Later (deferred runtime user-mod phase): ajv standalone mode can compile this schema into a
   dependency-free JS validator we ship — so even runtime validation costs zero runtime deps. */

import Ajv, { type ErrorObject } from 'ajv'
import type { GameData } from './schema'
import schema from './content/schema.json'

const ajv = new Ajv({ allErrors: true, strict: false })
const validateFn = ajv.compile<GameData>(schema)

export type ValidateResult =
  | { ok: true; data: GameData }
  | { ok: false; errors: string[] }

const fmt = (e: ErrorObject): string => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim()

/** Validate an untrusted content object against the GameData schema. On success the input is the
 *  validated GameData (ajv mutates nothing relevant here). On failure, located ajv messages. */
export function validateGameData(obj: unknown): ValidateResult {
  if (validateFn(obj)) return { ok: true, data: obj }
  return { ok: false, errors: (validateFn.errors ?? []).map(fmt) }
}
