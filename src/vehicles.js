// Véhicules d'auto-école supplémentaires, construits sur mesure : porteur 19 t (permis C), autobus 12 m (permis D),
// moto roadster (permis A). Chacun fournit : carrosserie PBR, roues (jumelées à l'arrière pour les poids lourds), feux,
// poste de conduite complet (volant ou guidon saisissable, levier, frein à main), disposition des yeux / écrans / rétros
// pour le cockpit, réglages de physique. Repère : avant = +z, gauche (conducteur) = +x, sol = y 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { interiorMaterials } from './interior.js';

const rbx = (w, h, d, r = 0.03, s = 3) => new RoundedBoxGeometry(w, h, d, s, Math.max(0.001, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

function exteriorMats(paint) {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 }),
    white: new THREE.MeshPhysicalMaterial({ color: 0xf1f1ed, metalness: 0.15, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.1 }),
    dark: std(0x1c1d20, 0.6, 0.25), black: std(0x0b0b0c, 0.45, 0.2), chassis: std(0x232426, 0.7, 0.5),
    chrome: std(0xdde1e6, 0.16, 1), alu: std(0xb6bbc1, 0.32, 0.9), rubber: std(0x111112, 0.9, 0),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x1d2a36, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 }),
    tire: std(0x151515, 0.88, 0), rim: std(0xc2c6cb, 0.28, 0.92), rimDark: std(0x3a3d42, 0.4, 0.8),
    yellow: std(0xf2c12e, 0.5, 0.2), orangeLed: new THREE.MeshBasicMaterial({ color: 0xff8a20 }),
  };
}
function lightMat(kind) {
  const col = kind === 'brake' ? 0xff1a0a : kind === 'blink' ? 0xff8a10 : 0xfff4e0;
  return new THREE.MeshStandardMaterial({ color: kind === 'brake' ? 0x5a0a08 : kind === 'blink' ? 0x6a3a08 : 0xdedede, roughness: 0.15, metalness: 0.1, emissive: col, emissiveIntensity: 0 });
}
function add(parent, geo, mat, pos, rot, shadow = true) {
  const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot);
  m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
}
// roue : pneu à flancs arrondis (tour), jante, moyeu ; jumelée si dual
function wheel(R, W, M, dual = false) {
  const g = new THREE.Group();
  const prof = []; const r0 = R * 0.6;
  prof.push(new THREE.Vector2(r0, -W / 2), new THREE.Vector2(R * 0.93, -W / 2), new THREE.Vector2(R, -W / 2 + W * 0.18), new THREE.Vector2(R, W / 2 - W * 0.18), new THREE.Vector2(R * 0.93, W / 2), new THREE.Vector2(r0, W / 2));
  const tire = new THREE.LatheGeometry(prof, 36); tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(r0, r0, W * 0.86, 28); rim.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(R * 0.18, R * 0.22, W * 0.92, 16); hub.rotateZ(Math.PI / 2);
  const offs = dual ? [-W * 0.52, W * 0.52] : [0];
  for (const o of offs) {
    add(g, tire, M.tire, [o, 0, 0]); add(g, rim, M.rim, [o, 0, 0]); add(g, hub, M.rimDark, [o, 0, 0]);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; add(g, new THREE.BoxGeometry(W * 0.9, 0.02, R * 0.08), M.rimDark, [o, Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4], [a, 0, 0], false); }
  }
  return g;
}
function addWheel(car, key, x, R, z, W, M, dual) {
  const steer = new THREE.Group(); steer.position.set(x, R, z); steer.userData.wheel = key;
  const spin = new THREE.Group(); steer.add(spin); spin.add(wheel(R, W, M, dual));
  car.body.add(steer); car.wheels[key] = { steer, spin };
}
// volant générique : pivot (rotation pilotée) → tilt (orientation) → jante cuir + 3 branches + moyeu
function steering(parent, pos, axis, R, IM) {
  const pivot = new THREE.Group(); pivot.position.copy(pos); pivot.userData.isSteering = true; pivot.userData.axis = axis.toArray(); pivot.userData.radius = R;
  const tilt = new THREE.Group(); tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis); pivot.add(tilt);
  add(tilt, new THREE.TorusGeometry(R, R * 0.1, 18, 80), IM.leather, null, null, false);
  for (const a of [Math.PI, 0, -Math.PI / 2]) { const sp = add(tilt, rbx(R * 0.8, R * 0.22, R * 0.1, 0.01), IM.leather, [Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, R * 0.05], [0, 0, a], false); void sp; }
  add(tilt, rbx(R * 0.7, R * 0.55, R * 0.3, R * 0.15, 4), IM.leather, [0, -R * 0.04, R * 0.1], null, false);
  add(tilt, new THREE.TorusGeometry(R * 0.09, R * 0.02, 10, 30), IM.alu, [0, 0, -R * 0.06], null, false);
  parent.add(pivot);
  // colonne
  const col = add(parent, new THREE.CylinderGeometry(0.05, 0.06, 0.45, 16), IM.dash, null, null, false);
  col.position.copy(pos).addScaledVector(axis, 0.24); col.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  return pivot;
}
function seat(parent, x, y0, z, IM, w = 0.54) {
  const g = new THREE.Group(); g.position.set(x, y0, z); parent.add(g);
  add(g, new THREE.CylinderGeometry(0.09, 0.12, 0.3, 14), IM.dash, [0, 0.15, 0], null, false);           // pied suspendu
  add(g, rbx(w, 0.13, 0.52, 0.05, 4), IM.fabric, [0, 0.36, 0], [-0.1, 0, 0], false);
  add(g, rbx(0.3, 0.03, 0.44, 0.012), IM.insert, [0, 0.43, 0], [-0.1, 0, 0], false);
  const b = new THREE.Group(); b.position.set(0, 0.42, -0.28); b.rotation.x = -0.2; g.add(b);
  add(b, rbx(w, 0.7, 0.14, 0.05, 4), IM.fabric, [0, 0.35, 0], null, false);
  add(b, rbx(0.3, 0.52, 0.03, 0.012), IM.insert, [0, 0.33, 0.065], null, false);
  for (const sx of [-1, 1]) add(b, rbx(0.1, 0.6, 0.13, 0.045, 4), IM.fabric, [sx * (w / 2 - 0.04), 0.32, 0.05], [0, -sx * 0.35, 0], false);
  add(b, rbx(0.28, 0.2, 0.11, 0.05, 4), IM.fabric, [0, 0.86, 0.01], null, false);
  return g;
}
// levier de vitesses et frein à main saisissables (API identique à interior.js)
function controls(api, parent, leverPos, hbPos, IM, M) {
  const lever = new THREE.Group(); lever.position.set(...leverPos); parent.add(lever);
  add(lever, rbx(0.07, 0.014, 0.16, 0.006), IM.rubber, [0, 0.005, 0], null, false);
  const stick = new THREE.Group(); lever.add(stick);
  add(stick, new THREE.CylinderGeometry(0.01, 0.012, 0.12, 12), IM.alu, [0, 0.06, 0], null, false);
  add(stick, rbx(0.045, 0.07, 0.055, 0.02, 4), IM.leather, [0, 0.14, 0], null, false);
  api.gearStick = stick;
  const hb = new THREE.Group(); hb.position.set(...hbPos); parent.add(hb);
  add(hb, rbx(0.05, 0.03, 0.08, 0.01), IM.dash, null, null, false);
  const knob = add(hb, rbx(0.045, 0.05, 0.045, 0.015), M.yellow, [0, 0.03, 0], null, false);
  api.hb = { rotation: { x: 0.18 } }; api.hbKnob = knob;
  api.leverKnob = () => new THREE.Vector3(leverPos[0], leverPos[1] + 0.14, leverPos[2] + api.gearStick.position.z);
  api.hbHandle = () => new THREE.Vector3(hbPos[0], hbPos[1] + 0.03 + (api.hbOn ? 0.03 : 0), hbPos[2]);
  api.update = (st) => {
    api.hbOn = st.handbrake; knob.position.y = st.handbrake ? 0.06 : 0.03;
    api.gearStick.position.z = st.leverZ !== undefined ? st.leverZ : ({ P: 0.045, R: 0.015, N: -0.015, D: -0.045 }[st.gear] || 0);
    if (api.extraUpdate) api.extraUpdate(st);
  };
}
function decalTex(lines, bg, fg, w = 1024, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [t, size, y, col] of lines) { g.fillStyle = col || fg; g.font = `900 ${size}px Arial`; g.fillText(t, w / 2, y); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function decal(parent, tex, w, h, pos, yaw) {
  const m = add(parent, new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }), pos, [0, yaw, 0], false);
  return m;
}
function newCar(kind, size, wheelbase, wheelR, spec, layout) {
  const obj = new THREE.Group(); const body = new THREE.Group(); obj.add(body);
  return { kind, obj, body, wheels: {}, lights: { head: [], brake: [], reverse: [], blink: [] }, details: [], lod: 0, spec, layout,
    tpl: { id: kind, spec, size, wheelbase, wheelR } };
}
function lamp(car, kind, geo, pos) { const m = lightMat(kind); car.lights[kind].push(m); return add(car.body, geo, m, pos, null, false); }

// =====================================================================
// PORTEUR 19 t — permis C
// =====================================================================
export function buildTruck({ interior = true } = {}) {
  const L = 9.4, W = 2.5, F = L / 2;
  const tiltWS = 0.17;
  const layout = {
    eye: new THREE.Vector3(0.62, 2.5, 3.18),
    screen: { pos: [0.0, 2.26, 4.12], rot: [0.32, -0.45], scale: 1.1 },
    cluster: { pos: [0.62, 2.17, 4.0], rotX: -0.35, scale: 1.1 },
    hud: { pos: [0.62, 2.27, 4.47], tilt: tiltWS, w: 0.36, h: 0.09 },
    mirrors: [
      ['left', 0.12, 0.42, [1.42, 2.42, 4.13], [0, 0.33], -0.48, 26, [200, 480]],
      ['right', 0.12, 0.42, [-1.42, 2.42, 4.13], [0, -0.55], 0.7, 26, [200, 480]],
    ],
    windshield: { pos: [0, 1.98, 4.6], tilt: tiltWS, W: 2.3, H: 1.05, wipers: [[-0.75, 0.95], [0.45, 0.95]] },
    passenger: { hips: [-0.62, 1.84, 3.08], board: [-0.62, 1.98, 3.42] },
    wheelMax: 11.7,
  };
  const spec = { accelK: 0.42, vmax: 25.0, ratio: 18, wheelMax: 11.7, brakeK: 0.72 };
  const car = newCar('truck', new THREE.Vector3(W, 3.6, L), 5.3, 0.5, spec, layout);
  const M = exteriorMats(0xb3141f), B = car.body;
  const cabZ0 = 2.45, cabZ1 = F - 0.06, floor = 1.25, roof = 3.25, belt = 2.15;
  const cz = (cabZ0 + cabZ1) / 2, cl = cabZ1 - cabZ0;
  // ---- cabine (peinture rouge auto-école) ----
  for (const sx of [-1, 1]) add(B, rbx(0.08, belt - 0.9, cl, 0.03), M.paint, [sx * (W / 2 - 0.04), (belt + 0.9) / 2, cz]); // portes (cabine creuse)
  add(B, rbx(W - 0.02, 0.24, cl, 0.08), M.paint, [0, roof, cz]);                             // pavillon
  add(B, rbx(W - 0.1, 0.4, 0.5, 0.15), M.paint, [0, roof + 0.3, cz - 0.3]);                  // déflecteur de toit
  add(B, rbx(W, roof - belt, 0.1, 0.03), M.paint, [0, (roof + belt) / 2, cabZ0 + 0.05]);       // paroi arrière
  for (const sx of [-1, 1]) {
    add(B, rbx(0.1, roof - belt, 0.12, 0.03), M.paint, [sx * (W / 2 - 0.05), (roof + belt) / 2, cabZ1 - 0.08], [-tiltWS, 0, 0]); // montant A
    add(B, rbx(0.1, roof - belt, 0.14, 0.03), M.paint, [sx * (W / 2 - 0.05), (roof + belt) / 2, cabZ0 + 0.2]);                    // montant arrière
    add(B, new THREE.PlaneGeometry(cl - 0.4, roof - belt - 0.1), M.glass, [sx * (W / 2 - 0.03), (roof + belt) / 2, cz + 0.05], [0, Math.PI / 2, 0], false); // vitres latérales
    // rétroviseurs (bras + coque) — la glace est rendue par le cockpit
    add(B, new THREE.CylinderGeometry(0.025, 0.025, 0.4, 10), M.black, [sx * (W / 2 + 0.12), 2.75, cabZ1 - 0.25], [0, 0, Math.PI / 2]);
    add(B, rbx(0.14, 0.48, 0.2, 0.04), M.black, [sx * (W / 2 + 0.17), 2.42, cabZ1 - 0.4]);
    add(B, rbx(0.12, 0.2, 0.16, 0.03), M.black, [sx * (W / 2 + 0.17), 2.05, cabZ1 - 0.38]);   // grand-angle
    // marchepieds
    for (const y of [0.62, 1.0]) add(B, rbx(0.3, 0.05, 0.5, 0.02), M.alu, [sx * (W / 2 - 0.15), y, cabZ1 - 0.75]);
    add(B, rbx(0.06, 0.62, 0.06, 0.02), M.chrome, [sx * (W / 2 + 0.03), 2.4, cabZ0 + 0.35]); // poignée
  }
  // face avant : calandre, pare-chocs, phares, visière
  add(B, rbx(W, 0.95, 0.14, 0.05), M.paint, [0, 1.42, F - 0.08]);
  for (let k = 0; k < 5; k++) add(B, rbx(1.3, 0.05, 0.04, 0.01), M.chrome, [0, 1.15 + k * 0.13, F + 0.0]);
  add(B, rbx(W, 0.42, 0.32, 0.06), M.dark, [0, 0.82, F - 0.12]);
  add(B, rbx(W - 0.3, 0.2, 0.3, 0.05), M.paint, [0, roof + 0.02, cabZ1 + 0.08]);           // visière pare-soleil
  for (const sx of [-1, 1]) { lamp(car, 'head', rbx(0.42, 0.18, 0.06, 0.04), [sx * 0.9, 0.98, F + 0.04]); lamp(car, 'blink', rbx(0.12, 0.12, 0.06, 0.03), [sx * 1.16, 0.98, F + 0.04]); }
  add(B, new THREE.PlaneGeometry(W - 0.22, 1.02), M.glass, [0, 2.6, F - 0.12], [-tiltWS, 0, 0], false); // pare-brise
  decal(B, decalTex([['AUTO-ÉCOLE', 120, 128]], '#1d4ed8', '#fff', 1024, 256), 1.2, 0.3, [0, 1.95, F + 0.01], 0);
  // dessous de cabine + châssis
  add(B, rbx(W - 0.1, 0.45, cl - 0.1, 0.05), M.chassis, [0, 1.05, cz]);
  for (const sx of [-1, 1]) add(B, new THREE.BoxGeometry(0.12, 0.3, L - 0.4), M.chassis, [sx * 0.5, 0.88, -0.1]);
  add(B, new THREE.CylinderGeometry(0.32, 0.32, 1.2, 20), M.alu, [W / 2 - 0.35, 0.75, 0.9], [Math.PI / 2, 0, 0]);  // réservoir
  add(B, rbx(0.5, 0.45, 0.6, 0.04), M.chassis, [-(W / 2 - 0.35), 0.8, 0.9]);                                   // batteries
  // ---- caisse fourgon blanche ----
  const bz0 = cabZ0 - 0.12, bz1 = -F + 0.05, bl = bz0 - bz1;
  add(B, rbx(W, 2.55, bl, 0.05), M.white, [0, 2.45, (bz0 + bz1) / 2]);
  add(B, new THREE.BoxGeometry(W + 0.02, 0.12, bl), M.dark, [0, 1.12, (bz0 + bz1) / 2]);
  const dt = decalTex([['AUTO-ÉCOLE', 150, 90, '#1d4ed8'], ['FORMATION POIDS LOURDS · PERMIS C', 64, 200, '#c8102e']], null, '#1d4ed8');
  decal(B, dt, 5.4, 1.35, [W / 2 + 0.012, 2.5, (bz0 + bz1) / 2], Math.PI / 2);
  decal(B, dt, 5.4, 1.35, [-W / 2 - 0.012, 2.5, (bz0 + bz1) / 2], -Math.PI / 2);
  add(B, new THREE.BoxGeometry(0.02, 2.4, 0.04), M.alu, [0, 2.45, bz1 - 0.02]);       // jonction des portes arrière
  for (const sx of [-1, 1]) add(B, new THREE.BoxGeometry(0.04, 2.2, 0.04), M.chrome, [sx * 0.35, 2.4, bz1 - 0.03]);
  add(B, rbx(W - 0.2, 0.12, 0.12, 0.03), M.dark, [0, 0.55, -F + 0.2]);                // barre anti-encastrement
  for (const sx of [-1, 1]) { lamp(car, 'brake', rbx(0.34, 0.16, 0.05, 0.03), [sx * 0.95, 0.95, -F + 0.02]); lamp(car, 'blink', rbx(0.14, 0.16, 0.05, 0.03), [sx * 0.62, 0.95, -F + 0.02]); lamp(car, 'reverse', rbx(0.12, 0.1, 0.05, 0.02), [sx * 0.42, 0.95, -F + 0.02]); }
  // garde-boue + roues (essieu avant simple, arrière jumelé)
  const fz = 3.45, rz = fz - 5.3;
  for (const sx of [-1, 1]) {
    add(B, rbx(0.42, 0.06, 1.2, 0.03), M.black, [sx * (W / 2 - 0.2), 1.12, rz]);
    addWheel(car, sx > 0 ? 'FL' : 'FR', sx * (W / 2 - 0.22), 0.5, fz, 0.34, M, false);
    addWheel(car, sx > 0 ? 'RL' : 'RR', sx * (W / 2 - 0.35), 0.5, rz, 0.3, M, true);
  }
  if (interior) car.interior = truckCab(car, { W, floor, roof, belt, cabZ0, cabZ1, tiltWS });
  return car;
}
function truckCab(car, { W, floor, roof, belt, cabZ0, cabZ1, tiltWS }) {
  const IM = interiorMaterials(), M = exteriorMats(0xb3141f), R = new THREE.Group(); car.obj.add(R);
  const api = { root: R };
  const cz = (cabZ0 + cabZ1) / 2, cl = cabZ1 - cabZ0;
  add(R, new THREE.BoxGeometry(W - 0.12, 0.04, cl - 0.12), IM.carpet, [0, floor, cz], null, false);                // plancher
  add(R, rbx(0.7, 0.3, 1.1, 0.08), IM.carpet, [0, floor + 0.15, cz - 0.1], null, false);                        // tunnel moteur
  add(R, new THREE.BoxGeometry(W - 0.14, 0.03, cl - 0.15), IM.headliner, [0, roof - 0.13, cz], null, false);     // pavillon
  add(R, new THREE.BoxGeometry(W - 0.14, roof - floor - 0.2, 0.04), IM.trimLight, [0, (roof + floor) / 2, cabZ0 + 0.12], null, false); // paroi arrière
  for (const sx of [-1, 1]) {
    add(R, rbx(0.05, belt - floor, cl - 0.3, 0.02), IM.trim, [sx * (W / 2 - 0.1), (belt + floor) / 2, cz], null, false);   // contre-porte
    add(R, rbx(0.1, 0.06, 0.9, 0.025), IM.trim, [sx * (W / 2 - 0.16), floor + 0.62, cz + 0.2], null, false);              // accoudoir
    add(R, rbx(0.08, 0.06, cl - 0.3, 0.025), IM.dash, [sx * (W / 2 - 0.13), belt, cz], null, false);                      // seuil de vitre
    add(R, new THREE.CircleGeometry(0.08, 24), IM.grille, [sx * (W / 2 - 0.13), floor + 0.3, cz + 0.4], [0, -sx * Math.PI / 2, 0], false);
    add(R, rbx(0.08, roof - belt, 0.1, 0.03), IM.trimLight, [sx * (W / 2 - 0.12), (roof + belt) / 2, cabZ1 - 0.15], [-tiltWS, 0, 0], false);
  }
  // planche de bord enveloppante
  const dz = cabZ1 - 0.42;
  add(R, rbx(W - 0.2, 0.42, 0.52, 0.08), IM.dash, [0, floor + 0.62, dz], null, false);
  add(R, rbx(W - 0.24, 0.1, 0.6, 0.05), IM.dash, [0, floor + 0.86, dz + 0.04], [0.12, 0, 0], false);
  add(R, rbx(0.62, 0.36, 0.3, 0.06), IM.dash, [0.62, floor + 0.78, dz - 0.04], [-0.35, 0, 0], false);      // nacelle conducteur
  add(R, rbx(0.6, 0.4, 0.3, 0.05), IM.dash, [0.04, floor + 0.62, dz - 0.18], [-0.3, -0.35, 0], false);     // console centrale orientée
  add(R, rbx(1.4, 0.012, 0.012, 0.004), IM.alu, [0, floor + 0.55, dz - 0.27], null, false);
  for (const x of [-0.9, -0.45]) { const v = add(R, rbx(0.16, 0.08, 0.03, 0.012), IM.piano, [x, floor + 0.75, dz - 0.27], null, false); void v; }
  // volant presque à plat, sièges
  car.steeringWheel = steering(R, new THREE.Vector3(0.62, floor + 0.8, cabZ1 - 0.82), new THREE.Vector3(0, -0.82, 0.57).normalize(), 0.24, IM);
  api.wheelPivot = car.steeringWheel;
  seat(R, 0.62, floor, cabZ1 - 1.5, IM); seat(R, -0.62, floor, cabZ1 - 1.5, IM);
  add(R, rbx(W - 0.3, 0.12, 0.45, 0.04), IM.fabric, [0, floor + 0.95, cabZ0 + 0.35], null, false);               // couchette repliée
  // pédalier
  for (const [x, w] of [[0.5, 0.12], [0.75, 0.08]]) add(R, rbx(w, 0.12, 0.02, 0.008), IM.rubber, [x, floor + 0.2, cabZ1 - 0.45], [-0.4, 0, 0], false);
  controls(api, R, [0.18, floor + 0.86, cabZ1 - 0.62], [0.28, floor + 0.9, cabZ1 - 0.42], IM, M);
  api.update0 = api.update;
  R.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return api;
}

// =====================================================================
// AUTOBUS 12 m — permis D
// =====================================================================
export function buildBus({ interior = true } = {}) {
  const L = 12, W = 2.55, F = L / 2, tiltWS = 0.06;
  const layout = {
    eye: new THREE.Vector3(0.72, 2.02, 4.78),
    screen: { pos: [0.22, 1.5, 5.45], rot: [0.55, -0.55], scale: 1.1 },
    cluster: { pos: [0.72, 1.43, 5.43], rotX: -0.6, scale: 1.2 },
    hud: { pos: [0.72, 1.74, 5.93], tilt: tiltWS, w: 0.4, h: 0.1 },
    mirrors: [
      ['left', 0.24, 0.42, [1.52, 2.28, 6.28], [0, 0.24], -0.36, 26, [240, 420]],
      ['right', 0.24, 0.42, [-1.62, 2.28, 6.28], [0, -0.48], 0.6, 26, [240, 420]],
    ],
    windshield: { pos: [0, 0.95, 5.98], tilt: tiltWS, W: 2.35, H: 1.9, wipers: [[-0.8, 1.25], [0.55, 1.25]] },
    passenger: { hips: [-0.75, 0.93, 4.35], board: [-0.75, 1.07, 4.7] },
    wheelMax: 10.5,
  };
  const spec = { accelK: 0.5, vmax: 27.8, ratio: 17, wheelMax: 10.5, brakeK: 0.8 };
  const car = newCar('bus', new THREE.Vector3(W, 3.15, L), 6.0, 0.5, spec, layout);
  const M = exteriorMats(0x1d4ed8), B = car.body;
  const floor = 0.38, win0 = 1.0, win1 = 2.62, roof = 3.1;
  // coque creuse : bas de caisse, bandeau haut, pavillon, faces
  for (const sx of [-1, 1]) {
    add(B, rbx(0.07, win0 - 0.3, L - 0.2, 0.03), M.white, [sx * (W / 2 - 0.035), (win0 + 0.3) / 2, 0]);
    add(B, rbx(0.07, roof - win1, L - 0.2, 0.03), M.white, [sx * (W / 2 - 0.035), (roof + win1) / 2, 0]);
    add(B, new THREE.BoxGeometry(0.075, 0.2, L - 0.3), M.paint, [sx * (W / 2 - 0.035), 0.85, 0]);         // bande bleue
    for (let z = -F + 0.5; z <= F - 0.3; z += 1.45) add(B, new THREE.BoxGeometry(0.08, win1 - win0, 0.12), M.black, [sx * (W / 2 - 0.035), (win0 + win1) / 2, z]); // montants
    add(B, new THREE.PlaneGeometry(L - 0.6, win1 - win0), M.glass, [sx * (W / 2 - 0.03), (win0 + win1) / 2, 0], [0, Math.PI / 2, 0], false);
  }
  add(B, rbx(W, 0.12, L, 0.06), M.white, [0, roof, 0]);
  add(B, rbx(W - 0.4, 0.3, 3.0, 0.1), M.white, [0, roof + 0.2, -2.5]);                    // bloc clim
  add(B, new THREE.BoxGeometry(W - 0.1, 0.12, L - 0.1), M.chassis, [0, 0.3, 0]);
  // face avant : bas, pare-brise panoramique, girouette
  add(B, rbx(W, 0.62, 0.12, 0.06), M.white, [0, 0.62, F - 0.06]);
  add(B, new THREE.PlaneGeometry(W - 0.15, 1.85), M.glass, [0, 1.9, F - 0.02], [-tiltWS, 0, 0], false);
  add(B, rbx(W, 0.32, 0.12, 0.04), M.black, [0, 2.92, F - 0.06]);
  const led = decalTex([['AUTO-ÉCOLE  ·  PERMIS D', 120, 128]], '#090909', '#ff9a1f', 1024, 256);
  add(B, new THREE.PlaneGeometry(1.9, 0.26), new THREE.MeshBasicMaterial({ map: led, toneMapped: false }), [0, 2.92, F + 0.005], null, false);
  for (const sx of [-1, 1]) {
    lamp(car, 'head', rbx(0.36, 0.14, 0.05, 0.04), [sx * 0.95, 0.66, F + 0.01]); lamp(car, 'blink', rbx(0.12, 0.12, 0.05, 0.03), [sx * 1.15, 0.66, F + 0.01]);
    lamp(car, 'brake', rbx(0.14, 0.5, 0.05, 0.03), [sx * 1.1, 1.1, -F - 0.01]); lamp(car, 'blink', rbx(0.14, 0.18, 0.05, 0.03), [sx * 1.1, 0.75, -F - 0.01]);
    // rétros « antennes de homard »
    add(B, new THREE.CylinderGeometry(0.025, 0.025, 0.9, 10), M.black, [sx * (W / 2 + 0.05), 2.65, F + 0.1], [0.9, 0, -sx * 0.5]);
    add(B, rbx(0.28, 0.48, 0.12, 0.04), M.black, [sx * 1.55 - (sx < 0 ? 0.07 : 0), 2.28, F + 0.33]);
  }
  lamp(car, 'reverse', rbx(0.3, 0.1, 0.05, 0.02), [0, 0.95, -F - 0.01]);
  add(B, rbx(W, 2.2, 0.1, 0.06), M.white, [0, 1.6, -F + 0.05]);
  add(B, new THREE.PlaneGeometry(1.8, 0.8), M.glass, [0, 2.2, -F + 0.11], [0, Math.PI, 0], false);
  const side = decalTex([['AUTO-ÉCOLE · FORMATION TRANSPORT DE VOYAGEURS', 66, 128, '#1d4ed8']], null, '#1d4ed8');
  decal(B, side, 7.5, 0.5, [W / 2 + 0.005, 0.62, 0], Math.PI / 2); decal(B, side, 7.5, 0.5, [-W / 2 - 0.005, 0.62, 0], -Math.PI / 2);
  // portes (côté droit) : panneaux vitrés à joints noirs
  for (const z of [F - 0.75, 0.2]) for (const dz of [-0.33, 0.33]) {
    add(B, new THREE.BoxGeometry(0.03, 2.2, 0.64), M.glass, [-W / 2 - 0.005, 1.4, z + dz], null, false);
    add(B, new THREE.BoxGeometry(0.035, 2.2, 0.03), M.black, [-W / 2 - 0.008, 1.4, z + dz + 0.32]);
  }
  // roues
  const fz = F - 2.7, rz = fz - 6.0;
  for (const sx of [-1, 1]) {
    addWheel(car, sx > 0 ? 'FL' : 'FR', sx * (W / 2 - 0.25), 0.5, fz, 0.34, M, false);
    addWheel(car, sx > 0 ? 'RL' : 'RR', sx * (W / 2 - 0.38), 0.5, rz, 0.3, M, true);
    for (const z of [fz, rz]) add(B, new THREE.CylinderGeometry(0.62, 0.62, 0.1, 24, 1, true, 0, Math.PI), M.black, [sx * (W / 2 - 0.02), 0.5, z], [0, 0, sx * Math.PI / 2]);
  }
  if (interior) car.interior = busInterior(car, { W, L, F, floor, win0, win1, roof, tiltWS });
  return car;
}
function busInterior(car, { W, L, F, floor, win0, win1, roof }) {
  const IM = interiorMaterials(), M = exteriorMats(0x1d4ed8), R = new THREE.Group(); car.obj.add(R);
  const api = { root: R };
  const vinyl = std(0x55585e, 0.85, 0), pole = std(0xf2c12e, 0.35, 0.6), seatM = new THREE.MeshStandardMaterial({ color: 0x2f4f9a, roughness: 0.9, map: IM.fabric.map });
  add(R, new THREE.BoxGeometry(W - 0.16, 0.04, L - 0.2), vinyl, [0, floor, 0], null, false);
  add(R, new THREE.BoxGeometry(W - 0.16, 0.03, L - 0.3), IM.headliner, [0, roof - 0.08, 0], null, false);
  for (const sx of [-1, 1]) {
    add(R, new THREE.BoxGeometry(0.03, win0 - floor, L - 0.3), IM.trimLight, [sx * (W / 2 - 0.09), (win0 + floor) / 2, 0], null, false);
    add(R, new THREE.BoxGeometry(0.03, roof - win1 - 0.08, L - 0.3), IM.trimLight, [sx * (W / 2 - 0.09), (roof + win1) / 2 - 0.04, 0], null, false);
    add(R, new THREE.BoxGeometry(0.15, 0.04, L - 0.6), new THREE.MeshStandardMaterial({ color: 0xfff7e8, emissive: 0xfff2dd, emissiveIntensity: 0.5 }), [sx * 0.55, roof - 0.1, 0], null, false); // rampes lumineuses
  }
  // poste conducteur surélevé + planche de bord
  add(R, rbx(1.1, 0.36, 1.8, 0.05), vinyl, [0.72, floor + 0.18, F - 1.25], null, false);
  const df = floor + 0.36;
  add(R, rbx(1.25, 0.4, 0.62, 0.08), IM.dash, [0.62, df + 0.55, F - 0.55], [0.1, 0, 0], false);
  add(R, rbx(0.55, 0.32, 0.5, 0.06), IM.dash, [0.08, df + 0.45, F - 0.72], [0.2, -0.5, 0], false);
  add(R, rbx(W - 0.3, 0.12, 0.35, 0.04), IM.dash, [0, df + 0.42, F - 0.25], null, false);
  for (let k = 0; k < 6; k++) add(R, rbx(0.05, 0.03, 0.05, 0.01), k % 2 ? IM.piano : M.yellow, [0.02 + k * 0.07, df + 0.63, F - 0.72], [0.2, -0.5, 0], false);
  car.steeringWheel = steering(R, new THREE.Vector3(0.72, df + 0.86, F - 1.0), new THREE.Vector3(0, -0.7, 0.71).normalize(), 0.25, IM);
  api.wheelPivot = car.steeringWheel;
  seat(R, 0.72, df, F - 1.62, IM);
  add(R, rbx(0.06, 1.0, 0.9, 0.02), IM.trimLight, [0.12, df + 0.5, F - 1.75], null, false);                       // cloison conducteur
  for (const [x, w] of [[0.62, 0.12], [0.86, 0.08]]) add(R, rbx(w, 0.12, 0.02, 0.008), IM.rubber, [x, df + 0.2, F - 0.6], [-0.4, 0, 0], false);
  controls(api, R, [0.25, df + 0.5, F - 1.0], [0.3, df + 0.6, F - 0.78], IM, M);
  // sièges voyageurs (rangées de part et d'autre de l'allée) + barres de maintien
  const seatGeo = (() => { const a = rbx(0.42, 0.1, 0.42, 0.03).toNonIndexed(); a.translate(0, 0.45, 0); const b = rbx(0.42, 0.5, 0.08, 0.03).toNonIndexed(); b.rotateX(-0.12); b.translate(0, 0.75, -0.2); return mergeTwo(a, b); })();
  const spots = [];
  for (let z = F - 2.4; z > -F + 0.8; z -= 0.82) {
    if (Math.abs(z - 0.2) < 0.9) continue;                         // porte du milieu
    for (const x of [0.97, 0.53]) spots.push([x, z]);
    if (z < F - 2.6) for (const x of [-0.97, -0.53]) spots.push([x, z]);
  }
  const inst = new THREE.InstancedMesh(seatGeo, seatM, spots.length);
  const m4 = new THREE.Matrix4(); spots.forEach(([x, z], i) => { m4.makeTranslation(x, floor, z); inst.setMatrixAt(i, m4); });
  R.add(inst);
  for (let z = F - 2.2; z > -F + 1; z -= 2.2) { add(R, new THREE.CylinderGeometry(0.02, 0.02, roof - floor - 0.1, 10), pole, [0.26, (roof + floor) / 2, z], null, false); add(R, new THREE.CylinderGeometry(0.02, 0.02, roof - floor - 0.1, 10), pole, [-0.26, (roof + floor) / 2, z - 1.1], null, false); }
  for (const sx of [-1, 1]) add(R, new THREE.CylinderGeometry(0.018, 0.018, L - 3, 10), pole, [sx * 0.3, roof - 0.35, -0.8], [Math.PI / 2, 0, 0], false);
  R.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return api;
}
function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) { const A = a.attributes[k].array, Bb = b.attributes[k].array, o = new Float32Array(A.length + Bb.length); o.set(A); o.set(Bb, A.length); g.setAttribute(k, new THREE.BufferAttribute(o, a.attributes[k].itemSize)); }
  return g;
}

// =====================================================================
// MOTO ROADSTER — permis A
// =====================================================================
export function buildMoto() {
  const layout = {
    eye: new THREE.Vector3(0, 1.5, -0.12),
    screen: { pos: [0, 0.15, 0.012], rot: [0.75, 0], scale: 0.62, onBar: true },
    cluster: null,
    hud: { pos: [0, 1.33, 0.62], tilt: 0, w: 0.34, h: 0.085 },
    mirrors: [
      ['left', 0.13, 0.085, [0.33, 0.28, -0.021], [0, 0.04], -0.22, 34, [240, 160], 'round'],
      ['right', 0.13, 0.085, [-0.33, 0.28, -0.021], [0, -0.04], 0.22, 34, [240, 160], 'round'],
    ],
    mirrorsOnBar: true,
    windshield: null, passenger: null, wheelMax: 0.55,
  };
  const spec = { accelK: 1.45, vmax: 50, ratio: 1, wheelMax: 0.55, brakeK: 1.05 };
  const car = newCar('moto', new THREE.Vector3(0.82, 1.2, 2.12), 1.45, 0.32, spec, layout);
  const M = exteriorMats(0x111214), B = car.body, IM = interiorMaterials();
  const accent = new THREE.MeshPhysicalMaterial({ color: 0xd4141f, metalness: 0.4, roughness: 0.28, clearcoat: 1 });
  const fz = 0.72, rz = -0.73, R = 0.32;
  // cadre treillis, moteur, échappement
  const tube = (a, b, r, mat) => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), len = A.distanceTo(Bv); const m = add(B, new THREE.CylinderGeometry(r, r, len, 10), mat); m.position.copy(A).add(Bv).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()); return m; };
  for (const sx of [-1, 1]) { tube([sx * 0.08, 0.98, 0.46], [sx * 0.14, 0.52, -0.15], 0.022, accent); tube([sx * 0.13, 0.52, -0.15], [sx * 0.11, R, rz], 0.026, M.alu); tube([sx * 0.1, 0.98, 0.42], [sx * 0.12, 0.82, -0.45], 0.018, accent); }
  add(B, rbx(0.3, 0.34, 0.44, 0.06), M.dark, [0, 0.45, 0.08]);
  for (const sx of [-1, 1]) add(B, rbx(0.1, 0.24, 0.16, 0.03), M.alu, [sx * 0.1, 0.7, 0.2], [-0.35, 0, 0]);
  tube([0.1, 0.4, 0.2], [0.16, 0.24, -0.1], 0.03, M.chrome); tube([0.16, 0.24, -0.1], [0.2, 0.42, -0.6], 0.032, M.chrome);
  add(B, new THREE.CylinderGeometry(0.06, 0.07, 0.36, 18), M.alu, [0.21, 0.46, -0.72], [Math.PI / 2 + 0.25, 0, 0]);
  // réservoir, selle, coque arrière
  const tank = add(B, new THREE.SphereGeometry(0.24, 28, 18), M.paint, [0, 0.94, 0.15]); tank.scale.set(0.82, 0.58, 1.3);
  add(B, rbx(0.3, 0.06, 0.28, 0.03), accent, [0, 1.06, 0.1], [-0.12, 0, 0]);
  add(B, rbx(0.3, 0.1, 0.62, 0.05, 4), std(0x18181a, 0.75, 0), [0, 0.88, -0.36], [0.06, 0, 0]);
  add(B, rbx(0.22, 0.14, 0.42, 0.05), M.paint, [0, 0.9, -0.74], [0.12, 0, 0]);
  lamp(car, 'brake', rbx(0.14, 0.05, 0.03, 0.01), [0, 0.92, -0.96]);
  for (const sx of [-1, 1]) lamp(car, 'blink', rbx(0.05, 0.035, 0.06, 0.01), [sx * 0.13, 0.82, -0.92]);
  add(B, new THREE.BoxGeometry(0.18, 0.1, 0.01), std(0xf0f0f0, 0.5, 0), [0, 0.62, -0.98], [0.3, 0, 0]);
  // fourche + garde-boue + phare
  for (const sx of [-1, 1]) { tube([sx * 0.085, R + 0.02, fz], [sx * 0.085, R + 0.38, fz - 0.13], 0.028, M.chrome); tube([sx * 0.085, R + 0.38, fz - 0.13], [sx * 0.085, 1.02, fz - 0.24], 0.032, M.black); }
  add(B, rbx(0.15, 0.04, 0.48, 0.015), M.paint, [0, R + 0.1, fz - 0.02], [0.15, 0, 0]);
  lamp(car, 'head', new THREE.CylinderGeometry(0.085, 0.085, 0.05, 24), [0, 0.96, fz - 0.12]).rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) lamp(car, 'blink', rbx(0.04, 0.03, 0.05, 0.01), [sx * 0.15, 0.9, fz - 0.14]);
  // guidon (pivot = « volant ») : axe de direction incliné, poignées à ±0,36 m
  const head = new THREE.Vector3(0, 1.02, 0.5), axis = new THREE.Vector3(0, -0.92, 0.38).normalize();
  const piv = new THREE.Group(); piv.position.copy(head); piv.userData.isSteering = true; piv.userData.axis = axis.toArray(); piv.userData.radius = 0.36; B.add(piv);
  const bar = new THREE.CylinderGeometry(0.014, 0.014, 0.66, 12); bar.rotateZ(Math.PI / 2);
  add(piv, bar, M.black, [0, 0.07, -0.04]);
  for (const sx of [-1, 1]) {
    add(piv, new THREE.CylinderGeometry(0.019, 0.019, 0.13, 14), M.rubber, [sx * 0.33, 0.07, -0.04], [0, 0, Math.PI / 2]);
    add(piv, new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), M.black, [sx * 0.3, 0.17, -0.02], [0, 0, -sx * 0.2]);   // tige de rétro
    add(piv, rbx(0.15, 0.1, 0.035, 0.02), M.black, [sx * 0.33, 0.28, 0.0]);                                           // coque de rétro
    add(piv, rbx(0.12, 0.012, 0.03, 0.005), M.alu, [sx * 0.24, 0.05, 0.04], [0, 0, 0]);                               // leviers
  }
  add(piv, rbx(0.2, 0.04, 0.16, 0.02), M.alu, [0, 0.0, 0.02]);                                                          // té supérieur
  add(piv, rbx(0.2, 0.12, 0.03, 0.02), M.black, [0, 0.12, 0.05], [0.75, 0, 0]);                                       // support TFT
  car.steeringWheel = piv;
  // roues : clés F (avant, braquée) et R
  const mk = (key, z) => { const steer = new THREE.Group(); steer.position.set(0, R, z); steer.userData.wheel = key; const spin = new THREE.Group(); steer.add(spin); spin.add(wheel(R, 0.16, M, false)); B.add(steer); car.wheels[key] = { steer, spin }; };
  mk('F', fz); mk('R', rz);
  // jambes du pilote (vues en baissant la tête) + bottes sur les repose-pieds
  const jeans = std(0x26324a, 0.9, 0), boot = std(0x111111, 0.6, 0.1);
  for (const sx of [-1, 1]) {
    const hip = [sx * 0.13, 0.95, -0.28], knee = [sx * 0.2, 0.86, 0.12], foot = [sx * 0.18, 0.45, -0.1];
    for (const [a, b, r] of [[hip, knee, 0.075], [knee, foot, 0.062]]) { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b); const m = add(car.obj, new THREE.CylinderGeometry(r, r * 0.9, A.distanceTo(Bv), 12), jeans); m.position.copy(A).add(Bv).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()); }
    add(car.obj, rbx(0.1, 0.1, 0.26, 0.03), boot, [foot[0], 0.44, foot[2] + 0.06]);
    add(B, rbx(0.12, 0.02, 0.04, 0.01), M.alu, [sx * 0.17, 0.4, -0.12]);
  }
  // API de commandes (pas de levier ni frein à main sur la moto : boîte automatique type scooter)
  const api = { root: car.obj, gearStick: { position: { z: 0 } }, hb: { rotation: { x: 0 } }, leverKnob: () => new THREE.Vector3(0, -10, 0), hbHandle: () => new THREE.Vector3(0, -10, 0), update: () => { } };
  car.interior = api;
  car.lean = B;
  return car;
}

export function buildVehicle(kind) { return kind === 'truck' ? buildTruck() : kind === 'bus' ? buildBus() : buildMoto(); }
