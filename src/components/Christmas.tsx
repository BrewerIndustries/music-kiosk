// Over-the-top Christmas dressing: a twinkling string of lights along the top,
// falling snow, and drifting gold sparkles. Pure CSS animation (transforms and
// opacity only, so it stays smooth on an iPad); pointer-events off so it never
// blocks a tap; stills itself for prefers-reduced-motion.

// Deterministic "random" so server and client render the same flakes.
function rand(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const BULBS = ["#e23a4b", "#f6d27a", "#3fbf6f", "#4aa8ff", "#f6d27a"];

export function Christmas() {
  const flakes = Array.from({ length: 46 }, (_, i) => ({
    left: rand(i, 1) * 100,
    size: 3 + rand(i, 2) * 6,
    dur: 9 + rand(i, 3) * 12,
    delay: -rand(i, 4) * 20,
    drift: (rand(i, 5) - 0.5) * 80,
    opacity: 0.45 + rand(i, 6) * 0.5,
  }));
  const sparkles = Array.from({ length: 18 }, (_, i) => ({
    left: rand(i, 7) * 100,
    top: rand(i, 8) * 100,
    size: 8 + rand(i, 9) * 10,
    dur: 2.5 + rand(i, 10) * 3,
    delay: -rand(i, 11) * 5,
  }));
  return (
    <div aria-hidden className="xmas-layer">
      <div className="xmas-lights">
        {Array.from({ length: 28 }, (_, i) => (
          <span
            key={i}
            className="xmas-bulb"
            style={{ ["--bulb" as string]: BULBS[i % BULBS.length], animationDelay: `${-(i % 7) * 0.37}s` }}
          />
        ))}
      </div>
      {flakes.map((f, i) => (
        <span
          key={i}
          className="xmas-flake"
          style={{
            left: `${f.left}%`,
            width: f.size,
            height: f.size,
            opacity: f.opacity,
            animationDuration: `${f.dur}s`,
            animationDelay: `${f.delay}s`,
            ["--drift" as string]: `${f.drift}px`,
          }}
        />
      ))}
      {sparkles.map((s, i) => (
        <span
          key={i}
          className="xmas-sparkle"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            animationDuration: `${s.dur}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
