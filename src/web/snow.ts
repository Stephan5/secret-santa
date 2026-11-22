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

// (`lands`: whether it's near enough to settle on a ledge, rather than
// falling past behind it)
type Flake = {x: number, y: number, r: number, vy: number, swayAmp: number, swayFreq: number, phase: number, alpha: number, lands: boolean}

type Ledge = {
    canvas: HTMLCanvasElement
    context: CanvasRenderingContext2D
    name: string
    width: number
    height: number
    // (the top of what it's on, down from the canvas's top, at each column)
    base: number[]
    hang: number
    // (how far it hangs at each column, of the most it could: uneven, and
    // the same each time it's drawn)
    lumps: number[]
    caps: number[]
    changed: boolean
}

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
        const r = 0.7 + Math.random() ** 2.2 * 2.8
        return {
            x: Math.random() * width,
            y: anywhere ? Math.random() * height : -8 - Math.random() * 40,
            r,
            vy: 16 + r * 15,
            swayAmp: 6 + Math.random() * 14,
            swayFreq: 0.4 + Math.random() * 0.8,
            phase: Math.random() * Math.PI * 2,
            alpha: 0.35 + (r / 3.5) * 0.6,
            // (the small, far-off ones never; of the rest, a little over half)
            lands: r > 1.2 && Math.random() < 0.6,
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

        const wanted = Math.min(400, Math.round((width * height) / 2000))
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
            const ledge: Ledge = {canvas, context, name: canvas.dataset.ledge ?? 'ledge', width: 0, height: 0, base: [], hang: 0, lumps: [], caps: [], changed: true}
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
        const depth = Number(canvas.dataset.depth ?? 12)
        ledge.hang = Number(canvas.dataset.hang ?? 0)
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
        ledge.lumps = lumpsFor(columns, ledge.name)
        ledge.caps = capsFor(columns, depth, Number(canvas.dataset.taper ?? 0)).map((cap, i) => {
            const slope = Math.abs(ledge.base[Math.min(columns - 1, i + 1)] - ledge.base[Math.max(0, i - 1)]) / (2 * column)
            return cap * Math.max(0, 1 - slope) ** 2
        })
        let pile = piles.get(ledge.name)
        // (resampled from what had gathered at the old width, or, the first
        // time, a dusting to start from)
        if (!pile || pile.length !== columns) pile = pile ? resample(pile, columns) : ledge.caps.map(cap => cap * 0.25)
        if (reduced) pile = ledge.caps.slice()
        for (let i = 0; i < columns; i++) pile[i] = Math.min(pile[i], ledge.caps[i])
        piles.set(ledge.name, pile)
        ledge.changed = true
    }

    // A flake landed in column i of a ledge: its snow, spread a little either
    // side, then let slide down any slope too steep to hold.
    function deposit(ledge: Ledge, i: number, r: number) {
        const p = piles.get(ledge.name)!
        const caps = ledge.caps
        // (more for each, since only some land)
        const amount = r * r * 2.4
        for (let d = -5; d <= 5; d++) {
            const j = i + d
            if (j < 0 || j >= p.length) continue
            p[j] = Math.min(caps[j], p[j] + amount * Math.exp(-(d * d) / 8) / 5)
        }
        for (let pass = 0; pass < 4; pass++) {
            for (let j = Math.max(0, i - 12); j < Math.min(p.length - 1, i + 12); j++) {
                const excess = p[j] - p[j + 1]
                if (Math.abs(excess) > column * 0.6) {
                    const move = (Math.abs(excess) - column * 0.6) / 2
                    if (excess > 0) { p[j] -= move; p[j + 1] = Math.min(caps[j + 1], p[j + 1] + move) }
                    else { p[j + 1] -= move; p[j] = Math.min(caps[j], p[j] + move) }
                }
            }
        }
        ledge.changed = true
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
        // ...and back along its underside: what it's lying on, less where it
        // hangs a little over the front, in a shape of its own (not the top's
        // turned over), fading out only where the snow above runs out
        const {lumps, hang} = ledge
        const under = (i: number) => base[i] + hang * lumps[i] * Math.min(1, p[i] / 2.5)
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
        c.shadowBlur = Math.min(6, 1 + Math.max(...p) / 2)
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
        const wind = Math.sin(t * 0.07) * 10 + Math.sin(t * 0.23) * 4
        if (++frames % 60 === 0) findLedges()
        const boxes = ledges.map(ledge => ledge.canvas.getBoundingClientRect())

        flakes: for (let n = 0; n < flakes.length; n++) {
            const flake = flakes[n]
            flake.y += flake.vy * dt
            flake.x += (wind + Math.sin(t * flake.swayFreq + flake.phase) * flake.swayAmp) * dt
            if (flake.x < -10) flake.x += width + 20
            if (flake.x > width + 10) flake.x -= width + 20

            // landing on a ledge, where it's in view
            for (let k = 0; flake.lands && k < ledges.length; k++) {
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
// falling gently, and thinning out to nothing `taper` from the ends.
function capsFor(columns: number, height: number, taper: number): number[] {
    const caps: number[] = []
    for (let i = 0; i < columns; i++) {
        const x = i * column
        const lumps = 0.72 + 0.16 * Math.sin(x / 37 + 1.3) + 0.12 * Math.sin(x / 13 + 0.4)
        const fromEnd = Math.min(i, columns - 1 - i) * column
        const thinning = Math.min(1, fromEnd / Math.max(1, taper)) ** 0.8
        caps[i] = height * 0.9 * lumps * thinning
    }
    return caps
}

// How far the snow hangs along a ledge, of the most it could: mostly a thin,
// even lip, with now and then a rounder drip. A value every few columns,
// picked from the ledge's name, eased between, so it rounds over from one
// to the next.
function lumpsFor(columns: number, name: string): number[] {
    let seed = 0
    for (const char of name) seed = (seed * 31 + char.codePointAt(0)!) >>> 0
    const knot = (k: number) => {
        let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
        h = (h ^ (h >>> 13)) >>> 0
        const pick = h / 0xffffffff
        return pick < 0.2 ? 0.75 + pick * 1.25 : 0.25 + (pick - 0.2) * 0.25
    }
    const every = 4
    const lumps: number[] = []
    for (let i = 0; i < columns; i++) {
        const k = Math.floor(i / every)
        const t = (i % every) / every
        const eased = (1 - Math.cos(t * Math.PI)) / 2
        lumps[i] = knot(k) * (1 - eased) + knot(k + 1) * eased
    }
    return lumps
}

function resample(from: number[], columns: number): number[] {
    const to: number[] = []
    for (let i = 0; i < columns; i++) to[i] = from[Math.min(from.length - 1, Math.round((i / Math.max(1, columns - 1)) * (from.length - 1)))]
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
