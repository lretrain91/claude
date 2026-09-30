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
  let lastSummary = null;

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
    $("where-phrase").textContent = `Phrase ${p.phrase}`;
    $("where-eight").textContent = `8-temps ${p.eight}/4`;
    const tp = $("to-phrase");
    tp.textContent = p.toPhrase === 32 ? "début de phrase !" : `prochaine phrase dans ${p.toPhrase}`;
    tp.className = p.toPhrase <= 8 || p.toPhrase === 32 ? "soon" : "";
    cells.forEach((c, i) => {
      c.classList.toggle("on", i + 1 === p.count);
      c.classList.toggle("pulse", i + 1 === p.count && p.frac < 0.2); // flash court sur chaque temps
    });
    phraseCells.forEach((c, i) => c.className = i + 1 < p.eight ? "done" : i + 1 === p.eight ? "on" : "");
  }

  const latency = () => (Number($("latency").value) || 0) / 1000;
  $("latency").value = store.get("mu:latency") ?? 60;
  $("latency-v").textContent = `${$("latency").value} ms`;
  const ideas = $("ideas");
  ideas.checked = store.get("mu:ideas") ?? true;
  const applyIdeas = () => document.body.classList.toggle("no-ideas", !ideas.checked);
  ideas.addEventListener("change", () => { store.set("mu:ideas", ideas.checked); applyIdeas(); });
  applyIdeas();

  $("latency").addEventListener("input", e => {
    $("latency-v").textContent = `${e.target.value} ms`;
    store.set("mu:latency", Number(e.target.value));
  });

  let level = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!mus || !actx) return;
    renderPosition(mus.now(actx.currentTime + latency()));
    $("meter").style.width = `${Math.min(100, level * 2500)}%`;
  }

  // ---------- Événements ----------
  function clearEvents() {
    $("events").innerHTML = "";
    evCount = 0;
    $("ev-count").textContent = "";
  }

  function addEvent(ev) {
    if (ev.type === "tempo" && evCount > 0 && !/avant/.test(ev.detail)) return;
    const info = BS.EVENT_TYPES[ev.type];
    const li = document.createElement("li");
    li.innerHTML = `<div class="ev-time"></div><div class="ev-main"><span class="chip"></span><span class="pos"></span><span class="detail"></span><span class="idee"></span></div>`;
    li.querySelector(".ev-time").textContent = mmss(ev.t);
    const chip = li.querySelector(".chip");
    chip.textContent = ev.label;
    chip.style.background = info.color;
    li.querySelector(".pos").textContent = ev.position;
    li.querySelector(".detail").textContent = ev.detail;
    if (ev.idee) li.querySelector(".idee").textContent = ev.idee;
    else li.querySelector(".idee").remove();
    const list = $("events");
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 300) list.removeChild(list.lastChild);
    evCount++;
    $("ev-count").textContent = `· ${evCount}`;
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

  function newAnalyzer(frameDur) {
    return new BS.MusicalityAnalyzer(frameDur, { onEvent: addEvent });
  }

  async function startListening() {
    const ctx = audioCtx();
    let cap;
    try {
      setStatus("Autorise l'accès au micro…");
      cap = await BS.openCapture("mic");
    } catch (err) {
      return setStatus(err.name === "NotAllowedError" ? "Accès au micro refusé." : `Micro indisponible : ${err.message}`, true);
    }
    clearEvents();
    $("summary").className = "";
    mus = newAnalyzer(BS.HOP / ctx.sampleRate);
    try {
      capture = await BS.createAnalyzer(ctx, cap.stream, 0, f => {
        level = (f.e[0] + f.e[1] + f.e[2] + f.e[3]) / 4;
        mus.push(f);
      });
    } catch (err) {
      cap.stream.getTracks().forEach(t => t.stop());
      mus = null;
      return setStatus(`Impossible d'analyser le son : ${err.message}`, true);
    }
    setStatus("À l'écoute. Le tempo et les comptes apparaissent après quelques secondes.");
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
    if (!mus || !actx) return;
    if (mus.tapOne(actx.currentTime + latency(), phraseStart)) {
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

  // ---------- Bilan ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function showSummary(songs, source) {
    const box = $("summary");
    box.innerHTML = "";
    lastSummary = { app: "Musicalité", date: new Date().toISOString(), source, morceaux: songs };
    box.appendChild(el("h2", null, "Bilan"));
    if (!songs.length) {
      box.appendChild(el("p", "muted", "Pas assez de musique entendue pour faire un bilan (il faut au moins une dizaine de secondes avec un rythme)."));
      box.className = "show";
      return;
    }
    for (const m of songs) {
      const card = el("div", "song");
      card.appendChild(el("h3", null, `Morceau ${m.morceau}`));
      card.appendChild(el("div", "muted", `${mmss(m.duree_s)} · tempo ${m.tempo_wcs}${m.tempo_stable ? "" : " et variable"}` +
        (m.feeling ? ` · ${m.feeling}` : "")));
      const stats = el("div", "stats");
      [[m.tempo_bpm, "BPM"], [m.nb_huit_temps, "× 8 temps"], [m.nb_phrases, "phrases"]].forEach(([v, l]) => {
        const d = el("div"); d.appendChild(el("b", null, String(v))); d.appendChild(el("span", null, l)); stats.appendChild(d);
      });
      card.appendChild(stats);

      card.appendChild(el("div", "legend", "Énergie de chaque 8-temps (un espace = une nouvelle phrase, contour violet = nouvelle section)"));
      const tl = el("div", "timeline");
      const starts = new Set(m.sections.map(s => s.debut_s));
      m.huit_temps.forEach((h, i) => {
        const d = el("div");
        d.style.opacity = String(0.2 + 0.8 * h.niveau);
        if (/ · 1\/4$/.test(h.position) && i > 0) d.classList.add("ph");
        if (starts.has(h.debut_s) && i > 0) d.classList.add("sec");
        d.title = `${mmss(h.debut_s)} · ${h.position} · énergie ${h.energie}`;
        tl.appendChild(d);
      });
      card.appendChild(tl);

      const secs = el("ul", "sections");
      m.sections.forEach((s, i) => {
        const li = el("li");
        li.appendChild(el("span", null, `${i + 1}. ${mmss(s.debut_s)} · ${s.debut}`));
        li.appendChild(el("span", "muted", `${s.huit_temps} × 8 · ${s.energie}`));
        secs.appendChild(li);
      });
      card.appendChild(secs);

      const chips = el("div", "chips");
      for (const [label, n] of Object.entries(m.resume_evenements)) {
        const type = Object.values(BS.EVENT_TYPES).find(t => t.label === label);
        const c = el("span", "chip", `${label} ×${n}`);
        c.style.background = type ? type.color : "#8b90a0";
        chips.appendChild(c);
      }
      card.appendChild(chips);
      box.appendChild(card);
    }

    const text = BS.summaryText(songs, $("ideas").checked);
    const exp = el("div", "export");
    const btn = (label, fn) => { const b = el("button", "btn", label); b.addEventListener("click", fn); exp.appendChild(b); return b; };
    const copy = async (str, b) => {
      try { await navigator.clipboard.writeText(str); b.textContent = "Copié ✓"; }
      catch { b.textContent = "Copie impossible"; }
      setTimeout(() => (b.textContent = b.dataset.label), 1500);
    };
    const download = (str, name, type) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([str], { type }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const json = JSON.stringify(lastSummary, null, 2);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const b1 = btn("Copier le texte", () => copy(text, b1)); b1.dataset.label = "Copier le texte";
    const b2 = btn("Copier le JSON", () => copy(json, b2)); b2.dataset.label = "Copier le JSON";
    btn("Télécharger .txt", () => download(text, `musicalite-${stamp}.txt`, "text/plain"));
    btn("Télécharger .json", () => download(json, `musicalite-${stamp}.json`, "application/json"));
    if (navigator.share) {
      const b = btn("Partager", () => navigator.share({ title: "Musicalité", text }).catch(() => {}));
      b.style.gridColumn = "1 / -1";
    }
    box.appendChild(exp);
    const det = el("details");
    det.style.marginTop = "12px";
    det.appendChild(el("summary", "muted", "Voir la liste complète"));
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
