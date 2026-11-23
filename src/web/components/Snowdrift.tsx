// Snow settling on top of whatever this is put in (snow.ts), which must be
// positioned. `ledge` names it, so the snow on it keeps building from page
// to page (and carries over to anything else given the same name); `depth`
// is how deep it can get and `hang` how far over the front, in CSS pixels,
// and `taper` how far in from the ends it rounds off over. The defaults are
// a panel's: shallow, so it sits on its neon edge without hiding much.
export function Snowdrift({ledge, depth = 10, hang = 2, taper = 18}: {ledge: string, depth?: number, hang?: number, taper?: number}) {
    return <canvas className="snowdrift" data-ledge={ledge} data-depth={depth} data-hang={hang} data-taper={taper} aria-hidden="true" />
}
