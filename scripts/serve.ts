import {createApp} from '../src/api/app.ts'
import {createLocalServer} from '../src/api/local-server.ts'
import {defaultPasswordCost} from '../src/api/secrets.ts'
import {MemoryStore} from '../src/api/store/memory.ts'

// Serves the production build (dist/, from npm run build) and the API, with
// an in-memory store, on one port: what the end-to-end tests run against.
//
//   PORT                 default 4173
//   PASSWORD_COST_LOG_N  scrypt's cost, lowered by the tests to keep quick
//   GROUPS_PER_HOUR      raised by the tests, which all come from one address
const port = Number(process.env.PORT ?? 4173)
const logN = Number(process.env.PASSWORD_COST_LOG_N ?? defaultPasswordCost.logN)
const groupsPerHour = Number(process.env.GROUPS_PER_HOUR ?? 10)

const app = createApp({store: new MemoryStore(), passwordCost: {...defaultPasswordCost, logN}, groupsPerHour})
const server = await createLocalServer(app, 'dist')
server.listen(port, () => console.log(`Serving dist/ and the API on http://localhost:${port}`))
