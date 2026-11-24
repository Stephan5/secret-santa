import {Doodle} from './Doodle.tsx'
import './Slip.css'

// The name drawn (or names, one a line), written on the back of a sheet of wrapping paper folded
// in half and in half again, which unfolds (unless reduced motion is asked
// for, or it's being shown again rather than for the first time): first
// out to the right, then up, in the panel the name was picked in
// (GroupPage.tsx). Who it's for is above it; the name's handwritten
// large, with a doodle beside it, across the middle of the sheet, over the across fold, so each half
// of the sheet has its half of it (the top one hidden from screen readers,
// so it's read once).
//
// Folded, the sheet was folded top down, then right over left. So it opens
// right first: its right side swings over (`slip-right`, printed both
// sides), leaving the bottom half's pattern showing, the top half folded
// down over it (`slip-flap`); then that swings up.
export function Slip({forName, receiverNames, unfold}: {forName: string, receiverNames: string[], unfold: boolean}) {
    const size = {fontSize: `${namesSize(receiverNames)}rem`}
    return (
        <div className={unfold ? 'slip slip-unfold' : 'slip'}>
            <p className="slip-for">{forName}, you're buying for</p>
            <div className="slip-sheet">
                <div className="slip-half slip-lower">
                    <p className="slip-written slip-name" style={size}><Names names={receiverNames} /></p>
                </div>
                <div className="slip-flap">
                    <div className="slip-half slip-upper">
                        <p className="slip-written" style={size} aria-hidden="true"><Names names={receiverNames} /></p>
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

// One name as a run of text; more, one under another, read as a list
// ("Ford and Trillian").
function Names({names}: {names: string[]}) {
    if (names.length === 1) return <Written name={names[0]} />
    return (
        <span className="slip-names">
            {names.map((name, i) => (
                <span key={name} className="slip-names-line">
                    {i > 0 && <span className="visually-hidden">{i === names.length - 1 ? ' and ' : ', '}</span>}
                    <Written name={name} />
                </span>
            ))}
        </span>
    )
}

// The name, with its doodle kept on the line of its last word.
function Written({name}: {name: string}) {
    const words = name.trim().split(/\s+/)
    const last = words.pop()
    // (one span, so it's laid out as one run of text in the middle of the sheet)
    return (
        <span className="slip-text">
            {words.length > 0 && `${words.join(' ')} `}
            <span className="slip-last-word">{last}<Doodle name={name} /></span>
        </span>
    )
}

// How big to write the name, in rem: as big as fits across the sheet, going
// by its widest word (so a word isn't broken; the last with its doodle), and
// smaller still if it's long enough to need three lines.
function nameSize(name: string): number {
    const words = name.trim().split(/\s+/)
    // (in ems: a letter of the handwriting's about 0.45 wide, the doodle 1.1)
    const widest = Math.max(...words.map((word, i) => word.length * 0.45 + (i === words.length - 1 ? 1.1 : 0)))
    const size = Math.min(4.2, 14.5 / widest)
    return name.length > 24 ? Math.min(size, 2.6) : size
}

// …and for more than one, one a line: as big as the biggest that fits
// across for all of them, and small enough that the lines, and the gaps
// between names (0.3em, in Slip.css), fit down the sheet (12rem, less a
// margin), allowing for a long one taking two.
function namesSize(names: string[]): number {
    if (names.length === 1) return nameSize(names[0])
    const lines = names.reduce((count, name) => count + (name.length > 14 ? 2 : 1), 0)
    return Math.min(...names.map(nameSize), 10.5 / (lines + 0.3 * (names.length - 1)))
}
