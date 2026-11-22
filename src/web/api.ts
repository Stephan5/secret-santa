import {
    adminTokenHeader,
    type ApiError,
    type CreateDrawRequest,
    type CreateGroupRequest,
    type CreateGroupResponse,
    type ErrorCode,
    type Group,
    type RevealResponse,
    type RuleName,
    type Rules,
    type Session,
    type UpdateDrawRequest,
    type UpdatePersonRequest,
} from '../shared/api.ts'
import {session as sessionStorage} from './storage.ts'

export class ApiFailure extends Error {
    readonly status: number
    readonly code: ErrorCode
    readonly blockers: RuleName[]

    constructor(status: number, error: ApiError) {
        super(error.message)
        this.status = status
        this.code = error.error
        this.blockers = error.blockers ?? []
    }
}

// CloudFront signs its requests to the API's Lambda, and the signature has
// to cover the body, which CloudFront can't hash itself: the browser sends
// the body's SHA-256 for it to use. (crypto.subtle only exists on https and
// localhost; anywhere else is local development, which doesn't need it.)
async function bodyHash(body: string): Promise<string | null> {
    if (!crypto.subtle) return null
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = {accept: 'application/json'}
    let payload: string | undefined
    if (body !== undefined) {
        payload = JSON.stringify(body)
        headers['content-type'] = 'application/json'
        const hash = await bodyHash(payload)
        if (hash) headers['x-amz-content-sha256'] = hash
    }
    if (token) headers[adminTokenHeader] = token
    let response: Response
    try {
        response = await fetch(`/api${path}`, {method, headers, body: payload})
    } catch {
        throw new ApiFailure(0, {error: 'server-error', message: "Couldn't reach the server. Check your connection and try again."})
    }
    if (response.status === 204) return undefined as T
    const text = await response.text()
    let data: unknown
    try {
        data = JSON.parse(text)
    } catch {
        throw new ApiFailure(response.status, {error: 'server-error', message: 'Something went wrong. Try again in a moment.'})
    }
    if (!response.ok) throw new ApiFailure(response.status, data as ApiError)
    return data as T
}

const group = (id: string) => `/groups/${encodeURIComponent(id)}`

export const api = {
    createGroup: (body: CreateGroupRequest) => request<CreateGroupResponse>('POST', '/groups', body),
    getGroup: (id: string) => request<Group>('GET', group(id)),
    reveal: (groupId: string, drawId: string, personId: string, deviceToken: string) =>
        request<RevealResponse>('POST', `${group(groupId)}/draws/${drawId}/reveal`, {personId, deviceToken}),
    signIn: (groupId: string, password: string) => request<Session>('POST', `${group(groupId)}/sessions`, {password}),
}

// The organiser's calls, with their session token. Each returns the group
// as it now is.
export function adminApi(groupId: string, token: string) {
    const base = group(groupId)
    const call = <T = Group>(method: string, path: string, body?: unknown) => request<T>(method, `${base}${path}`, body, token)
    return {
        check: () => call<{ok: true}>('GET', '/sessions/current'),
        signOut: () => call<undefined>('DELETE', '/sessions'),
        rename: (name: string) => call('PATCH', '', {name}),
        saveRules: (rules: Rules) => call('PATCH', '', {rules}),
        addPerson: (name: string) => call('POST', '/people', {name}),
        updatePerson: (personId: string, patch: UpdatePersonRequest) => call('PATCH', `/people/${personId}`, patch),
        createDraw: (body: CreateDrawRequest) => call('POST', '/draws', body),
        updateDraw: (drawId: string, patch: UpdateDrawRequest) => call('PATCH', `/draws/${drawId}`, patch),
        deleteDraw: (drawId: string) => call('DELETE', `/draws/${drawId}`),
        runDraw: (drawId: string) => call('POST', `/draws/${drawId}/run`),
        undoDraw: (drawId: string) => call('POST', `/draws/${drawId}/undo`),
        resetReveal: (drawId: string, personId: string) => call('POST', `/draws/${drawId}/people/${personId}/reset`),
    }
}

export type AdminApi = ReturnType<typeof adminApi>

// The organiser's session lasts as long as the tab (and at most the twelve
// hours the API gives it).
const sessionKey = (groupId: string) => `santa.admin.${groupId}`
export const adminSession = {
    get: (groupId: string) => sessionStorage.get(sessionKey(groupId)),
    set: (groupId: string, token: string) => sessionStorage.set(sessionKey(groupId), token),
    clear: (groupId: string) => sessionStorage.remove(sessionKey(groupId)),
}
