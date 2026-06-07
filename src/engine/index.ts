/* engine/ — the combat engine: pure, deterministic, DOM-free. Reduces (state, action) → {state, events}
   over core/ (generation) and data/ (content). The UI dispatches actions and renders the events. */

export * from './state'
export * from './events'
export * from './resolve'
export * from './triggers'
export * from './foe'
export * from './combat'
export * from './session'
