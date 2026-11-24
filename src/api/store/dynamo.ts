import {ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException} from '@aws-sdk/client-dynamodb'
import {
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand,
    type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb'
import {
    ConflictError,
    type DrawRecord,
    type GroupAggregate,
    type GroupRecord,
    type PairingRecord,
    type PersonRecord,
    type RevealResult,
    type SessionRecord,
    type Store,
} from './store.ts'

// One table, keyed pk + sk. A group's items share its partition, so loading
// a group is one query:
//
//   pk G#<group>   sk GROUP                 name, password hash, rules…
//                  sk PERSON#<person>       name, active
//                  sk DRAW#<draw>           name, status, participants…
//                  sk PAIR#<draw>#<giver>   receivers, revealedAt, deviceHash
//   pk S#<token hash>  sk SESSION           admin sessions, expiring by TTL
//   pk C#<key>         sk COUNTER           rate limit counters, likewise
//
// Nulls aren't stored: an attribute that's null in a record is absent from
// its item (so "not revealed" is attribute_not_exists(revealedAt)).
//
// Items from before each could buy for more than one have no giftsEach on a
// draw (one, then) and a single receiverId on a pairing, not receiverIds.

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number]

const groupKey = (groupId: string) => `G#${groupId}`
const keys = {
    group: (groupId: string) => ({pk: groupKey(groupId), sk: 'GROUP'}),
    person: (groupId: string, personId: string) => ({pk: groupKey(groupId), sk: `PERSON#${personId}`}),
    draw: (groupId: string, drawId: string) => ({pk: groupKey(groupId), sk: `DRAW#${drawId}`}),
    pairing: (groupId: string, drawId: string, giverId: string) => ({pk: groupKey(groupId), sk: `PAIR#${drawId}#${giverId}`}),
    session: (tokenHash: string) => ({pk: `S#${tokenHash}`, sk: 'SESSION'}),
    counter: (key: string) => ({pk: `C#${key}`, sk: 'COUNTER'}),
}

const epochSeconds = (iso: string | Date) => Math.ceil(new Date(iso).getTime() / 1000)

// A record as an item: nulls left out.
function withoutNulls<T extends object>(record: T): Partial<T> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null)) as Partial<T>
}

// SET for each field given, REMOVE for each null, as an update's
// expression and its names and values.
function updateFor(patch: Record<string, unknown>) {
    const sets: string[] = []
    const removes: string[] = []
    const names: Record<string, string> = {}
    const values: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(patch)) {
        if (value === undefined) continue
        names[`#${field}`] = field
        if (value === null) {
            removes.push(`#${field}`)
        } else {
            sets.push(`#${field} = :${field}`)
            values[`:${field}`] = value
        }
    }
    const expression = [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : '']
        .filter(Boolean).join(' ')
    return {expression, names, values}
}

const receiversOf = (item: Record<string, unknown>) =>
    (item.receiverIds as string[] | undefined) ?? [item.receiverId as string]

async function conflictOnFailedCondition<T>(operation: Promise<T>): Promise<T> {
    try {
        return await operation
    } catch (error) {
        if (error instanceof ConditionalCheckFailedException) throw new ConflictError(error.message)
        if (error instanceof TransactionCanceledException) {
            const reasons = error.CancellationReasons?.map(reason => reason.Code) ?? []
            if (reasons.some(code => code === 'ConditionalCheckFailed' || code === 'TransactionConflict')) {
                throw new ConflictError(`transaction cancelled: ${reasons.join(', ')}`)
            }
        }
        throw error
    }
}

export class DynamoStore implements Store {
    private readonly db: DynamoDBDocumentClient
    private readonly table: string

    constructor(table: string, client = new DynamoDBClient({})) {
        this.table = table
        this.db = DynamoDBDocumentClient.from(client, {marshallOptions: {removeUndefinedValues: true}})
    }

    async getGroup(groupId: string): Promise<GroupAggregate | null> {
        const items: Record<string, unknown>[] = []
        let startKey: Record<string, unknown> | undefined
        do {
            const page = await this.db.send(new QueryCommand({
                TableName: this.table,
                KeyConditionExpression: 'pk = :pk',
                ExpressionAttributeValues: {':pk': groupKey(groupId)},
                ExclusiveStartKey: startKey,
                ConsistentRead: true,
            }))
            items.push(...(page.Items ?? []))
            startKey = page.LastEvaluatedKey
        } while (startKey)

        const groupItem = items.find(item => item.sk === 'GROUP')
        if (!groupItem) return null
        const of = (prefix: string) => items.filter(item => (item.sk as string).startsWith(prefix))
        return {
            group: {
                id: groupId,
                name: groupItem.name as string,
                adminPasswordHash: groupItem.adminPasswordHash as string,
                rules: groupItem.rules as GroupRecord['rules'],
                createdAt: groupItem.createdAt as string,
                failedLogins: (groupItem.failedLogins as number | undefined) ?? 0,
                lockedUntil: (groupItem.lockedUntil as string | undefined) ?? null,
            },
            people: of('PERSON#').map(item => ({
                id: item.id as string,
                name: item.name as string,
                active: item.active as boolean,
                createdAt: item.createdAt as string,
            })),
            draws: of('DRAW#').map(item => ({
                id: item.id as string,
                name: item.name as string,
                status: item.status as DrawRecord['status'],
                participantIds: item.participantIds as string[],
                giftsEach: (item.giftsEach as number | undefined) ?? 1,
                resultsVisibleFrom: (item.resultsVisibleFrom as string | undefined) ?? null,
                createdAt: item.createdAt as string,
                drawnAt: (item.drawnAt as string | undefined) ?? null,
            })),
            pairings: of('PAIR#').map(item => ({
                drawId: item.drawId as string,
                giverId: item.giverId as string,
                receiverIds: receiversOf(item),
                revealedAt: (item.revealedAt as string | undefined) ?? null,
                deviceHash: (item.deviceHash as string | undefined) ?? null,
            })),
        }
    }

    async createGroup(group: GroupRecord, people: PersonRecord[]) {
        await conflictOnFailedCondition(this.db.send(new TransactWriteCommand({TransactItems: [
            {Put: {
                TableName: this.table,
                Item: {...keys.group(group.id), ...withoutNulls(group)},
                ConditionExpression: 'attribute_not_exists(pk)',
            }},
            ...people.map((person): TransactItem => ({Put: {
                TableName: this.table,
                Item: {...keys.person(group.id, person.id), ...person},
            }})),
        ]})))
    }

    private async update(key: Record<string, string>, patch: Record<string, unknown>, condition = 'attribute_exists(pk)',
        conditionValues: Record<string, unknown> = {}, conditionNames: Record<string, string> = {}) {
        const {expression, names, values} = updateFor(patch)
        if (!expression) return
        const allValues = {...values, ...conditionValues}
        await conflictOnFailedCondition(this.db.send(new UpdateCommand({
            TableName: this.table,
            Key: key,
            UpdateExpression: expression,
            ConditionExpression: condition,
            ExpressionAttributeNames: {...names, ...conditionNames},
            ExpressionAttributeValues: Object.keys(allValues).length ? allValues : undefined,
        })))
    }

    async updateGroup(groupId: string, patch: Partial<GroupRecord>) {
        await this.update(keys.group(groupId), patch)
    }

    async addPerson(groupId: string, person: PersonRecord) {
        await conflictOnFailedCondition(this.db.send(new PutCommand({
            TableName: this.table,
            Item: {...keys.person(groupId, person.id), ...person},
            ConditionExpression: 'attribute_not_exists(pk)',
        })))
    }

    async updatePerson(groupId: string, personId: string, patch: Partial<PersonRecord>) {
        await this.update(keys.person(groupId, personId), patch)
    }

    async createDraw(groupId: string, draw: DrawRecord) {
        await conflictOnFailedCondition(this.db.send(new PutCommand({
            TableName: this.table,
            Item: {...keys.draw(groupId, draw.id), ...withoutNulls(draw)},
            ConditionExpression: 'attribute_not_exists(pk)',
        })))
    }

    async updateDraw(groupId: string, drawId: string, expectedStatus: DrawRecord['status'], patch: Partial<DrawRecord>) {
        await this.update(keys.draw(groupId, drawId), patch,
            'attribute_exists(pk) AND #drawStatus = :expectedStatus', {':expectedStatus': expectedStatus}, {'#drawStatus': 'status'})
    }

    async saveDraw(groupId: string, drawId: string, expectedStatus: DrawRecord['status'], drawnAt: string,
        pairings: {giverId: string, receiverIds: string[]}[]) {
        await conflictOnFailedCondition(this.db.send(new TransactWriteCommand({TransactItems: [
            {Update: {
                TableName: this.table,
                Key: keys.draw(groupId, drawId),
                UpdateExpression: 'SET #status = :drawn, drawnAt = :drawnAt',
                ConditionExpression: 'attribute_exists(pk) AND #status = :expected',
                ExpressionAttributeNames: {'#status': 'status'},
                ExpressionAttributeValues: {':drawn': 'drawn', ':drawnAt': drawnAt, ':expected': expectedStatus},
            }},
            ...pairings.map((pairing): TransactItem => ({Put: {
                TableName: this.table,
                Item: {...keys.pairing(groupId, drawId, pairing.giverId), drawId, ...pairing},
                // (replacing a pairing nobody has looked at, or none)
                ConditionExpression: 'attribute_not_exists(revealedAt)',
            }})),
        ]})))
    }

    private deletePairings(groupId: string, drawId: string, giverIds: string[]): TransactItem[] {
        return giverIds.map(giverId => ({Delete: {
            TableName: this.table,
            Key: keys.pairing(groupId, drawId, giverId),
            ConditionExpression: 'attribute_not_exists(revealedAt)',
        }}))
    }

    async undoDraw(groupId: string, drawId: string, giverIds: string[]) {
        await conflictOnFailedCondition(this.db.send(new TransactWriteCommand({TransactItems: [
            {Update: {
                TableName: this.table,
                Key: keys.draw(groupId, drawId),
                UpdateExpression: 'SET #status = :pending REMOVE drawnAt',
                ConditionExpression: 'attribute_exists(pk) AND #status = :drawn',
                ExpressionAttributeNames: {'#status': 'status'},
                ExpressionAttributeValues: {':pending': 'pending', ':drawn': 'drawn'},
            }},
            ...this.deletePairings(groupId, drawId, giverIds),
        ]})))
    }

    async deleteDraw(groupId: string, drawId: string, giverIds: string[]) {
        await conflictOnFailedCondition(this.db.send(new TransactWriteCommand({TransactItems: [
            {Delete: {
                TableName: this.table,
                Key: keys.draw(groupId, drawId),
                ConditionExpression: 'attribute_exists(pk)',
            }},
            ...this.deletePairings(groupId, drawId, giverIds),
        ]})))
    }

    async reveal(groupId: string, drawId: string, giverId: string, deviceHash: string, now: string): Promise<RevealResult> {
        try {
            const result = await this.db.send(new UpdateCommand({
                TableName: this.table,
                Key: keys.pairing(groupId, drawId, giverId),
                // The first browser to ask claims it; the same one asking
                // again changes nothing.
                UpdateExpression: 'SET revealedAt = if_not_exists(revealedAt, :now), deviceHash = if_not_exists(deviceHash, :device)',
                ConditionExpression: 'attribute_exists(pk) AND (attribute_not_exists(revealedAt) OR deviceHash = :device)',
                ExpressionAttributeValues: {':now': now, ':device': deviceHash},
                ReturnValues: 'ALL_NEW',
                ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            }))
            const item = result.Attributes!
            return {outcome: 'revealed', pairing: {
                drawId,
                giverId,
                receiverIds: receiversOf(item),
                revealedAt: item.revealedAt as string,
                deviceHash: item.deviceHash as string,
            } satisfies PairingRecord}
        } catch (error) {
            if (error instanceof ConditionalCheckFailedException) {
                return {outcome: error.Item ? 'elsewhere' : 'missing'}
            }
            throw error
        }
    }

    async resetReveal(groupId: string, drawId: string, giverId: string) {
        await this.update(keys.pairing(groupId, drawId, giverId), {revealedAt: null, deviceHash: null})
    }

    async putSession(session: SessionRecord) {
        await this.db.send(new PutCommand({
            TableName: this.table,
            Item: {...keys.session(session.tokenHash), ...session, ttl: epochSeconds(session.expiresAt)},
        }))
    }

    async getSession(tokenHash: string): Promise<SessionRecord | null> {
        const {Item: item} = await this.db.send(new GetCommand({TableName: this.table, Key: keys.session(tokenHash)}))
        return item ? {tokenHash, groupId: item.groupId as string, expiresAt: item.expiresAt as string} : null
    }

    async deleteSession(tokenHash: string) {
        await this.db.send(new DeleteCommand({TableName: this.table, Key: keys.session(tokenHash)}))
    }

    async increment(key: string, expiresAt: Date) {
        const result = await this.db.send(new UpdateCommand({
            TableName: this.table,
            Key: keys.counter(key),
            UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
            ExpressionAttributeNames: {'#count': 'count', '#ttl': 'ttl'},
            ExpressionAttributeValues: {':one': 1, ':ttl': epochSeconds(expiresAt)},
            ReturnValues: 'UPDATED_NEW',
        }))
        return result.Attributes!.count as number
    }
}
