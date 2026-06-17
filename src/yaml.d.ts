/* Ambient type for build-time YAML imports (@modyfi/vite-plugin-yaml — see vite.config.ts).
   `import data from './foo.yaml'` yields the parsed object. We type it `unknown` deliberately:
   external content is untrusted-shaped, so it must pass the referential-link step (registry.ts)
   and, in CI, the ajv schema validation (validate.ts) before being cast to a typed slice. */
declare module '*.yaml' {
  const data: unknown
  export default data
}
declare module '*.yml' {
  const data: unknown
  export default data
}
