// Capybaras: kinematic, unhurried, unbothered. They amble around their home
// spot, pause politely when the puppy comes close, cannot be moved by barking,
// and serve as walkable, snuggleable friends.

import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { GROUP_DYNAMIC } from './world'

const FUR = 0x9c7a4f
const FUR_DARK = 0x82633c
const AMBLE_SPEED = 0.8
const BODY_Y = 0.4

export class Capybara {
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
  private twitchTimer = 3
  private legs: THREE.Mesh[] = []
  private ears: THREE.Mesh[] = []
  private head!: THREE.Group

  constructor(scene: THREE.Scene, world: CANNON.World, x: number, z: number, roam: number) {
    this.homeX = x
    this.homeZ = z
    this.roam = roam
    this.yaw = (x * 13 + z * 7) % 6.28
    this.timer = 2 + ((x + z) % 5)
    this.mesh = this.buildMesh()
    this.mesh.position.set(x, 0, z)
    scene.add(this.mesh)

    this.body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(0.55, 0.33, 0.28)),
    })
    this.body.collisionFilterGroup = GROUP_DYNAMIC
    this.body.allowSleep = false // a sleeping kinematic body ignores velocity writes
    this.body.position.set(x, BODY_Y, z)
    world.addBody(this.body)
  }

  private buildMesh(): THREE.Group {
    const g = new THREE.Group()
    const fur = new THREE.MeshLambertMaterial({ color: FUR })
    const furDark = new THREE.MeshLambertMaterial({ color: FUR_DARK })
    const black = new THREE.MeshLambertMaterial({ color: 0x2b2119 })

    // The loaf (forward is +Z)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 1.05), fur)
    body.position.set(0, 0.55, 0)
    body.castShadow = true
    g.add(body)

    this.head = new THREE.Group()
    this.head.position.set(0, 0.72, 0.55)
    g.add(this.head)
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.35), fur)
    skull.castShadow = true
    this.head.add(skull)
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.22), furDark)
    snout.position.set(0, -0.04, 0.26)
    this.head.add(snout)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), black)
    nose.position.set(0, 0.06, 0.37)
    this.head.add(nose)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.04), black)
      eye.position.set(0.18 * side, 0.08, 0.1)
      this.head.add(eye)
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.05), furDark)
      ear.position.set(0.13 * side, 0.2, -0.08)
      this.head.add(ear)
      this.ears.push(ear)
    }

    const legGeo = new THREE.BoxGeometry(0.13, 0.32, 0.13)
    legGeo.translate(0, -0.16, 0)
    for (const [lx, lz] of [
      [-0.2, 0.38],
      [0.2, 0.38],
      [-0.2, -0.38],
      [0.2, -0.38],
    ] as const) {
      const leg = new THREE.Mesh(legGeo, furDark)
      leg.position.set(lx, 0.34, lz)
      leg.castShadow = true
      g.add(leg)
      this.legs.push(leg)
    }
    return g
  }

  get heading(): number {
    return this.yaw
  }

  /** True when the puppy is close enough that the capybara politely stays put. */
  private puppyClose(puppyPos: CANNON.Vec3): boolean {
    const dx = puppyPos.x - this.body.position.x
    const dz = puppyPos.z - this.body.position.z
    return dx * dx + dz * dz < 1.7
  }

  /**
   * ridden: the puppy is snuggled on this capybara's back — keep ambling and
   * give the passenger a tour instead of politely parking.
   */
  update(dt: number, puppyPos: CANNON.Vec3, ridden = false): void {
    this.timer -= dt
    const parked = (!ridden && this.puppyClose(puppyPos)) || this.roam === 0

    let speed = 0
    if (this.walking && !parked) {
      const dx = this.targetX - this.body.position.x
      const dz = this.targetZ - this.body.position.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.3 || this.timer <= 0) {
        this.walking = false
        this.timer = 4 + Math.random() * 7
      } else {
        const targetYaw = Math.atan2(dx, dz)
        let diff = targetYaw - this.yaw
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        this.yaw += diff * Math.min(1, 2.5 * dt)
        speed = AMBLE_SPEED
      }
    } else if (!this.walking && this.timer <= 0 && !parked) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * this.roam
      this.targetX = this.homeX + Math.cos(a) * r
      this.targetZ = this.homeZ + Math.sin(a) * r
      this.walking = true
      this.timer = 12
    }

    this.body.velocity.set(Math.sin(this.yaw) * speed, 0, Math.cos(this.yaw) * speed)
    this.body.position.y = BODY_Y
    this.body.quaternion.setFromEuler(0, this.yaw, 0)
    this.lastSpeed = speed
    this.pose(dt, speed)
  }

  private lastSpeed = 0

  /** Mesh sync + waddle + ear twitch (shared by AI and network-driven paths). */
  private pose(dt: number, speed: number): void {
    this.mesh.position.set(this.body.position.x, 0, this.body.position.z)
    this.mesh.rotation.y = this.yaw
    if (speed > 0.01) {
      this.gait += dt * 6
      const amp = 0.35
      this.legs[0].rotation.x = Math.sin(this.gait) * amp
      this.legs[3].rotation.x = Math.sin(this.gait) * amp
      this.legs[1].rotation.x = Math.sin(this.gait + Math.PI) * amp
      this.legs[2].rotation.x = Math.sin(this.gait + Math.PI) * amp
    } else {
      for (const leg of this.legs) leg.rotation.x *= 1 - Math.min(1, 8 * dt)
    }

    // The occasional ear twitch — peak activity for a capybara
    this.twitchTimer -= dt
    if (this.twitchTimer <= 0) {
      this.twitchTimer = 2.5 + Math.random() * 5
    }
    const twitch = this.twitchTimer < 0.25 ? Math.sin(this.twitchTimer * 50) * 0.3 : 0
    this.ears[0].rotation.z = twitch
    this.ears[1].rotation.z = -twitch
    this.head.rotation.x = Math.sin(this.gait * 0.5) * 0.03
  }

  /** Compact pose for the host's NPC stream: [x, z, yaw, speed, flags]. */
  syncPose(): number[] {
    const r = (n: number): number => Math.round(n * 100) / 100
    return [r(this.body.position.x), r(this.body.position.z), r(this.yaw), r(this.lastSpeed), 0]
  }

  /** Drive from the host's stream instead of local AI. Returns false (no events). */
  netDrive(dt: number, x: number, z: number, yaw: number, speed: number, _flags: number): boolean {
    const k = Math.min(1, 10 * dt)
    this.body.velocity.set(0, 0, 0)
    this.body.position.x += (x - this.body.position.x) * k
    this.body.position.z += (z - this.body.position.z) * k
    this.body.position.y = BODY_Y
    let diff = yaw - this.yaw
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    this.yaw += diff * k
    this.body.quaternion.setFromEuler(0, this.yaw, 0)
    this.pose(dt, speed)
    return false
  }
}

export function createCapybaras(
  scene: THREE.Scene,
  world: CANNON.World,
  spots: Array<[number, number, number]>, // [x, z, roamRadius]
): Capybara[] {
  return spots.map(([x, z, roam]) => new Capybara(scene, world, x, z, roam))
}
