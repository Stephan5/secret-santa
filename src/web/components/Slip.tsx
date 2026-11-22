import './Slip.css'

// The name drawn, written on the back of a sheet of wrapping paper folded
// in half, which unfolds (unless reduced motion is asked for, or it's being
// shown again rather than for the first time). Who it's for is written
// just above the fold, the name just below it.
export function Slip({forName, receiverName, unfold}: {forName: string, receiverName: string, unfold: boolean}) {
    return (
        <div className={unfold ? 'slip slip-unfold' : 'slip'} role="status" aria-live="polite">
            <div className="slip-sheet">
                <div className="slip-half slip-lower">
                    <p className="slip-name">{receiverName}</p>
                </div>
                <div className="slip-flap">
                    <div className="slip-half slip-upper">
                        <p className="slip-for">{forName}, you're buying for</p>
                    </div>
                    <div className="slip-flap-outside" aria-hidden="true" />
                </div>
            </div>
        </div>
    )
}
