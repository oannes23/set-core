# data/

Typed, declarative game content — the portable JSON→YAML artifact.

- `schema.ts` — types for the token vocabulary + structures (traps, creatures, dungeons …). Pure
  authoring-time checking; nothing at runtime. Keeps the PORTABILITY CONTRACT (string tokens only).
- `game-data.ts` — the content as a typed `GAMEDATA` const, ported from `prototype/game-data.js`.
- `game-data.test.ts` — parity with the prototype oracle (no drift) + referential-integrity of all ids.

Migration note: `prototype/game-data.js` is still the oracle's `window.GAMEDATA`. Keep the two in
sync until the prototype is retired (TODO.md §A, step 5); the parity test enforces it.
