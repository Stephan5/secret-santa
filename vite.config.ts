import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'

// The site is a single-page app: src/web, built to dist/. In development
// /api goes to the local API that scripts/dev.ts starts alongside.
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': `http://localhost:${process.env.API_PORT ?? 8787}`,
        },
    },
})
