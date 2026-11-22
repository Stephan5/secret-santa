// The Hitchhiker's Guide, open at its entry on Secret Santa, and what's
// written on its cover: home's decoration (styled in Page.css).

export function GuideDevice() {
    return (
        <div className="guide-device" aria-hidden="true">
            <div className="guide-screen">
                <span className="guide-screen-line">Hitchhiker's Guide</span>
                <div className="guide-entry">
                    <span className="guide-entry-label">Entry</span>
                    <span className="guide-entry-title">Secret Santa</span>
                    <span className="guide-entry-text">Mostly harmless.</span>
                </div>
                <span className="guide-screen-line guide-screen-status">Sub-Etha: festive</span>
            </div>
            <div className="guide-keys">
                {Array.from({length: 12}, (_, key) => <span key={key} className="guide-key" />)}
            </div>
        </div>
    )
}

export function DontPanic() {
    return (
        <p className="dont-panic">
            <span className="hat-wearer">
                D
                <svg className="santa-hat" viewBox="0 0 60 50" aria-hidden="true">
                    <path d="M9 39C12 16 29 3 46 7C55 9 58 17 55 27C51 21 46 19 42 21L51 39Z" fill="#d0263f" />
                    <path d="M42 21C46 19 51 21 55 27" fill="none" stroke="#8e1426" strokeWidth="2" />
                    <rect x="4" y="35" width="52" height="12" rx="6" fill="#fffaf0" />
                    <circle cx="55" cy="28" r="6" fill="#fffaf0" />
                </svg>
            </span>
            on't Panic
        </p>
    )
}
