import {readFile, stat} from 'node:fs/promises'
import {createServer, type IncomingMessage, type Server} from 'node:http'
import {extname, join, normalize} from 'node:path'
import type {App} from './app.ts'

// A local stand-in for CloudFront: /api/* to the API, everything else from
// the built site (if given), with the single-page app's index.html for any
// path that isn't a file, and the same security headers the distribution
// adds (infra/security-headers.json), so the end-to-end tests would catch a
// page breaking its content security policy.

const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
}

async function readBody(request: IncomingMessage): Promise<string | null> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return chunks.length ? Buffer.concat(chunks).toString('utf8') : null
}

async function securityHeaders(): Promise<Record<string, string>> {
    const path = new URL('../../infra/security-headers.json', import.meta.url)
    const headers = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>
    return {
        'content-security-policy': headers.contentSecurityPolicy,
        'referrer-policy': headers.referrerPolicy,
        'x-robots-tag': headers.robotsTag,
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
    }
}

export async function createLocalServer(app: App, siteDir?: string): Promise<Server> {
    const security = await securityHeaders()
    return createServer(async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (url.pathname.startsWith('/api/')) {
            const headers: Record<string, string | undefined> = {}
            for (const [name, value] of Object.entries(request.headers)) {
                headers[name] = Array.isArray(value) ? value.join(', ') : value
            }
            const result = await app({
                method: request.method ?? 'GET',
                path: url.pathname,
                headers,
                body: await readBody(request),
                ip: request.socket.remoteAddress ?? null,
            })
            response.writeHead(result.status, result.headers).end(result.body)
            return
        }
        if (!siteDir) {
            response.writeHead(404).end()
            return
        }
        // (normalize keeps it inside siteDir: no ../ survives a leading /)
        let file = join(siteDir, normalize(decodeURIComponent(url.pathname)))
        const isFile = await stat(file).then(s => s.isFile(), () => false)
        if (!isFile) file = join(siteDir, 'index.html')
        const ext = extname(file)
        response.writeHead(200, {
            ...security,
            'content-type': types[ext] ?? 'application/octet-stream',
            'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        }).end(await readFile(file))
    })
}
