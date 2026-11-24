// Examen du permis : itinéraire guidé par l'inspecteur, contrôle des règles, fautes et note sur 31.
import * as THREE from 'three';
import { N, RW, LO, SP, nodeX, DIRS, dirOf, dirKey, turnOf, turnDir } from './city.js';

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

export class Exam {
  constructor({ city, traffic, audio, mode }) {
    this.city = city; this.traffic = traffic; this.audio = audio; this.mode = mode; // 'exam' | 'free'
    this.faults = []; this.cool = {}; this.t = 0;
    this.state = 'start';      // start → drive → park → done
    this.say = ''; this.sayT = 0;
    this.instr = null; this.maneuvers = 0; this.target = mode === 'exam' ? 9 : Infinity;
    this.prevLoc = null; this.approach = null; this.inNode = null;
    this.look = { center: -99, left: -99, right: -99, shoulderL: -99, shoulderR: -99 };
    this.blinkSeen = { L: -99, R: -99 };
    this.minSpeedApproach = Infinity;
    this.leftTime = 0; this.wrongTime = 0; this.overT = 0; this.slowT = 0;
    this.result = null;
  }
  speak(text, voice = true) { this.say = text; this.sayT = this.t; if (voice) this.audio.say(text); }

  begin() {
    if (this.mode === 'exam') this.speak('Bonjour, je suis votre inspecteur. Passez en marche avant avec A, mettez le clignotant gauche, contrôlez votre rétroviseur et votre angle mort, puis démarrez doucement.');
    else this.speak('Conduite libre : roulez où vous voulez. Je vous signale les erreurs pour vous entraîner.');
  }

  fault(key, extra = '') {
    if (this.state === 'done') return;
    const F = FAULTS[key];
    if (this.cool[key] && this.t - this.cool[key] < 8) return;
    this.cool[key] = this.t;
    const f = { key, label: F.label + extra, pts: F.pts || 0, elim: !!F.elim, t: this.t };
    this.faults.push(f);
    this.audio.beep(f.elim ? 'elim' : 'warn');
    if (f.elim) {
      if (this.mode === 'exam') { this.speak(F.label + '. C\'est une faute éliminatoire, l\'examen est terminé. Arrêtez-vous dès que possible.'); this.finish(); }
      else this.speak(F.label + ' : à l\'examen, ce serait éliminatoire !');
    } else this.speak(F.label + '.', this.mode === 'free');
  }

  finish() {
    const pen = this.faults.reduce((s, f) => s + f.pts, 0);
    const elim = this.faults.find(f => f.elim);
    const note = Math.max(0, 31 - pen);
    const ok = !elim && note >= 20;
    this.state = 'done';
    const lines = this.faults.length ? this.faults.map(f => (f.elim ? '⛔ ' : '• ') + f.label + (f.pts ? ` (−${f.pts})` : '')) : ['Aucune faute, conduite exemplaire !'];
    this.result = { ok, note: `Note : ${note} / 31${elim ? ' — faute éliminatoire' : ''}`, lines, hint: 'A / Entrée : recommencer   ·   B / F : conduite libre' };
    if (!elim) this.speak(ok ? `Félicitations, vous avez obtenu ${note} sur 31. Vous êtes reçu !` : `Vous avez ${note} sur 31. C'est insuffisant, il faut au moins 20. Ce sera pour la prochaine fois.`);
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
    if (blink) this.blinkSeen[blink] = this.t;
    if (this.state === 'done') return;
    const kmh = Math.abs(car.v) * 3.6;
    const f = car.forward();
    const loc = this.city.locate(car.x, car.z);

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
      }
      if (this.city.controlFor(B, loc.axis) === 'light') {
        const st = this.city.lightState(B, loc.axis);
        if (st === 'O' && ap.orangeFrom === undefined) ap.orangeFrom = toLine;
        if (st !== 'O') ap.orangeFrom = undefined;
      }
      // instruction à donner
      if (this.mode === 'exam' && this.state === 'drive' && (!this.instr || this.instr.n !== B || this.instr.dk !== dk)) this.plan(B, dk);
      if (this.instr && !this.instr.said && distC < 75 && this.state === 'drive') {
        this.instr.said = true;
        const ctl = this.city.controlFor(B, loc.axis);
        const where = ctl === 'light' ? 'Au feu' : ctl === 'stop' ? 'Au stop' : ctl === 'yield' ? 'Au cédez-le-passage' : 'Au prochain carrefour';
        this.speak(`${where}, ${TURN_TXT[this.instr.turn]}.`);
      }
      // regards avant de tourner : mémorisés tant qu'on approche
      // manque d'allure
      if (this.mode === 'exam' && this.state === 'drive' && kmh < 15 && toLine > 25 && limit >= 50 && !this.traffic.cars.some(a => Math.hypot(a.x - car.x, a.z - car.z) < 18)) { this.slowT += dt; if (this.slowT > 12) { this.fault('slow'); this.slowT = 0; } } else this.slowT = 0;
    }

    // ---- entrée / sortie de carrefour ----
    if (loc.type === 'node' && !this.inNode) {
      this.inNode = { n: loc.n, from: this.approach ? this.approach.dk : null, t: this.t };
    }
    if (loc.type !== 'node' && this.inNode) {
      const nd = this.inNode;
      if (loc.type === 'seg' && nd.from) {
        const sgn = Math.sign(loc.axis === 'x' ? f.x : f.z) || 1;
        const exit = dirKey(loc.axis, sgn);
        const turn = turnOf(nd.from, exit);
        if (turn === 'left' || turn === 'right') {
          const side = turn === 'left' ? 'L' : 'R';
          if (this.t - this.blinkSeen[side] > 9) this.fault('blink');
          const looked = Math.max(this.look.center, turn === 'left' ? this.look.left : this.look.right);
          if (this.t - looked > 12) this.fault('mirror');
        }
        if (this.mode === 'exam' && this.instr && this.instr.n === nd.n && this.state === 'drive') {
          if (turn === this.instr.turn) {
            this.maneuvers++;
            if (this.maneuvers >= this.target) { this.state = 'park'; this.speak('Parfait. Garez-vous à droite le long du trottoir dès que possible, puis passez en P.'); }
          } else if (turn !== 'uturn') this.speak('Ce n\'est pas grave, on continue par là.');
          this.instr = null;
        }
      }
      this.inNode = null;
    }

    // ---- vitesse ----
    this.limit = limit;
    if (kmh > limit + 25) this.fault('bigspeed', ` (${Math.round(kmh)} km/h pour ${limit})`);
    else if (kmh > limit + 4) { this.overT += dt; if (this.overT > 1.5) this.fault('speed', ` (${Math.round(kmh)} km/h pour ${limit})`); } else this.overT = 0;
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

    // ---- stationnement final ----
    if (this.state === 'park' && kmh < 0.5 && (car.gear === 'P' || this.parkT > 3)) {
      if (loc.type === 'seg' && this.rightOff > RW - 1.6) { this.speak('Arrêt correct. Coupez le moteur, l\'examen est terminé.', false); this.finish(); }
      else if (loc.type === 'seg' && car.gear === 'P') { this.fault('park'); this.finish(); }
    }
    if (this.state === 'park' && kmh < 0.5) this.parkT = (this.parkT || 0) + dt; else this.parkT = 0;
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
    const title = this.mode === 'exam' ? `Examen du permis — manœuvres ${Math.min(this.maneuvers, this.target)}/${this.target}` : 'Conduite libre';
    const pen = this.faults.reduce((s, f) => s + f.pts, 0);
    const info = { title, timer: this.mode === 'exam' ? `${31 - pen}/31` : '', faults: this.faults, say: this.t - this.sayT < 9 ? this.say : '' };
    if (this.result) { info.result = this.result; return info; }
    if (this.state === 'start' && this.mode === 'exam') info.instruction = { turn: 'go', text: 'Démarrez : D, clignotant gauche, angle mort' };
    else if (this.state === 'park') info.instruction = { turn: 'park', text: 'Garez-vous à droite, puis P' };
    else if (this.instr && this.approach) info.instruction = { turn: this.instr.turn, text: TURN_TXT[this.instr.turn].replace(/^./, c => c.toUpperCase()), dist: Math.max(0, Math.round(this.approach.dist - RW)) + ' m' };
    return info;
  }
}
