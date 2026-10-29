#!/usr/bin/env node
/* Pruebas del núcleo sin navegador: reglas (capturas, ko, suicidio, superko), coordenadas, hándicap, recuento,
   Benson, lectores de problemas (cada problema incluido), SGF y motor de Monte Carlo.
   Uso: node tests/test_reglas.js */
"use strict";
const fs = require("fs");
const path = require("path");
const src = ["core.js", "sgf.js", "engine.js", "problems.js"].map(f => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8")).join("\n");
const { Go, Sgf, Engine, PROBLEMS } = new Function(src + ";return { Go, Sgf, Engine, PROBLEMS };")();

const fallos = [];
function comprobar(cond, msg) {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) { fallos.push(msg); if (process.env.GITHUB_ACTIONS) console.log(`::error title=Prueba fallida::${msg}`); }
}
const P = (s, gtp) => { const [x, y] = Go.fromGtp(s.n, gtp); return Go.pt(s, x, y); };
function playSeq(s, seq) { for (const m of seq.split(" ")) { const r = Go.play(s, m === "pass" ? Go.PASS : P(s, m)); if (r.error) throw new Error(m + ": " + r.error); s = r.state; } return s; }

console.log("Reglas");
let s = Go.create(9);
s = playSeq(s, "D5 E5 E6 F5 E4 pass F4 pass F6");
// la piedra blanca de E5 queda rodeada por D5 E6 E4 y F5... F5 es blanca: no hay captura todavía
comprobar(s.b[P(s, "E5")] === Go.WHITE, "un grupo con libertades no se captura");
s = Go.fromAscii(`
.........
....X....
...XOX...
.........
.........
.........
.........
.........
.........`); s.turn = Go.BLACK;
let r = Go.play(s, P(s, "E6"));
comprobar(!r.error && r.captured.length === 1 && r.state.b[P(s, "E7")] === Go.EMPTY && r.state.cap[Go.BLACK] === 1, "captura de una piedra y recuento de prisioneros");
// suicidio
s = Go.fromAscii(`
.X.......
X........
.........
.........
.........
.........
.........
.........
.........`); s.turn = Go.WHITE;
comprobar(Go.play(s, P(s, "A9")).error === "suicide", "el suicidio está prohibido");
// ko
s = Go.fromAscii(`
.........
.........
...XO....
..XO.O...
...XO....
.........
.........
.........
.........`); s.turn = Go.BLACK;
r = Go.play(s, P(s, "E6"));
comprobar(!r.error && r.captured.length === 1, "toma de ko");
comprobar(Go.play(r.state, P(s, "D6")).error === "ko", "no se puede retomar el ko enseguida");
let t = Go.play(r.state, P(s, "J1")).state; t = Go.play(t, P(s, "J2")).state;
comprobar(!Go.play(t, P(s, "D6")).error, "tras una amenaza sí se puede retomar");
// superko: repetir una posición anterior
const hist = new Set([Go.key(s)]);
const back = Go.play(r.state, P(s, "D6"), Go.WHITE, { history: hist });
comprobar(back.error === "ko" || back.error === "superko", "el superko posicional prohíbe repetir posiciones");
// captura múltiple y libertades
s = Go.fromAscii(`
XO.......
XO.......
OO.......
.........
.........
.........
.........
.........
.........`); s.turn = Go.WHITE;
comprobar(Go.group(s, P(s, "A9")).libs.size === 0 || Go.libCount(s, P(s, "A9")) === 0, "grupo sin libertades detectado");

console.log("Coordenadas y hándicap");
comprobar(Go.gtp(19, 3, 15) === "D4" && Go.gtp(19, 15, 3) === "Q16" && Go.gtp(19, 8, 0) === "J19", "coordenadas GTP sin la I");
comprobar(String(Go.fromGtp(19, "Q16")) === "15,3" && Go.fromGtp(19, "I5") === null, "lectura de coordenadas GTP");
comprobar(Go.sgfCoord(15, 3) === "pd" && String(Go.fromSgf("dp")) === "3,15", "coordenadas SGF");
comprobar(Go.hoshi(19).length === 9 && Go.hoshi(13).length === 5 && Go.hoshi(9).length === 5, "puntos estrella de 19, 13 y 9");
comprobar(Go.handicapPoints(19, 9).length === 9 && Go.handicapPoints(19, 2).map(([x, y]) => Go.gtp(19, x, y)).sort().join() === "D4,Q16", "hándicap de 2 y de 9 piedras");

console.log("Recuento");
s = Go.fromAscii(`
..X.O
..X.O
XXXOO
OOOO.
.....`);
let sc = Go.score(s, { komi: 0 });
comprobar(sc.terr[1] === 4 && sc.terr[2] === 6 && sc.result === "W+2", "territorio japonés en 5×5");
sc = Go.score(s, { komi: 0.5, rules: "chinese" });
comprobar(sc.black === 9 && sc.white === 14.5, "área china con komi");
s = Go.fromAscii(`
.X.O.
XX.OO
...O.
OOOO.
.....`);
sc = Go.score(s, { komi: 0, dead: new Set([P(s, "B5"), P(s, "A4"), P(s, "B4")]) });
comprobar(sc.dead[1] === 3 && sc.prisoners[2] === 3 && sc.owner[P(s, "A5")] === Go.WHITE, "piedras muertas: prisioneras y territorio del rival");

console.log("Benson (vida incondicional)");
s = Go.fromAscii(`
.O.O.X...
OOOOOX...
XXXXXX...
.........
.........
.........
.........
.........
.........`);
comprobar(Go.benson(s, Go.WHITE).size === 7 && !Go.benson(s, Go.BLACK).size, "grupo con dos ojos vivo; el muro sin ojos, no");

console.log("Problemas incluidos (comprobados con los lectores exactos)");
function setupProblem(pr) {
  const rows = pr.diagram.slice(); while (rows.length < 9) rows.push(".........");
  let st = Go.create(9); const list = [], region = new Set();
  rows.forEach((row, y) => [...row].forEach((ch, x) => { const p = Go.pt(st, x, y); if (ch === "X") list.push([p, 1]); else if (ch === "O") list.push([p, 2]); else if (ch === ",") region.add(p); }));
  st = Go.setup(st, list); st.turn = Go.BLACK;
  return { st, region, target: Go.pt(st, pr.target[0], pr.target[1]) };
}
for (const pr of PROBLEMS) {
  const { st, region, target } = setupProblem(pr);
  const allStones = Go.points(st).filter(p => st.b[p]);
  const okLibs = Go.chains(st, 1).concat(Go.chains(st, 2)).every(g => g.libs.size >= 1);
  let sols;
  if (pr.kind === "ld") {
    comprobar(st.b[target] === (pr.goal === "kill" ? Go.WHITE : Go.BLACK), `${pr.title}: el objetivo es del color correcto`);
    sols = Go.solveLD(st, { target, region }).moves.filter(m => m !== Go.PASS).map(m => Go.moveName(st, m));
    // sin jugar, el defensor resiste (el problema no está resuelto de antemano)
    const passed = Go.play(st, Go.PASS).state;
    const def = Go.solveLD(passed, { target, region });
    comprobar(def.win, `${pr.title}: si negras no juegan, el otro bando se sale con la suya`);
  } else {
    sols = [];
    for (const p of Go.points(st)) {
      if (st.b[p]) continue;
      const rr = Go.play(st, p);
      if (rr.error) continue;
      if (rr.state.b[target] !== Go.WHITE || Go.readCapture(rr.state, target).captured) sols.push(Go.moveName(st, p));
    }
    const w = Go.clone(st); w.turn = Go.WHITE;
    comprobar(!Go.readCapture(w, target).captured, `${pr.title}: si juegan blancas, escapan`);
  }
  comprobar(okLibs && allStones.length > 3, `${pr.title}: posición válida`);
  comprobar(sols.slice().sort().join() === pr.answer.slice().sort().join(), `${pr.title}: soluciones ${pr.answer.join(", ")} (lector: ${sols.join(", ") || "ninguna"})`);
}

console.log("SGF");
const sgf = `(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[6.5]PB[Shusaku]PW[Gennan]RE[B+2]HA[0]
;B[qd]C[Komoku \\] con corchete];W[dc];B[pq]TE[1](;W[oc]BM[1]LB[qc:A][pc:B]TR[dd];B[mc])(;W[dq]N[Variante];B[ce]))`;
let parsed = Sgf.parse(sgf);
comprobar(parsed.length === 1 && parsed[0].moves === 7, "lee una partida con variantes");
let g = parsed[0].game;
const main = Sgf.mainline(g.root);
comprobar(main.length === 6 && main[1].comment === "Komoku ] con corchete" && main[3].nag === "!" && main[4].nag === "?", "comentarios con escapes y símbolos TE/BM");
comprobar(main[4].marks.LB.length === 2 && main[4].marks.TR.length === 1 && main[3].children[1].name === "Variante", "marcas LB y TR y nombre de nodo");
const out = Sgf.serialize(g);
comprobar(Sgf.serialize(Sgf.parse(out)[0].game) === out, "exportar → importar → exportar da el mismo SGF");
comprobar(Sgf.serialize(Sgf.fromJSON(JSON.parse(JSON.stringify(Sgf.toJSON(g))))) === out, "JSON de la biblioteca → SGF idéntico");
const coll = Sgf.parse("(;SZ[9];B[ee];W[cc])\n(;SZ[13]AB[dd:ee]AW[jj]PL[W];W[kk])");
comprobar(coll.length === 2 && coll[1].game.size === 13 && coll[1].game.root.setup.AB.length === 4, "colecciones y listas comprimidas de puntos (dd:ee)");
const st13 = Sgf.stateAt(coll[1].game, coll[1].game.root.children[0]);
comprobar(st13.b[Go.pt(st13, 10, 10)] === Go.WHITE && st13.turn === Go.BLACK, "colocación AB/AW, PL y jugada");
const hg = Sgf.newGame(19, { handicap: 4, komi: 0.5 });
comprobar(Sgf.stateAt(hg, hg.root).turn === Go.WHITE && /HA\[4\]/.test(Sgf.serialize(hg)) && Sgf.serialize(hg).includes("AB[pd][dp][pp][dd]"), "partida con hándicap: cuatro piedras y empiezan blancas");
let pm = Sgf.parseMoves("1. D4 2. Q16 3. pass 4. C3", 19);
comprobar(!pm.error && pm.moves.length === 4 && pm.moves[2].x === -1 && pm.moves[3].c === Go.WHITE, "jugadas sueltas en coordenadas GTP con pase");
pm = Sgf.parseMoves("pd dp cc", 19);
comprobar(!pm.error && pm.moves.length === 3 && pm.moves[0].x === 15, "jugadas sueltas en coordenadas SGF");
const pass = Sgf.parse("(;SZ[9];B[ee];W[];B[tt])")[0].game;
comprobar(Sgf.mainline(pass.root).slice(2).every(n => n.move.x === -1), "pases como B[] y B[tt]");
const latin = new TextEncoder().encode("(;CA[UTF-8]SZ[9]C[Año]);");
comprobar(Sgf.parse(Sgf.decodeBytes(latin))[0].game.root.comment === "Año", "lectura de bytes UTF-8");
for (let t = 0; t < 8; t++) { const [a, b] = Sgf.transform(2, 5, 19, t); comprobar(String(Sgf.transform(a, b, 19, Sgf.inverse(t))) === "2,5", "simetría " + t + " y su inversa"); }

console.log("Motor de Monte Carlo");
Engine.setSeed(7);
s = Go.fromAscii(`
.........
.........
.XXXXX...
XOOOOO.X.
.XXXXX...
.........
.........
.........
.........`); s.turn = Go.BLACK;
let res = Engine.analyze(s, { komi: 0, playouts: 2500, seed: 7 });
comprobar(Go.moveName(s, res.best) === "G6", "captura las cinco piedras en atari (G6)");
s = Go.fromAscii(`
.........
.........
.........
....OX...
...XO....
....X....
.........
.........
.........`); s.turn = Go.WHITE;
res = Engine.analyze(s, { komi: 0, playouts: 2500, seed: 9 });
comprobar(["D6", "F5"].includes(Go.moveName(s, res.best)), "salva o captura en una lucha de corte (" + Go.moveName(s, res.best) + ")");
s = Go.create(9);
res = Engine.analyze(s, { komi: 7, playouts: 3000, seed: 3 });
const [bx, by] = Go.xy(s, res.best);
comprobar(Math.min(bx, by, 8 - bx, 8 - by) >= 2, "en 9×9 vacío no empieza en la primera ni en la segunda línea (" + Go.moveName(s, res.best) + ")");
comprobar(res.winrateBlack > 0.2 && res.winrateBlack < 0.8 && res.ownership.length === s.b.length, "probabilidad razonable y mapa de territorio");
// piedras muertas al final
s = Go.fromAscii(`
.X.OO....
XX.O.O...
...OOO...
OOOO.....
.........
.........
.........
.........
.........`); s.turn = Go.BLACK;
const dead = Engine.estimateDead(s, { playouts: 600 });
comprobar(dead.dead.has(P(s, "B9")) && dead.dead.has(P(s, "A8")) && !dead.dead.has(P(s, "D9")), "detecta las piedras negras muertas en la esquina");
const t0 = Date.now();
Engine.analyze(Go.create(19), { komi: 6.5, playouts: 600 });
comprobar(Date.now() - t0 < 4000, "600 simulaciones en 19×19 en menos de 4 s (" + (Date.now() - t0) + " ms)");

console.log(fallos.length ? `\n${fallos.length} pruebas fallidas` : "\nTodas las pruebas del núcleo pasan.");
process.exit(fallos.length ? 1 : 0);
