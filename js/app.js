// Menu, écrans et les deux façons de jouer : extraits Spotify (hors-ligne) et session live.
(function () {
  "use strict";
  const BS = window.BS;
  const $ = id => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const fmt = n => n.toLocaleString("fr-FR");
  const pct = a => a.toFixed(1).replace(".", ",") + " %";

  const LEAD_IN = 2.0;      // extraits : secondes avant le début de la musique
  const LIVE_DELAY = 2.5;   // live (onglet) : retard appliqué au son rejoué
  const SILENCE_RMS = 0.002;

  let difficulty = store.get("bs:diff") || "normal";
  if (!BS.DIFFICULTY[difficulty]) difficulty = "normal";
  $("offset").value = store.get("bs:offset") ?? 0;
  const userOffset = () => (Number($("offset").value) || 0) / 1000;

  // ---------- Écrans ----------
  function show(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  }
  function setStatus(msg, err) {
    $("status").textContent = msg || "";
    $("status").className = err ? "err" : "";
  }

  // ---------- Menu ----------
  const diffSeg = $("diff");
  function renderDiff() {
    diffSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.d === difficulty));
  }
  diffSeg.addEventListener("click", e => {
    const d = e.target.dataset && e.target.dataset.d;
    if (!d) return;
    difficulty = d; store.set("bs:diff", d); renderDiff(); renderTracks();
  });
  $("offset").addEventListener("change", e => store.set("bs:offset", Number(e.target.value) || 0));
  renderDiff();

  const bestKey = track => "bs:best:" + difficulty + ":" + track.title + "|" + track.artist;

  function renderTracks() {
    const grid = $("tracks");
    grid.innerHTML = "";
    (window.TRACKS || []).forEach(track => {
      const btn = document.createElement("button");
      btn.className = "card";
      const best = store.get(bestKey(track));
      btn.innerHTML = `<img alt="" loading="lazy"><div class="meta"><div class="t"></div><div class="a"></div><div class="best"></div></div>`;
      btn.querySelector("img").src = track.cover;
      btn.querySelector(".t").textContent = track.title;
      btn.querySelector(".a").textContent = track.artist;
      btn.querySelector(".best").textContent = best ? `Record : ${fmt(best.score)} (${best.grade})` : "";
      btn.addEventListener("click", () => loadTrack(track));
      grid.appendChild(btn);
    });
    const file = document.createElement("button");
    file.className = "card file";
    file.innerHTML = `<div class="meta"><div class="t">+ Fichier audio</div><div class="a">MP3, WAV, OGG…</div></div>`;
    file.addEventListener("click", () => $("file").click());
    grid.appendChild(file);
  }
  renderTracks();

  $("file").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    await startFromBytes({ title: f.name.replace(/\.[^.]+$/, ""), artist: "Fichier local" }, () => f.arrayBuffer());
  });

  // ---------- Audio ----------
  let actx = null;
  function audioCtx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  let session = null; // { game, stop(), finish() }
  let replay = null;  // relance la dernière partie
  let busy = false;

  // ---------- Mode extraits ----------
  function loadTrack(track) {
    return startFromBytes(track, async () => {
      const res = await fetch(track.preview, { mode: "cors" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer();
    });
  }

  async function startFromBytes(track, getBytes) {
    if (busy) return;
    busy = true;
    const ctx = audioCtx();
    try {
      setStatus(`Chargement de « ${track.title} »…`);
      const buffer = await ctx.decodeAudioData(await getBytes());
      setStatus("Analyse du rythme…");
      const notes = await BS.buildChart(buffer, BS.DIFFICULTY[difficulty]);
      if (!notes.length) throw new Error("aucune note détectée");
      setStatus("");
      replay = () => playChart(track, buffer, notes);
      replay();
    } catch (err) {
      console.error(err);
      setStatus(`Impossible de charger ce titre (${err.message}). Essaie un autre titre, le mode live ou un fichier audio local.`, true);
    } finally {
      busy = false;
    }
  }

  function playChart(track, buffer, notes) {
    show("game");
    const ctx = audioCtx();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = ctx.currentTime + LEAD_IN;
    src.start(startAt);
    const offset = userOffset();
    const outLat = ctx.outputLatency || ctx.baseLatency || 0;
    $("songname").textContent = `${track.title} — ${track.artist}`;
    const game = BS.createGame({
      canvas: $("cv"),
      clock: () => ctx.currentTime - startAt - outLat - offset,
      approach: BS.DIFFICULTY[difficulty].approach,
      duration: buffer.duration,
      overlay: now => (now < 0 ? String(Math.ceil(-now)) : null),
      onChange: updateHud,
      onEnd: () => finish(),
    });
    notes.forEach(n => game.addNote(n));
    const stop = () => { game.stop(); try { src.stop(); } catch {} };
    const finish = () => {
      stop();
      const s = game.stats();
      const grade = BS.grade(s.acc, s.counts.miss);
      let bestMsg = "";
      if (track.preview) {
        const prev = store.get(bestKey(track));
        if (!prev || s.score > prev.score) {
          store.set(bestKey(track), { score: s.score, grade });
          bestMsg = prev ? "Nouveau record !" : "";
        } else {
          bestMsg = `Record : ${fmt(prev.score)}`;
        }
      }
      showResults(`${track.title} — ${track.artist} · ${difficulty}`, s, bestMsg, [], track.url);
    };
    session = { game, stop, finish };
  }

  // ---------- Mode live ----------
  async function startLive(kind) {
    if (busy) return;
    busy = true;
    const ctx = audioCtx();
    let cap;
    try {
      setStatus(kind === "mic" ? "Autorise l'accès au micro…" : "Choisis l'onglet Spotify et coche « Partager l'audio »…");
      cap = await BS.openCapture(kind);
    } catch (err) {
      busy = false;
      if (err && err.name === "NotAllowedError") return setStatus("Partage annulé.", true);
      return setStatus(`Impossible de démarrer le live : ${err.message}`, true);
    }
    setStatus("");

    const cfg = BS.DIFFICULTY[difficulty];
    const delay = cap.mode === "delay" ? LIVE_DELAY : 0;
    const outLat = ctx.outputLatency || ctx.baseLatency || 0;
    const offset = userOffset();
    // Mode "delay" : on entend le son rejoué par le jeu.
    // Mode "predict" : on entend la musique directement ; le son capté arrive un peu en retard.
    const clock = cap.mode === "delay"
      ? () => ctx.currentTime - outLat - offset
      : () => ctx.currentTime - 0.03 - offset;

    let analyzer = null;
    let detector = null, tempo = null;
    const selector = new BS.NoteSelector(cfg);
    let pending = [], lastTempoAt = 0, silentFor = 0, hearing = false, lastFrameT = 0;
    const songs = [];
    let songStart = null; // stats au début du titre en cours

    let game = null;

    function snapshot() { return game.stats(); }

    function closeSong() {
      if (!songStart) return;
      const now = snapshot(), c = {};
      for (const k of Object.keys(now.counts)) c[k] = now.counts[k] - songStart.counts[k];
      const total = c.perfect + c.good + c.ok + c.miss;
      if (total >= 8) songs.push({ score: now.score - songStart.score, counts: c, acc: BS.accuracy(c) });
      songStart = null;
    }

    function updateLabel() {
      const bpm = tempo && tempo.bpm && hearing ? ` · ${Math.round(tempo.bpm)} BPM` : "";
      const n = songs.length + 1;
      $("songname").textContent = `Live · ${cap.label}${bpm} · ` + (hearing ? `titre ${n}` : `en attente du titre ${n}`);
    }

    function onFrame(f) {
      if (!game) return;
      if (!detector) {
        detector = new BS.OnsetDetector(analyzer.frameDur, cfg.thresh);
        tempo = new BS.TempoTracker(analyzer.frameDur);
      }
      const fd = analyzer.frameDur;
      lastFrameT = f.t;
      const level = (f.e[0] + f.e[1] + f.e[2] + f.e[3]) / 4;

      // Silence prolongé = fin d'un titre (pratique pour une playlist).
      if (level < SILENCE_RMS) {
        silentFor += fd;
        if (hearing && silentFor > 1.2) {
          hearing = false;
          closeSong();
          tempo.reset();
          selector.reset();
          pending = [];
          updateLabel();
        }
      } else {
        silentFor = 0;
        if (!hearing) { hearing = true; songStart = snapshot(); updateLabel(); }
      }

      const cands = detector.push(f.e, f.t);
      tempo.push(detector.lastOdf);
      if (f.t - lastTempoAt > 0.5) {
        lastTempoAt = f.t;
        tempo.update();
        updateLabel();
        if (cap.mode === "predict" && tempo.bar) {
          game.setApproach(Math.max(0.6, Math.min(cfg.approach, tempo.bar - 0.45)));
        }
      }
      if (!hearing) return;

      for (const c of cands) pending.push(c);
      // On attend 250 ms avant de valider un groupe d'attaques pour garder les plus fortes.
      const cutoff = f.t - 0.25;
      if (!pending.length || pending[0].t >= cutoff) return;
      const batch = pending.filter(c => c.t < cutoff);
      pending = pending.filter(c => c.t >= cutoff);
      const lead = clock() + 0.35;
      for (const n of selector.select(batch)) {
        let target;
        if (cap.mode === "delay") target = n.t + delay;
        else if (tempo.bar && tempo.conf > 0.1) target = n.t + tempo.bar; // même moment, mesure suivante
        else continue;
        if (target > lead) game.addNote({ t: target, lane: n.lane });
      }
    }

    try {
      analyzer = await BS.createAnalyzer(ctx, cap.stream, delay, onFrame);
    } catch (err) {
      cap.stream.getTracks().forEach(t => t.stop());
      busy = false;
      return setStatus(`Impossible d'analyser le son : ${err.message}`, true);
    }
    busy = false;

    show("game");
    game = BS.createGame({
      canvas: $("cv"),
      clock,
      approach: cfg.approach,
      overlay: () => {
        if (game.upcoming() > 0) return null;
        if (!hearing) return "En attente de musique…";
        if (cap.mode === "predict" && !tempo.bar) return "Écoute du rythme…";
        return null;
      },
      onChange: s => { updateHud(s); },
    });

    updateLabel();
    const stop = () => { game.stop(); analyzer.stop(); };
    const finish = () => {
      if (hearing) closeSong();
      stop();
      const s = game.stats();
      const mode = cap.mode === "delay" ? "son rejoué avec 2,5 s de décalage" : "notes prédites";
      showResults(`Session live · ${cap.label} · ${mode} · ${difficulty}`, s, "", songs, null);
    };
    cap.stream.getAudioTracks().forEach(t => t.addEventListener("ended", () => { if (session && session.finish === finish) finish(); }));
    session = { game, stop, finish };
    replay = () => startLive(kind);
  }

  // ---------- HUD & résultats ----------
  function updateHud(s) {
    $("score").textContent = fmt(s.score);
    $("combo").textContent = s.combo > 1 ? `${s.combo}×` : "";
    $("acc").textContent = pct(s.acc);
  }

  function showResults(title, s, bestMsg, songs, url) {
    const c = s.counts;
    $("r-song").textContent = title;
    $("r-grade").textContent = BS.grade(s.acc, c.miss);
    $("r-score").textContent = fmt(s.score);
    $("r-best").textContent = bestMsg;
    $("r-perfect").textContent = c.perfect;
    $("r-good").textContent = c.good;
    $("r-ok").textContent = c.ok;
    $("r-miss").textContent = c.miss;
    $("r-combo").textContent = s.maxCombo;
    $("r-acc").textContent = pct(s.acc);

    const list = $("r-songs");
    list.innerHTML = "";
    songs.forEach((song, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span></span><b></b>`;
      li.querySelector("span").textContent = `Titre ${i + 1}`;
      li.querySelector("b").textContent = `${fmt(song.score)} · ${pct(song.acc)} · ${BS.grade(song.acc, song.counts.miss)}`;
      list.appendChild(li);
    });
    list.hidden = !songs.length;

    const link = $("r-link");
    link.innerHTML = "";
    if (url) {
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Écouter le titre complet sur Spotify";
      link.appendChild(a);
    }
    session = null;
    show("results");
  }

  function quit() {
    if (!session) return;
    session.finish();
  }

  // ---------- Entrées ----------
  window.addEventListener("keydown", e => {
    if (!session) return;
    if (e.code === "Escape") return quit();
    const lane = BS.KEYS.indexOf(e.code);
    if (lane < 0 || e.repeat) return;
    e.preventDefault();
    session.game.press(lane);
  });
  $("cv").addEventListener("pointerdown", e => {
    if (!session) return;
    const lane = session.game.laneAt(e.clientX);
    if (lane >= 0) session.game.press(lane);
  });
  $("quit").addEventListener("click", quit);
  $("live-tab").addEventListener("click", () => startLive("tab"));
  $("live-mic").addEventListener("click", () => startLive("mic"));
  $("retry").addEventListener("click", () => replay && replay());
  $("back").addEventListener("click", () => { renderTracks(); setStatus(""); show("menu"); });
})();
