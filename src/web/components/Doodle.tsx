// A little doodle beside the name drawn, as if drawn in the same pen: a
// Christmas tree, a Santa hat or a present, chosen by the name so it's the
// same one each time that name's shown. Each is an ink outline over a wash
// of colour that doesn't quite line up with it. (Styled in Slip.css.)

const ink = {fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round'} as const

function Tree() {
    return (
        <svg className="doodle" viewBox="0 0 40 50" aria-hidden="true">
            <path d="M21 7 13 18h4L9 29h5L6 40h29l-8-11h5l-8-11h4Z" fill="#62c27a" opacity="0.6" />
            <path {...ink} d="M20 5.5c-2.8 4-5.6 8-8.4 11.9l4.1.2c-2.6 3.7-5.2 7.2-7.9 10.8l5.1.1c-2.8 3.8-5.4 7.3-8.1 10.9 9.6.3 19.4.2 29.1-.1-2.6-3.6-5.3-7.2-8-10.8l5-.1c-2.6-3.6-5.3-7.3-7.9-10.9l4.2-.2C25.4 13.4 22.7 9.4 20 5.5Z" />
            <path {...ink} d="M17.3 39.6c-.1 2.3 0 4.6.2 6.9h5.4c.2-2.3.2-4.6.1-6.9" />
            <path d="m20 1.2 1.2 2.6 2.8.3-2.1 1.9.6 2.8L20 7.4l-2.5 1.4.6-2.8L16 4.1l2.8-.3Z" fill="#f2c14e" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <circle cx="16" cy="25" r="1.7" fill="#e8304a" />
            <circle cx="24.5" cy="31.5" r="1.7" fill="#e8304a" />
            <circle cx="21" cy="17.5" r="1.5" fill="#e8304a" />
            <circle cx="13.5" cy="35" r="1.5" fill="#f2c14e" />
        </svg>
    )
}

function Hat() {
    return (
        <svg className="doodle" viewBox="0 0 52 44" aria-hidden="true">
            <path d="M10 33c2-12 10-22 23-23 8-.5 12 4 11 12-3-3-7-4-10-2l6 13Z" fill="#e8304a" opacity="0.6" />
            <path {...ink} d="M8.5 31.5c2.2-12.6 10.4-22.4 23.4-23.2 7.6-.4 11.6 4.2 10.6 11.6-2.9-2.6-6.6-3.4-9.6-1.6 2.2 4.3 4.3 8.6 6.1 13.1" />
            <path {...ink} d="M6.2 31.8c9.9-1.6 20.4-1.9 31.4-.3 1.6.3 2.2 1.6 2 3.2-.3 1.8-1.3 2.7-3 2.6-10.2-1.3-20.6-1.1-30.4.4-1.7.2-2.7-.8-2.8-2.4-.1-1.9.9-3.2 2.8-3.5Z" />
            <path {...ink} d="M45.4 17.1c2.9.3 4.6 2.6 4.1 5.3-.5 2.7-3 4.3-5.6 3.7-2.6-.6-3.9-3.1-3.2-5.6.6-2.2 2.5-3.6 4.7-3.4Z" />
        </svg>
    )
}

function Present() {
    return (
        <svg className="doodle" viewBox="0 0 44 46" aria-hidden="true">
            <path d="M8 20h29v22H9Z" fill="#e8304a" opacity="0.55" />
            <path d="M6 14h33v7H7Z" fill="#62c27a" opacity="0.6" />
            <path {...ink} d="M7.6 20.4c-.2 7.2 0 14.4.5 21.6 9.6.4 19.3.3 28.9-.2.4-7.1.4-14.2 0-21.4" />
            <path {...ink} d="M5.1 13.7c11.4-.6 22.8-.7 34.2-.2.4 2.4.4 4.8.1 7.3-11.4.4-22.8.4-34.2-.1-.4-2.3-.4-4.7-.1-7Z" />
            <path {...ink} d="M21.3 13.6c-.3 9.5-.1 19 .4 28.5M24.6 13.6c.2 9.5.2 19 0 28.4" />
            <path {...ink} d="M22.8 12.8c-3.4-5.4-9.9-8.4-11.5-5.4-1.5 2.8 4.4 5.2 11.5 5.4Zm0 0c3.2-5.6 9.6-8.7 11.4-5.8 1.6 2.7-4.3 5.4-11.4 5.8Z" />
        </svg>
    )
}

const doodles = [Tree, Hat, Present]

export function Doodle({name}: {name: string}) {
    let hash = 0
    for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
    const Chosen = doodles[hash % doodles.length]
    return <Chosen />
}
