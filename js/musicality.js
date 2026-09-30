// Analyse de musicalité pour la danse : tempo, comptes de 8, phrases, sections et
// événements de micro-musicalité (breaks, drops, accents, syncopes…).
// On lui pousse des trames d'énergie par bande ({ t, e: [4] }), en direct ou depuis un fichier.
(function () {
  "use strict";
  const BS = (window.BS = window.BS || {});

  const BAND_HINT = ["basse / grosse caisse", "caisse claire", "voix / instruments", "charley / cymbales"];
  const SUB = ["", "e", "&", "a"]; // 1 e & a
  const mod = (a, n) => ((a % n) + n) % n;
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const median = a => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const energyLabel = q => (q < 0.34 ? "calme" : q < 0.67 ? "moyenne" : "intense");

  BS.EVENT_TYPES = {
    tempo:   { label: "Tempo",              color: "#8b90a0" },
    section: { label: "Nouvelle section",   color: "#b388ff" },
    montee:  { label: "Montée",             color: "#ffb347" },
    drop:    { label: "Drop",               color: "#ff5c7a" },
    break:   { label: "Break",              color: "#4fc3f7" },
    reprise: { label: "Reprise",            color: "#4fc3f7" },
    bassOff: { label: "Basse coupée",       color: "#4fc3f7" },
    bassOn:  { label: "Retour de la basse", color: "#ff5c7a" },
    hit:     { label: "Hit",                color: "#ff5c7a" },
    accent:  { label: "Accent",             color: "#1ed760" },
    syncope: { label: "Syncope",            color: "#1ed760" },
    fill:    { label: "Fill",               color: "#ffb347" },
    fin:     { label: "Fin du morceau",     color: "#8b90a0" },
  };

  BS.MusicalityAnalyzer = class {
    constructor(frameDur, opts = {}) {
      this.fd = frameDur;
      this.onEvent = opts.onEvent || (() => {});
      this.onBeat = opts.onBeat || (() => {});
      this.silenceRms = opts.silenceRms ?? 0.002;
      this.songs = [];
      this.song = null;
      this.silentFor = 0;
    }

    // ---------- Flux ----------
    push(f) {
      const level = (f.e[0] + f.e[1] + f.e[2] + f.e[3]) / 4;
      if (level < this.silenceRms) {
        this.silentFor += this.fd;
        if (this.song && this.silentFor > 1.5) this.endSong();
      } else {
        this.silentFor = 0;
        if (!this.song) this.startSong(f.t);
      }
      const s = this.song;
      if (!s) return;

      const cands = s.detector.push(f.e, f.t);
      s.tempo.push(s.detector.lastOdf);
      s.frames.push(f);
      s.odf.push({ t: f.t, v: s.detector.lastOdf });
      for (const c of cands) s.onsets.push(c);
      // ~10 s de mémoire : quand le tempo est trouvé, on repart du début du morceau.
      while (s.frames.length && s.frames[0].t < f.t - 10) s.frames.shift();
      while (s.odf.length && s.odf[0].t < f.t - 6) s.odf.shift();
      while (s.onsets.length && s.onsets[0].t < f.t - 10) s.onsets.shift();
      s.lastT = f.t;

      if (f.t - s.lastTempoAt > 0.5) {
        s.lastTempoAt = f.t;
        s.tempo.update();
        this.updateGrid(f.t);
      }
      const g = s.grid;
      if (g) while (f.t >= g.next + g.P - g.P / 8 + 0.06) this.finalizeBeat();
    }

    startSong(t) {
      this.song = {
        n: this.songs.length + 1, start: t, lastT: t,
        detector: new BS.OnsetDetector(this.fd, 1.3),
        tempo: new BS.TempoTracker(this.fd),
        frames: [], odf: [], onsets: [], beats: [],
        lastTempoAt: t, grid: null, bpms: [],
        // comptes : quel temps est un « 1 », quel 8-temps commence une phrase
        oneOff: 0, oneVotes: 0, s8: new Array(8).fill(0), s8n: new Array(8).fill(0), manualOne: null,
        phraseOff: 0, s4: new Array(4).fill(0), manualPhrase: null,
        groove: new Float32Array(16 * 4),
        eights: [], eightD: [],
        inBreak: null, bassCut: null, rising: false, dropCool: 0, bpmShown: null, lastExcess: new Set(),
        events: [],
      };
    }

    endSong() {
      const s = this.song;
      if (!s) return;
      this.song = null;
      if (s.beats.length === 0 && !s.events.length) return;
      if (s.inBreak && s.inBreak.ev) s.events.splice(s.events.indexOf(s.inBreak.ev), 1); // c'est la fin, pas un break
      if (s.grid) this.emit(s, "fin", s.lastT, null, "");
      this.songs.push(s);
    }

    // ---------- Grille des temps ----------
    updateGrid(now) {
      const s = this.song;
      if (!s.tempo.bar) return;
      const P = s.tempo.bar / 4;
      const nb = Math.max(8, Math.round(P / this.fd));
      const acc = new Float32Array(nb);
      for (const o of s.odf) {
        const w = Math.exp((o.t - now) / 3);
        acc[Math.floor((mod(o.t, P) / P) * nb) % nb] += o.v * w;
      }
      const sm = acc.map((v, i) => 0.25 * acc[mod(i - 1, nb)] + 0.5 * v + 0.25 * acc[(i + 1) % nb]);
      let b = 0;
      for (let i = 1; i < nb; i++) if (sm[i] > sm[b]) b = i;
      const a = sm[mod(b - 1, nb)], c = sm[(b + 1) % nb], d = a - 2 * sm[b] + c;
      const bf = d < 0 ? b + (0.5 * (a - c)) / d : b;
      const phase = ((bf + 0.5) / nb) * P;

      const g = s.grid;
      if (!g) {
        // Premier temps : on remonte au début du morceau (ou 9 s en arrière au plus).
        const from = Math.max(s.start, now - 9) - P / 8;
        s.grid = { P, next: from + mod(phase - from, P), k: 0, miss: 0 };
      } else {
        const diff = mod(phase - mod(g.next, P) + P / 2, P) - P / 2;
        if (Math.abs(P - g.P) / g.P < 0.04 && Math.abs(diff) < 0.15 * P) {
          g.next += 0.35 * diff;
          g.P = 0.8 * g.P + 0.2 * P;
          g.miss = 0;
        } else if (++g.miss >= 3) {
          g.next += diff;
          g.P = P;
          g.miss = 0;
        }
      }
      const bpm = 60 / s.grid.P;
      if (!s.bpmShown || Math.abs(bpm - s.bpmShown) / s.bpmShown > 0.04) {
        this.emit(s, "tempo", now, null, `${Math.round(bpm)} BPM` + (s.bpmShown ? ` (avant ${Math.round(s.bpmShown)})` : ""));
        s.bpmShown = bpm;
      }
    }

    position(s, k, q = 0) {
      const one = s.manualOne ?? s.oneOff;
      const rel = k - one;
      const count = mod(rel, 8) + 1;
      const eightAbs = Math.floor(rel / 8);
      const p = s.manualPhrase ?? s.phraseOff;
      const e = eightAbs - p;
      const base = Math.floor((Math.floor(-one / 8) - p) / 4); // phrase du tout premier temps
      const phrase = Math.floor(e / 4) - base + 1;
      const eight = mod(e, 4) + 1;
      return { k, count, eight, phrase, eightAbs, sub: q,
        label: `P${phrase} · ${eight}/4 · ${count}${SUB[q]}` };
    }

    finalizeBeat() {
      const s = this.song, g = s.grid, P = g.P, k = g.k, T = g.next;
      const lo = T - P / 8, hi = T + P - P / 8;
      const fr = s.frames.filter(x => x.t >= lo && x.t < hi);
      const E = [0, 0, 0, 0], Z = [0, 0, 0, 0];
      for (const x of fr) for (let b = 0; b < 4; b++) { E[b] += x.e[b]; Z[b] += x.z ? x.z[b] : 0; }
      if (fr.length) for (let b = 0; b < 4; b++) { E[b] /= fr.length; Z[b] /= fr.length; }
      const beat = { k, t: T, P, E, Z, Et: E[0] + E[1] + E[2] + E[3],
        ons: s.onsets.filter(o => o.t >= lo && o.t < hi) };
      g.k++;
      g.next += P;
      s.bpms.push(60 / P);

      this.learnDownbeat(s, beat);
      const pos = this.position(s, k);
      beat.pos = pos;
      this.beatEvents(s, beat, pos);
      s.beats.push(beat);
      if (s.beats.length > 64) s.beats.shift();
      if (pos.count === 8) this.closeEight(s);
      this.onBeat({ song: s.n, t: T - s.start, bpm: 60 / P, ...pos });
    }

    // Le « 1 » du 8-temps : là où les notes changent (basse, accords) et où tape la grosse caisse.
    // Les grands changements (break, drop, nouvelle section) votent aussi, via vote1().
    learnDownbeat(s, beat) {
      const prev = s.beats.length ? s.beats[s.beats.length - 1] : null;
      const pitch = (a, b) => (a > 0 && b > 0 ? Math.abs(Math.log(a / b)) : 0);
      const N = prev ? 4 * pitch(beat.Z[0], prev.Z[0]) + 2 * pitch(beat.Z[1], prev.Z[1]) : 0;
      const low = Math.max(0, ...beat.ons.filter(o => o.lane === 0 && Math.abs(o.t - beat.t) < beat.P / 6).map(o => o.s));
      this.vote1(s, beat.k, N + 0.05 * low);
    }

    vote1(s, k, v) {
      const j = mod(k, 8);
      for (let i = 0; i < 8; i++) { s.s8[i] *= 0.995; s.s8n[i] *= 0.995; }
      s.s8[j] += v;
      s.s8n[j] += 1;
      if (s.manualOne != null || k < 16) return;
      const avg = i => (s.s8n[i] ? s.s8[i] / s.s8n[i] : 0);
      const score = i => avg(i) + 0.5 * avg((i + 4) % 8);
      let best = 0;
      for (let i = 1; i < 8; i++) if (score(i) > score(best)) best = i;
      if (best !== s.oneOff && score(best) > 1.1 * score(s.oneOff)) {
        if (++s.oneVotes >= 4) { s.oneOff = best; s.oneVotes = 0; }
      } else {
        s.oneVotes = 0;
      }
    }

    beatEvents(s, beat, pos) {
      const hist = s.beats.slice(-16).map(b => b.Et);
      if (hist.length < 8) return;
      const ref = median(hist);
      const at = (type, detail, q = 0, t = beat.t) =>
        this.emit(s, type, t, q ? this.position(s, beat.k, q) : pos, detail);

      // Break : la musique s'arrête presque ; reprise ou drop quand elle revient.
      if (!s.inBreak && beat.Et < 0.3 * ref) {
        s.inBreak = { k: beat.k, ref, ev: at("break", "la musique s'arrête") };
        return;
      }
      if (s.inBreak) {
        beat.inBreak = true;
        if (beat.Et > 0.55 * s.inBreak.ref) {
          const len = beat.k - s.inBreak.k;
          if (len >= 2 && beat.Et > 1.15 * s.inBreak.ref) at("drop", `après ${len} temps de break`);
          else at("reprise", `après ${len} temps`);
          this.vote1(s, beat.k, 3); // la musique repart presque toujours sur un 1…
          this.votePhrase(s, pos, 2); // …et souvent en début de phrase
          s.dropCool = 4;
          s.inBreak = null;
        }
        return;
      }

      // Basse coupée / retour de la basse (le reste de la musique continue).
      const refLow = median(s.beats.slice(-16).map(b => b.E[0]));
      const refRest = median(s.beats.slice(-16).map(b => b.Et - b.E[0]));
      let bassBack = false;
      if (!s.bassCut && beat.E[0] < 0.4 * refLow && beat.Et - beat.E[0] > 0.6 * refRest) {
        s.bassCut = { k: beat.k, ref: refLow };
        at("bassOff", "la basse disparaît");
        this.vote1(s, beat.k, 1.5);
      } else if (s.bassCut && beat.E[0] > 0.7 * s.bassCut.ref) {
        if (beat.k - s.bassCut.k >= 2) { at("bassOn", `après ${beat.k - s.bassCut.k} temps`); this.vote1(s, beat.k, 1.5); }
        s.bassCut = null;
        bassBack = true;
        s.dropCool = Math.max(s.dropCool, 4);
      }

      // Drop : forte hausse d'énergie après un passage plus calme.
      const prev4 = mean(s.beats.slice(-4).map(b => b.Et));
      const ref32 = median(s.beats.slice(-32).map(b => b.Et));
      if (s.dropCool > 0) s.dropCool--;
      else if (!bassBack && beat.Et > 1.8 * prev4 && prev4 < 0.75 * ref32) {
        at("drop", "l'énergie explose");
        this.vote1(s, beat.k, 3);
        this.votePhrase(s, pos, 2);
        s.dropCool = 8;
        return;
      }

      // Accents et syncopes : attaques bien plus fortes que le groove habituel à cette position.
      const strongest = {}, perLane = [0, 0, 0, 0];
      for (const o of beat.ons) {
        perLane[o.lane]++;
        const q = Math.max(0, Math.round((o.t - beat.t) / (beat.P / 4)));
        if (q > 3) continue;
        const key = q * 4 + o.lane;
        if (!strongest[key] || o.s > strongest[key].s) strongest[key] = { ...o, q };
      }
      const barPos = mod(beat.k, 4); // indépendant du calage du 1, qui peut changer
      const exceed = [];
      for (const key in strongest) {
        const o = strongest[key];
        const G = s.groove[(barPos * 4 + o.q) * 4 + o.lane];
        const excess = o.s - (2 * G + 1.5);
        if (o.s > 3 && excess > 0) exceed.push({ ...o, key: `${barPos}:${key}`, excess });
      }
      for (let q = 0; q < 4; q++) for (let b = 0; b < 4; b++) {
        const i = (barPos * 4 + q) * 4 + b, o = strongest[q * 4 + b];
        s.groove[i] = 0.7 * s.groove[i] + 0.3 * (o ? o.s : 0);
      }
      // Un dépassement qui se répète d'une mesure à l'autre est un nouveau motif, pas un accent.
      const fresh = exceed.filter(o => !s.lastExcess.has(o.key));
      s.lastExcess = new Set(exceed.map(o => o.key));
      // Pas d'accent pendant que le groove change (basse coupée, juste après une reprise ou un drop).
      if (beat.k < 24 || !fresh.length || s.bassCut || bassBack || s.dropCool > 0) return;
      const byQ = [0, 0, 0, 0];
      fresh.forEach(o => byQ[o.q]++);
      const hitQ = byQ.findIndex(n => n >= 3);
      if (hitQ >= 0) {
        const o = fresh.find(x => x.q === hitQ);
        return at("hit", "tous les instruments ensemble", hitQ, o.t);
      }
      const best = fresh.reduce((a, o) => (o.excess > a.excess ? o : a));
      if (perLane[best.lane] >= 3) return; // roulement : signalé comme fill en fin de 8-temps
      if (best.q === 0) at("accent", BAND_HINT[best.lane], 0, best.t);
      else at("syncope", (best.q === 2 ? "sur le & · " : "à contretemps · ") + BAND_HINT[best.lane], best.q, best.t);
    }

    // Fin d'un 8-temps : profil sonore, sections, montées, fills.
    // Le profil n'utilise que les temps 1 à 6 : les temps 7-8 portent souvent un fill ou un break.
    closeEight(s) {
      const bs = s.beats.slice(-8);
      if (bs.length < 8) return;
      const core = bs.slice(0, 6);
      const prof = [0, 1, 2, 3].map(b => mean(core.map(x => Math.log1p(1000 * x.E[b]))));
      prof.push(Math.log1p(mean(core.map(x => x.ons.length))));
      const first = bs[0];
      const eight = { n: first.pos.eightAbs, t: first.t, pos: first.pos, prof,
        energy: mean(bs.map(x => x.Et)), core: mean(core.map(x => x.Et)), high: mean(core.map(x => x.E[3])),
        on78: bs[6].ons.length + bs[7].ons.length, hadBreak: bs.some(x => x.inBreak) };
      const prev = s.eights[s.eights.length - 1];
      s.eights.push(eight);

      const energies = s.eights.map(e => e.energy);
      const lo = Math.min(...energies), hi = Math.max(...energies);
      eight.level = hi > lo ? (eight.energy - lo) / (hi - lo) : 0.5;

      if (prev && prev.n === eight.n - 1) {
        const D = prof.reduce((a, v, i) => a + Math.abs(v - prev.prof[i]), 0);
        const medD = median(s.eightD);
        s.eightD.push(D);
        const jump = Math.abs(Math.log(eight.core / prev.core));
        const isSection = s.eightD.length >= 3 && ((D > 2 * medD && D > 0.6) || jump > Math.log(1.35));
        for (let i = 0; i < 4; i++) s.s4[i] *= 0.95;
        s.s4[mod(eight.n, 4)] += D;
        this.updatePhrase(s);
        if (isSection) {
          eight.section = true;
          this.vote1(s, first.k, 3);
          this.emit(s, "section", eight.t, eight.pos, `énergie ${energyLabel(eight.level)}`);
        }
      }

      // Montée : trois 8-temps d'affilée de plus en plus forts (sans break), aigus en hausse.
      const last3 = s.eights.slice(-3);
      const rising = last3.length === 3 && !last3.some(e => e.hadBreak) &&
        last3[1].core > 1.08 * last3[0].core && last3[2].core > 1.08 * last3[1].core && last3[2].high > last3[0].high;
      if (rising && !s.rising) this.emit(s, "montee", last3[0].t, last3[0].pos, "l'énergie monte depuis 3 × 8 temps");
      s.rising = rising;

      // Fill : les temps 7-8 bien plus chargés que d'habitude (comparé aux 8-temps précédents).
      const before = s.eights.slice(-4, -1).filter(e => !e.hadBreak).map(e => e.on78);
      const ref78 = before.length ? mean(before) : mean(core.map(x => x.ons.length)) * 2;
      if (!eight.hadBreak && eight.on78 >= Math.max(1.6 * ref78, ref78 + 3)) {
        this.emit(s, "fill", bs[6].t, bs[6].pos, "roulement avant la suite");
      }
    }

    // Début de phrase : là où le son change le plus d'un 8-temps à l'autre (avec un peu d'inertie).
    votePhrase(s, pos, v) {
      if (pos.count !== 1) return;
      s.s4[mod(pos.eightAbs, 4)] += v;
      this.updatePhrase(s);
    }

    updatePhrase(s) {
      if (s.manualPhrase != null || s.eightD.length < 3) return;
      let best = 0;
      for (let i = 1; i < 4; i++) if (s.s4[i] > s.s4[best]) best = i;
      if (s.s4[best] > 1.2 * s.s4[s.phraseOff]) s.phraseOff = best;
    }

    emit(s, type, t, pos, detail) {
      const ev = { song: s.n, t: Math.max(0, t - s.start), type, label: BS.EVENT_TYPES[type].label,
        position: pos ? pos.label : "", detail, k: pos ? pos.k : null, q: pos ? pos.sub : 0 };
      s.events.push(ev);
      this.onEvent(ev);
      return ev;
    }

    // ---------- Pour l'affichage en direct ----------
    now(t) {
      const s = this.song;
      if (!s || !s.grid) return null;
      const g = s.grid, kf = g.k + (t - g.next) / g.P, k = Math.floor(kf);
      return { bpm: 60 / g.P, frac: kf - k, song: s.n, ...this.position(s, k) };
    }

    // L'utilisateur tape sur un « 1 » (ou sur le début d'une phrase) pour caler les comptes.
    tapOne(t, phraseStart) {
      const s = this.song;
      if (!s || !s.grid) return false;
      const k = Math.round(s.grid.k + (t - s.grid.next) / s.grid.P);
      s.manualOne = mod(k, 8);
      if (phraseStart) s.manualPhrase = mod(Math.floor((k - s.manualOne) / 8), 4);
      return true;
    }

    // ---------- Bilan ----------
    finish() {
      this.endSong();
      return this.summary();
    }

    summary() {
      return this.songs.filter(s => s.beats.length || s.bpms.length).map(s => {
        // Les positions sont recalculées avec le calage final des comptes et des phrases.
        const label = (k, q = 0) => this.position(s, k, q).label;
        const rel = t => +Math.max(0, t - s.start).toFixed(2);
        const bpm = median(s.bpms);
        const spread = s.bpms.length ? Math.sqrt(mean(s.bpms.map(b => (b - bpm) ** 2))) : 0;
        const sections = [];
        s.eights.forEach((e, i) => {
          if (i === 0 || e.section) sections.push({ debut_s: rel(e.t), debut: label(e.pos.k), huit_temps: 0, levels: [] });
          const cur = sections[sections.length - 1];
          cur.huit_temps++;
          cur.levels.push(e.level);
        });
        const resume = {};
        for (const ev of s.events) if (ev.type !== "tempo" && ev.type !== "fin") resume[ev.label] = (resume[ev.label] || 0) + 1;
        return {
          morceau: s.n,
          duree_s: +(s.lastT - s.start).toFixed(1),
          tempo_bpm: +bpm.toFixed(1),
          tempo_stable: spread < 0.02 * bpm,
          nb_temps: s.bpms.length,
          nb_huit_temps: s.eights.length,
          nb_phrases: Math.ceil(s.eights.length / 4),
          sections: sections.map(({ levels, ...x }) => ({ ...x, energie: energyLabel(mean(levels)) })),
          huit_temps: s.eights.map(e => ({ debut_s: rel(e.t), position: label(e.pos.k).replace(/ · \d+$/, ""),
            energie: energyLabel(e.level), niveau: +e.level.toFixed(2) })),
          resume_evenements: resume,
          evenements: [...s.events].sort((a, b) => a.t - b.t).map(ev => ({ t_s: +ev.t.toFixed(2),
            position: ev.k != null ? label(ev.k, ev.q) : "", type: ev.label, detail: ev.detail })),
        };
      });
    }
  };

  // Rejoue un fichier audio décodé dans l'analyseur, aussi vite que possible.
  BS.analyzeBuffer = async function (buffer, analyzer, onProgress) {
    const HOP = BS.HOP;
    const bands = await Promise.all(BS.BANDS.map(async band => {
      const off = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
      const src = off.createBufferSource();
      src.buffer = buffer;
      src.connect(BS.makeFilter(off, band)).connect(off.destination);
      src.start();
      return (await off.startRendering()).getChannelData(0);
    }));
    const frames = Math.floor(buffer.length / HOP), fd = HOP / buffer.sampleRate;
    for (let i = 0; i < frames; i++) {
      const e = [0, 0, 0, 0], z = [0, 0, 0, 0];
      for (let b = 0; b < 4; b++) {
        let sum = 0, zc = 0;
        const d = bands[b];
        for (let j = i * HOP, end = j + HOP; j < end; j++) {
          sum += d[j] * d[j];
          if (j > 0 && (d[j] >= 0) !== (d[j - 1] >= 0)) zc++;
        }
        e[b] = Math.sqrt(sum / HOP);
        z[b] = zc / HOP;
      }
      analyzer.push({ t: i * fd, e, z });
      if (i % 2000 === 0) { onProgress && onProgress(i / frames); await new Promise(r => setTimeout(r)); }
    }
  };

  // Version texte du bilan, lisible et facile à partager.
  BS.summaryText = function (songs) {
    const lines = [];
    const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    for (const m of songs) {
      lines.push(`MORCEAU ${m.morceau} — ${m.tempo_bpm} BPM${m.tempo_stable ? "" : " (tempo variable)"} · ${mmss(m.duree_s)}`);
      lines.push(`${m.nb_huit_temps} × 8 temps · ${m.nb_phrases} phrases`);
      lines.push("");
      lines.push("Structure :");
      m.sections.forEach((s, i) => lines.push(`  ${i + 1}. ${mmss(s.debut_s)}  ${s.debut}  · ${s.huit_temps} × 8 · énergie ${s.energie}`));
      lines.push("");
      const r = Object.entries(m.resume_evenements).map(([k, v]) => `${k} ×${v}`).join(", ");
      if (r) lines.push(`Micro-musicalité : ${r}`);
      lines.push("");
      for (const ev of m.evenements) {
        lines.push(`  ${mmss(ev.t_s)}  ${(ev.position || "").padEnd(16)}  ${ev.type}${ev.detail ? " — " + ev.detail : ""}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  };
})();
