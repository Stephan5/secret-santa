// Snow: flakes falling down the window, behind everything (on `fall`, a
// canvas fixed over the viewport), and settling where they land on a
// ledge: any `canvas.snowdrift` in the page, sat on top of something (the
// footer's divider; on home, the steps' numbers and the start button). How
// much each holds is kept here by its `data-ledge` name, not in the page,
// so it carries on building from page to page. `data-depth` is how deep, in
// CSS pixels, it can get; `data-hang`, how far it can hang over the front
// edge, as snow on a ledge does. The snow lies along the top of what the ledge is
// on, round its corners as they curve away (so the canvas is sized and
// placed here, reaching down over them), thinning out to nothing where it
// would slide off. With reduced motion asked for: a still scatter of
// flakes, and the snow already settled.

// Levers for fiddling: each a multiplier on how it is now, so 1 leaves it
// as it is, 2 doubles it, 0.5 halves it.
const tune = {
    // Falling
    // (how many flakes there are)
    flakes: 1,
    // (how big each flake is; bigger ones also fall faster and bring more snow)
    flakeSize: 1,
    // (how fast they fall)
    fallSpeed: 1,
    // (how far each one drifts from side to side as it falls)
    sway: 1,
    // (how hard the wind pushes them all, back and forth, over time)
    wind: 1,

    // Settling
    // (how much snow each flake leaves on a ledge: how fast it builds up)
    settling: 1,
    // (how wide each flake's snow spreads where it lands)
    spread: 1,
    // (how fast the snow evens out as it lies; lower leaves it lumpier for longer)
    smoothing: 1,
    // (how much snow there is on a ledge when it's first seen, of its fill)
    dusting: 1,

    // The shape it settles into
    // (how deep it can get, on every ledge; past about 1, mind the room the
    // page leaves for it above the footer, in Page.css)
    depth: 1,
    // (how high the drifts rise, and low they dip, along a ledge)
    heaps: 1,
    // (how long each drift is, end to end)
    driftLength: 1,
    // (how far in from the ends it rounds off over)
    endRounding: 1,
    // (how far it hangs down over the front edge)
    hang: 1,
    // (how much it glows)
    glow: 1,
}

type Flake = {x: number, y: number, r: number, vy: number, swayAmp: number, swayFreq: number, phase: number, alpha: number}

type Ledge = {
    canvas: HTMLCanvasElement
    context: CanvasRenderingContext2D
    name: string
    width: number
    height: number
    // (the top of what it's on, down from the canvas's top, at each column)
    base: number[]
    hang: number
    caps: number[]
    changed: boolean
}

// Every flake that reaches a ledge settles on it, so there's none falling
// straight down below one but what drifts in from the side.
// (a ledge's snow is a row of columns this wide, in CSS pixels, each with
// its own depth)
const column = 3
const piles = new Map<string, number[]>()

export function startSnow(fall: HTMLCanvasElement, root: HTMLElement): () => void {
    const fallContext = fall.getContext('2d')
    if (!fallContext) return () => {}
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const sprite = flakeSprite()

    let width = 0
    let height = 0
    let ratio = 1
    const flakes: Flake[] = []
    let ledges: Ledge[] = []
    const observer = new ResizeObserver(() => { for (const ledge of ledges) size(ledge); if (reduced) draw() })

    function newFlake(anywhere: boolean): Flake {
        // mostly small, far-off flakes; a few big, near ones, falling faster
        const r = (0.7 + Math.random() ** 2.2 * 2.8) * tune.flakeSize
        return {
            x: Math.random() * width,
            y: anywhere ? Math.random() * height : -8 - Math.random() * 40,
            r,
            vy: (16 + r * 15) * tune.fallSpeed,
            swayAmp: (6 + Math.random() * 14) * tune.sway,
            swayFreq: 0.4 + Math.random() * 0.8,
            phase: Math.random() * Math.PI * 2,
            alpha: Math.min(1, 0.35 + (r / 3.5) * 0.6),
        }
    }

    function resize() {
        ratio = Math.min(devicePixelRatio || 1, 2)
        width = innerWidth
        height = innerHeight
        fall.width = Math.round(width * ratio)
        fall.height = Math.round(height * ratio)
        fallContext!.setTransform(ratio, 0, 0, ratio, 0, 0)
        for (const ledge of ledges) size(ledge)

        const wanted = Math.round(Math.min(400, (width * height) / 2000) * tune.flakes)
        while (flakes.length < wanted) flakes.push(newFlake(true))
        flakes.length = wanted
    }

    // (the ledges in the page now, keeping any already known; the page's
    // content can change under it)
    function findLedges() {
        const found = [...root.querySelectorAll<HTMLCanvasElement>('canvas.snowdrift')]
        const kept = ledges.filter(ledge => found.includes(ledge.canvas))
        for (const ledge of ledges) if (!kept.includes(ledge)) observer.unobserve(ledge.canvas)
        for (const canvas of found) {
            if (kept.some(ledge => ledge.canvas === canvas)) continue
            const context = canvas.getContext('2d')
            if (!context) continue
            const ledge: Ledge = {canvas, context, name: canvas.dataset.ledge ?? 'ledge', width: 0, height: 0, base: [], hang: 0, caps: [], changed: true}
            size(ledge)
            observer.observe(canvas)
            kept.push(ledge)
        }
        ledges = kept
    }

    // A ledge's size and shape, and so how much snow it can hold where
    function size(ledge: Ledge) {
        const {canvas} = ledge
        const on = canvas.parentElement!
        // (sizes before any turn it's given: offsetWidth and so on)
        const width = on.offsetWidth
        const corner = Math.min(parseFloat(getComputedStyle(on).borderTopLeftRadius) || 0, on.offsetHeight / 2, width / 2)
        const depth = Number(canvas.dataset.depth ?? 12) * tune.depth
        ledge.hang = Number(canvas.dataset.hang ?? 0) * tune.hang
        // (reaching down over the corners, and as far as the snow hangs)
        const reach = Math.max(corner, ledge.hang)
        canvas.style.left = '0'
        canvas.style.width = `${width}px`
        canvas.style.height = `${depth + reach}px`
        canvas.style.bottom = `calc(100% - ${reach}px)`
        ledge.width = width
        ledge.height = depth + reach
        canvas.width = Math.round(ledge.width * ratio)
        canvas.height = Math.round(ledge.height * ratio)
        ledge.context.setTransform(ratio, 0, 0, ratio, 0, 0)

        const columns = Math.max(2, Math.ceil(ledge.width / column) + 1)
        ledge.base = []
        for (let i = 0; i < columns; i++) {
            const x = Math.min(i * column, width)
            const fromEnd = Math.min(x, width - x)
            const drop = fromEnd < corner ? corner - Math.sqrt(corner ** 2 - (corner - fromEnd) ** 2) : 0
            ledge.base[i] = depth + drop
        }
        // (and none holds where what it's on is steeper than 45 degrees,
        // less the steeper it gets on the way)
        ledge.caps = capsFor(columns, depth, Number(canvas.dataset.taper ?? 0) * tune.endRounding).map((cap, i) => {
            const slope = Math.abs(ledge.base[Math.min(columns - 1, i + 1)] - ledge.base[Math.max(0, i - 1)]) / (2 * column)
            return cap * Math.max(0, 1 - slope) ** 2
        })
        let pile = piles.get(ledge.name)
        // (resampled from what had gathered at the old width, or, the first
        // time, a dusting to start from)
        if (!pile || pile.length !== columns) pile = pile ? resample(pile, columns) : ledge.caps.map(cap => Math.min(cap, cap * 0.25 * tune.dusting))
        if (reduced) pile = ledge.caps.slice()
        for (let i = 0; i < columns; i++) pile[i] = Math.min(pile[i], ledge.caps[i])
        piles.set(ledge.name, pile)
        ledge.changed = true
    }

    // A flake landed in column i of a ledge: its snow, spread softly either
    // side. (settle smooths it in.)
    function deposit(ledge: Ledge, i: number, r: number) {
        const p = piles.get(ledge.name)!
        const caps = ledge.caps
        const amount = r * r * 0.75 * tune.settling
        // (a bell curve, about 15px either side holding most of it, by default)
        const width = 50 * tune.spread ** 2
        const reach = Math.ceil(12 * tune.spread)
        const whole = Math.sqrt(width * Math.PI)
        for (let d = -reach; d <= reach; d++) {
            const j = i + d
            if (j < 0 || j >= p.length) continue
            p[j] = Math.min(caps[j], p[j] + amount * Math.exp(-(d * d) / width) / whole)
        }
        ledge.changed = true
    }

    // The snow on a ledge evening out as it lies: how full each column is,
    // of the most it can hold, eased towards its neighbours', so any bump a
    // flake leaves melts into the rest within a second or so and the snow
    // grows as one smooth drift, the shape of its caps, not grain by grain.
    function settle(ledge: Ledge, dt: number) {
        const p = piles.get(ledge.name)!
        const caps = ledge.caps
        const n = p.length
        // (as many passes as it takes to ease that much without overshooting)
        const total = 30 * dt * tune.smoothing
        const passes = Math.max(1, Math.ceil(total / 0.45))
        const k = Math.min(0.45, total / passes)
        const full = (j: number) => caps[j] > 0.01 ? p[j] / caps[j] : -1
        let moved = 0
        for (let pass = 0; pass < passes; pass++) {
            const f = p.map((_, j) => full(j))
            for (let j = 0; j < n; j++) {
                if (f[j] < 0) continue
                // (where a neighbour holds nothing, as at the very ends, as if it were this)
                const left = j > 0 && f[j - 1] >= 0 ? f[j - 1] : f[j]
                const right = j < n - 1 && f[j + 1] >= 0 ? f[j + 1] : f[j]
                const next = Math.min(1, Math.max(0, f[j] + k * (left - 2 * f[j] + right))) * caps[j]
                moved = Math.max(moved, Math.abs(next - p[j]))
                p[j] = next
            }
        }
        if (moved > 0.005) ledge.changed = true
    }

    function drawLedge(ledge: Ledge) {
        const p = piles.get(ledge.name)!
        const {base} = ledge
        const c = ledge.context
        const {width: w, height: h} = ledge
        const x = (i: number) => Math.min(i * column, w)
        c.clearRect(0, 0, w, h)
        c.beginPath()
        // along the top of the snow...
        c.moveTo(0, base[0] - p[0])
        for (let i = 1; i < p.length; i++) {
            const midX = (x(i - 1) + x(i)) / 2
            const midY = (base[i - 1] - p[i - 1] + base[i] - p[i]) / 2
            c.quadraticCurveTo(x(i - 1), base[i - 1] - p[i - 1], midX, midY)
        }
        c.lineTo(w, base[p.length - 1] - p[p.length - 1])
        // ...and back along its underside: what it's lying on, less an even
        // lip where it hangs a little over the front, as deep as the snow
        // above lets it be, so it eases away to nothing at the ends
        const {hang} = ledge
        const under = (i: number) => base[i] + hang * Math.min(1, p[i] / (hang * 3 + 1))
        c.lineTo(w, under(p.length - 1))
        for (let i = p.length - 2; i >= 0; i--) {
            const midX = (x(i + 1) + x(i)) / 2
            c.quadraticCurveTo(x(i + 1), under(i + 1), midX, (under(i + 1) + under(i)) / 2)
        }
        c.lineTo(0, under(0))
        c.closePath()
        const shade = c.createLinearGradient(0, 0, 0, h)
        shade.addColorStop(0, '#ffffff')
        shade.addColorStop(1, '#c9d4ea')
        c.fillStyle = shade
        c.shadowColor = 'rgb(200 220 255 / 0.45)'
        // (a glow, less on a small ledge, so it doesn't spill off the ends)
        c.shadowBlur = Math.min(6, 1 + Math.max(...p) / 2) * tune.glow
        c.fill()
        c.shadowBlur = 0
        ledge.changed = false
    }

    function drawFlakes() {
        const c = fallContext!
        c.clearRect(0, 0, width, height)
        for (const flake of flakes) {
            const size = flake.r * 4
            c.globalAlpha = flake.alpha
            c.drawImage(sprite, flake.x - size / 2, flake.y - size / 2, size, size)
        }
        c.globalAlpha = 1
    }

    function draw() {
        drawFlakes()
        for (const ledge of ledges) if (ledge.changed) drawLedge(ledge)
    }

    let last = performance.now()
    let frame = 0
    let frames = 0
    function tick(now: number) {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        const t = now / 1000
        const wind = (Math.sin(t * 0.07) * 10 + Math.sin(t * 0.23) * 4) * tune.wind
        if (++frames % 60 === 0) findLedges()
        const boxes = ledges.map(ledge => ledge.canvas.getBoundingClientRect())
        for (const ledge of ledges) settle(ledge, dt)

        flakes: for (let n = 0; n < flakes.length; n++) {
            const flake = flakes[n]
            flake.y += flake.vy * dt
            flake.x += (wind + Math.sin(t * flake.swayFreq + flake.phase) * flake.swayAmp) * dt
            if (flake.x < -10) flake.x += width + 20
            if (flake.x > width + 10) flake.x -= width + 20

            // landing on a ledge, where it's in view
            for (let k = 0; k < ledges.length; k++) {
                const box = boxes[k]
                if (flake.x < box.left || flake.x >= box.right) continue
                const ledge = ledges[k]
                const p = piles.get(ledge.name)!
                const i = Math.min(p.length - 1, Math.floor(((flake.x - box.left) / box.width) * ledge.width / column))
                const scale = box.height / ledge.height
                const under = box.top + ledge.base[i] * scale
                if (flake.y >= under - p[i] * scale && flake.y <= under + 6) {
                    deposit(ledge, i, flake.r)
                    flakes[n] = newFlake(false)
                    continue flakes
                }
            }
            if (flake.y > height + 10) flakes[n] = newFlake(false)
        }

        draw()
        frame = requestAnimationFrame(tick)
    }

    function onResize() {
        resize()
        if (reduced) draw()
    }

    findLedges()
    resize()
    if (reduced) draw()
    else frame = requestAnimationFrame(tick)
    addEventListener('resize', onResize)

    return () => {
        cancelAnimationFrame(frame)
        removeEventListener('resize', onResize)
        observer.disconnect()
    }
}

// How deep the snow can get along a ledge: most of its height, rising and
// falling gently in long, low drifts, and rounding off to nothing over
// `taper` from the ends, as a pillow of snow does.
function capsFor(columns: number, height: number, taper: number): number[] {
    const caps: number[] = []
    for (let i = 0; i < columns; i++) {
        const x = i * column
        const along = x / tune.driftLength
        const drifts = Math.max(0, 0.78 + (0.16 * Math.sin(along / 60 + 1.3) + 0.06 * Math.sin(along / 31 + 0.4)) * tune.heaps)
        const fromEnd = Math.min(i, columns - 1 - i) * column
        const u = Math.min(1, fromEnd / Math.max(1, taper))
        const thinning = Math.sqrt(1 - (1 - u) ** 2)
        caps[i] = Math.min(height, height * 0.9 * drifts * thinning)
    }
    return caps
}

function resample(from: number[], columns: number): number[] {
    const to: number[] = []
    for (let i = 0; i < columns; i++) {
        const at = (i / Math.max(1, columns - 1)) * (from.length - 1)
        const j = Math.min(from.length - 2, Math.floor(at))
        to[i] = j < 0 ? from[0] : from[j] + (from[j + 1] - from[j]) * (at - j)
    }
    return to
}

// A soft round flake, drawn once and stamped at each flake's size.
function flakeSprite(): HTMLCanvasElement {
    const sprite = document.createElement('canvas')
    sprite.width = sprite.height = 32
    const c = sprite.getContext('2d')!
    const glow = c.createRadialGradient(16, 16, 0, 16, 16, 16)
    glow.addColorStop(0, 'rgb(255 255 255 / 1)')
    glow.addColorStop(0.45, 'rgb(255 255 255 / 0.85)')
    glow.addColorStop(1, 'rgb(255 255 255 / 0)')
    c.fillStyle = glow
    c.fillRect(0, 0, 32, 32)
    return sprite
}
