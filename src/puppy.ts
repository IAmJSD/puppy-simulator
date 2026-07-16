// The star of the show: a low-poly procedural puppy with a physics body,
// movement controller, and wiggly bits (tail, ears, legs).

import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { isDown } from './input'
import { bark as barkSound, jumpYip } from './audio'
import { GROUP_DYNAMIC, GROUP_NO_CAMERA } from './world'

const BODY_RADIUS = 0.35
const WALK_SPEED = 7
const ZOOMIES_SPEED = 12
const JUMP_SPEED = 6.5
const ACCEL = 12 // higher = snappier direction changes
const CLIMB_SPEED = 3
const CLIMB_SPEED_ZOOMIES = 4.5
const SLIDE_ACCEL = 11 // extra downhill push while sliding hands-free
const SLIDE_MAX = 16

const FUR = 0xc68e5b
const FUR_DARK = 0xa8713f
const FUR_LIGHT = 0xe8c496

export interface BarkEvent {
  position: THREE.Vector3
}

/** Info about a climbable trunk in range, computed by main each frame. */
export interface ClimbInfo {
  dirX: number // unit vector from puppy toward the trunk axis
  dirZ: number
  dist: number // horizontal distance to the trunk axis
  radius: number
  topY: number
}

export class Puppy {
  readonly mesh: THREE.Group
  readonly body: CANNON.Body

  private legs: THREE.Mesh[] = []
  private tail!: THREE.Mesh
  private ears: THREE.Mesh[] = []
  private head!: THREE.Group
  // Animation phases are accumulated (phase += freq * dt) rather than computed
  // as time * freq — with a speed-dependent freq, the latter makes the phase
  // jump every frame and the limbs jitter.
  private gaitPhase = 0
  private wagPhase = 0
  private flopPhase = 0
  private facing = 0
  private barkCooldown = 0
  private wasJumpDown = false
  private snuggleTime = 0
  private slideDelay = 0
  private treatTimer = 0

  zoomies = false
  snuggling = false
  inWater = false // set by main; wading slows the puppy down
  climbing = false
  sliding = false
  delighted = false // being petted — maximum tail output

  setSnuggling(on: boolean): void {
    if (on && !this.snuggling) this.snuggleTime = 0
    this.snuggling = on
  }

  /** Briefly suppress barking (e.g. the E press that wakes from a snuggle). */
  muzzle(seconds: number): void {
    this.barkCooldown = Math.max(this.barkCooldown, seconds)
  }

  /** Point the model a specific way (e.g. aligned with a capybara mount). */
  face(yaw: number): void {
    this.facing = yaw
  }

  /** Treats grant a short sugar-rush speed boost. Stacks up to ~9 seconds. */
  energize(seconds: number): void {
    this.treatTimer = Math.min(9, this.treatTimer + seconds)
  }

  constructor(world: CANNON.World, spawn: THREE.Vector3, material: CANNON.Material) {
    this.mesh = this.buildMesh()
    this.body = new CANNON.Body({
      mass: 8,
      shape: new CANNON.Sphere(BODY_RADIUS),
      position: new CANNON.Vec3(spawn.x, spawn.y + BODY_RADIUS, spawn.z),
      material,
      fixedRotation: true,
      linearDamping: 0.05,
    })
    this.body.allowSleep = false // a sleeping body ignores velocity writes — puppy must stay awake
    this.body.collisionFilterGroup = GROUP_DYNAMIC // camera occlusion ray ignores dynamic bodies
    this.body.updateMassProperties()
    world.addBody(this.body)
  }

  private buildMesh(): THREE.Group {
    const g = new THREE.Group()
    const fur = new THREE.MeshLambertMaterial({ color: FUR })
    const furDark = new THREE.MeshLambertMaterial({ color: FUR_DARK })
    const furLight = new THREE.MeshLambertMaterial({ color: FUR_LIGHT })
    const black = new THREE.MeshLambertMaterial({ color: 0x2b2119 })

    // Body (forward is +Z)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.68), fur)
    body.position.set(0, 0.42, 0)
    body.castShadow = true
    g.add(body)

    // Chest patch
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.1), furLight)
    chest.position.set(0, 0.36, 0.32)
    g.add(chest)

    // Head group so it can tilt
    this.head = new THREE.Group()
    this.head.position.set(0, 0.62, 0.36)
    g.add(this.head)

    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), fur)
    skull.castShadow = true
    this.head.add(skull)

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.16), furLight)
    snout.position.set(0, -0.05, 0.2)
    this.head.add(snout)

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.05), black)
    nose.position.set(0, -0.02, 0.29)
    this.head.add(nose)

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.03), black)
      eye.position.set(0.09 * side, 0.06, 0.16)
      this.head.add(eye)

      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.06), furDark)
      ear.position.set(0.16 * side, 0.1, -0.02)
      ear.geometry.translate(0, -0.11, 0) // pivot at the top so it flops
      ear.rotation.z = 0.5 * side
      ear.castShadow = true
      this.head.add(ear)
      this.ears.push(ear)
    }

    // Legs — pivot at the hip
    const legGeo = new THREE.BoxGeometry(0.1, 0.26, 0.1)
    legGeo.translate(0, -0.13, 0)
    for (const [x, z] of [
      [-0.13, 0.24],
      [0.13, 0.24],
      [-0.13, -0.24],
      [0.13, -0.24],
    ]) {
      const leg = new THREE.Mesh(legGeo, furDark)
      leg.position.set(x, 0.28, z)
      leg.castShadow = true
      g.add(leg)
      this.legs.push(leg)
    }

    // Tail — pivot at the base, wags around Y
    const tailGeo = new THREE.BoxGeometry(0.08, 0.08, 0.3)
    tailGeo.translate(0, 0, -0.15)
    this.tail = new THREE.Mesh(tailGeo, fur)
    this.tail.position.set(0, 0.56, -0.32)
    this.tail.rotation.x = -0.6
    this.tail.castShadow = true
    g.add(this.tail)

    return g
  }

  /**
   * Advance the puppy one frame. groundNormal is the contact surface normal
   * (null while airborne). Returns a BarkEvent when the puppy barks this
   * frame (the world reacts to it), otherwise null.
   */
  update(
    dt: number,
    cameraYaw: number,
    groundNormal: THREE.Vector3 | null,
    wallNormals: readonly THREE.Vector3[] = [],
    climb: ClimbInfo | null = null,
  ): BarkEvent | null {
    const grounded = groundNormal !== null
    this.barkCooldown = Math.max(0, this.barkCooldown - dt)

    if (this.snuggling) {
      // Curled up: gently damp any drift and play the cozy pose
      const v = this.body.velocity
      v.x *= 1 - Math.min(1, 10 * dt)
      v.z *= 1 - Math.min(1, 10 * dt)
      this.syncSnuggle(dt)
      return null
    }

    this.zoomies = isDown('ShiftLeft') || isDown('ShiftRight')

    // Camera-relative movement direction
    let ix = 0
    let iz = 0
    if (isDown('KeyW') || isDown('ArrowUp')) iz += 1
    if (isDown('KeyS') || isDown('ArrowDown')) iz -= 1
    if (isDown('KeyA') || isDown('ArrowLeft')) ix -= 1
    if (isDown('KeyD') || isDown('ArrowRight')) ix += 1

    const moving = ix !== 0 || iz !== 0
    let dirX = 0
    let dirZ = 0
    if (moving) {
      const len = Math.hypot(ix, iz)
      ix /= len
      iz /= len
      const sin = Math.sin(cameraYaw)
      const cos = Math.cos(cameraYaw)
      // Rotate the input vector into world space around the camera yaw.
      dirX = ix * cos - iz * sin
      dirZ = -ix * sin - iz * cos
    }

    // --- Tree climbing: hold toward a trunk to scrabble up it ---
    const wantsClimb =
      climb !== null && moving && dirX * climb.dirX + dirZ * climb.dirZ > 0.35
    this.climbing = wantsClimb
    // While climbing, ignore GROUP_NO_CAMERA colliders (trunk, branches) so
    // the branch steps don't snag the climb; velocities are fully driven here.
    this.body.collisionFilterMask = wantsClimb ? ~GROUP_NO_CAMERA : -1
    if (wantsClimb && climb) {
      const v = this.body.velocity
      const jumpDown = isDown('Space')
      if (this.body.position.y >= climb.topY) {
        // Crest: hop up and inward onto the canopy
        v.y = 5.5
        v.x = climb.dirX * 2.5
        v.z = climb.dirZ * 2.5
      } else if (jumpDown && !this.wasJumpDown) {
        // Kick off the trunk
        v.y = JUMP_SPEED
        v.x = -climb.dirX * 4.5
        v.z = -climb.dirZ * 4.5
        jumpYip()
      } else {
        // Radial spring holds the puppy just off the bark; steady ascent
        const err = climb.dist - (climb.radius + 0.33)
        const radial = Math.max(-2, Math.min(2, err * 6))
        v.x = climb.dirX * radial
        v.z = climb.dirZ * radial
        v.y = this.zoomies ? CLIMB_SPEED_ZOOMIES : CLIMB_SPEED
      }
      this.wasJumpDown = jumpDown
      this.facing = Math.atan2(climb.dirX, climb.dirZ)
      this.syncClimb(dt)
      return null
    }

    this.treatTimer = Math.max(0, this.treatTimer - dt)
    const maxSpeed =
      (this.zoomies ? ZOOMIES_SPEED : WALK_SPEED) *
      (this.inWater ? 0.6 : 1) *
      (this.treatTimer > 0 ? 1.3 : 1)
    const blend = 1 - Math.exp(-ACCEL * dt)
    const v = this.body.velocity

    // Hands-free on a steep surface = WHEEE. The idle brake would otherwise
    // damp horizontal velocity and make slides a slow crawl — instead, stop
    // braking and push down the slope. The short grace delay keeps momentary
    // key releases while CLIMBING stairs from flinging the puppy back down.
    const slideCandidate =
      !moving && groundNormal !== null && groundNormal.y < 0.94 && groundNormal.y > 0.55
    this.slideDelay = slideCandidate ? this.slideDelay + dt : 0
    this.sliding = slideCandidate && this.slideDelay > 0.35
    if (this.sliding && groundNormal) {
      const n = groundNormal
      const sx = n.x * n.y
      const sy = -(n.x * n.x + n.z * n.z)
      const sz = n.z * n.y
      const len = Math.hypot(sx, sy, sz)
      if (len > 0.001 && v.length() < SLIDE_MAX) {
        const k = (SLIDE_ACCEL * dt) / len
        v.x += sx * k
        v.y += sy * k
        v.z += sz * k
      }
      // fall through: jump, facing, and bark all still work mid-slide
    } else {
      let tx = dirX * maxSpeed
      let ty = 0
      let tz = dirZ * maxSpeed
      let slopeActive = false
      if (moving && groundNormal && groundNormal.y > 0.55 && groundNormal.y < 0.999) {
        // On a slope: project the desired velocity onto the surface plane and
        // rescale, so stairs/ramps are climbed at full speed instead of the
        // contact solver eating the horizontal push. Also glues the puppy to
        // the ramp on the way down.
        const dot = tx * groundNormal.x + tz * groundNormal.z
        tx -= groundNormal.x * dot
        ty -= groundNormal.y * dot
        tz -= groundNormal.z * dot
        const len = Math.hypot(tx, ty, tz)
        if (len > 0.001) {
          const k = maxSpeed / len
          tx *= k
          ty *= k
          tz *= k
        }
        slopeActive = true
      }
      // Clamp the acceleration, not the velocity, against touched walls:
      // never accelerate INTO a wall (prevents penetration from constant
      // shoving) and never damp the solver's outward push (which would
      // freeze the puppy inside the wall).
      let ax = tx - v.x
      let ay = ty - v.y
      let az = tz - v.z
      for (const w of wallNormals) {
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
    }

    // Jump
    const jumpDown = isDown('Space')
    if (jumpDown && !this.wasJumpDown && grounded) {
      v.y = JUMP_SPEED
      jumpYip()
    }
    this.wasJumpDown = jumpDown

    // Face travel direction
    const speed = Math.hypot(v.x, v.z)
    if (speed > 0.5) {
      const target = Math.atan2(v.x, v.z)
      let diff = target - this.facing
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      this.facing += diff * Math.min(1, 12 * dt)
    }

    this.syncMesh(dt, speed, grounded)

    // Bark
    if (isDown('KeyE') && this.barkCooldown === 0) {
      this.barkCooldown = 0.6
      barkSound()
      return { position: this.mesh.position.clone() }
    }
    return null
  }

  private syncMesh(dt: number, speed: number, grounded: boolean): void {
    const p = this.body.position
    this.mesh.position.set(p.x, p.y - BODY_RADIUS, p.z)
    this.mesh.rotation.y = this.facing
    this.mesh.rotation.x = 0
    this.mesh.scale.set(1, 1, 1)

    this.wagPhase += dt * (this.delighted ? 26 : this.zoomies ? 22 : 7 + speed)
    this.gaitPhase += dt * (6 + speed * 1.6)
    this.flopPhase += dt * (4 + speed * 2)

    // Tail wag: always happy, ecstatic during zoomies
    this.tail.rotation.y = Math.sin(this.wagPhase) * 0.7

    // Legs trot in diagonal pairs — unless sledding, then splay like a toboggan
    const stride = Math.min(1, speed / WALK_SPEED)
    if (this.sliding && speed > 2) {
      this.legs[0].rotation.x = -1.0 // front legs thrown forward
      this.legs[1].rotation.x = -1.0
      this.legs[2].rotation.x = 1.2 // back legs tucked
      this.legs[3].rotation.x = 1.2
    } else {
      const amp = grounded ? stride * 0.7 : 0.9
      this.legs[0].rotation.x = Math.sin(this.gaitPhase) * amp
      this.legs[3].rotation.x = Math.sin(this.gaitPhase) * amp
      this.legs[1].rotation.x = Math.sin(this.gaitPhase + Math.PI) * amp
      this.legs[2].rotation.x = Math.sin(this.gaitPhase + Math.PI) * amp
    }

    // Ears flop with movement, head bobs a little
    const flop = Math.sin(this.flopPhase) * 0.12 * (0.3 + stride)
    this.ears[0].rotation.z = -0.5 + flop
    this.ears[1].rotation.z = 0.5 + flop
    this.head.rotation.x = Math.sin(this.flopPhase) * 0.05 * stride
    if (!grounded) this.head.rotation.x = -0.25 // airborne = maximum joy
  }

  /** Vertical scrabble up a trunk: nose up, legs scrambling, tail helicoptering. */
  private syncClimb(dt: number): void {
    const p = this.body.position
    this.mesh.position.set(p.x, p.y - BODY_RADIUS, p.z)
    this.mesh.rotation.y = this.facing
    this.mesh.rotation.x = -1.15 // nose to the sky
    this.mesh.scale.set(1, 1, 1)

    this.gaitPhase += dt * 18
    this.wagPhase += dt * 16
    const amp = 0.85
    this.legs[0].rotation.x = Math.sin(this.gaitPhase) * amp
    this.legs[3].rotation.x = Math.sin(this.gaitPhase) * amp
    this.legs[1].rotation.x = Math.sin(this.gaitPhase + Math.PI) * amp
    this.legs[2].rotation.x = Math.sin(this.gaitPhase + Math.PI) * amp
    this.tail.rotation.y = Math.sin(this.wagPhase) * 0.8
    this.ears[0].rotation.z = -0.85
    this.ears[1].rotation.z = 0.85
    this.head.rotation.x = -0.25 // eyes on the prize
  }

  /** Curled-up cozy pose: settled body, tucked legs, slow tail, breathing. */
  private syncSnuggle(dt: number): void {
    this.snuggleTime += dt
    const t = this.snuggleTime
    const settle = Math.min(1, t * 3) // ease into the pose over ~0.3s

    const p = this.body.position
    this.mesh.position.set(p.x, p.y - BODY_RADIUS - 0.13 * settle, p.z)
    this.mesh.rotation.y = this.facing
    this.mesh.rotation.x = 0

    // Slow, contented breathing
    const breathe = 1 + Math.sin(t * 2.2) * 0.018 * settle
    this.mesh.scale.set(breathe, 1, breathe)

    for (const leg of this.legs) {
      leg.rotation.x += (1.45 - leg.rotation.x) * settle * Math.min(1, 8 * dt) * 4
    }
    this.tail.rotation.y = Math.sin(t * 2) * 0.3 * settle
    this.ears[0].rotation.z = -0.5 - 0.3 * settle
    this.ears[1].rotation.z = 0.5 + 0.3 * settle
    this.head.rotation.x = 0.3 * settle + Math.sin(t * 2.2) * 0.02
  }
}
