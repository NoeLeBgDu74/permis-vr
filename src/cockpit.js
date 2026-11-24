// Habitacle de la voiture du joueur : place conducteur, écran central (inspecteur / GPS),
// combiné numérique, rétroviseurs rendus en temps réel, volant saisissable à la main en VR.
import * as THREE from 'three';
import { WHEEL_MAX } from './car.js';
import { CLUSTER } from './interior.js';

export const EYE = new THREE.Vector3(0.36, 1.21, -0.12);   // position des yeux (repère voiture, avant = +z, gauche = +x)

export class Cockpit {
  constructor(car, renderer, quality) {
    this.car = car; this.renderer = renderer;
    this.root = car.obj;
    this.mirrors = [];
    this.grab = [null, null];
    this.wheelAngle = 0; this.held = false;
    this.buildScreen();
    this.buildCluster();
    this.buildMirrors(quality);
    this.buildHUD();
  }

  // ---------- écran central ----------
  buildScreen() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 600;
    this.scr = c; this.scrG = c.getContext('2d');
    this.scrTex = new THREE.CanvasTexture(c); this.scrTex.colorSpace = THREE.SRGBColorSpace; this.scrTex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: this.scrTex, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.158), mat);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.176, 0.02), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.35, metalness: 0.4 }));
    const g = new THREE.Group(); g.add(bezel); m.position.z = -0.0105; m.rotation.y = Math.PI; g.add(m);
    // posé sur le haut de la planche de bord, au centre, orienté vers le conducteur
    g.position.set(0.0, 1.0, 0.5); g.rotation.set(0.22, -0.32, 0, 'YXZ'); // tourné vers le conducteur (+x), incliné vers ses yeux
    this.root.add(g); this.screen = g;
  }
  drawScreen(info) {
    const g = this.scrG, W = 1024, H = 600;
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#0d1526'); grd.addColorStop(1, '#070b14');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.font = '600 30px Inter, Arial'; g.fillStyle = '#8fa3c7'; g.textBaseline = 'top';
    g.fillText(info.title || '', 36, 26);
    if (info.timer) { g.textAlign = 'right'; g.fillText(info.timer, W - 36, 26); g.textAlign = 'left'; }
    if (info.result) return this.drawResult(info.result);
    // flèche d'instruction
    const ins = info.instruction;
    if (ins) {
      g.save(); g.translate(150, 230); this.arrow(g, ins.turn); g.restore();
      g.fillStyle = '#fff'; g.font = '800 48px Inter, Arial';
      wrap(g, ins.text, 290, 150, 690, 56);
      if (ins.dist !== undefined) { g.fillStyle = '#7fb0ff'; g.font = '700 40px Inter, Arial'; g.fillText(ins.dist, 290, 280); }
    }
    // inspecteur : sous-titre
    if (info.say) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(24, 360, W - 48, 96); g.fillStyle = '#dfe7f5'; g.font = 'italic 500 30px Inter, Arial'; wrap(g, '« ' + info.say + ' »', 44, 374, W - 88, 36); }
    // fautes récentes
    let y = 480;
    for (const f of (info.faults || []).slice(-2)) {
      g.fillStyle = f.elim ? '#ff4d4f' : '#ffb020'; g.font = '700 30px Inter, Arial';
      g.fillText((f.elim ? '⛔ ' : '⚠ ') + f.label + (f.pts ? `  (−${f.pts})` : ''), 36, y); y += 44;
    }
  }
  drawResult(r) {
    const g = this.scrG, W = 1024;
    g.textAlign = 'center';
    g.fillStyle = r.ok ? '#2ecc71' : '#ff4d4f'; g.font = '900 96px Inter, Arial'; g.fillText(r.ok ? 'ADMIS' : 'AJOURNÉ', W / 2, 80);
    g.fillStyle = '#fff'; g.font = '700 44px Inter, Arial'; g.fillText(r.note, W / 2, 190);
    g.textAlign = 'left'; g.font = '500 28px Inter, Arial'; g.fillStyle = '#c9d4e8';
    let y = 260; for (const l of r.lines.slice(0, 6)) { g.fillText(l, 60, y); y += 38; }
    g.textAlign = 'center'; g.fillStyle = '#7fb0ff'; g.font = '700 30px Inter, Arial'; g.fillText(r.hint, W / 2, 545); g.textAlign = 'left';
  }
  arrow(g, turn) {
    g.fillStyle = '#2f6bff'; g.beginPath(); g.arc(0, 0, 110, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 22; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    const head = (x, y, a) => { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(0, -34); g.lineTo(30, 6); g.lineTo(-30, 6); g.closePath(); g.fill(); g.restore(); };
    if (turn === 'left' || turn === 'right') {
      const s = turn === 'left' ? -1 : 1;
      g.moveTo(-s * 10, 70); g.lineTo(-s * 10, 0); g.quadraticCurveTo(-s * 10, -30, s * 20, -30); g.lineTo(s * 40, -30); g.stroke();
      head(s * 50, -30, s * Math.PI / 2);
    } else if (turn === 'park') {
      g.font = '900 120px Inter, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', 0, 6); g.textAlign = 'left'; g.textBaseline = 'top';
    } else if (turn === 'go') {
      g.font = '900 80px Inter, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('▶', 6, 4); g.textAlign = 'left'; g.textBaseline = 'top';
    } else { g.moveTo(0, 70); g.lineTo(0, -30); g.stroke(); head(0, -40, 0); }
    g.stroke();
  }

  // ---------- combiné numérique (devant le volant) ----------
  buildCluster() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 400;
    this.cl = c; this.clG = c.getContext('2d');
    this.clTex = new THREE.CanvasTexture(c); this.clTex.colorSpace = THREE.SRGBColorSpace; this.clTex.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.129), new THREE.MeshBasicMaterial({ map: this.clTex, toneMapped: false }));
    m.position.copy(CLUSTER.pos); m.rotation.set(-0.18, Math.PI, 0, 'YXZ'); m.position.y -= 0.008;
    this.root.add(m); this.cluster = m;
  }
  // combiné à aiguilles : compteur, compte-tours, écran central (rapport, limitation, clignotants)
  drawCluster(st) {
    const g = this.clG, W = 1024, H = 400;
    g.fillStyle = '#050608'; g.fillRect(0, 0, W, H);
    const gauge = (cx, cy, r, val, max, step, label, unit, red) => {
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, A = (v) => a0 + (a1 - a0) * Math.min(1, Math.max(0, v / max));
      const gr = g.createRadialGradient(cx, cy, 10, cx, cy, r); gr.addColorStop(0, '#16191f'); gr.addColorStop(1, '#0b0d11');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
      g.strokeStyle = '#c8ccd2'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, r - 2, 0, 7); g.stroke();
      if (red) { g.strokeStyle = '#d01c2c'; g.lineWidth = 12; g.beginPath(); g.arc(cx, cy, r - 18, A(red), a1); g.stroke(); }
      g.lineCap = 'round';
      for (let v = 0; v <= max + 1e-6; v += step / 2) {
        const a = A(v), big = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        g.strokeStyle = big ? '#f2f4f8' : '#8790a0'; g.lineWidth = big ? 5 : 3;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - (big ? 34 : 24)), cy + Math.sin(a) * (r - (big ? 34 : 24))); g.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); g.stroke();
        if (big) { g.fillStyle = '#e8ebf0'; g.font = '600 26px Inter, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(Math.round(v)), cx + Math.cos(a) * (r - 58), cy + Math.sin(a) * (r - 58)); }
      }
      g.fillStyle = '#8f98a8'; g.font = '600 20px Inter, Arial'; g.fillText(unit, cx, cy + r * 0.42);
      const a = A(val);
      g.shadowColor = '#ff5a1f'; g.shadowBlur = 12; g.strokeStyle = '#ff5a1f'; g.lineWidth = 7;
      g.beginPath(); g.moveTo(cx - Math.cos(a) * 18, cy - Math.sin(a) * 18); g.lineTo(cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22)); g.stroke(); g.shadowBlur = 0;
      g.fillStyle = '#2a2e36'; g.beginPath(); g.arc(cx, cy, 16, 0, 7); g.fill();
    };
    gauge(200, 200, 186, st.kmh, 200, 20, '', 'km/h');
    gauge(824, 200, 186, (st.rpm || 800) / 1000, 7, 1, '', 'x1000 tr/min', 6);
    // écran central
    g.fillStyle = '#0c1220'; roundRect(g, 404, 70, 216, 260, 18); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = '800 64px Inter, Arial'; g.fillText(String(Math.round(st.kmh)), 512, 150);
    g.fillStyle = '#8fa3c7'; g.font = '600 20px Inter, Arial'; g.fillText('km/h', 512, 192);
    g.font = '800 34px Inter, Arial';
    ['P', 'R', 'N', 'D'].forEach((k, i) => { g.fillStyle = st.gear === k ? '#ffffff' : '#344058'; g.fillText(k, 461 + i * 34, 300); });
    if (st.limit) { g.beginPath(); g.arc(512, 245, 26, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#d0142c'; g.stroke(); g.fillStyle = '#111'; g.font = '800 22px Inter, Arial'; g.fillText(String(st.limit), 512, 246); }
    if (st.handbrake) { g.strokeStyle = '#ff3030'; g.lineWidth = 5; g.beginPath(); g.arc(512, 104, 22, 0, 7); g.stroke(); g.fillStyle = '#ff3030'; g.font = '800 26px Inter, Arial'; g.fillText('P', 512, 106); g.font = '600 15px Inter, Arial'; g.fillText('FREIN À MAIN', 512, 138); }
    const on = st.blinkPhase;
    g.fillStyle = st.blink === 'L' && on ? '#28e070' : '#14201a'; tri(g, 450, 36, -1);
    g.fillStyle = st.blink === 'R' && on ? '#28e070' : '#14201a'; tri(g, 574, 36, 1);
    this.clTex.needsUpdate = true;
  }

  // ---------- affichage tête haute (bas du pare-brise, face au conducteur) ----------
  buildHUD() {
    const c = document.createElement('canvas'); c.width = 640; c.height = 160;
    this.hud = c; this.hudG = c.getContext('2d');
    this.hudTex = new THREE.CanvasTexture(c); this.hudTex.colorSpace = THREE.SRGBColorSpace;
    // projeté SUR le pare-brise : plan incliné comme la vitre (pente mesurée : 0,40 m de haut pour 0,84 m de profondeur),
    // placé entre ~1,5° et ~5,5° sous l'horizon du conducteur, donc au-dessus de la jante du volant.
    // La vitre étant très inclinée, le plan est étiré en hauteur pour que le texte paraisse droit.
    const tilt = Math.atan2(0.84, 0.40);          // ≈ 64° : normale de la vitre vers le conducteur
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.075 / Math.cos(tilt - 0.06)), new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
    m.position.set(EYE.x, 1.147, 0.79); m.rotation.set(tilt, Math.PI, 0, 'YXZ'); m.renderOrder = 10;
    this.root.add(m); this.hudMesh = m;
  }
  drawHUD(st) {
    const g = this.hudG, W = 640, H = 160;
    g.clearRect(0, 0, W, H);
    const over = st.limit && st.kmh > st.limit + 2;
    const txt = (t, x, y, font, col, lw = 8) => { g.font = font; g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = 'rgba(0,10,20,.8)'; g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y); };
    g.textBaseline = 'middle';
    // vitesse (centre) + km/h
    g.textAlign = 'right'; txt(String(Math.round(st.kmh)), 360, 82, '800 120px Inter, Arial', over ? '#ff5050' : '#f2fdff', 14);
    g.textAlign = 'left'; txt('km/h', 372, 110, '700 30px Inter, Arial', over ? '#ff8080' : '#bfeaf8', 6);
    // rapport (gauche) + clignotants
    g.textAlign = 'center'; txt(st.gear, 120, 82, '800 64px Inter, Arial', '#f2fdff', 10);
    if (st.blink && st.blinkPhase) txt(st.blink === 'L' ? '◀' : '▶', st.blink === 'L' ? 40 : 200, 82, '800 50px Inter, Arial', '#28e070', 8);
    if (st.handbrake) { g.textAlign = 'left'; txt(st.pc ? '(P) FREIN À MAIN — touche X (ou accélère)' : '(P) FREIN À MAIN', 10, 16, '800 24px Inter, Arial', '#ff4040', 6); g.textAlign = 'center'; }
    // limitation (droite)
    if (st.limit) {
      g.beginPath(); g.arc(560, 80, 62, 0, 7); g.fillStyle = 'rgba(255,255,255,.95)'; g.fill(); g.lineWidth = 14; g.strokeStyle = '#e0142c'; g.stroke();
      g.fillStyle = '#111'; g.font = '800 54px Inter, Arial'; g.textAlign = 'center'; g.fillText(String(st.limit), 560, 84);
    }
    this.hudTex.needsUpdate = true;
  }

  // ---------- rétroviseurs ----------
  buildMirrors(quality) {
    const q = quality === 'medium' ? 0.6 : quality === 'ultra' ? 1.4 : 1;
    const mk = (name, w, h, pos, rot, camYaw, fov, res, shape) => {
      const rt = new THREE.WebGLRenderTarget(Math.round(res[0] * q), Math.round(res[1] * q), { samples: 2, colorSpace: THREE.SRGBColorSpace });
      const geo = shape === 'round' ? roundedPlane(w, h, h * 0.35) : roundedPlane(w, h, h * 0.45);
      // image miroir : UV inversées horizontalement
      const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: false }));
      const frame = new THREE.Mesh(roundedPlane(w + 0.016, h + 0.016, h * 0.45), new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 }));
      const g = new THREE.Group(); g.position.copy(pos); g.rotation.copy(rot);
      mesh.rotation.y = Math.PI; frame.rotation.y = Math.PI; frame.position.z = 0.004; g.add(frame, mesh);
      this.root.add(g);
      const cam = new THREE.PerspectiveCamera(fov, w / h, 0.3, 600);
      cam.rotation.set(0, camYaw, 0); g.add(cam);
      // la caméra est au centre du miroir, regardant vers l'arrière de la voiture (axe -z du groupe tourné)
      cam.position.set(0, 0, 0);
      const m = { name, rt, mesh, frame, group: g, cam, every: name === 'center' ? 1 : 2 };
      this.mirrors.push(m);
      return m;
    };
    // intérieur (centre), gauche (côté conducteur) et droit
    mk('center', 0.25, 0.07, new THREE.Vector3(0.02, 1.36, 0.34), new THREE.Euler(-0.06, -0.24, 0, 'YXZ'), 0.06, 16, [640, 180]);
    // rétros extérieurs posés sur les coques du modèle (x ±0.85–0.96, y 1.02–1.16, z 0.50–0.64)
    mk('left', 0.15, 0.1, new THREE.Vector3(0.9, 1.09, 0.492), new THREE.Euler(0, 0.38, 0, 'YXZ'), -0.53, 30, [320, 200], 'round');
    mk('right', 0.15, 0.1, new THREE.Vector3(-0.9, 1.09, 0.492), new THREE.Euler(0, -0.56, 0, 'YXZ'), 0.71, 30, [320, 200], 'round');
  }
  // direction (repère voiture) du centre d'un miroir, pour vérifier les regards
  mirrorLocal(name) { const m = this.mirrors.find(x => x.name === name); return m ? m.group.position : null; }

  renderMirrors(scene, frame) {
    const r = this.renderer;
    const xr = r.xr.enabled, prevRT = r.getRenderTarget(), shadowAuto = r.shadowMap.autoUpdate;
    r.xr.enabled = false; r.shadowMap.autoUpdate = false;
    for (const m of this.mirrors) m.mesh.visible = false;
    for (const m of this.mirrors) {
      if (frame % m.every !== (m.name === 'right' ? 1 : 0) % m.every) continue;
      m.cam.updateMatrixWorld();
      // rétro intérieur : on masque l'habitacle pour voir la route par la lunette arrière
      if (m.name === 'center') { if (!this.carMeshes) { this.carMeshes = []; this.root.traverse(o => { if (o.isMesh && o.visible && !this.mirrors.some(x => x.mesh === o || x.frame === o) && o !== this.cluster) this.carMeshes.push(o); }); } for (const o of this.carMeshes) o.visible = false; }
      r.setRenderTarget(m.rt); r.render(scene, m.cam);
      if (m.name === 'center') for (const o of this.carMeshes) o.visible = true;
    }
    for (const m of this.mirrors) m.mesh.visible = true;
    r.setRenderTarget(prevRT); r.xr.enabled = xr; r.shadowMap.autoUpdate = shadowAuto;
  }

  // ---------- volant à la main (VR) ----------
  // hands : [{ pos: Vector3 monde, grip: bool }]
  updateWheel(dt, hands, stickSteer, kmh) {
    const sw = this.car.steeringWheel; if (!sw) return this.wheelAngle;
    const ax = new THREE.Vector3().fromArray(sw.userData.axis);
    const R = sw.userData.radius || 0.18;
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    // repère du plan du volant
    const up = new THREE.Vector3(0, 1, 0).projectOnPlane(ax).normalize();
    const side = new THREE.Vector3().crossVectors(ax, up).normalize();
    const angOf = (pLocal) => { const d = pLocal.clone().sub(sw.position); return { a: Math.atan2(d.dot(side), d.dot(up)), r: d.clone().projectOnPlane(ax).length(), z: d.dot(ax) }; };
    let delta = 0, n = 0;
    hands.forEach((h, k) => {
      if (!h) { this.grab[k] = null; return; }
      const pl = h.pos.clone().applyMatrix4(inv);
      const q = angOf(pl);
      if (h.grip && !this.grab[k]) {
        if (q.r > 0.03 && q.r < R + 0.22 && Math.abs(q.z) < 0.3) this.grab[k] = { last: q.a };
      } else if (!h.grip) this.grab[k] = null;
      if (this.grab[k]) {
        let d = q.a - this.grab[k].last; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.grab[k].last = q.a; delta += -d; n++;
        h.onWheel = true;
      } else h.onWheel = false;
    });
    this.held = n > 0;
    if (n) this.wheelAngle += delta / n;
    else if (Math.abs(stickSteer) > 0.05) { // joystick : angle volant proportionnel, vitesse limitée
      const target = stickSteer * WHEEL_MAX * (kmh > 40 ? 0.35 : kmh > 20 ? 0.6 : 1);
      this.wheelAngle += THREE.MathUtils.clamp(target - this.wheelAngle, -dt * 9, dt * 9);
    } else {
      // retour au centre (auto-alignement) quand on lâche, proportionnel à la vitesse
      const k = Math.min(1, dt * (0.6 + kmh / 15));
      this.wheelAngle -= this.wheelAngle * k;
    }
    this.wheelAngle = THREE.MathUtils.clamp(this.wheelAngle, -WHEEL_MAX, WHEEL_MAX);
    return this.wheelAngle;
  }
}

function wrap(g, text, x, y, w, lh) {
  const words = String(text).split(' '); let line = '';
  for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width > w && line) { g.fillText(line, x, y); y += lh; line = wd; } else line = t; }
  if (line) g.fillText(line, x, y);
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function tri(g, x, y, s) { g.beginPath(); g.moveTo(x + s * 26, y); g.lineTo(x - s * 6, y - 20); g.lineTo(x - s * 6, y + 20); g.closePath(); g.fill(); }
function roundedPlane(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ShapeGeometry(s, 8);
  const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  return g;
}
