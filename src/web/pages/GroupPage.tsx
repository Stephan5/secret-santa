import {useCallback, useEffect, useRef, useState} from 'react'
import type {Draw, Group, Person} from '../../shared/api.ts'
import {api, ApiFailure} from '../api.ts'
import {ErrorNote, Loading, Page} from '../components/Page.tsx'
import {Slip} from '../components/Slip.tsx'
import {deviceToken, forgetReveal, rememberReveal, revealedHere} from '../device.ts'
import {formatDay, formatWhen} from '../format.ts'
import {paths} from '../router.ts'
import {Link} from '../components/Link.tsx'
import {Snowdrift} from '../components/Snowdrift.tsx'
import {NotFound} from './Home.tsx'

// The page everyone's sent: pick your name, see who you're buying for.

export function GroupPage({groupId}: {groupId: string}) {
    const [group, setGroup] = useState<Group | null>(null)
    const [failure, setFailure] = useState<ApiFailure | null>(null)

    const reload = useCallback(() => {
        api.getGroup(groupId).then(setGroup, error => setFailure(error as ApiFailure))
    }, [groupId])
    useEffect(reload, [reload])

    if (failure?.status === 404) return <NotFound message={failure.message} />
    if (failure) return <Page><ErrorNote message={failure.message} /></Page>
    if (!group) return <Page><Loading /></Page>

    const [current, ...earlier] = group.draws
    const nameOf = (id: string) => group.people.find(p => p.id === id)?.name ?? 'Someone'

    return (
        <Page title={group.name}>
            <header className="group-head">
                <h1>{group.name}</h1>
                {current && <p className="lede">{current.name}</p>}
            </header>

            {!current && <p className="card card-gold"><Snowdrift ledge="not-drawn" />Names haven't been drawn yet. Check back once the organiser has drawn them.</p>}
            {current && <CurrentDraw key={current.id} group={group} draw={current} onRevealed={reload} nameOf={nameOf} />}

            {earlier.length > 0 && (
                <section className="earlier">
                    <h2>Earlier draws</h2>
                    {/* (green and violet in turn, counting from the first draw,
                         so each keeps its colour as more are made) */}
                    {earlier.map((draw, i) => (
                        <details key={draw.id} className={(earlier.length - 1 - i) % 2 === 0 ? 'card card-green' : 'card card-violet'}>
                            <summary><Snowdrift ledge={`draw-${draw.id}`} />{draw.name}{draw.drawnAt && <span className="muted"> · drawn {formatDay(draw.drawnAt)}</span>}</summary>
                            <Results draw={draw} nameOf={nameOf} />
                        </details>
                    ))}
                </section>
            )}

            <p className="organiser-link">
                <Link href={paths.admin(group.id)}>Organising? Manage this Secret Santa</Link>
            </p>
        </Page>
    )
}

function CurrentDraw({group, draw, onRevealed, nameOf}: {group: Group, draw: Draw, onRevealed: () => void, nameOf: (id: string) => string}) {
    if (draw.status === 'pending') {
        return (
            <section className="card card-gold">
                <Snowdrift ledge="not-drawn" />
                <p>Names haven't been drawn yet. Check back once the organiser has drawn them.</p>
                <p className="muted">In the hat: {draw.participantIds.map(nameOf).join(', ')}</p>
            </section>
        )
    }
    const looked = draw.revealedIds.length
    const people = draw.participantIds.map(id => group.people.find(p => p.id === id)!).filter(Boolean)
    return (
        <>
            <Reveal groupId={group.id} draw={draw} people={people} onRevealed={onRevealed} />
            <p className="progress muted">{looked} of {people.length} have opened theirs.</p>
            <Results draw={draw} nameOf={nameOf} />
        </>
    )
}

type Shown = {person: Person, receiverName: string, fresh: boolean}

function Reveal({groupId, draw, people, onRevealed}: {groupId: string, draw: Draw, people: Person[], onRevealed: () => void}) {
    const [chosen, setChosen] = useState('')
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [shown, setShown] = useState<Shown | null>(null)
    // (whether this browser has opened a name in this draw before, to show again)
    const [checkingHere, setCheckingHere] = useState(() => people.some(p => p.id === revealedHere(draw.id).at(-1)))
    const {remembered} = deviceToken()
    const here = revealedHere(draw.id)

    // If this browser has opened a name in this draw before, show it again
    // (once, on arriving: not each time the group reloads).
    const checked = useRef(false)
    useEffect(() => {
        if (checked.current) return
        checked.current = true
        const last = revealedHere(draw.id).at(-1)
        const person = people.find(p => p.id === last)
        if (!person) return
        api.reveal(groupId, draw.id, person.id, deviceToken().token)
            .then(({receiver}) => setShown({person, receiverName: receiver.name, fresh: false}))
            .catch(() => forgetReveal(draw.id, person.id))
            .finally(() => setCheckingHere(false))
    }, [groupId, draw.id, people])

    async function open() {
        const person = people.find(p => p.id === chosen)
        if (!person) return
        setBusy(true)
        setError(null)
        try {
            const {receiver} = await api.reveal(groupId, draw.id, person.id, deviceToken().token)
            rememberReveal(draw.id, person.id)
            setShown({person, receiverName: receiver.name, fresh: true})
            onRevealed()
        } catch (failure) {
            setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.')
        } finally {
            setBusy(false)
            setConfirming(false)
        }
    }

    if (checkingHere) return <Loading />

    if (shown) {
        return (
            <section className="reveal">
                <Slip forName={shown.person.name} receiverName={shown.receiverName} unfold={shown.fresh} />
                {remembered
                    ? <p className="muted center">This device will remember, so you can come back any time to check.</p>
                    : <p className="warning center">This browser can't remember it (private browsing?), and it can't be opened again anywhere else, so screenshot it or write it down.</p>}
                <p className="center">
                    <button type="button" className="link-button" onClick={() => { setShown(null); setChosen('') }}>
                        Not {shown.person.name}? Choose another name
                    </button>
                </p>
            </section>
        )
    }

    const person = people.find(p => p.id === chosen)
    return (
        <section className="card card-red reveal-picker">
            <Snowdrift ledge="reveal" />
            {!confirming && (
                <form className="stack" onSubmit={event => { event.preventDefault(); if (person) setConfirming(true) }}>
                    <label className="field">
                        <span className="label">Who are you?</span>
                        <select value={chosen} onChange={e => { setChosen(e.target.value); setError(null) }} required>
                            <option value="">Choose your name</option>
                            {people.map(p => {
                                const takenElsewhere = draw.revealedIds.includes(p.id) && !here.includes(p.id)
                                return (
                                    <option key={p.id} value={p.id} disabled={takenElsewhere}>
                                        {p.name}{takenElsewhere ? ' (already opened)' : ''}
                                    </option>
                                )
                            })}
                        </select>
                    </label>
                    <ErrorNote message={error} />
                    <button type="submit" className="button button-primary button-large" disabled={!person}>Show me who I'm buying for</button>
                    <p className="hint">
                        Each name opens on one device only. If yours says it's already been opened and it wasn't you,
                        ask the organiser to reset it.
                    </p>
                </form>
            )}
            {confirming && person && (
                <div className="stack confirm">
                    <p className="confirm-question">You're <strong>{person.name}</strong>?</p>
                    <p className="hint">Once it's open, only this device can see it.</p>
                    <div className="row">
                        <button type="button" className="button button-primary" onClick={open} disabled={busy} autoFocus>
                            {busy ? 'Opening…' : 'Yes, show me'}
                        </button>
                        <button type="button" className="button" onClick={() => setConfirming(false)} disabled={busy}>No</button>
                    </div>
                </div>
            )}
        </section>
    )
}

function Results({draw, nameOf}: {draw: Draw, nameOf: (id: string) => string}) {
    if (draw.results) {
        return (
            <section className="results">
                <h2>Who had whom</h2>
                <ul className="pairings">
                    {draw.results.map(({giverId, receiverId}) => (
                        <li key={giverId}>
                            <span className="pair-name">{nameOf(giverId)}</span>
                            <PairArrow />
                            <span className="pair-name">{nameOf(receiverId)}</span>
                        </li>
                    ))}
                </ul>
            </section>
        )
    }
    if (draw.status === 'drawn' && draw.resultsVisibleFrom) {
        return <p className="muted results-later">Everyone's pairings will be shown here from {formatWhen(draw.resultsVisibleFrom)}.</p>
    }
    return null
}

// The arrow between who bought and who they bought for: chunky and rounded,
// like the headings' lettering, cast in a darker red as they are.
function PairArrow() {
    return (
        <span className="pair-arrow">
            <span className="visually-hidden">bought for</span>
            <svg viewBox="0 0 34 22" aria-hidden="true">
                <path d="M4 12.5h22M19.5 5.5l8 7-8 7" transform="translate(1.6 1.6)" stroke="#8e1426" />
                <path d="M4 12.5h22M19.5 5.5l8 7-8 7" stroke="currentColor" />
            </svg>
        </span>
    )
}
