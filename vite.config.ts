import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/stronger/',
  test: {
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
  },
})
