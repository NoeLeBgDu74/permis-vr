// Circulation : voitures IA qui suivent les voies, respectent feux / stops / cédez / priorité à droite,
// gardent leurs distances (IDM) ; piétons qui traversent aux passages cloutés.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { N, SP, RW, LO, RO, RI, RC, radOf, nodeX, DIRS, dirOf, turnOf, turnDir } from './city.js';
import { loadCarTemplate, makeCar, poseCar, carLOD, MODELS, PAINTS } from './car.js';
import { glb } from './assets.js';

const rightOf = (d) => ({ x: -d.dz, z: d.dx });
function rand(a, b) { return a + Math.random() * (b - a); }

export class Traffic {
  constructor(scene, city) { this.scene = scene; this.city = city; this.cars = []; this.peds = []; this.parked = []; this.player = null; this.honks = []; }

  async init(count, avoid) {
    const ids = ['milano95', 'sigil07', 'asti89', 'fairheaven80', 'ace11'];
    const tpls = await Promise.all(ids.map(loadCarTemplate));
    const taken = [];
    let guard = 0;
    while (this.cars.length < count && guard++ < 500) {
      const axisDir = DIRS[Math.floor(Math.random() * 4)];
      const i = Math.floor(Math.random() * N), j = Math.floor(Math.random() * N);
      const from = this.city.node(i, j), to = this.city.node(i + axisDir.dx, j + axisDir.dz);
      if (!from || !to) continue;
      const s = rand(8, SP - 2 * RO - 4);
      const key = from.i + ',' + from.j + axisDir.k;
      if (taken.some(t => t.key === key && Math.abs(t.s - s) < 14)) continue;
      const tpl = tpls[Math.floor(Math.random() * tpls.length)];
      const car = makeCar(tpl, PAINTS[Math.floor(Math.random() * PAINTS.length)]);
      const fou = this.cars.length % 5 === 2;   // ≈ 1 voiture sur 5 : un chauffard
      const a = { car, from, d: axisDir.k, s, v: 6, phase: 'seg', len: tpl.size.z, half: tpl.size.x / 2, pace: fou ? rand(1.35, 1.6) : rand(0.85, 1.04), fou, wait: 0, cleared: false, stopped: 0, spin: 0, honkT: 0 };
      if (fou && car.paint) car.paint.color.set(['#101114', '#8a1c1c', '#e0c341', '#1d3c78'][this.cars.length % 4]);
      this.planNext(a);
      this.place(a);
      if (avoid && Math.hypot(a.x - avoid.x, a.z - avoid.z) < 45) { continue; }
      taken.push({ key, s });
      this.scene.add(car.obj); this.cars.push(a);
    }
    // voitures garées (rue du créneau + parking du supermarché), immobiles
    for (const sp of [...(this.city.parkedSpots || []), ...(this.city.decorCars || [])]) {
      const tpl = tpls[Math.floor(Math.random() * tpls.length)];
      const car = makeCar(tpl, PAINTS[Math.floor(Math.random() * PAINTS.length)]);
      const y = (this.city.parkedSpots || []).includes(sp) ? 0 : 0.152;
      car.obj.position.set(sp.x, y, sp.z); car.obj.rotation.y = sp.yaw; poseCar(car, {});
      this.scene.add(car.obj);
      this.parked.push({ x: sp.x, z: sp.z, yaw: sp.yaw, v: 0, len: tpl.size.z, half: tpl.size.x / 2, car, street: y === 0 });
    }
    // véhicules d'urgence : ambulance (blanche) et police (bleu nuit), gyrophares + sirène, priorité absolue
    for (const [id, paint, kind] of [['sigil07', '#f4f4f2', 'ambulance'], ['milano95', '#16244a', 'police']]) {
      const tpl = await loadCarTemplate(id), car = makeCar(tpl, paint);
      const bar = new THREE.Group(); bar.position.set(0, tpl.size.y + 0.06, -0.1);
      const blue = [0, 1].map(() => new THREE.MeshStandardMaterial({ color: 0x0a1a66, emissive: 0x2a5bff, emissiveIntensity: 0, toneMapped: false }));
      for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.22), blue[sx > 0 ? 0 : 1]); m.position.x = sx * 0.25; bar.add(m); }
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222 })); base.position.y = -0.07; bar.add(base);
      car.obj.add(bar);
      if (kind === 'ambulance') { const st = new THREE.Mesh(new THREE.BoxGeometry(tpl.size.x + 0.02, 0.14, tpl.size.z * 0.7), new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.5 })); st.position.y = 0.78; car.obj.add(st); }
      const i = Math.floor(Math.random() * N), j = 1 + Math.floor(Math.random() * (N - 2));
      const a = { car, from: this.city.node(i, j), d: 'E', s: 10, v: 8, phase: 'seg', len: tpl.size.z, half: tpl.size.x / 2, pace: 1.45, urgent: kind, blue, wait: 0, cleared: false, stopped: 0, spin: 0, honkT: 0, shift: 0 };
      if (!this.city.node(i + 1, j)) a.d = 'W';
      this.planNext(a); this.place(a); this.scene.add(car.obj); this.cars.push(a);
    }
    await this.initPeds();
  }

  segLen(a) { return SP - radOf(a.from) - radOf(this.toNode(a)); }
  toNode(a) { const d = dirOf(a.d); return this.city.node(a.from.i + d.dx, a.from.j + d.dz); }
  planNext(a) {
    const B = this.toNode(a);
    const opts = [];
    for (const t of ['straight', 'straight', 'left', 'right']) { const nd = dirOf(turnDir(a.d, t)); if (this.city.node(B.i + nd.dx, B.j + nd.dz)) opts.push(t); }
    a.turn = opts.length ? opts[Math.floor(Math.random() * opts.length)] : 'uturn';
    a.nd = a.turn === 'uturn' ? DIRS.find(x => { const D = dirOf(a.d); return x.dx === -D.dx && x.dz === -D.dz; }).k : turnDir(a.d, a.turn);
    a.cleared = false; a.wait = 0; a.stopped = 0; a.dare = a.fou && Math.random() < 0.55; // ce chauffard grillera-t-il le prochain feu / stop ?
  }
  // point de voie (droite) à la distance s depuis la sortie du nœud `from`
  lanePoint(n, dk, s) {
    const d = dirOf(dk), r = rightOf(d);
    const R0 = radOf(n);
    const L = LO - (this._shift || 0);
    return { x: n.x + d.dx * (R0 + s) + r.x * L, z: n.z + d.dz * (R0 + s) + r.z * L };
  }
  buildTurn(a) {
    const B = this.toNode(a), d = dirOf(a.d), r = rightOf(d), d2 = dirOf(a.nd), r2 = rightOf(d2);
    if (B.type === 'round') { // anneau parcouru dans le sens antihoraire (îlot à gauche)
      const k = Math.sqrt(RC * RC - LO * LO);
      const q0 = { x: B.x - d.dx * RO + r.x * LO, z: B.z - d.dz * RO + r.z * LO };
      const pin = { x: B.x + r.x * LO - d.dx * k, z: B.z + r.z * LO - d.dz * k };
      const pout = { x: B.x + r2.x * LO + d2.dx * k, z: B.z + r2.z * LO + d2.dz * k };
      const q2 = { x: B.x + d2.dx * RO + r2.x * LO, z: B.z + d2.dz * RO + r2.z * LO };
      const t1 = Math.atan2(pin.z - B.z, pin.x - B.x); let t2 = Math.atan2(pout.z - B.z, pout.x - B.x);
      while (t2 > t1 - 0.3) t2 -= Math.PI * 2;
      const pts = [q0]; for (let t = t1; t > t2; t -= 0.14) pts.push({ x: B.x + Math.cos(t) * RC, z: B.z + Math.sin(t) * RC });
      pts.push({ x: B.x + Math.cos(t2) * RC, z: B.z + Math.sin(t2) * RC }, q2);
      let L = 0; pts[0].L = 0; for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); pts[i].L = L; }
      a.turnPts = pts; a.turnLen = L; a.node = B; return;
    }
    const p0 = { x: B.x - d.dx * RW + r.x * LO, z: B.z - d.dz * RW + r.z * LO };
    const p2 = { x: B.x + d2.dx * RW + r2.x * LO, z: B.z + d2.dz * RW + r2.z * LO };
    let c;
    if (a.turn === 'straight') c = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
    else if (a.turn === 'uturn') c = { x: B.x, z: B.z };
    else { const t = (p2.x - p0.x) * d.dx + (p2.z - p0.z) * d.dz; c = { x: p0.x + d.dx * t, z: p0.z + d.dz * t }; }
    const pts = []; let L = 0, prev = null;
    for (let k = 0; k <= 16; k++) { const t = k / 16, u = 1 - t; const p = { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * c.z + t * t * p2.z }; if (prev) L += Math.hypot(p.x - prev.x, p.z - prev.z); p.L = L; pts.push(p); prev = p; }
    a.turnPts = pts; a.turnLen = L; a.node = B;
  }
  place(a) {
    let x, z, yaw;
    if (a.phase === 'seg') {
      this._shift = a.shift || 0; const p = this.lanePoint(a.from, a.d, a.s); this._shift = 0; x = p.x; z = p.z; const d = dirOf(a.d); yaw = Math.atan2(d.dx, d.dz);
    } else {
      const P = a.turnPts; let k = 1; while (k < P.length - 1 && P[k].L < a.s) k++;
      const p0 = P[k - 1], p1 = P[k], t = (a.s - p0.L) / Math.max(1e-4, p1.L - p0.L);
      x = p0.x + (p1.x - p0.x) * t; z = p0.z + (p1.z - p0.z) * t; yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    }
    a.x = x; a.z = z;
    if (a.yaw === undefined) a.yaw = yaw; else { let dy = yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.yaw += dy * 0.35; }
    a.car.obj.position.set(x, 0, z); a.car.obj.rotation.y = a.yaw;
  }

  // véhicules (IA + joueur) sous forme {x,z,yaw,v,len,half,self}
  bodies() {
    const out = this.cars.map(a => ({ x: a.x, z: a.z, yaw: a.yaw, v: a.v, len: a.len, half: a.half, ai: a }));
    if (this.player) out.push(this.player);
    return out;
  }

  // un véhicule approche-t-il du nœud n par la direction dk (en roulant vers n) dans un délai ?
  approaching(n, dk, horizon, bodies, self) {
    const d = dirOf(dk);
    for (const b of bodies) {
      if (b.ai === self) continue;
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      if (fx * d.dx + fz * d.dz < 0.7) continue;           // pas dans ce sens
      const rx = n.x - b.x, rz = n.z - b.z;
      const along = rx * d.dx + rz * d.dz;                  // distance restante jusqu'au centre
      const lat = Math.abs(rx * d.dz - rz * d.dx);
      if (lat > RW + 0.5 || along < -RW || along > 60) continue;
      const dist = along - RW;
      if (dist < 1.5) return true;                          // déjà dans le carrefour / à la ligne
      const v = Math.max(Math.abs(b.v), 0.1);
      if (dist / v < horizon && Math.abs(b.v) > 1) return true;
      if (b.ai && b.ai.phase === 'seg' && !b.ai.cleared && dist < 9 && Math.abs(b.v) < 0.5 && dk === b.ai.d && b.ai.waiting) return 'waiting';
    }
    return false;
  }
  boxBusy(n, bodies, self) {
    for (const b of bodies) {
      if (b.ai === self) continue;
      if (Math.abs(b.x - n.x) < RW + 0.8 && Math.abs(b.z - n.z) < RW + 0.8) return true;
    }
    return false;
  }

  update(dt, playerBody) {
    this.player = playerBody ? { ...playerBody, ai: null } : null;
    const bodies = this.bodies();
    const city = this.city;
    for (const a of this.cars) {
      const lim = a.phase === 'seg' ? city.limitOf(dirOf(a.d).dx ? 'x' : 'z', dirOf(a.d).dx ? a.from.j : a.from.i, dirOf(a.d).dx ? Math.min(a.from.i, a.from.i + dirOf(a.d).dx) : Math.min(a.from.j, a.from.j + dirOf(a.d).dz)) : 30;
      let v0 = lim / 3.6 * a.pace;
      if (a.phase === 'turn') v0 = a.node && a.node.type === 'round' ? 7 : a.turn === 'straight' ? 9 : 5.2;
      // approche du carrefour avec pré-ralentissement si on tourne
      let stopGap = Infinity;
      a.waiting = false;
      if (a.phase === 'seg') {
        const L = this.segLen(a), B = this.toNode(a);
        const remain = L - a.s;
        if ((a.turn !== 'straight' || B.type === 'round') && remain < 30) v0 = Math.min(v0, (B.type === 'round' ? 6.5 : 5.2) + remain * 0.25);
        const axis = dirOf(a.d).dx ? 'x' : 'z';
        const sd = city.stopDist(B, a.d) - radOf(B); // ligne d'arrêt à `sd` avant la fin du segment
        const toLine = remain - sd;
        // piétons sur le passage d'approche ou de sortie
        if (this.pedBlocking(B, a.d, a.nd)) stopGap = Math.min(stopGap, Math.max(0.1, toLine - 0.3));
        if (!a.cleared && toLine < 45) {
          const ctl = city.controlFor(B, axis);
          let go = true;
          if (ctl === 'light') {
            const st = city.lightState(B, axis);
            if (st === 'R') go = !!((a.dare || a.urgent) && toLine < 30);
            else if (st === 'O') go = toLine < a.v * a.v / 6 + 1;
          } else if (ctl === 'stop') {
            if (a.stopped < 1.0) go = false;
            if (a.dare) { a.stopped = 1; }                          // stop « glissé »
            if (toLine < 1.6 && Math.abs(a.v) < 0.25) a.stopped += dt;
            if (a.stopped >= 1.0) go = this.clearFor(a, B, axis, 'minor', bodies);
          } else if (ctl === 'yield') {
            if (toLine < 12) go = this.clearFor(a, B, axis, 'minor', bodies);
          } else if (ctl === 'right') {
            if (toLine < 14) go = a.dare || this.clearFor(a, B, axis, 'right', bodies);
          } else if (ctl === 'round') {
            if (toLine < 14) go = this.clearRound(a, B, bodies) || a.wait > 9;
          }
          if (a.urgent && toLine < 12) { go = !this.boxBusy(B, bodies, a); v0 = Math.min(v0, 6); }
          if (go && toLine < 10 && ctl !== 'major' && ctl !== 'round' && this.boxBusy(B, bodies, a)) go = false;
          if (go && toLine < 8) a.cleared = true;
          if (!go) { stopGap = Math.min(stopGap, Math.max(0.1, toLine - 0.3)); a.wait += dt; a.waiting = toLine < 9; }
        }
      }
      // véhicule de tête (y compris le joueur)
      let lead = Infinity, leadV = 0;
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      for (const b of bodies) {
        if (b.ai === a) continue;
        const rx = b.x - a.x, rz = b.z - a.z;
        const f = rx * fx + rz * fz; if (f <= 0 || f > 45) continue;
        const l = Math.abs(rx * fz - rz * fx);
        const bf = Math.sin(b.yaw) * fx + Math.cos(b.yaw) * fz;
        if (l > (a.phase === 'turn' ? 2.3 : 1.7) + (bf < 0.5 ? 0.6 : 0)) continue;
        const gap = f - (a.len + b.len) / 2;
        if (gap < lead) { lead = gap; leadV = b.v * Math.max(0, bf); a.leadIsPlayer = !b.ai; }
      }
      for (const p of this.peds) { // piétons devant (sécurité)
        if (!p.onRoad) continue;
        const rx = p.x - a.x, rz = p.z - a.z, f = rx * fx + rz * fz; if (f <= 0 || f > 20) continue;
        if (Math.abs(rx * fz - rz * fx) < 1.8) { const gap = f - a.len / 2 - 0.6; if (gap < lead) { lead = gap; leadV = 0; } }
      }
      // urgence bloquée derrière quelqu'un : elle déboîte à gauche pour doubler
      if (a.urgent) {
        const want = a.phase === 'seg' && lead < 14 && a.v < 6 && this.segLen(a) - a.s > 30 ? 2 * LO : (a.overT > 0 ? 2 * LO : 0);
        if (want && !a.overT) a.overT = 4; if (a.overT) a.overT = Math.max(0, a.overT - dt);
        a.shift = (a.shift || 0) + Math.sign(want - (a.shift || 0)) * Math.min(Math.abs(want - (a.shift || 0)), dt * 2.5);
        if (a.shift > 0.5) lead = Infinity;
        const ph = (performance.now() % 500) < 250; a.blue[0].emissiveIntensity = ph ? 6 : 0.2; a.blue[1].emissiveIntensity = ph ? 0.2 : 6;
      }
      // le chauffard klaxonne s'il est bloqué derrière le joueur
      if (a.fou && a.leadIsPlayer && lead < 9 && a.v < 3) { a.honkT += dt; if (a.honkT > 1.5) { a.honkT = -4; this.honks.push({ x: a.x, z: a.z, fou: true }); } } else if (a.honkT > 0) a.honkT = 0; else a.honkT += dt;
      a.leadIsPlayer = false;
      // IDM
      const amax = a.fou ? 3 : 1.6, bc = 2.4, T = a.fou ? 0.6 : 1.3, s0 = a.fou ? 1.0 : 2.2;
      let acc = amax * (1 - Math.pow(Math.max(0, a.v) / Math.max(0.5, v0), 4));
      const idm = (gap, vl) => { const ss = s0 + Math.max(0, a.v * T + a.v * (a.v - vl) / (2 * Math.sqrt(amax * bc))); return -amax * (ss / Math.max(0.2, gap)) ** 2; };
      if (lead < 60) acc += idm(lead, leadV);
      if (stopGap < 60) acc = Math.min(acc, amax * (1 - Math.pow(a.v / Math.max(0.5, v0), 4)) + idm(stopGap + 2.0, 0));
      acc = Math.max(-7, acc);
      a.v = Math.max(0, a.v + acc * dt);
      if (stopGap < 0.4 && a.v < 0.6) a.v = 0;
      a.s += a.v * dt;
      a.braking = acc < -0.6 || a.v < 0.1;
      // transitions
      if (a.phase === 'seg' && a.s >= this.segLen(a)) {
        a.s -= this.segLen(a); a.phase = 'turn'; this.buildTurn(a);
      } else if (a.phase === 'turn' && a.s >= a.turnLen) {
        a.s -= a.turnLen; a.from = a.node; a.d = a.nd; a.phase = 'seg'; this.planNext(a);
      }
      this.place(a);
      a.spin += a.v / 0.31 * dt;
      const isRound = a.phase === 'turn' ? a.node && a.node.type === 'round' : this.toNode(a).type === 'round';
      const blinking = isRound ? (a.phase === 'turn' && a.s > a.turnLen - 14) : a.turn !== 'straight' && (a.phase === 'turn' || this.segLen(a) - a.s < 35);
      poseCar(a.car, { spin: a.spin, steer: a.phase === 'turn' && a.turn !== 'straight' ? (a.turn === 'left' ? 0.45 : -0.45) : 0, brake: a.braking, blink: blinking && (performance.now() % 760 < 380) ? 4 : 0 });
      if (playerBody) carLOD(a.car, Math.hypot(a.x - playerBody.x, a.z - playerBody.z));
    }
    this.updatePeds(dt, bodies);
  }

  // rond-point : céder aux véhicules déjà dans l'anneau qui arrivent par la gauche (en amont)
  clearRound(a, B, bodies) {
    const d = dirOf(a.d), r = rightOf(d), k = Math.sqrt(RC * RC - LO * LO);
    const thIn = Math.atan2(B.z + r.z * LO - d.dz * k - B.z, B.x + r.x * LO - d.dx * k - B.x);
    return roundClear(B, thIn, bodies, a);
  }
  // Peut-on s'engager ? mode 'minor' : céder à tout trafic transversal ; 'right' : céder à droite seulement
  clearFor(a, B, axis, mode, bodies) {
    const d = dirOf(a.d);
    const cross = DIRS.filter(x => (axis === 'x' ? x.dz !== 0 : x.dx !== 0));
    for (const c of cross) {
      // véhicule arrivant vers B dans la direction c ; il vient de notre droite si c = gauche de d… (venir de la droite = rouler vers notre gauche)
      const fromRight = (c.dx === d.dz && c.dz === -d.dx);
      if (mode === 'right' && !fromRight) continue;
      const r = this.approaching(B, c.k, 4.2, bodies, a);
      if (r === true) return false;
      if (r === 'waiting' && mode === 'right' && a.wait < 5) return false;
    }
    // en tournant à gauche, céder aux véhicules d'en face (sauf feu protégé : simplifié)
    if (a.turn === 'left') { const opp = DIRS.find(x => x.dx === -d.dx && x.dz === -d.dz); if (this.approaching(B, opp.k, 3.5, bodies, a) === true && a.wait < 6) return false; }
    return true;
  }

  // ---------- piétons ----------
  async initPeds() {
    const srcs = [];
    for (const f of ['Soldier', 'Xbot']) {
      const g = await glb('assets/chars/' + f + '.glb').catch(() => null); if (!g) continue;
      const walk = g.animations.find(c => /walk/i.test(c.name)); const idle = g.animations.find(c => /idle/i.test(c.name));
      if (walk) srcs.push({ g, walk, idle });
    }
    this.pedSrc = srcs;
    this.pedTimer = 0;
  }
  spawnPed(cr) {
    if (!this.pedSrc.length) return;
    const src = this.pedSrc[Math.floor(Math.random() * this.pedSrc.length)];
    const obj = SkeletonUtils.clone(src.g.scene);
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(obj);
    const walk = mixer.clipAction(src.walk); walk.play();
    const idle = src.idle ? mixer.clipAction(src.idle) : null;
    // passage : bande [s0,s1] le long de l'axe de la route, traversée selon le travers
    const side = Math.random() < 0.5 ? -1 : 1;
    const s = (cr.s0 + cr.s1) / 2 + rand(-1, 1);
    const p = { obj, mixer, walk, idle, cr, s, l: side * (RW + 1.6), dirL: -side, v: rand(1.15, 1.45), state: 'wait', t: rand(0.5, 2), onRoad: false };
    this.posPed(p);
    this.scene.add(obj); this.peds.push(p);
  }
  posPed(p) {
    const cr = p.cr;
    if (cr.axis === 'x') { p.x = p.s; p.z = cr.c + p.l; } else { p.x = cr.c + p.l; p.z = p.s; }
    p.obj.position.set(p.x, 0.14 * (Math.abs(p.l) > RW ? 1 : 0), p.z);
    const dl = p.dirL;
    p.obj.rotation.y = cr.axis === 'x' ? (dl > 0 ? 0 : Math.PI) : (dl > 0 ? Math.PI / 2 : -Math.PI / 2);
    p.onRoad = Math.abs(p.l) < RW + 0.2;
  }
  // un piéton est-il engagé sur le passage d'approche (dk) ou de sortie (nd) du nœud B ?
  pedBlocking(B, dk, nd) {
    for (const p of this.peds) {
      if (p.cr.n !== B || p.state === 'wait' && Math.abs(p.l) > RW + 1) continue;
      if (p.cr.dk === dk || (nd && p.cr.n === B && this.isExitCrossing(p.cr, B, nd))) { if (p.onRoad || p.state === 'cross') return true; }
    }
    return false;
  }
  isExitCrossing(cr, B, nd) { // passage sur le tronçon de sortie : celui dont l'approche vient de la direction opposée
    const d = dirOf(nd); const opp = DIRS.find(x => x.dx === -d.dx && x.dz === -d.dz);
    return cr.dk === opp.k;
  }
  updatePeds(dt, bodies) {
    const P = this.player;
    // apparitions près du joueur
    this.pedTimer -= dt;
    if (P && this.pedTimer <= 0 && this.peds.length < 7 && this.pedSrc && this.pedSrc.length) {
      this.pedTimer = rand(2.5, 6);
      const near = this.city.crossings.filter(c => { const cx = c.axis === 'x' ? (c.s0 + c.s1) / 2 : c.c, cz = c.axis === 'x' ? c.c : (c.s0 + c.s1) / 2; const d = Math.hypot(cx - P.x, cz - P.z); return d > 25 && d < 160 && !this.peds.some(p => p.cr === c); });
      if (near.length) this.spawnPed(near[Math.floor(Math.random() * near.length)]);
    }
    for (const p of this.peds) {
      p.mixer.update(dt * (p.state === 'wait' ? 0 : p.v / 1.3));
      if (p.state === 'wait') {
        p.t -= dt;
        if (p.t <= 0) {
          // ne s'engage pas si une voiture est toute proche
          const cx = p.x, cz = p.z;
          const danger = bodies.some(b => Math.hypot(b.x - cx, b.z - cz) < 11 && Math.abs(b.v) > 2);
          if (!danger) p.state = 'cross'; else p.t = 0.6;
        }
      } else if (p.state === 'cross') {
        p.l += p.dirL * p.v * dt;
        if (Math.abs(p.l) > RW + 1.6 && Math.sign(p.l) === p.dirL) { p.state = 'leave'; p.t = 3; }
      } else if (p.state === 'leave') {
        p.t -= dt; p.l += p.dirL * p.v * dt * 0.6;
        if (p.t <= 0) p.dead = true;
      }
      this.posPed(p);
      if (P && Math.hypot(p.x - P.x, p.z - P.z) > 260) p.dead = true;
    }
    for (const p of this.peds) if (p.dead) this.scene.remove(p.obj);
    this.peds = this.peds.filter(p => !p.dead);
  }
}

// aucun véhicule de l'anneau n'arrive (en amont, angle croissant) vers l'angle d'entrée thIn ?
export function roundClear(B, thIn, bodies, self) {
  for (const b of bodies) {
    if (self && b.ai === self) continue;
    const rx = b.x - B.x, rz = b.z - B.z, rr = Math.hypot(rx, rz);
    if (rr < RI || rr > RO + 0.3) continue;
    let dth = Math.atan2(rz, rx) - thIn; dth = ((dth % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (dth < 1.5 && (Math.abs(b.v) > 0.8 || dth < 0.55)) return false;
  }
  return true;
}
