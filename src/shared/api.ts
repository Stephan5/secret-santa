// The API's request and response shapes, shared by the Lambda and the web app.
//
// Naming: a Group is what the site calls "a Secret Santa" (the family's,
// the office's), its People are the names in the hat, and each Draw (2026,
// 2027…) pairs some of them up, giver → receiver (or receivers, when
// each buys for more than one). The site never calls a
// person "a Secret Santa", since that could mean either end of a pairing.

export type Rules = {
    // Pairs of people who never draw each other, either way round (couples).
    exclusions: [string, string][]
    // Nobody gets the person they had in any of the last this many draws.
    avoidRecentDraws: number
    // If A buys for B, B doesn't buy for A.
    noSwaps: boolean
    // Everyone in one chain, A → B → C → … → A, rather than little closed
    // circles.
    singleLoop: boolean
}

export const defaultRules: Rules = {
    exclusions: [],
    avoidRecentDraws: 1,
    noSwaps: false,
    singleLoop: false,
}

export type RuleName = 'exclusions' | 'avoidRecentDraws' | 'noSwaps' | 'singleLoop'

export type Person = {
    id: string
    name: string
    // Removed people stay on record for past draws.
    active: boolean
}

export type DrawStatus = 'pending' | 'drawn'

export type Pairing = {giverId: string, receiverIds: string[]}

export type Draw = {
    id: string
    name: string
    status: DrawStatus
    participantIds: string[]
    // How many people each buys for
    giftsEach: number
    // Who has looked, not who they got.
    revealedIds: string[]
    // From then on everyone can see every pairing. ISO instant, or null for
    // never.
    resultsVisibleFrom: string | null
    createdAt: string
    drawnAt: string | null
    // Only once resultsVisibleFrom has passed. Nobody, the organiser
    // included, can see a pairing before then but its giver.
    results: Pairing[] | null
}

export type Group = {
    id: string
    name: string
    people: Person[]
    rules: Rules
    // Newest first
    draws: Draw[]
    createdAt: string
}

export type Session = {token: string, expiresAt: string}

export type CreateGroupRequest = {name: string, adminPassword: string, people: string[]}
export type CreateGroupResponse = {group: Group, session: Session}
export type LoginRequest = {password: string}
export type UpdateGroupRequest = {name?: string, rules?: Rules}
export type AddPersonRequest = {name: string}
export type UpdatePersonRequest = {name?: string, active?: boolean}
export type CreateDrawRequest = {name: string, participantIds: string[], giftsEach?: number, resultsVisibleFrom: string | null}
export type UpdateDrawRequest = {name?: string, participantIds?: string[], giftsEach?: number, resultsVisibleFrom?: string | null}
export type RevealRequest = {personId: string, deviceToken: string}
export type RevealResponse = {receivers: {id: string, name: string}[], revealedAt: string}

export type ErrorCode =
    | 'bad-request'
    | 'unauthorized'
    | 'not-found'
    | 'conflict'
    | 'already-revealed'
    | 'draw-impossible'
    | 'locked'
    | 'rate-limited'
    | 'too-large'
    | 'server-error'

export type ApiError = {
    error: ErrorCode
    message: string
    // For draw-impossible: the rules that, each dropped on its own, would
    // make a draw possible. Empty if no single one would.
    blockers?: RuleName[]
}

// The header admin requests carry their session token in. Not Authorization:
// CloudFront signs its requests to the Lambda with that.
export const adminTokenHeader = 'x-admin-token'
