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
    participantIds, exclusions: [], noSwaps: false, singleLoop: false, previous: [], ...rules,
})

// Checks a draw against the rules, independently of draw.ts's own checks.
function breaks(pairings: Pairing[], rules: DrawInput): string | null {
    const ids = rules.participantIds
    const receiverOf = new Map(pairings.map(p => [p.giverId, p.receiverId]))
    if (pairings.length !== ids.length) return 'not everyone gives'
    if (new Set(pairings.map(p => p.receiverId)).size !== ids.length) return 'someone receives twice'
    for (const {giverId, receiverId} of pairings) {
        if (!ids.includes(giverId) || !ids.includes(receiverId)) return 'outsider'
        if (giverId === receiverId) return `${giverId} gets themselves`
        if (rules.exclusions.some(([a, b]) => (a === giverId && b === receiverId) || (b === giverId && a === receiverId))) {
            return `${giverId} gets ${receiverId}, who they're excluded from`
        }
        if (rules.previous.some(previous => previous.some(p => p.giverId === giverId && p.receiverId === receiverId))) {
            return `${giverId} gets ${receiverId} again`
        }
        if (rules.noSwaps && receiverOf.get(receiverId) === giverId) return `${giverId} and ${receiverId} swap`
    }
    if (rules.singleLoop) {
        let at = ids[0]
        for (let step = 1; step < ids.length; step++) {
            at = receiverOf.get(at)!
            if (at === ids[0]) return 'more than one loop'
        }
    }
    return null
}

// Every permutation of the participants that fits, by brute force.
function everyFit(rules: DrawInput): Pairing[][] {
    const ids = rules.participantIds
    const fits: Pairing[][] = []
    const used = new Set<string>()
    const chosen: string[] = []
    function extend() {
        if (chosen.length === ids.length) {
            const pairings = ids.map((giverId, i) => ({giverId, receiverId: chosen[i]}))
            if (breaks(pairings, rules) === null) fits.push(pairings)
            return
        }
        for (const id of ids) {
            if (used.has(id)) continue
            used.add(id)
            chosen.push(id)
            extend()
            chosen.pop()
            used.delete(id)
        }
    }
    extend()
    return fits
}

const key = (pairings: Pairing[]) => pairings.map(p => `${p.giverId}>${p.receiverId}`).join(' ')

function randomInstance(random: Random, maxPeople: number): DrawInput {
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
        previous.push(pool.map((giverId, i) => ({giverId, receiverId: shuffledPool[i]})).filter(p => p.giverId !== p.receiverId))
    }
    return {participantIds: ids, exclusions, previous, noSwaps: random(2) === 0, singleLoop: random(3) === 0}
}

describe('draw', () => {
    it('needs at least two people', () => {
        assert.deepEqual(draw(input([])), {ok: false, reason: 'too-few'})
        assert.deepEqual(draw(input(['a'])), {ok: false, reason: 'too-few'})
    })

    it('pairs two people with each other', () => {
        const outcome = draw(input(['a', 'b']))
        assert.deepEqual(outcome, {ok: true, pairings: [{giverId: 'a', receiverId: 'b'}, {giverId: 'b', receiverId: 'a'}]})
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
        const previous = [ids.map((giverId, i) => ({giverId, receiverId: ids[(i + 2) % 50]}))]
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
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['exclusions']})
        })

        it('no swaps', () => {
            const outcome = draw(input(['a', 'b'], {noSwaps: true}))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['noSwaps']})
        })

        it('repeats', () => {
            // Three people can only make the two loops, and both have been done
            const outcome = draw(input(['a', 'b', 'c'], {previous: [
                [{giverId: 'a', receiverId: 'b'}, {giverId: 'b', receiverId: 'c'}, {giverId: 'c', receiverId: 'a'}],
                [{giverId: 'a', receiverId: 'c'}, {giverId: 'c', receiverId: 'b'}, {giverId: 'b', receiverId: 'a'}],
            ]}))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['avoidRecentDraws']})
        })

        it('one loop', () => {
            // Two couples who may only swap within the other couple: a⇄c and b⇄d
            const ab = [{giverId: 'a', receiverId: 'd'}, {giverId: 'b', receiverId: 'c'}, {giverId: 'c', receiverId: 'b'}, {giverId: 'd', receiverId: 'a'}]
            const outcome = draw(input(['a', 'b', 'c', 'd'], {
                exclusions: [['a', 'b'], ['c', 'd']],
                previous: [ab],
                singleLoop: true,
            }))
            // (without the exclusions a → b → d → c → a would do)
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['exclusions', 'avoidRecentDraws', 'singleLoop']})
        })

        it('none on its own', () => {
            // The exclusion alone rules it out, and so do the repeats alone
            const outcome = draw(input(['a', 'b', 'c'], {
                exclusions: [['b', 'c']],
                previous: [
                    [{giverId: 'a', receiverId: 'b'}, {giverId: 'b', receiverId: 'c'}, {giverId: 'c', receiverId: 'a'}],
                    [{giverId: 'a', receiverId: 'c'}, {giverId: 'c', receiverId: 'b'}, {giverId: 'b', receiverId: 'a'}],
                ],
            }))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: []})
        })

        it('ignoring rules about people not in this draw', () => {
            const outcome = draw(input(['a', 'b'], {exclusions: [['a', 'z']], noSwaps: true}))
            assert.deepEqual(outcome, {ok: false, reason: 'impossible', blockers: ['noSwaps']})
        })
    })

    it('lets two couples draw one loop between them', () => {
        const rules = input(['a', 'b', 'c', 'd'], {exclusions: [['a', 'b'], ['c', 'd']], noSwaps: true, singleLoop: true})
        const outcome = draw(rules)
        assert.ok(outcome.ok)
        assert.equal(breaks(outcome.pairings, rules), null)
    })
})
