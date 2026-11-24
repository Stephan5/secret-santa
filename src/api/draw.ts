import {randomInt} from 'node:crypto'
import type {Pairing, RuleName} from '../shared/api.ts'

// Drawing names: who buys for whom, for everyone in a draw at once, so the
// last person can't be left with only their own name in the hat.
//
// Each person buys for giftsEach others (one, usually), and is bought for by
// as many. The draw is that many rounds, each a random permutation in which
// nobody gets themselves, and no round gives anyone someone they already
// have in another. Across them all, nobody gets someone they're excluded
// from or who they had in the previous draws to avoid, and, if asked, nobody
// gets the person who has them (no swaps), and each round forms one loop of
// everyone.
//
// With one each it is uniformly random over every permutation that fits, by
// rejection sampling: shuffle, and keep the first that fits. With more, each
// round is sampled that way in turn, given the rounds before it, starting
// again if one runs out of options: random, though not quite uniform over
// who-buys-for-whom. If the rules leave so few that a few thousand shuffles
// miss them all, a randomised search finds one instead (not quite uniform,
// but still random), or proves there's none, in which case the rules that
// stand in the way are named.

export type DrawInput = {
    participantIds: string[]
    // How many people each buys for
    giftsEach: number
    exclusions: [string, string][]
    noSwaps: boolean
    singleLoop: boolean
    // The pairings of the previous draws to avoid repeating, already cut
    // down to the last N.
    previous: Pairing[][]
}

export type DrawOutcome =
    | {ok: true, pairings: Pairing[]}
    // Fewer than two people, or not enough for each to buy for giftsEach
    | {ok: false, reason: 'too-few'}
    // blockers: the rules that, each dropped on its own, would make a draw
    // possible. Empty if dropping any one of them wouldn't be enough.
    // fewerGifts: with more than one each, the most each could buy for
    // with the rules as they are, if any.
    | {ok: false, reason: 'impossible', blockers: RuleName[], fewerGifts: number | null}

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
    if (n < 2 || n <= input.giftsEach) return {ok: false, reason: 'too-few'}

    const constraints = constraintsFor(input)
    const rounds = sample(n, constraints, random, attempts)
        ?? searchFor(n, constraints, random, budget)
    if (rounds) {
        return {ok: true, pairings: ids.map((giverId, g) => ({giverId, receiverIds: rounds.map(round => ids[round[g]])}))}
    }
    return {ok: false, reason: 'impossible', blockers: blockersFor(input, budget), fewerGifts: fewerGiftsFor(input, budget)}
}

type Constraints = {
    // allowed[g][r]: may g buy for r, by the pairwise rules?
    allowed: boolean[][]
    giftsEach: number
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
        for (const {giverId, receiverIds} of pairings) {
            const g = index.get(giverId)
            for (const receiverId of receiverIds) {
                const r = index.get(receiverId)
                if (g !== undefined && r !== undefined) allowed[g][r] = false
            }
        }
    }
    return {allowed, giftsEach: input.giftsEach, noSwaps: input.noSwaps, singleLoop: input.singleLoop}
}

const grid = (n: number) => Array.from({length: n}, () => new Array<boolean>(n).fill(false))

// May g buy for r in another round, given used[g][r]: who already buys for
// whom in the rounds so far?
const open = ({allowed, noSwaps}: Constraints, used: boolean[][], g: number, r: number) =>
    allowed[g][r] && !used[g][r] && !(noSwaps && used[r][g])

// Could everyone buy for, and be bought for by, `more` more people, given
// those so far? (By counts alone: whether the rounds can be laid out as
// loops, or without swaps between two people both new, isn't checked. A
// flow, by augmenting paths: at most a few dozen people, so it's quick.)
function roomFor(constraints: Constraints, used: boolean[][], more: number): boolean {
    if (more === 0) return true
    const n = used.length
    const flow = grid(n)
    const into = new Array<number>(n).fill(0)
    function augment(g: number, seenGiver: boolean[], seen: boolean[]): boolean {
        seenGiver[g] = true
        for (let r = 0; r < n; r++) {
            if (seen[r] || flow[g][r] || !open(constraints, used, g, r)) continue
            seen[r] = true
            if (into[r] < more) {
                flow[g][r] = true
                into[r]++
                return true
            }
            for (let other = 0; other < n; other++) {
                if (flow[other][r] && !seenGiver[other] && augment(other, seenGiver, seen)) {
                    flow[other][r] = false
                    flow[g][r] = true
                    return true
                }
            }
        }
        return false
    }
    for (let g = 0; g < n; g++) {
        for (let k = 0; k < more; k++) {
            if (!augment(g, new Array<boolean>(n).fill(false), new Array<boolean>(n).fill(false))) return false
        }
    }
    return true
}

// Does round (round[g] the receiver for giver g) fit, given the rounds
// before it?
function fits(round: number[], used: boolean[][], constraints: Constraints): boolean {
    const n = round.length
    for (let g = 0; g < n; g++) {
        const r = round[g]
        if (!open(constraints, used, g, r)) return false
        if (constraints.noSwaps && round[r] === g) return false
    }
    if (constraints.singleLoop) {
        let at = 0
        for (let step = 1; step < n; step++) {
            at = round[at]
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

function shuffledRound(n: number, singleLoop: boolean, random: Random): number[] {
    if (!singleLoop) return shuffled(n, random)
    // A random order, each buying for the next: every loop equally likely
    // (each comes up once for each of its n rotations).
    const order = shuffled(n, random)
    const round = new Array<number>(n)
    for (let i = 0; i < n; i++) round[order[i]] = order[(i + 1) % n]
    return round
}

function sample(n: number, constraints: Constraints, random: Random, attempts: number): number[][] | null {
    const {giftsEach} = constraints
    // (no point shuffling if someone hasn't enough people they may buy for)
    if (!roomFor(constraints, grid(n), giftsEach)) return null
    // (with more than one round, a round that keeps missing may be because
    // of those before it, so after a while it starts again)
    const perRound = giftsEach === 1 ? attempts : Math.ceil(attempts / 10)
    let left = attempts
    while (left > 0) {
        const rounds: number[][] = []
        const used = grid(n)
        while (rounds.length < giftsEach && left > 0) {
            let found: number[] | null = null
            for (let tries = 0; tries < perRound && left > 0 && !found; tries++, left--) {
                const round = shuffledRound(n, constraints.singleLoop, random)
                if (fits(round, used, constraints)) found = round
            }
            if (!found) break
            rounds.push(found)
            found.forEach((r, g) => { used[g][r] = true })
        }
        if (rounds.length === giftsEach) return rounds
    }
    return null
}

class GaveUp extends Error {}

// Depth-first, a round at a time, taking the giver with fewest options
// first, and dropping any branch that leaves the rest of the givers in the
// round no way to all be matched, or the rounds after it no room.
// Shuffles the options with random, or takes them in order without it.
function search(n: number, constraints: Constraints, random: Random | null, budget: number): number[][] | null {
    const {giftsEach, singleLoop} = constraints
    const rounds = Array.from({length: giftsEach}, () => new Array<number>(n).fill(-1))
    const taken = Array.from({length: giftsEach}, () => new Array<boolean>(n).fill(false))
    // used[g][r]: does g buy for r, in any round so far?
    const used = grid(n)
    let steps = 0

    const free = (j: number, g: number, r: number) => !taken[j][r] && open(constraints, used, g, r)
    const may = (j: number, g: number, r: number) => free(j, g, r) && !(singleLoop && closesShortLoop(rounds[j], g, r))

    // Would g → r close a loop that leaves people out?
    function closesShortLoop(round: number[], g: number, r: number): boolean {
        let at = r
        let length = 1
        while (round[at] !== -1 && at !== g) {
            at = round[at]
            length++
        }
        return at === g && length < n
    }

    // Can every giver in round j still without a receiver get one? (Kuhn's
    // augmenting paths; at most a few dozen people, so it's quick.)
    function matchable(j: number): boolean {
        const givers: number[] = []
        for (let g = 0; g < n; g++) if (rounds[j][g] === -1) givers.push(g)
        const matchOf = new Array<number>(n).fill(-1)
        function augment(g: number, seen: boolean[]): boolean {
            for (let r = 0; r < n; r++) {
                if (seen[r] || !free(j, g, r)) continue
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

    function step(j: number, assigned: number): boolean {
        if (++steps > budget) throw new GaveUp()
        if (assigned === n) {
            if (j + 1 === giftsEach) return true
            return roomFor(constraints, used, giftsEach - j - 1) && step(j + 1, 0)
        }
        let giver = -1
        let options: number[] = []
        for (let g = 0; g < n; g++) {
            if (rounds[j][g] !== -1) continue
            const mine: number[] = []
            for (let r = 0; r < n; r++) if (may(j, g, r)) mine.push(r)
            if (mine.length === 0) return false
            if (giver === -1 || mine.length < options.length) {
                giver = g
                options = mine
            }
        }
        if (random) options = shuffled(options.length, random).map(i => options[i])
        for (const r of options) {
            rounds[j][giver] = r
            taken[j][r] = true
            used[giver][r] = true
            if (matchable(j) && step(j, assigned + 1)) return true
            rounds[j][giver] = -1
            taken[j][r] = false
            used[giver][r] = false
        }
        return false
    }

    return step(0, 0) ? rounds : null
}

function searchFor(n: number, constraints: Constraints, random: Random | null, budget: number): number[][] | null {
    try {
        return search(n, constraints, random, budget)
    } catch (error) {
        if (error instanceof GaveUp) return null
        throw error
    }
}

const possible = (input: DrawInput, budget: number) =>
    searchFor(input.participantIds.length, constraintsFor(input), null, budget) !== null

// Which rules, each dropped on its own, would let a draw through?
function blockersFor(input: DrawInput, budget: number): RuleName[] {
    const ids = new Set(input.participantIds)
    const inDraw = (a: string, b: string) => ids.has(a) && ids.has(b)
    const relaxations: [RuleName, boolean, DrawInput][] = [
        ['exclusions', input.exclusions.some(([a, b]) => inDraw(a, b)), {...input, exclusions: []}],
        ['avoidRecentDraws', input.previous.some(pairings => pairings.some(p => p.receiverIds.some(r => inDraw(p.giverId, r)))), {...input, previous: []}],
        ['noSwaps', input.noSwaps, {...input, noSwaps: false}],
        ['singleLoop', input.singleLoop, {...input, singleLoop: false}],
    ]
    return relaxations
        .filter(([, active, relaxed]) => active && possible(relaxed, budget))
        .map(([rule]) => rule)
}

// With more than one each, the most each could buy for instead, if any.
function fewerGiftsFor(input: DrawInput, budget: number): number | null {
    for (let giftsEach = input.giftsEach - 1; giftsEach >= 1; giftsEach--) {
        if (possible({...input, giftsEach}, budget)) return giftsEach
    }
    return null
}
