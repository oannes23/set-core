/* net/version — the client's RULESET + CONTENT version tokens. These are OPAQUE strings the Embassy
   equality-compares (SERVICE-REPLY-RESPONSE.md §2-3): a /daily is playable only when the descriptor's
   versions match these, and bests/replay are meaningful only across matching versions. The OFFICIAL
   service mirrors these via its EMBASSY_RULESET_VERSION / EMBASSY_CONTENT_VERSION env (the publish
   workflow = bump both sides + redeploy, never mid-day).

   These MUST equal the service's advertised tokens for a /daily to be playable: resolveDaily()
   opaque-compares the descriptor's ruleset/content versions to these, and a mismatch makes the daily
   "unavailable: update to play". The official/self-host service advertises EMBASSY_RULESET_VERSION /
   EMBASSY_CONTENT_VERSION (config.py defaults to "0.0.0-dev"); we mirror that default here so a fresh
   local pairing (game ↔ a default Embassy) resolves the daily with zero env setup.

   Still placeholder-grade: the publish workflow is to bump BOTH sides + redeploy (never mid-day — it
   re-rolls the seed). Wiring these to a real build/content hash (instead of a hand-kept constant) is the
   remaining follow-up. Bump CLIENT_CONTENT_VERSION whenever the YAML content registry changes;
   CLIENT_RULESET_VERSION when the engine rules/generation change in a way that breaks board-equality or replay. */

export const CLIENT_RULESET_VERSION = '0.0.0-dev'
export const CLIENT_CONTENT_VERSION = '0.0.0-dev'
