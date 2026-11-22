import type {DrawStatus, Rules} from '../../shared/api.ts'

// What the API keeps, and the operations on it. There are two
// implementations, DynamoDB's (dynamo.ts) and an in-memory one for local
// development and tests (memory.ts), held to the same behaviour by the
// tests in store.test.ts, run against both.
//
// Anything that has to hold under concurrent requests (one reveal per
// pairing, no redraw once someone has looked) is a single conditional
// operation here, never a read then a write in the API.

export type GroupRecord = {
    id: string
    name: string
    adminPasswordHash: string
    rules: Rules
    createdAt: string
    // Wrong admin passwords in a row, and when the lock they earned ends
    failedLogins: number
    lockedUntil: string | null
}

export type PersonRecord = {
    id: string
    name: string
    active: boolean
    createdAt: string
}

export type DrawRecord = {
    id: string
    name: string
    status: DrawStatus
    participantIds: string[]
    resultsVisibleFrom: string | null
    createdAt: string
    drawnAt: string | null
}

export type PairingRecord = {
    drawId: string
    giverId: string
    receiverId: string
    revealedAt: string | null
    // A hash of the token of the browser it was revealed in
    deviceHash: string | null
}

export type GroupAggregate = {
    group: GroupRecord
    people: PersonRecord[]
    draws: DrawRecord[]
    pairings: PairingRecord[]
}

export type SessionRecord = {
    tokenHash: string
    groupId: string
    expiresAt: string
}

export type RevealResult =
    | {outcome: 'revealed', pairing: PairingRecord}
    // Already revealed in another browser
    | {outcome: 'elsewhere'}
    | {outcome: 'missing'}

// A conditional operation's condition didn't hold: the thing it expected
// (a draw still pending, a pairing nobody has looked at) had changed.
export class ConflictError extends Error {}

export interface Store {
    getGroup(groupId: string): Promise<GroupAggregate | null>
    // Fails with ConflictError if the id is taken.
    createGroup(group: GroupRecord, people: PersonRecord[]): Promise<void>
    updateGroup(groupId: string, patch: Partial<Pick<GroupRecord, 'name' | 'rules' | 'failedLogins' | 'lockedUntil'>>): Promise<void>

    // Fails with ConflictError if the id is taken.
    addPerson(groupId: string, person: PersonRecord): Promise<void>
    updatePerson(groupId: string, personId: string, patch: Partial<Pick<PersonRecord, 'name' | 'active'>>): Promise<void>

    // Fails with ConflictError if the id is taken.
    createDraw(groupId: string, draw: DrawRecord): Promise<void>
    // Fails with ConflictError unless the draw has the expected status.
    updateDraw(groupId: string, drawId: string, expectedStatus: DrawStatus,
        patch: Partial<Pick<DrawRecord, 'name' | 'participantIds' | 'resultsVisibleFrom'>>): Promise<void>
    // Marks the draw drawn and writes its pairings, all at once, replacing
    // any it had. Fails with ConflictError unless the draw has the expected
    // status and nobody has revealed any pairing it's replacing.
    saveDraw(groupId: string, drawId: string, expectedStatus: DrawStatus, drawnAt: string,
        pairings: {giverId: string, receiverId: string}[]): Promise<void>
    // Puts a drawn draw back to pending, deleting its pairings. Fails with
    // ConflictError unless it's drawn and nobody has revealed.
    undoDraw(groupId: string, drawId: string, giverIds: string[]): Promise<void>
    // Fails with ConflictError if anybody has revealed.
    deleteDraw(groupId: string, drawId: string, giverIds: string[]): Promise<void>

    // Reveals a pairing to a browser: the first to ask gets it, and keeps
    // it; any other gets 'elsewhere'.
    reveal(groupId: string, drawId: string, giverId: string, deviceHash: string, now: string): Promise<RevealResult>
    resetReveal(groupId: string, drawId: string, giverId: string): Promise<void>

    putSession(session: SessionRecord): Promise<void>
    getSession(tokenHash: string): Promise<SessionRecord | null>
    deleteSession(tokenHash: string): Promise<void>

    // Adds one to a counter, kept until expiresAt, and returns its new value.
    increment(key: string, expiresAt: Date): Promise<number>
}
