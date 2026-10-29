/* GoBase · árbol de variantes y lector/escritor SGF (FF[4]): colecciones de partidas, variantes anidadas,
   colocación (AB/AW/AE), marcas (TR SQ CR MA LB), comentarios, símbolos (TE BM DO IT · GB GW DM UC)
   y propiedades desconocidas, que se conservan tal cual. También lee listas de jugadas sueltas (D4 Q16 o pd dp). */
"use strict";

const Sgf = (() => {
  let nextId = 1;
  const HEADER_ORDER = ["GM", "FF", "CA", "AP", "SZ", "KM", "HA", "RU", "PB", "BR", "PW", "WR", "RE", "DT", "EV", "RO", "PC", "GN", "TM", "OT", "SO", "US", "AN", "GC"];
  const HEADER_SET = new Set(HEADER_ORDER.concat(["BT", "WT", "ON", "ST"]));
  const MARKS = ["TR", "SQ", "CR", "MA"];
  const NAG_OUT = { "!": ["TE", "1"], "!!": ["TE", "2"], "?": ["BM", "1"], "??": ["BM", "2"], "?!": ["DO", ""], "!?": ["IT", ""] };
  const POS_CODES = ["GB", "GW", "DM", "UC"];

  function node(parent = null) {
    return { id: nextId++, parent, children: [], move: null, setup: null, pl: 0, comment: "", nag: "", pos: "", name: "",
      marks: null, extra: null, eval: null };
  }
  function newGame(size = 19, opts = {}) {
    const root = node();
    const g = { headers: { GM: "1", FF: "4", CA: "UTF-8", AP: "GoBase", SZ: String(size), KM: String(opts.komi ?? 6.5),
      RU: opts.rules === "chinese" ? "Chinese" : "Japanese", PB: opts.PB || "", PW: opts.PW || "", RE: "", DT: opts.DT || "" }, root, size };
    const h = opts.handicap | 0;
    if (h >= 2) {
      g.headers.HA = String(h);
      root.setup = { AB: Go.handicapPoints(size, h), AW: [], AE: [] };
      root.pl = Go.WHITE;
    }
    return g;
  }

  // ---------------------------------------------------------------- navegación y edición del árbol
  function path(n) { const out = []; for (let x = n; x; x = x.parent) out.push(x); return out.reverse(); }
  function mainline(root) { const out = [root]; let n = root; while (n.children.length) { n = n.children[0]; out.push(n); } return out; }
  function moveNumber(n) { let k = 0; for (let x = n; x; x = x.parent) if (x.move) k++; return k; }
  function sameMove(a, b) { return a && b && a.c === b.c && a.x === b.x && a.y === b.y; }
  function addChild(parent, move) {
    for (const c of parent.children) if (sameMove(c.move, move) && !c.setup) return { node: c, created: false };
    const c = node(parent);
    c.move = move;
    parent.children.push(c);
    return { node: c, created: true };
  }
  function cut(n) {
    if (!n.parent) return null;
    const p = n.parent;
    p.children = p.children.filter(c => c !== n);
    return p;
  }
  function promote(n) {
    const p = n.parent; if (!p) return;
    const i = p.children.indexOf(n);
    if (i > 0) { p.children.splice(i, 1); p.children.splice(i - 1, 0, n); }
  }
  function makeMain(n) {
    for (let x = n; x.parent; x = x.parent) {
      const p = x.parent, i = p.children.indexOf(x);
      if (i > 0) { p.children.splice(i, 1); p.children.unshift(x); }
    }
  }
  function isMainline(n) { for (let x = n; x.parent; x = x.parent) if (x.parent.children[0] !== x) return false; return true; }
  function walk(root, fn) { const st = [root]; while (st.length) { const n = st.pop(); fn(n); for (let i = n.children.length - 1; i >= 0; i--) st.push(n.children[i]); } }
  function countNodes(root) { let k = 0; walk(root, () => k++); return k; }

  // ---------------------------------------------------------------- posición en un nodo (con caché)
  function stateAt(game, n) {
    if (n._st && n._stSize === game.size) return n._st;
    let s;
    if (!n.parent) s = Go.create(game.size);
    else s = stateAt(game, n.parent);
    if (n.setup) {
      const list = [];
      for (const [k, c] of [["AB", Go.BLACK], ["AW", Go.WHITE], ["AE", Go.EMPTY]]) for (const [x, y] of n.setup[k] || []) if (x < game.size && y < game.size) list.push([Go.pt(s, x, y), c]);
      s = Go.setup(s, list);
    }
    if (n.move) {
      const p = n.move.x < 0 ? Go.PASS : Go.pt(s, n.move.x, n.move.y);
      let r = Go.play(s, p, n.move.c);
      if (r.error) {
        // Las partidas de otros programas pueden traer jugadas ilegales: se colocan sin más para no perder el resto
        const t = Go.setup(s, p === Go.PASS ? [] : [[p, n.move.c]]);
        t.turn = Go.other(n.move.c);
        r = { state: t, captured: [], illegal: r.error };
      }
      s = r.state;
      n._captured = r.captured;
      n._illegal = r.illegal || "";
    } else if (!n.parent) {
      s = Go.clone(s);
      s.turn = n.pl || (n.setup && (n.setup.AB || []).length > 1 && !(n.setup.AW || []).length ? Go.WHITE : Go.BLACK);
    } else if (n.pl) {
      s = Go.clone(s);
      s.turn = n.pl;
    }
    n._st = s; n._stSize = game.size;
    return s;
  }
  function invalidate(n) { walk(n, x => { x._st = null; }); }
  function historyKeys(game, n) {
    const set = new Set();
    for (let x = n; x; x = x.parent) set.add(Go.key(stateAt(game, x)));
    return set;
  }

  // ---------------------------------------------------------------- lector SGF
  function decodeBytes(buf) {
    // Lee como UTF-8; si la propiedad CA dice otra cosa, se vuelve a leer con esa codificación
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let text = new TextDecoder("utf-8").decode(bytes);
    const m = /CA\[([^\]]+)\]/.exec(text.slice(0, 4000));
    if (m) {
      const enc = m[1].trim().toLowerCase();
      if (enc && !/^utf-?8$/.test(enc)) {
        try { text = new TextDecoder(enc).decode(bytes); } catch (e) { /* codificación desconocida: se queda en UTF-8 */ }
      }
    }
    return text;
  }
  function tokenize(text) {
    // Devuelve un árbol crudo: { nodes: [[ [id, [vals]] ]], subs: [...] }
    let i = 0;
    const len = text.length;
    const games = [];
    function skipWs() { while (i < len && /\s/.test(text[i])) i++; }
    function readValue() {
      i++; // [
      let v = "";
      while (i < len && text[i] !== "]") {
        if (text[i] === "\\") {
          i++;
          if (text[i] === "\r") { i++; if (text[i] === "\n") i++; continue; }
          if (text[i] === "\n") { i++; if (text[i] === "\r") i++; continue; }
          v += text[i] ?? ""; i++;
        } else { v += text[i]; i++; }
      }
      i++; // ]
      return v;
    }
    function readTree() {
      // text[i] === "("
      i++;
      const t = { nodes: [], subs: [] };
      for (;;) {
        skipWs();
        if (i >= len) return t;
        const ch = text[i];
        if (ch === ";") {
          i++;
          const props = [];
          for (;;) {
            skipWs();
            const m = /^[A-Za-z]+/.exec(text.slice(i, i + 32));
            if (!m) break;
            i += m[0].length;
            const id = m[0].replace(/[a-z]/g, "");
            const vals = [];
            skipWs();
            while (text[i] === "[") { vals.push(readValue()); skipWs(); }
            if (id) props.push([id, vals]);
          }
          t.nodes.push(props);
        } else if (ch === "(") {
          t.subs.push(readTree());
        } else if (ch === ")") {
          i++; return t;
        } else i++;
      }
    }
    while (i < len) {
      if (text[i] === "(") {
        const save = i;
        const t = readTree();
        if (t.nodes.length) games.push(t);
        if (i === save) i++;
      } else i++;
    }
    return games;
  }
  function expandPoints(vals, size) {
    const out = [];
    for (const v of vals) {
      if (v.includes(":")) {
        const [a, b] = v.split(":").map(Go.fromSgf);
        if (!a || !b) continue;
        for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
          for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) out.push([x, y]);
      } else {
        const p = Go.fromSgf(v);
        if (p && p[0] < size && p[1] < size) out.push(p);
      }
    }
    return out;
  }
  function buildGame(raw) {
    const rootProps = raw.nodes[0] || [];
    let size = 19;
    for (const [id, v] of rootProps) if (id === "SZ") { const n = parseInt(String(v[0]).split(":")[0], 10); if (n >= 2 && n <= 25) size = n; }
    const g = { headers: {}, root: null, size };
    const errors = [];
    let moves = 0;
    function fill(n, props, isRoot) {
      for (const [id, vals] of props) {
        const v0 = vals[0] ?? "";
        if (isRoot && HEADER_SET.has(id)) { g.headers[id] = v0; continue; }
        switch (id) {
          case "B": case "W": {
            const c = id === "B" ? Go.BLACK : Go.WHITE;
            const p = (v0 === "" || (v0 === "tt" && size <= 19)) ? null : Go.fromSgf(v0);
            if (p && (p[0] >= size || p[1] >= size)) { errors.push("jugada fuera del tablero: " + v0); break; }
            n.move = p ? { c, x: p[0], y: p[1] } : { c, x: -1, y: -1 };
            moves++;
            break;
          }
          case "AB": case "AW": case "AE":
            n.setup = n.setup || { AB: [], AW: [], AE: [] };
            n.setup[id] = n.setup[id].concat(expandPoints(vals, size));
            break;
          case "PL": n.pl = /^w/i.test(v0) || v0 === "2" ? Go.WHITE : Go.BLACK; break;
          case "C": n.comment = n.comment ? n.comment + "\n" + v0 : v0; break;
          case "N": n.name = v0; break;
          case "TE": n.nag = v0 === "2" ? "!!" : "!"; break;
          case "BM": n.nag = v0 === "2" ? "??" : "?"; break;
          case "DO": n.nag = "?!"; break;
          case "IT": n.nag = "!?"; break;
          case "GB": case "GW": case "DM": case "UC": n.pos = id; break;
          case "TR": case "SQ": case "CR": case "MA":
            n.marks = n.marks || {}; n.marks[id] = (n.marks[id] || []).concat(expandPoints(vals, size)); break;
          case "LB":
            n.marks = n.marks || {};
            n.marks.LB = (n.marks.LB || []).concat(vals.map(v => { const k = v.indexOf(":"); const p = Go.fromSgf(v.slice(0, k)); return p ? [p[0], p[1], v.slice(k + 1)] : null; }).filter(Boolean));
            break;
          case "SL": case "AR": case "LN": case "VW": case "V": case "MN": case "KO": case "FG": case "PM": case "BL": case "WL": case "OB": case "OW": case "HO":
          default:
            n.extra = n.extra || {}; n.extra[id] = vals;
        }
      }
    }
    function build(t, parent) {
      let cur = parent;
      t.nodes.forEach((props, k) => {
        const n = node(cur);
        if (!cur) g.root = n; else cur.children.push(n);
        fill(n, props, !cur);
        cur = n;
      });
      for (const sub of t.subs) build(sub, cur);
    }
    build(raw, null);
    if (!g.root) g.root = node();
    if (g.root.move) {
      // Una jugada en el nodo raíz: se pasa a un hijo para que la raíz sea siempre la posición inicial
      const r = g.root, n = node(r);
      n.move = r.move; r.move = null; n.children = r.children; n.children.forEach(c => (c.parent = n));
      n.comment = r.comment; r.comment = ""; n.nag = r.nag; r.nag = "";
      r.children = [n];
    }
    if (!g.headers.SZ) g.headers.SZ = String(size);
    return { game: g, moves, errors };
  }
  function parse(text) {
    const raws = tokenize(text);
    return raws.map(buildGame);
  }

  // Jugadas sueltas: «D4 Q16 C3», «1. D4 2. Q16», «pd dp», «pasa»
  function parseMoves(text, size, start = Go.BLACK) {
    const toks = text.replace(/\d+\s*[.)]/g, " ").split(/[\s,;]+/).filter(Boolean);
    const out = [];
    let c = start;
    for (const tk of toks) {
      if (/^(pass|pasa|pasar|tt)$/i.test(tk)) { out.push({ c, x: -1, y: -1 }); c = Go.other(c); continue; }
      let m = /^([BW])\[?([a-z]{2})?\]?$/i.exec(tk);
      let p = null;
      const g = Go.fromGtp(size, tk.replace(/^[BWN]:?/i, ""));
      if (g) p = g;
      else if (/^[a-s]{2}$/.test(tk)) p = Go.fromSgf(tk);
      else if (m && m[2]) { p = Go.fromSgf(m[2]); }
      if (!p || p[0] >= size || p[1] >= size) return { error: "No entiendo «" + tk + "»", moves: out };
      out.push({ c, x: p[0], y: p[1] });
      c = Go.other(c);
    }
    return { moves: out };
  }
  function looksLikeSgf(text) { return /\(\s*;/.test(text); }

  // ---------------------------------------------------------------- escritor SGF
  const esc = v => String(v).replace(/\\/g, "\\\\").replace(/]/g, "\\]");
  function pts(list) { return list.map(([x, y]) => "[" + Go.sgfCoord(x, y) + "]").join(""); }
  function nodeProps(n, game, isRoot) {
    let out = "";
    if (isRoot) {
      const h = Object.assign({}, game.headers, { GM: "1", FF: "4", CA: "UTF-8", SZ: String(game.size) });
      if (!h.AP) h.AP = "GoBase";
      const keys = HEADER_ORDER.concat(Object.keys(h).filter(k => !HEADER_ORDER.includes(k)));
      for (const k of keys) if (h[k] !== undefined && h[k] !== "" && /^[A-Z]+$/.test(k)) out += k + "[" + esc(h[k]) + "]";
    }
    if (n.move) {
      const c = n.move.c === Go.BLACK ? "B" : "W";
      out += c + "[" + (n.move.x < 0 ? "" : Go.sgfCoord(n.move.x, n.move.y)) + "]";
    }
    if (n.setup) for (const k of ["AB", "AW", "AE"]) if ((n.setup[k] || []).length) out += k + pts(n.setup[k]);
    if (n.pl) out += "PL[" + (n.pl === Go.WHITE ? "W" : "B") + "]";
    if (n.nag && NAG_OUT[n.nag]) out += NAG_OUT[n.nag][0] + "[" + NAG_OUT[n.nag][1] + "]";
    if (n.pos && POS_CODES.includes(n.pos)) out += n.pos + "[1]";
    if (n.marks) {
      for (const k of MARKS) if ((n.marks[k] || []).length) out += k + pts(n.marks[k]);
      if ((n.marks.LB || []).length) out += "LB" + n.marks.LB.map(([x, y, t]) => "[" + Go.sgfCoord(x, y) + ":" + esc(t) + "]").join("");
    }
    if (n.name) out += "N[" + esc(n.name) + "]";
    if (n.comment) out += "C[" + esc(n.comment) + "]";
    if (n.extra) for (const [k, vals] of Object.entries(n.extra)) out += k + vals.map(v => "[" + esc(v) + "]").join("");
    return out;
  }
  function serialize(game) {
    let out = "";
    let col = 0;
    function emit(s) { out += s; col += s.length; if (col > 70 && s.endsWith("]")) { out += "\n"; col = 0; } }
    function seq(n, isRoot) {
      emit(";" + nodeProps(n, game, isRoot));
      if (n.children.length === 1) seq(n.children[0], false);
      else for (const c of n.children) { emit("("); seq(c, false); emit(")"); }
    }
    emit("(");
    seq(game.root, true);
    emit(")");
    return out.trim() + "\n";
  }
  function serializeAll(games) { return games.map(serialize).join("\n"); }

  // ---------------------------------------------------------------- JSON (para la biblioteca: guarda también el análisis)
  function toJSON(game) {
    function enc(n) {
      const o = {};
      for (const k of ["move", "setup", "pl", "comment", "nag", "pos", "name", "marks", "extra", "eval"]) if (n[k] && !(Array.isArray(n[k]) && !n[k].length)) o[k] = n[k];
      if (n.children.length) o.ch = n.children.map(enc);
      return o;
    }
    return { v: 1, size: game.size, headers: game.headers, root: enc(game.root) };
  }
  function fromJSON(o) {
    function dec(d, parent) {
      const n = node(parent);
      for (const k of ["move", "setup", "pl", "comment", "nag", "pos", "name", "marks", "extra", "eval"]) if (d[k] !== undefined) n[k] = d[k];
      n.children = (d.ch || []).map(c => dec(c, n));
      return n;
    }
    return { headers: Object.assign({}, o.headers), size: o.size || 19, root: dec(o.root || {}, null) };
  }

  // ---------------------------------------------------------------- simetrías (para el explorador y la búsqueda)
  function transform(x, y, n, t) {
    const m = n - 1;
    switch (t) {
      case 0: return [x, y]; case 1: return [m - x, y]; case 2: return [x, m - y]; case 3: return [m - x, m - y];
      case 4: return [y, x]; case 5: return [m - y, x]; case 6: return [y, m - x]; default: return [m - y, m - x];
    }
  }
  function inverse(t) { return t === 5 ? 6 : t === 6 ? 5 : t; }

  return {
    node, newGame, path, mainline, moveNumber, addChild, cut, promote, makeMain, isMainline, walk, countNodes,
    stateAt, invalidate, historyKeys, decodeBytes, parse, parseMoves, looksLikeSgf, serialize, serializeAll,
    toJSON, fromJSON, transform, inverse, sameMove, HEADER_ORDER
  };
})();
