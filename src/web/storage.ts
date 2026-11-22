// localStorage and sessionStorage, for when they're there: a private window
// or blocked site data can make them throw, and the site should still work,
// just forgetting more.

function safe(kind: 'localStorage' | 'sessionStorage') {
    const store = (): Storage | null => {
        try {
            return window[kind]
        } catch {
            return null
        }
    }
    return {
        get(key: string): string | null {
            try {
                return store()?.getItem(key) ?? null
            } catch {
                return null
            }
        },
        set(key: string, value: string): boolean {
            try {
                const s = store()
                if (!s) return false
                s.setItem(key, value)
                return true
            } catch {
                return false
            }
        },
        remove(key: string) {
            try {
                store()?.removeItem(key)
            } catch {
                // (nothing to forget)
            }
        },
    }
}

export const local = safe('localStorage')
export const session = safe('sessionStorage')
