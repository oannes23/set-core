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
  speed: { lumbering:19, slow:15, steady:11, swift:7, frenzied:4 },

  // --- CREATURES: stat baseline + a variant pool (minion/elite) OR authored traps (boss).
  //     A fielded foe = creature ⊕ rolled variant ⊕ dungeon template (TRAPS.md §7.1). ---
  creatures: {
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
