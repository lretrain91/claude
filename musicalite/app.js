// Interface de l'appli Musicalité : écoute au micro (ou fichier), affichage des comptes,
// liste des événements en direct et bilan exportable.
(function () {
  "use strict";
  const BS = window.BS;
  const $ = id => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  let actx = null, capture = null, mus = null, wakeLock = null, raf = 0, evCount = 0;
  let lastSummary = null, liveQueued = false;

  // ---------- Affichage des comptes ----------
  const countEl = $("count");
  for (let i = 1; i <= 8; i++) {
    const d = document.createElement("div");
    d.textContent = i;
    if (i === 1 || i === 5) d.className = "one";
    countEl.appendChild(d);
  }
  const cells = [...countEl.children];
  const phraseCells = [...$("phrase").children];

  function renderPosition(p) {
    if (!p) {
      $("bpm").innerHTML = "—<small>BPM</small>";
      $("where-phrase").textContent = "Phrase —";
      $("where-eight").textContent = mus ? "écoute du rythme…" : "8-temps —";
      $("to-phrase").textContent = "";
      $("feel").textContent = "";
      cells.forEach(c => c.classList.remove("on"));
      phraseCells.forEach(c => c.className = "");
      return;
    }
    $("bpm").innerHTML = `${Math.round(p.bpm)}<small>BPM</small>`;
    $("feel").textContent = `tempo ${BS.tempoCategory(p.bpm)}` + (p.feeling ? ` · ${p.feeling}` : "");
    const tp = $("to-phrase");
    if (p.phraseSure) {
      $("where-phrase").textContent = `Phrase ${p.phrase}`;
      $("where-eight").textContent = `8-temps ${p.eight}/4`;
      tp.textContent = p.toPhrase === 32 ? "début de phrase !" : `prochaine phrase dans ${p.toPhrase}`;
      tp.className = p.toPhrase <= 8 || p.toPhrase === 32 ? "soon" : "";
    } else {
      // Écoute commencée en cours de morceau : le grand 1 se confirme au prochain changement.
      $("where-phrase").textContent = "Phrase ?";
      $("where-eight").textContent = "grand 1 à confirmer";
      tp.textContent = "";
    }
    phraseCells.forEach(c => c.classList.toggle("unsure", !p.phraseSure));
    cells.forEach((c, i) => {
      c.classList.toggle("on", i + 1 === p.count);
      c.classList.toggle("pulse", i + 1 === p.count && p.frac < 0.2); // flash court sur chaque temps
    });
    phraseCells.forEach((c, i) => c.className = i + 1 < p.eight ? "done" : i + 1 === p.eight ? "on" : "");
  }

  const latency = () => (Number($("latency").value) || 0) / 1000;
  $("latency").value = store.get("mu:latency") ?? 60;
  $("latency-v").textContent = `${$("latency").value} ms`;
  $("latency").addEventListener("input", e => {
    $("latency-v").textContent = `${e.target.value} ms`;
    store.set("mu:latency", Number(e.target.value));
  });

  let level = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!mus || !capture) return;
    renderPosition(mus.now(clockNow() + latency()));
    $("meter").style.width = `${Math.min(100, level * 2500)}%`;
  }

  // ---------- Événements ----------
  function clearEvents() {
    $("events").innerHTML = "";
    evCount = 0;
    $("ev-count").textContent = "";
    $("events-box").hidden = false;
  }

  function addEvent(ev) {
    if (ev.type === "tempo" && evCount > 0 && !/avant/.test(ev.detail)) return;
    const info = BS.EVENT_TYPES[ev.type];
    const li = document.createElement("li");
    li.innerHTML = `<div class="ev-time"></div><div class="ev-main"><span class="chip"></span><span class="pos"></span><span class="detail"></span></div>`;
    li.querySelector(".ev-time").textContent = mmss(ev.t);
    const chip = li.querySelector(".chip");
    chip.textContent = ev.label;
    chip.style.background = info.color;
    li.querySelector(".pos").textContent = ev.position;
    li.querySelector(".detail").textContent = ev.detail;
    const list = $("events");
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 300) list.removeChild(list.lastChild);
    evCount++;
    $("ev-count").textContent = `(${evCount})`;
  }

  function setStatus(msg, err) {
    $("status").textContent = msg || "";
    $("status").className = err ? "err" : "";
  }

  // ---------- Écoute au micro ----------
  function audioCtx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function newAnalyzer(frameDur, live) {
    return new BS.MusicalityAnalyzer(frameDur, {
      onEvent: addEvent,
      onBeat: () => { if (live && !liveQueued) { liveQueued = true; requestAnimationFrame(() => { liveQueued = false; renderLiveMap(); }); } },
    });
  }

  // Horloge de la source audio en cours (temps des trames d'analyse).
  const clockNow = () => (capture ? capture.clock() : actx ? actx.currentTime : 0);

  async function startListening() {
    let cap;
    try {
      setStatus("Autorise l'accès au micro…");
      cap = await BS.openCapture("mic");
    } catch (err) {
      return setStatus(err.name === "NotAllowedError" ? "Accès au micro refusé." : `Micro indisponible : ${err.message}`, true);
    }
    clearEvents();
    $("summary").className = "";

    // Si la musique disparaît juste après le lancement (Android Auto, Bluetooth…), on le signale.
    const cut = { start: null, ref: [], low: 0, shown: false };
    const pending = [];
    const onFrame = f => {
      level = (f.e[0] + f.e[1] + f.e[2] + f.e[3]) / 4;
      if (cut.start == null) cut.start = f.t;
      const since = f.t - cut.start;
      if (since < 0.6) cut.ref.push(level);
      else if (since < 8 && !cut.shown) {
        const ref = cut.ref.reduce((a, x) => a + x, 0) / Math.max(1, cut.ref.length);
        cut.low = level < 0.2 * ref ? cut.low + 1 : 0;
        if (ref > 0.003 && cut.low > 80) { // ~1 s bien plus bas qu'au départ
          cut.shown = true;
          setStatus("Ta musique s'est coupée ? Relance-la dans ton lecteur : l'écoute continue.", true);
        }
      }
      if (mus) mus.push(f); else pending.push(f);
    };
    try {
      // Lecture directe du micro si possible (aucun son produit par la page), sinon moteur audio.
      capture = await BS.openMicFrames(cap.stream, onFrame);
      if (!capture) capture = await BS.createAnalyzer(audioCtx(), cap.stream, 0, onFrame);
    } catch (err) {
      cap.stream.getTracks().forEach(t => t.stop());
      capture = null;
      return setStatus(`Impossible d'analyser le son : ${err.message}`, true);
    }
    mus = newAnalyzer(capture.frameDur, true);
    pending.forEach(f => mus.push(f));
    renderLiveMap();
    if (!cut.shown) setStatus("À l'écoute. Le tempo et les comptes apparaissent quand un rythme est bien audible.");
    $("listen").textContent = "Arrêter et voir le bilan";
    $("listen").classList.add("stop");
    $("tap-one").disabled = $("tap-phrase").disabled = false;
    $("pick-file").disabled = true;
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }

  function stopListening() {
    capture && capture.stop();
    capture = null;
    const songs = mus.finish();
    mus = null;
    level = 0;
    renderPosition(null);
    $("listen").textContent = "Écouter";
    $("listen").classList.remove("stop");
    $("tap-one").disabled = $("tap-phrase").disabled = true;
    $("pick-file").disabled = false;
    try { wakeLock && wakeLock.release(); } catch {}
    wakeLock = null;
    setStatus("");
    showSummary(songs, "micro");
  }

  $("listen").addEventListener("click", () => (capture ? stopListening() : startListening()));

  function tap(phraseStart) {
    if (!mus || !capture) return;
    if (mus.tapOne(clockNow() + latency(), phraseStart)) {
      setStatus(phraseStart ? "Début de phrase recalé." : "Le 1 est recalé.");
      navigator.vibrate && navigator.vibrate(30);
    } else {
      setStatus("Attends que le tempo soit détecté pour recaler.");
    }
  }
  $("tap-one").addEventListener("pointerdown", () => tap(false));
  $("tap-phrase").addEventListener("pointerdown", () => tap(true));

  // ---------- Analyse d'un fichier ----------
  $("pick-file").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || capture) return;
    const ctx = audioCtx();
    clearEvents();
    $("summary").className = "";
    try {
      setStatus(`Décodage de « ${f.name} »…`);
      const buffer = await ctx.decodeAudioData(await f.arrayBuffer());
      const an = newAnalyzer(BS.HOP / buffer.sampleRate);
      await BS.analyzeBuffer(buffer, an, p => setStatus(`Analyse… ${Math.round(p * 100)} %`));
      setStatus("");
      showSummary(an.finish(), f.name);
    } catch (err) {
      console.error(err);
      setStatus(`Impossible d'analyser ce fichier : ${err.message}`, true);
    }
  });

  // ---------- Carte et bilan ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Carte d'un morceau : en-tête, forme en lettres, carte visuelle, légende.
  function songCard(m, live) {
    const card = el("div", "song");
    const head = el("div", "song-head");
    head.appendChild(el("h3", null, live ? "En cours" : `Morceau ${m.morceau}`));
    head.appendChild(el("span", "muted", [`${Math.round(m.tempo_bpm)} BPM`, m.tempo_categorie, m.feeling, mmss(m.duree_s)]
      .filter(Boolean).join(" · ")));
    card.appendChild(head);

    const form = el("div", "form");
    m.sections.forEach(sec => {
      const c = el("span", "letter");
      c.appendChild(el("b", null, sec.lettre));
      c.appendChild(el("small", null, `${sec.huit_temps}×8`));
      c.style.setProperty("--c", BS.SECTION_COLORS[(sec.lettre.charCodeAt(0) - 65) % BS.SECTION_COLORS.length]);
      c.title = `${mmss(sec.debut_s)} · ${sec.debut} · énergie ${sec.energie}`;
      form.appendChild(c);
    });
    card.appendChild(form);

    const map = el("div", "map");
    const svg = BS.renderMap(m);
    map.appendChild(svg);
    card.appendChild(map);

    const legend = el("div", "legend");
    legend.appendChild(el("span", null, "ligne = phrase · trait blanc = grand 1 · couleur = section · intensité = énergie"));
    for (const [, mark] of BS.mapLegend(m)) {
      const it = el("span");
      const sym = el("b", null, mark.sym);
      sym.style.color = mark.color;
      it.append(sym, ` ${mark.label}`);
      legend.appendChild(it);
    }
    card.appendChild(legend);
    card.svg = svg;
    return card;
  }

  // Carte en direct : redessinée à chaque fin de 8-temps.
  function renderLiveMap() {
    const box = $("live-map");
    const m = mus && mus.current();
    box.innerHTML = "";
    if (m) box.appendChild(songCard(m, true));
    else box.appendChild(el("p", "muted", "La carte du morceau se dessine ici au fil de l'écoute."));
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function showSummary(songs, source) {
    const box = $("summary");
    box.innerHTML = "";
    $("live-map").innerHTML = "";
    lastSummary = { app: "Musicalité", date: new Date().toISOString(), source, morceaux: songs };
    box.appendChild(el("h2", null, "Bilan"));
    if (!songs.length) {
      box.appendChild(el("p", "muted", "Pas assez de musique entendue pour faire un bilan (il faut au moins une dizaine de secondes avec un rythme)."));
      box.className = "show";
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    for (const m of songs) {
      const card = songCard(m, false);
      const b = el("button", "btn ghost small", "Enregistrer l'image");
      b.addEventListener("click", async () => {
        try {
          const title = `Morceau ${m.morceau} · ${Math.round(m.tempo_bpm)} BPM · forme ${m.forme}`;
          download(await BS.mapToPng(card.svg, title), `musicalite-${stamp}-morceau-${m.morceau}.png`);
        } catch (err) {
          b.textContent = "Image impossible";
        }
      });
      card.appendChild(b);
      box.appendChild(card);
    }

    const text = BS.summaryText(songs);
    const json = JSON.stringify(lastSummary, null, 2);
    const exp = el("div", "export");
    const btn = (label, fn) => { const b = el("button", "btn", label); b.dataset.label = label; b.addEventListener("click", () => fn(b)); exp.appendChild(b); return b; };
    btn("Copier le résumé", async b => {
      try { await navigator.clipboard.writeText(text); b.textContent = "Copié ✓"; }
      catch { b.textContent = "Copie impossible"; }
      setTimeout(() => (b.textContent = b.dataset.label), 1500);
    });
    btn("Télécharger .json", () => download(new Blob([json], { type: "application/json" }), `musicalite-${stamp}.json`));
    if (navigator.share) {
      const b = btn("Partager", () => navigator.share({ title: "Musicalité", text }).catch(() => {}));
      b.style.gridColumn = "1 / -1";
    }
    box.appendChild(exp);
    const det = el("details");
    det.style.marginTop = "12px";
    det.appendChild(el("summary", "muted", "Résumé texte"));
    det.appendChild(el("pre", null, text));
    box.appendChild(det);
    box.className = "show";
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  renderPosition(null);
  loop();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
