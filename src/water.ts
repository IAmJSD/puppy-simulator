// Water effects: jet droplets (a pooled THREE.Points system — one draw call),
// splash bursts, and expanding surface ripples.

import * as THREE from 'three'
import type { WaterJet } from './world'

const MAX_DROPS = 600
const GRAVITY = 9.8
const HIDDEN_Y = -100

interface Ripple {
  mesh: THREE.Mesh
  age: number
}

export class WaterFX {
  private scene: THREE.Scene
  private jets: Array<WaterJet & { acc: number }>
  private points: THREE.Points
  private positions: Float32Array
  private velocities: Float32Array
  private life: Float32Array
  private cursor = 0
  private ripples: Ripple[] = []
  private rippleGeo: THREE.RingGeometry

  constructor(scene: THREE.Scene, jets: WaterJet[]) {
    this.scene = scene
    this.jets = jets.map((j) => ({ ...j, acc: 0 }))
    this.positions = new Float32Array(MAX_DROPS * 3)
    this.velocities = new Float32Array(MAX_DROPS * 3)
    this.life = new Float32Array(MAX_DROPS)
    for (let i = 0; i < MAX_DROPS; i++) this.positions[i * 3 + 1] = HIDDEN_Y
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 500)
    const mat = new THREE.PointsMaterial({
      color: 0xbfe4f5,
      size: 0.16,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    scene.add(this.points)
    this.rippleGeo = new THREE.RingGeometry(0.82, 1, 24)
    this.rippleGeo.rotateX(-Math.PI / 2)
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % MAX_DROPS
    this.positions[i * 3] = x
    this.positions[i * 3 + 1] = y
    this.positions[i * 3 + 2] = z
    this.velocities[i * 3] = vx
    this.velocities[i * 3 + 1] = vy
    this.velocities[i * 3 + 2] = vz
    this.life[i] = life
  }

  /** Add a new emitter at runtime (e.g. a burst fire hydrant). */
  addJet(jet: WaterJet): void {
    this.jets.push({ ...jet, acc: 0 })
  }

  /** Burst of droplets kicked up from a point (entry splash, paddling). */
  splash(x: number, y: number, z: number, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * speed * 0.45
      this.emit(x, y, z, Math.cos(a) * r, speed * (0.6 + Math.random() * 0.7), Math.sin(a) * r, 1.2)
    }
  }

  /** Expanding ring on the water surface. */
  ripple(x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(
      this.rippleGeo,
      new THREE.MeshBasicMaterial({
        color: 0xd8f0fa,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    mesh.position.set(x, y, z)
    this.scene.add(mesh)
    this.ripples.push({ mesh, age: 0 })
  }

  update(dt: number): void {
    for (const jet of this.jets) {
      jet.acc += jet.rate * dt
      while (jet.acc >= 1) {
        jet.acc -= 1
        this.emit(
          jet.x,
          jet.y,
          jet.z,
          jet.vx + (Math.random() - 0.5) * jet.spread,
          jet.vy + (Math.random() - 0.5) * jet.spread,
          jet.vz + (Math.random() - 0.5) * jet.spread,
          2.2,
        )
      }
    }

    for (let i = 0; i < MAX_DROPS; i++) {
      const y = this.positions[i * 3 + 1]
      if (y <= HIDDEN_Y + 1) continue
      this.life[i] -= dt
      if (this.life[i] <= 0 || y < 0.04) {
        this.positions[i * 3 + 1] = HIDDEN_Y
        continue
      }
      this.velocities[i * 3 + 1] -= GRAVITY * dt
      this.positions[i * 3] += this.velocities[i * 3] * dt
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt
    }
    ;(this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      r.age += dt
      const t = r.age / 0.7
      if (t >= 1) {
        this.scene.remove(r.mesh)
        ;(r.mesh.material as THREE.Material).dispose()
        this.ripples.splice(i, 1)
        continue
      }
      const s = 0.3 + t * 1.6
      r.mesh.scale.set(s, 1, s)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t)
    }
  }
}
