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
  | 'center' | 'inner' | 'blast' | 'cross' | 'plus' | 'half' | 'random'
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
export interface StatMod {
  hp?: number
  damage?: number
  speed_band?: number // shift along the speed bands (+1 = faster)
}
export interface FoeRules {
  immune_card_damage?: boolean // set/Attack damage does nothing
  ability_damage?: 'mana_spent' // each ability cast drains the foe by the mana spent
}
export interface Creature {
  name: string
  tier: Tier
  hp: number
  speed: Speed
  damage: number
  desc?: string
  traps?: string[] // authored signature trap ids (bosses / special foes)
  variants?: string[] // variant ids to roll one from (minions / elites)
  rules?: FoeRules
  xp: number
  loot_tier: number
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
  boss_mirror?: string | null // trap id elites telegraph
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
}

export interface GameData {
  traps: Record<string, Trap>
  drifts: Record<string, Trap>
  speed: Record<SpeedBand, number>
  creatures: Record<string, Creature>
  variants: Record<string, Variant>
  templates: Record<string, Template>
  dungeons: Record<string, Dungeon>
  encounter: Encounter
}
