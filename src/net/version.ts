/* net/version — the client's RULESET + CONTENT version tokens. These are OPAQUE strings the Embassy
   equality-compares (SERVICE-REPLY-RESPONSE.md §2-3): a /daily is playable only when the descriptor's
   versions match these, and bests/replay are meaningful only across matching versions. The OFFICIAL
   service mirrors these via its EMBASSY_RULESET_VERSION / EMBASSY_CONTENT_VERSION env (the publish
   workflow = bump both sides + redeploy, never mid-day).

   PLACEHOLDERS for now — wire to real content/build versioning when the daily scene lands. Bump
   `CLIENT_CONTENT_VERSION` whenever the YAML content registry changes; `CLIENT_RULESET_VERSION` when
   the engine rules/generation change in a way that breaks board-equality or replay. */

export const CLIENT_RULESET_VERSION = '0'
export const CLIENT_CONTENT_VERSION = '0'
