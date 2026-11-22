import {useLayoutEffect, useRef, useState} from 'react'

// The group's link, with a button to copy it. The box is no wider than
// the link, and the button is as wide as the wider of what it says, so
// nothing moves when it says it's copied.
export function CopyLink({url}: {url: string}) {
    const [copied, setCopied] = useState(false)
    const [fit, setFit] = useState<number>()
    const input = useRef<HTMLInputElement>(null)

    // (the link's width in the box's type, measured once it's loaded, its
    // padding and border, and a little to spare, so it doesn't look cut off
    // or scroll where a browser draws the type a touch wider)
    useLayoutEffect(() => {
        let gone = false
        function measure() {
            const box = input.current
            const context = document.createElement('canvas').getContext('2d')
            if (gone || !box || !context) return
            const style = getComputedStyle(box)
            context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
            const sides = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const
            const around = sides.reduce((sum, side) => sum + (parseFloat(style[side]) || 0), 0)
            setFit(Math.ceil(context.measureText(url).width + around) + 8)
        }
        measure()
        document.fonts?.ready.then(measure)
        return () => { gone = true }
    }, [url])

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
            <input ref={input} readOnly value={url} style={{maxWidth: fit}} aria-label="Link to send everyone" onFocus={event => event.target.select()} />
            <button type="button" className="button" onClick={copy}>
                <span className="swap">
                    <span className={copied ? 'swap-off' : undefined}>Copy link</span>
                    <span className={copied ? undefined : 'swap-off'}>Copied</span>
                </span>
            </button>
        </div>
    )
}
