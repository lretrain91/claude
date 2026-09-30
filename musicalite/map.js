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

  BS.renderMap = function (song) {
    const eights = song.huit_temps;
    const W = 14, GAP = 3, PH_GAP = 9, TOP = 34, BAR_H = 70, FONT = "system-ui, -apple-system, sans-serif";
    const ROW_H = TOP + BAR_H + 26, ROW_EIGHTS = 16; // une ligne ≈ 4 phrases, comme une partition

    // Position de chaque 8-temps : espace entre deux phrases, retour à la ligne toutes les ~4 phrases.
    const pos = [];
    let x = 4, row = 0, inRow = 0, width = 60;
    eights.forEach((e, i) => {
      const newPhrase = i > 0 && e.huit === 1 && e.phrase !== eights[i - 1].phrase;
      if (i > 0 && newPhrase && inRow >= ROW_EIGHTS) { row++; x = 4; inRow = 0; }
      else if (i > 0) x += GAP + (newPhrase ? PH_GAP : 0);
      pos.push({ x, base: row * ROW_H + TOP + BAR_H, row });
      x += W;
      inRow++;
      width = Math.max(width, x + 4);
    });
    const height = (row + 1) * ROW_H - 4;

    const svg = node("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", role: "img",
      "aria-label": `Carte du morceau, forme ${song.forme}`, "font-family": FONT });
    svg.style.display = "block";
    svg.style.maxWidth = `${Math.round(width * 2.2)}px`; // un morceau court n'est pas agrandi à l'excès
    svg.appendChild(node("rect", { x: 0, y: 0, width, height, fill: "#181a21" }));

    // Bâtons d'énergie.
    eights.forEach((e, i) => {
      const h = 8 + (BAR_H - 8) * e.niveau;
      const r = node("rect", { x: pos[i].x, y: pos[i].base - h, width: W, height: h, rx: 2.5, fill: colorOf(e.section) });
      r.appendChild(node("title", {}, `${mmss(e.debut_s)} · ${e.position} · section ${e.section} · énergie ${e.energie}`));
      svg.appendChild(r);
    });

    // Lettre de section au début de chaque section (et en début de ligne pour s'y retrouver).
    eights.forEach((e, i) => {
      const starts = i === 0 || e.section !== eights[i - 1].section;
      const rowStart = i > 0 && pos[i].row !== pos[i - 1].row;
      if (!starts && !rowStart) return;
      svg.appendChild(node("text", { x: pos[i].x + W / 2, y: pos[i].base + 16, "text-anchor": "middle", "font-size": 12,
        "font-weight": 800, fill: colorOf(e.section), opacity: starts ? 1 : 0.45 }, e.section));
    });

    // Moments clés, placés au temps près au-dessus des bâtons.
    const at = t => {
      let i = eights.length - 1;
      while (i > 0 && eights[i].debut_s > t) i--;
      const len = eights[i + 1] ? eights[i + 1].debut_s - eights[i].debut_s
        : i > 0 ? eights[i].debut_s - eights[i - 1].debut_s : 1;
      const f = Math.max(0, Math.min(1, (t - eights[i].debut_s) / Math.max(0.01, len)));
      return { x: pos[i].x + f * W, row: pos[i].row, base: pos[i].base };
    };
    const lanes = {};
    for (const ev of song.evenements) {
      const m = BS.MOMENT_MARKS[ev.code];
      if (!m || !eights.length) continue;
      const p = at(ev.t_s);
      // Deux marques trop proches : la seconde monte d'un cran.
      const L = (lanes[p.row] = lanes[p.row] || []);
      let lane = 0;
      while (L[lane] != null && p.x - L[lane] < 11) lane++;
      L[lane] = p.x;
      const t = node("text", { x: p.x, y: p.base - BAR_H - 8 - lane * 13, "text-anchor": "middle", "font-size": 12,
        "font-weight": 700, fill: m.color }, m.sym);
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
