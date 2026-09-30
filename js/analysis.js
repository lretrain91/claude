// Analyse audio : détection des attaques (onsets) sur 4 bandes de fréquence, choix des notes,
// estimation du tempo. Utilisé à la fois hors-ligne (extraits) et en direct (mode live).
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
      this.bands = [0, 1, 2, 3].map(() => ({ prevE: null, hist: [], m: 0, v: 0, frames: 0 }));
    }

    push(energies, t) {
      const out = [];
      let odf = 0;
      for (let b = 0; b < 4; b++) {
        const st = this.bands[b];
        const e = Math.log1p(1000 * energies[b]);
        const flux = st.prevE == null ? 0 : Math.max(0, e - st.prevE);
        st.prevE = e;
        odf += flux;
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
      return out;
    }
  };

  // Choisit parmi les attaques candidates en respectant les écarts minimaux entre notes.
  // Les plus fortes passent en premier ; si une piste est occupée on tente une voisine.
  BS.NoteSelector = class {
    constructor(cfg) { this.cfg = cfg; this.recent = []; }

    select(cands) {
      const cfg = this.cfg, recent = this.recent, out = [];
      const busy = (lane, t) => recent.some(n => n.lane === lane && Math.abs(n.t - t) < cfg.laneGap);
      for (const c of [...cands].sort((a, b) => b.s - a.s)) {
        if (recent.some(n => Math.abs(n.t - c.t) < cfg.minGap)) continue;
        let lane = c.lane;
        if (busy(lane, c.t)) {
          const alt = [lane - 1, lane + 1].filter(l => l >= 0 && l < 4 && !busy(l, c.t));
          if (!alt.length) continue;
          lane = alt[0];
        }
        const n = { t: c.t, lane };
        recent.push(n);
        out.push(n);
      }
      if (out.length) {
        const last = Math.max(...out.map(n => n.t));
        this.recent = recent.filter(n => n.t > last - 2);
      }
      return out.sort((a, b) => a.t - b.t);
    }

    reset() { this.recent = []; }
  };

  // Estimation du tempo par autocorrélation de la courbe d'attaques (8 dernières secondes).
  BS.TempoTracker = class {
    constructor(frameDur) {
      this.fd = frameDur;
      this.maxLen = Math.round(8 / frameDur);
      this.reset();
    }

    reset() { this.odf = []; this.bpm = null; this.bar = null; this.conf = 0; this.cand = null; }

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
      for (let lag = lagMin; lag <= lagMax; lag++) {
        const r = ac(lag);
        const bpm = 60 / (lag * fd);
        const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
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

  // ---------- Hors-ligne : génère toutes les notes d'un morceau décodé ----------
  async function renderBand(buffer, band) {
    const off = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
    const src = off.createBufferSource();
    src.buffer = buffer;
    src.connect(BS.makeFilter(off, band)).connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  }

  BS.buildChart = async function (buffer, cfg) {
    const HOP = BS.HOP, frameDur = HOP / buffer.sampleRate;
    const bands = await Promise.all(BS.BANDS.map(b => renderBand(buffer, b)));
    const det = new BS.OnsetDetector(frameDur, cfg.thresh);
    const frames = Math.floor(buffer.length / HOP);
    let cands = [];
    const e = [0, 0, 0, 0];
    for (let i = 0; i < frames; i++) {
      for (let b = 0; b < 4; b++) {
        let s = 0;
        const d = bands[b];
        for (let j = i * HOP, end = j + HOP; j < end; j++) s += d[j] * d[j];
        e[b] = Math.sqrt(s / HOP);
      }
      cands = cands.concat(det.push(e, i * frameDur));
    }
    return new BS.NoteSelector(cfg).select(cands.filter(c => c.t >= 0.3));
  };

  // ---------- Live : capture d'un flux audio et analyse en continu ----------
  const WORKLET = `
    class BandEnergy extends AudioWorkletProcessor {
      constructor(o) { super(); this.hop = o.processorOptions.hop; this.acc = [0,0,0,0]; this.n = 0; this.t0 = 0; }
      process(inputs) {
        const inp = inputs[0];
        if (!inp || !inp.length) return true;
        const len = inp[0].length;
        for (let i = 0; i < len; i++) {
          if (this.n === 0) this.t0 = currentTime + i / sampleRate;
          for (let b = 0; b < 4; b++) { const s = (inp[b] || inp[0])[i]; this.acc[b] += s * s; }
          if (++this.n === this.hop) {
            this.port.postMessage({ t: this.t0, e: this.acc.map(a => Math.sqrt(a / this.hop)) });
            this.acc = [0,0,0,0]; this.n = 0;
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

  // Branche le flux sur les 4 filtres + le worklet ; `onFrame({t, e})` est appelé toutes les ~11 ms.
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
    merger.connect(node).connect(mute).connect(ctx.destination);
    node.port.onmessage = e => onFrame(e.data);

    let delayNode = null;
    if (delay > 0) {
      delayNode = ctx.createDelay(10);
      delayNode.delayTime.value = delay;
      src.connect(delayNode).connect(ctx.destination);
    }

    return {
      frameDur: BS.HOP / ctx.sampleRate,
      stop() {
        node.port.onmessage = null;
        [src, merger, node, mute, delayNode, ...filters].forEach(n => n && n.disconnect());
        stream.getTracks().forEach(t => t.stop());
      },
    };
  };
})();
