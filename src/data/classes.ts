/* data/classes — the playable classes (3 abilities + 1 passive each), chosen at run start.
   Content now lives in content/classes.yaml (the moddability source of truth, MODDING.md Phase 1);
   each entry references ability/passive ids resolved against the engine ABILITIES / PASSIVES
   registries (referential integrity guarded by classes.test.ts; shape by the schema validator). */

import type { ClassDef, ClassesFile } from './schema'
import classesData from './content/classes.yaml'

export const CLASSES: ClassDef[] = classesData as ClassesFile

export function classById(id: string): ClassDef {
  return CLASSES.find((c) => c.id === id) ?? CLASSES[0]
}
