// Moteur de jeu : affichage des pistes, notes, jugement des frappes, score.
// Il ne sait rien de l'audio : on lui donne une horloge (`clock`) et des notes à ajouter.
(function () {
  "use strict";
  const BS = (window.BS = window.BS || {});

  BS.KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
  BS.KEY_LABELS = ["D", "F", "J", "K"];
  BS.WINDOWS = { perfect: 0.045, good: 0.09, ok: 0.135 };
  BS.POINTS = { perfect: 300, good: 200, ok: 100 };
  BS.DIFFICULTY = {
    facile:    { minGap: 0.30, laneGap: 0.45, thresh: 1.9, approach: 1.7 },
    normal:    { minGap: 0.18, laneGap: 0.28, thresh: 1.5, approach: 1.35 },
    difficile: { minGap: 0.11, laneGap: 0.17, thresh: 1.2, approach: 1.05 },
  };

  const JUDGE_TEXT = {
    perfect: ["PARFAIT", "#1ed760"],
    good: ["BIEN", "#4fc3f7"],
    ok: ["OK", "#ffb347"],
    miss: ["RATÉ", "#ff5c7a"],
  };

  BS.accuracy = function (c) {
    const total = c.perfect + c.good + c.ok + c.miss;
    if (!total) return 100;
    return (100 * (c.perfect + c.good * 0.66 + c.ok * 0.33)) / total;
  };

  BS.grade = function (acc, miss) {
    if (acc >= 97 && miss === 0) return "S";
    if (acc >= 92) return "A";
    if (acc >= 82) return "B";
    if (acc >= 70) return "C";
    return "D";
  };

  // opts : { canvas, clock, approach, duration?, overlay?(now) -> string|null, onChange?(stats), onEnd?() }
  BS.createGame = function (opts) {
    const canvas = opts.canvas;
    const g = canvas.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const colors = ["--l0", "--l1", "--l2", "--l3"].map(v => css.getPropertyValue(v).trim());
    let W = 0, H = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener("resize", resize);
    resize();

    const st = {
      notes: [], next: 0,
      score: 0, combo: 0, maxCombo: 0,
      counts: { perfect: 0, good: 0, ok: 0, miss: 0 },
      pressed: [0, 0, 0, 0], flash: [], judge: null,
      approach: opts.approach, running: true,
    };

    function stats() {
      return { score: st.score, combo: st.combo, maxCombo: st.maxCombo,
        counts: { ...st.counts }, acc: BS.accuracy(st.counts) };
    }
    const changed = () => opts.onChange && opts.onChange(stats());

    // Les notes sont gardées triées par temps (en live elles arrivent au fil de l'eau).
    function addNote(n) {
      const arr = st.notes;
      let i = arr.length;
      while (i > st.next && arr[i - 1].t > n.t) i--;
      arr.splice(i, 0, { t: n.t, lane: n.lane, hit: null });
    }

    function judge(note, kind, now) {
      note.hit = kind;
      st.counts[kind]++;
      if (kind === "miss") {
        st.combo = 0;
      } else {
        st.combo++;
        st.maxCombo = Math.max(st.maxCombo, st.combo);
        st.score += Math.round(BS.POINTS[kind] * (1 + Math.min(st.combo, 100) / 100));
        st.flash.push({ lane: note.lane, until: now + 0.15 });
      }
      st.judge = { kind, until: now + 0.5 };
      changed();
    }

    function press(lane) {
      if (!st.running) return;
      const now = opts.clock();
      st.pressed[lane] = now + 0.08;
      let best = null;
      for (let i = st.next; i < st.notes.length; i++) {
        const n = st.notes[i];
        if (n.t - now > BS.WINDOWS.ok) break;
        if (n.hit || n.lane !== lane) continue;
        const d = Math.abs(n.t - now);
        if (d <= BS.WINDOWS.ok && (!best || d < Math.abs(best.t - now))) best = n;
      }
      if (!best) return;
      const d = Math.abs(best.t - now);
      judge(best, d <= BS.WINDOWS.perfect ? "perfect" : d <= BS.WINDOWS.good ? "good" : "ok", now);
    }

    function geometry() {
      const laneW = Math.min(110, (W - 32) / 4);
      return { laneW, x0: (W - laneW * 4) / 2, hitY: H - Math.max(90, H * 0.14) };
    }

    function laneAt(x) {
      const { laneW, x0 } = geometry();
      const l = Math.floor((x - x0) / laneW);
      return l >= 0 && l < 4 ? l : -1;
    }

    function frame() {
      if (!st.running) return;
      const now = opts.clock();
      while (st.next < st.notes.length) {
        const n = st.notes[st.next];
        if (n.hit) { st.next++; continue; }
        if (now - n.t > BS.WINDOWS.ok) { judge(n, "miss", now); st.next++; continue; }
        break;
      }
      if (st.next > 400) { st.notes.splice(0, st.next); st.next = 0; }
      draw(now);
      if (opts.duration != null && st.next >= st.notes.length && now > opts.duration + 0.3) {
        st.running = false;
        opts.onEnd && opts.onEnd();
        return;
      }
      requestAnimationFrame(frame);
    }

    function draw(now) {
      g.clearRect(0, 0, W, H);
      const { laneW, x0, hitY } = geometry();
      const speed = hitY / st.approach;

      for (let l = 0; l < 4; l++) {
        const x = x0 + l * laneW;
        g.fillStyle = l % 2 ? "#14161c" : "#171920";
        g.fillRect(x, 0, laneW, H);
        if (st.pressed[l] > now) {
          const grad = g.createLinearGradient(0, hitY, 0, hitY - 220);
          grad.addColorStop(0, colors[l] + "55");
          grad.addColorStop(1, colors[l] + "00");
          g.fillStyle = grad;
          g.fillRect(x, hitY - 220, laneW, 220);
        }
      }

      for (let l = 0; l < 4; l++) {
        const cx = x0 + l * laneW + laneW / 2;
        const flash = st.flash.some(f => f.lane === l && f.until > now);
        g.beginPath();
        g.arc(cx, hitY, laneW * 0.32, 0, Math.PI * 2);
        g.lineWidth = flash ? 5 : 3;
        g.strokeStyle = flash ? "#fff" : colors[l];
        g.stroke();
        g.fillStyle = "#8b90a0";
        g.font = "600 14px system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText(BS.KEY_LABELS[l], cx, hitY + laneW * 0.32 + 24);
      }
      st.flash = st.flash.filter(f => f.until > now);

      for (let i = st.next; i < st.notes.length; i++) {
        const n = st.notes[i];
        const y = hitY - (n.t - now) * speed;
        if (y < -40) break;
        if (n.hit) continue;
        const cx = x0 + n.lane * laneW + laneW / 2;
        g.beginPath();
        g.arc(cx, y, laneW * 0.28, 0, Math.PI * 2);
        g.fillStyle = colors[n.lane];
        g.fill();
        g.beginPath();
        g.arc(cx, y, laneW * 0.12, 0, Math.PI * 2);
        g.fillStyle = "rgba(255,255,255,0.55)";
        g.fill();
      }

      const overlay = opts.overlay && opts.overlay(now);
      if (overlay) {
        g.fillStyle = "#eceef3";
        g.font = overlay.length <= 2 ? "700 64px system-ui, sans-serif" : "600 22px system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText(overlay, W / 2, H * 0.4);
      }

      if (st.judge && st.judge.until > now) {
        const [txt, col] = JUDGE_TEXT[st.judge.kind];
        g.globalAlpha = Math.min(1, (st.judge.until - now) / 0.25);
        g.fillStyle = col;
        g.font = "800 32px system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText(txt, W / 2, hitY - 170);
        g.globalAlpha = 1;
      }

      if (opts.duration) {
        g.fillStyle = "#1ed760";
        g.fillRect(0, 0, W * Math.max(0, Math.min(1, now / opts.duration)), 3);
      }
    }

    requestAnimationFrame(frame);
    changed();

    return {
      addNote, press, laneAt, stats,
      upcoming: () => st.notes.length - st.next,
      setApproach(a) { st.approach = a; },
      stop() { st.running = false; window.removeEventListener("resize", resize); },
    };
  };
})();
