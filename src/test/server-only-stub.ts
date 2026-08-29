// Stands in for the `server-only` package under vitest.
//
// The real package is a build-time marker: importing it from a client bundle is
// meant to fail the Next build. Next resolves it through its own dependency
// tree rather than the top of node_modules, so vitest cannot find it, and every
// suite that transitively imported a `server-only` module failed to load.
//
// There is no client bundle in a unit test, so a no-op is exactly right here.
// The guarantee still holds everywhere it actually applies: `npm run build`.
export {};
