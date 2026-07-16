// Headless debug renderer: /debug.html?px=8&py=1.4&pz=-13&tx=0&ty=1.2&tz=-20
// Renders one settled frame of the world from the given camera pose.
import * as THREE from 'three'
import { createWorld } from './world'
import { createCapybaras } from './capybara'
import { createHumans } from './human'

const q = new URLSearchParams(location.search)
const n = (k: string, d: number): number => {
  const v = q.get(k)
  return v === null ? d : parseFloat(v)
}

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(920, 700)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(60, 920 / 700, 0.1, 450)
camera.position.set(n('px', 8), n('py', 1.4), n('pz', -13))
camera.lookAt(n('tx', 0), n('ty', 1.2), n('tz', -20))

const { scene, world, props, dynamicDecor } = createWorld()
createCapybaras(scene, world, [
  [-66, 91, 7],
  [-73, 90, 7],
  [-69, 99, 7],
  [-76, 96, 7],
  [38.5, 31.5, 0],
  [62, 34, 3],
])
createHumans(scene, world, [
  [0, 24, 5],
  [-8, 34, 4.5],
  [-30, 17, 8],
  [30, 13, 8],
  [-34, 30, 5],
  [30, 40, 5],
  [-58, 90, 6],
])
if (q.get('noglass') === '1') {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshPhongMaterial) o.visible = false
  })
}
for (let i = 0; i < 120; i++) world.step(1 / 60)
for (const p of [...props, ...dynamicDecor]) {
  p.mesh.position.set(p.body.position.x, p.body.position.y, p.body.position.z)
  p.mesh.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w)
}
renderer.render(scene, camera)
;(window as unknown as { __done: boolean }).__done = true
