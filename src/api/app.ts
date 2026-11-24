import {
    adminTokenHeader,
    defaultRules,
    type CreateGroupResponse,
    type RevealResponse,
    type Rules,
    type Session,
} from '../shared/api.ts'
import {limits} from '../shared/limits.ts'
import {draw as drawNames, type Random} from './draw.ts'
import {badRequest, conflict, errorResponse, HttpError, json, notFound, type ApiRequest, type ApiResponse} from './http.ts'
import {defaultPasswordCost, hashPassword, newGroupId, newId, newToken, sha256, verifyPassword, type PasswordCost} from './secrets.ts'
import {ConflictError, type DrawRecord, type GroupAggregate, type PersonRecord, type Store} from './store/store.ts'
import * as check from './validate.ts'
import {groupView, impossibleMessage} from './views.ts'

// The API: routes, and what each one does. Pure apart from the store, the
// clock and the randomness, which are passed in, so the tests can run it
// whole against the in-memory store.

export type AppOptions = {
    store: Store
    now?: () => Date
    passwordCost?: PasswordCost
    random?: Random
    // New groups an address can create an hour
    groupsPerHour?: number
}

export type App = (request: ApiRequest) => Promise<ApiResponse>

const sessionHours = 12
// Wrong admin passwords in a row before a group's admin is locked, and for
// how long
const maxFailedLogins = 10
const lockMinutes = 15
const maxBodyBytes = 32 * 1024
const minDeviceToken = 16

type Context = {
    request: ApiRequest
    params: Record<string, string>
    body: Record<string, unknown>
    now: Date
}

type Handler = (context: Context) => Promise<ApiResponse>

export function createApp(options: AppOptions): App {
    const {store, now = () => new Date(), passwordCost = defaultPasswordCost, random, groupsPerHour = 10} = options

    async function load(groupId: string): Promise<GroupAggregate> {
        const aggregate = await store.getGroup(groupId)
        if (!aggregate) throw notFound("There's no Secret Santa at this link.")
        return aggregate
    }

    const view = async (groupId: string, at: Date): Promise<ApiResponse> => json(200, groupView(await load(groupId), at))

    async function createSession(groupId: string, at: Date): Promise<Session> {
        const token = newToken()
        const expiresAt = new Date(at.getTime() + sessionHours * 3_600_000).toISOString()
        await store.putSession({tokenHash: sha256(token), groupId, expiresAt})
        return {token, expiresAt}
    }

    // The group, if the request carries a live admin session for it.
    async function admin({request, params, now: at}: Context): Promise<GroupAggregate> {
        const token = request.headers[adminTokenHeader]
        const session = token ? await store.getSession(sha256(token)) : null
        if (!session || session.groupId !== params.groupId || new Date(session.expiresAt) <= at) {
            throw new HttpError(401, 'unauthorized', 'Your organiser session has run out. Sign in again.')
        }
        return load(params.groupId)
    }

    function findDraw(aggregate: GroupAggregate, drawId: string): DrawRecord {
        const found = aggregate.draws.find(d => d.id === drawId)
        if (!found) throw notFound("That draw doesn't exist.")
        return found
    }

    function findPerson(aggregate: GroupAggregate, personId: string): PersonRecord {
        const found = aggregate.people.find(p => p.id === personId)
        if (!found) throw notFound("That person isn't in this Secret Santa.")
        return found
    }

    const anyoneLooked = (aggregate: GroupAggregate, drawId: string) =>
        aggregate.pairings.some(p => p.drawId === drawId && p.revealedAt)

    // A list of people's names for a new group: unique, and each valid.
    function names(value: unknown): string[] {
        const list = check.array(value, 'People', limits.peoplePerGroup).map(name => check.text(name, 'A name', limits.personName))
        const duplicate = list.find((name, i) => list.findIndex(other => check.sameName(other, name)) !== i)
        if (duplicate) throw badRequest(`${duplicate} is in the hat twice.`)
        return list
    }

    function checkNameFree(aggregate: GroupAggregate, name: string, exceptId?: string) {
        const clash = aggregate.people.find(p => p.active && p.id !== exceptId && check.sameName(p.name, name))
        if (clash) throw conflict(`There's already someone called ${clash.name}.`)
    }

    function checkDrawNameFree(aggregate: GroupAggregate, name: string, exceptId?: string) {
        if (aggregate.draws.some(d => d.id !== exceptId && check.sameName(d.name, name))) {
            throw conflict(`There's already a draw called ${name}.`)
        }
    }

    function participants(aggregate: GroupAggregate, value: unknown): string[] {
        const ids = check.array(value, 'Participants', limits.peoplePerGroup)
        if (ids.some(id => typeof id !== 'string')) throw badRequest('Participants must be a list of ids.')
        const unique = [...new Set(ids as string[])]
        for (const id of unique) {
            const person = findPerson(aggregate, id)
            if (!person.active) throw badRequest(`${person.name} has been taken out of the hat.`)
        }
        if (unique.length < 2) throw badRequest('A draw needs at least two people.')
        return unique
    }

    // (checked against how many are in the draw only when it's drawn, so
    // taking someone out of the hat isn't held up by it)
    const giftsEach = (value: unknown) => check.int(value, 'How many each buys for', 1, limits.giftsEach)

    function rules(aggregate: GroupAggregate, value: unknown): Rules {
        const body = check.object(value)
        const exclusions: [string, string][] = []
        for (const entry of check.array(body.exclusions, 'Exclusions', limits.exclusions)) {
            const pair = check.array(entry, 'An exclusion', 2)
            if (pair.length !== 2 || pair.some(id => typeof id !== 'string')) throw badRequest('An exclusion must be a pair of ids.')
            const [a, b] = pair as [string, string]
            findPerson(aggregate, a)
            findPerson(aggregate, b)
            if (a === b) throw badRequest("Someone can't be kept apart from themselves.")
            if (!exclusions.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) exclusions.push([a, b])
        }
        return {
            exclusions,
            avoidRecentDraws: check.int(body.avoidRecentDraws, 'Draws to avoid repeating', 0, limits.avoidRecentDraws),
            noSwaps: check.bool(body.noSwaps, 'No swaps'),
            singleLoop: check.bool(body.singleLoop, 'One big loop'),
        }
    }

    const routes: [string, string, Handler][] = [
        ['GET', '/api/health', async () => json(200, {ok: true})],

        ['POST', '/api/groups', async ({request, body, now: at}) => {
            const key = `create:${request.ip ?? 'unknown'}:${at.toISOString().slice(0, 13)}`
            if (await store.increment(key, new Date(at.getTime() + 3_600_000)) > groupsPerHour) {
                throw new HttpError(429, 'rate-limited', "That's a lot of new Secret Santas. Try again in an hour.")
            }
            const name = check.text(body.name, 'The name', limits.groupName)
            const adminPassword = check.password(body.adminPassword, 'The password', limits.passwordMin, limits.passwordMax)
            const people = names(body.people ?? [])
            const createdAt = at.toISOString()
            const group = {
                id: newGroupId(),
                name,
                adminPasswordHash: await hashPassword(adminPassword, passwordCost),
                rules: defaultRules,
                createdAt,
                failedLogins: 0,
                lockedUntil: null,
            }
            // (each a millisecond apart, so they keep the order they were given in)
            const records = people.map((personName, i): PersonRecord => ({
                id: newId(), name: personName, active: true, createdAt: new Date(at.getTime() + i).toISOString(),
            }))
            await store.createGroup(group, records)
            const response: CreateGroupResponse = {
                group: groupView({group, people: records, draws: [], pairings: []}, at),
                session: await createSession(group.id, at),
            }
            return json(201, response)
        }],

        ['GET', '/api/groups/:groupId', async ({params, now: at}) => view(params.groupId, at)],

        ['POST', '/api/groups/:groupId/sessions', async ({params, body, now: at}) => {
            const {group} = await load(params.groupId)
            if (group.lockedUntil && new Date(group.lockedUntil) > at) {
                const minutes = Math.ceil((new Date(group.lockedUntil).getTime() - at.getTime()) / 60_000)
                throw new HttpError(429, 'locked', `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
            }
            const given = typeof body.password === 'string' ? body.password : ''
            if (!await verifyPassword(given, group.adminPasswordHash)) {
                const failedLogins = group.failedLogins + 1
                await store.updateGroup(group.id, failedLogins >= maxFailedLogins
                    ? {failedLogins: 0, lockedUntil: new Date(at.getTime() + lockMinutes * 60_000).toISOString()}
                    : {failedLogins})
                throw new HttpError(401, 'unauthorized', "That's not the password.")
            }
            if (group.failedLogins > 0 || group.lockedUntil) await store.updateGroup(group.id, {failedLogins: 0, lockedUntil: null})
            return json(201, await createSession(group.id, at))
        }],

        ['DELETE', '/api/groups/:groupId/sessions', async ({request}) => {
            const token = request.headers[adminTokenHeader]
            if (token) await store.deleteSession(sha256(token))
            return json(204, undefined)
        }],

        // Checks a session is still good, for the admin page to know whether
        // to ask for the password.
        ['GET', '/api/groups/:groupId/sessions/current', async context => {
            await admin(context)
            return json(200, {ok: true})
        }],

        ['PATCH', '/api/groups/:groupId', async context => {
            const aggregate = await admin(context)
            const {body} = context
            await store.updateGroup(aggregate.group.id, {
                name: body.name === undefined ? undefined : check.text(body.name, 'The name', limits.groupName),
                rules: body.rules === undefined ? undefined : rules(aggregate, body.rules),
            })
            return view(aggregate.group.id, context.now)
        }],

        ['POST', '/api/groups/:groupId/people', async context => {
            const aggregate = await admin(context)
            const name = check.text(context.body.name, 'The name', limits.personName)
            checkNameFree(aggregate, name)
            if (aggregate.people.filter(p => p.active).length >= limits.peoplePerGroup) {
                throw badRequest(`The hat holds at most ${limits.peoplePerGroup} names.`)
            }
            if (aggregate.people.length >= limits.peoplePerGroup * 2) {
                throw badRequest('This Secret Santa has had too many people through it. Start a new one.')
            }
            await store.addPerson(aggregate.group.id, {id: newId(), name, active: true, createdAt: context.now.toISOString()})
            return view(aggregate.group.id, context.now)
        }],

        ['PATCH', '/api/groups/:groupId/people/:personId', async context => {
            const aggregate = await admin(context)
            const {body, params} = context
            const person = findPerson(aggregate, params.personId)
            const name = body.name === undefined ? undefined : check.text(body.name, 'The name', limits.personName)
            const active = body.active === undefined ? undefined : check.bool(body.active, 'Active')
            const restoring = active === true && !person.active
            // (a removed person can share a name; one in the hat, or coming back to it, can't)
            if ((active ?? person.active) && (name !== undefined || restoring)) {
                checkNameFree(aggregate, name ?? person.name, person.id)
            }
            if (active === false) {
                const inPending = aggregate.draws.find(d => d.status === 'pending' && d.participantIds.includes(person.id))
                if (inPending) throw conflict(`Take ${person.name} out of the ${inPending.name} draw first.`)
            }
            if (restoring && aggregate.people.filter(p => p.active).length >= limits.peoplePerGroup) {
                throw badRequest(`The hat holds at most ${limits.peoplePerGroup} names.`)
            }
            await store.updatePerson(aggregate.group.id, person.id, {name, active})
            return view(aggregate.group.id, context.now)
        }],

        ['POST', '/api/groups/:groupId/draws', async context => {
            const aggregate = await admin(context)
            const {body} = context
            if (aggregate.draws.length >= limits.drawsPerGroup) throw badRequest(`A Secret Santa can have at most ${limits.drawsPerGroup} draws.`)
            const name = check.text(body.name, 'The name', limits.drawName)
            checkDrawNameFree(aggregate, name)
            await store.createDraw(aggregate.group.id, {
                id: newId(),
                name,
                status: 'pending',
                participantIds: participants(aggregate, body.participantIds),
                giftsEach: giftsEach(body.giftsEach ?? 1),
                resultsVisibleFrom: check.instant(body.resultsVisibleFrom ?? null, 'Results visible from'),
                createdAt: context.now.toISOString(),
                drawnAt: null,
            })
            return view(aggregate.group.id, context.now)
        }],

        ['PATCH', '/api/groups/:groupId/draws/:drawId', async context => {
            const aggregate = await admin(context)
            const {body, params} = context
            const found = findDraw(aggregate, params.drawId)
            const name = body.name === undefined ? undefined : check.text(body.name, 'The name', limits.drawName)
            if (name !== undefined) checkDrawNameFree(aggregate, name, found.id)
            let participantIds: string[] | undefined
            if (body.participantIds !== undefined) {
                if (found.status !== 'pending') throw conflict('Names have been drawn, so who takes part is set. Undo the draw to change it.')
                participantIds = participants(aggregate, body.participantIds)
            }
            let gifts: number | undefined
            if (body.giftsEach !== undefined) {
                if (found.status !== 'pending') throw conflict('Names have been drawn, so how many each buys for is set. Undo the draw to change it.')
                gifts = giftsEach(body.giftsEach)
            }
            const resultsVisibleFrom = body.resultsVisibleFrom === undefined
                ? undefined
                : check.instant(body.resultsVisibleFrom, 'Results visible from')
            await store.updateDraw(aggregate.group.id, found.id, found.status, {name, participantIds, giftsEach: gifts, resultsVisibleFrom})
            return view(aggregate.group.id, context.now)
        }],

        ['DELETE', '/api/groups/:groupId/draws/:drawId', async context => {
            const aggregate = await admin(context)
            const found = findDraw(aggregate, context.params.drawId)
            if (anyoneLooked(aggregate, found.id)) throw conflict("Someone has already opened theirs, so this draw can't be deleted.")
            const giverIds = found.status === 'drawn' ? found.participantIds : []
            await store.deleteDraw(aggregate.group.id, found.id, giverIds)
            return view(aggregate.group.id, context.now)
        }],

        // Draws names, or draws them again if nobody has looked yet.
        ['POST', '/api/groups/:groupId/draws/:drawId/run', async context => {
            const aggregate = await admin(context)
            const found = findDraw(aggregate, context.params.drawId)
            if (anyoneLooked(aggregate, found.id)) throw conflict("Someone has already opened theirs, so names can't be drawn again.")
            const {rules: groupRules} = aggregate.group
            // The pairings of the last few draws before this one
            const previous = aggregate.draws
                .filter(d => d.id !== found.id && d.status === 'drawn' && d.drawnAt)
                .toSorted((a, b) => b.drawnAt!.localeCompare(a.drawnAt!))
                .slice(0, groupRules.avoidRecentDraws)
                .map(d => aggregate.pairings.filter(p => p.drawId === d.id))
            const outcome = drawNames({
                participantIds: found.participantIds,
                giftsEach: found.giftsEach,
                exclusions: groupRules.exclusions,
                noSwaps: groupRules.noSwaps,
                singleLoop: groupRules.singleLoop,
                previous,
            }, {random})
            if (!outcome.ok) {
                if (outcome.reason === 'too-few') {
                    const n = found.participantIds.length
                    throw badRequest(n < 2
                        ? 'A draw needs at least two people.'
                        : `With ${n} people in the draw, each can buy for at most ${n - 1}.`)
                }
                throw new HttpError(422, 'draw-impossible', impossibleMessage(outcome.blockers, outcome.fewerGifts), outcome.blockers)
            }
            await store.saveDraw(aggregate.group.id, found.id, found.status, context.now.toISOString(), outcome.pairings)
            return view(aggregate.group.id, context.now)
        }],

        ['POST', '/api/groups/:groupId/draws/:drawId/undo', async context => {
            const aggregate = await admin(context)
            const found = findDraw(aggregate, context.params.drawId)
            if (found.status !== 'drawn') throw conflict("Names haven't been drawn yet.")
            if (anyoneLooked(aggregate, found.id)) throw conflict("Someone has already opened theirs, so the draw can't be undone.")
            await store.undoDraw(aggregate.group.id, found.id, found.participantIds)
            return view(aggregate.group.id, context.now)
        }],

        ['POST', '/api/groups/:groupId/draws/:drawId/reveal', async ({params, body, now: at}) => {
            const aggregate = await load(params.groupId)
            const found = findDraw(aggregate, params.drawId)
            if (found.status !== 'drawn') throw conflict("Names haven't been drawn yet.")
            if (typeof body.personId !== 'string' || !found.participantIds.includes(body.personId)) {
                throw notFound("That person isn't in this draw.")
            }
            const person = findPerson(aggregate, body.personId)
            const deviceToken = check.text(body.deviceToken, 'The device token', 200, {min: minDeviceToken})
            const result = await store.reveal(aggregate.group.id, found.id, person.id, sha256(deviceToken), at.toISOString())
            if (result.outcome === 'elsewhere') {
                throw new HttpError(409, 'already-revealed',
                    `Someone's already opened ${person.name}'s on another device. If that wasn't ${person.name}, ask the group organiser to reset it.`)
            }
            if (result.outcome === 'missing') throw notFound("That person isn't in this draw.")
            const receivers = result.pairing.receiverIds.map(id => findPerson(aggregate, id))
            const response: RevealResponse = {receivers: receivers.map(({id, name}) => ({id, name})), revealedAt: result.pairing.revealedAt!}
            return json(200, response)
        }],

        ['POST', '/api/groups/:groupId/draws/:drawId/people/:personId/reset', async context => {
            const aggregate = await admin(context)
            const found = findDraw(aggregate, context.params.drawId)
            const person = findPerson(aggregate, context.params.personId)
            if (found.status !== 'drawn' || !found.participantIds.includes(person.id)) throw notFound(`${person.name} isn't in this draw.`)
            await store.resetReveal(aggregate.group.id, found.id, person.id)
            return view(aggregate.group.id, context.now)
        }],
    ]

    const compiled = routes.map(([method, pattern, handler]) => ({method, segments: pattern.split('/'), handler}))

    function route(method: string, path: string): {handler: Handler, params: Record<string, string>} | 'wrong-method' | null {
        const segments = path.replace(/\/+$/, '').split('/')
        let pathMatched = false
        for (const candidate of compiled) {
            if (candidate.segments.length !== segments.length) continue
            const params: Record<string, string> = {}
            const matches = candidate.segments.every((segment, i) => {
                if (segment.startsWith(':')) {
                    if (!segments[i]) return false
                    params[segment.slice(1)] = decodeURIComponent(segments[i])
                    return true
                }
                return segment === segments[i]
            })
            if (!matches) continue
            pathMatched = true
            if (candidate.method === method) return {handler: candidate.handler, params}
        }
        return pathMatched ? 'wrong-method' : null
    }

    return async request => {
        try {
            const found = route(request.method.toUpperCase(), request.path)
            if (found === null) throw notFound('No such endpoint.')
            if (found === 'wrong-method') throw new HttpError(405, 'bad-request', 'Method not allowed.')
            if (request.body && Buffer.byteLength(request.body) > maxBodyBytes) {
                throw new HttpError(413, 'too-large', 'That request is too large.')
            }
            let body: Record<string, unknown> = {}
            if (request.body) {
                try {
                    body = check.object(JSON.parse(request.body))
                } catch (error) {
                    if (error instanceof HttpError) throw error
                    throw badRequest("That request isn't valid JSON.")
                }
            }
            return await found.handler({request, params: found.params, body, now: now()})
        } catch (error) {
            if (error instanceof HttpError) return errorResponse(error)
            if (error instanceof ConflictError) {
                return errorResponse(conflict('Something changed while you were doing that. Reload the page and try again.'))
            }
            console.error(error)
            return errorResponse(new HttpError(500, 'server-error', 'Something went wrong. Try again in a moment.'))
        }
    }
}
