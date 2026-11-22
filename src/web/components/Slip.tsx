import './Slip.css'

// The name drawn, written on the back of a sheet of wrapping paper folded
// in half and in half again, which unfolds (unless reduced motion is asked
// for, or it's being shown again rather than for the first time): first
// out to the right, then up. Who it's for is written just above the
// across fold, the name just below it.
//
// Folded, the sheet was folded top down, then right over left. So it opens
// right first: its right side swings over (`slip-right`, printed both
// sides), leaving the bottom half's pattern showing, the top half folded
// down over it (`slip-flap`); then that swings up.
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
                    <div className="slip-outside" aria-hidden="true">
                        <div className="slip-print slip-left" />
                        <div className="slip-right">
                            <div className="slip-print slip-right-front" />
                            <div className="slip-print slip-right-back" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
