// Neighbourhood humans: they stroll around their patch, and when the puppy
// comes close and lingers, they crouch down and pet it. Kinematic bodies,
// same pattern as the capybaras — just taller and more affectionate.

import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { GROUP_DYNAMIC } from './world'

const WALK_SPEED = 1.2
const PET_RANGE = 1.6
const PET_DWELL = 0.4 // seconds the puppy must linger before petting starts
const PET_DURATION = 2.6
const PET_COOLDOWN = 8

const SKIN_TONES = [0xf0c8a0, 0xc68e5b, 0x8d5a3b, 0xe8b088]
const SHIRTS = [0xd7263d, 0x3a6ea5, 0x5d9c45, 0xf2b134, 0xb086e0, 0x2b6b6b]
const PANTS = [0x2b3a4a, 0x4a3a2b, 0x3d3d3d]
const HAIR = [0x2b2119, 0x6e4a2e, 0xd9c48c, 0x8a8a8a]

export interface PetEvents {
  petStarted: boolean
  heartPulse: boolean
  petting: boolean
}

export class Human {
  readonly mesh: THREE.Group
  readonly body: CANNON.Body

  private homeX: number
  private homeZ: number
  private roam: number
  private walking = false
  private timer: number
  private targetX = 0
  private targetZ = 0
  private yaw: number
  private gait = 0
  private legs: THREE.Mesh[] = []
  private arms: THREE.Mesh[] = []
  private torsoGroup!: THREE.Group

  private petTimer = 0
  private petCooldown = 0
  private dwell = 0
  private crouch = 0
  private heartTimer = 0

  constructor(scene: THREE.Scene, world: CANNON.World, x: number, z: number, roam: number, seed: number) {
    this.homeX = x
    this.homeZ = z
    this.roam = roam
    this.yaw = (seed * 2.3) % 6.28
    this.timer = 1 + (seed % 4)
    this.mesh = this.buildMesh(seed)
    this.mesh.position.set(x, 0, z)
    scene.add(this.mesh)

    this.body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(0.22, 0.85, 0.16)),
    })
    this.body.collisionFilterGroup = GROUP_DYNAMIC
    this.body.allowSleep = false // a sleeping kinematic body ignores velocity writes
    this.body.position.set(x, 0.85, z)
    world.addBody(this.body)
  }

  private buildMesh(seed: number): THREE.Group {
    const g = new THREE.Group()
    const skin = new THREE.MeshLambertMaterial({ color: SKIN_TONES[seed % SKIN_TONES.length] })
    const shirt = new THREE.MeshLambertMaterial({ color: SHIRTS[seed % SHIRTS.length] })
    const pants = new THREE.MeshLambertMaterial({ color: PANTS[seed % PANTS.length] })
    const hair = new THREE.MeshLambertMaterial({ color: HAIR[(seed * 3) % HAIR.length] })

    const legGeo = new THREE.BoxGeometry(0.15, 0.5, 0.16)
    legGeo.translate(0, -0.25, 0)
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, pants)
      leg.position.set(0.1 * side, 0.5, 0)
      leg.castShadow = true
      g.add(leg)
      this.legs.push(leg)
    }

    // Torso group pivots at the hips so the whole upper body can crouch
    this.torsoGroup = new THREE.Group()
    this.torsoGroup.position.y = 0.5
    g.add(this.torsoGroup)

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.24), shirt)
    torso.position.y = 0.28
    torso.castShadow = true
    this.torsoGroup.add(torso)

    const armGeo = new THREE.BoxGeometry(0.1, 0.48, 0.11)
    armGeo.translate(0, -0.24, 0)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, shirt)
      arm.position.set(0.27 * side, 0.52, 0)
      arm.castShadow = true
      this.torsoGroup.add(arm)
      this.arms.push(arm)
    }

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin)
    head.position.y = 0.72
    head.castShadow = true
    this.torsoGroup.add(head)
    const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), hair)
    hairCap.position.y = 0.88
    this.torsoGroup.add(hairCap)

    return g
  }

  update(dt: number, puppyPos: CANNON.Vec3): PetEvents {
    const events: PetEvents = { petStarted: false, heartPulse: false, petting: false }
    this.timer -= dt
    this.petCooldown = Math.max(0, this.petCooldown - dt)

    const dx = puppyPos.x - this.body.position.x
    const dz = puppyPos.z - this.body.position.z
    const puppyDist = Math.hypot(dx, dz)
    const puppyNear = puppyDist < PET_RANGE && Math.abs(puppyPos.y - 0.35) < 1.2

    // Petting state machine
    if (this.petTimer > 0) {
      this.petTimer -= dt
      events.petting = true
      this.yaw = Math.atan2(dx, dz) // stay turned toward the pup
      this.heartTimer -= dt
      if (this.heartTimer <= 0) {
        this.heartTimer = 0.65
        events.heartPulse = true
      }
      if (this.petTimer <= 0 || puppyDist > PET_RANGE + 0.8) {
        this.petTimer = 0
        this.petCooldown = PET_COOLDOWN
        this.dwell = 0
      }
    } else if (puppyNear && this.petCooldown <= 0) {
      this.dwell += dt
      if (this.dwell > PET_DWELL) {
        this.petTimer = PET_DURATION
        this.heartTimer = 0.15
        events.petStarted = true
        events.petting = true
      }
    } else {
      this.dwell = 0
    }

    const petting = this.petTimer > 0

    // Wandering (paused while petting or while the puppy hangs around close)
    let speed = 0
    if (!petting && !puppyNear) {
      if (this.walking) {
        const wx = this.targetX - this.body.position.x
        const wz = this.targetZ - this.body.position.z
        const dist = Math.hypot(wx, wz)
        if (dist < 0.3 || this.timer <= 0) {
          this.walking = false
          this.timer = 2 + Math.random() * 5
        } else {
          const targetYaw = Math.atan2(wx, wz)
          let diff = targetYaw - this.yaw
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          this.yaw += diff * Math.min(1, 4 * dt)
          speed = WALK_SPEED
        }
      } else if (this.timer <= 0) {
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * this.roam
        this.targetX = this.homeX + Math.cos(a) * r
        this.targetZ = this.homeZ + Math.sin(a) * r
        this.walking = true
        this.timer = 15
      }
    }

    this.body.velocity.set(Math.sin(this.yaw) * speed, 0, Math.cos(this.yaw) * speed)
    this.body.position.y = 0.85
    this.body.quaternion.setFromEuler(0, this.yaw, 0)
    this.lastSpeed = speed
    this.pose(dt, speed, petting)

    return events
  }

  private lastSpeed = 0

  /** True while crouched down petting (works for both AI and net-driven). */
  get isPetting(): boolean {
    return this.crouch > 0.3
  }

  /** Mesh sync + walk/crouch/pat animation (shared by AI and net paths). */
  private pose(dt: number, speed: number, petting: boolean): void {
    this.crouch += ((petting ? 1 : 0) - this.crouch) * Math.min(1, 6 * dt)
    this.mesh.position.set(this.body.position.x, 0, this.body.position.z)
    this.mesh.rotation.y = this.yaw
    if (speed > 0.01) {
      this.gait += dt * 5.5
      const amp = 0.5
      this.legs[0].rotation.x = Math.sin(this.gait) * amp
      this.legs[1].rotation.x = Math.sin(this.gait + Math.PI) * amp
      this.arms[0].rotation.x = Math.sin(this.gait + Math.PI) * amp * 0.6
      this.arms[1].rotation.x = Math.sin(this.gait) * amp * 0.6
    } else {
      for (const leg of this.legs) leg.rotation.x *= 1 - Math.min(1, 8 * dt)
      this.arms[1].rotation.x *= 1 - Math.min(1, 8 * dt)
    }

    // Crouch + pat-pat with the right arm
    this.torsoGroup.rotation.x = 0.55 * this.crouch
    this.torsoGroup.position.y = 0.5 - 0.32 * this.crouch
    if (this.crouch > 0.1) {
      this.gait += dt // keep phase alive for the pat rhythm
      this.arms[0].rotation.x = -1.55 + Math.sin(performance.now() / 90) * 0.3 * this.crouch
    } else if (speed < 0.01) {
      this.arms[0].rotation.x *= 1 - Math.min(1, 8 * dt)
    }
  }

  /** Compact pose for the host's NPC stream: [x, z, yaw, speed, flags]. */
  syncPose(): number[] {
    const r = (n: number): number => Math.round(n * 100) / 100
    return [
      r(this.body.position.x),
      r(this.body.position.z),
      r(this.yaw),
      r(this.lastSpeed),
      this.petTimer > 0 ? 1 : 0,
    ]
  }

  /** Drive from the host's stream instead of local AI. Returns false. */
  netDrive(dt: number, x: number, z: number, yaw: number, speed: number, flags: number): boolean {
    const k = Math.min(1, 10 * dt)
    this.body.velocity.set(0, 0, 0)
    this.body.position.x += (x - this.body.position.x) * k
    this.body.position.z += (z - this.body.position.z) * k
    this.body.position.y = 0.85
    let diff = yaw - this.yaw
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    this.yaw += diff * k
    this.body.quaternion.setFromEuler(0, this.yaw, 0)
    this.pose(dt, speed, (flags & 1) !== 0)
    return false
  }
}

export function createHumans(
  scene: THREE.Scene,
  world: CANNON.World,
  spots: Array<[number, number, number]>, // [x, z, roamRadius]
): Human[] {
  return spots.map(([x, z, roam], i) => new Human(scene, world, x, z, roam, i + 2))
}
