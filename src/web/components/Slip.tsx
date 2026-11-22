import './Slip.css'

// The name drawn, written on the back of a sheet of wrapping paper folded
// in half and in half again, which unfolds (unless reduced motion is asked
// for, or it's being shown again rather than for the first time): first
// out to the right, then up. Who it's for is above it; the name's written
// large across the middle of the sheet, over the across fold, so each half
// of the sheet has its half of it (the top one hidden from screen readers,
// so it's read once).
//
// Folded, the sheet was folded top down, then right over left. So it opens
// right first: its right side swings over (`slip-right`, printed both
// sides), leaving the bottom half's pattern showing, the top half folded
// down over it (`slip-flap`); then that swings up.
export function Slip({forName, receiverName, unfold}: {forName: string, receiverName: string, unfold: boolean}) {
    const size = {fontSize: `${nameSize(receiverName)}rem`}
    return (
        <div className={unfold ? 'slip slip-unfold' : 'slip'} role="status" aria-live="polite">
            <p className="slip-for">{forName}, you're buying for</p>
            <div className="slip-sheet">
                <div className="slip-half slip-lower">
                    <p className="slip-written slip-name" style={size}>{receiverName}</p>
                </div>
                <div className="slip-flap">
                    <div className="slip-half slip-upper">
                        <p className="slip-written" style={size} aria-hidden="true">{receiverName}</p>
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

// How big to write the name, in rem: as big as fits across the sheet, going
// by its longest word (so a word isn't broken), and smaller still if it's
// long enough to need three lines.
function nameSize(name: string): number {
    const longestWord = Math.max(...name.split(/\s+/).map(word => word.length), 1)
    const size = Math.min(3.6, 25 / longestWord)
    return name.length > 24 ? Math.min(size, 2) : size
}
