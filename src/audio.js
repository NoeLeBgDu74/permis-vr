// Sons synthétisés (aucun fichier) : moteur, roulement, clignotant, klaxon, alertes ; voix de l'inspecteur (synthèse vocale).
export class Audio {
  constructor() { this.ctx = null; this.muted = false; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = 0.7; this.master.connect(C.destination);
    // moteur : deux oscillateurs + filtre
    this.eng = C.createGain(); this.eng.gain.value = 0;
    const f = this.engF = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 2;
    this.o1 = C.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = C.createOscillator(); this.o2.type = 'square';
    const g2 = C.createGain(); g2.gain.value = 0.35;
    this.o1.connect(f); this.o2.connect(g2); g2.connect(f); f.connect(this.eng); this.eng.connect(this.master);
    this.o1.start(); this.o2.start();
    // roulement / vent : bruit filtré
    const buf = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const n = C.createBufferSource(); n.buffer = buf; n.loop = true;
    this.road = C.createGain(); this.road.gain.value = 0;
    const nf = C.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900;
    n.connect(nf); nf.connect(this.road); this.road.connect(this.master); n.start();
    // klaxon
    this.horn = C.createGain(); this.horn.gain.value = 0;
    for (const fr of [415, 520]) { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = fr; const hf = C.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 900; o.connect(hf); hf.connect(this.horn); o.start(); }
    this.horn.connect(this.master);
  }
  // pluie : bruit blanc filtré (crépitement)
  startRain() {
    if (!this.ctx || this.rainStarted) return; this.rainStarted = true; const C = this.ctx;
    const rb = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), rd = rb.getChannelData(0);
    for (let i = 0; i < rd.length; i++) rd[i] = (Math.random() * 2 - 1) * (Math.random() < 0.02 ? 1 : 0.35);
    const rs = C.createBufferSource(); rs.buffer = rb; rs.loop = true;
    const rf = C.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2400; rf.Q.value = 0.5;
    const rg = C.createGain(); rg.gain.value = 0.11; rs.connect(rf); rf.connect(rg); rg.connect(this.master); rs.start();
  }
  update(rpm, kmh, throttle, hornOn) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const fr = rpm / 60 * 2;       // 4 cylindres : 2 explosions par tour
    this.o1.frequency.setTargetAtTime(fr, t, 0.05); this.o2.frequency.setTargetAtTime(fr / 2, t, 0.05);
    this.engF.frequency.setTargetAtTime(300 + rpm * 0.25 + throttle * 600, t, 0.08);
    this.eng.gain.setTargetAtTime(this.muted ? 0 : 0.05 + throttle * 0.06 + rpm / 60000, t, 0.1);
    this.road.gain.setTargetAtTime(this.muted ? 0 : Math.min(0.5, kmh / 130), t, 0.2);
    this.horn.gain.setTargetAtTime(hornOn && !this.muted ? 0.16 : 0, t, 0.02);
  }
  click(hi) {
    if (!this.ctx || this.muted) return;
    const C = this.ctx, o = C.createOscillator(), g = C.createGain();
    o.type = 'square'; o.frequency.value = hi ? 2200 : 1500; g.gain.value = 0.09;
    g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + 0.03);
    o.connect(g); g.connect(this.master); o.start(); o.stop(C.currentTime + 0.04);
  }
  beep(kind) {
    if (!this.ctx || this.muted) return;
    const C = this.ctx, t = C.currentTime;
    const notes = kind === 'elim' ? [440, 330, 220] : kind === 'ok' ? [523, 659, 784] : kind === 'crash' ? [90] : [880, 660];
    notes.forEach((f, i) => {
      const o = C.createOscillator(), g = C.createGain();
      o.type = kind === 'crash' ? 'sawtooth' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.14); g.gain.exponentialRampToValueAtTime(kind === 'crash' ? 0.5 : 0.18, t + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + (kind === 'crash' ? 0.6 : 0.22));
      o.connect(g); g.connect(this.master); o.start(t + i * 0.14); o.stop(t + i * 0.14 + 0.7);
    });
  }
  say(text) {
    if (this.voice) { if (!this.muted) this.voice.say(text, true); return; }
    if (this.muted || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR'; u.rate = 1.02; u.pitch = 0.95;
      const v = speechSynthesis.getVoices().find(v => /^fr/i.test(v.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* synthèse vocale indisponible : le texte reste affiché */ }
  }
}
