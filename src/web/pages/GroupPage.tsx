import {useCallback, useEffect, useRef, useState} from 'react'
import type {Draw, Group, Person} from '../../shared/api.ts'
import {adminSession, api, ApiFailure} from '../api.ts'
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
    // (whether someone's name is showing here, to suggest starting their own)
    const [opened, setOpened] = useState(false)

    const reload = useCallback(() => {
        api.getGroup(groupId).then(setGroup, error => setFailure(error as ApiFailure))
    }, [groupId])
    useEffect(reload, [reload])

    if (failure?.status === 404) return <NotFound message={failure.message} />
    if (failure) return <Page><ErrorNote message={failure.message} /></Page>
    if (!group) return <Page><Loading /></Page>

    const [current, ...before] = group.draws
    // (of those before it, only the ones that were drawn: one never drawn
    // has nothing in it for anyone)
    const earlier = before.filter(draw => draw.status === 'drawn')
    const nameOf = (id: string) => group.people.find(p => p.id === id)?.name ?? 'Someone'
    const waiting = !current || current.status === 'pending'
    // (once its results are out, the exchange is over: until the next draw,
    // the page looks back on it)
    const finished = current?.status === 'drawn' && current.results !== null

    return (
        <Page title={group.name}>
            <header className="group-head">
                <h1>{group.name}</h1>
            </header>

            {!current && <p className="card card-gold"><Snowdrift ledge="not-drawn" />Names haven't been drawn yet. Check back once the group organiser has drawn them.</p>}
            {current && <CurrentDraw key={current.id} group={group} draw={current} onRevealed={reload} onShown={setOpened} nameOf={nameOf} />}

            {earlier.length > 0 && (
                <section className="earlier">
                    <h2>Earlier draws</h2>
                    {/* (green and violet in turn, counting from the first draw,
                         so each keeps its colour as more are made) */}
                    {earlier.map((draw, i) => (
                        <EarlierDraw key={draw.id} draw={draw} nameOf={nameOf} colour={(earlier.length - 1 - i) % 2 === 0 ? 'card-green' : 'card-violet'} />
                    ))}
                </section>
            )}

            <p className="organiser-link">
                <Link href={paths.admin(group.id)}>Manage this Secret Santa</Link>
            </p>

            {(waiting || opened || finished) && !adminSession.get(group.id) && (
                <StartYourOwn heading={waiting ? 'While you wait…' : 'Got another lot to sort?'} />
            )}
        </Page>
    )
}

function CurrentDraw({group, draw, onRevealed, onShown, nameOf}: {group: Group, draw: Draw, onRevealed: () => void, onShown: (shown: boolean) => void, nameOf: (id: string) => string}) {
    if (draw.status === 'pending') {
        return (
            <section className="card card-gold">
                <Snowdrift ledge="not-drawn" />
                <h2 className="draw-title">{draw.name}</h2>
                <p>Names haven't been drawn yet. Check back once the group organiser has drawn them.</p>
                <p className="muted">In the hat: {draw.participantIds.map(nameOf).join(', ')}</p>
            </section>
        )
    }
    if (draw.results) {
        return (
            <>
                <section className="card card-gold stack finished">
                    <h2>That's {draw.name} done</h2>
                    <p>
                        When it's time for the next one, the group organiser can start a new draw, and it'll show up
                        here, at this same link. Keep hold of it.
                    </p>
                </section>
                <Results draw={draw} nameOf={nameOf} />
            </>
        )
    }
    const looked = draw.revealedIds.length
    const people = draw.participantIds.map(id => group.people.find(p => p.id === id)!).filter(Boolean)
    return (
        <>
            <Reveal groupId={group.id} draw={draw} people={people} onRevealed={onRevealed} onShown={onShown} />
            <p className="progress muted">{looked} of {people.length} have opened theirs.</p>
            <Results draw={draw} nameOf={nameOf} />
        </>
    )
}

type Shown = {person: Person, receiverName: string, fresh: boolean}

function Reveal({groupId, draw, people, onRevealed, onShown}: {groupId: string, draw: Draw, people: Person[], onRevealed: () => void, onShown: (shown: boolean) => void}) {
    const [chosen, setChosen] = useState('')
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [shown, setShown] = useState<Shown | null>(null)
    // (whether this browser has opened a name in this draw before, to show again)
    const [checkingHere, setCheckingHere] = useState(() => people.some(p => p.id === revealedHere(draw.id).at(-1)))
    const {remembered} = deviceToken()
    const here = revealedHere(draw.id)
    useEffect(() => onShown(shown !== null), [shown, onShown])

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

    const yes = useRef<HTMLButtonElement>(null)
    const person = people.find(p => p.id === chosen)
    const step = shown ? 'slip' : confirming && person ? 'confirm' : 'pick'
    // (asking if it's you: straight to the answer)
    useEffect(() => { if (step === 'confirm') yes.current?.focus() }, [step])

    if (checkingHere) return <Loading />

    // One panel through each step, picking your name, checking it's you and
    // the slip: each in the same place, all but the one it's on hidden (and
    // out of reach), so it's as big as the biggest, whichever it shows.
    // (Till there's a slip, one with a stand-in name, never seen.)
    const layer = (which: typeof step) => which === step ? 'reveal-layer' : 'reveal-layer reveal-layer-off'
    const off = (which: typeof step) => which !== step || undefined
    return (
        <section className="reveal">
            <div className="card card-red reveal-panel">
                <Snowdrift ledge="reveal" />
                <h2 className="draw-title">{draw.name}</h2>
                <div className="reveal-layers">
                    <form className={`stack ${layer('pick')}`} inert={off('pick')} onSubmit={event => { event.preventDefault(); if (person) setConfirming(true) }}>
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
                        {/* (just "Show me" where the panel's narrow, as on most phones) */}
                        <button type="submit" className="button button-primary button-large" disabled={!person} aria-label="Show me who I'm buying for">
                            <span className="when-wide">Show me who I'm buying for</span>
                            <span className="when-narrow">Show me</span>
                        </button>
                        <p className="hint">
                            Each name opens on one device only. If yours says it's already been opened and it wasn't you,
                            ask the group organiser to reset it.
                        </p>
                    </form>
                    <div className={`stack confirm ${layer('confirm')}`} inert={off('confirm')}>
                        <p className="confirm-question">You're <strong>{person?.name ?? longest(people)}</strong>?</p>
                        <p className="hint">Once it's open, only this device can see it.</p>
                        <div className="row">
                            <button ref={yes} type="button" className="button button-primary" onClick={open} disabled={busy}>
                                {busy ? 'Opening…' : 'Yes, show me'}
                            </button>
                            <button type="button" className="button" onClick={() => setConfirming(false)} disabled={busy}>No</button>
                        </div>
                    </div>
                    <div className={layer('slip')} inert={off('slip')} role={shown ? 'status' : undefined} aria-live={shown ? 'polite' : undefined}>
                        <Slip forName={shown?.person.name ?? longest(people)} receiverName={shown?.receiverName ?? longest(people)} unfold={!!shown?.fresh} />
                    </div>
                </div>
            </div>
            {shown && (
                <>
                    {remembered
                        ? <p className="muted center">This device will remember, so you can come back any time to check.</p>
                        : <p className="warning center">This browser can't remember it (private browsing?), and it can't be opened again anywhere else, so screenshot it or write it down.</p>}
                    <p className="center">
                        <button type="button" className="link-button" onClick={() => { setShown(null); setChosen('') }}>
                            Not {shown.person.name}? Choose another name
                        </button>
                    </p>
                </>
            )}
        </section>
    )
}

// (the longest of their names: a stand-in for one not chosen yet, as wide
// as any could be)
function longest(people: Person[]): string {
    return people.reduce((most, p) => p.name.length > most.length ? p.name : most, '')
}

// While the names are still to be drawn, or once someone has theirs, the
// nudge to run one for their other lot (left out for the organiser, who
// already knows).
function StartYourOwn({heading}: {heading: string}) {
    return (
        <aside className="card card-green start-your-own">
            <h2>{heading}</h2>
            <p>
                Work, friends, the other side of the family: start a Secret Santa of your own. It takes a
                couple of minutes, and nobody needs an account.
            </p>
            <Link href={paths.create} className="button button-primary">Start your own Secret Santa</Link>
        </aside>
    )
}

function Results({draw, nameOf}: {draw: Draw, nameOf: (id: string) => string}) {
    if (draw.results) {
        return (
            <section className="results">
                <h2>Full draw results</h2>
                <Pairings draw={draw} nameOf={nameOf} />
            </section>
        )
    }
    if (draw.status === 'drawn' && draw.resultsVisibleFrom) {
        return <p className="muted results-later">Everyone's pairings will be shown here from {formatWhen(draw.resultsVisibleFrom)}.</p>
    }
    return null
}

function Pairings({draw, nameOf}: {draw: Draw, nameOf: (id: string) => string}) {
    return (
        <ul className="pairings">
            {draw.results?.map(({giverId, receiverId}) => (
                <li key={giverId}>
                    <span className="pair-name">{nameOf(giverId)}</span>
                    <PairArrow />
                    <span className="pair-name">{nameOf(receiverId)}</span>
                </li>
            ))}
        </ul>
    )
}

// An earlier draw, small: what it was called, when it was drawn, and its
// full results, folded away, once they're shown; or, till then, when they
// will be, or that they won't.
function EarlierDraw({draw, nameOf, colour}: {draw: Draw, nameOf: (id: string) => string, colour: string}) {
    const drawn = draw.drawnAt ? `Drawn ${formatDay(draw.drawnAt)}.` : 'Drawn.'
    return (
        <section className={`card ${colour} earlier-draw`}>
            <Snowdrift ledge={`draw-${draw.id}`} />
            <h3>{draw.name}</h3>
            {draw.results && (
                <>
                    <p className="muted">{drawn}</p>
                    <details>
                        <summary>Full draw results</summary>
                        <Pairings draw={draw} nameOf={nameOf} />
                    </details>
                </>
            )}
            {!draw.results && draw.resultsVisibleFrom && <p className="muted">{drawn} The full draw results will be shown here from {formatWhen(draw.resultsVisibleFrom)}.</p>}
            {!draw.results && !draw.resultsVisibleFrom && <p className="muted">{drawn} The full draw results are being kept secret.</p>}
        </section>
    )
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
