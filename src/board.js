/* GoBase · dibujo del tablero en SVG (tablero principal, miniaturas, figuras para imprimir e imagen PNG) */

const CELL = 40;
const BOARD_COLORS = {
  wood: ["#dcb35c", "#2b1d0e"], kaya: ["#e9c98b", "#3a2a14"], walnut: ["#b98543", "#1d1206"],
  green: ["#a9c48f", "#1f2d18"], slate: ["#9aa7b4", "#101820"], paper: ["#f4f1e8", "#222222"]
};

function boardGeom(n, coords, view) {
  const M = coords ? 38 : 24;
  const full = 2 * M + (n - 1) * CELL;
  let vb = [0, 0, full, full];
  if (view) {
    const x0 = Math.max(0, view.x0), y0 = Math.max(0, view.y0), x1 = Math.min(n - 1, view.x1), y1 = Math.min(n - 1, view.y1);
    const left = x0 === 0 ? 0 : M + x0 * CELL - CELL * 0.6, top = y0 === 0 ? 0 : M + y0 * CELL - CELL * 0.6;
    const right = x1 === n - 1 ? full : M + x1 * CELL + CELL * 0.6, bottom = y1 === n - 1 ? full : M + y1 * CELL + CELL * 0.6;
    const w = right - left, h = bottom - top, s = Math.min(full, Math.max(w, h));
    // cuadrado: se amplía el lado corto hacia dentro del tablero, sin salirse de él
    const fit = (a, len) => Math.max(0, Math.min(a - (s - len) / 2, full - s));
    vb = [fit(left, w), fit(top, h), s, s];
  }
  return { M, full, vb, X: x => M + x * CELL, Y: y => M + y * CELL };
}

function stoneDefs(idp, style) {
  if (style === "flat") return "";
  return `<defs>
<radialGradient id="${idp}b" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#6b6b6b"/><stop offset=".45" stop-color="#1b1b1b"/><stop offset="1" stop-color="#000"/></radialGradient>
<radialGradient id="${idp}w" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#e6e6e3"/><stop offset="1" stop-color="#b9b9b4"/></radialGradient>
<filter id="${idp}sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="1.6" dy="2.2" stdDeviation="1.4" flood-color="#000" flood-opacity=".45"/></filter>
</defs>`;
}

function stoneSvg(cx, cy, c, style, idp, opacity = 1, r = CELL * 0.48) {
  const op = opacity < 1 ? ` opacity="${opacity}"` : "";
  if (style === "flat" || !idp) {
    return c === 1 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#111" stroke="#000" stroke-width="1"${op}/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r - .6}" fill="#fafafa" stroke="#222" stroke-width="1.3"${op}/>`;
  }
  if (style === "contrast") {
    return c === 1 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#000" stroke="#000"${op}/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="#fff" stroke="#000" stroke-width="2.4"${op}/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${idp}${c === 1 ? "b" : "w"})" filter="url(#${idp}sh)"${op}${c === 2 ? ' stroke="#9a9a94" stroke-width=".6"' : ""}/>`;
}

/* o: { n, b (colores por punto, como Go: (y+1)*(n+2)+x+1), W, theme, style, coords, last, marks, numbers (Map p→texto),
        ownership, candidates, dead (Set), owner (recuento), hint, varHints, ghost, view, idp, ko, target, problemRegion } */
function BoardSvg(o) {
  const n = o.n, W = n + 2, g = boardGeom(n, o.coords, o.view), idp = o.idp || "gb";
  const [wood, line] = BOARD_COLORS[o.theme] || BOARD_COLORS.wood;
  const style = o.style || "real";
  const P = (x, y) => (y + 1) * W + x + 1;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${g.vb.join(" ")}"` + (o.px ? ` width="${o.px}" height="${o.px}"` : "") + ">";
  s += stoneDefs(idp, style);
  s += `<rect x="0" y="0" width="${g.full}" height="${g.full}" fill="${wood}"/>`;
  // zona del problema
  if (o.problemRegion) for (const p of o.problemRegion) {
    const x = p % W - 1, y = Math.floor(p / W) - 1;
    s += `<rect x="${g.X(x) - CELL / 2}" y="${g.Y(y) - CELL / 2}" width="${CELL}" height="${CELL}" fill="rgba(41,182,246,.13)"/>`;
  }
  // cuadrícula
  const a = g.X(0), b = g.X(n - 1);
  let path = "";
  for (let i = 0; i < n; i++) { const v = g.X(i); path += `M${a} ${v}H${b}M${v} ${a}V${b}`; }
  s += `<path d="${path}" stroke="${line}" stroke-width="1.1" fill="none"/>`;
  s += `<rect x="${a}" y="${a}" width="${b - a}" height="${b - a}" stroke="${line}" stroke-width="2" fill="none"/>`;
  for (const [x, y] of Go.hoshi(n)) s += `<circle cx="${g.X(x)}" cy="${g.Y(y)}" r="3.6" fill="${line}"/>`;
  if (o.coords) {
    for (let i = 0; i < n; i++) {
      const L = Go.LETTERS[i], num = n - i;
      s += `<text class="lbl" x="${g.X(i)}" y="${g.M - 20}" text-anchor="middle" fill="${line}" font-size="13" font-weight="700" opacity=".75">${L}</text>`;
      s += `<text class="lbl" x="${g.X(i)}" y="${g.full - g.M + 30}" text-anchor="middle" fill="${line}" font-size="13" font-weight="700" opacity=".75">${L}</text>`;
      s += `<text class="lbl" x="${g.M - 22}" y="${g.Y(i) + 5}" text-anchor="middle" fill="${line}" font-size="13" font-weight="700" opacity=".75">${num}</text>`;
      s += `<text class="lbl" x="${g.full - g.M + 22}" y="${g.Y(i) + 5}" text-anchor="middle" fill="${line}" font-size="13" font-weight="700" opacity=".75">${num}</text>`;
    }
  }
  // territorio del recuento (debajo de las piedras)
  const sq = (x, y, c, size, op) => `<rect x="${g.X(x) - size / 2}" y="${g.Y(y) - size / 2}" width="${size}" height="${size}" fill="${c === 1 ? "#000" : "#fff"}" opacity="${op}" ${c === 2 ? 'stroke="#000" stroke-width=".8"' : ""}/>`;
  // piedras
  const onStone = new Map();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const p = P(x, y), c = o.b[p];
    if (c !== 1 && c !== 2) continue;
    const isDead = o.dead && o.dead.has(p);
    s += stoneSvg(g.X(x), g.Y(y), c, style, idp, isDead ? 0.42 : 1);
    onStone.set(p, c);
  }
  if (o.owner) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const p = P(x, y), ow = o.owner[p];
    if (!ow) continue;
    const c = o.b[p];
    if ((c === 1 || c === 2) && !(o.dead && o.dead.has(p))) continue;
    s += sq(x, y, ow, 15, .85);
  }
  if (o.ownership) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const p = P(x, y), v = o.ownership[p];
    if (Math.abs(v) < 0.2) continue;
    const c = v > 0 ? 1 : 2, st = o.b[p];
    if (st === c) continue; // piedra viva de su propio color
    s += sq(x, y, c, st ? 16 : 12 + 14 * Math.abs(v), Math.min(.85, Math.abs(v)));
  }
  // marcas de variantes (hijos del nodo)
  if (o.varHints) for (const [x, y, k] of o.varHints) {
    if (onStone.has(P(x, y))) continue;
    s += `<circle class="mk" cx="${g.X(x)}" cy="${g.Y(y)}" r="7" fill="none" stroke="${k ? "#4fc3f7" : "#29b6f6"}" stroke-width="2.4" stroke-dasharray="${k ? "3 3" : ""}"/>`;
  }
  // candidatas del motor
  if (o.candidates && o.candidates.length) {
    o.candidates.forEach((c, i) => {
      if (c.p < 0) return;
      const x = c.p % W - 1, y = Math.floor(c.p / W) - 1;
      const col = i === 0 ? "#29b6f6" : c.rel > 0.85 ? "#66bb6a" : c.rel > 0.5 ? "#c0ca33" : "#ffa726";
      s += `<circle class="mk" cx="${g.X(x)}" cy="${g.Y(y)}" r="${CELL * 0.45}" fill="${col}" opacity=".88" stroke="${i === 0 ? "#01579b" : "rgba(0,0,0,.35)"}" stroke-width="${i === 0 ? 2.5 : 1}"/>`;
      s += `<text class="mk" x="${g.X(x)}" y="${g.Y(y) + 1}" text-anchor="middle" font-size="12.5" font-weight="800" fill="#0b0e14">${c.label}</text>`;
      if (c.sub) s += `<text class="mk" x="${g.X(x)}" y="${g.Y(y) + 12}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#0b0e14">${c.sub}</text>`;
    });
  }
  if (o.hint != null && o.hint >= 0) {
    const x = o.hint % W - 1, y = Math.floor(o.hint / W) - 1;
    s += `<circle class="mk" cx="${g.X(x)}" cy="${g.Y(y)}" r="${CELL * 0.42}" fill="none" stroke="#29b6f6" stroke-width="4"/>`;
  }
  // números en las piedras
  const txtCol = p => onStone.get(p) === 1 ? "#fff" : "#111";
  if (o.numbers) for (const [p, t] of o.numbers) {
    if (!onStone.has(p)) continue;
    const x = p % W - 1, y = Math.floor(p / W) - 1, len = String(t).length;
    s += `<text class="num" x="${g.X(x)}" y="${g.Y(y) + 5.5}" text-anchor="middle" font-size="${len >= 3 ? 13 : 16}" font-weight="700" fill="${txtCol(p)}">${t}</text>`;
  }
  // marcas SGF
  if (o.marks) {
    const m = o.marks, size = CELL * 0.27;
    const col = (x, y) => onStone.get(P(x, y)) === 1 ? "#fff" : onStone.has(P(x, y)) ? "#111" : line;
    for (const [x, y] of m.TR || []) { const cx = g.X(x), cy = g.Y(y); s += `<path class="mk" d="M${cx} ${cy - size * 1.15}L${cx + size} ${cy + size * .7}H${cx - size}Z" fill="none" stroke="${col(x, y)}" stroke-width="2.4"/>`; }
    for (const [x, y] of m.SQ || []) s += `<rect class="mk" x="${g.X(x) - size * .85}" y="${g.Y(y) - size * .85}" width="${size * 1.7}" height="${size * 1.7}" fill="none" stroke="${col(x, y)}" stroke-width="2.4"/>`;
    for (const [x, y] of m.CR || []) s += `<circle class="mk" cx="${g.X(x)}" cy="${g.Y(y)}" r="${size}" fill="none" stroke="${col(x, y)}" stroke-width="2.4"/>`;
    for (const [x, y] of m.MA || []) { const cx = g.X(x), cy = g.Y(y), d = size * .85; s += `<path class="mk" d="M${cx - d} ${cy - d}L${cx + d} ${cy + d}M${cx + d} ${cy - d}L${cx - d} ${cy + d}" stroke="${col(x, y)}" stroke-width="2.6"/>`; }
    for (const [x, y, t] of m.LB || []) {
      const p = P(x, y);
      if (!onStone.has(p)) s += `<circle class="mk" cx="${g.X(x)}" cy="${g.Y(y)}" r="${CELL * 0.36}" fill="${wood}"/>`;
      s += `<text class="mk" x="${g.X(x)}" y="${g.Y(y) + 6}" text-anchor="middle" font-size="${String(t).length > 2 ? 12 : 17}" font-weight="800" fill="${col(x, y)}">${escSvg(t)}</text>`;
    }
  }
  // última jugada
  if (o.last != null && o.last >= 0 && onStone.has(o.last) && !(o.numbers && o.numbers.has(o.last))) {
    const x = o.last % W - 1, y = Math.floor(o.last / W) - 1;
    s += `<circle class="mk" cx="${g.X(x)}" cy="${g.Y(y)}" r="${CELL * 0.2}" fill="none" stroke="${onStone.get(o.last) === 1 ? "#fff" : "#111"}" stroke-width="2.6"/>`;
  }
  if (o.ko != null && o.ko >= 0) {
    const x = o.ko % W - 1, y = Math.floor(o.ko / W) - 1;
    s += `<rect class="mk" x="${g.X(x) - 9}" y="${g.Y(y) - 9}" width="18" height="18" fill="none" stroke="${line}" stroke-width="2"/>`;
  }
  s += `<g id="${idp}ghost"></g></svg>`;
  return s;
}
function escSvg(t) { return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Miniatura (marcadores, problemas): sólo piedras, sin coordenadas
function miniBoard(n, b, opts = {}) {
  return BoardSvg(Object.assign({ n, b, coords: false, style: "flat", theme: opts.theme || "wood", idp: "" }, opts))
    .replace("<svg ", '<svg class="mini" ');
}

// Punto del tablero bajo el puntero (o null)
function pointFromEvent(svg, ev, n, coords) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  const m = svg.getScreenCTM();
  if (!m) return null;
  const q = pt.matrixTransform(m.inverse());
  const g = boardGeom(n, coords, null);
  const x = Math.round((q.x - g.M) / CELL), y = Math.round((q.y - g.M) / CELL);
  if (x < 0 || y < 0 || x >= n || y >= n) return null;
  return [x, y];
}
