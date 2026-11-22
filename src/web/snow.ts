// Snow: flakes falling down the window, behind everything (on `fall`, a
// canvas fixed over the viewport), and gathering where they land on the
// footer's divider (on `drift`, a canvas sitting on it). The drift is kept
// here, not in the page, so it carries on building from page to page.
// With reduced motion asked for: a still scatter of flakes, and the drift
// already settled.

type Flake = {x: number, y: number, r: number, vy: number, swayAmp: number, swayFreq: number, phase: number, alpha: number}

// (the drift is a row of columns this wide, in CSS pixels, each with its
// own depth of snow)
const column = 3
let pile: number[] | null = null

export function startSnow(fall: HTMLCanvasElement, drift: HTMLCanvasElement): () => void {
    const fallContext = fall.getContext('2d')
    const driftContext = drift.getContext('2d')
    if (!fallContext || !driftContext) return () => {}
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const sprite = flakeSprite()

    let width = 0
    let height = 0
    let driftWidth = 0
    let driftHeight = 0
    let ratio = 1
    let caps: number[] = []
    let driftChanged = true
    const flakes: Flake[] = []

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
        }
    }

    function resize() {
        ratio = Math.min(devicePixelRatio || 1, 2)
        width = innerWidth
        height = innerHeight
        fall.width = Math.round(width * ratio)
        fall.height = Math.round(height * ratio)
        fallContext!.setTransform(ratio, 0, 0, ratio, 0, 0)

        const box = drift.getBoundingClientRect()
        driftWidth = box.width
        driftHeight = box.height
        drift.width = Math.round(driftWidth * ratio)
        drift.height = Math.round(driftHeight * ratio)
        driftContext!.setTransform(ratio, 0, 0, ratio, 0, 0)

        const columns = Math.max(2, Math.ceil(driftWidth / column) + 1)
        caps = driftCaps(columns, driftHeight)
        if (!pile || pile.length !== columns) {
            // (resampled from what had gathered at the old width, or, the
            // first time, a dusting to start from)
            pile = pile ? resample(pile, columns) : caps.map(cap => cap * 0.25)
        }
        if (reduced) pile = caps.slice()
        for (let i = 0; i < columns; i++) pile[i] = Math.min(pile[i], caps[i])
        driftChanged = true

        const wanted = Math.min(400, Math.round((width * height) / 2000))
        while (flakes.length < wanted) flakes.push(newFlake(true))
        flakes.length = wanted
    }

    // A flake landed in column i: its snow, spread a little either side,
    // then let slide down any slope too steep to hold.
    function deposit(i: number, r: number) {
        const p = pile!
        const amount = r * r * 1.7
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
        driftChanged = true
    }

    function drawDrift() {
        const p = pile!
        const c = driftContext!
        c.clearRect(0, 0, driftWidth, driftHeight)
        c.beginPath()
        c.moveTo(0, driftHeight)
        c.lineTo(0, driftHeight - p[0])
        for (let i = 1; i < p.length; i++) {
            const x0 = (i - 1) * column
            const x1 = i * column
            c.quadraticCurveTo(x0, driftHeight - p[i - 1], (x0 + x1) / 2, driftHeight - (p[i - 1] + p[i]) / 2)
        }
        c.lineTo(driftWidth, driftHeight - p[p.length - 1])
        c.lineTo(driftWidth, driftHeight)
        c.closePath()
        const shade = c.createLinearGradient(0, 0, 0, driftHeight)
        shade.addColorStop(0, '#ffffff')
        shade.addColorStop(1, '#c9d4ea')
        c.fillStyle = shade
        c.shadowColor = 'rgb(200 220 255 / 0.45)'
        c.shadowBlur = 6
        c.fill()
        c.shadowBlur = 0
        driftChanged = false
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

    let last = performance.now()
    let frame = 0
    function tick(now: number) {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        const t = now / 1000
        const wind = Math.sin(t * 0.07) * 10 + Math.sin(t * 0.23) * 4
        const line = drift.getBoundingClientRect()
        const p = pile!

        for (let n = 0; n < flakes.length; n++) {
            const flake = flakes[n]
            flake.y += flake.vy * dt
            flake.x += (wind + Math.sin(t * flake.swayFreq + flake.phase) * flake.swayAmp) * dt
            if (flake.x < -10) flake.x += width + 20
            if (flake.x > width + 10) flake.x -= width + 20

            // landing on the drift, where it's in view
            if (flake.x >= line.left && flake.x < line.right) {
                const i = Math.min(p.length - 1, Math.floor((flake.x - line.left) / column))
                const surface = line.bottom - p[i]
                if (flake.y >= surface && flake.y <= line.bottom + 6) {
                    deposit(i, flake.r)
                    flakes[n] = newFlake(false)
                    continue
                }
            }
            if (flake.y > height + 10) flakes[n] = newFlake(false)
        }

        drawFlakes()
        if (driftChanged) drawDrift()
        frame = requestAnimationFrame(tick)
    }

    function onResize() {
        resize()
        if (reduced) { drawFlakes(); drawDrift() }
    }

    resize()
    if (reduced) {
        drawFlakes()
        drawDrift()
    } else {
        frame = requestAnimationFrame(tick)
    }
    addEventListener('resize', onResize)
    // (the footer can move without the window resizing, as the page fills)
    const observer = new ResizeObserver(onResize)
    observer.observe(drift)

    return () => {
        cancelAnimationFrame(frame)
        removeEventListener('resize', onResize)
        observer.disconnect()
    }
}

// How deep the snow can get along the line: most of the drift's height,
// rising and falling gently, and thinning out to nothing at the ends,
// where it'd slide off.
function driftCaps(columns: number, height: number): number[] {
    const caps: number[] = []
    for (let i = 0; i < columns; i++) {
        const x = i * column
        const lumps = 0.72 + 0.16 * Math.sin(x / 37 + 1.3) + 0.12 * Math.sin(x / 13 + 0.4)
        const fromEnd = Math.min(i, columns - 1 - i) * column
        const taper = Math.min(1, fromEnd / 36) ** 0.8
        caps[i] = height * 0.9 * lumps * taper
    }
    return caps
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
