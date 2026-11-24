import {Fragment, type CSSProperties} from 'react'
import {Doodle} from './Doodle.tsx'
import './Slip.css'

// The name drawn, written on the back of a sheet of wrapping paper folded
// in half and in half again, which unfolds (unless reduced motion is asked
// for, or it's being shown again rather than for the first time): first
// out to the right, then up, in the panel the name was picked in
// (GroupPage.tsx). The name's handwritten large, with a doodle beside it,
// across the middle of the sheet, over the across fold, so each half of the
// sheet has its half of it. Above it, once it's open, it's said again in
// plain type, in case the handwriting's hard to read (and that's what
// screen readers get: the sheets are hidden from them).
//
// Buying for more than one, each name has a smaller sheet of its own, each
// with a different doodle, side by side where there's room, put down and
// opened one after another.
//
// Folded, the sheet was folded top down, then right over left. So it opens
// right first: its right side swings over (`slip-right`, printed both
// sides), leaving the bottom half's pattern showing, the top half folded
// down over it (`slip-flap`); then that swings up.
export function Slip({receiverNames, unfold}: {receiverNames: string[], unfold: boolean}) {
    // (the plain line comes once the last sheet's open)
    const lastDelay = {'--last-delay': `${(receiverNames.length - 1) * sheetDelay}ms`} as CSSProperties
    return (
        <div className={unfold ? 'slip slip-unfold' : 'slip'} style={lastDelay}>
            <p className="slip-plain">You're buying for <span className="slip-name"><Listed names={receiverNames} /></span>.</p>
            <div className="slip-sheets" aria-hidden="true">
                {receiverNames.map((name, i) => (
                    <Sheet key={name} name={name} among={receiverNames} index={i} />
                ))}
            </div>
        </div>
    )
}

// "Gran, Sue and Dad", just the names in bold.
function Listed({names}: {names: string[]}) {
    return names.map((name, i) => (
        <Fragment key={name}>
            {i > 0 && (i === names.length - 1 ? ' and ' : ', ')}
            <strong>{name}</strong>
        </Fragment>
    ))
}

// Each sheet's size, in rem, by how many there are: as wide as fits that
// many side by side in the panel, and as tall as suits it.
const sizes: Record<number, {width: number, half: number}> = {
    1: {width: 17, half: 6},
    2: {width: 13, half: 4.6},
    3: {width: 10.5, half: 3.9},
}
// (each put down at a slightly different angle, and this long after the
// one before)
const tilts = [-1.5, 1.4, -0.5]
const sheetDelay = 450

function Sheet({name, among, index}: {name: string, among: string[], index: number}) {
    const {width, half} = sizes[among.length] ?? sizes[3]
    const sheet = {
        '--width': `${width}rem`,
        '--half': `${half}rem`,
        '--tilt': `${tilts[index % tilts.length]}deg`,
        '--delay': `${index * sheetDelay}ms`,
    } as CSSProperties
    const size = {fontSize: `${nameSize(name, width, half)}rem`}
    return (
        <div className="slip-sheet" style={sheet}>
            <div className="slip-half slip-lower">
                <p className="slip-written" style={size}><Written name={name} among={among} /></p>
            </div>
            <div className="slip-flap">
                <div className="slip-half slip-upper">
                    <p className="slip-written" style={size}><Written name={name} among={among} /></p>
                </div>
                <div className="slip-outside">
                    <div className="slip-print slip-left" />
                    <div className="slip-right">
                        <div className="slip-print slip-right-front" />
                        <div className="slip-print slip-right-back" />
                    </div>
                </div>
            </div>
        </div>
    )
}

// The name, with its doodle kept on the line of its last word.
function Written({name, among}: {name: string, among: string[]}) {
    const words = name.trim().split(/\s+/)
    const last = words.pop()
    // (one span, so it's laid out as one run of text in the middle of the sheet)
    return (
        <span className="slip-text">
            {words.length > 0 && `${words.join(' ')} `}
            <span className="slip-last-word">{last}<Doodle name={name} among={among} /></span>
        </span>
    )
}

// How big to write the name, in rem: as big as fits across the sheet, going
// by its widest word (so a word isn't broken; the last with its doodle), and
// smaller still if it's long enough to need three lines. (On the biggest
// sheet, 17rem across less its padding, at most 4.2rem; smaller sheets in
// proportion.)
function nameSize(name: string, width: number, half: number): number {
    const words = name.trim().split(/\s+/)
    // (in ems: a letter of the handwriting's about 0.45 wide, the doodle 1.1)
    const widest = Math.max(...words.map((word, i) => word.length * 0.45 + (i === words.length - 1 ? 1.1 : 0)))
    const scale = half / 6
    const size = Math.min(4.2 * scale, (width - 1.8) * 0.954 / widest)
    return name.length > 24 ? Math.min(size, 2.6 * scale) : size
}
