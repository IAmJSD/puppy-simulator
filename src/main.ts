import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import {
  createWorld,
  GROUP_STATIC,
  GROUP_DYNAMIC,
  GROUP_NO_CAMERA,
  type Prop,
  type Pane,
} from './world'
import { Puppy, DOG_COLORS, type ClimbInfo } from './puppy'
import { initInput, consumeMouse, onFirstInput, isDown } from './input'
import { award, tickScore, getScore, sleepPopup, heartPopup, showBanner } from './score'
import {
  thud,
  glassBreak,
  sigh,
  splashSound,
  crunch,
  happyWhine,
  hiss,
  squeak,
  chitter,
  boing,
  bark as barkSound,
} from './audio'
import { Net } from './net'
import { createHumans } from './human'
import { createCritters } from './critters'
import { WaterFX } from './water'
import { createCapybaras, type Capybara } from './capybara'

const BARK_RADIUS = 4.5
const BARK_KICK = 5 // delta-v given to props in bark range
const KNOCK_SPEED = 2.2 // prop speed that counts as "knocked"
const RESETTLE_TIME = 1.5 // seconds of stillness before a prop can score again

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 450)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- World + puppy ---
const {
  scene,
  world,
  props,
  panes,
  snuggleSpots,
  climbables,
  waterZones,
  waterJets,
  dynamicDecor,
  treatBags,
  doors,
  puppyMaterial,
} = createWorld()
const waterFX = new WaterFX(scene, waterJets)

// Capybaras: a herd by the pond, one soaking in the pool. Each one's back is
// a mobile snuggle spot, because capybaras allow this. Everyone knows this.
const capybaras = createCapybaras(scene, world, [
  [-66, 91, 7],
  [-73, 90, 7],
  [-69, 99, 7],
  [-76, 96, 7],
  [38.5, 31.5, 0], // pool enjoyer, not going anywhere
  [62, 34, 3], // lazy river island resident
])
for (const capy of capybaras) {
  snuggleSpots.push({ x: 0, y: 0, z: 0, r: 0.7, name: 'CAPYBARA', body: capy.body, dy: 0.68 })
}
const unbotheredCooldowns = new Map<number, number>()
let ridingCapy: Capybara | null = null

// Humans who pet the dog. The entire point of everything.
const humans = createHumans(scene, world, [
  [0, 24, 5], // plaza strollers
  [-8, 34, 4.5],
  [-30, 17, 8], // sidewalk walkers
  [30, 13, 8],
  [-34, 30, 5], // playground parent
  [30, 40, 5], // water park lifeguard (self-appointed)
  [-58, 90, 6], // pond capybara-watcher
])
let shownPetBanner = false

// Neighbourhood wildlife
const critters = createCritters(scene, world, [
  ['cat', 12, 21, 8],
  ['cat', -42, 8, 8],
  ['cat', 50, 66, 8],
  ['cat', 5, -10, 8],
  ['mouse', -15, -13, 4],
  ['mouse', 3, -18, 4],
  ['mouse', 6, 27, 4],
  ['mouse', -38, 58, 4],
  ['mouse', -62, 88, 4],
  ['mouse', 30, 26, 4],
  ['raccoon', -16.5, -12.5, 6],
  ['raccoon', -78, 88, 6],
  ['raccoon', 60, 74, 6],
  ['bunny', -20, 50, 6],
  ['bunny', -52, 102, 6],
  ['bunny', 52, 88, 6],
  ['bunny', 25, -8, 6],
  ['bunny', -70, 22, 5],
])
const lootCooldowns = new Map<number, number>()
const critterBanners = { cat: false, mouse: false, raccoon: false, bunny: false }

// Fire hydrants erupt into geysers when knocked over
const UP = new CANNON.Vec3(0, 1, 0)
const hydrantUp = new CANNON.Vec3()
const hydrants = props
  .filter((p) => p.name === 'FIRE HYDRANT')
  .map((p) => ({ prop: p, x0: p.body.position.x, z0: p.body.position.z, burst: false }))

function burstHydrant(h: (typeof hydrants)[number], mine: boolean): void {
  if (h.burst) return
  h.burst = true
  waterFX.addJet({ x: h.x0, y: 0.05, z: h.z0, vx: 0, vy: 8.5, vz: 0, spread: 1.4, rate: 45 })
  waterZones.push({ x: h.x0, z: h.z0, r: 1.3, name: 'HYDRANT GEYSER' })
  splashSound(1)
  if (mine) {
    const s = toScreen(h.prop.body.position)
    award(60, s.x, s.y, 'GUSHER')
    showBanner('OPEN HYDRANT SUMMER')
  }
}

function updateHydrants(): void {
  for (const h of hydrants) {
    if (h.burst) continue
    const b = h.prop.body
    b.quaternion.vmult(UP, hydrantUp)
    const dx = b.position.x - h.x0
    const dz = b.position.z - h.z0
    if (hydrantUp.y < 0.5 || dx * dx + dz * dz > 2) {
      // Tilt is derived from (synced) physics, so every client detects it —
      // only the player who plausibly caused it gets paid
      burstHydrant(h, attributedToMe(b.position))
    }
  }
}
const puppy = new Puppy(world, new THREE.Vector3(0, 0, 4), puppyMaterial)
scene.add(puppy.mesh)

initInput(renderer.domElement)
onFirstInput(() => document.getElementById('intro')!.classList.add('hidden'))

// --- Multiplayer lobby ---
const hudRoot = document.getElementById('hud')!
const net = new Net(scene, hudRoot)
const playersEl = document.getElementById('players')!
let myNick = 'pup'
let myColor = 0
{
  const nickEl = document.getElementById('nick') as HTMLInputElement
  const lobbyEl = document.getElementById('lobby') as HTMLInputElement
  const joinEl = document.getElementById('join') as HTMLButtonElement
  const statusEl = document.getElementById('mp-status')!
  const colorsEl = document.getElementById('colors')!
  nickEl.value = `pup${Math.floor(Math.random() * 900 + 100)}`
  DOG_COLORS.forEach((c, i) => {
    const b = document.createElement('button')
    b.className = 'swatch' + (i === 0 ? ' sel' : '')
    b.style.background = `#${c.toString(16).padStart(6, '0')}`
    b.addEventListener('click', () => {
      myColor = i
      puppy.setColor(DOG_COLORS[i])
      colorsEl.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'))
      b.classList.add('sel')
    })
    colorsEl.appendChild(b)
  })
  joinEl.addEventListener('click', async () => {
    const lobby = lobbyEl.value.trim().toLowerCase().replace(/[^\w-]/g, '')
    if (!lobby) {
      statusEl.textContent = 'enter a lobby id'
      return
    }
    myNick = nickEl.value.trim().slice(0, 14) || 'pup'
    statusEl.textContent = 'connecting…'
    joinEl.disabled = true
    try {
      await net.connect(lobby, myNick, myColor)
      document.getElementById('intro')!.classList.add('hidden')
      playersEl.style.display = 'block'
      if (!net.isHost) net.requestSnapshot() // pull the host's world state
    } catch {
      statusEl.textContent = 'could not join — check the lobby id and try again'
      joinEl.disabled = false
    }
  })
}

net.onBark = (x, y, z) => {
  spawnRing(new THREE.Vector3(x, y, z))
  barkSound()
  barkImpulse(new CANNON.Vec3(x, y + 0.3, z))
}

let playerListAcc = 0
function refreshPlayerList(): void {
  const rows = [
    { nick: `${myNick} (you)`, color: myColor, score: getScore() },
    ...[...net.remotes.values()].map((r) => ({ nick: r.nick, color: r.color, score: r.score })),
  ].sort((a, b) => b.score - a.score)
  playersEl.innerHTML = rows
    .map(
      (r) =>
        `<div><span class="dot" style="background:#${(DOG_COLORS[r.color] ?? DOG_COLORS[0])
          .toString(16)
          .padStart(6, '0')}"></span>${r.nick.replace(/[<>&]/g, '')} — ${r.score}</div>`,
    )
    .join('')
}

// --- Camera orbit state ---
let camYaw = Math.PI
let camPitch = 0.4
let camDist = 7
let camActualDist = 7 // camDist after wall-occlusion clamping
const camTarget = new THREE.Vector3()
const camRayResult = new CANNON.RaycastResult()
const CAMERA_RAY_MASK = ~(GROUP_DYNAMIC | GROUP_NO_CAMERA)

// --- Bark shockwave rings ---
interface Ring {
  mesh: THREE.Mesh
  age: number
}
const rings: Ring[] = []
const ringGeo = new THREE.RingGeometry(0.85, 1, 32)
ringGeo.rotateX(-Math.PI / 2)

function spawnRing(position: THREE.Vector3): void {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(ringGeo, mat)
  mesh.position.set(position.x, 0.08, position.z)
  scene.add(mesh)
  rings.push({ mesh, age: 0 })
}

function updateRings(dt: number): void {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]
    r.age += dt
    const t = r.age / 0.45
    if (t >= 1) {
      scene.remove(r.mesh)
      ;(r.mesh.material as THREE.Material).dispose()
      rings.splice(i, 1)
      continue
    }
    const s = 0.5 + t * BARK_RADIUS
    r.mesh.scale.set(s, 1, s)
    ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t)
  }
}

// --- Breakable glass ---
// Panes are physics triggers: anything dynamic touching one queues a shatter.
// Removal happens outside world.step (removing bodies mid-step is unsafe).
// `mine` marks breaks this client caused (scores + is announced to the lobby)
// vs. breaks replayed from other players (visuals only).
const paneBreakQueue: Array<{ pane: Pane; mine: boolean }> = []

function queuePaneBreak(pane: Pane, mine: boolean): void {
  if (pane.broken) return
  pane.broken = true
  paneBreakQueue.push({ pane, mine })
  if (mine) net.sendEvent('pane', panes.indexOf(pane))
}

for (const pane of panes) {
  pane.body.addEventListener('collide', () => queuePaneBreak(pane, true))
}

interface Shard {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  age: number
}
const shards: Shard[] = []
const shardGeo = new THREE.BoxGeometry(0.12, 0.12, 0.02)

function spawnShards(p: THREE.Vector3): void {
  for (let i = 0; i < 12; i++) {
    const mesh = new THREE.Mesh(
      shardGeo,
      new THREE.MeshBasicMaterial({ color: 0xcfe8f5, transparent: true, opacity: 0.85 }),
    )
    mesh.position.copy(p)
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
    scene.add(mesh)
    shards.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4),
      age: 0,
    })
  }
}

function updateShards(dt: number): void {
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i]
    s.age += dt
    if (s.age > 0.9) {
      scene.remove(s.mesh)
      ;(s.mesh.material as THREE.Material).dispose()
      shards.splice(i, 1)
      continue
    }
    s.vel.y -= 9.8 * dt
    s.mesh.position.addScaledVector(s.vel, dt)
    s.mesh.rotation.x += 6 * dt
    s.mesh.rotation.z += 4 * dt
    ;(s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - s.age / 0.9)
  }
}

function processPaneBreaks(): void {
  for (const { pane, mine } of paneBreakQueue.splice(0)) {
    world.removeBody(pane.body)
    pane.mesh.removeFromParent()
    if (mine) {
      const s = toScreen(pane.body.position)
      award(30, s.x, s.y, 'WINDOW')
    }
    glassBreak()
    // Use the body position: house panes live inside rotated groups, so the
    // mesh's local position isn't world space.
    spawnShards(new THREE.Vector3(pane.body.position.x, pane.body.position.y, pane.body.position.z))
  }
}

// --- Score attribution ---
// In a lobby, prop physics is synced, so every client sees every knock.
// Only pay out for chaos this player plausibly caused: it happened near
// their puppy, or right after their bark.
let lastBarkTime = -10
function attributedToMe(p: CANNON.Vec3): boolean {
  if (!net.connected) return true
  if (worldAge - lastBarkTime < 1.5) return true
  const dx = p.x - puppy.body.position.x
  const dy = p.y - puppy.body.position.y
  const dz = p.z - puppy.body.position.z
  return dx * dx + dy * dy + dz * dz < 64
}

// The prop-shoving part of a bark — shared by local and remote barks
function barkImpulse(o: CANNON.Vec3): void {
  for (const prop of props) {
    const d = prop.body.position.vsub(o)
    const dist = d.length()
    if (dist > BARK_RADIUS) continue
    const falloff = 1 - (dist / BARK_RADIUS) * 0.6
    d.normalize()
    d.y = Math.max(d.y, 0.55) // scoop things upward for maximum drama
    d.normalize()
    prop.body.wakeUp()
    prop.body.applyImpulse(d.scale(BARK_KICK * prop.body.mass * falloff))
  }
}

function bark(origin: THREE.Vector3): void {
  spawnRing(origin)
  lastBarkTime = worldAge
  net.sendBark(origin.x, origin.y, origin.z)
  const o = new CANNON.Vec3(origin.x, origin.y + 0.3, origin.z)
  barkImpulse(o)
  // Barking shatters nearby unbroken windows
  for (const pane of panes) {
    if (pane.broken) continue
    if (pane.body.position.vsub(o).length() <= BARK_RADIUS) {
      queuePaneBreak(pane, true)
    }
  }
  // Barking bursts treat bags in range
  for (const state of bagStates) {
    if (state.burst) continue
    if (state.bag.body.position.vsub(o).length() <= BARK_RADIUS) {
      queueBagBurst(state, true)
    }
  }
  // Barking scatters cats and mice, and shakes stolen kibble out of raccoons
  critters.forEach((critter, i) => {
    if (critter.body.position.vsub(o).length() > BARK_RADIUS) return
    critter.scare()
    if (critter.kind === 'raccoon' && (lootCooldowns.get(i) ?? 0) <= 0) {
      lootCooldowns.set(i, 45)
      const p = critter.body.position
      for (let k = 0; k < 3; k++) spawnKibble(p.x, 0.5, p.z)
      chitter()
      const s = toScreen(p)
      award(45, s.x, s.y, 'CAUGHT RED-HANDED')
      if (!critterBanners.raccoon) {
        critterBanners.raccoon = true
        showBanner('TRASH PANDA JUSTICE')
      }
    }
  })
  // Capybaras are physically and emotionally immune to barking
  capybaras.forEach((capy, i) => {
    if (capy.body.position.vsub(o).length() > BARK_RADIUS) return
    if ((unbotheredCooldowns.get(i) ?? 0) > 0) return
    unbotheredCooldowns.set(i, 60)
    const s = toScreen(capy.body.position)
    award(50, s.x, s.y, 'UNBOTHERED')
  })
}

// --- Raycast that actually works ---
// world.raycastClosest relies on the broadphase's aabbQuery, which is
// unreliable for SAPBroadphase (rays silently miss existing bodies). Brute
// force over all bodies instead — trivial at this body count.
const staticRay = new CANNON.Ray()
function raycastStatic(
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  mask: number,
  result: CANNON.RaycastResult,
): boolean {
  result.reset()
  staticRay.from.set(fromX, fromY, fromZ)
  staticRay.to.set(toX, toY, toZ)
  staticRay.skipBackfaces = false
  staticRay.collisionFilterMask = mask
  staticRay.collisionFilterGroup = -1
  staticRay.mode = CANNON.RAY_MODES.CLOSEST
  staticRay.result = result
  ;(staticRay as unknown as { updateDirection(): void }).updateDirection()
  staticRay.intersectBodies(world.bodies, result)
  return result.hasHit
}

// --- Contact classification ---
// groundNormal: the most floor-like contact (null while airborne) — used to
// steer along slopes. wallNormals: every steep contact — used to stop the
// controller from shoving the puppy into walls (constant shoving makes the
// solver tolerate visible penetration).
const groundNormal = new THREE.Vector3()
const wallNormals: THREE.Vector3[] = []
const wallMemory: THREE.Vector3[] = []
let wallMemoryTtl = 0

// Collide-and-slide brake: raycast along the puppy's velocity and cap the
// approach speed toward static geometry so one physics step can never bury
// the sphere inside a wall (the solver is slow to squeeze it back out).
const moveRayResult = new CANNON.RaycastResult()
const PUPPY_R = 0.36 // sphere radius + small skin
function brakeAgainstStatics(dt: number): void {
  const v = puppy.body.velocity
  const vlen = v.length()
  if (vlen < 0.5) return
  const p = puppy.body.position
  const reach = PUPPY_R + vlen * dt + 0.05
  const hit = raycastStatic(
    p.x,
    p.y,
    p.z,
    p.x + (v.x / vlen) * reach,
    p.y + (v.y / vlen) * reach,
    p.z + (v.z / vlen) * reach,
    GROUP_STATIC,
    moveRayResult,
  )
  if (!hit) return
  const n = moveRayResult.hitNormalWorld // faces back toward the puppy
  const into = -(v.x * n.x + v.y * n.y + v.z * n.z)
  const allowed = Math.max(0, (moveRayResult.distance - PUPPY_R) / dt)
  if (into > allowed) {
    const cut = into - allowed
    v.x += n.x * cut
    v.y += n.y * cut
    v.z += n.z * cut
  }
}
function collectContacts(): THREE.Vector3 | null {
  wallNormals.length = 0
  let best = 0.5
  let found = false
  for (const c of world.contacts) {
    if (c.bi !== puppy.body && c.bj !== puppy.body) continue
    const other = c.bi === puppy.body ? c.bj : c.bi
    const s = c.bi === puppy.body ? -1 : 1
    const nx = c.ni.x * s
    const ny = c.ni.y * s
    const nz = c.ni.z * s
    if (ny > best) {
      best = ny
      found = true
      groundNormal.set(nx, ny, nz)
    } else if (ny <= 0.5 && other.mass === 0) {
      // Only STATIC contacts count as walls: dynamic bodies (doors, props)
      // should yield to nuzzling, not cancel the push.
      wallNormals.push(new THREE.Vector3(nx, ny, nz))
    }
  }
  return found ? groundNormal : null
}

// --- Scoring ---
const projected = new THREE.Vector3()

function toScreen(p: CANNON.Vec3): { x: number; y: number } {
  projected.set(p.x, p.y, p.z).project(camera)
  return {
    x: THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * window.innerWidth, 60, window.innerWidth - 60),
    y: THREE.MathUtils.clamp((-projected.y * 0.5 + 0.5) * window.innerHeight, 60, window.innerHeight - 120),
  }
}

function updateProp(prop: Prop, dt: number): void {
  const b = prop.body
  prop.mesh.position.set(b.position.x, b.position.y, b.position.z)
  prop.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)

  const speed = b.velocity.length() + b.angularVelocity.length() * 0.3
  if (!prop.scored && speed > KNOCK_SPEED) {
    prop.scored = true
    prop.settleTime = 0
    // No points while the freshly spawned world is still settling — props
    // dropping into place at load time are not the puppy's doing (yet).
    // In a lobby, only knocks attributable to this player pay out.
    if (worldAge > 2 && attributedToMe(b.position)) {
      const s = toScreen(b.position)
      award(prop.points, s.x, s.y, prop.name)
      thud(Math.min(1, speed / 9))
    }
  } else if (prop.scored) {
    if (speed < 0.4) {
      prop.settleTime += dt
      if (prop.settleTime > RESETTLE_TIME) {
        prop.scored = false
        prop.settleTime = 0
      }
    } else {
      prop.settleTime = 0
    }
  }
}

// --- Snuggling ---
// On a cozy spot, E snuggles instead of barking (resting quietly for a
// moment also works). Any input wakes the puppy back up.
const MOVE_KEYS = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]
const eHintEl = document.getElementById('e-hint')!
let restTimer = 0
let zzzTimer = 0
let prevEDown = false
let shownSnuggleBanner = false
const napCooldowns = new Map<string, number>() // spot name -> seconds until next award

function anyMoveDown(): boolean {
  return MOVE_KEYS.some((k) => isDown(k))
}

function currentSnuggleSpot(): (typeof snuggleSpots)[number] | null {
  const p = puppy.body.position
  for (const spot of snuggleSpots) {
    // Furniture spots (beds, couches) follow their body wherever it's shoved
    const sx = spot.body ? spot.body.position.x : spot.x
    const sy = spot.body ? spot.body.position.y + (spot.dy ?? 0) : spot.y
    const sz = spot.body ? spot.body.position.z : spot.z
    const dx = p.x - sx
    const dz = p.z - sz
    if (dx * dx + dz * dz <= spot.r * spot.r && Math.abs(p.y - sy) < 1) return spot
  }
  return null
}

let shownCapyBanner = false

function enterSnuggle(spot: (typeof snuggleSpots)[number]): void {
  puppy.setSnuggling(true)
  restTimer = 0
  zzzTimer = 0.8
  sigh()
  if (spot.name === 'CAPYBARA') {
    ridingCapy = capybaras.find((c) => c.body === spot.body) ?? null
    if (!shownCapyBanner) {
      shownCapyBanner = true
      showBanner('FRIENDSHIP ACHIEVED')
    }
  } else if (!shownSnuggleBanner) {
    shownSnuggleBanner = true
    showBanner('SNUG AS A BUG')
  }
  if (!napCooldowns.has(spot.name)) {
    napCooldowns.set(spot.name, 30)
    const s = toScreen(puppy.body.position)
    award(25, s.x, s.y, `COZY NAP (${spot.name})`)
  }
}

function updateSnuggle(dt: number, grounded: boolean): void {
  for (const [name, t] of napCooldowns) {
    if (t > dt) napCooldowns.set(name, t - dt)
    else napCooldowns.delete(name)
  }

  const ePressed = isDown('KeyE') && !prevEDown
  prevEDown = isDown('KeyE')
  const spot = currentSnuggleSpot()

  // Context-sensitive E in the controls bar
  const hint = puppy.snuggling ? 'E wake up' : spot ? 'E snuggle' : 'E bark'
  if (eHintEl.textContent !== hint) eHintEl.textContent = hint

  if (puppy.snuggling) {
    if (anyMoveDown() || ePressed) {
      puppy.setSnuggling(false)
      puppy.muzzle(0.4) // the wake-up press shouldn't also bark
      ridingCapy = null
      restTimer = 0
    } else {
      zzzTimer -= dt
      if (zzzTimer <= 0) {
        zzzTimer = 1.4
        const s = toScreen(puppy.body.position)
        sleepPopup(s.x + 24, s.y - 30)
      }
    }
    return
  }

  if (!spot || !grounded) {
    restTimer = 0
    return
  }

  if (ePressed) {
    enterSnuggle(spot)
    return
  }

  // Resting quietly on the spot still works
  const speed = Math.hypot(puppy.body.velocity.x, puppy.body.velocity.z)
  if (speed < 0.6 && !anyMoveDown() && !isDown('KeyE')) {
    restTimer += dt
    if (restTimer > 0.6) enterSnuggle(spot)
  } else {
    restTimer = 0
  }
}

// --- Water play ---
let wasInWater = false
let rippleTimer = 0
let airTime = 0 // seconds airborne — cashed in as BELLY FLOP points on water entry
const splashCooldowns = new Map<string, number>()

function updateWater(dt: number): void {
  for (const [name, t] of splashCooldowns) {
    if (t > dt) splashCooldowns.set(name, t - dt)
    else splashCooldowns.delete(name)
  }

  const p = puppy.body.position
  let zone = null
  for (const z of waterZones) {
    const dx = p.x - z.x
    const dz = p.z - z.z
    const d2 = dx * dx + dz * dz
    const inner = z.innerR ?? 0
    if (d2 <= z.r * z.r && d2 >= inner * inner && p.y < 1.6) {
      zone = z
      break
    }
  }
  puppy.inWater = zone !== null

  // The lazy river has a current — drift with it
  if (zone && zone.name === 'LAZY RIVER') {
    const rx = p.x - zone.x
    const rz = p.z - zone.z
    const len = Math.hypot(rx, rz) || 1
    const v = puppy.body.velocity
    v.x += (-rz / len) * 2.8 * dt
    v.z += (rx / len) * 2.8 * dt
  }

  if (zone) {
    const speed = puppy.body.velocity.length()
    if (!wasInWater) {
      // Entry splash, scaled by how hard the puppy hit the water
      const intensity = Math.min(1, speed / 8)
      waterFX.splash(p.x, 0.35, p.z, 10 + Math.round(intensity * 18), 2 + intensity * 3)
      splashSound(intensity)
      if (!splashCooldowns.has(zone.name)) {
        splashCooldowns.set(zone.name, 20)
        const s = toScreen(p)
        award(15, s.x, s.y, `SPLASH (${zone.name})`)
      }
      // Belly flop: paid by airtime, no cooldown — style is skill
      if (airTime > 0.35) {
        const pts = Math.min(150, Math.round(airTime * 80))
        const s = toScreen(p)
        award(pts, s.x, s.y - 40, 'BELLY FLOP')
        waterFX.splash(p.x, 0.4, p.z, 30, 4.5)
        splashSound(1)
        if (airTime > 1.1) showBanner('MAJESTIC BELLY FLOP')
      }
    }
    // Wading kicks up ripples and droplets
    rippleTimer -= dt
    if (rippleTimer <= 0 && speed > 1) {
      rippleTimer = 0.3
      waterFX.ripple(p.x, 0.32, p.z)
      if (speed > 4) waterFX.splash(p.x, 0.3, p.z, 4, 1.6)
    }
  }
  wasInWater = zone !== null
}

// --- Treat bags & kibble ---
// Bags burst on a hard hit (headbutt, fall, bark); the kibble inside spills
// out as physics pieces the puppy eats by walking over them.
interface BagState {
  bag: (typeof treatBags)[number]
  burst: boolean
}
interface Kibble {
  mesh: THREE.Mesh
  body: CANNON.Body
}
const bagStates: BagState[] = treatBags.map((bag) => ({ bag, burst: false }))
const bagBurstQueue: Array<{ state: BagState; mine: boolean }> = []

function queueBagBurst(state: BagState, mine: boolean): void {
  if (state.burst) return
  state.burst = true
  bagBurstQueue.push({ state, mine })
  if (mine) net.sendEvent('bag', bagStates.indexOf(state))
}
const kibbles: Kibble[] = []
const kibbleGeo = new THREE.SphereGeometry(0.06, 6, 5)
const kibbleMats = [0xa5692e, 0x8a542a, 0xb87d3a].map(
  (c) => new THREE.MeshLambertMaterial({ color: c }),
)
let treatsEaten = 0

for (const state of bagStates) {
  state.bag.body.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
    if (state.burst) return
    if (Math.abs(e.contact.getImpactVelocityAlongNormal()) > 4.5) {
      queueBagBurst(state, true)
    }
  })
}

function spawnKibble(x: number, y: number, z: number): void {
  const mesh = new THREE.Mesh(kibbleGeo, kibbleMats[kibbles.length % kibbleMats.length])
  mesh.castShadow = true
  scene.add(mesh)
  const body = new CANNON.Body({ mass: 0.05, shape: new CANNON.Sphere(0.055) })
  body.collisionFilterGroup = GROUP_DYNAMIC
  body.linearDamping = 0.35
  body.position.set(x, y, z)
  const a = Math.random() * Math.PI * 2
  const r = 1 + Math.random() * 2.2
  body.velocity.set(Math.cos(a) * r, 2 + Math.random() * 2.5, Math.sin(a) * r)
  world.addBody(body)
  kibbles.push({ mesh, body })
}

function processBagBursts(): void {
  for (const { state, mine } of bagBurstQueue.splice(0)) {
    const p = state.bag.body.position
    world.removeBody(state.bag.body)
    state.bag.mesh.visible = false
    // Torn bag husk stays behind
    const husk = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.22, 0.52), new THREE.MeshLambertMaterial({ color: 0xe8762c }))
    husk.position.set(p.x, 0.11, p.z)
    husk.rotation.y = Math.random() * 3
    husk.castShadow = true
    scene.add(husk)
    for (let i = 0; i < 16; i++) spawnKibble(p.x, Math.max(0.5, p.y), p.z)
    thud(1)
    crunch()
    if (mine) {
      const s = toScreen(p)
      award(20, s.x, s.y, 'JACKPOT')
    }
  }
}

function updateKibble(): void {
  const pp = puppy.body.position
  for (let i = kibbles.length - 1; i >= 0; i--) {
    const k = kibbles[i]
    k.mesh.position.set(k.body.position.x, k.body.position.y, k.body.position.z)
    const dx = k.body.position.x - pp.x
    const dy = k.body.position.y - pp.y
    const dz = k.body.position.z - pp.z
    if (dx * dx + dy * dy + dz * dz < 0.36) {
      scene.remove(k.mesh)
      world.removeBody(k.body)
      kibbles.splice(i, 1)
      crunch()
      puppy.energize(1.5)
      treatsEaten++
      const s = toScreen(pp)
      award(5, s.x, s.y, 'NOM')
      if (treatsEaten === 15) showBanner('TREAT GOBLIN')
      else if (treatsEaten === 40) showBanner('INSATIABLE')
    }
  }
}

// --- Swing doors: soft return spring toward closed ---
// Doors swing freely both ways; this eases them shut again afterwards.
function updateDoors(dt: number): void {
  for (const d of doors) {
    const q = d.body.quaternion
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z))
    let diff = yaw - d.restYaw
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    if (Math.abs(diff) > 0.04) {
      d.body.wakeUp()
      d.body.angularVelocity.y -= diff * 4.5 * dt
    }
  }
}

// --- Tree climbing ---
function currentClimbable(): ClimbInfo | null {
  const p = puppy.body.position
  for (const c of climbables) {
    const dx = c.x - p.x
    const dz = c.z - p.z
    const dist = Math.hypot(dx, dz)
    if (dist > 0.01 && dist < c.r + 0.8 && p.y < c.topY + 0.5) {
      return { dirX: dx / dist, dirZ: dz / dist, dist, radius: c.r, topY: c.topY }
    }
  }
  return null
}

// --- Synced physics (host-authoritative) ---
// The lobby host's simulation is the truth. It streams deltas of awake
// bodies; other clients keep simulating locally as prediction and apply the
// host's state on top. Remote players get kinematic ghost bodies in the
// host's world so their pushes move props for everyone.
const syncBodies: CANNON.Body[] = [...props.map((p) => p.body), ...dynamicDecor.map((d) => d.body)]
const r3 = (n: number): number => Math.round(n * 1000) / 1000

function buildEntries(onlyAwake: boolean): number[][] {
  const out: number[][] = []
  syncBodies.forEach((b, i) => {
    if (!b.world) return // removed (e.g. burst treat bag)
    if (onlyAwake && b.sleepState === CANNON.Body.SLEEPING) return
    out.push([
      i,
      r3(b.position.x),
      r3(b.position.y),
      r3(b.position.z),
      r3(b.quaternion.x),
      r3(b.quaternion.y),
      r3(b.quaternion.z),
      r3(b.quaternion.w),
      r3(b.velocity.x),
      r3(b.velocity.y),
      r3(b.velocity.z),
    ])
  })
  return out
}

function applyEntries(entries: number[][]): void {
  for (const e of entries) {
    const b = syncBodies[e[0]]
    if (!b || !b.world) continue
    b.wakeUp()
    b.position.set(e[1], e[2], e[3])
    b.quaternion.set(e[4], e[5], e[6], e[7])
    b.velocity.set(e[8], e[9], e[10])
  }
}

net.onDelta = applyEntries
net.onEvent = (kind, i) => {
  if (kind === 'pane' && panes[i]) queuePaneBreak(panes[i], false)
  else if (kind === 'bag' && bagStates[i]) queueBagBurst(bagStates[i], false)
  else if (kind === 'scare' && net.isHost) critters[i]?.scare()
}
net.onSnapshotRequest = (from) => {
  net.sendSnapshot(from, {
    bodies: buildEntries(false),
    panes: panes.map((p, i) => (p.broken ? i : -1)).filter((i) => i >= 0),
    bags: bagStates.map((s, i) => (s.burst ? i : -1)).filter((i) => i >= 0),
    hyd: hydrants.map((h, i) => (h.burst ? i : -1)).filter((i) => i >= 0),
  })
}
net.onSnapshot = (snap) => {
  for (const i of snap.panes) if (panes[i]) queuePaneBreak(panes[i], false)
  for (const i of snap.bags) if (bagStates[i]) queueBagBurst(bagStates[i], false)
  for (const i of snap.hyd) if (hydrants[i]) burstHydrant(hydrants[i], false)
  applyEntries(snap.bodies)
}

// --- NPC sync ---
interface NpcLike {
  body: CANNON.Body
  syncPose(): number[]
  netDrive(dt: number, x: number, z: number, yaw: number, speed: number, flags: number): boolean
}
const npcs: NpcLike[] = [...capybaras, ...humans, ...critters]
const critterOffset = capybaras.length + humans.length
let npcTargets: number[][] | null = null
net.onNpc = (n) => {
  npcTargets = n
}

const nearestTmp = new CANNON.Vec3()
function nearestPuppyPos(x: number, z: number): CANNON.Vec3 {
  let best: CANNON.Vec3 = puppy.body.position
  let bd = (x - best.x) ** 2 + (z - best.z) ** 2
  for (const rp of net.remotes.values()) {
    const d = (x - rp.netPos.x) ** 2 + (z - rp.netPos.z) ** 2
    if (d < bd) {
      bd = d
      nearestTmp.set(rp.netPos.x, rp.netPos.y, rp.netPos.z)
      best = nearestTmp
    }
  }
  return best
}

// Geometric NPC interactions against MY puppy: pets, boops, catches.
const petAwardCooldowns = new Map<number, number>()
const touchAwardCooldowns = new Map<number, number>()
let heartAcc = 0
function updateMyNpcInteractions(dt: number): void {
  let beingPetted = false
  humans.forEach((h, i) => {
    const cd = petAwardCooldowns.get(i) ?? 0
    if (cd > 0) petAwardCooldowns.set(i, cd - dt)
    if (!h.isPetting) return
    const dx = h.body.position.x - puppy.body.position.x
    const dz = h.body.position.z - puppy.body.position.z
    if (dx * dx + dz * dz > 4.4) return
    beingPetted = true
    if ((petAwardCooldowns.get(i) ?? 0) <= 0) {
      petAwardCooldowns.set(i, 12)
      happyWhine()
      const s = toScreen(puppy.body.position)
      award(30, s.x, s.y, 'PETS')
      if (!shownPetBanner) {
        shownPetBanner = true
        showBanner('MAXIMUM GOOD DOG')
      }
    }
  })
  puppy.delighted = beingPetted
  if (beingPetted) {
    heartAcc += dt
    if (heartAcc > 0.65) {
      heartAcc = 0
      const s = toScreen(puppy.body.position)
      heartPopup(s.x, s.y - 40)
    }
  }

  critters.forEach((c, i) => {
    const cd = touchAwardCooldowns.get(i) ?? 0
    if (cd > 0) {
      touchAwardCooldowns.set(i, cd - dt)
      return
    }
    const range = c.touchRange
    if (range <= 0) return
    const dx = c.body.position.x - puppy.body.position.x
    const dy = c.body.position.y - puppy.body.position.y
    const dz = c.body.position.z - puppy.body.position.z
    if (dx * dx + dy * dy + dz * dz > range * range) return
    touchAwardCooldowns.set(i, 30)
    const s = toScreen(c.body.position)
    if (c.kind === 'cat') {
      award(35, s.x, s.y, 'CAT BOOP')
      if (!critterBanners.cat) {
        critterBanners.cat = true
        showBanner('FELINE DIPLOMACY')
      }
    } else if (c.kind === 'mouse') {
      squeak()
      award(25, s.x, s.y, 'MOUSE!')
      if (!critterBanners.mouse) {
        critterBanners.mouse = true
        showBanner('MICE TO MEET YOU')
      }
    } else if (c.kind === 'bunny') {
      boing()
      award(30, s.x, s.y, 'BUNNY BOOP')
      if (!critterBanners.bunny) {
        critterBanners.bunny = true
        showBanner('SOMEBUNNY SPECIAL')
      }
    }
    // The flee must happen where the AI runs
    if (net.connected && !net.isHost) net.sendEvent('scare', i)
    else c.scare()
  })

  for (const [i, t] of lootCooldowns) {
    if (t > dt) lootCooldowns.set(i, t - dt)
    else lootCooldowns.delete(i)
  }
}

// Kinematic ghost puppies (host only): remote players' bodies in OUR sim,
// so their shoves and nuzzles move props authoritatively.
const ghostBodies = new Map<string, CANNON.Body>()
function updateGhosts(): void {
  if (!net.isHost) {
    for (const [id, g] of ghostBodies) {
      world.removeBody(g)
      ghostBodies.delete(id)
    }
    return
  }
  for (const [id, rp] of net.remotes) {
    let g = ghostBodies.get(id)
    if (!g) {
      g = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.KINEMATIC,
        shape: new CANNON.Sphere(0.35),
      })
      g.collisionFilterGroup = GROUP_DYNAMIC
      g.allowSleep = false
      g.position.set(rp.netPos.x, rp.netPos.y, rp.netPos.z)
      world.addBody(g)
      ghostBodies.set(id, g)
    }
    const dx = rp.netPos.x - g.position.x
    const dy = rp.netPos.y - g.position.y
    const dz = rp.netPos.z - g.position.z
    if (dx * dx + dy * dy + dz * dz > 6) {
      g.position.set(rp.netPos.x, rp.netPos.y, rp.netPos.z)
      g.velocity.set(0, 0, 0)
    } else {
      g.velocity.set(dx / 0.12, dy / 0.12, dz / 0.12)
    }
  }
  for (const [id, g] of ghostBodies) {
    if (!net.remotes.has(id)) {
      world.removeBody(g)
      ghostBodies.delete(id)
    }
  }
}

// --- Main loop ---
let lastTime = performance.now()
let worldAge = 0
let deltaAcc = 0

// Let the physics settle before the first frame so props start at rest
// instead of visibly dropping into place at spawn.
for (let i = 0; i < 60; i++) world.step(1 / 60)
paneBreakQueue.length = 0
bagBurstQueue.length = 0

function frame(now: number): void {
  requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - lastTime) / 1000)
  lastTime = now
  if (dt <= 0) return
  worldAge += dt

  // Camera input
  const m = consumeMouse()
  camYaw -= m.dx * 0.005
  camPitch = THREE.MathUtils.clamp(camPitch + m.dy * 0.005, 0.08, 1.2)
  camDist = THREE.MathUtils.clamp(camDist + m.wheel * 0.01, 3.5, 14)

  // Simulate
  world.step(1 / 60, dt, 4)

  const ground = collectContacts()
  // Wall contacts flicker (resolve → separate → re-slam), so remember them
  // briefly — otherwise the controller re-rams the wall on every separation
  // frame and the solver settles into visible penetration.
  if (wallNormals.length > 0) {
    wallMemory.length = 0
    wallMemory.push(...wallNormals)
    wallMemoryTtl = 0.2
  } else {
    wallMemoryTtl -= dt
    if (wallMemoryTtl <= 0) wallMemory.length = 0
  }
  // Snuggle first: an E press on a cozy spot must become a snuggle, not a
  // bark (a snuggling puppy skips input handling in update()).
  updateSnuggle(dt, ground !== null)
  const barkEvent = puppy.update(dt, camYaw, ground, wallMemory, currentClimbable())
  brakeAgainstStatics(dt)
  if (barkEvent) bark(barkEvent.position)

  updateWater(dt)
  if (ground) airTime = 0
  else if (!puppy.climbing && !puppy.inWater) airTime += dt
  // NPCs: host/solo runs the AI (reacting to the NEAREST puppy, whoever's
  // that is); lobby non-hosts drive their copies from the host's stream.
  const npcRemote = net.connected && !net.isHost
  if (!npcRemote) {
    for (const capy of capybaras) {
      const near = nearestPuppyPos(capy.body.position.x, capy.body.position.z)
      const riddenLocal = capy === ridingCapy && puppy.snuggling
      let riddenRemote = false
      for (const rp of net.remotes.values()) {
        const ddx = rp.netPos.x - capy.body.position.x
        const ddz = rp.netPos.z - capy.body.position.z
        if (rp.isSnuggling && ddx * ddx + ddz * ddz < 0.85) {
          riddenRemote = true
          break
        }
      }
      capy.update(dt, near, riddenLocal || riddenRemote)
    }
    for (const h of humans) {
      h.update(dt, nearestPuppyPos(h.body.position.x, h.body.position.z))
    }
    for (const c of critters) {
      const ev = c.update(dt, nearestPuppyPos(c.body.position.x, c.body.position.z))
      if (ev.fleeStarted && c.kind === 'cat') hiss()
    }
  } else if (npcTargets) {
    for (const e of npcTargets) {
      const n = npcs[e[0]]
      if (!n) continue
      const fleeStarted = n.netDrive(dt, e[1], e[2], e[3], e[4], e[5])
      const ci = e[0] - critterOffset
      if (fleeStarted && ci >= 0 && critters[ci]?.kind === 'cat') hiss()
    }
  }

  // Interactions with MY puppy — geometric, so awards always land on the
  // right player regardless of who hosts.
  updateMyNpcInteractions(dt)
  // Carry the snoozing passenger along on the capybara's back
  if (ridingCapy && puppy.snuggling) {
    const rb = ridingCapy.body
    puppy.body.position.set(rb.position.x, rb.position.y + 0.66, rb.position.z)
    puppy.body.velocity.set(rb.velocity.x, 0, rb.velocity.z)
    puppy.face(ridingCapy.heading)
  }
  updateHydrants()
  processBagBursts()
  updateKibble()
  updateDoors(dt)

  // Multiplayer: interpolate remote puppies, position nameplates, send state
  if (net.connected || net.remotes.size > 0) {
    updateGhosts()
    deltaAcc += dt
    if (net.isHost && deltaAcc >= 0.1) {
      deltaAcc = 0
      net.sendDelta(buildEntries(true))
      net.sendNpc(npcs.map((n, i) => [i, ...n.syncPose()]))
    }
    for (const rp of net.remotes.values()) {
      rp.update(dt)
      const g = rp.parts.group
      projected.set(g.position.x, g.position.y + 1.15, g.position.z).project(camera)
      const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1
      rp.nameEl.style.display = onScreen && g.visible ? 'block' : 'none'
      if (onScreen) {
        rp.nameEl.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`
        rp.nameEl.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`
      }
    }
    net.maybeSendState(
      dt,
      puppy.body.position.x,
      puppy.body.position.y,
      puppy.body.position.z,
      puppy.heading,
      {
        z: puppy.zoomies ? 1 : 0,
        s: puppy.snuggling ? 1 : 0,
        c: puppy.climbing ? 1 : 0,
      },
      getScore(),
    )
    playerListAcc += dt
    if (playerListAcc > 1) {
      playerListAcc = 0
      refreshPlayerList()
    }
  }
  for (const [i, t] of unbotheredCooldowns) {
    if (t > dt) unbotheredCooldowns.set(i, t - dt)
    else unbotheredCooldowns.delete(i)
  }
  processPaneBreaks()
  for (const prop of props) updateProp(prop, dt)
  for (const d of dynamicDecor) {
    d.mesh.position.set(d.body.position.x, d.body.position.y, d.body.position.z)
    d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w)
  }
  waterFX.update(dt)
  updateRings(dt)
  updateShards(dt)
  tickScore(dt)

  // Camera follow with wall occlusion: raycast toward the desired position and
  // pull the camera in front of whatever static geometry it would clip through.
  const desiredTarget = new THREE.Vector3(
    puppy.body.position.x,
    puppy.body.position.y + 0.6,
    puppy.body.position.z,
  )
  camTarget.lerp(desiredTarget, 1 - Math.exp(-10 * dt))
  // The smoothed target can cut corners through walls (e.g. turning sharply
  // through a doorway), which would start the occlusion ray inside geometry.
  // If a static separates it from the puppy, snap it.
  if (
    raycastStatic(
      desiredTarget.x,
      desiredTarget.y,
      desiredTarget.z,
      camTarget.x,
      camTarget.y,
      camTarget.z,
      CAMERA_RAY_MASK,
      camRayResult,
    )
  ) {
    camTarget.copy(desiredTarget)
  }
  const cp = Math.cos(camPitch)
  const dirX = Math.sin(camYaw) * cp
  const dirY = Math.sin(camPitch)
  const dirZ = Math.cos(camYaw) * cp

  raycastStatic(
    camTarget.x,
    camTarget.y,
    camTarget.z,
    camTarget.x + dirX * camDist,
    camTarget.y + dirY * camDist,
    camTarget.z + dirZ * camDist,
    CAMERA_RAY_MASK,
    camRayResult,
  )
  // No lower clamp that could push the camera past nearby geometry: if the
  // wall is 0.4m away, the camera sits at 0.15m — never inside the wall.
  const allowedDist = camRayResult.hasHit
    ? Math.max(0.05, camRayResult.distance - 0.25)
    : camDist
  if (allowedDist < camActualDist) {
    camActualDist = allowedDist // snap in instantly — never clip
  } else {
    camActualDist += (allowedDist - camActualDist) * (1 - Math.exp(-4 * dt)) // ease back out
  }

  camera.position.set(
    camTarget.x + dirX * camActualDist,
    Math.max(0.5, camTarget.y + dirY * camActualDist),
    camTarget.z + dirZ * camActualDist,
  )
  camera.lookAt(camTarget)
  // Ultra-close camera would be inside the puppy's head — hide the model
  puppy.mesh.visible = camActualDist > 0.8

  renderer.render(scene, camera)
}

requestAnimationFrame(frame)
