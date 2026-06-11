/* data/game-data — DECLARATIVE game content for set.combat / set.crawl, as a typed module.
   ------------------------------------------------------------------------------------------
   PORTABILITY CONTRACT (keep strict): pure JSON-shaped data — string tokens, plain nested
   objects/arrays, numbers, booleans. NO functions, NO computed values. JSON is a YAML subset,
   so this whole object transcribes mechanically to YAML when the server ingests content.

   Migration note: this is the typed successor to prototype/game-data.js. The migration is complete,
   so the two have INTENTIONALLY DIVERGED — this is the live source of truth and evolves past the
   archived prototype (new foes/elites, retuned dungeons). game-data.test.ts guards referential integrity. */

import type { GameData } from './schema'

export const GAMEDATA: GameData = {
  // --- enemy TRAPS: event -> condition -> effect (TRAPS.md). on: "match" | "tick" ---
  traps: {
    war_cry: {
      name: 'War Cry', icon: '🗣️', on: 'match', when: { axis: 'color', mode: 'all_same', value: 'red' },
      desc: 'all-red match → 30%: the enemy strikes at once',
      do: [{ effect: 'instant_attack', chance: 0.3 }],
    },
    spiked_hide: {
      name: 'Spiked Hide', icon: '🦔', on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'attack' },
      desc: 'all-Attack match → reflect 5 damage',
      do: [{ effect: 'damage', amount: 5 }],
    },
    plague: {
      name: 'Plague', icon: '☠️', on: 'match', when: { axis: 'color', mode: 'all_same', value: 'green' },
      desc: 'all-green match → enemy heals 5',
      do: [{ effect: 'enemy_heal', amount: 5 }],
    },
    vigilance: {
      name: 'Vigilance', icon: '👁️', on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'move' },
      desc: 'all-Move match → drain 4 Tactics',
      do: [{ effect: 'drain_tactics', amount: 4 }],
    },
    mana_sear: {
      name: 'Mana Sear', icon: '🔥', on: 'match', when: { axis: 'color', mode: 'all_same', value: 'red' },
      desc: 'all-red match → burn 3 Fire mana + 4 damage',
      do: [{ effect: 'drain_mana', color: 'red', amount: 3 }, { effect: 'damage', amount: 4 }],
    },

    // BOARD-VERB traps (TRAPS.md §5): reactive herding + a damage+geometry stack + a lock
    press_swarm: {
      name: 'Press the Swarm', icon: '🌀', on: 'match', when: { axis: 'color', mode: 'all_same', value: 'blue' },
      desc: 'all-blue match → warp 2 cards toward Fire (herding)',
      do: [{ effect: 'transmute', count: 2, select: { axis: 'color', mode: 'not_value', value: 'red' }, bias: { axis: 'color', value: 'red', intensity: 1 } }],
    },
    molten_veins: {
      name: 'Molten Veins', icon: '🌋', on: 'match', when: { axis: 'color', mode: 'all_same', value: 'red' },
      desc: 'all-red match → 4 dmg + warp the center column to Fire',
      do: [
        { effect: 'damage', amount: 4 },
        { effect: 'transmute', select: { geometry: 'column', which: 'center' }, bias: { axis: 'color', value: 'red', intensity: 1 } },
      ],
    },
    petrify: {
      name: 'Petrify', icon: '🗿', on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'move' },
      desc: 'all-Move match → lock 2 cards for 5s',
      do: [{ effect: 'lock', seconds: 5, select: { geometry: 'random', count: 2 } }],
    },

    // GENERALIST trap (all_different) + a DREAD tick — the boss role buckets
    confusion: {
      name: 'Confusion', icon: '💫', on: 'match', when: { axis: 'color', mode: 'all_different' },
      desc: 'rainbow (all-different colour) match → the foe quickens by the set\u2019s weight (1+2+3 → 2s · 3/3/3 → 5s)',
      do: [{ effect: 'advance_timer', scale: 'set_mag' }],
    },
    dread_drums: {
      name: 'Dread Drums', icon: '🥁', on: 'tick', every: 8,
      desc: 'every 8s: 3 unblockable dread damage',
      do: [{ effect: 'damage', amount: 3 }],
    },

    // TRAINING-DUMMY signature: a COMPOUND trigger (all-Move AND all-1s) + a sequenced board verb.
    limbless: {
      name: 'Limbless', icon: '🧟', on: 'match',
      when: { all: [{ axis: 'shape', mode: 'all_same', value: 'move' }, { axis: 'number', mode: 'all_same', value: 'one' }] },
      desc: 'all-Move + all-1s match → the zombie lurches: Moves in your bottom row lock 5s, then the row warps toward Move',
      do: [
        { effect: 'lock', seconds: 5, select: { geometry: 'row', which: 'bottom', axis: 'shape', mode: 'all_same', value: 'move' } },
        { effect: 'transmute', gap: 5000, select: { geometry: 'row', which: 'bottom' }, bias: { axis: 'shape', value: 'move', intensity: 2 } },
      ],
    },

    // TACTICS lesson — all carrot: channel useless Defend cards into Moves.
    tremor: {
      name: 'Tremor', icon: '🪨', on: 'tick', every: 12,
      desc: 'every 12s the ground quakes, rattling your useless shields loose into Moves',
      do: [{ effect: 'transmute', select: { axis: 'shape', mode: 'all_same', value: 'defend' }, bias: { axis: 'shape', value: 'move', intensity: 2 } }],
    },
    // the gentle NUDGE toward Moves: a Move set pushes the behemoth's attack back 5s (a "Slow").
    // A TRICK — favorable, aim for it (green), not a trap to avoid.
    outmaneuvered: {
      name: 'Outmaneuvered', icon: '🐢', kind: 'trick', on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'move' },
      desc: 'all-Move match → you dance aside; the behemoth lumbers after you, +5s before it can strike',
      do: [{ effect: 'delay_attack', seconds: 5 }],
    },

    // ABILITIES lesson: an INVERSE trap — melts wasted Attacks into Moves, feeding Tactics→mana→spells.
    ethereal_cackle: {
      name: 'Ethereal Cackle', icon: '😈', on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'attack' },
      desc: 'all-Attack match → he cackles at your flailing and melts every sword into a Move',
      do: [{ effect: 'transmute', select: { axis: 'shape', mode: 'all_same', value: 'attack' }, bias: { axis: 'shape', value: 'move', intensity: 2 } }],
    },

    // ELITE telegraphs (a weaker mirror of the boss's red theme) + a rare double-all-same boss-tier omen
    war_cry_lesser: {
      name: 'Lesser War Cry', icon: '🗣️', on: 'match', when: { axis: 'color', mode: 'all_same', value: 'red' },
      desc: 'all-red match → 30%: 5 damage (a foretaste of the King’s War Cry)',
      do: [{ effect: 'damage', chance: 0.3, amount: 5 }],
    },
    ember_sweep: {
      name: 'Ember Sweep', icon: '🌅', on: 'match', when: { axis: 'color', mode: 'all_same', value: 'red' },
      desc: 'all-red match → warp the bottom row toward Fire (an elite sweep)',
      do: [{ effect: 'transmute', select: { geometry: 'row', which: 'bottom' }, bias: { axis: 'color', value: 'red', intensity: 1 } }],
    },
    red_threes_omen: {
      name: 'Crimson Omen', icon: '🔱', on: 'match',
      when: { all: [{ axis: 'color', mode: 'all_same', value: 'red' }, { axis: 'number', mode: 'all_same', value: 'three' }] },
      desc: 'all-red + all-Threes match → 35%: the elite strikes at once',
      do: [{ effect: 'instant_attack', chance: 0.35 }],
    },
  },

  // --- dungeon DRIFTS: the global on:tick transmute that gives a dungeon its "feel" (TRAPS.md §7) ---
  drifts: {
    ember: {
      name: 'Ember Drift', icon: '🔥', on: 'tick', every: 7, quiet: true,
      desc: 'the board drifts toward Fire',
      do: [{ effect: 'transmute', count: 1, select: { axis: 'color', mode: 'not_value', value: 'red' }, bias: { axis: 'color', value: 'red', intensity: 1 } }],
    },
  },

  // --- SPEED bands → attack cadence in seconds (TRAPS.md §7.2; lower = more dangerous) ---
  speed: { lumbering: 20, slow: 15, steady: 12, swift: 10, frenzied: 8 },

  // --- CREATURES: stat baseline + a variant pool (minion/elite) OR authored traps (boss) ---
  creatures: {
    // TUTORIAL DUMMY: 0 damage, no trap — pressure-free practice for the guided intro (numeric speed = 30s cadence).
    training_dummy: {
      name: 'Training Dummy', tier: 'minion', hp: 120, speed: 30, damage: 0,
      desc: 'A straw-stuffed practice dummy on a creaky pivot. It cannot hurt you — take all the time you need to learn the ropes.',
      traps: [], variants: [], xp: 0, loot_tier: 0,
    },
    limbless_zombie: {
      name: 'Limbless Zombie', tier: 'minion', hp: 30, speed: 'lumbering', damage: 3,
      desc: 'A zombie with no limbs, chin-crawling across the floor toward you. Harmless — until it gathers itself for a sudden lurch.',
      voice: { hit: ['gnaws at', 'claws at', 'paws at'], zero: 'flops against you, harmless' },
      traps: ['limbless'], variants: [], xp: 5, loot_tier: 1,
    },
    dread_behemoth: {
      name: 'Dread Behemoth', tier: 'elite', hp: 50, speed: 120, damage: 100,
      desc: 'A mountain that walks. Its blow is <b>certain death</b>, so blocking is futile — but it is <i>ponderously</i> slow. Its tremors shake your useless <b>Defend</b> cards loose into <b>Moves</b>; spend a <b>Move</b> set and you dance aside, leaving it a step behind. Stay mobile, bank <b>Tactics</b>, and break it with a decisive strike.',
      voice: { hit: ['hammers', 'crushes down on', 'flattens'], zero: 'misses — its bulk too slow' },
      traps: ['tremor', 'outmaneuvered'], variants: [], xp: 30, loot_tier: 3,
    },
    unstable_ethereal_goblin: {
      name: 'Unstable Ethereal Goblin', tier: 'minion', hp: 15, speed: 'steady', damage: 6,
      desc: 'A goblin who gulped a Potion of Etherealness <i>and</i> a Potion of Polymorph at once — now a flickering wisp of raw magic. <b>Swords pass right through him</b> (Attack cards deal no damage). Only <b>magic</b> bites: every <b>ability</b> you cast drains him by the <b>mana you spent</b>. Spend 15 mana of spells to dispel him.',
      rules: { immune_card_damage: true, ability_damage: 'mana_spent' },
      voice: { hit: ['flickers through', 'phases into', 'wisps across'], heal: ['reknits from mist'], zero: 'shimmers past you' },
      traps: ['ethereal_cackle'], variants: [], xp: 25, loot_tier: 3,
    },
    goblin: {
      name: 'Goblin', tier: 'minion', hp: 20, speed: 'swift', damage: 10,
      variants: ['bloodthirsty', 'sneaky', 'cowardly', 'grasping'], xp: 10, loot_tier: 2,
    },
    cave_bat: {
      name: 'Cave Bat', tier: 'minion', hp: 14, speed: 'frenzied', damage: 6,
      variants: ['sneaky', 'elusive'], xp: 8, loot_tier: 1,
    },
    goblin_shaman: {
      name: 'Goblin Shaman', tier: 'minion', hp: 18, speed: 'slow', damage: 8,
      variants: ['plagued', 'hexer', 'covetous'], xp: 12, loot_tier: 2,
    },
    goblin_brute: {
      name: 'Goblin Brute', tier: 'elite', hp: 38, speed: 'steady', damage: 13,
      variants: ['bloodthirsty', 'cruel', 'grasping'], xp: 26, loot_tier: 3,
    },
    goblin_king: {
      name: 'The Goblin King', tier: 'boss', hp: 90, speed: 'steady', damage: 16,
      // war_cry is the SIGNATURE the elites' Lesser War Cry foretells; the other three are the
      // §7 role buckets (specialist molten_veins / generalist confusion / tick-dread dread_drums)
      traps: ['war_cry', 'molten_veins', 'confusion', 'dread_drums'], xp: 120, loot_tier: 5,
    },

    // --- goblin_warren build-out: more minions + a proper elite roster (each elite = telegraph + rolled) ---
    goblin_archer: {
      name: 'Goblin Archer', tier: 'minion', hp: 16, speed: 'steady', damage: 9,
      desc: 'A wiry goblin loosing crude arrows from a ledge — quick to panic, quicker to flee.',
      voice: { hit: ['looses an arrow at', 'pelts', 'nicks'], zero: 'misses wide' },
      variants: ['frenetic', 'cowardly'], xp: 11, loot_tier: 2,
    },
    goblin_sapper: {
      name: 'Goblin Sapper', tier: 'minion', hp: 22, speed: 'slow', damage: 8,
      desc: 'A grubby goblin lugging fire-bombs — more dangerous to your board than to you.',
      voice: { hit: ['lobs a bomb at', 'scorches', 'singes'], zero: 'fumbles the fuse' },
      variants: ['firebrand', 'greedy'], xp: 12, loot_tier: 2,
    },
    warren_rat: {
      name: 'Warren Rat', tier: 'minion', hp: 12, speed: 'frenzied', damage: 5,
      desc: 'A fat, fearless rat the size of a dog. It comes in a chittering rush.',
      voice: { hit: ['bites', 'gnaws', 'scratches'], zero: 'squeaks and recoils' },
      variants: ['nimble', 'sneaky'], xp: 7, loot_tier: 1,
    },
    goblin_warlord: {
      name: 'Goblin Warlord', tier: 'elite', hp: 42, speed: 'steady', damage: 14,
      desc: 'A scarred captain in looted plate, bellowing the King’s own war-cry. His red rage foretells the throne room.',
      voice: { hit: ['cleaves', 'bludgeons', 'smashes'], zero: 'swings wide, roaring' },
      traps: ['war_cry_lesser'], variants: ['bloodthirsty', 'cruel'], xp: 28, loot_tier: 3,
    },
    ember_shaman: {
      name: 'Ember Shaman', tier: 'elite', hp: 36, speed: 'slow', damage: 11,
      desc: 'A goblin mystic wreathed in cinders, dragging whole rows of your runes into the fire — the warren’s drift made a weapon.',
      voice: { hit: ['scorches', 'immolates', 'sears'], heal: ['draws strength from the embers'], zero: 'fizzles out' },
      traps: ['ember_sweep'], variants: ['scorched', 'hexer'], xp: 30, loot_tier: 3,
    },
    warren_butcher: {
      name: 'The Warren Butcher', tier: 'elite', hp: 50, speed: 'lumbering', damage: 18,
      desc: 'A hulking goblin gone to fat and cruelty, a cleaver in each hand. Slow, but every red blow lands like the King’s.',
      voice: { hit: ['hacks', 'butchers', 'rends'], zero: 'is too slow, just missing' },
      traps: ['war_cry_lesser'], variants: ['cruel', 'greedy', 'covetous'], xp: 34, loot_tier: 4,
    },
    goblin_oracle: {
      name: 'Goblin Oracle', tier: 'elite', hp: 38, speed: 'swift', damage: 12,
      desc: 'A wild-eyed seer who reads doom in the runes — crimson and threefold, and the strike comes at once.',
      voice: { hit: ['hexes', 'curses', 'blights'], zero: 'mutters, the omen unbroken' },
      traps: ['red_threes_omen'], variants: ['nimble', 'plagued'], xp: 30, loot_tier: 3,
    },
  },

  // --- VARIANTS: an adjective = a themed trap (+ optional stat tweak). Rolled from the creature. ---
  variants: {
    bloodthirsty: {
      name: 'Bloodthirsty', icon: '🩸', desc: 'all-red → 50%: 6 dmg + warp a Defend to Fire',
      trap: { on: 'match', when: { axis: 'color', mode: 'all_same', value: 'red' }, do: [{ effect: 'damage', chance: 0.5, amount: 6 }, { effect: 'transmute', count: 1, select: { axis: 'shape', mode: 'all_same', value: 'defend' }, bias: { axis: 'color', value: 'red', intensity: 1 } }] },
    },
    sneaky: {
      name: 'Sneaky', icon: '🌑', desc: 'all-Move → 25%: strikes at once', stat_mod: { speed_band: 1 },
      trap: { on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'move' }, do: [{ effect: 'instant_attack', chance: 0.25 }] },
    },
    cowardly: {
      name: 'Cowardly', icon: '😰', desc: 'all-Attack → panics, strikes 4s sooner', stat_mod: { hp: -6, damage: -2 },
      trap: { on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'attack' }, do: [{ effect: 'advance_timer', seconds: 4 }] },
    },
    elusive: {
      name: 'Elusive', icon: '💨', desc: 'all-Move → lock 1 card 4s', stat_mod: { speed_band: 1 },
      trap: { on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'move' }, do: [{ effect: 'lock', seconds: 4, select: { geometry: 'random', count: 1 } }] },
    },
    plagued: {
      name: 'Plagued', icon: '☠️', desc: 'all-green → enemy heals 5',
      trap: { on: 'match', when: { axis: 'color', mode: 'all_same', value: 'green' }, do: [{ effect: 'enemy_heal', amount: 5 }] },
    },
    hexer: {
      name: 'Hexer', icon: '🔮', desc: 'all-blue → burn 3 Frost mana', stat_mod: { hp: 4 },
      trap: { on: 'match', when: { axis: 'color', mode: 'all_same', value: 'blue' }, do: [{ effect: 'drain_mana', color: 'blue', amount: 3 }] },
    },
    cruel: {
      name: 'Cruel', icon: '🔪', desc: 'all-Attack → reflect 6', stat_mod: { damage: 2 },
      trap: { on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'attack' }, do: [{ effect: 'damage', amount: 6 }] },
    },
    // magnitude TOLLS — heavy (all-3s) sets pay a small constant tax, never a spike: greed is a grind
    grasping: {
      name: 'Grasping', icon: '🪤', desc: 'all-3s match → it snatches at your spoils: strikes 2s sooner',
      trap: { on: 'match', when: { axis: 'number', mode: 'all_same', value: 'three' }, do: [{ effect: 'advance_timer', seconds: 2 }] },
    },
    covetous: {
      name: 'Covetous', icon: '🧲', desc: 'all-3s match → it plucks your heaviest rune from the board',
      trap: { on: 'match', when: { axis: 'number', mode: 'all_same', value: 'three' }, do: [{ effect: 'transmute', count: 1, select: { pick: 'highest_mag' } }] },
    },
    nimble: {
      name: 'Nimble', icon: '🦶', desc: 'all-Move → drain 3 Tactics', stat_mod: { speed_band: 1 },
      trap: { on: 'match', when: { axis: 'shape', mode: 'all_same', value: 'move' }, do: [{ effect: 'drain_tactics', amount: 3 }] },
    },
    frenetic: {
      name: 'Frenetic', icon: '⚡', desc: 'rainbow colour → strikes 2s sooner',
      trap: { on: 'match', when: { axis: 'color', mode: 'all_different' }, do: [{ effect: 'advance_timer', seconds: 2 }] },
    },
    greedy: {
      name: 'Greedy', icon: '🪙', desc: 'all-red → lock 1 card 4s', stat_mod: { hp: 3 },
      trap: { on: 'match', when: { axis: 'color', mode: 'all_same', value: 'red' }, do: [{ effect: 'lock', seconds: 4, select: { geometry: 'random', count: 1 } }] },
    },
    firebrand: {
      name: 'Firebrand', icon: '🔥', desc: 'all-blue → warp 1 non-red card toward Fire',
      trap: { on: 'match', when: { axis: 'color', mode: 'all_same', value: 'blue' }, do: [{ effect: 'transmute', count: 1, select: { axis: 'color', mode: 'not_value', value: 'red' }, bias: { axis: 'color', value: 'red', intensity: 1 } }] },
    },
    scorched: {
      name: 'Scorched', icon: '🌶️', desc: 'all-red → burn 3 Fire mana', stat_mod: { damage: 1 },
      trap: { on: 'match', when: { axis: 'color', mode: 'all_same', value: 'red' }, do: [{ effect: 'drain_mana', color: 'red', amount: 3 }] },
    },
  },

  // --- TEMPLATES: a dungeon-global overlay stacked on EVERY foe (one-knob harder dungeon) ---
  templates: {
    undead: {
      name: 'Undead', icon: '💀', desc: 'regenerates 3 HP every 7s', stat_mod: { hp: 8, speed_band: -1 },
      trap: { on: 'tick', every: 7, quiet: true, do: [{ effect: 'enemy_heal', amount: 3 }] },
    },
  },

  // --- DUNGEONS: theme + drift + weighted enemy table + elite pool + boss (+ optional template) ---
  dungeons: {
    // GUIDED INTRO: the DEFAULT room — guided walkthrough vs the harmless Training Dummy.
    tutorial: {
      name: 'Tutorial · Guided Intro', difficulty: 0, coach: true, guided: true,
      theme: null, drift: null, boss_mirror: null, default_foe: 'training_dummy',
      enemy_table: [{ foe: 'training_dummy', weight: 100 }],
      elite_pool: [], boss: null, template: null,
    },
    // TRAINING: a planned GAUNTLET — a fixed sequence teaching traps → tactics → abilities.
    training: {
      name: 'Training · Gauntlet', difficulty: 0, coach: true,
      theme: null, drift: null, boss_mirror: null,
      sequence: ['limbless_zombie', 'dread_behemoth', 'unstable_ethereal_goblin'],
      enemy_table: [{ foe: 'limbless_zombie', weight: 1 }, { foe: 'dread_behemoth', weight: 1 }, { foe: 'unstable_ethereal_goblin', weight: 1 }],
      elite_pool: [], boss: null, template: null,
    },
    goblin_warren: {
      name: 'The Goblin Warren', difficulty: 1,
      theme: { axis: 'color', value: 'red' }, drift: 'ember', boss_mirror: 'war_cry_lesser',
      enemy_table: [{ foe: 'goblin', weight: 35 }, { foe: 'cave_bat', weight: 20 }, { foe: 'goblin_shaman', weight: 15 }, { foe: 'goblin_archer', weight: 12 }, { foe: 'goblin_sapper', weight: 10 }, { foe: 'warren_rat', weight: 8 }],
      elite_pool: ['goblin_warlord', 'ember_shaman', 'warren_butcher', 'goblin_oracle'], boss: 'goblin_king', template: null,
    },
    haunted_warren: {
      name: 'The Haunted Warren', difficulty: 3, extends: 'goblin_warren',
      theme: { axis: 'color', value: 'red' }, drift: 'ember', boss_mirror: 'war_cry_lesser',
      enemy_table: [{ foe: 'goblin', weight: 35 }, { foe: 'cave_bat', weight: 20 }, { foe: 'goblin_shaman', weight: 15 }, { foe: 'goblin_archer', weight: 12 }, { foe: 'goblin_sapper', weight: 10 }, { foe: 'warren_rat', weight: 8 }],
      elite_pool: ['goblin_warlord', 'ember_shaman', 'warren_butcher', 'goblin_oracle'], boss: 'goblin_king', template: 'undead',
    },
  },

  // --- the active sandbox encounter — the "Custom (sliders)" fallback foe's traps/drift ---
  encounter: {
    traps: ['molten_veins', 'spiked_hide', 'petrify'],
    drift: 'ember',
  },
}
