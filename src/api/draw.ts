import {randomInt} from 'node:crypto'
import type {Pairing, RuleName} from '../shared/api.ts'

// Drawing names: who buys for whom, for everyone in a draw at once, so the
// last person can't be left with only their own name in the hat.
//
// The draw is a random permutation in which nobody gets themselves, nobody
// gets someone they're excluded from, nobody gets who they had in the
// previous draws to avoid, and, if asked, nobody gets the person who has
// them (no swaps) and everyone forms one loop. It is uniformly random over
// every permutation that fits, by rejection sampling: shuffle, and keep the
// first that fits. If the rules leave so few that a few thousand shuffles
// miss them all, a randomised search finds one instead (not quite uniform,
// but still random), or proves there's none, in which case the rules that
// stand in the way are named.

export type DrawInput = {
    participantIds: string[]
    exclusions: [string, string][]
    noSwaps: boolean
    singleLoop: boolean
    // The pairings of the previous draws to avoid repeating, already cut
    // down to the last N.
    previous: Pairing[][]
}

export type DrawOutcome =
    | {ok: true, pairings: Pairing[]}
    | {ok: false, reason: 'too-few'}
    // blockers: the rules that, each dropped on its own, would make a draw
    // possible. Empty if dropping any one of them wouldn't be enough.
    | {ok: false, reason: 'impossible', blockers: RuleName[]}

// An integer in [0, n)
export type Random = (n: number) => number

export type DrawOptions = {
    random?: Random
    // How many shuffles to try before searching (tests set 0 to exercise the
    // search).
    attempts?: number
    // How many steps the search may take before giving up.
    budget?: number
}

const cryptoRandom: Random = n => randomInt(n)

export function draw(input: DrawInput, options: DrawOptions = {}): DrawOutcome {
    const {random = cryptoRandom, attempts = 20_000, budget = 200_000} = options
    const ids = input.participantIds
    const n = ids.length
    if (n < 2) return {ok: false, reason: 'too-few'}

    const constraints = constraintsFor(input)
    const perm = sample(n, constraints, random, attempts)
        ?? searchFor(n, constraints, random, budget)
    if (perm) {
        return {ok: true, pairings: perm.map((r, g) => ({giverId: ids[g], receiverId: ids[r]}))}
    }
    return {ok: false, reason: 'impossible', blockers: blockersFor(input, budget)}
}

type Constraints = {
    // allowed[g][r]: may g buy for r, by the pairwise rules?
    allowed: boolean[][]
    noSwaps: boolean
    singleLoop: boolean
}

function constraintsFor(input: DrawInput): Constraints {
    const index = new Map(input.participantIds.map((id, i) => [id, i]))
    const n = index.size
    const allowed = Array.from({length: n}, (_, g) => Array.from({length: n}, (_, r) => g !== r))
    for (const [a, b] of input.exclusions) {
        const ai = index.get(a)
        const bi = index.get(b)
        if (ai === undefined || bi === undefined) continue
        allowed[ai][bi] = false
        allowed[bi][ai] = false
    }
    for (const pairings of input.previous) {
        for (const {giverId, receiverId} of pairings) {
            const g = index.get(giverId)
            const r = index.get(receiverId)
            if (g !== undefined && r !== undefined) allowed[g][r] = false
        }
    }
    return {allowed, noSwaps: input.noSwaps, singleLoop: input.singleLoop}
}

// perm[g] is the receiver for giver g.
function fits(perm: number[], {allowed, noSwaps, singleLoop}: Constraints): boolean {
    const n = perm.length
    for (let g = 0; g < n; g++) {
        const r = perm[g]
        if (!allowed[g][r]) return false
        if (noSwaps && perm[r] === g) return false
    }
    if (singleLoop) {
        let at = 0
        for (let step = 1; step < n; step++) {
            at = perm[at]
            if (at === 0) return false
        }
    }
    return true
}

function shuffled(n: number, random: Random): number[] {
    const items = Array.from({length: n}, (_, i) => i)
    for (let i = n - 1; i > 0; i--) {
        const j = random(i + 1)
        ;[items[i], items[j]] = [items[j], items[i]]
    }
    return items
}

function sample(n: number, constraints: Constraints, random: Random, attempts: number): number[] | null {
    // (no point shuffling if someone has nobody they may buy for)
    if (constraints.allowed.some(row => !row.includes(true))) return null
    for (let attempt = 0; attempt < attempts; attempt++) {
        let perm: number[]
        if (constraints.singleLoop) {
            // A random order, each buying for the next: every loop equally
            // likely (each comes up once for each of its n rotations).
            const order = shuffled(n, random)
            perm = new Array<number>(n)
            for (let i = 0; i < n; i++) perm[order[i]] = order[(i + 1) % n]
        } else {
            perm = shuffled(n, random)
        }
        if (fits(perm, constraints)) return perm
    }
    return null
}

class GaveUp extends Error {}

// Depth-first, taking the giver with fewest options first, and dropping any
// branch that leaves the rest of the givers no way to all be matched.
// Shuffles the options with random, or takes them in order without it.
function search(n: number, constraints: Constraints, random: Random | null, budget: number): number[] | null {
    const {allowed, noSwaps, singleLoop} = constraints
    const perm = new Array<number>(n).fill(-1)
    const taken = new Array<boolean>(n).fill(false)
    let steps = 0

    const may = (g: number, r: number) =>
        !taken[r] && allowed[g][r] && !(noSwaps && perm[r] === g) && !(singleLoop && closesShortLoop(g, r))

    // Would g → r close a loop that leaves people out?
    function closesShortLoop(g: number, r: number): boolean {
        let at = r
        let length = 1
        while (perm[at] !== -1 && at !== g) {
            at = perm[at]
            length++
        }
        return at === g && length < n
    }

    // Can every giver still without a receiver get one? (Kuhn's augmenting
    // paths; at most a few dozen people, so it's quick.)
    function matchable(): boolean {
        const givers: number[] = []
        for (let g = 0; g < n; g++) if (perm[g] === -1) givers.push(g)
        const matchOf = new Array<number>(n).fill(-1)
        const open = (g: number, r: number) =>
            !taken[r] && allowed[g][r] && !(noSwaps && perm[r] === g)
        function augment(g: number, seen: boolean[]): boolean {
            for (let r = 0; r < n; r++) {
                if (seen[r] || !open(g, r)) continue
                seen[r] = true
                if (matchOf[r] === -1 || augment(matchOf[r], seen)) {
                    matchOf[r] = g
                    return true
                }
            }
            return false
        }
        return givers.every(g => augment(g, new Array<boolean>(n).fill(false)))
    }

    function step(assigned: number): boolean {
        if (++steps > budget) throw new GaveUp()
        if (assigned === n) return true
        let giver = -1
        let options: number[] = []
        for (let g = 0; g < n; g++) {
            if (perm[g] !== -1) continue
            const mine: number[] = []
            for (let r = 0; r < n; r++) if (may(g, r)) mine.push(r)
            if (mine.length === 0) return false
            if (giver === -1 || mine.length < options.length) {
                giver = g
                options = mine
            }
        }
        if (random) options = shuffled(options.length, random).map(i => options[i])
        for (const r of options) {
            perm[giver] = r
            taken[r] = true
            if (matchable() && step(assigned + 1)) return true
            perm[giver] = -1
            taken[r] = false
        }
        return false
    }

    return step(0) ? perm : null
}

function searchFor(n: number, constraints: Constraints, random: Random | null, budget: number): number[] | null {
    try {
        return search(n, constraints, random, budget)
    } catch (error) {
        if (error instanceof GaveUp) return null
        throw error
    }
}

// Which rules, each dropped on its own, would let a draw through?
function blockersFor(input: DrawInput, budget: number): RuleName[] {
    const ids = new Set(input.participantIds)
    const inDraw = (a: string, b: string) => ids.has(a) && ids.has(b)
    const relaxations: [RuleName, boolean, DrawInput][] = [
        ['exclusions', input.exclusions.some(([a, b]) => inDraw(a, b)), {...input, exclusions: []}],
        ['avoidRecentDraws', input.previous.some(pairings => pairings.some(p => inDraw(p.giverId, p.receiverId))), {...input, previous: []}],
        ['noSwaps', input.noSwaps, {...input, noSwaps: false}],
        ['singleLoop', input.singleLoop, {...input, singleLoop: false}],
    ]
    return relaxations
        .filter(([, active, relaxed]) => active
            && searchFor(input.participantIds.length, constraintsFor(relaxed), null, budget) !== null)
        .map(([rule]) => rule)
}
