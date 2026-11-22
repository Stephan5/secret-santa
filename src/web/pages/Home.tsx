import {Page} from '../components/Page.tsx'
import {paths} from '../router.ts'
import {Link} from '../components/Link.tsx'

export function Home() {
    return (
        <Page>
            <section className="hero">
                <h1>Secret Santa, without the hat.</h1>
                <p className="lede">
                    Put everyone's names in, draw them all at once, and send one link. Each person picks their name and
                    sees who they're buying for, on their own phone, wherever in the world they are.
                </p>
                <Link href={paths.create} className="button button-primary button-large">Start a Secret Santa</Link>
            </section>

            <ol className="steps">
                <li>
                    <h2>Put the names in the hat</h2>
                    <p>And any rules: couples who shouldn't draw each other, nobody getting who they had last year.</p>
                </li>
                <li>
                    <h2>Draw</h2>
                    <p>Everyone's drawn at once, so nobody's left holding their own name, and not even you know who got whom.</p>
                </li>
                <li>
                    <h2>Send the link</h2>
                    <p>Each name opens on one device only, so if anyone peeks, it shows. Share the results on Christmas Day, if you like.</p>
                </li>
            </ol>
        </Page>
    )
}

export function NotFound({message = "There's nothing here."}: {message?: string}) {
    return (
        <Page title="Not found">
            <h1>Nothing here</h1>
            <p className="lede">{message}</p>
            <p>Check the link you were sent, or <Link href={paths.create}>start a Secret Santa</Link> of your own.</p>
        </Page>
    )
}
