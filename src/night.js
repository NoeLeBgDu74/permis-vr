// Nuit : ciel nocturne, lune, ville éclairée (halos des lampadaires au sol, fenêtres allumées),
// phares du véhicule du joueur (croisement / route) et feux des autres véhicules.
import * as THREE from 'three';
import { hdr } from './assets.js';
import { CURB } from './city.js';

export const NIGHT = { on: false };

export async function applyNight(renderer, scene, env, city) {
  NIGHT.on = true;
  const tex = await hdr('assets/hdri/qwantani_night_puresky_2k.hdr');
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex).texture; pm.dispose();
  scene.background = tex; scene.backgroundIntensity = 0.22; scene.environmentIntensity = 0.12;
  renderer.toneMappingExposure = 0.85;
  scene.fog.color.set(0x0a0f1a); scene.fog.near = 60; scene.fog.far = 700;
  env.sun.color.set(0x9fb4ff); env.sun.intensity = 0.12;             // clair de lune
  const amb = new THREE.HemisphereLight(0x2a3656, 0x0a0a0a, 0.12); scene.add(amb);
  // halos de lampadaires : flaque de lumière chaude au sol + ampoule
  const pool = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,200,130,0.85)'); gr.addColorStop(0.45, 'rgba(255,180,110,0.35)'); gr.addColorStop(1, 'rgba(255,170,100,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; })());
  const lamps = city.lampPlaces || [];
  const pg = new THREE.PlaneGeometry(13, 13); pg.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }), lamps.length);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false }), lamps.length);
  const m4 = new THREE.Matrix4();
  lamps.forEach((l, i) => { m4.makeTranslation(l.hx, 0.06, l.hz); pools.setMatrixAt(i, m4); m4.makeTranslation(l.hx, CURB + 6.1, l.hz); bulbs.setMatrixAt(i, m4); });
  pools.renderOrder = 2; scene.add(pools, bulbs);
  // fenêtres allumées (une sur trois environ), légèrement devant la vitre
  const wl = (city.windowList || []).filter((w, k) => (k * 2654435761 >>> 0) % 7 < 2);
  const wg = new THREE.PlaneGeometry(1.25, 1.6);
  const lit = new THREE.InstancedMesh(wg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), wl.length);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  wl.forEach((w, k) => {
    e.set(0, Math.atan2(w.n[0], w.n[1]), 0); q.setFromEuler(e);
    const s = w.s || 1;
    m4.compose(new THREE.Vector3(w.x + w.n[0] * 0.02, w.y + (w.door ? 0.25 : 0), w.z + w.n[1] * 0.02), q, new THREE.Vector3(s, (w.door ? 1.35 : 1) * s, 1));
    lit.setMatrixAt(k, m4);
    col.setHSL(0.1 + Math.random() * 0.04, 0.7, 0.45 + Math.random() * 0.25); lit.setColorAt(k, col);
  });
  scene.add(lit);
  // signalisation lumineuse plus visible
  for (const m of city.lightMats.values()) m.toneMapped = false;
}

// Phares du joueur : deux projecteurs + lumière des optiques
export class Headlights {
  constructor(car) {
    this.car = car; this.mode = 0; // 0 éteints, 1 croisement, 2 route
    const s = car.tpl.size, front = s.z / 2 - 0.1, hx = Math.max(0.35, s.x / 2 - 0.35), y = car.kind === 'moto' ? 0.95 : car.kind ? 0.95 : 0.7;
    this.spots = [];
    const xs = car.kind === 'moto' ? [0] : [hx, -hx];
    for (const x of xs) {
      const L = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.55, 1.4);
      L.position.set(x, y, front); L.target.position.set(x * 0.6, 0, front + 22);
      car.obj.add(L, L.target); this.spots.push(L);
    }
  }
  set(mode) {
    this.mode = mode;
    for (const L of this.spots) {
      L.intensity = mode === 0 ? 0 : (mode === 1 ? 60 : 110) * (this.spots.length === 1 ? 1.6 : 1);
      L.distance = mode === 2 ? 140 : 70; L.angle = mode === 2 ? 0.5 : 0.42;
      L.target.position.z = this.car.tpl.size.z / 2 + (mode === 2 ? 45 : 20); L.target.position.y = mode === 2 ? 0.8 : 0;
    }
    for (const m of this.car.lights.head) m.emissiveIntensity = mode ? 5 : 0.3;
  }
  cycle() { this.set((this.mode + 1) % 3); return this.mode; }
}
