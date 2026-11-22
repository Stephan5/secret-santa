import {createApp} from './app.ts'
import {DynamoStore} from './store/dynamo.ts'

// The Lambda's entry point, behind CloudFront at /api/*, called through its
// function URL (payload format 2.0).

type FunctionUrlEvent = {
    rawPath: string
    headers?: Record<string, string | undefined>
    body?: string
    isBase64Encoded?: boolean
    requestContext: {http: {method: string, sourceIp: string}}
}

type FunctionUrlResult = {statusCode: number, headers: Record<string, string>, body: string}

const table = process.env.TABLE_NAME
if (!table) throw new Error('TABLE_NAME is not set')
const app = createApp({store: new DynamoStore(table)})

// CloudFront tells the origin who's asking in CloudFront-Viewer-Address,
// "<ip>:<port>" (its own address being the request's source).
function viewerIp(headers: Record<string, string | undefined>): string | null {
    const address = headers['cloudfront-viewer-address']
    return address ? address.slice(0, address.lastIndexOf(':')) : null
}

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
    const headers = event.headers ?? {}
    const body = event.body === undefined
        ? null
        : event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
    const response = await app({
        method: event.requestContext.http.method,
        path: event.rawPath,
        headers,
        body,
        ip: viewerIp(headers) ?? event.requestContext.http.sourceIp,
    })
    return {statusCode: response.status, headers: response.headers, body: response.body}
}
