import {badRequest} from './http.ts'

// Checks a request body's fields, throwing a 400 that says what's wrong.
// The forms check the same things first, so these messages are mostly for
// someone calling the API directly.

export function object(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw badRequest('Expected a JSON object.')
    return value as Record<string, unknown>
}

// Trimmed, with runs of whitespace made single spaces.
export function text(value: unknown, field: string, max: number, {min = 1} = {}): string {
    if (typeof value !== 'string') throw badRequest(`${field} must be text.`)
    const cleaned = value.normalize('NFC').trim().replace(/\s+/g, ' ')
    if (cleaned.length < min) throw badRequest(min === 1 ? `${field} can't be empty.` : `${field} must be at least ${min} characters.`)
    if (cleaned.length > max) throw badRequest(`${field} can be at most ${max} characters.`)
    return cleaned
}

// As typed: passwords aren't trimmed.
export function password(value: unknown, field: string, min: number, max: number): string {
    if (typeof value !== 'string') throw badRequest(`${field} must be text.`)
    if (value.length < min) throw badRequest(`${field} must be at least ${min} characters.`)
    if (value.length > max) throw badRequest(`${field} can be at most ${max} characters.`)
    return value
}

export function bool(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`)
    return value
}

export function int(value: unknown, field: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw badRequest(`${field} must be a whole number from ${min} to ${max}.`)
    }
    return value
}

export function array(value: unknown, field: string, max: number): unknown[] {
    if (!Array.isArray(value)) throw badRequest(`${field} must be a list.`)
    if (value.length > max) throw badRequest(`${field} can have at most ${max} entries.`)
    return value
}

// An ISO date-time, or null.
export function instant(value: unknown, field: string): string | null {
    if (value === null) return null
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw badRequest(`${field} must be a date and time, or null.`)
    return new Date(value).toISOString()
}

export const sameName = (a: string, b: string) => a.localeCompare(b, undefined, {sensitivity: 'accent'}) === 0
