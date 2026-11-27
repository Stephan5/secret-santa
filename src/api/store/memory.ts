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

// A patch without its undefined fields (which mean "leave as is").
const defined = <T extends object>(patch: T): Partial<T> =>
    structuredClone(Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))) as Partial<T>

type State = {
    groups: Record<string, GroupAggregate>
    sessions: Record<string, SessionRecord>
    counters: Record<string, {count: number, expiresAt: string}>
}

// The store in memory, for local development and tests. Everything going in
// or out is copied, so nothing outside can change what it holds behind its
// back. onChange (if given) is called with the whole state after each write,
// which scripts/dev.ts uses to keep it in a file between restarts.
export class MemoryStore implements Store {
    private state: State
    private readonly onChange?: (state: State) => void

    constructor(initial?: State, onChange?: (state: State) => void) {
        this.state = initial ? structuredClone(initial) : {groups: {}, sessions: {}, counters: {}}
        this.onChange = onChange
    }

    private changed() {
        this.onChange?.(structuredClone(this.state))
    }

    private aggregate(groupId: string): GroupAggregate {
        const aggregate = this.state.groups[groupId]
        if (!aggregate) throw new ConflictError(`no group ${groupId}`)
        return aggregate
    }

    private draw(groupId: string, drawId: string): DrawRecord {
        const draw = this.aggregate(groupId).draws.find(d => d.id === drawId)
        if (!draw) throw new ConflictError(`no draw ${drawId}`)
        return draw
    }

    private pairingsOf(groupId: string, drawId: string): PairingRecord[] {
        return this.aggregate(groupId).pairings.filter(p => p.drawId === drawId)
    }

    async getGroup(groupId: string) {
        const aggregate = this.state.groups[groupId]
        return aggregate ? structuredClone(aggregate) : null
    }

    async createGroup(group: GroupRecord, people: PersonRecord[]) {
        if (this.state.groups[group.id]) throw new ConflictError('group exists')
        this.state.groups[group.id] = structuredClone({group, people, draws: [], pairings: []})
        this.changed()
    }

    async updateGroup(groupId: string, patch: Partial<GroupRecord>) {
        Object.assign(this.aggregate(groupId).group, defined(patch))
        this.changed()
    }

    async addPerson(groupId: string, person: PersonRecord) {
        const {people} = this.aggregate(groupId)
        if (people.some(p => p.id === person.id)) throw new ConflictError('person exists')
        people.push(structuredClone(person))
        this.changed()
    }

    async updatePerson(groupId: string, personId: string, patch: Partial<PersonRecord>) {
        const person = this.aggregate(groupId).people.find(p => p.id === personId)
        if (!person) throw new ConflictError(`no person ${personId}`)
        Object.assign(person, defined(patch))
        this.changed()
    }

    async createDraw(groupId: string, draw: DrawRecord) {
        const {draws} = this.aggregate(groupId)
        if (draws.some(d => d.id === draw.id)) throw new ConflictError('draw exists')
        draws.push(structuredClone(draw))
        this.changed()
    }

    async updateDraw(groupId: string, drawId: string, expectedStatus: DrawRecord['status'], patch: Partial<DrawRecord>) {
        const draw = this.draw(groupId, drawId)
        if (draw.status !== expectedStatus) throw new ConflictError(`draw is ${draw.status}`)
        Object.assign(draw, defined(patch))
        this.changed()
    }

    async saveDraw(groupId: string, drawId: string, expectedStatus: DrawRecord['status'], drawnAt: string,
        pairings: {giverId: string, receiverIds: string[]}[]) {
        const draw = this.draw(groupId, drawId)
        if (draw.status !== expectedStatus) throw new ConflictError(`draw is ${draw.status}`)
        const replacing = this.pairingsOf(groupId, drawId)
        if (replacing.some(p => p.revealedAt)) throw new ConflictError('someone has revealed')
        const aggregate = this.aggregate(groupId)
        aggregate.pairings = [
            ...aggregate.pairings.filter(p => p.drawId !== drawId),
            ...pairings.map(p => ({drawId, ...p, revealedAt: null, deviceHash: null})),
        ]
        Object.assign(draw, {status: 'drawn', drawnAt})
        this.changed()
    }

    async undoDraw(groupId: string, drawId: string) {
        const draw = this.draw(groupId, drawId)
        if (draw.status !== 'drawn') throw new ConflictError(`draw is ${draw.status}`)
        if (this.pairingsOf(groupId, drawId).some(p => p.revealedAt)) throw new ConflictError('someone has revealed')
        const aggregate = this.aggregate(groupId)
        aggregate.pairings = aggregate.pairings.filter(p => p.drawId !== drawId)
        Object.assign(draw, {status: 'pending', drawnAt: null})
        this.changed()
    }

    async deleteDraw(groupId: string, drawId: string) {
        this.draw(groupId, drawId)
        if (this.pairingsOf(groupId, drawId).some(p => p.revealedAt)) throw new ConflictError('someone has revealed')
        const aggregate = this.aggregate(groupId)
        aggregate.draws = aggregate.draws.filter(d => d.id !== drawId)
        aggregate.pairings = aggregate.pairings.filter(p => p.drawId !== drawId)
        this.changed()
    }

    async reveal(groupId: string, drawId: string, giverId: string, deviceHash: string, now: string): Promise<RevealResult> {
        const pairing = this.state.groups[groupId]?.pairings.find(p => p.drawId === drawId && p.giverId === giverId)
        if (!pairing) return {outcome: 'missing'}
        if (pairing.revealedAt && pairing.deviceHash !== deviceHash) return {outcome: 'elsewhere'}
        if (!pairing.revealedAt) {
            pairing.revealedAt = now
            pairing.deviceHash = deviceHash
            this.changed()
        }
        return {outcome: 'revealed', pairing: structuredClone(pairing)}
    }

    async resetReveal(groupId: string, drawId: string, giverId: string) {
        const pairing = this.pairingsOf(groupId, drawId).find(p => p.giverId === giverId)
        if (!pairing) throw new ConflictError(`no pairing for ${giverId}`)
        pairing.revealedAt = null
        pairing.deviceHash = null
        this.changed()
    }

    async putSession(session: SessionRecord) {
        this.state.sessions[session.tokenHash] = structuredClone(session)
        this.changed()
    }

    async getSession(tokenHash: string) {
        const session = this.state.sessions[tokenHash]
        return session ? structuredClone(session) : null
    }

    async deleteSession(tokenHash: string) {
        delete this.state.sessions[tokenHash]
        this.changed()
    }

    // (keeps counting however late, as DynamoDB does until TTL gets round to
    // deleting the item: what bounds a count is the time window in its key)
    async increment(key: string, expiresAt: Date) {
        const counter = this.state.counters[key]
        const count = (counter?.count ?? 0) + 1
        this.state.counters[key] = {count, expiresAt: counter?.expiresAt ?? expiresAt.toISOString()}
        this.changed()
        return count
    }
}
