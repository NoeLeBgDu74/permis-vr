// Habitacle entièrement reconstruit (remplace celui du modèle) : planche de bord moussée, combiné,
// volant cuir 3 branches, commodo, console et levier de vitesses, pédalier, sièges tissu surpiqués,
// banquette, contre-portes, montants, ciel de toit, pare-soleil, plafonnier.
// Repère voiture : avant = +z, gauche (conducteur) = +x, haut = +y. Mesures prises sur la carrosserie Ace '11.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WHEEL = { pos: new THREE.Vector3(0.36, 0.975, 0.40), axis: new THREE.Vector3(0, -0.37, 0.93).normalize(), radius: 0.185 };
export const CLUSTER = { pos: new THREE.Vector3(0.36, 0.985, 0.505) };

// ---------- textures procédurales ----------
function canvasTex(w, h, draw, srgb = true, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 8; return t;
}
function noise(g, w, h, amp, base = 128, blur = 1) {
  const id = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const n = base + (Math.random() - 0.5) * amp; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
  if (blur) { g.filter = `blur(${blur}px)`; g.drawImage(g.canvas, 0, 0); g.filter = 'none'; }
}
const TEX = {};
function textures() {
  if (TEX.grain) return TEX;
  TEX.grain = canvasTex(256, 256, (g, w, h) => noise(g, w, h, 160, 128, 1.2), false, [6, 6]);           // grain de plastique moussé
  TEX.leather = canvasTex(256, 256, (g, w, h) => { noise(g, w, h, 200, 128, 2); }, false, [3, 3]);
  TEX.fabric = canvasTex(256, 256, (g, w, h) => {                                                        // tissu tramé
    g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const o = ((x + y) / 4) % 2; g.fillStyle = o ? '#9c9c9c' : '#7a7a7a'; g.fillRect(x, y, 4, 2); g.fillStyle = o ? '#808080' : '#969696'; g.fillRect(x, y + 2, 4, 2); }
    g.globalAlpha = 0.25; noise(g, w, h, 120, 128, 0); g.globalAlpha = 1;
  }, true, [5, 5]);
  TEX.insert = canvasTex(256, 512, (g, w, h) => {                                                         // insert de siège matelassé
    g.fillStyle = '#7d7f84'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { g.fillStyle = y % 6 ? '#74767b' : '#868990'; g.fillRect(0, y, w, 1); }
    g.strokeStyle = '#4b4d52'; g.lineWidth = 6; for (let y = 40; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.setLineDash([6, 6]); g.strokeStyle = '#b5b7bc'; g.lineWidth = 2; for (let y = 34; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.beginPath(); g.moveTo(0, y + 12); g.lineTo(w, y + 12); g.stroke(); }
  }, true, [1, 1]);
  TEX.insertBump = canvasTex(256, 512, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000'; for (let y = 40; y < h; y += 64) g.fillRect(0, y - 4, w, 8); }, false);
  TEX.headliner = canvasTex(256, 256, (g, w, h) => { noise(g, w, h, 40, 200, 1.5); }, true, [4, 6]);
  TEX.carpet = canvasTex(256, 256, (g, w, h) => noise(g, w, h, 90, 60, 0.6), true, [8, 8]);
  TEX.grille = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#121214'; g.fillRect(0, 0, w, h); g.fillStyle = '#2b2c30'; for (let y = 4; y < h; y += 8) for (let x = (y / 8 % 2) * 4 + 4; x < w; x += 8) { g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); } }, true, [2, 2]);
  return TEX;
}

function materials() {
  const T = textures();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    dash: std({ color: 0x2a2c30, roughness: 0.82, metalness: 0, bumpMap: T.grain, bumpScale: 0.6, envMapIntensity: 0.9 }),
    trim: std({ color: 0x45484e, roughness: 0.7, metalness: 0, bumpMap: T.grain, bumpScale: 0.4 }),
    trimLight: std({ color: 0x8b8a86, roughness: 0.75, metalness: 0, bumpMap: T.grain, bumpScale: 0.3 }),
    piano: std({ color: 0x08090a, roughness: 0.12, metalness: 0.2, envMapIntensity: 1.4 }),
    alu: std({ color: 0xc8ccd2, roughness: 0.28, metalness: 1.0, envMapIntensity: 1.3 }),
    leather: std({ color: 0x1b1b1d, roughness: 0.55, metalness: 0, bumpMap: T.leather, bumpScale: 0.8 }),
    fabric: std({ color: 0x3a3d44, roughness: 0.95, map: T.fabric, bumpMap: T.fabric, bumpScale: 0.5 }),
    insert: std({ color: 0xffffff, roughness: 0.95, map: T.insert, bumpMap: T.insertBump, bumpScale: 1.2 }),
    headliner: std({ color: 0xc9c5bc, roughness: 1.0, map: T.headliner, bumpMap: T.headliner, bumpScale: 0.3 }),
    carpet: std({ color: 0x3a3b3f, roughness: 1.0, map: T.carpet }),
    rubber: std({ color: 0x141416, roughness: 0.9 }),
    grille: std({ color: 0xffffff, roughness: 0.7, map: T.grille }),
    led: new THREE.MeshBasicMaterial({ color: 0xff5a1f }),
    dome: std({ color: 0xf3f1ea, roughness: 0.3, emissive: 0xfff3dd, emissiveIntensity: 0.15 }),
  };
}

const rb = (w, h, d, r = 0.02, s = 3) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
function mesh(geo, mat, pos, rot, parent) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot);
  m.castShadow = false; m.receiveShadow = true;
  parent.add(m); return m;
}
// poutre entre deux points (montants)
function beam(a, b, w, t, mat, parent, roll = 0) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = mesh(rb(w, len, t, Math.min(w, t) * 0.45), mat, null, null, parent);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  m.quaternion.copy(q); m.rotateY(roll);
  return m;
}

export function buildInterior(car) {
  const M = materials();
  const root = new THREE.Group(); root.name = 'interior';
  const api = { root };

  // ---------- planche de bord (profil extrudé sur toute la largeur) ----------
  const s = new THREE.Shape();
  s.moveTo(1.10, 1.015);
  s.lineTo(0.72, 1.07);
  s.quadraticCurveTo(0.565, 1.085, 0.545, 1.0);
  s.lineTo(0.515, 0.80);
  s.quadraticCurveTo(0.505, 0.655, 0.60, 0.60);
  s.lineTo(0.80, 0.52);
  s.lineTo(1.10, 0.50);
  s.closePath();
  const dg = new THREE.ExtrudeGeometry(s, { depth: 1.40, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 12 });
  dg.rotateY(-Math.PI / 2); dg.translate(0.70, 0, 0);
  // UV en mètres pour le grain
  { const p = dg.attributes.position, uv = dg.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 1.0, p.getY(i) + p.getZ(i)); }
  mesh(dg, M.dash, null, null, root);
  // jonc décoratif aluminium sur la face
  mesh(rb(1.36, 0.012, 0.012, 0.005), M.alu, [0, 0.885, 0.515], [0, 0, 0], root);
  // capote du combiné
  const hood = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 28, 1, true, -Math.PI * 0.42, Math.PI * 0.84);
  hood.rotateX(Math.PI / 2); hood.rotateZ(Math.PI / 2);
  const hm = mesh(hood, M.dash, [CLUSTER.pos.x, 0.94, 0.565], null, root); hm.material = M.dash.clone(); hm.material.side = THREE.DoubleSide;
  // fond du combiné
  mesh(rb(0.36, 0.16, 0.04, 0.02), M.piano, [CLUSTER.pos.x, 0.985, 0.53], [-0.3, 0, 0], root);
  // aérateurs (lamelles)
  const vent = (x, y, z, w) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.x = -0.1; root.add(g);
    mesh(rb(w + 0.02, 0.075, 0.03, 0.012), M.piano, [0, 0, 0], null, g);
    for (let k = -2; k <= 2; k++) mesh(new THREE.BoxGeometry(w, 0.004, 0.02), M.trim, [0, k * 0.013, -0.012], [0.2, 0, 0], g);
    mesh(new THREE.BoxGeometry(0.012, 0.016, 0.012), M.alu, [0, 0, -0.02], null, g);
  };
  vent(0.62, 0.945, 0.535, 0.1); vent(-0.62, 0.945, 0.535, 0.1); vent(0.075, 0.84, 0.505, 0.09); vent(-0.075, 0.84, 0.505, 0.09);
  // console centrale verticale : commandes de climatisation + warning
  mesh(rb(0.3, 0.26, 0.06, 0.02), M.piano, [0, 0.68, 0.53], [-0.12, 0, 0], root);
  for (const x of [-0.09, 0.09]) {
    const k = mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.03, 32), M.alu, [x, 0.66, 0.49], [Math.PI / 2 - 0.12, 0, 0], root);
    mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.006, 32), M.piano, [0, -0.017, 0], null, k);
  }
  const warn = mesh(rb(0.05, 0.03, 0.02, 0.006), M.trim, [0, 0.76, 0.495], [-0.12, 0, 0], root);
  mesh(new THREE.CircleGeometry(0.008, 3), M.led, [0, 0, -0.011], [0, Math.PI, 0], warn);
  // boîte à gants (joint)
  mesh(rb(0.42, 0.005, 0.005, 0.002), M.piano, [-0.38, 0.79, 0.505], null, root);
  mesh(rb(0.06, 0.012, 0.012, 0.004), M.alu, [-0.38, 0.75, 0.505], null, root);

  // ---------- colonne, volant et commodo ----------
  const col = mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.32, 20), M.dash, null, null, root);
  col.position.copy(WHEEL.pos).addScaledVector(WHEEL.axis, 0.17); col.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), WHEEL.axis);
  const shroud = mesh(rb(0.13, 0.1, 0.14, 0.03), M.dash, null, null, root);
  shroud.position.copy(WHEEL.pos).addScaledVector(WHEEL.axis, 0.1); shroud.quaternion.copy(col.quaternion); shroud.rotateX(Math.PI / 2);
  // pivot : rotation autour de l'axe (pilotée par poseCar) ; tilt : orientation de base
  const pivot = new THREE.Group(); pivot.position.copy(WHEEL.pos); pivot.userData.isSteering = true; pivot.userData.axis = WHEEL.axis.toArray(); pivot.userData.radius = WHEEL.radius;
  const tilt = new THREE.Group(); tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), WHEEL.axis); pivot.add(tilt);
  const rim = new THREE.TorusGeometry(WHEEL.radius, 0.0175, 20, 96);
  { const p = rim.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const a = Math.atan2(y, x); const k = 1 + 0.18 * Math.max(0, Math.sin(a)) ** 6; p.setXYZ(i, x, y, z * k); } rim.computeVertexNormals(); }
  mesh(rim, M.leather, null, null, tilt);
  // branches (3) + moyeu avec coussin d'airbag
  for (const [a, len] of [[Math.PI, 0.15], [0, 0.15], [-Math.PI / 2, 0.15]]) {
    const sp = mesh(rb(len, 0.045, 0.02, 0.008), M.leather, null, null, tilt);
    sp.position.set(Math.cos(a) * (0.05 + len / 2 - 0.02), Math.sin(a) * (0.05 + len / 2 - 0.02) - (a === -Math.PI / 2 ? 0 : 0.012), 0.012);
    sp.rotation.z = a;
    if (a !== -Math.PI / 2) mesh(rb(0.06, 0.006, 0.004, 0.002), M.alu, [0, 0.016, -0.011], null, sp);
  }
  const hub = mesh(rb(0.14, 0.11, 0.06, 0.03, 4), M.leather, [0, -0.008, 0.02], null, tilt);
  mesh(new THREE.TorusGeometry(0.016, 0.0035, 10, 32), M.alu, [0, 0.005, -0.031], null, hub);
  car.obj.add(pivot); api.wheelPivot = pivot;
  // commodo de clignotant (à gauche de la colonne) et d'essuie-glace (à droite)
  const stalkBase = WHEEL.pos.clone().addScaledVector(WHEEL.axis, 0.085);
  const mkStalk = (side) => {
    const g = new THREE.Group(); g.position.copy(stalkBase); g.quaternion.copy(col.quaternion); root.add(g);
    const arm = new THREE.Group(); g.add(arm);
    const b = mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.14, 12), M.dash, [side * 0.12, 0, 0], [0, 0, Math.PI / 2], arm);
    mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.04, 12), M.trim, [0, side * 0.07, 0], null, b);
    return arm;
  };
  api.blinkStalk = mkStalk(1); mkStalk(-1);

  // ---------- console et levier de vitesses ----------
  mesh(rb(0.24, 0.36, 1.0, 0.04), M.trim, [0, 0.4, 0.0], null, root);
  mesh(rb(0.25, 0.02, 0.55, 0.01), M.piano, [0, 0.58, 0.18], null, root);
  const gate = mesh(new THREE.PlaneGeometry(0.05, 0.13), new THREE.MeshBasicMaterial({ map: canvasTex(64, 160, (g) => { g.fillStyle = '#060606'; g.fillRect(0, 0, 64, 160); g.font = 'bold 30px Arial'; g.textAlign = 'center'; ['P', 'R', 'N', 'D'].forEach((k, i) => { g.fillStyle = '#9aa0a8'; g.fillText(k, 32, 34 + i * 36); }); }), toneMapped: false }), [0.075, 0.592, 0.18], [-Math.PI / 2, 0, Math.PI], root);
  void gate;
  const lever = new THREE.Group(); lever.position.set(0, 0.59, 0.18); root.add(lever);
  mesh(rb(0.06, 0.012, 0.16, 0.005), M.rubber, [0, 0.004, 0], null, lever);           // soufflet
  const stick = new THREE.Group(); lever.add(stick);
  mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.12, 12), M.alu, [0, 0.06, 0], null, stick);
  mesh(rb(0.045, 0.07, 0.055, 0.02, 4), M.leather, [0, 0.14, 0], null, stick);
  mesh(rb(0.03, 0.01, 0.03, 0.004), M.alu, [0, 0.178, 0], null, stick);
  api.gearStick = stick;
  // frein à main
  const hb = mesh(rb(0.035, 0.03, 0.24, 0.012), M.dash, [0, 0.63, -0.18], [0.18, 0, 0], root);
  mesh(rb(0.038, 0.034, 0.08, 0.014), M.leather, [0, 0.005, -0.08], null, hb);
  // porte-gobelets + accoudoir
  for (const z of [0.36, 0.44]) mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.005, 24), M.rubber, [0, 0.592, z], null, root);
  mesh(rb(0.22, 0.09, 0.32, 0.03), M.leather, [0, 0.64, -0.5], null, root);

  // ---------- plancher, pédalier ----------
  mesh(rb(1.44, 0.04, 2.75, 0.01), M.carpet, [0, 0.2, -0.32], null, root);
  mesh(new THREE.PlaneGeometry(1.4, 0.36), M.carpet, [0, 0.38, 0.98], [0.55, Math.PI, 0], root);  // tablier incliné
  const pedal = (x, w, h, z) => { const p = new THREE.Group(); p.position.set(x, 0.52, z); root.add(p); mesh(new THREE.BoxGeometry(0.012, 0.012, 0.2), M.dash, [0, -0.07, 0.07], [0.9, 0, 0], p); const pad = mesh(rb(w, h, 0.015, 0.006), M.rubber, [0, -0.15, -0.0], [-0.35, 0, 0], p); for (let k = -2; k <= 2; k++) mesh(new THREE.BoxGeometry(w * 0.8, 0.004, 0.004), M.alu, [0, k * h / 6, -0.009], null, pad); return p; };
  api.brakePedal = pedal(0.40, 0.085, 0.07, 0.8);
  api.gasPedal = pedal(0.25, 0.05, 0.12, 0.84);
  mesh(rb(0.08, 0.02, 0.22, 0.008), M.rubber, [0.58, 0.27, 0.72], [-0.4, 0, 0], root);        // repose-pied

  // ---------- sièges ----------
  const seat = (x, scale = 1) => {
    const g = new THREE.Group(); g.position.set(x, 0, 0); root.add(g);
    // glissières
    for (const sx of [-0.18, 0.18]) mesh(new THREE.BoxGeometry(0.03, 0.04, 0.5), M.dash, [sx, 0.25, -0.12], null, g);
    const cushion = new THREE.Group(); cushion.position.set(0, 0.43, -0.13); cushion.rotation.x = -0.12; g.add(cushion);
    mesh(rb(0.52 * scale, 0.12, 0.52, 0.05, 4), M.fabric, [0, 0, 0], null, cushion);
    mesh(rb(0.3, 0.03, 0.46, 0.012), M.insert, [0, 0.055, -0.01], null, cushion);
    for (const sx of [-1, 1]) mesh(rb(0.1, 0.07, 0.5, 0.035, 4), M.fabric, [sx * 0.21 * scale, 0.05, 0], [0, 0, sx * 0.2], cushion);
    const back = new THREE.Group(); back.position.set(0, 0.5, -0.4); back.rotation.x = -0.24; g.add(back);
    mesh(rb(0.52 * scale, 0.66, 0.13, 0.05, 4), M.fabric, [0, 0.33, 0], null, back);
    mesh(rb(0.3, 0.5, 0.03, 0.012), M.insert, [0, 0.3, 0.058], null, back);
    for (const sx of [-1, 1]) mesh(rb(0.1, 0.56, 0.12, 0.045, 4), M.fabric, [sx * 0.22 * scale, 0.3, 0.05], [0, sx * -0.35, 0], back);
    // appuie-tête
    for (const sx of [-0.06, 0.06]) mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 8), M.alu, [sx, 0.69, 0], null, back);
    mesh(rb(0.27, 0.19, 0.1, 0.045, 4), M.fabric, [0, 0.82, 0.01], null, back);
    return g;
  };
  seat(0.36); seat(-0.36);
  // banquette arrière
  { const g = new THREE.Group(); root.add(g);
    mesh(rb(1.3, 0.14, 0.5, 0.05, 4), M.fabric, [0, 0.45, -0.95], [-0.08, 0, 0], g);
    for (const x of [-0.42, 0, 0.42]) mesh(rb(0.34, 0.03, 0.42, 0.012), M.insert, [x, 0.525, -0.95], [-0.08, 0, 0], g);
    const b = mesh(rb(1.3, 0.62, 0.13, 0.05, 4), M.fabric, [0, 0.8, -1.27], [-0.22, 0, 0], g);
    for (const x of [-0.42, 0.42]) mesh(rb(0.25, 0.16, 0.09, 0.04, 4), M.fabric, [x, 0.4, -0.02], null, b);
    mesh(rb(1.36, 0.03, 0.5, 0.01), M.trim, [0, 1.06, -1.5], null, g);              // plage arrière
  }

  // ---------- contre-portes et habillages latéraux ----------
  for (const side of [1, -1]) {
    const X = side * 0.71;
    for (const [z0, z1, front] of [[-0.38, 0.58, true], [-1.16, -0.38, false]]) {
      const zc = (z0 + z1) / 2, L = z1 - z0;
      const door = new THREE.Group(); door.position.set(X, 0, zc); root.add(door);
      mesh(rb(0.05, 0.74, L - 0.01, 0.02), M.trim, [0, 0.64, 0], null, door);
      mesh(rb(0.07, 0.07, L - 0.02, 0.03), M.dash, [-side * 0.01, 1.0, 0], null, door);         // seuil de vitre
      mesh(rb(0.03, 0.2, L * 0.62, 0.012), M.fabric, [-side * 0.026, 0.84, -0.02], null, door);   // insert tissu
      mesh(rb(0.08, 0.05, L * 0.55, 0.02), M.trim, [-side * 0.05, 0.74, -L * 0.05], null, door);  // accoudoir
      mesh(rb(0.025, 0.04, 0.11, 0.01), M.alu, [-side * 0.03, 0.86, L * 0.33], null, door);       // poignée
      mesh(new THREE.CircleGeometry(0.07, 28), M.grille, [-side * 0.028, 0.45, L * 0.22], [0, -side * Math.PI / 2, 0], door); // haut-parleur
      mesh(rb(0.05, 0.12, L * 0.6, 0.015), M.dash, [-side * 0.03, 0.4, -L * 0.1], null, door);    // vide-poche
      if (front) for (let k = 0; k < 2; k++) mesh(rb(0.02, 0.008, 0.025, 0.003), M.piano, [-side * 0.072, 0.772, -L * 0.1 + 0.18 + k * 0.035], null, door); // lève-vitres
    }
    // panneaux latéraux avant (pieds) et arrière (custode)
    mesh(rb(0.05, 0.72, 0.5, 0.02), M.trim, [X, 0.64, 0.83], null, root);
    mesh(rb(0.06, 1.12, 0.55, 0.03), M.trimLight, [side * 0.7, 0.86, -1.43], null, root);
    // montants : A (pare-brise), B (milieu), C (arrière)
    beam([side * 0.655, 1.03, 1.03], [side * 0.6, 1.44, 0.22], 0.085, 0.045, M.trimLight, root);
    beam([side * 0.69, 1.02, -0.38], [side * 0.68, 1.44, -0.4], 0.11, 0.05, M.trimLight, root);
    mesh(rb(0.025, 0.06, 0.04, 0.01), M.dash, [side * 0.66, 1.32, -0.37], null, root);            // renvoi de ceinture
    beam([side * 0.67, 1.04, -1.68], [side * 0.62, 1.43, -1.5], 0.15, 0.05, M.trimLight, root);
    // rail de pavillon
    mesh(rb(0.06, 0.05, 1.95, 0.02), M.trimLight, [side * 0.67, 1.42, -0.73], null, root);
    // poignée de maintien (passager / arrière)
    if (side < 0) mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 20, Math.PI), M.trim, [side * 0.63, 1.37, 0.05], [0, Math.PI / 2, Math.PI], root);
  }

  // ---------- pavillon ----------
  mesh(rb(1.42, 0.03, 1.98, 0.012), M.headliner, [0, 1.455, -0.72], null, root);
  mesh(rb(1.3, 0.05, 0.1, 0.02), M.headliner, [0, 1.435, 0.24], null, root);                     // traverse avant
  mesh(rb(1.3, 0.06, 0.1, 0.02), M.headliner, [0, 1.41, -1.68], null, root);                    // traverse arrière
  for (const side of [1, -1]) {                                                                   // pare-soleil relevés
    const v = mesh(rb(0.34, 0.018, 0.16, 0.008), M.headliner, [side * 0.33, 1.42, 0.17], [0.08, 0, 0], root);
    mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 8), M.trimLight, [0, 0, 0.075], [0, 0, Math.PI / 2], v);
  }
  // plafonnier + console de pavillon
  mesh(rb(0.22, 0.03, 0.12, 0.012), M.trimLight, [0, 1.428, 0.05], null, root);
  mesh(rb(0.08, 0.012, 0.05, 0.005), M.dome, [0, 1.41, 0.05], null, root);
  // rétroviseur intérieur : pied
  mesh(rb(0.03, 0.05, 0.03, 0.01), M.dash, [0.02, 1.4, 0.335], null, root);

  root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  car.obj.add(root);

  // ---------- animation ----------
  api.update = (st) => {
    api.brakePedal.rotation.x = -st.brake * 0.35;
    api.gasPedal.rotation.x = -st.throttle * 0.3;
    api.blinkStalk.rotation.z = st.blink === 'L' ? -0.12 : st.blink === 'R' ? 0.12 : 0;
    api.gearStick.position.z = { P: 0.045, R: 0.015, N: -0.015, D: -0.045 }[st.gear] || 0;
  };
  return api;
}
