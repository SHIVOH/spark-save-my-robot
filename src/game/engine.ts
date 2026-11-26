// SPARK: Save My Robot — Zone 1 Vertical Slice (Meadow of Beginnings)
// Raw Three.js game engine driven by a React shell. All geometry procedural.
import * as THREE from 'three';
import { AudioEngine } from './audio';

// ---------------------------------------------------------------------------
// HUD bridge types (discrete state mirrored to React)
// ---------------------------------------------------------------------------
export interface HudState {
  started: boolean;
  questIndex: number;
  questName: string;
  questText: string; // <= 5 words
  cells: number;
  cellsTotal: number;
  showCells: boolean;
  stations: number;
  stationsTotal: number;
  showStations: boolean;
  actionLabel: string | null;
  hint: string | null;
  dashUnlocked: boolean;
  predictionOpen: boolean;
  banner: string | null;
  complete: boolean;
  seatHold: number; // 0..1 while seating the cell
  lantern: boolean;
  boltHope: number; // 0..1 eye-light hope indicator
}

// ---------------------------------------------------------------------------
// Tuning constants (band-1 defaults: generous energy budgets)
// ---------------------------------------------------------------------------
const GAUGE_MAX = 100;
const WALK_SPEED = 7.0;
const SPRINT_SPEED = 11.0;
const DASH_SPEED = 22.0;
const DASH_TIME = 0.32;
const DASH_COST = 6;
const DASH_COOLDOWN = 0.8;
const DRAIN_WALK = 0.35; // per second while walking
const DRAIN_SPRINT = 2.0; // sprinting drains faster than walking (canon)
const DRAIN_IDLE = 0.02;
const WORLD_RADIUS = 82; // playable clamp
const GATE_MIN_CHARGE = 25; // sunset crossing: arrive with charge to spare
const LANTERN_CHARGE = 40; // NOT a full tank — walking (4) fits easily, sprinting (16) just misses
const TRAIL_IDLE_DELAY = 30; // s of no progress -> guidance trail fades in
const HINT_IDLE_DELAY = 45; // s idle -> hint pulse

export const AMBER = new THREE.Color('#ffb020');
export const AMBER_DEEP = new THREE.Color('#e08900');
export const CYAN = new THREE.Color('#37e0e6');
export const ORANGE = new THREE.Color('#ff7a1a');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
export function damp(rate: number, dt: number) {
  return 1 - Math.exp(-dt / rate);
}
export function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
// deterministic rng for scatter
export function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Pooled particle system (one draw call)
// ---------------------------------------------------------------------------
interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  gravity: number;
}

export class ParticleSystem {
  points: THREE.Points;
  private parts: Particle[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, capacity = 700) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) {
      this.parts.push({
        alive: false,
        pos: new THREE.Vector3(0, -999, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        color: new THREE.Color(),
        gravity: 0,
      });
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.42,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(
    pos: THREE.Vector3,
    color: THREE.Color,
    count: number,
    speed = 4,
    up = 3,
    gravity = 6,
    life = 0.8,
  ) {
    let spawned = 0;
    for (const p of this.parts) {
      if (spawned >= count) break;
      if (p.alive) continue;
      p.alive = true;
      p.pos.copy(pos);
      p.vel.set((Math.random() - 0.5) * speed, Math.random() * up, (Math.random() - 0.5) * speed);
      p.life = 0;
      p.maxLife = life * (0.6 + Math.random() * 0.7);
      p.color.copy(color);
      p.gravity = gravity;
      spawned++;
    }
  }

  update(dt: number) {
    const n = this.parts.length;
    for (let i = 0; i < n; i++) {
      const p = this.parts[i];
      if (p.alive) {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.alive = false;
          p.pos.set(0, -999, 0);
        } else {
          p.vel.y -= p.gravity * dt;
          p.pos.addScaledVector(p.vel, dt);
          if (p.pos.y < 0.05) {
            p.pos.y = 0.05;
            p.vel.y *= -0.3;
          }
        }
      }
      this.positions[i * 3] = p.pos.x;
      this.positions[i * 3 + 1] = p.pos.y;
      this.positions[i * 3 + 2] = p.pos.z;
      const fade = p.alive ? 1 - p.life / p.maxLife : 0;
      this.colors[i * 3] = p.color.r * fade;
      this.colors[i * 3 + 1] = p.color.g * fade;
      this.colors[i * 3 + 2] = p.color.b * fade;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Bloom-aware material registry: dormant world desaturated -> full bloom
// ---------------------------------------------------------------------------
export interface BloomMat {
  mat: THREE.MeshStandardMaterial;
  full: THREE.Color;
  dormant: THREE.Color;
}

export function dormantOf(c: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const d = new THREE.Color();
  d.setHSL(hsl.h, hsl.s * 0.18, hsl.l * 0.72 + 0.08);
  return d;
}

// ---------------------------------------------------------------------------
// Procedural art factories (low-poly, flat-shaded, rounded silhouettes)
// ---------------------------------------------------------------------------
export function std(color: string | THREE.Color, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true,
    ...opts,
  });
}

export function regBloom(reg: BloomMat[], mat: THREE.MeshStandardMaterial) {
  reg.push({ mat, full: mat.color.clone(), dormant: dormantOf(mat.color) });
}

export interface Flower {
  group: THREE.Group;
  glow: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  openK: number;
}

function makeFlower(scene: THREE.Scene, reg: BloomMat[], x: number, z: number, scale = 1): Flower {
  const g = new THREE.Group();
  const stemMat = std('#3e8e41');
  regBloom(reg, stemMat);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1.5, 6), stemMat);
  stem.position.y = 0.75;
  g.add(stem);
  const petalMat = std('#ffd166');
  regBloom(reg, petalMat);
  const glow = std('#ffb020', { emissive: AMBER, emissiveIntensity: 1.6 });
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), glow);
  center.position.y = 1.62;
  g.add(center);
  for (let i = 0; i < 6; i++) {
    const petal = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.8, 5), petalMat);
    const a = (i / 6) * Math.PI * 2;
    petal.position.set(Math.cos(a) * 0.42, 1.56, Math.sin(a) * 0.42);
    petal.rotation.z = Math.cos(a) * 1.15;
    petal.rotation.x = -Math.sin(a) * 1.15;
    g.add(petal);
  }
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  scene.add(g);
  return { group: g, glow, pos: new THREE.Vector3(x, 0, z), openK: 0.7 };
}

export interface Harvester {
  group: THREE.Group;
  panel: THREE.Group;
  glowMat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  wakeK: number;
  wakeTarget: number;
}

function makeHarvester(
  scene: THREE.Scene,
  reg: BloomMat[],
  x: number,
  z: number,
  rotY = 0,
): Harvester {
  const g = new THREE.Group();
  const baseMat = std('#b5763c');
  regBloom(reg, baseMat);
  const darkMat = std('#6b4a2f');
  regBloom(reg, darkMat);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, 1.2, 8), baseMat);
  base.position.y = 0.6;
  g.add(base);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 5.2, 6), darkMat);
  mast.position.y = 3.4;
  g.add(mast);
  const panel = new THREE.Group();
  const glowMat = std('#8a6d4f', { emissive: AMBER_DEEP, emissiveIntensity: 0.0 });
  for (let i = -1; i <= 1; i++) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 3.2), glowMat);
    wing.position.set(i * 2.5, 0, 0);
    panel.add(wing);
    const rib = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.3), darkMat);
    rib.position.set(i * 2.5, 0, 0);
    panel.add(rib);
  }
  panel.position.y = 6.2;
  panel.rotation.z = 0.9; // drooped, dormant
  g.add(panel);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  return { group: g, panel, glowMat, pos: new THREE.Vector3(x, 0, z), wakeK: 0, wakeTarget: 0 };
}

export function makeTree(scene: THREE.Scene, reg: BloomMat[], x: number, z: number, s: number, leaf: string) {
  const g = new THREE.Group();
  const trunkMat = std('#8a6844');
  regBloom(reg, trunkMat);
  const leafMat = std(leaf);
  regBloom(reg, leafMat);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.42 * s, 2.4 * s, 6), trunkMat);
  trunk.position.y = 1.2 * s;
  g.add(trunk);
  const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 * s, 0), leafMat);
  c1.position.y = 3.1 * s;
  g.add(c1);
  const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0 * s, 0), leafMat);
  c2.position.set(0.7 * s, 3.9 * s, 0.3 * s);
  g.add(c2);
  g.position.set(x, 0, z);
  g.rotation.y = s * 3.7;
  scene.add(g);
}

export interface Cell {
  group: THREE.Group;
  pos: THREE.Vector3;
  taken: boolean;
  baseY: number;
}

function makeCell(scene: THREE.Scene, x: number, z: number): Cell {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.85, 8),
    std('#3a3f4a', { roughness: 0.5, metalness: 0.4 }),
  );
  g.add(body);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.32, 0.25, 8),
    std('#ffb020', { emissive: AMBER, emissiveIntensity: 1.8 }),
  );
  cap.position.y = 0.55;
  g.add(cap);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.06, 6, 16),
    std('#37e0e6', { emissive: CYAN, emissiveIntensity: 1.2 }),
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.position.set(x, 0.9, z);
  scene.add(g);
  return { group: g, pos: new THREE.Vector3(x, 0.9, z), taken: false, baseY: 0.9 };
}

export interface Station {
  group: THREE.Group;
  ringMat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  visited: boolean;
}

function makeStation(scene: THREE.Scene, reg: BloomMat[], x: number, z: number): Station {
  const g = new THREE.Group();
  const postMat = std('#7c8a99');
  regBloom(reg, postMat);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3.4, 6), postMat);
  post.position.y = 1.7;
  g.add(post);
  const ringMat = std('#ffb020', { emissive: AMBER, emissiveIntensity: 0.7 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.14, 8, 24), ringMat);
  ring.position.y = 3.8;
  g.add(ring);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), ringMat);
  orb.position.y = 3.8;
  g.add(orb);
  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, ringMat, pos: new THREE.Vector3(x, 0, z), visited: false };
}

// ---------------------------------------------------------------------------
// Characters: Spark (kid), Bolt (robot companion), Dyna (zone keeper)
// ---------------------------------------------------------------------------
export interface KidRig {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armR: THREE.Group;
}

export function makeKid(): KidRig {
  const g = new THREE.Group();
  const suit = std('#3f7fbf');
  const skin = std('#f2c49b');
  const hood = std('#2f5f93');
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 4, 10), suit);
  body.position.y = 1.0;
  g.add(body);
  const head = new THREE.Group();
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), skin);
  head.add(face);
  const hoodM = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 8), hood);
  hoodM.position.y = 0.22;
  head.add(hoodM);
  head.position.y = 1.85;
  g.add(head);
  const legMat = std('#2b4a6e');
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 3, 6), legMat);
  legL.position.set(-0.18, 0.35, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.18;
  g.add(legR);
  const armR = new THREE.Group();
  const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 3, 6), suit);
  armMesh.position.y = -0.28;
  armR.add(armMesh);
  armR.position.set(0.5, 1.45, 0);
  g.add(armR);
  const armL = armR.clone();
  armL.position.x = -0.5;
  g.add(armL);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), std('#e08900'));
  pack.position.set(0, 1.25, 0.42);
  g.add(pack);
  return { group: g, body, head, legL, legR, armR };
}

export interface BoltRig {
  group: THREE.Group;
  body: THREE.Mesh;
  eyeL: THREE.Mesh;
  eyeR: THREE.Mesh;
  eyeMatL: THREE.MeshStandardMaterial;
  eyeMatR: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshStandardMaterial;
  head: THREE.Group;
}

export function makeBolt(): BoltRig {
  const g = new THREE.Group();
  // rounded homemade chassis — mismatched warm panels, zero sharp angles
  const bodyMat = std('#ffc44d', { roughness: 0.6, metalness: 0.25 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 12), bodyMat);
  body.position.y = 0.78;
  body.scale.y = 1.12;
  g.add(body);
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.5, 12), std('#4db6ac'));
  belly.position.y = 0.42;
  g.add(belly);
  // amber battery-core visible in the chest cavity
  const coreMat = std('#ffb020', { emissive: AMBER, emissiveIntensity: 0.7 });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8), coreMat);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, 0.85, -0.52);
  g.add(core);
  // conduit spine (amber liquid-light when powered)
  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.6, 3, 6), coreMat);
  spine.position.set(0, 0.8, 0.55);
  g.add(spine);
  // head with the two expressive eye-lights — one slightly larger (canon)
  const head = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), bodyMat);
  head.add(dome);
  const eyeMatL = std('#bffbff', { emissive: CYAN, emissiveIntensity: 1.0 });
  const eyeMatR = std('#bffbff', { emissive: CYAN, emissiveIntensity: 1.0 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), eyeMatL); // the bigger one
  eyeL.position.set(-0.16, 0.05, -0.36);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), eyeMatR);
  eyeR.position.set(0.17, 0.05, -0.37);
  head.add(eyeL, eyeR);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5), bodyMat);
  antenna.position.y = 0.55;
  head.add(antenna);
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), coreMat);
  antTip.position.y = 0.78;
  head.add(antTip);
  head.position.y = 1.62;
  g.add(head);
  const footMat = std('#5a6270');
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), footMat);
    foot.position.set(sx * 0.32, 0.16, 0);
    g.add(foot);
  }
  return { group: g, body, eyeL, eyeR, eyeMatL, eyeMatR, coreMat, head };
}

export interface DynaRig {
  group: THREE.Group;
  head: THREE.Group;
  humMat: THREE.MeshStandardMaterial;
}

function makeDyna(): DynaRig {
  const g = new THREE.Group();
  // grandmotherly keeper: pear-shaped warm body, apron, humming core
  const bodyMat = std('#c98bb9', { roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 12), bodyMat);
  body.position.y = 0.95;
  body.scale.y = 1.2;
  g.add(body);
  const apron = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 12, 10, 0, Math.PI),
    std('#fdf3e3'),
  );
  apron.position.set(0, 0.85, -0.18);
  apron.scale.y = 1.15;
  g.add(apron);
  const head = new THREE.Group();
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), bodyMat);
  head.add(hd);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), std('#8d5f83'));
  bun.position.y = 0.5;
  head.add(bun);
  const humMat = std('#ffe9b0', { emissive: AMBER, emissiveIntensity: 0.9 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), humMat);
  eyeL.position.set(-0.17, 0.05, -0.42);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.17;
  head.add(eyeL, eyeR);
  head.position.y = 2.15;
  g.add(head);
  return { group: g, head, humMat };
}

// ---------------------------------------------------------------------------
// Level layout (one continuous meadow, quests gate progression)
// ---------------------------------------------------------------------------
const SPAWN = new THREE.Vector3(0, 0, 58);
const DOCK_POS = new THREE.Vector3(0, 0, 44);
const FIRST_FLOWER = new THREE.Vector3(6, 0, 39.5);
const TETHER_HARVESTER = new THREE.Vector3(-13, 0, 36);
const DYNA_POS = new THREE.Vector3(16, 0, -10);
const SHRINE_POS = new THREE.Vector3(20, 0, -15);
const GATE_POS = new THREE.Vector3(-58, 0, -52);
const CELL_POS: [number, number][] = [
  [20, 50],
  [-26, 48],
  [32, 22],
  [-30, 16],
  [6, 2],
];
const FLOWER_POS: [number, number][] = [
  [26, 14],
  [-16, -8],
  [32, -28],
  [-40, -22],
  [-52, -46], // pre-marked recharge stop beside the sunset gate (band 1)
  [14, -46],
];
const STATION_POS: [number, number][] = [
  [54, 10],
  [26, -40],
  [-30, -46],
  [-54, -8],
];
const EXTRA_HARVESTERS: [number, number, number][] = [
  [40, 42, 0.6],
  [-42, 44, -0.4],
  [46, -18, 1.4],
  [-16, -56, 0.2],
  [58, -34, -1.0],
];

const QUESTS = [
  { name: 'First Light', text: 'Follow the amber trail' },
  { name: 'Snack-Bar Hunt', text: 'Find 5 charge cells' },
  { name: 'The Tether', text: 'Fix the broken cable' },
  { name: "Dyna's Patrol", text: 'Visit 4 charge stations' },
  { name: 'Sunset Crossing', text: 'Carry lantern, spare charge' },
  { name: "Bolt's Reboot", text: 'Seat the charged cell' },
  { name: 'Free Play', text: 'Explore with charge-dash' },
];

interface Interactable {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  obj: THREE.Object3D;
  pulseMat: THREE.MeshStandardMaterial | null;
  enabled: boolean;
}

interface WirePort {
  id: string;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  pairId: string | null; // null = decoy (wrong port)
  connected: boolean;
}

interface Cable {
  curve: THREE.CatmullRomCurve3;
  mesh: THREE.Mesh;
  pulses: THREE.Mesh[];
  returnPath: boolean;
}

// ---------------------------------------------------------------------------
// The game engine
// ---------------------------------------------------------------------------
export class GameEngine {
  audio = new AudioEngine();
  gauge = 60;
  gaugeMax = GAUGE_MAX;

  private canvas: HTMLCanvasElement;
  private hudCb: (h: HudState) => void;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private hud: HudState = {
    started: false,
    questIndex: 0,
    questName: QUESTS[0].name,
    questText: QUESTS[0].text,
    cells: 0,
    cellsTotal: 5,
    showCells: false,
    stations: 0,
    stationsTotal: 4,
    showStations: false,
    actionLabel: null,
    hint: null,
    dashUnlocked: false,
    predictionOpen: false,
    banner: null,
    complete: false,
    seatHold: 0,
    lantern: false,
    boltHope: 0.35,
  };

  // world
  private bloomMats: BloomMat[] = [];
  private bloomK = 0;
  private particles: ParticleSystem;
  private flowers: Flower[] = [];
  private cells: Cell[] = [];
  private stations: Station[] = [];
  private harvesters: Harvester[] = [];
  private interactables: Interactable[] = [];
  private interactByMesh = new Map<THREE.Object3D, Interactable>();
  private trail!: THREE.InstancedMesh;
  private trailVisible = 0; // 0..1 fade
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private skyDay = new THREE.Color('#bfe8ff');
  private skySunset = new THREE.Color('#ff9e5e');
  private sunsetK = 0;

  // dock / lamp / tether
  private lampBulb!: THREE.MeshStandardMaterial;
  private lampLight!: THREE.PointLight;
  private ports: WirePort[] = [];
  private cables: Cable[] = [];
  private dragPort: WirePort | null = null;
  private dragCable: THREE.Mesh | null = null;
  private dragPoint = new THREE.Vector3();
  private hoverPort: WirePort | null = null;
  private hintPort: WirePort | null = null; // the port the wrong-attempt hint points at
  private wireAttempts = 0;
  private tetherDone = false;
  private lampOn = false;

  // characters
  private kid: KidRig;
  private bolt: BoltRig;
  private dyna: DynaRig;
  private lantern!: THREE.Group;
  private lanternGlow!: THREE.MeshStandardMaterial;
  private gateBarrier!: THREE.Mesh;

  // input / movement state
  private keys = new Set<string>();
  private joy = new THREE.Vector2();
  private joyActive = false;
  private moveTarget: THREE.Vector3 | null = null;
  private pendingInteract: Interactable | null = null;
  private vel = new THREE.Vector3();
  private facing = Math.PI; // facing -z (into the meadow)
  private vy = 0;
  private grounded = true;
  private dashT = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector3();
  private lastTapDir = new Map<string, number>();
  private hitStop = 0;
  private stepT = 0;
  private pluckStep = 0;
  private pingT = 0;
  private idleT = 0;
  private noProgressT = 0;
  private ambientT = 6;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // quest state
  private quest = 0;
  private charging = false;
  private lanternCarried = false;
  private predictionPassed = false;
  private seatHolding = false;
  private seatT = 0;
  private ceremonyT = -1;
  private bloomWaveStarted = false;
  private boltFollows = false;
  private time = 0;

  constructor(canvas: HTMLCanvasElement, hudCb: (h: HudState) => void) {
    this.canvas = canvas;
    this.hudCb = hudCb;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.particles = new ParticleSystem(this.scene);
    this.kid = makeKid();
    this.bolt = makeBolt();
    this.dyna = makeDyna();
    this.buildWorld();
    this.setupLights();
    this.registerInteractables();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // -------------------------------------------------------------------------
  // World assembly
  // -------------------------------------------------------------------------
  private buildWorld() {
    // sky + fog (day -> sunset lerped at runtime)
    this.scene.background = this.skyDay.clone();
    this.scene.fog = new THREE.Fog(this.skyDay.clone(), 70, 190);

    // terrain: gentle meadow disc
    const groundMat = std('#58b04c');
    regBloom(this.bloomMats, groundMat);
    const groundGeo = new THREE.CircleGeometry(95, 48);
    const gp = groundGeo.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const y = gp.getY(i);
      const r = Math.hypot(x, y);
      const h = r > 70 ? (r - 70) * 0.12 * Math.sin(x * 0.15) * Math.cos(y * 0.15) : 0;
      gp.setZ(i, h + Math.sin(x * 0.35) * Math.cos(y * 0.3) * 0.12 * Math.min(1, r / 90));
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    ground.userData.ground = true;

    // grass tufts (instanced)
    const tuftGeo = new THREE.ConeGeometry(0.16, 0.6, 4);
    const tuftMat = std('#6cc25e');
    regBloom(this.bloomMats, tuftMat);
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 320);
    const rng = mulberry(42);
    const dummy = new THREE.Object3D();
    let placed = 0;
    while (placed < 320) {
      const a = rng() * Math.PI * 2;
      const r = 6 + rng() * 74;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x - DOCK_POS.x, z - DOCK_POS.z) < 7) continue;
      dummy.position.set(x, 0.28, z);
      dummy.rotation.y = rng() * Math.PI;
      const s = 0.7 + rng() * 0.9;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      tufts.setMatrixAt(placed++, dummy.matrix);
    }
    tufts.instanceMatrix.needsUpdate = true;
    this.scene.add(tufts);

    // trees
    const treeRng = mulberry(7);
    const keyPoints = [SPAWN, DOCK_POS, FIRST_FLOWER, TETHER_HARVESTER, DYNA_POS, SHRINE_POS, GATE_POS];
    for (let i = 0; i < 26; i++) {
      const a = treeRng() * Math.PI * 2;
      const r = 22 + treeRng() * 55;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (keyPoints.some((p) => Math.hypot(x - p.x, z - p.z) < 9)) continue;
      if (FLOWER_POS.some(([fx, fz]) => Math.hypot(x - fx, z - fz) < 5)) continue;
      if (STATION_POS.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 5)) continue;
      makeTree(this.scene, this.bloomMats, x, z, 0.8 + treeRng() * 0.8, treeRng() > 0.5 ? '#4da44e' : '#63b24f');
    }

    // recharge flowers (first one is the pre-marked tutorial stop)
    this.flowers.push(makeFlower(this.scene, this.bloomMats, FIRST_FLOWER.x, FIRST_FLOWER.z, 1.25));
    for (const [x, z] of FLOWER_POS) {
      this.flowers.push(makeFlower(this.scene, this.bloomMats, x, z, 1.0));
    }

    // dormant solar harvesters
    for (const [x, z, r] of EXTRA_HARVESTERS) {
      this.harvesters.push(makeHarvester(this.scene, this.bloomMats, x, z, r));
    }

    // charge cells (Snack-Bar Hunt)
    for (const [x, z] of CELL_POS) this.cells.push(makeCell(this.scene, x, z));

    // charge stations (Dyna's Orchard Patrol)
    for (const [x, z] of STATION_POS) {
      this.stations.push(makeStation(this.scene, this.bloomMats, x, z));
    }

    this.buildDock();
    this.buildTetherHarvester();
    this.buildShrineAndGate();

    // guidance trail (instanced amber dots)
    const trailMat = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.85 });
    this.trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), trailMat, 22);
    this.trail.count = 22;
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    // characters
    this.kid.group.position.copy(SPAWN);
    this.kid.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(this.kid.group);
    this.bolt.group.position.copy(DOCK_POS).add(new THREE.Vector3(1.5, 0, 1.5));
    this.bolt.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(this.bolt.group);
    this.dyna.group.position.copy(DYNA_POS);
    this.dyna.group.rotation.y = Math.PI * 0.15;
    this.dyna.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(this.dyna.group);
  }

  private buildDock() {
    // Bolt's dock: platform + housing + lamp post
    const platMat = std('#7c8a99');
    regBloom(this.bloomMats, platMat);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.4, 12), platMat);
    plat.position.copy(DOCK_POS).setY(0.2);
    plat.receiveShadow = true;
    this.scene.add(plat);
    const houseMat = std('#5f7d95');
    regBloom(this.bloomMats, houseMat);
    const house = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 1.6), houseMat);
    house.position.copy(DOCK_POS).add(new THREE.Vector3(0, 0.9, 1.4));
    house.castShadow = true;
    this.scene.add(house);
    // lamp post — stays dark until the tether loop is closed
    const lampGroup = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 3.6, 6), platMat);
    post.position.y = 1.8;
    lampGroup.add(post);
    this.lampBulb = std('#334', { emissive: AMBER, emissiveIntensity: 0.05 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), this.lampBulb);
    bulb.position.y = 3.7;
    lampGroup.add(bulb);
    lampGroup.position.copy(DOCK_POS).add(new THREE.Vector3(2.6, 0, -1.5));
    this.scene.add(lampGroup);
    this.lampLight = new THREE.PointLight(AMBER, 0, 26, 1.6);
    this.lampLight.position.copy(lampGroup.position).setY(3.7);
    this.scene.add(this.lampLight);
  }

  private buildTetherHarvester() {
    const h = makeHarvester(this.scene, this.bloomMats, TETHER_HARVESTER.x, TETHER_HARVESTER.z, 0.9);
    this.harvesters.push(h);
    // wiring ports: out (+) and return (-) on harvester, in/out on dock, plus decoys
    const mkPort = (id: string, pos: THREE.Vector3, pairId: string | null, hot: boolean) => {
      const mat = std(hot ? '#ffb020' : '#8a8f98', {
        emissive: hot ? AMBER : new THREE.Color('#444a52'),
        emissiveIntensity: hot ? 1.1 : 0.35,
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.35, 8), mat);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      const port: WirePort = { id, pos: pos.clone(), mesh, mat, pairId, connected: false };
      mesh.userData.port = port;
      this.ports.push(port);
      return port;
    };
    const hv = TETHER_HARVESTER;
    const dk = DOCK_POS;
    mkPort('hOut', new THREE.Vector3(hv.x + 1.6, 1.5, hv.z + 1.2), 'dIn', true);
    mkPort('hRet', new THREE.Vector3(hv.x + 1.6, 0.7, hv.z + 1.6), 'dOut', true);
    mkPort('dIn', new THREE.Vector3(dk.x + 1.3, 1.3, dk.z + 0.6), 'hOut', true);
    mkPort('dOut', new THREE.Vector3(dk.x - 1.3, 1.3, dk.z + 0.6), 'hRet', true);
    mkPort('hGround', new THREE.Vector3(hv.x + 2.0, 0.45, hv.z + 2.4), null, false);
    mkPort('dAux', new THREE.Vector3(dk.x, 2.0, dk.z + 1.5), null, false);
  }

  private buildShrineAndGate() {
    // lantern shrine (Sunset Crossing start)
    const shrineMat = std('#9b8ac4');
    regBloom(this.bloomMats, shrineMat);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 1.1, 8), shrineMat);
    ped.position.copy(SHRINE_POS).setY(0.55);
    ped.castShadow = true;
    this.scene.add(ped);
    // fragile lantern: amber glow in a wire cage
    this.lantern = new THREE.Group();
    this.lanternGlow = std('#ffcf70', { emissive: AMBER, emissiveIntensity: 2.2 });
    const glowBall = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), this.lanternGlow);
    this.lantern.add(glowBall);
    const cage = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.04, 6, 14),
      std('#5a6270', { metalness: 0.5, roughness: 0.4 }),
    );
    this.lantern.add(cage);
    const cage2 = cage.clone();
    cage2.rotation.y = Math.PI / 2;
    this.lantern.add(cage2);
    this.lantern.position.copy(SHRINE_POS).setY(1.6);
    this.scene.add(this.lantern);
    // the gate to new ground: two pillars + light barrier
    const gateMat = std('#b5763c');
    regBloom(this.bloomMats, gateMat);
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 5.4, 8), gateMat);
      pillar.position.copy(GATE_POS).add(new THREE.Vector3(sx * 2.6, 2.7, 0));
      pillar.castShadow = true;
      this.scene.add(pillar);
    }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.7, 0.9), gateMat);
    arch.position.copy(GATE_POS).setY(5.4);
    this.scene.add(arch);
    this.gateBarrier = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 5.0),
      new THREE.MeshBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.gateBarrier.position.copy(GATE_POS).setY(2.6);
    this.scene.add(this.gateBarrier);
  }

  private setupLights() {
    this.hemi = new THREE.HemisphereLight('#dff3ff', '#7ea86a', 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff2d8', 1.6);
    this.sun.position.set(40, 60, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.far = 220;
    this.scene.add(this.sun);
    const amb = new THREE.AmbientLight('#ffffff', 0.25);
    this.scene.add(amb);
  }

  // -------------------------------------------------------------------------
  // Lifecycle & public API (called from React)
  // -------------------------------------------------------------------------
  start() {
    if (this.hud.started) return;
    this.audio.ensure();
    this.setHud({ started: true, banner: QUESTS[0].name });
    window.setTimeout(() => this.clearBanner(), 2200);
    this.clock.start();
    this.loop();
  }

  resumeFreePlay() {
    this.quest = 6;
    this.ceremonyT = -1; // stop updateCeremony from re-firing the completion card
    // clear any stale input left over from the cinematic / card dismissal
    this.keys.clear();
    this.joy.set(0, 0);
    this.joyActive = false;
    this.seatHolding = false;
    this.moveTarget = null;
    this.pendingInteract = null;
    this.setHud({
      complete: false,
      questIndex: 6,
      questName: QUESTS[6].name,
      questText: QUESTS[6].text,
      banner: null,
      hint: null,
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.audio.chargeHumStop();
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // free the WebGL context when switching zones
  }

  setJoystick(x: number, y: number) {
    this.joy.set(x, y);
    this.joyActive = Math.hypot(x, y) > 0.15; // 15% dead zone
    if (this.joyActive) this.markActive();
  }

  private setHud(patch: Partial<HudState>) {
    Object.assign(this.hud, patch);
    this.hudCb({ ...this.hud });
  }

  private clearBanner() {
    if (this.hud.banner) this.setHud({ banner: null });
  }

  private setQuest(i: number) {
    this.quest = i;
    this.noProgressT = 0;
    this.setHud({
      questIndex: i,
      questName: QUESTS[i].name,
      questText: QUESTS[i].text,
      banner: QUESTS[i].name,
      hint: null,
      showCells: i === 1,
      showStations: i === 3,
    });
    window.setTimeout(() => this.clearBanner(), 2400);
    this.audio.stinger(2);
  }

  answerPrediction(i: number) {
    // 1 = just enough (correct — true IF you walk); 0 = plenty, 2 = not enough
    if (i === 1) {
      this.predictionPassed = true;
      this.audio.stinger(3);
      this.setHud({ predictionOpen: false, hint: null, banner: 'Carry the light!' });
      window.setTimeout(() => this.clearBanner(), 2000);
      this.gateBarrier.visible = false;
      this.particles.burst(SHRINE_POS.clone().setY(2), AMBER, 30, 5, 4);
      this.takeLantern();
    } else {
      // friendly, no punishment: Bolt tilts his head, hint re-opens the choice
      this.audio.chirp(false);
      this.setHud({
        hint:
          i === 0
            ? 'Careful — it is a long way. Sprinting wastes spark!'
            : 'It IS enough — walking beats sprinting!',
      });
    }
  }

  setSeatHolding(h: boolean) {
    this.seatHolding = h;
    if (h) this.markActive();
  }

  /** Touch dash button (double-tap / Shift remain primary). */
  dashButton() {
    this.tryDash();
  }

  /** True while a wiring cable drag is active (so touch joystick yields). */
  isWiringDrag(): boolean {
    return this.dragPort !== null;
  }

  tapAction() {
    this.markActive();
    const a = this.currentAction;
    if (!a) return;
    this.audio.pluck(this.pluckStep = (this.pluckStep + 1) % 10);
    this.doInteract(a);
  }

  // -------------------------------------------------------------------------
  // Input: pointer (tap-to-move, interact, wiring drag) + keyboard
  // -------------------------------------------------------------------------
  private pointerStart = { x: 0, y: 0, t: 0, id: -1 };

  handlePointerDown(x: number, y: number) {
    if (!this.hud.started || this.hud.predictionOpen || this.hud.complete) return;
    this.audio.ensure();
    this.pointerStart = { x, y, t: performance.now(), id: 1 };
    // wiring drag?
    if (this.quest === 2 && !this.tetherDone) {
      const port = this.pickPort(x, y);
      if (port && !port.connected) {
        this.dragPort = port;
        this.markActive();
        return;
      }
    }
  }

  handlePointerMove(x: number, y: number) {
    if (this.dragPort) {
      this.groundPoint(x, y, this.dragPoint);
      this.hoverPort = this.pickPort(x, y, 2.2);
    }
  }

  handlePointerUp(x: number, y: number) {
    if (this.dragPort) {
      this.finishWireDrag(x, y);
      return;
    }
    if (!this.hud.started || this.hud.predictionOpen || this.hud.complete) return;
    const dx = x - this.pointerStart.x;
    const dy = y - this.pointerStart.y;
    const dt = performance.now() - this.pointerStart.t;
    if (Math.hypot(dx, dy) < 8 && dt < 400) {
      this.handleTap(x, y);
    }
  }

  private handleTap(x: number, y: number) {
    this.markActive();
    const ndc = this.toNdc(x, y);
    this.raycaster.setFromCamera(ndc, this.camera);
    // interactable first
    const meshes: THREE.Object3D[] = [];
    for (const it of this.interactables) if (it.enabled) meshes.push(it.obj);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length > 0) {
      let obj: THREE.Object3D | null = hits[0].object;
      let it: Interactable | undefined;
      while (obj && !it) {
        it = this.interactByMesh.get(obj);
        obj = obj.parent;
      }
      if (it) {
        const d = this.kid.group.position.distanceTo(it.pos);
        if (d < it.radius + 1.2) {
          this.doInteract(it);
        } else {
          // walk to it, then interact (magnet selection)
          this.moveTarget = it.pos.clone();
          this.pendingInteract = it;
        }
        return;
      }
    }
    // ground: tap-to-move
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, p)) {
      const r = Math.hypot(p.x, p.z);
      if (r > WORLD_RADIUS) p.multiplyScalar(WORLD_RADIUS / r);
      this.moveTarget = p;
      this.pendingInteract = null;
    }
  }

  private toNdc(x: number, y: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private groundPoint(x: number, y: number, out: THREE.Vector3): boolean {
    const ndc = this.toNdc(x, y);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, out);
    return !!hit;
  }

  private pickPort(x: number, y: number, pad = 1.6): WirePort | null {
    const ndc = this.toNdc(x, y);
    this.raycaster.setFromCamera(ndc, this.camera);
    // generous hit spheres for small fingers
    let best: WirePort | null = null;
    let bestD = Infinity;
    for (const p of this.ports) {
      const dist = this.raycaster.ray.distanceToPoint(p.pos);
      if (dist < pad && dist < bestD) {
        bestD = dist;
        best = p;
      }
    }
    return best;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.hud.started) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (this.hud.predictionOpen || this.hud.complete) return;
    this.audio.ensure();
    this.markActive();
    // double-tap a direction = charge-dash (once unlocked)
    const dirKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    if (dirKeys.includes(k) && this.hud.dashUnlocked && !e.repeat) {
      const now = performance.now();
      const last = this.lastTapDir.get(k) ?? -9999;
      if (now - last < 300) this.tryDash();
      this.lastTapDir.set(k, now);
    }
    if (k === 'shift' && this.hud.dashUnlocked && !e.repeat) {
      this.tryDash();
    }
    if (k === ' ' && this.grounded && !e.repeat) {
      this.vy = 7.5;
      this.grounded = false;
      this.audio.jump();
    }
    this.keys.add(k);
    if (dirKeys.includes(k)) this.moveTarget = null;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private markActive() {
    this.idleT = 0;
    if (this.hud.hint) this.setHud({ hint: null });
  }

  // -------------------------------------------------------------------------
  // Wiring minigame (The Tether): drag port-to-port, out-AND-back required
  // -------------------------------------------------------------------------
  private currentAction: Interactable | null = null;
  private camWide = false;

  private finishWireDrag(x: number, y: number) {
    const from = this.dragPort;
    this.dragPort = null;
    if (this.dragCable) {
      this.scene.remove(this.dragCable);
      this.dragCable.geometry.dispose();
      this.dragCable = null;
    }
    const target = this.hoverPort ?? this.pickPort(x, y, 2.2);
    this.hoverPort = null;
    if (!from || !target || target === from || target.connected) return;
    if (target.pairId === from.id) {
      // correct pair: connect
      from.connected = true;
      target.connected = true;
      this.hintPort = null;
      this.connectCable(from, target);
      this.hitStop = 0.06; // 60ms hit-stop on major connection (canon)
      this.audio.snapChime();
      this.particles.burst(target.pos, AMBER, 24, 3.5, 3);
      this.particles.burst(from.pos, AMBER, 24, 3.5, 3);
      const outDone = this.isPortConnected('hOut') && this.isPortConnected('dIn');
      const backDone = this.isPortConnected('dOut') && this.isPortConnected('hRet');
      if (outDone && backDone) {
        this.tetherDone = true;
        this.lampOn = true;
        this.audio.stinger(3);
        this.audio.boltLaugh();
        this.setHud({ boltHope: 0.65 });
        this.setQuest(3);
      } else {
        // one wire is not enough — the lamp stays dark, planted experientially
        this.setHud({ hint: 'One wire is not enough…' });
        this.audio.chirp(false);
      }
    } else {
      // wrong port: friendly orange sparks + kazoo buzz, never punishment
      this.audio.wrongBuzz();
      this.particles.burst(target.pos, ORANGE, 20, 3, 2.5);
      this.wireAttempts++;
      if (this.wireAttempts === 2) {
        // outline the correct port
        const mate = this.ports.find((p) => p.pairId === from.id);
        this.hintPort = mate ?? null;
        this.setHud({ hint: 'The glowing port fits!' });
      } else if (this.wireAttempts >= 3) {
        this.hintPort = this.ports.find((p) => p.pairId === from.id) ?? null;
        this.setHud({ hint: 'Bolt points at the bright port' });
        this.audio.chirp(true);
      }
    }
  }

  private isPortConnected(id: string): boolean {
    return this.ports.find((p) => p.id === id)?.connected ?? false;
  }

  private connectCable(a: WirePort, b: WirePort) {
    const isReturn = a.id === 'dOut' || b.id === 'dOut';
    const mid = a.pos.clone().lerp(b.pos, 0.5);
    mid.y = 0.22;
    const q1 = a.pos.clone().lerp(b.pos, 0.25);
    q1.y = lerp(a.pos.y, 0.3, 0.6);
    const q2 = a.pos.clone().lerp(b.pos, 0.75);
    q2.y = lerp(b.pos.y, 0.3, 0.6);
    const curve = new THREE.CatmullRomCurve3([a.pos.clone(), q1, mid, q2, b.pos.clone()]);
    const mat = std(isReturn ? '#c98a2e' : '#ffb020', {
      emissive: isReturn ? AMBER_DEEP : AMBER,
      emissiveIntensity: isReturn ? 0.55 : 1.4, // return path dimmed but visible
    });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.09, 6), mat);
    this.scene.add(mesh);
    const pulses: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(isReturn ? 0.1 : 0.15, 8, 6),
        new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: isReturn ? 0.55 : 1 }),
      );
      this.scene.add(p);
      pulses.push(p);
    }
    this.cables.push({ curve, mesh, pulses, returnPath: isReturn });
    a.mat.emissiveIntensity = 2.0;
    b.mat.emissiveIntensity = 2.0;
  }

  private updateDragCable() {
    if (!this.dragPort) return;
    if (this.dragCable) {
      this.scene.remove(this.dragCable);
      this.dragCable.geometry.dispose();
    }
    const end = this.hoverPort ? this.hoverPort.pos.clone() : this.dragPoint.clone().setY(0.4);
    const mid = this.dragPort.pos.clone().lerp(end, 0.5);
    mid.y = Math.max(0.3, Math.min(this.dragPort.pos.y, end.y) * 0.5);
    const curve = new THREE.CatmullRomCurve3([this.dragPort.pos.clone(), mid, end]);
    this.dragCable = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 16, 0.07, 6),
      new THREE.MeshBasicMaterial({ color: AMBER }),
    );
    this.scene.add(this.dragCable);
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------
  private registerInteractables() {
    const add = (
      id: string,
      pos: THREE.Vector3,
      radius: number,
      obj: THREE.Object3D,
      pulseMat: THREE.MeshStandardMaterial | null,
    ) => {
      const it: Interactable = { id, pos, radius, obj, pulseMat, enabled: true };
      this.interactables.push(it);
      obj.traverse((o) => this.interactByMesh.set(o, it));
      obj.userData.interactId = id;
      return it;
    };
    this.flowers.forEach((f, i) => add(`flower:${i}`, f.pos, 3.0, f.group, f.glow));
    add('shrine', SHRINE_POS, 3.2, this.lantern, this.lanternGlow);
    add('gate', GATE_POS, 4.2, this.gateBarrier, null);
    add('bolt', this.bolt.group.position, 2.8, this.bolt.group, this.bolt.coreMat);
    add('dyna', this.dyna.group.position, 3.6, this.dyna.group, this.dyna.humMat);
  }

  private doInteract(it: Interactable) {
    this.idleT = 0;
    this.noProgressT = 0;
    switch (true) {
      case it.id.startsWith('flower:'): {
        // stepping into a flower charges by proximity too; a tap confirms with a pluck
        this.audio.pluck(this.pluckStep = (this.pluckStep + 1) % 10);
        this.particles.burst(it.pos.clone().setY(1.6), AMBER, 10, 2, 2);
        break;
      }
      case it.id === 'shrine': {
        if (this.quest === 4 && !this.lanternCarried && !this.predictionPassed) {
          // predict the cost in pictograms BEFORE moving (mastery gate)
          this.setHud({ predictionOpen: true, hint: null });
          this.audio.chirp(true);
        } else if (this.quest === 4 && this.predictionPassed && !this.lanternCarried) {
          this.takeLantern();
        }
        break;
      }
      case it.id === 'gate': {
        if (this.quest === 4 && this.lanternCarried) {
          if (this.gauge >= GATE_MIN_CHARGE) {
            this.audio.stinger(3);
            this.particles.burst(GATE_POS.clone().setY(3), AMBER, 40, 6, 6);
            this.setQuest(5);
          } else {
            // no fail: the pre-marked flower beside the gate tops you up
            this.audio.chirp(false);
            this.setHud({ hint: 'Need more spark — the flower helps!' });
          }
        }
        break;
      }
      case it.id === 'bolt': {
        this.audio.boltLaugh(this.quest < 5);
        this.particles.burst(this.bolt.group.position.clone().setY(2), CYAN, 8, 2, 2);
        break;
      }
      case it.id === 'dyna': {
        this.audio.dynaHum();
        const lines: Record<number, string> = {
          0: 'Dyna hums: follow the amber lights',
          1: 'Dyna hums: cells sparkle in the grass',
          2: 'Dyna hums: power needs a way home',
          3: 'Dyna hums: visit my four stations, dear',
          4: 'Dyna hums: carry the lantern gently',
        };
        this.setHud({ hint: lines[this.quest] ?? 'Dyna hums happily' });
        break;
      }
    }
  }

  private takeLantern() {
    this.lanternCarried = true;
    this.gauge = LANTERN_CHARGE; // the lantern gives a modest fill — budgeting matters now
    this.audio.pickup();
    this.setHud({ lantern: true, banner: 'To the sunset gate!' });
    window.setTimeout(() => this.clearBanner(), 2000);
    const it = this.interactables.find((i) => i.id === 'shrine');
    if (it) it.enabled = false;
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.time += dt;
    this.idleT += dt;
    this.noProgressT += dt;

    if (this.hud.started && !this.hud.predictionOpen && !this.hud.complete) {
      if (this.ceremonyT < 0) {
        // no walking / quest triggers during the reboot cinematic
        this.updatePlayer(dt);
        this.updateQuests(dt);
      }
      this.updateEnergy(dt);
    }
    if (this.ceremonyT >= 0) this.updateCeremony(dt);
    this.updateBolt(dt);
    this.updateDyna(dt);
    this.updateWorldFx(dt);
    this.updateCamera(dt);
    this.updateTrail(dt);
    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private moveInput(): THREE.Vector2 {
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.joyActive) {
      x += this.joy.x;
      y += -this.joy.y;
    }
    const v = new THREE.Vector2(x, y);
    if (v.length() > 1) v.normalize();
    return v;
  }

  private tryDash() {
    if (this.ceremonyT >= 0) return; // no dashing during the cinematic
    if (this.dashCd > 0 || this.gauge < DASH_COST || !this.hud.dashUnlocked) return;
    const inp = this.moveInput();
    if (inp.length() < 0.1) {
      this.dashDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    } else {
      this.dashDir.set(inp.x, 0, -inp.y).normalize();
    }
    this.dashT = DASH_TIME;
    this.dashCd = DASH_COOLDOWN;
    this.gauge -= DASH_COST;
    this.audio.dash();
    this.particles.burst(this.kid.group.position.clone().setY(0.6), AMBER, 14, 3, 2);
  }

  private updatePlayer(dt: number) {
    const pos = this.kid.group.position;
    const inp = this.moveInput();
    const tired = this.gauge <= 0;
    const wantSprint =
      !this.hud.dashUnlocked && (this.keys.has('shift') || (this.joyActive && this.joy.length() > 0.92));
    this.dashCd = Math.max(0, this.dashCd - dt);

    const desired = new THREE.Vector3();
    if (this.dashT > 0) {
      this.dashT -= dt;
      desired.copy(this.dashDir).multiplyScalar(DASH_SPEED);
      // amber dash trail
      this.particles.burst(pos.clone().setY(0.5), AMBER, 2, 0.6, 0.8, 2, 0.5);
    } else if (inp.length() > 0.1) {
      const sprinting = wantSprint && !tired;
      const speed = sprinting ? SPRINT_SPEED : tired ? WALK_SPEED * 0.7 : WALK_SPEED;
      desired.set(inp.x, 0, -inp.y).normalize().multiplyScalar(speed);
      this.moveTarget = null;
      this.pendingInteract = null;
      this.sprinting = sprinting;
    } else if (this.moveTarget) {
      const to = this.moveTarget.clone().sub(pos);
      to.y = 0;
      const d = to.length();
      if (d < 0.5) {
        this.moveTarget = null;
        if (this.pendingInteract) {
          const it = this.pendingInteract;
          this.pendingInteract = null;
          if (pos.distanceTo(it.pos) < it.radius + 1.2) this.doInteract(it);
        }
      } else {
        const sprinting = wantSprint && !tired;
        const speed = sprinting ? SPRINT_SPEED : tired ? WALK_SPEED * 0.7 : WALK_SPEED;
        desired.copy(to.normalize()).multiplyScalar(Math.min(speed, d * 3));
        this.sprinting = sprinting;
      }
    } else {
      this.sprinting = false;
    }

    // eased acceleration
    this.vel.x = lerp(this.vel.x, desired.x, damp(0.12, dt));
    this.vel.z = lerp(this.vel.z, desired.z, damp(0.12, dt));
    pos.x += this.vel.x * dt;
    pos.z += this.vel.z * dt;
    const r = Math.hypot(pos.x, pos.z);
    if (r > WORLD_RADIUS) {
      pos.x *= WORLD_RADIUS / r;
      pos.z *= WORLD_RADIUS / r;
    }

    // jump / gravity
    if (!this.grounded) {
      this.vy -= 22 * dt;
      pos.y += this.vy * dt;
      if (pos.y <= 0) {
        pos.y = 0;
        this.grounded = true;
        this.audio.land();
        // 12% squash on landing
        this.kid.group.scale.set(1.08, 0.88, 1.08);
        this.particles.burst(pos.clone(), new THREE.Color('#cbbd93'), 6, 2, 1);
      }
    }
    // recover squash + run bob + lean
    const squash = this.kid.group.scale;
    squash.x = lerp(squash.x, 1, damp(0.09, dt));
    squash.y = lerp(squash.y, 1, damp(0.09, dt));
    squash.z = lerp(squash.z, 1, damp(0.09, dt));
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.6) {
      const targetFacing = Math.atan2(this.vel.x, this.vel.z);
      let diff = targetFacing - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * damp(0.08, dt);
      this.kid.legL.rotation.x = Math.sin(this.time * 10) * 0.7 * Math.min(1, speed / WALK_SPEED);
      this.kid.legR.rotation.x = -Math.sin(this.time * 10) * 0.7 * Math.min(1, speed / WALK_SPEED);
      this.kid.body.position.y = 1.0 + Math.abs(Math.sin(this.time * 10)) * 0.06;
      this.stepT -= dt * speed;
      if (this.stepT <= 0 && this.grounded) {
        this.stepT = 3.2;
        this.audio.footstep();
      }
    } else {
      this.kid.legL.rotation.x = lerp(this.kid.legL.rotation.x, 0, damp(0.1, dt));
      this.kid.legR.rotation.x = lerp(this.kid.legR.rotation.x, 0, damp(0.1, dt));
    }
    this.kid.group.rotation.y = this.facing;

    // lantern floats beside the kid while carried
    if (this.lanternCarried) {
      const lp = pos.clone();
      lp.x += Math.sin(this.facing + 1.2) * 0.9;
      lp.z += Math.cos(this.facing + 1.2) * 0.9;
      lp.y = 1.7 + Math.sin(this.time * 2.2) * 0.12;
      this.lantern.position.lerp(lp, damp(0.15, dt));
    }
  }

  private updateEnergy(dt: number) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const sprinting = this.sprinting === true;
    if (this.dashT <= 0) {
      if (speed > 0.6) this.gauge -= (sprinting ? DRAIN_SPRINT : DRAIN_WALK) * dt;
      else this.gauge -= DRAIN_IDLE * dt;
    }
    // recharge flowers restore the gauge (band 1: proximity is enough)
    let nearFlower = false;
    for (const f of this.flowers) {
      const d = this.kid.group.position.distanceTo(f.pos);
      if (d < 2.8 && this.gauge < GAUGE_MAX - 0.5) {
        nearFlower = true;
        this.gauge = Math.min(GAUGE_MAX, this.gauge + 45 * dt);
        if (Math.random() < dt * 8) {
          this.particles.burst(f.pos.clone().setY(1.6), AMBER, 3, 1.5, 2);
        }
        if (this.quest === 0 && this.gauge >= 99) {
          this.audio.chargeHumStop();
          this.audio.stinger(2);
          this.boltFollows = true;
          this.setHud({ boltHope: 0.5 });
          this.setQuest(1);
        }
      }
    }
    if (nearFlower && !this.charging) {
      this.charging = true;
      this.audio.chargeHumStart();
    } else if (!nearFlower && this.charging) {
      this.charging = false;
      this.audio.chargeHumStop();
    }
    this.gauge = clamp(this.gauge, 0, GAUGE_MAX);
  }

  // -------------------------------------------------------------------------
  // Quest logic
  // -------------------------------------------------------------------------
  private objectivePos(): THREE.Vector3 | null {
    const p = this.kid.group.position;
    switch (this.quest) {
      case 0:
        return FIRST_FLOWER;
      case 1: {
        let best: Cell | null = null;
        let bd = Infinity;
        for (const c of this.cells) {
          if (c.taken) continue;
          const d = p.distanceTo(c.pos);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        return best ? best.pos : null;
      }
      case 2:
        return new THREE.Vector3(TETHER_HARVESTER.x + 1.6, 0, TETHER_HARVESTER.z + 1.4);
      case 3: {
        let best: Station | null = null;
        let bd = Infinity;
        for (const s of this.stations) {
          if (s.visited) continue;
          const d = p.distanceTo(s.pos);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        return best ? best.pos : null;
      }
      case 4:
        return this.lanternCarried ? GATE_POS : SHRINE_POS;
      case 5:
        return this.bolt.group.position;
      default:
        return null;
    }
  }

  private updateQuests(dt: number) {
    const p = this.kid.group.position;

    // quest 1: collect 5 depleted charge cells
    if (this.quest === 1) {
      for (const c of this.cells) {
        if (c.taken) continue;
        // lamp reveals glints of remaining cells once powered (after first cell)
        if (this.hud.cells > 0 && Math.random() < dt * 2.5) {
          this.particles.burst(c.pos.clone().setY(1.6), CYAN, 1, 0.4, 0.8, 1, 1.2);
        }
        if (p.distanceTo(c.pos) < 1.9) {
          c.taken = true;
          c.group.visible = false;
          this.gauge = Math.min(GAUGE_MAX, this.gauge + 20);
          const n = this.hud.cells + 1;
          this.audio.pickup();
          this.particles.burst(c.pos, AMBER, 22, 4, 4);
          this.noProgressT = 0;
          this.setHud({ cells: n });
          if (n === 1) this.setHud({ hint: "Bolt's lamp reveals glints!" });
          if (n >= this.hud.cellsTotal) {
            this.setHud({ hint: null });
            this.setQuest(2);
          }
        }
      }
    }

    // quest 3: visit 4 charge stations on one tank (flowers refill en route)
    if (this.quest === 3) {
      for (const s of this.stations) {
        if (s.visited) continue;
        if (p.distanceTo(s.pos) < 3.4) {
          s.visited = true;
          s.ringMat.emissiveIntensity = 2.4;
          const n = this.hud.stations + 1;
          this.audio.dynaCheer();
          this.particles.burst(s.pos.clone().setY(3.8), AMBER, 26, 4, 3);
          this.noProgressT = 0;
          this.setHud({ stations: n });
          if (n >= this.hud.stationsTotal) {
            this.setQuest(4);
          }
        }
      }
    }

    // quest 5: beat 1 — the seat (2s hold builds anticipation)
    if (this.quest === 5 && this.ceremonyT < 0) {
      const nearBolt = p.distanceTo(this.bolt.group.position) < 4;
      if (this.seatHolding && nearBolt) {
        this.seatT += dt;
        this.setHud({ seatHold: clamp(this.seatT / 2, 0, 1) });
        if (Math.random() < dt * 10) {
          this.particles.burst(this.bolt.group.position.clone().setY(1.2), AMBER, 2, 1, 1.5);
        }
        if (this.seatT >= 2) {
          this.seatHolding = false;
          this.beginCeremony();
        }
      } else if (this.seatT > 0) {
        this.seatT = 0;
        this.setHud({ seatHold: 0 });
      }
    }

    // contextual action button (bottom-right)
    this.updateActionButton();

    // idle hint pulse after 45s (canon)
    if (this.idleT > HINT_IDLE_DELAY && !this.hud.hint) {
      const hints = [
        'The amber lights show the way',
        'Cells sparkle — walk into them',
        'Drag a cable port to port',
        'Dyna cheers at every station',
        'Predict, then carry the light',
      ];
      this.setHud({ hint: hints[this.quest] ?? 'Follow the amber trail' });
      this.idleT = HINT_IDLE_DELAY; // hold the hint until input
    }

    // idle ping every 2.5s toward nearest interactable
    this.pingT += dt;
    if (this.pingT > 2.5) {
      this.pingT = 0;
      if (this.idleT > 2.5) {
        const obj = this.objectivePos();
        if (obj && p.distanceTo(obj) < 26) this.audio.ping();
      }
    }
  }

  private updateActionButton() {
    const p = this.kid.group.position;
    let action: Interactable | null = null;
    let label: string | null = null;
    if (this.quest === 5 && this.ceremonyT < 0) {
      if (p.distanceTo(this.bolt.group.position) < 4) label = 'Hold to seat the cell';
    } else {
      // collect in-range interactables; before quest 4 the shrine and gate
      // are scenery (their interactions are quest-gated), so no dead buttons
      const inRange: Interactable[] = [];
      for (const it of this.interactables) {
        if (!it.enabled) continue;
        if (this.quest < 4 && (it.id === 'shrine' || it.id === 'gate')) continue;
        if (p.distanceTo(it.pos) < it.radius) inRange.push(it);
      }
      // quest-critical targets take priority over companions (Bolt follows the
      // kid everywhere and would otherwise shadow the shrine/gate buttons)
      let pool = inRange;
      if (this.quest === 4) {
        const key = inRange.filter((it) => it.id === 'shrine' || it.id === 'gate');
        if (key.length > 0) pool = key;
      }
      let bd = Infinity;
      for (const it of pool) {
        const d = p.distanceTo(it.pos);
        if (d < bd) {
          bd = d;
          action = it;
        }
      }
      if (action) {
        if (action.id.startsWith('flower:')) label = 'Recharge flower';
        else if (action.id === 'shrine')
          label = this.predictionPassed ? 'Take the lantern' : 'How much charge?';
        else if (action.id === 'gate')
          label = this.lanternCarried ? 'Cross with the lantern' : 'A quiet gate';
        else if (action.id === 'bolt') label = 'Say hi to Bolt';
        else if (action.id === 'dyna') label = 'Talk to Dyna';
      }
    }
    this.currentAction = action;
    if (label !== this.hud.actionLabel) this.setHud({ actionLabel: label });
  }

  // -------------------------------------------------------------------------
  // The six-beat restoration ceremony: Bolt's First Reboot
  // -------------------------------------------------------------------------
  private beginCeremony() {
    this.ceremonyT = 0;
    this.hitStop = 0.06;
    this.gauge = GAUGE_MAX;
    // cinematic: freeze any in-progress input so the kid stands still
    this.keys.clear();
    this.joy.set(0, 0);
    this.joyActive = false;
    this.moveTarget = null;
    this.pendingInteract = null;
    this.vel.set(0, 0, 0);
    this.audio.snapChime();
    this.audio.ceremony();
    this.particles.burst(this.bolt.group.position.clone().setY(1), AMBER, 40, 5, 5);
    this.setHud({ seatHold: 0, actionLabel: null, banner: 'Bolt wakes up!' });
    window.setTimeout(() => this.clearBanner(), 2200);
    // stagger the wake wave outward from Bolt
    const bp = this.bolt.group.position;
    for (const h of this.harvesters) {
      const d = h.pos.distanceTo(bp);
      (h as Harvester & { wakeDelay?: number }).wakeDelay = d * 0.045;
    }
  }

  private updateCeremony(dt: number) {
    this.ceremonyT += dt;
    const t = this.ceremonyT;
    const bp = this.bolt.group.position;

    // beat 2: amber flow races through his conduits, camera pulls wide
    this.camWide = t > 0.4 && t < 11.5;
    this.bolt.coreMat.emissiveIntensity = 0.7 + Math.min(2.2, t * 1.2);
    if (t < 2 && Math.random() < dt * 14) {
      this.particles.burst(bp.clone().setY(0.9), AMBER, 3, 2, 2.5);
    }

    // beat 3: the bloom — desaturated -> full color sweep, machines wake in a wave
    if (t > 2 && this.bloomK < 1) {
      this.bloomWaveStarted = true;
      this.bloomK = clamp(this.bloomK + dt / 4.2, 0, 1);
      this.applyBloom();
    }
    if (this.bloomWaveStarted) {
      for (const h of this.harvesters) {
        const delay = (h as Harvester & { wakeDelay?: number }).wakeDelay ?? 0;
        if (t - 2 > delay) {
          if (h.wakeTarget === 0) {
            this.particles.burst(h.pos.clone().setY(6), AMBER, 16, 3, 2);
          }
          h.wakeTarget = 1;
        }
      }
    }

    // beat 4: Bolt's moment — eye-lights brighten, happy hop, three beeps and a squeak
    if (t > 4.6 && t < 6.2) {
      const hopT = (t - 4.6) / 1.6;
      this.bolt.group.position.y = Math.abs(Math.sin(hopT * Math.PI * 2)) * 1.1;
    } else if (t >= 6.2 && t < 9) {
      this.bolt.group.position.y = 0;
    }
    if (!this.laughed && t > 4.8) {
      this.laughed = true;
      this.audio.boltLaugh(false);
      this.setHud({ boltHope: 1 });
    }

    // beat 5: new verb unlocked — charge-dash
    if (!this.dashShown && t > 7.2) {
      this.dashShown = true;
      this.setHud({
        dashUnlocked: true,
        banner: 'New move: CHARGE-DASH!',
        hint: 'Double-tap a direction, or press Shift',
      });
      this.audio.stinger(3);
      window.setTimeout(() => this.clearBanner(), 2600);
    }

    // beat 6: rest cue + completion card
    if (t > 10.2 && !this.restCued) {
      this.restCued = true;
      this.setHud({ banner: 'Zone 1 complete', hint: null });
      window.setTimeout(() => this.clearBanner(), 2400);
      // Bolt powers down gently (rest cue), eyes stay warm
      this.boltResting = true;
    }
    if (t > 12.6 && !this.hud.complete) {
      this.setHud({ complete: true });
      try {
        localStorage.setItem('spark-zone1-complete', '1');
      } catch {
        /* ignore */
      }
    }
  }

  private laughed = false;
  private dashShown = false;
  private restCued = false;
  private boltResting = false;

  private applyBloom() {
    const k = easeInOut(this.bloomK);
    for (const b of this.bloomMats) {
      b.mat.color.copy(b.dormant).lerp(b.full, k);
    }
    const bg = this.skyDay.clone().lerp(this.skySunset, this.sunsetK * (1 - k * 0.5));
    this.scene.background = bg;
    if (this.scene.fog) this.scene.fog.color.copy(bg);
  }

  // -------------------------------------------------------------------------
  // Companions, world FX, camera, trail
  // -------------------------------------------------------------------------
  private sprinting = false;
  private dynaHumT = 0;
  private lookAtPt = new THREE.Vector3(0, 2, 40);

  private updateBolt(dt: number) {
    const b = this.bolt.group;
    const hope = this.hud.boltHope;
    // eye-lights double as the hope HUD; warm and dim when weak, never cold
    const flicker = hope < 0.6 ? Math.sin(this.time * 13) * 0.12 : 0;
    const eyeI = this.boltResting ? 0.4 : 0.35 + hope * 1.6 + flicker;
    this.bolt.eyeMatL.emissiveIntensity = eyeI;
    this.bolt.eyeMatR.emissiveIntensity = eyeI;
    if (this.ceremonyT < 0) {
      this.bolt.coreMat.emissiveIntensity = 0.4 + hope * 0.8;
    }
    if (this.boltResting) {
      // rest cue: settles down, slow breathing bob
      b.rotation.z = lerp(b.rotation.z, 0.12, damp(0.5, dt));
      b.position.y = Math.sin(this.time * 1.2) * 0.03;
      return;
    }
    if (this.boltFollows && this.ceremonyT < 0) {
      const kp = this.kid.group.position;
      const behind = new THREE.Vector3(Math.sin(this.facing - 0.7), 0, Math.cos(this.facing - 0.7));
      const target = kp.clone().addScaledVector(behind, 2.4);
      const to = target.sub(b.position.clone().setY(0));
      const d = to.length();
      if (d > 0.3) {
        const speed = Math.min(d * 2.2, hope > 0.6 ? 8.5 : 4.2); // weak = slower (scripted state)
        b.position.addScaledVector(to.normalize(), Math.min(d, speed * dt));
        b.rotation.y = Math.atan2(to.x, to.z);
      }
      // bounce-step while playful
      const bounce = hope > 0.6 ? Math.abs(Math.sin(this.time * 7)) * 0.12 : Math.abs(Math.sin(this.time * 4)) * 0.05;
      b.position.y = Math.max(b.position.y, bounce);
    }
    // head tracks Spark when close
    const d = b.position.distanceTo(this.kid.group.position);
    if (d < 6) {
      this.bolt.head.rotation.y = Math.sin(this.time * 0.8) * 0.3;
    }
  }

  private updateDyna(dt: number) {
    const g = this.dyna.group;
    g.position.y = Math.sin(this.time * 1.6) * 0.06;
    this.dyna.head.rotation.y = Math.sin(this.time * 0.6) * 0.4;
    this.dynaHumT += dt;
    const d = g.position.distanceTo(this.kid.group.position);
    if (d < 9 && this.dynaHumT > 7) {
      this.dynaHumT = 0;
      this.audio.dynaHum();
    }
  }

  private updateWorldFx(dt: number) {
    // flowers sway + pulse
    for (const f of this.flowers) {
      f.group.rotation.z = Math.sin(this.time * 1.3 + f.pos.x) * 0.06;
      f.glow.emissiveIntensity = 1.3 + Math.sin(this.time * 2.4 + f.pos.z) * 0.5;
      const targetScale = 1 + this.bloomK * 0.25;
      const s = lerp(f.group.scale.x, targetScale * (f.pos.equals(FIRST_FLOWER) ? 1.25 : 1), dt);
      f.group.scale.setScalar(s);
    }
    // cells bob & spin
    for (const c of this.cells) {
      if (c.taken) continue;
      c.group.rotation.y += dt * 1.6;
      c.group.position.y = c.baseY + Math.sin(this.time * 2 + c.pos.x) * 0.15;
    }
    // station rings
    for (const s of this.stations) {
      s.group.rotation.y += dt * (s.visited ? 1.4 : 0.3);
      if (!s.visited) s.ringMat.emissiveIntensity = 0.7 + Math.sin(this.time * 2.6) * 0.35;
    }
    // harvesters wake: panels rise, glow returns
    for (const h of this.harvesters) {
      if (h.wakeK !== h.wakeTarget) {
        h.wakeK = lerp(h.wakeK, h.wakeTarget, damp(0.9, dt));
        h.panel.rotation.z = lerp(0.9, 0.12, h.wakeK);
        h.glowMat.emissiveIntensity = h.wakeK * 0.9;
      }
    }
    // wiring ports pulse; hovered port blooms
    for (const port of this.ports) {
      if (port.connected) {
        port.mesh.scale.setScalar(1);
        continue;
      }
      const base = port.pairId ? 1.1 : 0.35;
      port.mat.emissiveIntensity =
        port === this.hoverPort
          ? 3.0
          : port === this.hintPort
            ? 3.2 + Math.sin(this.time * 9) * 1.2 // unmistakably brighter than the rest
            : base + Math.sin(this.time * 5.2 + port.pos.x) * 0.4;
      const hs = port === this.hintPort ? 1.5 + Math.sin(this.time * 9) * 0.2 : 1;
      port.mesh.scale.setScalar(hs);
    }
    if (this.dragPort) this.updateDragCable();
    // current flows along connected cables (~visible liquid pulses; return dimmed)
    for (const c of this.cables) {
      const len = c.curve.getLength();
      const speed = (c.returnPath ? 1.4 : 2.2) / len;
      c.pulses.forEach((p, i) => {
        const t = (this.time * speed + i / c.pulses.length) % 1;
        p.position.copy(c.curve.getPoint(t));
      });
    }
    // lamp: dark until out-AND-back is closed
    const lampTarget = this.lampOn ? 2.4 : 0.05;
    this.lampBulb.emissiveIntensity = lerp(this.lampBulb.emissiveIntensity, lampTarget, damp(0.4, dt));
    this.lampLight.intensity = lerp(this.lampLight.intensity, this.lampOn ? 26 : 0, damp(0.4, dt));
    // gate barrier shimmer
    if (this.gateBarrier.visible) {
      (this.gateBarrier.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(this.time * 3) * 0.08;
    }
    // sunset shift during the crossing
    if (this.quest === 4 && this.predictionPassed && this.sunsetK < 1) {
      this.sunsetK = clamp(this.sunsetK + dt / 6, 0, 1);
      this.applyBloom();
      this.sun.color.lerpColors(new THREE.Color('#fff2d8'), new THREE.Color('#ff8c42'), this.sunsetK);
      this.sun.position.lerpVectors(new THREE.Vector3(40, 60, 20), new THREE.Vector3(-55, 16, -30), this.sunsetK);
      this.hemi.intensity = lerp(0.9, 0.6, this.sunsetK);
    }
    // lantern flicker (fragile, warm)
    this.lanternGlow.emissiveIntensity = 2.0 + Math.sin(this.time * 7) * 0.3;
    // ambient pad
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 7 + Math.random() * 5;
      if (this.hud.started) this.audio.ambient();
    }
  }

  private updateCamera(dt: number) {
    const kp = this.kid.group.position;
    let target: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.camWide) {
      const bp = this.bolt.group.position;
      target = bp.clone().add(new THREE.Vector3(0, 22, 30));
      look = bp.clone().setY(2);
    } else {
      target = kp.clone().add(new THREE.Vector3(0, 13, 15));
      look = kp.clone().add(new THREE.Vector3(0, 2, 0));
    }
    // smooth dolly (~0.8s easing)
    this.camera.position.lerp(target, damp(0.4, dt));
    this.lookAtPt.lerp(look, damp(0.3, dt));
    this.camera.lookAt(this.lookAtPt);
  }

  private updateTrail(dt: number) {
    const obj = this.objectivePos();
    const wantsTrail =
      this.hud.started && !this.hud.complete && obj !== null &&
      (this.quest === 0 || (this.noProgressT > TRAIL_IDLE_DELAY && this.quest < 5));
    this.trailVisible = lerp(this.trailVisible, wantsTrail ? 1 : 0, damp(0.4, dt));
    const mat = this.trail.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.85 * this.trailVisible;
    this.trail.visible = this.trailVisible > 0.02;
    if (!this.trail.visible || !obj) return;
    const from = this.kid.group.position;
    const dummy = new THREE.Object3D();
    const n = 22;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      const p = from.clone().lerp(obj, t);
      p.y = 0.35 + Math.sin(this.time * 3 - t * 8) * 0.18;
      dummy.position.copy(p);
      const s = 0.7 + Math.sin(this.time * 4 - t * 10) * 0.3;
      dummy.scale.setScalar(Math.max(0.15, s));
      dummy.updateMatrix();
      this.trail.setMatrixAt(i, dummy.matrix);
    }
    this.trail.instanceMatrix.needsUpdate = true;
  }
}
