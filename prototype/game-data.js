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
  },

  // --- dungeon DRIFTS: the global on:tick transmute that gives a dungeon its "feel" (TRAPS.md §7) ---
  drifts: {
    ember: { name:"Ember Drift", icon:"🔥", on:"tick", every:5, quiet:true,
             desc:"the board drifts toward Fire",
             do:[ {effect:"transmute", count:1,
                   select:{axis:"color", mode:"not_value", value:"red"},
                   bias:{axis:"color", value:"red", intensity:1}} ] },
  },

  // --- the active sandbox encounter (TEST wiring; Task 6's foe assembler will build this from
  //     creatures ⊕ variants ⊕ templates ⊕ dungeons) ---
  encounter: {
    traps: ["molten_veins", "spiked_hide", "petrify"],   // punishes the red / Attack / Move lines
    drift: "ember",
  },

};
