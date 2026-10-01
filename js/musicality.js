// Analyse de musicalité pour la danse (réglée pour le West Coast Swing) : tempo, feeling
// swing/droit, comptes de 8, phrases, tags, sections et événements de micro-musicalité
// (breaks, drops, accents, syncopes…).
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
    feeling: { label: "Feeling",            color: "#8b90a0" },
    section: { label: "Nouvelle section",   color: "#b388ff" },
    tag:     { label: "Tag",                color: "#b388ff" },
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

  // Repères de tempo usuels en West Coast Swing.
  BS.tempoCategory = bpm => (bpm < 88 ? "lent" : bpm <= 108 ? "moyen" : "rapide");

  // Position du contretemps dans le temps : 0,5 = croches droites, ~0,67 = swing/shuffle.
  BS.feelingOf = ratio => (ratio == null ? null : ratio < 0.56 ? "droit" : ratio < 0.61 ? "légèrement swing" : "swing / shuffle");

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
        if (!this.song) this.startSong(f.t, this.silentFor > 0.2); // après un silence : entrée propre
        this.silentFor = 0;
      }
      const s = this.song;
      if (!s) return;

      const cands = s.detector.push(f.e, f.t);
      s.tempo.push(s.detector.tempoOdf);
      s.frames.push(f);
      s.odf.push({ t: f.t - this.fd, v: s.detector.tempoOdf }); // le lissage retarde d'environ une trame
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

    startSong(t, fromSilence = false) {
      this.song = {
        n: this.songs.length + 1, start: t, lastT: t, fromSilence,
        detector: new BS.OnsetDetector(this.fd, 1.3),
        tempo: new BS.TempoTracker(this.fd, 102), // la plupart des morceaux de WCS : 75–130 BPM
        offbeats: [], feeling: null,
        // Portions du morceau séparées par des tags, chacune avec son propre calage.
        regions: [], cur: { kStart: 0, num0: 1 },
        frames: [], odf: [], onsets: [], beats: [],
        lastTempoAt: t, grid: null, bpms: [], okRun: 0, lostFor: 0, log: [],
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
      this.finalAlign(s); // calage final sur tout le morceau
      if (s.inBreak && s.inBreak.ev) s.events.splice(s.events.indexOf(s.inBreak.ev), 1); // c'est la fin, pas un break
      if (s.grid) this.emit(s, "fin", s.lastT, null, "");
      this.songs.push(s);
    }

    // ---------- Grille des temps ----------
    updateGrid(now) {
      const s = this.song;
      // Pas de comptes tant qu'on n'entend pas un rythme franc (bruit de la pièce, voix…).
      if (s.grid) {
        if (s.tempo.weak || !s.tempo.bar) {
          if ((s.lostFor += 0.5) > 6) this.endSong(); // plus de rythme depuis 6 s : la musique s'est arrêtée
          if (!s.tempo.bar) return;
        } else s.lostFor = 0;
      } else {
        if (!s.tempo.ok || !s.tempo.bar) { s.okRun = 0; return; }
        if (++s.okRun < 2) return; // deux mesures concordantes avant de se lancer
      }
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
        // Premier temps : là où la musique a vraiment commencé (9 s en arrière au plus).
        s.start = this.musicStart(s, now);
        const from = s.start - P / 8;
        s.grid = { P, next: from + mod(phase - from, P), k: 0, miss: 0 };
        // A priori (voir realign) : si on a entendu l'entrée de la musique, elle se fait sur un grand 1.
        s.cleanStart = s.startClean;
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
        this.emit(s, "tempo", now, null, `${Math.round(bpm)} BPM · ${BS.tempoCategory(bpm)}` + (s.bpmShown ? ` (avant ${Math.round(s.bpmShown)})` : ""));
        s.bpmShown = bpm;
      }
    }

    region(s, k) {
      for (const r of s.regions) if (k < r.kEnd) return r;
      return s.cur;
    }

    // Début réel de la musique : dernier passage net du « bruit de fond » au niveau de la musique.
    musicStart(s, now) {
      const lv = s.frames.filter(x => x.t >= now - 9).map(x => ({ t: x.t, v: (x.e[0] + x.e[1] + x.e[2] + x.e[3]) / 4 }));
      if (!lv.length) return Math.max(s.start, now - 9);
      // Le morceau a commencé après un silence, il y a moins de 9 s : on a entendu son entrée.
      if (s.fromSilence && s.start >= now - 9) { s.startClean = true; return s.start; }
      // On raisonne par blocs d'une demi-seconde : les creux entre deux frappes ne comptent pas.
      const blk = Math.round(0.5 / this.fd);
      const blocks = [];
      for (let i = 0; i + blk <= lv.length; i += Math.round(blk / 2)) blocks.push({ i, m: mean(lv.slice(i, i + blk).map(x => x.v)) });
      s.startClean = false;
      if (blocks.length < 4) return Math.max(s.start, lv[0].t);
      const floor = Math.min(...blocks.map(b => b.m));
      const music = median(blocks.filter(b => lv[b.i].t >= now - 3).map(b => b.m));
      if (music < 2 * floor) return Math.max(s.start, lv[0].t); // pas de montée nette : la musique jouait déjà
      const thr = Math.min(Math.sqrt(floor * music), 0.5 * music);
      // On remonte jusqu'au dernier bloc nettement plus calme que la musique : elle entre juste après.
      for (let j = blocks.length - 1; j >= 0; j--) {
        if (blocks[j].m < thr) {
          s.startClean = true;
          const first = lv.slice(blocks[j].i).find(x => x.v >= thr);
          return first ? first.t : lv[blocks[j].i].t;
        }
      }
      return Math.max(s.start, lv[0].t);
    }

    // Grand 1 fiable ? Oui si on a entendu l'entrée du morceau (ou la reprise après un tag), si
    // l'utilisateur l'a calé, ou après 2 phrases entendues. Sinon on ne peut pas encore savoir
    // lequel des 8-temps d'une section ouvre la phrase.
    phraseSure(s) {
      if (s.manualPhrase != null || s.finalized) return true;
      if (s.cur.kStart === 0 ? s.cleanStart : true) return true;
      return s.log.filter(b => b.k >= s.cur.kStart).length >= 64;
    }

    position(s, k, q = 0) {
      const r = this.region(s, k);
      const one = r.one ?? s.manualOne ?? s.oneOff;
      const p = r.p ?? s.manualPhrase ?? s.phraseOff;
      const rel = k - one;
      const count = mod(rel, 8) + 1;
      const eightAbs = Math.floor(rel / 8);
      const e = eightAbs - p;
      const eA = Math.floor((Math.floor((r.kStart - one) / 8) - p) / 4); // phrase du début de la portion
      let phrase = r.num0 + Math.floor(e / 4) - eA;
      const eight = mod(e, 4) + 1;
      if (r.tagFrom != null && k >= r.tagFrom) {
        const n = k - r.tagFrom + 1;
        return { k, count: n, eight, phrase: r.lastPhrase, eightAbs, sub: q, tag: true, label: `Tag · ${n}${SUB[q]}` };
      }
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
      this.learnFeeling(s, beat);

      // Historique complet des temps : sert à la frise et au calage des 1 / grands 1.
      const onBeat = lane => Math.max(0, ...beat.ons.filter(o => o.lane === lane && Math.abs(o.t - T) < P / 6).map(o => o.s));
      s.log.push({ k, t: T, Et: beat.Et, E: [...E], Z: [Z[0], Z[1]], low: onBeat(0), mid: Math.max(onBeat(1), onBeat(2)),
        high: onBeat(3), n: beat.ons.length, evt: 0 });
      const pos = this.position(s, k);
      beat.pos = pos;
      this.beatEvents(s, beat, pos);
      s.beats.push(beat);
      if (s.beats.length > 64) s.beats.shift();
      if (pos.count === 8) this.closeEight(s);
      if (mod(k - s.cur.kStart, 4) === 3) this.realign(s, false);
      this.onBeat({ song: s.n, t: T - s.start, bpm: 60 / P, phraseSure: this.phraseSure(s), ...pos });
    }

    // Un grand changement (break, drop, basse, nouvelle section) au temps k : indice de début de phrase.
    vote1(s, k, v) {
      const b = s.log.find(x => x.k === k);
      if (b) b.evt += v;
    }

    // Calage des 1 et des grands 1 sur tout ce qui a été entendu depuis le début du morceau
    // (ou depuis le dernier tag). Pour chacune des 32 places possibles du grand 1, on additionne
    // les indices musicaux qui tombent au bon endroit, et on garde la plus cohérente :
    //  - changements de son ou d'énergie (sections, drops, reprises, basse) → début de phrase ;
    //  - fill ou roulement juste avant → début de phrase ;
    //  - changement de notes (basse, accords) et attaque forte → début de mesure ;
    //  - grosse caisse sur 1 et 3, caisse claire sur 2 et 4 → parité des temps.
    // `range` : une portion figée par un tag ({ kStart, kEnd, tagFrom }) ; on renvoie alors
    // seulement la meilleure place du grand 1, sans rien modifier.
    realign(s, final, range) {
      const part = range || s.cur;
      const manual = !range;
      let L = s.log.filter(b => b.k >= part.kStart && (part.kEnd == null || b.k < (part.tagFrom ?? part.kEnd)));
      // Les temps comptés dans le silence (avant l'entrée, après la fin) ressembleraient à de gros
      // changements de section : on les écarte.
      const medEt = median(L.map(b => b.Et));
      let a = 0, z = L.length;
      while (a < z && L[a].Et < 0.15 * medEt) a++;
      while (z > a && L[z - 1].Et < 0.15 * medEt) z--;
      L = L.slice(a, z);
      const n = L.length;
      if (n < 8) return null;
      if (manual && s.manualOne != null && s.manualPhrase != null) return null;
      const P = L.map(b => [...b.E.map(x => Math.log1p(1000 * x)), Math.log1p(b.n)]);
      const avgProf = (a, z) => { const r = [0, 0, 0, 0, 0]; for (let i = a; i < z; i++) for (let j = 0; j < 5; j++) r[j] += P[i][j] / (z - a); return r; };
      const avgEt = (a, z) => mean(L.slice(a, z).map(b => b.Et));
      const lg = (a, b) => (a > 0 && b > 0 ? Math.abs(Math.log(a / b)) : 0);
      const nov = [], jump = [], pitch = [], acc = [], fill = [], back = [];
      const nMed = median(L.map(b => b.n));
      for (let i = 0; i < n; i++) {
        // Avant / après le temps i, en mettant de côté les 2 temps juste avant : c'est là que se
        // logent les fills, qui sinon feraient croire que le changement commence 2 temps trop tôt.
        // Il faut 6 temps de recul de chaque côté : les derniers temps entendus, jugés avec moins
        // de recul, créeraient de faux changements.
        const w = 6;
        if (i - 2 - w >= 0 && i + w <= n) {
          const before = avgProf(i - 2 - w, i - 2), after = avgProf(i, i + w);
          nov.push(before.reduce((a, v, j) => a + Math.abs(v - after[j]), 0));
          jump.push(lg(avgEt(i, i + 4), avgEt(i - 6, i - 2)));
        } else { nov.push(0); jump.push(0); }
        pitch.push(i > 0 ? 2 * lg(L[i].Z[0], L[i - 1].Z[0]) + lg(L[i].Z[1], L[i - 1].Z[1]) : 0);
        acc.push(L[i].low + L[i].high);
        fill.push(i >= 2 ? Math.max(0, L[i - 1].n + L[i - 2].n - 2 * nMed) : 0);
        back.push(L[i].low - L[i].mid);
      }
      // Pour les changements, on retire ce qui revient à chaque mesure (le groove lui-même) :
      // seul compte ce qui sort de l'ordinaire à cette place dans la mesure.
      const ungroove = a => {
        const sum = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
        a.forEach((v, i) => { const j = mod(L[i].k, 4); sum[j] += v; cnt[j]++; });
        const avg = sum.map((x, j) => (cnt[j] ? x / cnt[j] : 0)), all = mean(a);
        return a.map((v, i) => Math.max(0, v - avg[mod(L[i].k, 4)] + all));
      };
      // Chaque indice est ramené à son niveau habituel pour pouvoir les additionner.
      const norm = a => { const m = mean(a.map(Math.abs)) || 1; return a.map(v => v / m); };
      const [N, J, H, A, F, K] = [ungroove(nov), ungroove(jump), pitch, acc, ungroove(fill), back].map(norm);
      const Emax = Math.max(1, ...L.map(b => b.evt));
      const score = o => {
        let sc = 0;
        for (let i = 0; i < n; i++) {
          const r = mod(L[i].k - o, 32);
          const B = N[i] + 1.5 * J[i] + 0.7 * F[i] + (3 * L[i].evt) / Emax; // changements
          const wB = r === 0 ? 3 : r % 8 === 0 ? 1 : r % 4 === 0 ? 0.3 : 0;
          const wA = r === 0 ? 0.5 : r % 8 === 0 ? 0.4 : r % 4 === 0 ? 0.2 : 0; // attaques
          const wH = r % 8 === 0 ? 1 : r % 4 === 0 ? 0.7 : 0;                     // notes
          sc += wB * B + wA * A[i] + wH * H[i] + (r % 2 === 0 ? 0.6 : -0.6) * K[i]; // grosse caisse / caisse claire
        }
        return sc;
      };
      // A priori : si on a entendu l'entrée de la musique, elle se fait presque toujours sur un
      // grand 1. Elle compte comme le plus gros changement du morceau, sans plus : si l'écoute a
      // commencé en cours de morceau, les autres indices l'emportent.
      let maxB = 0;
      for (let i = 0; i < n; i++) maxB = Math.max(maxB, N[i] + 1.5 * J[i] + 0.7 * F[i] + (3 * L[i].evt) / Emax);
      // Même a priori pour la reprise qui ouvre une portion après un tag : c'est un grand 1.
      const clean = part.kStart === 0 ? s.cleanStart : true;
      const cands = [];
      for (let o = 0; o < 32; o++) {
        if (manual && s.manualOne != null && mod(o, 8) !== mod(s.manualOne, 8)) continue;
        const r0 = mod(L[0].k - o, 32);
        const prior = clean ? (r0 === 0 ? 3 : r0 % 8 === 0 ? 1 : 0) * maxB : 0;
        cands.push({ o, sc: score(o) + prior });
      }
      cands.sort((a, b) => b.sc - a.sc);
      const best = cands[0];
      if (range) return best.o;
      const apply = o => {
        const newOne = mod(o, 8);
        if (s.manualOne == null) s.oneOff = newOne;
        if (s.manualPhrase == null) s.phraseOff = mod((o - newOne) / 8, 4);
      };
      if (final) { s.alignCand = null; s.finalized = true; apply(best.o); return; }

      const one = s.manualOne ?? s.oneOff, p = s.manualPhrase ?? s.phraseOff;
      const curO = mod(one + 8 * p, 32);
      const cur = cands.find(c => c.o === curO);
      if (best.o === curO) { s.alignCand = null; return; }
      // En direct, on ne change qu'avec une nette avance, confirmée deux fois de suite.
      const margin = cur ? best.sc - cur.sc : Infinity;
      if (margin < 0.08 * Math.abs(best.sc) + 1 || s.alignCand !== best.o) { s.alignCand = best.o; return; }
      s.alignCand = null;
      apply(best.o);
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
          s.dropCool = 4;
          s.inBreak = null;
          // La musique repart presque toujours sur un 1, souvent en début de phrase.
          // Si elle repart ailleurs après un vrai break, c'est probablement un tag.
          this.vote1(s, beat.k, 3);
          if (len >= 2 && pos.count !== 1 && beat.k >= 32) {
            // Avant de parler de tag, on vérifie avec le meilleur calage sur tout ce qu'on a entendu :
            // souvent, c'est le calage qui était faux et la reprise tombe bien sur un 1.
            this.realign(s, true);
            const p2 = this.position(s, beat.k);
            if (p2.count !== 1) this.tag(s, beat, p2);
          }
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
        const ph = (o.t - beat.t) / beat.P;
        // En swing, le « & » tombe vers 2/3 du temps et non à la moitié.
        const q = s.swing > 0.6 && ph > 0.55 && ph < 0.8 ? 2 : Math.max(0, Math.round(ph * 4));
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
        if (isSection) {
          eight.section = true;
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

    // Tag : on recale les comptes pour que ce temps devienne le 1 d'une phrase.
    tag(s, beat, pos) {
      const shift = pos.count - 1;
      // On fige le calage de la portion précédente ; les temps en trop forment le tag.
      const last = this.position(s, beat.k - shift - 1);
      s.regions.push({ ...s.cur, kEnd: beat.k, one: s.manualOne ?? s.oneOff, p: s.manualPhrase ?? s.phraseOff,
        tagFrom: shift <= 4 ? beat.k - shift : null, lastPhrase: last.phrase });
      s.cur = { kStart: beat.k, num0: last.phrase + 1 };
      const one = mod(beat.k, 8);
      s.oneOff = one;
      s.oneVotes = 0;
      s.s8.fill(0); s.s8n.fill(0);
      this.vote1(s, beat.k, 3);
      if (s.manualOne != null) s.manualOne = one;
      const eightAbs = Math.floor((beat.k - one) / 8);
      s.phraseOff = mod(eightAbs, 4);
      s.s4.fill(0);
      s.s4[s.phraseOff] = 3;
      if (s.manualPhrase != null) s.manualPhrase = s.phraseOff;
      const extra = shift <= 4 ? `${shift} temps en plus` : `${8 - shift} temps en moins`;
      this.emit(s, "tag", beat.t, this.position(s, beat.k), `la musique repart sur le ${pos.count} : phrase décalée (${extra}), comptes recalés`);
    }

    // Swing ou droit : où tombent les contretemps (charley, caisse claire) dans le temps.
    learnFeeling(s, beat) {
      for (const o of beat.ons) {
        if (o.lane === 0) continue;
        const ph = (o.t - beat.t) / beat.P;
        if (ph > 0.38 && ph < 0.8) s.offbeats.push(ph);
      }
      if (s.offbeats.length > 300) s.offbeats.splice(0, s.offbeats.length - 300);
      if (beat.k < 24 || beat.k % 8 !== 7 || s.offbeats.length < 12) return;
      const ratio = median(s.offbeats);
      const feeling = BS.feelingOf(ratio);
      if (feeling !== s.feeling) {
        s.feeling = feeling;
        s.swing = ratio;
        this.emit(s, "feeling", beat.t, null, `${feeling} (contretemps à ${Math.round(ratio * 100)} % du temps)`);
      }
      s.swing = ratio;
    }

    // Calage final : chaque portion (séparée par un tag) est recalée sur ses propres temps ; si deux
    // portions voisines ont le même calage, le tag était faux et on les fusionne.
    finalAlign(s) {
      for (let i = s.regions.length - 1; i >= 0; i--) {
        const r = s.regions[i], next = s.regions[i + 1] || s.cur;
        const o1 = this.realign(s, true, r);
        const o2 = next === s.cur ? this.realign(s, true, { kStart: next.kStart }) : this.realign(s, true, next);
        if (o1 != null && o2 != null && o1 === o2) {
          next.kStart = r.kStart;
          next.num0 = r.num0;
          s.events = s.events.filter(e => !(e.type === "tag" && e.k === r.kEnd));
          s.regions.splice(i, 1);
        } else if (o1 != null) {
          r.one = mod(o1, 8);
          r.p = mod((o1 - r.one) / 8, 4);
        }
      }
      this.realign(s, true);
      // Numérotation des phrases d'une portion à l'autre.
      const parts = [...s.regions, s.cur];
      for (let i = 1; i < parts.length; i++) {
        const prev = parts[i - 1];
        const lastK = (prev.tagFrom ?? prev.kEnd) - 1;
        const saved = prev.tagFrom;
        prev.tagFrom = null;
        const ph = this.position(s, lastK).phrase;
        prev.tagFrom = saved;
        prev.lastPhrase = ph;
        parts[i].num0 = ph + 1;
      }
    }

    // Début de phrase : un grand changement à cet endroit est un indice (voir realign).
    votePhrase() {}

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
      const pos = this.position(s, k);
      return { bpm: 60 / g.P, frac: kf - k, song: s.n, feeling: s.feeling, phraseSure: this.phraseSure(s), ...pos,
        toPhrase: (4 - pos.eight) * 8 + (8 - pos.count) + 1 };
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
      return this.songs.filter(s => s.beats.length || s.bpms.length).map(s => this.summarizeSong(s));
    }

    // Résumé du morceau en cours (pour la carte en direct).
    current() {
      const s = this.song;
      return s && s.log.length ? this.summarizeSong(s) : null;
    }

    summarizeSong(s) {
      // Les positions sont recalculées avec le calage final des comptes et des phrases.
      const label = (k, q = 0) => this.position(s, k, q).label;
      const rel = t => +Math.max(0, t - s.start).toFixed(2);
      const bpm = median(s.bpms);
      const spread = s.bpms.length ? Math.sqrt(mean(s.bpms.map(b => (b - bpm) ** 2))) : 0;

      // Énergie de chaque 8-temps, relative à tout le morceau.
      const energies = s.eights.map(e => e.energy);
      const lo = Math.min(...energies), hi = Math.max(...energies);
      const level = e => (hi > lo ? (e.energy - lo) / (hi - lo) : 0.5);

      // Sections, puis lettres : deux sections au son proche reçoivent la même lettre (A B A B…).
      const sections = [];
      s.eights.forEach((e, i) => {
        if (i === 0 || e.section) sections.push({ debut_s: rel(e.t), debut: label(e.pos.k), huit_temps: 0, levels: [], profs: [] });
        const cur = sections[sections.length - 1];
        cur.huit_temps++;
        cur.levels.push(level(e));
        cur.profs.push(e.prof);
        e.sectionIndex = sections.length - 1;
      });
      const thr = Math.max(0.6, 2 * median(s.eightD));
      const groups = [];
      for (const sec of sections) {
        sec.prof = sec.profs[0].map((_, i) => mean(sec.profs.map(p => p[i])));
        let best = null, bestD = Infinity;
        for (const g of groups) {
          const d = g.prof.reduce((a, v, i) => a + Math.abs(v - sec.prof[i]), 0);
          if (d < bestD) { bestD = d; best = g; }
        }
        if (!best || bestD > thr) { best = { letter: String.fromCharCode(65 + groups.length), prof: sec.prof }; groups.push(best); }
        sec.lettre = best.letter;
      }

      const resume = {};
      for (const ev of s.events) if (!["tempo", "fin", "feeling"].includes(ev.type)) resume[ev.label] = (resume[ev.label] || 0) + 1;
      return {
        morceau: s.n,
        horloge_debut: +s.start.toFixed(3), // pour recaler les taps des données d'apprentissage
        duree_s: +(s.lastT - s.start).toFixed(1),
        tempo_bpm: +bpm.toFixed(1),
        tempo_categorie: BS.tempoCategory(bpm),
        tempo_stable: spread < 0.02 * bpm,
        feeling: BS.feelingOf(s.offbeats.length >= 12 ? median(s.offbeats) : null),
        nb_temps: s.bpms.length,
        nb_huit_temps: s.eights.length,
        nb_phrases: Math.ceil(s.eights.length / 4),
        forme: sections.map(x => x.lettre).join(" "),
        sections: sections.map(({ levels, profs, prof, ...x }) => ({ ...x, energie: energyLabel(mean(levels)) })),
        temps: (() => {
          // Énergie de chaque temps, lissée sur ±2 temps et ramenée entre 0 et 1 (percentiles 5–95).
          const E = s.log.map((b, i) => mean(s.log.slice(Math.max(0, i - 2), i + 3).map(x => x.Et)));
          const sorted = [...E].sort((a, b) => a - b);
          const p5 = sorted[Math.floor(sorted.length * 0.05)] || 0, p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
          const starts = sections.map(x => x.debut_s);
          // On retire les temps comptés après la fin de la musique (silence avant l'arrêt).
          const med = median(s.log.map(b => b.Et));
          let end = s.log.length;
          while (end > 0 && s.log[end - 1].Et < 0.15 * med) end--;
          return s.log.slice(0, end).map((b, i) => {
            const pos = this.position(s, b.k), t = rel(b.t);
            let si = 0;
            while (si + 1 < starts.length && starts[si + 1] <= t + 0.01) si++;
            return { t_s: t, compte: pos.count, huit: pos.eight, phrase: pos.phrase, tag: !!pos.tag,
              section: sections[si] ? sections[si].lettre : "A",
              niveau: +Math.max(0, Math.min(1, (E[i] - p5) / Math.max(1e-9, p95 - p5))).toFixed(2) };
          });
        })(),
        huit_temps: s.eights.map(e => {
          const pos = this.position(s, e.pos.k);
          return { debut_s: rel(e.t), position: label(e.pos.k).replace(/ · \d+$/, ""), phrase: pos.phrase, huit: pos.eight,
            section: sections[e.sectionIndex].lettre, energie: energyLabel(level(e)), niveau: +level(e).toFixed(2) };
        }),
        resume_evenements: resume,
        evenements: [...s.events].sort((a, b) => a.t - b.t).map(ev => ({ t_s: +ev.t.toFixed(2),
          position: ev.k != null ? label(ev.k, ev.q) : "", type: ev.label, code: ev.type, detail: ev.detail })),
      };
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

  // Moments marquants (affichés sur la carte et dans le résumé) ; le reste n'est que compté.
  BS.KEY_MOMENTS = ["tag", "break", "drop", "montee", "bassOff", "hit"];

  // Version texte du bilan : courte, lisible, facile à partager.
  BS.summaryText = function (songs) {
    const lines = [];
    const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    for (const m of songs) {
      lines.push(`MORCEAU ${m.morceau} — ${Math.round(m.tempo_bpm)} BPM (${m.tempo_categorie})` +
        `${m.feeling ? " · " + m.feeling : ""} · ${mmss(m.duree_s)} · ${m.nb_phrases} phrases`);
      lines.push(`Forme : ${m.forme}`);
      lines.push("");
      m.sections.forEach(s => lines.push(`  ${s.lettre}  ${mmss(s.debut_s)}  ${s.huit_temps} × 8  ${s.energie}`));
      const moments = m.evenements.filter(ev => BS.KEY_MOMENTS.includes(ev.code));
      if (moments.length) {
        lines.push("");
        lines.push("Moments clés :");
        for (const ev of moments) lines.push(`  ${mmss(ev.t_s)}  ${ev.type}${ev.position ? " (" + ev.position + ")" : ""}`);
      }
      const small = ["accent", "syncope", "fill"].map(code => {
        const n = m.evenements.filter(ev => ev.code === code).length;
        return n ? `${BS.EVENT_TYPES[code].label.toLowerCase()}s ×${n}` : null;
      }).filter(Boolean);
      if (small.length) lines.push("", `Détails : ${small.join(", ")}`);
      lines.push("");
    }
    return lines.join("\n");
  };

})();
