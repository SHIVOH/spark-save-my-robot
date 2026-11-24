import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Cable,
  Flag,
  Lightbulb,
  MapPin,
  Play,
  Sparkles,
  Sunrise,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import type { HudState } from '@/game/engine';
import { GameEngine } from '@/game/engine';

const QUEST_ICONS = [Sunrise, BatteryCharging, Cable, MapPin, Lightbulb, Sparkles, Zap];

const INITIAL_HUD: HudState = {
  started: false,
  questIndex: 0,
  questName: 'First Light',
  questText: 'Follow the amber trail',
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

interface JoyState {
  active: boolean;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
}

export default function Zone1Game({ onExit }: { onExit?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const gaugeTextRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [muted, setMuted] = useState(false);
  const [joy, setJoy] = useState<JoyState>({ active: false, ox: 0, oy: 0, dx: 0, dy: 0 });
  const joyRef = useRef<{ id: number; ox: number; oy: number; isJoy: boolean }>({
    id: -1,
    ox: 0,
    oy: 0,
    isJoy: false,
  });
  const [wasComplete] = useState(() => {
    try {
      return localStorage.getItem('spark-zone1-complete') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, setHud);
    engineRef.current = engine;
    setMuted(engine.audio.muted);
    // per-frame gauge fill (bypasses React render cycle)
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const e = engineRef.current;
      if (!e || !gaugeRef.current) return;
      const k = Math.max(0, Math.min(1, e.gauge / e.gaugeMax));
      gaugeRef.current.style.width = `${(k * 100).toFixed(1)}%`;
      gaugeRef.current.style.background = k < 0.2 ? '#ff7a1a' : '#ffb020';
      if (gaugeTextRef.current) {
        gaugeTextRef.current.style.opacity = k < 0.2 ? '1' : '0';
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

  const toggleMute = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const m = !muted;
    e.audio.ensure();
    e.audio.setMuted(m);
    setMuted(m);
  }, [muted]);

  // ------------------------------------------------------------------
  // Unified pointer layer: tap-to-move + wiring drag (engine) and the
  // floating joystick (touch). A press that barely moves = tap; a press
  // that drags = joystick (unless the engine grabbed a wiring port).
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
  const isSeatAction = hud.questIndex === 5 && hud.actionLabel !== null && hud.seatHold >= 0;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#bfe8ff] font-sans select-none">
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
            className="absolute rounded-full bg-amber-400/90 shadow-lg"
            style={{ left: 36 + joy.dx, top: 36 + joy.dy, width: 40, height: 40 }}
          />
        </div>
      )}

      {/* HUD */}
      {hud.started && !hud.complete && (
        <>
          {/* amber energy gauge */}
          <div className="pointer-events-none fixed left-4 top-4 z-20 flex items-center gap-2 rounded-2xl bg-black/35 px-3 py-2 backdrop-blur-sm">
            <Battery className="h-7 w-7 text-amber-400" />
            <div className="relative h-5 w-40 overflow-hidden rounded-full border-2 border-amber-300/70 bg-black/40">
              <div ref={gaugeRef} className="h-full rounded-full" style={{ width: '60%', background: '#ffb020' }} />
              <div ref={gaugeTextRef} className="absolute inset-0 flex items-center justify-center opacity-0">
                <Zap className="h-4 w-4 animate-pulse text-orange-300" />
              </div>
            </div>
            {hud.lantern && <Lightbulb className="h-6 w-6 animate-pulse text-amber-300" />}
          </div>

          {/* Bolt hope indicator: his eye-lights brighten with progress */}
          <div className="pointer-events-none fixed left-4 top-[4.2rem] z-20 flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5">
            {[0.33, 0.66, 1].map((th) => (
              <div
                key={th}
                className="h-2.5 w-2.5 rounded-full transition-colors duration-500"
                style={{ background: hud.boltHope >= th - 0.01 ? '#37e0e6' : '#334155' }}
              />
            ))}
          </div>

          {/* quest card: icon + <=5 words */}
          <div className="pointer-events-none fixed left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-black/35 px-4 py-2 backdrop-blur-sm">
            <QuestIcon className="h-6 w-6 text-amber-300" />
            <div className="text-white">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-200/80">
                {hud.questName}
              </div>
              <div className="text-sm font-bold leading-tight">{hud.questText}</div>
            </div>
            {hud.showCells && (
              <div className="ml-2 flex gap-1">
                {Array.from({ length: hud.cellsTotal }).map((_, i) => (
                  <div
                    key={i}
                    className="h-3 w-3 rounded-full"
                    style={{ background: i < hud.cells ? '#ffb020' : '#475569' }}
                  />
                ))}
              </div>
            )}
            {hud.showStations && (
              <div className="ml-2 flex gap-1">
                {Array.from({ length: hud.stationsTotal }).map((_, i) => (
                  <Flag
                    key={i}
                    className="h-4 w-4"
                    style={{ color: i < hud.stations ? '#ffb020' : '#475569' }}
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

          {/* hint bubble */}
          {hud.hint && (
            <div className="pointer-events-none fixed bottom-28 left-1/2 z-20 -translate-x-1/2 animate-pulse rounded-2xl bg-amber-400/95 px-5 py-2.5 text-center text-sm font-bold text-amber-950 shadow-xl">
              {hud.hint}
            </div>
          )}

          {/* banner */}
          {hud.banner && (
            <div className="pointer-events-none fixed left-1/2 top-1/4 z-20 -translate-x-1/2 rounded-3xl bg-black/45 px-8 py-4 text-center backdrop-blur-sm">
              <div className="text-3xl font-black tracking-wide text-amber-300 drop-shadow-lg">
                {hud.banner}
              </div>
            </div>
          )}

          {/* contextual action button */}
          {hud.actionLabel && !hud.predictionOpen && (
            <button
              className="fixed bottom-8 right-6 z-30 flex items-center gap-2 rounded-full bg-amber-400 px-6 py-4 text-lg font-black text-amber-950 shadow-2xl transition-transform active:scale-95"
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
                    className="absolute inset-0 rounded-full border-4 border-amber-900/30"
                    style={{
                      background: `conic-gradient(#78350f ${hud.seatHold * 360}deg, transparent 0deg)`,
                      borderRadius: '9999px',
                    }}
                  />
                  <Zap className="relative h-4 w-4" />
                </span>
              )}
              {hud.actionLabel}
            </button>
          )}

          {/* charge-dash button (touch) once unlocked */}
          {hud.dashUnlocked && (
            <button
              className="fixed bottom-8 left-6 z-30 rounded-full bg-cyan-400 p-4 text-cyan-950 shadow-2xl transition-transform active:scale-90"
              onPointerDown={() => engineRef.current?.dashButton()}
              aria-label="Charge dash"
            >
              <Zap className="h-7 w-7" />
            </button>
          )}
        </>
      )}

      {/* prediction modal: pictogram choice before the crossing */}
      {hud.predictionOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 max-w-md rounded-3xl bg-amber-50 p-6 text-center shadow-2xl">
            <Lightbulb className="mx-auto h-10 w-10 text-amber-500" />
            <h2 className="mt-2 text-2xl font-black text-amber-900">The Sunset Crossing</h2>
            <p className="mt-1 text-sm font-semibold text-amber-800">
              The lantern is full. Is that enough charge to reach the gate?
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <button
                onClick={() => engineRef.current?.answerPrediction(0)}
                className="flex flex-col items-center gap-1 rounded-2xl border-4 border-green-300 bg-green-100 p-4 transition-transform hover:scale-105 active:scale-95"
              >
                <BatteryFull className="h-10 w-10 text-green-600" />
                <span className="text-xs font-bold text-green-800">Plenty!</span>
              </button>
              <button
                onClick={() => engineRef.current?.answerPrediction(1)}
                className="flex flex-col items-center gap-1 rounded-2xl border-4 border-amber-300 bg-amber-100 p-4 transition-transform hover:scale-105 active:scale-95"
              >
                <BatteryMedium className="h-10 w-10 text-amber-600" />
                <span className="text-xs font-bold text-amber-800">Just enough</span>
              </button>
              <button
                onClick={() => engineRef.current?.answerPrediction(2)}
                className="flex flex-col items-center gap-1 rounded-2xl border-4 border-red-300 bg-red-100 p-4 transition-transform hover:scale-105 active:scale-95"
              >
                <BatteryLow className="h-10 w-10 text-red-500" />
                <span className="text-xs font-bold text-red-700">Not enough</span>
              </button>
            </div>
            {hud.hint && <p className="mt-3 text-sm font-bold text-amber-700">{hud.hint}</p>}
          </div>
        </div>
      )}

      {/* completion / end screen */}
      {hud.complete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-b from-amber-900/60 to-black/70 backdrop-blur-sm">
          <div className="mx-4 max-w-lg rounded-3xl bg-amber-50 p-8 text-center shadow-2xl">
            <Sparkles className="mx-auto h-12 w-12 text-amber-500" />
            <h2 className="mt-3 text-3xl font-black text-amber-900">Zone 1 Complete!</h2>
            <p className="mt-2 font-semibold text-amber-800">
              Bolt's battery is restored. The meadow is in full bloom — and you've unlocked the
              charge-dash!
            </p>
            <p className="mt-1 text-sm font-bold text-amber-600">
              Vertical Slice complete — thanks for playing!
            </p>
            <button
              onClick={() => engineRef.current?.resumeFreePlay()}
              className="mt-6 rounded-full bg-amber-400 px-8 py-4 text-lg font-black text-amber-950 shadow-xl transition-transform hover:scale-105 active:scale-95"
            >
              Keep exploring with charge-dash
            </button>
          </div>
        </div>
      )}

      {/* start screen */}
      {!hud.started && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-sky-300 via-emerald-100 to-amber-100">
          <div className="text-center">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">
              Meadow of Beginnings
            </div>
            <h1 className="mt-2 text-5xl font-black text-amber-900 drop-shadow-sm">
              SPARK: Save My Robot
            </h1>
            <p className="mt-2 text-lg font-bold text-amber-800/80">Zone 1 Vertical Slice</p>
            {wasComplete && (
              <p className="mt-1 text-sm font-bold text-emerald-700">✓ Completed — play again!</p>
            )}
          </div>
          <button
            onClick={() => engineRef.current?.start()}
            className="mt-10 flex items-center gap-3 rounded-full bg-amber-400 px-12 py-6 text-2xl font-black text-amber-950 shadow-2xl transition-transform hover:scale-105 active:scale-95"
          >
            <Play className="h-8 w-8 fill-amber-950" />
            Play
          </button>
          <button
            onClick={toggleMute}
            className="mt-6 rounded-full bg-black/20 p-3 text-amber-950"
            aria-label="Toggle sound"
          >
            {muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
          </button>
          <p className="mt-8 max-w-sm px-6 text-center text-sm font-semibold text-amber-900/60">
            WASD or arrow keys to move · click or tap to walk · Space to jump · Shift to sprint
          </p>
          {onExit && (
            <button
              onClick={onExit}
              className="mt-4 rounded-full bg-black/15 px-6 py-2 text-sm font-black text-amber-900 transition-transform active:scale-95"
            >
              &larr; Zones
            </button>
          )}
        </div>
      )}
    </div>
  );
}
