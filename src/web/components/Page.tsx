import {useEffect, useRef, type ReactNode} from 'react'
import {paths} from '../router.ts'
import {Link} from './Link.tsx'
import {startSnow} from '../snow.ts'
import './Page.css'

// (this year, as the page loaded)
const year = new Date().getFullYear()

// Every page: the candy-stripe ribbon across the top, the content in a
// column, and a small footer (its name, and the copyright), with snow falling behind it all and
// settling on the footer's divider, and anything else in the page with a
// `canvas.snowdrift` on top (snow.ts).
export function Page({title, children, wide = false}: {title?: string, children: ReactNode, wide?: boolean}) {
    useEffect(() => {
        document.title = title ? `${title} · Secret Santa` : 'Secret Santa'
    }, [title])
    const fall = useRef<HTMLCanvasElement>(null)
    const page = useRef<HTMLDivElement>(null)
    useEffect(() => startSnow(fall.current!, page.current!), [])
    return (
        <div className="page" ref={page}>
            <canvas ref={fall} className="snowfall" aria-hidden="true" />
            <div className="ribbon" aria-hidden="true" />
            <main className={wide ? 'column column-wide' : 'column'}>{children}</main>
            <footer className={wide ? 'footer column column-wide' : 'footer column'}>
                <canvas className="snowdrift" data-ledge="footer" data-depth="28" data-hang="6" data-taper="36" aria-hidden="true" />
                <Link href={paths.home} className="wordmark">
                    <img src="/favicon.svg" alt="" width="20" height="20" />
                    Secret Santa
                </Link>
                <p className="copyright">
                    © {year} <a href="https://blakeslee.uk">Stephan Blakeslee</a>
                </p>
            </footer>
        </div>
    )
}

export function ErrorNote({message}: {message: string | null | undefined}) {
    if (!message) return null
    return <p className="error-note" role="alert">{message}</p>
}

export function Loading({label = 'Loading…'}: {label?: string}) {
    return <p className="loading" role="status">{label}</p>
}
