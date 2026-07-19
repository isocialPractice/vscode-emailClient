/**
 * Dynamic import that survives CommonJS compilation.
 *
 * This extension compiles to CommonJS (the default for VS Code extension
 * hosts), where TypeScript rewrites `import()` into `require()` - which
 * cannot load ES modules such as the send-email engine. Routing the call
 * through the Function constructor keeps a genuine dynamic `import()` in
 * the emitted code.
 */
export const importEsm = new Function(
  'specifier',
  'return import(specifier);'
) as (specifier: string) => Promise<Record<string, unknown>>;
