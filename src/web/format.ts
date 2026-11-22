// Dates and counts in words, in the viewer's own locale and time zone.

export function formatWhen(iso: string): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso))
}

export function formatDay(iso: string): string {
    return new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'long', year: 'numeric'}).format(new Date(iso))
}

// <input type="datetime-local"> works in local time without a zone:
// "2026-12-25T10:00".
export function toLocalInput(iso: string | null): string {
    if (!iso) return ''
    const date = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

// "Mum", "Mum and Dad", "Mum, Dad and Sue"
export function listOf(items: string[]): string {
    if (items.length <= 1) return items.join('')
    return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
