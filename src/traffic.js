// Circulation : voitures IA qui suivent les voies, respectent feux / stops / cédez / priorité à droite,
// gardent leurs distances (IDM) ; piétons qui traversent aux passages cloutés.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { N, SP, RW, LO, nodeX, DIRS, dirOf, turnOf, turnDir } from './city.js';
import { loadCarTemplate, makeCar, poseCar, carLOD, MODELS, PAINTS } from './car.js';
import { glb } from './assets.js';

const rightOf = (d) => ({ x: -d.dz, z: d.dx });
function rand(a, b) { return a + Math.random() * (b - a); }

export class Traffic {
  constructor(scene, city) { this.scene = scene; this.city = city; this.cars = []; this.peds = []; this.player = null; }

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
      const s = rand(8, SP - 2 * RW - 20);
      const key = from.i + ',' + from.j + axisDir.k;
      if (taken.some(t => t.key === key && Math.abs(t.s - s) < 14)) continue;
      const tpl = tpls[Math.floor(Math.random() * tpls.length)];
      const car = makeCar(tpl, PAINTS[Math.floor(Math.random() * PAINTS.length)]);
      const a = { car, from, d: axisDir.k, s, v: 6, phase: 'seg', len: tpl.size.z, half: tpl.size.x / 2, pace: rand(0.85, 1.04), wait: 0, cleared: false, stopped: 0, spin: 0 };
      this.planNext(a);
      this.place(a);
      if (avoid && Math.hypot(a.x - avoid.x, a.z - avoid.z) < 45) { continue; }
      taken.push({ key, s });
      this.scene.add(car.obj); this.cars.push(a);
    }
    await this.initPeds();
  }

  segLen() { return SP - 2 * RW; }
  toNode(a) { const d = dirOf(a.d); return this.city.node(a.from.i + d.dx, a.from.j + d.dz); }
  planNext(a) {
    const B = this.toNode(a);
    const opts = [];
    for (const t of ['straight', 'straight', 'left', 'right']) { const nd = dirOf(turnDir(a.d, t)); if (this.city.node(B.i + nd.dx, B.j + nd.dz)) opts.push(t); }
    a.turn = opts.length ? opts[Math.floor(Math.random() * opts.length)] : 'uturn';
    a.nd = a.turn === 'uturn' ? DIRS.find(x => { const D = dirOf(a.d); return x.dx === -D.dx && x.dz === -D.dz; }).k : turnDir(a.d, a.turn);
    a.cleared = false; a.wait = 0; a.stopped = 0;
  }
  // point de voie (droite) à la distance s depuis la sortie du nœud `from`
  lanePoint(n, dk, s) {
    const d = dirOf(dk), r = rightOf(d);
    return { x: n.x + d.dx * (RW + s) + r.x * LO, z: n.z + d.dz * (RW + s) + r.z * LO };
  }
  buildTurn(a) {
    const B = this.toNode(a), d = dirOf(a.d), r = rightOf(d), d2 = dirOf(a.nd), r2 = rightOf(d2);
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
      const p = this.lanePoint(a.from, a.d, a.s); x = p.x; z = p.z; const d = dirOf(a.d); yaw = Math.atan2(d.dx, d.dz);
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
      if (a.phase === 'turn') v0 = a.turn === 'straight' ? 9 : 5.2;
      // approche du carrefour avec pré-ralentissement si on tourne
      let stopGap = Infinity;
      a.waiting = false;
      if (a.phase === 'seg') {
        const L = this.segLen(), B = this.toNode(a);
        const remain = L - a.s;
        if (a.turn !== 'straight' && remain < 30) v0 = Math.min(v0, 5.2 + remain * 0.25);
        const axis = dirOf(a.d).dx ? 'x' : 'z';
        const sd = city.stopDist(B, a.d) - RW; // ligne d'arrêt à `sd` avant la fin du segment
        const toLine = remain - sd;
        // piétons sur le passage d'approche ou de sortie
        if (this.pedBlocking(B, a.d, a.nd)) stopGap = Math.min(stopGap, Math.max(0.1, toLine - 0.3));
        if (!a.cleared && toLine < 45) {
          const ctl = city.controlFor(B, axis);
          let go = true;
          if (ctl === 'light') {
            const st = city.lightState(B, axis);
            if (st === 'R') go = false;
            else if (st === 'O') go = toLine < a.v * a.v / 6 + 1;
          } else if (ctl === 'stop') {
            if (a.stopped < 1.0) go = false;
            if (toLine < 1.6 && Math.abs(a.v) < 0.25) a.stopped += dt;
            if (a.stopped >= 1.0) go = this.clearFor(a, B, axis, 'minor', bodies);
          } else if (ctl === 'yield') {
            if (toLine < 12) go = this.clearFor(a, B, axis, 'minor', bodies);
          } else if (ctl === 'right') {
            if (toLine < 14) go = this.clearFor(a, B, axis, 'right', bodies);
          }
          if (go && toLine < 10 && this.boxBusy(B, bodies, a) && ctl !== 'major') go = false;
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
        if (gap < lead) { lead = gap; leadV = b.v * Math.max(0, bf); }
      }
      for (const p of this.peds) { // piétons devant (sécurité)
        if (!p.onRoad) continue;
        const rx = p.x - a.x, rz = p.z - a.z, f = rx * fx + rz * fz; if (f <= 0 || f > 20) continue;
        if (Math.abs(rx * fz - rz * fx) < 1.8) { const gap = f - a.len / 2 - 0.6; if (gap < lead) { lead = gap; leadV = 0; } }
      }
      // IDM
      const amax = 1.6, bc = 2.4, T = 1.3, s0 = 2.2;
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
      if (a.phase === 'seg' && a.s >= this.segLen()) {
        a.s -= this.segLen(); a.phase = 'turn'; this.buildTurn(a);
      } else if (a.phase === 'turn' && a.s >= a.turnLen) {
        a.s -= a.turnLen; a.from = a.node; a.d = a.nd; a.phase = 'seg'; this.planNext(a);
      }
      this.place(a);
      a.spin += a.v / 0.31 * dt;
      const blinking = a.turn !== 'straight' && (a.phase === 'turn' || this.segLen() - a.s < 35);
      poseCar(a.car, { spin: a.spin, steer: a.phase === 'turn' && a.turn !== 'straight' ? (a.turn === 'left' ? 0.45 : -0.45) : 0, brake: a.braking, blink: blinking && (performance.now() % 760 < 380) ? 4 : 0 });
      if (playerBody) carLOD(a.car, Math.hypot(a.x - playerBody.x, a.z - playerBody.z));
    }
    this.updatePeds(dt, bodies);
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
