/* GoBase · motor propio: búsqueda de Monte Carlo en árbol (UCT + RAVE) con partidas aleatorias guiadas
   (capturar, salir del atari, no rellenar ojos propios, no autoatari de grupos grandes, responder cerca).
   Calcula el porcentaje de victoria, la ventaja estimada en puntos, las mejores jugadas con su variante
   y la propiedad de cada punto (territorio y piedras muertas). Corre en un Worker o en el hilo principal. */
"use strict";

const Engine = (() => {
  const EMPTY = 0, BLACK = 1, WHITE = 2, EDGE = 3, PASS = -1;

  // ---------------------------------------------------------------- tablero rápido (pseudolibertades)
  class FastBoard {
    constructor(n) {
      this.n = n; this.W = n + 2; const L = this.W * this.W; this.L = L;
      this.color = new Uint8Array(L); this.head = new Int32Array(L); this.next = new Int32Array(L);
      this.plibs = new Int32Array(L); this.lsum = new Float64Array(L); this.lsq = new Float64Array(L); this.size = new Int32Array(L);
      this.empties = new Int32Array(L); this.epos = new Int32Array(L).fill(-1); this.ne = 0;
      this.ko = -1; this.turn = BLACK; this.cap = [0, 0, 0]; this.last = -1; this.last2 = -1;
      this.dirs = [1, -1, this.W, -this.W]; this.diag = [this.W + 1, this.W - 1, -this.W + 1, -this.W - 1];
    }
    static fromState(s) {
      const B = new FastBoard(s.n);
      B.color.fill(EDGE);
      for (let y = 0; y < s.n; y++) for (let x = 0; x < s.n; x++) { const p = (y + 1) * B.W + x + 1; B.color[p] = EMPTY; B.addEmpty(p); }
      for (let p = 0; p < B.L; p++) if (s.b[p] === BLACK || s.b[p] === WHITE) B.place(p, s.b[p], true);
      B.ko = s.ko; B.turn = s.turn; B.cap = s.cap.slice();
      return B;
    }
    copyFrom(o) {
      this.color.set(o.color); this.head.set(o.head); this.next.set(o.next); this.plibs.set(o.plibs); this.lsum.set(o.lsum); this.lsq.set(o.lsq);
      this.size.set(o.size); this.empties.set(o.empties); this.epos.set(o.epos); this.ne = o.ne; this.ko = o.ko; this.turn = o.turn;
      this.cap[1] = o.cap[1]; this.cap[2] = o.cap[2]; this.last = o.last; this.last2 = o.last2;
    }
    addEmpty(p) { this.epos[p] = this.ne; this.empties[this.ne++] = p; }
    removeEmpty(p) {
      const i = this.epos[p], q = this.empties[--this.ne];
      this.empties[i] = q; this.epos[q] = i; this.epos[p] = -1;
    }
    addLib(h, p) { this.plibs[h]++; this.lsum[h] += p; this.lsq[h] += p * p; }
    remLib(h, p) { this.plibs[h]--; this.lsum[h] -= p; this.lsq[h] -= p * p; }
    inAtari(h) { const n = this.plibs[h]; return n > 0 && this.lsum[h] * this.lsum[h] === n * this.lsq[h]; }
    atariLib(h) { return this.lsum[h] / this.plibs[h]; }
    // ¿Es legal para c? (sin superko)
    legal(p, c) {
      if (this.color[p] !== EMPTY) return false;
      if (p === this.ko && c === this.turn) return false;
      const col = this.color, head = this.head;
      for (let d = 0; d < 4; d++) {
        const q = p + this.dirs[d], v = col[q];
        if (v === EMPTY) return true;
        if (v === EDGE) continue;
        const h = head[q];
        if (v === c) { if (!this.inAtari(h)) return true; }
        else if (this.inAtari(h)) return true;
      }
      return false;
    }
    // Ojo propio: los cuatro vecinos son propios y no es un ojo falso
    isEye(p, c) {
      const col = this.color;
      for (let d = 0; d < 4; d++) { const v = col[p + this.dirs[d]]; if (v !== c && v !== EDGE) return false; }
      let bad = 0, edge = 0;
      for (let d = 0; d < 4; d++) { const v = col[p + this.diag[d]]; if (v === EDGE) edge = 1; else if (v === 3 - c) bad++; }
      return bad + edge < 2;
    }
    place(p, c, setup) {
      const col = this.color, head = this.head, next = this.next, W = this.dirs;
      col[p] = c; head[p] = p; next[p] = p; this.size[p] = 1; this.plibs[p] = 0; this.lsum[p] = 0; this.lsq[p] = 0;
      this.removeEmpty(p);
      for (let d = 0; d < 4; d++) {
        const q = p + W[d], v = col[q];
        if (v === EMPTY) this.addLib(p, q);
        else if (v !== EDGE) this.remLib(head[q], p);
      }
      for (let d = 0; d < 4; d++) {
        const q = p + W[d];
        if (col[q] === c && head[q] !== head[p]) this.merge(head[p], head[q]);
      }
      let captured = 0, capPt = -1;
      const opp = 3 - c;
      for (let d = 0; d < 4; d++) {
        const q = p + W[d];
        if (col[q] === opp && this.plibs[head[q]] === 0) { capPt = q; captured += this.removeChain(head[q]); }
      }
      if (!setup) {
        this.cap[c] += captured;
        const h = head[p];
        this.ko = (captured === 1 && this.size[h] === 1 && this.inAtari(h)) ? capPt : -1;
        this.turn = opp; this.last2 = this.last; this.last = p;
      }
      return captured;
    }
    merge(a, b) {
      if (this.size[a] < this.size[b]) { const t = a; a = b; b = t; }
      const head = this.head, next = this.next;
      let s = b;
      do { head[s] = a; s = next[s]; } while (s !== b);
      const t = next[a]; next[a] = next[b]; next[b] = t;
      this.size[a] += this.size[b]; this.plibs[a] += this.plibs[b]; this.lsum[a] += this.lsum[b]; this.lsq[a] += this.lsq[b];
    }
    removeChain(h) {
      const col = this.color, next = this.next, head = this.head, W = this.dirs;
      let s = h, n = 0;
      do { col[s] = EMPTY; this.addEmpty(s); n++; s = next[s]; } while (s !== h);
      s = h;
      do {
        for (let d = 0; d < 4; d++) { const q = s + W[d], v = col[q]; if (v === BLACK || v === WHITE) this.addLib(head[q], s); }
        const nx = next[s]; next[s] = s; head[s] = s; s = nx;
      } while (s !== h);
      return n;
    }
    pass() { this.ko = -1; this.turn = 3 - this.turn; this.last2 = this.last; this.last = PASS; }
    // ¿Dejaría su propio grupo en atari? (cálculo exacto, sólo cuando hay pocas libertades)
    selfAtariSize(p, c) {
      const col = this.color, W = this.dirs;
      let libs = 0, l1 = -1;
      const addL = q => { if (q === p) return false; if (q !== l1) { if (l1 < 0) { l1 = q; libs = 1; } else return true; } return false; };
      let size = 1;
      for (let d = 0; d < 4; d++) {
        const q = p + W[d], v = col[q];
        if (v === EMPTY) { if (addL(q)) return 0; }
        else if (v === 3 - c && this.inAtari(this.head[q])) return 0; // captura: no es autoatari
      }
      const seen = [];
      for (let d = 0; d < 4; d++) {
        const q = p + W[d];
        if (col[q] !== c) continue;
        const h = this.head[q];
        if (seen.includes(h)) continue;
        seen.push(h); size += this.size[h];
        let s = h;
        do {
          for (let e = 0; e < 4; e++) { const r = s + W[e]; if (col[r] === EMPTY && addL(r)) return 0; }
          s = this.next[s];
        } while (s !== h);
      }
      return libs <= 1 ? size : 0;
    }
    // Recuento por área al final de una partida aleatoria: piedras + puntos vacíos rodeados por un solo color
    areaScore(own) {
      const col = this.color, W = this.dirs, n = this.n, Wd = this.W;
      let b = 0, w = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const p = (y + 1) * Wd + x + 1, v = col[p];
        let o = 0;
        if (v === BLACK || v === WHITE) o = v;
        else {
          let m = 0;
          for (let d = 0; d < 4; d++) { const u = col[p + W[d]]; if (u === BLACK) m |= 1; else if (u === WHITE) m |= 2; }
          o = m === 1 ? BLACK : m === 2 ? WHITE : 0;
        }
        if (o === BLACK) { b++; if (own) own[p]++; } else if (o === WHITE) { w++; if (own) own[p]--; }
      }
      return b - w;
    }
  }

  // ---------------------------------------------------------------- generador aleatorio rápido
  let seed = 0x2545F491;
  function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
  function setSeed(x) { seed = (x | 0) || 0x2545F491; }

  // ---------------------------------------------------------------- partida aleatoria guiada
  const tmp = [];
  function heuristicMove(B, c) {
    const last = B.last;
    if (last < 0) return -1;
    const col = B.color, W = B.dirs, opp = 3 - c;
    tmp.length = 0;
    // 1) capturar lo que acaba de jugar el rival si está en atari, o un vecino suyo en atari
    if (col[last] === opp && B.inAtari(B.head[last])) tmp.push(B.atariLib(B.head[last]));
    // 2) salvar piedras propias puestas en atari por la última jugada
    for (let d = 0; d < 4; d++) {
      const q = last + W[d];
      if (col[q] === c && B.inAtari(B.head[q])) {
        const h = B.head[q];
        // capturar una cadena rival en atari que la toque
        let s = h;
        do {
          for (let e = 0; e < 4; e++) { const r = s + W[e]; if (col[r] === opp && B.inAtari(B.head[r])) tmp.push(B.atariLib(B.head[r])); }
          s = B.next[s];
        } while (s !== h && tmp.length < 6);
        const lib = B.atariLib(h);
        let emp = 0;
        for (let e = 0; e < 4; e++) if (col[lib + W[e]] === EMPTY) emp++;
        if (emp >= 2) tmp.push(lib);
      } else if (col[q] === opp && q !== last && B.inAtari(B.head[q])) tmp.push(B.atariLib(B.head[q]));
    }
    for (let k = tmp.length; k > 0; k--) {
      const i = (rnd() * k) | 0, p = tmp[i];
      tmp[i] = tmp[k - 1];
      if (B.legal(p, c) && !B.isEye(p, c) && B.selfAtariSize(p, c) < 2) return p;
    }
    // 3) responder cerca de la última jugada (8 vecinos) con cortes y hanes sencillos
    if (rnd() < 0.55) {
      const around = [1, -1, B.W, -B.W, B.W + 1, B.W - 1, -B.W + 1, -B.W - 1];
      const start = (rnd() * 8) | 0;
      for (let k = 0; k < 8; k++) {
        const p = last + around[(start + k) & 7];
        if (col[p] !== EMPTY || !B.legal(p, c) || B.isEye(p, c)) continue;
        if (goodShape(B, p, c) && B.selfAtariSize(p, c) === 0) return p;
      }
    }
    return -1;
  }
  // Distancia (Manhattan) a la piedra más cercana, hasta «max»
  function nearestStone(B, x, y, max) {
    const n = B.n, W = B.W;
    for (let d = 1; d <= max; d++) {
      for (let dx = -d; dx <= d; dx++) {
        const dy = d - Math.abs(dx);
        for (const sy of dy ? [dy, -dy] : [0]) {
          const a = x + dx, b = y + sy;
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const v = B.color[(b + 1) * W + a + 1];
          if (v === BLACK || v === WHITE) return d;
        }
      }
    }
    return max + 1;
  }
  // Forma mínima: toca una piedra rival y tiene alguna piedra propia en diagonal o al lado (hane, corte)
  function goodShape(B, p, c) {
    const col = B.color;
    let mine = 0, theirs = 0, emp = 0;
    for (let d = 0; d < 4; d++) { const v = col[p + B.dirs[d]]; if (v === c) mine++; else if (v === 3 - c) theirs++; else if (v === EMPTY) emp++; }
    let dmine = 0;
    for (let d = 0; d < 4; d++) if (col[p + B.diag[d]] === c) dmine++;
    return theirs > 0 && (mine + dmine) > 0 && emp > 0 && !(mine >= 3);
  }
  function randomMove(B, c) {
    const ne = B.ne;
    if (!ne) return PASS;
    let i = (rnd() * ne) | 0;
    for (let k = 0; k < ne; k++, i = (i + 1 === ne ? 0 : i + 1)) {
      const p = B.empties[i];
      if (!B.legal(p, c) || B.isEye(p, c)) continue;
      if (B.selfAtariSize(p, c) >= 3) continue;
      return p;
    }
    return PASS;
  }
  /* Juega hasta el final; devuelve la diferencia por área (negras − blancas) sin komi.
     amaf: Int8Array con el color que jugó primero en cada punto (para RAVE). */
  function playout(B, amaf, own, maxMoves) {
    let passes = 0, moves = 0;
    while (passes < 2 && moves < maxMoves) {
      const c = B.turn;
      let p = heuristicMove(B, c);
      if (p < 0) p = randomMove(B, c);
      if (p === PASS) { B.pass(); passes++; }
      else { if (amaf && !amaf[p]) amaf[p] = c; B.place(p, c, false); passes = 0; }
      moves++;
    }
    return B.areaScore(own);
  }

  // ---------------------------------------------------------------- árbol
  function TreeNode(move, color) {
    this.m = move; this.c = color; // color que jugó «m»
    this.n = 0; this.w = 0; this.rn = 0; this.rw = 0; this.kids = null;
  }
  const RAVE_K = 600;

  class Search {
    constructor(state, opts = {}) {
      this.state = state; this.n = state.n; this.komi = opts.komi ?? 6.5;
      this.root = new TreeNode(PASS, 3 - state.turn);
      this.base = FastBoard.fromState(state);
      this.B = new FastBoard(state.n); this.B.color.fill(EDGE);
      this.own = new Float64Array(this.base.L); this.scoreSum = 0; this.playouts = 0;
      this.amaf = new Int8Array(this.base.L);
      this.history = opts.history || null; // claves de superko en la raíz (sólo para las jugadas de la raíz)
      this.maxMoves = state.n * state.n * 3;
      this.expandAt = opts.expandAt ?? 2;
      this.moveNum = opts.moveNum || 0;
      this.forbidden = opts.forbidden || null; // puntos que no se pueden jugar en la raíz (superko)
      this.rootMoves = opts.rootMoves || null; // restringir las jugadas candidatas de la raíz
      this.passAllowed = opts.passAllowed ?? true;
      this.track = opts.track ?? null; // jugada de la raíz que se quiere medir (la que se jugó en la partida)
    }
    expand(node, B) {
      const c = B.turn, kids = [], n = this.n, W = B.W;
      const isRoot = node === this.root;
      const empt = B.ne;
      for (let i = 0; i < B.ne; i++) {
        const p = B.empties[i];
        if (!B.legal(p, c) || B.isEye(p, c)) continue;
        if (isRoot && this.forbidden && this.forbidden.has(p)) continue;
        if (isRoot && this.rootMoves && !this.rootMoves.has(p)) continue;
        const k = new TreeNode(p, c);
        // conocimiento previo: visitas virtuales
        const x = p % W - 1, y = ((p / W) | 0) - 1;
        const line = Math.min(x, y, n - 1 - x, n - 1 - y);
        let pn = 10, pw = 5;
        const sa = B.selfAtariSize(p, c);
        if (sa >= 2) { pn += 20; pw += 0; }
        else if (sa === 1) { pn += 6; pw += 1; }
        let capt = 0, save = 0;
        for (let d = 0; d < 4; d++) {
          const q = p + B.dirs[d], v = B.color[q];
          if (v === 3 - c && B.inAtari(B.head[q])) capt += B.size[B.head[q]];
          if (v === c && B.inAtari(B.head[q])) save += B.size[B.head[q]];
        }
        if (capt) { pn += 20; pw += 18 + Math.min(10, capt); }
        if (save && sa === 0) { pn += 15; pw += 12; }
        if (n >= 9 && empt > n * n * 0.7) {
          // apertura: tercera y cuarta línea, sobre todo en zonas vacías y en las esquinas
          if (line === 0) { pn += 30; pw += 1; }
          else if (line === 1) { pn += 20; pw += 2; }
          else if (line === 2 || line === 3) {
            pn += 14; pw += 11;
            const near = nearestStone(B, x, y, 4);
            if (near > 4) { pn += 10; pw += 9; }
            const corner = Math.min(x, n - 1 - x) <= 4 && Math.min(y, n - 1 - y) <= 4;
            if (corner && near > 4) { pn += 10; pw += 9; }
          } else if (n >= 13) { pn += 10; pw += 3; }
          if (n >= 13 && nearestStone(B, x, y, 1) <= 1 && !capt && !save) { pn += 8; pw += 2; }
        } else if (line === 0) { pn += 6; pw += 1; }        k.n = 0; k.w = 0; k.pn = pn; k.pw = pw; k.pr = pw / pn;
        kids.push(k);
      }
      if (this.passAllowed || !kids.length) {
        const k = new TreeNode(PASS, c);
        const late = kids.length < 6 || empt < n * n * 0.25;
        k.pn = 10; k.pw = late ? 5 : 0; k.n = 0; k.w = 0; k.pr = k.pw / k.pn;
        kids.push(k);
      }
      // ampliación progresiva: se exploran primero las jugadas con mejor conocimiento previo
      if (isRoot && this.track != null) for (const k of kids) if (k.m === this.track) k.pr = 99;
      kids.sort((a, b) => b.pr - a.pr);
      node.kids = kids;
    }
    select(node) {
      let best = null, bv = -1;
      const lnN = Math.log(node.n + 1);
      const kids = node.kids, lim = Math.min(kids.length, 4 + Math.floor(Math.log(node.n + 1) / 0.47));
      for (let i = 0; i < lim; i++) {
        const k = kids[i];
        const n = k.n + k.pn, q = (k.w + k.pw) / n;
        let v;
        if (k.rn > 0) {
          const beta = k.rn / (k.rn + n + k.rn * n / RAVE_K);
          v = (1 - beta) * q + beta * (k.rw / k.rn);
        } else v = q;
        v += 0.25 * Math.sqrt(lnN / (n + 1));
        if (v > bv) { bv = v; best = k; }
      }
      return best;
    }
    step() {
      const B = this.B;
      B.copyFrom(this.base);
      const amaf = this.amaf; amaf.fill(0);
      const path = [this.root];
      let node = this.root, passes = 0;
      while (node.kids) {
        if (!node.kids.length) break;
        const k = this.select(node);
        if (k.m === PASS) { B.pass(); passes++; }
        else { if (!amaf[k.m]) amaf[k.m] = k.c; B.place(k.m, k.c, false); passes = 0; }
        path.push(k);
        node = k;
        if (passes >= 2) break;
      }
      if (passes < 2 && !node.kids && (node.n >= this.expandAt || node === this.root)) {
        this.expand(node, B);
        if (node.kids.length) {
          const k = this.select(node);
          if (k.m === PASS) { B.pass(); passes++; } else { if (!amaf[k.m]) amaf[k.m] = k.c; B.place(k.m, k.c, false); passes = 0; }
          path.push(k); node = k;
        }
      }
      let diff;
      if (passes >= 2) diff = B.areaScore(this.own);
      else diff = playout(B, amaf, this.own, this.maxMoves);
      const score = diff - this.komi;
      this.scoreSum += score; this.playouts++;
      const winner = score > 0 ? BLACK : WHITE;
      for (const nd of path) {
        nd.n++;
        if (nd.c === winner) nd.w++;
        if (nd.kids) {
          // RAVE: todas las jugadas hijas que el que juega en este nodo hizo después
          const c = 3 - nd.c;
          for (const k of nd.kids) {
            if (k.m >= 0 && amaf[k.m] === c) { k.rn++; if (c === winner) k.rw++; }
          }
        }
      }
    }
    run(k) { for (let i = 0; i < k; i++) this.step(); }
    pv(node, max = 12) {
      const out = [];
      while (node.kids && node.kids.length && out.length < max) {
        let b = null;
        for (const k of node.kids) if (!b || k.n > b.n) b = k;
        if (!b || b.n < 2) break;
        out.push(b.m); node = b;
      }
      return out;
    }
    result(multi = 5) {
      const root = this.root, mover = this.state.turn;
      const kids = (root.kids || []).filter(k => k.n > 0).sort((a, b) => b.n - a.n);
      const moves = kids.slice(0, Math.max(multi, 1)).map(k => ({ p: k.m, visits: k.n, wr: k.w / k.n, pv: [k.m].concat(this.pv(k, 10)) }));
      const own = new Float32Array(this.own.length);
      const N = Math.max(1, this.playouts);
      for (let i = 0; i < own.length; i++) own[i] = this.own[i] / N;
      const rootWrMover = root.n ? 1 - root.w / root.n : 0.5; // root.c es el rival del que juega
      const best = moves[0];
      const wrMover = best ? best.wr : rootWrMover;
      let tracked = null;
      if (this.track != null && root.kids) {
        const k = root.kids.find(x => x.m === this.track);
        if (k && k.n) tracked = { visits: k.n, wr: k.w / k.n };
      }
      return {
        playouts: this.playouts, mover, tracked,
        winrateBlack: mover === BLACK ? wrMover : 1 - wrMover,
        scoreLead: this.scoreSum / N, // negras − blancas (con komi)
        best: best ? best.p : PASS, moves, ownership: own
      };
    }
  }

  // ---------------------------------------------------------------- utilidades
  function analyze(state, opts = {}) {
    if (opts.seed) setSeed(opts.seed);
    const S = new Search(state, opts);
    const total = opts.playouts || 2000, deadline = opts.timeMs ? Date.now() + opts.timeMs : Infinity;
    while (S.playouts < total && Date.now() < deadline) S.run(Math.min(64, total - S.playouts));
    return S.result(opts.multi || 5);
  }
  /* Piedras muertas al final: las que en las partidas aleatorias acaban casi siempre en poder del rival */
  function estimateDead(state, opts = {}) {
    const S = new Search(state, Object.assign({ komi: 0 }, opts));
    const B = new FastBoard(state.n);
    const own = new Float64Array(S.base.L);
    const total = opts.playouts || 1500;
    for (let i = 0; i < total; i++) {
      B.copyFrom(S.base);
      playout(B, null, own, S.maxMoves);
    }
    const dead = new Set(), ownership = new Float32Array(own.length);
    for (let p = 0; p < own.length; p++) {
      const o = own[p] / total; ownership[p] = o;
      if (state.b[p] === BLACK && o < -0.4) dead.add(p);
      if (state.b[p] === WHITE && o > 0.4) dead.add(p);
    }
    // un grupo es todo vivo o todo muerto: decide la mayoría de sus piedras
    const seen = new Set();
    for (let p = 0; p < own.length; p++) {
      if ((state.b[p] !== BLACK && state.b[p] !== WHITE) || seen.has(p)) continue;
      const g = Go.group(state, p);
      g.stones.forEach(q => seen.add(q));
      const d = g.stones.filter(q => dead.has(q)).length;
      g.stones.forEach(q => d * 2 > g.stones.length ? dead.add(q) : dead.delete(q));
    }
    return { dead, ownership };
  }

  return { FastBoard, Search, analyze, estimateDead, playout, setSeed, rnd };
})();
