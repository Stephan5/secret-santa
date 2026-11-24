import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {ApiError, CreateGroupResponse, Group, Pairing, RevealResponse, Rules, Session} from '../shared/api.ts'
import {createApp} from './app.ts'
import {MemoryStore} from './store/memory.ts'

// The API, whole, against the in-memory store, with a clock the tests move,
// and that ticks a millisecond on each request, so things done one after
// another happen one after another.

function setup() {
    let clock = new Date('2026-11-22T12:00:00.000Z')
    const store = new MemoryStore()
    const app = createApp({store, now: () => (clock = new Date(clock.getTime() + 1)), passwordCost: {logN: 4, r: 8, p: 1}})

    async function call<T = unknown>(method: string, path: string, body?: unknown, {token, ip = '203.0.113.1'}: {token?: string, ip?: string} = {}) {
        const response = await app({
            method,
            path,
            headers: token ? {'x-admin-token': token} : {},
            body: body === undefined ? null : JSON.stringify(body),
            ip,
        })
        return {status: response.status, body: (response.body ? JSON.parse(response.body) : undefined) as T}
    }

    // A group with the people given, its organiser signed in.
    async function group(people = ['Mum', 'Dad', 'Sue']) {
        const created = await call<CreateGroupResponse>('POST', '/api/groups', {name: 'Blakeslee Christmas', adminPassword: 'mince pies', people})
        assert.equal(created.status, 201)
        const {group: g, session} = created.body
        const as = (name: string) => g.people.find(p => p.name === name)!.id
        const admin = <T = Group>(method: string, path: string, body?: unknown) =>
            call<T>(method, `/api/groups/${g.id}${path}`, body, {token: session.token})
        return {id: g.id, as, admin, session}
    }

    // …with a draw of everyone in it, drawn.
    async function drawn(people?: string[], visibleFrom: string | null = null) {
        const setup = await group(people)
        const {body: g} = await setup.admin('GET', '')
        const created = await setup.admin('POST', '/draws', {name: '2026', participantIds: g.people.map(p => p.id), resultsVisibleFrom: visibleFrom})
        assert.equal(created.status, 200)
        const drawId = created.body.draws[0].id
        const ran = await setup.admin('POST', `/draws/${drawId}/run`)
        assert.equal(ran.status, 200, JSON.stringify(ran.body))
        const reveal = (personId: string, deviceToken: string) =>
            call<RevealResponse & ApiError>('POST', `/api/groups/${setup.id}/draws/${drawId}/reveal`, {personId, deviceToken})
        return {...setup, drawId, reveal}
    }

    return {call, group, drawn, setClock: (iso: string) => { clock = new Date(iso) }}
}

const device = (n: number) => `device-token-number-${n}`

describe('API', () => {
    describe('creating a Secret Santa', () => {
        it('puts the names in the hat and signs the organiser in', async () => {
            const {call} = setup()
            const {status, body} = await call<CreateGroupResponse>('POST', '/api/groups', {
                name: '  Blakeslee   Christmas ', adminPassword: 'mince pies', people: ['Mum', ' Dad '],
            })
            assert.equal(status, 201)
            assert.equal(body.group.name, 'Blakeslee Christmas')
            assert.deepEqual(body.group.people.map(p => [p.name, p.active]), [['Mum', true], ['Dad', true]])
            assert.deepEqual(body.group.draws, [])
            assert.match(body.group.id, /^[0-9a-f-]{36}$/)
            assert.ok(body.session.token)
            // The group is there at its link
            const loaded = await call<Group>('GET', `/api/groups/${body.group.id}`)
            assert.deepEqual(loaded.body, body.group)
        })

        it('checks what it is given', async () => {
            const {call} = setup()
            const cases: [unknown, RegExp][] = [
                [{name: '', adminPassword: 'mince pies'}, /can't be empty/],
                [{name: 'x'.repeat(81), adminPassword: 'mince pies'}, /at most 80/],
                [{name: 'Xmas', adminPassword: 'short'}, /at least 8/],
                [{name: 'Xmas', adminPassword: 'mince pies', people: ['Mum', 'mum']}, /twice/],
                [{name: 'Xmas', adminPassword: 'mince pies', people: 'Mum'}, /must be a list/],
                [[], /JSON object/],
            ]
            for (const [body, message] of cases) {
                const response = await call<ApiError>('POST', '/api/groups', body)
                assert.equal(response.status, 400, JSON.stringify(body))
                assert.match(response.body.message, message)
            }
            const response = await call<ApiError>('POST', '/api/groups', undefined)
            assert.equal(response.status, 400)
        })

        it('limits how many one address creates an hour', async () => {
            const {call, setClock} = setup()
            const create = (ip: string) => call('POST', '/api/groups', {name: 'Xmas', adminPassword: 'mince pies'}, {ip})
            for (let i = 0; i < 10; i++) assert.equal((await create('198.51.100.7')).status, 201)
            assert.equal((await create('198.51.100.7')).status, 429)
            assert.equal((await create('198.51.100.8')).status, 201)
            setClock('2026-11-22T13:00:00.000Z')
            assert.equal((await create('198.51.100.7')).status, 201)
        })
    })

    it("says so when there's nothing at a link", async () => {
        const {call} = setup()
        const response = await call<ApiError>('GET', '/api/groups/00000000-0000-4000-8000-000000000000')
        assert.equal(response.status, 404)
        assert.equal((await call('GET', '/api/nothing')).status, 404)
        assert.equal((await call('PUT', '/api/groups')).status, 405)
    })

    describe('organiser sign-in', () => {
        it('needs the password', async () => {
            const {call, group} = setup()
            const {id} = await group()
            assert.equal((await call('POST', `/api/groups/${id}/sessions`, {password: 'wrong guess'})).status, 401)
            const right = await call<Session>('POST', `/api/groups/${id}/sessions`, {password: 'mince pies'})
            assert.equal(right.status, 201)
            assert.equal((await call('GET', `/api/groups/${id}/sessions/current`, undefined, {token: right.body.token})).status, 200)
        })

        it('locks after ten wrong passwords in a row, for fifteen minutes', async () => {
            const {call, group, setClock} = setup()
            const {id} = await group()
            const login = (password: string) => call<ApiError>('POST', `/api/groups/${id}/sessions`, {password})
            for (let i = 0; i < 9; i++) assert.equal((await login('wrong guess')).status, 401)
            // (a right one resets the count)
            assert.equal((await login('mince pies')).status, 201)
            for (let i = 0; i < 10; i++) assert.equal((await login('wrong guess')).status, 401)
            const locked = await login('mince pies')
            assert.equal(locked.status, 429)
            assert.match(locked.body.message, /15 minutes/)
            setClock('2026-11-22T12:16:00.000Z')
            assert.equal((await login('mince pies')).status, 201)
        })

        it('turns away other groups\' sessions, expired ones, signed-out ones and none', async () => {
            const {call, group, setClock} = setup()
            const first = await group()
            const second = await group()
            const add = (groupId: string, token?: string) => call('POST', `/api/groups/${groupId}/people`, {name: 'Gran'}, {token})
            assert.equal((await add(first.id)).status, 401)
            assert.equal((await add(first.id, 'made-up')).status, 401)
            assert.equal((await add(first.id, second.session.token)).status, 401)
            assert.equal((await add(first.id, first.session.token)).status, 200)

            await call('DELETE', `/api/groups/${second.id}/sessions`, undefined, {token: second.session.token})
            assert.equal((await add(second.id, second.session.token)).status, 401)

            setClock('2026-11-23T00:00:01.000Z')
            assert.equal((await call('POST', `/api/groups/${first.id}/people`, {name: 'Grandad'}, {token: first.session.token})).status, 401)
        })
    })

    describe('people', () => {
        it('adds, renames, removes and restores', async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad'])
            let response = await admin('POST', '/people', {name: 'Gran'})
            assert.deepEqual(response.body.people.map(p => p.name), ['Mum', 'Dad', 'Gran'])
            response = await admin('PATCH', `/people/${as('Dad')}`, {name: 'Father'})
            assert.deepEqual(response.body.people.map(p => p.name), ['Mum', 'Father', 'Gran'])
            response = await admin('PATCH', `/people/${as('Mum')}`, {active: false})
            assert.deepEqual(response.body.people.map(p => [p.name, p.active]), [['Mum', false], ['Father', true], ['Gran', true]])
            response = await admin('PATCH', `/people/${as('Mum')}`, {active: true})
            assert.equal(response.body.people[0].active, true)
        })

        it("won't have two people in the hat with the same name", async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad'])
            assert.equal((await admin('POST', '/people', {name: 'MUM'})).status, 409)
            assert.equal((await admin('PATCH', `/people/${as('Dad')}`, {name: 'mum'})).status, 409)
            // A removed person can share a name, but can't come back while it's taken
            await admin('PATCH', `/people/${as('Mum')}`, {active: false})
            assert.equal((await admin('POST', '/people', {name: 'Mum'})).status, 200)
            assert.equal((await admin('PATCH', `/people/${as('Mum')}`, {active: true})).status, 409)
        })

        it("won't remove someone from the hat who's in a draw still to be drawn", async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad', 'Sue'])
            await admin('POST', '/draws', {name: '2026', participantIds: [as('Mum'), as('Dad'), as('Sue')], resultsVisibleFrom: null})
            const response = await admin<ApiError>('PATCH', `/people/${as('Sue')}`, {active: false})
            assert.equal(response.status, 409)
            assert.match(response.body.message, /Take Sue out of the 2026 draw first/)
        })
    })

    describe('rules', () => {
        it('saves them, dropping repeated exclusions', async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad', 'Sue'])
            const rules: Rules = {
                exclusions: [[as('Mum'), as('Dad')], [as('Dad'), as('Mum')]],
                avoidRecentDraws: 2,
                noSwaps: true,
                singleLoop: false,
            }
            const response = await admin('PATCH', '', {rules})
            assert.equal(response.status, 200)
            assert.deepEqual(response.body.rules, {...rules, exclusions: [[as('Mum'), as('Dad')]]})
            assert.equal(response.body.name, 'Blakeslee Christmas')
        })

        it('checks them', async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad'])
            const base = {exclusions: [], avoidRecentDraws: 1, noSwaps: false, singleLoop: false}
            const bad = [
                {...base, exclusions: [[as('Mum'), as('Mum')]]},
                {...base, exclusions: [[as('Mum'), 'nobody']]},
                {...base, exclusions: [[as('Mum')]]},
                {...base, avoidRecentDraws: 6},
                {...base, avoidRecentDraws: 1.5},
                {...base, noSwaps: 'yes'},
                {exclusions: []},
            ]
            for (const rules of bad) {
                const {status} = await admin('PATCH', '', {rules})
                assert.ok(status === 400 || status === 404, `${status} for ${JSON.stringify(rules)}`)
            }
        })
    })

    describe('draws', () => {
        it('creates a draw, waiting to be drawn, with nobody having looked', async () => {
            const {group} = setup()
            const {admin, as} = await group()
            const response = await admin('POST', '/draws', {name: '2026', participantIds: [as('Mum'), as('Dad')], resultsVisibleFrom: '2026-12-25T10:00:00Z'})
            const [draw] = response.body.draws
            assert.match(draw.createdAt, /^2026-11-22T12:00:00\.\d{3}Z$/)
            assert.deepEqual(
                {...draw, id: undefined, createdAt: undefined},
                {
                    id: undefined,
                    name: '2026',
                    status: 'pending',
                    participantIds: [as('Mum'), as('Dad')],
                    giftsEach: 1,
                    revealedIds: [],
                    resultsVisibleFrom: '2026-12-25T10:00:00.000Z',
                    createdAt: undefined,
                    drawnAt: null,
                    results: null,
                })
        })

        it('checks a new draw', async () => {
            const {group} = setup()
            const {admin, as} = await group()
            await admin('POST', '/draws', {name: '2026', participantIds: [as('Mum'), as('Dad')], resultsVisibleFrom: null})
            assert.equal((await admin('POST', '/draws', {name: '2026', participantIds: [as('Mum'), as('Dad')], resultsVisibleFrom: null})).status, 409)
            assert.equal((await admin('POST', '/draws', {name: '2027', participantIds: [as('Mum')], resultsVisibleFrom: null})).status, 400)
            assert.equal((await admin('POST', '/draws', {name: '2027', participantIds: [as('Mum'), 'nobody'], resultsVisibleFrom: null})).status, 404)
            assert.equal((await admin('POST', '/draws', {name: '2027', participantIds: [as('Mum'), as('Dad')], resultsVisibleFrom: 'Christmas'})).status, 400)
        })

        it('draws names, so everyone has one person and nobody themselves', async () => {
            const {drawn, setClock} = setup()
            const {admin, drawId} = await drawn(['Mum', 'Dad', 'Sue', 'Gran', 'Grandad'], '2026-12-25T10:00:00.000Z')
            const {body} = await admin('GET', '')
            const draw = body.draws.find(d => d.id === drawId)!
            assert.equal(draw.status, 'drawn')
            // Nobody, the organiser included, can see the pairings yet
            assert.equal(draw.results, null)
            setClock('2026-12-25T10:00:00.000Z')
            const results = (await admin('GET', '')).body.draws[0].results!
            assert.equal(results.length, 5)
            assert.deepEqual(new Set(results.flatMap(r => r.receiverIds)), new Set(draw.participantIds))
            assert.ok(results.every(r => r.receiverIds.length === 1 && r.receiverIds[0] !== r.giverId))
        })

        it('has each buy for more than one, when asked', async () => {
            const {group, call, setClock} = setup()
            const {admin, as, id} = await group(['Mum', 'Dad', 'Sue', 'Gran', 'Grandad'])
            const everyone = ['Mum', 'Dad', 'Sue', 'Gran', 'Grandad'].map(as)
            const {body} = await admin('POST', '/draws', {name: '2026', participantIds: everyone, giftsEach: 2, resultsVisibleFrom: '2026-12-25T10:00:00.000Z'})
            const drawId = body.draws[0].id
            assert.equal(body.draws[0].giftsEach, 2)
            assert.equal((await admin('POST', `/draws/${drawId}/run`)).status, 200)

            const opened = await call<RevealResponse>('POST', `/api/groups/${id}/draws/${drawId}/reveal`, {personId: as('Mum'), deviceToken: device(1)})
            assert.equal(opened.body.receivers.length, 2)
            assert.ok(opened.body.receivers.every(r => r.id !== as('Mum')))
            assert.notEqual(opened.body.receivers[0].id, opened.body.receivers[1].id)

            setClock('2026-12-25T10:00:00.000Z')
            const results = (await admin('GET', '')).body.draws[0].results!
            assert.ok(results.every(r => r.receiverIds.length === 2))
            // (everyone bought for twice)
            for (const person of everyone) assert.equal(results.filter(r => r.receiverIds.includes(person)).length, 2)
        })

        it('checks how many each buys for', async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad', 'Sue'])
            const everyone = [as('Mum'), as('Dad'), as('Sue')]
            for (const giftsEach of [0, 4, 1.5, '2']) {
                assert.equal((await admin('POST', '/draws', {name: '2026', participantIds: everyone, giftsEach, resultsVisibleFrom: null})).status, 400)
            }
            // More than the others in the draw: said when drawing
            const {body} = await admin('POST', '/draws', {name: '2026', participantIds: everyone, giftsEach: 3, resultsVisibleFrom: null})
            const drawId = body.draws[0].id
            const tooMany = await admin<ApiError>('POST', `/draws/${drawId}/run`)
            assert.equal(tooMany.status, 400)
            assert.equal(tooMany.body.message, 'With 3 people in the draw, each can buy for at most 2.')
            // Changeable till it's drawn
            assert.equal((await admin('PATCH', `/draws/${drawId}`, {giftsEach: 2})).body.draws[0].giftsEach, 2)
            assert.equal((await admin('POST', `/draws/${drawId}/run`)).status, 200)
            assert.equal((await admin('PATCH', `/draws/${drawId}`, {giftsEach: 1})).status, 409)
        })

        it('says when fewer each would work', async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad', 'Sue', 'Gran'])
            await admin('PATCH', '', {rules: {exclusions: [], avoidRecentDraws: 1, noSwaps: true, singleLoop: false}})
            const {body} = await admin('POST', '/draws', {name: '2026', participantIds: ['Mum', 'Dad', 'Sue', 'Gran'].map(as), giftsEach: 2, resultsVisibleFrom: null})
            const response = await admin<ApiError>('POST', `/draws/${body.draws[0].id}/run`)
            assert.equal(response.status, 422)
            assert.equal(response.body.message, 'No draw fits these rules. It would work without the "No swaps" rule, or with each buying for one.')
        })

        it('keeps to the rules, naming those in the way when it can’t', async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad', 'Sue'])
            await admin('PATCH', '', {rules: {exclusions: [[as('Mum'), as('Dad')]], avoidRecentDraws: 1, noSwaps: false, singleLoop: false}})
            const {body} = await admin('POST', '/draws', {name: '2026', participantIds: [as('Mum'), as('Dad'), as('Sue')], resultsVisibleFrom: null})
            const response = await admin<ApiError>('POST', `/draws/${body.draws[0].id}/run`)
            assert.equal(response.status, 422)
            assert.equal(response.body.error, 'draw-impossible')
            assert.deepEqual(response.body.blockers, ['exclusions'])
            assert.match(response.body.message, /without the "Never draw each other" pairs/)
        })

        it("doesn't give anyone who they had last time", async () => {
            const {group} = setup()
            const {admin, as} = await group(['Mum', 'Dad', 'Sue'])
            const everyone = [as('Mum'), as('Dad'), as('Sue')]
            const results: (Pairing[] | null)[] = []
            // Three people make two loops; each year has to be the other one
            for (const year of ['2026', '2027', '2028']) {
                const {body} = await admin('POST', '/draws', {name: year, participantIds: everyone, resultsVisibleFrom: '2026-01-01T00:00:00Z'})
                const drawId = body.draws[0].id
                const ran = await admin('POST', `/draws/${drawId}/run`)
                assert.equal(ran.status, 200)
                results.push(ran.body.draws.find(d => d.id === drawId)!.results)
            }
            const key = (pairings: Pairing[] | null) => pairings!.map(p => `${p.giverId}>${p.receiverIds}`).sort().join()
            assert.notEqual(key(results[0]), key(results[1]))
            assert.notEqual(key(results[1]), key(results[2]))
            assert.equal(key(results[0]), key(results[2]))

            // Avoiding the last two draws leaves nothing
            await admin('PATCH', '', {rules: {exclusions: [], avoidRecentDraws: 2, noSwaps: false, singleLoop: false}})
            const {body} = await admin('POST', '/draws', {name: '2029', participantIds: everyone, resultsVisibleFrom: null})
            const response = await admin<ApiError>('POST', `/draws/${body.draws[0].id}/run`)
            assert.deepEqual(response.body.blockers, ['avoidRecentDraws'])
        })

        it('redraws, undoes and deletes only while nobody has looked', async () => {
            const {drawn, call} = setup()
            const {admin, as, drawId, reveal, id} = await drawn()
            assert.equal((await admin('POST', `/draws/${drawId}/run`)).status, 200)
            assert.equal((await admin('POST', `/draws/${drawId}/undo`)).status, 200)
            assert.equal((await admin('POST', `/draws/${drawId}/undo`)).status, 409)
            assert.equal((await admin('POST', `/draws/${drawId}/run`)).status, 200)

            assert.equal((await reveal(as('Mum'), device(1))).status, 200)
            for (const [method, path] of [['POST', `/draws/${drawId}/run`], ['POST', `/draws/${drawId}/undo`], ['DELETE', `/draws/${drawId}`]]) {
                const response = await admin<ApiError>(method, path)
                assert.equal(response.status, 409, path)
                assert.match(response.body.message, /already opened theirs/)
            }
            // …and who takes part is set once drawn
            assert.equal((await admin('PATCH', `/draws/${drawId}`, {participantIds: [as('Mum'), as('Dad')]})).status, 409)
            // (but the name and the results date can change)
            const renamed = await admin('PATCH', `/draws/${drawId}`, {name: 'Christmas 2026', resultsVisibleFrom: '2026-12-25T10:00:00Z'})
            assert.equal(renamed.status, 200)
            assert.equal(renamed.body.draws[0].name, 'Christmas 2026')
            assert.equal((await call<Group>('GET', `/api/groups/${id}`)).body.draws[0].resultsVisibleFrom, '2026-12-25T10:00:00.000Z')
        })

        it('changes who takes part, and deletes, while still to be drawn', async () => {
            const {group} = setup()
            const {admin, as} = await group()
            const {body} = await admin('POST', '/draws', {name: '2026', participantIds: [as('Mum'), as('Dad'), as('Sue')], resultsVisibleFrom: null})
            const drawId = body.draws[0].id
            const changed = await admin('PATCH', `/draws/${drawId}`, {participantIds: [as('Mum'), as('Sue')]})
            assert.deepEqual(changed.body.draws[0].participantIds, [as('Mum'), as('Sue')])
            const deleted = await admin('DELETE', `/draws/${drawId}`)
            assert.deepEqual(deleted.body.draws, [])
        })
    })

    describe('revealing', () => {
        it('shows each person who they have, once, in one browser', async () => {
            const {drawn, call} = setup()
            const {as, reveal, id} = await drawn()
            const first = await reveal(as('Mum'), device(1))
            assert.equal(first.status, 200)
            assert.equal(first.body.receivers.length, 1)
            assert.ok(['Dad', 'Sue'].includes(first.body.receivers[0].name))
            assert.match(first.body.revealedAt, /^2026-11-22T12:00:00\.\d{3}Z$/)

            // The same browser can see it again
            assert.deepEqual((await reveal(as('Mum'), device(1))).body, first.body)
            // Any other can't
            const elsewhere = await reveal(as('Mum'), device(2))
            assert.equal(elsewhere.status, 409)
            assert.equal(elsewhere.body.error, 'already-revealed')
            assert.match(elsewhere.body.message, /Someone's already opened Mum's on another device/)

            // Everyone can see that Mum has looked, but not who she got
            const {body} = await call<Group>('GET', `/api/groups/${id}`)
            assert.deepEqual(body.draws[0].revealedIds, [as('Mum')])
            assert.equal(body.draws[0].results, null)
            assert.ok(!JSON.stringify(body).includes('receiverId'))
        })

        it('lets another browser have it once the organiser resets it', async () => {
            const {drawn} = setup()
            const {admin, as, reveal, drawId} = await drawn()
            const first = await reveal(as('Dad'), device(1))
            const reset = await admin('POST', `/draws/${drawId}/people/${as('Dad')}/reset`)
            assert.deepEqual(reset.body.draws[0].revealedIds, [])
            const second = await reveal(as('Dad'), device(2))
            assert.equal(second.status, 200)
            assert.deepEqual(second.body.receivers, first.body.receivers)
            assert.equal((await reveal(as('Dad'), device(1))).status, 409)
        })

        it("turns away people not in the draw, short tokens, and draws not yet drawn", async () => {
            const {drawn, group, call} = setup()
            const {as, reveal, id, drawId} = await drawn()
            assert.equal((await reveal('nobody', device(1))).status, 404)
            assert.equal((await reveal(as('Mum'), 'short')).status, 400)
            assert.equal((await call('POST', `/api/groups/${id}/draws/nope/reveal`, {personId: as('Mum'), deviceToken: device(1)})).status, 404)
            assert.equal((await call('POST', `/api/groups/${id}/draws/${drawId}/reveal`, {deviceToken: device(1)})).status, 404)

            const pending = await group()
            const {body} = await pending.admin('POST', '/draws', {name: '2026', participantIds: [pending.as('Mum'), pending.as('Dad')], resultsVisibleFrom: null})
            const response = await call<ApiError>('POST', `/api/groups/${pending.id}/draws/${body.draws[0].id}/reveal`, {personId: pending.as('Mum'), deviceToken: device(1)})
            assert.equal(response.status, 409)
            assert.match(response.body.message, /haven't been drawn/)
        })

        it('shows everyone every pairing once the results date has passed', async () => {
            const {drawn, call, setClock} = setup()
            const {id, reveal, as} = await drawn(['Mum', 'Dad', 'Sue'], '2026-12-25T10:00:00.000Z')
            const {body: mum} = await reveal(as('Mum'), device(1))
            assert.equal((await call<Group>('GET', `/api/groups/${id}`)).body.draws[0].results, null)
            setClock('2026-12-25T09:59:59.000Z')
            assert.equal((await call<Group>('GET', `/api/groups/${id}`)).body.draws[0].results, null)
            setClock('2026-12-25T09:59:59.999Z')
            const {results} = (await call<Group>('GET', `/api/groups/${id}`)).body.draws[0]
            assert.equal(results!.length, 3)
            assert.deepEqual(results!.find(r => r.giverId === as('Mum'))!.receiverIds, mum.receivers.map(r => r.id))
        })
    })

    it('refuses bodies that are too big or not JSON', async () => {
        const {call} = setup()
        const app = createApp({store: new MemoryStore()})
        const big = await app({method: 'POST', path: '/api/groups', headers: {}, body: 'x'.repeat(40_000), ip: null})
        assert.equal(big.status, 413)
        const garbled = await app({method: 'POST', path: '/api/groups', headers: {}, body: '{nope', ip: null})
        assert.equal(garbled.status, 400)
        assert.equal((await call('GET', '/api/health')).status, 200)
    })
})
