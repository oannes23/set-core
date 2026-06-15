# CRAWL-DESIGN.md — SET.crawl

> The first iteration toward the **real game**: a data-driven dungeon crawler on
> the SET skill engine. **Status: in build, on `src/`.** Combat, the threat layer,
> **Tactics v2** (§5.5), and **Phase B1** (scene shell + town/run-map screens +
> persisted progression) are shipped in the modular TS client; the **run loop**
> (§2, exit ladder §6) is the next build — see `TODO.md`. Builds on
> `GAME-DESIGN.md` (trigger bus, transmute verb, locked f=3/N=15) and `PROJECT.md`
> (generation math). This doc owns the crawl-specific run loop, the data
> architecture, and the visual reskin.

**Lineage:** `set.core` (skill core + tuning console) → `set.combat` (combat
sandbox) → **`set.crawl`** (the dungeon-crawler game). ~~set.crawl starts as a copy
of `prototype/set-combat.html`, palette-swapped first, then grown into the loop
below.~~ *(Superseded by `TODO.md` §A: the crawl is built on the modular `src/`
client, not the archived HTML; the typed TS data module (`src/data`) is the
YAML-portable equivalent of the loader sketched below.)* We keep the validated
generation core untouched.

---

## 1. Visual direction — dungeon-crawler reskin

A pure palette/asset swap first (no mechanics change). The board stays the same
f=3/N=15 grid; only the skin changes.

- **Card stock = parchment.** Aged vellum texture, subtle stains/foxing, slightly
  irregular deckled edges, an inked border. Replaces the dark instrument cards.
- **Iconography = inked action glyphs.** The shape axis is **Attack / Defend / Move**
  (§4 axis theming), so the card glyph depicts the *verb*, not the gear object: a
  strike / a guard / a stride (e.g. crossed-blades, shield-guard, footprints), drawn
  woodcut/engraving style — kept visually distinct from the Sword/Shield/Boots *gear*
  nouns. Number renders as pips or repeated glyphs (magnitude 1–3).
  *Icon sourcing:* **set.crawl** draws from **game-icons.net** (CC BY 3.0 — carry an
  attribution credit), which matches the woodcut aesthetic; the **set.combat** sandbox
  uses **Lucide/Tabler** (MIT) placeholders. Working glyph picks: Attack = crossed
  swords, Defend = shield, Move = footprints.
- **Color = aged inks, not neon.** Muted tints (vermilion / verdigris / woad) rather
  than the current bright RGB, themed as elements/mana.
- **UI chrome = stone, torch, wood, iron.** Torch-lit vignette, wood/iron panel
  framing, a blackletter or chiseled-serif display face for headers (vs. Syne),
  readable serif/mono for body. Inventory/town as unrolled parchment scrolls.
- **Feedback juice.** Damage = blood/torch red vignette flash (the §4 timed-hole
  damage mechanic). Timer could become a guttering candle or draining hourglass
  (optional; keep legibility).
- **Health gems + playfield tint.** Gems set into the background art recolor with the
  player's HP band, and at the low bands the whole playfield takes a vignette tint
  that deepens toward death — a glanceable, ambient health read (no need to watch a
  number). *(As shipped in `src/ui`: a simpler two-band version — **low ≤70% ·
  crit ≤35%** — driving the HP-bar glow + playfield vignette; the 4-band
  blue/green/yellow/red gem spec and corner-gem placement remain a future polish
  option, prototyped in the archived `set-combat.html`.)*

> Principle: reskin is cosmetic only. No generation/mechanic change rides along with
> the palette swap — that's a separate, later step.

---

## 2. The run loop

```
  TOWN ──enter──> DUNGEON ──> [ROOM: 1 enemy] ──win──> LOOT ROLL ──> next room
   ^                                  │                                  │
   │                            (lose = run ends)            (boss-chance check each room)
   └────────────── exit / death ──────┴──────── BOSS room ──win──> big LOOT ──> TOWN
```

- **Dungeons** have a difficulty level, a **theme**, a **weighted enemy table**, and a
  **named boss**. Loot quality scales with **enemy level + dungeon level**. Each
  dungeon also applies one **global transmute drift** (an `on:tick` nudge of the board
  toward the theme value) active in *every* room — this is what makes a dungeon *feel*
  like its element, and it **baits** the theme value the foes are built to punish
  (build-vs-dungeon). Full threat-layer spec in **`TRAPS.md`** (esp. §7 attachment).
- **Foes** are **HP · Speed · Damage** + traps, by tier: **minion** = 1 trap (rolled as
  a themed *variant* of the creature) · **elite/lieutenant** = 2 (one dungeon-fixed,
  mirroring the boss's specialist theme trap — a *telegraph* — plus one rolled) ·
  **boss** = higher stats + 3 authored signature traps (the squeeze). Ladder = **1 → 2 →
  3 traps**. A fielded foe is composed **base creature ⊕ rolled variant ⊕ dungeon
  template** (built like an item; `TRAPS.md` §7.1), with **Speed** named in bands
  (Lumbering → Frenzied, §7.2).
- **Rooms** are fought one enemy at a time (a SET combat encounter). Win → a roll on
  the loot table. Lose → the **exit ladder** (settled — §6): flee falls back to the
  between-rooms fork at a price; death ends the run and costs the carried loot + a tithe.
- **Boss chance per room** is cumulative (the running probability the boss has
  appeared rises each room). Each room *n* adds *n%* to the running total:
  `cumulative(n) = n·(n+1)/2 %` (triangular).

  | Room n | adds | cumulative boss-appeared |
  |---|---|---|
  | 1 | +1% | 1% |
  | 2 | +2% | 3% |
  | 3 | +3% | 6% |
  | 4 | +4% | 10% |
  | 5 | +5% | 15% |
  | 6 | +6% | 21% |
  | 7 | +7% | 28% |
  | 8 | +8% | 36% |
  | 9 | +9% | 45% |
  | 10 | +10% | 55% |
  | … | … | … |
  | 14 | +14% | **100% (capped → guaranteed)** |

  So **median boss ≈ room 10, guaranteed by room 14** — dungeons self-bound in
  length, with a long-run gambler's choice (push deeper for more loot rolls vs. cash
  out before the boss). When the boss triggers, **it replaces the enemy that room would
  have generated** (its own fresh encounter), not an appended extra room.

  **Mechanism (SETTLED 2026-06-09)** — the table above is the *distribution itself*,
  not a per-room reroll spec (naive readings get it wrong: rolling the +n% increment
  each room yields only ~67% by room 14 with no guarantee; rolling the cumulative each
  room front-loads it to a ~room-6 median). Implement by **inverse-CDF draw**: at run
  start, draw one `R ∈ [0, 100)` from the run seed; the boss appears at the first room
  where `cumulative(n) > R`. Exact (P(boss at room n) = n% for rooms 1–13, the
  remaining 9% at 14; mean ≈ 9.5, median 10, rooms 8–12 hold half the mass),
  deterministic per seed (daily/shareable runs), and one line of code. Corollaries:
  - **Room index n counts encounters *entered*, cleared or fled** — fleeing
    (exit ladder, §6) still advances the boss total, so flee-farming the minion
    tier always walks toward the throne room.
  - **The throne room, once found, stays found.** Fleeing the boss pays the parting
    blow and returns to the fork, but pressing on always faces the boss again — no
    minion rooms remain behind him. The boss's appearance is the run's point of no
    return for farming (finish him or cash out).
  - **The dread meter (between-rooms UI, Phase B2):** the running total is surfaced
    as **thematic bands** (≈4–5 steps: "the warren is quiet" → "drums echo" →
    "the throne stirs" → "he is near"), monotone and honest against the true
    cumulative — fiction on the surface, the exact curve underneath. **These bands
    also set the combat `dread` *depth floor* `D₀` (§5.8)** — the across-run threat
    that the within-fight escalation builds on.

- **Elite chance per room** — checked *only if the boss didn't trigger this room*, and
  **recurring** (the elite tier is met repeatedly). Chance = **10% × (rooms since the
  last elite)**; the counter **resets to 0 when an elite is fought**, so it climbs
  10% → 20% → 30% … then drops back to 10%. Mean gap ~3–4 rooms → usually **2–3 elites
  before the boss** (with rare swingy runs — a room-2 boss is possible). 10% is the
  tuning dial.

- **Town** between dungeons: **sell** gear/spellbooks, **buy** from shop loot-table
  inventory (gear, consumables, spellbooks). Healing/restock happens here.

### Between-rooms approaches — the exploration verbs *(SETTLED 2026-06-13; build with the B2 run loop)*
At the between-rooms fork (after a clear, before the next room — alongside press-on / flee /
cash-out, §6) you choose **one approach** for the next room. **Free, one per transition, resets each
room** — the opportunity cost (only one) *is* the decision, and it turns the fork from a continue
button into a live read. This realizes the shelved Scout & Scavenge "run-fork verbs" (the Tactics v2
notes) as a full set. The five live approaches map onto **the five things a run can be short on** —
pick to shore up your weakest axis:

- **Scout (information)** — preview the next encounter. **Free baseline at L1 for everyone**
  (new-player-friendly — info is what de-risks early runs), scaling by *information depth*: L1 the
  **tier** (minion/elite/boss — the brace-or-flee signal) · L2 **+ the exact foe** · L3 **+ its
  traps/signature** (the full threat read). The meta approach: it informs *which* approach to take
  next AND the flee/press decision (Scout an elite → flee it before committing) — Scout is the exit
  ladder's natural partner.
- **Lurk (tempo)** — **+seconds on round 1** (+3 / +6 / +9s at L1/2/3). Initiative falls out of v3
  for free: the foe's telegraph is a *fixed per-round budget*, so a longer round 1 is pure player
  accumulation against it. **Stacks with the Speed initiative** (below).
- **Scavenge (reward)** — the next room's loot roll gets **+2 / +4 / +6 effective-depth** (reuses the
  `DEPTH_RATE` machinery — ≈ +14 / +28 / +42% gold + quality bias), L1/2/3.
- **Recover (sustain)** — heal **5% / 10% / 15% maxHP** (L1/2/3). **Hard-capped low on purpose** —
  it's a *choice against* the HP-attrition spine, never a sustain engine.
- **Prepare (resource)** — start round 1 with a **partial mana pool** (~20% / 35% / 50% of cap; the
  rest still rebuilds in-fight per §6 — bounds caster snowballing), L1/2/3.

**The voluntary-activation board preview (baseline — every fight, not just Lurk).** The pre-round
preview is *untimed*: plan freely, and **the first set you complete activates the round** (it counts
as your opening move). Kills opening-scan pressure — fits the v3 deliberate register, great for
onboarding — while fast players still go fast. **Supersedes the fixed 3s start-grace.**

**Speed = initiative, via round-1 length.** Round 1 runs `clamp(20 + (playerS − foeS), 15, 25)`
seconds (faster-than-foe → up to 25s, slower → down to 15s); **every other round stays a flat 20s**
(the v3 pacing constant holds). Lurk adds on top. *Scoping rationale (the load-bearing call):*
scaling **every** round by Speed would be a universal throughput multiplier (it lifts attack AND
defend AND charges vs a fixed foe budget) that **triple-dips** with dodge + charges, unsettles the
20s pacing constant + the kill budgets, and **re-couples output to scan speed** (undoing "sets steer,
stats carry") — so the initiative is confined to the opener. Bonus: it helps the sim-flagged "Speed
under-buys" gap. **Speed's old start-grace rider migrates here** (supersedes §5.7's
start-grace-stretches-with-Speed).

**Acquisition.** The five are **universal** (everyone can use all of them); you **level them via the
per-level horizontal pick** (§3) — four scale L1→3, Scout's depth L1→3, capped at 3. *Which* you
level and in what *order* is the playstyle expression. **Class synergy is optional flavor** (a class
*may* carry a passive that boosts one approach), never a per-class requirement.

**Deferred — Investigate (the 6th, with the event-room system).** When non-combat rooms exist (the
StS-style events / merchants / camps run-variety thread), **Investigate** buys *encounter type* —
biasing the next room's roll toward event scenes. It dovetails with Scout, which then reads room
*type* too ("an event lies ahead"): Investigate shifts the odds, Scout reads the result. Event rooms
may themselves *offer* a free or boosted approach (a campfire = a bigger Recover), keeping the two
systems reinforcing rather than parallel.

### Scenes & persistence (the hub)
The game is **two top-level scenes**, not one screen: the **Hub** (town/menu) and the
**Combat** playfield. They're separate scenes with a clean transition between them.
- **Hub** = the default place you sit *between* matches: **character create / select**,
  **dungeon select**, **loadout** (equip gear / abilities / consumables), the **shop**
  (buy/sell), and the jump into a run. It is today's start screen *grown up* — the
  class+dungeon picker in `src/ui/app.ts` is the seed of it.
- **Combat** = the SET playfield (one room/encounter). A run is a chain of Combat scenes;
  on run end (win → Town, or flee/death) you return to the Hub.
- **Persistence** is tied to the Hub: a saved **character** (class, level/XP, ability
  loadout, inventory/gear/consumables, gold) plus run state. **Start minimal — the chosen
  character + HP — and grow** into inventory/progression. `localStorage` first; the
  `session.ts` seam keeps a *run* replayable, while the character save is the *meta* layer
  on top. (Equipment, consumables, and loot all depend on this layer existing.)

---

## 3. Progression & economy *(SETTLED 2026-06-12 — numbers are first-cut, GATED by the
budget-conformance sim; constants tabled in `TUNING.md` "Progression & loot — PLANNED")*

### Leveling (settled + BUILT 2026-06-13)
> **STATUS: shipped** — `src/ui/save.ts` (level/xp/alloc + the pure curve/stat math, unit-tested)
> + the level-up modal & character-sheet XP/stat readout in `app.ts`. XP banks per kill (always,
> even on death); level-ups are allocated in town. Teaching foes carry an `xp` override for the
> onboarding curve. STILL OPEN from §3: the **loot tables** (gold/gear/spellbook drops).
- **Cap: level 21** — numeric to 20; the 21st renders as a **★** (the cap badge).
- **Per level: +5 max HP** (base 100 → **200 at cap**; gear/passives can add ~+100 more for a
  practical ~300 ceiling on a dedicated build) **+ 6 stat points, freely distributed, ≤3 per stat**
  (REVISED 2026-06-14 — was a rigid +3/+2/+1 permutation; now any split summing to 6 with each ≤3:
  **3/3/0 · 2/2/2 · 3/2/1**). → +6/level, **+120 over the arc**. The freedom adds **two-stat-focus**
  builds (3/3/0 → two stats +60, the third dumped to base) alongside the old focused-main (+60) and
  balanced (+40 each). Totals + bounds are **unchanged** (max one stat is still +3/level → +60; the
  contest clamp [2,20] binds at ±60), so the sim's parity line + conformance hold — dumping a stat is
  the real cost. Pre-gear build identity lives here (classes start stat-uniform).
- **The re-denomination corollary (SIM-DERIVED 2026-06-12 — `sim/progression-sim.mjs`,
  constants in `TUNING.md`):** contests are DIFFERENCE-based, so the wide point arc re-derives
  the per-point constants — `RATE_K` 0.8 → **0.2**, `MOVE_RATE_K` 0.1 → **0.025**; the
  **tempo bands survive UNCHANGED** (they read the foe's own S−P, and role spreads author
  level-invariant). Foes author against the **parity line `10 + 2(L−1)`** (endgame 40–80) and
  the **telegraph re-anchors on the contest** (`budget = rate(P_f, E_p) × 3.1 × tier` — raw
  `P × 2.5` breaks A4 over the arc and retires). The wound/heal laws are already scale-free
  (`maxHP/10`). The prize difference-math hands us free: outleveled content goes automatically
  trivial — returning to the warren at 15 and flattening goblins is a real reward.
- **XP is COMPUTED from the foe statline, never authored** (the wounds/tempo-law aesthetic —
  new foes self-price): `XP = (hp/10 + P + E + S) × (1 + 0.15·trapCount) × tierMult`, with
  **tierMult ×1 / ×2 / ×4** (minion/elite/boss) — deliberately ABOVE the stat ladder's
  ×1/×1.5/×2, so harder targets always beat grinding per minute (the economic anti-stall).
  The authored `xp` field retires with the data rebase.
- **Curve anchors (shape SIM-DERIVED 2026-06-12; base STEEPENED 2026-06-14 — sim §8):** **polynomial —
  `need(L→L+1) = 110 × L^1.7`** (geometric REJECTED by the sim: XP income grows ~linearly with the
  parity line, so a geometric requirement walls off AND undershoots the 2→3 anchor). **The base was
  raised 55 → 80 → 110** to hit the target of **~50–60 level-matched dungeon clears to ★** (110 → ~56)
  — the base RISES because foe XP income rises with dungeon level (below), and `L^1.7` keeps the
  requirement outpacing income. (At 55 a first warren clear gave ~2 levels — too fast; 110 still keeps
  it ≈ 1 level. The curve-base is now DECOUPLED from the L3-minion XP, coincidentally both 55.) Pinned
  at the bottom by the teaching foes' `xp` overrides: **dummy → L2** (need(1→2)=110), **gauntlet → L3**
  (need(2→3)=355); real dungeons assume a **fresh level-3 entrant**. **XP always banks, even on death.**

#### Dungeon difficulty, level-equivalence & the outlevel penalty *(SETTLED 2026-06-14 — sim §8)*
- **Dungeons carry a difficulty 1–5 → a dungeon LEVEL** (the parity-authoring level of its foes),
  `L = 3 + 4(D−1)`: **D1→L3 · D2→L7 · D3→L11 · D4→L15 · D5→L19** (±2 ramp within each). **D5 is the
  "18+" endgame**; you climb D1→D5 as you level. Higher-difficulty foes have bigger statlines → **bigger
  XP** (computed from the statline), so the curve must — and does — steepen to match (above).
- **Every foe SELF-RATES a level-equivalent from its statline** (inverting the parity line):
  `L_foe ≈ 1 + (avgStat − 10)/2`. No authoring — a foe's strength *is* its level. (Elites/bosses read
  ~1 higher via their E-bump; within the penalty's grace band, so harmless.)
- **The outlevel XP penalty (anti-backtrack-farm):** `xpMult = clamp(1 − 0.15·max(0, L_player −
  L_foe − 2), 0.1, 1)` — full XP within **2 levels**, then −15%/level to a **×0.1 floor**: one tier
  down (gap ~4) ×0.70, two tiers (gap ~8) ×0.1 (farming trivial content is pointless). Above-level =
  ×1.0 (a small above-level *bonus* is an available lever, not taken yet). This is what makes the
  "50–60 *level-matched* clears" target real — you can't cheese it by grinding easy rooms.
#### The loadout — slots, the level cadence & class packages *(SETTLED 2026-06-13; supersedes the boss-gated pick)*
- **Loadout caps: 6 active abilities + 3 passives.** The equipped loadout is what you
  fight with; the cap is the build-tension constraint (a ~10-deep class list never all
  fits — you choose). Each level also grants **+HP + stat points** (above).
- **The signature passive COUNTS toward the 3** (settled 2026-06-13). Each class has **~5
  passives to choose from but begins with one particular signature** (the identity trigger,
  e.g. Rogue's Move→Attack bias) occupying one passive slot → **2 free passive slots** to fill
  from the rest of the list (or via passive spellbooks). Tight on purpose — passives are scarce,
  which is why passive books are the premium tier.
- **Actives gate on MANA and/or COOLDOWN** (settled 2026-06-13): cooldowns join mana as a second
  gating dimension — a balance + variety lever (a cheap-but-cooldowned nuke vs a mana-hungry
  spammable read very differently). Each ability authors `cost` (mana) and/or `cooldown` (rounds);
  either, both, or neither (a free-but-conditional trigger). Lands with the ability-system build.
- **A class is a PACKAGE — `{ X starter abilities, Y starter passives, Z beginner gear }`
  — and the counts are CLASS-DEFINED, not fixed.** A standard class opens with a small kit
  (room to grow); the package is the class's whole opening identity (kit + the beginner gear
  that the kit wants). The class also owns a **~10-deep ability list** (its learnable pool —
  the intra-class build variety) + its passive list.
- **Advancement is on the LEVEL-UP cadence (this REPLACES the old "one pick per boss").**
  A level-up both **unlocks a slot** (toward the 6/3 caps, on the cadence below) **and grants a pick**
  — learn one ability/passive from your class list into the newly opened slot. So the 6+3 loadout
  fills in *over the arc*, and *which* picks in *what order* is the build. **Active slots unlock at
  L3 · L6 · L10 · L14** (from a 2-active start → cap by L14); **passive slots at L8 · L16** (signature
  + 2 → cap by L16). The back third (L17–21) is stats / approaches / swaps + spellbooks. (Surplus
  grants — a kit-heavy package already at cap, or a prestige class — convert to a free REPLACE pick.)
  **Bosses keep their growth feel via the guaranteed dungeon-clear roll** (Loot, below).
- **Every level grants a BUNDLE — leveling is always juicy (cadence SETTLED 2026-06-14).** *Automatic*
  each level: **+5 HP · +6 stats (≤3/stat) · +mana cap** (15 → ~35 at cap, gear raises further).
  *On top*, a **scheduled cadence** of capacity + ability + exploration, all **off the combat-power
  curve** (never touches balance). The split: **capacity (satchel / consumable slots) is FIXED &
  guaranteed** ("+1 satchel vs +1 satchel" is no real choice), while the **exploration approach-ups
  stay the player's PICK** (which of the five you level, and in what *order*, is the early-game
  exploration identity). The full arc:

  | Lvl | Ability slot (+pick) | Capacity (fixed) | Approach pick |
  |---|---|---|---|
  | 1 | *start:* 2 active + signature + Background | satchel 10 · cons 3 | all 5 approaches @ L1 |
  | 2 | | satchel→11 | |
  | 3 | active #3 | | approach↑ |
  | 4 | | satchel→12 | |
  | 5 | | consumable→4 | |
  | 6 | active #4 | | |
  | 7 | | | approach↑ |
  | 8 | passive #2 | | |
  | 9 | | satchel→13 | |
  | 10 | active #5 | | approach↑ |
  | 11 | | | approach↑ |
  | 12 | | satchel→14 | |
  | 13 | | consumable→5 | approach↑ |
  | 14 | active #6 ✓ | | |
  | 15 | | | approach↑ |
  | 16 | passive #3 ✓ | | |
  | 17 | | satchel→15 ✓ | |
  | 18–21 | | | approach↑ ×4 |

  Counts land exactly: **satchel 10→15** (5), **consumables 3→5** (2), **active 2→6** (done L14),
  **passive 1→3** (done L16), **10 approach-picks → all 5 approaches maxed by ★** (the *order* is the
  climb's identity; off-power-curve, so a complete kit at cap is fine). L3/10/13 double up (slot *and*
  approach). **Excluded on purpose:** charge cap (stays **15** — the Rounds-v3 board invariant, not a
  lever) and Storage (gold-bought, `N²`). Every level is a fistful.
- **PRESTIGE CLASSES (future, unlockable):** the dynamic package count is what makes these work —
  a prestige class **starts with ~2 of 3** the loadout filled (a near-complete kit at L1), and **at
  the levels it would normally unlock a slot it instead gets a REPLACE option** drawn from the
  *prestige pick set* — so its leveling is **customization, not growth** (swap toward your build
  rather than fill empty slots). Same machinery, inverted: a big starter package + level-ups that
  grant swaps instead of fresh slots.
- **Swapping the equipped loadout among *known* abilities is free in town;** *acquiring* new
  known abilities is the gated part (the level pick from your class list, or a spellbook).
- **Spellbooks — the cross-class vector (REPLACE, not expand — settled 2026-06-13).** A spellbook
  grants an ability **outside your class list**; using one teaches it into your known pool and you
  **slot it by REPLACING an equipped ability** — it does **NOT** raise the 6/3 cap. (Firebolt lives
  once; Wizard/Sorcerer/Pyromancer all reference it — a Rogue *learns* it from the book.) **Why
  replace, not exceed:** the whole loadout-tension design + the combat budget/telegraph economy
  assume a *bounded* per-round output; letting gold buy a 7th active dissolves the central choice
  and reads as the pay/grind-to-win the genre punishes. Replace-only **still fully enables twinking**
  — a kitted character runs *better / cross-class* abilities, just not *more* of them; variety lives
  in *which* books. Any ceiling bump above 6/3 should be **earned, not bought** (a rare achievement/
  boss unlock), so the power ceiling is gated by mastery, not gold. **Passive spellbooks are RARER**
  (passive slots are scarcer). Sources lean **lottery-primary**: the dungeon-clear marquee roll +
  drops are the exciting faucet; the **class-hall shop** (Town, below) is the *targeted pity backstop*
  — priced so a drop is usually the faster path and buying is the "I gave up waiting" route. Sell
  unwanted books for gold.

#### Character creation — classes, backgrounds & the achievement gate *(SETTLED 2026-06-14)*
Character creation has **two orthogonal facets — Class × Background — and almost everything is
achievement-gated.** Unlocking content (not grinding gold) is the meta-progression spine; the
combinatorial Class × Background space is the long-tail replayability.

- **Classes are achievement-gated, opening with one starter.** A new account can only make an
  **Adventurer** — a deliberately **generic, very balanced** first-entry class that gently teaches
  the game (no sharp identity to misplay). **Completing the tutorial unlocks a few basic classes**;
  everything beyond is gated behind progressively more interesting achievements. **Prestige classes
  are just the deep end of this same ladder** (this answers the earlier open "prestige unlock
  conditions" — there is no separate system; it's all one achievement gate, prestige = harder gates).
- **Background — the second facet (a permanent, powerful, NEUTRAL passive).** At creation you also
  pick a **Background**, which grants **one extra Passive in a DEDICATED slot** (on top of the 3
  class-passive slots → 4 passives total) that **can NEVER be changed**. Backgrounds are:
  - **Thematic but neutrally oriented** — broadly useful across many builds, *not* build-defining
    (class owns build identity; Background is a flavorful, widely-applicable boost). Keep them from
    becoming a must-pick meta — neutral + roughly equal power is the design guard.
  - **Fairly powerful** vs a normal passive (the premium for permanence + the one-per-character
    scarcity). Since *every* character gets one, it raises the floor + adds identity, not an
    advantage *between* characters.
  - A flexible fiction bucket: **racial ancestries, bound signature items that auto-scale with the
    character** (a permanent scaling weapon/relic without spending a gear slot), **size/physical
    traits** (big → +HP/−dodge, small → +dodge/−HP), **flavorful careers**, etc.
  - **Achievement-gated too** — easy to author a *huge* number behind varied, interesting unlock
    conditions, so the **Background × Class** combination space keeps opening up as you play.
- **Implication: an achievement-tracking meta-layer** is now a real system (account-level, like the
  bank/class-halls — survives individual deaths). Lands later (B4/B5 content phase), but the *hooks*
  (class-locked creation, the Background slot) get designed now. Adventurer-only + tutorial-unlock is
  the onboarding's first slice.
- **Character slots are gold-bought (settled 2026-06-14, sim §9).** Slot 1 is free; each further slot
  unlocks for gold on a rising curve — **cheap to ~10** (cumulative ~15k), **steep 11→20** (slot 20 =
  16k; cumulative 11–20 ≈ 86k; all-20 ≈ 102k). PEGGED to the **~23k lifetime gold a character banks
  on its 1→★ climb** (sim §9), with the affordability **invariant** `cost(slot 20) ≤ one char's
  lifetime gold` (×1.4 margin) — so leveling one more hero always funds the next slot; you can't get
  slot-locked. Shared account; rescale with `GOLD_K` if it recalibrates. (`TUNING.md` for the curve.)

### Gear vs levels — the power share (settled; REVISED 2026-06-15 by the §7 clean-slate)
**Levels carry the stat baseline (+120 points over the arc); gear carries ~⅓ of effective combat
power** (revised UP from the old ¼). The key shift: **gear's power is flat per-card RIDERS, not raw
stats** (§7) — a rider is bounded (doesn't scale with the `rate()` contest) yet *impactful* (it hits
per-card × cards/set × sets/round), where a raw +stat barely moves. Difference-math punishes
stat-stacked gear (one lucky drop = a permanent every-contest edge — what the clamp bounds); bounded
riders don't, and **foes are tuned against your rarity-current rider level** so a bigger gear share is
the expected baseline, not an edge. Leveling stays meaningful (a drop makes you stronger, never makes
levels optional). HP mirrors the share. (Full model: §7.)

### Loot (settled + BUILT 2026-06-13 — category-first nested tables)
> **STATUS: gold + consumables shipped** — `src/engine/loot.ts` (the category roller + gold formula,
> tested) + `src/ui/bank.ts` (the shared account vault + death tithe) + the delve's run-purse/banking
> flow. Gold is a **weightless run counter** (decided 2026-06-13: it never takes satchel space — the
> town-economy plan already separates the Gold pool from item Storage). Gold derives from the same
> `foeValue` XP uses, via its own `GOLD_K` (independently tunable). **GEAR (B3) and spellbook (B4)
> loot categories are scaffolded but disabled** until those systems exist; the gear pity sawtooth
> lands with them. ⚠ Full warren clear runs ~210g (depth-inflated) vs the ~100–150 first cut —
> recalibrate `GOLD_K` once the shop sink exists.
- **Drop count by tier:** minion **1** · elite **2–3** + **guaranteed gold (×2 standard)** ·
  boss **5** + guaranteed gold (×4). The guarantee is the WAGE; the drops are the lottery.
- **Dungeon-clear MARQUEE roll (SETTLED 2026-06-13):** beating the boss (= clearing the dungeon)
  grants **one guaranteed HIGH-QUALITY roll** on top of the boss table — a **spellbook** if it
  lands in the consumable category, a **rare+ piece** if it lands in gear. This is the dungeon's
  headline reward and the main *organic* spellbook faucet (the class-hall shop is the *targeted*
  one). It's also what carries the bosses' growth feel now that ability picks moved to the level
  cadence (§ loadout) — you beat the boss FOR the marquee item.
- Each drop rolls a **CATEGORY** (per-tier weights — minion **60/30/10**
  gold/consumable/gear · elite **45/35/20** · boss **30/40/30**), then a sub-table within it.
  Elites/bosses also roll **quality with advantage** (roll twice, keep better). *(Rejected:
  "roll N, keep highest" across categories — there's no natural cross-category ordering;
  shifted weights buy the same skew transparently.)*
- **Sub-tables:** **gold** = a number, kept SMALL (minions ~3–8g; a full warren clear ≈
  100–150g — a moderate player banks **hundreds**, chase items price in **thousands**).
  **Consumables** = 60% potions / 35% scrolls / 5% spellbooks (scrolls double as one-shot
  DEMOS of the abilities spellbooks teach — the table advertises its own chase item; potion
  tier rides the quality roll). **Gear** = slot split × rarity (→ affix count) × loot-tier
  (→ affix power), per §7. Table entries **STAGE IN** as their systems land (gear at B3,
  spellbooks at B4) — the loadout-sequencing pattern.
- **Depth scaling:** loot quality / gold weight climbs with room number (~+5–10%/room) — aligns
  greed with the dread meter ("one more room" is always the loot-maximizing gamble) and
  economically kills shallow clear-and-cash-out farming.
- **Gear pity sawtooth:** the gear category's weight ticks up per gear-less drop, resets on a
  hit — the elite-sawtooth pattern reused as bad-luck protection.
- **Death tithe: ~12% of banked gold** (the exit ladder's last open number, now settled).
- **Gold** sinks unchanged: shop purchases, amenities, learning abilities (Rest stays free).
  Sources: the loot rolls above + selling unwanted gear/spellbooks. ⚠ Tune the faucet only
  AFTER the shop (the sink) lands — until then, instrument gold/run in the dev panel.

**Abilities can be shared across classes.** An ability is a standalone data object;
classes (and spellbooks) merely *reference* it. Firebolt exists once; Wizard,
Sorcerer, Pyromancer all list it.

### Class halls — the town's spellbook shops *(SETTLED 2026-06-13; build phase B4)*
The town has **one hall per class**, and they unlock through *play*, not gold:
- **Playing a class unlocks its hall.** Create/own a character of class C → hall C appears in
  town. (No character of that class → its hall stays locked.) The roster *is* the key ring.
- **The hall LEVELS with the class** (proposed metric: the **highest level any of your
  characters of that class has reached**; a `TUNING.md` open number). Higher hall tiers unlock
  **better shops** — and the **top tiers stock that class's SPELLBOOKS**. So **maxing a
  character of class C (→ ★) opens C's full spellbook catalog** for purchase by your *whole*
  roster (the account-shared bank pays). This is the targeted spellbook faucet (vs the dungeon
  marquee roll's organic one): a maxed Wizard lets your Rogue walk in and *buy* Firebolt.
- **Prices (settled 2026-06-13):** **1000g an active spellbook · 2500g a passive** — pricey by
  design: enough to **enable twinking but only to a limited degree** (a passive is a serious
  save-up, ~10+ clears of gold). The high tag keeps the shop a *backstop* to the drop lottery, not
  a shortcut, and the passive premium mirrors the scarcity of passive slots (3) + the rarity of
  passive books. **Sell-back is low by default — ~20% of value** (a town amenity raises it later),
  so flipping shop stock is never an arbitrage.
- **Storage-slot upgrades price as the SQUARE of the target size** (settled 2026-06-13), bought in
  10-slot steps off the base 20: **30 slots = 900g · 40 = 1600g · 50 = 2500g · … · 100 = 10,000g**
  (`cost(N) = N²`). The square makes early expansion cheap and a maxed 100-slot vault a genuine
  long-game gold sink (~38k all-in) — Storage is the steady, always-useful place to dump gold.
- **The cross-class dream made concrete:** halls turn "I leveled a Pyromancer" into permanent
  account power — every other hero can now buy the fire line. Class mastery is account progress.
- Sits on the **shared account bank** (gold + Storage) the B2 economy core builds; the hall shop
  is one more sink alongside consumables, gear, and amenities. (Rest stays free — §6.)

**The dual-axis hall — character level FLOORS quality, gold BUYS breadth (settled 2026-06-14).**
- **Character level in the class** (the highest you've reached) has a **subtle GLOBAL effect**: it
  raises the **default loot-quality floor** of the hall's random rolls — a ★ Pyromancer's hall with
  *zero gold invested* still rolls better on its low-end table than a level-3 account's Pyromancer
  hall. It also **gates the upgrades**: reaching a level unlocks the *option* to spend gold on a
  given hall upgrade.
- **Gold invested buys BREADTH**: more **shop slots** (stock quantity) and access to **higher reward
  TIER-TABLES** (≈3–5 gear tiers, each random roll made on the highest table you've unlocked). So
  **level = the floor, gold = the ceiling + volume.**

**What a hall stocks (all on-theme, seeded by the class's bias metadata):**
- **Random scrolls · potions · gear**, themed to the class (its bias metadata slants the loot table);
  **gear quality scales with the highest class char-level** (the floor effect above).
- **Spellbooks are a DAILY rotation — at most 3 active + 1 passive**, any from the class list. Very
  limited and re-rolled each day: the daily refresh *is* the chase (come back tomorrow for a different
  roll). Reinforces **lottery-primary** (§3) — the shop is a *rotating* backstop, never an
  everything-store.
- **Trainers (unlock-gated):** **respec** a character (re-allocate stats / swap loadout) — **cheaper
  for members of the class, pricier for outsiders** — and **guarantee a specific ability** for gold
  (the deterministic-buy path), again **much pricier for non-members**. The member discount makes a
  class's own hall its true home.

### Bounties & the quest layer *(SETTLED 2026-06-14; the achievement-unlock engine)*
The game's **quest system** — a large part of the long game is **bounty-hunting specific dungeons for
specific rewards** — and bounties are the engine that *drives* the achievement→unlock web (§3 creation).
- **A bounty is a KNOWN-reward contract:** you see the reward *before* you accept — some combination of
  **gold · a good consumable (e.g. a spellbook) · rare-quality gear · bonus XP**. Bounties are
  **random, refresh daily, and are repeatable.**
- **First completion mints an ACHIEVEMENT** (the bounty's correlated achievement), and those
  achievements are **often the gates for unlocked content** (classes / backgrounds / dungeons). So
  bounties are *how you earn* the achievement-gated content the whole game hangs on — repeatable for
  the loot, one-time for the unlock.
- **Posted in halls, themed to the hall's bias** — a bounty's reward slants to the same loot-table
  biases that hall's shop uses. Where you grind shapes what you get.
- **The unlock web (who points where):**
  - **The Adventurer Guild Hall** (your free starter hall) is the **best source of bounties pointing
    toward the achievements that unlock other CLASSES** — the onboarding's content funnel.
  - **Each class hall's bounties** reward on-theme loot AND **funnel toward RELATED classes** (e.g. the
    Wizard hall pushes you toward Pyromancer / Cryomancer / Chronomancer unlocks).
  - **A generic Tavern** posts **fully-random bounties** — the best, most consistent route to the
    achievements that unlock new **BACKGROUNDS**.
  - **Some bounties unlock DUNGEONS** — completing one **adds that dungeon to your known list**; the
    bounty board is how the dungeon roster grows.
- **Hall-unique dungeons:** each hall likely hosts a **few signature dungeons**, mostly
  **procedurally generated, staffed by NPC versions of the class.** ⚙ **Open design thread — the
  ability↔trap parity translation:** a class's own kit, mirrored as the foe's threat layer (its
  abilities become the NPC's traps/tricks). Surmountable precisely because the information model is
  **geometric** — abilities and traps are *both* spec→spec transforms over the same board verbs, so a
  translation table is tractable.

**Generation seed = class BIAS METADATA.** A hall (shop slant + bounty pool + related-class funnel) is
**dynamically generated from a few per-class metadata fields** — bias preferences (themes, loot-table
slants, related-class pointers) that seed the loot tables, the bounties, and the unlock funnel. New
class → author its bias metadata → its hall, shop, and bounty funnel fall out. (Fits the data-driven
architecture, §4; the same spec→spec discipline as foes/abilities.)

### Achievements, the meta-reward web & base-building *(SETTLED 2026-06-14)*
The account-level meta spine — the connective tissue under the class/background/dungeon unlocks, the
guild halls + bounties (above), and the town itself. Two ideas unify it, and most of it *falls out* of
data the engine already produces.

**1. Achievements fall OUT of the mechanics — two kinds:**
- **Escalation counters (the bulk):** almost every tracked action is a counter with **tiered
  thresholds — 1 · 10 · 100 · 1,000 · 10,000** (each tier a "level" of the achievement, ~×10 the
  count). The engine already produces most (the combat `stats` block — dealt/taken/blocked/healed/sets/
  traps — + the dev instruments + run/meta events); they just need to **persist + aggregate
  account-wide**. Natural counters: kills (total / by tier / by foe / **by class** — feeds the hall
  funnel) · sets by shape & quality · dodges / wards / transmutes / traps-sprung · dungeon clears (by
  difficulty / dungeon) · depth · deaths · bounties · characters maxed · gold earned · items &
  spellbooks looted · levels gained · perfect (no-damage) clears · low-HP comebacks. The **1k / 10k**
  tiers are the months-long retention goals.
- **Milestone gates (the content keys):** one-time "first time you do X", mostly **bounty-correlated**
  (a bounty's first clear mints its achievement). These are the **unlock gates** for classes /
  backgrounds / dungeons.

**2. The BASE town is fully open from day 1; achievements gate the EXPANSION on top.**
- **The base town is FULLY OPEN at the start** (no achievement gate) and gold-upgradeable immediately:
  the **Tavern** (bounty leads — esp. background hunts), the **Bank** (storage vault, `N²` slots), the
  **Barracks** (roster / character slots), the **Temple** (healing services; Rest stays free), and the
  general shops — **Weaponsmith · Armorsmith · Trinket shop · Alchemist** (gear by slot + consumables).
  Deliberate: it gives **gold a sink from day one** (wealth always has somewhere to go *before* any
  unlock) and a **breadth of building direction so diverse you won't max it all** unless you're
  dedicated.
- **Achievements then unlock EXPANSION content on top** — new **classes, backgrounds, dungeons**, the
  **class halls** (by playing the class), and advanced amenities. *This* layer runs on "unlock the
  blueprint → gold fills it in"; the basics need no blueprint. And because it's all data-pattern,
  **adding a new dungeon or class is trivial** — author its bias metadata, the halls/bounties/shop
  slant fall out.
- **⭐ GUARDRAIL — the meta is HORIZONTAL, never a flat power multiplier.** Achievements unlock
  **ACCESS** (more classes / backgrounds / dungeons / amenities) — the achievement **badge itself is
  the bragging reward**; there is **no separate currency / cosmetic / power payout**, and **never**
  account-wide combat bonuses (+X% damage / XP / stats), which would inflate over the account's life
  and break the difference-based balance. Power comes **only from leveling a character** (per-character,
  resets on a new hero). The meta widens *what you can do*, never *how strong you flatly are*.
  (Backgrounds/classes are *option*-power — you still level into them — not multipliers.)

**Which gate applies:**
- **Base town (capacity + basic services)** → **fully open + gold only**, from the start. No
  achievement gate on storage, slots, the smiths, the alchemist, the temple, the tavern.
- **Content (classes / backgrounds / dungeons)** → **achievement-gated, and DUAL-SOURCE:** the
  achievement grind is the *guaranteed, natural-pace* path; a **rare bounty** can unlock the same thing
  *early* (the lucky shortcut). Two roads to every unlock.
- **Escalation tiers = ONLY unlock gates + bragging** — never combat, never capacity, never currency.
  The unlock value scales with the action's **RARITY**: 1,000 *damage* is trivial (bragging only),
  1,000 dungeon *clears* is enormous (a real unlock). **Each dungeon carries its own clear series
  (1 / 10 / 100): the FIRST clear usually unlocks something; 10 / 100 are bragging** (unless the class
  roster grows into the hundreds, when deeper tiers can gate too).
- **Backgrounds** lean on the **big, varied cumulative counters everyone racks up** — dungeons on a
  single character, total dungeons, total battles, items sold, all sorts — so the background space is
  broad and grindy-but-guaranteed (with the rare-bounty early-out).

**The build** = an account **COUNTER store** (persist + aggregate the engine's existing event counters,
survives death like the bank) + an **achievement-definition table** (counter + thresholds →
blueprint-unlocks; the reward IS the unlock + the badge) that feeds the creation / hall / dungeon gates,
with a **rare-bounty side-channel** to the same unlocks. Clean event aggregation — the data is mostly
already there. Lands with the B4/B5 meta-layer.

---

## 4. Data-driven architecture — YAML entities

~~Everything content-side is **declarative YAML, ingested at load**.~~ *(As built:
content lives in a **typed TS module** — `src/data/game-data.ts` against
`src/data/schema.ts` — that keeps a **YAML-portable contract**: plain-data
objects, no functions, swappable for a YAML loader later without engine change.
The declarative principle holds; the file format changed.)* This keeps
content authorable without touching engine code and makes the whole game moddable.

### Axis theming (locks the abstract axes to crawler flavor)
| Axis | Values | Theme |
|---|---|---|
| **color** | red / green / blue | element → **mana** (3 colors) |
| **shape** | Attack / Defend / Move | offense / defense / mobility verbs (gear nouns Sword/Shield/Boots stay free) |
| **number** | 1 / 2 / 3 | **magnitude** |

Resource model: **color → mana is the one spendable economy, and it's universal** —
every class uses all three mana types; only the *theming* differs per class. **Color
carries a valence:** red = aggressive abilities, blue = defensive, green = utility.
This runs parallel to the **shape** valence (Attack = offense, Defend = defense, Move =
mobility/utility), giving a 2-D identity lattice (**color-theme × shape-action**) that
build archetypes cut diagonals through (pure aggro = all-red-Attack; hybrids play
off-diagonal). **Shape stays immediate** (per-card → damage / Block / tempo, never a
banked resource); **number stays a scalar** (magnitude 1–3 multiplies output). Weapon
color-affinity (§7) feeds the color half of the lattice.

### The spine: one trigger schema, used everywhere
Abilities' reactive parts, class passives, item affixes, and enemy traps are **all
the same event→condition→effect unit** from `GAME-DESIGN.md` §3. Define it once:

```yaml
# a trigger — the universal reactive unit
on: match            # match | tick | damage | ability | room_clear
when:                # condition (optional)
  axis: color        # color | shape | number
  mode: all_same     # all_same | contains | signature | not_value
  value: red
do:                  # one or more effects
  - effect: grant_resource   # see effect vocabulary below
    resource: red_mana
    amount: 1
```

**Effect vocabulary (open, growing):** `grant_resource`, `damage_enemy`,
`advance_enemy_timer`, `enemy_attack` (immediate or `chance`), `transmute`
(the board verb), `set_bias`, `modify_stat`, `heal`, `learn_ability`, `gain_xp`.

### Entity sketches (illustrative — to iterate, not final)

> **⚠ Caution — do not author from these sketches.** They are illustrative
> design-capture only. The **real trigger vocabulary** is `src/data/schema.ts`
> (e.g. `On = 'match' | 'tick'`, different effect names) and the real content is
> `src/data/game-data.ts`. Several event names and effects below
> (`damage_enemy`, `grant_resource`, `on: lethal`, `room_clear`, …) never shipped
> in this form.

```yaml
# abilities.yaml — active verbs + (passive abilities are just triggers w/ no cost)
- id: firebolt
  name: Firebolt
  type: active
  target: enemy            # none | enemy | card | area
  cost: { red_mana: 2 }
  cooldown: 0
  do:
    - effect: damage_enemy
      amount: 6
- id: call_flames
  name: Call Flames
  type: active
  target: none
  cost: { blue_mana: 5, green_mana: 5 }
  do:
    - effect: transmute
      select: { axis: color, mode: not_value, value: red }   # destroy non-red
      bias:   { axis: color, value: red, intensity: 1.0 }
      objective: maximize_bias
```

```yaml
# classes.yaml
- id: rogue
  name: Rogue
  base_hp: 30
  ability_slots: 4
  starting_abilities: [quick_strike, backstab, smoke_bomb, dash]
  signature:               # the class set-passive (a trigger)
    on: match
    when: { axis: shape, mode: all_same, value: move }
    do:
      - effect: set_bias
        scope: next_regen
        bias: { axis: shape, value: attack, intensity: 1.0 }
```

```yaml
# foes.yaml — a base CREATURE = stats + an authored variant pool (TRAPS.md §7.1).
# A fielded foe = base creature ⊕ rolled variant ⊕ dungeon template(s).
- id: goblin               # a MINION creature
  name: Goblin
  tier: minion             # minion | elite | boss (→ trap count + stat scale)
  hp: 20
  speed: swift             # named band (TRAPS.md §7.2); resolves to a seconds range
  damage: 10
  variants: [bloodthirsty, sneaky, cowardly]   # roll ONE at spawn; the variant IS the trap
  xp: 10
  loot_tier: 2
- id: goblin_king          # the BOSS (named → authored signature traps, no variant roll)
  name: The Goblin King
  tier: boss
  hp: 90
  speed: steady
  damage: 14
  traps: [ war_cry, press_the_swarm, dread_drums ]   # 3 authored: specialist + generalist + dread
  xp: 120
  loot_tier: 5

# variants.yaml — adjective = a themed trap (+ optional ±band / stat tweak), tied to the creature
- id: bloodthirsty         # the worked example: on all-red, chance damage + warp a Defend toward red
  name: Bloodthirsty
  trap:
    on: match
    when: { axis: color, mode: all_same, value: red }
    do:                                            # PAIRED (damage+transmute) → transmute stays ≈1 card (§5.5)
      - { effect: damage, chance: 0.5, amount: 6 }
      - { effect: transmute, count: 1,
          select: { axis: shape, mode: all_same, value: defend },
          bias: { axis: color, value: red } }
- id: sneaky
  name: Sneaky
  stat_mod: { speed_band: +1 }                     # one band faster (Swift → Frenzied)
  trap: { on: match, when: { axis: shape, mode: all_same, value: move },
          do: [ { effect: enemy_attack, chance: 0.25 } ] }
- id: cowardly
  name: Cowardly
  stat_mod: { hp: -5, speed_band: +1 }
  trap: { on: damage, do: [ { effect: advance_enemy_timer, seconds: -2 } ] }   # flinches when hit

# templates.yaml — a DUNGEON-GLOBAL overlay stacked on EVERY foe (TRAPS.md §7.1)
- id: undead
  name: Undead
  stat_mod: { hp: +8, speed_band: -1 }             # tankier but slower
  trap: { on: lethal, once: true, do: [ { effect: set_hp, amount: 1 } ] }      # revenant: cheat death once

- id: swarm                # traps.yaml — shared trap palette variants/bosses draw from
  name: Swarm
  on: match
  when: { axis: number, mode: all_same, value: one }   # all_same = a dodgeable price (TRAPS.md §1)
  do: [ { effect: advance_enemy_timer, seconds: 2 } ]
- id: war_cry              # boss specialist trap (the dungeon's theme-punish; elites mirror this)
  name: War Cry
  on: match
  when: { axis: color, mode: all_same, value: red }
  do: [ { effect: enemy_attack, chance: 0.25 } ]
- id: press_the_swarm      # a TRIGGERED transmute trap (reactive herding, TRAPS.md §5.1)
  name: Press the Swarm
  on: match
  when: { axis: color, mode: all_same, value: blue }   # punish your escape color...
  do: [ { effect: transmute, count: 2,                 # ...by warping cards toward the theme
          select: { axis: color, mode: not_value, value: red },
          bias: { axis: color, value: red, intensity: 1.0 } } ]
- id: dread_drums          # boss dread / tick trap (anti-stall)
  name: Dread Drums
  on: tick
  every: 5                 # seconds
  do: [ { effect: transmute, count: 1,                 # slowly rots your board toward red
          select: { axis: shape, mode: all_same, value: defend, pick: highest_mag },
          bias: { axis: color, value: red, intensity: 1.0 } } ]
- id: molten_veins         # DAMAGE + GEOMETRIC transmute stacked in one do: (TRAPS.md §5.4)
  name: Molten Veins
  on: match
  when: { axis: color, mode: all_same, value: red }
  do:
    - { effect: damage, amount: 4 }                    # punish HP...
    - { effect: transmute,                             # ...AND warp a grid region toward red
        select: { geometry: column, which: center },   # geometry selector (5×3 grid)
        bias: { axis: color, value: red, intensity: 1.0 } }
```

```yaml
# items.yaml + affixes.yaml
- id: ember_dagger         # items.yaml
  name: Ember Dagger
  slot: weapon
  base_type: dagger        # martial weapon → base math-mod = +Attack-card damage (§7)
  rarity: uncommon
  base: { attack_damage: 3 } # flat per-card add to each Attack card in a match
  affix_slots: 2
- id: of_embers            # affixes.yaml (rolled onto items)
  name: of Embers
  tier: 1
  slots: [weapon]
  weight: 10               # generation weight
  trigger:
    on: match
    when: { axis: color, mode: contains, value: red }
    do: [ { effect: grant_resource, resource: red_mana, amount: 1 } ]
```

```yaml
# consumables.yaml + spellbooks.yaml
- id: minor_heal           # consumables.yaml
  name: Minor Healing Draught
  do: [ { effect: heal, amount: 10 } ]
  price: 25
- id: tome_firebolt        # spellbooks.yaml (consume to learn, or sell)
  name: "Tome: Firebolt"
  teaches: firebolt
  sell_price: 40
```

**Consumables — the low-friction first loot type.** The player carries **~3 consumable
slots**; consumables are **common drops** (gear/spellbooks are the rarer rolls). Two families,
most of which **reuse engine ops we already have** — that's what makes them cheap to ship:
- **Potions** = instant or over-time board/engine effects:
  insta-heal (`healPlayer`), insta-block (`gainBlock`), insta-tempo / "Move" (`pushClock` +
  Tactics), a **regen-bias refill** (`transmute` a slice with a `bias`), and **gradual
  regeneration** (a *player-side heal-over-time*). All map to existing ops **except** the HoT,
  which is the one genuinely-new bit — a small player-side `condition` tick (the conditions
  framework already exists for enemies in `TRAPS.md`; this is the friendly mirror). Other
  board/engine modifiers slot in here later.
- **Scrolls** = any class **ability** baked into a single use — reuse the `ABILITIES` roster
  (a scroll just `castAbility(id)` once, no mana cost). Trivial to author: **every ability is
  already a scroll**, so the scroll pool comes free with the ability list.
A consumable is used via a new **"use consumable"** combat action (one of the slots), dispatched
like any other action so it stays replay-deterministic.

### Consumables & player buffs (shipped — `src/engine/consumables.ts`)

The system above is built. A consumable is a registry entry with a pure
`use(state, rng, sink)` effect, spent via the replay-deterministic
`useConsumable` action. The shipped roster (~30 potions + a scroll per ability):

- **Tiered staples** (Minor / standard / Major): Healing (10/20/30 HP),
  Stoneskin (10/20/30 Block), Speed (stall the enemy 10/20/30s, bypassing the
  Move clock cap), per-color Mana (5/10/15), Rainbow Mana (2/4/6 of each).
- **Special potions:** **Invisibility** (fill the Tactics charges + freeze the
  enemy until your next Set) and **Strength** (triple your next attacking Set's
  damage).
- **Elemental cascade triad** (region-flood + payoff per matching card, 50% to
  repeat): **Fire Breathing** (flood the least-red row, damage), **Regeneration**
  (green the 2 least-green columns, heal), **Mind Reading** (blue the 3 deadest
  cards, Block).
- **Utility potions:** **Hourglass Draught** (reset the enemy clock to a full
  interval + suppress drift/DoT ticks 6s), **Prismatic Vial** (paint the rows
  red/green/blue, +1 mana per card painted), **Saboteur's Phial** (destroy the 3
  lightest cards — they reform fresh).
- **Scrolls:** every ability in the `ABILITIES` roster is automatically a
  one-shot, free-cast scroll (`scroll_<id>`) — the scroll pool comes free.

The transient **buff flags** these set live on `CombatState`
(`src/engine/state.ts`): `attackFrozen` (Invisibility — enemy clock paused until
the next Set), `nextSetDamageMult` (Strength — multiplier on the next attacking
Set), `tickSuppressedUntil` (Hourglass — `on:tick` effects paused until then).

```yaml
# dungeons.yaml + loot_tables.yaml
- id: goblin_warren        # dungeons.yaml
  name: The Goblin Warren
  difficulty: 1
  theme: { axis: color, value: red }     # the dungeon's element
  drift:                                 # global on:tick transmute → "feel" + bait (TRAPS.md §7)
    on: tick
    every: 5                             # seconds — base drift rate: 1 card / 5s
    do: [ { effect: transmute, count: 1,
            bias: { axis: color, value: red, intensity: 1.0 } } ]
  template: null           # optional DUNGEON-GLOBAL foe overlay (e.g. undead) → harder variant
  boss_mirror: war_cry     # the boss trap elites telegraph (their "@boss_mirror" slot)
  enemy_table:             # weighted creature roll (each rolls its own variant; tier from the foe)
    - { foe: goblin,      weight: 50 }
    - { foe: cave_bat,    weight: 30 }
    - { foe: goblin_shaman, weight: 20 }
  elite_pool: [goblin_brute, goblin_shaman_elite]   # drawn by the §2 elite roll, not the weight table
  boss: goblin_king
  loot_modifier: 0         # dungeon-level loot bonus
# A harder variant of the same dungeon — one global template makes every foe undead:
- id: goblin_warren_haunted
  name: The Haunted Warren
  difficulty: 3
  extends: goblin_warren   # same theme/drift/tables…
  template: undead         # …but EVERY foe gains the undead overlay (TRAPS.md §7.1)
- id: loot_tier2           # loot_tables.yaml
  rolls: 1
  entries:
    - { type: gold,       weight: 40, min: 5, max: 20 }
    - { type: consumable, weight: 25, table: consum_tier2 }
    - { type: gear,       weight: 25, rarity_table: rarity_tier2 }
    - { type: spellbook,  weight: 10, table: books_tier2 }
```

### How the entities reference each other
```
  dungeon ──drift──────────────────────────────> trap (on:tick transmute) ─┐
     │    ──template──> (every foe) ──┐                                     │
     │    ──enemy_table/boss──> creature ──variants──> variant ──trap───────┤
     │    ──boss_mirror────────────> (elite "@boss_mirror" telegraph)       ┤
  loot_table <── foe.loot_tier ──┘   fielded foe = creature ⊕ variant ⊕ template ─→ TRIGGER
  class ──starting_abilities/signature──> ability ──do──────────────────────┤   (on/when/do)
  spellbook ──teaches──> ability                                            │
  item ──base_type/affix_slots──> affix ──trigger──────────────────────────┘
```
The whole content graph bottoms out in two primitives: the **trigger** (reactive)
and the **transmute verb** (active board change) — both honoring spec→spec fairness.
Note the parallel: **foe = creature ⊕ variant ⊕ template** mirrors **item = base_type ⊕
affixes** — the enemy is assembled like a piece of gear (`TRAPS.md` §7.1).

---

## 5. Build sequence *(superseded — see `TODO.md`)*

*(This pre-migration sequence assumed growing the single-file prototype. The
actual build runs on the modular `src/` client: the trigger bus, transmute verb,
and typed data schemas are long shipped; Phase B1 (scenes + persistence) is done;
the live phase plan lives in `TODO.md`. Kept for history:)*

1. ~~Copy `set-combat.html` → `set-crawl.html`; **palette-swap only** (§1).~~
2. ~~Stand up the **YAML loader** + the entity schemas (§4)~~ — shipped as the
   typed TS data module (`src/data`).
3. ~~Implement the **trigger bus** and **transmute verb** against the data.~~ — shipped.
4. Wrap a single **room/encounter** in the run loop (enemy stats, attack timer,
   loot roll). ← *the current frontier*
5. Add **dungeon flow** (room chain, boss-chance, loot scaling), then **town**
   (buy/sell — B1 shell shipped), then **progression** (XP/levels/slots).
6. Author content; tune.

---

## 5.5 Combat resolution, Tactics (v2) & the Flee retreat — *shipped in `src/`*

The per-room combat model. ~~Values below are prototyped and live in
`prototype/set-combat.html`.~~ *(Now shipped in the modular client —
`src/engine/resolve.ts`, `tactics.ts`; live constants in `TUNING.md`.)* Treat
numbers as tuning defaults.

> ⚠ **SUPERSEDED IN PART by ROUNDS v3 (§5.6, settled 2026-06-11, next combat build):**
> the continuous clock (approach→windup→strike), the swap-spin-up rule, excess-timer
> income, Adaptive Tactics, `DMG_REGEN_MS`, and the speed bands all restructure under
> the round grammar. This section remains the SHIPPED baseline until v3 lands.

**Per-card resolution — RESOLUTION v2, "sets steer, stats carry" (SETTLED & BUILT
2026-06-10; Model B from the pacing design session).** The character sheet carries the
numbers; a matched set CHOOSES and AIMS the action. Each card in a found set fires its
shape's STAT, scaled by the card's magnitude read as QUALITY:
- **Stat block: Power / Endurance / Speed** (`StatBlock`; base 2/2/2 = exact parity
  with the old card-magnitude system; gear/levels grow them — the B3 power curve).
- **Quality:** ① glancing ×0.7 · ② solid ×1.0 · ③ heavy ×1.4 — per card:
  `value = round(stat × quality)`. At base stats per-card values are 1/2/3.
- **Attack → round(Power × q) damage** — DETERMINISTIC now (no roll): a set always
  delivers exactly what it reads; the deliberate-grind direction. (`weightedRoll`
  remains for enemy strikes and ability rolls.)
- **Defend → round(Endurance × q) Block** (a persistent barrier).
- **Move → round(Speed × q) clock-push seconds** + 1 Tactics charge per Move card.
- **Color → mana** by signature: all-same color → 3 of that mana; all-different → 1
  of each. Mana stays pure board economy (no stat touches it — caster identity).
- *Why:* decouples output from scan speed (a slow player executes the same build at
  lower tempo — speed buys tempo, not existence), makes gear/levels load-bearing,
  softens the death spiral. Decided WITH the commercial-positioning lens (deliberate
  strategic grind > perception-gated twitch for the Steam roguelite market).

**The telegraphed exchange (the clock rework, same session).** The steady invisible
cadence is replaced by a readable exchange loop: **approach → windup → strike.**
- **Approach:** the clock runs as before; Move pushes work (capped, overflow→charges).
- **Windup** (the last `windup` seconds — default 4, per-foe authored: Behemoth 8,
  King 6, Butcher 6): the strike is **pre-rolled and REVEALED** (`incoming`, the ⚔N
  telegraph in the HUD) and the clock is **COMMITTED** — Move pushes apply 0 and
  convert fully to charges. Counterplay: raise Block to meet the known number, ward
  the shatter, or kill first. Nothing dodges a committed strike.
- **Strike:** lands EXACTLY the telegraphed amount, then the next approach begins.
  Un-telegraphed hits (`instant_attack` trap effects) still roll fresh — traps stay
  surprising; the clock stays honest.
- Speed bands slowed + damage raised across the roster (fewer, weightier, readable
  exchanges — see TUNING.md): lumbering 24 / slow 19 / steady 15 / swift 12 / frenzied 9.

**Resource caps (and the adaptive deal).**
- **Block ≤ max HP.** The barrier can hold up to your HP (block never exceeds the cap) →
  generation steers the shape axis away from Defend when Block is full. The excess isn't
  fully wasted: **overcap block converts to Tactics charges** (see v2 below), and the
  **Sentinel** passive *also* spills the full overflow into a weighted attack — both stack.
- **Enemy clock ≤ 20s.** Move can't push the next attack more than 20s out — but the
  overflow seconds are **no longer wasted**: they convert to Tactics charges (below),
  so a maxed clock keeps Move a fair, useful draw. Distinctness still caps realized
  skew (the §3-style saturation governor), so the board never goes mono.
- **Mana ≤ 15 per color** (NEW with Tactics v2; gear may raise it later). Storing and
  chaining 2–3 big casts stays a valid strategy; gains past the cap are a **pure loss**
  (deliberately: no excess-mana income — see v2 income rules). Excess healing at full
  HP is likewise pure loss.

**TACTICS v2 — charges & the two tactics** (settled 2026-06-09/10; supersedes the v1
armed meter, kept below for history). Tactics is the **board-control discipline**: a
**charge queue** fed by play, spent by whichever **tactic** you've selected. This is
the player-side mirror of dungeon drift — a literal tug-of-war over the board's
composition — and it makes TRAPS §5.5's reshape-share *directly playable*.

- **Income (charges):**
  - **+1 charge per Move CARD in a matched set** — a shape-rainbow set always contains
    exactly one Move (steady trickle for every archetype); an all-Move set pays 3.
    Magnitude stays tempo-only (boots push the clock; charges count cards, flat).
  - **+ excess timer:** clock-push seconds wasted against the 20s cap convert ~1:1.
  - **+ excess block:** block past max HP converts (default 1 charge per 2 excess).
  - **Nothing else.** No excess-mana or excess-healing income (pure loss, see caps).
- **The queue:** charges queue up to a **cap of 5** (overflow wasted) and spend
  **serially, one at a time** (~0.8s between spends, tunable) — never a batch flash;
  the eye can follow every change. Deadest-card evaluation re-runs after each spend.
  Deterministic: spends resolve on reducer ticks (replay-safe).
- **The two tactics** (pick ONE; its sub-UI shows its parameter):
  - **⚔ Maneuver** *(active shaping)* — each charge transmutes the **deadest**
    non-conforming card toward your chosen **bias** (sub-UI: axis/value picker —
    any color, shape, or magnitude; uses the standard `patchFavor` weights, so the
    §3 saturation governor still applies).
  - **🛡 Stand Ground** *(passive integrity)* — charges **bank** (same cap of 5);
    each hostile **board verb** that fires — dungeon drift tick, enemy transmute,
    lock, wound-shatter — consumes one banked charge and **fizzles**. Never absorbs
    raw damage (that's Block's lane); dread ticks still hurt, the board just holds
    its shape. Sub-UI: the banked pips.
  - **Swapping tactics RESETS your charges to 0** and takes a few seconds (~3s
    spin-up, tunable) before accumulation resumes. Picking your tactic is a
    commitment — that's what makes greed-vs-integrity a real decision.
- **Remaps from v1:** Vigilance-style `drain_tactics` effects drain queued/banked
  charges; the Invisibility potion's "fill the meter + pause drain" becomes "fill
  the queue (+5 charges), enemy frozen until your next match"; the Warlord's
  Tactician passive is replaced by **Adaptive Tactics** (your charges PERSIST through
  a tactic swap, no spin-up — the stance-dancer); the tutorial's Tactics stage
  teaches Maneuver. §7's Move affixes re-anchor on charge income / queue cap.
- **Tactics' lane vs class floods — still resolved: keep the overlap, re-shaped.**
  Maneuver is the slow, free, full-board **tide**; Call-type abilities are instant,
  regional, mana-priced **waves** (see the Calls tiering in §3-adjacent ability
  notes / TODO). Drip vs splash, same ocean — running both is the control loop.
- ⚠ Watch in tuning: Maneuver(green) smooths sustain loops, and a pinned clock
  (Chronomancer) is the premier excess-timer engine — the **structural anti-stall**
  (FABLE §8.1) ships with/before this system.

*v1 (superseded, for history):* Move matches rolled into a 0–10 meter that ARMED six
one-shot board-flood buttons (Attack/Defend/Move/Heat Up/Chill Out/Go Wild), draining
0.5/sec once armed (use-it-or-lose-it). Constants were `TACTICS_GOAL=10`,
`TACTICS_DRAIN=0.5`/sec. The meter's overlap-with-floods doctrine carries forward;
the use-it-or-lose-it pressure is replaced by the swap-commitment rule.

**ABILITY TRANSLATION to v2 + the Calls tiering** (the batch's authoring map; names
and costs are placeholders the designer will rename — mechanics are the spec).

Audit result: of the 23 shipped abilities, **only Rally touches the meter** — every
other ability is built on clock-pushes, transmutes, and damage, all of which survive
v2 untouched. So the table is mostly KEEP:

| Disposition | Abilities |
|---|---|
| **KEEP unchanged** | firebolt, frostbolt, heal, block, fireball, glaciate, wildgrowth, callflames, callfrost, callwilds, cleave, berserk, rampage, bulwark, quickstrike, smokebomb, thornwall, venomstrike, thornvines, coldblade, riposte, timewarp |
| **RE-ANCHOR** | **rally** — "bank 4 Tactics" is meaningless in v2. New form (per design direction — a deadest targeter): *Rally — the 3 deadest cards answer the call: under **Maneuver** they churn toward your chosen bias now; under **Stand Ground** they dig in as heavy Defends.* Same cost slot; the tactic-aware dual mode makes it the Warlord's signature bridge into the new system. |
| **RE-ANCHOR (consumable)** | **Invisibility** — "fill the meter + pause drain" → "fill the queue (+5 charges); enemy frozen until your next match". |
| **RE-ANCHOR (passive)** | **Tactician** → **Adaptive Tactics** (charges persist through tactic swaps, no spin-up). |
| **NOTE (tuning watch)** | The stall kit — timewarp / glaciate / frostbolt / smokebomb / thornvines — now *generates income* via excess timer. Intended (Move-flavored classes run charge-rich) but these numbers get a look in the tuning pass. |

**Tier 1 — the generic Calls (shared, board-wide, the teaching versions).** The three
color Calls (shipped) + three NEW shape Calls, costs mirrored at 8 total mana,
weighted toward the shape's kin color (Attack↔red, Defend↔green, Move↔blue):
- **Call to Arms** `[4,2,2]` — every non-Attack card → max-magnitude Attack (the burst enabler).
- **Call the Shields** `[2,4,2]` — every non-Defend card → max-magnitude Defend.
- **Call the Hunt** `[2,2,4]` — every non-Move card → Move. ⚠ The hot one: a Move
  flood feeds the charge queue — watch its cost/queue-cap interaction first.

**Tier 2 — class-signature geometric Calls (the boss-pick / spellbook content, B4).**
Same verb, smaller region, sharper identity, cheaper — the geometry selector
vocabulary (row/column/border/inner/diagonal/corners — already engine-built, today
enemy-only) handed to players. Power ≈ region size ≈ cost; the saturation governor
already polices all of them. One seed sketch per class (names/costs placeholder):
- Pyromancer — **Wall of Flame**: the center *column* → red.
- Cryomancer — **Glacial Front**: the *border* → blue.
- Druid — **Overgrowth**: the *inner* region → green, light magnitudes.
- Spellblade — **Cross-Cut**: a *diagonal* → Attack, small damage per card converted.
- Chronomancer — **Stasis Rank**: the top *row* → blue/Move.
- Berserker — **Hone**: the bottom *row*'s magnitudes → 3s (heavy everything).
- Sentinel — **Shield Wall**: the *border* → Defend.
- Warlord — **Battle Line**: the bottom *row* → Attack.
- Rogue — **Ambush**: the four *corners* → Move.
The relationship to Maneuver is deliberate: Maneuver is the slow free full-board
*tide*; Calls are instant regional mana-priced *waves*. Drip vs splash, same ocean.

**Flee — the retreat mechanic** (resolves the §6 loss-condition retreat path). The
old standalone Flee *meter* (toggle Fleeing mode, farm Moves to 10, decay + lockout)
is **superseded**. **Built:** Flee is a **standalone, any-time button** (top-right of the
foe header) — *not* gated by the Tactics meter, so retreat is always available; confirm-gated
since it forfeits the encounter (sandbox: a flee-success end screen). It was briefly an armed
Tactic during the feel pass, then pulled out so escape never depends on first banking Tactics.
The retreat *penalty* is **settled (2026-06-09)** — see **§6 "Loss condition / the exit
ladder"**: a parting blow + the room's reward forfeited, falling back to the between-rooms
fork (run continues; encounter rerolled, elite counter reset) rather than ending the run.

---

## 5.6 ROUNDS v3 — the 20-second round grammar (SETTLED 2026-06-11; next combat build)

The temporal grammar that supersedes §5.5's continuous clock (approach→windup→strike).
Grew out of the Move/Defend-distinctness thread (TODO, 2026-06-10/11): the draw-phase idea,
generalized — **all three verbs round-batch**. The axiom: **round length is THE pacing
constant** — every other combat time number denominates in rounds, not seconds. Planned
constants staged in `TUNING.md` ("Rounds v3 — PLANNED"); code remains v2 until this builds.

**The round (20s, tunable).** Matches accumulate by shape verb; nothing cashes until the
exchange. Stats still carry (Model B per-card math, §5.5):
- **Attack matches** → the player's exchange swing (per card `round(Power × q)`, summed).
- **Defend matches** → mitigation of THIS round's telegraphed hit. Block past the
  telegraph (or the HP cap) is **PURE LOSS** (settled 2026-06-11 — no charge trickle:
  the faucet belongs to the Speed contest, and over-matching Defend is a visible skill
  cost the player learns to read). The one paid exception: Sentinel's Overflow passive
  spills the overcap into a weighted attack — class identity, priced at a slot.
  UI cue (the wheel batch): the block badge goes **"sated"** once it meets the
  telegraph, so the waste is learnable. The round is one continuous allocation
  question: kill faster vs blunt the known hit.
- **Move matches** → Tactics charge points (the Speed contest — see Resolution v3 below).
- **Round reset:** Attack/Defend accumulators and the Maneuver bank zero at the
  exchange; mana, the Stand Ground bank, and HP carry. Each round is a fresh question.
- **Speed's job — SETTLED (2026-06-11):** Speed is the **agency stat**, contested
  against the foe's Speed for charge income (Resolution v3 below). The clock-push
  era is fully closed.

**Live mid-round** (the real-time half of the grammar):
- **Mana + spells** — instant, outside round ordering; the panic-button slot Move used
  to own. Anything dropping the foe to 0 HP ends the battle on the spot.
- **Traps / tricks** — fire on matches via the trigger bus, as today.
- **Dungeon drift** — ambient pressure, unchanged.
- **Stand Ground wards** — intercept live (the wall stands all round).
- **Board refill** — instant and **NEUTRAL** (mid-round regen drops the player-bias
  tilt; `BIAS_W` expresses ONLY through the Maneuver rollover dump). The round
  *degrades* — you cherry-pick the juice, drift drags, traps scar — the deal *redeems*.

**The rollover** (≈ 4.5s, diegetic, choreographed in staged DRAINING transfers — **never a
modal, no button, ever**; playtest-raised from ≤2.5s: the pause must be FELT, each quantity
seen moving — banked swing → foe HP, telegraph → guard → HP, then the tide and the deal):
1. **Player swing** — the Attack total lands. **Lethal cancels the enemy swing** (the
   kill-race: rushing lethal under a big telegraph is valid play, rewarded via passives/
   gear). Symmetric: a player who would die but banked lethal wins the exchange.
2. **Enemy swing** — telegraph minus the Defend total; damage *suffered* computes wounds.
3. **Maneuver dump** — all charges burn (stance economy below).
4. **The deal** — gaps fill, one wound reforms, churned cards settle.
5. **Next telegraph reveals + the queued stance locks.** The breath; next round's plan forms.

**Foe speed = round BEHAVIOR, not round length.** The speed bands (24…9s) retire. Every
foe gives the same 20s of scan; quickness becomes exchange cadence — and cadence is not
authored but **DERIVED from the statline by the tempo law** (Resolution v3 below): swarm
chips, clean hits, or every-Nth-round giants, all from Speed−Power. The telegraph is part
of the deal, so Defend allocation is a decision, never a guess. This is the structural
fix for the quick-foe sweet spot: scan pressure was the problem, and it's gone.

**The stance economy — banker vs dumper.** Charges accumulate in EVERY stance (income
above). The stances differ in their relationship to the bank AND in resolution timing:
- **🛡 Stand Ground** (wheel center) — **spends live**: each hostile board verb that
  fires (drift tick, enemy transmute, lock) fizzles for **1 charge**; each incoming
  **wound** fizzles for **3 charges**. **Carries its remainder across the rollover.**
  No rollover effect — stuck with whatever luck draws out and what your own spells and
  consumables trigger.
- **⚔ Maneuver** (the six spokes) — **never wards**; drift runs unopposed. At rollover
  it **burns ALL charges**: N charges redraw the **N deadest cards NOT already matching
  the bias**, each redrawn to the bias value on that axis (other axes random). Biasing
  Blue on a Red-heavy board converts dead Reds/Greens to Blue — undeadening the existing
  Blues fast. The bank zeroes.
- **Charge cap 15** (raised from v2's 5 — settled 2026-06-11). The number is exact on
  both ends: a full bank soaks a maximum 5-wound haymaker (5 × 3 = 15) precisely, and a
  full Maneuver dump rerolls the ENTIRE 15-card board toward your bias precisely. Cap =
  board size = max exchange ward cost — one number, three readings. Filling it is a
  multi-round arc (income runs a few charges per round), so the full-bank play is an
  earned spike, not per-round routine. **Defend allocation remains the PRIMARY wound
  prevention** (wounds key to damage *suffered*, so turtling cuts them at the source);
  SG's wound-ward is the deep reserve you build toward. If the dump holds more charges
  than non-matching cards exist, the excess burns unused (the board is already yours —
  the bank still zeroes, per the rule).
- **The stance locks at the draw phase** (the wheel mid-round queues NEXT round's pick).
  Load-bearing, not flavor: free swapping enables the obvious cheese — Stand Ground all
  round, flip to Maneuver at second 19, dump, collect both benefits. The lock kills it.
  It also enables the legitimate cross-round line: turtle two rounds banking behind
  wards, then flip and dump a full-bank tide. *Supersedes the swap-spin-up rule entirely.*

**The Tactics wheel (the widget).** One control, seven states, one tap:
- **Center: Stand Ground** — a braced stick-figure icon, classic bracing-for-battle.
- **Top arc (shape biases):** Attack · Defend (top-middle) · Move — "steer what I can DO."
- **Bottom arc (color biases):** Red · Blue (bottom-middle) · Green — "steer what I can CAST."
- Selecting a spoke = selecting Maneuver with that bias (the v2 verb-then-parameter
  two-step collapses into one gesture). Lit spoke = the locked current stance; ghost
  spoke = queued for the deal.
- **Magnitude bias is CUT — deliberately**, not by wheel geometry: heavy boards come
  only from gear/Hone (B3). `grasping`/`covetous` now tax drift-luck and gear greed only.

**Wounds — computed, never authored.** Both laws derive from one quantum, `maxHP/10`
(the decimal rebase — HP 100, stats 10 — lands WITH v3 so the laws read clean):
- **Inflict:** `wounds = floor(damageSuffered / (maxHP/10))`, summed **per exchange**
  (a frenzied ⚔4×2 wounds off the 8 total, never two floored swings), **cap 5 per
  exchange**. Chip hits (<10%) never scar; a 50% haymaker = 5 wounds — if you saw the
  telegraph and didn't turtle, that's the lesson.
- **Repair:** any heal also repairs `ceil(heal / (maxHP/10))` wounds. Floor-on-damage /
  ceil-on-heal is deliberately player-generous; both sides are one law, so tightening
  is a constant change, never a data audit.
- **Recovery:** one wound reforms per draw phase; ALL reform at combat end.
  (`DMG_REGEN_MS` retires — another seconds-constant rebased to rounds.)
- ⚠ Invariant: wounds (≤5) + locks combined must still leave ≥ FLOOR makeable sets —
  assert the worst case in the headless sim; a combined concurrent cap may need a number.
- **Coach hook:** a player under a match-count threshold who takes ≥4 wounds in one
  exchange gets a cooldowned reminder (every X occurrences) to Stand Ground / turtle
  when big damage is telegraphed. Rides the explain-mid-play tutorial variant (TODO).

**Ability/passive remaps (the v3 translation):**
- **Adaptive Tactics → "Combined Arms"** (Warlord; total rewrite — swap-spin-up is dead):
  **+1 bonus charge on any shape-rainbow set**. A rainbow carries exactly one Move card,
  so it nets 2 charges vs all-Move's 3 — but delivered Attack+Defend value in the same
  match: the flexible-commander identity, rebuilt on income.
- **Rally / Vigilance / Invisibility** survive re-denominated (they drain/fill the same bank).
- ⚠ OPEN: the **clock-push verbs** (timewarp, glaciate, frostbolt, smokebomb, thornvines —
  the stall kit) lose their target with the clock. Candidates: shave the telegraph
  (⚔N−X — time magic slows the blow), delay/skip a foe's exchange round, or convert to
  charges. Settle in the v3 translation pass. Chronomancer's excess-timer-engine note
  (§5.5 ⚠) dies with the income rule.

**RESOLUTION v3 — the stat contests + the tempo law (SETTLED 2026-06-11; engine built).**
Foes carry the same **Power / Endurance / Speed** block as players, and every per-card
value is an **opposed-stat rate × quality** — one stat pair per lane, each stat used
exactly once per direction (no double-dipping):
- **Attack card** → `rate(your Power, their Endurance) × q` banked toward the exchange.
- **Defend card** → `rate(your Endurance, their Power) × q` banked as Block.
- **Move card** → `rate(your Speed, their Speed) × q` banked as charge points (fractional
  under the hood; the gauge shows whole pips). A fast foe suppresses your board game —
  not your eyes.
- **The telegraph** is the foe's own Power expressed: round budget = `Power × K`,
  un-discounted (the contest is felt through your block math, not double-counted).
- Rates are **difference-based with clamps** (legible + bounded under gear; ratios
  compound viciously). At parity (10 vs 10) an Attack/Defend card is worth `8 × q` —
  a magnitude-6 set ≈ 25, the even-exchange quantum. Constants in `TUNING.md`.

**The TEMPO LAW — attack behavior derives from the statline.** `Speed − Power` picks the
packaging while Power fixes the per-round budget (damage conservation): diff ≥ +4 → 3 chip
swings/round · −1..+3 → 2 swings (equals → two hits) · −4..−2 → one clean hit ·
−7..−5 → every 2nd round at double budget · ≤ −8 → every 3rd round at triple (the
Behemoth: certain death on a visible schedule). Packaging is mechanically real through
the wound law — swarms chip below the quantum and never scar; giants concentrate damage
and scar hard — and it seeds the B3 affix taxonomy (flat per-hit reduction = anti-swarm;
wards/burst = anti-giant). An authored override field stays available for exceptional
foes; derivation is the default.

**The 6/6/6 baseline axiom (the balancing anchor).** Casual/baseline play = one
magnitude-6 set per verb per round (~a match every 6–7s; measured experienced play runs
4–6 sets/round, so competent ≈ ×2). At stat parity and baseline play the exchange is
even: a mag-6 Defend set neutralizes the average telegraph, a mag-6 Attack set deals the
baseline quantum (~25). **Tiers are output multipliers** — minion balanced at ×1.0
baseline output, elite ×1.5, boss ×2.0 — so skill and gear are interchangeable
currencies against the ladder. First-cut foe stats are tier-anchored (TUNING.md);
kill budgets per tier are the open derivation-sheet item.

**The feel target (user, 2026-06-11 — keep verbatim):** "you play the round in a quick
frantic pace making matches, resisting the drift, using spells. You probably bias toward
the high cards, and they run dry as you match and you hunt for best options as quick as
you can, and it drifts, and by round end the board is a little weak and gross. That's
when your tactics come in, and suddenly draw reset, you go from the held breath
inhalation of the action to the sighing exhaling relief as your tactics trigger and the
board redraws fresh with possibility. Or you resolutely stand your ground the entire
time, reducing the churn in your foe's favor but being stuck with whatever luck draws
out and what you can trigger with your own spells and consumables."

**Numbers sanity (fourth-playtest anchored):** sets/min ran 12–17 → roughly 4–6 sets per
20s round, comfortably over the workshop's ≥3 decisions-per-exchange floor. The dev
instruments grow a **sets/round** readout; re-read reshape share and spring rate after v3
lands (the rollover dump changes who moves the board, and when).

---

## 5.7 Speed, the guard & the live tide — combat amendments (SETTLED + BUILT 2026-06-12)

> **STATUS: shipped 2026-06-12** (engine + UI; 106 tests). LIVE: deal-time dodge (DODGED! card +
> 💨 tags + free-round cue), guard-carry + early telegraph reveal (the savings test), Maneuver
> live-burn (stances go live; gather-in / instant-bail), the start-grace Speed rider. DEFERRED:
> the **parting-blow** Speed rider — it waits on the flee parting blow (a B2 exit-ladder item).
> Constants in `TUNING.md` (Rounds v3 table). The spec below is the as-built design.

The progression workshop surfaced two structural reads: **Speed under-buys** (`MOVE_RATE_K` is
~1/10th of `RATE_K` per point) and **slow foes overperform their budget** — the guard zeroes
every rollover, so against a `strikeEvery: 3` giant two rounds of board-forced Defends are
wasted *by rule*, then one round of Defend income faces a triple budget. The round-scoped guard
vs. multi-round threat mismatch, not the statline, is the difficulty skew. The settled package:

- **The distinctness law, amended:** *Speed owns WHETHER/WHEN; Defend owns HOW MUCH.* Speed may
  negate **whole swings** (binary, timing-flavored) but never does partial mitigation — Defend's
  territory stays intact. (This is what the old "Move never denominated in HP" law was reaching
  for; the Dodge-*stance* stays dead.)
- **Dodge — rolled at the DEAL, folded into the telegraph.** Each foe swing independently checks
  the Speed-diff dodge chance *at telegraph time*; dodged swings vanish from the revealed ⚔
  (💨 swing tags). Determinism-at-reveal — the same pattern as the already-random `weightedRoll`
  strike: the player always plans against a true number. The asymmetry falls out free:
  single-swing giants fully whiff with chance *p* (the spike-relief moment); multi-swing foes
  shed swings smoothly (full whiff = *p*^swings). Dodge applies to **strikes only** — never
  traps, drift, or dread ticks (Speed does not buy out of the board game). **Stat weight:
  charges + dodge JOINTLY ≈ a P/E point** — dodge alone can't carry parity (the EV math needs
  ~+8–10%/pt, which is a difficulty toggle, not a stat). First cut: base ~10% at parity,
  clamped, per-point K set with the re-denomination.
- **Dodge feedback is a DEAL-TIME smash card.** A full whiff slams **"DODGED!"** over a paused,
  dimmed board — sprite sidestep, the foe read shows *swinging at shadows*, and the guard cell
  flags a **FREE ROUND** ("no need to Defend" is *displayed*, not implied). Partial dodges tag
  the telegraph 💨×N.
- **Crits: deferred to gear/abilities (B3+).** Player set output stays deterministic — "a set
  delivers exactly what it reads" holds hard. If crit ever exists it's a deterministic gear hook
  (e.g. a Speed-keyed relic: "your exchange swing crits when you banked ≥ 30").
- **The guard CARRIES through windups.** `strikeEvery > 1` foes reveal their strike at windup
  start ("⚔75 — lands in 2 rounds"); Block persists across the windup rounds, **capped at the
  revealed telegraph** (the sated cue marks the stop), and drops only after a strike resolves.
  Slow foes become a **savings test** (the Punch-Out fantasy); fast foes stay the cash-flow
  test. Off-turn Defends become meaningful instead of insulting.
- **Maneuver goes LIVE-BURN.** Replaces the rollover dump (the playtest record argued for it:
  churns ≈ 0 across the warren sweep — a back-loaded payoff that usually never landed). Maneuver
  burns **~1 charge/sec** into the deadest-first churn toward your bias, starting after a short
  **gather** (~1.5–2s — damps wheel-drumming). **Bail-out is asymmetric:** swapping back to
  Stand Ground is INSTANT — keeps the remainder, stops the burn, resumes warding (the panic
  button always works); *entering* the tide pays the gather. Maneuver still never wards — its
  cost is now legible in real time (you watch wards not-happen while you're greedy). Burn rate
  is the scan-stability dial (fallback 1/1.5–2s if the board reads as a river). The tide beat
  shrinks to knit/deal/stance-lock; **the exchange gets LOUDER**.
- **Speed riders:** the flee **parting blow scales down with Speed edge** (Speed = the escape
  stat; lands with the exit-ladder build) · the pre-round **start grace stretches** with Speed
  edge ("you size them up") — ⚠ **superseded 2026-06-13: this migrates to *round-1 length*** (Speed =
  initiative, `clamp(20 + ΔS, 15, 25)`s; the start grace itself becomes the untimed voluntary-
  activation preview — see §2 "Between-rooms approaches") · B3 gives Speed its gear hooks.
- **Presentation direction:** big Persona / Mörk Borg-style **smash-art declarations** (DODGED!,
  the exchange beats) over a paused, dimmed board + sprite acting — extends the existing
  bamWord impact-card system; reduced-motion falls back per the established pattern.

---

## 5.8 The dread escalation — the structural anti-stall (SETTLED 2026-06-13)

> **STATUS: BUILT 2026-06-14** (engine + functional UI; 145 tests). LIVE: the meter (`dreadLevel` =
> `dreadFloor` + 0.5·round, depth floor from the delve band, OFF for coach fights), drift accel
> (`driftRateMult` scales the tick rate), the two-way ramp (`dreadFoeMult` folds into the telegraph
> AT REVEAL + trap/tick damage · `dreadPlayerMult` on attack + heals), the generic unguardable
> `dreadBleed` (bypasses Block, per round past the onset), the two-motion dread meter HUD. Constants
> + helpers in `state.ts`; sim-validated (§7 damage + §10 drift). Settled + SIM-VALIDATED 2026-06-13
> (`sim/progression-sim.mjs` §7). Closes the long-open structural anti-stall (`FABLE.md` §8.1; the old §2.4
> ramping-DoT idea). Constants tabled in `TUNING.md` ("Dread escalation — PLANNED"). The sim
> confirmed the calibration (band past the kill budgets), the inert-backstop property (ON ≈ OFF for
> normal fights), and the anti-stall bite — and corrected the design: **the foe ramp rides the
> UNGUARDABLE lane** (trap/tick), since sated guard neutralizes a pure telegraph multiplier. This
> supersedes the per-foe `dread_drums` DoT as the *load-bearing* anti-stall — authored dread ticks
> survive only as optional theming on top of the global rule.

**The goal is ACCELERATION + DRAMA, not punishing the stall.** (Reframed 2026-06-13.) Stalling is
already self-defeating — you want the foe dead *fast* to reach the loot; an indefinite-heal turtle
wins nothing, so we don't need to force-kill it. What the meter does is **push every fight toward a
determined outcome** and **manufacture the dread-driven swing moment** — the board turns chaotically
against you, your damage is escalated by dread *and* low HP, and you rip a flurry of attack matches
to one-shot the foe before it finishes you. The "hard counter to forever-stalling" framing is
demoted; *acceleration toward a good-enough resolution* is the real job.

The mechanism is **one unified `dread` meter (1–10)** driving two lanes with different jobs:
**drift = soft, atmospheric tension** (it can never threaten HP — the FLOOR invariant forbids it,
see §6 / `TRAPS.md` §6) and **a two-way damage escalation = the resolver** (the one axis the FLOOR
can't protect). Drift makes a long fight *feel* dire; the damage ramp accelerates it to a close.
The two are separated on purpose — don't ask drift to do the killing.

- **The meter (`dread` ∈ [1,10]).** Two stacked components:
  - **Depth floor `D₀`** — the run's across-run threat, read from the cumulative boss-total
    (the existing dread *bands*, §2): quiet → 1, drums → ~2.5, throne-stirs → ~4, he-is-near
    → **5 (hard cap)**. Set per room, persists across the run, resets at Town. **Capped at 5
    on purpose** — depth alone gets you into the *tense* zone but **never into the damage band**
    (≥7). The lethal top half of the meter is *always* earned by dragging the fight in front of
    you, not by how deep you are.
  - **Within-fight rise** — `dread = clamp(D₀ + DREAD_RISE × round, 1, 10)`, climbing each
    round from the deal. **Resets to `D₀` at fight end** (no half-enraged state carries to the
    next room; flee resets the rise but the depth floor stands, since the boss total advanced).
- **Lane 1 — drift (soft / flavor), accelerates past the knee.** Drift cadence = `base ×
  driftCurve(dread)`: gentle and near-flat through `dread ≤ 5`, then **steepening past the knee
  at 5** toward the `TRAPS.md` §6 net-transmute ceiling (≤ ~0.3–0.4 c/s — even max dread cannot
  break the makeable-set floor; the budget is the wall). Quantized to the **rollover** (N pulls
  at the round boundary, N off the curve) — consistent with v3 retiring the continuous clock;
  the old "next pull in Ns" countdown is gone. This is the mounting-tension read: the board rots
  faster the longer you stay, Stand Ground has more to ward, the music darkens — but nobody dies
  from it.
- **Lane 2 — the two-way damage multiplier (hard / the anti-stall), engages LATE.** Off until
  `dread ≥ DMG_ONSET` (**7**), then ramps **linearly to max at dread 10**:
  - **Foe damage ×1.0 → ×2.0** · **Player damage *and healing* ×1.0 → ×1.5.** The multiplier
    is a global "everything resolves harder, split by side" knob; it touches damage both ways
    **and player heals** (so sustain scales with the player's 1.5 while incoming scales 2.0 →
    a heal-equilibrium stalemate breaks decisively toward the house, by construction).
  - **⚠ THE FOE SIDE MUST RIDE THE *UNGUARDABLE* LANE (the sim's load-bearing finding,
    `progression-sim.mjs` §7).** Scaling only the *telegraphed strike* does **nothing** to a
    turtle — sated guard simply caps at the inflated ⚔ and the bite stays 0. So the foe ×2.0
    applies to **all foe-dealt damage including trap-hit and dread-tick damage** (the lane that
    bypasses Defend — the original §2.4 "clock you cannot pause", now ramped by the meter).
    That unguardable half is what actually accelerates the close; the telegraph half just bites
    players who *can't* meet the guard. The multiplier does **NOT** touch **drift** (a transmute —
    no HP — stays purely soft lane 1). Dodge/guard/Stand Ground still function against the bigger
    numbers (skill extends your tolerance; the asymmetry still wins).
  - **THE GENERIC `dread bleed` — a foe-independent baseline drain (settled 2026-06-13).** Because
    the foe ramp routes through the unguardable lane, the bite would otherwise *depend on the foe's
    trap kit* — a trap-light foe would have weak teeth. So the dread escalation contributes its
    **own** guaranteed unguardable drain past the onset: a small per-round HP bleed
    (`DREAD_BLEED`, ∝ maxHP, 0 below dread 7 → its max at dread 10), present **regardless of the
    foe's traps**. This is the generic, split-out anti-stall — decoupled from threat-layer
    authoring; authored traps/ticks ride *on top* as flavor. It's the clean primitive the design
    converged on: a universal dread bleed, not a per-foe DoT.
  - **It folds into the telegraph AT REVEAL**, so the shown ⚔ stays honest (v3 invariant): a slow
    foe's windup-revealed strike bakes the dread-at-reveal multiplier and that frozen number is
    what lands.
  - **Two-way, not enemy-only, on purpose:** the fight accelerates toward *resolution* in both
    directions — a player who's close to the kill gets their 1.5× to finish (a climactic
    power-surge, not just punishment), a player who's losing dies faster. And the asymmetry
    (2.0 > 1.5) **self-protects against the reverse-exploit**: deliberately dragging to nuke
    with your 1.5× is always net-negative, because the foe's 2.0× outpaces it.
  - **First cut caps at dread 10** (foe 2.0× / player 1.5× + the `DREAD_BLEED` max). We do **NOT**
    chase an absolute kill-the-turtle guarantee (the reframe: an indefinite-heal build wins nothing,
    so it needs no force-kill) — the sim confirmed the ramp breaks *realistic* sustain (≤~15%/rnd
    heal), which is the point. If a future build trivially out-heals even the bleed, that's a
    sustain-*number* cap to fix at the source, not a reason to crank the ramp into normal-fight
    territory.
- **Calibration anchor — the damage band sits PAST the kill budgets** (A6: minion 2.5 / elite
  5 / boss 10 rounds). At `DREAD_RISE ≈ 0.5/round` a *shallow* fight (`D₀ = 1`) reaches the
  onset (dread 7) around **round 12** and max around **round 18** — minions never approach it,
  a normal boss kill barely grazes it, only a genuine drag bites. A *deep* fight (`D₀ = 5`,
  near the throne) reaches the onset in ~4 of its own rounds — which is the **boss-climax
  feature**: the run's deepest, most dramatic fight starts tense and ramps to a both-sides
  climax, a natural finite finale rather than a silent timer. Depth shortens the patience
  window; it never removes it.
- **Presentation — the meter telegraphs its own teeth (the v3 ethos).** Render the two motions
  distinctly: the depth floor as a **filled base**, the within-fight rise as a **rising
  overlay**, with the **knee (5)** and the **damage onset (7)** marked on the gauge so "past
  here it turns lethal" is *visible* before it happens. Dread crossing 7 wants a beat — the
  board-edge darkens, a Mörk-Borg-register cue ("the dark presses in") — so the gloves coming
  off reads as earned drama, not a sudden spike.

---

## 6. Open questions

- ~~⭐ **rework Move's core**~~ — **RESOLVED: the Tactics meter (§5.5).** Move now
  banks into a use-it-or-lose-it Tactics meter that arms one-shot board transmutes —
  a board-control engine, distinct from Defend's "don't-die" role. (Close to the old
  option (a) banked-tempo, but generalized to a meta-resource rather than a green
  utility pool.) Tactics' overlap with class floods is **kept** (a control-loop
  feature, §5.5). The Move *affixes* (§7 Windstep / Stalker's) now re-anchor on
  **Tactics** ("a fraction of Move tempo → Block", "+dmg scaled by banked Tactics")
  instead of the unreachable clock cap.
- ~~**⭐ NEXT — build the enemy-trap half of the trigger bus**~~ — **DONE** (`src/engine`,
  `TRAPS.md`). Enemy traps/tricks fire on the bus, render as the trap strip (with an
  "armed" pulse when a springing line is on the board), and the four board verbs
  (destroy / transmute / lock / conditions) are live. Combat now reads the board *against*
  the enemy's traps — the design thesis (`GAME-DESIGN.md` §0) is built. The **NEXT** build
  is the crawl shell around combat (run loop / second screens — see `TODO.md`).
- ~~**Loss condition**~~ — **RESOLVED (2026-06-09): the exit ladder.** A run's four
  exits are strictly ordered — each rung clearly worse than the one above, so "one
  room deeper?" is always a live gamble:
  1. **Cash out (between rooms only).** After clearing a room you may leave with
     everything — run inventory and gold carried this run bank, XP banks. **Delving
     commits you to room 1**: there is no free back-out once you enter (this is what
     structurally kills the scout-and-reroll loop, so honest play needs no penalty).
  2. **Flee (mid-fight) — the run does NOT end.** You take a **parting blow** (the
     foe's pending attack resolves as you turn your back; clamped so flee can never
     kill — min 1 HP), you **forfeit the room's reward**, and you fall back to the
     between-rooms fork: the next room's encounter is **rerolled** and the **elite
     sawtooth counter resets to base**. From the fork: press on or cash out home.
     *Intended play:* a timid player can duck an elite and farm minions for early
     gold/XP — paying HP per duck, since the parting blow scales with the foe.
  3. **Death.** The run inventory and all gold carried this run are **lost**, plus a
     **tithe: ~12% of banked gold** (settled 2026-06-12; a recovery fee). **XP always
     banks, even on death** — the struggling player still inches forward. Equipped
     gear and the hero survive. True permadeath is deferred to a future *opt-in*
     hardcore flag (the roster already supports it cheaply).
  - Corollaries: **gold found mid-run is carried, not banked** — it banks on any exit
    except death (this rule is most of the dread-meter's teeth). **Town Rest stays
    free, permanently** — gold's sinks live elsewhere (base-building amenities, shop
    gear, consumables, learning abilities; see §6 economy note). **A fled room DOES
    advance the boss running-total** (settled — boss % keys to encounters *entered*,
    §2), and the boss, once appeared, persists through flees (§2). The tithe is settled
    (~12%, §3); the **parting blow scales down with the player's Speed edge** (§5.7 —
    Speed is the escape stat).
  - ⚠ Interaction flag: free Rest + flee-farming + in-combat sustain builds
    (Druid/Sentinel healing loops) = unbounded minion farming with no attrition. This
    raises the priority of a **structural anti-stall** (universal soft-enrage /
    per-room time pressure — `FABLE.md` §8.1) from "balance concern" to "B2 companion."
- ~~**Boss room**~~ — **resolved: the boss *replaces* the enemy that room would have
  generated** (its own fresh encounter), not an appended extra room (§2).
- ~~**Resource mapping** for shape & number axes~~ — **working resolution: single
  spendable economy.** color→mana is the only banked resource (universal, valence-themed
  — §4); shape stays immediate (per-card damage/Block/tempo), number stays a scalar.
  Revisit only if martial builds feel resource-thin in play.
- ~~**Trap condition default**~~ — **resolved in `TRAPS.md` §1–§2:** `all_same` for
  punishing traps (rare, dodgeable, a *price*); `contains` reserved for *reward*
  triggers. Full trap vocabulary, the severity∝rarity law, consequence families, the
  counter-foe recipe, and the four board verbs (destroy / transmute / **lock** / —)
  all live in `TRAPS.md`.
- **Ability slots vs. known abilities** — do you *learn* a growing library but only
  *equip* slot-many? (Implies a loadout screen in town.)
- **Cooldowns vs. resource-only** gating for actives.
- ~~**Level/XP curve, HP curve, gold economy balance.**~~ — **SETTLED 2026-06-12: the
  progression package (§3).** Cap 21 (★), +5 HP & +3/+2/+1 allocated stats per level, XP
  computed from the foe statline (×2/×4 elite/boss), curve anchored dummy→2 / gauntlet→3 /
  warren = fresh level 3; loot = category-first nested tables with depth scaling + gear pity;
  tithe ~12%. First-cut numbers sim-gated (`TUNING.md`).
- ~~**Mana persistence**~~ — **resolved: HP is the only cross-room persistence
  layer.** On entering each room, **everything except HP resets** — mana, Tactics, and
  any active DoTs/dread all clear to zero; HP carries over (the run's attrition clock).
  Caster builds rebuild their pool every encounter (bounds snowballing), dread is
  strictly per-room pressure, and each room is a clean tactical reset on top of a
  persistent health total. The reset is **archetype-symmetric** — casters lose mana,
  tanks lose Block, Move-builds lose Tactics — so no archetype is singled out by it.
- ~~**Trap resolution order**~~ — **resolved: dungeon drift first, then the foe's
  traps in listed order.** A match (or tick) resolves the dungeon-global trap first,
  then each foe trap top-to-bottom as authored on the foe — so trap order on the foe is
  a deliberate design lever (e.g. transmute-then-punish vs. punish-then-transmute).
- **Inventory limits**, gear comparison UX.

---

## 7. Gear (clean-slate — SETTLED 2026-06-15)

> Reworked from the ground up via a design session. The durable bones of the old taxonomy survived
> (two-effect model, slot personalities, rarity→affix, weapon color-affinity); what was deleted: the
> raw-stat power channel (→ **flat per-card riders**), the clock/meter-anchored Move affixes (→ the
> Tactics wheel + Speed riders), and the pre-rebase numbers. **All magnitudes are first-cut, GATED by
> ONE coupled sim pass** — gear power + the ability economy + the foe-difficulty raise are inseparable
> (the balance-log finding). Set bonuses deferred.

### The power model (the keystone)
- **Gear's primary power = flat per-card RIDERS, rarity-scaled with big jumps** — NOT raw stats. (A raw
  +stat runs through the `rate()` contest and barely moves; a rider hits *per card × cards/set ×
  sets/round*, so it's far bigger AND bounded — it never scales with the contest.) Weapon → +damage per
  Attack card · Armor → +Block per Defend card · caster gear → +mana per [match].
- **Foes are balanced against your RARITY-CURRENT rider level** — the power you reach just by equipping
  your best drops, *no build knowledge required*. Nobody gets walled; the smith's rarity-upgrade lets you
  **buy your floor current** on unlucky streaks.
- **Affixes are UNPRICED upside** — they scale with rarity but are **NOT counted in foe tuning**. So
  build skill + card skill are the *over-performance reward*, never the price of admission. This is what
  lets us raise foe difficulty (the balance-log fix) without ever walling a casual builder.
- **Gear is ~⅓ of effective combat power** (up from the old ¼ — safe to push up *precisely because* foes
  balance against it, so it's the expected baseline, not an unfair edge). The exact share is a numbers lever.

### Item anatomy (two effect classes — the durable bones)
`slot + base-type + rarity + affixes[]`. Every item touches the game in exactly two ways:
1. **Base math-mod** — the rarity-scaled per-card rider above (+ the slot's signature) + a small native stat.
2. **Affixes** — `event→condition→effect` rules on the **same trigger bus** the enemies/classes use (zero
   new machinery), PLUS raw-stat affixes (below).

**Rider ↔ the v3 contest:** a rider adds **FLAT, *after* the `rate(yourStat, theirOpposed) × q` contest**
— bounded (doesn't scale with the rate), which is exactly why riders are fair where raw stat-stacking isn't.

### The 5 slots
**Weapon** (payoff) · **Armor** (defense) · **Relic/offhand** (augments / alt-verbs) · **Trinket ×2**
(flex economy). Each owns a mechanic personality; the small native stat aligns to the slot (Weapon → a
touch of Power, Armor → Endurance, a Trinket → Speed) so a full kit spreads P/E/S. (5 slots = the
raw-stat budget; ~+25% gear stat-share before affixes, more with off-stat affixes.)

### Weapon — base damage (both schools) + a match-type bonus
- **Base, ALL weapons, school-agnostic: +damage per Attack card** (rarity-scaled, big). **Casters hit
  exactly as hard** — same base rider, flavored as magical.
- **Type = which of the 4 Attack-set color outcomes it rewards** (every Attack set is one of these four)
  — martial adds **damage**, caster converts that slot into **mana**:

| Attack match | Martial (+damage) | Caster (+mana) |
|---|---|---|
| all-**red** | **Axe** | **Wand** |
| all-**blue** | **Mace** | **Orb** |
| all-**green** | **Spear** | **Staff** |
| **rainbow** (all-diff) | **Sword** | **Tome** |

### Armor — COLOR is the magic axis, WEIGHT is the physical axis
The asymmetry (weapons + caster armor are color-typed; martial armor is weight-typed) is **intentional
and intuitive, not an inconsistency**: **color = the magic/offense pattern** (weapons of both schools;
caster "defense" is really mana-generation, which is magic), **weight = the physical-defense pattern**
(martial armor — "red plate" would read *worse* than heavy-vs-light). The split also gives the schools
genuinely different build structures — **martial = color-weapon + weight-armor (two axes); caster =
mono-color (one axis, reinforced)** — which deepens identity.
- **Martial armor — weight trades Defend ↔ Speed, soak ↔ Tactics:** **Plate** (big +Block/Defend, −Speed,
  soaks more raw damage) · **Chainmail** (medium, neutral) · **Leather** (small +Block, +Speed, feeds
  Tactics charges instead of soaking).
- **Caster armor — mana by color; the SQUISHIEST tier (the school's cost):** lower +Block/Defend than even
  Leather, **no Speed bonus** — it just generates mana on Defend. **Regalia** (green) · **Vestments**
  (blue) · **Robe** (red) · **Cassock** (rainbow → mixed/any-color mana on all-diff Defends). Casters are
  glass — their burst + flexibility is **paid for in fragility**.

### Relic (offhand) + Trinkets — augments & flex economy
- **Relic:** Shield (room-start Block / first-hit negation) · Crossbow (Move→damage) · Oil (Attack DoT
  rider) · Dagger (bonus hit on rainbow Attacks) · *(caster)* Focus / Tome (−ability cost / +mana / spell power).
- **Trinkets ×2:** rings · amulets · **Boots** (Move/Speed riders, **re-anchored on the Tactics WHEEL +
  the Speed riders** — dodge / initiative — *not* the retired clock). Flex economy, deal-bias (a passive
  refill `FavorBias` — the locked-board-safe reframe of the old "deal-odds" gear), triggers.

### Rarity → rider + affix count; loot-tier → affix power
`grey (rider ×0, 0 affix) → white (×1, 1) → green (×2, 1) → blue (×3, 2) → purple (×4, 3) → orange (×5,
3 + a named unique)`. Rarity scales the **base rider + affix count**; **loot-tier** (foe lvl + dungeon
lvl) scales **affix power**. The transformative **build-around** affixes concentrate at blue+ (esp. the
orange named uniques) — the "smooth base, build-around top" curve.

### Affixes — triggers AND stat-patches
The affix pool is slot-gated (`affixes.yaml` `slots:`/`weight:`). Two families:
- **Trigger-granting** (the build-around mechanics): riders, conditional procs, alt-verbs.
- **Raw-stat boosters, including OFF-STAT** — "Armor of Strength" (+Power on armor), a "Defender" weapon
  (+Endurance), etc. — to **patch a stat your base gear doesn't natively give**. (Off-stat is fine: raw
  stat, bounded by the rate clamp, and it lives in the unpriced affix layer.)

### Class affinity — one CLASS-side field, two jobs
Each **class** declares an `affinity`: preferred **gear types** (e.g. Axe + Heavy + martial) and preferred
**affix families**. This single field drives both:
- **The soft school lean** — off-affinity gear still works, just suboptimal (a caster *can* swing an Axe —
  the hybrid texture, not a wall).
- **The class-hall loot bias** (the reason gear precedes finishing classes) — a hall biases its loot toward
  its class's affinity (Pyromancer hall → red/caster gear + fire affixes). New class → author its affinity
  → its hall biases itself. (Affinity is class-side, so gear stays class-agnostic — one tag system.)

### The smith — an upgradeable crafting bench (lottery + a deterministic backstop)
Drops are the exciting primary faucet; the smith is the **targeted backstop + gold sink**. Capabilities
unlock and cheapen as you **upgrade the smithy** (a base-building amenity — achievement unlocks the
blueprint, gold tiers it), at escalating prices:
- **Upgrade rarity** (grey→…→orange) — raises the base rider + opens affix slots. The "keep my floor
  current / level a beloved base" path + the main raw-power gold sink.
- **Enchant** — set one chosen affix into an open slot (targeted, expensive).
- **Reroll affixes** — gamble all affixes (cheaper, RNG).
- **Transfer / extract** — move a rolled affix onto a better base (premium, top-smithy operation).

### The ability economy — COUPLED to gear (the caster-balance fix)
Caster gear pumps mana → mana buys abilities, so the ability economy must be balanced *with* gear:
- **Abilities are CONTESTED** — damage/effects scale `rate(yourStat, theirOpposed) × …` like card sets
  (no fixed nukes, so caster spells are bounded by the same contest a martial's attack faces).
- **Priced as a throughput-neutral REDIRECT** — a unit of mana buys ≈ the value you'd have gotten making
  the match directly. So **more mana ≠ more DPS**; it buys **flexibility + burst** (bank to the 15 cap,
  unload). Casters = bursty / flexible / fragile, throughput-equal to martials — *not* stronger.
- **The pricing currency** (first cut from the validated model — 1 unit = 1 damage to the foe):

  | Effect | Value (dmg-equiv) | Grounding |
  |---|---|---|
  | damage to foe | **1.0** | the unit (+ a slight win-condition premium) |
  | Block / Heal | **~1.0** | a Defend set (25 block) ≈ an Attack set (25 dmg); heal +small flex premium |
  | Tactics charge | **~3.5** | wards a wound (3 chg → ~10 HP) / board verbs |
  | delay (1s of round) | **~3.75** | the extra set-making it enables (~75 dmg/round ÷ 20s) |
  | favorable transmute | **~3–5/card** | the set-quality/findability bump |
  | **mana (VPM)** | **≈ 4** | anchored to the 15-cap burst ≈ 2.4 attack sets ≈ 60 damage |

  **Ability cost = value ÷ VPM** (a 40-dmg spell → 10 mana · a 40-HP heal → ~10 · a 1-round delay → ~6 ·
  churn 3 cards → ~3). Caster gear generates **~4 mana / color-match** (throughput-neutral vs the martial
  weapon's color-damage bonus). This is closed-form from the model; **firm it empirically in the sim pass.**

### Deferred
- **Set bonuses** — themed 2/4/6-pc families (a parallel cross-build vector to spellbooks). The clean
  second wave once base gear + affixes + crafting prove out.

### The coupled balance pass — DERIVED 2026-06-15 (`sim/progression-sim.mjs` §11)
Gear power + ability throughput + foe difficulty derived *together* (they only make sense relative to
each other). First-cut, sim-backed:
- **Gear riders (Part 1):** weapon base **+0 / +1 / +2 / +3 / +4 / +5 damage per Attack card** (grey→orange,
  ×3 a set) → **0 → 38% of attack power** (orange ≈ ⅓, the target). Armor mirrors it (+Block per Defend
  card). These flat per-card riders ARE the gear-power channel (a raw +stat barely moves the contest).
- **⭐ The foe-difficulty raise (Part 2) — THE "combat too easy" fix:** foe **HP + telegraph × a gear
  factor** `= (25 + 3·expectedRider(L)) / 25`, keyed to the rarity you're expected to carry at that level
  (~1 rarity tier per 3.4 levels): **×1.00 (grey) → ~×1.6 (orange).** Validated: it takes the geared
  *baseline* boss from a too-easy **70–88%** back to **~36% ≈ the bare-intended ~32%** (curve restored),
  while a *skilled* geared player over-performs at **~74%** — the build/card-skill reward, by design.
  (Minions/elites stay fodder, but their kill *time* is restored — no more 1-round kills.)
- **Ability effect values (Part 3, empirical marginal win-rate):** **damage ≈ heal ≈ 1.0** (the
  high-value effects — heal even edges damage when you're losing) · **Block ~0.2** (heavily discounted by
  waste + the sated-guard cap) · **Tactics charge ~0** (⚠ a strong empirical restatement of the
  Speed/Tactics under-value problem — see below). Values are **context-dependent** (survival is worth more
  when losing); price abilities off the *throughput* basis (damage:heal ≈ 1; block/charge cheaper).
  **VPM ≈ 4 dmg/mana** (15-mana burst ≈ 60 dmg ≈ 2.4 sets); ability cost = value ÷ VPM.
- **The Speed/Tactics under-value — FIX DECIDED (`Primed`):** the sim shows marginal Tactics charges
  ≈ 0 (warding is low-value at the margin; Maneuver's churn value is invisible to the model). Fix: adopt
  **Primed** — a Maneuver-churned card matched within ~6s counts one quality tier higher (≈ **+2.8
  dmg-equiv/charge**, up from ~0), converting Speed's board-control into measurable OUTPUT *in-lane*
  (Braced — charges→mitigation — is OUT, it breaks the §5.7 distinctness law). Implement WITH this pass
  (it raises player output → folded into the foe-difficulty raise). Stand Ground warding stays
  situationally valuable vs the dread/drift pressure (the calm-fight sim under-credits it).
- **Still open:** affix power per loot-tier, the off-stat affix magnitudes, set-bonus tuning (deferred).

## 8. Deferred (next session)

- *(open — pick the next thread from §6's remaining open questions, or start coding
  the §5 build sequence)*
