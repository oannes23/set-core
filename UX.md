# UX.md — the combat play area, re-examined at 1080p

A high-level UX analysis of the combat screen (`src/ui/app.ts` `buildPlay`/`buildCastPanel` +
`styles.css`), written 2026-06-12, just after the **tri-counter** build (the verb accumulators
⚔/🛡/⚙ as the primary HUD strip above the board — taken as a **given** throughout). Target
viewport: **1920×1080**. The brief: group the layout by psychological game-design and
graphic-design principles, offer options from radical to minor, steal from the genre's best.

The pillars this must serve (CRAWL §5.6, TODO):
- **Deliberate strategic grind** — not twitch. The UI should reward reading, not reflexes.
- **The round as breath** — inhale (frantic matching) / exhale (the choreographed exchange).
- **Sets steer, stats carry, stats contest** — the accumulators ARE the resource; everything
  else is meta guiding them.
- **Telegraph-driven allocation** — the round is one question: kill faster vs blunt the known hit.

---

## 1. Inventory & audit — what exists, where, and what it costs

Current combat column, top to bottom (left 2/3 of `.play`; the rail is the right 1/3):

| # | Element | Built in | Placement | Audit |
|---|---|---|---|---|
| 1 | **Foe header** (`.headpanel`, 195px min) — sprites 🧙/👹, stance badge, foe name + desc, Flee | `buildPlay` | top, full width | The only "set dressing" zone, and the coach popover's anchor. But it holds foe *identity* while foe *vitals* (HP), foe *threats* (trap strip), and foe *intent* (telegraph) live three bands away — a textbook **Gestalt proximity** violation: four fragments of "the enemy" that the eye must reassemble. The sprites react to board events they sit far from. Flee is correctly quiet (progressive disclosure done right). |
| 2 | **Combat bar** — You HP + buff badge vs Enemy HP | `buildPlay` | band 1 | Two opposed gauges sharing one row reads well. But "You" HP belongs to the player zone and "Enemy" HP to the foe zone — the row is a convenience grouping, not a semantic one. The buff badge (👻/💪/⏳) is an orphan: tiny, label-less, discoverable only by noticing it. |
| 3 | **Foe band** — round bar (Round N · clock · track) + telegraph chip ("their strike ⚔N") | `buildPlay` (Task-1 shape) | band 2 | Good post-merge: the ATB-style bar and the strike it counts down to are now one read — *theirs/time*. The clock's low/crit colors carry the pre-exchange urgency. Weakness: it sits between two *player* bands (HP above, traps/counters below), so the yours/theirs zoning is felt only by color, not by position. |
| 4 | **Tug bar** — board composition differential | `buildPlay` | band 3, conditional | The least legible instrument on screen: a 7px track whose meaning (enemy-theme share vs your-bias share) is explained nowhere in-flow. It appears only when both ends exist, so most fights never show it — and when it does appear it reads as noise. Candidate for demotion into the sprites alone (which already walk the same number) or a hover-tip-only detail. |
| 5 | **Trap strip** — trap/trick/drift chips, armed pulses, drift countdown | `renderStrip` | band 4 | High-value: the armed pulse is the §2.5 sweet spot (danger is live, *which line* stays earned) and the drift countdown gives the tug a rhythm. But it's the foe's rulebook sitting inside the player's stack, one more proximity break. Chips are text-heavy at small sizes; the `td` description is unreadable at a glance and duplicates the briefing. |
| 6 | **Tri-counter** (NEW) — ⚔ banked attack · 🛡 guard (✓ sated) · ⚙ tactics /15 | `buildPlay` | band 5, directly above board | The primary read, correctly adjacent to the thing that feeds it (**Fitts**: zero travel between cause and effect; **proximity**: the resource sits on the field that produces it). Verb colors match the card glyphs — **Gestalt similarity** doing real work: red swords on cards → red ⚔ number. The cells ring as values land; the exchange drains the same numerals — one ledger, never two places. This is the anchor any future layout must keep. |
| 7 | **Board** (5×3, max-width **500px**) + float layer | `renderBoard` | center of band 6 | THE play surface — and it's capped at 500px inside a 1000px wrap on a 1920px screen: the core loop occupies **~26% of the horizontal viewport**, cards ~92×123px. Everything else in this audit is meta; the thing the player stares at for 17 of every 20 seconds is the smallest major element. This is the single biggest signal-vs-noise budget error: the noise got the pixels. |
| 8 | **Dev instruments** row | `renderDevStats` | band 7, dim | Correctly styled as a non-feature. Stays dev-only; excluded from all layout options below (it pins to wherever the board is). |
| 9 | **Rail: Tactics** — 15 charge pips + the wheel (164px) | `buildCastPanel` | rail top | The wheel is a genuinely good control (7 states, 1 tap, queue ghosting). But Tactics state is now smeared across three surfaces in two zones: ⚙ count (tri-counter, left), pips (rail), wheel (rail). The pips' 3-grouping (one warded wound each) is a lovely detail nobody is told. |
| 10 | **Rail: Abilities** — mana pips in the header, 3-col grid, passive chips | `buildCastPanel` | rail middle | Mana — the *panic-button lane*, the only instant resource — is three tiny numbers in a panel header. The spark flight (board → pip) teaches the economy beautifully, but the standing read is the weakest of any resource. Ability slots light gold when ready (good pre-attentive pop against the dim board). Passive chips pulse on proc — nice, but they're static text the rest of the time and compete for rail space. |
| 11 | **Rail: Consumables** | `buildCastPanel` | rail lower | Fine. Same click-to-use grammar as abilities; color-tinted identity. Slightly stranded at the rail's bottom — it's a combat verb, not an inventory readout. |
| 12 | **Rail: Combat log** (220px max) | `log`/`loggroup` | rail bottom | Correctly archival (newest-on-top, grouped per action). But mid-fight it's a wall of small colored text duplicating what floaters/bams/bursts already said louder. It earns its place in post-hoc reading ("what just killed me?"), not in the live loop. |
| 13 | **Overlays** — floaters, mana sparks, ripple, center bursts, BAM words, board flashes, low-HP vignette, sprite reactions | various | body/board layers | The feedback stack is rich and mostly well-prioritized (`FLASH_PRI`, coalesced flushes, staggered bursts). Two budget concerns: ① the **center burst** (trap/trick infographic card) parks over the board mid-round — the one moment the player must re-scan (the board just changed!) is the moment a card covers it. ② Stance state renders in three places (wheel lit, board-edge aura, sprite badge) — redundancy that was added as a "volume-up" pass and could consolidate once one surface proves primary. |

**Eye-path, mid-round:** board (center-low) → tri-counter (one saccade up) → board. Mana check
costs a long saccade up-right to a 13px number; trap check a medium one to band 4. Acceptable, but
the scan loop's "home" is bottom-center while half the meta lives top-right.

**Eye-path, exchange:** flag stamps over the board → ⚔ drains in the tri-counter while foe HP
drains in band 1 (a full-column vertical span) → telegraph (band 2) drains into guard (band 5) —
another span → board tide (center) → round stamp. The spectacle is good but plays across ~700
vertical pixels; the drains pull the eye in a zig-zag rather than a duel line. A layout where
"mine" and "theirs" face each other would let the exchange read as a *collision* instead of
an elevator ride.

---

## 2. The attention model — who owns each phase

Four phases per round; each should have ONE owner and a known supporting cast
(**cognitive-load minimization**: at most one new thing asks for working memory per phase).

| Phase | Duration | What the player must do | Should own the screen | Supporting cast | Today's friction |
|---|---|---|---|---|---|
| **① Round-start read** | ~1.5s (the deal) | Ingest the new telegraph; confirm the locked stance; first board scan | The telegraph reveal + round stamp | stance-lock flash, fresh board | Telegraph pulse is a small chip flourish in band 2 while the eye is on the round stamp (board center). The two should land in one fixation. |
| **② Mid-round scan loop** | ~12–15s | Hunt sets; route them by verb intent; resist the bait | The board, ~90% | tri-counter rings (peripheral confirmation), armed trap pulses, drift countdown | Mostly right post-tri-counter. Mana remains an off-loop read. Center bursts interrupt the scan at its most fragile moment. |
| **③ Allocation check** | last ~5s | "Does ⚔ kill? Does 🛡 meet ⚔-theirs? Dump or hold ⚙?" | Tri-counter **vs** telegraph, side by side | clock crit color, foe sprite winding | The two halves of the question sit 4 bands apart. The sated ✓ and LETHAL states answer it *if* you fixate both. A computed **bite preview** ("you'll take 5") would answer it in one glyph — see Into the Breach below. |
| **④ Exchange spectacle** | ~6s | Nothing (locked) — *feel* the consequences | The choreography, full field | drains, BAMs, tide, knit | Strong already. Wants spatial compression (the duel line) more than more juice. |

The phase grammar is the round-as-breath pillar made spatial: ②'s owner (the board) must be
visually *biggest*; ③'s owner (the counters/telegraph pair) must be *adjacent*; ④ may
legitimately seize everything.

---

## 3. Genre references — specific lessons

**Slay the Spire — the energy/block/intent triangle.** The genre's telegraph standard: intent
icons hover *on the enemy*, block badges *on the portrait shield*, energy bottom-left as the only
spend gauge. Everything reads at its owner's body. Lesson: **attach state to its actor**. Our
telegraph belongs visually to the foe (header/sprite), not to a neutral band; our guard belongs
beside our avatar or our counter — never both. StS also proves players happily do exact-number
arithmetic (intent 12 vs block 8) when the two numbers share a fixation group.

**Balatro — score assembly as celebration.** The chips×mult ledger lives in one fixed left-rail
spot; every scoring event tweens *into that ledger* with escalating juice. The numbers don't just
update, they *perform* — but always on the same stage. Lesson: our drain-tween grammar is right;
keep ALL of it on the tri-counter (one ledger, one stage) and let magnitude scale the juice
(already partly true via `--sc` on BAM words). Never spawn a second place where damage counts.

**Hearthstone / MTG Arena — opposing halves.** The duel is legible before you read a single
number: their stuff top, your stuff bottom, the battlefield between, hero portraits as the two
anchors. Lesson: **vertical mirroring is free semantics**. Our current single column interleaves
yours/theirs four times; a top-foe / center-board / bottom-player zoning would delete most of the
labels ("their strike", "You") because position would carry the meaning.

**Inscryption — the diegetic table.** Scale, bell, candles: every UI element is an object on the
table, so affordances teach themselves and atmosphere is structural, not decorative. Lesson for
the radical option: the exchange scoreboard *wants* to be a physical object (a scale that tips as
⚔ banks against the telegraph); the wheel already half-is one (a dial). Diegesis also future-proofs
the dungeon-crawl fantasy better than panels ever will.

**Classic ATB JRPGs (FF4–FF9) — the wait-bar as tension.** A filling bar beside each actor's name
made "whose moment is coming" a glanceable, dread-building read. Our round bar IS an ATB bar and
the Task-1 foeband (bar + telegraph in one row) is exactly this lesson: the bar counts down *to
the strike beside it*. Keep them fused in every future layout.

**Into the Breach — perfect-information allocation.** The entire game is visible enemy intent plus
exact outcome previews; the player's turn is pure allocation. Closest spiritual match to ROUNDS v3.
Lesson: ITB never shows raw inputs when it can show the *resolved consequence* — the strongest
cheap addition here is a computed **bite preview** on the guard cell or foe band:
`⚔12 − 🛡7 → you take 5 (1 wound)`. One number that collapses phase ③ into a glance, and it
makes the wound quantum legible before it ever lands.

---

## 4. Three layouts at 1920×1080

All three assume: tri-counter stays the single player ledger; dev row stays dev-only and rides
with the board; the coach/briefing layer is accounted for per option.

### 4a. RADICAL — the duel table (full diegetic re-frame)

Foe domain top, battlefield center, player cockpit bottom. Everything is an object; the side
panels dissolve into the table dressing. Hearthstone zoning + Inscryption materiality.

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│  ╔═ FOE DOMAIN ═══════════════════════════════════════════════════════════════════╗  1080p │
│  ║   [foe art / sprite, large]   GOBLIN WARLORD ★elite          ⚔ INTENT: 12       ║        │
│  ║   ████████████░░░░ 84/120     "drums and frenzy…"            (on a raised claw, ║        │
│  ║   trap sigils hover beside the art: ⚠🔥  ⚠⛓  ✦               StS-style)         ║        │
│  ╚═══════════════════════════════════════════════════════════════[round bar ▓▓▓░ 7s]═╝     │
│                                                                                            │
│   ┌─ log scroll ─┐      ╔════════════ THE TABLE (board ~880px) ════════════╗   ┌─ belt ─┐  │
│   │ (pull-out    │      ║   ▦   ▦   ▦   ▦   ▦      cards ~165×220px        ║   │ 🧪 🧪  │  │
│   │  parchment,  │      ║   ▦   ▦   ▦   ▦   ▦      floaters/BAMs here      ║   │ 📜     │  │
│   │  collapsed   │      ║   ▦   ▦   ▦   ▦   ▦                              ║   │        │  │
│   │  by default) │      ╚══════════════════════════════════════════════════╝   └────────┘  │
│                                                                                            │
│  ╔═ PLAYER COCKPIT (a carved console, one object) ═══════════════════════════════════╗     │
│  ║  [you, avatar]   ❤ ████████░░ 72/100    ⚔ 18 │ 🛡 7 ✓ │ ⚙ 9/15  (three gauges     ║     │
│  ║   🧙 + stance     buffs: 💪×2            set INTO the console, drain like dials)   ║     │
│  ║  ( WHEEL as a physical dial )  ( mana as three VIALS 🔥3 🌿1 ❄6 )  [🔥][🌿][❄] abils ║   │
│  ╚════════════════════════════════════════════════════════════════════════════════════╝   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

The exchange plays as the table's centerpiece: the banked ⚔ slides UP the table into the foe, the
intent slides DOWN into the guard, the tide washes the cards — a literal collision on the duel
axis instead of today's zig-zag.

- **Cost:** weeks, art-gated (real foe art, console art, dial/vial rendering). New CSS regime
  (full-viewport zones, not a 1000px wrap). Mobile needs a separate reflow.
- **Risk:** high. Every coach selector, the popover anchor (`positionCoachPop` targets
  `.headpanel`), the briefing modal, and the section gates need re-pointing; the tutorial script's
  spatial language ("above the board") needs a copy pass. Easy to lose a year of feel-tuning juice
  in the port.
- **Payoff:** identity. This is the screenshot that sells the game; diegesis compounds with the
  crawl fantasy and the planned pixel duelists. The yours/theirs semantics become positional and
  free. Phase ③ becomes a single vertical fixation (cockpit gauges ↔ intent claw).
- **Tutorial/coach:** rebuild the anchor map; the cockpit actually *improves* coaching (one
  spotlight target per lesson: "this dial", "these vials").

### 4b. MODERATE — three bands + side rails (re-zone what exists)

Same components, re-zoned: foe band top, board center (finally big), player band bottom; the
rails take the archival/secondary surfaces. No new art required — this is CSS and DOM moves.

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ ╔═ FOE BAND ════════════════════════════════════════════════════════════════════════════╗ │
│ ║ 👹 Goblin Warlord ★    HP ████████░░ 84/120    their strike ⚔ 12    Round 3 ▓▓▓░░ 7s   ║ │
│ ║ ⚠ Frenzy Totem · ⚠ Caltrops · 🌫 drift (next pull 3s)                        [🏃 Flee] ║ │
│ ╚═══════════════════════════════════════════════════════════════════════════════════════╝ │
│ ┌─ LEFT RAIL ──────┐   ┌────────────── BOARD ~820px ──────────────┐   ┌─ RIGHT RAIL ────┐  │
│ │ Combat log       │   │     ▦    ▦    ▦    ▦    ▦                │   │ TACTICS         │  │
│ │ (the archive —   │   │     ▦    ▦    ▦    ▦    ▦                │   │  wheel + pips   │  │
│ │  full height,    │   │     ▦    ▦    ▦    ▦    ▦                │   │ ABILITIES       │  │
│ │  earns its rail) │   │   cards ~155×205px · floaters · stamps   │   │  🔥3 🌿1 ❄6     │  │
│ │ dev row (dim)    │   │                                          │   │  [grid] passives│  │
│ └──────────────────┘   └──────────────────────────────────────────┘   │ CONSUMABLES     │  │
│ ╔═ PLAYER BAND ═════════════════════════════════════════════════════╗ └─────────────────┘  │
│ ║ 🧙 You  ❤ ████████░░ 72/100  💪×2   │  ⚔ 18  │  🛡 7 ✓  │  ⚙ 9/15 │                      │
│ ╚═══════════════════════════════════════════════════════════════════╝                      │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Key moves: wrap widens to ~1700px for combat; the headpanel, enemy HP, telegraph, round bar, and
trap strip **fuse into one foe band** (proximity repaired in one stroke); player HP + buffs join
the tri-counter in a **player band** under the board (the cockpit's panel-styled ancestor); the
log gets the left rail at full height (it stops competing with controls for the right rail);
the command surfaces keep the right rail. Tug bar retires into the sprites/hover detail.

- **Cost:** ~a day of markup/CSS surgery plus a feel pass. Zero engine change; every existing
  ref id and event hook survives (elements move, ids stay).
- **Risk:** medium-low. The coach popover re-anchors to the foe band (same element, new shape);
  section gates (`[data-sec]`) move intact. The exchange choreography improves for free — swing
  drains bottom→top, counter top→bottom, a real duel axis. Watch: the board at ~820px makes card
  motion (flutter/rattle) larger — may need amplitude retuning.
- **Payoff:** ~80% of the radical option's legibility for ~10% of its cost. Board area roughly
  ×2.6. Phase ③ becomes two fixations on one vertical line (player band ↔ foe band).
- **Tutorial/coach:** survives with selector touch-ups and 2–3 copy edits ("above the board" →
  "in your band").

### 4c. MINOR — targeted regroupings of what exists

Keep the single-column flow; fix the worst proximity and budget errors in place.

```
┌──────────────────────────────────────────────────────────┐╌╌ (wrap widens 1000 → 1200px)
│ FOE HEADER  👹 name/desc · sprites · [Flee]              │
│             + enemy HP moves UP here, beside the name    │
│ ──────────────────────────────────────────────────────── │
│ You ❤ ████ 72/100 💪      Round 3 ▓▓▓░░ 7s · ⚔ 12 theirs │  ← foeband unchanged
│ ⚠ traps strip (chips slim: icon + name, desc → tooltip)  │
│ ⚔ 18        │        🛡 7 ✓ (take 5)      │      ⚙ 9/15  │  ← tri-counter + bite preview
│ ┌──────────────────── BOARD ~640px ────────────────────┐ │   ┌─ RAIL ────────────┐
│ │   ▦   ▦   ▦   ▦   ▦      cards ~120×160px            │ │   │ COMMAND CLUSTER   │
│ │   ▦   ▦   ▦   ▦   ▦                                  │ │   │  wheel ⊕ pips ⊕   │
│ │   ▦   ▦   ▦   ▦   ▦                                  │ │   │  mana ⊕ consum.   │
│ └──────────────────────────────────────────────────────┘ │   │  (one panel, one  │
│ dev row (dim)                                            │   │   muscle-memory   │
│                                                          │   │   zone) + abils   │
│                                                          │   │ LOG (140px, calm) │
└──────────────────────────────────────────────────────────┘   └───────────────────┘
```

The moves, each independent:
1. **Board scale-up** — wrap 1000→1200px on the combat scene, board max-width 500→640px. One CSS
   constant each; the single highest leverage-per-line change in the codebase.
2. **Command cluster** — wheel + charge pips + mana + consumables into one rail panel with one
   header. Mana grows from header-text to proper pips (`MANA_CAP` 15 — same pip grammar as
   charges; **similarity** makes the two banks rhyme). Abilities sit directly beneath, their costs
   visually adjacent to the mana that pays them (**proximity** for the afford-check).
3. **Enemy HP into the foe header** — vitals join identity; the combat bar's left half becomes the
   player's alone. (Halfway house to the moderate option's bands.)
4. **Bite preview** on the guard cell: `🛡 7 ✓` → `🛡 7 (take 5)` when unsated — the ITB lesson,
   ~15 lines in `updateBar`.
5. **Log demoted** — max-height 220→140px, slightly dimmer; **center bursts** repositioned to the
   board's top edge (never over cards) so the post-trap re-scan is unobstructed.
6. **Tug bar retired** to a sprite-only read (the duelists already walk it) + a tooltip on the
   sprites.

- **Cost:** hours, spread across independent commits.
- **Risk:** near zero; every move is reversible and ref-stable. Coach untouched except the mana
  cue (`.manabar` selector → new pip element).
- **Payoff:** real but bounded — the column stays interleaved (yours/theirs zoning unfixed), the
  exchange keeps its vertical zig-zag.
- **Tutorial/coach:** unaffected save one selector.

---

## 5. Recommendation — the staged path

**Do MINOR now, design toward MODERATE, hold RADICAL as the art-driven horizon.** The deciding
test: every minor move must remain correct under both later options — they all do, which makes
them no-regret:

- Board scale-up, bite preview, log demotion, burst repositioning, tug retirement → survive any
  layout verbatim.
- Command cluster → becomes the right rail of MODERATE and the cockpit's right wing in RADICAL.
- Enemy-HP-into-header → IS the seed of the foe band; MODERATE merely finishes the merge.

**Sequence with the build calendar:** the minor batch fits any idle slot (hours, combat-only —
TODO's polish bucket). The **moderate re-zone should land with Phase B2** — the run shell adds
between-room screens anyway, so the combat scene is already open on the bench, and re-anchoring
the coach once (not twice) is cheaper. The **radical table waits for the pixel-duelist art
moment** (TODO `[~]` sprites item): diegesis without art is just bigger panels, so spending the
re-frame before art exists would burn its one wow.

**Tied back to the pillars:**
- *Sets steer, stats carry* — the tri-counter as the single ledger is the pillar's UI theorem;
  every option above preserves it and the staged path makes it more central each step.
- *The round as breath* — the foeband (bar fused to telegraph) is the inhale's metronome; the
  duel-axis exchange (moderate/radical) is what finally makes the exhale read as a collision.
- *Telegraph-driven allocation* — the bite preview is the cheapest, highest-value single change
  in this document; if only one item ships from §4c, ship that.
- *Deliberate grind, not twitch* — the budget rule going forward: **the board buys pixels with
  player-seconds**. It owns ~85% of each round's attention and should own a comparable share of
  the viewport; any element that wants more space must show the phase (§2) in which it owns the
  player's eyes.
