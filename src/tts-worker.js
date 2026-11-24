// Synthèse vocale neuronale 100 % gratuite et locale : Piper (voix « Pierre », fr_FR-upmc-medium, CC-BY-SA 4.0)
// exécutée dans un worker (onnxruntime-web + phonémiseur espeak-ng en WebAssembly) pour ne jamais faire saccader la VR.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js';
import { createPiperPhonemize } from 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js';

const VOICE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx';
const PHON = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const CACHE = 'pvr-voice-v1';
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
ort.env.wasm.numThreads = 1;

let ready = null, session = null, cfg = null, phonUrls = null;

async function cached(url, progress) {
  const c = await caches.open(CACHE);
  let r = await c.match(url);
  if (!r) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('téléchargement ' + res.status);
    // lecture avec progression
    const total = +res.headers.get('content-length') || 0, reader = res.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (progress && total) progress(got / total); }
    const blob = new Blob(parts);
    await c.put(url, new Response(blob));
    return blob;
  }
  return r.blob();
}

function init() {
  if (ready) return ready;
  ready = (async () => {
    const [model, json, wasm, data] = await Promise.all([
      cached(VOICE, (p) => postMessage({ type: 'progress', p })),
      cached(VOICE + '.json'), cached(PHON + '.wasm'), cached(PHON + '.data'),
    ]);
    cfg = JSON.parse(await json.text());
    phonUrls = { wasm: URL.createObjectURL(wasm), data: URL.createObjectURL(data) };
    session = await ort.InferenceSession.create(await model.arrayBuffer(), { executionProviders: ['wasm'] });
    postMessage({ type: 'ready' });
  })();
  ready.catch(e => postMessage({ type: 'error', message: String(e && e.message || e) }));
  return ready;
}

async function phonemize(text) {
  return new Promise(async (res, rej) => {
    try {
      const m = await createPiperPhonemize({
        print: (l) => { try { res(JSON.parse(l).phoneme_ids); } catch (e) { rej(e); } },
        printErr: () => { },
        locateFile: (f) => f.endsWith('.wasm') ? phonUrls.wasm : f.endsWith('.data') ? phonUrls.data : f,
      });
      m.callMain(['-l', cfg.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
    } catch (e) { rej(e); }
  });
}

async function speak(id, text) {
  await init();
  // phrase par phrase : la première est jouée pendant que les suivantes se calculent
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) || [text];
  for (const p of parts) {
    const t = p.trim(); if (!t) continue;
    const ids = await phonemize(t);
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([cfg.inference.noise_scale, 1.0, cfg.inference.noise_w]), [3]),
    };
    if (cfg.speaker_id_map && 'pierre' in cfg.speaker_id_map) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(cfg.speaker_id_map.pierre)]), [1]);
    const out = await session.run(feeds);
    const pcm = out.output.data;
    postMessage({ type: 'audio', id, pcm, rate: cfg.audio.sample_rate }, [pcm.buffer]);
  }
  postMessage({ type: 'done', id });
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') init();
  else if (m.type === 'speak') speak(m.id, m.text).catch(err => postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }));
};
