// Examen du permis : itinéraire guidé par l'inspecteur, contrôle des règles, fautes et note sur 31.
import * as THREE from 'three';
import { N, RW, LO, SP, RO, RC, nodeX, DIRS, dirOf, dirKey, turnOf, turnDir } from './city.js';
import { roundClear } from './traffic.js';
import { MOODS, randomMood, pick } from './moods.js';
import { TALK, ELIM_END, FREE_ELIM, REACT } from './talk.js';
import { at as hwAt, PER as HW_PER } from './highway.js';
import { NIGHT } from './night.js';
import { pickQuestions } from './quiz.js';

const FAULTS = {
  blink: { label: 'Clignotant non utilisé avant de tourner', pts: 1 },
  blinkStart: { label: 'Pas de clignotant au démarrage', pts: 1 },
  mirror: { label: 'Rétroviseurs non contrôlés avant de tourner', pts: 1 },
  blind: { label: 'Angle mort non contrôlé au démarrage', pts: 1 },
  speed: { label: 'Vitesse excessive', pts: 2 },
  left: { label: 'Mauvais placement : trop à gauche', pts: 2 },
  curb: { label: 'Montée sur le trottoir', pts: 2 },
  orange: { label: 'Feu orange franchi', pts: 1 },
  park: { label: 'Arrêt final loin du trottoir', pts: 1 },
  blinkExit: { label: 'Clignotant droit oublié en sortie de rond-point', pts: 1 },
  creneau: { label: 'Créneau raté', pts: 2 },
  creneauAvant: { label: 'Créneau fait en marche avant', pts: 1 },
  touch: { label: 'Contact avec un véhicule en stationnement', pts: 2 },
  blinkLane: { label: 'Changement de voie sans clignotant', pts: 1 },
  keepRight: { label: 'Circulation prolongée sur la voie de gauche', pts: 1 },
  distance: { label: 'Distance de sécurité insuffisante', pts: 2 },
  stopHW: { label: 'Ralentissement / arrêt injustifié sur autoroute', pts: 2 },
  bau: { label: 'Circulation sur la bande d\'arrêt d\'urgence', pts: 2 },
  insertion: { label: 'Insertion trop lente sur l\'autoroute', pts: 1 },
  lights: { label: 'Circulation de nuit sans les feux', pts: 2 },
  brake: { label: 'Freinage brusque', pts: 1 },
  slow: { label: 'Manque d\'allure', pts: 1 },
  // éliminatoires
  red: { label: 'Feu rouge grillé', elim: true },
  stop: { label: 'Stop non marqué (arrêt complet obligatoire)', elim: true },
  priority: { label: 'Refus de priorité', elim: true },
  ped: { label: 'Priorité piéton non respectée', elim: true },
  crash: { label: 'Collision', elim: true },
  wrongway: { label: 'Circulation à contresens', elim: true },
  bigspeed: { label: 'Grand excès de vitesse', elim: true },
};
const TURN_TXT = { left: 'tournez à gauche', right: 'tournez à droite', straight: 'continuez tout droit' };
const ROUND_TXT = { right: 'prenez la première sortie', straight: 'prenez la deuxième sortie', left: 'prenez la troisième sortie' };
const turnText = (n, t) => (n && n.type === 'round' ? ROUND_TXT : TURN_TXT)[t];

export class Exam {
  constructor({ city, traffic, hw, rainy, vclass, audio, mode, mood }) {
    this.hw = hw; this.rainy = !!rainy; this.vclass = vclass || 'B'; this.withHW = !!hw; this.hwDone = false;
    this.moodKey = mood && MOODS[mood] ? mood : randomMood(); this.mood = MOODS[this.moodKey]; this.chatT = 25 + Math.random() * 20;
    this.city = city; this.traffic = traffic; this.audio = audio; this.mode = mode; // 'exam' | 'free'
    this.faults = []; this.cool = {}; this.t = 0;
    this.state = 'start';      // start → drive → park → done
    this.say = ''; this.sayT = 0;
    this.instr = null; this.maneuvers = 0; this.target = mode === 'exam' ? (hw ? 4 : 7) : Infinity;
    this.prevLoc = null; this.approach = null; this.inNode = null;
    this.look = { center: -99, left: -99, right: -99, shoulderL: -99, shoulderR: -99 };
    this.blinkSeen = { L: -99, R: -99 };
    this.minSpeedApproach = Infinity;
    this.leftTime = 0; this.wrongTime = 0; this.overT = 0; this.slowT = 0;
    this.result = null;
  }
  speak(text, voice = true) { this.say = text; this.sayT = this.t; if (voice) this.audio.say(text); }

  begin() {
    const veh = { B: '', C: ' Aujourd\'hui : permis poids lourd. Attention au gabarit dans les virages, prenez large.', D: ' Aujourd\'hui : permis transport en commun. Douceur, pensez à vos passagers.', A: ' Aujourd\'hui : permis moto. Je vous suis en voiture et je vous guide à la radio.' }[this.vclass] || '';
    if (NIGHT.on) this.nightHint = ' Il fait nuit : n\'oubliez pas d\'allumer vos phares.';
    if (this.mode === 'exam') { this.startText = (this.vclass === 'A' ? 'Passez en D, clignotant gauche, contrôle de l\'angle mort, puis démarrez.' : 'Passez en D, desserrez le frein à main, mettez le clignotant gauche, contrôlez votre rétroviseur et votre angle mort, puis démarrez doucement.'); this.state = 'quiz'; this.quiz = pickQuestions(); this.qi = 0; this.speak(pick(this.mood.hello) + veh + (this.nightHint || '') + ' Avant de partir, deux petites questions. ' + this.questionText()); return; }
    if (this.mode === 'exam') this.speak(pick(this.mood.hello) + veh + (this.nightHint || '') + (this.vclass === 'A' ? ' Passez en D, clignotant gauche, contrôle de l\'angle mort, puis démarrez.' : ' Passez en D, desserrez le frein à main, mettez le clignotant gauche, contrôlez votre rétroviseur et votre angle mort, puis démarrez doucement.'));
    else this.speak('Conduite libre : roulez où vous voulez. Je vous signale les erreurs pour vous entraîner.');
  }

  fault(key, extra = '') {
    if (this.state === 'done') return;
    const F = FAULTS[key];
    if (this.cool[key] && this.t - this.cool[key] < 8) return;
    this.cool[key] = this.t;
    // humeur : un inspecteur fatigué ou distrait peut ne pas voir un oubli de contrôle ; un inspecteur indulgent accorde parfois une faute légère
    if (!F.elim && ['mirror', 'blind', 'blinkStart', 'blink', 'blinkExit'].includes(key) && Math.random() < this.mood.blindSpot) return;
    if (!F.elim && this.mode === 'exam' && Math.random() < this.mood.forgive && this.mood.forgiveLines.length) {
      this.faults.push({ key, label: F.label + extra + ' — accordée', pts: 0, elim: false, t: this.t, forgiven: true, x: this.pos && this.pos[0], z: this.pos && this.pos[1] });
      this.audio.beep('warn'); this.speak(pick(TALK[key] || [F.label + '.']) + ' ' + pick(this.mood.forgiveLines)); return;
    }
    const f = { key, label: F.label + extra, pts: F.pts || 0, elim: !!F.elim, t: this.t, x: this.pos && this.pos[0], z: this.pos && this.pos[1] };
    this.faults.push(f);
    this.audio.beep(f.elim ? 'elim' : 'warn');
    if (f.elim) {
      const line = pick(TALK[key] || [F.label + '.']);
      if (this.mode === 'exam') { this.speak(line + ' ' + pick(ELIM_END)); this.finish(); }
      else this.speak(line + ' ' + pick(FREE_ELIM));
    } else {
      // réaction humaine (pas toujours pendant l'examen : un inspecteur note souvent en silence)
      const talk = this.mode === 'free' || Math.random() < (REACT[this.moodKey] ?? 0.5);
      this.speak(pick(TALK[key] || [F.label + '.']), talk);
    }
  }

  finish() {
    const pen = this.faults.reduce((s, f) => s + f.pts, 0);
    const elim = this.faults.find(f => f.elim);
    const note = Math.max(0, 31 - pen);
    const ok = !elim && note >= 20;
    this.state = 'done';
    const lines = this.faults.length ? this.faults.map(f => (f.elim ? '⛔ ' : '• ') + f.label + (f.pts ? ` (−${f.pts})` : '')) : ['Aucune faute, conduite exemplaire !'];
    this.result = { ok, noteN: note, note: `Note : ${note} / 31${elim ? ' — faute éliminatoire' : ''}`, lines, hint: 'A / Entrée : recommencer   ·   B / F : conduite libre', trace: this.trace || [], faults: this.faults.slice(), city: this.city, vclass: this.vclass, mood: this.mood, elim: !!elim, time: this.t };
    if (this.onFinish) this.onFinish(this.result);
    if (!elim) this.speak(ok ? `Vous avez obtenu ${note} sur 31. ${this.mood.pass}` : `Vous avez ${note} sur 31, il faut au moins 20. ${this.mood.fail}`);
    this.audio.beep(ok ? 'ok' : 'elim');
  }

  // regards (repère voiture) : direction de la tête + positions des miroirs
  updateLook(headPos, headDir, mirrors) {
    const yaw = Math.atan2(headDir.x, headDir.z); // 0 = devant, + = vers la gauche
    for (const [name, p] of Object.entries(mirrors)) {
      if (!p) continue;
      const d = p.clone().sub(headPos).normalize();
      if (d.angleTo(headDir) < 0.3) this.look[name] = this.t;
    }
    if (yaw > 1.15) this.look.shoulderL = this.t;
    if (yaw < -1.15) this.look.shoulderR = this.t;
  }

  // car : Physics ; ctl : commandes ; blink : 'L'|'R'|null
  update(dt, car, ctl, blink) {
    this.t += dt;
    this.pos = [car.x, car.z]; this.trace = this.trace || [];
    if (this.state !== 'done' && (!this.trace.length || Math.hypot(car.x - this.trace[this.trace.length - 1][0], car.z - this.trace[this.trace.length - 1][1]) > 4)) this.trace.push([car.x, car.z]);
    if (blink) this.blinkSeen[blink] = this.t;
    // de nuit : feux obligatoires
    if (NIGHT.on && !car.headMode && Math.abs(car.v) > 1.5) { this.darkT = (this.darkT || 0) + dt; if (this.darkT > 4) { this.fault('lights'); this.darkT = -6; } } else if (car.headMode) this.darkT = 0;
    // un chauffard passe à toute vitesse près de nous ?
    if (this.state !== 'done') for (const a of [...this.traffic.cars, ...(this.hw ? this.hw.cars : [])]) {
      if (!a.fou) continue;
      const d = Math.hypot(a.x - car.x, a.z - car.z);
      if (d < 22 && a.v > 15) { this.react('fou'); break; }
    }
    // bavardage selon l'humeur (seulement quand tout est calme)
    if (this.mood.chat && this.state === 'drive' && this.mood.chatLines.length) {
      this.chatT -= dt;
      if (this.chatT <= 0 && this.t - this.sayT > 12 && (!this.approach || this.approach.dist > 60)) { this.chatT = this.mood.chat * (0.7 + Math.random() * 0.6); this.speak(pick(this.mood.chatLines)); }
    }
    if (this.state === 'done') return;
    const kmh = Math.abs(car.v) * 3.6;
    const f = car.forward();
    const loc = this.city.locate(car.x, car.z);

    // on démarre pendant les questions : on les abandonne
    if (this.state === 'quiz' && kmh > 6) { this.state = 'start'; this.speak('Bon, on verra les questions plus tard.'); }
    // départ : clignotant + angle mort avant de quitter le trottoir
    if (this.state === 'start') {
      if (kmh > 6) {
        if (this.mode === 'exam') {
          if (this.t - this.blinkSeen.L > 10) this.fault('blinkStart');
          if (this.t - this.look.shoulderL > 10 && this.t - this.look.left > 10) this.fault('blind');
        }
        this.state = 'drive';
        if (this.mode === 'exam') this.speak('Très bien. Suivez la route, je vous indiquerai la direction.');
      }
    }

    // ---- sur un tronçon ----
    let limit = 50;
    if (loc.type === 'seg') {
      const sgnRaw = loc.axis === 'x' ? f.x : f.z;
      const sgn = Math.sign(sgnRaw) || 1;
      limit = this.city.limitOf(loc.axis, loc.line, loc.a);
      // décalage vers la droite (positif = dans sa voie)
      const right = loc.axis === 'x' ? loc.lat * sgn : -loc.lat * sgn;
      this.rightOff = right;
      const aligned = Math.abs(sgnRaw) > 0.8;
      if (aligned && kmh > 4 && this.state !== 'done') {
        if (right < -0.2) { this.leftTime += dt; if (this.leftTime > 1.4) this.fault('left'); } else this.leftTime = 0;
        if (right < -LO + 0.3) { this.wrongTime += dt; if (this.wrongTime > 4) this.fault('wrongway'); } else this.wrongTime = 0;
      }
      // approche du prochain nœud
      const ni = loc.axis === 'x' ? loc.a + (sgn > 0 ? 1 : 0) : loc.line;
      const nj = loc.axis === 'x' ? loc.line : loc.a + (sgn > 0 ? 1 : 0);
      const B = this.city.node(ni, nj);
      const dk = dirKey(loc.axis, sgn);
      if (!this.approach || this.approach.n !== B || this.approach.dk !== dk) { this.approach = { n: B, dk, axis: loc.axis, minV: Infinity, lightAtLine: null }; }
      const ap = this.approach;
      const distC = loc.axis === 'x' ? Math.abs(B.x - car.x) : Math.abs(B.z - car.z);
      const sd = this.city.stopDist(B, dk);
      const toLine = distC - sd - car.car.tpl.size.z / 2;
      ap.toLine = toLine; ap.dist = distC;
      if (toLine < 14) ap.minV = Math.min(ap.minV, kmh);
      // franchissement de la ligne d'arrêt
      if (toLine < 0 && !ap.crossed) {
        ap.crossed = true; ap.vAtLine = kmh;
        const ctl = this.city.controlFor(B, loc.axis);
        if (ctl === 'light') {
          const st = this.city.lightState(B, loc.axis);
          if (st === 'R') this.fault('red');
          else if (st === 'O' && ap.orangeFrom !== undefined && ap.orangeFrom > kmh * kmh / 260 + 4) this.fault('orange');
        }
        if (ctl === 'stop' && ap.minV > 1.5) this.fault('stop');
        // priorités
        if (ctl === 'stop' || ctl === 'yield') { if (this.conflict(B, loc.axis, dk, 'minor')) this.fault('priority'); }
        else if (ctl === 'right') { if (this.conflict(B, loc.axis, dk, 'right')) this.fault('priority'); }
        else if (ctl === 'round') {
          const d = dirOf(dk), k = Math.sqrt(RC * RC - LO * LO), rx = -d.dz, rz = d.dx;
          const thIn = Math.atan2(rz * LO - d.dz * k, rx * LO - d.dx * k);
          const bodies = this.traffic.cars.map(a => ({ x: a.x, z: a.z, v: a.v }));
          if (!roundClear(B, thIn, bodies, null)) this.fault('priority');
        }
      }
      if (this.city.controlFor(B, loc.axis) === 'light') {
        const st = this.city.lightState(B, loc.axis);
        if (st === 'O' && ap.orangeFrom === undefined) ap.orangeFrom = toLine;
        if (st !== 'O') ap.orangeFrom = undefined;
      }
      // instruction à donner
      if (this.mode === 'exam' && (this.state === 'drive' || this.state === 'nav' || this.state === 'navHW') && (!this.instr || this.instr.n !== B || this.instr.dk !== dk)) this.plan(B, dk);
      if (this.instr && !this.instr.said && distC < 75 && (this.state === 'drive' || this.state === 'nav' || this.state === 'navHW')) {
        this.instr.said = true;
        const ctl = this.city.controlFor(B, loc.axis);
        const where = ctl === 'round' ? 'Au rond-point' : ctl === 'light' ? 'Au feu' : ctl === 'stop' ? 'Au stop' : ctl === 'yield' ? 'Au cédez-le-passage' : 'Au prochain carrefour';
        this.speak(`${where}, ${turnText(B, this.instr.turn)}.`);
      }
      // regards avant de tourner : mémorisés tant qu'on approche
      // manque d'allure
      if (this.mode === 'exam' && this.state === 'drive' && kmh < 15 && toLine > 25 && limit >= 50 && !this.traffic.cars.some(a => Math.hypot(a.x - car.x, a.z - car.z) < 18)) { this.slowT += dt; if (this.slowT > this.mood.slowAfter) { this.fault('slow'); this.slowT = 0; } } else this.slowT = 0;
    }

    // ---- autoroute, bretelles, route d'accès ----
    const hl = (loc.type === 'off' && this.hw) ? this.hw.locate(car.x, car.z) : null;
    if (hl) limit = this.updateHW(dt, car, kmh, f, hl);
    else this.hwLane = null;
    // ---- entrée / sortie de carrefour ----
    if (loc.type === 'node' && !this.inNode) {
      this.inNode = { n: loc.n, from: this.approach ? this.approach.dk : null, t: this.t };
      // arrivée sur la rocade depuis la route d'accès : stop obligatoire
      const n52 = this.city.nodes[5][2];
      if (loc.n === n52 && this.approach && this.approach.dk === 'W' && this.approach.n === n52 && this.city.controlFor(n52, 'x') === 'stop' && this.approach.minV > 1.5) this.fault('stop');
    }
    if (loc.type !== 'node' && this.inNode) {
      const nd = this.inNode;
      const onLink = !!(hl && hl.type === 'link');
      if ((loc.type === 'seg' || onLink) && nd.from) {
        const sgn = onLink ? 1 : (Math.sign(loc.axis === 'x' ? f.x : f.z) || 1);
        const exit = onLink ? 'E' : dirKey(loc.axis, sgn);
        const turn = turnOf(nd.from, exit);
        if (nd.n.type === 'round') {
          if (this.t - this.blinkSeen.R > 8) this.fault('blinkExit');
        } else if (turn === 'left' || turn === 'right') {
          const side = turn === 'left' ? 'L' : 'R';
          if (this.t - this.blinkSeen[side] > 9) this.fault('blink');
          const looked = Math.max(this.look.center, turn === 'left' ? this.look.left : this.look.right);
          if (this.t - looked > 12) this.fault('mirror');
        }
        if (this.mode === 'exam' && this.instr && this.instr.n === nd.n && (this.state === 'drive' || this.state === 'nav' || this.state === 'navHW')) {
          if (turn === this.instr.turn) {
            this.maneuvers++;
            if (this.state === 'drive' && this.maneuvers >= this.target) {
              if (this.withHW && !this.hwDone) { this.state = 'navHW'; this.speak('Très bien. Nous allons maintenant prendre l\'autoroute. Suivez mes indications.'); }
              else this.endCity();
            }
          } else if (turn !== 'uturn') this.speak('Ce n\'est pas grave, on continue par là.');
          this.instr = null;
        }
        if (onLink && this.state === 'navHW') { this.state = 'hwIn'; this.hwSaid = {}; this.speak('Suivez la direction de l\'autoroute A 77. Sur la bretelle, accélérez, mettez le clignotant gauche et insérez-vous quand c\'est libre.'); }
        if (this.state === 'back' && !onLink) { this.hwDone = true; this.endCity(); }
        // arrivée dans la rue du créneau (sens est)
        const cr = this.city.creneau;
        if (this.mode === 'exam' && this.state === 'nav' && loc.type === 'seg' && loc.axis === 'x' && loc.line === cr.line && loc.a === cr.a && sgn > 0) {
          this.state = 'creneau'; this.crT = 0; this.usedReverse = false;
          this.speak('Sur votre droite, il y a une place libre entre deux voitures. Garez-vous en créneau, en marche arrière, puis passez en P.');
        }
      }
      this.inNode = null;
    }

    // ---- vitesse ----
    this.limit = limit;
    if (kmh > limit + 25) this.fault('bigspeed', ` (${Math.round(kmh)} km/h pour ${limit})`);
    else if (kmh > limit + this.mood.speedTol) { this.overT += dt; if (this.overT > 1.5) this.fault('speed', ` (${Math.round(kmh)} km/h pour ${limit})`); } else this.overT = 0;
    // freinage brusque (sans danger devant)
    if (ctl.brake > 0.95 && kmh > 35 && car.accel < -7 && !this.dangerAhead(car)) this.fault('brake');

    // ---- piétons sur les passages ----
    for (const p of this.traffic.peds) {
      if (!p.onRoad) continue;
      const cr = p.cr;
      const along = cr.axis === 'x' ? car.x : car.z, lat = cr.axis === 'x' ? car.z - cr.c : car.x - cr.c;
      if (along > cr.s0 - 1 && along < cr.s1 + 1 && Math.abs(lat) < RW && kmh > 3) {
        const pl = p.l; // le piéton est-il sur la moitié proche / devant la voiture ?
        if (Math.abs(pl - lat) < 4.5) this.fault('ped');
      }
    }

    // ---- sens de rotation dans le rond-point ----
    if (loc.type === 'node' && loc.n.type === 'round' && kmh > 4) {
      const px = car.x - loc.n.x, pz = car.z - loc.n.z, r = Math.hypot(px, pz) || 1;
      if ((f.x * pz - f.z * px) / r < -0.3) { this.wrongRound = (this.wrongRound || 0) + dt; if (this.wrongRound > 1.2) this.fault('wrongway'); } else this.wrongRound = 0;
    }

    // ---- arrêt final au bord (catégories C, D, A) ----
    if (this.state === 'park') {
      if (kmh < 0.5) this.parkT = (this.parkT || 0) + dt; else this.parkT = 0;
      if (this.parkT > 1.2 && (car.gear === 'P' || this.parkT > 4) && loc.type === 'seg') {
        if (this.rightOff > RW - 2.2) { this.speak('Arrêt correct. L\'examen est terminé.', false); this.finish(); }
        else if (car.gear === 'P') { this.fault('park'); this.finish(); }
      }
    }
    // ---- créneau ----
    const inSlot = this.inSlot(car);
    if (this.state === 'creneau') {
      this.crT += dt;
      if (car.gear === 'R' && car.v < -0.3) this.usedReverse = true;
      if (kmh < 0.3) this.stopT = (this.stopT || 0) + dt; else this.stopT = 0;
      if (this.stopT > 1.2 && (car.gear === 'P' || this.stopT > 4)) {
        const cr = this.city.creneau, sl = cr.target;
        if (inSlot) {
          if (!this.usedReverse) this.fault('creneauAvant');
          this.speak('Créneau réussi, bien joué. L\'examen est terminé.', false); this.finish();
        } else if (car.gear === 'P' && car.x > sl.x0 - 4 && car.x < sl.x1 + 4 && car.z > cr.z0 - 3) { this.fault('creneau'); this.finish(); }
      }
      if (this.crT > 150) { this.fault('creneau'); this.finish(); }
    } else if (this.mode === 'free' && inSlot && kmh < 0.3) {
      this.freeSlotT = (this.freeSlotT || 0) + dt;
      if (this.freeSlotT > 1.5 && !this.freeSlotDone) { this.freeSlotDone = true; this.speak('Joli créneau ! Vous êtes parfaitement garé.'); this.audio.beep('ok'); }
    } else { this.freeSlotT = 0; if (!inSlot) this.freeSlotDone = false; }
  }

  // ---------- questions de vérification ----------
  questionText() { const [q, a] = this.quiz[this.qi]; return `${q} Un : ${a[0]}. Deux : ${a[1]}. Trois : ${a[2]}.`; }
  answer(i) {
    if (this.state !== 'quiz') return;
    const [q, , good, expl] = this.quiz[this.qi];
    let txt;
    if (i === good) { txt = pick(['Exact.', 'C\'est ça.', 'Très bien.']) + ' ' + expl; this.audio.beep('ok'); }
    else { txt = pick(['Non…', 'Ce n\'est pas ça.', 'Hmm, non.']) + ' ' + expl; this.faults.push({ key: 'quiz', label: 'Question ratée : ' + q, pts: 1, elim: false, t: this.t, x: this.pos && this.pos[0], z: this.pos && this.pos[1] }); this.audio.beep('warn'); }
    this.qi++;
    if (this.qi < this.quiz.length) this.speak(txt + ' Question suivante. ' + this.questionText());
    else { this.state = 'start'; this.speak(txt + ' Bien, on peut y aller. ' + this.startText); }
  }

  // réactions aux autres usagers
  react(kind) {
    if (this.t - (this.reactT || -99) < 15) return;
    this.reactT = this.t;
    const L = {
      honk: ['Ne vous laissez pas impressionner par le klaxon, vous faites bien.', 'Il klaxonne… laissez-le faire, restez calme.', 'Oh, celui-là, toujours pressé !'],
      fou: ['Et bien ! Il y en a qui sont pressés…', 'Regardez-moi ce chauffard. Ne faites jamais ça.', 'Lui, il ne passerait pas le permis aujourd\'hui !', 'Quel fou ! Restez bien concentré, il y en a toujours un.'],
      red: ['Vous avez vu ? Il a grillé le feu rouge ! Toujours anticiper les autres.', 'Incroyable, en plein rouge…'],
      victim: ['Aïe ! Ce n\'est pas votre faute, ce chauffard nous est rentré dedans. Je ne le compte pas.', 'Oh le fou ! Ne vous inquiétez pas, vous n\'y êtes pour rien.'],
    }[kind];
    if (L) this.speak(pick(L));
  }

  // fin de la partie « ville » : créneau (permis B) ou arrêt au bord (autres catégories)
  endCity() {
    if (this.vclass === 'B') { this.state = 'nav'; this.speak('Parfait. Nous allons terminer par un créneau. Suivez mes indications.'); }
    else { this.state = 'park'; this.speak('Très bien. Arrêtez-vous à droite le long du trottoir dès que possible, puis passez en P.'); }
  }
  hwLimit() { const base = { B: 130, A: 130, C: 90, D: 100 }[this.vclass] || 130; return this.rainy ? Math.min(base, base === 130 ? 110 : base - 10) : base; }

  // règles sur l'autoroute ; renvoie la limitation en vigueur
  updateHW(dt, car, kmh, f, hl) {
    const say = (k, text) => { if (this.mode === 'exam' && !this.hwSaid[k]) { this.hwSaid[k] = true; this.speak(text); } };
    this.hwSaid = this.hwSaid || {};
    if (hl.type === 'link') {
      // retour : marquer l'approche du stop de la rocade
      if (f.x < -0.5) { this.approach = { n: this.city.nodes[5][2], dk: 'W', axis: 'x', minV: Math.min(this.approach && this.approach.dk === 'W' ? this.approach.minV : Infinity, car.x < this.city.ext + 16 ? kmh : Infinity), dist: car.x - this.city.ext }; }
      return 70;
    }
    if (hl.type === 'ramp') {
      if (hl.which === 'exit' && (this.state === 'hwExit' || this.state === 'hw')) { this.state = 'back'; say('back', 'Bien. Ralentissez sur la bretelle, et au bout, stop : arrêt complet avant de vous engager sur la rocade.'); }
      return hl.which === 'exit' ? 50 : 70;
    }
    // chaussée principale
    const p = hwAt(hl.s), along = f.x * p.tx + f.z * p.tz;
    const wrong = (hl.cw === 'in' && along < -0.5) || (hl.cw === 'out' && along > 0.5);
    if (wrong && kmh > 5) { this.hwWrongT = (this.hwWrongT || 0) + dt; if (this.hwWrongT > 1.5) this.fault('wrongway'); } else this.hwWrongT = 0;
    const lane = hl.lane;
    // changement de voie : clignotant obligatoire
    if (this.hwLane && lane !== this.hwLane && lane !== 'shoulder' && this.hwLane !== 'shoulder') {
      const order = { extra: 0, right: 1, left: 2 };
      const side = order[lane] > order[this.hwLane] ? 'L' : 'R';
      if (this.t - this.blinkSeen[side] > 5) this.fault('blinkLane');
      if (this.hwLane === 'extra' && lane === 'right') { // insertion
        if (kmh < 70) this.fault('insertion');
        const cut = this.hw.cars.some(a => a.cw === hl.cw && a.lane === 1 && Math.abs(((a.s - hl.s + HW_PER * 1.5) % HW_PER) - HW_PER / 2) < 12);
        if (cut) this.fault('priority');
        if (this.state === 'hwIn') { this.state = 'hw'; this.hwStartS = hl.s; say('in', `Très bien. Restez sur la voie de droite, la vitesse est limitée à ${this.hwLimit()}. Je vous indiquerai la sortie.`); }
      }
    }
    this.hwLane = lane;
    if (this.state === 'hwIn' && lane === 'extra') say('acc', 'Accélérez franchement sur la voie d\'insertion.');
    // bande d'arrêt d'urgence
    if (lane === 'shoulder' && kmh > 20 && !(hl.u < 0 && this.nearExtra(hl.s))) { this.bauT = (this.bauT || 0) + dt; if (this.bauT > 2) { this.fault('bau'); this.bauT = 0; } } else this.bauT = 0;
    // véhicule devant dans la même voie
    let gap = 1e9, rightBusy = false;
    for (const a of this.hw.cars) {
      if (a.cw !== hl.cw) continue;
      const d = (((a.s - hl.s) * (hl.cw === 'in' ? 1 : -1)) + HW_PER) % HW_PER;
      if (d > 0 && d < 220 && Math.abs(Math.abs(a.ucur) - Math.abs(hl.u)) < 1.8) gap = Math.min(gap, d - 4.3);
      if (d > -10 && d < 140 && a.lane === 1) rightBusy = true;
    }
    const v = kmh / 3.6;
    if ((lane === 'left' || lane === 'right') && kmh > 50 && gap < v * 1.1) { this.distT = (this.distT || 0) + dt; if (this.distT > 3) { this.fault('distance'); this.distT = 0; } } else this.distT = 0;
    if (lane === 'left' && !rightBusy && kmh > 30) { this.keepT = (this.keepT || 0) + dt; if (this.keepT > 12) { this.fault('keepRight'); this.keepT = -10; } } else if (lane !== 'left') this.keepT = 0;
    if ((lane === 'left' || lane === 'right') && kmh < 25 && gap > 50 && this.state !== 'hwIn') { this.slowHWT = (this.slowHWT || 0) + dt; if (this.slowHWT > 4) { this.fault('stopHW'); this.slowHWT = -6; } } else this.slowHWT = 0;
    // sortie : annoncée à 900 m puis 300 m
    if (this.mode === 'exam' && (this.state === 'hw' || this.state === 'hwExit') && hl.cw === 'in') {
      const travelled = ((hl.s - (this.hwStartS ?? hl.s)) + HW_PER) % HW_PER;
      const toExit = ((this.hw.exitS0 - hl.s) + HW_PER) % HW_PER;
      this.toExit = toExit;
      if (travelled > 1500 && toExit < 900) { this.state = 'hwExit'; say('ex900', 'Dans neuf cents mètres, vous prendrez la sortie 12, direction centre-ville.'); }
      if (this.state === 'hwExit' && toExit < 320) say('ex300', 'Prenez la sortie maintenant. Clignotant droit, puis serrez sur la voie de décélération.');
    }
    return this.hwLimit();
  }
  nearExtra(s) { const h = this.hw, inr = (a, b) => { const x = ((s - a) + HW_PER) % HW_PER; return x <= ((b - a) + HW_PER) % HW_PER; }; return inr(h.exitS0 - 45, h.exitS1 + 5) || inr(h.accS0 - 5, h.accS1 + 65); }

  // la voiture est-elle entièrement dans la place libre, alignée, face à l'est ?
  inSlot(car) {
    const cr = this.city.creneau, sl = cr.target;
    if (Math.abs(Math.cos(car.yaw)) > 0.2 || Math.sin(car.yaw) < 0) return false;
    for (const [x, z] of car.corners()) if (x < sl.x0 + 0.05 || x > sl.x1 - 0.05 || z < cr.z0 - 0.65 || z > cr.z1 + 0.05) return false;
    return true;
  }

  // itinéraire le plus court (en carrefours) jusqu'au début de la rue du créneau : renvoie le virage à faire en B
  routeTurn(B, dk, target) {
    const cr = this.city.creneau, T = target ? target.n : this.city.node(cr.a, cr.line), goalDir = target ? target.dir : cr.dir;
    const key = (n, d) => n.i + ',' + n.j + d;
    const q = [{ n: B, d: dk, first: null }], seen = new Set([key(B, dk)]);
    while (q.length) {
      const st = q.shift();
      for (const t of ['straight', 'right', 'left']) {
        const nd = turnDir(st.d, t), D = dirOf(nd);
        const first = st.first || t;
        if (st.n === T && nd === goalDir) return first;
        const nn = this.city.node(st.n.i + D.dx, st.n.j + D.dz); if (!nn) continue;
        const k = key(nn, nd); if (seen.has(k)) continue; seen.add(k);
        q.push({ n: nn, d: nd, first });
      }
    }
    return null;
  }

  dangerAhead(car) {
    const f = car.forward();
    return this.traffic.cars.some(a => { const rx = a.x - car.x, rz = a.z - car.z, fd = rx * f.x + rz * f.z; return fd > 0 && fd < 25 && Math.abs(rx * f.z - rz * f.x) < 2.5; }) || this.traffic.peds.some(p => p.onRoad && Math.hypot(p.x - car.x, p.z - car.z) < 20);
  }

  // un véhicule prioritaire arrive-t-il quand on s'engage ?
  conflict(B, axis, dk, mode) {
    const d = dirOf(dk);
    const bodies = this.traffic.cars.map(a => ({ x: a.x, z: a.z, yaw: a.yaw, v: a.v, ai: a }));
    for (const c of DIRS) {
      if ((axis === 'x') === (c.dx !== 0)) continue; // seulement le trafic transversal
      const fromRight = (c.dx === d.dz && c.dz === -d.dx);
      if (mode === 'right' && !fromRight) continue;
      for (const b of bodies) {
        const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
        if (fx * c.dx + fz * c.dz < 0.7 || b.v < 2) continue;
        const rx = B.x - b.x, rz = B.z - b.z;
        const along = rx * c.dx + rz * c.dz, lat = Math.abs(rx * c.dz - rz * c.dx);
        if (lat > RW + 0.5 || along < 0 || along > 50) continue;
        if ((along - RW) / b.v < 2.6) return true;
      }
    }
    return false;
  }

  plan(B, dk) {
    if (this.state === 'nav' || this.state === 'navHW') { const t = this.routeTurn(B, dk, this.state === 'navHW' ? { n: this.city.nodes[5][2], dir: 'E' } : null); if (t) { this.instr = { n: B, dk, turn: t, said: false }; return; } }
    const opts = [];
    for (const t of ['left', 'right', 'straight']) {
      const nd = dirOf(turnDir(dk, t)); const nn = this.city.node(B.i + nd.dx, B.j + nd.dz);
      if (nn) opts.push(t);
    }
    if (!opts.length) return;
    // un peu plus de virages que de tout droit
    const pick = opts.filter(t => t !== 'straight');
    const turn = (pick.length && Math.random() < 0.7) ? pick[Math.floor(Math.random() * pick.length)] : opts[Math.floor(Math.random() * opts.length)];
    this.instr = { n: B, dk, turn, said: false };
  }

  // informations affichées sur l'écran central
  screenInfo(car) {
    const title = `Permis ${this.vclass} · ` + (this.mode === 'exam' ? `Examen — manœuvres ${Math.min(this.maneuvers, this.target)}/${this.target}` : 'Conduite libre') + `  ·  inspecteur ${this.mood.emoji} ${this.mood.label}`;
    const pen = this.faults.reduce((s, f) => s + f.pts, 0);
    const info = { title, timer: this.mode === 'exam' ? `${31 - pen}/31` : '', faults: this.faults, say: this.t - this.sayT < 9 ? this.say : '' };
    if (this.result) { info.result = this.result; return info; }
    if (this.state === 'quiz') { const [q, a] = this.quiz[this.qi]; info.quiz = { q, a, n: this.qi + 1, of: this.quiz.length }; return info; }
    if (this.state === 'start' && this.mode === 'exam') info.instruction = { turn: 'go', text: 'D, frein à main desserré, clignotant gauche, angle mort' };
    else if (this.state === 'creneau') info.instruction = { turn: 'park', text: 'Créneau à droite, en marche arrière' };
    else if (this.state === 'park') info.instruction = { turn: 'park', text: 'Garez-vous à droite, puis P' };
    else if (this.state === 'hwIn') info.instruction = { turn: 'straight', text: 'A 77 : insérez-vous (clignotant gauche)' };
    else if (this.state === 'hw') info.instruction = { turn: 'straight', text: `Autoroute — voie de droite, ${this.hwLimit()} max` };
    else if (this.state === 'hwExit') info.instruction = { turn: 'right', text: 'Sortie 12 — Centre-ville', dist: Math.round(this.toExit || 0) + ' m' };
    else if (this.state === 'back') info.instruction = { turn: 'straight', text: 'Retour en ville — STOP au bout' };
    else if (this.instr && this.approach) info.instruction = { turn: this.instr.turn, text: turnText(this.instr.n, this.instr.turn).replace(/^./, c => c.toUpperCase()), dist: Math.max(0, Math.round(this.approach.dist - RW)) + ' m' };
    return info;
  }
}
