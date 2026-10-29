import { defineConfig } from 'vitest/config'

// The integration tests share one SQLite database, so run the files one after another.
export default defineConfig({ test: { fileParallelism: false } })
