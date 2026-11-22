import {expect, type APIRequestContext, type Browser, type Page} from '@playwright/test'
import type {CreateGroupResponse, Group} from '../src/shared/api.ts'

// Collects anything the page throws, logs as an error (a content security
// policy violation included) or fails to load while a test runs.
export function trackErrors(page: Page): string[] {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
    page.on('console', message => {
        // (a 4xx the page expects and shows, like a wrong password, also logs one)
        if (message.type() === 'error' && !/status of 4\d\d/.test(message.text())) errors.push(`console: ${message.text()}`)
    })
    page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()}`))
    return errors
}

export const password = 'mince pies'

// A Secret Santa made through the API, quicker than through the form, with
// its organiser's session and a way to make its organiser's calls.
export async function makeGroup(request: APIRequestContext, people: string[], name = 'The Test Christmas') {
    const response = await request.post('/api/groups', {data: {name, adminPassword: password, people}})
    expect(response.status()).toBe(201)
    const {group, session} = await response.json() as CreateGroupResponse
    const idOf = (personName: string) => group.people.find(p => p.name === personName)!.id
    async function admin(method: string, path: string, data?: unknown): Promise<Group> {
        const res = await request.fetch(`/api/groups/${group.id}${path}`, {method, data, headers: {'x-admin-token': session.token}})
        expect(res.ok(), await res.text()).toBe(true)
        return res.json()
    }
    return {group, session, idOf, admin}
}

// …with a draw of everyone, drawn.
export async function makeDrawnGroup(request: APIRequestContext, people: string[], resultsVisibleFrom: string | null = null) {
    const made = await makeGroup(request, people)
    let group = await made.admin('POST', '/draws', {name: '2026', participantIds: made.group.people.map(p => p.id), resultsVisibleFrom})
    const drawId = group.draws[0].id
    group = await made.admin('POST', `/draws/${drawId}/run`)
    return {...made, drawId}
}

// Signs in on the organiser's page, as the organiser.
export async function signIn(page: Page, groupId: string) {
    await page.goto(`/g/${groupId}/admin`)
    await page.getByLabel('Organiser password').fill(password)
    await page.getByRole('button', {name: 'Sign in'}).click()
    await expect(page.getByRole('heading', {name: 'Names in the hat'})).toBeVisible()
}

// Opens a name in a browser of its own: another person's phone.
export async function openName(browser: Browser, groupId: string, name: string) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = trackErrors(page)
    await page.goto(`/g/${groupId}`)
    await page.getByLabel('Who are you?').selectOption({label: name})
    await page.getByRole('button', {name: "Show me who I'm buying for"}).click()
    await page.getByRole('button', {name: 'Yes, show me'}).click()
    const slip = page.getByRole('status').filter({hasText: "you're buying for"})
    await expect(slip).toBeVisible()
    const receiver = (await slip.locator('.slip-name').textContent())!
    return {page, context, receiver, errors}
}
