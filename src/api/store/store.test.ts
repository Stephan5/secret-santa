import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {after, before, describe, it} from 'node:test'
import {CreateTableCommand, DeleteTableCommand, DynamoDBClient, PutItemCommand} from '@aws-sdk/client-dynamodb'
import {defaultRules} from '../../shared/api.ts'
import {DynamoStore} from './dynamo.ts'
import {MemoryStore} from './memory.ts'
import {ConflictError, type GroupRecord, type PersonRecord, type Store} from './store.ts'

// The same tests for both stores, so the in-memory one the API's tests and
// local development use behaves as DynamoDB does. DynamoDB's run only with
// DYNAMODB_ENDPOINT set, pointing at DynamoDB Local (CI starts one; see the
// README to run one yourself).

const group = (id = randomUUID()): GroupRecord => ({
    id,
    name: 'Blakeslee Christmas',
    adminPasswordHash: 'hash',
    rules: defaultRules,
    createdAt: '2026-11-01T00:00:00.000Z',
    failedLogins: 0,
    lockedUntil: null,
})

const person = (id: string, name = id): PersonRecord => ({id, name, active: true, createdAt: '2026-11-01T00:00:00.000Z'})

const pending = (id: string, participantIds: string[]) => ({
    id,
    name: '2026',
    status: 'pending' as const,
    participantIds,
    giftsEach: 1,
    resultsVisibleFrom: null,
    createdAt: '2026-11-02T00:00:00.000Z',
    drawnAt: null,
})

const loop = [
    {giverId: 'a', receiverIds: ['b']},
    {giverId: 'b', receiverIds: ['c']},
    {giverId: 'c', receiverIds: ['a']},
]
const otherLoop = [
    {giverId: 'a', receiverIds: ['c']},
    {giverId: 'c', receiverIds: ['b']},
    {giverId: 'b', receiverIds: ['a']},
]

function contract(label: string, makeStore: () => Store) {
    describe(label, () => {
        let store: Store
        before(() => {
            store = makeStore()
        })

        // A group of three with a 2026 draw, drawn as a → b → c → a.
        async function drawnGroup() {
            const g = group()
            await store.createGroup(g, [person('a'), person('b'), person('c')])
            await store.createDraw(g.id, pending('d1', ['a', 'b', 'c']))
            await store.saveDraw(g.id, 'd1', 'pending', '2026-11-03T00:00:00.000Z', loop)
            return g.id
        }

        it('keeps a group and its people', async () => {
            const g = group()
            await store.createGroup(g, [person('a', 'Mum'), person('b', 'Dad')])
            const loaded = await store.getGroup(g.id)
            assert.deepEqual(loaded, {group: g, people: [person('a', 'Mum'), person('b', 'Dad')], draws: [], pairings: []})
        })

        it("doesn't know groups it hasn't got", async () => {
            assert.equal(await store.getGroup(randomUUID()), null)
        })

        it("won't create a group twice", async () => {
            const g = group()
            await store.createGroup(g, [])
            await assert.rejects(store.createGroup(g, []), ConflictError)
        })

        it('updates a group, setting and clearing fields', async () => {
            const g = group()
            await store.createGroup(g, [])
            const rules = {...defaultRules, exclusions: [['a', 'b']] as [string, string][], noSwaps: true}
            await store.updateGroup(g.id, {name: 'Renamed', rules, failedLogins: 3, lockedUntil: '2026-11-05T00:00:00.000Z'})
            assert.deepEqual((await store.getGroup(g.id))?.group,
                {...g, name: 'Renamed', rules, failedLogins: 3, lockedUntil: '2026-11-05T00:00:00.000Z'})
            await store.updateGroup(g.id, {failedLogins: 0, lockedUntil: null})
            assert.deepEqual((await store.getGroup(g.id))?.group, {...g, name: 'Renamed', rules})
        })

        it('leaves fields an update leaves out, or gives as undefined', async () => {
            const g = group()
            await store.createGroup(g, [person('a', 'Mum')])
            await store.updateGroup(g.id, {name: undefined, rules: undefined, failedLogins: 2})
            await store.updatePerson(g.id, 'a', {name: undefined, active: false})
            const loaded = (await store.getGroup(g.id))!
            assert.deepEqual(loaded.group, {...g, failedLogins: 2})
            assert.deepEqual(loaded.people, [{...person('a', 'Mum'), active: false}])
        })

        it('adds and updates people', async () => {
            const g = group()
            await store.createGroup(g, [])
            await store.addPerson(g.id, person('a', 'Mum'))
            await assert.rejects(store.addPerson(g.id, person('a', 'Mum')), ConflictError)
            await store.updatePerson(g.id, 'a', {name: 'Mother', active: false})
            assert.deepEqual((await store.getGroup(g.id))?.people, [{...person('a', 'Mother'), active: false}])
            await assert.rejects(store.updatePerson(g.id, 'nobody', {name: 'X'}), ConflictError)
        })

        it('updates a draw only while it has the status expected', async () => {
            const g = group()
            await store.createGroup(g, [])
            await store.createDraw(g.id, pending('d1', ['a', 'b']))
            await assert.rejects(store.createDraw(g.id, pending('d1', ['a', 'b'])), ConflictError)
            await store.updateDraw(g.id, 'd1', 'pending', {name: '2027', participantIds: ['a', 'b', 'c'], resultsVisibleFrom: '2026-12-25T00:00:00.000Z'})
            await assert.rejects(store.updateDraw(g.id, 'd1', 'drawn', {name: 'nope'}), ConflictError)
            await assert.rejects(store.updateDraw(g.id, 'nope', 'pending', {name: 'nope'}), ConflictError)
            const [draw] = (await store.getGroup(g.id))!.draws
            assert.deepEqual(draw, {...pending('d1', ['a', 'b', 'c']), name: '2027', resultsVisibleFrom: '2026-12-25T00:00:00.000Z'})
            await store.updateDraw(g.id, 'd1', 'pending', {resultsVisibleFrom: null})
            assert.equal((await store.getGroup(g.id))!.draws[0].resultsVisibleFrom, null)
        })

        it('saves a draw and its pairings together', async () => {
            const groupId = await drawnGroup()
            const loaded = (await store.getGroup(groupId))!
            assert.equal(loaded.draws[0].status, 'drawn')
            assert.equal(loaded.draws[0].drawnAt, '2026-11-03T00:00:00.000Z')
            assert.deepEqual(
                loaded.pairings.toSorted((x, y) => x.giverId.localeCompare(y.giverId)),
                loop.map(p => ({drawId: 'd1', ...p, revealedAt: null, deviceHash: null})))
            // (not twice from pending)
            await assert.rejects(store.saveDraw(groupId, 'd1', 'pending', '2026-11-04T00:00:00.000Z', otherLoop), ConflictError)
        })

        it('keeps more than one receiver for each giver', async () => {
            const g = group()
            await store.createGroup(g, [person('a'), person('b'), person('c')])
            await store.createDraw(g.id, {...pending('d1', ['a', 'b', 'c']), giftsEach: 2})
            const both = [
                {giverId: 'a', receiverIds: ['b', 'c']},
                {giverId: 'b', receiverIds: ['c', 'a']},
                {giverId: 'c', receiverIds: ['a', 'b']},
            ]
            await store.saveDraw(g.id, 'd1', 'pending', '2026-11-03T00:00:00.000Z', both)
            const loaded = (await store.getGroup(g.id))!
            assert.equal(loaded.draws[0].giftsEach, 2)
            assert.deepEqual(
                loaded.pairings.toSorted((x, y) => x.giverId.localeCompare(y.giverId)),
                both.toSorted((x, y) => x.giverId.localeCompare(y.giverId)).map(p => ({drawId: 'd1', ...p, revealedAt: null, deviceHash: null})))
            const revealed = await store.reveal(g.id, 'd1', 'b', 'device-1', '2026-11-05T00:00:00.000Z')
            assert.deepEqual(revealed.outcome === 'revealed' && revealed.pairing.receiverIds, ['c', 'a'])
        })

        it('redraws only while nobody has looked, all or nothing', async () => {
            const groupId = await drawnGroup()
            await store.saveDraw(groupId, 'd1', 'drawn', '2026-11-04T00:00:00.000Z', otherLoop)
            const receiverOf = async (giverId: string) =>
                (await store.getGroup(groupId))!.pairings.find(p => p.giverId === giverId)!.receiverIds[0]
            assert.equal(await receiverOf('a'), 'c')

            await store.reveal(groupId, 'd1', 'b', 'device-1', '2026-11-05T00:00:00.000Z')
            await assert.rejects(store.saveDraw(groupId, 'd1', 'drawn', '2026-11-06T00:00:00.000Z', loop), ConflictError)
            // (a's pairing, which nobody had looked at, is untouched too)
            assert.equal(await receiverOf('a'), 'c')
            assert.equal((await store.getGroup(groupId))!.draws[0].drawnAt, '2026-11-04T00:00:00.000Z')
        })

        it('reveals a pairing to the first browser that asks, and only to it', async () => {
            const groupId = await drawnGroup()
            const first = await store.reveal(groupId, 'd1', 'a', 'device-1', '2026-11-05T00:00:00.000Z')
            assert.deepEqual(first, {outcome: 'revealed', pairing: {
                drawId: 'd1', giverId: 'a', receiverIds: ['b'], revealedAt: '2026-11-05T00:00:00.000Z', deviceHash: 'device-1',
            }})
            // Again in the same browser: the same, still revealed when it first was
            assert.deepEqual(await store.reveal(groupId, 'd1', 'a', 'device-1', '2026-11-06T00:00:00.000Z'), first)
            assert.deepEqual(await store.reveal(groupId, 'd1', 'a', 'device-2', '2026-11-06T00:00:00.000Z'), {outcome: 'elsewhere'})
            assert.deepEqual(await store.reveal(groupId, 'd1', 'nobody', 'device-1', '2026-11-06T00:00:00.000Z'), {outcome: 'missing'})
            assert.deepEqual(await store.reveal(groupId, 'd2', 'a', 'device-1', '2026-11-06T00:00:00.000Z'), {outcome: 'missing'})
        })

        it('reveals to only one of two browsers asking at once', async () => {
            const groupId = await drawnGroup()
            const results = await Promise.all(Array.from({length: 8}, (_, i) =>
                store.reveal(groupId, 'd1', 'a', `device-${i}`, '2026-11-05T00:00:00.000Z')))
            assert.equal(results.filter(r => r.outcome === 'revealed').length, 1)
            assert.equal(results.filter(r => r.outcome === 'elsewhere').length, 7)
        })

        it('resets a reveal, so another browser can have it', async () => {
            const groupId = await drawnGroup()
            await store.reveal(groupId, 'd1', 'a', 'device-1', '2026-11-05T00:00:00.000Z')
            await store.resetReveal(groupId, 'd1', 'a')
            const pairing = (await store.getGroup(groupId))!.pairings.find(p => p.giverId === 'a')
            assert.deepEqual(pairing, {drawId: 'd1', giverId: 'a', receiverIds: ['b'], revealedAt: null, deviceHash: null})
            assert.equal((await store.reveal(groupId, 'd1', 'a', 'device-2', '2026-11-06T00:00:00.000Z')).outcome, 'revealed')
            await assert.rejects(store.resetReveal(groupId, 'd1', 'nobody'), ConflictError)
        })

        it('undoes a draw only while nobody has looked', async () => {
            const groupId = await drawnGroup()
            await store.undoDraw(groupId, 'd1', ['a', 'b', 'c'])
            let loaded = (await store.getGroup(groupId))!
            assert.deepEqual(loaded.draws[0], pending('d1', ['a', 'b', 'c']))
            assert.deepEqual(loaded.pairings, [])
            await assert.rejects(store.undoDraw(groupId, 'd1', []), ConflictError)

            await store.saveDraw(groupId, 'd1', 'pending', '2026-11-04T00:00:00.000Z', loop)
            await store.reveal(groupId, 'd1', 'c', 'device-1', '2026-11-05T00:00:00.000Z')
            await assert.rejects(store.undoDraw(groupId, 'd1', ['a', 'b', 'c']), ConflictError)
            loaded = (await store.getGroup(groupId))!
            assert.equal(loaded.draws[0].status, 'drawn')
            assert.equal(loaded.pairings.length, 3)
        })

        it('deletes a draw only while nobody has looked', async () => {
            const groupId = await drawnGroup()
            await store.reveal(groupId, 'd1', 'a', 'device-1', '2026-11-05T00:00:00.000Z')
            await assert.rejects(store.deleteDraw(groupId, 'd1', ['a', 'b', 'c']), ConflictError)
            assert.equal((await store.getGroup(groupId))!.pairings.length, 3)
            await store.resetReveal(groupId, 'd1', 'a')
            await store.deleteDraw(groupId, 'd1', ['a', 'b', 'c'])
            const loaded = (await store.getGroup(groupId))!
            assert.deepEqual([loaded.draws, loaded.pairings], [[], []])
            await assert.rejects(store.deleteDraw(groupId, 'd1', []), ConflictError)
        })

        it('keeps sessions', async () => {
            const session = {tokenHash: randomUUID(), groupId: 'g', expiresAt: '2026-11-05T00:00:00.000Z'}
            await store.putSession(session)
            assert.deepEqual(await store.getSession(session.tokenHash), session)
            await store.deleteSession(session.tokenHash)
            assert.equal(await store.getSession(session.tokenHash), null)
        })

        it('counts', async () => {
            const key = randomUUID()
            const expiresAt = new Date(Date.now() + 60_000)
            assert.equal(await store.increment(key, expiresAt), 1)
            assert.equal(await store.increment(key, expiresAt), 2)
            assert.equal(await store.increment(randomUUID(), expiresAt), 1)
        })

        // (whatever the clock says: the API's clock isn't always the real one)
        it('keeps counting past a counter\'s expiry', async () => {
            const key = randomUUID()
            const expired = new Date(Date.now() - 60_000)
            assert.equal(await store.increment(key, expired), 1)
            assert.equal(await store.increment(key, expired), 2)
        })
    })
}

contract('MemoryStore', () => new MemoryStore())

const endpoint = process.env.DYNAMODB_ENDPOINT
describe('DynamoStore', {skip: endpoint ? false : 'DYNAMODB_ENDPOINT not set'}, () => {
    const table = `secret-santa-test-${randomUUID()}`
    const client = new DynamoDBClient({
        endpoint,
        region: 'eu-west-2',
        credentials: {accessKeyId: 'local', secretAccessKey: 'local'},
    })
    before(async () => {
        await client.send(new CreateTableCommand({
            TableName: table,
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [{AttributeName: 'pk', AttributeType: 'S'}, {AttributeName: 'sk', AttributeType: 'S'}],
            KeySchema: [{AttributeName: 'pk', KeyType: 'HASH'}, {AttributeName: 'sk', KeyType: 'RANGE'}],
        }))
    })
    after(async () => {
        await client.send(new DeleteTableCommand({TableName: table}))
        client.destroy()
    })
    contract('against DynamoDB Local', () => new DynamoStore(table, client))

    it('reads draws and pairings saved before each could buy for more than one', async () => {
        const store = new DynamoStore(table, client)
        const g = group()
        await store.createGroup(g, [person('a'), person('b')])
        const pk = {S: `G#${g.id}`}
        await client.send(new PutItemCommand({TableName: table, Item: {
            pk, sk: {S: 'DRAW#d1'}, id: {S: 'd1'}, name: {S: '2025'}, status: {S: 'drawn'},
            participantIds: {L: [{S: 'a'}, {S: 'b'}]}, createdAt: {S: '2025-11-02T00:00:00.000Z'}, drawnAt: {S: '2025-11-03T00:00:00.000Z'},
        }}))
        await client.send(new PutItemCommand({TableName: table, Item: {
            pk, sk: {S: 'PAIR#d1#a'}, drawId: {S: 'd1'}, giverId: {S: 'a'}, receiverId: {S: 'b'},
        }}))
        const loaded = (await store.getGroup(g.id))!
        assert.equal(loaded.draws[0].giftsEach, 1)
        assert.deepEqual(loaded.pairings[0].receiverIds, ['b'])
        const revealed = await store.reveal(g.id, 'd1', 'a', 'device-1', '2026-11-05T00:00:00.000Z')
        assert.deepEqual(revealed.outcome === 'revealed' && revealed.pairing.receiverIds, ['b'])
    })
})
