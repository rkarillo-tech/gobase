/* GoBase · núcleo: reglas del go (capturas, ko, suicidio, superko), coordenadas, hándicap, recuento,
   vida incondicional (Benson) y dos lectores exactos para problemas: capturas (escaleras, redes, contragolpe)
   y vida y muerte en una zona cerrada. No usa el DOM: también corre en un Worker y en Node (pruebas). */
"use strict";

const Go = (() => {
  const EMPTY = 0, BLACK = 1, WHITE = 2, EDGE = 3, PASS = -1;
  const LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
  const other = c => 3 - c;

  // ---------------------------------------------------------------- Zobrist (dos enteros de 32 bits)
  const ZOB = {};
  function zob(n) {
    if (ZOB[n]) return ZOB[n];
    const len = (n + 2) * (n + 2);
    const t = new Int32Array(len * 4);
    let x = 0x9E3779B9 ^ (n * 7919);
    for (let i = 0; i < t.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; t[i] = x; }
    return (ZOB[n] = t);
  }
  const keyOf = (h1, h2) => (h1 >>> 0) * 2097152 + (h2 & 0x1fffff);

  // ---------------------------------------------------------------- posición
  function create(n = 19) {
    if (!(n >= 2 && n <= 25)) throw new Error("Tamaño de tablero no válido: " + n);
    const W = n + 2, b = new Uint8Array(W * W).fill(EDGE);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[(y + 1) * W + x + 1] = EMPTY;
    return { n, W, b, turn: BLACK, ko: -1, cap: [0, 0, 0], h1: 0, h2: 0, passes: 0 };
  }
  function clone(s) {
    return { n: s.n, W: s.W, b: s.b.slice(), turn: s.turn, ko: s.ko, cap: s.cap.slice(), h1: s.h1, h2: s.h2, passes: s.passes };
  }
  const pt = (s, x, y) => (y + 1) * s.W + x + 1;
  const xy = (s, p) => [p % s.W - 1, Math.floor(p / s.W) - 1];
  const onBoard = (s, x, y) => x >= 0 && y >= 0 && x < s.n && y < s.n;
  const nbrs = (s, p) => [p - 1, p + 1, p - s.W, p + s.W];
  function points(s) {
    const out = [];
    for (let y = 0; y < s.n; y++) for (let x = 0; x < s.n; x++) out.push(pt(s, x, y));
    return out;
  }
  function toggle(s, p, c) {
    const z = zob(s.n), k = (p * 2 + (c - 1)) * 2;
    s.h1 ^= z[k]; s.h2 ^= z[k + 1];
  }
  // La clave incluye quién juega para distinguir posiciones iguales con distinto turno (superko situacional no: posicional)
  const key = s => keyOf(s.h1, s.h2);

  // ---------------------------------------------------------------- grupos
  function group(s, p) {
    const c = s.b[p];
    if (c !== BLACK && c !== WHITE) return null;
    const stones = [p], libs = new Set(), seen = new Set([p]);
    for (let k = 0; k < stones.length; k++) {
      const q = stones[k];
      for (const r of nbrs(s, q)) {
        const v = s.b[r];
        if (v === EMPTY) libs.add(r);
        else if (v === c && !seen.has(r)) { seen.add(r); stones.push(r); }
      }
    }
    return { color: c, stones, libs };
  }
  function libCount(s, p, max = 99) {
    const c = s.b[p], stones = [p], seen = new Set([p]), libs = new Set();
    for (let k = 0; k < stones.length; k++) {
      for (const r of nbrs(s, stones[k])) {
        const v = s.b[r];
        if (v === EMPTY) { libs.add(r); if (libs.size >= max) return libs.size; }
        else if (v === c && !seen.has(r)) { seen.add(r); stones.push(r); }
      }
    }
    return libs.size;
  }
  function chains(s, color) {
    const seen = new Set(), out = [];
    for (const p of points(s)) {
      if (s.b[p] !== color || seen.has(p)) continue;
      const g = group(s, p);
      g.stones.forEach(q => seen.add(q));
      out.push(g);
    }
    return out;
  }

  // ---------------------------------------------------------------- jugar
  /* Devuelve { state, captured } o { error: "occupied" | "ko" | "suicide" | "superko" }.
     opts.history: Set de claves de posiciones anteriores para el superko posicional. */
  function play(s, p, color = s.turn, opts = {}) {
    if (p === PASS) {
      const t = clone(s);
      t.turn = other(color); t.ko = -1; t.passes = s.passes + 1;
      return { state: t, captured: [] };
    }
    if (s.b[p] !== EMPTY) return { error: "occupied" };
    if (p === s.ko && color === s.turn) return { error: "ko" };
    const t = clone(s), opp = other(color);
    t.b[p] = color; toggle(t, p, color);
    const captured = [];
    for (const q of nbrs(t, p)) {
      if (t.b[q] !== opp) continue;
      const g = group(t, q);
      if (g.libs.size === 0) for (const r of g.stones) { t.b[r] = EMPTY; toggle(t, r, opp); captured.push(r); }
    }
    const mine = group(t, p);
    if (mine.libs.size === 0) {
      if (!opts.allowSuicide) return { error: "suicide" };
      for (const r of mine.stones) { t.b[r] = EMPTY; toggle(t, r, color); }
      t.cap[opp] += mine.stones.length;
    }
    t.cap[color] += captured.length;
    t.ko = (captured.length === 1 && mine.stones.length === 1 && mine.libs.size === 1) ? captured[0] : -1;
    t.turn = opp; t.passes = 0;
    if (opts.history && opts.history.has(key(t))) return { error: "superko" };
    return { state: t, captured };
  }
  const isLegal = (s, p, color = s.turn, opts) => !play(s, p, color, opts).error;
  function legalMoves(s, color = s.turn) {
    return points(s).filter(p => s.b[p] === EMPTY && isLegal(s, p, color));
  }
  // Colocación libre (propiedades AB, AW, AE del SGF): no captura nada
  function setup(s, list) {
    const t = clone(s);
    for (const [p, c] of list) {
      if (t.b[p] === EDGE) continue;
      if (t.b[p] === BLACK || t.b[p] === WHITE) toggle(t, p, t.b[p]);
      t.b[p] = c;
      if (c === BLACK || c === WHITE) toggle(t, p, c);
    }
    t.ko = -1;
    return t;
  }
  function stoneCount(s) {
    let b = 0, w = 0;
    for (const p of points(s)) { if (s.b[p] === BLACK) b++; else if (s.b[p] === WHITE) w++; }
    return { b, w };
  }

  // ---------------------------------------------------------------- coordenadas
  function gtp(n, x, y) { return LETTERS[x] + (n - y); }
  function fromGtp(n, str) {
    const m = /^\s*([A-HJ-Z])(\d{1,2})\s*$/i.exec(str || "");
    if (!m) return null;
    const x = LETTERS.indexOf(m[1].toUpperCase()), y = n - parseInt(m[2], 10);
    return x >= 0 && x < n && y >= 0 && y < n ? [x, y] : null;
  }
  const sgfCoord = (x, y) => String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
  function fromSgf(str) {
    if (!str || str.length < 2) return null;
    const f = c => { const k = c.charCodeAt(0); return k >= 97 && k <= 122 ? k - 97 : k >= 65 && k <= 90 ? k - 65 + 26 : -1; };
    const x = f(str[0]), y = f(str[1]);
    return x < 0 || y < 0 ? null : [x, y];
  }
  function hoshi(n) {
    const e = n >= 13 ? 3 : 2, out = [];
    if (n < 7) return n % 2 ? [[(n - 1) / 2, (n - 1) / 2]] : out;
    const lines = [e, n - 1 - e];
    if (n % 2 && n >= 9) lines.splice(1, 0, (n - 1) / 2);
    for (const a of lines) for (const b of lines) {
      if (n < 15 && n % 2 && (a === (n - 1) / 2) !== (b === (n - 1) / 2)) continue;
      out.push([a, b]);
    }
    return out;
  }
  // Colocación clásica de las piedras de hándicap (como en las reglas japonesas y en GNU Go)
  function handicapPoints(n, k) {
    if (k < 2 || n < 7) return [];
    const e = n >= 13 ? 3 : 2, lo = e, hi = n - 1 - e, mid = (n - 1) / 2, odd = n % 2 === 1;
    const corners = [[hi, lo], [lo, hi], [hi, hi], [lo, lo]];
    const max = odd && n >= 9 ? 9 : 4;
    k = Math.min(k, max);
    const out = corners.slice(0, Math.min(k, 4));
    if (k >= 5 && odd) {
      if (k === 5 || k === 7 || k === 9) out.push([mid, mid]);
      if (k >= 6) out.push([lo, mid], [hi, mid]);
      if (k >= 8) out.push([mid, lo], [mid, hi]);
    }
    return out;
  }

  // ---------------------------------------------------------------- recuento
  /* dead: Set de puntos con piedras muertas. rules: "japanese" (territorio + prisioneros) o "chinese" (área).
     Devuelve owner (1 negro, 2 blanco, 0 neutral) para cada punto, los totales y el resultado («B+3.5»). */
  function score(s, { dead = new Set(), rules = "japanese", komi = 6.5 } = {}) {
    const n = s.n, owner = new Int8Array(s.b.length), seen = new Uint8Array(s.b.length);
    const deadCount = [0, 0, 0];
    const eff = p => (dead.has(p) && (s.b[p] === BLACK || s.b[p] === WHITE)) ? EMPTY : s.b[p];
    for (const p of points(s)) if (dead.has(p) && s.b[p] !== EMPTY) deadCount[s.b[p]]++;
    const terr = [0, 0, 0];
    for (const p of points(s)) {
      if (eff(p) !== EMPTY || seen[p]) continue;
      const region = [p], border = new Set();
      seen[p] = 1;
      for (let k = 0; k < region.length; k++) {
        for (const q of nbrs(s, region[k])) {
          const v = eff(q);
          if (v === EMPTY && !seen[q]) { seen[q] = 1; region.push(q); }
          else if (v === BLACK || v === WHITE) border.add(v);
        }
      }
      const o = border.size === 1 ? [...border][0] : 0;
      for (const q of region) owner[q] = o;
      if (o) terr[o] += region.length;
    }
    let stones = [0, 0, 0];
    for (const p of points(s)) { const v = eff(p); if (v === BLACK || v === WHITE) { owner[p] = v; stones[v]++; } }
    let bTotal, wTotal;
    const pris = [0, s.cap[BLACK] + deadCount[WHITE], s.cap[WHITE] + deadCount[BLACK]];
    if (rules === "chinese") { bTotal = stones[1] + terr[1]; wTotal = stones[2] + terr[2] + komi; }
    else { bTotal = terr[1] + pris[1]; wTotal = terr[2] + pris[2] + komi; }
    const diff = bTotal - wTotal;
    return {
      owner, terr, stones, prisoners: pris, dead: deadCount, black: bTotal, white: wTotal, diff,
      result: diff === 0 ? "0" : (diff > 0 ? "B+" : "W+") + fmtNum(Math.abs(diff)), n
    };
  }
  const fmtNum = x => (Math.round(x * 10) / 10).toString();

  // ---------------------------------------------------------------- Benson: grupos vivos incondicionalmente
  function benson(s, color) {
    const ch = chains(s, color);
    const chainOf = new Map();
    ch.forEach((g, i) => g.stones.forEach(p => chainOf.set(p, i)));
    // regiones: componentes conexas de puntos que no son de «color»
    const regions = [], regOf = new Map();
    for (const p of points(s)) {
      if (s.b[p] === color || regOf.has(p)) continue;
      const pts = [p], idx = regions.length;
      regOf.set(p, idx);
      for (let k = 0; k < pts.length; k++) for (const q of nbrs(s, pts[k])) {
        if (s.b[q] !== EDGE && s.b[q] !== color && !regOf.has(q)) { regOf.set(q, idx); pts.push(q); }
      }
      const border = new Set();
      for (const q of pts) for (const r of nbrs(s, q)) if (chainOf.has(r)) border.add(chainOf.get(r));
      regions.push({ pts, empties: pts.filter(q => s.b[q] === EMPTY), border });
    }
    const aliveC = new Set(ch.map((_, i) => i)), aliveR = new Set(regions.map((_, i) => i));
    // vital[r] = cadenas para las que cada punto vacío de la región es libertad suya
    const vitalFor = regions.map(r => {
      const out = new Set();
      for (const ci of r.border) {
        const libs = new Set();
        for (const p of ch[ci].stones) for (const q of nbrs(s, p)) if (s.b[q] === EMPTY) libs.add(q);
        if (r.empties.every(q => libs.has(q))) out.add(ci);
      }
      return out;
    });
    let changed = true;
    while (changed) {
      changed = false;
      for (const ci of [...aliveC]) {
        let v = 0;
        for (const ri of aliveR) if (vitalFor[ri].has(ci)) v++;
        if (v < 2) { aliveC.delete(ci); changed = true; }
      }
      for (const ri of [...aliveR]) {
        for (const ci of regions[ri].border) if (!aliveC.has(ci)) { aliveR.delete(ri); changed = true; break; }
      }
    }
    const out = new Set();
    for (const ci of aliveC) ch[ci].stones.forEach(p => out.add(p));
    return out;
  }

  // ---------------------------------------------------------------- lector de capturas
  /* ¿Puede «attacker» capturar el grupo de «target»? Busca escaleras, redes (geta), contragolpes y atari doble.
     Se considera que el grupo escapa si llega a 4 libertades (3 fuera de la raíz).
     Devuelve { captured, move } para el bando que juega (s.turn). */
  function readCapture(s, target, { maxDepth = 60, maxNodes = 200000 } = {}) {
    const defColor = s.b[target];
    if (defColor !== BLACK && defColor !== WHITE) return { captured: true, move: null };
    const tt = new Map();
    let nodes = 0;
    const atkColor = other(defColor);
    function libsOf(st) { return st.b[target] === defColor ? group(st, target).libs : null; }
    function attack(st, depth, root) {
      if (st.b[target] !== defColor) return PASS;
      const libs = libsOf(st);
      if (libs.size > (root ? 3 : 2) || depth <= 0 || ++nodes > maxNodes) return null;
      const k = key(st) + "a" + st.ko;
      if (tt.has(k)) return tt.get(k);
      const cands = new Set(libs);
      if (libs.size <= 2 && depth > maxDepth - 8) {
        // red: puntos a dos pasos del grupo
        for (const l of libs) for (const q of nbrs(st, l)) if (st.b[q] === EMPTY) cands.add(q);
      }
      // salvar piedras propias en atari que tocan al grupo
      for (const g of adjacentChains(st, target)) if (g.libs.size === 1) {
        const l = [...g.libs][0]; cands.add(l);
      }
      let res = null;
      for (const m of orderByLibs(st, [...cands], atkColor)) {
        const r = play(st, m, atkColor);
        if (r.error) continue;
        const t = r.state;
        if (t.b[target] !== defColor || defend(t, depth - 1) === null) { res = m; break; }
      }
      tt.set(k, res);
      return res;
    }
    function defend(st, depth) {
      // devuelve la jugada que salva (o PASS si ya está a salvo); null si el grupo cae
      if (st.b[target] !== defColor) return null;
      const libs = libsOf(st);
      if (libs.size >= 3) return PASS;
      if (depth <= 0 || nodes > maxNodes) return PASS;
      const k = key(st) + "d" + st.ko;
      if (tt.has(k)) return tt.get(k);
      const cands = new Set(libs);
      for (const g of adjacentChains(st, target)) if (g.libs.size <= 2) for (const l of g.libs) cands.add(l);
      let res = null;
      for (const m of orderByLibs(st, [...cands], defColor)) {
        const r = play(st, m, defColor);
        if (r.error) continue;
        if (attack(r.state, depth - 1, false) === null) { res = m; break; }
      }
      tt.set(k, res);
      return res;
    }
    function orderByLibs(st, cands, color) {
      return cands.map(m => {
        const r = play(st, m, color);
        if (r.error) return [m, -99];
        const g = r.state.b[target] === defColor ? group(r.state, target) : null;
        const own = group(r.state, m);
        const score = color === atkColor ? (g ? -g.libs.size * 4 : 50) + own.libs.size + r.captured.length * 3
          : (g ? g.libs.size * 4 : -50) + r.captured.length * 5;
        return [m, score];
      }).filter(x => x[1] > -99).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    }
    if (s.turn === atkColor) {
      const m = attack(s, maxDepth, true);
      return { captured: m !== null, move: m, nodes };
    }
    const m = defend(s, maxDepth);
    return { captured: m === null, move: m, nodes };
  }
  function adjacentChains(s, p) {
    const g = group(s, p), seen = new Set(), out = [];
    for (const q of g.stones) for (const r of nbrs(s, q)) {
      if (s.b[r] === other(g.color) && !seen.has(r)) {
        const h = group(s, r); h.stones.forEach(x => seen.add(x)); out.push(h);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- vida y muerte en zona cerrada
  /* Búsqueda exhaustiva: «attacker» quiere capturar la piedra «target»; el otro bando quiere que siga en el tablero.
     Sólo se juega en los puntos de «region» (o se pasa). El defensor gana si el grupo vive incondicionalmente
     (Benson), si los dos pasan seguidos o si se acaba la profundidad. Devuelve { win, moves } para quien juega
     en s (s.turn), con todas las primeras jugadas que ganan. */
  function solveLD(s, { target, region, maxDepth, maxNodes = 3000000 } = {}) {
    const defColor = s.b[target], atkColor = other(defColor);
    const reg = [...region].filter(p => s.b[p] !== EDGE);
    const depthMax = maxDepth || Math.min(90, reg.length * 6 + 12);
    const tt = new Map();
    let nodes = 0, aborted = false;
    // gana el atacante (desde su punto de vista) si captura; true/false
    function atkWins(st, passes, depth) {
      if (st.b[target] !== defColor) return true;
      if (passes >= 2 || depth <= 0) return false;
      if (++nodes > maxNodes) { aborted = true; return false; }
      const k = key(st) + ":" + st.turn + passes + ":" + st.ko;
      const e = tt.get(k);
      if (e) { if (e.w && e.d <= depth) return true; if (!e.w && e.d >= depth) return false; }
      if (bensonAlive(st)) { tt.set(k, { w: false, d: 99 }); return false; }
      const moves = orderMoves(st);
      let res;
      if (st.turn === atkColor) {
        res = false;
        for (const m of moves) {
          const r = play(st, m, atkColor);
          if (r.error) continue;
          if (atkWins(r.state, 0, depth - 1)) { res = true; break; }
        }
        if (!res) res = atkWins(play(st, PASS).state, passes + 1, depth - 1);
      } else {
        res = true;
        for (const m of moves) {
          const r = play(st, m, defColor);
          if (r.error) continue;
          if (!atkWins(r.state, 0, depth - 1)) { res = false; break; }
        }
        if (res) res = atkWins(play(st, PASS).state, passes + 1, depth - 1);
      }
      tt.set(k, { w: res, d: depth });
      return res;
    }
    function bensonAlive(st) { return benson(st, defColor).has(target); }
    function orderMoves(st) {
      const g = group(st, target);
      return reg.filter(p => st.b[p] === EMPTY).map(p => {
        let sc = 0;
        if (g.libs.has(p)) sc += 2;
        for (const q of nbrs(st, p)) if (st.b[q] === EMPTY && region.has(q)) sc += 1;
        return [p, sc];
      }).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    }
    const mover = s.turn;
    const winMoves = [];
    const candidates = [...orderMoves(s), PASS];
    for (const m of candidates) {
      const r = play(s, m, mover);
      if (r.error) continue;
      const aw = atkWins(r.state, m === PASS ? s.passes + 1 : 0, depthMax - 1);
      if ((mover === atkColor) === aw) winMoves.push(m);
    }
    return { win: winMoves.length > 0, moves: winMoves, nodes, aborted };
  }

  // ---------------------------------------------------------------- utilidades para la interfaz
  function moveName(s, p) {
    if (p === PASS) return "pasa";
    const [x, y] = xy(s, p);
    return gtp(s.n, x, y);
  }
  function boardToAscii(s) {
    const rows = [];
    for (let y = 0; y < s.n; y++) {
      let r = "";
      for (let x = 0; x < s.n; x++) r += ".XO"[s.b[pt(s, x, y)]];
      rows.push(r);
    }
    return rows.join("\n");
  }
  // Diagrama ASCII → posición: X negras, O blancas, . o + vacío (filas de arriba abajo)
  function fromAscii(text, n) {
    const rows = text.trim().split(/\n/).map(r => r.replace(/\s+/g, ""));
    n = n || rows.length;
    let s = create(n);
    const list = [];
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (x < n && y < n) list.push([pt(s, x, y), ch === "X" ? BLACK : ch === "O" ? WHITE : EMPTY]);
    }));
    return setup(s, list);
  }

  return {
    EMPTY, BLACK, WHITE, EDGE, PASS, LETTERS, other,
    create, clone, pt, xy, onBoard, nbrs, points, key, keyOf,
    group, libCount, chains, adjacentChains, play, isLegal, legalMoves, setup, stoneCount,
    gtp, fromGtp, sgfCoord, fromSgf, hoshi, handicapPoints,
    score, fmtNum, benson, readCapture, solveLD, moveName, boardToAscii, fromAscii
  };
})();
