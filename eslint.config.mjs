import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    // supabase/functions is Deno, not Node: it has its own globals and module
    // resolution, so the Next lint/type config does not apply to it.
    ignores: [".next/**", "node_modules/**", "e2e/**", "supabase/functions/**"],
  },
  {
    rules: {
      // This rule is over-aggressive for the codebase's data-fetching pattern:
      // `useEffect(() => { fetchData(); }, [fetchData])` is correct React idiom.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
