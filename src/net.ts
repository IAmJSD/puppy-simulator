// Multiplayer client: WebSocket to the lobby Durable Object, plus rendering
// and interpolation of remote players' puppies.

import * as THREE from 'three'
import { buildPuppyMesh, DOG_COLORS, type PuppyParts } from './puppy'

const SEND_INTERVAL = 0.1 // 10Hz state updates

export interface PoseFlags {
  z?: number // zoomies
  s?: number // snuggling
  c?: number // climbing
}

interface StateMsg {
  t: 'state'
  id: string
  p: [number, number, number]
  f: number
  m: PoseFlags
  sc: number
}

export class RemotePlayer {
  readonly id: string
  readonly nick: string
  readonly color: number
  readonly parts: PuppyParts
  readonly nameEl: HTMLDivElement
  score = 0

  private target = new THREE.Vector3()
  private targetFacing = 0
  private facing = 0
  private speed = 0
  private gait = 0
  private wag = 0
  private flags: PoseFlags = {}

  constructor(scene: THREE.Scene, hud: HTMLElement, id: string, nick: string, color: number) {
    this.id = id
    this.nick = nick
    this.color = color
    this.parts = buildPuppyMesh(DOG_COLORS[color] ?? DOG_COLORS[0])
    this.parts.group.visible = false // until the first state arrives
    scene.add(this.parts.group)
    this.nameEl = document.createElement('div')
    this.nameEl.className = 'nameplate'
    this.nameEl.textContent = nick
    hud.appendChild(this.nameEl)
  }

  /** Latest network position — drives the host's kinematic ghost body. */
  get netPos(): THREE.Vector3 {
    return this.target
  }

  applyState(msg: StateMsg): void {
    const prev = this.target.clone()
    this.target.set(msg.p[0], msg.p[1], msg.p[2])
    if (!this.parts.group.visible) {
      this.cur.copy(this.target)
      this.parts.group.position.set(this.target.x, this.target.y - 0.35, this.target.z)
      this.parts.group.visible = true
    }
    this.speed = prev.distanceTo(this.target) / SEND_INTERVAL
    this.targetFacing = msg.f
    this.flags = msg.m ?? {}
    this.score = msg.sc ?? 0
  }

  private cur = new THREE.Vector3()

  update(dt: number): void {
    const g = this.parts.group
    if (!g.visible) return
    this.cur.lerp(this.target, 1 - Math.exp(-12 * dt))
    // Wire positions are the physics body CENTER; the mesh origin is at the feet
    g.position.set(this.cur.x, this.cur.y - 0.35, this.cur.z)
    let diff = this.targetFacing - this.facing
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    this.facing += diff * Math.min(1, 12 * dt)
    g.rotation.y = this.facing

    const snuggling = !!this.flags.s
    const climbing = !!this.flags.c
    g.rotation.x = climbing ? -1.15 : 0

    this.gait += dt * (6 + this.speed * 1.6) * (climbing ? 2 : 1)
    this.wag += dt * (this.flags.z ? 22 : 7 + this.speed)
    const p = this.parts
    if (snuggling) {
      for (const leg of p.legs) leg.rotation.x = 1.45
      p.tail.rotation.y = Math.sin(this.wag * 0.3) * 0.3
      p.head.rotation.x = 0.3
    } else {
      const amp = Math.min(0.9, snuggling ? 0 : this.speed * 0.12 + (climbing ? 0.8 : 0))
      p.legs[0].rotation.x = Math.sin(this.gait) * amp
      p.legs[3].rotation.x = Math.sin(this.gait) * amp
      p.legs[1].rotation.x = Math.sin(this.gait + Math.PI) * amp
      p.legs[2].rotation.x = Math.sin(this.gait + Math.PI) * amp
      p.tail.rotation.y = Math.sin(this.wag) * 0.7
      p.head.rotation.x = 0
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.parts.group)
    this.nameEl.remove()
  }
}

export type WorldEventKind = 'pane' | 'bag'

/** One synced body: [index, x, y, z, qx, qy, qz, qw, vx, vy, vz] */
export type BodyEntry = number[]

export interface Snapshot {
  bodies: BodyEntry[]
  panes: number[]
  bags: number[]
  hyd: number[]
}

export class Net {
  readonly remotes = new Map<string, RemotePlayer>()
  myId = ''
  hostId = ''
  onBark: ((x: number, y: number, z: number) => void) | null = null
  onDelta: ((entries: BodyEntry[]) => void) | null = null
  onEvent: ((kind: WorldEventKind, index: number) => void) | null = null
  onSnapshotRequest: ((from: string) => void) | null = null
  onSnapshot: ((snap: Snapshot) => void) | null = null

  private ws: WebSocket | null = null
  private scene: THREE.Scene
  private hud: HTMLElement
  private sendAcc = 0

  get isHost(): boolean {
    return this.connected && this.myId === this.hostId
  }

  constructor(scene: THREE.Scene, hud: HTMLElement) {
    this.scene = scene
    this.hud = hud
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  connect(lobby: string, nick: string, color: number): Promise<void> {
    // On the vite dev server there's no worker — talk to production
    const host =
      location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'puppy-simulator.astrid.place'
        : location.host
    const url = `wss://${host}/api/lobby/${encodeURIComponent(lobby)}`
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const fail = (): void => reject(new Error('could not join lobby'))
      ws.addEventListener('error', fail)
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ t: 'join', nick, color }))
      })
      ws.addEventListener('message', (e) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(e.data))
        } catch {
          return
        }
        if (msg.t === 'welcome') {
          this.ws = ws
          this.myId = String(msg.id)
          this.hostId = String(msg.host ?? msg.id)
          ws.removeEventListener('error', fail)
          for (const p of msg.players as Array<{ id: string; nick: string; color: number; last: StateMsg | null }>) {
            const rp = new RemotePlayer(this.scene, this.hud, p.id, p.nick, p.color)
            this.remotes.set(p.id, rp)
            if (p.last) rp.applyState({ ...p.last, id: p.id })
          }
          resolve()
        } else if (msg.t === 'joined') {
          const id = String(msg.id)
          if (!this.remotes.has(id)) {
            this.remotes.set(
              id,
              new RemotePlayer(this.scene, this.hud, id, String(msg.nick), Number(msg.color)),
            )
          }
        } else if (msg.t === 'left') {
          const rp = this.remotes.get(String(msg.id))
          if (rp) {
            rp.dispose(this.scene)
            this.remotes.delete(rp.id)
          }
        } else if (msg.t === 'state') {
          this.remotes.get(String(msg.id))?.applyState(msg as unknown as StateMsg)
        } else if (msg.t === 'bark') {
          const p = msg.p as [number, number, number]
          if (this.onBark && Array.isArray(p)) this.onBark(p[0], p[1], p[2])
        } else if (msg.t === 'host') {
          this.hostId = String(msg.id)
        } else if (msg.t === 'delta') {
          if (!this.isHost && this.onDelta && Array.isArray(msg.b)) {
            this.onDelta(msg.b as BodyEntry[])
          }
        } else if (msg.t === 'ev') {
          if (this.onEvent && (msg.k === 'pane' || msg.k === 'bag')) {
            this.onEvent(msg.k, Number(msg.i))
          }
        } else if (msg.t === 'reqsnap') {
          if (this.isHost && this.onSnapshotRequest) this.onSnapshotRequest(String(msg.from))
        } else if (msg.t === 'snapshot') {
          if (!this.isHost && this.onSnapshot) this.onSnapshot(msg.data as Snapshot)
        }
      })
      ws.addEventListener('close', () => {
        if (this.ws === ws) {
          this.ws = null
          for (const rp of this.remotes.values()) rp.dispose(this.scene)
          this.remotes.clear()
        }
      })
    })
  }

  /** Called every frame; throttles to 10Hz internally. */
  maybeSendState(
    dt: number,
    x: number,
    y: number,
    z: number,
    facing: number,
    flags: PoseFlags,
    score: number,
  ): void {
    if (!this.connected) return
    this.sendAcc += dt
    if (this.sendAcc < SEND_INTERVAL) return
    this.sendAcc = 0
    this.ws!.send(
      JSON.stringify({
        t: 'state',
        p: [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100],
        f: Math.round(facing * 100) / 100,
        m: flags,
        sc: score,
      }),
    )
  }

  sendBark(x: number, y: number, z: number): void {
    if (!this.connected) return
    this.ws!.send(JSON.stringify({ t: 'bark', p: [x, y, z] }))
  }

  sendDelta(entries: BodyEntry[]): void {
    if (!this.connected || entries.length === 0) return
    this.ws!.send(JSON.stringify({ t: 'delta', b: entries }))
  }

  sendEvent(kind: WorldEventKind, index: number): void {
    if (!this.connected) return
    this.ws!.send(JSON.stringify({ t: 'ev', k: kind, i: index }))
  }

  requestSnapshot(): void {
    if (!this.connected) return
    this.ws!.send(JSON.stringify({ t: 'reqsnap' }))
  }

  sendSnapshot(to: string, data: Snapshot): void {
    if (!this.connected) return
    this.ws!.send(JSON.stringify({ t: 'snapshot', to, data }))
  }
}
