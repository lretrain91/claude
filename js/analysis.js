// Analyse audio : 4 bandes de fréquence, détection des attaques (onsets), estimation du tempo,
// lecture du micro. Utilisé en direct (micro) comme sur un fichier audio.
(function () {
  "use strict";
  const BS = (window.BS = window.BS || {});

  BS.HOP = 512; // échantillons par trame d'analyse (~11,6 ms à 44,1 kHz)

  // Une bande par piste : basses → D, bas-médiums → F, hauts-médiums → J, aigus → K.
  BS.BANDS = [
    { type: "lowpass",  freq: 150 },
    { type: "bandpass", freq: 400,  q: 1.0 },
    { type: "bandpass", freq: 1600, q: 1.0 },
    { type: "highpass", freq: 4000 },
  ];

  BS.makeFilter = function (ctx, band) {
    const f = ctx.createBiquadFilter();
    f.type = band.type;
    f.frequency.value = band.freq;
    if (band.q) f.Q.value = band.q;
    return f;
  };

  // Détecteur d'attaques en flux continu. On lui pousse l'énergie RMS de chaque bande
  // trame par trame ; il renvoie les attaques détectées avec 3 trames de retard.
  BS.OnsetDetector = class {
    constructor(frameDur, mult) {
      this.frameDur = frameDur;
      this.mult = mult;
      this.alpha = frameDur / 3; // moyenne glissante sur ~3 s
      this.warm = Math.round(0.5 / frameDur);
      this.lastOdf = 0;
      this.tempoOdf = 0;
      this.bands = [0, 1, 2, 3].map(() => ({ prevE: null, hist: [], m: 0, v: 0, frames: 0, raw: [], ls: [] }));
    }

    push(energies, t) {
      const out = [];
      let odf = 0, tOdf = 0;
      for (let b = 0; b < 4; b++) {
        const st = this.bands[b];
        const e = Math.log1p(1000 * energies[b]);
        const flux = st.prevE == null ? 0 : Math.max(0, e - st.prevE);
        st.prevE = e;
        odf += flux;
        // Courbe pour le tempo, plus robuste au bruit de fond : énergie lissée sur 3 trames,
        // comparée au maximum des trames précédentes (seules les vraies montées comptent).
        st.raw.push(energies[b]);
        if (st.raw.length > 3) st.raw.shift();
        st.ls.push(Math.log1p(1000 * (st.raw.reduce((a, x) => a + x, 0) / st.raw.length)));
        if (st.ls.length > 5) st.ls.shift();
        if (st.ls.length === 5) tOdf += Math.max(0, st.ls[4] - Math.max(st.ls[0], st.ls[1]));
        st.hist.push({ v: flux, t });
        if (st.hist.length > 40) st.hist.shift();
        const diff = flux - st.m, incr = this.alpha * diff;
        st.m += incr;
        st.v = (1 - this.alpha) * (st.v + diff * incr);
        st.frames++;

        const h = st.hist, j = h.length - 4;
        if (j < 16 || st.frames < this.warm) continue;
        const v = h[j].v;
        if (v <= 0) continue;
        let isMax = true;
        for (let k = -3; k <= 3; k++) if (h[j + k].v > v) { isMax = false; break; }
        if (!isMax) continue;
        let loc = 0;
        for (let k = j - 16; k <= j + 3; k++) loc += h[k].v;
        loc /= 20;
        const std = Math.sqrt(st.v);
        if (v > loc * this.mult && v > st.m + 0.5 * std) {
          out.push({ t: h[j].t, lane: b, s: (v - st.m) / (std || 1) });
        }
      }
      this.lastOdf = odf;
      this.tempoOdf = tOdf;
      return out;
    }
  };

  // Estimation du tempo par autocorrélation de la courbe d'attaques (8 dernières secondes).
  // `center` : tempo le plus probable a priori (sert à trancher entre tempo simple et double).
  BS.TempoTracker = class {
    constructor(frameDur, center = 120) {
      this.fd = frameDur;
      this.center = center;
      this.maxLen = Math.round(8 / frameDur);
      this.reset();
    }

    reset() { this.odf = []; this.bpm = null; this.bar = null; this.conf = 0; this.salience = 0; this.ok = false; this.weak = true; this.cand = null; }

    push(v) {
      this.odf.push(v);
      if (this.odf.length > this.maxLen) this.odf.shift();
    }

    update() {
      const fd = this.fd, n = this.odf.length;
      if (n < 4 / fd) return;
      let mean = 0;
      for (const v of this.odf) mean += v;
      mean /= n;
      const x = this.odf.map(v => v - mean);
      let r0 = 0;
      for (const v of x) r0 += v * v;
      r0 /= n;
      if (r0 <= 1e-9) return;
      const ac = lag => {
        let s = 0;
        for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
        return s / (n - lag) / r0;
      };
      const interp = (lag, f) => {
        const a = f(lag - 1), b = f(lag), c = f(lag + 1);
        const d = a - 2 * b + c;
        return d < 0 ? lag + (0.5 * (a - c)) / d : lag;
      };

      const lagMin = Math.floor(60 / 180 / fd), lagMax = Math.ceil(60 / 70 / fd);
      let best = -1, bestScore = -Infinity, bestAc = 0;
      const all = [];
      for (let lag = lagMin; lag <= lagMax; lag++) {
        const r = ac(lag);
        all.push(r);
        const bpm = 60 / (lag * fd);
        const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / this.center) / 0.7, 2));
        if (r * w > bestScore) { bestScore = r * w; best = lag; bestAc = r; }
      }
      const beatLag = interp(best, ac);

      // Affinage de la durée d'une mesure (4 temps) directement sur l'autocorrélation.
      let barLag = beatLag * 4;
      const c = Math.round(barLag);
      if (n - (c + 4) > c + 4) {
        let bl = c, br = -Infinity;
        for (let lag = c - 3; lag <= c + 3; lag++) { const r = ac(lag); if (r > br) { br = r; bl = lag; } }
        barLag = interp(bl, ac);
      }

      const bar = barLag * fd;
      this.conf = bestAc;
      // Netteté du tempo : à quel point il ressort parmi tous les tempos possibles (écart en σ).
      // Robuste au bruit de fond, qui abaisse `conf` mais pas le relief du pic.
      const m = all.reduce((a, v) => a + v, 0) / all.length;
      const sd = Math.sqrt(all.reduce((a, v) => a + (v - m) ** 2, 0) / all.length) || 1;
      this.salience = (bestAc - m) / sd;
      // Rythme franc : le bruit d'une pièce (voix, ventilation) reste sous ~0,12 ; la musique,
      // même avec autant de bruit que de musique, reste au-dessus de ~0,4.
      this.ok = this.conf >= 0.25;
      this.weak = this.conf < 0.15;
      this.bpm = 240 / bar;
      // On ne change de tempo qu'après deux estimations concordantes.
      if (this.bar && Math.abs(bar - this.bar) / this.bar < 0.03) {
        this.bar = 0.8 * this.bar + 0.2 * bar;
      } else if (this.cand && Math.abs(bar - this.cand) / this.cand < 0.03) {
        this.bar = bar;
      }
      this.cand = bar;
    }
  };

  // ---------- Live : capture d'un flux audio et analyse en continu ----------
  const WORKLET = `
    class BandEnergy extends AudioWorkletProcessor {
      constructor(o) { super(); this.hop = o.processorOptions.hop; this.acc = [0,0,0,0]; this.zc = [0,0,0,0]; this.prev = [0,0,0,0]; this.n = 0; this.t0 = 0; }
      process(inputs) {
        const inp = inputs[0];
        if (!inp || !inp.length) return true;
        const len = inp[0].length;
        for (let i = 0; i < len; i++) {
          if (this.n === 0) this.t0 = currentTime + i / sampleRate;
          for (let b = 0; b < 4; b++) {
            const s = (inp[b] || inp[0])[i];
            this.acc[b] += s * s;
            if ((s >= 0) !== (this.prev[b] >= 0)) this.zc[b]++;
            this.prev[b] = s;
          }
          if (++this.n === this.hop) {
            this.port.postMessage({ t: this.t0, e: this.acc.map(a => Math.sqrt(a / this.hop)), z: this.zc.map(c => c / this.hop) });
            this.acc = [0,0,0,0]; this.zc = [0,0,0,0]; this.n = 0;
          }
        }
        return true;
      }
    }
    registerProcessor("band-energy", BandEnergy);`;

  const loadedCtx = new WeakSet();

  // Ouvre la source audio. `kind` : "tab" (partage d'onglet / d'écran) ou "mic".
  // mode "delay"   : on peut couper le son d'origine et le rejouer en retard → notes exactes.
  // mode "predict" : on entend la musique en direct → on prédit la mesure suivante.
  BS.openCapture = async function (kind) {
    const md = navigator.mediaDevices;
    const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (kind === "mic") {
      if (!md || !md.getUserMedia) throw new Error("micro non disponible dans ce navigateur");
      const stream = await md.getUserMedia({ audio: raw });
      return { stream, mode: "predict", label: "micro" };
    }
    if (!md || !md.getDisplayMedia) throw new Error("partage d'onglet non disponible (utilise Chrome ou Edge sur ordinateur)");
    const stream = await md.getDisplayMedia({
      video: true,
      audio: { ...raw, suppressLocalAudioPlayback: true },
      systemAudio: "include",
      selfBrowserSurface: "exclude",
    });
    const video = stream.getVideoTracks()[0];
    const surface = video && video.getSettings().displaySurface;
    stream.getVideoTracks().forEach(t => t.stop());
    const audio = stream.getAudioTracks()[0];
    if (!audio) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error("aucun son partagé — coche « Partager aussi l'audio de l'onglet »");
    }
    const suppressed = audio.getSettings().suppressLocalAudioPlayback === true;
    if (surface === "browser" && suppressed) return { stream, mode: "delay", label: "onglet" };
    return { stream, mode: "predict", label: surface === "browser" ? "onglet" : "écran" };
  };

  // Filtre biquad (mêmes formules que le BiquadFilterNode du Web Audio).
  function biquad(type, freq, q, sr) {
    const w0 = (2 * Math.PI * freq) / sr, cos = Math.cos(w0), sin = Math.sin(w0);
    // lowpass/highpass : Q en dB (1 dB par défaut) ; bandpass : Q linéaire.
    const alpha = type === "bandpass" ? sin / (2 * q) : sin / (2 * Math.pow(10, (q ?? 1) / 20));
    let b0, b1, b2;
    if (type === "lowpass") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
    else if (type === "highpass") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }
    const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
    const c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return x => {
      const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    };
  }

  // Lecture directe du micro, sans moteur audio (Chrome, dont Android) : la page ne produit
  // aucun son et ne prend donc pas la main sur la musique d'une autre appli (Android Auto…).
  // Renvoie null si le navigateur ne sait pas faire ; sinon { frameDur, clock, stop }.
  BS.openMicFrames = async function (stream, onFrame) {
    const track = stream.getAudioTracks()[0];
    if (!track || typeof MediaStreamTrackProcessor === "undefined") return null;
    let reader;
    try { reader = new MediaStreamTrackProcessor({ track }).readable.getReader(); } catch { return null; }
    const clock = () => performance.now() / 1000;
    const first = await reader.read();
    if (first.done) return null;
    const sr = first.value.sampleRate, HOP = BS.HOP;
    const filters = BS.BANDS.map(b => biquad(b.type, b.freq, b.q, sr));
    const acc = [0, 0, 0, 0], zc = [0, 0, 0, 0], prev = [0, 0, 0, 0];
    let n = 0, total = 0, base = Infinity, stopped = false, mono = new Float32Array(0), tmp = new Float32Array(0);

    function handle(ad) {
      const nf = ad.numberOfFrames, ch = ad.numberOfChannels;
      if (mono.length < nf) { mono = new Float32Array(nf); tmp = new Float32Array(nf); }
      ad.copyTo(mono, { planeIndex: 0, format: "f32-planar" });
      for (let c = 1; c < ch; c++) {
        ad.copyTo(tmp, { planeIndex: c, format: "f32-planar" });
        for (let i = 0; i < nf; i++) mono[i] += tmp[i];
      }
      if (ch > 1) for (let i = 0; i < nf; i++) mono[i] /= ch;
      // Horloge : l'arrivée la plus précoce d'un bloc donne le décalage entre échantillons et temps réel.
      base = Math.min(base, clock() - (total + nf) / sr);
      for (let i = 0; i < nf; i++) {
        const x = mono[i];
        for (let b = 0; b < 4; b++) {
          const y = filters[b](x);
          acc[b] += y * y;
          if ((y >= 0) !== (prev[b] >= 0)) zc[b]++;
          prev[b] = y;
        }
        if (++n === HOP) {
          onFrame({ t: base + (total + i + 1 - HOP) / sr, e: acc.map(a => Math.sqrt(a / HOP)), z: zc.map(c => c / HOP) });
          acc.fill(0); zc.fill(0); n = 0;
        }
      }
      total += nf;
    }

    handle(first.value);
    first.value.close();
    (async () => {
      while (!stopped) {
        const { value, done } = await reader.read().catch(() => ({ done: true }));
        if (done) break;
        handle(value);
        value.close();
      }
    })();
    return {
      frameDur: HOP / sr,
      clock,
      stop() {
        stopped = true;
        reader.cancel().catch(() => {});
        stream.getTracks().forEach(t => t.stop());
      },
    };
  };

  // Branche le flux sur les 4 filtres + le worklet ; `onFrame({t, e, z})` est appelé toutes les ~11 ms
  // (e : énergie RMS par bande, z : taux de passage par zéro, qui suit grossièrement la hauteur des notes).
  // Si `delay` > 0, le son est rejoué avec ce retard (mode "delay").
  BS.createAnalyzer = async function (ctx, stream, delay, onFrame) {
    if (!loadedCtx.has(ctx)) {
      // URL data: d'abord (fonctionne aussi quand la page est ouverte en file://), sinon blob:.
      try {
        await ctx.audioWorklet.addModule("data:application/javascript;base64," + btoa(WORKLET));
      } catch {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      }
      loadedCtx.add(ctx);
    }
    const src = ctx.createMediaStreamSource(stream);
    const merger = ctx.createChannelMerger(4);
    const filters = BS.BANDS.map((band, b) => {
      const f = BS.makeFilter(ctx, band);
      src.connect(f).connect(merger, 0, b);
      return f;
    });
    const node = new AudioWorkletNode(ctx, "band-energy", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 4, channelCountMode: "explicit", channelInterpretation: "discrete",
      processorOptions: { hop: BS.HOP },
    });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    merger.connect(node);
    // Pas de sortie audio : sur Android, une page qui « joue » du son (même muet) peut prendre
    // la main sur la musique. On ne se branche sur la sortie que si le navigateur l'exige.
    let got = false;
    node.port.onmessage = e => { got = true; onFrame(e.data); };
    const fallback = setTimeout(() => { if (!got) node.connect(mute).connect(ctx.destination); }, 1000);

    let delayNode = null;
    if (delay > 0) {
      delayNode = ctx.createDelay(10);
      delayNode.delayTime.value = delay;
      src.connect(delayNode).connect(ctx.destination);
    }

    return {
      frameDur: BS.HOP / ctx.sampleRate,
      clock: () => ctx.currentTime,
      stop() {
        clearTimeout(fallback);
        node.port.onmessage = null;
        [src, merger, node, mute, delayNode, ...filters].forEach(n => n && n.disconnect());
        stream.getTracks().forEach(t => t.stop());
      },
    };
  };
})();
