import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["dist-electron/**", "renderer/**", "node_modules/**"],
  },
})
