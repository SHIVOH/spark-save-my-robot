import { useState } from 'react';
import { Flower2, Leaf, Lock, Play } from 'lucide-react';
import Zone1Game from './Zone1Game';
import Zone2Game from './Zone2Game';

function zone2Unlocked(): boolean {
  try {
    return localStorage.getItem('spark-zone1-complete') === '1';
  } catch {
    return false;
  }
}

/**
 * Zone select shell: boots the Zone 1 or Zone 2 engine component (unmounting
 * one disposes its engine before the other is created).
 */
export default function Home() {
  const [zone, setZone] = useState<null | 1 | 2>(null);

  if (zone === 1) return <Zone1Game onExit={() => setZone(null)} />;
  if (zone === 2) return <Zone2Game onExit={() => setZone(null)} />;

  const unlocked = zone2Unlocked();

  return (
    <div className="relative flex h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-sky-300 via-emerald-50 to-cyan-100 font-sans select-none">
      <div className="text-center">
        <h1 className="text-5xl font-black text-slate-800 drop-shadow-sm">SPARK: Save My Robot</h1>
        <p className="mt-2 text-lg font-bold text-slate-600">Choose a zone</p>
      </div>
      <div className="mt-10 flex flex-col items-stretch gap-5 px-6 sm:flex-row">
        {/* Zone 1 — always available */}
        <button
          onClick={() => setZone(1)}
          className="flex w-64 flex-col items-center gap-2 rounded-3xl border-4 border-amber-300 bg-amber-100/90 p-6 shadow-xl transition-transform hover:scale-105 active:scale-95"
        >
          <Leaf className="h-12 w-12 text-amber-600" />
          <span className="text-xl font-black text-amber-900">Zone 1</span>
          <span className="text-sm font-bold text-amber-700">Meadow of Beginnings</span>
          <span className="mt-2 flex items-center gap-1 rounded-full bg-amber-400 px-4 py-1.5 text-sm font-black text-amber-950">
            <Play className="h-4 w-4 fill-amber-950" /> Play
          </span>
        </button>
        {/* Zone 2 — unlocked by completing Zone 1 */}
        {unlocked ? (
          <button
            onClick={() => setZone(2)}
            className="flex w-64 flex-col items-center gap-2 rounded-3xl border-4 border-cyan-300 bg-cyan-100/90 p-6 shadow-xl transition-transform hover:scale-105 active:scale-95"
          >
            <Flower2 className="h-12 w-12 text-cyan-600" />
            <span className="text-xl font-black text-cyan-900">Zone 2</span>
            <span className="text-sm font-bold text-cyan-700">Sensor Gardens</span>
            <span className="mt-2 flex items-center gap-1 rounded-full bg-cyan-400 px-4 py-1.5 text-sm font-black text-cyan-950">
              <Play className="h-4 w-4 fill-cyan-950" /> Play
            </span>
          </button>
        ) : (
          <div className="flex w-64 flex-col items-center gap-2 rounded-3xl border-4 border-slate-300 bg-slate-200/70 p-6 opacity-80">
            <Lock className="h-12 w-12 text-slate-500" />
            <span className="text-xl font-black text-slate-600">Zone 2</span>
            <span className="text-sm font-bold text-slate-500">Sensor Gardens</span>
            <span className="mt-2 rounded-full bg-slate-400/60 px-4 py-1.5 text-sm font-black text-slate-100">
              Finish Zone 1 to unlock
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
