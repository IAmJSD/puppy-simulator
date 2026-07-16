// Keyboard + mouse-drag state, polled by the game loop.

const keys = new Set<string>()

export const mouse = {
  dragging: false,
  dx: 0,
  dy: 0,
  wheel: 0,
}

let anyKeyListeners: Array<() => void> = []

/** Fires once on the first key press or click (used to dismiss the intro). */
export function onFirstInput(fn: () => void): void {
  anyKeyListeners.push(fn)
}

function fireFirstInput(): void {
  if (anyKeyListeners.length === 0) return
  const listeners = anyKeyListeners
  anyKeyListeners = []
  for (const fn of listeners) fn()
}

export function isDown(code: string): boolean {
  return keys.has(code)
}

export function initInput(canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault()
    keys.add(e.code)
    fireFirstInput()
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => keys.clear())

  canvas.addEventListener('mousedown', () => {
    mouse.dragging = true
    fireFirstInput()
  })
  window.addEventListener('mouseup', () => {
    mouse.dragging = false
  })
  window.addEventListener('mousemove', (e) => {
    if (mouse.dragging) {
      mouse.dx += e.movementX
      mouse.dy += e.movementY
    }
  })
  window.addEventListener(
    'wheel',
    (e) => {
      mouse.wheel += e.deltaY
    },
    { passive: true },
  )
}

/** Read and reset per-frame mouse deltas. */
export function consumeMouse(): { dx: number; dy: number; wheel: number } {
  const out = { dx: mouse.dx, dy: mouse.dy, wheel: mouse.wheel }
  mouse.dx = 0
  mouse.dy = 0
  mouse.wheel = 0
  return out
}
