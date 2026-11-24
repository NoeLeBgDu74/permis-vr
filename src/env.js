// Ciel HDRI Poly Haven (éclairage par image + arrière-plan), soleil avec ombres qui suivent la voiture.
import * as THREE from 'three';
import { hdr } from './assets.js';

export async function setupEnv(renderer, scene, quality) {
  const tex = await hdr('assets/hdri/qwantani_late_afternoon_puresky_2k.hdr');
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  const envRT = pm.fromEquirectangular(tex);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.9;
  scene.background = tex;
  scene.backgroundIntensity = 1.0;
  scene.fog = new THREE.Fog(0xc9d3dc, 250, 1400);
  pm.dispose();

  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.position.set(-60, 90, -45);
  sun.castShadow = true;
  const S = quality === 'ultra' ? 4096 : 2048;
  sun.shadow.mapSize.set(S, S);
  const c = sun.shadow.camera; c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 260;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const offset = sun.position.clone();
  return {
    sun,
    follow(p) { // recale la boîte d'ombre sur la voiture, au texel près (évite le scintillement)
      const tx = 90 / S;
      const x = Math.round(p.x / tx) * tx, z = Math.round(p.z / tx) * tx;
      sun.position.set(x + offset.x, offset.y, z + offset.z);
      sun.target.position.set(x, 0, z);
    }
  };
}
