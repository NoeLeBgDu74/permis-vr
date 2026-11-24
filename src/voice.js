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
  say(text, priority = false) {
    if (!text) return;
    if (priority) this.stop();
    this.queue = this.queue.then(() => this.speakNow(text)).catch(() => { });
  }
  stop() {
    if (this.audioEl) { try { this.audioEl.pause(); } catch (e) { } }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.queue = Promise.resolve();
  }
  async speakNow(text) {
    this.speaking = true;
    try {
      if (this.caps.tts) {
        const r = await fetch(RELAY + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        if (r.ok) {
          const url = URL.createObjectURL(await r.blob());
          await new Promise(res => { const a = this.audioEl = new Audio(url); a.onended = a.onerror = res; a.play().catch(res); });
          URL.revokeObjectURL(url); return;
        }
        this.caps.tts = false; // voix serveur indisponible : repli sur la voix de l'appareil
      }
      await this.browserSay(text);
    } finally { this.speaking = false; }
  }
  browserSay(text) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) return res();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR'; u.rate = 1.0; u.pitch = 0.92;
      const v = speechSynthesis.getVoices().find(x => x.name === this.voiceName); if (v) u.voice = v;
      u.onend = u.onerror = res; speechSynthesis.speak(u);
      setTimeout(res, 400 + text.length * 90);
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
      return;
    }
    try {
      this.stream = this.stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      this.chunks = []; this.mime = mime;
      const mr = this.mr = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      mr.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      mr.start();
    } catch (e) { this.recording = false; this.status = 'Micro indisponible (autorise le micro).'; }
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
    if (blob.size < 2500) return '';
    this.status = '…';
    try {
      const b64 = await blobToB64(blob);
      const r = await fetch(RELAY + '/api/stt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: b64, mime: blob.type }) });
      const j = await r.json();
      return (j.text || '').trim();
    } catch (e) { return ''; }
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
