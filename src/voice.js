// Inspecteur vocal : on lui parle (bouton maintenu), il répond avec une voix naturelle.
// Micro → transcription (Whisper via le relais, ou reconnaissance vocale du navigateur sur PC)
// → réponse de l'inspecteur (LLM Groq via le relais) → voix (OpenAI TTS via le relais si dispo, sinon meilleure voix du navigateur).
const RELAY = 'https://track-a-truck-ia.netlify.app';
const MODEL = 'openai/gpt-oss-20b';

export class Voice {
  constructor() {
    this.history = [];
    this.recording = false; this.busy = false;
    this.caps = { stt: false, tts: false, llm: false };
    this.audioEl = null; this.queue = Promise.resolve();
    this.status = '';
    this.voiceName = null;
    fetch(RELAY + '/api/groq').then(r => r.json()).then(j => { this.caps.llm = !!j.hasKey; this.caps.stt = !!j.stt; this.caps.tts = !!j.tts; }).catch(() => { });
    if ('speechSynthesis' in window) { const pick = () => { this.voiceName = bestVoice(); }; pick(); speechSynthesis.onvoiceschanged = pick; }
  }

  // ---------- voix ----------
  // file d'attente : une phrase après l'autre ; `priority` coupe ce qui est en cours
  // une seule voix à la fois : `gen` change à chaque interruption, toute phrase d'une génération dépassée est abandonnée
  say(text, priority = false) {
    if (!text) return;
    if (priority) this.stop();
    const g = this.gen || 0;
    this.queue = this.queue.then(() => (g === (this.gen || 0) ? this.speakNow(text, g) : null)).catch(() => { });
  }
  stop() {
    this.gen = (this.gen || 0) + 1;
    if (this.current) { const c = this.current; this.current = null; c.stop(); }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
  // moteur neuronal local (Piper dans un worker) : téléchargé une fois (~95 Mo) puis en cache
  initNeural() {
    if (this.worker) return;
    try {
      this.worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
      this.neural = 'loading'; this.neuralP = 0; this.jobs = new Map(); this.jid = 0;
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') this.neuralP = m.p;
        else if (m.type === 'ready') this.neural = 'ready';
        else if (m.type === 'error') { if (m.id !== undefined && this.jobs.has(m.id)) this.jobs.get(m.id).fail(); else this.neural = 'failed'; console.warn('Voix neuronale :', m.message); }
        else if (m.type === 'audio') { const j = this.jobs.get(m.id); if (j) j.chunk(m.pcm, m.rate); }
        else if (m.type === 'done') { const j = this.jobs.get(m.id); if (j) j.end(); }
      };
      this.worker.postMessage({ type: 'init' });
    } catch (e) { this.neural = 'failed'; }
  }
  neuralSay(text, gen) {
    const ctx = this.audio && this.audio.ctx;
    return new Promise((resolve, reject) => {
      const id = ++this.jid; let t = Math.max(ctx.currentTime + 0.05, 0), finished = false, last = null;
      const src = [];
      this.current = { stop: () => { for (const s of src) try { s.stop(); } catch (e) { } this.jobs.delete(id); resolve(); } };
      this.jobs.set(id, {
        chunk: (pcm, rate) => {
          if (gen !== this.gen) return;
          const buf = ctx.createBuffer(1, pcm.length, rate); buf.copyToChannel(pcm, 0);
          const s = ctx.createBufferSource(); s.buffer = buf;
          const g = ctx.createGain(); g.gain.value = 1.6; s.connect(g); g.connect(this.audio.master);
          t = Math.max(t, ctx.currentTime + 0.03); s.start(t); t += buf.duration + 0.12; src.push(s); last = s;
          s.onended = () => { if (finished && s === last) { this.jobs.delete(id); resolve(); } };
        },
        end: () => { finished = true; if (!last) { this.jobs.delete(id); resolve(); } },
        fail: () => { this.jobs.delete(id); reject(new Error('tts')); },
      });
      this.worker.postMessage({ type: 'speak', id, text });
    });
  }
  async speakNow(text, gen) {
    this.speaking = true;
    try {
      if (this.neural === 'ready' && this.audio && this.audio.ctx) { try { await this.neuralSay(text, gen); return; } catch (e) { } }
      if (gen === this.gen) await this.browserSay(text, gen);
    } finally { this.speaking = false; }
  }
  browserSay(text, gen) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) return res();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR'; u.rate = 1.0; u.pitch = 0.92;
      const v = speechSynthesis.getVoices().find(x => x.name === this.voiceName); if (v) u.voice = v;
      let done = false; const fin = () => { if (!done) { done = true; clearInterval(iv); res(); } };
      u.onend = u.onerror = fin; speechSynthesis.speak(u);
      const t0 = performance.now();
      // filet de sécurité : fin réelle de la parole (certains navigateurs n'émettent pas onend)
      const iv = setInterval(() => { if (gen !== this.gen || (performance.now() - t0 > 800 && !speechSynthesis.speaking) || performance.now() - t0 > 30000) fin(); }, 200);
    });
  }

  // ---------- micro ----------
  async startTalk() {
    if (this.recording || this.busy) return;
    this.stop();
    this.recording = true; this.status = '🎙️ Je vous écoute…';
    // PC sans Whisper : reconnaissance vocale du navigateur
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!this.caps.stt && SR) {
      const rec = this.rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = false; rec.continuous = true;
      this.srText = '';
      rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) this.srText += e.results[i][0].transcript + ' '; };
      rec.onerror = () => { };
      try { rec.start(); } catch (e) { }
      return true;
    }
    try {
      this.stream = this.stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      this.chunks = []; this.mime = mime;
      const mr = this.mr = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      mr.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      mr.start();
    } catch (e) { this.recording = false; this.micError = (e && e.name === 'NotAllowedError') ? 'Micro refusé : autorise le micro pour ce site' : 'Micro indisponible sur cet appareil'; return false; }
    this.micError = null; return true;
  }
  // demande l'autorisation du micro à l'avance (bouton du menu)
  async enableMic() {
    try { this.stream = this.stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); this.micError = null; return true; }
    catch (e) { this.micError = (e && e.name === 'NotAllowedError') ? 'Micro refusé : autorise le micro pour ce site' : 'Micro indisponible sur cet appareil'; return false; }
  }
  // renvoie le texte entendu (ou '')
  async endTalk() {
    if (!this.recording) return '';
    this.recording = false;
    if (this.rec) {
      const rec = this.rec; this.rec = null;
      await new Promise(res => { rec.onend = res; try { rec.stop(); } catch (e) { res(); } setTimeout(res, 1500); });
      return this.srText.trim();
    }
    if (!this.mr) return '';
    const mr = this.mr; this.mr = null;
    await new Promise(res => { mr.onstop = res; try { mr.stop(); } catch (e) { res(); } });
    const blob = new Blob(this.chunks, { type: this.mime || 'audio/webm' });
    if (blob.size < 2500) { this.lastError = 'Trop court : maintiens le bouton pendant que tu parles'; return ''; }
    this.status = '…';
    try {
      const b64 = await blobToB64(blob);
      const r = await fetch(RELAY + '/api/stt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: b64, mime: blob.type }) });
      const j = await r.json();
      if (!r.ok) this.lastError = 'Transcription impossible (' + r.status + ')';
      return (j.text || '').trim();
    } catch (e) { this.lastError = 'Pas de connexion internet pour la transcription'; return ''; }
  }

  // ---------- cerveau de l'inspecteur ----------
  async answer(userText, ctx) {
    this.busy = true; this.status = '💭';
    const sys = `Tu es Monsieur Bernard, inspecteur du permis de conduire français, assis à la place passager pendant l'épreuve pratique (ou une leçon de conduite libre). ` +
      `Tu es calme, poli, un peu pince-sans-rire mais bienveillant. Tu vouvoies le candidat. Réponds en français parlé, 1 à 3 phrases courtes (c'est lu à voix haute, pas de liste, pas d'émoji, pas de markdown). ` +
      `Tu peux expliquer le code de la route, rassurer, répondre aux questions sur l'examen, rappeler la consigne en cours. Tu ne donnes jamais la note avant la fin. ` +
      `La voiture est une citadine à boîte AUTOMATIQUE (sélecteur P, R, N, D ; pas d'embrayage ni de première). Commandes du candidat en VR : gâchette droite = accélérer, gâchette gauche = freiner, saisir le volant avec les gâchettes latérales, X/Y = clignotants gauche/droit, A = marche avant/arrière, B = klaxon. Sur PC : Z accélérer, S freiner, Q/D tourner, A/E clignotants, R marche avant/arrière, P parking. ` +
      `Si le candidat te demande de conduire à sa place ou de tricher, refuse avec humour. Contexte actuel : ${ctx}`;
    const messages = [{ role: 'system', content: sys }, ...this.history.slice(-8), { role: 'user', content: userText }];
    let reply = '';
    try {
      const r = await fetch(RELAY + '/api/groq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, temperature: 0.6, max_tokens: 220 }) });
      const j = await r.json();
      reply = (j.choices && j.choices[0].message.content || '').trim();
    } catch (e) { }
    if (!reply) reply = 'Pardon, je n\'ai pas bien compris. Concentrez-vous sur la route, nous en reparlerons.';
    reply = reply.replace(/[*_#`]/g, '');
    this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
    this.busy = false; this.status = '';
    return reply;
  }
}

function bestVoice() {
  const vs = speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang));
  const score = (v) => (/natural|neural|online/i.test(v.name) ? 10 : 0) + (/henri|remy|rémy|paul|thomas|claude|google/i.test(v.name) ? 3 : 0) + (/fr-FR/i.test(v.lang) ? 1 : 0);
  vs.sort((a, b) => score(b) - score(a));
  return vs[0] ? vs[0].name : null;
}
function blobToB64(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); }); }
