import './Slip.css'

// The name drawn, on a slip of paper that unfolds (unless reduced motion is
// asked for, or it's being shown again rather than for the first time).
export function Slip({forName, receiverName, unfold}: {forName: string, receiverName: string, unfold: boolean}) {
    return (
        <div className={unfold ? 'slip slip-unfold' : 'slip'} role="status" aria-live="polite">
            <div className="slip-paper">
                <p className="slip-for">{forName}, you're buying for</p>
                <p className="slip-name">{receiverName}</p>
            </div>
        </div>
    )
}
