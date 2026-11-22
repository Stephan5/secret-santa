import {useState, type FormEvent} from 'react'
import {limits} from '../../shared/limits.ts'
import {adminSession, api, ApiFailure} from '../api.ts'
import {ErrorNote, Page} from '../components/Page.tsx'
import {plural} from '../format.ts'
import {navigate, paths} from '../router.ts'

// The names typed, one a line, tidied, and what's wrong with them, if
// anything.
function readNames(text: string): {names: string[], problem: string | null} {
    const names = text.split('\n').map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean)
    const seen = new Set<string>()
    for (const name of names) {
        const key = name.toLocaleLowerCase()
        if (seen.has(key)) return {names, problem: `${name} is in the hat twice.`}
        seen.add(key)
        if (name.length > limits.personName) return {names, problem: `${name} is too long: at most ${limits.personName} characters.`}
    }
    if (names.length > limits.peoplePerGroup) return {names, problem: `The hat holds at most ${limits.peoplePerGroup} names.`}
    return {names, problem: null}
}

export function Create() {
    const [name, setName] = useState('')
    const [namesText, setNamesText] = useState('')
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const {names, problem} = readNames(namesText)

    async function submit(event: FormEvent) {
        event.preventDefault()
        setError(null)
        if (problem) return setError(problem)
        if (password.length < limits.passwordMin) return setError(`The password needs at least ${limits.passwordMin} characters.`)
        if (password !== confirm) return setError("The passwords don't match.")
        setBusy(true)
        try {
            const {group, session} = await api.createGroup({name, adminPassword: password, people: names})
            adminSession.set(group.id, session.token)
            navigate(paths.admin(group.id))
        } catch (failure) {
            setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.')
            setBusy(false)
        }
    }

    return (
        <Page title="Start a Secret Santa">
            <h1>Start a Secret Santa</h1>
            <form className="stack" onSubmit={submit}>
                <label className="field">
                    <span className="label">What's it called?</span>
                    <input value={name} onChange={e => setName(e.target.value)} required maxLength={limits.groupName}
                        placeholder="Christmas on the Heart of Gold" autoComplete="off" />
                </label>

                <label className="field">
                    <span className="label">Names in the hat</span>
                    <span className="hint">One a line. You can add more, or take some out, later.</span>
                    <textarea value={namesText} onChange={e => setNamesText(e.target.value)} rows={7}
                        placeholder={'Arthur\nFord\nTrillian\nZaphod\n…'} autoComplete="off" />
                    {names.length > 0 && <span className="hint" aria-live="polite">{plural(names.length, 'name')}</span>}
                </label>

                <fieldset className="field">
                    <legend className="label">Organiser password</legend>
                    <span className="hint">
                        You'll need it to run the draw, change the names, or reset someone that forgot who they got in the draw. Everyone else just needs the link.
                        There's no way to get it back yet, so keep it safe.
                    </span>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                        minLength={limits.passwordMin} maxLength={limits.passwordMax} autoComplete="new-password" aria-label="Password" />
                    <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                        autoComplete="new-password" aria-label="Password again" placeholder="Again, to be sure" />
                </fieldset>

                <ErrorNote message={error} />
                <button type="submit" className="button button-primary button-large" disabled={busy}>
                    {busy ? 'Creating…' : 'Create'}
                </button>
            </form>
        </Page>
    )
}
