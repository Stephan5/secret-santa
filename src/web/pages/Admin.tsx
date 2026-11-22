import {useCallback, useEffect, useState, type FormEvent} from 'react'
import type {Draw, Group, Person, Rules} from '../../shared/api.ts'
import {limits} from '../../shared/limits.ts'
import {adminApi, adminSession, api, ApiFailure, type AdminApi} from '../api.ts'
import {CopyLink} from '../components/CopyLink.tsx'
import {ErrorNote, Loading, Page} from '../components/Page.tsx'
import {formatDay, formatWhen, fromLocalInput, listOf, plural, toLocalInput} from '../format.ts'
import {navigate, paths} from '../router.ts'
import {Link} from '../components/Link.tsx'
import {NotFound} from './Home.tsx'

// The organiser's page: the names in the hat, the rules, and the draws.
// Nothing here shows who has whom: the organiser sees only who has looked,
// like everyone else, until a draw's results date.

export function Admin({groupId}: {groupId: string}) {
    const [token, setToken] = useState(() => adminSession.get(groupId))
    const [group, setGroup] = useState<Group | null>(null)
    const [failure, setFailure] = useState<ApiFailure | null>(null)

    const signedOut = useCallback(() => {
        adminSession.clear(groupId)
        setToken(null)
    }, [groupId])

    useEffect(() => {
        api.getGroup(groupId).then(setGroup, error => setFailure(error as ApiFailure))
    }, [groupId])

    // (a session from earlier may have run out)
    useEffect(() => {
        if (token) adminApi(groupId, token).check().catch(error => { if ((error as ApiFailure).status === 401) signedOut() })
    }, [groupId, token, signedOut])

    if (failure?.status === 404) return <NotFound message={failure.message} />
    if (failure) return <Page><ErrorNote message={failure.message} /></Page>
    if (!group) return <Page><Loading /></Page>
    if (!token) return <SignIn group={group} onSignedIn={t => { adminSession.set(groupId, t); setToken(t) }} />

    return <Organiser group={group} setGroup={setGroup} client={adminApi(groupId, token)} signedOut={signedOut} />
}

function SignIn({group, onSignedIn}: {group: Group, onSignedIn: (token: string) => void}) {
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function submit(event: FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try {
            onSignedIn((await api.signIn(group.id, password)).token)
        } catch (failure) {
            setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.')
            setBusy(false)
        }
    }

    return (
        <Page title={group.name}>
            <h1>{group.name}</h1>
            <form className="card card-gold stack" onSubmit={submit}>
                <label className="field">
                    <span className="label">Organiser password</span>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" autoFocus />
                </label>
                <ErrorNote message={error} />
                <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
            <p className="organiser-link"><Link href={paths.group(group.id)}>Not organising? Find out who you're buying for</Link></p>
        </Page>
    )
}

// Runs an organiser's action, keeping the group it returns, and its error
// (or signing out if the session's run out).
function useAction(setGroup: (group: Group) => void, signedOut: () => void) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    async function act(action: () => Promise<Group>): Promise<boolean> {
        setBusy(true)
        setError(null)
        try {
            setGroup(await action())
            return true
        } catch (failure) {
            if (failure instanceof ApiFailure && failure.status === 401) signedOut()
            setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.')
            return false
        } finally {
            setBusy(false)
        }
    }
    return {act, busy, error, setError}
}

type SectionProps = {group: Group, setGroup: (group: Group) => void, client: AdminApi, signedOut: () => void}

function Organiser(props: SectionProps) {
    const {group, client, signedOut} = props
    const link = `${location.origin}${paths.group(group.id)}`

    async function signOut() {
        await client.signOut().catch(() => {})
        signedOut()
        navigate(paths.group(group.id))
    }

    return (
        <Page title={`${group.name}`} wide>
            <header className="group-head">
                <p className="eyebrow">Organiser</p>
                <GroupName {...props} />
            </header>

            <section className="card card-gold stack">
                <h2>Send everyone this link</h2>
                <CopyLink url={link} />
                <p className="hint">
                    Anyone with the link can open a name, so only send it to the people taking part.
                </p>
            </section>

            <People {...props} />
            <RulesSection {...props} />
            <Draws {...props} />

            <p className="organiser-link">
                <Link href={paths.group(group.id)}>See the page everyone else sees</Link>
                {' · '}
                <button type="button" className="link-button" onClick={signOut}>Sign out</button>
            </p>
        </Page>
    )
}

function GroupName({group, setGroup, client, signedOut}: SectionProps) {
    const [editing, setEditing] = useState(false)
    const [name, setName] = useState(group.name)
    const {act, busy, error} = useAction(setGroup, signedOut)

    if (!editing) {
        return (
            <div className="title-row">
                <h1>{group.name}</h1>
                <button type="button" className="link-button" onClick={() => { setName(group.name); setEditing(true) }}>Rename</button>
            </div>
        )
    }
    return (
        <form className="inline-form" onSubmit={async event => {
            event.preventDefault()
            if (await act(() => client.rename(name))) setEditing(false)
        }}>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={limits.groupName} required aria-label="Name" autoFocus />
            <button type="submit" className="button button-primary" disabled={busy}>Save</button>
            <button type="button" className="button" onClick={() => setEditing(false)}>Cancel</button>
            <ErrorNote message={error} />
        </form>
    )
}

function People({group, setGroup, client, signedOut}: SectionProps) {
    const [name, setName] = useState('')
    const [renaming, setRenaming] = useState<{id: string, name: string} | null>(null)
    const {act, busy, error} = useAction(setGroup, signedOut)
    const active = group.people.filter(p => p.active)
    const removed = group.people.filter(p => !p.active)

    async function remove(person: Person) {
        // Out of any draw still to be drawn first, which they'd otherwise block
        const pending = group.draws.filter(d => d.status === 'pending' && d.participantIds.includes(person.id))
        if (pending.length && !confirm(`${person.name} is in the ${listOf(pending.map(d => d.name))} draw, which hasn't been drawn yet. Take them out of that too?`)) return
        await act(async () => {
            for (const draw of pending) {
                await client.updateDraw(draw.id, {participantIds: draw.participantIds.filter(id => id !== person.id)})
            }
            return client.updatePerson(person.id, {active: false})
        })
    }

    return (
        <section className="card card-green stack">
            <h2>Names in the hat</h2>
            {active.length === 0 && <p className="muted">Nobody yet.</p>}
            <ul className="people">
                {active.map(person => (
                    <li key={person.id}>
                        {renaming?.id === person.id ? (
                            <form className="inline-form" onSubmit={async event => {
                                event.preventDefault()
                                if (await act(() => client.updatePerson(person.id, {name: renaming.name}))) setRenaming(null)
                            }}>
                                <input value={renaming.name} onChange={e => setRenaming({id: person.id, name: e.target.value})}
                                    maxLength={limits.personName} required aria-label={`New name for ${person.name}`} autoFocus />
                                <button type="submit" className="button button-small" disabled={busy}>Save</button>
                                <button type="button" className="button button-small" onClick={() => setRenaming(null)}>Cancel</button>
                            </form>
                        ) : (
                            <>
                                <span className="person-name">{person.name}</span>
                                <span className="actions">
                                    <button type="button" className="link-button" onClick={() => setRenaming({id: person.id, name: person.name})}>Rename</button>
                                    <button type="button" className="link-button" onClick={() => remove(person)} disabled={busy}
                                        aria-label={`Take ${person.name} out of the hat`}>Take out</button>
                                </span>
                            </>
                        )}
                    </li>
                ))}
            </ul>
            <form className="inline-form" onSubmit={async event => {
                event.preventDefault()
                if (await act(() => client.addPerson(name))) setName('')
            }}>
                <input value={name} onChange={e => setName(e.target.value)} maxLength={limits.personName} required
                    placeholder="Marvin" aria-label="Name to add" />
                <button type="submit" className="button" disabled={busy}>Add</button>
            </form>
            <ErrorNote message={error} />
            {removed.length > 0 && (
                <details>
                    <summary className="muted">Taken out ({removed.length})</summary>
                    <ul className="people">
                        {removed.map(person => (
                            <li key={person.id}>
                                <span className="person-name muted">{person.name}</span>
                                <button type="button" className="link-button" disabled={busy}
                                    onClick={() => act(() => client.updatePerson(person.id, {active: true}))}>Put back</button>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </section>
    )
}

function RulesSection({group, setGroup, client, signedOut}: SectionProps) {
    const {act, busy, error} = useAction(setGroup, signedOut)
    const [first, setFirst] = useState('')
    const [second, setSecond] = useState('')
    const {rules} = group
    const active = group.people.filter(p => p.active)
    const nameOf = (id: string) => group.people.find(p => p.id === id)?.name ?? 'Someone'
    const save = (changes: Partial<Rules>) => act(() => client.saveRules({...rules, ...changes}))

    return (
        <section className="card card-ice stack">
            <h2>Rules</h2>

            <div className="field">
                <span className="label">Never draw each other</span>
                <span className="hint">Couples, usually. Either way round.</span>
                {rules.exclusions.length > 0 && (
                    <ul className="people">
                        {rules.exclusions.map(([a, b]) => (
                            <li key={`${a}-${b}`}>
                                <span className="person-name">{nameOf(a)} &amp; {nameOf(b)}</span>
                                <button type="button" className="link-button" disabled={busy}
                                    aria-label={`Let ${nameOf(a)} and ${nameOf(b)} draw each other`}
                                    onClick={() => save({exclusions: rules.exclusions.filter(([x, y]) => !(x === a && y === b))})}>Remove</button>
                            </li>
                        ))}
                    </ul>
                )}
                <form className="pair-form" onSubmit={async event => {
                    event.preventDefault()
                    if (await save({exclusions: [...rules.exclusions, [first, second]]})) {
                        setFirst('')
                        setSecond('')
                    }
                }}>
                    <select value={first} onChange={e => setFirst(e.target.value)} required aria-label="First person">
                        <option value="">Someone…</option>
                        {active.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <span className="amp" aria-hidden="true">&amp;</span>
                    <select value={second} onChange={e => setSecond(e.target.value)} required aria-label="Second person">
                        <option value="">…and someone</option>
                        {active.filter(p => p.id !== first).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button type="submit" className="button" disabled={busy || !first || !second}>Add</button>
                </form>
            </div>

            <label className="field">
                <span className="label">Don't repeat earlier draws</span>
                <span className="hint">Nobody gets someone they've bought for recently.</span>
                <select value={rules.avoidRecentDraws} disabled={busy}
                    onChange={e => save({avoidRecentDraws: Number(e.target.value)})}>
                    <option value={0}>Repeats are fine</option>
                    <option value={1}>Not the same as last time</option>
                    {Array.from({length: limits.avoidRecentDraws - 1}, (_, i) => i + 2).map(n => (
                        <option key={n} value={n}>Not the same as any of the last {n}</option>
                    ))}
                </select>
            </label>

            <label className="check">
                <input type="checkbox" checked={rules.noSwaps} disabled={busy} onChange={e => save({noSwaps: e.target.checked})} />
                <span>
                    <span className="label">No swaps</span>
                    <span className="hint">If Arthur buys for Ford, Ford doesn't buy for Arthur.</span>
                </span>
            </label>

            <label className="check">
                <input type="checkbox" checked={rules.singleLoop} disabled={busy} onChange={e => save({singleLoop: e.target.checked})} />
                <span>
                    <span className="label">One big loop</span>
                    <span className="hint">Everyone in a single chain, each buying for the next, rather than little circles.</span>
                </span>
            </label>
            <ErrorNote message={error} />
        </section>
    )
}

function nextDrawName(group: Group): string {
    let year = new Date().getFullYear()
    while (group.draws.some(d => d.name === String(year))) year++
    return String(year)
}

function Draws(props: SectionProps) {
    const {group, setGroup, client, signedOut} = props
    const active = group.people.filter(p => p.active)
    const [creating, setCreating] = useState(group.draws.length === 0)
    const [name, setName] = useState(() => nextDrawName(group))
    // Who's been left out, so anyone put in the hat meanwhile is in
    const [leftOut, setLeftOut] = useState<Set<string>>(new Set())
    const chosen = new Set(active.filter(p => !leftOut.has(p.id)).map(p => p.id))
    const setChosen = (next: Set<string>) => setLeftOut(new Set(active.filter(p => !next.has(p.id)).map(p => p.id)))
    const [visibleFrom, setVisibleFrom] = useState('')
    const {act, busy, error} = useAction(setGroup, signedOut)

    function startCreating() {
        setName(nextDrawName(group))
        setLeftOut(new Set())
        setVisibleFrom('')
        setCreating(true)
    }

    return (
        <section className="stack draws">
            <div className="title-row">
                <h2>Draws</h2>
                {!creating && <button type="button" className="button" onClick={startCreating}>New draw</button>}
            </div>
            {creating && (
                <form className="card card-violet stack" onSubmit={async event => {
                    event.preventDefault()
                    const created = await act(() => client.createDraw({
                        name,
                        participantIds: active.filter(p => chosen.has(p.id)).map(p => p.id),
                        resultsVisibleFrom: fromLocalInput(visibleFrom),
                    }))
                    if (created) setCreating(false)
                }}>
                    <h3>New draw</h3>
                    <label className="field">
                        <span className="label">Name</span>
                        <input value={name} onChange={e => setName(e.target.value)} maxLength={limits.drawName} required />
                    </label>
                    <Participants people={active} chosen={chosen} onChange={setChosen} />
                    <VisibleFrom value={visibleFrom} onChange={setVisibleFrom} />
                    <ErrorNote message={error} />
                    <div className="row">
                        <button type="submit" className="button button-primary" disabled={busy || chosen.size < 2}>Create draw</button>
                        {group.draws.length > 0 && <button type="button" className="button" onClick={() => setCreating(false)}>Cancel</button>}
                    </div>
                </form>
            )}
            {/* (keyed on what its form holds, so it starts afresh when that changes underneath it) */}
            {group.draws.map(draw => (
                <DrawCard key={`${draw.id} ${draw.status} ${draw.participantIds.join()} ${draw.resultsVisibleFrom}`} {...props} draw={draw} />
            ))}
        </section>
    )
}

function Participants({people, chosen, onChange, disabled = false}: {people: Person[], chosen: Set<string>, onChange: (chosen: Set<string>) => void, disabled?: boolean}) {
    return (
        <fieldset className="field">
            <legend className="label">Who's in this draw</legend>
            <div className="checks">
                {people.map(person => (
                    <label key={person.id} className="chip-check">
                        <input type="checkbox" checked={chosen.has(person.id)} disabled={disabled} onChange={e => {
                            const next = new Set(chosen)
                            if (e.target.checked) next.add(person.id)
                            else next.delete(person.id)
                            onChange(next)
                        }} />
                        <span>{person.name}</span>
                    </label>
                ))}
            </div>
            {people.length < 2 && <span className="hint">Put at least two names in the hat first.</span>}
        </fieldset>
    )
}

// (noon on Christmas Day this year, as the page loaded)
const christmas = `${new Date().getFullYear()}-12-25T12:00`

function VisibleFrom({value, onChange}: {value: string, onChange: (value: string) => void}) {
    return (
        <label className="field">
            <span className="label">Show everyone who had whom from</span>
            <span className="hint">Leave it empty to keep it secret for good.</span>
            <span className="inline-form">
                <input type="datetime-local" value={value} onChange={e => onChange(e.target.value)} />
                <button type="button" className="button button-small" onClick={() => onChange(christmas)}>Christmas Day</button>
                {value && <button type="button" className="button button-small" onClick={() => onChange('')}>Clear</button>}
            </span>
        </label>
    )
}

function DrawCard({group, setGroup, client, signedOut, draw}: SectionProps & {draw: Draw}) {
    const {act, busy, error} = useAction(setGroup, signedOut)
    const [chosen, setChosen] = useState(() => new Set(draw.participantIds))
    const [visibleFrom, setVisibleFrom] = useState(() => toLocalInput(draw.resultsVisibleFrom))
    const personOf = (id: string) => group.people.find(p => p.id === id)
    const nameOf = (id: string) => personOf(id)?.name ?? 'Someone'
    const nobodyLooked = draw.revealedIds.length === 0
    const pending = draw.status === 'pending'
    // In a pending draw: everyone in the hat, and anyone in it who's since been taken out
    const choosable = group.people.filter(p => p.active || draw.participantIds.includes(p.id))
    const participantsChanged = pending && (chosen.size !== draw.participantIds.length || draw.participantIds.some(id => !chosen.has(id)))
    const visibleChanged = fromLocalInput(visibleFrom) !== draw.resultsVisibleFrom

    return (
        <article className="card stack draw-card">
            <header className="title-row">
                <h3>{draw.name}</h3>
                <span className={pending ? 'badge' : 'badge badge-drawn'}>
                    {pending ? 'Not drawn yet' : `Drawn ${formatDay(draw.drawnAt!)}`}
                </span>
            </header>

            {pending ? (
                <>
                    <Participants people={choosable} chosen={chosen} onChange={setChosen} disabled={busy} />
                    {participantsChanged && (
                        <button type="button" className="button" disabled={busy || chosen.size < 2}
                            onClick={() => act(() => client.updateDraw(draw.id, {participantIds: [...chosen]}))}>Save who's in it</button>
                    )}
                    <div className="row">
                        <button type="button" className="button button-primary" disabled={busy || participantsChanged}
                            onClick={() => act(() => client.runDraw(draw.id))}>Draw names</button>
                        <button type="button" className="button button-quiet" disabled={busy}
                            onClick={() => confirm(`Delete the ${draw.name} draw?`) && act(() => client.deleteDraw(draw.id))}>Delete</button>
                    </div>
                </>
            ) : (
                <>
                    <p>{draw.revealedIds.length} of {plural(draw.participantIds.length, 'person', 'people')} have opened theirs.</p>
                    <ul className="people">
                        {draw.participantIds.map(id => {
                            const looked = draw.revealedIds.includes(id)
                            return (
                                <li key={id}>
                                    <span className="person-name">{nameOf(id)}</span>
                                    <span className="actions">
                                        <span className={looked ? 'looked' : 'muted'}>{looked ? 'Opened' : 'Not yet'}</span>
                                        {looked && (
                                            <button type="button" className="link-button" disabled={busy}
                                                aria-label={`Reset ${nameOf(id)}`}
                                                onClick={() => confirm(`Reset ${nameOf(id)}'s? Whoever opened it loses it, and it can be opened again on any device.`)
                                                    && act(() => client.resetReveal(draw.id, id))}>Reset</button>
                                        )}
                                    </span>
                                </li>
                            )
                        })}
                    </ul>
                    {nobodyLooked ? (
                        <>
                            <div className="row">
                                <button type="button" className="button" disabled={busy}
                                    onClick={() => confirm('Draw the names again?') && act(() => client.runDraw(draw.id))}>Draw again</button>
                                <button type="button" className="button" disabled={busy}
                                    onClick={() => act(() => client.undoDraw(draw.id))}>Undo draw</button>
                                <button type="button" className="button button-quiet" disabled={busy}
                                    onClick={() => confirm(`Delete the ${draw.name} draw?`) && act(() => client.deleteDraw(draw.id))}>Delete</button>
                            </div>
                            <p className="hint">Undo the draw to change who's in it.</p>
                        </>
                    ) : (
                        <p className="hint">Someone has opened theirs, so this draw can't be drawn again or deleted. If someone opened the wrong one, reset it.</p>
                    )}
                </>
            )}

            <VisibleFrom value={visibleFrom} onChange={setVisibleFrom} />
            {visibleChanged && (
                <button type="button" className="button" disabled={busy}
                    onClick={() => act(() => client.updateDraw(draw.id, {resultsVisibleFrom: fromLocalInput(visibleFrom)}))}>
                    Save results date
                </button>
            )}
            {draw.resultsVisibleFrom && !visibleChanged && (
                <p className="hint">
                    {draw.results ? 'Everyone can see who had whom now.' : `Everyone will see who had whom from ${formatWhen(draw.resultsVisibleFrom)}.`}
                </p>
            )}
            <ErrorNote message={error} />
        </article>
    )
}
