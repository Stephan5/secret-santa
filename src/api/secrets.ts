import {createHash, randomBytes, randomUUID, scrypt, timingSafeEqual} from 'node:crypto'

// Ids, tokens and admin password hashing.

// Groups get a UUID: it's their link, and knowing it is what lets you see
// the group, so it mustn't be guessable.
export const newGroupId = () => randomUUID()
// People and draws only need to be unique within their group.
export const newId = () => randomBytes(6).toString('base64url')
export const newToken = () => randomBytes(32).toString('base64url')

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// scrypt's cost: N = 2^logN, block size r, parallelism p. The default is
// OWASP's recommendation (N = 2^17, r = 8, p = 1, which takes 128 MiB, so
// the Lambda has 512 MB); tests turn it down to keep quick.
export type PasswordCost = {logN: number, r: number, p: number}
export const defaultPasswordCost: PasswordCost = {logN: 17, r: 8, p: 1}

const keyLength = 32

function derive(password: string, salt: Buffer, {logN, r, p}: PasswordCost): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password.normalize('NFC'), salt, keyLength, {N: 2 ** logN, r, p, maxmem: 256 * 1024 * 1024},
            (error, key) => (error ? reject(error) : resolve(key)))
    })
}

// Stored as scrypt$logN$r$p$salt$key, so the cost can be raised later
// without breaking the passwords already set.
export async function hashPassword(password: string, cost = defaultPasswordCost): Promise<string> {
    const salt = randomBytes(16)
    const key = await derive(password, salt, cost)
    return ['scrypt', cost.logN, cost.r, cost.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, logN, r, p, salt, key] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const expected = Buffer.from(key, 'base64')
    const actual = await derive(password, Buffer.from(salt, 'base64'), {logN: Number(logN), r: Number(r), p: Number(p)})
    return actual.length === expected.length && timingSafeEqual(actual, expected)
}
