// PERMIS VR — passe ton permis en réalité virtuelle (Meta Quest 3, WebXR) ou sur PC.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { City, N, RW, SW, SP, nodeX } from './city.js';
import { setupEnv } from './env.js';
import { loadCarTemplate, makeCar, Physics, carLOD } from './car.js';
import { Cockpit, EYE, CAR_LAYOUT } from './cockpit.js';
import { buildVehicle } from './vehicles.js';
import { buildInterior } from './interior.js';
import { loadInspector } from './inspector.js';
import { Traffic } from './traffic.js';
import { Exam } from './exam.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Voice } from './voice.js';
import { applyRainLook, Rain, Windshield } from './weather.js';
import { Highway } from './highway.js';
import { drawMap } from './debrief.js';
import { applyNight, Headlights, NIGHT } from './night.js';
import { setAnisotropy } from './assets.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local');
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 3000);
const audio = new Audio();
const voice = new Voice(); audio.voice = voice; voice.audio = audio;
const input = new Input(renderer);

let world = null;        // { city, env, traffic, quality }
let game = null;         // partie en cours
const params = new URLSearchParams(location.search);

// ---------- menu ----------
const qualSel = $('quality');
try { const q = localStorage.getItem('pvr.quality'); if (q) qualSel.value = q; } catch (e) { }
qualSel.onchange = () => { try { localStorage.setItem('pvr.quality', qualSel.value); } catch (e) { } };
if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then(ok => {
  if (ok) { $('vrExam').disabled = false; $('vrFree').disabled = false; $('vrNote').textContent = 'Casque détecté : mets-le et choisis un mode VR.'; }
  else $('vrNote').textContent = 'Pas de casque VR détecté : ouvre cette page dans le navigateur du Meta Quest 3 (connexion https requise).';
}).catch(() => { });
$('vrExam').onclick = () => launch('exam', true);
$('vrFree').onclick = () => launch('free', true);
$('pcExam').onclick = () => launch('exam', false);
$('pcFree').onclick = () => launch('free', false);
$('micBtn').onclick = async () => {
  const ok = await voice.enableMic();
  $('micBtn').textContent = ok ? '🎙️ Micro activé ✓' : '🎙️ ' + voice.micError;
  $('micBtn').disabled = ok;
};
if (navigator.permissions) navigator.permissions.query({ name: 'microphone' }).then(p => { if (p.state === 'granted') { $('micBtn').textContent = '🎙️ Micro activé ✓'; $('micBtn').disabled = true; } }).catch(() => { });

async function launch(mode, vr) {
  audio.start(); voice.initNeural();
  let session = null;
  if (vr) { // la session doit être demandée directement dans le geste de l'utilisateur
    try {
      session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking', 'layers'] });
    } catch (e) { alert('Impossible de démarrer la VR : ' + e.message); return; }
  }
  $('menu').classList.add('hidden'); $('loading').classList.remove('hidden');
  try { await ensureWorld(qualSel.value, params.get('meteo') || $('weather').value, params.get('nuit') ? 'night' : $('daytime').value); await startGame(mode); }
  catch (e) { console.error(e); $('loading').textContent = 'Erreur de chargement : ' + e.message; return; }
  $('loading').classList.add('hidden');
  if (session) {
    renderer.xr.setFramebufferScaleFactor(world.quality === 'ultra' ? 1.25 : world.quality === 'medium' ? 0.85 : 1.0);
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(world.quality === 'ultra' ? 0.2 : 0.45);
    game.needRecenter = 2;
    session.addEventListener('end', () => { location.reload(); });
  } else { $('hud').classList.remove('hidden'); }
}

async function ensureWorld(quality, weather = 'sun', daytime = 'day') {
  if (world) return;
  if (daytime === 'random') daytime = Math.random() < 0.4 ? 'night' : 'day';
  if (weather === 'random') weather = Math.random() < 0.45 ? 'rain' : 'sun';
  if (quality === 'medium') { renderer.shadowMap.enabled = true; }
  const env = await setupEnv(renderer, scene, quality);
  const city = new City(scene);
  const hw = new Highway(scene, city); city.hw = hw;
  await city.build(quality);
  await hw.build(weather === 'rain');
  const traffic = new Traffic(scene, city);
  const tpl = await loadCarTemplate('ace11');
  world = { env, city, traffic, quality, tpl, rain: null, hw, rainy: weather === 'rain' };
  await hw.initTraffic(quality === 'medium' ? 16 : 26);
  if (daytime === 'night') await applyNight(renderer, scene, env, city);
  if (weather === 'rain') { applyRainLook(scene, env, city); world.rain = new Rain(scene); audio.startRain(); }
  // compile les shaders tout de suite (évite les saccades au premier regard)
  renderer.compile(scene, camera);
}

// ---------- partie ----------
async function startGame(mode) {
  const { city, traffic, tpl } = world;
  if (game) { scene.remove(game.car.obj); }
  const vclass = params.get('permis') || ($('permis') && $('permis').value) || 'B';
  const car = vclass === 'B' ? makeCar(tpl, '#f4f4f2', { player: true }) : buildVehicle({ C: 'truck', D: 'bus', A: 'moto' }[vclass]);
  const LAY = car.layout || CAR_LAYOUT;
  scene.add(car.obj);
  const phys = new Physics(car);
  if (vclass === 'A') phys.handbrake = false;
  // départ : garé le long du trottoir droit, rue horizontale ligne 2, vers l'est
  phys.x = nodeX(1) + RW + 10 + car.tpl.size.z / 2 + (vclass === 'B' ? 16 : 6); phys.z = nodeX(2) + (RW - car.tpl.size.x / 2 - 0.1); phys.yaw = Math.PI / 2; phys.gear = 'P';
  phys.apply();
  let interior;
  if (vclass === 'B') { interior = buildInterior(car); car.steeringWheel = interior.wheelPivot; }
  else interior = car.interior;
  const inspector = LAY.passenger ? await loadInspector(car, LAY.passenger).catch(e => { console.warn(e); return null; }) : null;
  const cockpit = new Cockpit(car, renderer, world.quality);
  const windshield = world.rain && LAY.windshield ? new Windshield(car, LAY.windshield) : null;
  const headlights = new Headlights(car); headlights.set(0); phys.headMode = 0;
  // plaque « auto-école » sur le toit
  if (vclass === 'B') car.obj.add(makeSchoolSign(car));
  // rig de tête : caméra + manettes, à la place conducteur
  const rig = new THREE.Group(); rig.position.copy(LAY.eye); car.obj.add(rig);
  rig.add(camera); camera.position.set(0, 0, 0); camera.rotation.set(0, Math.PI, 0);
  const hands = [];
  const factory = new XRControllerModelFactory();
  for (let i = 0; i < 2; i++) {
    const grip = renderer.xr.getControllerGrip(i);
    grip.add(factory.createControllerModel(grip));
    const ctrl = renderer.xr.getController(i);
    ctrl.addEventListener('connected', (e) => { grip.userData.hand = e.data.handedness; });
    rig.add(grip, ctrl); hands.push(grip);
  }
  if (!traffic.cars.length) await traffic.init(world.quality === 'medium' ? 14 : 20, { x: phys.x, z: phys.z });
  else for (const a of traffic.cars) if (Math.hypot(a.x - phys.x, a.z - phys.z) < 30) { a.s = Math.max(0, a.s - 40); }
  const exam = new Exam({ city, traffic, hw: world.hw, rainy: world.rainy, vclass, audio, mode, mood: $('mood') ? $('mood').value : 'random' });
  voice.persona = exam.mood.persona; voice.rate = exam.mood.rate; voice.history = [];
  game = { vclass, LAY, mode, car, phys, cockpit, interior, inspector, windshield, headlights, rig, hands, exam, blink: null, blinkT: 0, blinkPhase: false, blinkPeak: 0, cam: 'in', frame: 0, scrT: 0, clT: 0, crashT: -9, curbT: -9, needRecenter: 0 };
  exam.onFinish = (r) => { r.first = mode === 'exam' && saveExam(r); if (r.first) { audio.beep('ok'); exam.speak(`Et voilà : vous avez votre permis ${r.vclass} ! Félicitations !`); } showResultCard(r); };
  exam.begin();
  const old = document.getElementById('resultCard'); if (old) old.remove();
}

// ---------- carnet de permis (historique, conservé dans ce navigateur) ----------
function loadCarnet() { try { return JSON.parse(localStorage.getItem('pvr.carnet') || '[]'); } catch (e) { return []; } }
function saveExam(r) {
  const all = loadCarnet();
  const first = r.ok && !all.some(x => x.v === r.vclass && x.ok);
  all.push({ v: r.vclass, ok: r.ok, n: r.noteN, d: Date.now(), m: r.mood.label });
  try { localStorage.setItem('pvr.carnet', JSON.stringify(all.slice(-200))); } catch (e) { }
  renderCarnet();
  return first;
}
function renderCarnet() {
  const el = $('carnet'); if (!el) return;
  const all = loadCarnet();
  const names = { B: '🚗 Voiture', C: '🚚 Camion', D: '🚌 Bus', A: '🏍️ Moto' };
  el.innerHTML = ['B', 'C', 'D', 'A'].map(v => {
    const t = all.filter(x => x.v === v), ok = t.some(x => x.ok), best = t.length ? Math.max(...t.map(x => x.n || 0)) : null;
    return `<div class="p ${ok ? 'ok' : ''}"><b>${v}</b>${names[v]}<br>${ok ? '✅ obtenu' : t.length ? `${t.length} essai${t.length > 1 ? 's' : ''}` : '—'}${best !== null ? ` · ${best}/31` : ''}</div>`;
  }).join('');
}
renderCarnet();

// fiche de résultat (PC) : grand plan + liste des fautes
function showResultCard(r) {
  if (renderer.xr.isPresenting) return;
  const card = document.createElement('div'); card.id = 'resultCard';
  card.style.cssText = 'position:fixed;inset:auto 16px 16px auto;z-index:8;background:rgba(8,13,24,.94);color:#e8eefb;border-radius:18px;padding:16px;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;font:14px Inter,Arial;box-shadow:0 20px 60px rgba(0,0,0,.5)';
  const cv = document.createElement('canvas'); cv.width = 520; cv.height = 520; cv.style.cssText = 'width:100%;border-radius:12px;display:block;margin:10px 0';
  const items = (r.faults || []).map((f, i) => `<div style="color:${f.elim ? '#ff6b6b' : f.forgiven ? '#8fa3c7' : '#ffc860'}">${i + 1}. ${f.label}${f.pts ? ` (−${f.pts})` : ''}</div>`).join('') || '<div>Aucune faute, conduite exemplaire !</div>';
  card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b style="font-size:30px;color:${r.ok ? '#2ecc71' : '#ff4d4f'}">${r.ok ? 'ADMIS' : 'AJOURNÉ'}</b><span>Permis ${r.vclass} · ${r.note}</span></div>${r.first ? `<div style="margin-top:8px;padding:10px;border-radius:12px;background:linear-gradient(120deg,#f6d1e1,#d9e6ff);color:#1d2a4a;font-weight:800">🎉 Nouveau permis ${r.vclass} obtenu ! Il est ajouté à ton carnet.</div>` : ''}<div style="opacity:.75;margin-top:4px">Inspecteur ${r.mood.emoji} ${r.mood.label} · durée ${Math.floor(r.time / 60)} min ${Math.round(r.time % 60)} s</div>`;
  card.appendChild(cv);
  const lst = document.createElement('div'); lst.innerHTML = items; card.appendChild(lst);
  const btn = document.createElement('div'); btn.style.cssText = 'margin-top:10px;opacity:.8'; btn.textContent = 'Entrée : recommencer · F : conduite libre · Échap : menu'; card.appendChild(btn);
  drawMap(cv.getContext('2d'), 0, 0, 520, r.city, r.trace || [], r.faults || []);
  document.body.appendChild(card);
}

function makeSchoolSign(car) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#fff'; g.font = '900 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('AUTO-ÉCOLE', 128, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.08), [m, m, new THREE.MeshStandardMaterial({ color: 0x1d4ed8 }), m, m, m]);
  s.position.set(0, car.tpl.size.y + 0.1, -0.2);
  s.castShadow = true;
  return s;
}

// vibration d'une manette (0 = gauche, 1 = droite)
function pulse(k, intensity, ms) {
  const s = renderer.xr.getSession(); if (!s) return;
  for (const src of s.inputSources) if (src.handedness === (k ? 'right' : 'left') && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]) { try { src.gamepad.hapticActuators[0].pulse(intensity, ms); } catch (e) { } }
}

// ---------- recentrage VR : place la tête du joueur à la place conducteur ----------
function recenter() {
  const xrCam = renderer.xr.getCamera();
  const p = camera.position.clone(), q = camera.quaternion.clone();
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  const yaw = e.y;
  game.rig.rotation.set(0, Math.PI - yaw, 0);
  const rp = p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - yaw);
  game.rig.position.copy(game.LAY.eye).sub(rp);
  void xrCam;
}

// ---------- boucle ----------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
renderer.setAnimationLoop(loop);
function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  if (!game) { renderer.render(scene, camera); return; }
  const G = game, { phys, cockpit, exam, car } = G;
  const xr = renderer.xr.isPresenting;
  const session = renderer.xr.getSession();
  const inp = input.read(dt, session ? session.inputSources : null);
  if (G.needRecenter > 0 && xr) { G.needRecenter--; if (G.needRecenter === 0) recenter(); }

  // ----- événements -----
  // pendant les questions de vérification : 1/2/3 (PC) ou X / Y / A (manettes)
  if (exam.state === 'quiz') {
    const map = [['ans1', 0], ['ans2', 1], ['ans3', 2]];
    if (xr) map.push(['blinkL', 0], ['blinkR', 1], ['gear', 2]);
    for (const [ev, i] of map) if (inp.events.has(ev)) { inp.events.delete(ev); exam.answer(i); break; }
    if (xr) { inp.events.delete('blinkL'); inp.events.delete('blinkR'); inp.events.delete('gear'); }
  }
  const kmh = Math.abs(phys.v) * 3.6;
  if (exam.state === 'done' && exam.mode === 'exam' && (inp.events.has('restart') || (xr && inp.events.has('gear')))) { startGame('exam'); return; }
  if (exam.state === 'done' && (inp.events.has('free') || (xr && inp.events.has('horn')))) { startGame('free'); return; }
  if (inp.events.has('restart') && exam.mode === 'free') { startGame('free'); return; }
  if (inp.events.has('menu')) { location.href = location.pathname; return; }
  const setGear = (g) => { if (g === phys.gear) return; if (g === 'P' && kmh > 2) return; if ((g === 'R' && phys.v > 1.5) || (g === 'D' && phys.v < -1.5)) return; phys.gear = g; audio.click(true); pulse(0, 0.5, 30); pulse(1, 0.5, 30); };
  if (inp.events.has('gear')) setGear(phys.gear === 'R' ? 'D' : 'R');
  if (inp.events.has('gearN')) setGear('N');
  if (inp.events.has('lights')) { G.headlights.cycle(); phys.headMode = G.headlights.mode; audio.click(true); }
  if (inp.events.has('handbrake')) { phys.handbrake = !phys.handbrake; audio.click(false); }
  // frein à main électrique : se desserre tout seul quand on accélère en D ou R
  if (phys.handbrake && (phys.gear === 'D' || phys.gear === 'R') && inp.throttle > 0.3) { phys.handbrake = false; audio.click(true); }
  // accélérer en P : passe tout seul en D (boîte automatique)
  if (phys.gear === 'P' && inp.throttle > 0.3 && !G.leverHeld) { phys.gear = 'D'; audio.click(true); }
  if (inp.events.has('park') && kmh < 2) { phys.gear = 'P'; audio.click(true); }
  if (inp.events.has('blinkL')) { G.blink = G.blink === 'L' ? null : 'L'; G.blinkPeak = 0; G.blinkT = 0; }
  if (inp.events.has('blinkR')) { G.blink = G.blink === 'R' ? null : 'R'; G.blinkPeak = 0; G.blinkT = 0; }
  if (inp.events.has('cam') && !xr) G.cam = G.cam === 'in' ? 'out' : 'in';
  if (inp.events.has('recenter')) { if (xr) recenter(); else input.look.yaw = input.look.pitch = 0; }

  // ----- parler à l'inspecteur (T maintenu / joystick droit vers l'avant) -----
  const ask = async (text) => {
    exam.heard = text;
    const reply = await voice.answer(text, examContext(G));
    exam.speak(reply, false); voice.say(reply, true);
  };
  if (inp.talk && !G.talking) {
    G.talking = true; voice.lastError = null;
    voice.startTalk().then(ok => {
      if (ok !== false || xr) return;
      // PC sans micro : on écrit sa question
      G.talking = false; input.keys.clear();
      askBox((voice.micError || 'Micro indisponible') + ' — écris ta question :', (q) => { input.keys.clear(); clock.getDelta(); if (q) ask(q); });
    });
  }
  if (!inp.talk && G.talking) {
    G.talking = false;
    voice.endTalk().then(async (text) => {
      if (!text) { exam.speak(voice.micError || voice.lastError || 'Je ne vous ai pas entendu. Maintenez le bouton pendant que vous parlez.', false); return; }
      exam.heard = text;
      const reply = await voice.answer(text, examContext(G));
      exam.speak(reply, false); voice.say(reply, true);
    });
  }

  // ----- volant -----
  car.obj.updateMatrixWorld(true);
  const handStates = [null, null];
  if (xr) for (const g of G.hands) {
    const hnd = g.userData.hand; if (!hnd) continue;
    const k = hnd === 'left' ? 0 : 1; const st = inp.hands[k];
    if (!st) continue;
    g.getWorldPosition(tmpV);
    handStates[k] = { pos: tmpV.clone(), grip: st.grip };
  }
  // ----- mains sur le levier de vitesses / le frein à main -----
  G.handGrab = G.handGrab || [null, null]; G.leverHeld = false; G.leverZ = undefined;
  const ORDER = ['P', 'R', 'N', 'D'];
  for (let k = 0; k < 2; k++) {
    const h = handStates[k];
    if (!h || !h.grip) { G.handGrab[k] = null; continue; }
    const lp = h.pos.clone().applyMatrix4(car.obj.matrixWorld.clone().invert());
    if (!G.handGrab[k]) {
      if (lp.distanceTo(G.interior.leverKnob()) < 0.14) G.handGrab[k] = { type: 'lever', z0: lp.z, g0: ORDER.indexOf(phys.gear) };
      else if (lp.distanceTo(G.interior.hbHandle()) < 0.14) G.handGrab[k] = { type: 'hb', y0: lp.y };
      else G.handGrab[k] = { type: 'wheel' };
      if (G.handGrab[k].type !== 'wheel') pulse(k, 0.3, 25);
    }
    const gr = G.handGrab[k];
    if (gr.type === 'lever') {
      const dz = THREE.MathUtils.clamp(lp.z - gr.z0, -0.12, 0.12);
      const idx = THREE.MathUtils.clamp(Math.round(gr.g0 - dz / 0.03), 0, 3);
      setGear(ORDER[idx]);
      G.leverHeld = true; G.leverZ = THREE.MathUtils.clamp(({ P: 0.045, R: 0.015, N: -0.015, D: -0.045 })[ORDER[gr.g0]] + dz, -0.05, 0.05);
      handStates[k] = null;
    } else if (gr.type === 'hb') {
      const dy = lp.y - gr.y0;
      if (dy > 0.05 && !phys.handbrake) { phys.handbrake = true; audio.click(false); pulse(k, 0.8, 60); }
      if (dy < -0.04 && phys.handbrake) { phys.handbrake = false; audio.click(true); pulse(k, 0.6, 40); }
      handStates[k] = null;
    }
  }
  const wheel = cockpit.updateWheel(dt, handStates, inp.steer, kmh);

  // ----- physique -----
  const prevX = phys.x, prevZ = phys.z, prevYaw = phys.yaw;
  phys.step(dt, { throttle: inp.throttle, brake: inp.brake, wheel });
  phys.brakeLight = inp.brake > 0.1 || phys.gear === 'P';
  collide(G, prevX, prevZ, prevYaw);
  // clignotants : tic-tac + annulation automatique au retour du volant
  if (G.blink) {
    G.blinkT += dt; const ph = (G.blinkT % 0.76) < 0.38;
    if (ph !== G.blinkPhase) { G.blinkPhase = ph; audio.click(ph); }
    const s = G.blink === 'L' ? wheel : -wheel;
    G.blinkPeak = Math.max(G.blinkPeak, s);
    if (G.blinkPeak > 2.2 && s < 0.6) G.blink = null;
  } else G.blinkPhase = false;
  phys.blinkOn = G.blink && G.blinkPhase;
  phys.apply();
  if (G.inspector) G.inspector.update(dt, { speaking: voice.speaking, turn: exam.instr && exam.approach && exam.approach.dist < 45 && exam.instr.turn !== 'straight' ? exam.instr.turn : null });
  if (car.lean) { const lat = phys.v * phys.v * Math.tan(phys.steer) / (car.tpl.wheelbase * 9.81); G.lean = (G.lean || 0) + (THREE.MathUtils.clamp(Math.atan(lat), -0.7, 0.7) - (G.lean || 0)) * Math.min(1, dt * 6); car.lean.rotation.z = -G.lean; car.obj.rotation.z = 0; }
  G.interior.update({ brake: inp.brake, throttle: inp.throttle, blink: G.blink, gear: phys.gear, handbrake: phys.handbrake, leverZ: G.leverHeld ? G.leverZ : undefined });
  car.obj.updateMatrixWorld(true);

  // ----- monde -----
  world.city.update(dt);
  if (world.rain) world.rain.update(dt, car.obj.position);
  if (G.windshield) { if (inp.events.has('wipers')) G.windshield.on = !G.windshield.on; G.windshield.update(dt, kmh, true); }
  world.traffic.update(dt, { x: phys.x, z: phys.z, yaw: phys.yaw, v: phys.v, len: car.tpl.size.z, half: car.tpl.size.x / 2 });
  for (const h of world.traffic.honks.splice(0)) { const d = Math.hypot(h.x - phys.x, h.z - phys.z); if (d < 60) { audio.honk(d); if (d < 15) exam.react('honk'); } }
  world.hw.updateTraffic(dt, { x: phys.x, z: phys.z, v: phys.v, len: car.tpl.size.z }, world.rainy);
  // regard (repère voiture)
  camera.getWorldPosition(tmpV); camera.getWorldQuaternion(tmpQ);
  const inv = car.obj.matrixWorld.clone().invert();
  const headL = tmpV.clone().applyMatrix4(inv);
  const dirW = new THREE.Vector3(0, 0, -1).applyQuaternion(tmpQ);
  const carQ = car.obj.getWorldQuaternion(new THREE.Quaternion());
  const dirL = dirW.applyQuaternion(carQ.invert());
  exam.updateLook(headL, dirL, { center: cockpit.mirrorLocal('center'), left: cockpit.mirrorLocal('left'), right: cockpit.mirrorLocal('right') });
  exam.update(dt, phys, inp, G.blink);
  audio.update(phys.rpm, kmh, inp.throttle, inp.hornHeld);

  // ----- caméra PC -----
  if (!xr && G.cam !== 'debug') {
    if (G.cam === 'in') {
      G.rig.position.copy(G.LAY.eye); G.rig.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0); camera.rotation.set(input.look.pitch, Math.PI + input.look.yaw, 0, 'YXZ');
      camera.fov = 72;
    } else {
      const k = Math.max(1, car.tpl.size.z / 4.1); G.rig.position.set(0, 2.6 * Math.max(1, k * 0.7), -4.5 - 2 * k * 1.1); G.rig.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0); camera.rotation.set(-0.2 + input.look.pitch * 0.5, Math.PI + input.look.yaw, 0, 'YXZ');
    }
    camera.updateProjectionMatrix();
  }

  // ----- écrans (rafraîchis à cadence réduite) -----
  G.clT -= dt; G.scrT -= dt;
  if (G.clT <= 0) {
    G.clT = 0.1;
    const cst = { lights: G.headlights.mode, pc: !xr, handbrake: phys.handbrake, rpm: phys.rpm, kmh, gear: phys.gear, limit: exam.limit, blink: G.blink, blinkPhase: G.blinkPhase };
    cockpit.drawCluster(cst); cockpit.drawHUD(cst);
  }
  if (G.scrT <= 0) {
    G.scrT = 0.25;
    const si = exam.screenInfo(phys); if (voice.recording) si.say = '🎙️ Je vous écoute… (relâchez pour envoyer)'; else if (voice.busy) si.say = "… (l'inspecteur réfléchit)"; else if (voice.neural === 'loading' && exam.t < 120) si.say = (si.say ? si.say + '  —  ' : '') + `Voix de l'inspecteur : téléchargement ${Math.round(voice.neuralP * 100)} %`;
    else if (exam.heard && exam.t - exam.sayT < 9) si.say = 'Vous : ' + exam.heard + ' — ' + si.say;
    cockpit.drawScreen(si); cockpit.scrTex.needsUpdate = true;
    if (!xr) $('hud').innerHTML = `${Math.round(kmh)} km/h · ${phys.gear} · ${G.blink ? 'clignotant ' + (G.blink === 'L' ? 'gauche' : 'droit') : ''}<br>Clic maintenu : regarder · C : vue extérieure · Échap : menu`;
  }

  world.env.follow(car.obj.position);
  G.frame++;
  cockpit.renderMirrors(scene, G.frame);
  renderer.render(scene, camera);
}

// case de saisie dans la page (prompt() est interdit dans certains navigateurs)
function askBox(label, cb) {
  let box = document.getElementById('askBox');
  if (!box) {
    box = document.createElement('form'); box.id = 'askBox';
    box.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:9;background:rgba(10,16,30,.92);padding:12px;border-radius:14px;display:flex;gap:8px;align-items:center;width:min(640px,92vw);font:14px Inter,Arial;color:#cfe0ff';
    box.innerHTML = '<span id="askLbl" style="flex:0 1 auto;max-width:42%"></span><input id="askIn" style="flex:1;min-width:0;font:inherit;padding:8px 10px;border-radius:8px;border:0" autocomplete="off"><button style="font:inherit;padding:8px 12px;border:0;border-radius:8px;background:#2f6bff;color:#fff">Envoyer</button>';
    document.body.appendChild(box);
  }
  box.style.display = 'flex'; document.getElementById('askLbl').textContent = label;
  const inp = document.getElementById('askIn'); inp.value = ''; setTimeout(() => inp.focus(), 30);
  const close = (v) => { box.style.display = 'none'; box.onsubmit = null; inp.onkeydown = null; cb(v); };
  box.onsubmit = (e) => { e.preventDefault(); close(inp.value.trim()); };
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(''); };
  inp.onkeyup = (e) => e.stopPropagation();
}

function examContext(G) {
  const e = G.exam, p = G.phys;
  const ins = e.instr ? { left: 'tourner à gauche', right: 'tourner à droite', straight: 'continuer tout droit' }[e.instr.turn] + ' au prochain carrefour' : (e.state === 'park' ? 'se garer à droite puis passer en P' : e.state === 'start' ? 'démarrer (D, clignotant gauche, angle mort)' : 'aucune');
  return `mode ${e.mode === 'exam' ? 'examen' : 'conduite libre'} ; étape ${e.state} ; consigne : ${ins} ; vitesse ${Math.round(Math.abs(p.v) * 3.6)} km/h (limite ${e.limit || 50}) ; rapport ${p.gear} ; manœuvres réussies ${e.maneuvers}/${e.target === Infinity ? '-' : e.target} ; fautes : ${e.faults.map(f => f.label).join(', ') || 'aucune'}${e.state === 'done' && e.result ? ' ; résultat : ' + (e.result.ok ? 'admis' : 'ajourné') + ', ' + e.result.note : ''}.`;
}

// ---------- collisions du joueur ----------
function collide(G, px, pz, pyaw) {
  const { phys, exam } = G;
  const city = world.city;
  const t = exam.t;
  const lim = (N - 1) / 2 * SP + RW + SW + 0.5, hw = world.hw;
  let hit = false;
  for (const [x, z] of phys.corners()) {
    const outside = Math.abs(x) > lim || Math.abs(z) > lim || (Math.abs(x) > city.ext - 0.5 && hw.onLinkArea(x, z));
    if (outside ? !hw.drivable(x, z) : city.hitsSolid(x, z)) { hit = true; break; }
  }
  if (hit) {
    phys.x = px; phys.z = pz; phys.yaw = pyaw;
    if (Math.abs(phys.v) > 1.5 && t - G.crashT > 3) { G.crashT = t; audio.beep('crash'); exam.fault('crash'); }
    phys.v = 0;
    return;
  }
  // trottoir
  let curb = false;
  const heavy = G.vclass === 'C' || G.vclass === 'D';
  for (const [x, z] of phys.corners(-0.15).filter((_, i) => !heavy || i === 0 || i === 1 || i === 4)) {
    if (Math.abs(x) > lim || Math.abs(z) > lim || (Math.abs(x) > city.ext - 0.5 && hw.onLinkArea(x, z))) continue; // hors ville : géré par l'autoroute
    if (city.onSidewalk(x, z)) { curb = true; break; }
  }
  if (curb) {
    phys.v *= 0.96;
    if (Math.abs(phys.v) > 0.8 && t - G.curbT > 6) { G.curbT = t; exam.fault('curb'); }
  }
  // autres voitures
  const c = Math.cos(phys.yaw), s = Math.sin(phys.yaw);
  const hx = phys.car.tpl.size.x / 2, hz = phys.car.tpl.size.z / 2;
  for (const a of world.traffic.cars) {
    const rx = a.x - phys.x, rz = a.z - phys.z;
    if (rx * rx + rz * rz > 64) continue;
    const lx = rx * c - rz * s, lz = rx * s + rz * c;
    const dyaw = Math.abs(Math.sin(a.yaw - phys.yaw));
    const ahx = a.half * (1 - dyaw) + a.len / 2 * dyaw, ahz = a.len / 2 * (1 - dyaw) + a.half * dyaw;
    if (Math.abs(lx) < hx + ahx - 0.15 && Math.abs(lz) < hz + ahz - 0.2) {
      phys.x = px; phys.z = pz; phys.yaw = pyaw;
      if (a.fou && !(Math.abs(phys.v) > 3 && lz > 0)) { if (t - G.crashT > 3) { G.crashT = t; audio.beep('crash'); exam.reactT = -99; exam.react('victim'); } phys.v = 0; a.v = 0; return; }
      if (t - G.crashT > 3) { G.crashT = t; audio.beep('crash'); exam.fault('crash'); }
      phys.v = 0; a.v = 0;
      return;
    }
  }
  for (const a of world.hw.cars) {
    const rx = a.x - phys.x, rz = a.z - phys.z;
    if (rx * rx + rz * rz > 64) continue;
    const lx = rx * c - rz * s, lz = rx * s + rz * c;
    if (Math.abs(lx) < hx + a.half - 0.15 && Math.abs(lz) < hz + a.len / 2 - 0.2) {
      phys.x = px; phys.z = pz; phys.yaw = pyaw;
      if (t - G.crashT > 3) { G.crashT = t; audio.beep('crash'); exam.fault('crash'); }
      phys.v = 0; a.v = Math.min(a.v, 3);
      return;
    }
  }
  for (const a of world.traffic.parked) {
    if (!a.street) continue;
    const rx = a.x - phys.x, rz = a.z - phys.z;
    if (rx * rx + rz * rz > 64) continue;
    const lx = rx * c - rz * s, lz = rx * s + rz * c;
    const dyaw = Math.abs(Math.sin(a.yaw - phys.yaw));
    const ahx = a.half * (1 - dyaw) + a.len / 2 * dyaw, ahz = a.len / 2 * (1 - dyaw) + a.half * dyaw;
    if (Math.abs(lx) < hx + ahx - 0.12 && Math.abs(lz) < hz + ahz - 0.12) {
      const slow = Math.abs(phys.v) < 3;
      phys.x = px; phys.z = pz; phys.yaw = pyaw;
      if (t - G.crashT > 3) { G.crashT = t; audio.beep(slow ? 'warn' : 'crash'); exam.fault(slow ? 'touch' : 'crash'); }
      phys.v = 0;
      return;
    }
  }
  for (const p of world.traffic.peds) {
    const rx = p.x - phys.x, rz = p.z - phys.z;
    const lx = rx * c - rz * s, lz = rx * s + rz * c;
    if (Math.abs(lx) < hx + 0.3 && Math.abs(lz) < hz + 0.3 && Math.abs(phys.v) > 0.5) {
      phys.v = 0; phys.x = px; phys.z = pz;
      if (t - G.crashT > 3) { G.crashT = t; audio.beep('crash'); exam.fault('crash'); }
    }
  }
}

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / Math.max(1, innerHeight); camera.updateProjectionMatrix();
});
// le volet d'aperçu peut démarrer avec une taille nulle
setInterval(() => { if (!renderer.xr.isPresenting && (canvas.width === 0 || Math.abs(camera.aspect - innerWidth / Math.max(1, innerHeight)) > 0.01)) dispatchEvent(new Event('resize')); }, 1000);

// lancement direct pour les tests : ?play=exam|free
if (params.get('play')) launch(params.get('play'), false);
window.__look = (x, y, z, tx, ty, tz) => { const G = game; G.cam = 'debug'; scene.attach(G.rig); G.rig.position.set(x, y, z); G.rig.rotation.set(0, 0, 0); camera.position.set(0, 0, 0); camera.lookAt(tx, ty, tz); };
window.__pvr = () => ({ game, world, THREE, camera, renderer, voice });
