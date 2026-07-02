/* data/schema — types for the declarative game content (TRAPS.md / CRAWL-DESIGN.md vocabulary).
   The data stays PURE JSON-shaped string tokens (red / attack / all_same / column …) so it
   transcribes mechanically to YAML for the eventual server (PORTABILITY CONTRACT). These types add
   nothing at runtime — they just make the token vocabulary and structure type-checked at authoring
   time, turning a class of "typo / dangling reference" runtime bugs into compile errors. */

// ---- token vocabulary ----
export type Axis = 'color' | 'shape' | 'number'
export type ColorTok = 'red' | 'green' | 'blue' // Fire / Nature / Frost
export type ShapeTok = 'attack' | 'defend' | 'move'
export type NumberTok = 'one' | 'two' | 'three'
export type ValueTok = ColorTok | ShapeTok | NumberTok
export type Mode = 'all_same' | 'all_different' | 'contains' | 'not_value'
export type Geometry =
  | 'row' | 'column' | 'diagonal' | 'corners' | 'border'
  | 'center' | 'inner' | 'half' | 'random'
// NOTE: 'blast' | 'cross' | 'plus' were dropped 2026-06-17 — they were in the union but had no case
// in geometrySlots (triggers.ts), so authored content using them silently selected nothing. Re-add
// them here only alongside a real center-anchored implementation + tests (the Fireball ABILITY uses a
// separate offset footprint, select.ts FIREBALL_BLAST — not this region-selector path).
export type Which = 'top' | 'bottom' | 'left' | 'right' | 'center' | 'anti'
export type On = 'match' | 'tick'
export type Tier = 'minion' | 'elite' | 'boss'
/** Valence of a reactive trigger: a Trap is hostile (avoid, yellow); a Trick is favorable
 *  (aim for, green). Same mechanism (condition → effects); only valence + presentation differ.
 *  Default when omitted is 'trap'. */
export type TriggerKind = 'trap' | 'trick'
export type SpeedBand = 'lumbering' | 'slow' | 'steady' | 'swift' | 'frenzied'
/** A creature's speed: a named band OR a raw cadence in seconds (e.g. 30, 120). */
export type Speed = SpeedBand | number

// ---- trigger condition (`when`). axis-correlated so e.g. {axis:'color', value:'move'} is an error ----
export type SimpleCondition =
  | { axis: 'color'; mode: Mode; value?: ColorTok }
  | { axis: 'shape'; mode: Mode; value?: ShapeTok }
  | { axis: 'number'; mode: Mode; value?: NumberTok }
/** Compound AND of simple conditions (e.g. all-Move AND all-1s — the Limbless trigger). */
export interface CompoundCondition {
  all: SimpleCondition[]
}
export type Condition = SimpleCondition | CompoundCondition

// ---- selector (`select`): a spatial region and/or a value filter ----
export interface Selector {
  geometry?: Geometry
  which?: Which
  index?: number
  center?: number
  count?: number
  axis?: Axis
  mode?: Mode
  value?: ValueTok
  pick?: 'highest_mag'
}

// ---- regen bias (transmute target). axis-correlated like Condition ----
export type Bias =
  | { axis: 'color'; value: ColorTok; intensity?: number }
  | { axis: 'shape'; value: ShapeTok; intensity?: number }
  | { axis: 'number'; value: NumberTok; intensity?: number }

// ---- effects (engine TRAP_EFFECTS). One flat shape; the engine reads the fields each effect uses ----
export type EffectName =
  | 'damage' | 'instant_attack' | 'advance_timer' | 'delay_attack'
  | 'enemy_heal' | 'drain_tactics' | 'drain_mana' | 'transmute' | 'lock'
export interface Effect {
  effect: EffectName
  chance?: number // gate: only fires with this probability
  amount?: number
  max?: number
  seconds?: number
  color?: ColorTok // drain_mana target
  count?: number // cap for value/random selects
  select?: Selector
  bias?: Bias
  gap?: number // transmute: hold slots empty this long before reforming (ms)
  /** severity scaled by the springing set's TOTAL magnitude: max(1, total − 4) — a modest 1+2+3
   *  rainbow pays the mild price, a greedy 3/3/3 pays for its weight (damage / advance_timer). */
  scale?: 'set_mag'
}

// ---- traps & drifts ----
export interface Trap {
  name: string
  icon?: string
  kind?: TriggerKind // 'trap' (hostile, default) | 'trick' (favorable — aim for it)
  on: On
  when?: Condition
  every?: number // on:'tick' cadence (seconds)
  quiet?: boolean // ambient (drift) — fires without a "sprung trap" flourish
  desc?: string
  do: Effect[]
}
/** Forward-looking umbrella name. A trap and a trick are one mechanism differing only by `kind`;
 *  the data collection stays `traps` until the prototype retires (then it can become `triggers`). */
export type Trigger = Trap
/** A trap authored inline on a variant/template (carries no name/icon of its own). */
export interface InlineTrap {
  on: On
  when?: Condition
  every?: number
  quiet?: boolean
  do: Effect[]
}

// ---- creatures, variants, templates ----
/** A foe's contest statline — the other side of every resolve.ts contest. Authored directly
 *  against the parity line `10 + 2(L−1)` (CRAWL §3 / TUNING.md): warren = fresh L3 → ~14, with
 *  role spreads (swift −2P/+5S · steady · heavy +2P/−5S · giant +4P/−9S) and per-tier E bumps
 *  (elite +4 / boss +8) baked into the numbers — no automatic tier bump at assembly. */
export interface CreatureStats {
  power: number
  endurance: number
  speed: number
}
/** Variant/template stat deltas (added to the base statline). Replaced the legacy hp/damage/
 *  speed_band mods in the data rebase. */
export interface StatMod {
  power?: number
  endurance?: number
  speed?: number
  hp?: number
}
/** Override the tempo law's S−P packaging (else strikeEvery/swings derive from the statline). */
export interface TempoOverride {
  strikeEvery: number
  swings: number
}
export interface FoeRules {
  immune_card_damage?: boolean // set/Attack damage does nothing
  ability_damage?: 'mana_spent' // each ability cast drains the foe by the mana spent
}
/** Combat-log voice: swappable verbs so a foe reads in character (the zombie gnaws, the behemoth booms).
 *  Pure flavour — the UI's combat log consumes it; absent fields fall back to a neutral default. */
export interface Voice {
  hit?: string[] // "the X <hit> you" — e.g. ['claws at', 'gnaws']
  heal?: string[] // "the X <heal>" — e.g. ['festers whole']
  zero?: string // the harmless-attack lead — e.g. 'flops against you'
}
export interface Creature {
  name: string
  tier: Tier
  stats: CreatureStats // authored P/E/S — the contest's other side (the data rebase, 2026-06-12)
  hp: number // max HP for this encounter — the kill-budget lever (~60 minion / 110 elite / 200 boss)
  tempo?: TempoOverride // override the S−P packaging (else derived from the statline)
  desc?: string
  voice?: Voice // combat-log character (optional; neutral default otherwise)
  traps?: string[] // authored signature trap ids (bosses / special foes)
  variants?: string[] // variant ids to roll one from (minions / elites)
  rules?: FoeRules
  loot_tier: number
  xp?: number // TEACHING-FOE override only — real foes compute XP from the statline (foe.ts computeXP).
  // The dummy (Power 0) and the gauntlet are authored for the onboarding curve (dummy→L2, gauntlet→L3).
  // RETIRED in the rebase: speed (band), damage (→ telegraph contest), windup (→ deal reveal).
}
export interface Variant {
  name: string
  icon?: string
  desc?: string
  stat_mod?: StatMod
  trap: InlineTrap
}
export interface Template {
  name: string
  icon?: string
  desc?: string
  stat_mod?: StatMod
  trap: InlineTrap
}

// ---- dungeons ----
export interface Theme {
  axis: Axis
  value: ValueTok
}
export interface EnemyTableEntry {
  foe: string
  weight: number
}
export interface Dungeon {
  name: string
  difficulty: number
  coach?: boolean // arm the new-player affordance layer
  guided?: boolean // launch the staged guided-intro walkthrough on Engage
  theme?: Theme | null
  drift?: string | null // drift id
  boss_mirror?: string | null // lesser-echo trap id EVERY elite carries (attaches atop authored traps, deduped)
  default_foe?: string // creature id pre-selected in the picker
  sequence?: string[] // creature ids fought in a row (gauntlet)
  enemy_table: EnemyTableEntry[]
  elite_pool: string[]
  boss?: string | null
  template?: string | null
  extends?: string // dungeon id this one is derived from (authoring note)
}

export interface Encounter {
  traps: string[]
  drift: string
}

/** A playable class: a presentation shell over a loadout of ability + passive ids (resolved against
 *  the engine ABILITIES / PASSIVES registries). Pure content — chosen at run start. */
export interface ClassDef {
  id: string
  name: string
  icon: string
  blurb: string
  abilities: string[] // ability ids (3) drawn into the active loadout
  passives: string[] // passive id(s) — always-on
  /** Resolution v3 statline (Power/Endurance/Speed); omitted = BASE_STATS 10/10/10 parity (the decimal rebase).
   *  A future class-identity lever — ship uniform first, differentiate with gear/levels (B3+). */
  stats?: { power: number; endurance: number; speed: number }
}

export interface GameData {
  traps: Record<string, Trap>
  drifts: Record<string, Trap>
  creatures: Record<string, Creature>
  variants: Record<string, Variant>
  templates: Record<string, Template>
  dungeons: Record<string, Dungeon>
  encounter: Encounter
}

// ---- per-file content roots (one per YAML file under content/) ----
// Each YAML content file's top level is one of these. They exist so `gen:schema` can emit a JSON
// Schema per file, which the `# yaml-language-server: $schema=…` header points at — giving content
// authors live autocomplete + inline validation in-editor. Same shapes as GameData's collections.
export type TrapsFile = Record<string, Trap>
export type DriftsFile = Record<string, Trap>
export type CreaturesFile = Record<string, Creature>
export type VariantsFile = Record<string, Variant>
export type TemplatesFile = Record<string, Template>
export type DungeonsFile = Record<string, Dungeon>
export type EncounterFile = Encounter
/** content/classes.yaml — the playable-class roster (a list, not a keyed map). */
export type ClassesFile = ClassDef[]
