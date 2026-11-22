import {useRef, useState} from 'react'

// The group's link, with a button to copy it.
export function CopyLink({url}: {url: string}) {
    const [copied, setCopied] = useState(false)
    const input = useRef<HTMLInputElement>(null)

    async function copy() {
        try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
        } catch {
            // (no clipboard: select it for copying by hand)
            input.current?.select()
        }
    }

    return (
        <div className="copy-link">
            <input ref={input} readOnly value={url} aria-label="Link to send everyone" onFocus={event => event.target.select()} />
            <button type="button" className="button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
    )
}
