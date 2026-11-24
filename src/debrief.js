// Plan de bilan : ville, autoroute, trajet parcouru et fautes numérotées à l'endroit où elles ont été commises.
import { N, SP, RW, nodeX } from './city.js';
import { D as HD, RCO } from './highway.js';

export function drawMap(g, x0, y0, size, city, trace, faults) {
  const ext = HD + 22, k = size / (2 * ext);
  const P = (x, z) => [x0 + (x + ext) * k, y0 + (z + ext) * k];
  g.save();
  g.beginPath(); g.roundRect(x0, y0, size, size, 18); g.clip();
  g.fillStyle = '#1d2a1c'; g.fillRect(x0, y0, size, size);
  // autoroute
  const c = HD - RCO;
  g.strokeStyle = '#59606a'; g.lineWidth = Math.max(3, 22 * k); g.lineJoin = 'round';
  g.beginPath(); g.roundRect(...P(-HD, -HD), 2 * HD * k, 2 * HD * k, RCO * k); g.stroke();
  // route d'accès
  if (city.hw) { const [a, b] = P(city.hw.linkX0, city.hw.linkZ), [e] = P(city.hw.linkX1, city.hw.linkZ); g.lineWidth = Math.max(2, 8 * k); g.beginPath(); g.moveTo(a, b); g.lineTo(e, b); g.stroke(); }
  // îlots
  g.fillStyle = '#3b3f46';
  const H = (N - 1) / 2 * SP + RW;
  g.fillRect(...P(-H - 4, -H - 4), (2 * H + 8) * k, (2 * H + 8) * k);
  for (const b of city.blocks) {
    const [ax, ay] = P(b.x0, b.z0);
    g.fillStyle = '#6b6258'; g.fillRect(ax, ay, (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
  }
  for (const r of city.rounds || []) { const [cx, cy] = P(r.x, r.z); g.fillStyle = '#3f6b33'; g.beginPath(); g.arc(cx, cy, 6.3 * k, 0, 7); g.fill(); }
  // trajet
  if (trace.length > 1) {
    g.strokeStyle = '#4ea2ff'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); trace.forEach(([x, z], i) => { const [px, py] = P(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
    const [sx, sy] = P(...trace[0]); g.fillStyle = '#2ecc71'; g.beginPath(); g.arc(sx, sy, 6, 0, 7); g.fill();
  }
  // fautes
  g.font = '800 15px Inter, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  faults.forEach((f, i) => {
    if (f.x === undefined) return;
    const [fx, fy] = P(f.x, f.z);
    g.fillStyle = f.elim ? '#ff3b3b' : f.forgiven ? '#8fa3c7' : '#ffb020';
    g.beginPath(); g.arc(fx, fy, 11, 0, 7); g.fill();
    g.fillStyle = '#111'; g.fillText(String(i + 1), fx, fy + 1);
  });
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2; g.beginPath(); g.roundRect(x0, y0, size, size, 18); g.stroke();
}
void nodeX;
