// Multiplayer server: one Durable Object per lobby, relaying player state
// and bark events over WebSockets. Static assets fall through to ASSETS.

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
      if (msg.t === 'join' && !this.sessions.has(ws)) {
        info.nick = String(msg.nick ?? 'pup').slice(0, 14) || 'pup'
        info.color = Math.max(0, Math.min(5, Number(msg.color) || 0))
        this.sessions.set(ws, info)
        const players = [...this.sessions.values()]
          .filter((p) => p.id !== info.id)
          .map((p) => ({ id: p.id, nick: p.nick, color: p.color, last: p.last }))
        ws.send(JSON.stringify({ t: 'welcome', id: info.id, players }))
        this.broadcast(ws, { t: 'joined', id: info.id, nick: info.nick, color: info.color })
      } else if (msg.t === 'state' && this.sessions.has(ws)) {
        info.last = msg
        this.broadcast(ws, { ...msg, t: 'state', id: info.id })
      } else if (msg.t === 'bark' && this.sessions.has(ws)) {
        this.broadcast(ws, { t: 'bark', id: info.id, p: msg.p })
      }
    })

    const drop = (): void => {
      if (this.sessions.delete(ws)) {
        this.broadcast(null, { t: 'left', id: info.id })
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
