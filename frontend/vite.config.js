import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
    // Vitest's default is 5000ms, and `PlantRecipe.test.jsx` intermittently blew through it on a
    // FULL parallel run while passing 54/54 in isolation and 961/961 with `--no-file-parallelism`
    // — so the failures were CPU starvation, not a defect: `getByRole` waiters timing out while
    // other workers held the machine. Different test names failed each run, which is the signature.
    //
    // Raised rather than papered over with retries, because a retry hides a real flake whereas a
    // longer ceiling only costs time when something is genuinely stuck. A hanging test still
    // fails, 10 seconds later. Worth fixing rather than living with: an intermittently red suite
    // gates prod deploys, and README.md advertises the total as green to anyone who clones this.
    testTimeout: 15000,
  },
})
