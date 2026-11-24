// Chargement des ressources : textures PBR, GLB (meshopt), HDRI.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const manager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const hdrLoader = new RGBELoader(manager);
hdrLoader.setDataType(THREE.HalfFloatType);

let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = a; }

const texCache = new Map();
function tex(url, srgb) {
  if (texCache.has(url)) return texCache.get(url);
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(url, t);
  return t;
}

// Matériau PBR Poly Haven : diff (sRGB), nor (normal GL), arm (AO / rugosité / métal).
// Les UV des géométries de la ville sont en mètres ; `scale` = mètres couverts par une tuile.
const matCache = new Map();
export function pbr(name, { scale = 2, color = 0xffffff, normalScale = 1, roughness = 1, metalness = 1, envMapIntensity = 1, aoIntensity = 1 } = {}) {
  const key = name + '|' + scale + '|' + color + '|' + normalScale + '|' + roughness;
  if (matCache.has(key)) return matCache.get(key);
  const base = 'assets/tex/' + name + '/';
  const rep = new THREE.Vector2(1 / scale, 1 / scale);
  const clone = (t) => { const c = t.clone(); c.repeat.copy(rep); c.needsUpdate = true; return c; };
  const m = new THREE.MeshStandardMaterial({
    color, map: clone(tex(base + 'diff.webp', true)), normalMap: clone(tex(base + 'nor.webp')),
    roughnessMap: clone(tex(base + 'arm.webp')), metalnessMap: null, aoMap: clone(tex(base + 'arm.webp')),
    roughness, metalness: 0, envMapIntensity, aoMapIntensity: aoIntensity,
    normalScale: new THREE.Vector2(normalScale, normalScale)
  });
  // Les clones partagent l'image source : on attend le chargement de l'original pour rafraîchir.
  for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
    const src = tex(base + (k === 'map' ? 'diff' : k === 'normalMap' ? 'nor' : 'arm') + '.webp', k === 'map');
    const c = m[k];
    if (src.image) c.needsUpdate = true; else waitImage(src, () => { c.image = src.image; c.needsUpdate = true; });
  }
  m.name = name;
  matCache.set(key, m);
  return m;
}
function waitImage(t, cb) { const id = setInterval(() => { if (t.image) { clearInterval(id); cb(); } }, 50); }

const glbCache = new Map();
export function glb(url) {
  if (!glbCache.has(url)) glbCache.set(url, new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej)));
  return glbCache.get(url);
}

export function hdr(url) { return new Promise((res, rej) => hdrLoader.load(url, res, undefined, rej)); }

export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}
