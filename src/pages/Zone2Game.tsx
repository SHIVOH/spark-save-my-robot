import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Battery,
  Cloud,
  Ear,
  Eye,
  Flower2,
  Footprints,
  Hand,
  Home as HomeIcon,
  Moon,
  Mountain,
  MoveHorizontal,
  Palette,
  Play,
  Radar,
  CircleSlash,
  Sparkles,
  Sun,
  TramFront,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import type { Zone2HudState } from '@/game/zone2/engine';
import { Zone2Engine } from '@/game/zone2/engine';

const QUEST_ICONS = [Footprints, Flower2, Radar, MoveHorizontal, Cloud, Eye, Sun, Sparkles];

const INITIAL_HUD: Zone2HudState = {
  started: false,
  questIndex: 0,
  questName: 'Into the Gardens',
  questText: 'Follow the cyan trail',
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

interface JoyState {
  active: boolean;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
}

// sensor pick options (quest 5): light / color / ultrasonic
const SENSOR_OPTIONS = [
  { icon: Sun, label: 'Light' },
  { icon: Palette, label: 'Color' },
  { icon: Ear, label: 'Ultrasonic' },
];
// reading prediction options per obstacle
const READING_OPTIONS: { icon: typeof Sun; label: string; color: string }[][] = [
  [
    { icon: Sun, label: 'Bright!', color: 'text-amber-500' },
    { icon: Moon, label: 'Dark', color: 'text-indigo-500' },
    { icon: Zap, label: 'Spiky', color: 'text-orange-500' },
  ],
  [
    { icon: Palette, label: 'Red', color: 'text-red-500' },
    { icon: Palette, label: 'Blue', color: 'text-blue-500' },
    { icon: Palette, label: 'Green', color: 'text-green-500' },
  ],
  [
    { icon: Hand, label: 'Near!', color: 'text-cyan-600' },
    { icon: Mountain, label: 'Far', color: 'text-slate-500' },
    { icon: CircleSlash, label: 'Nothing', color: 'text-slate-400' },
  ],
];

export default function Zone2Game({ onExit }: { onExit?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Zone2Engine | null>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<HTMLSpanElement>(null);
  const startleRef = useRef<HTMLDivElement>(null);
  const calmLineRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Zone2HudState>(INITIAL_HUD);
  const [muted, setMuted] = useState(false);
  const [joy, setJoy] = useState<JoyState>({ active: false, ox: 0, oy: 0, dx: 0, dy: 0 });
  const [cartValue, setCartValue] = useState(1);
  const [calmValue, setCalmValue] = useState(30);
  const joyRef = useRef<{ id: number; ox: number; oy: number; isJoy: boolean }>({
    id: -1,
    ox: 0,
    oy: 0,
    isJoy: false,
  });
  const [wasComplete] = useState(() => {
    try {
      return localStorage.getItem('spark-zone2-complete') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Zone2Engine(canvasRef.current, setHud);
    engineRef.current = engine;
    setMuted(engine.audio.muted);
    // per-frame values (bypass React render cycle): amber gauge, cyan chest
    // chip, and Flicker's live startle meter vs the calm-threshold line
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const e = engineRef.current;
      if (!e) return;
      if (gaugeRef.current) {
        const k = Math.max(0, Math.min(1, e.gauge / e.gaugeMax));
        gaugeRef.current.style.width = `${(k * 100).toFixed(1)}%`;
        gaugeRef.current.style.background = k < 0.2 ? '#ff7a1a' : '#ffb020';
      }
      if (readingRef.current) {
        if (readingRef.current.textContent !== e.readingText) {
          readingRef.current.textContent = e.readingText;
        }
      }
      if (startleRef.current) {
        startleRef.current.style.width = `${Math.round(e.calmStartle)}%`;
      }
      if (calmLineRef.current) {
        calmLineRef.current.style.left = `${Math.round(e.calmThreshold)}%`;
      }
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // When the completion card appears, the input layer unmounts — possibly
  // mid-drag. On touch each finger gets a fresh pointerId, so a lost
  // pointerup would otherwise jam the joystick for the rest of the session.
  useEffect(() => {
    if (!hud.complete) return;
    joyRef.current = { id: -1, ox: 0, oy: 0, isJoy: false };
    engineRef.current?.setJoystick(0, 0);
    setJoy({ active: false, ox: 0, oy: 0, dx: 0, dy: 0 });
  }, [hud.complete]);

  // keep the cart slider in sync when the modal opens
  useEffect(() => {
    if (hud.sliderOpen) setCartValue(hud.sliderValue);
  }, [hud.sliderOpen, hud.sliderValue]);

  const toggleMute = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const m = !muted;
    e.audio.ensure();
    e.audio.setMuted(m);
    setMuted(m);
  }, [muted]);

  // ------------------------------------------------------------------
  // Unified pointer layer (identical contract to Zone 1): tap-to-move and
  // tap-to-ping in the engine; floating joystick for touch drags.
  // ------------------------------------------------------------------
  const onPadDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    const e = engineRef.current;
    if (!e) return;
    e.handlePointerDown(ev.clientX, ev.clientY);
    if (joyRef.current.id !== -1 && joyRef.current.id !== ev.pointerId) {
      // stale pointer (a pointerup was lost, e.g. layer unmounted mid-drag):
      // drop it instead of ignoring every future touch
      joyRef.current = { id: -1, ox: 0, oy: 0, isJoy: false };
      e.setJoystick(0, 0);
    }
    if (joyRef.current.id === -1) {
      joyRef.current = { id: ev.pointerId, ox: ev.clientX, oy: ev.clientY, isJoy: false };
    }
  };

  const onPadMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const e = engineRef.current;
    if (!e) return;
    e.handlePointerMove(ev.clientX, ev.clientY);
    const j = joyRef.current;
    if (j.id !== ev.pointerId) return;
    const dx = ev.clientX - j.ox;
    const dy = ev.clientY - j.oy;
    if (!j.isJoy && Math.hypot(dx, dy) > 14 && !e.isWiringDrag()) {
      j.isJoy = true;
    }
    if (j.isJoy) {
      const r = 56;
      const len = Math.hypot(dx, dy);
      const cl = len > r ? r / len : 1;
      const nx = (dx * cl) / r;
      const ny = (dy * cl) / r;
      e.setJoystick(nx, ny);
      setJoy({ active: true, ox: j.ox, oy: j.oy, dx: dx * cl, dy: dy * cl });
    }
  };

  const onPadUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    const e = engineRef.current;
    if (!e) return;
    e.handlePointerUp(ev.clientX, ev.clientY);
    if (joyRef.current.id === ev.pointerId) {
      joyRef.current = { id: -1, ox: 0, oy: 0, isJoy: false };
      e.setJoystick(0, 0);
      setJoy({ active: false, ox: 0, oy: 0, dx: 0, dy: 0 });
    }
  };

  const QuestIcon = QUEST_ICONS[Math.min(hud.questIndex, QUEST_ICONS.length - 1)];
  const isSeatAction = hud.questIndex === 6 && hud.actionLabel !== null && hud.seatHold >= 0;
  const readingOpts = READING_OPTIONS[Math.min(hud.sensorObstacle, READING_OPTIONS.length - 1)];

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#8fa6b8] font-sans select-none">
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }}
      />

      {/* unified input layer */}
      {hud.started && !hud.complete && (
        <div
          className="fixed inset-0 z-10 touch-none"
          onPointerDown={onPadDown}
          onPointerMove={onPadMove}
          onPointerUp={onPadUp}
          onPointerCancel={onPadUp}
        />
      )}

      {/* floating joystick visual */}
      {joy.active && (
        <div
          className="pointer-events-none fixed z-20 rounded-full border-4 border-white/50 bg-white/10"
          style={{ left: joy.ox - 56, top: joy.oy - 56, width: 112, height: 112 }}
        >
          <div
            className="absolute rounded-full bg-cyan-400/90 shadow-lg"
            style={{ left: 36 + joy.dx, top: 36 + joy.dy, width: 40, height: 40 }}
          />
        </div>
      )}

      {/* HUD */}
      {hud.started && !hud.complete && (
        <>
          {/* amber energy gauge (power still matters) */}
          <div className="pointer-events-none fixed left-4 top-4 z-20 flex items-center gap-2 rounded-2xl bg-black/35 px-3 py-2 backdrop-blur-sm">
            <Battery className="h-7 w-7 text-amber-400" />
            <div className="relative h-5 w-40 overflow-hidden rounded-full border-2 border-amber-300/70 bg-black/40">
              <div ref={gaugeRef} className="h-full rounded-full" style={{ width: '80%', background: '#ffb020' }} />
            </div>
          </div>

          {/* cyan reading chip (Bolt's chest glyph, mirrored for readability) */}
          <div className="pointer-events-none fixed left-4 top-[3.4rem] z-20 flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5">
            <Radar className="h-4 w-4 text-cyan-300" />
            <span ref={readingRef} className="min-w-8 text-sm font-black text-cyan-200" />
          </div>

          {/* Bolt hope indicator: his eye-lights brighten with progress */}
          <div className="pointer-events-none fixed left-4 top-[5.6rem] z-20 flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5">
            {[0.33, 0.66, 1].map((th) => (
              <div
                key={th}
                className="h-2.5 w-2.5 rounded-full transition-colors duration-500"
                style={{ background: hud.boltHope >= th - 0.01 ? '#37e0e6' : '#334155' }}
              />
            ))}
          </div>

          {/* quest card: icon + <=5 words */}
          <div className="pointer-events-none fixed left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-black/35 px-4 py-2 backdrop-blur-sm max-sm:left-auto max-sm:right-4 max-sm:top-[4.5rem] max-sm:translate-x-0">
            <QuestIcon className="h-6 w-6 text-cyan-300" />
            <div className="text-white">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-200/80">
                {hud.questName}
              </div>
              <div className="text-sm font-bold leading-tight">{hud.questText}</div>
            </div>
            {hud.showBlooms && (
              <div className="ml-2 flex gap-1">
                {Array.from({ length: hud.bloomsTotal }).map((_, i) => (
                  <Flower2
                    key={i}
                    className="h-4 w-4"
                    style={{ color: i < hud.blooms ? '#ffb020' : '#475569' }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* mute toggle */}
          <button
            onClick={toggleMute}
            className="fixed right-4 top-4 z-30 rounded-full bg-black/35 p-3 text-white backdrop-blur-sm transition-transform active:scale-90"
            aria-label="Toggle sound"
          >
            {muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
          </button>

          {/* back to the zone picker — only in free play, so a stray tap can't lose a run */}
          {onExit && hud.questIndex >= 7 && (
            <button
              onClick={onExit}
              className="fixed right-20 top-4 z-30 flex items-center gap-1.5 rounded-full bg-black/35 px-4 py-3 text-sm font-black text-white backdrop-blur-sm transition-transform active:scale-90"
            >
              <HomeIcon className="h-5 w-5" /> Zones
            </button>
          )}

          {/* hint bubble (sits above the calm panel while that is open) */}
          {hud.hint && (
            <div className={`pointer-events-none fixed ${hud.calmMode ? 'bottom-[17rem]' : 'bottom-28'} left-1/2 z-20 -translate-x-1/2 animate-pulse rounded-2xl bg-cyan-400/95 px-5 py-2.5 text-center text-sm font-bold text-cyan-950 shadow-xl`}>
              {hud.hint}
            </div>
          )}

          {/* banner */}
          {hud.banner && (
            <div className="pointer-events-none fixed left-1/2 top-1/4 z-20 -translate-x-1/2 rounded-3xl bg-black/45 px-8 py-4 text-center backdrop-blur-sm">
              <div className="text-3xl font-black tracking-wide text-cyan-300 drop-shadow-lg">
                {hud.banner}
              </div>
            </div>
          )}

          {/* contextual action button */}
          {hud.actionLabel && !hud.sensorOpen && !hud.sliderOpen && (
            <button
              className="fixed bottom-8 right-6 z-30 flex items-center gap-2 rounded-full bg-cyan-400 px-6 py-4 text-lg font-black text-cyan-950 shadow-2xl transition-transform active:scale-95"
              onPointerDown={() => {
                if (isSeatAction) engineRef.current?.setSeatHolding(true);
              }}
              onPointerUp={() => {
                if (isSeatAction) engineRef.current?.setSeatHolding(false);
              }}
              onPointerLeave={() => {
                if (isSeatAction) engineRef.current?.setSeatHolding(false);
              }}
              onClick={() => {
                if (!isSeatAction) engineRef.current?.tapAction();
              }}
            >
              {isSeatAction && (
                <span className="relative flex h-7 w-7 items-center justify-center">
                  <span
                    className="absolute inset-0 rounded-full border-4 border-cyan-900/30"
                    style={{
                      background: `conic-gradient(#164e63 ${hud.seatHold * 360}deg, transparent 0deg)`,
                      borderRadius: '9999px',
                    }}
                  />
                  <Zap className="relative h-4 w-4" />
                </span>
              )}
              {hud.actionLabel}
            </button>
          )}

          {/* charge-dash button (touch) — stays unlocked from Zone 1 */}
          {hud.dashUnlocked && (
            <button
              className="fixed bottom-8 left-6 z-30 rounded-full bg-amber-400 p-4 text-amber-950 shadow-2xl transition-transform active:scale-90"
              onPointerDown={() => engineRef.current?.dashButton()}
              aria-label="Charge dash"
            >
              <Zap className="h-7 w-7" />
            </button>
          )}

          {/* scan-ping button (the new verb) once unlocked */}
          {hud.scanUnlocked && (
            <button
              className="fixed bottom-28 left-6 z-30 rounded-full bg-cyan-400 p-4 text-cyan-950 shadow-2xl transition-transform active:scale-90"
              onPointerDown={() => engineRef.current?.scanPing()}
              aria-label="Scan ping"
            >
              <Radar className="h-7 w-7" />
            </button>
          )}

          {/* Flicker's Jitters: live startle meter vs the calm-threshold line */}
          {hud.calmMode && (
            <div className="fixed bottom-28 left-1/2 z-30 w-[min(92vw,26rem)] -translate-x-1/2 rounded-3xl bg-black/45 p-4 backdrop-blur-sm">
              <div className="mb-2 flex items-center gap-2 text-cyan-100">
                <Cloud className="h-6 w-6" />
                <span className="text-sm font-black">
                  Flicker jumps when the bar passes the line ({Math.round(calmValue)})
                </span>
              </div>
              <div className="relative mb-3 h-6 overflow-hidden rounded-full border-2 border-cyan-300/60 bg-slate-800/80">
                <div
                  ref={startleRef}
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-orange-400"
                  style={{ width: '8%' }}
                />
                <div
                  ref={calmLineRef}
                  className="absolute top-0 h-full w-1.5 -translate-x-1/2 bg-white shadow"
                  style={{ left: '30%' }}
                />
              </div>
              <input
                type="range"
                min={5}
                max={98}
                step={1}
                value={calmValue}
                onChange={(ev) => {
                  const v = Number(ev.target.value);
                  setCalmValue(v);
                  engineRef.current?.setCalmThreshold(v);
                }}
                className="h-8 w-full accent-cyan-400"
                aria-label="Calm threshold"
              />
            </div>
          )}
        </>
      )}

      {/* minecart stop-threshold slider (Bat Hollow) */}
      {hud.sliderOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-3xl bg-cyan-50 p-6 text-center shadow-2xl">
            <TramFront className="mx-auto h-10 w-10 text-cyan-600" />
            <h2 className="mt-2 text-2xl font-black text-cyan-900">Stop the cart!</h2>
            <p className="mt-1 text-sm font-semibold text-cyan-800">
              Brake so the cart stops on the <span className="font-black text-green-600">green</span> zone.
            </p>
            <div className="mt-4 rounded-2xl bg-cyan-100 px-3 py-3 text-lg font-black text-cyan-900">
              IF distance &lt; <span className="text-4xl text-cyan-700">{cartValue} m</span> → BRAKE
            </div>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={cartValue}
              onChange={(ev) => {
                const v = Number(ev.target.value);
                setCartValue(v);
                engineRef.current?.setCartThreshold(v);
              }}
              className="mt-4 h-10 w-full accent-cyan-500"
              aria-label="Stop distance"
            />
            <div className="flex justify-between px-1 text-xs font-bold text-cyan-800/70">
              <span>1 m</span>
              <span>12 m</span>
            </div>
            <button
              onClick={() => engineRef.current?.confirmCartSlider()}
              className="mt-5 w-full rounded-full bg-cyan-500 px-8 py-4 text-xl font-black text-white shadow-xl transition-transform hover:scale-105 active:scale-95"
            >
              Roll the cart!
            </button>
            {hud.hint && <p className="mt-3 text-sm font-bold text-cyan-700">{hud.hint}</p>}
          </div>
        </div>
      )}

      {/* sensor module-swap modal (The Right Eyes): pick, then predict */}
      {hud.sensorOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-3xl bg-cyan-50 p-6 text-center shadow-2xl">
            <Eye className="mx-auto h-10 w-10 text-cyan-600" />
            <h2 className="mt-2 text-2xl font-black text-cyan-900">
              {hud.sensorStage === 'pick' ? 'Fit a sensor' : 'What will it read?'}
            </h2>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {hud.sensorStage === 'pick'
                ? SENSOR_OPTIONS.map((opt, i) => (
                    <button
                      key={opt.label}
                      onClick={() => engineRef.current?.pickSensor(i)}
                      className="flex flex-col items-center gap-1 rounded-2xl border-4 border-cyan-300 bg-cyan-100 p-4 transition-transform hover:scale-105 active:scale-95"
                    >
                      <opt.icon className="h-10 w-10 text-cyan-700" />
                      <span className="text-xs font-bold text-cyan-900">{opt.label}</span>
                    </button>
                  ))
                : readingOpts.map((opt, i) => (
                    <button
                      key={opt.label}
                      onClick={() => engineRef.current?.answerReading(i)}
                      className="flex flex-col items-center gap-1 rounded-2xl border-4 border-cyan-300 bg-cyan-100 p-4 transition-transform hover:scale-105 active:scale-95"
                    >
                      <opt.icon className={`h-10 w-10 ${opt.color}`} />
                      <span className="text-xs font-bold text-cyan-900">{opt.label}</span>
                    </button>
                  ))}
            </div>
            {hud.hint && <p className="mt-3 text-sm font-bold text-cyan-700">{hud.hint}</p>}
          </div>
        </div>
      )}

      {/* completion / end screen */}
      {hud.complete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-b from-cyan-900/60 to-black/70 backdrop-blur-sm">
          <div className="mx-4 max-w-lg rounded-3xl bg-cyan-50 p-8 text-center shadow-2xl">
            <Sparkles className="mx-auto h-12 w-12 text-cyan-500" />
            <h2 className="mt-3 text-3xl font-black text-cyan-900">Zone 2 Complete!</h2>
            <p className="mt-2 font-semibold text-cyan-800">
              Bolt's eyes and ears are restored — the Sensor Gardens bloom in crisp color, and
              you've unlocked the scan-ping!
            </p>
            <p className="mt-1 text-sm font-bold text-cyan-600">
              Vertical Slice complete — thanks for playing!
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                onClick={() => engineRef.current?.resumeFreePlay()}
                className="rounded-full bg-cyan-400 px-8 py-4 text-lg font-black text-cyan-950 shadow-xl transition-transform hover:scale-105 active:scale-95"
              >
                Keep exploring with scan-ping
              </button>
              {onExit && (
                <button onClick={onExit} className="text-sm font-black text-cyan-800 underline">
                  Back to zones
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* start screen */}
      {!hud.started && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-slate-400 via-cyan-100 to-teal-100">
          <div className="text-center">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">
              Sensor Gardens
            </div>
            <h1 className="mt-2 text-5xl font-black text-cyan-900 drop-shadow-sm">
              SPARK: Save My Robot
            </h1>
            <p className="mt-2 text-lg font-bold text-cyan-800/80">Zone 2 Vertical Slice</p>
            <p className="mt-1 text-sm font-bold text-cyan-700/70">
              Bolt's eyes and ears are dark — wake his sensors!
            </p>
            {wasComplete && (
              <p className="mt-1 text-sm font-bold text-emerald-700">✓ Completed — play again!</p>
            )}
          </div>
          <button
            onClick={() => engineRef.current?.start()}
            className="mt-10 flex items-center gap-3 rounded-full bg-cyan-400 px-12 py-6 text-2xl font-black text-cyan-950 shadow-2xl transition-transform hover:scale-105 active:scale-95"
          >
            <Play className="h-8 w-8 fill-cyan-950" />
            Play
          </button>
          <button
            onClick={toggleMute}
            className="mt-6 rounded-full bg-black/20 p-3 text-cyan-950"
            aria-label="Toggle sound"
          >
            {muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
          </button>
          <p className="mt-8 max-w-sm px-6 text-center text-sm font-semibold text-cyan-900/60">
            WASD or arrow keys to move · click or tap to walk · E to scan-ping · Shift to dash
          </p>
          {onExit && (
            <button
              onClick={onExit}
              className="mt-4 rounded-full bg-black/15 px-6 py-2 text-sm font-black text-cyan-900 transition-transform active:scale-95"
            >
              &larr; Zones
            </button>
          )}
        </div>
      )}
    </div>
  );
}
