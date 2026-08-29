import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a build-time marker: importing it from a client bundle
      // is meant to fail the Next build. Next resolves it through its own
      // dependency tree, so it is not present at the top of node_modules and
      // vitest cannot find it — which made every test that transitively
      // imported a `server-only` module fail to load, including
      // src/lib/routes/generate.test.ts.
      //
      // Under vitest there is no client bundle to protect, so aliasing it to a
      // no-op is exactly right: it restores those suites without weakening the
      // guarantee anywhere it actually applies.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    // Playwright specs live in e2e/ and are run by `npm run test:e2e`. Without
    // this, vitest also collects them, fails to load all 16, and buries the
    // real unit-test result in noise.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "**/__tests__/**/*.mjs"],
  },
});
