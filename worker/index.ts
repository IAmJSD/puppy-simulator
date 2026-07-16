// Multiplayer server: one Durable Object per lobby, relaying player state
// and bark events over WebSockets. The oldest connected player is the
// physics HOST: their simulation is authoritative, streamed as deltas and
// snapshots which the DO relays. Static assets fall through to ASSETS.

export interface Env {
  LOBBY: DurableObjectNamespace
  ASSETS: Fetcher
}

const MAX_PLAYERS = 8

interface PlayerInfo {
  id: string
  nick: string
  color: number
  last: unknown | null // most recent state message, replayed to joiners
}

export class Lobby {
  private sessions = new Map<WebSocket, PlayerInfo>()
  private host: WebSocket | null = null

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }
    if (this.sessions.size >= MAX_PLAYERS) {
      return new Response('lobby full', { status: 429 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.handleSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  private send(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj))
    } catch {
      // dead socket; close handler cleans up
    }
  }

  private handleSocket(ws: WebSocket): void {
    ws.accept()
    const info: PlayerInfo = {
      id: crypto.randomUUID().slice(0, 8),
      nick: 'pup',
      color: 0,
      last: null,
    }

    ws.addEventListener('message', (e) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : '')
      } catch {
        return
      }
      const joined = this.sessions.has(ws)
      if (msg.t === 'join' && !joined) {
        info.nick = String(msg.nick ?? 'pup').slice(0, 14) || 'pup'
        info.color = Math.max(0, Math.min(5, Number(msg.color) || 0))
        this.sessions.set(ws, info)
        if (!this.host) this.host = ws
        const players = [...this.sessions.values()]
          .filter((p) => p.id !== info.id)
          .map((p) => ({ id: p.id, nick: p.nick, color: p.color, last: p.last }))
        this.send(ws, {
          t: 'welcome',
          id: info.id,
          host: this.sessions.get(this.host)?.id ?? info.id,
          players,
        })
        this.broadcast(ws, { t: 'joined', id: info.id, nick: info.nick, color: info.color })
      } else if (!joined) {
        return
      } else if (msg.t === 'state') {
        info.last = msg
        this.broadcast(ws, { ...msg, t: 'state', id: info.id })
      } else if (msg.t === 'bark') {
        this.broadcast(ws, { t: 'bark', id: info.id, p: msg.p })
      } else if (msg.t === 'ev') {
        // One-shot world events (window broke, treat bag burst) — relay all
        this.broadcast(ws, { t: 'ev', k: msg.k, i: msg.i })
      } else if (msg.t === 'delta') {
        // Authoritative physics stream — host only
        if (ws === this.host) this.broadcast(ws, { t: 'delta', b: msg.b })
      } else if (msg.t === 'npc') {
        // Authoritative NPC stream — host only
        if (ws === this.host) this.broadcast(ws, { t: 'npc', n: msg.n })
      } else if (msg.t === 'reqsnap') {
        if (this.host && this.host !== ws) {
          this.send(this.host, { t: 'reqsnap', from: info.id })
        }
      } else if (msg.t === 'snapshot' && ws === this.host) {
        for (const [sock, p] of this.sessions) {
          if (p.id === msg.to) {
            this.send(sock, { t: 'snapshot', data: msg.data })
            break
          }
        }
      }
    })

    const drop = (): void => {
      if (this.sessions.delete(ws)) {
        this.broadcast(null, { t: 'left', id: info.id })
        if (this.host === ws) {
          const next = this.sessions.keys().next()
          this.host = next.done ? null : next.value
          if (this.host) {
            const hostId = this.sessions.get(this.host)?.id
            this.broadcast(null, { t: 'host', id: hostId })
          }
        }
      }
    }
    ws.addEventListener('close', drop)
    ws.addEventListener('error', drop)
  }

  private broadcast(except: WebSocket | null, obj: unknown): void {
    const data = JSON.stringify(obj)
    for (const ws of this.sessions.keys()) {
      if (ws === except) continue
      try {
        ws.send(data)
      } catch {
        // dead socket; close handler will clean it up
      }
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/api\/lobby\/([\w-]{1,32})$/)
    if (m) {
      const id = env.LOBBY.idFromName(m[1].toLowerCase())
      return env.LOBBY.get(id).fetch(req)
    }
    return env.ASSETS.fetch(req)
  },
}
