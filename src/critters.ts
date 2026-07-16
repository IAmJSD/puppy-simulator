// Small neighbourhood wildlife: cats (flee, hiss, boopable), mice (dart,
// squeak), and raccoons (lurk, rear up, drop stolen kibble when barked at).
// All share one kinematic wanderer engine with species-specific models.

import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { GROUP_DYNAMIC } from './world'

export type CritterKind = 'cat' | 'mouse' | 'raccoon'

interface SpeciesCfg {
  walkSpeed: number
  fleeSpeed: number
  fleeRange: number // flees when the puppy gets this close (0 = never)
  touchRange: number
  bodyY: number
  half: [number, number, number]
  idleMin: number
  idleMax: number
  gaitRate: number
}

const SPECIES: Record<CritterKind, SpeciesCfg> = {
  cat: {
    walkSpeed: 1.0,
    fleeSpeed: 6,
    fleeRange: 3,
    touchRange: 0.95,
    bodyY: 0.25,
    half: [0.14, 0.22, 0.3],
    idleMin: 2,
    idleMax: 7,
    gaitRate: 9,
  },
  mouse: {
    walkSpeed: 3.2, // darts
    fleeSpeed: 4.5,
    fleeRange: 2.2,
    touchRange: 0.5,
    bodyY: 0.1,
    half: [0.07, 0.09, 0.12],
    idleMin: 0.6,
    idleMax: 2.2,
    gaitRate: 22,
  },
  raccoon: {
    walkSpeed: 0.9,
    fleeSpeed: 5,
    fleeRange: 0, // unbothered by proximity; only barking scares one
    touchRange: 0,
    bodyY: 0.3,
    half: [0.18, 0.28, 0.35],
    idleMin: 2,
    idleMax: 6,
    gaitRate: 7,
  },
}

type Animate = (gait: number, speed: number, alert: boolean) => void

interface BuiltMesh {
  mesh: THREE.Group
  animate: Animate
}

const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c })

function buildCat(seed: number): BuiltMesh {
  const colors = [0x2b2b31, 0xe8762c, 0x8a8a8a, 0xf5f0e6]
  const fur = lam(colors[seed % colors.length])
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.5), fur)
  body.position.y = 0.26
  body.castShadow = true
  g.add(body)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.16), fur)
  head.position.set(0, 0.42, 0.28)
  head.castShadow = true
  g.add(head)
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), fur)
    ear.position.set(0.06 * side, 0.54, 0.26)
    g.add(ear)
  }
  const legs: THREE.Mesh[] = []
  const legGeo = new THREE.BoxGeometry(0.05, 0.18, 0.05)
  legGeo.translate(0, -0.09, 0)
  for (const [lx, lz] of [
    [-0.07, 0.18],
    [0.07, 0.18],
    [-0.07, -0.18],
    [0.07, -0.18],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, fur)
    leg.position.set(lx, 0.17, lz)
    g.add(leg)
    legs.push(leg)
  }
  const tailGeo = new THREE.BoxGeometry(0.05, 0.05, 0.38)
  tailGeo.translate(0, 0, -0.19)
  const tail = new THREE.Mesh(tailGeo, fur)
  tail.position.set(0, 0.34, -0.24)
  tail.rotation.x = -0.7
  g.add(tail)

  return {
    mesh: g,
    animate: (gait, speed, alert) => {
      const amp = Math.min(0.8, speed * 0.12)
      legs[0].rotation.x = Math.sin(gait) * amp
      legs[3].rotation.x = Math.sin(gait) * amp
      legs[1].rotation.x = Math.sin(gait + Math.PI) * amp
      legs[2].rotation.x = Math.sin(gait + Math.PI) * amp
      tail.rotation.y = Math.sin(gait * 0.35) * 0.45
      tail.rotation.x = alert ? -1.2 : -0.7 // tail up when spooked
    },
  }
}

function buildMouse(seed: number): BuiltMesh {
  const fur = lam(seed % 2 === 0 ? 0x9a9a9a : 0x8a6a4f)
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.18), fur)
  body.position.y = 0.08
  body.castShadow = true
  g.add(body)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.09), fur)
  head.position.set(0, 0.09, 0.12)
  g.add(head)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), lam(0xe8a0a0))
  nose.position.set(0, 0.08, 0.17)
  g.add(nose)
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.015, 8), lam(0xe8a0a0))
    ear.rotation.x = Math.PI / 2
    ear.position.set(0.04 * side, 0.14, 0.1)
    g.add(ear)
  }
  const tailGeo = new THREE.BoxGeometry(0.015, 0.015, 0.2)
  tailGeo.translate(0, 0, -0.1)
  const tail = new THREE.Mesh(tailGeo, lam(0xc9a0a0))
  tail.position.set(0, 0.05, -0.08)
  g.add(tail)

  return {
    mesh: g,
    animate: (gait, speed) => {
      // Scurry bob + tail wiggle
      body.position.y = 0.08 + Math.abs(Math.sin(gait)) * Math.min(0.03, speed * 0.01)
      tail.rotation.y = Math.sin(gait * 0.7) * 0.5
    },
  }
}

function buildRaccoon(): BuiltMesh {
  const grayFur = lam(0x7a7a7a)
  const dark = lam(0x2b2b31)
  const g = new THREE.Group()
  const pivot = new THREE.Group() // rears up around this
  g.add(pivot)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.6), grayFur)
  body.position.set(0, 0.34, 0)
  body.castShadow = true
  pivot.add(body)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.2), grayFur)
  head.position.set(0, 0.52, 0.34)
  head.castShadow = true
  pivot.add(head)
  const mask = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.07, 0.03), dark)
  mask.position.set(0, 0.55, 0.44)
  pivot.add(mask)
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.08), lam(0xd9d4c9))
  snout.position.set(0, 0.47, 0.46)
  pivot.add(snout)
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 4), dark)
    ear.position.set(0.08 * side, 0.65, 0.3)
    pivot.add(ear)
  }
  // Ringed tail
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.BoxGeometry(0.1 - i * 0.012, 0.1 - i * 0.012, 0.12), i % 2 === 0 ? grayFur : dark)
    ring.position.set(0, 0.36 + i * 0.045, -0.34 - i * 0.1)
    ring.castShadow = true
    pivot.add(ring)
  }
  const legs: THREE.Mesh[] = []
  const legGeo = new THREE.BoxGeometry(0.08, 0.22, 0.08)
  legGeo.translate(0, -0.11, 0)
  for (const [lx, lz] of [
    [-0.11, 0.2],
    [0.11, 0.2],
    [-0.11, -0.2],
    [0.11, -0.2],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, dark)
    leg.position.set(lx, 0.22, lz)
    pivot.add(leg)
    legs.push(leg)
  }

  return {
    mesh: g,
    animate: (gait, speed, alert) => {
      const amp = Math.min(0.5, speed * 0.3)
      legs[0].rotation.x = Math.sin(gait) * amp
      legs[3].rotation.x = Math.sin(gait) * amp
      legs[1].rotation.x = Math.sin(gait + Math.PI) * amp
      legs[2].rotation.x = Math.sin(gait + Math.PI) * amp
      // Rear up on hind legs when the puppy is close
      const target = alert ? -0.75 : 0
      pivot.rotation.x += (target - pivot.rotation.x) * 0.12
      pivot.position.y = -Math.sin(pivot.rotation.x) * 0.28
    },
  }
}

export interface CritterEvents {
  touched: boolean
  fleeStarted: boolean
}

export class Critter {
  readonly kind: CritterKind
  readonly mesh: THREE.Group
  readonly body: CANNON.Body
  touchCooldown = 0

  private cfg: SpeciesCfg
  private animateFn: Animate
  private homeX: number
  private homeZ: number
  private roam: number
  private walking = false
  private timer: number
  private targetX = 0
  private targetZ = 0
  private yaw: number
  private gait = 0
  private fleeTime = 0
  private wasFleeing = false

  constructor(
    scene: THREE.Scene,
    world: CANNON.World,
    kind: CritterKind,
    x: number,
    z: number,
    roam: number,
    seed: number,
  ) {
    this.kind = kind
    this.cfg = SPECIES[kind]
    const built = kind === 'cat' ? buildCat(seed) : kind === 'mouse' ? buildMouse(seed) : buildRaccoon()
    this.mesh = built.mesh
    this.animateFn = built.animate
    this.homeX = x
    this.homeZ = z
    this.roam = roam
    this.yaw = (seed * 1.7) % 6.28
    this.timer = 1 + (seed % 3)
    this.mesh.position.set(x, 0, z)
    scene.add(this.mesh)

    const h = this.cfg.half
    this.body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(h[0], h[1], h[2])),
    })
    this.body.collisionFilterGroup = GROUP_DYNAMIC
    this.body.allowSleep = false // sleeping kinematic bodies ignore velocity writes
    this.body.position.set(x, this.cfg.bodyY, z)
    world.addBody(this.body)
  }

  /** Force a flee (e.g. barked at). */
  scare(): void {
    this.fleeTime = Math.max(this.fleeTime, 1.6)
  }

  update(dt: number, puppyPos: CANNON.Vec3): CritterEvents {
    const events: CritterEvents = { touched: false, fleeStarted: false }
    this.timer -= dt
    this.touchCooldown = Math.max(0, this.touchCooldown - dt)
    this.fleeTime = Math.max(0, this.fleeTime - dt)

    const dx = puppyPos.x - this.body.position.x
    const dz = puppyPos.z - this.body.position.z
    const puppyDist = Math.hypot(dx, dz)

    if (this.cfg.fleeRange > 0 && puppyDist < this.cfg.fleeRange) {
      this.fleeTime = Math.max(this.fleeTime, 0.8)
    }
    if (
      this.cfg.touchRange > 0 &&
      puppyDist < this.cfg.touchRange &&
      this.touchCooldown <= 0 &&
      Math.abs(puppyPos.y - this.cfg.bodyY) < 1
    ) {
      this.touchCooldown = 30
      events.touched = true
      this.scare()
    }

    const fleeing = this.fleeTime > 0
    if (fleeing && !this.wasFleeing) events.fleeStarted = true
    this.wasFleeing = fleeing

    let speed = 0
    if (fleeing && puppyDist > 0.01) {
      // Run directly away, drifting back toward home
      const awayX = -dx / (puppyDist || 1) + (this.homeX - this.body.position.x) * 0.02
      const awayZ = -dz / (puppyDist || 1) + (this.homeZ - this.body.position.z) * 0.02
      const targetYaw = Math.atan2(awayX, awayZ)
      let diff = targetYaw - this.yaw
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      this.yaw += diff * Math.min(1, 10 * dt)
      speed = this.cfg.fleeSpeed
      this.walking = false
      this.timer = 1
    } else if (this.walking) {
      const wx = this.targetX - this.body.position.x
      const wz = this.targetZ - this.body.position.z
      const dist = Math.hypot(wx, wz)
      if (dist < 0.25 || this.timer <= 0) {
        this.walking = false
        this.timer = this.cfg.idleMin + Math.random() * (this.cfg.idleMax - this.cfg.idleMin)
      } else {
        const targetYaw = Math.atan2(wx, wz)
        let diff = targetYaw - this.yaw
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        this.yaw += diff * Math.min(1, 6 * dt)
        speed = this.cfg.walkSpeed
      }
    } else if (this.timer <= 0) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * this.roam
      this.targetX = this.homeX + Math.cos(a) * r
      this.targetZ = this.homeZ + Math.sin(a) * r
      this.walking = true
      this.timer = 6
    }

    this.body.velocity.set(Math.sin(this.yaw) * speed, 0, Math.cos(this.yaw) * speed)
    this.body.position.y = this.cfg.bodyY
    this.body.quaternion.setFromEuler(0, this.yaw, 0)

    const alert = puppyDist < 2.2 && !fleeing
    this.lastSpeed = speed
    this.lastFlee = fleeing
    this.lastAlert = alert
    this.pose(dt, speed, fleeing, alert)

    return events
  }

  private lastSpeed = 0
  private lastFlee = false
  private lastAlert = false

  private pose(dt: number, speed: number, fleeing: boolean, alert: boolean): void {
    this.mesh.position.set(this.body.position.x, 0, this.body.position.z)
    this.mesh.rotation.y = this.yaw
    if (speed > 0.01) this.gait += dt * this.cfg.gaitRate * (fleeing ? 1.6 : 1)
    this.animateFn(this.gait, speed, alert)
  }

  get touchRange(): number {
    return this.cfg.touchRange
  }

  /** Compact pose for the host's NPC stream: [x, z, yaw, speed, flags]. */
  syncPose(): number[] {
    const r = (n: number): number => Math.round(n * 100) / 100
    return [
      r(this.body.position.x),
      r(this.body.position.z),
      r(this.yaw),
      r(this.lastSpeed),
      (this.lastFlee ? 1 : 0) | (this.lastAlert ? 2 : 0),
    ]
  }

  /** Drive from the host's stream. Returns true when a flee just started. */
  netDrive(dt: number, x: number, z: number, yaw: number, speed: number, flags: number): boolean {
    const fleeing = (flags & 1) !== 0
    const alert = (flags & 2) !== 0
    const fleeStarted = fleeing && !this.wasFleeing
    this.wasFleeing = fleeing
    const k = Math.min(1, 12 * dt)
    this.body.velocity.set(0, 0, 0)
    this.body.position.x += (x - this.body.position.x) * k
    this.body.position.z += (z - this.body.position.z) * k
    this.body.position.y = this.cfg.bodyY
    let diff = yaw - this.yaw
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    this.yaw += diff * k
    this.body.quaternion.setFromEuler(0, this.yaw, 0)
    this.pose(dt, speed, fleeing, alert)
    return fleeStarted
  }
}

export function createCritters(
  scene: THREE.Scene,
  world: CANNON.World,
  spots: Array<[CritterKind, number, number, number]>, // [kind, x, z, roam]
): Critter[] {
  return spots.map(([kind, x, z, roam], i) => new Critter(scene, world, kind, x, z, roam, i + 1))
}
