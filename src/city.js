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
    this.time = 0;
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
  stopDist(n, dk) { return n.cross[dk] ? RW + 6.6 : RW + 0.9; }

  // Feu : 'G' | 'O' | 'R' pour un axe d'arrivée
  lightState(n, axis, t = this.time) {
    const c = ((t + n.lightOffset) % 34 + 34) % 34;
    const a = axis === 'x' ? c : (c + 17) % 34;
    return a < 12 ? 'G' : a < 15 ? 'O' : 'R';
  }

  // Localisation d'un point : carrefour, tronçon (avec écart latéral) ou hors route
  locate(x, z) {
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
  onSidewalk(x, z) { for (const b of this.blocks) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true; return Math.abs(x) > HALF + RW || Math.abs(z) > HALF + RW; }
  hitsSolid(x, z) { for (const b of this.solids) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true; return false; }

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
    for (const s of [-1, 1]) {
      this.addSlab(G, -ext - SW, ext + SW, s > 0 ? ext : -ext - SW, s > 0 ? ext + SW : -ext, 'outer');
      this.addSlab(G, s > 0 ? ext : -ext - SW, s > 0 ? ext + SW : -ext, -ext, ext, 'outer');
    }
    // îlots
    const parks = new Set(['1:3', '3:1']);
    this.parkSpots = [];
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
      const x0 = nodeX(i) + RW, x1 = nodeX(i + 1) - RW, z0 = nodeX(j) + RW, z1 = nodeX(j + 1) - RW;
      this.blocks.push({ x0, x1, z0, z1 });
      const kind = parks.has(i + ':' + j) ? 'park' : 'build';
      this.addSlab(G, x0, x1, z0, z1, kind);
      const L = { x0: x0 + SW, x1: x1 - SW, z0: z0 + SW, z1: z1 - SW };
      if (kind === 'park') this.buildPark(G, L, R);
      else this.buildBlock(G, L, R, quality);
    }
    this.buildMarkings(G);
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
    this.buildTrees(R);
  }

  addSlab(G, x0, x1, z0, z1, kind) {
    const w = x1 - x0, d = z1 - z0;
    const top = new THREE.PlaneGeometry(w, d); top.rotateX(-Math.PI / 2); top.translate((x0 + x1) / 2, CURB, (z0 + z1) / 2); uvWorld(top);
    if (kind === 'park') {
      // allée périphérique + pelouse
      const rim = [[x0, x1, z0, z0 + SW], [x0, x1, z1 - SW, z1], [x0, x0 + SW, z0 + SW, z1 - SW], [x1 - SW, x1, z0 + SW, z1 - SW]];
      for (const [a, b, c, e] of rim) { const p = new THREE.PlaneGeometry(b - a, e - c); p.rotateX(-Math.PI / 2); p.translate((a + b) / 2, CURB, (c + e) / 2); uvWorld(p); G.add('sidewalk', p); }
      const g = new THREE.PlaneGeometry(w - 2 * SW, d - 2 * SW); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, CURB + 0.01, (z0 + z1) / 2); uvWorld(g); G.add('grass', g);
    } else G.add(kind === 'outer' ? 'sidewalk' : 'sidewalk', top);
    // bordure (faces verticales)
    const sides = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
    for (const [ax, az, bx, bz] of sides) G.add('curb', wall(ax, az, bx, bz, 0, CURB + 0.001));
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
      const c = nodeX(line), s0 = nodeX(a) + RW, s1 = nodeX(a + 1) - RW;
      const P = (s, l) => axis === 'x' ? [s, c + l] : [c + l, s];
      const nA = axis === 'x' ? this.nodes[a][line] : this.nodes[line][a];
      const nB = axis === 'x' ? this.nodes[a + 1][line] : this.nodes[line][a + 1];
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
        else if (ctl === 'yield') for (let l = 0.3; l < RW - 0.4; l += 1.0) strip(...P(sLine, rs * l), ...P(sLine, rs * (l + 0.5)), 0.5);
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
      sc.set(1, w.door ? 1.35 : 1, 1); p.set(w.x, w.y + (w.door ? 0.25 : 0), w.z);
      m4.compose(p, q, sc); frames.setMatrixAt(k, m4); glass.setMatrixAt(k, m4);
      if ((k * 7919) % 5 < 2 && si < withShut.length) shut.setMatrixAt(si++, m4);
    });
    for (const im of [frames, glass, shut]) { im.castShadow = false; im.receiveShadow = true; this.group.add(im); }
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
        else if (ctl === 'yield') add('yield', px, pz, yaw);
        // panneaux de position avancée (30 m avant)
        const ax = n.x - d.dx * (sd + 30) + rx * (RW + 0.7), az = n.z - d.dz * (sd + 30) + rz * (RW + 0.7);
        if (ctl === 'right') add('ab1', ax, az, yaw);
        else if (ctl === 'major') add('ab2', ax, az, yaw);
        else if (ctl === 'light') add('a17', ax, az, yaw);
        // limitation en sortie de carrefour (sur le tronçon qui part de n dans la direction d)
        const to = this.node(i + d.dx, j + d.dz);
        if (to) {
          const line = axis === 'x' ? j : i, a = axis === 'x' ? Math.min(i, i + d.dx) : Math.min(j, j + d.dz);
          const lim = this.limitOf(axis, line, a);
          const sx = n.x + d.dx * (RW + 12) + rx * (RW + 0.7), sz = n.z + d.dz * (RW + 12) + rz * (RW + 0.7);
          add('v' + lim, sx, sz, Math.atan2(d.dx, d.dz) + Math.PI);
        }
      }
    }
    // poteaux
    const pm = new THREE.InstancedMesh(poleGeo, this.mats.metal, poles.length);
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
  M.mark = std(0xf4f4f0, 0.55, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  M.winFrame = std(0xf2f0ea, 0.5, 0.05);
  M.winGlass = std(0x1a2430, 0.06, 0.9, { envMapIntensity: 1.6 });
  M.shutter = std(0x5d7a8c, 0.6, 0.1);
  M.shopGlass = std(0x22303a, 0.05, 0.85, { envMapIntensity: 1.8 });
  M.shopFrame = std(0x2a2d31, 0.4, 0.6);
  ['#9c2a2a', '#2d5a3f', '#24456e', '#b88a2a'].forEach((c, k) => M['awning' + k] = std(c, 0.85, 0, { side: THREE.DoubleSide }));
  M.metal = std(0xa6a9ad, 0.35, 0.85);
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
  for (const v of [30, 50, 70]) T['v' + v] = mk((g) => {
    g.translate(S / 2, S / 2);
    g.beginPath(); g.arc(0, 0, 124, 0, 7); g.fillStyle = '#c8102e'; g.fill();
    g.beginPath(); g.arc(0, 0, 96, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = '#111'; g.font = 'bold 104px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), 0, 8);
  });
  return T;
}
