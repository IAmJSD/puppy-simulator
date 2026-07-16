// Headless physics test: drive a puppy-like body up the staircase and log
// its trajectory. /sim.html?sx=0.5&sz=-26.75&dx=1&dz=0
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { createWorld } from './world'

const q = new URLSearchParams(location.search)
const n = (k: string, d: number): number => {
  const v = q.get(k)
  return v === null ? d : parseFloat(v)
}

const { world, panes, puppyMaterial } = createWorld()
const body = new CANNON.Body({
  mass: 8,
  shape: new CANNON.Sphere(0.35),
  position: new CANNON.Vec3(n('sx', 0.5), n('sy', 0.35), n('sz', -26.75)),
  material: puppyMaterial,
  fixedRotation: true,
  linearDamping: 0.05,
})
for (const pane of panes) {
  pane.body.addEventListener('collide', () => {
    if (!pane.broken) {
      pane.broken = true
      console.log(`PANE COLLIDE body#${pane.body.id} at (${pane.body.position.x},${pane.body.position.y})`)
    }
  })
}
body.allowSleep = false
body.collisionFilterGroup = 2
world.addBody(body)

const dirX = n('dx', 1)
const dirZ = n('dz', 0)
const maxSpeed = n('speed', 7)
const groundNormal = new THREE.Vector3()
const wallNormals: THREE.Vector3[] = []

function getGroundNormal(): THREE.Vector3 | null {
  wallNormals.length = 0
  let best = 0.5
  let found = false
  for (const c of world.contacts) {
    if (c.bi !== body && c.bj !== body) continue
    const s = c.bi === body ? -1 : 1
    const ny = c.ni.y * s
    if (ny > best) {
      best = ny
      found = true
      groundNormal.set(c.ni.x * s, c.ni.y * s, c.ni.z * s)
    } else if (ny <= 0.5) {
      wallNormals.push(new THREE.Vector3(c.ni.x * s, ny, c.ni.z * s))
    }
  }
  return found ? groundNormal : null
}

const lines: string[] = []
const verbose = q.get('verbose') === '1'
const simRay = new CANNON.Ray()
function rayStatic(
  fx: number,
  fy: number,
  fz: number,
  tx2: number,
  ty2: number,
  tz2: number,
  mask: number,
  result: CANNON.RaycastResult,
): boolean {
  result.reset()
  simRay.from.set(fx, fy, fz)
  simRay.to.set(tx2, ty2, tz2)
  simRay.skipBackfaces = false
  simRay.collisionFilterMask = mask
  simRay.collisionFilterGroup = -1
  simRay.mode = CANNON.RAY_MODES.CLOSEST
  simRay.result = result
  ;(simRay as unknown as { updateDirection(): void }).updateDirection()
  simRay.intersectBodies(world.bodies, result)
  return result.hasHit
}
if (q.get('probe') === '2') {
  // Dump everything that could be the upstairs floor or west wall
  for (const b of world.bodies) {
    const inFloorBand = b.position.y > 2.8 && b.position.y < 4.2
    const inWestBand = b.position.x < -8.5
    if (b.mass === 0 && (inFloorBand || inWestBand)) {
      const sh = b.shapes[0]
      const he = sh instanceof CANNON.Box ? ` half=(${sh.halfExtents.x},${sh.halfExtents.y},${sh.halfExtents.z})` : ` ${sh?.constructor.name}`
      console.log(
        `body#${b.id} grp=${b.collisionFilterGroup} pos=(${b.position.x.toFixed(2)},${b.position.y.toFixed(2)},${b.position.z.toFixed(2)})${he}`,
      )
    }
  }
}
if (q.get('probe') === '1') {
  for (const b of world.bodies) {
    if (Math.abs(b.position.z + 20) < 0.6 && b.position.y < 3.5) {
      const sh = b.shapes[0]
      const he = sh instanceof CANNON.Box ? ` half=(${sh.halfExtents.x},${sh.halfExtents.y},${sh.halfExtents.z})` : ''
      console.log(
        `body#${b.id} ${sh?.constructor.name} grp=${b.collisionFilterGroup} trig=${b.isTrigger} pos=(${b.position.x.toFixed(2)},${b.position.y.toFixed(2)},${b.position.z.toFixed(2)})${he}`,
      )
    }
  }
  const rr = new CANNON.RaycastResult()
  rayStatic(-1.675, 0.35, -22, -1.675, 0.35, -18, -1, rr)
  console.log(`ray hit=${rr.hasHit} dist=${rr.distance.toFixed(2)} body#${rr.body?.id}`)
}
const wallMemory: THREE.Vector3[] = []
let wallMemoryTtl = 0
for (let i = 0; i <= 360; i++) {
  const preV = `pre=(${body.velocity.x.toFixed(2)},${body.velocity.y.toFixed(2)},${body.velocity.z.toFixed(2)})`
  world.step(1 / 60)
  if (q.get('tracewest') === '1' && body.position.x < -8.8 && body.position.y > 1) {
    const contacts = world.contacts
      .filter((c) => c.bi === body || c.bj === body)
      .map((c) => {
        const other = c.bi === body ? c.bj : c.bi
        const s = c.bi === body ? -1 : 1
        return `#${other.id} n=(${(c.ni.x * s).toFixed(2)},${(c.ni.y * s).toFixed(2)},${(c.ni.z * s).toFixed(2)})`
      })
      .join(' ')
    lines.push(
      `f${i} pos=(${body.position.x.toFixed(3)},${body.position.y.toFixed(3)},${body.position.z.toFixed(3)}) v=(${body.velocity.x.toFixed(1)},${body.velocity.y.toFixed(1)},${body.velocity.z.toFixed(1)}) c: ${contacts}`,
    )
  }
  if (verbose && i >= 28 && i <= 40) {
    const contacts = world.contacts
      .filter((c) => c.bi === body || c.bj === body)
      .map((c) => {
        const other = c.bi === body ? c.bj : c.bi
        const s = c.bi === body ? -1 : 1
        const shape = other.shapes[0]?.constructor.name ?? '?'
        return `${shape}#${other.id} n=(${(c.ni.x * s).toFixed(2)},${(c.ni.y * s).toFixed(2)},${(c.ni.z * s).toFixed(2)})`
      })
      .join(' | ')
    lines.push(
      `f${i} ${preV} post=(${body.velocity.x.toFixed(2)},${body.velocity.y.toFixed(2)},${body.velocity.z.toFixed(2)}) pos=(${body.position.x.toFixed(2)},${body.position.y.toFixed(2)}) contacts: ${contacts}`,
    )
  }
  const gn = getGroundNormal()
  const blend = 1 - Math.exp(-12 / 60)
  let tx = dirX * maxSpeed
  let ty = 0
  let tz = dirZ * maxSpeed
  let slopeActive = false
  const v = body.velocity
  if (gn && gn.y > 0.55 && gn.y < 0.999) {
    const dot = tx * gn.x + tz * gn.z
    tx -= gn.x * dot
    ty -= gn.y * dot
    tz -= gn.z * dot
    const len = Math.hypot(tx, ty, tz)
    if (len > 0.001) {
      const k = maxSpeed / len
      tx *= k
      ty *= k
      tz *= k
    }
    slopeActive = true
  }
  if (wallNormals.length > 0) {
    wallMemory.length = 0
    wallMemory.push(...wallNormals)
    wallMemoryTtl = 0.2
  } else {
    wallMemoryTtl -= 1 / 60
    if (wallMemoryTtl <= 0) wallMemory.length = 0
  }
  let ax = tx - v.x
  let ay = ty - v.y
  let az = tz - v.z
  for (const w of wallMemory) {
    const d = ax * w.x + (slopeActive ? ay * w.y : 0) + az * w.z
    if (d < 0) {
      ax -= w.x * d
      az -= w.z * d
      if (slopeActive) ay -= w.y * d
    }
  }
  if (slopeActive) v.y += ay * blend
  v.x += ax * blend
  v.z += az * blend
  // collide-and-slide brake (mirrors main.ts)
  const vlen = v.length()
  if (vlen > 0.5) {
    const reach = 0.36 + (vlen * 1) / 60 + 0.05
    const rr = new CANNON.RaycastResult()
    rayStatic(
      body.position.x,
      body.position.y,
      body.position.z,
      body.position.x + (v.x / vlen) * reach,
      body.position.y + (v.y / vlen) * reach,
      body.position.z + (v.z / vlen) * reach,
      1,
      rr,
    )
    if (rr.hasHit) {
      const wn = rr.hitNormalWorld
      const into = -(v.x * wn.x + v.y * wn.y + v.z * wn.z)
      const allowed = Math.max(0, (rr.distance - 0.36) * 60)
      if (into > allowed) {
        const cut = into - allowed
        v.x += wn.x * cut
        v.y += wn.y * cut
        v.z += wn.z * cut
      }
    }
  }
  if (i % 15 === 0) {
    lines.push(
      `t=${(i / 60).toFixed(2)} x=${body.position.x.toFixed(2)} y=${body.position.y.toFixed(2)} z=${body.position.z.toFixed(2)} vx=${v.x.toFixed(1)} vy=${v.y.toFixed(1)} n=${gn ? gn.y.toFixed(2) : 'air'}`,
    )
  }
}
console.log(lines.join('\n'))
;(window as unknown as { __done: boolean }).__done = true
