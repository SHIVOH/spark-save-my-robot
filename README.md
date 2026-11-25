# SPARK: Save My Robot

**A game where a curious kid saves their dying robot — by learning real robotics.**

![Gameplay](docs/screenshot-gameplay.png)

Bolt the robot is running out of charge. Explore an open world, harvest energy,
wire real circuits, and learn how robots sense, think, and act — one quest at a
time. Built for kids aged 6–14.

## ▶ Play it now

**https://shivoh.github.io/spark-save-my-robot/** — runs right in your browser
(desktop or phone), no install. Progress saves locally on your device.

## Give feedback

Played it? We'd love to hear from you — especially if you're a kid or
played with one! Open a
[playtest feedback issue](https://github.com/SHIVOH/spark-save-my-robot/issues/new)
and tell us: what was fun, what was confusing, where you got stuck.

## Status: Zones 1–2 playable

Zone 1 — *Meadow of Beginnings* — energy and circuits:

- **First Light** — follow the amber trail and charge the first flower
- **Snack-Bar Hunt** — collect 5 charge cells scattered across the meadow
- **The Tether** — wire a real circuit (out *and* back!) to wake the harvester
- **Dyna's Patrol** — visit Dyna's 4 charge stations
- **Sunset Crossing** — predict your charge, carry the lantern, cross the gate
- **Bolt's Reboot** — the ceremony, and a new move: **charge-dash**

Zone 2 — *Sensor Gardens* — how robots sense the world (unlocks after Zone 1):

- **Morning Bloom** — analog light: flowers bloom by *how much* light they get
- **Bat Hollow** — ultrasonic echolocation + a brake rule for two minecarts
- **Vine Crossing** — binary touch: felt vine or not?
- **Flicker's Jitters** — noise vs signal: tune out false positives
- **The Right Eyes** — pick the right sensor for each obstacle
- **Bolt's Eyes Open** — the ceremony, and a new move: **scan-ping**

## Run it locally

```bash
npm install
npm run dev      # dev server
npm run build    # production build -> dist/
```

Works on desktop (WASD / arrows / Shift) and touch (floating joystick,
tap-to-move, dash button).

## Tech

- TypeScript + React 19 + Vite
- Three.js (raw game loop, procedural low-poly world — no game engine)
- WebAudio-synthesized sound (no audio assets)
- Tailwind CSS + shadcn/ui for the HUD

## Project layout

```
src/game/engine.ts   # the whole game: quests, wiring, energy, companions
src/game/audio.ts    # synthesized sound effects
src/pages/Home.tsx   # React HUD + touch input layer
```

## Roadmap

1. Playtest Zones 1–2 with kids, iterate on feedback ← **we are here**
2. Zones 3+ — new robotics concepts per the game design document
3. Native iOS/Android build
