/**
 * Decorative HUD reticle behind/around the orb: tick ring, dashed orbit,
 * crosshair lines. Pure SVG, pointer-transparent, never blocks interaction.
 */
export default function Reticle() {
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
      {/* crosshair */}
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#39D8FF]/15 to-transparent" />
      <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-gradient-to-r from-transparent via-[#39D8FF]/15 to-transparent" />

      <svg
        className="absolute left-1/2 top-1/2 h-[min(72vh,86%)] w-[min(72vh,86%)] -translate-x-1/2 -translate-y-1/2 opacity-70"
        viewBox="0 0 400 400"
        fill="none"
      >
        {/* outer tick ring */}
        <g className="reticle-spin" style={{ transformOrigin: '200px 200px' }}>
          <circle cx="200" cy="200" r="188" stroke="rgba(57,216,255,0.25)" strokeWidth="1" />
          {ticks.map((i) => {
            const a = (i / 60) * Math.PI * 2;
            const major = i % 5 === 0;
            const r1 = major ? 176 : 182;
            const x1 = 200 + Math.cos(a) * r1;
            const y1 = 200 + Math.sin(a) * r1;
            const x2 = 200 + Math.cos(a) * 188;
            const y2 = 200 + Math.sin(a) * 188;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={major ? 'rgba(57,216,255,0.65)' : 'rgba(57,216,255,0.3)'} strokeWidth={major ? 1.4 : 0.8} />;
          })}
        </g>

        {/* inner dashed orbit */}
        <g className="reticle-spin-rev" style={{ transformOrigin: '200px 200px' }}>
          <circle cx="200" cy="200" r="150" stroke="rgba(168,85,247,0.35)" strokeWidth="1" strokeDasharray="6 10" />
        </g>

        {/* static bracket marks */}
        {[0, 90, 180, 270].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 200 200)`}>
            <path d="M 196 6 L 196 16 M 204 6 L 204 16" stroke="rgba(57,216,255,0.8)" strokeWidth="1.5" />
          </g>
        ))}

        {/* corner readout boxes */}
        <g className="hud-mono" fontSize="8" fill="rgba(104,118,154,0.9)" fontFamily="monospace">
          <text x="34" y="40">+100</text>
          <text x="340" y="40">+100</text>
          <text x="34" y="368">-100</text>
          <text x="340" y="368">-100</text>
          <text x="186" y="26">000</text>
        </g>
      </svg>
    </div>
  );
}
