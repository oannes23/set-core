# engine/

Combat logic — resolution, traps (`TRAP_EFFECTS`), tactics, the targeting toolkit, the trigger
bus. Extract from the prototype with light cleanup + types (TODO.md §A, step 4): recycle the
design (the abstractions were discovered through play), refactor the structure. Verify behavior
against the `proto-reference` oracle. Reduce `(state, action) -> state` / emit events so a server
can later be the authority (step 6) — no netcode yet, just the shape.
