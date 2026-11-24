// Ville d'examen : quadrillage de rues à la française (feux, stops, cédez-le-passage, priorités à droite,
// passages piétons, limitations), immeubles PBR, parcs, campagne autour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pbr, canvasTex, glb } from './assets.js';

export const N = 6;          // intersections par axe
export const SP = 110;       // espacement (m)
export const RW = 4.3;       // demi-largeur de chaussée
export const LO = 1.95;      // décalage du centre de voie
export const SW = 3.8;       // largeur de trottoir
export const CURB = 0.14;
export const RO = 13;          // rayon extérieur de l'anneau du rond-point
export const RI = 6.3;         // rayon de l'îlot central
export const RC = 10.2;        // rayon de la trajectoire dans l'anneau
export const ND = 2.3;         // profondeur des places de stationnement (créneau)
export const radOf = (n) => (n && n.type === 'round') ? RO : RW;
const HALF = (N - 1) / 2 * SP;

export const nodeX = (i) => (i - (N - 1) / 2) * SP;
export const idx = (x) => Math.round(x / SP + (N - 1) / 2);

// Générateur pseudo-aléatoire déterministe
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class City {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.nodes = [];       // nodes[i][j] = {i,j,x,z,type,minor,lightOffset,crossing:{dirKey:true}}
    this.blocks = [];      // rectangles de trottoirs surélevés
    this.solids = [];      // emprises bâties (collision)
    this.crossings = [];   // passages piétons {x,z,axis,w,len}
    this.lightMats = new Map();
    this.time = 0; this.ext = HALF + RW;
    this.setupNetwork();
  }

  // ---------- réseau ----------
  setupNetwork() {
    const R = rng(1789);
    const interior = [];
    for (let i = 0; i < N; i++) { this.nodes[i] = []; for (let j = 0; j < N; j++) {
      const n = { i, j, x: nodeX(i), z: nodeX(j), type: 'none', minor: null, lightOffset: 0, cross: {} };
      const bi = i === 0 || i === N - 1, bj = j === 0 || j === N - 1;
      if (bi && bj) n.type = 'none';
      else if (bi || bj) { n.type = R() < 0.55 ? 'stop' : 'yield'; n.minor = bi ? 'x' : 'z'; } // la route intérieure (perpendiculaire au bord) est secondaire
      else interior.push(n);
      this.nodes[i][j] = n;
    } }
    // répartition des régimes aux carrefours intérieurs
    const plan = ['light', 'light', 'light', 'light', 'stop', 'stop', 'stop', 'yield', 'yield', 'yield', 'right', 'right', 'right', 'right', 'right', 'right'];
    for (let k = plan.length - 1; k > 0; k--) { const r = Math.floor(R() * (k + 1)); [plan[k], plan[r]] = [plan[r], plan[k]]; }
    interior.forEach((n, k) => {
      n.type = plan[k % plan.length];
      if (n.type === 'stop' || n.type === 'yield') n.minor = R() < 0.5 ? 'x' : 'z';
      if (n.type === 'light') { n.lightOffset = R() * 34; for (const d of DIRS) n.cross[d.k] = true; }
    });
    // quelques passages piétons supplémentaires
    for (const n of interior) if (n.type !== 'light' && R() < 0.45) n.cross[DIRS[Math.floor(R() * 4)].k] = true;
    // rond-point
    const rn = this.nodes[3][3]; rn.type = 'round'; rn.minor = null; rn.cross = {};
    this.rounds = [rn];
    // rue du créneau : places en encoche le long du trottoir droit (sens est), ligne 4 entre les nœuds 2 et 3
    const cl = 4, ca = 2, widths = [6, 6, 6, 7, 6, 6, 6];
    const cr = this.creneau = { axis: 'x', line: cl, a: ca, dir: 'E', z0: nodeX(cl) + RW, z1: nodeX(cl) + RW + ND, slots: [], xa: nodeX(ca) + RW + 30 };
    let cx = cr.xa; widths.forEach((w, k) => { const sl = { x0: cx, x1: cx + w, k }; cr.slots.push(sl); if (k === 3) cr.target = sl; cx += w; });
    cr.xb = cx;
    // quartiers
    this.districts = { '1:3': 'park', '3:1': 'park', '0:0': 'houses', '1:0': 'houses', '2:0': 'houses', '0:3': 'houses', '0:4': 'houses', '4:0': 'houses', '4:3': 'shops', '4:4': 'works', '2:1': 'school' };
    // limitations : 70 sur la rocade, 30 dans deux rues (zone école), 50 ailleurs
    this.limits = new Map();
    this.school = new Set(['z:2:1', 'x:3:2']);
  }

  node(i, j) { return (i >= 0 && j >= 0 && i < N && j < N) ? this.nodes[i][j] : null; }
  // segment entre deux nœuds adjacents : axe 'x' (ligne j fixe, de i à i+1) ou 'z'
  segKey(axis, line, a) { return axis + ':' + line + ':' + a; }
  limitOf(axis, line, a) {
    if (line === 0 || line === N - 1) return 70;
    if (this.school.has(this.segKey(axis, line, a))) return 30;
    return 50;
  }

  // Régime de priorité pour un véhicule arrivant au nœud n en roulant selon l'axe `axis`
  controlFor(n, axis) {
    if (n.type === 'stop' || n.type === 'yield') return axis === n.minor ? n.type : 'major';
    return n.type;
  }
  // distance de la ligne d'arrêt au centre du nœud pour une approche (dk = clé de la direction d'arrivée vers le nœud)
  stopDist(n, dk) { return n.type === 'round' ? RO + 0.4 : n.cross[dk] ? RW + 6.6 : RW + 0.9; }
  districtOf(i, j) { return this.districts[i + ':' + j] || 'centre'; }
  nearRound(x0, z0, x1, z1, m) { for (const r of this.rounds) { const dx = Math.max(x0 - r.x, 0, r.x - x1), dz = Math.max(z0 - r.z, 0, r.z - z1); if (Math.hypot(dx, dz) < RO + m) return true; } return false; }

  // Feu : 'G' | 'O' | 'R' pour un axe d'arrivée
  lightState(n, axis, t = this.time) {
    const c = ((t + n.lightOffset) % 34 + 34) % 34;
    const a = axis === 'x' ? c : (c + 17) % 34;
    return a < 12 ? 'G' : a < 15 ? 'O' : 'R';
  }

  // Localisation d'un point : carrefour, tronçon (avec écart latéral) ou hors route
  locate(x, z) {
    for (const r of this.rounds) if (Math.hypot(x - r.x, z - r.z) < RO) return { type: 'node', n: r };
    const i = idx(x), j = idx(z);
    const ci = Math.min(N - 1, Math.max(0, i)), cj = Math.min(N - 1, Math.max(0, j));
    const nx = nodeX(ci), nz = nodeX(cj);
    const dx = x - nx, dz = z - nz;
    if (Math.abs(dx) <= RW && Math.abs(dz) <= RW) return { type: 'node', n: this.nodes[ci][cj] };
    if (Math.abs(dz) <= RW && x >= -HALF - 0.01 && x <= HALF + 0.01) { // route selon x, ligne cj
      const a = Math.min(N - 2, Math.floor(x / SP + (N - 1) / 2));
      return { type: 'seg', axis: 'x', line: cj, a, lat: dz, lineC: nz };
    }
    if (Math.abs(dx) <= RW && z >= -HALF - 0.01 && z <= HALF + 0.01) {
      const a = Math.min(N - 2, Math.floor(z / SP + (N - 1) / 2));
      return { type: 'seg', axis: 'z', line: ci, a, lat: dx, lineC: nx };
    }
    return { type: 'off' };
  }
  onSidewalk(x, z) {
    if (this.hw && Math.abs(x) > this.ext - 0.5 && this.hw.onLinkArea(x, z)) return false;
    for (const r of this.rounds) { const d = Math.hypot(x - r.x, z - r.z); if (d < RI + 0.15) return true; if (d < RO) return false; }
    for (const b of this.blocks) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && inPoly(x, z, b.poly)) return true;
    return Math.abs(x) > HALF + RW || Math.abs(z) > HALF + RW;
  }
  hitsSolid(x, z) {
    for (const r of this.rounds) if (Math.hypot(x - r.x, z - r.z) < RI - 0.9) return true;
    for (const b of this.solids) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true;
    return false;
  }
  // polygone d'un rectangle (ordre x0z0 → x1z0 → x1z1 → x0z1), angles proches d'un rond-point découpés en arc de rayon cutR,
  // encoche optionnelle (places de stationnement) sur le bord z0
  rectPoly(x0, x1, z0, z1, cutR, notch) {
    const C = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const ins = [[0, -1], [1, 0], [0, 1], [-1, 0]], outs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const pts = [];
    C.forEach(([cx, cz], k) => {
      const r = this.rounds.find(n => Math.hypot(n.x - cx, n.z - cz) < cutR);
      if (r) {
        const ui = ins[k], uo = outs[k];
        const di = ui[0] ? Math.abs(r.z - cz) : Math.abs(r.x - cx), dO = uo[0] ? Math.abs(r.z - cz) : Math.abs(r.x - cx);
        const ai = Math.sqrt(Math.max(0, cutR * cutR - di * di)), ao = Math.sqrt(Math.max(0, cutR * cutR - dO * dO));
        const pin = ui[0] ? [r.x - ui[0] * ai, cz] : [cx, r.z - ui[1] * ai];
        const pout = uo[0] ? [r.x + uo[0] * ao, cz] : [cx, r.z + uo[1] * ao];
        const a1 = Math.atan2(pin[1] - r.z, pin[0] - r.x), a2 = Math.atan2(pout[1] - r.z, pout[0] - r.x);
        let da = a2 - a1; da = Math.atan2(Math.sin(da), Math.cos(da));
        const n = Math.max(4, Math.ceil(Math.abs(da) / 0.12));
        for (let q = 0; q <= n; q++) { const a = a1 + da * q / n; pts.push([r.x + Math.cos(a) * cutR, r.z + Math.sin(a) * cutR]); }
      } else pts.push([cx, cz]);
      if (k === 0 && notch) pts.push([notch.xa, z0], [notch.xa, z0 + notch.d], [notch.xb, z0 + notch.d], [notch.xb, z0]);
    });
    return pts;
  }

  update(dt) {
    this.time += dt;
    for (const [key, m] of this.lightMats) {
      const [i, j, axis, col] = key.split(':');
      const st = this.lightState(this.nodes[i][j], axis);
      const on = st === col;
      m.emissiveIntensity = on ? 5 : 0.04;
      m.color.setHex(on ? 0x222222 : 0x111111);
    }
  }

  // ---------- construction ----------
  async build(quality) {
    const M = this.mats = makeMaterials();
    const G = new Geo();
    const R = rng(42);
    const ext = HALF + RW;
    // chaussée : un grand plan d'asphalte couvrant la ville ; les îlots sont des dalles surélevées
    const road = new THREE.PlaneGeometry(2 * ext + 2, 2 * ext + 2); road.rotateX(-Math.PI / 2); uvWorld(road);
    G.add('asphalt', road);
    // campagne
    const grass = new THREE.RingGeometry(ext + 1, 2600, 64, 6); grass.rotateX(-Math.PI / 2); uvWorld(grass); grass.translate(0, 0.02, 0);
    G.add('grassFar', grass);
    // bas-côté de la rocade : bande de trottoir extérieure
    const rp = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const lz = this.nodes[5][2].z; // passage de la route d'accès à l'autoroute dans le trottoir est
    for (const s of [-1, 1]) {
      this.addSlab(G, rp(-ext - SW, ext + SW, s > 0 ? ext : -ext - SW, s > 0 ? ext + SW : -ext), null);
      if (s > 0) { this.addSlab(G, rp(ext, ext + SW, -ext, lz - RW), null); this.addSlab(G, rp(ext, ext + SW, lz + RW, ext), null); }
      else this.addSlab(G, rp(-ext - SW, -ext, -ext, ext), null);
    }
    this.windowList = []; this.treeSpots = [];
    this.buildMarkings(G);
    // îlots
    this.parkSpots = []; this.decorCars = [];
    const cr = this.creneau;
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
      const x0 = nodeX(i) + RW, x1 = nodeX(i + 1) - RW, z0 = nodeX(j) + RW, z1 = nodeX(j + 1) - RW;
      const notch = (i === cr.a && j === cr.line) ? { xa: cr.xa, xb: cr.xb, d: ND } : null;
      const poly = this.rectPoly(x0, x1, z0, z1, RO, notch);
      this.blocks.push({ x0, x1, z0, z1, poly });
      const kind = this.districtOf(i, j);
      const L = { x0: x0 + SW, x1: x1 - SW, z0: z0 + SW, z1: z1 - SW };
      const lotPoly = this.rectPoly(L.x0, L.x1, L.z0, L.z1, RO + SW, null);
      const lotMat = { park: 'grass', houses: 'grass', shops: 'lotAsphalt', works: 'lotConcrete', school: 'lotConcrete' }[kind];
      this.addSlab(G, poly, lotMat ? { poly: lotPoly, mat: lotMat } : null);
      if (kind === 'park') this.buildPark(G, L, R);
      else if (kind === 'houses') this.buildHouses(G, L, R);
      else if (kind === 'shops') this.buildShops(G, L, R);
      else if (kind === 'works') this.buildWorks(G, L, R);
      else if (kind === 'school') this.buildSchool(G, L, R);
      else this.buildBlock(G, L, R, quality);
    }
    this.buildRound(G);
    this.buildCreneauDecor(G);
    // maillage fusionné par matériau
    for (const [k, list] of G.map) {
      const geo = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, M[k]);
      mesh.receiveShadow = true; mesh.castShadow = !/asphalt|grass|mark|road/.test(k);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.buildWindows(M);
    this.buildSigns();
    this.buildLights();
    await this.buildProps(R);
    for (const sg of (this.signs3D || [])) {
      const t = canvasTex(1024, Math.round(1024 * sg.h / sg.w), (g, w, h) => { g.fillStyle = sg.bg; g.fillRect(0, 0, w, h); g.fillStyle = sg.fg; g.font = `900 ${Math.round(h * 0.62)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sg.text, w / 2, h / 2 + 4); });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sg.w, sg.h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25 }));
      m.position.set(sg.x, sg.y, sg.z); m.rotation.y = sg.yaw; this.group.add(m);
    }
    this.buildTrees(R);
  }

  addSlab(G, poly, lot) {
    G.add('sidewalk', polyTop(poly, CURB));
    if (lot) G.add(lot.mat, polyTop(lot.poly, CURB + 0.012));
    for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) G.add('curb', wall(a[0], a[1], b[0], b[1], 0, CURB + 0.001)); }
  }

  buildBlock(G, L, R, quality) {
    const depth = 15;
    const facades = ['plasterW', 'plasterY', 'brick', 'concTile', 'plasterG', 'facadeTile', 'plasterW', 'stone'];
    const rows = [];
    // côtés nord/sud sur toute la longueur, est/ouest entre les deux
    const sides = [
      { a: [L.x0, L.z0], b: [L.x1, L.z0], n: [0, -1] },
      { a: [L.x1, L.z1], b: [L.x0, L.z1], n: [0, 1] },
      { a: [L.x0, L.z1 - depth], b: [L.x0, L.z0 + depth], n: [-1, 0] },
      { a: [L.x1, L.z0 + depth], b: [L.x1, L.z1 - depth], n: [1, 0] },
    ];
    this.windowList = this.windowList || [];
    for (const s of sides) {
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      const ux = (s.b[0] - s.a[0]) / len, uz = (s.b[1] - s.a[1]) / len;
      let t = 0; let k = 0;
      while (t < len - 0.5) {
        let w = 11 + R() * 13; if (len - t - w < 9) w = len - t;
        const floors = 3 + Math.floor(R() * 5);
        const h = floors * 3.1 + 0.9;
        const mat = facades[Math.floor(R() * facades.length)];
        const p0 = [s.a[0] + ux * t, s.a[1] + uz * t], p1 = [s.a[0] + ux * (t + w), s.a[1] + uz * (t + w)];
        // boîte du bâtiment : façade p0→p1, profondeur vers l'intérieur (-n)
        const q0 = [p0[0] - s.n[0] * depth, p0[1] - s.n[1] * depth], q1 = [p1[0] - s.n[0] * depth, p1[1] - s.n[1] * depth];
        const minx = Math.min(p0[0], p1[0], q0[0], q1[0]), maxx = Math.max(p0[0], p1[0], q0[0], q1[0]);
        const minz = Math.min(p0[1], p1[1], q0[1], q1[1]), maxz = Math.max(p0[1], p1[1], q0[1], q1[1]);
        if (this.nearRound(minx, minz, maxx, maxz, SW + 1)) { t += w; continue; }
        this.solids.push({ x0: minx - 0.1, x1: maxx + 0.1, z0: minz - 0.1, z1: maxz + 0.1 });
        const y0 = CURB;
        G.add(mat, wall(p0[0], p0[1], p1[0], p1[1], y0, y0 + h));             // façade
        G.add(mat, wall(p1[0], p1[1], q1[0], q1[1], y0, y0 + h));             // pignons
        G.add(mat, wall(q0[0], q0[1], p0[0], p0[1], y0, y0 + h));
        G.add(mat, wall(q1[0], q1[1], q0[0], q0[1], y0, y0 + h));             // arrière
        const roof = new THREE.PlaneGeometry(maxx - minx, maxz - minz); roof.rotateX(-Math.PI / 2); roof.translate((minx + maxx) / 2, y0 + h, (minz + maxz) / 2); uvWorld(roof);
        G.add('roof', roof);
        // corniche + acrotère
        const cor = new THREE.BoxGeometry(w + 0.3, 0.35, 0.45); orientBox(cor, p0, p1, s.n, 0.2, y0 + h - 0.15); G.add('cornice', cor);
        const band = new THREE.BoxGeometry(w + 0.1, 0.22, 0.25); orientBox(band, p0, p1, s.n, 0.12, y0 + 3.6); G.add('cornice', band);
        // rez-de-chaussée commerçant ?
        const shop = R() < 0.45;
        const nWin = Math.max(1, Math.floor((w - 1.5) / 3.3));
        const step = w / nWin;
        for (let f = shop ? 1 : 0; f < floors; f++) for (let c = 0; c < nWin; c++) {
          const tt = (c + 0.5) * step;
          this.windowList.push({ x: p0[0] + ux * tt + s.n[0] * 0.02, z: p0[1] + uz * tt + s.n[1] * 0.02, y: y0 + f * 3.1 + (f === 0 ? 1.0 : 1.35), n: s.n, door: f === 0 && c === Math.floor(nWin / 2) });
        }
        if (shop) {
          const sh = new THREE.BoxGeometry(w - 1.2, 2.7, 0.12); orientBox(sh, p0, p1, s.n, 0.0, y0 + 1.5); G.add('shopGlass', sh);
          const fr = new THREE.BoxGeometry(w - 0.6, 0.5, 0.2); orientBox(fr, p0, p1, s.n, 0.05, y0 + 3.05); G.add('shopFrame', fr);
          const aw = new THREE.BoxGeometry(w - 1.0, 0.08, 1.5); aw.rotateX(0.32); orientBox(aw, p0, p1, s.n, 0.75, y0 + 3.1);
          G.add('awning' + Math.floor(R() * 4), aw);
        }
        // pignons visibles aux angles de rue : fenêtres sur la face latérale aussi
        t += w; k++;
      }
    }
  }

  buildPark(G, L, R) {
    this.treeSpots = this.treeSpots || [];
    for (let k = 0; k < 26; k++) this.treeSpots.push([L.x0 + 4 + R() * (L.x1 - L.x0 - 8), L.z0 + 4 + R() * (L.z1 - L.z0 - 8), 0.8 + R() * 0.6]);
    // allée en croix
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    for (const [w, d] of [[L.x1 - L.x0, 3], [3, L.z1 - L.z0]]) { const p = new THREE.PlaneGeometry(w, d); p.rotateX(-Math.PI / 2); p.translate(cx, CURB + 0.02, cz); uvWorld(p); G.add('gravel', p); }
  }

  buildMarkings(G) {
    const Y = 0.012;
    const strip = (x0, z0, x1, z1, w) => { // bande blanche de largeur w de (x0,z0) à (x1,z1)
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.05) return;
      const p = new THREE.PlaneGeometry(w, len); p.rotateX(-Math.PI / 2);
      p.rotateY(-Math.atan2(x1 - x0, z1 - z0) + Math.PI);
      p.translate((x0 + x1) / 2, Y, (z0 + z1) / 2); G.add('mark', p);
    };
    this.strip = strip;
    for (let line = 0; line < N; line++) for (let a = 0; a < N - 1; a++) for (const axis of ['x', 'z']) {
      const c = nodeX(line);
      const P = (s, l) => axis === 'x' ? [s, c + l] : [c + l, s];
      const nA = axis === 'x' ? this.nodes[a][line] : this.nodes[line][a];
      const nB = axis === 'x' ? this.nodes[a + 1][line] : this.nodes[line][a + 1];
      const s0 = nodeX(a) + radOf(nA), s1 = nodeX(a + 1) - radOf(nB);
      // ligne axiale : continue sur 16 m aux abords des carrefours, discontinue (T1 : 3 m / 10 m) ailleurs
      const cont = 16;
      strip(...P(s0, 0), ...P(s0 + cont, 0), 0.13);
      strip(...P(s1 - cont, 0), ...P(s1, 0), 0.13);
      for (let s = s0 + cont + 5; s < s1 - cont - 3; s += 13) strip(...P(s, 0), ...P(Math.min(s + 3, s1 - cont), 0), 0.13);
      // lignes de rive discontinues
      for (const l of [-RW + 0.35, RW - 0.35]) for (let s = s0 + 2; s < s1 - 3; s += 6) strip(...P(s, l), ...P(s + 3, l), 0.12);
      // lignes d'arrêt / cédez + passages piétons, pour les deux sens d'arrivée
      for (const [n, sgn] of [[nB, -1], [nA, 1]]) {
        // véhicule arrivant sur n en roulant dans le sens -sgn (vers n)
        const dir = -sgn; const dk = dirKey(axis, dir);
        const ctl = this.controlFor(n, axis);
        const nc = axis === 'x' ? n.x : n.z;
        const sd = this.stopDist(n, dk);
        const sLine = nc + sgn * sd;
        // côté droit de la voie : pour un sens dir, la voie de droite est en lat = +dir*LO (axe x) ou -dir*LO (axe z)
        const rs = axis === 'x' ? dir : -dir;
        if (ctl === 'stop' || ctl === 'light') strip(...P(sLine, rs * 0.1), ...P(sLine, rs * (RW - 0.2)), 0.5);
        else if (ctl === 'yield' || ctl === 'round') for (let l = 0.3; l < RW - 0.4; l += 1.0) strip(...P(sLine, rs * l), ...P(sLine, rs * (l + 0.5)), 0.5);
        if (n.cross[dk]) {
          const z0 = nc + sgn * (RW + 1.4), z1 = nc + sgn * (RW + 5.4);
          for (let l = -RW + 0.5; l < RW - 0.3; l += 1.0) strip(...P(z0, l + 0.25), ...P(z1, l + 0.25), 0.5);
          this.crossings.push({ n, dk, axis, s0: Math.min(z0, z1), s1: Math.max(z0, z1), c });
        }
      }
    }
  }

  buildWindows(M) {
    const list = this.windowList || [];
    const fw = 1.3, fh = 1.7;
    const parts = [];
    const bar = (w, h, x, y) => { const b = new THREE.BoxGeometry(w, h, 0.14); b.translate(x, y, 0.02); return b; };
    parts.push(bar(fw + 0.16, 0.1, 0, fh / 2), bar(fw + 0.16, 0.1, 0, -fh / 2), bar(0.1, fh, -fw / 2, 0), bar(0.1, fh, fw / 2, 0), bar(0.05, fh, 0, 0), bar(fw, 0.05, 0, fh * 0.18));
    const sill = new THREE.BoxGeometry(fw + 0.4, 0.08, 0.3); sill.translate(0, -fh / 2 - 0.06, 0.1); parts.push(sill);
    // embrasure (tableau) sombre
    const frameGeo = mergeGeometries(parts, false);
    const glassGeo = new THREE.PlaneGeometry(fw, fh); glassGeo.translate(0, 0, 0.012);
    const shutL = new THREE.BoxGeometry(0.66, fh + 0.05, 0.04); shutL.translate(-fw / 2 - 0.36, 0, 0.06);
    const shutR = shutL.clone(); shutR.translate(fw + 0.72, 0, 0);
    const shutGeo = mergeGeometries([shutL, shutR], false);
    const n = list.length;
    const frames = new THREE.InstancedMesh(frameGeo, M.winFrame, n);
    const glass = new THREE.InstancedMesh(glassGeo, M.winGlass, n);
    const withShut = list.filter((w, k) => (k * 7919) % 5 < 2);
    const shut = new THREE.InstancedMesh(shutGeo, M.shutter, withShut.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let si = 0;
    list.forEach((w, k) => {
      e.set(0, Math.atan2(w.n[0], w.n[1]), 0); q.setFromEuler(e);
      const ws = w.s || 1; sc.set(ws, (w.door ? 1.35 : 1) * ws, 1); p.set(w.x, w.y + (w.door ? 0.25 : 0), w.z);
      m4.compose(p, q, sc); frames.setMatrixAt(k, m4); glass.setMatrixAt(k, m4);
      if ((k * 7919) % 5 < 2 && si < withShut.length) shut.setMatrixAt(si++, m4);
    });
    for (const im of [frames, glass, shut]) { im.castShadow = false; im.receiveShadow = true; this.group.add(im); }
  }


  // ---------- rond-point ----------
  buildRound(G) {
    for (const r of this.rounds) {
      // îlot central surélevé : pelouse, bordure, couronne franchissable pavée
      const top = new THREE.CircleGeometry(RI, 64); top.rotateX(-Math.PI / 2); top.translate(r.x, 0.22, r.z); uvWorld(top); G.add('grass', top);
      const curb = new THREE.CylinderGeometry(RI, RI, 0.22, 64, 1, true); curb.translate(r.x, 0.11, r.z);
      { const uv = curb.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * RI * 6.28, uv.getY(i) * 0.22); }
      G.add('curb', curb);
      const apron = new THREE.RingGeometry(RI, RI + 1.4, 64, 1); apron.rotateX(-Math.PI / 2); apron.translate(r.x, 0.05, r.z); uvWorld(apron); G.add('sidewalk', apron);
      const ac = new THREE.CylinderGeometry(RI + 1.4, RI + 1.4, 0.05, 64, 1, true); ac.translate(r.x, 0.025, r.z); G.add('curb', ac);
      // massifs de fleurs et sculpture
      this.treeSpots = this.treeSpots || [];
      this.treeSpots.push([r.x - 2.2, r.z + 1.5, 1.15], [r.x + 2.4, r.z - 1.8, 0.95]);
      const flowers = [];
      for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2, rr = RI - 0.9; const b = new THREE.IcosahedronGeometry(0.32, 1); b.scale(1, 0.6, 1); b.translate(r.x + Math.cos(a) * rr, 0.36, r.z + Math.sin(a) * rr); flowers.push(b); }
      const fm = new THREE.Mesh(mergeGeometries(flowers.map(g => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: 0xc8325a, roughness: 0.8 }));
      fm.castShadow = true; this.group.add(fm);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.16, 16, 64), this.mats.pole); arc.position.set(r.x, 1.9, r.z); arc.rotation.y = 0.6; arc.castShadow = true; this.group.add(arc);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.35, 24), this.mats.curb); base.position.set(r.x, 0.38, r.z); this.group.add(base);
    }
  }

  // ---------- rue du créneau : places marquées et voitures garées ----------
  buildCreneauDecor(G) {
    const cr = this.creneau;
    for (const sl of cr.slots) for (const x of [sl.x0, sl.x1]) this.strip(x, cr.z0 + 0.05, x, cr.z1 - 0.05, 0.12);
    this.strip(cr.xa, cr.z0 + 0.06, cr.xb, cr.z0 + 0.06, 0.1);
    // emplacements occupés (les voitures sont posées par la circulation)
    this.parkedSpots = cr.slots.filter(sl => sl !== cr.target).map(sl => ({ x: (sl.x0 + sl.x1) / 2 + (Math.random() - 0.5) * 0.6, z: (cr.z0 + cr.z1) / 2 + 0.05, yaw: Math.PI / 2 }));
  }

  // ---------- quartier pavillonnaire ----------
  buildHouses(G, L, R) {
    const walls = ['plasterW', 'plasterY', 'plasterG', 'stone', 'whiteBrick'];
    const sides = [
      { a: [L.x0, L.z0], b: [L.x1, L.z0], n: [0, -1] }, { a: [L.x1, L.z1], b: [L.x0, L.z1], n: [0, 1] },
      { a: [L.x0, L.z1 - 18], b: [L.x0, L.z0 + 18], n: [-1, 0] }, { a: [L.x1, L.z0 + 18], b: [L.x1, L.z1 - 18], n: [1, 0] },
    ];
    for (const sd of sides) {
      const len = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]), ux = (sd.b[0] - sd.a[0]) / len, uz = (sd.b[1] - sd.a[1]) / len;
      const nx = sd.n[0], nz = sd.n[1];
      let t = 2;
      while (t < len - 12) {
        const w = 8.5 + R() * 3, set = 5 + R() * 1.5, dep = 8.5, h = 5.6, rh = 2.4 + R() * 0.6;
        const at = (tt, back) => [sd.a[0] + ux * tt - nx * back, sd.a[1] + uz * tt - nz * back];
        const p0 = at(t + 1, set), p1 = at(t + 1 + w, set), q0 = at(t + 1, set + dep), q1 = at(t + 1 + w, set + dep);
        const xs = [p0[0], p1[0], q0[0], q1[0]], zs = [p0[1], p1[1], q0[1], q1[1]];
        const bb = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
        if (!this.nearRound(bb[0], bb[1], bb[2], bb[3], SW + 1)) {
          const wm = walls[Math.floor(R() * walls.length)], y0 = CURB;
          G.add(wm, wall(p0[0], p0[1], p1[0], p1[1], y0, y0 + h)); G.add(wm, wall(p1[0], p1[1], q1[0], q1[1], y0, y0 + h));
          G.add(wm, wall(q1[0], q1[1], q0[0], q0[1], y0, y0 + h)); G.add(wm, wall(q0[0], q0[1], p0[0], p0[1], y0, y0 + h));
          // toit à deux pans (faîtage parallèle à la rue), débords de 0,5 m
          const ov = 0.5, eave = y0 + h - 0.05, ridge = eave + rh;
          const E = (pt, o) => [pt[0] + nx * o, pt[1] + nz * o];
          const m0 = [(p0[0] + q0[0]) / 2, (p0[1] + q0[1]) / 2], m1 = [(p1[0] + q1[0]) / 2, (p1[1] + q1[1]) / 2];
          const ext = (pt, k) => [pt[0] + ux * k, pt[1] + uz * k];
          const f0 = ext(E(p0, ov), -ov), f1 = ext(E(p1, ov), ov), b0 = ext(E(q0, -ov), -ov), b1 = ext(E(q1, -ov), ov), r0 = ext(m0, -ov), r1 = ext(m1, ov);
          const roofM = R() < 0.7 ? 'roofTile' : 'roofSlate';
          G.add(roofM, quad([f0[0], eave, f0[1]], [f1[0], eave, f1[1]], [r1[0], ridge, r1[1]], [r0[0], ridge, r0[1]]));
          G.add(roofM, quad([b1[0], eave, b1[1]], [b0[0], eave, b0[1]], [r0[0], ridge, r0[1]], [r1[0], ridge, r1[1]]));
          // pignons
          G.add(wm, tri3([q0[0], eave, q0[1]], [p0[0], eave, p0[1]], [m0[0], ridge - 0.15, m0[1]]));
          G.add(wm, tri3([p1[0], eave, p1[1]], [q1[0], eave, q1[1]], [m1[0], ridge - 0.15, m1[1]]));
          // fenêtres / porte
          const nw = 3;
          for (let f = 0; f < 2; f++) for (let c = 0; c < nw; c++) {
            const tt = t + 1 + (c + 0.5) * w / nw; const pp = at(tt, set - 0.02);
            this.windowList.push({ x: pp[0], z: pp[1], y: y0 + f * 2.8 + (f === 0 ? 1.15 : 1.25), n: sd.n, door: f === 0 && c === 1, s: 0.8 });
          }
          this.solids.push({ x0: bb[0] - 0.1, x1: bb[2] + 0.1, z0: bb[1] - 0.1, z1: bb[3] + 0.1 });
          // haie basse le long du trottoir, avec portail
          const g0 = at(t, 0.45), g1 = at(t + 1 + w * 0.35, 0.45), g2 = at(t + 1 + w * 0.35 + 3.2, 0.45), g3 = at(t + w + 4, 0.45);
          for (const [A, B] of [[g0, g1], [g2, g3]]) {
            const hl = Math.hypot(B[0] - A[0], B[1] - A[1]); if (hl < 0.5) continue;
            const hg = new THREE.BoxGeometry(hl, 1.1, 0.6); hg.rotateY(-Math.atan2(B[1] - A[1], B[0] - A[0])); hg.translate((A[0] + B[0]) / 2, CURB + 0.55, (A[1] + B[1]) / 2);
            boxUV(hg); G.add('hedge', hg);
            this.solids.push({ x0: Math.min(A[0], B[0]) - 0.3, x1: Math.max(A[0], B[0]) + 0.3, z0: Math.min(A[1], B[1]) - 0.3, z1: Math.max(A[1], B[1]) + 0.3 });
          }
          // allée gravillonnée jusqu'à la porte
          const d0 = at(t + 1 + w * 0.35 + 1.6, 0), d1 = at(t + 1 + w * 0.35 + 1.6, set);
          const dg = new THREE.PlaneGeometry(2.6, set); dg.rotateX(-Math.PI / 2); dg.rotateY(Math.atan2(nx, nz)); dg.translate((d0[0] + d1[0]) / 2, CURB + 0.025, (d0[1] + d1[1]) / 2); uvWorld(dg); G.add('gravel', dg);
          // arbre de jardin
          if (R() < 0.6) { const tp = at(t + 1 + w + 2, set + dep + 3); this.treeSpots = this.treeSpots || []; this.treeSpots.push([tp[0], tp[1], 0.7 + R() * 0.3]); }
        }
        t += w + 5 + R() * 3;
      }
    }
  }

  // ---------- zone commerciale : supermarché + parking ----------
  buildShops(G, L, R) {
    const hx0 = L.x0 + 10, hx1 = L.x1 - 10, hz1 = L.z1 - 5, hz0 = hz1 - 36, h = 8.5, y0 = CURB;
    if (!this.nearRound(hx0, hz0, hx1, hz1, 2)) {
      const box = [[hx0, hz0], [hx1, hz0], [hx1, hz1], [hx0, hz1]];
      for (let k = 0; k < 4; k++) { const a = box[k], b = box[(k + 1) % 4]; G.add('metal', wall(a[0], a[1], b[0], b[1], y0, y0 + h)); }
      const roof = new THREE.PlaneGeometry(hx1 - hx0, hz1 - hz0); roof.rotateX(-Math.PI / 2); roof.translate((hx0 + hx1) / 2, y0 + h, (hz0 + hz1) / 2); uvWorld(roof); G.add('roof', roof);
      // façade vitrée + auvent rouge sur le côté parking (z0)
      const gl = new THREE.BoxGeometry(24, 3.2, 0.15); gl.translate((hx0 + hx1) / 2, y0 + 1.6, hz0 - 0.05); G.add('shopGlass', gl);
      const aw = new THREE.BoxGeometry(30, 0.5, 3); aw.translate((hx0 + hx1) / 2, y0 + 3.6, hz0 - 1.5); G.add('awning0', aw);
      const band = new THREE.BoxGeometry(hx1 - hx0 + 0.2, 1.2, 0.2); band.translate((hx0 + hx1) / 2, y0 + h - 0.6, hz0 - 0.1); G.add('awning2', band);
      this.solids.push({ x0: hx0, x1: hx1, z0: hz0 - 3, z1: hz1 });
      this.signs3D = this.signs3D || [];
      this.signs3D.push({ text: 'MARCHÉ+', x: (hx0 + hx1) / 2, y: y0 + h + 1.1, z: hz0 - 0.2, yaw: Math.PI, w: 12, h: 2.2, bg: '#c8102e', fg: '#ffffff' });
      // parking : lignes de places + voitures garées
      for (let row = 0; row < 2; row++) {
        const zr = L.z0 + 5 + row * 13;
        for (let x = L.x0 + 6; x < L.x1 - 8; x += 2.7) {
          this.strip(x, zr, x, zr + 5, 0.1);
          if (R() < 0.42) this.decorCars.push({ x: x + 1.35, z: zr + 2.5, yaw: R() < 0.5 ? 0 : Math.PI });
        }
      }
      for (const x of [L.x0 + 20, L.x1 - 20]) { this.lampSpots = this.lampSpots || []; this.lampSpots.push({ x, z: L.z0 + 11.5, yaw: 0 }); }
    }
  }

  // ---------- zone d'activités : entrepôts, conteneurs, clôture ----------
  buildWorks(G, L, R) {
    const y0 = CURB;
    const halls = [[L.x0 + 6, L.z0 + 8, L.x0 + 44, L.z1 - 30, 9], [L.x1 - 40, L.z0 + 30, L.x1 - 6, L.z1 - 8, 7]];
    for (const [x0, z0, x1, z1, h] of halls) {
      if (this.nearRound(x0, z0, x1, z1, 2)) continue;
      const box = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      for (let k = 0; k < 4; k++) { const a = box[k], b = box[(k + 1) % 4]; G.add(k % 2 ? 'metal' : 'metalBlue', wall(a[0], a[1], b[0], b[1], y0, y0 + h)); }
      const roof = new THREE.PlaneGeometry(x1 - x0, z1 - z0); roof.rotateX(-Math.PI / 2); roof.translate((x0 + x1) / 2, y0 + h, (z0 + z1) / 2); uvWorld(roof); G.add('roof', roof);
      // portes sectionnelles
      for (let k = 0; k < 3; k++) { const dr = new THREE.BoxGeometry(4, 4.5, 0.1); dr.translate(x0 + 6 + k * 9, y0 + 2.25, z0 - 0.05); G.add('shutterDoor', dr); }
      this.solids.push({ x0, x1, z0, z1 });
    }
    // conteneurs
    const cols = ['awning0', 'awning1', 'awning2', 'awning3'];
    for (let k = 0; k < 5; k++) {
      const cx = L.x1 - 30 + (k % 3) * 2.6, cz = L.z0 + 8 + Math.floor(k / 3) * 7, cy = y0 + 1.3;
      if (this.nearRound(cx - 2, cz - 3, cx + 2, cz + 3, 2)) continue;
      const c = new THREE.BoxGeometry(2.44, 2.6, 6.06); c.translate(cx, cy, cz); boxUV(c); G.add(cols[k % 4], c);
      this.solids.push({ x0: cx - 1.3, x1: cx + 1.3, z0: cz - 3.1, z1: cz + 3.1 });
    }
    this.fence(G, L);
  }

  // ---------- école ----------
  buildSchool(G, L, R) {
    const y0 = CURB, d = 13, floors = 3, h = floors * 3.3 + 1;
    const x0 = L.x0 + 2, x1 = L.x1 - 2, z0 = L.z0 + 6, z1 = z0 + d;
    if (!this.nearRound(x0, z0, x1, z1, 2)) {
      const box = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      for (let k = 0; k < 4; k++) { const a = box[k], b = box[(k + 1) % 4]; G.add('brick', wall(a[0], a[1], b[0], b[1], y0, y0 + h)); }
      const roof = new THREE.PlaneGeometry(x1 - x0, d); roof.rotateX(-Math.PI / 2); roof.translate((x0 + x1) / 2, y0 + h, (z0 + z1) / 2); uvWorld(roof); G.add('roof', roof);
      const cor = new THREE.BoxGeometry(x1 - x0 + 0.4, 0.5, 0.5); cor.translate((x0 + x1) / 2, y0 + h - 0.2, z0 - 0.15); G.add('cornice', cor);
      for (let f = 0; f < floors; f++) for (let x = x0 + 3; x < x1 - 2; x += 3.4) this.windowList.push({ x, z: z0 - 0.02, y: y0 + f * 3.3 + 1.6, n: [0, -1], door: false, s: 1.15 });
      this.solids.push({ x0, x1, z0, z1 });
      this.signs3D = this.signs3D || [];
      this.signs3D.push({ text: 'ÉCOLE JULES-FERRY', x: (x0 + x1) / 2, y: y0 + h - 1.1, z: z0 - 0.45, yaw: Math.PI, w: 11, h: 1.1, bg: '#f4efe4', fg: '#1d3c78' });
      // préau
      const pr = new THREE.BoxGeometry(18, 0.3, 6); pr.translate((x0 + x1) / 2, y0 + 3.3, z1 + 12); G.add('roof', pr);
      for (const px of [-8.5, 8.5]) for (const pz of [9.5, 14.5]) { const pc = new THREE.CylinderGeometry(0.15, 0.15, 3.2, 10); pc.translate((x0 + x1) / 2 + px, y0 + 1.6, z1 + pz); G.add('metalBlue', pc); }
      this.treeSpots = this.treeSpots || [];
      for (let k = 0; k < 6; k++) this.treeSpots.push([L.x0 + 10 + k * 12, L.z1 - 8, 0.9]);
    }
    this.fence(G, L);
  }
  // clôture métallique sur le pourtour d'un lot (portail laissé libre au milieu de chaque côté)
  fence(G, L) {
    const sides = [[L.x0, L.z0, L.x1, L.z0], [L.x1, L.z0, L.x1, L.z1], [L.x1, L.z1, L.x0, L.z1], [L.x0, L.z1, L.x0, L.z0]];
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let t = 0.5; t < len - 0.5; t += 2.5) {
        if (Math.abs(t - len / 2) < 3) continue;
        const x = ax + ux * t, z = az + uz * t;
        if (this.nearRound(x, z, x, z, SW + 0.5)) continue;
        const pnl = new THREE.BoxGeometry(2.45, 1.7, 0.05); pnl.rotateY(-Math.atan2(uz, ux)); pnl.translate(x + ux * 1.25, CURB + 0.85, z + uz * 1.25); G.add('fence', pnl);
      }
    }
  }

  // ---------- panneaux ----------
  buildSigns() {
    const T = signTextures();
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 8); poleGeo.translate(0, 1.3, 0);
    const poles = [];
    const signs = {}; // texture -> matrices
    const add = (tex, x, z, yaw, y = 2.25, size = 0.8) => {
      poles.push(new THREE.Matrix4().makeTranslation(x, CURB, z));
      (signs[tex] = signs[tex] || []).push({ x, z, yaw, y, size });
    };
    this.signList = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const n = this.nodes[i][j];
      for (const d of DIRS) {
        // approche arrivant au nœud en roulant dans la direction d (on vient de n - d)
        const from = this.node(i - d.dx, j - d.dz); if (!from) continue;
        const axis = d.dx ? 'x' : 'z';
        const ctl = this.controlFor(n, axis);
        const sd = this.stopDist(n, d.k);
        // côté droit : normale droite de (dx,dz) = (-dz, dx)
        const rx = -d.dz, rz = d.dx;
        const yaw = Math.atan2(-d.dx, -d.dz); // face au conducteur qui arrive
        const px = n.x - d.dx * (sd + 0.4) + rx * (RW + 0.7), pz = n.z - d.dz * (sd + 0.4) + rz * (RW + 0.7);
        if (ctl === 'stop') add('stop', px, pz, yaw);
        else if (ctl === 'yield' || ctl === 'round') add('yield', px, pz, yaw);
        if (ctl === 'round') add('b21', px, pz, yaw, 1.5, 0.6);
        // panneaux de position avancée (30 m avant)
        const ax = n.x - d.dx * (sd + 30) + rx * (RW + 0.7), az = n.z - d.dz * (sd + 30) + rz * (RW + 0.7);
        if (ctl === 'right') add('ab1', ax, az, yaw);
        else if (ctl === 'major') add('ab2', ax, az, yaw);
        else if (ctl === 'light') add('a17', ax, az, yaw);
        else if (ctl === 'round') add('ab25', ax, az, yaw);
        // limitation en sortie de carrefour (sur le tronçon qui part de n dans la direction d)
        const to = this.node(i + d.dx, j + d.dz);
        if (to) {
          const line = axis === 'x' ? j : i, a = axis === 'x' ? Math.min(i, i + d.dx) : Math.min(j, j + d.dz);
          const lim = this.limitOf(axis, line, a);
          const sx = n.x + d.dx * (radOf(n) + 12) + rx * (RW + 0.7), sz = n.z + d.dz * (radOf(n) + 12) + rz * (RW + 0.7);
          add('v' + lim, sx, sz, Math.atan2(d.dx, d.dz) + Math.PI);
        }
      }
    }
    // panneau P de la rue du créneau
    { const cr = this.creneau; add('park', cr.xa - 2, cr.z1 + 0.6, Math.PI); }
    // poteaux
    const pm = new THREE.InstancedMesh(poleGeo, this.mats.pole, poles.length);
    poles.forEach((m, k) => pm.setMatrixAt(k, m)); pm.castShadow = true; this.group.add(pm);
    // faces de panneaux (avant texturé + dos gris)
    const plane = new THREE.PlaneGeometry(1, 1);
    const back = plane.clone(); back.rotateY(Math.PI); back.translate(0, 0, -0.012);
    for (const k in signs) {
      const list = signs[k];
      const front = new THREE.MeshStandardMaterial({ map: T[k], alphaTest: 0.5, roughness: 0.45, metalness: 0.0, envMapIntensity: 0.8 });
      const bm = new THREE.MeshStandardMaterial({ map: silhouette(T[k]), alphaTest: 0.5, roughness: 0.5, metalness: 0.6 });
      const fi = new THREE.InstancedMesh(plane, front, list.length), bi = new THREE.InstancedMesh(back, bm, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      list.forEach((s, idx2) => {
        e.set(0, s.yaw, 0); q.setFromEuler(e);
        m4.compose(new THREE.Vector3(s.x, CURB + s.y, s.z).add(new THREE.Vector3(0, 0, 0.05).applyQuaternion(q)), q, new THREE.Vector3(s.size, s.size, 1));
        fi.setMatrixAt(idx2, m4); bi.setMatrixAt(idx2, m4);
      });
      fi.castShadow = true; this.group.add(fi, bi);
    }
  }

  // ---------- feux tricolores ----------
  buildLights() {
    const M = this.mats;
    const housing = new THREE.BoxGeometry(0.32, 0.95, 0.22);
    const lens = new THREE.CircleGeometry(0.1, 20);
    const visor = new THREE.CylinderGeometry(0.13, 0.13, 0.18, 16, 1, true, -Math.PI / 2, Math.PI); visor.rotateX(Math.PI / 2); visor.rotateZ(Math.PI);
    const pole = new THREE.CylinderGeometry(0.06, 0.07, 3.0, 10); pole.translate(0, 1.5, 0);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const n = this.nodes[i][j]; if (n.type !== 'light') continue;
      for (const axis of ['x', 'z']) for (const col of ['R', 'O', 'G']) {
        const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col === 'R' ? 0xff2010 : col === 'O' ? 0xffa000 : 0x20ff60, emissiveIntensity: 0, roughness: 0.2, toneMapped: true });
        this.lightMats.set(`${i}:${j}:${axis}:${col}`, m);
      }
      for (const d of DIRS) {
        const axis = d.dx ? 'x' : 'z';
        const rx = -d.dz, rz = d.dx;
        const sd = this.stopDist(n, d.k);
        const g = new THREE.Group();
        g.position.set(n.x - d.dx * (sd - 0.3) + rx * (RW + 0.6), CURB, n.z - d.dz * (sd - 0.3) + rz * (RW + 0.6));
        g.rotation.y = Math.atan2(-d.dx, -d.dz);
        const p = new THREE.Mesh(pole, M.darkMetal); p.castShadow = true; g.add(p);
        for (const [hy, sc] of [[2.75, 1], [1.45, 0.55]]) { // feu principal + répétiteur à hauteur des yeux
          const h = new THREE.Mesh(housing, M.darkMetal); h.position.set(0, hy, 0.16); h.scale.setScalar(sc); h.castShadow = true; g.add(h);
          ['R', 'O', 'G'].forEach((col, k) => {
            const l = new THREE.Mesh(lens, this.lightMats.get(`${i}:${j}:${axis}:${col}`));
            l.position.set(0, hy + (0.3 - k * 0.3) * sc, 0.16 + 0.112 * sc); l.scale.setScalar(sc); g.add(l);
            const v = new THREE.Mesh(visor, M.darkMetal); v.position.set(0, hy + (0.3 - k * 0.3) * sc + 0.02 * sc, 0.16 + 0.2 * sc); v.scale.setScalar(sc); g.add(v);
          });
        }
        this.group.add(g);
      }
    }
  }

  async buildProps(R) {
    // lampadaires le long des trottoirs
    const lamp = await glb('assets/props/street_lamp_01.glb').catch(() => null);
    if (!lamp) return;
    const mats = [];
    for (let line = 0; line < N; line++) for (let a = 0; a < N - 1; a++) for (const axis of ['x', 'z']) {
      const c = nodeX(line);
      for (let s = nodeX(a) + RW + 14; s < nodeX(a + 1) - RW - 10; s += 32) for (const side of [-1, 1]) {
        if (side === 1 && ((s / 32) | 0) % 2) continue; // en quinconce
        const l = side * (RW + 0.55);
        const x = axis === 'x' ? s + (side > 0 ? 16 : 0) : c + l, z = axis === 'x' ? c + l : s + (side > 0 ? 16 : 0);
        const yaw = axis === 'x' ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        mats.push({ x, z, yaw });
      }
    }
    for (const l of (this.lampSpots || [])) mats.push(l);
    this.lampPlaces = mats.map(m => ({ hx: m.x, hz: m.z }));
    instGLB(this.group, lamp.scene, mats, 6.5);
    const hyd = await glb('assets/props/fire_hydrant.glb').catch(() => null);
    if (hyd) { const hs = []; for (const b of this.blocks) if (R() < 0.7) hs.push({ x: b.x0 + 0.6, z: b.z0 + 10 + R() * 40, yaw: R() * 6 }); instGLB(this.group, hyd.scene, hs, 0.75); }
  }

  buildTrees(R) {
    const spots = this.treeSpots || [];
    // arbres d'alignement sur certains boulevards
    for (let line = 1; line < N - 1; line += 2) for (let a = 0; a < N - 1; a++) {
      const c = nodeX(line);
      for (let s = nodeX(a) + RW + 20; s < nodeX(a + 1) - RW - 18; s += 14) for (const side of [-1, 1]) spots.push([s, c + side * (RW + SW - 1.0), 0.85 + R() * 0.3]);
    }
    // campagne
    for (let k = 0; k < 520; k++) {
      const a = R() * Math.PI * 2, r = HALF + RW + 18 + Math.pow(R(), 0.7) * 420;
      let x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.hw && this.hw.near(x, z, 14)) continue;
      spots.push([x, z, 0.9 + R() * 0.9, true]);
    }
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 3.4, 9, 1); trunk.translate(0, 1.7, 0); uvCyl(trunk);
    const crown = makeCrownGeo();
    const ti = new THREE.InstancedMesh(trunk, this.mats.bark, spots.length);
    const ci = new THREE.InstancedMesh(crown, this.mats.leaves, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    spots.forEach(([x, z, s, far], k) => {
      e.set(0, R() * 6.28, 0); q.setFromEuler(e);
      const y = far ? 0.02 : CURB;
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.9 + R() * 0.3), s));
      ti.setMatrixAt(k, m4); ci.setMatrixAt(k, m4);
      col.setHSL(0.24 + R() * 0.07, 0.45 + R() * 0.2, 0.75 + R() * 0.3); ci.setColorAt(k, col);
      if (!far) this.solids.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 });
    });
    ti.castShadow = ci.castShadow = true; ci.receiveShadow = true;
    this.group.add(ti, ci);
  }
}

// ---------- directions ----------
export const DIRS = [
  { k: 'E', dx: 1, dz: 0 }, { k: 'W', dx: -1, dz: 0 }, { k: 'S', dx: 0, dz: 1 }, { k: 'N', dx: 0, dz: -1 },
];
export function dirKey(axis, sign) { return axis === 'x' ? (sign > 0 ? 'E' : 'W') : (sign > 0 ? 'S' : 'N'); }
export function dirOf(k) { return DIRS.find(d => d.k === k); }
// virage relatif : de la direction a à la direction b → 'straight' | 'left' | 'right' | 'uturn'
export function turnOf(a, b) {
  const A = dirOf(a), B = dirOf(b);
  if (A.k === B.k) return 'straight';
  if (A.dx === -B.dx && A.dz === -B.dz) return 'uturn';
  // normale droite de A = (-dz, dx)
  return (B.dx === -A.dz && B.dz === A.dx) ? 'right' : 'left';
}
export function turnDir(a, turn) {
  const A = dirOf(a);
  if (turn === 'straight') return a;
  const r = { dx: -A.dz, dz: A.dx };
  const t = turn === 'right' ? r : { dx: -r.dx, dz: -r.dz };
  return DIRS.find(d => d.dx === t.dx && d.dz === t.dz).k;
}

// ---------- géométrie utilitaire ----------
class Geo { constructor() { this.map = new Map(); } add(k, g) { if (!this.map.has(k)) this.map.set(k, []); if (!g.index) g = g; this.map.get(k).push(g.index ? g.toNonIndexed() : g); } }
function uvWorld(g) { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i)); uv.needsUpdate = true; }
function polyTop(poly, y) {
  const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(sh, 8); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); uvWorld(g); return g;
}
export function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function quad(a, b, c, d) { // quadrilatère a b c d (sens antihoraire vu de l'extérieur), UV en mètres
  const g = new THREE.BufferGeometry();
  const P = [...a, ...b, ...c, ...a, ...c, ...d, ...a, ...c, ...b, ...a, ...d, ...c]; // deux faces
  const lu = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), lv = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, lu, 0, lu, lv, 0, 0, lu, lv, 0, lv, 0, 0, lu, lv, lu, 0, 0, 0, 0, lv, lu, lv], 2));
  g.computeVertexNormals(); return g;
}
function tri3(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
  const lu = Math.hypot(b[0] - a[0], b[2] - a[2]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, a[1], lu, b[1], lu / 2, c[1], 0, a[1], lu / 2, c[1], lu, b[1]], 2));
  g.computeVertexNormals(); return g;
}
function boxUV(g) { // UV des faces d'une boîte en mètres
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)); uv.setXY(i, ay > 0.5 ? p.getX(i) : (ax > 0.5 ? p.getZ(i) : p.getX(i)), ay > 0.5 ? p.getZ(i) : p.getY(i)); }
}
function uvCyl(g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.4, uv.getY(i) * 3.4); }
// mur vertical de (ax,az) à (bx,bz), normale à droite du sens a→b ... orientée vers l'extérieur selon l'ordre donné
function wall(ax, az, bx, bz, y0, y1) {
  const len = Math.hypot(bx - ax, bz - az);
  const g = new THREE.PlaneGeometry(len, y1 - y0);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * (y1 - y0) + y0);
  // plan par défaut : normale +z, largeur selon x. On l'oriente pour que la largeur suive a→b et la normale pointe vers -(a→b) tourné.
  const ang = Math.atan2(bz - az, bx - ax);
  g.rotateY(-ang + Math.PI); // normale à gauche du parcours a→b (vers l'extérieur)
  g.translate((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2);
  return g;
}
function orientBox(g, p0, p1, n, out, y) {
  g.rotateY(Math.atan2(n[0], n[1]));
  g.translate((p0[0] + p1[0]) / 2 + n[0] * out, y, (p0[1] + p1[1]) / 2 + n[1] * out);
}
function makeCrownGeo() {
  const parts = [];
  const R = rng(7);
  for (let k = 0; k < 6; k++) {
    const s = new THREE.IcosahedronGeometry(1.25 + R() * 0.6, 2);
    const p = s.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const f = 1 + (Math.sin(v.x * 3.1 + k) * Math.cos(v.z * 2.7) * 0.18); v.multiplyScalar(f); p.setXYZ(i, v.x, v.y, v.z); }
    s.computeVertexNormals();
    s.translate((R() - 0.5) * 2.2, 4.2 + R() * 1.8, (R() - 0.5) * 2.2);
    parts.push(s);
  }
  return mergeGeometries(parts, false);
}
// instancie un modèle GLB (toutes ses sous-maillages) à plusieurs emplacements, mis à l'échelle sur une hauteur
function instGLB(group, scene, places, height) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene); const s = height / (box.max.y - box.min.y);
  const base = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  const meshes = []; scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const m4 = new THREE.Matrix4(), place = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const me of meshes) {
    const im = new THREE.InstancedMesh(me.geometry, me.material, places.length);
    places.forEach((p, k) => {
      e.set(0, p.yaw || 0, 0); q.setFromEuler(e);
      place.compose(new THREE.Vector3(p.x, CURB, p.z), q, new THREE.Vector3(1, 1, 1));
      m4.copy(place).multiply(base).multiply(me.matrixWorld); im.setMatrixAt(k, m4);
    });
    im.castShadow = true; im.receiveShadow = true; group.add(im);
  }
}

function makeMaterials() {
  const M = {};
  const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  M.asphalt = pbr('asphalt_02', { scale: 4.5, color: 0xcfcfcf });
  M.sidewalk = pbr('square_concrete_pavers', { scale: 2.2 });
  M.curb = pbr('concrete_floor_02', { scale: 1.2, color: 0xe2ded6 });
  M.grass = pbr('leafy_grass', { scale: 2.6, color: 0xc8d6b0 });
  M.grassFar = pbr('leafy_grass', { scale: 5, color: 0xb9c99a });
  M.gravel = pbr('gravel_floor', { scale: 2.2, color: 0xd8d0c0 });
  M.brick = pbr('red_brick_03', { scale: 2.2 });
  M.plasterW = pbr('white_plaster_02', { scale: 3, color: 0xf2eee6 });
  M.plasterY = pbr('yellow_plaster', { scale: 3, color: 0xf3e3c6 });
  M.plasterG = pbr('grey_plaster', { scale: 3, color: 0xdcd8d0 });
  M.concTile = pbr('concrete_tile_facade', { scale: 4, color: 0xebe7df });
  M.facadeTile = pbr('rectangular_facade_tiles_02', { scale: 3 });
  M.stone = pbr('white_plaster_02', { scale: 2, color: 0xe8dcc6 });
  M.roof = pbr('gravel_floor', { scale: 2, color: 0x8f8b85 });
  M.bark = pbr('bark_willow_02', { scale: 1.2 });
  M.cornice = std(0xe9e4da, 0.8, 0);
  M.lotAsphalt = pbr('asphalt_02', { scale: 4.5, color: 0xb9b9b9 });
  M.lotConcrete = pbr('painted_concrete', { scale: 3, color: 0xd9d4ca });
  M.roofTile = pbr('clay_roof_tiles_02', { scale: 2.2 });
  M.roofSlate = pbr('grey_roof_tiles_02', { scale: 2.2 });
  M.whiteBrick = pbr('white_bricks', { scale: 2.2 });
  M.metal = pbr('box_profile_metal_sheet', { scale: 2.5, color: 0xe4e6e8 });
  M.metalBlue = pbr('box_profile_metal_sheet', { scale: 2.5, color: 0x6f8fb3 });
  M.hedge = std(0x3f6b2a, 0.9, 0, { bumpMap: null });
  M.fence = std(0x2f5a3d, 0.5, 0.6, { transparent: true, opacity: 0.85 });
  M.shutterDoor = std(0xc9ccd0, 0.5, 0.5);
  M.mark = std(0xf4f4f0, 0.55, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  M.winFrame = std(0xf2f0ea, 0.5, 0.05);
  M.winGlass = std(0x1a2430, 0.06, 0.9, { envMapIntensity: 1.6 });
  M.shutter = std(0x5d7a8c, 0.6, 0.1);
  M.shopGlass = std(0x22303a, 0.05, 0.85, { envMapIntensity: 1.8 });
  M.shopFrame = std(0x2a2d31, 0.4, 0.6);
  ['#9c2a2a', '#2d5a3f', '#24456e', '#b88a2a'].forEach((c, k) => M['awning' + k] = std(c, 0.85, 0, { side: THREE.DoubleSide }));
  M.pole = std(0xa6a9ad, 0.35, 0.85);
  M.darkMetal = std(0x2b2e31, 0.45, 0.7);
  M.leaves = std(0x6f9a48, 0.78, 0, { envMapIntensity: 0.7 });
  return M;
}

function silhouette(t) {
  const src = t.image, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#8d9196'; g.fillRect(0, 0, c.width, c.height);
  const o = new THREE.CanvasTexture(c); o.colorSpace = THREE.SRGBColorSpace; return o;
}
// ---------- textures de panneaux (dessinées) ----------
function signTextures() {
  const T = {};
  const S = 256;
  const mk = (draw) => { const t = canvasTex(S, S, draw); t.anisotropy = 8; return t; };
  T.stop = mk((g) => {
    g.translate(S / 2, S / 2); g.beginPath();
    for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(Math.cos(a) * 124, Math.sin(a) * 124); }
    g.closePath(); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(Math.cos(a) * 114, Math.sin(a) * 114); }
    g.closePath(); g.fillStyle = '#c8102e'; g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 74px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 0, 4);
  });
  const tri = (g, up, inner) => {
    g.translate(S / 2, S / 2 + (up ? 18 : -18));
    const pts = (r) => up ? [[0, -r], [r * 0.866, r / 2], [-r * 0.866, r / 2]] : [[0, r], [r * 0.866, -r / 2], [-r * 0.866, -r / 2]];
    const path = (r) => { g.beginPath(); pts(r).forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
    g.lineJoin = 'round'; g.lineWidth = 16;
    path(140); g.fillStyle = '#c8102e'; g.strokeStyle = '#c8102e'; g.fill(); g.stroke();
    path(98); g.fillStyle = '#fff'; g.fill();
    inner && inner(g);
  };
  T.yield = mk((g) => tri(g, false));
  T.ab1 = mk((g) => tri(g, true, (g) => { g.strokeStyle = '#111'; g.lineWidth = 15; g.lineCap = 'butt'; g.beginPath(); g.moveTo(-30, -18); g.lineTo(30, 52); g.moveTo(30, -18); g.lineTo(-30, 52); g.stroke(); }));
  T.ab2 = mk((g) => tri(g, true, (g) => { g.fillStyle = '#111'; g.fillRect(-9, -40, 18, 100); g.fillRect(-38, 12, 76, 9); }));
  T.a17 = mk((g) => tri(g, true, (g) => { g.fillStyle = '#111'; g.beginPath(); g.roundRect(-20, -48, 40, 104, 10); g.fill(); [['#e3202a', -30], ['#f5b000', 4], ['#2bb24c', 38]].forEach(([c, y]) => { g.fillStyle = c; g.beginPath(); g.arc(0, y, 12, 0, 7); g.fill(); }); }));
  T.ab25 = mk((g) => tri(g, true, (g) => { g.strokeStyle = '#111'; g.lineWidth = 9; for (let k = 0; k < 3; k++) { const a0 = k * 2.09 + 0.3; g.beginPath(); g.arc(0, 18, 26, a0, a0 + 1.4); g.stroke(); const a = a0 + 1.4, x = Math.cos(a) * 26, y = 18 + Math.sin(a) * 26; g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2); g.fillStyle = '#111'; g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -9); g.lineTo(-6, 9); g.closePath(); g.fill(); g.restore(); } }));
  T.b21 = mk((g) => { g.translate(S / 2, S / 2); g.beginPath(); g.arc(0, 0, 122, 0, 7); g.fillStyle = '#fff'; g.fill(); g.beginPath(); g.arc(0, 0, 114, 0, 7); g.fillStyle = '#1d4ed8'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 16; for (let k = 0; k < 3; k++) { const a0 = k * 2.09 + 0.2; g.beginPath(); g.arc(0, 0, 58, a0, a0 + 1.45); g.stroke(); const a = a0 + 1.45; g.save(); g.translate(Math.cos(a) * 58, Math.sin(a) * 58); g.rotate(a + Math.PI / 2); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(22, 0); g.lineTo(-10, -20); g.lineTo(-10, 20); g.closePath(); g.fill(); g.restore(); } });
  T.park = mk((g) => { g.fillStyle = '#fff'; g.beginPath(); g.roundRect(6, 6, S - 12, S - 12, 22); g.fill(); g.fillStyle = '#1d4ed8'; g.beginPath(); g.roundRect(16, 16, S - 32, S - 32, 16); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 190px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', S / 2, S / 2 + 10); });
  for (const v of [30, 50, 70]) T['v' + v] = mk((g) => {
    g.translate(S / 2, S / 2);
    g.beginPath(); g.arc(0, 0, 124, 0, 7); g.fillStyle = '#c8102e'; g.fill();
    g.beginPath(); g.arc(0, 0, 96, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = '#111'; g.font = 'bold 104px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), 0, 8);
  });
  return T;
}
