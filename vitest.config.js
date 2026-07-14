import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',       // logic tests are pure — no DOM needed
    include: ['src/**/*.test.{js,jsx}'],
  },
})
