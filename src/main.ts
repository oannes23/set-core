import './ui/styles.css'
import { mountApp } from './ui/app'

// The new client (TODO.md §A, step 5): a functional rebuild over the engine. The single-file
// prototype (prototype/set-combat.html) remains the polished oracle/live game during migration.
const root = document.querySelector<HTMLDivElement>('#app')
if (root) mountApp(root)
