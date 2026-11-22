import {defineConfig, devices} from '@playwright/test'

// The production build and the API, served together by scripts/serve.ts
// with an in-memory store, driven on a phone (with reduced motion asked
// for) and a desktop. Set PORT to run more than one copy at once.
const port = Number(process.env.PORT ?? 4173)

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', {open: 'never'}]] : 'list',
    use: {
        baseURL: `http://localhost:${port}`,
        trace: 'on-first-retry',
    },
    projects: [
        {name: 'desktop', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 900}}},
        {name: 'phone', use: {...devices['Pixel 7'], contextOptions: {reducedMotion: 'reduce'}}},
    ],
    webServer: {
        // (CI has just built it; a cheap password hash keeps the tests quick)
        command: `${process.env.CI ? '' : 'npx vite build && '}node scripts/serve.ts`,
        env: {PORT: String(port), PASSWORD_COST_LOG_N: '12', GROUPS_PER_HOUR: '1000'},
        url: `http://localhost:${port}/api/health`,
        reuseExistingServer: !process.env.CI,
    },
})
