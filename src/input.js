// Entrées : clavier/souris (PC) et manettes Meta Quest (WebXR).
export class Input {
  constructor(renderer) {
    this.renderer = renderer;
    this.keys = new Set();
    this.pressed = new Set();   // touches pressées depuis la dernière lecture
    this.look = { yaw: 0, pitch: 0 };
    this.xrPrev = {};
    addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    let drag = false, lx = 0, ly = 0;
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', e => { drag = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointerup', () => { drag = false; });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      this.look.yaw -= (e.clientX - lx) * 0.004; this.look.pitch -= (e.clientY - ly) * 0.004;
      this.look.pitch = Math.max(-1.0, Math.min(0.8, this.look.pitch)); this.look.yaw = Math.max(-2.4, Math.min(2.4, this.look.yaw));
      lx = e.clientX; ly = e.clientY;
    });
    cv.addEventListener('dblclick', () => { this.look.yaw = 0; this.look.pitch = 0; });
  }
  take(k) { const h = this.pressed.has(k); this.pressed.delete(k); return h; }
  any(...ks) { return ks.some(k => this.keys.has(k)); }

  // État de conduite combiné. Renvoie aussi les « événements » (boutons pressés)
  read(dt, xrInputs) {
    const st = { throttle: 0, brake: 0, steer: 0, events: new Set(), hands: [null, null] };
    // clavier
    if (this.any('z', 'w', 'arrowup')) st.throttle = 1;
    if (this.any('s', 'arrowdown', ' ')) st.brake = 1;
    if (this.any('q', 'arrowleft')) st.steer += 1;
    if (this.any('d', 'arrowright')) st.steer -= 1;
    for (const [k, ev] of [['a', 'blinkL'], ['e', 'blinkR'], ['r', 'gear'], ['n', 'gearN'], ['p', 'park'], ['x', 'handbrake'], ['g', 'wipers'], ['l', 'lights'], ['1', 'ans1'], ['2', 'ans2'], ['3', 'ans3'], ['&', 'ans1'], ['é', 'ans2'], ['"', 'ans3'], ['h', 'horn'], ['c', 'cam'], ['enter', 'restart'], ['escape', 'menu'], ['v', 'recenter'], ['f', 'free']]) if (this.take(k)) st.events.add(ev);
    st.hornHeld = this.keys.has('h');
    st.talk = this.keys.has('t');
    // manette de jeu (Xbox / PlayStation / standard) sur PC
    st.pad = false;
    const pads = (navigator.getGamepads && !xrInputs) ? navigator.getGamepads() : [];
    for (const gp of pads || []) {
      if (!gp || !gp.connected || gp.mapping !== 'standard') continue;
      st.pad = true; this.pad = gp;
      const b = gp.buttons, ax = gp.axes, val = (i) => b[i] ? b[i].value : 0, down = (i) => b[i] && b[i].pressed;
      const prev = this.padPrev || {}, edge = (i) => down(i) && !prev[i];
      const dz = (v) => Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
      st.throttle = Math.max(st.throttle, val(7)); st.brake = Math.max(st.brake, val(6));
      const lx = dz(ax[0] || 0); if (lx) st.steer = -Math.sign(lx) * Math.pow(Math.abs(lx), 1.4);
      // joystick droit : regarder autour (revient doucement au centre)
      const rx = dz(ax[2] || 0), ry = dz(ax[3] || 0);
      if (rx || ry) { this.look.yaw = Math.max(-2.4, Math.min(2.4, this.look.yaw - rx * dt * 2.6)); this.look.pitch = Math.max(-1, Math.min(0.8, this.look.pitch - ry * dt * 1.8)); }
      else { this.look.yaw *= Math.max(0, 1 - dt * 2.5); this.look.pitch *= Math.max(0, 1 - dt * 2.5); }
      if (edge(0)) st.events.add('gear');        // A
      st.hornHeld = st.hornHeld || down(1);       // B
      if (edge(1)) st.events.add('horn');
      if (edge(2)) st.events.add('handbrake');   // X
      if (down(3)) st.talk = true;                // Y maintenu : parler
      if (edge(4)) st.events.add('blinkL');      // LB
      if (edge(5)) st.events.add('blinkR');      // RB
      if (edge(8)) st.events.add('cam');         // Vue / Select
      if (edge(9)) st.events.add('restart');     // Menu / Start
      if (edge(12)) st.events.add('gearN');      // croix haut
      if (edge(13)) st.events.add('park');       // croix bas
      if (edge(14)) st.events.add('wipers');     // croix gauche
      if (edge(15)) st.events.add('lights');     // croix droite
      if (edge(11)) st.events.add('recenter');   // clic joystick droit
      const np = {}; for (let i = 0; i < b.length; i++) np[i] = down(i); this.padPrev = np;
      break;
    }
    // manettes VR
    if (xrInputs) for (const src of xrInputs) {
      const gp = src.gamepad; if (!gp) continue;
      const hand = src.handedness, b = gp.buttons, ax = gp.axes;
      const val = (i) => b[i] ? b[i].value : 0, down = (i) => b[i] && b[i].pressed;
      const prev = this.xrPrev[hand] || {};
      const edge = (i) => down(i) && !prev[i];
      if (hand === 'right') {
        st.throttle = Math.max(st.throttle, val(0));
        if (edge(4)) st.events.add('gear');          // A
        st.hornHeld = st.hornHeld || down(5);          // B
        if (edge(5)) st.events.add('horn');
        if (edge(3)) st.events.add('recenter');        // clic joystick
        if ((ax[3] || 0) < -0.6) st.talk = true;     // joystick droit poussé vers l'avant (maintenu) : parler à l'inspecteur
      } else if (hand === 'left') {
        st.brake = Math.max(st.brake, val(0));
        if (edge(4)) st.events.add('blinkL');          // X
        if (edge(5)) st.events.add('blinkR');          // Y
        const x = ax[2] || 0; if (Math.abs(x) > 0.15) st.steer = -x;
        if (edge(3)) st.events.add('lights');        // clic joystick gauche : phares
      }
      const np = {}; for (let i = 0; i < b.length; i++) np[i] = down(i); np.ay = Math.abs(ax[3] || 0) > 0.6;
      this.xrPrev[hand] = np;
      st.hands[hand === 'left' ? 0 : 1] = { grip: down(1), handed: hand };
    }
    return st;
  }
  rumble(strong, ms = 200) {
    const gp = this.pad; const a = gp && gp.vibrationActuator;
    if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: Math.min(1, strong + 0.2) }).catch(() => { });
  }
}
