import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {createServer} from 'vite'
import {createApp} from '../src/api/app.ts'
import {createLocalServer} from '../src/api/local-server.ts'
import {MemoryStore} from '../src/api/store/memory.ts'

// Local development: the API on API_PORT (default 8787) with an in-memory
// store kept in .dev-data.json between restarts, and Vite's dev server,
// which proxies /api to it (vite.config.ts).
const apiPort = Number(process.env.API_PORT ?? 8787)
const dataFile = '.dev-data.json'

const initial = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : undefined
const store = new MemoryStore(initial, state => writeFileSync(dataFile, JSON.stringify(state, null, 2)))
// (a cheaper password hash, since nothing here is worth protecting)
const api = await createLocalServer(createApp({store, passwordCost: {logN: 12, r: 8, p: 1}}))
api.listen(apiPort)

const vite = await createServer()
await vite.listen()
vite.printUrls()
console.log(`  ➜  API:     http://localhost:${apiPort}/api (data in ${dataFile})`)
