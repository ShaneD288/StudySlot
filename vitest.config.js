import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    environment: "node",
    // Run the tests in Ireland's time zone, like the students using the app.
    env: { TZ: "Europe/Dublin" },
  },
});
