// Voitures : préparation des modèles détaillés (roues pivotantes, peinture vernie, vitres, feux)
// et physique simple de voiture à boîte automatique (modèle bicyclette).
import * as THREE from 'three';
import { glb } from './assets.js';

export const MODELS = {
  ace11: { file: 'ace11', length: 4.05 },
  milano95: { file: 'milano95', length: 4.6 },
  sigil07: { file: 'sigil07', length: 4.85 },
  asti89: { file: 'asti89', length: 4.3 },
  fairheaven80: { file: 'fairheaven80', length: 5.3 },
};
export const PAINTS = ['#f2f2f0', '#101114', '#7d8790', '#1d3c78', '#8a1c1c', '#2f5a3d', '#c9b48a', '#5a5f66', '#2a6f8f', '#d9d4c8', '#3b3f45'];

const templates = new Map();
export function loadCarTemplate(id) {
  if (templates.has(id)) return templates.get(id);
  const spec = MODELS[id];
  const p = (async () => {
    const g = await glb('assets/cars/' + spec.file + '.glb');
    const src = g.scene; src.updateMatrixWorld(true);
    const center = (re) => { const b = new THREE.Box3(); src.traverse(o => { if (o.isMesh && re.test(o.name)) b.expandByObject(o); }); return b.isEmpty() ? null : b.getCenter(new THREE.Vector3()); };
    const front = center(/Headlights(?!_Glass)/i), rear = center(/Brakelights/i) || center(/Taillights/i);
    const wrap = new THREE.Group(); wrap.add(src);
    if (front && rear) { const d = front.clone().sub(rear); d.y = 0; d.normalize(); wrap.rotation.y = -Math.atan2(d.x, d.z); }
    wrap.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(wrap);
    wrap.scale.setScalar(spec.length / (box.max.z - box.min.z)); wrap.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(wrap);
    const c = box.getCenter(new THREE.Vector3());
    const root = new THREE.Group();
    wrap.position.set(-c.x, -box.min.y, -c.z);
    root.add(wrap); root.updateMatrixWorld(true);
    const wheels = {};
    const meshes = []; src.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      const mm = /Wheel\w*_(FL|FR|RL|RR)/i.exec(m.name) || /Wheel\w*_(FL|FR|RL|RR)/i.exec(m.parent && m.parent.name || '');
      if (!mm) continue;
      const k = mm[1].toUpperCase();
      const wb = new THREE.Box3().setFromObject(m); const wc = wb.getCenter(new THREE.Vector3());
      const steer = new THREE.Group(); steer.position.copy(wc); steer.userData.wheel = k; root.add(steer);
      const spin = new THREE.Group(); steer.add(spin); root.updateMatrixWorld(true); spin.attach(m);
      wheels[k] = { radius: (wb.max.y - wb.min.y) / 2, pos: wc.clone() };
    }
    const wl0 = Object.values(wheels);
    if (wl0.length) {
      const lowest = Math.min(...wl0.map(w => w.pos.y - w.radius));
      if (Math.abs(lowest) > 0.03) { for (const ch of root.children) ch.position.y -= lowest; for (const w of wl0) w.pos.y -= lowest; root.updateMatrixWorld(true); }
    }
    // volant : centre et axe déduits de la géométrie (plan de la jante = plus petite variance), côté conducteur (x > 0)
    for (const m of meshes) if (/Steering/i.test(m.name)) {
      const pos = m.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
      const step = Math.max(1, Math.floor(pos.count / 2000));
      for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); pts.push(v.clone()); }
      const drv = pts.filter(p => p.x > 0.05); const P = drv.length > 30 ? drv : pts;
      const c = P.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / P.length);
      const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (const p of P) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k] += d[r] * d[k]; }
      const tr = C[0] + C[4] + C[8];
      const Mx = new THREE.Matrix3().set(tr - C[0], -C[1], -C[2], -C[3], tr - C[4], -C[5], -C[6], -C[7], tr - C[8]);
      let ax = new THREE.Vector3(0.1, 0.3, 1);
      for (let it = 0; it < 40; it++) ax.applyMatrix3(Mx).normalize();
      if (ax.z < 0) ax.negate();
      let rad = 0; for (const p of P) rad = Math.max(rad, p.clone().sub(c).projectOnPlane(ax).length());
      const piv = new THREE.Group(); piv.position.copy(c); piv.userData.isSteering = true; piv.userData.axis = ax.toArray(); piv.userData.radius = rad;
      root.add(piv); root.updateMatrixWorld(true); piv.attach(m);
      break;
    }
    for (const m of meshes) {
      const mat = m.material; if (!mat) continue;
      const n = m.name + ' ' + (m.parent ? m.parent.name : '');
      if (/Bodymat/i.test(mat.name)) m.userData.paint = true;
      if (/Transp/i.test(mat.name)) m.userData.glass = true;
      if (/Head_?lights?/i.test(n) && !/Glass/i.test(n)) m.userData.light = 'head';
      else if (/Brakelights/i.test(n)) m.userData.light = 'brake';
      else if (/Reverse/i.test(n)) m.userData.light = 'reverse';
      else if (/Blinkers/i.test(n)) m.userData.light = 'blink';
      if (/Interior/i.test(n)) m.userData.interior = true;
      if (/Steering/i.test(n)) m.userData.steering = true;
      if (/Glass_Driver|Glass_Passenger|Windshield/i.test(n)) m.userData.cabinGlass = true;
      m.castShadow = true; m.receiveShadow = true;
      if (/Interior|Badges|Numberplates|Suspension|Bottom|Reverse|Blinkers|Steering/i.test(n)) m.userData.detail = true;
    }
    root.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      if (o.userData.paint) {
        o.material = new THREE.MeshPhysicalMaterial({ map: m.map, normalMap: m.normalMap, color: 0xffffff, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 });
        o.material.name = 'paint';
      } else if (o.userData.glass) {
        o.material = new THREE.MeshPhysicalMaterial({ color: 0x0c1014, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.35, envMapIntensity: 1.5, depthWrite: false });
        o.material.name = 'glass'; o.castShadow = false;
      } else if (m) m.envMapIntensity = 1.0;
    });
    const bb = new THREE.Box3().setFromObject(root);
    return { id, spec, root, size: bb.getSize(new THREE.Vector3()), wheels,
      wheelbase: wheels.FL && wheels.RL ? wheels.FL.pos.z - wheels.RL.pos.z : spec.length * 0.6,
      wheelR: wheels.FL ? wheels.FL.radius : 0.31 };
  })();
  templates.set(id, p);
  return p;
}

export function makeCar(tpl, paint, { player = false } = {}) {
  const root = tpl.root.clone(true);
  const car = { tpl, obj: root, wheels: {}, lights: { head: [], brake: [], reverse: [], blink: [] }, details: [] };
  let pm = null;
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.material && o.material.name === 'paint') { if (!pm) { pm = o.material.clone(); pm.color.set(paint); } o.material = pm; }
    if (player && o.material && o.material.name === 'glass') { // vitres de la voiture du joueur : quasi transparentes vues de l'intérieur
      o.material = o.material.clone(); o.material.opacity = 0.12; o.material.color.set(0x8899aa);
    }
    const l = o.userData.light;
    if (l) {
      o.material = o.material.clone();
      o.material.emissive = new THREE.Color(l === 'brake' ? 0xff1a0a : l === 'blink' ? 0xff8a10 : 0xfff4e0);
      o.material.emissiveIntensity = 0;
      car.lights[l].push(o.material);
    }
    if (o.userData.detail) car.details.push(o);
    if (player && (o.userData.interior || o.userData.steering)) o.visible = false; // habitacle remplacé par interior.js
    if (player && o.material && o.material.name === 'glass') o.material.side = THREE.DoubleSide;
  });
  root.traverse(o => { if (o.userData.wheel) car.wheels[o.userData.wheel] = { steer: o, spin: o.children[0] }; if (o.userData.isSteering && !player) car.steeringWheel = o; });
  car.paint = pm; car.lod = 0;
  return car;
}

export function carLOD(car, dist) {
  const lod = dist > 50 ? 1 : 0;
  if (lod === car.lod) return; car.lod = lod;
  for (const m of car.details) m.visible = !lod;
  car.obj.traverse(o => { if (o.isMesh) o.castShadow = !lod; });
}

export function poseCar(car, { spin = 0, steer = 0, brake = false, reverse = false, blink = 0, wheelAngle }) {
  for (const k in car.wheels) { const w = car.wheels[k]; w.spin.rotation.x = spin; if (k[0] === 'F') w.steer.rotation.y = steer; }
  for (const m of car.lights.brake) m.emissiveIntensity = brake ? 5 : 0.25;
  for (const m of car.lights.reverse) m.emissiveIntensity = reverse ? 3 : 0;
  for (const m of car.lights.blink) m.emissiveIntensity = blink;
  for (const m of car.lights.head) m.emissiveIntensity = 0.6;
  if (car.steeringWheel && wheelAngle !== undefined) { SW.fromArray(car.steeringWheel.userData.axis); car.steeringWheel.quaternion.setFromAxisAngle(SW, -wheelAngle); }
}
const SW = new THREE.Vector3();

// ---------- physique de la voiture du joueur ----------
export const WHEEL_RATIO = 15;       // démultiplication de direction
export const WHEEL_MAX = 7.6;        // angle volant max (rad) ≈ 435°
export class Physics {
  constructor(car) {
    this.car = car;
    this.L = car.tpl.wheelbase || 2.5;
    this.x = 0; this.z = 0; this.yaw = 0;   // yaw : 0 = avant vers +z
    this.v = 0; this.steer = 0; this.wheelAngle = 0;
    this.gear = 'P'; this.rpm = 800; this.spin = 0;
    this.pitch = 0; this.roll = 0; this.accel = 0;
  }
  forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  // ctl : { throttle 0..1, brake 0..1, wheel (angle volant rad) }
  step(dt, ctl) {
    this.wheelAngle = THREE.MathUtils.clamp(ctl.wheel, -WHEEL_MAX, WHEEL_MAX);
    this.steer = this.wheelAngle / WHEEL_RATIO;
    const v = this.v;
    let a = 0;
    const thr = ctl.throttle, brk = ctl.brake;
    if (this.gear === 'D' || this.gear === 'R') {
      const sgn = this.gear === 'D' ? 1 : -1;
      const top = this.gear === 'D' ? 46 : 6;
      const sp = v * sgn;
      // traction (couple qui baisse avec la vitesse) + rampage au ralenti (≈ 6 km/h)
      let drive = thr * 3.4 * Math.max(0, 1 - sp / top) * (sp < 8 ? 1 : 8 / sp * 0.6 + 0.4);
      if (thr < 0.02 && brk < 0.02 && sp < 1.7) drive += (1.7 - sp) * 1.2;
      a += drive * sgn;
    }
    // freins, résistance au roulement, traînée
    const decel = brk * 8.5 + 0.18 + 0.0009 * v * v + (this.gear === 'P' ? 12 : 0) + ((this.gear === 'D' || this.gear === 'R') && thr < 0.02 ? 0.35 : 0);
    if (Math.abs(this.v) < 0.05 && Math.abs(a) < decel) { this.v = 0; a = 0; }
    else { a -= Math.sign(this.v || a) * decel; }
    const nv = this.v + a * dt;
    if (this.v !== 0 && Math.sign(nv) !== Math.sign(this.v) && Math.abs(a) > 0 && (brk > 0.02 || this.gear === 'P' || (this.gear === 'D' && this.v < 0) || (this.gear === 'R' && this.v > 0))) this.v = 0; else this.v = nv;
    this.accel += ((a) - this.accel) * Math.min(1, dt * 4);
    // cinématique : yaw = v·tan(braquage)/L, avec perte d'adhérence douce à haute vitesse
    const grip = 1 / (1 + this.v * this.v / 900);
    this.yaw += this.v * Math.tan(this.steer) / this.L * grip * dt;
    this.x += Math.sin(this.yaw) * this.v * dt;
    this.z += Math.cos(this.yaw) * this.v * dt;
    // boîte auto simulée : régime
    const kmh = Math.abs(this.v) * 3.6;
    const gears = [0, 22, 40, 60, 85, 115, 999];
    let g = 1; while (kmh > gears[g]) g++;
    const lo = gears[g - 1], hi = Math.min(gears[g], 140);
    const target = this.gear === 'P' || this.gear === 'N' ? 800 + thr * 2500 : 900 + (kmh - lo) / (hi - lo) * 2600 + thr * 700;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 6);
    this.spin += this.v / (this.car.tpl.wheelR || 0.31) * dt;
    // tangage / roulis (confort visuel : faibles)
    this.pitch += (-this.accel * 0.006 - this.pitch) * Math.min(1, dt * 5);
    const lat = this.v * this.v * Math.tan(this.steer) / this.L;
    this.roll += (THREE.MathUtils.clamp(lat * 0.004, -0.03, 0.03) - this.roll) * Math.min(1, dt * 5);
  }
  apply() {
    const o = this.car.obj;
    o.position.set(this.x, 0, this.z);
    o.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    poseCar(this.car, { spin: this.spin, steer: this.steer, brake: this.brakeLight, reverse: this.gear === 'R', blink: this.blinkOn ? 4 : 0, wheelAngle: this.wheelAngle });
  }
  // coins du véhicule (monde), marge optionnelle
  corners(m = 0) {
    const s = this.car.tpl.size, hx = s.x / 2 - 0.05 + m, hz = s.z / 2 - 0.05 + m;
    const c = Math.cos(this.yaw), si = Math.sin(this.yaw);
    return [[hx, hz], [-hx, hz], [hx, -hz], [-hx, -hz], [0, hz], [0, -hz]].map(([lx, lz]) => [this.x + lx * c + lz * si, this.z - lx * si + lz * c]);
  }
}
