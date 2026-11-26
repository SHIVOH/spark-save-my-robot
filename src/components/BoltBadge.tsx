// Bolt the robot, as a friendly inline SVG for title screens.
// Matches his in-game rig: amber round body, teal belly, cyan eye-lights
// (the left one slightly bigger — canon), antenna with an amber tip.
export default function BoltBadge({ className = 'h-28 w-28' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 124" className={className} role="img" aria-label="Bolt the robot">
      {/* antenna */}
      <line x1="60" y1="20" x2="60" y2="10" stroke="#c78d2c" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="8" r="5" fill="#ffb020" />
      {/* head dome */}
      <circle cx="60" cy="42" r="24" fill="#ffc44d" />
      {/* eye-lights — the left one is bigger (canon) */}
      <circle cx="50" cy="42" r="6.5" fill="#0e7490" />
      <circle cx="50" cy="42" r="4.5" fill="#37e0e6" />
      <circle cx="71" cy="42" r="5" fill="#0e7490" />
      <circle cx="71" cy="42" r="3.4" fill="#37e0e6" />
      {/* body */}
      <ellipse cx="60" cy="88" rx="32" ry="30" fill="#ffc44d" />
      {/* teal belly band */}
      <ellipse cx="60" cy="100" rx="22" ry="13" fill="#4db6ac" />
      {/* amber battery-core in the chest */}
      <circle cx="60" cy="80" r="6" fill="#ffb020" />
      {/* feet */}
      <circle cx="43" cy="115" r="7" fill="#5a6270" />
      <circle cx="77" cy="115" r="7" fill="#5a6270" />
    </svg>
  );
}
