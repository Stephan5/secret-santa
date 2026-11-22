import {Page} from '../components/Page.tsx'
import {paths} from '../router.ts'
import {Link} from '../components/Link.tsx'

export function Home() {
    return (
        <Page>
            <section className="hero">
                <h1>Secret Santa,<br/>sorted</h1>
                <p className="lede">
                    Put everyone's names in, draw them all at once, and send one link. Everyone finds out
                    who they're buying for on their own phone, wherever they are.
                </p>
                <Link href={paths.create} className="button button-primary button-large snowy">
                    Start a Secret Santa
                    <canvas className="snowdrift" data-ledge="start" data-depth="10" data-hang="2.5" aria-hidden="true" />
                </Link>
            </section>

            <ol className="steps">
                <li>
                    <StepKey n={1} />
                    <h2>Put the names in the hat</h2>
                    <p className="details">Plus any rules: couples who shouldn't draw each other, nobody getting the same person as last year.</p>
                </li>
                <li>
                    <StepKey n={2} />
                    <h2>Draw</h2>
                    <p className="details">Everyone is drawn at once, so nobody is left holding their own name, and not even you know who
                        got whom.</p>
                </li>
                <li>
                    <StepKey n={3} />
                    <h2>Send the link</h2>
                    <p className="details">Each name opens on one device only, so if anyone peeks, it shows. Set the full results be revealed once Santa has been, if you like.</p>
                </li>
            </ol>
        </Page>
    )
}

// A step's number, on a key with snow settling on it (snow.ts)
function StepKey({n}: {n: number}) {
    return (
        <span className="step-key" aria-hidden="true">
            {n}
            <canvas className="snowdrift" data-ledge={`step-${n}`} data-depth="6" data-hang="2" />
        </span>
    )
}

export function NotFound({message = "There's nothing here."}: { message?: string }) {
    return (
        <Page title="Not found">
            <h1>Nothing here</h1>
            <p className="lede">{message}</p>
            <p>Check the link you were sent, or <Link href={paths.create}>start a Secret Santa</Link> of your own.</p>
        </Page>
    )
}
