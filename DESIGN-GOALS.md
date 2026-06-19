# DESIGN-GOALS.md — guiding principles & go-to-market north star

Distilled from the 2026-06-16 market/genre review (`REVIEW-2026-06-16.md`). These are
**principles, not a backlog** — they steer judgment calls and feature prioritization. Concrete
tasks live in `TODO.md`. Keep this in mind when deciding *what* to build and *how* to frame it.

## The strategic one-liner
set.crawl's edge is a **never-before-commercialized Set mechanic + a human-made Mörk Borg / Persona
art identity + deterministic-leaderboard fit** inside a fatigued genre. Commercial fate hinges on two
things almost entirely within our control: **make the Set rule click in the first 60 seconds**, and
**keep all player-facing art unmistakably human-made**.

## Guiding principles
1. **Onboarding is the product's make-or-break.** The #1 risk is comprehension / feature-soup (Set
   geometry + traps + dread + Tactics + affixes is a steep wall). Ruthless progressive disclosure;
   the rule must teach itself fast. New players already bounce — every system we add must earn its
   onboarding cost.
2. **Protect the fairness invariants — they are the anti-frustration moat.** Speed × RNG = perceived
   unfairness is the documented churn killer for timed puzzle-combat. Hard-rule #6 (selection-protected
   turnover) and the makeable-set floor are not negotiable polish; they are *why this won't feel cheap*.
3. **Lean on the art identity as THE marketable hook.** In a saturated genre, a distinct human art
   voice is the most defensible asset. Use AI for code; keep displayed art human / curated. ≈85% of
   the target audience is hostile to visible Gen-AI art — review-bomb risk on the exact hook that sells
   the game. (Steam requires disclosure only for player-facing AI output, not code.)
4. **Every resolution moment should be clip-worthy.** Juice is mandatory-tier in this niche and doubles
   as streamer-driven discovery. The deterministic "sets steer / stats carry" reveal + the breakdown
   cutscene are the right instinct — make them feel like a *payoff*, not a readout.
5. **The trap layer must be outsmartable into euphoria, not merely endured.** Retention here comes from
   the player feeling like a genius via emergent synergy. A counter-foe is a puzzle to crack into a
   combo high, never a wall.
6. **Every run must advance something persistent.** Total loot-loss reads as "waste of time"; the
   cash-out / flee valve + always-banked XP + meta-unlocks keep a lost run meaningful.
7. **Build variety via unlocks, not stat grinds.** Turn 9 classes + affix gear into distinct, deep
   build paths; persistent raw-power grinds get panned.
8. **Web/PWA is a funnel, not the revenue center.** Treat it as a free demo → Steam wishlist. Price
   anchor **$9.99–$14.99** (the high-review healthy-seller band). Stand up the Steam page early;
   Next Fest is a multiplier, not discovery; target ~10–15 min runs with bulletproof pause/resume.

## Killer-feature watch-list (not yet built — fold in when a natural hook appears)
These tend to drive success in this niche and we haven't built them. Don't force them — land each when
a feature we're *already* building gives a clean hook-in point (noted in parens):
- **Daily seed + leaderboards** — deterministic resolution makes clean, RNG-complaint-free leaderboards
  nearly free; a strong social/replay lever for a solo game. *(Hook-in: the `session.ts` replay seam +
  seeded runs — also why U5 tick-coalescing matters.)*
- **Big-chain achievements / streaming highlights** — **combo OVERTIME shipped 2026-06-18** (a live chain
  holds the round open; the gold OVERTIME skin is a built-in highlight-reel moment). `combo.fightPeak`
  (whole-fight best chain) is already surfaced on combat state as the gating hook. *(Hook-in: PRESENT —
  persist `fightPeak` through the run/`save.ts` layer, then key achievements / special abilities / gear
  affixes on it. Pairs naturally with the daily-seed leaderboard above: "highest chain on today's seed".)*
- **A relaxed / no-timer (or tunable-clock) mode** — widens the audience, de-risks the timer for the
  deliberate-RPG crowd, and is the accessibility entry point. *(Hook-in: the pause / clock work.)*
- **Clock-starts-on-first-action** (Puzzle Quest 3 lesson) — let players read the board before the
  timer bites. *(Hook-in: Rounds v3 UI.)*
- **Graceful miss-degradation** — a missed/late match degrades rather than hard-fails (Paper Mario
  action-command lesson).
- **Modding / Workshop** — long-tail replay extender; deprioritized for solo scope.

## Red flags to keep checking ourselves against
Comprehension wall · visible AI art · genre saturation / low single-player wishlist ceiling · solo-dev
scope creep (ship content over systems) · total-loss frustration · breadth-without-depth across 9
classes · time pressure alienating the deliberate audience.
