// Carte visuelle d'un morceau : un bâton par 8-temps (hauteur = énergie, couleur = section),
// les phrases espacées, et les moments clés marqués au-dessus.
(function () {
  "use strict";
  const BS = window.BS;

  BS.SECTION_COLORS = ["#1ed760", "#b388ff", "#ffb347", "#4fc3f7", "#ff5c7a", "#e0e0e0"];
  const colorOf = letter => BS.SECTION_COLORS[(letter.charCodeAt(0) - 65) % BS.SECTION_COLORS.length];

  // Symbole de chaque moment clé sur la carte.
  BS.MOMENT_MARKS = {
    tag:     { sym: "T", color: "#b388ff", label: "tag" },
    break:   { sym: "‖", color: "#4fc3f7", label: "break" },
    drop:    { sym: "▲", color: "#ff5c7a", label: "drop" },
    montee:  { sym: "↗", color: "#ffb347", label: "montée" },
    bassOff: { sym: "~", color: "#4fc3f7", label: "basse coupée" },
    hit:     { sym: "●", color: "#ff5c7a", label: "hit" },
  };

  const NS = "http://www.w3.org/2000/svg";
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  function node(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  // Frise chronologique : une ligne par phrase (4 × 8 temps), un trait par temps.
  // Les 1 de toutes les phrases sont alignés : les passages qui se répètent se voient d'un coup d'œil.
  BS.renderMap = function (song) {
    const beats = song.temps || [];
    // Chaque ligne : bande des symboles (12), traits (24), lettres (10), marge (10).
    const BX = 10, LEFT = 34, COLS = 32, EXTRA = 4, ROW_H = 56, TOP = 18, FONT = "system-ui, -apple-system, sans-serif";
    const TICK = { grand: 24, un: 16, cinq: 10, temps: 6 };

    // Une ligne par phrase ; colonne = place du temps dans la phrase (les temps de tag vont au bout).
    const rows = [];
    let cur = null;
    beats.forEach((b, i) => {
      if (!cur || (!b.tag && b.phrase !== cur.phrase)) { cur = { phrase: b.phrase, beats: [] }; rows.push(cur); }
      const col = b.tag ? COLS + b.compte - 1 : (b.huit - 1) * 8 + (b.compte - 1);
      cur.beats.push({ ...b, i, col });
    });

    const width = LEFT + (COLS + EXTRA) * BX + 6;
    const height = TOP + Math.max(1, rows.length) * ROW_H + 4;
    const svg = node("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", role: "img",
      "aria-label": `Frise du morceau, forme ${song.forme}`, "font-family": FONT });
    svg.style.display = "block";
    svg.appendChild(node("rect", { x: 0, y: 0, width, height, fill: "#181a21" }));

    // Règle du haut : numéro du 8-temps dans la phrase.
    for (let e = 0; e < 4; e++) {
      svg.appendChild(node("text", { x: LEFT + e * 8 * BX + 2, y: 12, "font-size": 9, fill: "#8b90a0" }, `${e + 1}/4`));
      svg.appendChild(node("line", { x1: LEFT + e * 8 * BX - BX / 2, y1: 16, x2: LEFT + e * 8 * BX - BX / 2, y2: height - 4,
        stroke: "#2a2d38", "stroke-width": e === 0 ? 0 : 0.8 }));
    }

    const xOf = col => LEFT + col * BX;
    const where = new Map(); // indice du temps → position, pour placer les moments
    rows.forEach((row, r) => {
      const base = TOP + r * ROW_H + 38; // pied des traits
      const first = row.beats[0];
      svg.appendChild(node("text", { x: 2, y: base - 12, "font-size": 11, "font-weight": 800, fill: "#eceef3" }, `P${row.phrase}`));
      svg.appendChild(node("text", { x: 2, y: base, "font-size": 8, fill: "#8b90a0" }, mmss(first.t_s)));

      // Bande de couleur de la section, derrière les traits.
      let segStart = null;
      row.beats.forEach((b, j) => {
        const next = row.beats[j + 1];
        if (segStart == null) segStart = b;
        if (!next || next.section !== b.section || next.col !== b.col + 1) {
          svg.appendChild(node("rect", { x: xOf(segStart.col) - BX / 2 + 0.5, y: base - TICK.grand - 2, width: (b.col - segStart.col + 1) * BX - 1,
            height: TICK.grand + 4, rx: 3, fill: colorOf(b.section), "fill-opacity": b.tag ? 0.05 : 0.1 }));
          segStart = null;
        }
      });

      row.beats.forEach((b, j) => {
        const x = xOf(b.col);
        where.set(b.i, { x, base });
        const kind = b.tag ? "temps" : b.col === 0 ? "grand" : b.compte === 1 ? "un" : b.compte === 5 ? "cinq" : "temps";
        const h = TICK[kind];
        const color = b.tag ? "#b388ff" : colorOf(b.section);
        const line = node("line", { x1: x, y1: base, x2: x, y2: base - h, stroke: kind === "grand" ? "#ffffff" : color,
          "stroke-width": kind === "grand" ? 3 : kind === "un" ? 2.2 : 1.6, "stroke-linecap": "round",
          "stroke-opacity": (0.3 + 0.7 * b.niveau).toFixed(2) });
        line.appendChild(node("title", {}, `${mmss(b.t_s)} · ${b.tag ? "tag" : `P${b.phrase} · ${b.huit}/4 · ${b.compte}`} · section ${b.section}`));
        svg.appendChild(line);
        // Lettre de la section là où elle commence.
        const prev = j > 0 ? row.beats[j - 1] : (r > 0 ? rows[r - 1].beats[rows[r - 1].beats.length - 1] : null);
        if (!prev || prev.section !== b.section) {
          svg.appendChild(node("text", { x: x + 2, y: base + 9, "font-size": 9, "font-weight": 800, fill: colorOf(b.section) }, b.section));
        }
      });
      if (row.beats.some(b => b.tag)) {
        const tb = row.beats.find(b => b.tag);
        svg.appendChild(node("text", { x: xOf(tb.col) - 2, y: base + 9, "font-size": 8, "font-weight": 700, fill: "#b388ff" }, "tag"));
      }
    });

    // Moments clés, au temps près, au-dessus des traits.
    const used = [];
    for (const ev of song.evenements) {
      const m = BS.MOMENT_MARKS[ev.code];
      if (!m || !beats.length) continue;
      let i = beats.length - 1;
      while (i > 0 && beats[i].t_s > ev.t_s + 0.05) i--;
      const w = where.get(i);
      if (!w) continue;
      const P = beats[i + 1] ? beats[i + 1].t_s - beats[i].t_s : 0.5;
      const x = w.x + Math.max(0, Math.min(0.9, (ev.t_s - beats[i].t_s) / P)) * BX;
      let y = w.base - TICK.grand - 5;
      while (used.some(u => Math.abs(u.x - x) < 9 && Math.abs(u.y - y) < 9)) y -= 9;
      used.push({ x, y });
      const t = node("text", { x, y, "text-anchor": "middle", "font-size": 10, "font-weight": 700, fill: m.color }, m.sym);
      t.appendChild(node("title", {}, `${mmss(ev.t_s)} · ${ev.type}${ev.position ? " · " + ev.position : ""}`));
      svg.appendChild(t);
    }
    return svg;
  };

  // Légende des symboles réellement présents sur la carte.
  BS.mapLegend = function (song) {
    const codes = new Set(song.evenements.map(e => e.code));
    return Object.entries(BS.MOMENT_MARKS).filter(([c]) => codes.has(c));
  };

  // Convertit la carte (SVG) en image PNG téléchargeable.
  BS.mapToPng = function (svg, title, scale = 3) {
    return new Promise((resolve, reject) => {
      const vb = svg.viewBox.baseVal, pad = 16, head = title ? 28 : 0;
      const data = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const probe = c.getContext("2d");
        probe.font = "700 13px system-ui, sans-serif";
        const w = Math.max(vb.width, title ? probe.measureText(title).width : 0);
        c.width = (w + pad * 2) * scale;
        c.height = (vb.height + pad * 2 + head) * scale;
        const g = c.getContext("2d");
        g.scale(scale, scale);
        g.fillStyle = "#181a21";
        g.fillRect(0, 0, c.width, c.height);
        if (title) {
          g.fillStyle = "#eceef3";
          g.font = "700 13px system-ui, sans-serif";
          g.fillText(title, pad, pad + 12);
        }
        g.drawImage(img, pad, pad + head, vb.width, vb.height);
        c.toBlob(b => (b ? resolve(b) : reject(new Error("image vide"))), "image/png");
      };
      img.onerror = () => reject(new Error("rendu impossible"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(data);
    });
  };
})();
