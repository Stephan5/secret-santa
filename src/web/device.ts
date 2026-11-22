import {local} from './storage.ts'

// This browser's token: the API ties a reveal to the first browser that asks
// for it, by this. Kept for good in localStorage; if that can't keep it (a
// private window), it lasts as long as the page, and the reveal page says
// so, since that browser won't be able to see the name again.

const tokenKey = 'santa.device'

function newToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

let memoryToken: string | null = null

export function deviceToken(): {token: string, remembered: boolean} {
    const stored = local.get(tokenKey)
    if (stored) return {token: stored, remembered: true}
    const token = memoryToken ?? newToken()
    memoryToken = token
    return {token, remembered: local.set(tokenKey, token)}
}

// Which names this browser has opened in each draw, the latest last, so it
// can show them again without asking.
const revealedKey = (drawId: string) => `santa.revealed.${drawId}`

export function revealedHere(drawId: string): string[] {
    try {
        const ids: unknown = JSON.parse(local.get(revealedKey(drawId)) ?? '[]')
        return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []
    } catch {
        return []
    }
}

export function rememberReveal(drawId: string, personId: string) {
    const ids = revealedHere(drawId).filter(id => id !== personId)
    local.set(revealedKey(drawId), JSON.stringify([...ids, personId]))
}

export function forgetReveal(drawId: string, personId: string) {
    local.set(revealedKey(drawId), JSON.stringify(revealedHere(drawId).filter(id => id !== personId)))
}
