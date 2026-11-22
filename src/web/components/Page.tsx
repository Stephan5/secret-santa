import {useEffect, useRef, type ReactNode} from 'react'
import {paths} from '../router.ts'
import {Link} from './Link.tsx'
import {startSnow} from '../snow.ts'
import './Page.css'

// Every page: the candy-stripe ribbon across the top, the content in a
// column, and a small footer, with snow falling behind it all and
// gathering on the footer's divider (snow.ts).
export function Page({title, children, wide = false}: {title?: string, children: ReactNode, wide?: boolean}) {
    useEffect(() => {
        document.title = title ? `${title} · Secret Santa` : 'Secret Santa'
    }, [title])
    const fall = useRef<HTMLCanvasElement>(null)
    const drift = useRef<HTMLCanvasElement>(null)
    useEffect(() => startSnow(fall.current!, drift.current!), [])
    return (
        <div className="page">
            <canvas ref={fall} className="snowfall" aria-hidden="true" />
            <div className="ribbon" aria-hidden="true" />
            <main className={wide ? 'column column-wide' : 'column'}>{children}</main>
            <footer className={wide ? 'footer column column-wide' : 'footer column'}>
                <canvas ref={drift} className="snowdrift" aria-hidden="true" />
                <Link href={paths.home} className="wordmark">
                    <img src="/favicon.svg" alt="" width="20" height="20" />
                    Secret Santa
                </Link>
                <span>Without the hat.</span>
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
