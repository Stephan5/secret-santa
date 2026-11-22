import type {ApiError, ErrorCode, RuleName} from '../shared/api.ts'

// A request as the API sees it, from the Lambda's function URL event or the
// local server alike.
export type ApiRequest = {
    method: string
    path: string
    // Lowercased names
    headers: Record<string, string | undefined>
    body: string | null
    // The viewer's address, for rate limiting
    ip: string | null
}

export type ApiResponse = {
    status: number
    headers: Record<string, string>
    body: string
}

export class HttpError extends Error {
    readonly status: number
    readonly code: ErrorCode
    readonly blockers?: RuleName[]

    constructor(status: number, code: ErrorCode, message: string, blockers?: RuleName[]) {
        super(message)
        this.status = status
        this.code = code
        this.blockers = blockers
    }
}

export const badRequest = (message: string) => new HttpError(400, 'bad-request', message)
export const notFound = (message: string) => new HttpError(404, 'not-found', message)
export const conflict = (message: string) => new HttpError(409, 'conflict', message)

const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
}

export function json(status: number, body: unknown): ApiResponse {
    return {status, headers, body: body === undefined ? '' : JSON.stringify(body)}
}

export function errorResponse(error: HttpError): ApiResponse {
    const body: ApiError = {error: error.code, message: error.message}
    if (error.blockers) body.blockers = error.blockers
    return json(error.status, body)
}
