# 🐶 Puppy Simulator

Goat Simulator, but you're a puppy. Cause chaos in a procedurally-built
neighbourhood: break windows, bark furniture across rooms, climb trees,
belly-flop into pools, burst open treat bags, and snuggle on capybaras
(they don't mind — they don't mind anything).

**Play it:** https://puppy-simulator.astrid.place

## Controls

- **WASD** — move
- **Shift** — zoomies
- **Space** — jump
- **E** — bark / snuggle (context-sensitive)
- **Mouse drag** — look · **scroll** — zoom

## Development

```sh
npm install
npm run dev      # dev server at localhost:5173
npm run build    # typecheck + production build
npm run deploy   # build + wrangler deploy
```

Built with [Three.js](https://threejs.org) (rendering),
[cannon-es](https://github.com/pmndrs/cannon-es) (physics), and Vite.
Everything is procedural — no art or audio assets; all sounds are
synthesized with WebAudio.

### Debug tools

- `debug.html?px=..&py=..&pz=..&tx=..&ty=..&tz=..` — render one settled
  frame from any camera pose
- `sim.html?sx=..&sz=..&dx=..&dz=..&speed=..` — headless physics test that
  drives a puppy-like body and logs its trajectory
- `node scripts/shot.mjs <name> "<query>" [page]` — screenshot either page
  via headless Chrome
