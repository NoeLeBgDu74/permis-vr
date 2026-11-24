// Autoroute en anneau autour de la ville : 2×2 voies, BAU, séparateur béton, glissières, panneaux,
// route d'accès depuis la rocade (nœud 5,2) avec bretelle de sortie et bretelle d'insertion (voie d'accélération).
// Repère : abscisse curviligne s le long de l'axe central, décalage latéral u (positif vers l'extérieur).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, pbr } from './assets.js';
import { loadCarTemplate, makeCar, poseCar, carLOD, PAINTS } from './car.js';
import { buildTruck, buildBus } from './vehicles.js';

export const D = 520, RCO = 140, SIDE = 2 * (D - RCO);
export const PER = 4 * SIDE + 2 * Math.PI * RCO;
export const U = { med: 0.5, edgeL: 1.3, lane1: 3.1, lane2: 6.7, sep: 4.9, edgeR: 8.6, shoulder: 11.2, rail: 11.6 }; // |u| : voie de gauche (rapide) 3,1 ; voie de droite 6,7
const A = Math.PI / 2 * RCO;

// point de l'axe à l'abscisse s : {x,z,tx,tz,nx,nz}
export function at(s) {
  s = ((s % PER) + PER) % PER;
  const c = D - RCO;
  const arc = (cx, cz, a0, ds) => { const a = a0 + ds / RCO; return { x: cx + Math.cos(a) * RCO, z: cz + Math.sin(a) * RCO, tx: -Math.sin(a), tz: Math.cos(a), nx: Math.cos(a), nz: Math.sin(a) }; };
  if (s < SIDE) return { x: D, z: -c + s, tx: 0, tz: 1, nx: 1, nz: 0 };
  s -= SIDE; if (s < A) return arc(c, c, 0, s);
  s -= A; if (s < SIDE) return { x: c - s, z: D, tx: -1, tz: 0, nx: 0, nz: 1 };
  s -= SIDE; if (s < A) return arc(-c, c, Math.PI / 2, s);
  s -= A; if (s < SIDE) return { x: -D, z: c - s, tx: 0, tz: -1, nx: -1, nz: 0 };
  s -= SIDE; if (s < A) return arc(-c, -c, Math.PI, s);
  s -= A; if (s < SIDE) return { x: -c + s, z: -D, tx: 1, tz: 0, nx: 0, nz: -1 };
  s -= SIDE; return arc(c, -c, Math.PI * 1.5, s);
}
// projection d'un point sur l'axe : {s, u}
export function project(x, z) {
  const c = D - RCO, dx = Math.abs(x) - c, dz = Math.abs(z) - c;
  if (dx > 0 && dz > 0) {
    const cx = Math.sign(x) * c, cz = Math.sign(z) * c;
    let a = Math.atan2(z - cz, x - cx); if (a < 0) a += Math.PI * 2;
    const u = Math.hypot(x - cx, z - cz) - RCO;
    let s;
    if (x > 0 && z > 0) s = SIDE + a * RCO;
    else if (x < 0 && z > 0) s = 2 * SIDE + A + (a - Math.PI / 2) * RCO;
    else if (x < 0 && z < 0) s = 3 * SIDE + 2 * A + (a - Math.PI) * RCO;
    else s = 4 * SIDE + 3 * A + (a - Math.PI * 1.5) * RCO;
    return { s, u };
  }
  if (dx > dz) return x > 0 ? { s: z + c, u: x - D } : { s: 2 * SIDE + 2 * A + (c - z), u: -x - D };
  return z > 0 ? { s: SIDE + A + (c - x), u: z - D } : { s: 3 * SIDE + 3 * A + (x + c), u: -z - D };
}

export class Highway {
  constructor(scene, city) {
    this.scene = scene; this.city = city;
    this.group = new THREE.Group(); scene.add(this.group);
    // route d'accès : depuis la rocade (x = bord de ville) vers l'est, à la hauteur du nœud (5,2)
    const ext = city.ext;
    this.linkZ = city.nodes[5][2].z; this.linkX0 = ext; this.linkX1 = 468;
    const zL = this.linkZ;
    // côté intérieur de l'anneau (u < 0) : la chaussée « IN » y roule dans le sens des s croissants (vers +z côté est)
    this.sLink = zL + (D - RCO);
    this.exitS0 = this.sLink - 175; this.exitS1 = this.sLink - 105;      // voie de décélération
    this.accS0 = this.sLink + 40; this.accS1 = this.sLink + 170;         // voie d'accélération
    const xr = D - 12.6;                                                  // axe des voies annexes (u ≈ -12.6)
    // trajectoires des bretelles (polylignes {x,z})
    const bez = (p0, c, p2, n = 28) => { const o = []; for (let k = 0; k <= n; k++) { const t = k / n, q = 1 - t; o.push({ x: q * q * p0.x + 2 * q * t * c.x + t * t * p2.x, z: q * q * p0.z + 2 * q * t * c.z + t * t * p2.z }); } return o; };
    this.exitRamp = bez({ x: xr, z: zL - 120 + (this.exitS1 - this.sLink + 120) }, { x: xr, z: zL - 3 }, { x: this.linkX1, z: zL - 1.95 });
    this.onRamp = bez({ x: this.linkX1, z: zL + 1.95 }, { x: xr, z: zL + 3 }, { x: xr, z: zL + 40 });
    for (const r of [this.exitRamp, this.onRamp]) { let L = 0; r[0].L = 0; for (let i = 1; i < r.length; i++) { L += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z); r[i].L = L; } r.len = L; }
    this.cars = []; this.player = null;
  }

  // ---------- requêtes ----------
  near(x, z, m) { const p = project(x, z); if (Math.abs(p.u) < U.rail + m) return true; return this.onLinkArea(x, z, m); }
  onLinkArea(x, z, m = 0) {
    if (x > this.linkX0 - 1 && x < this.linkX1 + 2 && Math.abs(z - this.linkZ) < 4.3 + m) return true;
    for (const r of [this.exitRamp, this.onRamp]) if (distPoly(x, z, r) < 2.6 + m) return true;
    return false;
  }
  // une roue peut-elle être là ? (chaussée, BAU, voies annexes, bretelles, route d'accès)
  drivable(x, z) {
    if (this.onLinkArea(x, z)) return true;
    const p = project(x, z), au = Math.abs(p.u);
    if (au < U.med) return false;                               // séparateur
    if (au <= U.shoulder) return true;
    const inLane = p.u < 0 && au <= 14.4 && (inS(p.s, this.exitS0 - 40, this.exitS1 + 2) || inS(p.s, this.accS0 - 2, this.accS1 + 60));
    return inLane;
  }
  // localisation fine pour l'examen
  locate(x, z) {
    if (x > this.linkX0 - 0.5 && x < this.linkX1 && Math.abs(z - this.linkZ) < 4.3) return { type: 'link', lat: z - this.linkZ };
    if (distPoly(x, z, this.exitRamp) < 2.6) return { type: 'ramp', which: 'exit' };
    if (distPoly(x, z, this.onRamp) < 2.6) return { type: 'ramp', which: 'on' };
    const p = project(x, z), au = Math.abs(p.u);
    if (au > 15) return null;
    const cw = p.u < 0 ? 'in' : 'out';
    const lane = au < U.sep ? 'left' : au < U.edgeR ? 'right' : (au < U.shoulder ? 'shoulder' : 'extra');
    return { type: 'hw', s: p.s, u: p.u, cw, lane };
  }

  // ---------- construction ----------
  async build(rainy) {
    const G = new Map(); const add = (k, g) => { if (!G.has(k)) G.set(k, []); G.get(k).push(g.index ? g.toNonIndexed() : g); };
    const M = {
      asphalt: this.city.mats.asphalt, mark: this.city.mats.mark, grass: this.city.mats.grassFar,
      concrete: pbr('concrete_floor_02', { scale: 1.5, color: 0xd8d6d0 }),
      rail: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.9 }),
      post: new THREE.MeshStandardMaterial({ color: 0x8e9296, roughness: 0.5, metalness: 0.8 }),
    };
    const STEP = 2;
    // ruban le long de l'anneau entre u0 et u1, à la hauteur y, sur [s0,s1]
    const ribbon = (u0, u1, y, s0 = 0, s1 = PER, step = STEP) => {
      const n = Math.ceil((s1 - s0) / step), P = [], UV = [];
      for (let k = 0; k < n; k++) {
        const sa = s0 + k * step, sb = Math.min(s1, sa + step), a = at(sa), b = at(sb);
        const v = (p, u) => [p.x + p.nx * u, y, p.z + p.nz * u];
        const a0 = v(a, u0), a1 = v(a, u1), b0 = v(b, u0), b1 = v(b, u1);
        P.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
        UV.push(u0, sa, u0, sb, u1, sb, u0, sa, u1, sb, u1, sa);
      }
      faceUp(P, UV);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      g.computeVertexNormals(); // les normales pointent vers le haut si l'ordre est correct : on force
      const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
      return g;
    };
    // chaussées (y légèrement au-dessus de la campagne)
    add('asphalt', ribbon(-U.shoulder, -U.med, 0.03)); add('asphalt', ribbon(U.med, U.shoulder, 0.03));
    // voies annexes (décélération / accélération)
    add('asphalt', ribbon(-14.4, -U.shoulder + 0.01, 0.031, this.exitS0 - 40, this.exitS1 + 2));
    add('asphalt', ribbon(-14.4, -U.shoulder + 0.01, 0.031, this.accS0 - 2, this.accS1 + 60));
    // terre-plein central (béton) + séparateur GBA
    add('concrete', ribbon(-U.med, U.med, 0.035));
    // marquages : bords continus, séparation des voies discontinue (10 m / 14 m), ligne de BAU
    for (const sg of [-1, 1]) {
      add('mark', ribbon(sg * (U.edgeL - 0.1), sg * (U.edgeL + 0.1), 0.045));
      for (let s = 0; s < PER - 10; s += 24) add('mark', ribbon(sg * (U.sep - 0.08), sg * (U.sep + 0.08), 0.045, s, s + 10, 2.5));
      if (sg > 0) add('mark', ribbon(U.edgeR, U.edgeR + 0.25, 0.045));
      else {
        add('mark', ribbon(-U.edgeR - 0.25, -U.edgeR, 0.045, 0, this.exitS0 - 40));
        add('mark', ribbon(-U.edgeR - 0.25, -U.edgeR, 0.045, this.accS1 + 60, PER));
        for (const [a, b] of [[this.exitS0 - 40, this.exitS1 + 2], [this.accS0 - 2, this.accS1 + 60]]) for (let s = a; s < b - 3; s += 6) add('mark', ribbon(-U.edgeR - 0.25, -U.edgeR, 0.045, s, s + 3, 1.5));
      }
    }
    // séparateur central : profil béton extrudé (GBA)
    const gba = [];
    for (let s = 0; s < PER; s += 4) { const a = at(s); const b = new THREE.BoxGeometry(0.5, 0.82, 4.02); b.rotateY(Math.atan2(a.tx, a.tz)); b.translate(a.x, 0.44, a.z); gba.push(b.toNonIndexed()); }
    const gb = new THREE.Mesh(mergeGeometries(gba), M.concrete); gb.castShadow = true; gb.receiveShadow = true; this.group.add(gb);
    // glissières métalliques (lisse + poteaux), interrompues au niveau des bretelles
    const rails = [], posts = [];
    for (const sg of [-1, 1]) for (let s = 0; s < PER; s += 4) {
      if (sg < 0 && inS(s, this.exitS0 - 44, this.accS1 + 64)) continue;
      const a = at(s), u = sg * U.rail, x = a.x + a.nx * u, z = a.z + a.nz * u, yaw = Math.atan2(a.tx, a.tz);
      const r = new THREE.BoxGeometry(0.05, 0.32, 4.02); r.rotateY(yaw); r.translate(x, 0.62, z); rails.push(r.toNonIndexed());
      const p = new THREE.BoxGeometry(0.12, 0.7, 0.12); p.translate(x - a.nx * 0.1 * sg, 0.35, z - a.nz * 0.1 * sg); posts.push(p.toNonIndexed());
    }
    const rm = new THREE.Mesh(mergeGeometries(rails), M.rail); rm.castShadow = true; this.group.add(rm);
    const pm = new THREE.Mesh(mergeGeometries(posts), M.post); this.group.add(pm);
    // route d'accès + bretelles
    const zL = this.linkZ;
    { const g = new THREE.PlaneGeometry(this.linkX1 - this.linkX0 + 2, 8.6); g.rotateX(-Math.PI / 2); g.translate((this.linkX0 + this.linkX1) / 2 + 1, 0.03, zL); uvMeters(g); add('asphalt', g); }
    for (const r of [this.exitRamp, this.onRamp]) add('asphalt', polyRibbon(r, -2.7, 2.7, 0.032));
    // marquages de la route d'accès : axe continu (pas de dépassement) + rives
    { const g = new THREE.PlaneGeometry(this.linkX1 - this.linkX0, 0.14); g.rotateX(-Math.PI / 2); g.translate((this.linkX0 + this.linkX1) / 2, 0.046, zL); add('mark', g); }
    for (const sg of [-1, 1]) { const g = new THREE.PlaneGeometry(this.linkX1 - this.linkX0, 0.12); g.rotateX(-Math.PI / 2); g.translate((this.linkX0 + this.linkX1) / 2, 0.046, zL + sg * 3.95); add('mark', g); }
    for (const r of [this.exitRamp, this.onRamp]) for (const e of [-2.45, 2.45]) add('mark', polyRibbon(r, e - 0.06, e + 0.06, 0.047));
    // ligne de stop à l'arrivée sur la rocade (la route d'accès est secondaire)
    { const g = new THREE.PlaneGeometry(0.5, 4.0); g.rotateX(-Math.PI / 2); g.translate(this.linkX0 + 1.0, 0.047, zL - 2.15); add('mark', g); }
    for (const [k, list] of G) { const m = new THREE.Mesh(mergeGeometries(list), M[k]); m.receiveShadow = true; m.matrixAutoUpdate = false; this.group.add(m); }
    this.buildSigns(rainy);
  }

  buildSigns(rainy) {
    const sign = (tex, w, h, x, y, z, yaw, poleH) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 })); m.position.set(0, y, 0.06); g.add(m);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), new THREE.MeshStandardMaterial({ color: 0x8d9196, metalness: 0.6, roughness: 0.5 })); back.position.set(0, y, 0); g.add(back);
      for (const px of (w > 2 ? [-w / 2 + 0.3, w / 2 - 0.3] : [0])) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, poleH, 10), new THREE.MeshStandardMaterial({ color: 0x9a9ea3, metalness: 0.8, roughness: 0.4 })); p.position.set(px, poleH / 2, -0.06); g.add(p); }
      g.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.group.add(g);
    };
    const blue = (lines, w = 512, h = 256) => canvasTex(w, h, (g) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d4ed8'; g.fillRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      lines.forEach(([t, size, y]) => { g.font = `bold ${size}px Arial`; g.fillText(t, w / 2, y); });
    });
    const speed = (v) => canvasTex(256, 256, (g) => { g.translate(128, 128); g.beginPath(); g.arc(0, 0, 124, 0, 7); g.fillStyle = '#c8102e'; g.fill(); g.beginPath(); g.arc(0, 0, 96, 0, 7); g.fillStyle = '#fff'; g.fill(); g.fillStyle = '#111'; g.font = `bold ${v >= 100 ? 92 : 104}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), 0, 8); });
    const zL = this.linkZ;
    // entrée d'autoroute (sur la route d'accès, côté droit en allant vers l'est)
    sign(blue([['A 77', 64, 70], ['VILLE-NOUVELLE', 44, 150], ['AUTOROUTE', 40, 210]]), 3.0, 1.5, this.linkX0 + 60, 2.6, zL + 5.6, -Math.PI / 2, 3.4);
    sign(speed(70), 0.8, 0.8, this.linkX0 + 20, 2.2, zL + 5.4, -Math.PI / 2, 2.6);
    // limitations le long de l'anneau (chaussée intérieure, côté droit = u très négatif)
    const lim = rainy ? 110 : 130;
    for (let s = 300; s < PER; s += 900) for (const sg of [-1, 1]) {
      const a = at(s); const x = a.x + a.nx * sg * 12.5, z = a.z + a.nz * sg * 12.5;
      const dirTx = sg < 0 ? a.tx : -a.tx, dirTz = sg < 0 ? a.tz : -a.tz;
      sign(speed(lim), 1.0, 1.0, x, 2.4, z, Math.atan2(-dirTx, -dirTz), 2.9);
    }
    // panneaux de sortie (à 500 m et au début de la bretelle)
    for (const [ds, txt] of [[-500, '500 m'], [-30, '']]) {
      const a = at(this.exitS0 + ds); const x = a.x + a.nx * -12.6, z = a.z + a.nz * -12.6;
      sign(blue([['SORTIE 12', 54, 70], ['CENTRE-VILLE', 46, 150], [txt || '→', 44, 214]]), 3.2, 1.6, x, 3.0, z, Math.atan2(-a.tx, -a.tz), 3.8);
    }
  }

  // ---------- trafic autoroutier ----------
  async initTraffic(n) {
    const ids = ['milano95', 'sigil07', 'asti89', 'fairheaven80', 'ace11'];
    const tpls = await Promise.all(ids.map(loadCarTemplate));
    for (let i = 0; i < n; i++) {
      const tpl = tpls[Math.floor(Math.random() * tpls.length)];
      const car = makeCar(tpl, PAINTS[Math.floor(Math.random() * PAINTS.length)]);
      const cw = i % 2 ? 'in' : 'out';
      const fou = i % 6 === 3;
      const a = { car, cw, fou, s: (i / n) * PER + Math.random() * 40, lane: Math.random() < 0.65 ? 1 : 0, u: 0, v: 30, v0: (fou ? 160 + Math.random() * 25 : 110 + Math.random() * 25) / 3.6, len: tpl.size.z, half: tpl.size.x / 2, spin: 0, laneT: 0 };
      if (fou && car.paint) car.paint.color.set('#101114');
      a.uTarget = a.lane ? U.lane2 : U.lane1; a.ucur = a.uTarget;
      this.scene.add(car.obj); this.cars.push(a);
    }
    // poids lourds : toujours sur la voie de droite, 80-90 km/h, pas de dépassement
    for (let i = 0; i < 8; i++) {
      const car = i % 4 === 3 ? buildBus({ interior: false }) : buildTruck({ interior: false });
      const a = { car, cw: i % 2 ? 'in' : 'out', heavy: true, s: ((i + 0.5) / 8) * PER, lane: 1, u: 0, v: 24, v0: (80 + Math.random() * 10) / 3.6, len: car.tpl.size.z, half: car.tpl.size.x / 2, spin: 0, laneT: 0 };
      a.uTarget = U.lane2; a.ucur = a.uTarget;
      this.scene.add(car.obj); this.cars.push(a);
    }
  }
  // sens de circulation : chaussée « in » (u<0) roule vers les s croissants, « out » vers les s décroissants
  updateTraffic(dt, player, rainy) {
    const vmaxK = rainy ? 0.88 : 1;
    // joueur projeté s'il est sur l'anneau
    let P = null;
    if (player) { const p = project(player.x, player.z); if (Math.abs(p.u) < 15) P = { s: p.s, u: p.u, v: player.v, len: player.len, cw: p.u < 0 ? 'in' : 'out' }; }
    for (const a of this.cars) {
      const dir = a.cw === 'in' ? 1 : -1, sgU = a.cw === 'in' ? -1 : 1;
      // véhicule de tête dans la même voie
      let gap = 1e9, lv = 0;
      const ahead = (s2) => ((s2 - a.s) * dir + PER) % PER;
      const consider = (o, ou, ov, olen) => {
        if (Math.abs(Math.abs(ou) - Math.abs(a.ucur)) > 2.2) return;
        const d = ahead(o) ; if (d > 0 && d < 200) { const g = d - (a.len + olen) / 2; if (g < gap) { gap = g; lv = ov; } }
      };
      for (const b of this.cars) if (b !== a && b.cw === a.cw) consider(b.s, b.ucur, b.v, b.len);
      if (P && P.cw === a.cw) consider(P.s, P.u, Math.abs(P.v), P.len);
      // changement de voie : dépasser si gêné, se rabattre dès que possible
      a.laneT -= dt;
      if (a.laneT <= 0 && !a.heavy) {
        const want = a.lane === 1 ? (gap < 60 && lv < a.v0 * vmaxK - 3 ? 0 : 1) : (this.laneFree(a, 1, P) ? 1 : 0);
        if (want !== a.lane && this.laneFree(a, want, P)) { a.lane = want; a.laneT = a.fou ? 1.2 : 4; }
        else a.laneT = 0.6;
      }
      a.uTarget = a.lane ? U.lane2 : U.lane1;
      a.ucur += Math.sign(a.uTarget - a.ucur) * Math.min(Math.abs(a.uTarget - a.ucur), dt * (a.fou ? 2.6 : 1.2));
      // IDM
      const v0 = a.v0 * (a.fou ? 1 : vmaxK), am = a.fou ? 2.6 : 1.4, bc = 2.5, T = a.fou ? 0.55 : 1.5, s0 = a.fou ? 2 : 4;
      let acc = am * (1 - Math.pow(a.v / v0, 4));
      if (gap < 1e8) { const ss = s0 + Math.max(0, a.v * T + a.v * (a.v - lv) / (2 * Math.sqrt(am * bc))); acc -= am * (ss / Math.max(0.5, gap)) ** 2; }
      a.v = Math.max(0, a.v + Math.max(-8, acc) * dt);
      a.s = (a.s + dir * a.v * dt + PER) % PER;
      const p = at(a.s), u = sgU * a.ucur;
      a.x = p.x + p.nx * u; a.z = p.z + p.nz * u;
      const du = (a.uTarget - a.ucur) * sgU;
      a.yaw = Math.atan2(p.tx * dir + p.nx * du * 0.08, p.tz * dir + p.nz * du * 0.08);
      a.car.obj.position.set(a.x, 0.03, a.z); a.car.obj.rotation.y = a.yaw;
      a.spin += a.v / 0.31 * dt;
      poseCar(a.car, { spin: a.spin, brake: acc < -1, blink: Math.abs(a.uTarget - a.ucur) > 0.2 && (performance.now() % 760 < 380) ? 4 : 0 });
      if (player) carLOD(a.car, Math.hypot(a.x - player.x, a.z - player.z));
    }
  }
  laneFree(a, lane, P) {
    const uT = lane ? U.lane2 : U.lane1, dir = a.cw === 'in' ? 1 : -1;
    const back = a.fou ? -9 : -25, front = a.fou ? 18 : 45;
    const check = (s, u) => { const d = ((s - a.s) * dir + PER) % PER, dd = d > PER / 2 ? d - PER : d; return Math.abs(Math.abs(u) - uT) < 1.8 && dd > back && dd < front; };
    for (const b of this.cars) if (b !== a && b.cw === a.cw && check(b.s, b.ucur)) return false;
    if (P && P.cw === a.cw && check(P.s, Math.abs(P.u))) return false;
    return true;
  }
  bodies() { return this.cars.map(a => ({ x: a.x, z: a.z, yaw: a.yaw, v: a.v, len: a.len, half: a.half })); }
  // le chauffard qui zigzague change aussi de voie sans raison
}

// retourne les triangles dont la face regarde vers le bas (pour qu'ils soient visibles du dessus)
function faceUp(P, UV) {
  for (let i = 0; i < P.length; i += 9) {
    const ax = P[i], az = P[i + 2], bx = P[i + 3], bz = P[i + 5], cx = P[i + 6], cz = P[i + 8];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny < 0) { for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; } const j = i / 9 * 6; for (let k = 0; k < 2; k++) { const t = UV[j + 2 + k]; UV[j + 2 + k] = UV[j + 4 + k]; UV[j + 4 + k] = t; } }
  }
}
function inS(s, a, b) { s = ((s % PER) + PER) % PER; a = ((a % PER) + PER) % PER; b = ((b % PER) + PER) % PER; return a <= b ? (s >= a && s <= b) : (s >= a || s <= b); }
function distPoly(x, z, pts) {
  let best = 1e9;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}
function polyRibbon(pts, l0, l1, y) {
  const P = [], UV = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const nrm = (p, q) => { const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz) || 1; return { x: dz / L, z: -dx / L }; };
    const na = nrm(pts[Math.max(0, i - 2)], b), nb = nrm(a, pts[Math.min(pts.length - 1, i + 1)]);
    const v = (p, n, l) => [p.x + n.x * l, y, p.z + n.z * l];
    const a0 = v(a, na, l0), a1 = v(a, na, l1), b0 = v(b, nb, l0), b1 = v(b, nb, l1);
    P.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    UV.push(l0, a.L, l0, b.L, l1, b.L, l0, a.L, l1, b.L, l1, a.L);
  }
  faceUp(P, UV);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}
function uvMeters(g) { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i)); }
export { inS, distPoly };
