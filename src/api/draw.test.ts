import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {Pairing} from '../shared/api.ts'
import {draw, type DrawInput, type Random} from './draw.ts'

// A seeded generator (mulberry32), so a failure here can be replayed.
function seeded(seed: number): Random {
    let state = seed >>> 0
    return n => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
    }
}

const names = (n: number) => Array.from({length: n}, (_, i) => `p${i}`)

const input = (participantIds: string[], rules: Partial<DrawInput> = {}): DrawInput => ({
    participantIds, giftsEach: 1, exclusions: [], noSwaps: false, singleLoop: false, previous: [], ...rules,
})

// Pairings from giver → receiver pairs: pairs(['a', 'b'], ['b', 'a'])
function pairs(...edges: [string, string][]): Pairing[] {
    const byGiver = new Map<string, string[]>()
    for (const [g, r] of edges) byGiver.set(g, [...(byGiver.get(g) ?? []), r])
    return [...byGiver].map(([giverId, receiverIds]) => ({giverId, receiverIds}))
}

const edgesOf = (pairings: Pairing[]): [string, string][] =>
    pairings.flatMap(({giverId, receiverIds}) => receiverIds.map((r): [string, string] => [giverId, r]))

// Checks a draw against the rules, independently of draw.ts's own checks.
function breaks(pairings: Pairing[], rules: DrawInput): string | null {
    const ids = rules.participantIds
    const k = rules.giftsEach
    const edges = edgesOf(pairings)
    const has = (g: string, r: string) => edges.some(([x, y]) => x === g && y === r)
    if (pairings.length !== ids.length || new Set(pairings.map(p => p.giverId)).size !== ids.length) return 'not everyone gives'
    for (const {giverId, receiverIds} of pairings) {
        if (receiverIds.length !== k || new Set(receiverIds).size !== k) return `${giverId} doesn't buy for ${k} different people`
    }
    for (const id of ids) if (edges.filter(([, r]) => r === id).length !== k) return `${id} isn't bought for ${k} times`
    for (const [giverId, receiverId] of edges) {
        if (!ids.includes(giverId) || !ids.includes(receiverId)) return 'outsider'
        if (giverId === receiverId) return `${giverId} gets themselves`
        if (rules.exclusions.some(([a, b]) => (a === giverId && b === receiverId) || (b === giverId && a === receiverId))) {
            return `${giverId} gets ${receiverId}, who they're excluded from`
        }
        if (rules.previous.some(previous => edgesOf(previous).some(([g, r]) => g === giverId && r === receiverId))) {
            return `${giverId} gets ${receiverId} again`
        }
        if (rules.noSwaps && has(receiverId, giverId)) return `${giverId} and ${receiverId} swap`
    }
    if (rules.singleLoop && !roundsAreLoops(pairings) && !(ids.length <= 6 && loops(ids, edges, k))) return 'not one loop each round'
    return null
}

// Is each round (each giver's first receiver, their second…) one loop of
// everyone? (How draw.ts gives them.)
function roundsAreLoops(pairings: Pairing[]): boolean {
    const n = pairings.length
    return pairings[0].receiverIds.every((_, j) => {
        const next = new Map(pairings.map(p => [p.giverId, p.receiverIds[j]]))
        let at = pairings[0].giverId
        for (let step = 1; step < n; step++) {
            at = next.get(at)!
            if (at === pairings[0].giverId) return false
        }
        return next.get(at) === pairings[0].giverId
    })
}

// Can these edges be split into k loops, each through everyone? (For a
// draw laid out some other way, as everyFit's are: by brute force.)
function loops(ids: string[], edges: [string, string][], k: number): boolean {
    if (k === 0) return edges.length === 0
    const [first, ...rest] = ids
    let found = false
    // Every loop from the first person, by brute force (a handful of people)
    function extend(path: string[], left: string[]) {
        if (found) return
        const at = path.at(-1)!
        const hasEdge = (g: string, r: string) => edges.some(([x, y]) => x === g && y === r)
        if (left.length === 0) {
            if (!hasEdge(at, first)) return
            const loop = path.map((g, i): [string, string] => [g, path[(i + 1) % path.length]])
            const remaining = edges.filter(([g, r]) => !loop.some(([x, y]) => x === g && y === r))
            if (loops(ids, remaining, k - 1)) found = true
            return
        }
        for (const next of left) if (hasEdge(at, next)) extend([...path, next], left.filter(id => id !== next))
    }
    extend([first], rest)
    return found
}

// Every draw that fits, by brute force: each giver choosing k of the others.
function everyFit(rules: DrawInput): Pairing[][] {
    const ids = rules.participantIds
    const k = rules.giftsEach
    const fits: Pairing[][] = []
    const subsets = (from: string[], size: number): string[][] => size === 0
        ? [[]]
        : from.flatMap((id, i) => subsets(from.slice(i + 1), size - 1).map(rest => [id, ...rest]))
    const chosen: string[][] = []
    const received = new Map<string, number>()
    function extend() {
        if (chosen.length === ids.length) {
            const pairings = ids.map((giverId, i) => ({giverId, receiverIds: chosen[i]}))
            if (breaks(pairings, rules) === null) fits.push(pairings)
            return
        }
        const giver = ids[chosen.length]
        for (const subset of subsets(ids.filter(id => id !== giver), k)) {
            if (subset.some(r => (received.get(r) ?? 0) >= k)) continue
            for (const r of subset) received.set(r, (received.get(r) ?? 0) + 1)
            chosen.push(subset)
            extend()
            chosen.pop()
            for (const r of subset) received.set(r, received.get(r)! - 1)
        }
    }
    extend()
    return fits
}

const key = (pairings: Pairing[]) => edgesOf(pairings).map(([g, r]) => `${g}>${r}`).sort().join(' ')

function randomInstance(random: Random, maxPeople: number, giftsEach = 1): DrawInput {
    const ids = names(1 + random(maxPeople))
    const exclusions: [string, string][] = []
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            if (random(100) < 15) exclusions.push([ids[i], ids[j]])
        }
    }
    // Previous draws, some including people not in this one
    const previous: Pairing[][] = []
    for (let d = random(3); d > 0; d--) {
        const pool = [...ids, 'gone']
        const shuffledPool = [...pool].sort(() => random(2) - 0.5)
        previous.push(pairs(...pool.map((g, i): [string, string] => [g, shuffledPool[i]]).filter(([g, r]) => g !== r)))
    }
    return {participantIds: ids, giftsEach, exclusions, previous, noSwaps: random(2) === 0, singleLoop: random(3) === 0}
}

describe('draw', () => {
    it('needs at least two people', () => {
        assert.deepEqual(draw(input([])), {ok: false, reason: 'too-few'})
        assert.deepEqual(draw(input(['a'])), {ok: false, reason: 'too-few'})
    })

    it('pairs two people with each other', () => {
        const outcome = draw(input(['a', 'b']))
        assert.deepEqual(outcome, {ok: true, pairings: [{giverId: 'a', receiverIds: ['b']}, {giverId: 'b', receiverIds: ['a']}]})
    })

    it('gives everyone one person, and nobody themselves, at any size', () => {
        const random = seeded(1)
        for (let n = 2; n <= 50; n++) {
            for (let run = 0; run < 5; run++) {
                const rules = input(names(n))
                const outcome = draw(rules, {random})
                assert.ok(outcome.ok, `no draw for ${n}`)
                assert.equal(breaks(outcome.pairings, rules), null)
            }
        }
    })

    it('makes one loop of everyone, when asked, at any size', () => {
        const random = seeded(2)
        for (let n = 2; n <= 50; n++) {
            const rules = input(names(n), {singleLoop: true})
            const outcome = draw(rules, {random})
            assert.ok(outcome.ok)
            assert.equal(breaks(outcome.pairings, rules), null)
        }
    })

    // The main check: on hundreds of random groups and rules small enough to
    // brute-force, it finds a draw exactly when one exists, and every draw it
    // finds keeps every rule, both by shuffling and by searching.
    for (const [mode, attempts] of [['shuffling', undefined], ['searching', 0]] as const) {
        it(`finds a draw exactly when the rules allow one (${mode})`, () => {
            const random = seeded(attempts === 0 ? 4 : 3)
            for (let run = 0; run < 1500; run++) {
                const rules = randomInstance(random, 7)
                const possible = everyFit(rules).length > 0
                const outcome = draw(rules, {random, attempts})
                const label = JSON.stringify(rules)
                if (rules.participantIds.length < 2) {
                    assert.deepEqual(outcome, {ok: false, reason: 'too-few'}, label)
                } else if (possible) {
                    assert.ok(outcome.ok, `missed a draw for ${label}`)
                    assert.equal(breaks(outcome.pairings, rules), null, label)
                } else {
                    assert.equal(outcome.ok, false, label)
                    assert.equal(!outcome.ok && outcome.reason, 'impossible', label)
                }
            }
        })
    }

    it('copes with tight rules in a big group', () => {
        // Fifty people in couples, avoiding a previous draw, no swaps, one loop
        const ids = names(50)
        const exclusions: [string, string][] = []
        for (let i = 0; i < 50; i += 2) exclusions.push([ids[i], ids[i + 1]])
        const previous = [ids.map((giverId, i) => ({giverId, receiverIds: [ids[(i + 2) % 50]]}))]
        const rules = input(ids, {exclusions, previous, noSwaps: true, singleLoop: true})
        for (const attempts of [undefined, 0]) {
            const outcome = draw(rules, {random: seeded(5), attempts})
            assert.ok(outcome.ok)
            assert.equal(breaks(outcome.pairings, rules), null)
        }
    })

    // Every draw that fits should be as likely as any other: the nine ways
    // four people can be paired off, and the six loops of four, each come up
    // about equally often (chi-squared, well inside p = 0.001).
    for (const [label, rules, expected] of [
        ['pairing off', input(names(4)), 9],
        ['loops', input(names(4), {singleLoop: true}), 6],
        ['with rules', input(names(5), {exclusions: [['p0', 'p1']], noSwaps: true}), 0],
    ] as const) {
        it(`picks every fitting draw equally often (${label})`, () => {
            const fits = everyFit(rules)
            if (expected) assert.equal(fits.length, expected)
            const counts = new Map(fits.map(f => [key(f), 0]))
            const random = seeded(6)
            const runs = fits.length * 2000
            for (let run = 0; run < runs; run++) {
                const outcome = draw(rules, {random})
                assert.ok(outcome.ok)
                const k = key(outcome.pairings)
                assert.ok(counts.has(k), `drew something that doesn't fit: ${k}`)
                counts.set(k, counts.get(k)! + 1)
            }
            const chiSquared = [...counts.values()].reduce((sum, count) => sum + (count - 2000) ** 2 / 2000, 0)
            // (five standard deviations above its mean: about p = 0.001 for
            // this many degrees of freedom)
            const freedom = counts.size - 1
            assert.ok(chiSquared < freedom + 5 * Math.sqrt(2 * freedom), `chi-squared ${chiSquared.toFixed(1)} over ${counts.size} draws`)
        })
    }

    describe('when no draw fits, names the rules in the way', () => {
        it('exclusions', () => {
            // b and c both have to buy for a
            const outcome = draw(input(['a', 'b', 'c'], {exclusions: [['b', 'c']]}))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['exclusions'], fewerGifts: null})
        })

        it('no swaps', () => {
            const outcome = draw(input(['a', 'b'], {noSwaps: true}))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['noSwaps'], fewerGifts: null})
        })

        it('repeats', () => {
            // Three people can only make the two loops, and both have been done
            const outcome = draw(input(['a', 'b', 'c'], {previous: [
                [{giverId: 'a', receiverIds: ['b']}, {giverId: 'b', receiverIds: ['c']}, {giverId: 'c', receiverIds: ['a']}],
                [{giverId: 'a', receiverIds: ['c']}, {giverId: 'c', receiverIds: ['b']}, {giverId: 'b', receiverIds: ['a']}],
            ]}))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['avoidRecentDraws'], fewerGifts: null})
        })

        it('one loop', () => {
            // Two couples who may only swap within the other couple: a⇄c and b⇄d
            const ab = [{giverId: 'a', receiverIds: ['d']}, {giverId: 'b', receiverIds: ['c']}, {giverId: 'c', receiverIds: ['b']}, {giverId: 'd', receiverIds: ['a']}]
            const outcome = draw(input(['a', 'b', 'c', 'd'], {
                exclusions: [['a', 'b'], ['c', 'd']],
                previous: [ab],
                singleLoop: true,
            }))
            // (without the exclusions a → b → d → c → a would do)
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['exclusions', 'avoidRecentDraws', 'singleLoop'], fewerGifts: null})
        })

        it('none on its own', () => {
            // The exclusion alone rules it out, and so do the repeats alone
            const outcome = draw(input(['a', 'b', 'c'], {
                exclusions: [['b', 'c']],
                previous: [
                    [{giverId: 'a', receiverIds: ['b']}, {giverId: 'b', receiverIds: ['c']}, {giverId: 'c', receiverIds: ['a']}],
                    [{giverId: 'a', receiverIds: ['c']}, {giverId: 'c', receiverIds: ['b']}, {giverId: 'b', receiverIds: ['a']}],
                ],
            }))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: [], fewerGifts: null})
        })

        it('ignoring rules about people not in this draw', () => {
            const outcome = draw(input(['a', 'b'], {exclusions: [['a', 'z']], noSwaps: true}))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['noSwaps'], fewerGifts: null})
        })
    })

    describe('with more than one each', () => {
        it('needs more people than each buys for', () => {
            assert.deepEqual(draw(input(['a', 'b'], {giftsEach: 2})), {ok: false, reason: 'too-few'})
            const outcome = draw(input(['a', 'b', 'c'], {giftsEach: 2}))
            assert.ok(outcome.ok)
            // (everyone buys for both the others)
            assert.deepEqual(outcome.pairings.map(p => p.receiverIds.toSorted()), [['b', 'c'], ['a', 'c'], ['a', 'b']])
        })

        it('gives everyone that many different people, at any size', () => {
            const random = seeded(7)
            for (const giftsEach of [2, 3]) {
                for (let n = giftsEach + 1; n <= 50; n += 3) {
                    for (const rules of [{}, {singleLoop: true}, {noSwaps: true}]) {
                        const drawInput = input(names(n), {giftsEach, ...rules})
                        const outcome = draw(drawInput, {random})
                        // (without swaps, each pair can only go one way;
                        // and everyone buying for everyone else can't be
                        // laid out as loops for four or six people)
                        if (('noSwaps' in rules && n < 2 * giftsEach + 1) || ('singleLoop' in rules && n === giftsEach + 1 && (n === 4 || n === 6))) {
                            assert.equal(outcome.ok, false)
                            continue
                        }
                        assert.ok(outcome.ok, `no draw of ${giftsEach} each for ${n} with ${JSON.stringify(rules)}`)
                        assert.equal(breaks(outcome.pairings, drawInput), null)
                    }
                }
            }
        })

        // As above: against every draw there could be, for groups small
        // enough to list them all.
        for (const [mode, attempts] of [['shuffling', undefined], ['searching', 0]] as const) {
            it(`finds a draw exactly when the rules allow one (${mode})`, () => {
                const random = seeded(attempts === 0 ? 9 : 8)
                for (let run = 0; run < 400; run++) {
                    const giftsEach = 2 + random(2)
                    const rules = {...randomInstance(random, 3), giftsEach}
                    rules.participantIds = names(giftsEach + 1 + random(5 - giftsEach))
                    const possible = everyFit(rules).length > 0
                    const outcome = draw(rules, {random, attempts})
                    const label = JSON.stringify(rules)
                    if (possible) {
                        assert.ok(outcome.ok, `missed a draw for ${label}`)
                        assert.equal(breaks(outcome.pairings, rules), null, label)
                    } else {
                        assert.equal(outcome.ok, false, label)
                        assert.equal(!outcome.ok && outcome.reason, 'impossible', label)
                    }
                }
            })
        }

        it('comes up with every draw that fits', () => {
            // Four people buying for two each: each leaves out one of the
            // other three, nobody left out twice, so nine ways
            const rules = input(names(4), {giftsEach: 2})
            const fits = everyFit(rules)
            assert.equal(fits.length, 9)
            const seen = new Set<string>()
            const random = seeded(10)
            for (let run = 0; run < 1000; run++) {
                const outcome = draw(rules, {random})
                assert.ok(outcome.ok)
                seen.add(key(outcome.pairings))
            }
            assert.deepEqual([...seen].sort(), fits.map(key).sort())
        })

        it('copes with tight rules in a big group', () => {
            // Fifty people in couples, three each, avoiding a previous draw,
            // no swaps, a loop each round
            const ids = names(50)
            const exclusions: [string, string][] = []
            for (let i = 0; i < 50; i += 2) exclusions.push([ids[i], ids[i + 1]])
            const previous = [ids.map((giverId, i) => ({giverId, receiverIds: [ids[(i + 2) % 50], ids[(i + 3) % 50]]}))]
            const rules = input(ids, {giftsEach: 3, exclusions, previous, noSwaps: true, singleLoop: true})
            for (const attempts of [undefined, 0]) {
                const outcome = draw(rules, {random: seeded(11), attempts})
                assert.ok(outcome.ok)
                assert.equal(breaks(outcome.pairings, rules), null)
            }
        })

        it('says how many each could buy for, when fewer would work', () => {
            // Five people without swaps: two each fills every pair one way
            // round, so three can't
            assert.deepEqual(draw(input(names(5), {giftsEach: 3, noSwaps: true})),
                {ok: false, reason: 'impossible', blockers: ['noSwaps'], fewerGifts: 2})
            // Two couples buying for two each have to buy for the other
            // couple, both ways round
            assert.deepEqual(draw(input(['a', 'b', 'c', 'd'], {giftsEach: 2, exclusions: [['a', 'b'], ['c', 'd']], noSwaps: true})),
                {ok: false, reason: 'impossible', blockers: ['noSwaps'], fewerGifts: 1})
            // …and when fewer wouldn't help, says nothing of it
            assert.deepEqual(draw(input(['a', 'b', 'c'], {giftsEach: 2, exclusions: [['a', 'b']]})),
                {ok: false, reason: 'impossible', blockers: ['exclusions'], fewerGifts: null})
        })
    })

    it('lets two couples draw one loop between them', () => {
        const rules = input(['a', 'b', 'c', 'd'], {exclusions: [['a', 'b'], ['c', 'd']], noSwaps: true, singleLoop: true})
        const outcome = draw(rules)
        assert.ok(outcome.ok)
        assert.equal(breaks(outcome.pairings, rules), null)
    })
})
