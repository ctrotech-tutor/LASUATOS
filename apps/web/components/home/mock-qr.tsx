/**
 * A QR-looking pattern for illustrations. It is deliberately not a real QR
 * code: nobody should scan the homepage demo and land somewhere confusing.
 * Same seed, same pattern, so server and browser render identically.
 */
const SIZE = 25;

function random(seed: number) {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };
}

function inFinder(x: number, y: number): boolean {
  const near = (value: number, start: number) => value >= start && value < start + 8;
  return (near(x, 0) && near(y, 0)) || (near(x, SIZE - 8) && near(y, 0)) || (near(x, 0) && near(y, SIZE - 8));
}

// The hero asks for the same few patterns over and over; build each once.
const cache = new Map<number, string>();

function modulesFor(seed: number): string {
  const known = cache.get(seed);
  if (known !== undefined) return known;
  const next = random(seed + 7);
  let path = '';
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (inFinder(x, y)) continue;
      const timing = (x === 6 || y === 6) && (x + y) % 2 === 0;
      if (timing || next() > 0.53) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  if (cache.size > 64) cache.clear();
  cache.set(seed, path);
  return path;
}

function Finder({ x, y }: Readonly<{ x: number; y: number }>) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0.5" y="0.5" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="2" y="2" width="3" height="3" rx="0.6" fill="currentColor" />
    </g>
  );
}

export function MockQr({ seed, className }: Readonly<{ seed: number; className?: string }>) {
  return (
    <svg className={className} viewBox={`0 0 ${SIZE} ${SIZE}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <path d={modulesFor(seed)} fill="currentColor" />
      <g shapeRendering="geometricPrecision">
        <Finder x={0} y={0} />
        <Finder x={SIZE - 7} y={0} />
        <Finder x={0} y={SIZE - 7} />
      </g>
    </svg>
  );
}
