import {useEffect, type ReactNode} from 'react'
import {paths} from '../router.ts'
import {Link} from './Link.tsx'
import './Page.css'

// Every page: the candy-stripe ribbon across the top, the content in a
// column, and a small footer.
export function Page({title, children, wide = false}: {title?: string, children: ReactNode, wide?: boolean}) {
    useEffect(() => {
        document.title = title ? `${title} · Secret Santa` : 'Secret Santa'
    }, [title])
    return (
        <div className="page">
            <div className="ribbon" aria-hidden="true" />
            <main className={wide ? 'column column-wide' : 'column'}>{children}</main>
            <footer className={wide ? 'footer column column-wide' : 'footer column'}>
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
