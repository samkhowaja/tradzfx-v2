import nextEslint from "eslint-config-next";
import nextTypescript from "eslint-config-next/typescript";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...nextEslint,
  ...nextTypescript,
  ...nextCoreWebVitals,
  {
    rules: {
      // The V2 codebase predates strict typing discipline; keep lint useful
      // without blocking CI on legacy patterns.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
      "prefer-const": "warn",
    },
  },
];

export default eslintConfig;
