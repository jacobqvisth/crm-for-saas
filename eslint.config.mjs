import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "e2e/**"],
  },
  {
    rules: {
      // This rule is over-aggressive for the codebase's data-fetching pattern:
      // `useEffect(() => { fetchData(); }, [fetchData])` is correct React idiom.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
