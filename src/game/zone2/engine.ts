// SPARK: Save My Robot — Zone 2 Vertical Slice (Sensor Gardens)
// Separate engine module: Zone 1 (src/game/engine.ts) is untouched; shared
// helpers, rigs and the particle system are imported from it. All geometry
// procedural, all audio synthesized. Hero color: cyan (data/signals).
import * as THREE from 'three';
import {
  AMBER,
  CYAN,
  ORANGE,
  ParticleSystem,
  clamp,
  damp,
  easeInOut,
  lerp,
  makeBolt,
  makeKid,
  makeTree,
  mulberry,
  regBloom,
  std,
  type BloomMat,
  type BoltRig,
  type KidRig,
} from '../engine';
import { Zone2Audio } from './audio';

// ---------------------------------------------------------------------------
// HUD bridge (discrete state mirrored to React; per-frame values are public)
// ---------------------------------------------------------------------------
export interface Zone2HudState {
  started: boolean;
  questIndex: number;
  questName: string;
  questText: string; // <= 5 words
  blooms: number;
  bloomsTotal: number;
  showBlooms: boolean;
  actionLabel: string | null;
  hint: string | null;
  dashUnlocked: boolean;
  scanUnlocked: boolean;
  sensorOpen: boolean; // sensor module-swap modal (quest 5)
  sensorStage: 'pick' | 'predict';
  sensorObstacle: number; // which obstacle the modal is for (0..2)
  sliderOpen: boolean; // minecart stop-threshold slider modal (quest 2)
  sliderValue: number;
  calmMode: boolean; // live calm-threshold slider visible (quest 4)
  banner: string | null;
  complete: boolean;
  seatHold: number; // 0..1 while seating the sensor modules
  boltHope: number;
}

// ---------------------------------------------------------------------------
// Tuning (band 1: generous radii, big margins, no fail states)
// ---------------------------------------------------------------------------
const WALK_SPEED = 7.0;
const DASH_SPEED = 22.0;
const DASH_TIME = 0.32;
const DASH_COST = 6;
const DASH_COOLDOWN = 0.8;
const DRAIN_WALK = 0.3;
const DRAIN_IDLE = 0.02;
const WORLD_RADIUS = 82;
const GLOBE_RANGE = 9.5; // light-globe reach for flower meters
const HINT_IDLE_DELAY = 45;
const TRAIL_IDLE_DELAY = 30;

// ---------------------------------------------------------------------------
// Level layout — one continuous Sensor Gardens zone
// ---------------------------------------------------------------------------
const SPAWN = new THREE.Vector3(0, 0, 62);
const GATE_POS = new THREE.Vector3(0, 0, 56);
const FLICKER_MEET = new THREE.Vector3(0, 0, 50);
const GLOBE_POS = new THREE.Vector3(4, 0, 40); // light-globe pedestal
const BLOOM_POS: [number, number][] = [
  [-14, 33],
  [-5, 32],
  [4, 31],
  [13, 32],
  [22, 33],
];
const RAVINE = { zMin: 22, zMax: 29, xMin: -34, xMax: 34, bridgeX: 4, bridgeHalf: 3 };
const CAVE_POS = new THREE.Vector3(-38, 0, -8); // Bat Hollow center
const CAVE_R = 17;
const CAVE_ENTRY = new THREE.Vector3(-30, 0, 0);
const CART_START_X = -50;
const CART_EDGE_X = -28; // broken track / drop edge
const CART_Z = -12;
const CART_CONSOLE = new THREE.Vector3(-44, 0, -7);
const GORGE = { xMin: 2, xMax: 38, zMin: -36, zMax: -26 };
const VINE_START = new THREE.Vector3(8, 0, -22);
const VINE_POINTS: [number, number][] = [
  [12, -27.5],
  [17, -29.5],
  [22, -32],
  [27, -34.5],
  [34, -40], // far ledge
];
const PLAZA_POS = new THREE.Vector3(-8, 0, -48); // Flicker's Jitters
const GREENHOUSE_POS = new THREE.Vector3(30, 0, -52);
const DAIS_POS = new THREE.Vector3(44, 0, -58); // finale dais

// The Right Eyes: three obstacles, correct sensor index per obstacle
// sensors: 0 = light, 1 = color, 2 = ultrasonic
const OBSTACLES = [
  { pos: new THREE.Vector3(22, 0, -47), through: new THREE.Vector3(26, 0, -47), correct: 0, predCorrect: 1 },
  { pos: new THREE.Vector3(30, 0, -54), through: new THREE.Vector3(30, 0, -57), correct: 1, predCorrect: 0 },
  { pos: new THREE.Vector3(38, 0, -53), through: new THREE.Vector3(41, 0, -53), correct: 2, predCorrect: 0 },
];

const QUESTS = [
  { name: 'Into the Gardens', text: 'Follow the cyan trail' },
  { name: 'Morning Bloom', text: 'Wake 5 sleeping flowers' },
  { name: 'Bat Hollow', text: 'Ping, then stop the cart' },
  { name: 'Vine Crossing', text: 'Swing the lit vines' },
  { name: "Flicker's Jitters", text: 'Calm clouds, catch dusk' },
  { name: 'The Right Eyes', text: 'Fit the right sensor' },
  { name: "Bolt's Eyes Open", text: 'Hold to seat sensors' },
  { name: 'Free Play', text: 'Explore with scan-ping' },
];

const HINTS = [
  'The cyan lights show the way',
  'Carry the light-globe close',
  'Tap to ping — numbers tell distance',
  'The lit vine is the safe one',
  'Clouds are noise, dusk is real',
  'Match the sense to the obstacle',
  'Hold the button by Bolt',
];

// ---------------------------------------------------------------------------
// Zone 2 object types
// ---------------------------------------------------------------------------
interface Interactable {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  obj: THREE.Object3D;
  pulseMat: THREE.MeshStandardMaterial | null;
  enabled: boolean;
}

interface BloomFlower {
  group: THREE.Group;
  petals: THREE.Mesh[];
  petalMat: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshStandardMaterial;
  meterMats: THREE.MeshStandardMaterial[]; // radial light-meter bars
  pos: THREE.Vector3;
  charge: number; // 0..1, drains when the globe is parked away
  bloomed: boolean;
  openK: number;
}

interface Vine {
  group: THREE.Group;
  vineMat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3; // landing point at vine base
  step: number;
  correct: boolean;
  it: Interactable;
}

interface Pingable {
  obj: THREE.Object3D;
  mat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  flash: number; // seconds of flash remaining
}

interface PingRing {
  mesh: THREE.Mesh;
  r: number;
  speed: number;
  maxR: number;
  from: THREE.Vector3;
}

interface TagSprite {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  ttl: number;
}

// ---------------------------------------------------------------------------
// Zone 2 procedural factories
// ---------------------------------------------------------------------------
export interface FlickerRig {
  group: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  tailMat: THREE.MeshStandardMaterial;
  eyeMat: THREE.MeshStandardMaterial;
}

/** Flicker: a nervous firefly-drone — jittery hover, blinking cyan tail. */
function makeFlicker(): FlickerRig {
  const g = new THREE.Group();
  const bodyMat = std('#8a93a8', { roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), bodyMat);
  body.scale.y = 0.9;
  g.add(body);
  const eyeMat = std('#ffffff', { emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.6 });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), eyeMat);
  eye.position.set(0, 0.05, -0.2);
  g.add(eye);
  const wingMat = std('#cfe8ff', {
    transparent: true,
    opacity: 0.55,
    roughness: 0.3,
  });
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.16), wingMat);
  wingL.position.set(-0.26, 0.14, 0.05);
  g.add(wingL);
  const wingR = wingL.clone();
  wingR.position.x = 0.26;
  g.add(wingR);
  const tailMat = std('#37e0e6', { emissive: CYAN, emissiveIntensity: 2.0 });
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), tailMat);
  tail.position.set(0, -0.05, 0.26);
  g.add(tail);
  return { group: g, wingL, wingR, tailMat, eyeMat };
}

/** Morning Bloom flower: sleeping machine-flower + radial light meter. */
function makeBloomFlower(reg: BloomMat[], x: number, z: number): BloomFlower {
  const g = new THREE.Group();
  const stemMat = std('#4a7c59');
  regBloom(reg, stemMat);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 1.7, 6), stemMat);
  stem.position.y = 0.85;
  g.add(stem);
  const potMat = std('#7c8a99');
  regBloom(reg, potMat);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.5, 8), potMat);
  pot.position.y = 0.25;
  g.add(pot);
  // petals start closed (cyan), bloom open to amber (canon: cyan -> amber)
  const petalMat = std('#37e0e6', { emissive: CYAN, emissiveIntensity: 0.25 });
  const petals: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const petal = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 5), petalMat);
    const a = (i / 6) * Math.PI * 2;
    petal.position.set(Math.cos(a) * 0.18, 1.85, Math.sin(a) * 0.18);
    g.add(petal);
    petals.push(petal);
  }
  const coreMat = std('#5a6a72', { emissive: CYAN, emissiveIntensity: 0.15 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), coreMat);
  core.position.y = 1.9;
  g.add(core);
  // radial light-meter: 10 bars in a ring above the flower, fill = charge
  const meterMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 10; i++) {
    const m = std('#263238', { emissive: CYAN, emissiveIntensity: 0.05 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), m);
    const a = (i / 10) * Math.PI * 2;
    bar.position.set(Math.cos(a) * 0.85, 2.9, Math.sin(a) * 0.85);
    g.add(bar);
    meterMats.push(m);
  }
  g.position.set(x, 0, z);
  return {
    group: g,
    petals,
    petalMat,
    coreMat,
    meterMats,
    pos: new THREE.Vector3(x, 0, z),
    charge: 0,
    bloomed: false,
    openK: 0,
  };
}

/** The light-globe: a glowing orb the kid carries along the terrace. */
function makeLightGlobe(): { group: THREE.Group; glowMat: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const glowMat = std('#dffcff', { emissive: CYAN, emissiveIntensity: 2.4 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), glowMat);
  orb.position.y = 1.1;
  g.add(orb);
  const baseMat = std('#5f7d95', { metalness: 0.3, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 0.5, 8), baseMat);
  base.position.y = 0.25;
  g.add(base);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.05, 8, 20),
    std('#37e0e6', { emissive: CYAN, emissiveIntensity: 1.2 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 1.1;
  g.add(halo);
  return { group: g, glowMat };
}

/** A hanging vine for the crossing. */
function makeVine(x: number, z: number): { group: THREE.Group; vineMat: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const vineMat = std('#3f6b4f', { emissive: CYAN, emissiveIntensity: 0.04 });
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6.4, 6), vineMat);
  rope.position.y = 7.5 - 3.2;
  g.add(rope);
  const leafMat = std('#57a05e');
  const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), leafMat);
  tuft.position.y = 1.1;
  g.add(tuft);
  const grip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), vineMat);
  grip.position.y = 1.55;
  g.add(grip);
  g.position.set(x, 0, z);
  return { group: g, vineMat };
}

/** The minecart on rails (Bat Hollow). */
function makeCart(): { group: THREE.Group; lampMat: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const bodyMat = std('#b5763c', { metalness: 0.2, roughness: 0.6 });
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.1), bodyMat);
  tub.position.y = 0.85;
  g.add(tub);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 1.3), std('#8a5a2e'));
  rim.position.y = 1.34;
  g.add(rim);
  const wheelMat = std('#3a3f4a', { metalness: 0.5, roughness: 0.4 });
  for (const sx of [-0.55, 0.55]) {
    for (const sz of [-0.62, 0.62]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 10), wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(sx, 0.24, sz);
      g.add(w);
    }
  }
  const lampMat = std('#37e0e6', { emissive: CYAN, emissiveIntensity: 1.4 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), lampMat);
  lamp.position.set(0.85, 1.0, 0);
  g.add(lamp);
  return { group: g, lampMat };
}

/** Tag icon sprite for scan-ping (cyan disc + white glyph). */
function makeTagSprite(scene: THREE.Scene): TagSprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(1.4);
  sprite.visible = false;
  scene.add(sprite);
  return { sprite, canvas, tex, ttl: 0 };
}

function drawTag(tag: TagSprite, glyph: string) {
  const ctx = tag.canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(23,154,160,0.92)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#bffbff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 64, 68);
  tag.tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// The Zone 2 game engine — same public interface as the Zone 1 engine
// ---------------------------------------------------------------------------
export class Zone2Engine {
  audio = new Zone2Audio();
  gauge = 80;
  gaugeMax = 100;
  // per-frame values read directly by the React rAF loop (bypass re-renders)
  readingText = ''; // cyan chest chip (distance number etc.)
  calmStartle = 0; // Flicker's live startle meter 0..100
  calmThreshold = 55; // player-set calm threshold 0..100

  private canvas: HTMLCanvasElement;
  private hudCb: (h: Zone2HudState) => void;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private hud: Zone2HudState = {
    started: false,
    questIndex: 0,
    questName: QUESTS[0].name,
    questText: QUESTS[0].text,
    blooms: 0,
    bloomsTotal: 5,
    showBlooms: false,
    actionLabel: null,
    hint: null,
    dashUnlocked: false,
    scanUnlocked: false,
    sensorOpen: false,
    sensorStage: 'pick',
    sensorObstacle: 0,
    sliderOpen: false,
    sliderValue: 4,
    calmMode: false,
    banner: null,
    complete: false,
    seatHold: 0,
    boltHope: 0.3,
  };

  // world
  private bloomMats: BloomMat[] = [];
  private bloomK = 0;
  private particles: ParticleSystem;
  private interactables: Interactable[] = [];
  private interactByMesh = new Map<THREE.Object3D, Interactable>();
  private trail!: THREE.InstancedMesh;
  private trailVisible = 0;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private skyDim = new THREE.Color('#8fa6b8'); // Bolt's broken eyes: dim world
  private skyFull = new THREE.Color('#bfe8ff'); // crisp full color (finale)

  // quest elements
  private globe!: { group: THREE.Group; glowMat: THREE.MeshStandardMaterial };
  private globeCarried = false;
  private bloomFlowers: BloomFlower[] = [];
  private petalBridge!: THREE.Group;
  private bridgeK = 0;
  private bridgeOpen = false;
  private pingables: Pingable[] = [];
  private rings: PingRing[] = [];
  private pingsFired = 0;
  private caveK = 0;
  private cart!: { group: THREE.Group; lampMat: THREE.MeshStandardMaterial };
  private cartState: 'idle' | 'rolling' | 'braking' | 'returning' = 'idle';
  private cartX = CART_START_X;
  private cartSpeed = 0;
  private cartThreshold = 4;
  private cartRattleT = 0;
  private vines: Vine[] = [];
  private vineStep = 0;
  private swingT = -1; // >=0 while a swing animation runs
  private swingFrom = new THREE.Vector3();
  private swingTo = new THREE.Vector3();
  private swingWrong = false;
  private onVine = false; // kid hangs on a vine mid-gorge
  private boltDetour: THREE.Vector3[] = [];
  // Flicker's Jitters
  private jitterActive = false;
  private jitterT = 0;
  private jitterPhase: 'clouds' | 'dusk' = 'clouds';
  private calmT = 0;
  private cloudShadowT = 0;
  private startleTarget = 0;
  private duskK = 0;
  private clouds: THREE.Mesh[] = [];
  private shadowBlobs: THREE.Mesh[] = [];
  // The Right Eyes
  private obstacleStage = 0; // 0..3
  private obstacleCleared = [false, false, false];
  private obstacleMeshes: THREE.Group[] = [];
  private bumpT = -1;
  private bumpFrom = new THREE.Vector3();
  private bumpDir = new THREE.Vector3();
  // scan-ping tags
  private tags: TagSprite[] = [];
  private scanCd = 0;

  // characters
  private kid: KidRig;
  private bolt: BoltRig;
  private flicker: FlickerRig;
  private flickerFollows = false;
  private flickerStartleT = -1;
  private flickerChirpT = 4;
  private chestCanvas!: HTMLCanvasElement;
  private chestTex!: THREE.CanvasTexture;

  // input / movement state
  private keys = new Set<string>();
  private joy = new THREE.Vector2();
  private joyActive = false;
  private moveTarget: THREE.Vector3 | null = null;
  private pendingInteract: Interactable | null = null;
  private vel = new THREE.Vector3();
  private facing = Math.PI;
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
  private pointerStart = { x: 0, y: 0, t: 0 };
  private currentAction: Interactable | null = null;
  private camWide = false;
  private watchCart = false;
  private lookAtPt = new THREE.Vector3(0, 2, 56);

  // quest state
  private quest = 0;
  private seatHolding = false;
  private seatT = 0;
  private ceremonyT = -1;
  private meetStage = 0; // 0 = not met, 1 = startle skit running, 2 = done
  private meetT = 0;
  private time = 0;
  private laughed = false;
  private scanShown = false;
  private restCued = false;
  private boltResting = false;

  constructor(canvas: HTMLCanvasElement, hudCb: (h: Zone2HudState) => void) {
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
    this.flicker = makeFlicker();
    this.buildWorld();
    this.setupLights();
    this.registerInteractables();
    this.applyBloom(); // world starts dim (bloomK = 0)
    try {
      this.hud.dashUnlocked = localStorage.getItem('spark-zone1-complete') === '1';
    } catch {
      /* ignore */
    }
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // -------------------------------------------------------------------------
  // World assembly
  // -------------------------------------------------------------------------
  private buildWorld() {
    this.scene.background = this.skyDim.clone();
    this.scene.fog = new THREE.Fog(this.skyDim.clone(), 55, 160);

    // terrain: gentle garden disc
    const groundMat = std('#4d9e68');
    regBloom(this.bloomMats, groundMat);
    const groundGeo = new THREE.CircleGeometry(95, 48);
    const gp = groundGeo.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const y = gp.getY(i);
      const r = Math.hypot(x, y);
      const h = r > 70 ? (r - 70) * 0.12 * Math.sin(x * 0.15) * Math.cos(y * 0.15) : 0;
      gp.setZ(i, h + Math.sin(x * 0.3) * Math.cos(y * 0.27) * 0.12 * Math.min(1, r / 90));
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.buildGateAndTerraces();
    this.buildRavineAndBridge();
    this.buildCave();
    this.buildGorge();
    this.buildPlaza();
    this.buildGreenhouse();
    this.buildDecor();

    // guidance trail (cyan dots — data is cyan in Zone 2)
    const trailMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.85 });
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
    this.bolt.group.position.copy(SPAWN).add(new THREE.Vector3(1.6, 0, 1.6));
    this.bolt.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(this.bolt.group);
    // Bolt's chest glyph: cyan reading chip (distance numbers etc.)
    this.chestCanvas = document.createElement('canvas');
    this.chestCanvas.width = 128;
    this.chestCanvas.height = 64;
    this.chestTex = new THREE.CanvasTexture(this.chestCanvas);
    const chip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.25),
      new THREE.MeshBasicMaterial({ map: this.chestTex, transparent: true }),
    );
    chip.position.set(0, 0.92, -0.6);
    chip.rotation.y = Math.PI;
    this.bolt.group.add(chip);
    // Bolt's eyes start dark (broken sensors): dim, stuttering red on arrival
    this.bolt.eyeMatL.emissiveIntensity = 0.15;
    this.bolt.eyeMatR.emissiveIntensity = 0.15;

    this.flicker.group.position.copy(FLICKER_MEET).add(new THREE.Vector3(1.5, 2.2, -1));
    this.scene.add(this.flicker.group);

    // scan-ping tag sprite pool
    for (let i = 0; i < 8; i++) this.tags.push(makeTagSprite(this.scene));
  }

  private buildGateAndTerraces() {
    // garden gate: two pillars + open arch
    const gateMat = std('#7c8a99');
    regBloom(this.bloomMats, gateMat);
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 5.0, 8), gateMat);
      pillar.position.copy(GATE_POS).add(new THREE.Vector3(sx * 2.6, 2.5, 0));
      pillar.castShadow = true;
      this.scene.add(pillar);
    }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.7, 0.9), gateMat);
    arch.position.copy(GATE_POS).setY(5.0);
    this.scene.add(arch);
    const signMat = std('#37e0e6', { emissive: CYAN, emissiveIntensity: 1.2 });
    const sign = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.12, 8, 24), signMat);
    sign.position.copy(GATE_POS).setY(5.9);
    this.scene.add(sign);

    // terraces: stepped planters along the ravine rim
    const terrMat = std('#8a9a7a');
    regBloom(this.bloomMats, terrMat);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5 + i * 0.02, 2.2), terrMat);
      t.position.set(-20 + i * 8.5, 0.25, 37.5 + (i % 2) * 1.6);
      t.receiveShadow = true;
      this.scene.add(t);
    }

    // the five sleeping machine-flowers (Morning Bloom)
    for (const [x, z] of BLOOM_POS) {
      const f = makeBloomFlower(this.bloomMats, x, z);
      this.bloomFlowers.push(f);
      this.scene.add(f.group);
    }

    // light-globe on its pedestal
    this.globe = makeLightGlobe();
    this.globe.group.position.copy(GLOBE_POS);
    this.scene.add(this.globe.group);
    const pedMat = std('#5f7d95');
    regBloom(this.bloomMats, pedMat);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 0.4, 8), pedMat);
    ped.position.copy(GLOBE_POS).setY(0.05);
    this.scene.add(ped);
  }

  private buildRavineAndBridge() {
    // ravine: sunken dark strip crossing the terraces
    const w = RAVINE.xMax - RAVINE.xMin;
    const d = RAVINE.zMax - RAVINE.zMin;
    const cx = (RAVINE.xMin + RAVINE.xMax) / 2;
    const cz = (RAVINE.zMin + RAVINE.zMax) / 2;
    const pitMat = std('#26343a');
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pitMat);
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(cx, -2.6, cz);
    this.scene.add(pit);
    const wallMat = std('#5a6a5a');
    regBloom(this.bloomMats, wallMat);
    for (const sz of [RAVINE.zMin, RAVINE.zMax]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, 0.5), wallMat);
      wall.position.set(cx, -1.3, sz);
      this.scene.add(wall);
    }
    // petal bridge: hidden until all five flowers bloom
    this.petalBridge = new THREE.Group();
    const plankMat = std('#ffb6d9', { emissive: new THREE.Color('#ff7fb0'), emissiveIntensity: 0.25 });
    regBloom(this.bloomMats, plankMat);
    for (let i = 0; i < 5; i++) {
      const plank = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.24, 8), plankMat);
      plank.scale.set(1, 1, 0.62);
      plank.position.set(RAVINE.bridgeX, 0.12, RAVINE.zMin + 0.9 + i * 1.35);
      plank.castShadow = true;
      this.petalBridge.add(plank);
    }
    this.petalBridge.visible = false;
    this.scene.add(this.petalBridge);
  }

  private buildCave() {
    // Bat Hollow: dark hollow with a rock arch mouth
    const floorMat = std('#2c3540');
    const floor = new THREE.Mesh(new THREE.CircleGeometry(CAVE_R, 28), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(CAVE_POS.x, 0.03, CAVE_POS.z);
    this.scene.add(floor);
    const rockMat = std('#5a6270');
    regBloom(this.bloomMats, rockMat);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(5.2, 1.4, 8, 14, Math.PI), rockMat);
    arch.position.set(CAVE_ENTRY.x, 0, CAVE_ENTRY.z - 2);
    arch.rotation.y = Math.PI / 2.6;
    arch.castShadow = true;
    this.scene.add(arch);
    const rng = mulberry(11);
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2;
      const r = CAVE_R * (0.75 + rng() * 0.3);
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.8 + rng() * 1.4, 0),
        rockMat,
      );
      rock.position.set(CAVE_POS.x + Math.cos(a) * r, 0.5, CAVE_POS.z + Math.sin(a) * r);
      this.scene.add(rock);
    }
    // pingables: crystals, glow-caps, sleepy bats
    const addPingable = (
      kind: 'crystal' | 'cap' | 'bat',
      x: number,
      z: number,
      y = 0,
    ): void => {
      const mat = std(kind === 'bat' ? '#6b5b8e' : '#37e0e6', {
        emissive: kind === 'bat' ? new THREE.Color('#6b5b8e') : CYAN,
        emissiveIntensity: 0.15,
      });
      let mesh: THREE.Mesh;
      if (kind === 'crystal') {
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), mat);
        mesh.position.set(x, 0.7, z);
      } else if (kind === 'cap') {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        mesh.position.set(x, 0.25, z);
      } else {
        mesh = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6), mat);
        mesh.position.set(x, y, z);
        mesh.rotation.x = Math.PI; // hanging
      }
      this.scene.add(mesh);
      this.pingables.push({ obj: mesh, mat, pos: mesh.position.clone(), flash: 0 });
    };
    addPingable('crystal', -33, -4);
    addPingable('crystal', -44, -14);
    addPingable('cap', -30, -12);
    addPingable('cap', -47, -6);
    addPingable('bat', -38, -3, 3.2);
    addPingable('bat', -42, -10, 3.6);

    // minecart rails -> broken drop edge
    const railMat = std('#4a4f58', { metalness: 0.6, roughness: 0.35 });
    const railLen = CART_EDGE_X - CART_START_X;
    for (const sz of [CART_Z - 0.62, CART_Z + 0.62]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(railLen, 0.12, 0.14), railMat);
      rail.position.set(CART_START_X + railLen / 2, 0.12, sz);
      this.scene.add(rail);
    }
    // broken stubs past the edge + the drop pit
    for (const sz of [CART_Z - 0.62, CART_Z + 0.62]) {
      const stub = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.14), railMat);
      stub.position.set(CART_EDGE_X + 0.6, -0.25, sz);
      stub.rotation.z = -0.6;
      this.scene.add(stub);
    }
    const drop = new THREE.Mesh(new THREE.PlaneGeometry(8, 10), std('#1c242c'));
    drop.rotation.x = -Math.PI / 2;
    drop.position.set(CART_EDGE_X + 4, -2.8, CART_Z);
    this.scene.add(drop);
    // soft bumper right at the edge (no fail states: it catches the cart)
    const bumper = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.9, 1.6),
      std('#ff7a1a', { emissive: ORANGE, emissiveIntensity: 0.3 }),
    );
    bumper.position.set(CART_EDGE_X + 0.3, 0.45, CART_Z);
    this.scene.add(bumper);
    // the cart itself
    this.cart = makeCart();
    this.cart.group.position.set(CART_START_X, 0, CART_Z);
    this.scene.add(this.cart.group);
    // control console
    const conMat = std('#5f7d95');
    regBloom(this.bloomMats, conMat);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 6), conMat);
    post.position.copy(CART_CONSOLE).setY(0.8);
    this.scene.add(post);
    const screenMat = std('#37e0e6', { emissive: CYAN, emissiveIntensity: 0.9 });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.12), screenMat);
    screen.position.copy(CART_CONSOLE).setY(1.8);
    screen.rotation.y = Math.PI / 4;
    this.scene.add(screen);
  }

  private buildGorge() {
    // vine-strung gorge: sunken strip + rock walls + overhead cable
    const w = GORGE.xMax - GORGE.xMin;
    const d = GORGE.zMax - GORGE.zMin;
    const cx = (GORGE.xMin + GORGE.xMax) / 2;
    const cz = (GORGE.zMin + GORGE.zMax) / 2;
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std('#22303a'));
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(cx, -5.2, cz);
    this.scene.add(pit);
    const wallMat = std('#6a7a6a');
    regBloom(this.bloomMats, wallMat);
    for (const sz of [GORGE.zMin, GORGE.zMax]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 5.2, 0.5), wallMat);
      wall.position.set(cx, -2.6, sz);
      this.scene.add(wall);
    }
    // overhead cable the vines hang from
    const a = new THREE.Vector3(VINE_START.x, 7.6, VINE_START.z - 2);
    const b = new THREE.Vector3(VINE_POINTS[4][0], 7.6, VINE_POINTS[4][1]);
    const dir = b.clone().sub(a);
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, dir.length(), 6),
      std('#4a4f58', { metalness: 0.5, roughness: 0.4 }),
    );
    cable.position.copy(a).addScaledVector(dir, 0.5);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.scene.add(cable);
    // vine pairs: one felt (correct), one dark (harmless swing) per step
    for (let i = 0; i < VINE_POINTS.length; i++) {
      const [cx2, cz2] = VINE_POINTS[i];
      const side = i % 2 === 0 ? -1 : 1;
      const wrong = i < VINE_POINTS.length - 1 ? { x: cx2 + side * 3.2, z: cz2 + 1.4 } : null;
      const cv = makeVine(cx2, cz2);
      this.scene.add(cv.group);
      this.vines.push({
        group: cv.group,
        vineMat: cv.vineMat,
        pos: new THREE.Vector3(cx2, 0, cz2),
        step: i,
        correct: true,
        it: null as unknown as Interactable,
      });
      if (wrong) {
        const wv = makeVine(wrong.x, wrong.z);
        this.scene.add(wv.group);
        this.vines.push({
          group: wv.group,
          vineMat: wv.vineMat,
          pos: new THREE.Vector3(wrong.x, 0, wrong.z),
          step: i,
          correct: false,
          it: null as unknown as Interactable,
        });
      }
    }
    // ledge markers
    const ledgeMat = std('#8a9a7a');
    regBloom(this.bloomMats, ledgeMat);
    for (const p of [VINE_START, new THREE.Vector3(VINE_POINTS[4][0], 0, VINE_POINTS[4][1])]) {
      const ledge = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.4, 10), ledgeMat);
      ledge.position.copy(p).setY(0.2);
      ledge.receiveShadow = true;
      this.scene.add(ledge);
    }
  }

  private buildPlaza() {
    // Flicker's Jitters: open plaza with drifting cloud shadows
    const tileMat = std('#9aa8b8');
    regBloom(this.bloomMats, tileMat);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(8, 8.6, 0.24, 20), tileMat);
    disc.position.copy(PLAZA_POS).setY(0.12);
    disc.receiveShadow = true;
    this.scene.add(disc);
    // drifting clouds (always drifting; their shadows matter in quest 4)
    const cloudMat = std('#f4f8ff', { roughness: 1 });
    const rng = mulberry(23);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(2.6 + rng() * 1.6, 10, 8), cloudMat);
      c.scale.set(1.6, 0.45, 1.1);
      c.position.set(-30 + i * 18, 19 + rng() * 3, -60 + rng() * 30);
      this.scene.add(c);
      this.clouds.push(c);
    }
    for (let i = 0; i < 3; i++) {
      const blob = new THREE.Mesh(
        new THREE.CircleGeometry(3.2, 18),
        new THREE.MeshBasicMaterial({ color: '#101820', transparent: true, opacity: 0, depthWrite: false }),
      );
      blob.rotation.x = -Math.PI / 2;
      blob.position.set(PLAZA_POS.x, 0.3, PLAZA_POS.z);
      this.scene.add(blob);
      this.shadowBlobs.push(blob);
    }
  }

  private buildGreenhouse() {
    // ruined greenhouse: arched ribs + three obstacles + finale dais
    const ribMat = std('#7c8a99', { metalness: 0.3, roughness: 0.5 });
    regBloom(this.bloomMats, ribMat);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.18, 6, 18, Math.PI), ribMat);
      rib.position.set(24 + i * 5.5, 0, -52);
      rib.rotation.y = Math.PI / 2;
      this.scene.add(rib);
    }
    const paneMat = new THREE.MeshStandardMaterial({
      color: '#bfe8ff',
      transparent: true,
      opacity: 0.14,
      roughness: 0.1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 3; i++) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.4), paneMat);
      pane.position.set(25 + i * 6, 4.6, -55.5);
      pane.rotation.x = 0.5;
      this.scene.add(pane);
    }

    // obstacle 0: dark tunnel (needs the LIGHT sensor)
    const tunnel = new THREE.Group();
    const tunMat = std('#3a4a58');
    regBloom(this.bloomMats, tunMat);
    const o0 = OBSTACLES[0].pos;
    for (const sz of [-1.5, 1.5]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 0.5), tunMat);
      wall.position.set(0, 1.6, sz);
      tunnel.add(wall);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 3.5), tunMat);
    roof.position.set(0, 3.3, 0);
    tunnel.add(roof);
    const tunGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 2.8),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    tunGlow.position.set(0, 1.5, 0);
    tunnel.add(tunGlow);
    tunnel.position.copy(o0);
    this.scene.add(tunnel);
    this.obstacleMeshes.push(tunnel);

    // obstacle 1: color-coded door — a RED door (needs the COLOR sensor)
    const door = new THREE.Group();
    const o1 = OBSTACLES[1].pos;
    const frameMat = std('#8a7a5a');
    regBloom(this.bloomMats, frameMat);
    for (const sx of [-1.6, 1.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.6, 0.6), frameMat);
      post.position.set(sx, 1.8, 0);
      door.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.5, 0.6), frameMat);
    lintel.position.set(0, 3.7, 0);
    door.add(lintel);
    const doorPanelMat = std('#e0453a', { emissive: new THREE.Color('#e0453a'), emissiveIntensity: 0.35 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 3.2, 0.3), doorPanelMat);
    panel.position.set(0, 1.6, 0);
    panel.name = 'panel';
    door.add(panel);
    door.position.copy(o1);
    this.scene.add(door);
    this.obstacleMeshes.push(door);

    // obstacle 2: glass wall — nearly invisible (needs ULTRASONIC)
    const glassG = new THREE.Group();
    const o2 = OBSTACLES[2].pos;
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#cfe8ff',
      transparent: true,
      opacity: 0.1,
      roughness: 0.05,
      side: THREE.DoubleSide,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), glassMat);
    glass.position.set(0, 1.7, 0);
    glass.rotation.y = Math.PI / 2;
    glass.name = 'glass';
    glassG.add(glass);
    const gFrameMat = std('#7c8a99');
    regBloom(this.bloomMats, gFrameMat);
    for (const sy of [0.1, 3.4]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 4.4), gFrameMat);
      rail.position.set(0, sy, 0);
      glassG.add(rail);
    }
    glassG.position.copy(o2);
    this.scene.add(glassG);
    this.obstacleMeshes.push(glassG);

    // finale dais
    const daisMat = std('#8a9ab8');
    regBloom(this.bloomMats, daisMat);
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.36, 14), daisMat);
    dais.position.copy(DAIS_POS).setY(0.18);
    dais.receiveShadow = true;
    this.scene.add(dais);
    const daisRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.1, 8, 28),
      std('#37e0e6', { emissive: CYAN, emissiveIntensity: 0.8 }),
    );
    daisRing.rotation.x = Math.PI / 2;
    daisRing.position.copy(DAIS_POS).setY(0.4);
    this.scene.add(daisRing);
  }

  private buildDecor() {
    const rng = mulberry(99);
    const keyPoints = [
      SPAWN,
      GATE_POS,
      FLICKER_MEET,
      GLOBE_POS,
      CAVE_POS,
      CAVE_ENTRY,
      CART_CONSOLE,
      VINE_START,
      PLAZA_POS,
      GREENHOUSE_POS,
      DAIS_POS,
      ...BLOOM_POS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      ...OBSTACLES.map((o) => o.pos),
      ...VINE_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    ];
    const clear = (x: number, z: number, r: number) =>
      keyPoints.every((p) => Math.hypot(x - p.x, z - p.z) > r);
    // trees
    for (let i = 0; i < 22; i++) {
      const a = rng() * Math.PI * 2;
      const r = 24 + rng() * 52;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!clear(x, z, 9)) continue;
      makeTree(this.scene, this.bloomMats, x, z, 0.7 + rng() * 0.7, rng() > 0.5 ? '#3e8e6e' : '#57a05e');
    }
    // machine-flower beds (decorative)
    const bedMat = std('#8a9a7a');
    regBloom(this.bloomMats, bedMat);
    const budMat = std('#37e0e6', { emissive: CYAN, emissiveIntensity: 0.4 });
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const r = 14 + rng() * 60;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!clear(x, z, 6)) continue;
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 1.4), bedMat);
      bed.position.set(x, 0.2, z);
      bed.rotation.y = rng() * Math.PI;
      this.scene.add(bed);
      for (let j = 0; j < 3; j++) {
        const bud = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 5), budMat);
        bud.position.set(x - 0.8 + j * 0.8, 0.7, z);
        this.scene.add(bud);
      }
    }
    // rocks
    const rockMat = std('#6a7a72');
    regBloom(this.bloomMats, rockMat);
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      const r = 18 + rng() * 60;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!clear(x, z, 5)) continue;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + rng() * 1.1, 0), rockMat);
      rock.position.set(x, 0.3, z);
      this.scene.add(rock);
    }
  }

  private setupLights() {
    this.hemi = new THREE.HemisphereLight('#cfe4f2', '#5a7a62', 0.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff2d8', 0.85);
    this.sun.position.set(40, 60, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.far = 220;
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.18));
  }

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
    add('globe', GLOBE_POS, 3.4, this.globe.group, this.globe.glowMat);
    add('flicker', this.flicker.group.position, 3.6, this.flicker.group, this.flicker.tailMat);
    add('bolt', this.bolt.group.position, 2.8, this.bolt.group, this.bolt.coreMat);
    add('cart', CART_CONSOLE, 3.6, this.cart.group, this.cart.lampMat);
    this.bloomFlowers.forEach((f, i) => add(`flower:${i}`, f.pos, 3.0, f.group, f.coreMat));
    for (const v of this.vines) {
      v.it = add(`vine:${v.step}:${v.correct ? 1 : 0}`, v.pos, 6.0, v.group, v.vineMat);
    }
    OBSTACLES.forEach((o, i) => add(`obstacle:${i}`, o.pos, 4.0, this.obstacleMeshes[i], null));
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
    this.quest = 7;
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
      questIndex: 7,
      questName: QUESTS[7].name,
      questText: QUESTS[7].text,
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
    this.renderer.dispose();
  }

  setJoystick(x: number, y: number) {
    this.joy.set(x, y);
    this.joyActive = Math.hypot(x, y) > 0.15;
    if (this.joyActive) this.markActive();
  }

  private setHud(patch: Partial<Zone2HudState>) {
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
      showBlooms: i === 1,
      calmMode: i === 4,
    });
    window.setTimeout(() => this.clearBanner(), 2400);
    this.audio.stinger(2);
    if (i === 3) {
      // Bolt can't swing vines — he cheerfully takes the long way around
      this.boltDetour = [
        new THREE.Vector3(0, 0, -24),
        new THREE.Vector3(-2, 0, -40),
      ];
    }
  }

  private modalOpen(): boolean {
    return this.hud.sensorOpen || this.hud.sliderOpen;
  }

  setSeatHolding(h: boolean) {
    this.seatHolding = h;
    if (h) this.markActive();
  }

  /** Touch dash button (double-tap / Shift remain primary). */
  dashButton() {
    this.tryDash();
  }

  /** No wiring drag in Zone 2 — kept for interface parity with Home/Zone2Game. */
  isWiringDrag(): boolean {
    return false;
  }

  tapAction() {
    this.markActive();
    const a = this.currentAction;
    if (!a) return;
    this.audio.pluck((this.pluckStep = (this.pluckStep + 1) % 10));
    this.doInteract(a);
  }

  /** The new verb: scan-ping — visible cyan ring tagging nearby interactables. */
  scanPing() {
    if (!this.hud.scanUnlocked || this.ceremonyT >= 0 || this.scanCd > 0) return;
    if (!this.hud.started || this.hud.complete) return;
    this.scanCd = 1.6;
    this.audio.scanPing();
    this.spawnRing(this.bolt.group.position.clone(), 26, 16, 0.9);
    const glyphs: [string, string][] = [
      ['flower', '❀'],
      ['globe', '●'],
      ['flicker', '✦'],
      ['bolt', '◉'],
      ['cart', '▣'],
      ['vine', '〰'],
      ['obstacle', '⬡'],
    ];
    let used = 0;
    for (const it of this.interactables) {
      if (!it.enabled || used >= this.tags.length) continue;
      if (this.bolt.group.position.distanceTo(it.pos) > 24) continue;
      const tag = this.tags[used++];
      const glyph = glyphs.find(([pre]) => it.id.startsWith(pre))?.[1] ?? '✚';
      drawTag(tag, glyph);
      tag.sprite.position.copy(it.pos).add(new THREE.Vector3(0, 3.2, 0));
      tag.sprite.visible = true;
      tag.ttl = 5;
    }
  }

  // ---- quest 2: minecart slider (React modal drives these) -----------------
  setCartThreshold(v: number) {
    this.cartThreshold = clamp(Math.round(v), 1, 8);
    this.setHud({ sliderValue: this.cartThreshold });
  }

  confirmCartSlider() {
    this.setHud({ sliderOpen: false });
    this.startCartRun();
  }

  // ---- quest 4: live calm-threshold slider ---------------------------------
  setCalmThreshold(v: number) {
    this.calmThreshold = clamp(v, 5, 98);
    this.markActive();
  }

  // ---- quest 5: sensor selection modal -------------------------------------
  pickSensor(i: number) {
    if (!this.hud.sensorOpen || this.hud.sensorStage !== 'pick') return;
    const ob = OBSTACLES[this.obstacleStage];
    if (i === ob.correct) {
      this.audio.moduleSeat();
      this.setHud({ sensorStage: 'predict', hint: null });
    } else {
      // wrong pick: Bolt bumps softly, friendly hint, modal closes (no fail)
      this.setHud({ sensorOpen: false, hint: this.wrongSensorHint(this.obstacleStage) });
      this.bumpT = 0;
      this.bumpFrom.copy(this.bolt.group.position);
      const dir = ob.pos.clone().sub(this.bolt.group.position).setY(0);
      this.bumpDir.copy(dir.lengthSq() > 0.001 ? dir.normalize() : new THREE.Vector3(0, 0, 1));
      this.audio.softBump();
      this.particles.burst(ob.pos.clone().setY(1.4), CYAN, 14, 2.5, 2.5);
    }
  }

  answerReading(i: number) {
    if (!this.hud.sensorOpen || this.hud.sensorStage !== 'predict') return;
    const ob = OBSTACLES[this.obstacleStage];
    if (i === ob.predCorrect) {
      this.setHud({ sensorOpen: false, hint: null });
      this.clearObstacle(this.obstacleStage);
    } else {
      this.audio.chirp(false);
      this.setHud({ hint: 'What will it really read? Look again' });
    }
  }

  private wrongSensorHint(stage: number): string {
    if (stage === 0) return 'Dark in there — which sense sees light?';
    if (stage === 1) return 'The door wears a color — which sense sees colors?';
    return 'Clear glass tricks eyes — which sense hears walls?';
  }

  private clearObstacle(stage: number) {
    this.obstacleCleared[stage] = true;
    this.audio.stinger(3);
    const ob = OBSTACLES[stage];
    this.particles.burst(ob.pos.clone().setY(2), CYAN, 30, 4, 4);
    const g = this.obstacleMeshes[stage];
    if (stage === 0) {
      // the light sensor sees: the tunnel glows safe cyan
      const glow = g.children.find((c) => c instanceof THREE.Mesh && (c as THREE.Mesh).geometry instanceof THREE.PlaneGeometry) as THREE.Mesh | undefined;
      if (glow) (glow.material as THREE.MeshBasicMaterial).opacity = 0.25;
    } else if (stage === 1) {
      // door slides open
      const panel = g.getObjectByName('panel');
      if (panel) panel.position.y = -1.6;
    } else {
      // glass wall shimmers visible, then sinks
      const glass = g.getObjectByName('glass') as THREE.Mesh | undefined;
      if (glass) {
        (glass.material as THREE.MeshStandardMaterial).opacity = 0.5;
        (glass.material as THREE.MeshStandardMaterial).emissive = CYAN.clone();
        (glass.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
        glass.position.y = -1.8;
      }
    }
    this.setHud({ banner: 'It works! Walk Bolt through' });
    window.setTimeout(() => this.clearBanner(), 2000);
  }

  // -------------------------------------------------------------------------
  // Input: pointer (tap-to-move / tap-to-ping / vine taps) + keyboard
  // -------------------------------------------------------------------------
  handlePointerDown(x: number, y: number) {
    if (!this.hud.started || this.modalOpen() || this.hud.complete) return;
    this.audio.ensure();
    this.pointerStart = { x, y, t: performance.now() };
  }

  handlePointerMove(x: number, y: number) {
    // no drag interactions in Zone 2 (carrying uses the action button)
    void x;
    void y;
  }

  handlePointerUp(x: number, y: number) {
    if (!this.hud.started || this.modalOpen() || this.hud.complete) return;
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
        // vines are swung to, not walked to — tap works from any distance
        if (it.id.startsWith('vine:')) {
          this.doInteract(it);
          return;
        }
        const d = this.kid.group.position.distanceTo(it.pos);
        if (d < it.radius + 1.2) {
          this.doInteract(it);
        } else {
          this.moveTarget = it.pos.clone();
          this.pendingInteract = it;
        }
        return;
      }
    }
    // Bat Hollow: tap anywhere = echolocation ping (movement stays on joystick/keys)
    if (this.quest === 2 && this.inCave()) {
      this.firePing();
      return;
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

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.hud.started) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (this.modalOpen() || this.hud.complete) return;
    this.audio.ensure();
    this.markActive();
    if (k === 'e' && !e.repeat) {
      this.scanPing();
      return;
    }
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

  private inCave(): boolean {
    const p = this.kid.group.position;
    return Math.hypot(p.x - CAVE_POS.x, p.z - CAVE_POS.z) < CAVE_R + 4;
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------
  private doInteract(it: Interactable) {
    this.idleT = 0;
    this.noProgressT = 0;
    switch (true) {
      case it.id === 'globe': {
        if (this.quest === 1) {
          this.globeCarried = !this.globeCarried;
          this.audio.pickup();
          this.particles.burst(this.globe.group.position.clone().setY(1.2), CYAN, 16, 3, 3);
          if (this.globeCarried) {
            this.setHud({ hint: 'Carry it close to a flower' });
          }
        } else {
          this.audio.knock();
        }
        break;
      }
      case it.id.startsWith('flower:'): {
        this.audio.pluck((this.pluckStep = (this.pluckStep + 1) % 10));
        this.particles.burst(it.pos.clone().setY(2), CYAN, 8, 2, 2);
        break;
      }
      case it.id === 'flicker': {
        this.audio.flickerChirp(false);
        const lines: Record<number, string> = {
          0: 'Flicker trembles: shadows bite!',
          1: 'Flicker: flowers drink the light',
          2: 'Flicker: bats hear the dark… ping!',
          3: 'Flicker: lit vines hold, dark ones swing',
          4: 'Flicker: not every shadow is danger',
          5: 'Flicker: pick the right eyes for Bolt',
        };
        this.setHud({ hint: lines[this.quest] ?? 'Flicker chirps happily' });
        break;
      }
      case it.id === 'bolt': {
        this.audio.boltLaugh(this.quest < 6);
        this.particles.burst(this.bolt.group.position.clone().setY(2), CYAN, 8, 2, 2);
        break;
      }
      case it.id === 'cart': {
        if (this.quest === 2 && this.pingsFired >= 1 && this.cartState === 'idle') {
          this.setHud({ sliderOpen: true, sliderValue: this.cartThreshold, hint: null });
          this.audio.chirp(true);
        } else if (this.quest === 2 && this.pingsFired < 1) {
          this.setHud({ hint: 'Ping first — feel the distance!' });
          this.audio.chirp(false);
        }
        break;
      }
      case it.id.startsWith('vine:'): {
        if (this.quest !== 3 || this.swingT >= 0) break;
        const [, stepS, correctS] = it.id.split(':');
        const step = Number(stepS);
        const correct = correctS === '1';
        if (step !== this.vineStep) {
          this.audio.knock();
          break;
        }
        this.startSwing(it.pos, correct);
        break;
      }
      case it.id.startsWith('obstacle:'): {
        const idx = Number(it.id.split(':')[1]);
        if (this.quest === 5 && idx === this.obstacleStage && !this.obstacleCleared[idx]) {
          this.setHud({ sensorOpen: true, sensorStage: 'pick', sensorObstacle: idx, hint: null });
          this.audio.chirp(true);
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Bat Hollow: echolocation ping + minecart threshold
  // -------------------------------------------------------------------------
  private spawnRing(from: THREE.Vector3, maxR: number, speed: number, opacity = 0.8) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.09, 8, 40),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity, depthWrite: false }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(from).setY(0.5);
    this.scene.add(mesh);
    this.rings.push({ mesh, r: 0.5, speed, maxR, from: from.clone() });
  }

  private firePing() {
    this.pingsFired++;
    this.audio.pingChirp();
    const from = this.bolt.group.position.clone();
    this.spawnRing(from, 32, 14);
    // nearest pingable gets a distance number on Bolt's chest glyph
    let best: Pingable | null = null;
    let bd = Infinity;
    for (const p of this.pingables) {
      const d = from.distanceTo(p.pos);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) this.setReading(`${Math.round(bd)}m`);
    if (this.pingsFired === 1) this.setHud({ hint: 'The number is distance!' });
    if (this.pingsFired === 2) this.setHud({ hint: 'Now: stop the cart — console!' });
  }

  private setReading(t: string) {
    if (this.readingText === t) return;
    this.readingText = t;
    const ctx = this.chestCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 128, 64);
    if (t) {
      ctx.fillStyle = 'rgba(8,40,46,0.85)';
      ctx.beginPath();
      ctx.roundRect(0, 0, 128, 64, 14);
      ctx.fill();
      ctx.fillStyle = '#37e0e6';
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, 64, 34);
    }
    this.chestTex.needsUpdate = true;
  }

  private startCartRun() {
    this.cartState = 'rolling';
    this.cartSpeed = 4.5;
    this.cartX = CART_START_X;
    this.watchCart = true;
    this.audio.chirp(true);
  }

  private updateCart(dt: number) {
    const g = this.cart.group;
    if (this.cartState === 'rolling') {
      this.cartX += this.cartSpeed * dt;
      this.cartRattleT -= dt;
      if (this.cartRattleT <= 0) {
        this.cartRattleT = 0.32;
        this.audio.rattle();
      }
      const dist = CART_EDGE_X - this.cartX;
      this.setReading(`${Math.max(0, Math.round(dist))}m`);
      // the threshold: stop when closer than the set number
      if (dist <= this.cartThreshold) {
        this.cartState = 'braking';
        this.audio.cartBrake();
      }
    } else if (this.cartState === 'braking') {
      this.cartSpeed = Math.max(0, this.cartSpeed - 9 * dt);
      this.cartX += this.cartSpeed * dt;
      const dist = Math.max(0, CART_EDGE_X - this.cartX);
      this.setReading(`${Math.round(dist)}m`);
      if (this.cartSpeed === 0) {
        this.judgeCart(dist);
      }
    } else if (this.cartState === 'returning') {
      this.cartX -= 6 * dt;
      if (this.cartX <= CART_START_X) {
        this.cartX = CART_START_X;
        this.cartState = 'idle';
        this.watchCart = false;
      }
    }
    g.position.x = this.cartX;
    g.rotation.z = this.cartState === 'rolling' ? Math.sin(this.time * 18) * 0.02 : 0;
    this.cart.lampMat.emissiveIntensity =
      this.cartState === 'rolling' ? 1.8 + Math.sin(this.time * 10) * 0.5 : 1.2;
  }

  private judgeCart(dist: number) {
    if (dist >= 2 && dist <= 5) {
      // stopped safely at the threshold — threshold understood!
      this.audio.stinger(3);
      this.particles.burst(this.cart.group.position.clone().setY(1.4), CYAN, 30, 4, 4);
      this.setReading('SAFE');
      this.watchCart = false;
      this.noProgressT = 0;
      this.setQuest(3);
    } else if (dist > 5) {
      this.setHud({ hint: 'Stopped too far — try a smaller number' });
      this.audio.chirp(false);
      this.cartState = 'returning';
    } else {
      // rolled right to the soft bumper — too close, gently try again
      this.audio.softBump();
      this.particles.burst(this.cart.group.position.clone().setY(1), ORANGE, 16, 3, 3);
      this.setHud({ hint: 'Whoa, too close! Bigger number' });
      this.cartState = 'returning';
    }
  }

  // -------------------------------------------------------------------------
  // Vine Crossing: binary felt / not-felt
  // -------------------------------------------------------------------------
  private startSwing(target: THREE.Vector3, correct: boolean) {
    this.swingT = 0;
    this.swingWrong = !correct;
    this.swingFrom.copy(this.kid.group.position);
    this.swingTo.copy(target);
    this.moveTarget = null;
    this.pendingInteract = null;
    this.keys.clear();
    this.joy.set(0, 0);
    this.joyActive = false;
    this.vel.set(0, 0, 0);
    if (correct) {
      this.audio.swing();
      this.audio.pluck((this.pluckStep = (this.pluckStep + 1) % 10));
    } else {
      // wrong vine: harmless swing out and back, with a giggle
      this.audio.swing();
      window.setTimeout(() => this.audio.giggle(), 350);
    }
  }

  private updateSwing(dt: number) {
    if (this.swingT < 0) return;
    const dur = 0.9;
    this.swingT += dt;
    const t = clamp(this.swingT / dur, 0, 1);
    const kid = this.kid.group.position;
    if (this.swingWrong) {
      // out to 55%, then placed gently back
      const tt = t < 0.5 ? t * 2 : (1 - t) * 2;
      const mid = this.swingFrom.clone().lerp(this.swingTo, 0.55);
      kid.lerpVectors(this.swingFrom, mid, tt);
      kid.y = lerp(this.swingFrom.y, 2.2, Math.sin(tt * Math.PI * 0.5));
      if (t >= 1) {
        this.swingT = -1;
        kid.copy(this.swingFrom);
        kid.y = this.onVine ? 1.5 : 0;
        this.setHud({ hint: 'That vine is dark — pick the lit one!' });
      }
    } else {
      const e = easeInOut(t);
      kid.lerpVectors(this.swingFrom, this.swingTo, e);
      kid.y = lerp(this.swingFrom.y, 1.5, e) + Math.sin(e * Math.PI) * 1.6;
      if (t >= 1) {
        this.swingT = -1;
        const landedStep = this.vineStep;
        this.vineStep++;
        this.noProgressT = 0;
        this.particles.burst(kid.clone().setY(1.5), CYAN, 14, 2.5, 2);
        if (this.vineStep >= VINE_POINTS.length) {
          // far ledge — crossing complete
          this.onVine = false;
          kid.y = 0;
          this.audio.stinger(3);
          this.setQuest(4);
        } else {
          this.onVine = true;
          kid.y = 1.5;
          if (landedStep === 0) this.setHud({ hint: 'Lit vine = felt = safe!' });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Flicker's Jitters: noise vs signal
  // -------------------------------------------------------------------------
  private updateJitters(dt: number) {
    if (!this.jitterActive) return;
    this.jitterT += dt;
    if (this.jitterPhase === 'clouds') {
      // noise: cloud shadows drift over the plaza every few seconds
      this.cloudShadowT -= dt;
      if (this.cloudShadowT <= -1.6) {
        this.cloudShadowT = 2.2 + Math.random() * 1.4; // shadow pass duration start
      }
      const passing = this.cloudShadowT > 0;
      if (passing) {
        this.cloudShadowT -= dt;
        this.startleTarget = 42 + Math.sin(this.jitterT * 3) * 8 + Math.random() * 10;
      } else {
        this.startleTarget = 8;
      }
      // shadow blobs slide across the plaza while a cloud passes
      this.shadowBlobs.forEach((b, i) => {
        const m = b.material as THREE.MeshBasicMaterial;
        m.opacity = lerp(m.opacity, passing ? 0.35 : 0, damp(0.4, dt));
        if (passing) {
          b.position.x = PLAZA_POS.x - 8 + ((this.jitterT * 3 + i * 5) % 16);
          b.position.z = PLAZA_POS.z - 4 + i * 4;
        }
      });
      // accumulate calm-through-clouds time
      if (this.calmStartle <= this.calmThreshold) {
        this.calmT += dt;
      } else {
        // false positive: Flicker startles at a mere shadow (comedy, no fail)
        this.calmT = 0;
        this.flickerStartleT = 0;
        this.audio.flickerChirp(true);
        this.setHud({ hint: 'A shadow spooked him! Raise the line' });
        this.jitterT = 0;
      }
      if (this.calmT >= 10) {
        // calm through the clouds — now the true signal: dusk falls
        this.jitterPhase = 'dusk';
        this.jitterT = 0;
        this.setHud({ hint: 'Dusk is real — he should react!' });
      }
    } else {
      // dusk: the true signal ramps up
      this.duskK = clamp(this.duskK + dt / 5, 0, 1);
      this.startleTarget = 8 + this.duskK * 90;
      this.shadowBlobs.forEach((b) => {
        const m = b.material as THREE.MeshBasicMaterial;
        m.opacity = lerp(m.opacity, 0, damp(0.4, dt));
      });
      if (this.calmStartle > this.calmThreshold) {
        // correct dusk reaction — filtering understood!
        this.jitterActive = false;
        this.flickerStartleT = 0;
        this.audio.flickerChirp(true);
        window.setTimeout(() => this.audio.stinger(3), 500);
        this.particles.burst(this.flicker.group.position.clone(), CYAN, 24, 3, 3);
        this.noProgressT = 0;
        this.setQuest(5);
      } else if (this.duskK >= 1 && this.jitterT > 8) {
        // slept through dusk: threshold too high — friendly reset
        this.jitterPhase = 'clouds';
        this.jitterT = 0;
        this.calmT = 0;
        this.duskK = 0;
        this.setHud({ hint: 'He slept through dusk! Lower the line' });
        this.audio.chirp(false);
      }
    }
    // smooth the live meter toward its target
    this.calmStartle = lerp(this.calmStartle, this.startleTarget, damp(0.35, dt));
  }

  // -------------------------------------------------------------------------
  // Quest logic
  // -------------------------------------------------------------------------
  private objectivePos(): THREE.Vector3 | null {
    const p = this.kid.group.position;
    switch (this.quest) {
      case 0:
        return FLICKER_MEET;
      case 1: {
        if (!this.globeCarried) return GLOBE_POS;
        let best: BloomFlower | null = null;
        let bd = Infinity;
        for (const f of this.bloomFlowers) {
          if (f.bloomed) continue;
          const d = p.distanceTo(f.pos);
          if (d < bd) {
            bd = d;
            best = f;
          }
        }
        return best ? best.pos : null;
      }
      case 2:
        return this.pingsFired >= 2 ? CART_CONSOLE : CAVE_ENTRY;
      case 3:
        if (this.vineStep >= VINE_POINTS.length) return PLAZA_POS;
        return this.vineStep === 0 && !this.onVine
          ? VINE_START
          : new THREE.Vector3(VINE_POINTS[this.vineStep][0], 0, VINE_POINTS[this.vineStep][1]);
      case 4:
        return PLAZA_POS;
      case 5:
        return this.obstacleStage < 3 ? OBSTACLES[this.obstacleStage].pos : DAIS_POS;
      case 6:
        return DAIS_POS;
      default:
        return null;
    }
  }

  private updateQuests(dt: number) {
    const p = this.kid.group.position;

    // quest 0: meet Flicker — he startles at Spark's shadow (played for laughs)
    if (this.quest === 0 && this.meetStage === 0 && p.distanceTo(FLICKER_MEET) < 5) {
      this.meetStage = 1;
      this.meetT = 0;
      this.flickerStartleT = 0;
      this.audio.flickerChirp(true);
      this.setHud({ hint: "Flicker startles at shadows — he's jumpy!" });
      this.noProgressT = 0;
    }
    if (this.meetStage === 1) {
      this.meetT += dt;
      if (this.meetT > 1.6) {
        this.meetStage = 2;
        this.flickerFollows = true;
        this.setQuest(1);
      }
    }

    // quest 1: Morning Bloom — analog light meters fill near the globe
    if (this.quest === 1) {
      const globePos = this.globe.group.position;
      for (const f of this.bloomFlowers) {
        if (f.bloomed) continue;
        const d = globePos.distanceTo(f.pos);
        const level = clamp(1.15 - d / GLOBE_RANGE, 0, 1);
        f.charge = clamp(f.charge + (level * 0.45 - 0.1) * dt, 0, 1);
        if (f.charge >= 1) {
          f.bloomed = true;
          const n = this.hud.blooms + 1;
          this.audio.bloomOpen();
          this.particles.burst(f.pos.clone().setY(2.2), CYAN, 18, 3, 3);
          this.particles.burst(f.pos.clone().setY(2.2), AMBER, 18, 3, 3);
          this.noProgressT = 0;
          this.setHud({ blooms: n });
          if (n >= this.hud.bloomsTotal) {
            this.bridgeOpen = true;
            this.petalBridge.visible = true;
            this.audio.stinger(3);
            this.setHud({ banner: 'A petal bridge blooms!' });
            window.setTimeout(() => this.clearBanner(), 2200);
            this.setQuest(2);
          }
        }
      }
      // carried globe floats beside the kid
      if (this.globeCarried) {
        const lp = p.clone();
        lp.x += Math.sin(this.facing + 1.2) * 1.0;
        lp.z += Math.cos(this.facing + 1.2) * 1.0;
        lp.y = Math.sin(this.time * 2.2) * 0.12;
        this.globe.group.position.lerp(lp, damp(0.15, dt));
      } else if (this.quest === 1) {
        this.globe.group.position.y = lerp(this.globe.group.position.y, 0, damp(0.3, dt));
      }
    }

    // quest 2: cave ambience + cart handled in updateCart / updateWorldFx
    if (this.quest === 2 && this.inCave() && this.pingsFired === 0 && !this.hud.hint) {
      if (this.noProgressT > 2) this.setHud({ hint: 'Dark! Tap anywhere to ping' });
    }

    // quest 3: proximity reveals each vine's binary state (felt = solid cyan)
    if (this.quest === 3 && this.vineStep < VINE_POINTS.length) {
      for (const v of this.vines) {
        if (v.step !== this.vineStep) continue;
        const d = p.distanceTo(v.pos);
        if (d < 7) {
          v.vineMat.emissiveIntensity = lerp(
            v.vineMat.emissiveIntensity,
            v.correct ? 1.6 : 0.04,
            damp(0.2, dt),
          );
        }
      }
    }

    // quest 4: entering the plaza starts the jitter scene
    if (this.quest === 4 && !this.jitterActive && p.distanceTo(PLAZA_POS) < 10) {
      this.jitterActive = true;
      this.jitterT = 0;
      this.jitterPhase = 'clouds';
      this.calmT = 0;
      this.duskK = 0;
      this.calmStartle = 8;
      this.setHud({ banner: 'Flicker startles at shadows!' });
      window.setTimeout(() => this.clearBanner(), 2200);
      this.noProgressT = 0;
    }

    // quest 5: walk-through triggers after each obstacle clears
    if (this.quest === 5 && this.obstacleStage < 3 && this.obstacleCleared[this.obstacleStage]) {
      const through = OBSTACLES[this.obstacleStage].through;
      if (p.distanceTo(through) < 3.2) {
        this.obstacleStage++;
        this.noProgressT = 0;
        this.audio.stinger(2);
        if (this.obstacleStage >= 3) {
          this.setHud({ banner: 'All sensors fit! To the dais' });
          window.setTimeout(() => this.clearBanner(), 2200);
          this.setQuest(6);
        } else {
          this.setHud({ banner: `${3 - this.obstacleStage} to go!` });
          window.setTimeout(() => this.clearBanner(), 1600);
        }
      }
    }

    // quest 6: beat 1 — seat the sensor modules (2s hold builds anticipation)
    if (this.quest === 6 && this.ceremonyT < 0) {
      const nearBolt = p.distanceTo(this.bolt.group.position) < 4.5;
      const nearDais = p.distanceTo(DAIS_POS) < 7;
      if (this.seatHolding && nearBolt && nearDais) {
        this.seatT += dt;
        this.setHud({ seatHold: clamp(this.seatT / 2, 0, 1) });
        if (Math.random() < dt * 10) {
          this.particles.burst(this.bolt.group.position.clone().setY(1.2), CYAN, 2, 1, 1.5);
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

    this.updateActionButton();

    // idle hint pulse after 45s (canon)
    if (this.idleT > HINT_IDLE_DELAY && !this.hud.hint) {
      this.setHud({ hint: HINTS[this.quest] ?? 'Follow the cyan trail' });
      this.idleT = HINT_IDLE_DELAY;
    }

    // idle ping every 2.5s toward the objective
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
    if (this.quest === 6 && this.ceremonyT < 0) {
      if (p.distanceTo(this.bolt.group.position) < 4.5 && p.distanceTo(DAIS_POS) < 7) {
        label = 'Hold to seat the sensors';
      }
    } else {
      const inRange: Interactable[] = [];
      for (const it of this.interactables) {
        if (!it.enabled) continue;
        if (it.id.startsWith('vine:')) continue; // vines are tap-only
        if (it.id.startsWith('obstacle:')) {
          const idx = Number(it.id.split(':')[1]);
          if (this.quest !== 5 || idx !== this.obstacleStage || this.obstacleCleared[idx]) continue;
        }
        if (it.id === 'cart' && this.quest !== 2) continue;
        if (it.id === 'globe' && this.quest !== 1) continue;
        if (p.distanceTo(it.pos) < it.radius) inRange.push(it);
      }
      let bd = Infinity;
      for (const it of inRange) {
        const d = p.distanceTo(it.pos);
        if (d < bd) {
          bd = d;
          action = it;
        }
      }
      if (action) {
        if (action.id === 'globe') label = this.globeCarried ? 'Set down the light' : 'Pick up the light';
        else if (action.id === 'cart') label = 'Set stop distance';
        else if (action.id === 'flicker') label = 'Say hi to Flicker';
        else if (action.id === 'bolt') label = 'Say hi to Bolt';
        else if (action.id.startsWith('obstacle:')) label = 'Fit a sensor';
        else if (action.id.startsWith('flower:')) label = 'A sleeping flower';
      }
    }
    this.currentAction = action;
    if (label !== this.hud.actionLabel) this.setHud({ actionLabel: label });
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

    if (this.hud.started && !this.modalOpen() && !this.hud.complete) {
      if (this.ceremonyT < 0) {
        // no walking / quest triggers during the ceremony cinematic
        this.updatePlayer(dt);
        this.updateQuests(dt);
      }
      this.updateEnergy(dt);
    }
    if (this.ceremonyT >= 0) this.updateCeremony(dt);
    this.updateJitters(dt);
    this.updateBolt(dt);
    this.updateFlicker(dt);
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
    this.particles.burst(this.kid.group.position.clone().setY(0.6), CYAN, 14, 3, 2);
  }

  private updatePlayer(dt: number) {
    const pos = this.kid.group.position;
    this.dashCd = Math.max(0, this.dashCd - dt);

    // a vine swing owns the kid's position while it runs
    if (this.swingT >= 0) {
      this.updateSwing(dt);
      this.kid.group.rotation.y = this.facing;
      return;
    }

    const prevZ = pos.z;
    const inp = this.moveInput();
    const tired = this.gauge <= 0;

    const desired = new THREE.Vector3();
    if (this.dashT > 0) {
      this.dashT -= dt;
      desired.copy(this.dashDir).multiplyScalar(DASH_SPEED);
      this.particles.burst(pos.clone().setY(0.5), CYAN, 2, 0.6, 0.8, 2, 0.5);
    } else if (inp.length() > 0.1) {
      const speed = tired ? WALK_SPEED * 0.7 : WALK_SPEED;
      desired.set(inp.x, 0, -inp.y).normalize().multiplyScalar(speed);
      this.moveTarget = null;
      this.pendingInteract = null;
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
        const speed = tired ? WALK_SPEED * 0.7 : WALK_SPEED;
        desired.copy(to.normalize()).multiplyScalar(Math.min(speed, d * 3));
      }
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

    // world blocking: the ravine (until the petal bridge) and the gorge
    if (pos.y < 0.4) {
      const inRavineZ = pos.z > RAVINE.zMin && pos.z < RAVINE.zMax;
      const inRavineX = pos.x > RAVINE.xMin && pos.x < RAVINE.xMax;
      if (inRavineZ && inRavineX) {
        const onBridge = this.bridgeOpen && Math.abs(pos.x - RAVINE.bridgeX) < RAVINE.bridgeHalf;
        if (!onBridge) {
          pos.z = prevZ <= RAVINE.zMin ? RAVINE.zMin : RAVINE.zMax;
        }
      }
      if (!this.onVine) {
        const inGorgeZ = pos.z > GORGE.zMin && pos.z < GORGE.zMax;
        const inGorgeX = pos.x > GORGE.xMin && pos.x < GORGE.xMax;
        if (inGorgeZ && inGorgeX) {
          pos.z = prevZ <= GORGE.zMax - (GORGE.zMax - GORGE.zMin) / 2 ? GORGE.zMax : GORGE.zMin;
        }
      }
    }

    // jump / gravity (not while hanging on a vine)
    if (this.onVine) {
      pos.y = lerp(pos.y, 1.5, damp(0.2, dt));
    } else if (!this.grounded) {
      this.vy -= 22 * dt;
      pos.y += this.vy * dt;
      if (pos.y <= 0) {
        pos.y = 0;
        this.grounded = true;
        this.audio.land();
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
  }

  private updateEnergy(dt: number) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.dashT <= 0) {
      if (speed > 0.6) this.gauge -= DRAIN_WALK * dt;
      else this.gauge -= DRAIN_IDLE * dt;
    }
    // bloomed flowers glow amber and restore power (power = amber, canon)
    for (const f of this.bloomFlowers) {
      if (!f.bloomed) continue;
      if (this.kid.group.position.distanceTo(f.pos) < 3 && this.gauge < this.gaugeMax - 0.5) {
        this.gauge = Math.min(this.gaugeMax, this.gauge + 40 * dt);
        if (Math.random() < dt * 8) {
          this.particles.burst(f.pos.clone().setY(1.8), AMBER, 3, 1.5, 2);
        }
      }
    }
    this.gauge = clamp(this.gauge, 0, this.gaugeMax);
  }

  // -------------------------------------------------------------------------
  // The six-beat finale: Bolt's Eyes Open
  // -------------------------------------------------------------------------
  private beginCeremony() {
    this.ceremonyT = 0;
    this.hitStop = 0.06;
    this.gauge = this.gaugeMax;
    // cinematic: freeze any in-progress input so the kid stands still
    this.keys.clear();
    this.joy.set(0, 0);
    this.joyActive = false;
    this.moveTarget = null;
    this.pendingInteract = null;
    this.vel.set(0, 0, 0);
    this.audio.moduleSeat();
    this.audio.ceremonyCool();
    // cyan data races through his conduits (sensors = cyan)
    this.bolt.coreMat.emissive = CYAN.clone();
    this.particles.burst(this.bolt.group.position.clone().setY(1), CYAN, 40, 5, 5);
    this.setHud({ seatHold: 0, actionLabel: null, calmMode: false, banner: "Bolt's eyes open!" });
    window.setTimeout(() => this.clearBanner(), 2200);
  }

  private updateCeremony(dt: number) {
    this.ceremonyT += dt;
    const t = this.ceremonyT;
    const bp = this.bolt.group.position;

    // beat 2: cyan data races through his conduits, camera pulls wide
    this.camWide = t > 0.4 && t < 11.5;
    this.bolt.coreMat.emissiveIntensity = 0.7 + Math.min(2.4, t * 1.3);
    if (t < 2 && Math.random() < dt * 14) {
      this.particles.burst(bp.clone().setY(0.9), CYAN, 3, 2, 2.5);
    }

    // beat 3: the Gardens sharpen and bloom — dim world -> crisp full color
    if (t > 2 && this.bloomK < 1) {
      this.bloomK = clamp(this.bloomK + dt / 4.2, 0, 1);
      this.applyBloom();
      if (Math.random() < dt * 10) {
        const f = this.bloomFlowers[Math.floor(Math.random() * this.bloomFlowers.length)];
        this.particles.burst(f.pos.clone().setY(2.4), CYAN, 4, 2, 2);
      }
    }

    // beat 4: his eye-lights ignite, happy hop + laugh
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

    // beat 5: new verb unlocked — scan-ping
    if (!this.scanShown && t > 7.2) {
      this.scanShown = true;
      this.setHud({
        scanUnlocked: true,
        banner: 'New move: SCAN-PING!',
        hint: 'Press E or the cyan ring button',
      });
      this.audio.scanPing();
      this.spawnRing(bp.clone(), 18, 12, 1);
      window.setTimeout(() => this.clearBanner(), 2600);
    }

    // beat 6: rest cue + completion card
    if (t > 10.2 && !this.restCued) {
      this.restCued = true;
      this.setHud({ banner: 'Zone 2 complete', hint: null });
      window.setTimeout(() => this.clearBanner(), 2400);
      this.boltResting = true;
    }
    if (t > 12.6 && !this.hud.complete) {
      this.setHud({ complete: true });
      try {
        localStorage.setItem('spark-zone2-complete', '1');
      } catch {
        /* ignore */
      }
    }
  }

  private applyBloom() {
    const k = easeInOut(this.bloomK);
    for (const b of this.bloomMats) {
      b.mat.color.copy(b.dormant).lerp(b.full, k);
    }
  }

  // -------------------------------------------------------------------------
  // Companions, world FX, camera, trail
  // -------------------------------------------------------------------------
  private updateBolt(dt: number) {
    const b = this.bolt.group;
    const hope = this.hud.boltHope;
    // eye-lights: broken sensors stutter red on arrival, then dim cyan until
    // the finale ignites them (they double as the hope HUD)
    const stuttering = this.quest === 0 && this.time < 3.5 && this.ceremonyT < 0;
    if (stuttering) {
      const on = Math.sin(this.time * 21) > 0.2;
      this.bolt.eyeMatL.emissive.setRGB(on ? 1 : 0.2, 0.15, 0.12); // red flicker
      this.bolt.eyeMatR.emissive.setRGB(on ? 1 : 0.2, 0.15, 0.12);
      this.bolt.eyeMatL.emissiveIntensity = on ? 1.1 : 0.15;
      this.bolt.eyeMatR.emissiveIntensity = on ? 1.1 : 0.15;
    } else {
      this.bolt.eyeMatL.emissive.copy(CYAN);
      this.bolt.eyeMatR.emissive.copy(CYAN);
      const flicker = hope < 0.6 ? Math.sin(this.time * 13) * 0.12 : 0;
      const eyeI = this.boltResting ? 0.4 : 0.3 + hope * 1.7 + flicker;
      this.bolt.eyeMatL.emissiveIntensity = eyeI;
      this.bolt.eyeMatR.emissiveIntensity = eyeI;
    }
    if (this.ceremonyT < 0) {
      this.bolt.coreMat.emissiveIntensity = 0.4 + hope * 0.8;
    }
    if (this.boltResting) {
      b.rotation.z = lerp(b.rotation.z, 0.12, damp(0.5, dt));
      b.position.y = Math.sin(this.time * 1.2) * 0.03;
      return;
    }
    // soft-bump animation after a wrong sensor pick (out and gently back)
    if (this.bumpT >= 0) {
      this.bumpT += dt;
      const tt = clamp(this.bumpT / 0.7, 0, 1);
      b.position.copy(this.bumpFrom).addScaledVector(this.bumpDir, Math.sin(tt * Math.PI) * 0.8);
      if (tt >= 1) {
        this.bumpT = -1;
        b.position.copy(this.bumpFrom);
      }
    }
    if (this.ceremonyT < 0) {
      // the long way around the gorge (vines are for kids)
      let target: THREE.Vector3;
      if (this.boltDetour.length > 0) {
        target = this.boltDetour[0];
        if (b.position.distanceTo(target) < 1) {
          this.boltDetour.shift();
          target = this.boltDetour[0] ?? this.kid.group.position;
        }
      } else {
        const kp = this.kid.group.position;
        const behind = new THREE.Vector3(Math.sin(this.facing - 0.7), 0, Math.cos(this.facing - 0.7));
        target = kp.clone().addScaledVector(behind, 2.4);
        // Bolt waits at the vine ledge while Spark swings across
        if (this.onVine || this.swingT >= 0) target = VINE_START.clone().add(new THREE.Vector3(1.5, 0, 1.5));
      }
      const to = target.clone().sub(b.position.clone().setY(0));
      const d = to.length();
      if (d > 0.3 && this.bumpT < 0) {
        const speed = Math.min(d * 2.2, hope > 0.6 ? 8.5 : 4.2);
        b.position.addScaledVector(to.normalize(), Math.min(d, speed * dt));
        b.rotation.y = Math.atan2(to.x, to.z);
      }
      const bounce = hope > 0.6 ? Math.abs(Math.sin(this.time * 7)) * 0.12 : Math.abs(Math.sin(this.time * 4)) * 0.05;
      b.position.y = Math.max(0, bounce);
    }
    const d2 = b.position.distanceTo(this.kid.group.position);
    if (d2 < 6) {
      this.bolt.head.rotation.y = Math.sin(this.time * 0.8) * 0.3;
    }
  }

  private updateFlicker(dt: number) {
    const g = this.flicker.group;
    // jittery, twitchy hover — his personality IS the lesson (over-triggering)
    const jit = Math.sin(this.time * 13) * 0.05 + Math.sin(this.time * 29) * 0.03;
    let target: THREE.Vector3;
    if (this.quest === 4 && this.jitterActive) {
      target = PLAZA_POS.clone().add(new THREE.Vector3(0, 2.4, 0));
    } else if (this.flickerFollows) {
      const kp = this.kid.group.position;
      target = kp.clone().add(new THREE.Vector3(Math.sin(this.facing + 2.4), 0, Math.cos(this.facing + 2.4)).multiplyScalar(3.2));
      target.y = 2.2;
    } else {
      target = FLICKER_MEET.clone().add(new THREE.Vector3(1.5, 2.2, -1));
    }
    // startle: dart away fast (played for comedy)
    if (this.flickerStartleT >= 0) {
      this.flickerStartleT += dt;
      const s = this.flickerStartleT;
      if (s < 0.5) {
        target = g.position.clone().add(new THREE.Vector3(2.5 * dt * 10, 1.6 * dt * 10, 1.5 * dt * 10));
      } else if (s > 1.4) {
        this.flickerStartleT = -1;
      }
    }
    g.position.lerp(target, damp(this.flickerStartleT >= 0 ? 0.08 : 0.6, dt));
    g.position.y += jit;
    // facing + wing flap + nervous tail blink
    const toKid = this.kid.group.position.clone().sub(g.position);
    g.rotation.y = Math.atan2(toKid.x, toKid.z) + Math.PI;
    const flap = Math.sin(this.time * (this.flickerStartleT >= 0 ? 60 : 34)) * 0.7;
    this.flicker.wingL.rotation.z = flap;
    this.flicker.wingR.rotation.z = -flap;
    this.flicker.tailMat.emissiveIntensity =
      1.4 + Math.sin(this.time * 6) * 0.8 + (this.flickerStartleT >= 0 ? 1.6 : 0);
    // nervous chirps near the kid (pitch up when startled)
    this.flickerChirpT -= dt;
    if (this.flickerChirpT <= 0) {
      this.flickerChirpT = 5 + Math.random() * 5;
      if (g.position.distanceTo(this.kid.group.position) < 10 && this.hud.started) {
        this.audio.flickerChirp(this.flickerStartleT >= 0);
      }
    }
  }

  private updateWorldFx(dt: number) {
    // bloom flowers: radial meters track charge; petals open cyan -> amber
    for (const f of this.bloomFlowers) {
      f.group.rotation.z = Math.sin(this.time * 1.2 + f.pos.x) * 0.04;
      const lit = Math.round(f.charge * f.meterMats.length);
      f.meterMats.forEach((m, i) => {
        m.emissiveIntensity = i < lit ? 1.6 : 0.05;
      });
      const targetOpen = f.bloomed ? 1 : 0;
      if (f.openK !== targetOpen) {
        f.openK = lerp(f.openK, targetOpen, damp(0.4, dt));
        f.petals.forEach((petal, i) => {
          const a = (i / f.petals.length) * Math.PI * 2;
          const spread = lerp(0.18, 0.62, f.openK);
          petal.position.set(Math.cos(a) * spread, 1.85 + f.openK * 0.12, Math.sin(a) * spread);
          petal.rotation.z = Math.cos(a) * lerp(0.1, 1.25, f.openK);
          petal.rotation.x = -Math.sin(a) * lerp(0.1, 1.15, f.openK);
        });
        f.petalMat.color.copy(CYAN).lerp(AMBER, f.openK);
        f.petalMat.emissive.copy(CYAN).lerp(AMBER, f.openK);
        f.petalMat.emissiveIntensity = 0.25 + f.openK * 1.1;
        f.coreMat.emissive.copy(CYAN).lerp(AMBER, f.openK);
        f.coreMat.emissiveIntensity = 0.15 + f.openK * 1.8;
      }
    }
    // light-globe glow
    this.globe.glowMat.emissiveIntensity = 2.2 + Math.sin(this.time * 3) * 0.5;
    // petal bridge pops in
    if (this.bridgeOpen && this.bridgeK < 1) {
      this.bridgeK = clamp(this.bridgeK + dt / 0.8, 0, 1);
      this.petalBridge.scale.setScalar(0.2 + easeInOut(this.bridgeK) * 0.8);
    }
    // ping rings expand; objects they touch flash cyan
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.r += ring.speed * dt;
      ring.mesh.scale.setScalar(ring.r);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - ring.r / ring.maxR);
      for (const p of this.pingables) {
        const d = Math.hypot(p.pos.x - ring.from.x, p.pos.z - ring.from.z);
        if (Math.abs(d - ring.r) < 0.9 && p.flash <= 0) {
          p.flash = 1.0;
          this.audio.pluck((this.pluckStep = (this.pluckStep + 1) % 10));
        }
      }
      if (ring.r >= ring.maxR) {
        this.scene.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    for (const p of this.pingables) {
      if (p.flash > 0) {
        p.flash -= dt;
        p.mat.emissiveIntensity = 0.15 + Math.max(0, p.flash) * 2.4;
      }
    }
    // scan-ping tag sprites bob + expire
    for (const tag of this.tags) {
      if (!tag.sprite.visible) continue;
      tag.ttl -= dt;
      tag.sprite.position.y += Math.sin(this.time * 3) * 0.002;
      (tag.sprite.material as THREE.SpriteMaterial).opacity = clamp(tag.ttl, 0, 1);
      if (tag.ttl <= 0) tag.sprite.visible = false;
    }
    this.scanCd = Math.max(0, this.scanCd - dt);
    // Bat Hollow darkness while inside
    const wantCave = this.inCave() && this.quest >= 2 ? 1 : 0;
    this.caveK = lerp(this.caveK, wantCave, damp(0.6, dt));
    // clouds drift forever
    for (const c of this.clouds) {
      c.position.x += dt * 0.7;
      if (c.position.x > 70) c.position.x = -70;
    }
    // dusk fades back once the jitters scene is done
    if (!this.jitterActive && this.jitterPhase === 'dusk' && this.quest > 4 && this.duskK > 0) {
      this.duskK = clamp(this.duskK - dt / 3, 0, 1);
    }
    // combined lighting: dim world -> crisp bloom, cave darkness, dusk signal
    const k = easeInOut(this.bloomK);
    const sky = this.skyDim.clone().lerp(this.skyFull, k);
    if (this.duskK > 0) sky.lerp(new THREE.Color('#5a4a7e'), this.duskK * 0.7);
    if (this.caveK > 0) sky.lerp(new THREE.Color('#1c2733'), this.caveK * 0.85);
    this.scene.background = sky;
    if (this.scene.fog) {
      this.scene.fog.color.copy(sky);
      const fog = this.scene.fog as THREE.Fog;
      fog.near = lerp(lerp(55, 70, k), 16, this.caveK);
      fog.far = lerp(lerp(160, 190, k), 60, this.caveK);
    }
    this.hemi.intensity = lerp(0.5 + k * 0.45, 0.16, this.caveK) * (1 - this.duskK * 0.45);
    this.sun.intensity = lerp(0.85 + k * 0.85, 0.25, this.caveK) * (1 - this.duskK * 0.6);
    // vines sway; current-step felt vine pulses cyan
    for (const v of this.vines) {
      v.group.rotation.x = Math.sin(this.time * 1.1 + v.pos.x) * 0.03;
      if (this.quest === 3 && v.step === this.vineStep && v.correct && v.vineMat.emissiveIntensity > 0.5) {
        v.vineMat.emissiveIntensity = 1.3 + Math.sin(this.time * 4) * 0.5;
      }
    }
    // the cart (rolling / braking / returning)
    this.updateCart(dt);
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
    } else if (this.watchCart) {
      const mid = kp.clone().lerp(this.cart.group.position, 0.65);
      target = mid.clone().add(new THREE.Vector3(0, 14, 14));
      look = this.cart.group.position.clone().setY(1.5);
    } else {
      target = kp.clone().add(new THREE.Vector3(0, 13, 15));
      look = kp.clone().add(new THREE.Vector3(0, 2, 0));
    }
    this.camera.position.lerp(target, damp(0.4, dt));
    this.lookAtPt.lerp(look, damp(0.3, dt));
    this.camera.lookAt(this.lookAtPt);
  }

  private updateTrail(dt: number) {
    const obj = this.objectivePos();
    const wantsTrail =
      this.hud.started &&
      !this.hud.complete &&
      obj !== null &&
      (this.quest === 0 || (this.noProgressT > TRAIL_IDLE_DELAY && this.quest < 6));
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
