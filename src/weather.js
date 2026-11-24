// Météo : pluie (ciel couvert, route mouillée réfléchissante, rideau de gouttes autour de la voiture,
// gouttes qui s'accumulent sur le pare-brise et essuie-glaces animés qui les balaient, bruit de pluie).
import * as THREE from 'three';

export function applyRainLook(scene, env, city) {
  scene.environmentIntensity = 0.5;
  scene.backgroundIntensity = 0.42;
  scene.fog.color.set(0x8f989f); scene.fog.near = 30; scene.fog.far = 420;
  env.sun.intensity = 0.55; env.sun.color.set(0xdfe6ee);
  const M = city.mats;
  // chaussée et trottoirs mouillés : plus sombres et brillants (reflets du ciel)
  for (const k of ['asphalt', 'lotAsphalt']) if (M[k]) { M[k].color.multiplyScalar(0.62); M[k].roughness = 0.32; M[k].envMapIntensity = 2.2; }
  for (const k of ['sidewalk', 'curb', 'lotConcrete']) if (M[k]) { M[k].color.multiplyScalar(0.78); M[k].roughness = 0.55; M[k].envMapIntensity = 1.6; }
  if (M.mark) { M.mark.roughness = 0.25; }
}

export class Rain {
  constructor(scene) {
    // rideau de pluie : segments recyclés dans une boîte qui suit la caméra
    const N = 2600, B = this.B = { x: 26, y: 16, z: 26 };
    const pos = new Float32Array(N * 6);
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.drops[i * 3] = (Math.random() - 0.5) * B.x * 2; this.drops[i * 3 + 1] = Math.random() * B.y; this.drops[i * 3 + 2] = (Math.random() - 0.5) * B.z * 2; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb9c6d2, transparent: true, opacity: 0.38, depthWrite: false }));
    this.lines.frustumCulled = false; this.N = N;
    scene.add(this.lines);
  }
  update(dt, center) {
    const p = this.lines.geometry.attributes.position.array, d = this.drops, B = this.B, vy = 11 * dt;
    for (let i = 0; i < this.N; i++) {
      let x = d[i * 3], y = d[i * 3 + 1] - vy, z = d[i * 3 + 2];
      if (y < 0) { y += B.y; x = (Math.random() - 0.5) * B.x * 2; z = (Math.random() - 0.5) * B.z * 2; }
      d[i * 3 + 1] = y;
      const wx = center.x + x, wz = center.z + z;
      p[i * 6] = wx; p[i * 6 + 1] = y; p[i * 6 + 2] = wz;
      p[i * 6 + 3] = wx + 0.02; p[i * 6 + 4] = y + 0.45; p[i * 6 + 5] = wz;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// Gouttes sur le pare-brise + essuie-glaces (posés dans le plan incliné de la vitre)
export class Windshield {
  constructor(car) {
    const tilt = Math.atan2(0.84, 0.40);
    this.W = 1.24; this.H = 0.9;                               // dimensions dans le plan de la vitre (m)
    const c = this.c = document.createElement('canvas'); c.width = 512; c.height = 372; this.g = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(this.W, this.H), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }));
    // repère de la vitre : origine au centre bas, axe « haut » le long de la pente
    const frame = this.frame = new THREE.Group();
    frame.position.set(0, 1.035, 1.045); frame.rotation.set(tilt, Math.PI, 0, 'YXZ');
    plane.position.set(0, this.H / 2, 0.008); frame.add(plane);
    car.obj.add(frame);
    // essuie-glaces (pivots en bas de la vitre)
    this.wipers = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.5, metalness: 0.4 });
    for (const [px, len] of [[-0.34, 0.6], [0.26, 0.56]]) { // repère de la vitre : +x = droite du conducteur (le plan est tourné de π)
      const piv = new THREE.Group(); piv.position.set(px, 0.03, -0.018);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, len, 0.01), mat); arm.position.y = len / 2; piv.add(arm);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, len * 0.95, 0.018), mat); blade.position.set(0.012, len / 2 + 0.02, 0.006); piv.add(blade);
      frame.add(piv); this.wipers.push({ piv, len, px });
    }
    this.drops = []; this.phase = 0; this.on = true; this.ang = 0; this.dir = 1; this.timer = 0;
  }
  update(dt, kmh, raining) {
    // nouvelles gouttes (plus nombreuses à l'arrêt, chassées vers le haut en roulant)
    if (raining) for (let k = 0; k < Math.round(dt * 70 + Math.random()); k++) this.drops.push({ x: Math.random() * this.W - this.W / 2, y: Math.random() * this.H, r: 0.004 + Math.random() * 0.006, a: 0.5 + Math.random() * 0.4 });
    if (this.drops.length > 900) this.drops.splice(0, this.drops.length - 900);
    for (const d of this.drops) d.y += kmh * dt * 0.004;
    // balayage : aller-retour de 0 à 1,9 rad
    // intermittent : un aller-retour (≈1,3 s) puis une pause qui raccourcit avec la vitesse
    this.pause = (this.pause === undefined ? 2 : this.pause) - dt;
    if (this.on && raining && (this.dir !== 0 || this.pause <= 0)) {
      if (this.dir === 0) this.dir = 1;
      this.ang += this.dir * dt * 3.0;
      if (this.ang > 1.9) { this.ang = 1.9; this.dir = -1; }
      else if (this.ang < 0) { this.ang = 0; this.dir = 0; this.pause = Math.max(0.4, 3.2 - kmh / 25); }
    } else if (!this.on || !raining) this.ang = Math.max(0, this.ang - dt * 3);
    for (const w of this.wipers) {
      if (this.ang <= 0.001) { w.piv.rotation.z = -Math.PI / 2; continue; }
      const th = -Math.PI / 2 + this.ang;           // au repos : bras couchés vers la droite ; balayage vers le haut
      w.piv.rotation.z = th;
      const dirx = -Math.sin(th), diry = Math.cos(th); // direction du bras dans le plan
      this.drops = this.drops.filter(d => {
        const rx = d.x - w.px, ry = d.y - 0.03, along = rx * dirx + ry * diry, perp = Math.abs(rx * diry - ry * dirx);
        return !(along > 0 && along < w.len && perp < 0.035);
      });
    }
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.08; this.draw(); }
  }
  draw() {
    const g = this.g, cw = this.c.width, ch = this.c.height, sx = cw / this.W, sy = ch / this.H;
    g.clearRect(0, 0, cw, ch);
    for (const d of this.drops) {
      const x = (d.x + this.W / 2) * sx, y = ch - d.y * sy, r = d.r * sx;
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${0.55 * d.a})`); gr.addColorStop(0.6, `rgba(200,215,230,${0.22 * d.a})`); gr.addColorStop(1, `rgba(40,50,60,${0.35 * d.a})`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    this.tex.needsUpdate = true;
  }
}
