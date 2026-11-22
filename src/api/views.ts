import type {Draw, Group, RuleName} from '../shared/api.ts'
import type {GroupAggregate} from './store/store.ts'

// A group as anyone with its link sees it, organiser included: who has
// looked at each draw, but who has whom only once the draw's results are
// visible.
export function groupView({group, people, draws, pairings}: GroupAggregate, now: Date): Group {
    return {
        id: group.id,
        name: group.name,
        people: people
            .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map(({id, name, active}) => ({id, name, active})),
        rules: group.rules,
        draws: draws
            .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((draw): Draw => {
                const mine = pairings.filter(p => p.drawId === draw.id)
                const visible = draw.status === 'drawn' && resultsVisible(draw.resultsVisibleFrom, now)
                return {
                    id: draw.id,
                    name: draw.name,
                    status: draw.status,
                    participantIds: draw.participantIds,
                    revealedIds: draw.participantIds.filter(id => mine.some(p => p.giverId === id && p.revealedAt)),
                    resultsVisibleFrom: draw.resultsVisibleFrom,
                    createdAt: draw.createdAt,
                    drawnAt: draw.drawnAt,
                    results: visible
                        ? draw.participantIds.flatMap(giverId => {
                            const pairing = mine.find(p => p.giverId === giverId)
                            return pairing ? [{giverId, receiverId: pairing.receiverId}] : []
                        })
                        : null,
                }
            }),
        createdAt: group.createdAt,
    }
}

export const resultsVisible = (from: string | null, now: Date) => from !== null && new Date(from) <= now

const ruleLabels: Record<RuleName, string> = {
    exclusions: 'the people who never draw each other',
    avoidRecentDraws: 'not repeating recent draws',
    noSwaps: 'no swaps',
    singleLoop: 'one big loop',
}

export function impossibleMessage(blockers: RuleName[]): string {
    if (blockers.length === 0) {
        return "No draw fits these rules, and dropping any one of them wouldn't be enough. Try loosening a couple."
    }
    const labels = blockers.map(rule => ruleLabels[rule])
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`
    return `No draw fits these rules. It would work without ${list}.`
}
