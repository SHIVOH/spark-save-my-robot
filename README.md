# SPARK: Save My Robot

**A game where a curious kid saves their dying robot — by learning real robotics.**

![Gameplay](docs/screenshot-gameplay.png)

Bolt the robot is running out of charge. Explore an open world, harvest energy,
wire real circuits, and learn how robots sense, think, and act — one quest at a
time. Built for kids aged 6–14.

## Status: Zones 1 and 2 playable

Tuned for ages 9–11 (numbers and sliders). Zone 1 — *Meadow of Beginnings* (power):

- **First Light** — follow the amber trail and charge the first flower
- **Snack-Bar Hunt** — collect 5 charge cells scattered across the meadow
- **The Tether** — wire a real circuit (out *and* back!) to wake the harvester
- **Dyna's Patrol** — visit Dyna's 4 charge stations
- **Sunset Crossing** — predict your charge, carry the lantern, cross the gate
- **Bolt's Reboot** — the ceremony, and a new move: **charge-dash**

Zone 2 — *Sensor Gardens* (sensors), unlocked by finishing Zone 1:

- **Morning Bloom** — carry the light-globe to wake 5 flowers and grow a bridge
- **Bat Hollow** — ping for distance, then set the brake rule for two minecarts
- **Vine Crossing** — swing across the gorge on the vines that light up
- **Flicker's Jitters** — set a threshold that ignores cloud shadows but catches dusk
- **The Right Eyes** — fit the right sensor for each obstacle and predict its reading
- **Bolt's Eyes Open** — the ceremony, and a new move: **scan-ping**

A playtest link is shared privately with testers during this phase.

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
src/game/engine.ts         # Zone 1 engine (+ shared rigs, particles, helpers)
src/game/zone2/engine.ts   # Zone 2 engine
src/game/audio.ts          # synthesized sound effects (zone2/audio.ts extends it)
src/pages/Home.tsx         # zone picker
src/pages/Zone1Game.tsx    # Zone 1 HUD + touch input layer
src/pages/Zone2Game.tsx    # Zone 2 HUD + touch input layer
```

## Roadmap

1. Playtest Zones 1–2 with kids, iterate on feedback
2. Zones 3+ — new robotics concepts per the game design document
3. Native iOS/Android build
