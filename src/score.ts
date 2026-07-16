// Chaos score, combo multiplier, floating popups, and milestone banners.

const COMBO_WINDOW = 4 // seconds to keep a combo alive
const MAX_COMBO = 10

const MILESTONES: Array<[number, string]> = [
  [100, 'GOOD PUPPY'],
  [500, "WHO'S A GOOD GIRL?!"],
  [1000, 'ZOOMIES UNLEASHED'],
  [2500, 'ABSOLUTE UNIT OF CHAOS'],
  [5000, '10/10 WOULD DESTROY AGAIN'],
  [10000, 'THE VET FEARS YOU'],
]

const scoreEl = document.getElementById('score')!
const comboEl = document.getElementById('combo')!
const comboBarEl = document.getElementById('combo-bar')!
const comboFillEl = document.getElementById('combo-bar-fill')!
const bannerEl = document.getElementById('banner')!
const hudEl = document.getElementById('hud')!

let score = 0
let combo = 0
let comboTimer = 0
let nextMilestone = 0

export function getCombo(): number {
  return Math.max(1, combo)
}

export function getScore(): number {
  return score
}

/** Award base points (multiplied by the current combo). Returns points granted. */
export function award(basePoints: number, screenX: number, screenY: number, label: string): number {
  combo = Math.min(MAX_COMBO, combo + 1)
  comboTimer = COMBO_WINDOW
  const points = basePoints * getCombo()
  score += points
  scoreEl.textContent = String(score)
  spawnPopup(`+${points} ${label}`, screenX, screenY)
  updateComboDisplay()
  checkMilestones()
  return points
}

export function tickScore(dt: number): void {
  if (combo > 0) {
    comboTimer -= dt
    if (comboTimer <= 0) {
      combo = 0
      comboTimer = 0
    }
    updateComboDisplay()
  }
}

function updateComboDisplay(): void {
  const active = combo > 1
  comboEl.classList.toggle('active', active)
  comboBarEl.classList.toggle('active', active)
  if (active) {
    comboEl.textContent = `x${combo} COMBO`
    comboFillEl.style.width = `${(comboTimer / COMBO_WINDOW) * 100}%`
  }
}

function spawnPopup(text: string, x: number, y: number): void {
  const el = document.createElement('div')
  el.className = 'popup'
  el.textContent = text
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  hudEl.appendChild(el)
  setTimeout(() => el.remove(), 1200)
}

function checkMilestones(): void {
  while (nextMilestone < MILESTONES.length && score >= MILESTONES[nextMilestone][0]) {
    showBanner(MILESTONES[nextMilestone][1])
    nextMilestone++
  }
}

/** A floating heart — being petted is a big deal. */
export function heartPopup(x: number, y: number): void {
  const el = document.createElement('div')
  el.className = 'popup popup-heart'
  el.textContent = '♥'
  el.style.left = `${x + (Math.random() - 0.5) * 50}px`
  el.style.top = `${y}px`
  hudEl.appendChild(el)
  setTimeout(() => el.remove(), 1700)
}

/** Soft drifting "Zzz" above a snoozing puppy. */
export function sleepPopup(x: number, y: number): void {
  const el = document.createElement('div')
  el.className = 'popup popup-zzz'
  el.textContent = 'z Z z'
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  hudEl.appendChild(el)
  setTimeout(() => el.remove(), 1700)
}

export function showBanner(text: string): void {
  bannerEl.textContent = text
  bannerEl.classList.remove('show')
  // Force a reflow so the animation restarts even for back-to-back banners.
  void bannerEl.offsetWidth
  bannerEl.classList.add('show')
}
