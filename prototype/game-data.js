/* ============================================================
   game-data.js  —  DECLARATIVE game content for SET.combat / SET.crawl
   ------------------------------------------------------------
   Loaded as a CLASSIC script BEFORE the engine (set-combat.html);
   exposes window.GAMEDATA. The engine normalizes string tokens ->
   internal enums at load (loadTraps / TOKEN).

   PORTABILITY CONTRACT (keep this strict):
     This object is PURE JSON-shaped data — string tokens, plain
     nested objects/arrays, numbers, booleans. NO functions, NO JS
     constants (use "red"/"attack"/"all_same"/"column", never
     COLOR_RED / SHAPE_ATTACK). JSON is a YAML subset, so this whole
     file transcribes mechanically to YAML when the real game's
     server ingests content (see CRAWL-DESIGN.md §4). Scripted
     abilities/passives live in the engine, not here.

   TOKEN VOCABULARY (engine resolves these):
     axis:   "color" | "shape" | "number"
     color:  "red" | "green" | "blue"        (Fire / Nature / Frost)
     shape:  "attack" | "defend" | "move"
     number: "one" | "two" | "three"         (magnitude)
     mode:   "all_same" | "all_different" | "contains" | "not_value"
     geometry: "row" | "column" | "diagonal" | "corners" | "border"
             | "center" | "blast" | "cross" | "half" | "random"
   EFFECTS (engine TRAP_EFFECTS): damage · instant_attack ·
     advance_timer · enemy_heal · drain_tactics · drain_mana ·
     transmute · lock
   ============================================================ */
window.GAMEDATA = {

  // --- enemy TRAPS: event -> condition -> effect (TRAPS.md). on: "match" | "tick" ---
  traps: {
    war_cry:     { name:"War Cry",        icon:"🗣️", on:"match", when:{axis:"color", mode:"all_same", value:"red"},
                   desc:"all-red match → 30%: the enemy strikes at once",
                   do:[ {effect:"instant_attack", chance:0.30} ] },
    spiked_hide: { name:"Spiked Hide",    icon:"🦔", on:"match", when:{axis:"shape", mode:"all_same", value:"attack"},
                   desc:"all-Attack match → reflect 5 damage",
                   do:[ {effect:"damage", amount:5} ] },
    plague:      { name:"Plague",         icon:"☠️", on:"match", when:{axis:"color", mode:"all_same", value:"green"},
                   desc:"all-green match → enemy heals 5",
                   do:[ {effect:"enemy_heal", amount:5} ] },
    vigilance:   { name:"Vigilance",      icon:"👁️", on:"match", when:{axis:"shape", mode:"all_same", value:"move"},
                   desc:"all-Move match → drain 4 Tactics",
                   do:[ {effect:"drain_tactics", amount:4} ] },
    mana_sear:   { name:"Mana Sear",      icon:"🔥", on:"match", when:{axis:"color", mode:"all_same", value:"red"},
                   desc:"all-red match → burn 3 Fire mana + 4 damage",
                   do:[ {effect:"drain_mana", color:"red", amount:3}, {effect:"damage", amount:4} ] },

    // BOARD-VERB traps (TRAPS.md §5): reactive herding + a damage+geometry stack + a lock
    press_swarm: { name:"Press the Swarm", icon:"🌀", on:"match", when:{axis:"color", mode:"all_same", value:"blue"},
                   desc:"all-blue match → warp 2 cards toward Fire (herding)",
                   do:[ {effect:"transmute", count:2,
                         select:{axis:"color", mode:"not_value", value:"red"},
                         bias:{axis:"color", value:"red", intensity:1}} ] },
    molten_veins:{ name:"Molten Veins",   icon:"🌋", on:"match", when:{axis:"color", mode:"all_same", value:"red"},
                   desc:"all-red match → 4 dmg + warp the center column to Fire",
                   do:[ {effect:"damage", amount:4},
                        {effect:"transmute",
                         select:{geometry:"column", which:"center"},
                         bias:{axis:"color", value:"red", intensity:1}} ] },
    petrify:     { name:"Petrify",        icon:"🗿", on:"match", when:{axis:"shape", mode:"all_same", value:"move"},
                   desc:"all-Move match → lock 2 cards for 5s",
                   do:[ {effect:"lock", seconds:5, select:{geometry:"random", count:2}} ] },

    // GENERALIST trap (all_different = punishes spread play) + a DREAD tick — the boss role buckets
    confusion:   { name:"Confusion",      icon:"💫", on:"match", when:{axis:"color", mode:"all_different"},
                   desc:"rainbow (all-different colour) match → enemy speeds up 2s",
                   do:[ {effect:"advance_timer", seconds:2} ] },
    dread_drums: { name:"Dread Drums",    icon:"🥁", on:"tick", every:8,
                   desc:"every 8s: 3 unblockable dread damage",
                   do:[ {effect:"damage", amount:3} ] },

    // TRAINING-DUMMY signature: a COMPOUND trigger (all-Move AND all-1s) + a sequenced board verb.
    // Locks the bottom-row cards that were ALREADY Move (fires first, so transmute skips them),
    // then warps the rest of the bottom row toward Move. The lurch of a limbless zombie.
    limbless:    { name:"Limbless",       icon:"🧟", on:"match",
                   when:{ all:[ {axis:"shape",  mode:"all_same", value:"move"},
                                {axis:"number", mode:"all_same", value:"one"} ] },
                   desc:"all-Move + all-1s match → the zombie lurches: Moves in your bottom row lock 5s, then the row warps toward Move",
                   do:[ {effect:"lock", seconds:5,
                         select:{geometry:"row", which:"bottom", axis:"shape", mode:"all_same", value:"move"}},
                        {effect:"transmute", gap:5000,    // knocked down: the row stays EMPTY for the 5s lock, then you "get up" — Moves reform
                         select:{geometry:"row", which:"bottom"},
                         bias:{axis:"shape", value:"move", intensity:2}} ] },

    // TACTICS lesson — all CARROT, no stick (punishing a skill the player hasn't learned just makes them
    // quit). Block is worthless against a one-shot, so its tremors CHANNEL your dead Defend cards into
    // useful Moves. (Pairs with `outmaneuvered`, which rewards spending those Moves.)
    tremor:      { name:"Tremor", icon:"🪨", on:"tick", every:12,
                   desc:"every 12s the ground quakes, rattling your useless shields loose into Moves",
                   do:[ {effect:"transmute",
                         select:{axis:"shape", mode:"all_same", value:"defend"},
                         bias:{axis:"shape", value:"move", intensity:2}} ] },
    // the gentle NUDGE toward Moves: a Move set leaves the lumbering behemoth a step behind — its attack
    // is pushed back 5s (a "Slow"). No timer reduction anywhere; failing to grab Moves just isn't rewarded.
    outmaneuvered:{ name:"Outmaneuvered", icon:"🐢", kind:"trick", on:"match", when:{axis:"shape", mode:"all_same", value:"move"},
                   desc:"all-Move match → you dance aside; the behemoth lumbers after you, +5s before it can strike",
                   do:[ {effect:"delay_attack", seconds:5} ] },

    // ABILITIES lesson: an INVERSE trap the player WANTS to trigger. All-Attack matches are wasted on
    // an immune foe, so he melts every sword into a Move — feeding Tactics → mana → the spells that hurt him.
    ethereal_cackle:{ name:"Ethereal Cackle", icon:"😈", on:"match", when:{axis:"shape", mode:"all_same", value:"attack"},
                   desc:"all-Attack match → he cackles at your flailing and melts every sword into a Move",
                   do:[ {effect:"transmute",
                         select:{axis:"shape", mode:"all_same", value:"attack"},
                         bias:{axis:"shape", value:"move", intensity:2}} ] },
  },

  // --- dungeon DRIFTS: the global on:tick transmute that gives a dungeon its "feel" (TRAPS.md §7) ---
  drifts: {
    ember: { name:"Ember Drift", icon:"🔥", on:"tick", every:7, quiet:true,
             desc:"the board drifts toward Fire",
             do:[ {effect:"transmute", count:1,
                   select:{axis:"color", mode:"not_value", value:"red"},
                   bias:{axis:"color", value:"red", intensity:1}} ] },
  },

  // --- SPEED bands → attack cadence in seconds (TRAPS.md §7.2; lower = more dangerous) ---
  speed: { lumbering:20, slow:15, steady:12, swift:10, frenzied:8 },

  // --- CREATURES: stat baseline + a variant pool (minion/elite) OR authored traps (boss).
  //     A fielded foe = creature ⊕ rolled variant ⊕ dungeon template (TRAPS.md §7.1). ---
  creatures: {
    // TUTORIAL DUMMY: cannot hurt you (damage 0) and has no trap — pure, pressure-free practice for
    // the guided intro. Numeric speed = raw cadence seconds (30s). High HP so it survives the lesson.
    training_dummy:{ name:"Training Dummy", tier:"minion", hp:120, speed:30, damage:0,
                     desc:"A straw-stuffed practice dummy on a creaky pivot. It cannot hurt you — take all the time you need to learn the ropes.",
                     traps:[], variants:[], xp:0, loot_tier:0 },
    // TRAINING DUMMY (zombie): a sandbag. Huge HP, slowest band the system has (lumbering), trivial bite.
    // Its ONE signature is the authored `limbless` trap; variants:[] so it never rolls a random one.
    limbless_zombie:{ name:"Limbless Zombie", tier:"minion", hp:30, speed:"lumbering", damage:3,
                     desc:"A zombie with no limbs, chin-crawling across the floor toward you. Harmless — until it gathers itself for a sudden lurch.",
                     traps:["limbless"], variants:[], xp:5, loot_tier:1 },
    // TACTICS teacher: one hit is death, but it is ponderously slow. Survive by matching Moves (which
    // push its clock back AND bank Tactics), then spend a decisive Tactic to break its 50 HP.
    dread_behemoth:{ name:"Dread Behemoth", tier:"elite", hp:50, speed:120, damage:100,
                     desc:"A mountain that walks. Its blow is <b>certain death</b>, so blocking is futile — but it is <i>ponderously</i> slow. Its tremors shake your useless <b>Defend</b> cards loose into <b>Moves</b>; spend a <b>Move</b> set and you dance aside, leaving it a step behind. Stay mobile, bank <b>Tactics</b>, and break it with a decisive strike.",
                     traps:["tremor","outmaneuvered"], variants:[], xp:30, loot_tier:3 },
    // ABILITIES teacher: immune to swords; only spells bite him, for the mana you spend. His cackle
    // (inverse trap) melts your wasted Attacks into Moves — fueling the Tactics→mana→spells loop.
    unstable_ethereal_goblin:{ name:"Unstable Ethereal Goblin", tier:"minion", hp:15, speed:"steady", damage:6,
                     desc:"A goblin who gulped a Potion of Etherealness <i>and</i> a Potion of Polymorph at once — now a flickering wisp of raw magic. <b>Swords pass right through him</b> (Attack cards deal no damage). Only <b>magic</b> bites: every <b>ability</b> you cast drains him by the <b>mana you spent</b>. Spend 15 mana of spells to dispel him.",
                     rules:{ immune_card_damage:true, ability_damage:"mana_spent" },
                     traps:["ethereal_cackle"], variants:[], xp:25, loot_tier:3 },
    goblin:        { name:"Goblin",        tier:"minion", hp:20, speed:"swift",   damage:10,
                     variants:["bloodthirsty","sneaky","cowardly"], xp:10, loot_tier:2 },
    cave_bat:      { name:"Cave Bat",      tier:"minion", hp:14, speed:"frenzied", damage:6,
                     variants:["sneaky","elusive"], xp:8, loot_tier:1 },
    goblin_shaman: { name:"Goblin Shaman", tier:"minion", hp:18, speed:"slow",     damage:8,
                     variants:["plagued","hexer"], xp:12, loot_tier:2 },
    goblin_brute:  { name:"Goblin Brute",  tier:"elite",  hp:38, speed:"steady",   damage:13,
                     variants:["bloodthirsty","cruel"], xp:26, loot_tier:3 },
    // BOSS: higher stats + 3 AUTHORED signature traps (specialist + generalist + dread)
    goblin_king:   { name:"The Goblin King", tier:"boss", hp:90, speed:"steady",   damage:16,
                     traps:["molten_veins","confusion","dread_drums"], xp:120, loot_tier:5 },
  },

  // --- VARIANTS: an adjective = a themed trap (+ optional stat tweak). Rolled from the creature. ---
  variants: {
    bloodthirsty: { name:"Bloodthirsty", icon:"🩸", desc:"all-red → 50%: 6 dmg + warp a Defend to Fire",
                    trap:{ on:"match", when:{axis:"color", mode:"all_same", value:"red"},
                           do:[ {effect:"damage", chance:0.5, amount:6},
                                {effect:"transmute", count:1, select:{axis:"shape", mode:"all_same", value:"defend"},
                                 bias:{axis:"color", value:"red", intensity:1}} ] } },
    sneaky:       { name:"Sneaky", icon:"🌑", desc:"all-Move → 25%: strikes at once", stat_mod:{ speed_band:1 },
                    trap:{ on:"match", when:{axis:"shape", mode:"all_same", value:"move"},
                           do:[ {effect:"instant_attack", chance:0.25} ] } },
    cowardly:     { name:"Cowardly", icon:"😰", desc:"all-Attack → panics, strikes 4s sooner", stat_mod:{ hp:-6, damage:-2 },
                    trap:{ on:"match", when:{axis:"shape", mode:"all_same", value:"attack"},
                           do:[ {effect:"advance_timer", seconds:4} ] } },
    elusive:      { name:"Elusive", icon:"💨", desc:"all-Move → lock 1 card 4s", stat_mod:{ speed_band:1 },
                    trap:{ on:"match", when:{axis:"shape", mode:"all_same", value:"move"},
                           do:[ {effect:"lock", seconds:4, select:{geometry:"random", count:1}} ] } },
    plagued:      { name:"Plagued", icon:"☠️", desc:"all-green → enemy heals 5",
                    trap:{ on:"match", when:{axis:"color", mode:"all_same", value:"green"},
                           do:[ {effect:"enemy_heal", amount:5} ] } },
    hexer:        { name:"Hexer", icon:"🔮", desc:"all-blue → burn 3 Frost mana", stat_mod:{ hp:4 },
                    trap:{ on:"match", when:{axis:"color", mode:"all_same", value:"blue"},
                           do:[ {effect:"drain_mana", color:"blue", amount:3} ] } },
    cruel:        { name:"Cruel", icon:"🔪", desc:"all-Attack → reflect 6", stat_mod:{ damage:2 },
                    trap:{ on:"match", when:{axis:"shape", mode:"all_same", value:"attack"},
                           do:[ {effect:"damage", amount:6} ] } },
  },

  // --- TEMPLATES: a dungeon-global overlay stacked on EVERY foe (one-knob harder dungeon) ---
  templates: {
    undead: { name:"Undead", icon:"💀", desc:"regenerates 3 HP every 7s", stat_mod:{ hp:8, speed_band:-1 },
              trap:{ on:"tick", every:7, quiet:true, do:[ {effect:"enemy_heal", amount:3} ] } },
  },

  // --- DUNGEONS: theme + drift + weighted enemy table + elite pool + boss (+ optional template) ---
  dungeons: {
    // GUIDED INTRO: the DEFAULT room for a fresh player. `guided:true` triggers the staged walkthrough
    // on Engage (freeze-and-explain, one play-element per stage). Foe = the harmless Training Dummy
    // (0 damage) so nothing swings at you while you read. `coach:true` arms the ready-arrow affordances.
    tutorial:      { name:"Tutorial · Guided Intro", difficulty:0, coach:true, guided:true,
                     theme:null, drift:null, boss_mirror:null, default_foe:"training_dummy",
                     enemy_table:[ {foe:"training_dummy", weight:100} ],
                     elite_pool:[], boss:null, template:null },
    // TRAINING: a planned GAUNTLET — a fixed sequence of foes fought in a row, each teaching one
    // concept (traps → tactics → abilities). `sequence` drives the run; the enemy_table keeps the
    // individual foes selectable for practice. No drift/template — the only threats are the foes' own.
    training:      { name:"Training · Gauntlet", difficulty:0, coach:true,
                     theme:null, drift:null, boss_mirror:null,
                     sequence:[ "limbless_zombie", "dread_behemoth", "unstable_ethereal_goblin" ],
                     enemy_table:[ {foe:"limbless_zombie", weight:1}, {foe:"dread_behemoth", weight:1}, {foe:"unstable_ethereal_goblin", weight:1} ],
                     elite_pool:[], boss:null, template:null },
    goblin_warren: { name:"The Goblin Warren", difficulty:1,
                     theme:{axis:"color", value:"red"}, drift:"ember", boss_mirror:"war_cry",
                     enemy_table:[ {foe:"goblin", weight:50}, {foe:"cave_bat", weight:30}, {foe:"goblin_shaman", weight:20} ],
                     elite_pool:["goblin_brute"], boss:"goblin_king", template:null },
    haunted_warren:{ name:"The Haunted Warren", difficulty:3, extends:"goblin_warren",
                     theme:{axis:"color", value:"red"}, drift:"ember", boss_mirror:"war_cry",
                     enemy_table:[ {foe:"goblin", weight:50}, {foe:"cave_bat", weight:30}, {foe:"goblin_shaman", weight:20} ],
                     elite_pool:["goblin_brute"], boss:"goblin_king", template:"undead" },
  },

  // --- the active sandbox encounter — the "Custom (sliders)" fallback foe's traps/drift ---
  encounter: {
    traps: ["molten_veins", "spiked_hide", "petrify"],   // punishes the red / Attack / Move lines
    drift: "ember",
  },

};
