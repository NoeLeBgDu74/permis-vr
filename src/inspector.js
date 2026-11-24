// L'inspecteur, assis à la place passager : pose assise calculée sur le squelette, tête qui suit la situation
// (regarde la route, ses rétros, le conducteur quand il parle, la direction annoncée), bouche animée pendant la parole,
// planchette d'évaluation sur les genoux.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { glb } from './assets.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

export async function loadInspector(car, seat = { hips: [-0.36, 0.6, -0.24], board: [-0.36, 0.72, 0.1] }) {
  const g = await glb('assets/chars/readyplayer.me.glb');
  const root = SkeletonUtils.clone(g.scene);
  const bones = {}; const morphs = [];
  root.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; if (o.morphTargetDictionary && 'mouthOpen' in o.morphTargetDictionary) morphs.push(o); }
  });
  car.obj.add(root);
  root.updateMatrixWorld(true);
  const carQ = new THREE.Quaternion();
  // oriente l'os pour que la direction os→enfant pointe vers `dir` (repère voiture)
  const point = (name, child, dir) => {
    const b = bones[name], c = bones[child]; if (!b || !c) return;
    root.updateMatrixWorld(true);
    car.obj.getWorldQuaternion(carQ);
    const pb = b.getWorldPosition(new THREE.Vector3()), pc = c.getWorldPosition(new THREE.Vector3());
    const cur = pc.sub(pb).normalize();
    const want = dir.clone().applyQuaternion(carQ).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(cur, want);
    const wq = b.getWorldQuaternion(new THREE.Quaternion());
    const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pq.invert().multiply(rot.multiply(wq)));
  };
  // pose assise (personnage tourné vers +z comme la voiture ; sa gauche = +x)
  point('Spine', 'Spine1', V(0, 1, -0.12));
  point('LeftUpLeg', 'LeftLeg', V(0.06, -0.12, 1));
  point('RightUpLeg', 'RightLeg', V(-0.06, -0.12, 1));
  point('LeftLeg', 'LeftFoot', V(0.03, -1, 0.22));
  point('RightLeg', 'RightFoot', V(-0.03, -1, 0.22));
  point('LeftFoot', 'LeftToeBase', V(0, -0.3, 1));
  point('RightFoot', 'RightToeBase', V(0, -0.3, 1));
  point('LeftArm', 'LeftForeArm', V(0.18, -1, 0.15));
  point('RightArm', 'RightForeArm', V(-0.18, -1, 0.15));
  point('LeftForeArm', 'LeftHand', V(-0.25, -0.35, 1));
  point('RightForeArm', 'RightHand', V(0.25, -0.35, 1));
  // placement : bassin au-dessus de l'arrière de l'assise passager
  root.updateMatrixWorld(true);
  const hips = bones.Hips.getWorldPosition(new THREE.Vector3());
  car.obj.worldToLocal(hips);
  root.position.add(new THREE.Vector3(...seat.hips).sub(hips));
  root.updateMatrixWorld(true);

  // planchette d'évaluation sur les genoux
  const c = document.createElement('canvas'); c.width = 256; c.height = 340; const x = c.getContext('2d');
  x.fillStyle = '#f7f5ef'; x.fillRect(0, 0, 256, 340); x.fillStyle = '#1d3c78'; x.font = 'bold 22px Arial'; x.fillText('ÉVALUATION', 20, 40);
  x.strokeStyle = '#9aa3b5'; x.lineWidth = 2; for (let y = 70; y < 330; y += 26) { x.beginPath(); x.moveTo(20, y); x.lineTo(236, y); x.stroke(); x.strokeRect(210, y - 18, 14, 14); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Group();
  board.add(new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.008, 0.31), new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.6 })));
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  paper.rotation.x = -Math.PI / 2; paper.position.y = 0.005; board.add(paper);
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.03), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.3 })); clip.position.set(0, 0.01, -0.14); board.add(clip);
  board.position.set(...seat.board); board.rotation.set(0.35, 0.1, 0);
  car.obj.add(board);

  // ---------- animation ----------
  const head = bones.Head, neck = bones.Neck;
  const head0 = head.quaternion.clone(), neck0 = neck.quaternion.clone();
  const st = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, glanceT: 2, mouth: 0, t: 0 };
  const qy = new THREE.Quaternion(), qx = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
  return {
    root, board,
    // ctx : { speaking, turn: 'left'|'right'|null, alert }
    update(dt, ctx) {
      st.t += dt;
      st.glanceT -= dt;
      if (ctx.speaking) { st.tyaw = 0.75; st.tpitch = 0.05; }              // vers le conducteur
      else if (ctx.alert) { st.tyaw = 0; st.tpitch = 0.0; }                 // fixe la route
      else if (ctx.turn) { st.tyaw = ctx.turn === 'left' ? 0.5 : -0.6; st.tpitch = 0; }
      else if (st.glanceT <= 0) {                                            // coups d'œil : route, rétro droit, planchette, conducteur
        const r = Math.random();
        if (r < 0.45) { st.tyaw = (Math.random() - 0.5) * 0.3; st.tpitch = 0; }
        else if (r < 0.65) { st.tyaw = -0.9; st.tpitch = -0.05; }
        else if (r < 0.85) { st.tyaw = 0.05; st.tpitch = -0.55; }
        else { st.tyaw = 0.6; st.tpitch = 0.05; }
        st.glanceT = 1.5 + Math.random() * 3.5;
      }
      const k = Math.min(1, dt * 4);
      st.yaw += (st.tyaw - st.yaw) * k; st.pitch += (st.tpitch - st.pitch) * k;
      // répartition cou / tête
      qy.setFromAxisAngle(AY, st.yaw * 0.4); neck.quaternion.copy(neck0).premultiply(qy);
      qy.setFromAxisAngle(AY, st.yaw * 0.6); qx.setFromAxisAngle(AX, -st.pitch);
      head.quaternion.copy(head0).premultiply(qy).multiply(qx);
      // bouche
      const target = ctx.speaking ? 0.15 + 0.35 * Math.abs(Math.sin(st.t * 13) * Math.sin(st.t * 7.3 + 1)) : 0;
      st.mouth += (target - st.mouth) * Math.min(1, dt * 18);
      for (const m of morphs) m.morphTargetInfluences[m.morphTargetDictionary.mouthOpen] = st.mouth;
    },
  };
}
