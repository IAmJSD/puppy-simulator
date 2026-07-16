// The backyard: scenery, static colliders, and every knockable prop.

import * as THREE from 'three'
import * as CANNON from 'cannon-es'

export const YARD_HALF = 120 // the neighbourhood spans -YARD_HALF..+YARD_HALF on x and z

// Collision filter groups. The camera's occlusion ray only hits GROUP_STATIC,
// so props never yank the camera around and the invisible boundary walls /
// glass triggers never block the view.
export const GROUP_STATIC = 1
export const GROUP_DYNAMIC = 2
export const GROUP_NO_CAMERA = 4

export interface Prop {
  name: string
  points: number
  mesh: THREE.Object3D
  body: CANNON.Body
  scored: boolean
  settleTime: number
}

export interface Pane {
  mesh: THREE.Mesh
  body: CANNON.Body
  broken: boolean
}

export interface SnuggleSpot {
  x: number
  y: number
  z: number
  r: number
  name: string
  // For snuggle spots on movable furniture (beds, couches): track the body,
  // standing surface dy above its center.
  body?: CANNON.Body
  dy?: number
}

export interface Climbable {
  x: number
  z: number
  r: number // trunk radius
  topY: number // height where the climb crests into the canopy
}

export interface WaterZone {
  x: number
  z: number
  r: number
  innerR?: number // for ring-shaped water (lazy river)
  name: string
}

export interface WaterJet {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  spread: number // random velocity jitter
  rate: number // droplets per second
}

export interface DynamicDecor {
  mesh: THREE.Object3D
  body: CANNON.Body
}

export interface SwingDoor {
  body: CANNON.Body
  restYaw: number // closed orientation; a soft spring returns the door here
}

export interface GameWorld {
  scene: THREE.Scene
  world: CANNON.World
  props: Prop[]
  panes: Pane[]
  snuggleSpots: SnuggleSpot[]
  climbables: Climbable[]
  waterZones: WaterZone[]
  waterJets: WaterJet[]
  dynamicDecor: DynamicDecor[]
  treatBags: DynamicDecor[]
  doors: SwingDoor[]
  puppyMaterial: CANNON.Material
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color })

export function createWorld(): GameWorld {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x8fd3f0)
  scene.fog = new THREE.Fog(0x8fd3f0, 120, 330)

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) })
  // NaiveBroadphase, deliberately: cannon-es SAPBroadphase silently drops
  // collision pairs (bodies sink through floors, walls go ghost) and its
  // aabbQuery breaks raycasts. Naive is O(n²) but exact, and trivially fast
  // at this body count.
  world.broadphase = new CANNON.NaiveBroadphase()
  world.allowSleep = true

  const groundMaterial = new CANNON.Material('ground')
  const puppyMaterial = new CANNON.Material('puppy')
  const propMaterial = new CANNON.Material('prop')
  const bouncyMaterial = new CANNON.Material('bouncy')
  world.defaultContactMaterial.friction = 0.4
  world.defaultContactMaterial.restitution = 0.1
  // Frictionless: the puppy is velocity-controlled, and contact friction
  // fights the controller (it caps flat speed and glues the puppy to ramps).
  world.addContactMaterial(
    new CANNON.ContactMaterial(puppyMaterial, groundMaterial, { friction: 0, restitution: 0 }),
  )
  world.addContactMaterial(
    new CANNON.ContactMaterial(propMaterial, groundMaterial, { friction: 0.5, restitution: 0.15 }),
  )
  world.addContactMaterial(
    new CANNON.ContactMaterial(bouncyMaterial, groundMaterial, { friction: 0.3, restitution: 0.75 }),
  )

  const waterZones: WaterZone[] = []
  const waterJets: WaterJet[] = []
  const dynamicDecor: DynamicDecor[] = []
  const doors: SwingDoor[] = []
  const climbables: Climbable[] = []
  const snuggleSpots: SnuggleSpot[] = [
    { x: 17, y: 0.35, z: -16, r: 0.85, name: 'KENNEL' },
    { x: -7.5, y: 3.75, z: -21.5, r: 0.9, name: 'BLANKETS' },
  ]

  setupLights(scene)
  setupGround(scene, world, groundMaterial)
  setupFence(scene, world)
  setupScenery(scene, world, climbables)
  setupFountains(scene, world, waterZones, waterJets)
  setupPlayground(scene, world, dynamicDecor)
  setupWaterPark(scene, world, waterZones, waterJets)
  setupPond(scene, world, waterZones)
  setupSoccerField(scene, world)

  const props: Prop[] = []
  const panes: Pane[] = []
  const add = (
    name: string,
    points: number,
    mesh: THREE.Object3D,
    body: CANNON.Body,
    x: number,
    y: number,
    z: number,
    rotY = 0,
  ) => {
    body.position.set(x, y, z)
    body.quaternion.setFromEuler(0, rotY, 0)
    if (!body.material) body.material = propMaterial
    body.collisionFilterGroup = GROUP_DYNAMIC
    body.sleepSpeedLimit = 0.4
    body.sleepTimeLimit = 0.8
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    scene.add(mesh)
    world.addBody(body)
    props.push({ name, points, mesh, body, scored: false, settleTime: 0 })
  }

  setupMansion(scene, world, add, panes, dynamicDecor, doors, snuggleSpots)
  setupNeighbourhood(scene, world, add, panes, dynamicDecor, doors, snuggleSpots)

  // Pond ducks + soccer balls for the new south side
  for (const [x, z] of [
    [-72, 93],
    [-67, 97],
    [-74, 99],
  ] as const) {
    const duck = makeDuck()
    add('RUBBER DUCK', 50, duck.mesh, duck.body, x, 0.3, z, Math.random() * 6)
  }
  for (const [x, z] of [
    [62, 95],
    [68, 96],
  ] as const) {
    const { mesh, body } = makeBall()
    body.material = bouncyMaterial
    add('BALL', 15, mesh, body, x, 0.4, z)
  }

  // --- Trash cans ---
  for (const [x, z] of [
    [-16, -14],
    [-14.6, -14.4],
    [-15.2, -12.6],
  ] as const) {
    const { mesh, body } = makeTrashCan()
    add('TRASH CAN', 25, mesh, body, x, 0.55, z, Math.random() * Math.PI)
  }

  // --- Flower pots along the fence ---
  for (let i = 0; i < 6; i++) {
    const { mesh, body } = makeFlowerPot(i % 3)
    add('FLOWER POT', 10, mesh, body, -18 + i * 2.2, 0.25, YARD_HALF - 3.5)
  }

  // --- Garden gnomes ---
  for (const [x, z, r] of [
    [6, 6, 2.4],
    [8, 4.5, -0.8],
    [4.5, 8, 1.2],
    [-6, 12, 0.3],
  ] as const) {
    const { mesh, body } = makeGnome()
    add('GNOME', 50, mesh, body, x, 0.45, z, r)
  }

  // --- Lawn flamingos ---
  for (const [x, z, r] of [
    [12, -8, 0.5],
    [13.5, -6.5, -1.1],
    [11, -5.5, 2.0],
  ] as const) {
    const { mesh, body } = makeFlamingo()
    add('FLAMINGO', 45, mesh, body, x, 0.55, z, r)
  }

  // --- Crate pyramid ---
  const crateSpots: Array<[number, number, number]> = [
    [-8, 0.3, -8],
    [-7.3, 0.3, -8],
    [-6.6, 0.3, -8],
    [-7.65, 0.95, -8],
    [-6.95, 0.95, -8],
    [-7.3, 1.6, -8],
  ]
  for (const [x, y, z] of crateSpots) {
    const { mesh, body } = makeCrate()
    add('CRATE', 10, mesh, body, x, y, z)
  }

  // --- Garden table with teacups ---
  {
    const { mesh, body } = makeTable()
    add('TABLE', 30, mesh, body, 14, 0.5, 10)
    for (const [dx, dz] of [
      [-0.5, -0.3],
      [0.4, 0.2],
      [0, 0.45],
    ] as const) {
      const cup = makeTeacup()
      add('TEACUP', 20, cup.mesh, cup.body, 14 + dx, 1.13, 10 + dz)
    }
  }

  // --- Bird bath ---
  {
    const { mesh, body } = makeBirdBath()
    add('BIRD BATH', 40, mesh, body, -12, 0.65, 8)
  }

  // --- Mailbox (beside the mansion path) ---
  {
    const { mesh, body } = makeMailbox()
    add('MAILBOX', 35, mesh, body, 4.5, 0.75, -14, 0.2)
  }

  // --- Bird nest at the top of the climbable tree ---
  {
    const { mesh, body } = makeNest()
    add('BIRD NEST', 70, mesh, body, -16, 7.05, -4)
  }

  // --- Soccer balls ---
  for (const [x, z] of [
    [3, -5],
    [-3, 8],
  ] as const) {
    const { mesh, body } = makeBall()
    body.material = bouncyMaterial
    add('BALL', 15, mesh, body, x, 0.4, z)
  }

  // --- Neighbourhood props ---
  for (const [x, z, r] of [
    [-8, 19.2, 0.3],
    [30, 19.2, -0.4],
  ] as const) {
    const { mesh, body } = makeHydrant()
    add('FIRE HYDRANT', 40, mesh, body, x, 0.36, z, r)
  }
  for (const [x, z, r] of [
    [-6.5, 24, 0.35],
    [6.5, 24, -0.35],
  ] as const) {
    const { mesh, body } = makeBench()
    add('BENCH', 30, mesh, body, x, 0.45, z, r)
  }
  // Water-park resort props: deck chairs, extra toys for the new pools
  for (const [x, z, r] of [
    [32, 24.5, 0.4],
    [67, 26.3, -0.9],
    [63.5, 39.7, 2.3], // island lounging
  ] as const) {
    const chair = makeDeckChair()
    add('DECK CHAIR', 25, chair.mesh, chair.body, x, 0.25, z, r)
  }
  {
    const beach2 = makeBall()
    beach2.body.material = bouncyMaterial
    ;(beach2.mesh as THREE.Mesh & { material: THREE.MeshLambertMaterial }).material =
      new THREE.MeshLambertMaterial({ color: 0xf2b134 })
    add("BEACH BALL", 15, beach2.mesh, beach2.body, 68, 0.5, 22.5)
    const duck2 = makeDuck()
    add("RUBBER DUCK", 50, duck2.mesh, duck2.body, 53, 0.35, 37.5)
  }

  // Yuzu oranges for the pool capybara — it's an onsen thing
  for (const [x, z] of [
    [37.8, 32.2],
    [39.3, 30.6],
  ] as const) {
    const yuzu = makeYuzu()
    add('YUZU ORANGE', 20, yuzu.mesh, yuzu.body, x, 0.35, z)
  }
  {
    const duck = makeDuck()
    add('RUBBER DUCK', 50, duck.mesh, duck.body, 37, 0.35, 30.5)
    const beach = makeBall()
    beach.body.material = bouncyMaterial
    ;(beach.mesh as THREE.Mesh & { material: THREE.MeshLambertMaterial }).material =
      new THREE.MeshLambertMaterial({ color: 0xf2789f })
    add('BEACH BALL', 15, beach.mesh, beach.body, 34.5, 0.5, 29)
  }

  // Every static body shares groundMaterial so the puppy's zero-friction
  // pairing (and the props' 0.5-friction pairing) applies to walls, ramps,
  // floors, and scenery — not just the ground plane. Unassigned statics
  // would otherwise fall back to the default 0.4-friction contact, which
  // grips the velocity-driven puppy and stalls it on slopes.
  for (const body of world.bodies) {
    if (body.mass === 0 && !body.isTrigger && !body.material) {
      body.material = groundMaterial
    }
  }

  // Huge bags of puppy treats — burst them open for the kibble inside
  const treatBags: DynamicDecor[] = []
  for (const [x, z, r] of [
    [7.5, -26.6, 0.4], // mansion pantry corner
    [-30, 33, -0.3], // playground snack stash
    [8, 22.5, 0.9], // plaza, beside the bench
  ] as const) {
    const bag = makeTreatBag()
    bag.body.position.set(x, 0.56, z)
    bag.body.quaternion.setFromEuler(0, r, 0)
    bag.body.collisionFilterGroup = GROUP_DYNAMIC
    scene.add(bag.mesh)
    world.addBody(bag.body)
    dynamicDecor.push(bag)
    treatBags.push(bag)
  }

  return {
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
  }
}

// ---------------------------------------------------------------- scenery

function setupLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5d8a4a, 1.05))
  const sun = new THREE.DirectionalLight(0xfff2d0, 1.6)
  sun.position.set(55, 90, 38)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.bias = -0.0001
  sun.shadow.normalBias = 0.04 // kills acne banding on the big flat mansion walls
  sun.shadow.camera.left = -130
  sun.shadow.camera.right = 130
  sun.shadow.camera.top = 130
  sun.shadow.camera.bottom = -130
  sun.shadow.camera.far = 320
  scene.add(sun)
}

function setupGround(scene: THREE.Scene, world: CANNON.World, mat: CANNON.Material): void {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), lambert(0x6aa84f))
  grass.rotation.x = -Math.PI / 2
  grass.receiveShadow = true
  scene.add(grass)

  // Lighter grass patches for texture (instanced — there are hundreds now)
  const patchGeo = new THREE.CircleGeometry(1.5, 8)
  patchGeo.rotateX(-Math.PI / 2)
  const patchMat = lambert(0x7bb85c)
  const PATCHES = 260
  const patches = new THREE.InstancedMesh(patchGeo, patchMat, PATCHES)
  const helper = new THREE.Object3D()
  for (let i = 0; i < PATCHES; i++) {
    helper.position.set(
      (((i * 7919) % 1000) / 1000 - 0.5) * 2 * (YARD_HALF - 2),
      0.01,
      (((i * 104729) % 1000) / 1000 - 0.5) * 2 * (YARD_HALF - 2),
    )
    const s = 0.5 + ((i * 31) % 10) / 10
    helper.scale.set(s, 1, s)
    helper.updateMatrix()
    patches.setMatrixAt(i, helper.matrix)
  }
  scene.add(patches)

  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: mat })
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
  world.addBody(ground)
}

function setupFence(scene: THREE.Scene, world: CANNON.World): void {
  const wood = lambert(0xa9825d)
  const post = new THREE.BoxGeometry(0.14, 1.1, 0.14)
  const rail = new THREE.BoxGeometry(2.02, 0.14, 0.06)

  // Instanced: at neighbourhood scale this is hundreds of posts/rails, far
  // too many as individual meshes.
  const sides: Array<[boolean, number]> = [
    [true, YARD_HALF],
    [true, -YARD_HALF],
    [false, YARD_HALF],
    [false, -YARD_HALF],
  ]
  const postMatrices: THREE.Matrix4[] = []
  const railMatrices: THREE.Matrix4[] = []
  const helper = new THREE.Object3D()
  for (const [alongX, edge] of sides) {
    for (let i = -YARD_HALF; i <= YARD_HALF; i += 2) {
      helper.position.set(alongX ? i : edge, 0.55, alongX ? edge : i)
      helper.rotation.set(0, 0, 0)
      helper.updateMatrix()
      postMatrices.push(helper.matrix.clone())
      if (i < YARD_HALF) {
        for (const y of [0.35, 0.8]) {
          helper.position.set(
            alongX ? i + 1 : edge,
            y,
            alongX ? edge : i + 1,
          )
          helper.rotation.set(0, alongX ? 0 : Math.PI / 2, 0)
          helper.updateMatrix()
          railMatrices.push(helper.matrix.clone())
        }
      }
    }
  }
  const posts = new THREE.InstancedMesh(post, wood, postMatrices.length)
  postMatrices.forEach((mt, i) => posts.setMatrixAt(i, mt))
  posts.castShadow = true
  scene.add(posts)
  const rails = new THREE.InstancedMesh(rail, wood, railMatrices.length)
  railMatrices.forEach((mt, i) => rails.setMatrixAt(i, mt))
  rails.castShadow = true
  scene.add(rails)

  // Invisible walls so nothing escapes the yard
  const wallShape = new CANNON.Box(new CANNON.Vec3(YARD_HALF + 1, 3, 0.5))
  for (const [x, z, rot] of [
    [0, YARD_HALF + 0.5, 0],
    [0, -YARD_HALF - 0.5, 0],
    [YARD_HALF + 0.5, 0, Math.PI / 2],
    [-YARD_HALF - 0.5, 0, Math.PI / 2],
  ] as const) {
    const wall = new CANNON.Body({ mass: 0, shape: wallShape })
    wall.collisionFilterGroup = GROUP_NO_CAMERA
    wall.position.set(x, 3, z)
    wall.quaternion.setFromEuler(0, rot, 0)
    world.addBody(wall)
  }
}

/**
 * A big climbable tree: branch steps spiral up the trunk to a stand-on canopy
 * platform, and the trunk itself can be scrambled up. All colliders live on
 * one compound GROUP_NO_CAMERA body (no camera stutter, one broadphase entry).
 */
function buildTree(
  scene: THREE.Scene,
  world: CANNON.World,
  climbables: Climbable[],
  x: number,
  z: number,
): void {
  const tree = new THREE.Group()
  const barkMat = lambert(0x7a5230)
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 5, 8), barkMat)
  trunk.position.y = 2.5
  trunk.castShadow = true
  tree.add(trunk)
  for (const [dx, dy, dz, s] of [
    [0, 5.6, 0, 1.5],
    [1.2, 5.2, 0.4, 1.2],
    [-1.0, 5.3, -0.5, 1.1],
    [0.2, 5.1, 1.1, 1.0],
    [-0.3, 5.2, -1.2, 1.0],
  ] as const) {
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), lambert(0x4e8c3a))
    leaves.position.set(dx, dy, dz)
    leaves.castShadow = true
    tree.add(leaves)
  }

  const body = new CANNON.Body({ mass: 0 })
  body.collisionFilterGroup = GROUP_NO_CAMERA
  body.position.set(x, 0, z)

  // Branch steps: ~0.9m vertical hops, spiraling 75° around the trunk
  const branchGeo = new THREE.BoxGeometry(1.4, 0.16, 0.55)
  const branchTops = [1.0, 1.9, 2.8, 3.7, 4.6, 5.5]
  branchTops.forEach((top, i) => {
    const a = THREE.MathUtils.degToRad(i * 75)
    const bx = Math.cos(a) * 1.05
    const bz = Math.sin(a) * 1.05
    const branch = new THREE.Mesh(branchGeo, barkMat)
    branch.position.set(bx, top - 0.08, bz)
    branch.rotation.y = -a
    branch.castShadow = true
    tree.add(branch)
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), lambert(0x5d9c45))
    tuft.position.set(Math.cos(a) * 1.8, top + 0.1, Math.sin(a) * 1.8)
    tree.add(tuft)
    const q = new CANNON.Quaternion()
    q.setFromEuler(0, -a, 0)
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(0.7, 0.08, 0.275)),
      new CANNON.Vec3(bx, top - 0.08, bz),
      q,
    )
  })

  body.addShape(new CANNON.Cylinder(0.4, 0.6, 5, 8), new CANNON.Vec3(0, 2.5, 0))
  // Invisible platform sunk into the canopy — stand on top of the tree
  body.addShape(new CANNON.Cylinder(1.3, 1.3, 0.3, 10), new CANNON.Vec3(0, 6.75, 0))
  world.addBody(body)

  tree.position.set(x, 0, z)
  scene.add(tree)
  climbables.push({ x, z, r: 0.5, topY: 6.0 })
}

function setupScenery(scene: THREE.Scene, world: CANNON.World, climbables: Climbable[]): void {
  // Trees all over the neighbourhood — every one climbable
  for (const [tx, tz] of [
    [-16, -4],
    [-40, -18],
    [55, -8],
    [-85, 45],
    [90, 42],
    [-30, 95],
    [30, 100],
  ] as const) {
    buildTree(scene, world, climbables, tx, tz)
  }

  // Dog house — home base, hollow so the puppy can snuggle inside
  const HOUSE_ROT = -0.6
  const house = new THREE.Group()
  const red = lambert(0xb0503c)
  const houseFloor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 2.1), lambert(0x7a5230))
  houseFloor.position.y = 0.05
  house.add(houseFloor)
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.3, 2.1), red)
    wall.position.set(0.9 * side, 0.7, 0)
    wall.castShadow = true
    house.add(wall)
  }
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 0.15), red)
  backWall.position.set(0, 0.7, -1.0)
  backWall.castShadow = true
  house.add(backWall)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1, 4), lambert(0x6e3327))
  roof.position.y = 1.85
  roof.rotation.y = Math.PI / 4
  roof.castShadow = true
  house.add(roof)
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.14, 12), lambert(0xc95f6e))
  cushion.position.set(0, 0.17, -0.15)
  house.add(cushion)
  house.position.set(17, 0, -16)
  house.rotation.y = HOUSE_ROT
  scene.add(house)
  // Colliders: sides, back, and a roof slab — front stays open to walk in
  const houseParts: Array<[CANNON.Vec3, CANNON.Vec3]> = [
    // [half extents, local position]
    [new CANNON.Vec3(0.075, 0.65, 1.05), new CANNON.Vec3(0.9, 0.7, 0)],
    [new CANNON.Vec3(0.075, 0.65, 1.05), new CANNON.Vec3(-0.9, 0.7, 0)],
    [new CANNON.Vec3(0.9, 0.65, 0.075), new CANNON.Vec3(0, 0.7, -1.0)],
    [new CANNON.Vec3(1.05, 0.1, 1.15), new CANNON.Vec3(0, 1.45, 0)],
  ]
  const cosR = Math.cos(HOUSE_ROT)
  const sinR = Math.sin(HOUSE_ROT)
  for (const [half, local] of houseParts) {
    const part = new CANNON.Body({ mass: 0, shape: new CANNON.Box(half) })
    part.position.set(17 + local.x * cosR + local.z * sinR, local.y, -16 - local.x * sinR + local.z * cosR)
    part.quaternion.setFromEuler(0, HOUSE_ROT, 0)
    world.addBody(part)
  }
}

// ---------------------------------------------------------------- neighbourhood

const waterMat = new THREE.MeshLambertMaterial({ color: 0x58b7e3, transparent: true, opacity: 0.65 })

function staticBox(
  world: CANNON.World,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): CANNON.Body {
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) })
  body.position.set(x, y, z)
  body.quaternion.setFromEuler(0, rotY, 0)
  world.addBody(body)
  return body
}

function setupPond(scene: THREE.Scene, world: CANNON.World, zones: WaterZone[]): void {
  const cx = -70
  const cz = 95
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(10, 24), lambert(0x35708f))
  bottom.rotation.x = -Math.PI / 2
  bottom.position.set(cx, 0.02, cz)
  bottom.scale.set(1.3, 1, 1)
  scene.add(bottom)
  const surface = new THREE.Mesh(new THREE.CircleGeometry(9.7, 24), waterMat)
  surface.rotation.x = -Math.PI / 2
  surface.position.set(cx, 0.12, cz)
  surface.scale.set(1.3, 1, 1)
  scene.add(surface)
  zones.push({ x: cx, z: cz, r: 9.5, name: 'POND' })

  // Lily pads, reeds, and a few rocks (one compound body)
  const padMat = lambert(0x4e8c3a)
  for (let i = 0; i < 7; i++) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.35 + (i % 3) * 0.12, 8), padMat)
    pad.rotation.x = -Math.PI / 2
    const a = i * 0.9
    pad.position.set(cx + Math.cos(a) * (3 + i * 0.8), 0.14, cz + Math.sin(a) * (2 + i * 0.5))
    scene.add(pad)
  }
  const reedMat = lambert(0x5d9c45)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.9 + (i % 3) * 0.3, 5), reedMat)
    reed.position.set(cx + Math.cos(a) * 12.6, 0.5, cz + Math.sin(a) * 9.9)
    reed.rotation.z = ((i % 5) - 2) * 0.06
    scene.add(reed)
  }
  const rocks = new CANNON.Body({ mass: 0 })
  for (const [rx, rz, s] of [
    [cx - 12, cz - 8, 0.8],
    [cx + 12.5, cz + 7, 0.6],
    [cx + 10, cz - 9, 0.7],
  ] as const) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), lambert(0x9a958c))
    rock.position.set(rx, s * 0.5, rz)
    rock.castShadow = true
    scene.add(rock)
    rocks.addShape(new CANNON.Sphere(s * 0.8), new CANNON.Vec3(rx, s * 0.4, rz))
  }
  world.addBody(rocks)
}

function setupSoccerField(scene: THREE.Scene, world: CANNON.World): void {
  const cx = 65
  const cz = 95
  const W = 30
  const D = 18
  const lineMat = lambert(0xf0f0ea)
  const lines: Array<[number, number, number, number]> = [
    // [w, d, x, z]
    [W, 0.25, cx, cz - D / 2],
    [W, 0.25, cx, cz + D / 2],
    [0.25, D, cx - W / 2, cz],
    [0.25, D, cx + W / 2, cz],
    [0.25, D, cx, cz],
  ]
  for (const [w, d, x, z] of lines) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), lineMat)
    line.position.set(x, 0.02, z)
    scene.add(line)
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.8, 3.05, 24), lineMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.set(cx, 0.025, cz)
  scene.add(ring)

  // Goals: posts + crossbar, one compound body each
  const postMat = lambert(0xfafafa)
  for (const side of [-1, 1]) {
    const gx = cx + side * (W / 2)
    const goal = new CANNON.Body({ mass: 0 })
    for (const dz of [-3, 3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 8), postMat)
      post.position.set(gx, 1.1, cz + dz)
      post.castShadow = true
      scene.add(post)
      goal.addShape(new CANNON.Cylinder(0.07, 0.07, 2.2, 6), new CANNON.Vec3(gx, 1.1, cz + dz))
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.14, 8), postMat)
    bar.rotation.x = Math.PI / 2
    bar.position.set(gx, 2.2, cz)
    bar.castShadow = true
    scene.add(bar)
    const q = new CANNON.Quaternion()
    q.setFromEuler(Math.PI / 2, 0, 0)
    goal.addShape(new CANNON.Cylinder(0.07, 0.07, 6.14, 6), new CANNON.Vec3(gx, 2.2, cz), q)
    world.addBody(goal)
  }
}

/**
 * A door on a vertical hinge — the puppy nuzzles it open by pushing into it.
 * hingeX/hingeZ is the hinge edge; the door extends w along the wall's local
 * +x direction (matching a THREE rotation.y of rotY).
 */
function addSwingDoor(
  scene: THREE.Scene,
  world: CANNON.World,
  decor: DynamicDecor[],
  doors: SwingDoor[],
  hingeX: number,
  hingeZ: number,
  rotY: number,
  w: number,
  h: number,
  color: number,
  baseY = 0, // bottom of the doorway (e.g. porch height for the mansion)
): void {
  // Hung slightly off the floor: a door resting ON the floor drags with
  // friction and swings badly.
  const hangY = baseY + h / 2 + 0.04
  const anchor = new CANNON.Body({ mass: 0 })
  anchor.position.set(hingeX, hangY, hingeZ)
  world.addBody(anchor)

  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  const door = new CANNON.Body({
    mass: 4,
    shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, 0.04)),
  })
  door.collisionFilterGroup = GROUP_DYNAMIC
  door.position.set(hingeX + (w / 2) * cos, hangY, hingeZ - (w / 2) * sin)
  door.quaternion.setFromEuler(0, rotY, 0)
  door.angularDamping = 0.6
  door.linearDamping = 0.3
  world.addBody(door)
  world.addConstraint(
    new CANNON.HingeConstraint(anchor, door, {
      pivotA: new CANNON.Vec3(0, 0, 0),
      axisA: new CANNON.Vec3(0, 1, 0),
      pivotB: new CANNON.Vec3(-w / 2, 0, 0),
      axisB: new CANNON.Vec3(0, 1, 0),
    }),
  )

  const g = new THREE.Group()
  // Visual panel is slightly LARGER than the physics box: the body needs
  // clearance to swing without scraping the frame, but the visible door
  // should fill the opening with no gaps.
  const panel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.09, h + 0.08, 0.08), lambert(color))
  panel.position.y = 0.04
  panel.castShadow = true
  g.add(panel)
  for (const side of [-1, 1]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), lambert(0xd9b44a))
    knob.position.set(w / 2 - 0.14, 0, side * 0.07)
    g.add(knob)
  }
  scene.add(g)
  decor.push({ mesh: g, body: door })
  doors.push({ body: door, restYaw: rotY })
}

const ART_PALETTE = [0xd7263d, 0xf2b134, 0x3a6ea5, 0x5d9c45, 0xb086e0, 0xe8762c, 0x2b2b31]

/** Framed abstract art hung on a wall — pure decoration, procedurally varied. */
function buildArtwork(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  rotY: number,
  seed: number,
): void {
  const g = new THREE.Group()
  const w = 0.8 + ((seed * 37) % 5) * 0.09
  const h = 0.6 + ((seed * 23) % 4) * 0.09
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.05), lambert(0x4a2e1c))
  g.add(frame)
  const canvas = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), lambert(0xf0ece2))
  g.add(canvas)
  const shapes = 2 + (seed % 3)
  for (let i = 0; i < shapes; i++) {
    const color = ART_PALETTE[(seed * 7 + i * 3) % ART_PALETTE.length]
    const round = (seed + i) % 2 === 0
    const s = 0.1 + ((seed * 11 + i * 5) % 4) * 0.05
    const shape = round
      ? new THREE.Mesh(new THREE.CylinderGeometry(s, s, 0.02, 12), lambert(color))
      : new THREE.Mesh(new THREE.BoxGeometry(s * 2, s * 1.4, 0.02), lambert(color))
    if (round) shape.rotation.x = Math.PI / 2
    shape.position.set(
      (((seed * 13 + i * 17) % 10) / 10 - 0.5) * (w - 0.3),
      (((seed * 19 + i * 29) % 10) / 10 - 0.5) * (h - 0.25),
      0.04 + i * 0.005,
    )
    shape.rotation.z = (((seed + i * 3) % 6) - 3) * 0.15
    g.add(shape)
  }
  g.position.set(x, y, z)
  g.rotation.y = rotY
  parent.add(g)
}

function makeTVStand(): MeshBody {
  const g = new THREE.Group()
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.42, 0.38), lambert(0x8a6a3d))
  g.add(cabinet)
  const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.03), lambert(0x6e4a2e))
  doorL.position.set(-0.28, 0, 0.2)
  g.add(doorL)
  const doorR = doorL.clone()
  doorR.position.x = 0.28
  g.add(doorR)
  const body = new CANNON.Body({ mass: 10, shape: new CANNON.Box(new CANNON.Vec3(0.6, 0.24, 0.2)) })
  return { mesh: g, body }
}

function makeTV(channelColor: number): MeshBody {
  const g = new THREE.Group()
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.58, 0.07), lambert(0x1a1a1f))
  g.add(bezel)
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.48, 0.02),
    new THREE.MeshBasicMaterial({ color: channelColor }),
  )
  screen.position.z = 0.035
  g.add(screen)
  const detail = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.12, 0.015),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  )
  detail.position.set(0.18, 0.1, 0.05)
  g.add(detail)
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), lambert(0x1a1a1f))
  neck.position.y = -0.34
  g.add(neck)
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.22), lambert(0x1a1a1f))
  foot.position.y = -0.4
  g.add(foot)
  const body = new CANNON.Body({ mass: 5, shape: new CANNON.Box(new CANNON.Vec3(0.48, 0.42, 0.12)) })
  return { mesh: g, body }
}

function makeConsole(): MeshBody {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.24), lambert(0x2b2b31))
  g.add(box)
  const light = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.02, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }),
  )
  light.position.set(0.14, 0.02, 0)
  g.add(light)
  const body = new CANNON.Body({ mass: 0.8, shape: new CANNON.Box(new CANNON.Vec3(0.17, 0.05, 0.12)) })
  return { mesh: g, body }
}

function makeController(): MeshBody {
  const g = new THREE.Group()
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.11), lambert(0x3d3d3d))
  g.add(pad)
  for (const sx of [-0.04, 0.04]) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), lambert(0x1a1a1f))
    stick.position.set(sx, 0.035, 0)
    g.add(stick)
  }
  const body = new CANNON.Body({ mass: 0.3, shape: new CANNON.Box(new CANNON.Vec3(0.09, 0.03, 0.06)) })
  return { mesh: g, body }
}

function makeEasel(): MeshBody {
  const g = new THREE.Group()
  const legMat = lambert(0x8a6a3d)
  for (const [lx, tilt] of [
    [-0.3, 0.12],
    [0.3, -0.12],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), legMat)
    leg.position.set(lx, 0, -0.02)
    leg.rotation.z = tilt
    g.add(leg)
  }
  const backLeg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.45, 0.06), legMat)
  backLeg.position.set(0, 0, -0.25)
  backLeg.rotation.x = -0.3
  g.add(backLeg)
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.1), legMat)
  tray.position.set(0, -0.25, 0.06)
  g.add(tray)
  const canvasGroup = new THREE.Group()
  buildArtwork(canvasGroup, 0, 0, 0, 0, 5)
  canvasGroup.scale.setScalar(1.15)
  canvasGroup.position.set(0, 0.18, 0.08)
  canvasGroup.rotation.x = -0.1
  g.add(canvasGroup)
  const body = new CANNON.Body({ mass: 3, shape: new CANNON.Box(new CANNON.Vec3(0.4, 0.75, 0.25)) })
  return { mesh: g, body }
}

function makeBed(): MeshBody {
  const g = new THREE.Group()
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 1.1), lambert(0x8a6a3d))
  frame.position.y = -0.15
  g.add(frame)
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.24, 1.02), lambert(0xf0ece2))
  mattress.position.y = 0.12
  g.add(mattress)
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 1.1), lambert(0x8a6a3d))
  headboard.position.set(-0.9, 0.2, 0)
  g.add(headboard)
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.8), lambert(0xffffff))
  pillow.position.set(-0.6, 0.29, 0)
  g.add(pillow)
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 1.04), lambert(0xc95f6e))
  blanket.position.set(0.35, 0.27, 0)
  g.add(blanket)
  const body = new CANNON.Body({ mass: 18, shape: new CANNON.Box(new CANNON.Vec3(0.95, 0.3, 0.55)) })
  return { mesh: g, body }
}

function makeCouch(color: number): MeshBody {
  const g = new THREE.Group()
  const fabric = lambert(color)
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.8), fabric)
  g.add(base)
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 0.22), fabric)
  back.position.set(0, 0.42, -0.29)
  g.add(back)
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.8), fabric)
    arm.position.set(side * 0.79, 0.3, 0)
    g.add(arm)
  }
  const cushionSeam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.6), lambert(0x00000))
  cushionSeam.position.set(0, 0.21, 0.05)
  g.add(cushionSeam)
  const body = new CANNON.Body({ mass: 16 })
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.42, 0.4)), new CANNON.Vec3(0, 0.22, 0))
  return { mesh: g, body }
}

const houseGlassMat = new THREE.MeshPhongMaterial({
  color: 0x9fd4ee,
  transparent: true,
  opacity: 0.35,
  shininess: 90,
  specular: 0xffffff,
  side: THREE.DoubleSide,
})

function setupNeighbourhood(
  scene: THREE.Scene,
  world: CANNON.World,
  add: AddProp,
  panes: Pane[],
  decor: DynamicDecor[],
  doors: SwingDoor[],
  snuggleSpots: SnuggleSpot[],
): void {
  const g = new THREE.Group()

  // Street grid: two east-west avenues plus two north-south connectors
  const asphaltMat = lambert(0x4a4a50)
  const dashGeo = new THREE.BoxGeometry(1.6, 0.05, 0.22)
  const dashMat = lambert(0xe8e4d8)
  for (const z of [15, 70]) {
    const asphalt = new THREE.Mesh(new THREE.BoxGeometry(2 * YARD_HALF, 0.04, 6), asphaltMat)
    asphalt.position.set(0, 0.02, z)
    asphalt.receiveShadow = true
    g.add(asphalt)
    for (let x = -YARD_HALF + 4; x < YARD_HALF; x += 6) {
      const dash = new THREE.Mesh(dashGeo, dashMat)
      dash.position.set(x, 0.03, z)
      g.add(dash)
    }
  }
  for (const x of [20, -60]) {
    const asphalt = new THREE.Mesh(new THREE.BoxGeometry(6, 0.04, 49), asphaltMat)
    asphalt.position.set(x, 0.02, 42.5)
    asphalt.receiveShadow = true
    g.add(asphalt)
    for (let z = 22; z < 66; z += 6) {
      const dash = new THREE.Mesh(dashGeo, dashMat)
      dash.rotation.y = Math.PI / 2
      dash.position.set(x, 0.03, z)
      g.add(dash)
    }
  }
  for (const z of [11, 19]) {
    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(2 * YARD_HALF, 0.05, 2), lambert(0xb8b4a8))
    sidewalk.position.set(0, 0.025, z)
    sidewalk.receiveShadow = true
    g.add(sidewalk)
  }

  // Enterable neighbour houses: hollow, with a hinged front door and two
  // breakable front windows each. Front face is local +z.
  const houses: Array<[number, number, number, number]> = [
    // [x, z, rotY, wall color]
    [-46, 4, Math.PI / 2, 0xd9b38c],
    [46, 4, -Math.PI / 2, 0x9cbf9c],
    [-16, 26, Math.PI, 0xc9a0a0],
    [16, 26, Math.PI, 0x9fb3cf],
    // Second avenue, north side (facing south toward the street)
    [-80, 62, 0, 0xd9c48c],
    [-38, 62, 0, 0xa8c9c0],
    [48, 62, 0, 0xcfa8cf],
    [80, 62, 0, 0xb3cf9f],
    // Second avenue, south side (facing north)
    [-88, 78, Math.PI, 0x9cbf9c],
    [-30, 78, Math.PI, 0x9fb3cf],
    [38, 78, Math.PI, 0xd9b38c],
    [72, 78, Math.PI, 0xc9a0a0],
    // A lone house down the west connector
    [-70, 40, -Math.PI / 2, 0xd9c48c],
  ]
  const halfDiag = Math.SQRT1_2
  const white = lambert(0xfafafa)
  houses.forEach(([hx, hz, rot, color], idx) => {
    const house = new THREE.Group()
    const wallMat = lambert(color)
    const cosR = Math.cos(rot)
    const sinR = Math.sin(rot)
    const worldOf = (lx: number, lz: number): { x: number; z: number } => ({
      x: hx + lx * cosR + lz * sinR,
      z: hz - lx * sinR + lz * cosR,
    })
    // All wall colliders live on ONE compound body per house — at 13 houses
    // the broadphase cost of per-piece bodies adds up.
    const houseBody = new CANNON.Body({ mass: 0 })
    houseBody.position.set(hx, 0, hz)
    houseBody.quaternion.setFromEuler(0, rot, 0)
    const piece = (w: number, h: number, d: number, lx: number, ly: number, lz: number): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
      mesh.position.set(lx, ly, lz)
      mesh.castShadow = true
      mesh.receiveShadow = true
      house.add(mesh)
      houseBody.addShape(
        new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
        new CANNON.Vec3(lx, ly, lz),
      )
    }

    // Front wall (z 2.7..3.0): door x [-0.8, 0.8] y 0..2.2 (wide enough to
    // shove the bed through), windows 1.4 wide at ±2.4, y 1.3..2.5
    piece(8, 1.5, 0.3, 0, 3.25, 2.85) // above openings
    piece(0.9, 0.3, 0.3, -3.55, 2.35, 2.85)
    piece(3.4, 0.3, 0.3, 0, 2.35, 2.85)
    piece(0.9, 0.3, 0.3, 3.55, 2.35, 2.85)
    piece(0.9, 2.2, 0.3, -3.55, 1.1, 2.85)
    piece(0.9, 2.2, 0.3, -1.25, 1.1, 2.85)
    piece(0.9, 2.2, 0.3, 1.25, 1.1, 2.85)
    piece(0.9, 2.2, 0.3, 3.55, 1.1, 2.85)
    piece(1.4, 1.3, 0.3, -2.4, 0.65, 2.85) // under windows
    piece(1.4, 1.3, 0.3, 2.4, 0.65, 2.85)
    // Back and side walls
    piece(8, 4, 0.3, 0, 2, -2.85)
    piece(0.3, 4, 5.4, -3.85, 2, 0)
    piece(0.3, 4, 5.4, 3.85, 2, 0)

    // Door trim
    for (const jx of [-0.88, 0.88]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.42), white)
      jamb.position.set(jx, 1.1, 2.85)
      house.add(jamb)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 0.42), white)
    lintel.position.set(0, 2.26, 2.85)
    house.add(lintel)

    // Breakable windows with frames + muntins (same recipe as the mansion)
    for (const wx of [-2.4, 2.4]) {
      const w = 1.4
      const h = 1.2
      const wy = 1.9
      const frameParts: Array<[number, number, number, number]> = [
        [w + 0.18, 0.1, wx, wy + h / 2 + 0.05],
        [w + 0.18, 0.1, wx, wy - h / 2 - 0.05],
        [0.1, h + 0.18, wx - w / 2 - 0.05, wy],
        [0.1, h + 0.18, wx + w / 2 + 0.05, wy],
      ]
      for (const [fw, fh, fx, fy] of frameParts) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.42), white)
        f.position.set(fx, fy, 2.85)
        house.add(f)
      }
      const glassMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), houseGlassMat)
      glassMesh.add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.12), white))
      glassMesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.12), white))
      glassMesh.position.set(wx, wy, 2.85)
      house.add(glassMesh)
      const wp = worldOf(wx, 2.85)
      const paneBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, 0.04)),
        isTrigger: true,
      })
      paneBody.collisionFilterGroup = GROUP_NO_CAMERA
      paneBody.position.set(wp.x, wy, wp.z)
      paneBody.quaternion.setFromEuler(0, rot, 0)
      world.addBody(paneBody)
      panes.push({ mesh: glassMesh, body: paneBody, broken: false })
    }

    // Roof
    const roofGeo = new THREE.CylinderGeometry(0.15, 1, 1, 4)
    roofGeo.rotateY(Math.PI / 4)
    const roof = new THREE.Mesh(roofGeo, lambert(0x5a6472))
    roof.scale.set(4.6 / halfDiag, 1.6, 3.6 / halfDiag)
    roof.position.y = 4.8
    roof.castShadow = true
    house.add(roof)
    houseBody.addShape(new CANNON.Box(new CANNON.Vec3(4.2, 0.9, 3.2)), new CANNON.Vec3(0, 4.95, 0))
    world.addBody(houseBody)

    // Interior: light floorboards, a lit ceiling panel, and a real warm
    // point light so living rooms are bright
    const floor = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.06, 5.4), lambert(0xb98f5f))
    floor.position.y = 0.03
    floor.receiveShadow = true
    house.add(floor)
    const ceilingGlow = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.05, 2),
      new THREE.MeshBasicMaterial({ color: 0xffe9c9 }),
    )
    ceilingGlow.position.y = 3.7
    house.add(ceilingGlow)
    const glow = new THREE.PointLight(0xffe0b0, 30, 13)
    glow.position.set(0, 3.1, 0)
    house.add(glow)

    house.position.set(hx, 0, hz)
    house.rotation.y = rot
    g.add(house)

    // Hinged front door (opening local x -0.8..0.8 at lz 2.85)
    const hinge = worldOf(-0.8, 2.85)
    addSwingDoor(scene, world, decor, doors, hinge.x, hinge.z, rot, 1.5, 2.12, 0x6e4a2e)

    // Knickknack + a bed or couch (which doubles as a snuggle spot)
    const spotA = worldOf(1.6, -1)
    const spotB = worldOf(-1.9, -1.1)
    const kind = idx % 4
    if (kind === 0) {
      const t = makeTable()
      add('TABLE', 30, t.mesh, t.body, spotA.x, 0.5, spotA.z)
      const cup = makeTeacup()
      add('TEACUP', 20, cup.mesh, cup.body, spotA.x, 1.13, spotA.z)
    } else if (kind === 1) {
      const crate = makeCrate()
      add('CRATE', 10, crate.mesh, crate.body, spotA.x, 0.3, spotA.z)
    } else if (kind === 2) {
      const gnome = makeGnome()
      add('GNOME', 50, gnome.mesh, gnome.body, spotA.x, 0.45, spotA.z, rot)
    } else {
      const ped = makePedestal()
      add('PEDESTAL', 20, ped.mesh, ped.body, spotA.x, 0.45, spotA.z)
      const vase = makeVase()
      add('FANCY VASE', 60, vase.mesh, vase.body, spotA.x, 1.2, spotA.z)
    }
    if (idx % 2 === 0) {
      const bed = makeBed()
      add('BED', 40, bed.mesh, bed.body, spotB.x, 0.32, spotB.z, rot)
      snuggleSpots.push({ x: 0, y: 0, z: 0, r: 1.0, name: 'BED', body: bed.body, dy: 0.6 })
    } else {
      const couchColors = [0x3a6ea5, 0x8e2b3e, 0x5d8a4a, 0x8a6a3d]
      const couch = makeCouch(couchColors[idx % 4])
      add('COUCH', 45, couch.mesh, couch.body, spotB.x, 0.45, spotB.z, rot)
      snuggleSpots.push({ x: 0, y: 0, z: 0, r: 0.9, name: 'COUCH', body: couch.body, dy: 0.55 })
    }

    // Every living room has a TV; the console households are idx % 2 === 1
    const tvSpot = worldOf(-1.5, 1.65)
    const stand = makeTVStand()
    add('TV STAND', 25, stand.mesh, stand.body, tvSpot.x, 0.28, tvSpot.z, rot + Math.PI)
    const channels = [0x4fc3f7, 0x5d9c45, 0xf2789f]
    const tv = makeTV(channels[idx % channels.length])
    add('TV', 70, tv.mesh, tv.body, tvSpot.x, 0.95, tvSpot.z, rot + Math.PI)
    if (idx % 2 === 1) {
      const consoleSpot = worldOf(-0.8, 1.7)
      const console = makeConsole()
      add('GAME CONSOLE', 55, console.mesh, console.body, consoleSpot.x, 0.1, consoleSpot.z, rot + Math.PI)
      const ctrlSpot = worldOf(-1.4, 0.8)
      const controller = makeController()
      add('CONTROLLER', 15, controller.mesh, controller.body, ctrlSpot.x, 0.07, ctrlSpot.z, rot + 1.2)
    }

    // Art on the back wall, varied per address
    buildArtwork(house, ((idx % 3) - 1) * 1.6, 2.3, -2.66, 0, idx + 6)
    if (idx % 3 === 0) buildArtwork(house, 3.66, 2.1, 0.5, -Math.PI / 2, idx + 11)
  })

  scene.add(g)
}

function makeBasin(
  scene: THREE.Scene,
  world: CANNON.World,
  x: number,
  z: number,
  r: number,
  segments: number,
): void {
  const stone = lambert(0xc9c4bc)
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const segLen = (2 * Math.PI * r) / segments + 0.05
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.4, 0.28), stone)
    mesh.position.set(x + Math.cos(a) * r, 0.2, z + Math.sin(a) * r)
    mesh.rotation.y = -a + Math.PI / 2
    mesh.castShadow = true
    scene.add(mesh)
    staticBox(world, segLen, 0.4, 0.28, x + Math.cos(a) * r, 0.2, z + Math.sin(a) * r, -a + Math.PI / 2)
  }
  const water = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.1, r - 0.1, 0.04, 24), waterMat)
  water.position.set(x, 0.2, z)
  scene.add(water)
}

function setupFountains(
  scene: THREE.Scene,
  world: CANNON.World,
  zones: WaterZone[],
  jets: WaterJet[],
): void {
  // Plaza
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(8, 28), lambert(0xcfc9be))
  plaza.rotation.x = -Math.PI / 2
  plaza.position.set(0, 0.04, 30)
  plaza.receiveShadow = true
  scene.add(plaza)

  // Grand fountain
  makeBasin(scene, world, 0, 30, 2.4, 12)
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.3, 10), lambert(0xc9c4bc))
  pedestal.position.set(0, 0.65, 30)
  pedestal.castShadow = true
  scene.add(pedestal)
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.45, 0.22, 12), lambert(0xc9c4bc))
  bowl.position.set(0, 1.35, 30)
  bowl.castShadow = true
  scene.add(bowl)
  const bodyPed = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.4, 0.4, 1.5, 8) })
  bodyPed.position.set(0, 0.75, 30)
  world.addBody(bodyPed)
  zones.push({ x: 0, z: 30, r: 2.3, name: 'FOUNTAIN' })
  jets.push({ x: 0, y: 1.55, z: 30, vx: 0, vy: 4.6, vz: 0, spread: 0.6, rate: 26 })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    jets.push({
      x: Math.cos(a) * 0.7,
      y: 1.45,
      z: 30 + Math.sin(a) * 0.7,
      vx: Math.cos(a) * 1.6,
      vy: 2.2,
      vz: Math.sin(a) * 1.6,
      spread: 0.25,
      rate: 9,
    })
  }

  // Mini fountain on the west sidewalk
  makeBasin(scene, world, -24, 22, 1.3, 8)
  const mini = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.8, 8), lambert(0xc9c4bc))
  mini.position.set(-24, 0.4, 22)
  mini.castShadow = true
  scene.add(mini)
  zones.push({ x: -24, z: 22, r: 1.25, name: 'MINI FOUNTAIN' })
  jets.push({ x: -24, y: 0.85, z: 22, vx: 0, vy: 3.2, vz: 0, spread: 0.4, rate: 12 })
}

/** Stairs (hidden ramp) rising toward +x, platform, then a chute down +x. */
function buildSlide(
  scene: THREE.Scene,
  world: CANNON.World,
  baseX: number,
  z: number,
  platH: number,
  chuteLen: number,
  color: number,
): void {
  const mat = lambert(color)
  const stairRun = platH * 1.4
  const stairX0 = baseX - 1 - stairRun

  // Step visuals + hidden ramp (same trick as the mansion staircase)
  const nSteps = Math.max(5, Math.round(platH / 0.28))
  for (let i = 0; i < nSteps; i++) {
    const stepTop = ((i + 1) / nSteps) * platH
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(stairRun / nSteps + 0.02, stepTop, 1.2),
      mat,
    )
    step.position.set(stairX0 + (i + 0.5) * (stairRun / nSteps), stepTop / 2, z)
    step.castShadow = true
    scene.add(step)
  }
  const angle = Math.atan2(platH, stairRun)
  const rx0 = stairX0 - 0.7
  const ry0 = -0.7 * Math.tan(angle)
  const rampLen = Math.hypot(baseX - 1 - rx0, platH - ry0)
  const ramp = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(rampLen / 2, 0.1, 0.6)) })
  ramp.position.set((rx0 + baseX - 1) / 2 + Math.sin(angle) * 0.1, (ry0 + platH) / 2 - Math.cos(angle) * 0.1, z)
  ramp.quaternion.setFromEuler(0, 0, angle)
  world.addBody(ramp)

  // Platform on legs
  const plat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 1.6), mat)
  plat.position.set(baseX, platH, z)
  plat.castShadow = true
  scene.add(plat)
  staticBox(world, 2, 0.15, 1.6, baseX, platH - 0.075, z)
  for (const [lx, lz] of [
    [-0.8, -0.6],
    [0.8, -0.6],
    [-0.8, 0.6],
    [0.8, 0.6],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, platH, 0.12), lambert(0x8a8a8a))
    leg.position.set(baseX + lx, platH / 2, z + lz)
    scene.add(leg)
  }
  // Back rail so you don't just fall off the far side
  const railMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.08), mat)
  railMesh.position.set(baseX, platH + 0.33, z - 0.8)
  scene.add(railMesh)
  staticBox(world, 2, 0.5, 0.08, baseX, platH + 0.33, z - 0.8)

  // Chute descending toward +x, ending near the ground
  const endY = 0.35
  const chuteAngle = -Math.atan2(platH - endY, chuteLen)
  const chuteHypo = Math.hypot(chuteLen, platH - endY)
  const cx = baseX + 1 + chuteLen / 2
  const cy = (platH + endY) / 2
  const chute = new THREE.Mesh(new THREE.BoxGeometry(chuteHypo, 0.1, 1.0), mat)
  chute.position.set(cx, cy, z)
  chute.rotation.z = chuteAngle
  chute.castShadow = true
  scene.add(chute)
  const chuteBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(chuteHypo / 2, 0.05, 0.5)),
  })
  chuteBody.position.set(cx, cy, z)
  chuteBody.quaternion.setFromEuler(0, 0, chuteAngle)
  world.addBody(chuteBody)
  for (const side of [-1, 1]) {
    const railSide = new THREE.Mesh(new THREE.BoxGeometry(chuteHypo, 0.25, 0.07), mat)
    railSide.position.set(cx, cy + 0.16, z + side * 0.53)
    railSide.rotation.z = chuteAngle
    scene.add(railSide)
    const rb = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(chuteHypo / 2, 0.125, 0.035)),
    })
    rb.collisionFilterGroup = GROUP_NO_CAMERA
    rb.position.set(cx, cy + 0.16, z + side * 0.53)
    rb.quaternion.setFromEuler(0, 0, chuteAngle)
    world.addBody(rb)
  }
}

function setupPlayground(scene: THREE.Scene, world: CANNON.World, decor: DynamicDecor[]): void {
  // Rubber-mat pad
  const pad = new THREE.Mesh(new THREE.CircleGeometry(9, 24), lambert(0xb08968))
  pad.rotation.x = -Math.PI / 2
  pad.position.set(-34, 0.035, 36)
  pad.receiveShadow = true
  scene.add(pad)

  // Slide into the sandbox
  buildSlide(scene, world, -39, 32, 1.9, 4, 0xd7263d)
  const sand = new THREE.Mesh(new THREE.CircleGeometry(2.4, 16), lambert(0xe0c98f))
  sand.rotation.x = -Math.PI / 2
  sand.position.set(-33, 0.05, 32)
  scene.add(sand)

  // Swings: rigid-arm seats hinged to the top bar — bonk them, they swing
  const swingX = -28
  const swingZ = 40
  const frameMat = lambert(0x3a6ea5)
  const barBody = staticBox(world, 3.2, 0.12, 0.12, swingX, 2.4, swingZ)
  const barMesh = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), frameMat)
  barMesh.position.set(swingX, 2.4, swingZ)
  barMesh.castShadow = true
  scene.add(barMesh)
  for (const side of [-1, 1]) {
    for (const tilt of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), frameMat)
      leg.position.set(swingX + side * 1.55, 1.25, swingZ + tilt * 0.55)
      // Λ, not V: tops meet at the bar, feet spread outward
      leg.rotation.x = -tilt * 0.42
      leg.castShadow = true
      scene.add(leg)
    }
  }
  for (const dx of [-0.75, 0.75]) {
    const seatGroup = new THREE.Group()
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.26), lambert(0xd7263d))
    seatGroup.add(seat)
    for (const rx of [-0.26, 0.26]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 5), lambert(0x888888))
      rod.position.set(rx, 0.85, 0)
      seatGroup.add(rod)
    }
    seatGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    scene.add(seatGroup)
    const seatBody = new CANNON.Body({
      mass: 2,
      shape: new CANNON.Box(new CANNON.Vec3(0.3, 0.03, 0.13)),
    })
    seatBody.position.set(swingX + dx, 0.7, swingZ)
    seatBody.collisionFilterGroup = GROUP_DYNAMIC
    seatBody.angularDamping = 0.15
    seatBody.linearDamping = 0.05
    world.addBody(seatBody)
    world.addConstraint(
      new CANNON.HingeConstraint(barBody, seatBody, {
        pivotA: new CANNON.Vec3(dx, 0, 0),
        axisA: new CANNON.Vec3(1, 0, 0),
        pivotB: new CANNON.Vec3(0, 1.7, 0),
        axisB: new CANNON.Vec3(1, 0, 0),
      }),
    )
    decor.push({ mesh: seatGroup, body: seatBody })
  }

  // Seesaw: plank hinged on a base
  const seesawX = -34
  const seesawZ = 43
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.4), lambert(0x3a6ea5))
  base.position.set(seesawX, 0.25, seesawZ)
  base.castShadow = true
  scene.add(base)
  const baseBody = staticBox(world, 0.35, 0.5, 0.4, seesawX, 0.25, seesawZ)
  const plankGroup = new THREE.Group()
  const plank = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.45), lambert(0xf2b134))
  plankGroup.add(plank)
  for (const hx of [-1.45, 1.45]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), lambert(0x555555))
    handle.position.set(hx, 0.15, 0)
    plankGroup.add(handle)
  }
  plankGroup.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  scene.add(plankGroup)
  const plankBody = new CANNON.Body({
    mass: 5,
    shape: new CANNON.Box(new CANNON.Vec3(1.6, 0.05, 0.225)),
  })
  plankBody.position.set(seesawX, 0.56, seesawZ)
  plankBody.collisionFilterGroup = GROUP_DYNAMIC
  plankBody.angularDamping = 0.2
  world.addBody(plankBody)
  world.addConstraint(
    new CANNON.HingeConstraint(baseBody, plankBody, {
      pivotA: new CANNON.Vec3(0, 0.31, 0),
      axisA: new CANNON.Vec3(0, 0, 1),
      pivotB: new CANNON.Vec3(0, 0, 0),
      axisB: new CANNON.Vec3(0, 0, 1),
    }),
  )
  decor.push({ mesh: plankGroup, body: plankBody })
}

function setupWaterPark(
  scene: THREE.Scene,
  world: CANNON.World,
  zones: WaterZone[],
  jets: WaterJet[],
): void {
  // Deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(20, 0.05, 22), lambert(0xd8d2c5))
  deck.position.set(36, 0.025, 34)
  deck.receiveShadow = true
  scene.add(deck)

  // Pool: bottom, water, low walls
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 7), lambert(0x2e7cab))
  bottom.position.set(36, 0.05, 30)
  scene.add(bottom)
  const poolWater = new THREE.Mesh(new THREE.BoxGeometry(9.7, 0.04, 6.7), waterMat)
  poolWater.position.set(36, 0.3, 30)
  scene.add(poolWater)
  const wallMat = lambert(0xf0f0ea)
  const poolWalls: Array<[number, number, number, number, number]> = [
    // [w, d, x, z, rotY]
    [10.6, 0.3, 36, 26.35, 0],
    [10.6, 0.3, 36, 33.65, 0],
    [0.3, 7.0, 30.85, 30, 0],
    [0.3, 7.0, 41.15, 30, 0],
  ]
  for (const [w, d, x, z] of poolWalls) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), wallMat)
    wall.position.set(x, 0.25, z)
    wall.castShadow = true
    scene.add(wall)
    staticBox(world, w, 0.5, d, x, 0.25, z)
  }
  zones.push({ x: 36, z: 30, r: 4.8, name: 'POOL' })

  // Water slide: tower west of the pool, chute launching in
  buildSlide(scene, world, 26, 30, 3.2, 6, 0x6db3d9)

  // Splash pad with a ring of jets
  const padCenter = { x: 36, z: 42 }
  const splashPad = new THREE.Mesh(new THREE.CircleGeometry(3.8, 20), lambert(0x6db3d9))
  splashPad.rotation.x = -Math.PI / 2
  splashPad.position.set(padCenter.x, 0.06, padCenter.z)
  splashPad.receiveShadow = true
  scene.add(splashPad)
  zones.push({ x: padCenter.x, z: padCenter.z, r: 3.8, name: 'SPLASH PAD' })
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    jets.push({
      x: padCenter.x + Math.cos(a) * 2.2,
      y: 0.1,
      z: padCenter.z + Math.sin(a) * 2.2,
      vx: -Math.cos(a) * 0.5,
      vy: 3.6,
      vz: -Math.sin(a) * 0.5,
      spread: 0.3,
      rate: 10,
    })
  }

  // --- Lazy river: a ring of water with a current, around a palm island ---
  const RC = { x: 62, z: 38, inner: 7.5, outer: 11.5 }
  const riverBottom = new THREE.Mesh(new THREE.RingGeometry(RC.inner - 0.2, RC.outer + 0.3, 40), lambert(0x2e7cab))
  riverBottom.rotation.x = -Math.PI / 2
  riverBottom.position.set(RC.x, 0.03, RC.z)
  scene.add(riverBottom)
  const riverWater = new THREE.Mesh(new THREE.RingGeometry(RC.inner, RC.outer, 40), waterMat)
  riverWater.rotation.x = -Math.PI / 2
  riverWater.position.set(RC.x, 0.12, RC.z)
  scene.add(riverWater)
  zones.push({ x: RC.x, z: RC.z, r: RC.outer + 0.1, innerR: RC.inner, name: 'LAZY RIVER' })
  // Outer wall ring
  const rimMat = lambert(0xf0f0ea)
  const rimSegments = 22
  for (let i = 0; i < rimSegments; i++) {
    const a = (i / rimSegments) * Math.PI * 2
    const segLen = (2 * Math.PI * (RC.outer + 0.4)) / rimSegments + 0.05
    const rim = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.45, 0.3), rimMat)
    rim.position.set(RC.x + Math.cos(a) * (RC.outer + 0.4), 0.22, RC.z + Math.sin(a) * (RC.outer + 0.4))
    rim.rotation.y = -a + Math.PI / 2
    rim.castShadow = true
    scene.add(rim)
    staticBox(world, segLen, 0.45, 0.3, RC.x + Math.cos(a) * (RC.outer + 0.4), 0.22, RC.z + Math.sin(a) * (RC.outer + 0.4), -a + Math.PI / 2)
  }
  // Island: sandy beach ring, grassy middle, one palm tree
  const beach = new THREE.Mesh(new THREE.CircleGeometry(RC.inner - 0.1, 28), lambert(0xe0c98f))
  beach.rotation.x = -Math.PI / 2
  beach.position.set(RC.x, 0.06, RC.z)
  beach.receiveShadow = true
  scene.add(beach)
  const islandGrass = new THREE.Mesh(new THREE.CircleGeometry(5.2, 24), lambert(0x7bb85c))
  islandGrass.rotation.x = -Math.PI / 2
  islandGrass.position.set(RC.x, 0.07, RC.z)
  scene.add(islandGrass)
  const palm = new THREE.Group()
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.16 - i * 0.02, 0.19 - i * 0.02, 1.0, 7), lambert(0x8a6a3d))
    seg.position.set(i * 0.14, 0.5 + i * 0.95, 0)
    seg.rotation.z = -0.12
    seg.castShadow = true
    palm.add(seg)
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const frond = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), lambert(0x4e8c3a))
    frond.position.set(0.55 + Math.cos(a) * 0.85, 4.15 - Math.abs(Math.sin(a * 0.5)) * 0.1, Math.sin(a) * 0.85)
    frond.rotation.y = -a
    frond.rotation.z = Math.cos(a) * -0.35 - 0.15
    frond.castShadow = true
    palm.add(frond)
  }
  palm.position.set(RC.x, 0, RC.z)
  scene.add(palm)
  const palmBody = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.2, 0.2, 4, 7) })
  palmBody.collisionFilterGroup = GROUP_NO_CAMERA
  palmBody.position.set(RC.x + 0.2, 2, RC.z)
  world.addBody(palmBody)

  // --- Mega slide with its own plunge pool ---
  buildSlide(scene, world, 52, 22, 5.5, 10, 0xf2789f)
  // Raised slightly above the sidewalk it meets — coplanar tops z-fight
  const plungeDeck = new THREE.Mesh(new THREE.BoxGeometry(13, 0.09, 10), lambert(0xd8d2c5))
  plungeDeck.position.set(66.5, 0.045, 22)
  plungeDeck.receiveShadow = true
  scene.add(plungeDeck)
  const plungeBottom = new THREE.Mesh(new THREE.BoxGeometry(9, 0.05, 6), lambert(0x2e7cab))
  plungeBottom.position.set(66.5, 0.05, 22)
  scene.add(plungeBottom)
  const plungeWater = new THREE.Mesh(new THREE.BoxGeometry(8.7, 0.04, 5.7), waterMat)
  plungeWater.position.set(66.5, 0.3, 22)
  scene.add(plungeWater)
  const plungeWalls: Array<[number, number, number, number]> = [
    [9.6, 0.3, 66.5, 18.85],
    [9.6, 0.3, 66.5, 25.15],
    [0.3, 6.0, 61.85, 22],
    [0.3, 6.0, 71.15, 22],
  ]
  for (const [w, d, x, z] of plungeWalls) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), rimMat)
    wall.position.set(x, 0.25, z)
    wall.castShadow = true
    scene.add(wall)
    staticBox(world, w, 0.5, d, x, 0.25, z)
  }
  zones.push({ x: 66.5, z: 22, r: 4.2, name: "PLUNGE POOL" })

  // Parasols
  for (const [ux, uz, uc] of [
    [33, 24, 0xd7263d],
    [70.5, 26.2, 0xf2b134],
  ] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), lambert(0xd9d9d9))
    pole.position.set(ux, 1.1, uz)
    scene.add(pole)
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.55, 10), lambert(uc))
    canopy.position.set(ux, 2.3, uz)
    canopy.castShadow = true
    scene.add(canopy)
    const poleBody = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.07, 0.07, 2.2, 6) })
    poleBody.collisionFilterGroup = GROUP_NO_CAMERA
    poleBody.position.set(ux, 1.1, uz)
    world.addBody(poleBody)
  }
}

type AddProp = (
  name: string,
  points: number,
  mesh: THREE.Object3D,
  body: CANNON.Body,
  x: number,
  y: number,
  z: number,
  rotY?: number,
) => void

function setupMansion(
  scene: THREE.Scene,
  world: CANNON.World,
  add: AddProp,
  panes: Pane[],
  decor: DynamicDecor[],
  doors: SwingDoor[],
  snuggleSpots: SnuggleSpot[],
): void {
  const m = new THREE.Group()
  const cream = lambert(0xf2ead9)
  const white = lambert(0xfafafa)
  const slate = lambert(0x5a6472)

  const W = 20 // width (x)
  const D = 8 // depth (z)
  const H = 6.4 // wall height
  const T = 0.4 // wall thickness
  const CZ = -24 // center z — front face at CZ + D/2 = -20
  const front = CZ + D / 2

  // Wall piece = mesh + matching static collider
  const wallPiece = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cream)
    piece.position.set(x, y, z)
    piece.castShadow = true
    piece.receiveShadow = true
    m.add(piece)
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
    })
    body.position.set(x, y, z)
    world.addBody(body)
  }

  // Front wall, ground floor: segments between the openings.
  // Openings: door x [-1, 1] (y 0..2.8), windows 1.3 wide at ±3, ±5.6, ±8.2 (y 1..2.8).
  const segments: Array<[number, number]> = [
    // [center x, width] of solid strips between openings
    [-9.425, 1.15],
    [-6.9, 1.3],
    [-4.3, 1.3],
    [-1.675, 1.35],
    [1.675, 1.35],
    [4.3, 1.3],
    [6.9, 1.3],
    [9.425, 1.15],
  ]
  for (const [x, w] of segments) wallPiece(w, 2.8, T, x, 1.4, front)
  for (const x of [-8.2, -5.6, -3, 3, 5.6, 8.2]) wallPiece(1.3, 1.0, T, x, 0.5, front) // under windows

  // Front wall, upper floor: same idea. Window openings y 3.9..5.5 at ±3, ±5.6, ±8.2
  // plus the grand window x [-1.1, 1.1].
  wallPiece(W, 1.1, T, 0, 3.35, front) // strip between floors (y 2.8..3.9)
  wallPiece(W, 0.9, T, 0, 5.95, front) // strip above windows (y 5.5..6.4)
  const upperSegs: Array<[number, number]> = [
    [-9.425, 1.15],
    [-6.9, 1.3],
    [-4.3, 1.3],
    [-1.725, 1.25],
    [1.725, 1.25],
    [4.3, 1.3],
    [6.9, 1.3],
    [9.425, 1.15],
  ]
  for (const [x, w] of upperSegs) wallPiece(w, 1.6, T, x, 4.7, front)

  // Breakable glass panes in every window opening. Triggers: they don't push
  // back, they just report the touch — main.ts shatters them on contact.
  // Phong with a hot specular so the glass visibly glints instead of reading
  // as a slab of wall.
  const glassMat = new THREE.MeshPhongMaterial({
    color: 0x9fd4ee,
    transparent: true,
    opacity: 0.35,
    shininess: 90,
    specular: 0xffffff,
    side: THREE.DoubleSide,
  })
  const trimD = T + 0.08
  const addPane = (w: number, h: number, x: number, y: number): void => {
    // White frame around the opening — stays behind after the glass breaks
    const frameParts: Array<[number, number, number, number]> = [
      [w + 0.18, 0.1, x, y + h / 2 + 0.05],
      [w + 0.18, 0.1, x, y - h / 2 - 0.05],
      [0.1, h + 0.18, x - w / 2 - 0.05, y],
      [0.1, h + 0.18, x + w / 2 + 0.05, y],
    ]
    for (const [fw, fh, fx, fy] of frameParts) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, trimD), white)
      f.position.set(fx, fy, front)
      m.add(f)
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), glassMat)
    // Muntin cross rides on the pane, so it shatters away with the glass
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.12), white))
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.12), white))
    mesh.position.set(x, y, front)
    m.add(mesh)
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, 0.04)),
      isTrigger: true,
    })
    body.collisionFilterGroup = GROUP_NO_CAMERA
    body.position.set(x, y, front)
    world.addBody(body)
    panes.push({ mesh, body, broken: false })
  }
  for (const x of [-8.2, -5.6, -3, 3, 5.6, 8.2]) {
    addPane(1.3, 1.8, x, 1.9) // ground floor
    addPane(1.3, 1.6, x, 4.7) // upper floor
  }
  addPane(2.2, 1.6, 0, 4.7) // grand window

  // Back and side walls, solid
  wallPiece(W, H, T, 0, H / 2, CZ - D / 2)
  wallPiece(T, H, D - T, W / 2 - T / 2, H / 2, CZ)
  wallPiece(T, H, D - T, -(W / 2 - T / 2), H / 2, CZ)

  // White band between floors — four perimeter strips, NOT a solid slab
  // (a slab would fill the interior and visually cover the stairwell)
  const bandStrips: Array<[number, number, number, number]> = [
    // [width, depth, x, z]
    [W + 0.15, 0.3, 0, front + T / 2],
    [W + 0.15, 0.3, 0, CZ - D / 2 - T / 2],
    [0.3, D + 0.15, W / 2, CZ],
    [0.3, D + 0.15, -W / 2, CZ],
  ]
  for (const [bw, bd, bx, bz] of bandStrips) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.25, bd), white)
    strip.position.set(bx, 3.3, bz)
    m.add(strip)
  }

  // Door frame trim (the doorway itself is open — walk right in)
  for (const x of [-1.07, 1.07]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.8, T + 0.1), white)
    jamb.position.set(x, 1.4, front)
    m.add(jamb)
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.15, T + 0.1), white)
  lintel.position.set(0, 2.87, front)
  m.add(lintel)

  // Interior: wooden floor, rug, chandelier, warm light
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W - T * 2, 0.08, D - T * 2), lambert(0x9a7148))
  floor.position.set(0, 0.04, CZ)
  floor.receiveShadow = true
  m.add(floor)
  const rug = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), lambert(0x8e2b3e))
  rug.rotation.x = -Math.PI / 2
  rug.position.set(0, 0.09, CZ)
  m.add(rug)
  const chandelier = new THREE.Group()
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), lambert(0xd9b44a))
  rod.position.y = 0.6
  chandelier.add(rod)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 16), lambert(0xd9b44a))
  ring.rotation.x = Math.PI / 2
  chandelier.add(ring)
  for (let i = 0; i < 6; i++) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9b8 }),
    )
    bulb.position.set(Math.cos((i / 6) * Math.PI * 2) * 0.5, 0.08, Math.sin((i / 6) * Math.PI * 2) * 0.5)
    chandelier.add(bulb)
  }
  chandelier.position.set(0, 5.2, CZ)
  m.add(chandelier)
  const upstairsGlow = new THREE.PointLight(0xffd9a0, 55, 22)
  upstairsGlow.position.set(0, 5.6, CZ)
  m.add(upstairsGlow)
  const downstairsGlow = new THREE.PointLight(0xffd9a0, 48, 18)
  downstairsGlow.position.set(0, 2.6, CZ)
  m.add(downstairsGlow)

  // --- Upper floor: slabs with a stairwell opening above the staircase ---
  const wood = lambert(0x9a7148)
  const floorSlab = (w: number, d: number, x: number, z: number): void => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), wood)
    slab.position.set(x, 3.3, z)
    slab.receiveShadow = true
    slab.castShadow = true
    m.add(slab)
    const b = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, 0.1, d / 2)),
    })
    b.position.set(x, 3.3, z)
    world.addBody(b)
  }
  // Stairwell opening: x 2.2..8.1, z -27.6..-25.8
  floorSlab(11.8, 7.2, -3.7, CZ) // everything left of the stairwell
  floorSlab(7.4, 5.4, 5.9, -23.1) // right side, in front of the stairwell
  floorSlab(1.5, 1.8, 8.85, -26.7) // landing at the top of the stairs

  // --- Staircase: chunky visual steps + smooth hidden ramp collider ---
  const N_STEPS = 12
  const runPer = 5.6 / N_STEPS
  const risePer = 3.4 / N_STEPS
  for (let i = 0; i < N_STEPS; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(runPer + 0.02, risePer, 1.5), wood)
    step.position.set(2.4 + (i + 0.5) * runPer, (i + 1) * risePer - risePer / 2, -26.75)
    step.castShadow = true
    step.receiveShadow = true
    m.add(step)
  }
  // The ramp's walking surface runs (2.4, 0) → (8.0, 3.4) but the collider is
  // extended below ground at the entry: if its lower tip sat exactly at
  // ground level, the puppy would wedge against the ramp's end edge instead
  // of rolling onto the top face.
  const rampAngle = Math.atan2(3.4, 5.6)
  const rampX0 = 1.7
  const rampY0 = (rampX0 - 2.4) * Math.tan(rampAngle)
  const rampLen = Math.hypot(8.0 - rampX0, 3.4 - rampY0)
  const ramp = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(rampLen / 2, 0.1, 0.75)),
  })
  ramp.position.set(
    (rampX0 + 8.0) / 2 + Math.sin(rampAngle) * 0.1,
    (rampY0 + 3.4) / 2 - Math.cos(rampAngle) * 0.1,
    -26.75,
  )
  ramp.quaternion.setFromEuler(0, 0, rampAngle)
  world.addBody(ramp)

  // Railings around the stairwell (low enough to jump — safety is optional)
  const railPiece = (w: number, d: number, x: number, z: number): void => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), white)
    r.position.set(x, 3.75, z)
    r.castShadow = true
    m.add(r)
    const b = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, 0.35, d / 2)),
    })
    b.position.set(x, 3.75, z)
    world.addBody(b)
  }
  railPiece(5.9, 0.08, 5.15, -25.84) // along the stairwell's front edge
  railPiece(0.08, 1.8, 2.24, -26.7) // above the bottom steps

  // Blanket nest at the west end of the bedroom — prime snuggle real estate
  {
    const bed = new THREE.Group()
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.85, 0.16, 14), lambert(0x7f9fc9))
    cushion.position.y = 0.08
    bed.add(cushion)
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.75), lambert(0xc95f6e))
    blanket.position.set(0.05, 0.2, 0)
    blanket.rotation.y = 0.3
    bed.add(blanket)
    const fold = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.3), lambert(0xd9808f))
    fold.position.set(-0.1, 0.27, 0.1)
    fold.rotation.y = -0.2
    bed.add(fold)
    bed.position.set(-7.5, 3.4, -21.5)
    bed.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    m.add(bed)
  }

  // Upstairs loot
  {
    const ped1 = makePedestal()
    add('PEDESTAL', 20, ped1.mesh, ped1.body, -6, 3.85, CZ - 1.5)
    const trophy = makeTrophy()
    add('TROPHY', 80, trophy.mesh, trophy.body, -6, 4.55, CZ - 1.5)
    const ped2 = makePedestal()
    add('PEDESTAL', 20, ped2.mesh, ped2.body, -2, 3.85, CZ + 1.5)
    const vase = makeVase()
    add('FANCY VASE', 60, vase.mesh, vase.body, -2, 4.6, CZ + 1.5)
  }

  // Threshold under the doorway at porch height: the porch floor is 0.6m
  // tall, and a full-height door would slam into it when swinging outward.
  wallPiece(2.0, 0.6, T, 0, 0.3, front)
  // Front door on a hinge — nuzzle it open (opening spans x -1..1)
  addSwingDoor(scene, world, decor, doors, -1, front, 0, 1.9, 2.1, 0x4a2e1c, 0.6)

  // A couch in the parlour and a four-legged-friend-sized bed upstairs;
  // both are snuggle spots that stay snuggleable wherever they get shoved.
  {
    const couch = makeCouch(0x8e2b3e)
    add('COUCH', 45, couch.mesh, couch.body, 4, 0.45, CZ + 2, 0.4)
    snuggleSpots.push({ x: 0, y: 0, z: 0, r: 0.9, name: 'COUCH', body: couch.body, dy: 0.55 })
    const bed = makeBed()
    add('BED', 40, bed.mesh, bed.body, -4, 3.75, CZ - 2.3)
    snuggleSpots.push({ x: 0, y: 0, z: 0, r: 1.0, name: 'BED', body: bed.body, dy: 0.6 })
  }

  // Entertainment corner facing the couch
  {
    const stand = makeTVStand()
    add('TV STAND', 25, stand.mesh, stand.body, 5, 0.28, front - 0.9, Math.PI + 0.4)
    const tv = makeTV(0x4fc3f7)
    add('TV', 70, tv.mesh, tv.body, 5, 0.95, front - 0.9, Math.PI + 0.4)
    const console = makeConsole()
    add('GAME CONSOLE', 55, console.mesh, console.body, 6.1, 0.1, front - 0.95, Math.PI + 0.4)
    const controller = makeController()
    add('CONTROLLER', 15, controller.mesh, controller.body, 5.3, 0.07, front - 1.6, 0.9)
  }

  // Gallery wall: the family has taste (all of it barkable off the easel)
  buildArtwork(m, 9.55, 2.2, CZ + 1, -Math.PI / 2, 1)
  buildArtwork(m, -9.55, 2.2, CZ - 1, Math.PI / 2, 2)
  buildArtwork(m, 3, 2.3, CZ - D / 2 + 0.25, 0, 3)
  buildArtwork(m, -3, 4.9, CZ - D / 2 + 0.25, 0, 4)
  {
    const easel = makeEasel()
    add('MASTERPIECE', 65, easel.mesh, easel.body, -8.3, 0.78, CZ + 2.5, 0.5)
  }

  // Fancy destructibles inside
  {
    const piano = makePiano()
    add('GRAND PIANO', 100, piano.mesh, piano.body, -6, 0.56, CZ - 1.5, 0.5)
    // Front of the room — the staircase occupies the back-right corner
    for (const side of [-1, 1]) {
      const ped = makePedestal()
      add('PEDESTAL', 20, ped.mesh, ped.body, 3.5 * side, 0.45, CZ + 2.2)
      const vase = makeVase()
      add('FANCY VASE', 60, vase.mesh, vase.body, 3.5 * side, 1.2, CZ + 2.2)
    }
  }

  // Hip roof: 4-sided cylinder rotated 45° in geometry so edges align to axes
  const roofGeo = new THREE.CylinderGeometry(0.12, 1, 1, 4)
  roofGeo.rotateY(Math.PI / 4)
  const roof = new THREE.Mesh(roofGeo, slate)
  const halfDiag = Math.SQRT1_2 // 4-seg cylinder's half-extent along an axis
  roof.scale.set((W / 2 + 0.7) / halfDiag, 2.4, (D / 2 + 0.7) / halfDiag)
  roof.position.set(0, H + 1.2, CZ)
  roof.castShadow = true
  m.add(roof)

  // Chimneys
  for (const x of [-6, 6]) {
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), lambert(0xa05a44))
    chimney.position.set(x, H + 1.8, CZ)
    chimney.castShadow = true
    m.add(chimney)
  }


  // Porch slab + columns + portico roof
  const porchD = 3.2
  const porchZ = front + porchD / 2
  const porch = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, porchD), white)
  porch.position.set(0, 0.3, porchZ)
  porch.receiveShadow = true
  m.add(porch)

  const colGeo = new THREE.CylinderGeometry(0.18, 0.2, 4.4, 10)
  for (const x of [-2.9, -1.1, 1.1, 2.9]) {
    const col = new THREE.Mesh(colGeo, white)
    col.position.set(x, 0.6 + 2.2, porchZ + 1.1)
    col.castShadow = true
    m.add(col)
  }
  const entab = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, porchD + 0.6), white)
  entab.position.set(0, 5.05, porchZ + 0.2)
  entab.castShadow = true
  m.add(entab)
  const pedGeo = new THREE.CylinderGeometry(0.05, 1, 1, 4)
  pedGeo.rotateY(Math.PI / 4)
  const pediment = new THREE.Mesh(pedGeo, white)
  pediment.scale.set(3.9 / halfDiag, 1.1, (porchD / 2 + 0.4) / halfDiag)
  pediment.position.set(0, 5.85, porchZ + 0.2)
  pediment.castShadow = true
  m.add(pediment)

  // Steps down from the porch
  const stepsZ0 = porchZ + porchD / 2
  const stepMeshes: Array<[number, number]> = [
    [0.4, 0.4], // [top y of step, z offset]
    [0.2, 1.0],
  ]
  for (const [topY, dz] of stepMeshes) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(5, topY, 1.2), lambert(0xd8d2c5))
    step.position.set(0, topY / 2, stepsZ0 + dz)
    step.receiveShadow = true
    m.add(step)
  }

  // Stone path from the steps into the yard
  const stoneMat = lambert(0xc4beb2)
  for (let i = 0; i < 6; i++) {
    const stone = new THREE.Mesh(new THREE.BoxGeometry(1.4 - (i % 2) * 0.2, 0.04, 1.0), stoneMat)
    stone.position.set(((i % 2) - 0.5) * 0.4, 0.02, stepsZ0 + 2.2 + i * 1.3)
    stone.rotation.y = ((i % 3) - 1) * 0.15
    stone.receiveShadow = true
    m.add(stone)
  }

  scene.add(m)

  // --- Static colliders (walls already have theirs via wallPiece) ---
  const statics: Array<[CANNON.Vec3, CANNON.Vec3]> = [
    // [half extents, position]
    [new CANNON.Vec3(W / 2 + 0.7, 1.2, D / 2 + 0.7), new CANNON.Vec3(0, H + 1.2, CZ)], // roof, approx
    [new CANNON.Vec3(3.5, 0.3, porchD / 2), new CANNON.Vec3(0, 0.3, porchZ)],
    [new CANNON.Vec3(2.5, 0.2, 0.6), new CANNON.Vec3(0, 0.2, stepsZ0 + 0.4)],
    [new CANNON.Vec3(2.5, 0.1, 0.6), new CANNON.Vec3(0, 0.1, stepsZ0 + 1.0)],
    [new CANNON.Vec3(3.7, 0.25, porchD / 2 + 0.3), new CANNON.Vec3(0, 5.05, porchZ + 0.2)], // entablature
  ]
  for (const x of [-2.9, -1.1, 1.1, 2.9]) {
    statics.push([new CANNON.Vec3(0.2, 2.2, 0.2), new CANNON.Vec3(x, 2.8, porchZ + 1.1)])
  }
  for (const [half, pos] of statics) {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(half) })
    body.position.copy(pos)
    world.addBody(body)
  }
}

// ---------------------------------------------------------------- props

interface MeshBody {
  mesh: THREE.Object3D
  body: CANNON.Body
}

function makeTrashCan(): MeshBody {
  const g = new THREE.Group()
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 1.0, 10), lambert(0x8a9aa5))
  g.add(can)
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 10), lambert(0x6d7d88))
  lid.position.y = 0.54
  g.add(lid)
  const body = new CANNON.Body({ mass: 4 })
  body.addShape(new CANNON.Cylinder(0.32, 0.28, 1.1, 10), new CANNON.Vec3(0, 0.05, 0))
  return { mesh: g, body }
}

function makeFlowerPot(variant: number): MeshBody {
  const g = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.3, 8), lambert(0xc16a4a))
  g.add(pot)
  const bloomColors = [0xe25563, 0xf2b134, 0xb086e0]
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), lambert(0x4e8c3a))
  stem.position.y = 0.28
  g.add(stem)
  const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), lambert(bloomColors[variant]))
  bloom.position.y = 0.46
  g.add(bloom)
  const body = new CANNON.Body({ mass: 1.2 })
  body.addShape(new CANNON.Cylinder(0.22, 0.16, 0.5, 8), new CANNON.Vec3(0, 0.1, 0))
  return { mesh: g, body }
}

function makeGnome(): MeshBody {
  const g = new THREE.Group()
  const gBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8), lambert(0x3a6ea5))
  g.add(gBody)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), lambert(0xf0c8a0))
  head.position.y = 0.34
  g.add(head)
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.22, 8), lambert(0xf5f5f5))
  beard.rotation.x = Math.PI
  beard.position.set(0, 0.22, 0.08)
  g.add(beard)
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8), lambert(0xd7263d))
  hat.position.y = 0.6
  g.add(hat)
  const body = new CANNON.Body({ mass: 2 })
  body.addShape(new CANNON.Cylinder(0.2, 0.26, 0.9, 8), new CANNON.Vec3(0, 0.2, 0))
  return { mesh: g, body }
}

function makeFlamingo(): MeshBody {
  const g = new THREE.Group()
  const pink = lambert(0xf277a8)
  const flBody = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), pink)
  flBody.scale.set(1.2, 0.85, 0.8)
  flBody.position.y = 0.35
  g.add(flBody)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 6), pink)
  neck.position.set(0.2, 0.62, 0)
  neck.rotation.z = -0.35
  g.add(neck)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), pink)
  head.position.set(0.32, 0.82, 0)
  g.add(head)
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 6), lambert(0x2b2119))
  beak.rotation.z = -Math.PI / 2
  beak.position.set(0.44, 0.8, 0)
  g.add(beak)
  for (const dz of [-0.06, 0.06]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), lambert(0x333333))
    leg.position.set(0, 0.05, dz)
    g.add(leg)
  }
  // Collider raised so its base sits at the FEET (the visual hangs low —
  // an origin-centered box would rest with the legs dangling mid-air)
  const body = new CANNON.Body({ mass: 0.8 })
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.22, 0.5, 0.14)), new CANNON.Vec3(0, 0.3, 0))
  return { mesh: g, body }
}

function makeCrate(): MeshBody {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), lambert(0xb08d57))
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x8a6a3d }),
  )
  mesh.add(edges)
  const body = new CANNON.Body({ mass: 1.5, shape: new CANNON.Box(new CANNON.Vec3(0.3, 0.3, 0.3)) })
  return { mesh, body }
}

function makeTable(): MeshBody {
  const g = new THREE.Group()
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 12), lambert(0xf5f5f5))
  top.position.y = 0.46
  g.add(top)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8), lambert(0xd9d9d9))
  g.add(pole)
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.08, 12), lambert(0xd9d9d9))
  foot.position.y = -0.46
  g.add(foot)
  const body = new CANNON.Body({ mass: 6 })
  body.addShape(new CANNON.Cylinder(0.9, 0.9, 0.1, 12), new CANNON.Vec3(0, 0.46, 0))
  body.addShape(new CANNON.Cylinder(0.1, 0.1, 0.9, 8))
  body.addShape(new CANNON.Cylinder(0.4, 0.45, 0.08, 12), new CANNON.Vec3(0, -0.46, 0))
  return { mesh: g, body }
}

function makeTeacup(): MeshBody {
  const g = new THREE.Group()
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.12, 8), lambert(0xfceff0))
  g.add(cup)
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 8), lambert(0x8a5a2b))
  tea.position.y = 0.05
  g.add(tea)
  const body = new CANNON.Body({ mass: 0.3, shape: new CANNON.Cylinder(0.09, 0.06, 0.12, 8) })
  return { mesh: g, body }
}

function makeBirdBath(): MeshBody {
  const g = new THREE.Group()
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 1.0, 10), lambert(0xc9c4bc))
  g.add(pedestal)
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.18, 12), lambert(0xc9c4bc))
  bowl.position.y = 0.58
  g.add(bowl)
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.02, 12), lambert(0x64b5d9))
  water.position.y = 0.65
  g.add(water)
  const body = new CANNON.Body({ mass: 5 })
  body.addShape(new CANNON.Cylinder(0.15, 0.22, 1.0, 10))
  body.addShape(new CANNON.Cylinder(0.5, 0.3, 0.2, 12), new CANNON.Vec3(0, 0.58, 0))
  return { mesh: g, body }
}

function makeMailbox(): MeshBody {
  const g = new THREE.Group()
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), lambert(0x7a5230))
  g.add(post)
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.3), lambert(0x3a6ea5))
  box.position.y = 0.72
  g.add(box)
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), lambert(0xd7263d))
  flag.position.set(0.2, 0.95, 0.16)
  g.add(flag)
  const body = new CANNON.Body({ mass: 3 })
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.05, 0.6, 0.05)))
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.28, 0.15, 0.15)), new CANNON.Vec3(0, 0.72, 0))
  return { mesh: g, body }
}

function makePiano(): MeshBody {
  const g = new THREE.Group()
  const blackGloss = lambert(0x1a1a1f)
  const pBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 1.0), blackGloss)
  pBody.position.y = 0.35
  g.add(pBody)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.95), blackGloss)
  lid.position.set(0, 0.68, -0.15)
  lid.rotation.x = 0.5
  g.add(lid)
  const keys = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.18), lambert(0xf5f0e6))
  keys.position.set(0, 0.55, 0.56)
  g.add(keys)
  for (const [x, z] of [
    [-0.65, 0.4],
    [0.65, 0.4],
    [0, -0.4],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), blackGloss)
    leg.position.set(x, -0.28, z)
    g.add(leg)
  }
  g.position.y = 0 // group origin at body center
  const body = new CANNON.Body({ mass: 12, shape: new CANNON.Box(new CANNON.Vec3(0.8, 0.56, 0.5)) })
  return { mesh: g, body }
}

function makeHydrant(): MeshBody {
  const g = new THREE.Group()
  const red = lambert(0xd7263d)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.62, 10), red)
  g.add(barrel)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), red)
  dome.position.y = 0.33
  g.add(dome)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6), lambert(0xf2b134))
  cap.position.y = 0.44
  g.add(cap)
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6), red)
    nub.rotation.z = Math.PI / 2
    nub.rotation.y = a
    nub.position.set(Math.cos(a) * 0.19, 0.08, -Math.sin(a) * 0.19)
    g.add(nub)
  }
  const body = new CANNON.Body({ mass: 6 })
  body.addShape(new CANNON.Cylinder(0.19, 0.19, 0.72, 8), new CANNON.Vec3(0, 0.05, 0))
  return { mesh: g, body }
}

function makeBench(): MeshBody {
  const g = new THREE.Group()
  const woodMat = lambert(0x8a6a3d)
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.5), woodMat)
  g.add(seat)
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 0.07), woodMat)
  back.position.set(0, 0.32, -0.24)
  back.rotation.x = -0.15
  g.add(back)
  const legMat = lambert(0x3d3d3d)
  for (const [lx, lz] of [
    [-0.75, 0.18],
    [0.75, 0.18],
    [-0.75, -0.18],
    [0.75, -0.18],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.07), legMat)
    leg.position.set(lx, -0.25, lz)
    g.add(leg)
  }
  const body = new CANNON.Body({ mass: 8, shape: new CANNON.Box(new CANNON.Vec3(0.85, 0.45, 0.3)) })
  return { mesh: g, body }
}

function makeDeckChair(): MeshBody {
  const g = new THREE.Group()
  const fabric = lambert(0x6db3d9)
  const frame = lambert(0xf0f0ea)
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 1.0), fabric)
  seat.position.y = 0.05
  g.add(seat)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.65), fabric)
  back.position.set(0, 0.28, -0.72)
  back.rotation.x = -0.75
  g.add(back)
  for (const [lx, lz] of [
    [-0.24, 0.4],
    [0.24, 0.4],
    [-0.24, -0.4],
    [0.24, -0.4],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.05), frame)
    leg.position.set(lx, -0.1, lz)
    g.add(leg)
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  const body = new CANNON.Body({ mass: 6 })
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.3, 0.55)), new CANNON.Vec3(0, 0.1, 0))
  return { mesh: g, body }
}

function makeTreatBag(): MeshBody {
  const g = new THREE.Group()
  const orange = lambert(0xe8762c)
  const sack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, 0.45), orange)
  g.add(sack)
  const fold = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.14, 0.49), lambert(0xc95f1e))
  fold.position.y = 0.52
  fold.rotation.z = 0.04
  g.add(fold)
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.47), lambert(0xf5efdc))
  label.position.y = 0.02
  g.add(label)
  // Bone logo on the label
  const boneMat = lambert(0xa5692e)
  const boneBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.03), boneMat)
  boneBar.position.set(0, 0.02, 0.24)
  g.add(boneBar)
  for (const side of [-1, 1]) {
    const knub = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), boneMat)
    knub.position.set(0.11 * side, 0.02, 0.24)
    g.add(knub)
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  const body = new CANNON.Body({ mass: 12, shape: new CANNON.Box(new CANNON.Vec3(0.35, 0.55, 0.23)) })
  return { mesh: g, body }
}

function makeYuzu(): MeshBody {
  const g = new THREE.Group()
  const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), lambert(0xf39c12))
  g.add(fruit)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.05, 5), lambert(0x5d9c45))
  stem.position.y = 0.15
  g.add(stem)
  const body = new CANNON.Body({ mass: 0.15, shape: new CANNON.Sphere(0.14) })
  body.angularDamping = 0.4
  return { mesh: g, body }
}

function makeDuck(): MeshBody {
  const g = new THREE.Group()
  const yellow = lambert(0xf2c531)
  const duckBody = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), yellow)
  duckBody.scale.set(1.15, 0.85, 1)
  g.add(duckBody)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), yellow)
  head.position.set(0.16, 0.22, 0)
  g.add(head)
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), lambert(0xe8762c))
  beak.rotation.z = -Math.PI / 2
  beak.position.set(0.31, 0.2, 0)
  g.add(beak)
  const body = new CANNON.Body({ mass: 0.4, shape: new CANNON.Sphere(0.22) })
  body.angularDamping = 0.6
  return { mesh: g, body }
}

function makeNest(): MeshBody {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.08, 6, 12), lambert(0x8a6a3d))
  ring.rotation.x = Math.PI / 2
  g.add(ring)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.12, 0.08, 8), lambert(0x7a5230))
  base.position.y = -0.06
  g.add(base)
  for (let i = 0; i < 3; i++) {
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), lambert(0xf5f9fc))
    egg.position.set(Math.cos(i * 2.1) * 0.08, 0.03, Math.sin(i * 2.1) * 0.08)
    egg.scale.y = 1.25
    g.add(egg)
  }
  const body = new CANNON.Body({ mass: 0.5, shape: new CANNON.Cylinder(0.26, 0.26, 0.2, 8) })
  return { mesh: g, body }
}

function makeTrophy(): MeshBody {
  const g = new THREE.Group()
  const gold = lambert(0xd9a92f)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 8), lambert(0x3a3a3a))
  base.position.y = -0.18
  g.add(base)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.14, 6), gold)
  stem.position.y = -0.07
  g.add(stem)
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.07, 0.26, 10), gold)
  cup.position.y = 0.12
  g.add(cup)
  const body = new CANNON.Body({ mass: 1, shape: new CANNON.Cylinder(0.14, 0.14, 0.5, 8) })
  return { mesh: g, body }
}

function makePedestal(): MeshBody {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.9, 10), lambert(0xe5e0d5))
  const body = new CANNON.Body({ mass: 3, shape: new CANNON.Cylinder(0.18, 0.24, 0.9, 10) })
  return { mesh, body }
}

function makeVase(): MeshBody {
  const g = new THREE.Group()
  const porcelain = lambert(0xdcebf2)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), porcelain)
  belly.scale.set(1, 1.25, 1)
  g.add(belly)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.18, 8), porcelain)
  neck.position.y = 0.24
  g.add(neck)
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.02, 6, 16), lambert(0x3a6ea5))
  stripe.rotation.x = Math.PI / 2
  stripe.position.y = 0.08
  g.add(stripe)
  const body = new CANNON.Body({ mass: 0.8, shape: new CANNON.Cylinder(0.12, 0.14, 0.55, 8) })
  return { mesh: g, body }
}

function makeBall(): MeshBody {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), lambert(0xf5f5f5))
  const spots = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.322, 0),
    new THREE.MeshLambertMaterial({ color: 0x333333, wireframe: true }),
  )
  mesh.add(spots)
  const body = new CANNON.Body({ mass: 0.6, shape: new CANNON.Sphere(0.32) })
  body.angularDamping = 0.2
  return { mesh, body }
}
