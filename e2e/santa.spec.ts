import {expect, test} from '@playwright/test'
import {makeDrawnGroup, makeGroup, openName, signIn, trackErrors} from './helpers.ts'

test('while the names are still to be drawn, everyone is asked whether they have another lot to sort', async ({page, request}) => {
    const made = await makeGroup(request, ['Mum', 'Dad'])
    await page.goto(`/g/${made.group.id}`)
    await expect(page.getByText("Names haven't been drawn yet.", {exact: false})).toBeVisible()
    await expect(page.getByRole('heading', {name: 'While you wait…'})).toBeVisible()
    await expect(page.getByRole('link', {name: 'Start your own Secret Santa'})).toHaveAttribute('href', '/new')

    // ...but not the organiser
    await signIn(page, made.group.id)
    await page.goto(`/g/${made.group.id}`)
    await expect(page.getByText("Names haven't been drawn yet.", {exact: false})).toBeVisible()
    await expect(page.getByRole('link', {name: 'Start your own Secret Santa'})).toHaveCount(0)
})

test('an organiser sets up a Secret Santa, and everyone opens their name', async ({page, browser}) => {
    const errors = trackErrors(page)

    // Start one
    await page.goto('/')
    await page.getByRole('link', {name: 'Start a Secret Santa'}).click()
    await page.getByLabel("What's it called?").fill('My Group')
    await page.getByLabel('Names in the hat').fill('Mum\nDad\nBill\n')
    await page.getByLabel('Password', {exact: true}).fill('mince pies')
    await page.getByLabel('Password again').fill('mince pies')
    await page.getByRole('button', {name: 'Start it'}).click()
    await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}\/admin$/)
    const groupUrl = page.url().replace(/\/admin$/, '')
    const groupId = groupUrl.split('/').at(-1)!
    await expect(page.getByRole('textbox', {name: 'Link to send everyone'})).toHaveValue(groupUrl)

    // Another name, and a couple who shouldn't draw each other
    await page.getByLabel('Name to add').fill('Gran')
    await page.getByRole('button', {name: 'Add', exact: true}).first().click()
    await expect(page.locator('.people').getByText('Gran', {exact: true})).toBeVisible()
    await page.getByLabel('First person').selectOption({label: 'Mum'})
    await page.getByLabel('Second person').selectOption({label: 'Dad'})
    await page.locator('.pair-form').getByRole('button', {name: 'Add'}).click()
    await expect(page.getByText('Mum & Dad')).toBeVisible()

    // Draw
    await expect(page.getByLabel('Name', {exact: true})).toHaveValue(String(new Date().getFullYear()))
    await page.getByRole('button', {name: 'Create draw'}).click()
    await page.getByRole('button', {name: 'Draw names'}).click()
    await expect(page.getByText(/^Drawn /)).toBeVisible()
    await expect(page.getByText('0 of 4 people have opened theirs.')).toBeVisible()

    // Everyone opens theirs, each on their own phone
    const receivers = new Map<string, string>()
    for (const name of ['Mum', 'Dad', 'Bill', 'Gran']) {
        const opened = await openName(browser, groupId, name)
        receivers.set(name, opened.receiver)
        expect(opened.errors).toEqual([])
        // ...and is asked whether they've another lot to sort
        await expect(opened.page.getByRole('link', {name: 'Start your own Secret Santa'})).toHaveAttribute('href', '/new')
        // Coming back, it's still there, without choosing again
        await opened.page.reload()
        await expect(opened.page.locator('.slip-name')).toHaveText(opened.receiver)
        await opened.context.close()
    }
    expect([...receivers.values()].sort()).toEqual(['Bill', 'Dad', 'Gran', 'Mum'])
    for (const [giver, receiver] of receivers) expect(receiver).not.toBe(giver)
    expect(receivers.get('Mum')).not.toBe('Dad')
    expect(receivers.get('Dad')).not.toBe('Mum')

    // The organiser sees that everyone has looked, but not who has whom
    await page.reload()
    await expect(page.getByText('4 of 4 people have opened theirs.')).toBeVisible()
    await expect(page.getByText('Opened', {exact: true})).toHaveCount(4)
    expect(errors).toEqual([])
})

test('everyone can buy for more than one person', async ({page, browser, request}) => {
    const {group} = await makeGroup(request, ['Mum', 'Dad', 'Bill', 'Gran'])
    const errors = trackErrors(page)
    await signIn(page, group.id)
    await page.getByLabel('Each person buys for').selectOption({label: '2 people'})
    await page.getByRole('button', {name: 'Create draw'}).click()
    await page.getByRole('button', {name: 'Draw names'}).click()
    await expect(page.getByText("0 of 4 people have opened theirs. Everyone's buying for 2.")).toBeVisible()

    const bought = new Map<string, number>()
    for (const name of ['Mum', 'Dad', 'Bill', 'Gran']) {
        const opened = await openName(browser, group.id, name)
        const receivers = opened.receiver.split(' and ')
        expect(receivers).toHaveLength(2)
        expect(receivers).not.toContain(name)
        for (const receiver of receivers) bought.set(receiver, (bought.get(receiver) ?? 0) + 1)
        expect(opened.errors).toEqual([])
        await opened.context.close()
    }
    expect([...bought.values()]).toEqual([2, 2, 2, 2])
    expect(errors).toEqual([])
})

test("a name opened on one phone can't be opened on another, until the organiser resets it", async ({page, browser, request}) => {
    const {group} = await makeDrawnGroup(request, ['Mum', 'Dad', 'Sue'])
    const mum = await openName(browser, group.id, 'Mum')

    // Someone else's phone: Mum's name is taken
    const errors = trackErrors(page)
    await page.goto(`/g/${group.id}`)
    await expect(page.getByRole('option', {name: 'Mum (already opened)'})).toHaveJSProperty('disabled', true)
    await expect(page.getByText('1 of 3 have opened theirs.')).toBeVisible()

    // The organiser resets it, and now it opens here, the same name
    const organiser = await browser.newPage()
    await signIn(organiser, group.id)
    organiser.once('dialog', dialog => dialog.accept())
    await organiser.getByRole('button', {name: 'Reset Mum'}).click()
    await expect(organiser.getByText('0 of 3 people have opened theirs.')).toBeVisible()

    await page.reload()
    await page.getByLabel('Who are you?').selectOption({label: 'Mum'})
    await page.getByRole('button', {name: "Show me who I'm buying for"}).click()
    await page.getByRole('button', {name: 'Yes, show me'}).click()
    await expect(page.locator('.slip-name')).toHaveText(mum.receiver)

    // …and Mum's first phone has lost it
    await mum.page.reload()
    await expect(mum.page.getByRole('option', {name: 'Mum (already opened)'})).toHaveJSProperty('disabled', true)
    expect([...errors, ...mum.errors]).toEqual([])
})

test("a shared device can open more than one name", async ({page, request}) => {
    const {group} = await makeDrawnGroup(request, ['Mum', 'Dad', 'Sue'])
    const errors = trackErrors(page)
    await page.goto(`/g/${group.id}`)
    for (const name of ['Mum', 'Dad']) {
        await page.getByLabel('Who are you?').selectOption({label: name})
        await page.getByRole('button', {name: "Show me who I'm buying for"}).click()
        await page.getByRole('button', {name: 'Yes, show me'}).click()
        await expect(page.locator('.slip-for')).toHaveText(`${name}, you're buying for`)
        await page.getByRole('button', {name: `Not ${name}? Choose another name`}).click()
    }
    expect(errors).toEqual([])
})

test('everyone sees the full draw results from the results date', async ({page, request}) => {
    const {group} = await makeDrawnGroup(request, ['Mum', 'Dad', 'Sue'], '2020-12-25T12:00:00Z')
    const errors = trackErrors(page)
    await page.goto(`/g/${group.id}`)
    const pairings = page.locator('.pairings li')
    await expect(pairings).toHaveCount(3)
    await expect(page.getByRole('heading', {name: 'Full draw results'})).toBeVisible()
    // It's over: no more opening names, until the group organiser starts the next draw
    await expect(page.getByRole('heading', {name: "That's 2026 done"})).toBeVisible()
    await expect(page.getByLabel('Who are you?')).toHaveCount(0)
    await expect(page.getByRole('link', {name: 'Start your own Secret Santa'})).toBeVisible()
    expect(errors).toEqual([])
})

test("says when the results will be shown, and doesn't show them before", async ({page, request}) => {
    const {group} = await makeDrawnGroup(request, ['Mum', 'Dad', 'Sue'], '2099-12-25T12:00:00Z')
    await page.goto(`/g/${group.id}`)
    await expect(page.getByText(/Everyone's pairings will be shown here from .*2099/)).toBeVisible()
    await expect(page.locator('.pairings')).toHaveCount(0)
})

test('says which rules are in the way when no draw fits them', async ({page, request}) => {
    const {group, idOf, admin} = await makeGroup(request, ['Mum', 'Dad', 'Sue'])
    await admin('PATCH', '', {rules: {exclusions: [[idOf('Mum'), idOf('Dad')]], avoidRecentDraws: 1, noSwaps: false, singleLoop: false}})
    await admin('POST', '/draws', {name: '2026', participantIds: group.people.map(p => p.id), resultsVisibleFrom: null})
    await signIn(page, group.id)
    await page.getByRole('button', {name: 'Draw names'}).click()
    await expect(page.getByRole('alert')).toHaveText('No draw fits these rules. It would work without the "Never draw each other" pairs.')
})

test("turns away a wrong organiser password", async ({page, request}) => {
    const {group} = await makeGroup(request, ['Mum', 'Dad'])
    await page.goto(`/g/${group.id}/admin`)
    await page.getByLabel('Organiser password').fill('wrong guess')
    await page.getByRole('button', {name: 'Sign in'}).click()
    await expect(page.getByRole('alert')).toHaveText("That's not the password.")
})

test("says there's nothing at a link that doesn't lead anywhere", async ({page}) => {
    await page.goto('/g/00000000-0000-4000-8000-000000000000')
    await expect(page.getByRole('heading', {name: 'Nothing here'})).toBeVisible()
    await expect(page.getByText("There's no Secret Santa at this link.")).toBeVisible()
    await page.goto('/nowhere/at/all')
    await expect(page.getByRole('heading', {name: 'Nothing here'})).toBeVisible()
})

test("doesn't scroll sideways on a phone, even as the slip unfolds", async ({browser, request}) => {
    const {group} = await makeDrawnGroup(request, ['Mum', 'Dad', 'Sue'])
    const context = await browser.newContext({viewport: {width: 360, height: 740}})
    const page = await context.newPage()
    for (const path of ['/', '/new', `/g/${group.id}`, `/g/${group.id}/admin`]) {
        await page.goto(path)
        await expect(page.locator('main')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(360)
    }
    await page.goto(`/g/${group.id}`)
    await page.getByLabel('Who are you?').selectOption({label: 'Sue'})
    await page.getByRole('button', {name: "Show me who I'm buying for"}).click()
    await page.getByRole('button', {name: 'Yes, show me'}).click()
    for (let i = 0; i < 5; i++) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
        await page.waitForTimeout(200)
    }
    await context.close()
})
