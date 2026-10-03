import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", ".wrangler/", "public/vendor/"] },
  js.configs.recommended,
  {
    rules: {
      // `catch {}` is used on purpose where storage or sharing may be unavailable.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // Cloudflare Worker
  { files: ["src/**/*.js"], languageOptions: { globals: globals.serviceworker } },
  // The app, its modules and its service worker run in the browser
  { files: ["public/**/*.js"], languageOptions: { globals: globals.browser } },
  { files: ["public/sw.js"], languageOptions: { globals: globals.serviceworker } },
  // Build scripts, config and tests run in Node
  { files: ["scripts/**/*.js", "test/**/*.js", "*.config.js"], languageOptions: { globals: globals.node } },
  // …except the smoke test, which runs the app in a simulated browser (happy-dom)
  { files: ["test/app.smoke.test.js"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
