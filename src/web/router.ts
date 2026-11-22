import {useEffect, useState} from 'react'

// Just enough routing for four pages: the path from the history API, a
// navigate that pushes to it, and a hook that re-renders on navigation (and
// Link, in components/Link.tsx).

export type Route =
    | {page: 'home'}
    | {page: 'create'}
    | {page: 'group', groupId: string}
    | {page: 'admin', groupId: string}
    | {page: 'not-found'}

export function parse(path: string): Route {
    const clean = path.replace(/\/+$/, '') || '/'
    if (clean === '/') return {page: 'home'}
    if (clean === '/new') return {page: 'create'}
    const group = clean.match(/^\/g\/([^/]+)(\/admin)?$/)
    if (group) return {page: group[2] ? 'admin' : 'group', groupId: decodeURIComponent(group[1])}
    return {page: 'not-found'}
}

export const paths = {
    home: '/',
    create: '/new',
    group: (groupId: string) => `/g/${encodeURIComponent(groupId)}`,
    admin: (groupId: string) => `/g/${encodeURIComponent(groupId)}/admin`,
}

const listeners = new Set<() => void>()

export function navigate(to: string, {replace = false} = {}) {
    if (replace) history.replaceState(null, '', to)
    else history.pushState(null, '', to)
    window.scrollTo(0, 0)
    listeners.forEach(listener => listener())
}

export function useRoute(): Route {
    const [path, setPath] = useState(location.pathname)
    useEffect(() => {
        const update = () => setPath(location.pathname)
        listeners.add(update)
        window.addEventListener('popstate', update)
        return () => {
            listeners.delete(update)
            window.removeEventListener('popstate', update)
        }
    }, [])
    return parse(path)
}
