# SET.core — seed bundle

This is a project seed for a **Set**-based skill-minigame intended as the
action-resolution layer of a web RPG.

## Start here
1. **`CLAUDE.md`** — fast orientation for a Claude Code session.
2. **`PROJECT.md`** — full design context and rationale (the source of truth).
3. **`prototype/set-proto.html`** — the working prototype. Open in any browser;
   no build step or dependencies (uses inline CSS/JS + Google Fonts).

## Try the prototype
Open `prototype/set-proto.html`, pick dials (defaults to f=3 / N=12 / 30s), hit
Start. Use the **Quick compare** presets to feel f=3·n=10 vs f=4·n=15, the
**Set camouflage** dial for findability, and **Encounter** for value-scoring.
The board-analysis strip shows the honest difficulty number (easiest-k).

## Images
Diagnostic renders used during development — see `PROJECT.md` §10 for what each
one demonstrates.

## Suggested repo layout when seeding
```
.
├── CLAUDE.md
├── PROJECT.md
├── README.md
├── prototype/
│   └── set-proto.html
└── images/
    ├── f3-board-n12-highlighted.png
    ├── f4-board-n15-highlighted.png
    ├── shading-solid-striped-open.png
    └── feature-contact-sheet.png
```
