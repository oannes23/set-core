/* data/classes — the playable classes (3 abilities + 1 passive each), chosen at run start.
   Ported verbatim from the prototype's CLASSES (set-combat.html). Pure content: each entry just
   references ability/passive ids resolved against the engine ABILITIES / PASSIVES registries
   (guarded by classes.test.ts). Stays YAML-portable like the rest of data/. */

import type { ClassDef } from './schema'

export const CLASSES: ClassDef[] = [
  { id: 'pyromancer', name: 'Pyromancer', icon: '🔥', blurb: 'Flood the board with fire and burn through anything.', abilities: ['firebolt', 'fireball', 'callflames'], passives: ['flameshield'] },
  { id: 'cryomancer', name: 'Cryomancer', icon: '❄️', blurb: "Freeze the enemy's tempo and grind them out.", abilities: ['frostbolt', 'glaciate', 'callfrost'], passives: ['permafrost'] },
  { id: 'druid', name: 'Druid', icon: '🌿', blurb: 'Outlast everything on relentless healing.', abilities: ['heal', 'wildgrowth', 'callwilds'], passives: ['photosynthesis'] },
  { id: 'berserker', name: 'Berserker', icon: '⚔️', blurb: 'Turn the whole board into blades, then swing.', abilities: ['cleave', 'berserk', 'rampage'], passives: ['bloodlust'] },
  { id: 'sentinel', name: 'Sentinel', icon: '🛡️', blurb: 'An immovable wall that wins by attrition.', abilities: ['bulwark', 'block', 'heal'], passives: ['overflow'] },
  { id: 'rogue', name: 'Rogue', icon: '🗡️', blurb: 'Spend Attacks for damage, flow back into Moves.', abilities: ['quickstrike', 'smokebomb', 'frostbolt'], passives: ['momentum'] },
  { id: 'spellblade', name: 'Spellblade', icon: '⚡', blurb: 'A caster whose every spell cuts twice.', abilities: ['firebolt', 'frostbolt', 'block'], passives: ['spellecho'] },
  { id: 'chronomancer', name: 'Chronomancer', icon: '⏳', blurb: 'Bend the enemy clock until it never strikes.', abilities: ['timewarp', 'glaciate', 'frostbolt'], passives: ['quicken'] },
  { id: 'warlord', name: 'Warlord', icon: '🎯', blurb: 'Fuel the Tactics meter and never stop acting.', abilities: ['berserk', 'bulwark', 'cleave'], passives: ['tactician'] },
]

export function classById(id: string): ClassDef {
  return CLASSES.find((c) => c.id === id) ?? CLASSES[0]
}
