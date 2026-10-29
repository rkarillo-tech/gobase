/* GoBase · entrenamiento: problemas (vida y muerte y capturas) con defensa perfecta, problemas en SGF,
   errores de tus partidas, tarjetas con repetición espaciada y el ejercicio de contar; arranque de la aplicación */

const SRS_DAYS = [1, 3, 7, 16, 35, 75];
let P = null; // problema en curso

function problemSetup(pr) {
  const rows = pr.diagram.slice();
  while (rows.length < 9) rows.push(".........");
  let s = Go.create(9);
  const list = [], region = new Set();
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const p = Go.pt(s, x, y);
    if (ch === "X") list.push([p, 1]); else if (ch === "O") list.push([p, 2]); else if (ch === ",") region.add(p);
  }));
  s = Go.setup(s, list); s.turn = Go.BLACK;
  let view = null;
  if (pr.kind === "ld") {
    let x0 = 9, y0 = 9, x1 = 0, y1 = 0;
    pr.diagram.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== ".") { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
    view = { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 };
  }
  return { s, region, view };
}
function solved() { return store("probs") || {}; }
function renderTrain() {
  const done = solved(), cat = (document.querySelector("#probCats .active") || {}).dataset?.pc || "all";
  $("probGrid").innerHTML = PROBLEMS.map((pr, i) => {
    if (cat !== "all" && pr.kind !== cat) return "";
    const { s } = problemSetup(pr);
    return `<button class="prob-card ${done[pr.id] ? "done" : ""}" data-prob="${i}">${miniBoard(9, s.b, { view: problemSetup(pr).view })}<div><b>${esc(pr.title)}</b><span>${pr.kind === "ld" ? (pr.goal === "kill" ? "Matar" : "Vivir") : "Capturar"} · ${"★".repeat(pr.level)}${done[pr.id] ? " · ✔" : ""}</span></div></button>`;
  }).join("");
  const n = Object.keys(done).filter(k => PROBLEMS.some(p => p.id === k)).length;
  $("probScore").textContent = `${n} de ${PROBLEMS.length} resueltos`;
  $("probScore").classList.toggle("ok", n === PROBLEMS.length);
  errorItems().then(list => { $("errCount").textContent = list.length; });
  renderMarkCount();
}

// ---------------------------------------------------------------- problemas incluidos
function startProblem(i) {
  const pr = PROBLEMS[i];
  const { s, region, view } = problemSetup(pr);
  P = { pr, i, start: s, target: Go.pt(s, pr.target[0], pr.target[1]), region, view, correct: 0, done: false, failed: false, busy: false, hinted: false };
  openOverlay({
    state: s, region: pr.kind === "ld" ? region : null, view, title: "🧩 " + pr.title, komi: 0, status: pr.text,
    allowPass: pr.kind === "ld", blackName: "Tú", whiteName: "CPU",
    onClick: (x, y) => probClick(x, y), onPass: () => probPlay(Go.PASS), onHint: probHint
  });
  probBox(pr.text);
}
function probBox(msg, kind) {
  const box = $("probBox"), pr = P.pr;
  box.hidden = false;
  box.style.borderColor = kind === "bad" ? "var(--danger)" : kind === "ok" ? "var(--accent)" : "";
  const nextI = P.i != null ? (P.i + 1) % PROBLEMS.length : null;
  box.innerHTML = `<div class="retry-head">🧩 ${esc(pr.title)} ${pr.level ? "· " + "★".repeat(pr.level) : ""}</div><div class="retry-msg">${msg}</div>
    ${P.done && pr.explain ? `<div class="small" style="margin-top:6px">${esc(pr.explain)}</div>` : ""}
    <div class="controls">
      ${P.done || P.failed ? '<button class="sm-btn" data-pb="retry">↺ Otra vez</button>' : '<button class="sm-btn info-btn" data-pb="hint">💡 Pista</button>'}
      <button class="sm-btn" data-pb="sol">👁 Ver solución</button>
      ${nextI != null ? '<button class="sm-btn primary" data-pb="next">Siguiente ▶</button>' : P.file ? '<button class="sm-btn primary" data-pb="fnext">Siguiente ▶</button>' : ""}
      <button class="sm-btn danger" data-pb="end">✖ Terminar</button>
    </div>`;
  box.querySelectorAll("[data-pb]").forEach(b => b.onclick = () => {
    const a = b.dataset.pb;
    if (a === "retry") P.file ? startFileProblem(P.fi) : startProblem(P.i);
    if (a === "hint") probHint();
    if (a === "sol") probSolution();
    if (a === "next") startProblem(nextI);
    if (a === "fnext") startFileProblem((P.fi + 1) % P.file.length);
    if (a === "end") { closeOverlay(); P = null; }
  });
}
function probClick(x, y) {
  if (!P || P.busy || P.done || P.failed) return;
  const st = S.overlay.state, p = Go.pt(st, x, y);
  if (P.file) return fileProbClick(x, y);
  if (P.pr.kind === "ld" && !P.region.has(p)) { flashStatus("Juega dentro de la zona marcada en azul (o pasa)."); return; }
  const r = Go.play(st, p);
  if (r.error) { flashStatus(KO_MSG[r.error]); return; }
  probPlay(p);
}
function name9(p) { return p === Go.PASS ? "pasar" : Go.moveName(P.start, p); }
function probPlay(p) {
  const pr = P.pr, ov = S.overlay;
  const r = Go.play(ov.state, p);
  if (r.error) return;
  ov.state = r.state; ov.last = p; S.hint = null;
  if (p !== Go.PASS) clack();
  P.busy = true; ov.locked = true;
  renderBoard(); renderBars();
  probBox("Comprobando…");
  setTimeout(() => { try { probJudge(r.state); } finally { P.busy = false; if (S.overlay) S.overlay.locked = P.done || P.failed; renderBoard(); } }, 30);
}
function probJudge(st) {
  const pr = P.pr, T = P.target;
  if (pr.kind === "cap") {
    if (st.b[T] !== Go.WHITE) return probSuccess("✔ ¡Capturadas!");
    const d = Go.readCapture(st, T);
    if (!d.captured) {
      const esc1 = d.move;
      if (esc1 != null && esc1 !== Go.PASS) cpuProbMove(esc1);
      return probFail(`✗ No funciona: las blancas escapan${esc1 != null && esc1 !== Go.PASS ? " con " + name9(esc1) : ""}.`);
    }
    P.correct++;
    if (P.correct >= 4) return probSuccess("✔ Correcto: las blancas ya no pueden escapar.");
    const m = resistantCapture(st, T);
    cpuProbMove(m);
    if (S.overlay.state.b[T] !== Go.WHITE) return probSuccess("✔ ¡Capturadas!");
    probBox(`Bien. Las blancas responden ${name9(m)}. Sigue.`);
    return;
  }
  // vida y muerte
  const kill = pr.goal === "kill";
  if (kill && st.b[T] !== Go.WHITE) return probSuccess("✔ ¡Capturado: el grupo blanco ha muerto!");
  if (!kill && st.b[T] !== Go.BLACK) return probFail("✗ Tu grupo ha caído.");
  if (!kill && Go.benson(st, Go.BLACK).has(T)) return probSuccess("✔ ¡Vivo! Tienes dos ojos que nadie puede quitarte.");
  const res = Go.solveLD(st, { target: T, region: P.region });
  if (res.win) {
    const m = res.moves.find(x => x !== Go.PASS) ?? res.moves[0];
    cpuProbMove(m);
    return probFail(kill ? `✗ No: las blancas viven con ${name9(m)}.` : `✗ No: las blancas matan con ${name9(m)}.`);
  }
  P.correct++;
  if ((kill && P.correct >= 2) || (!kill && P.correct >= 3)) return probSuccess(kill ? "✔ Correcto: el grupo blanco ya no puede hacer dos ojos." : "✔ Correcto: tu grupo vive.");
  const m = resistantLD(st);
  cpuProbMove(m);
  const s2 = S.overlay.state;
  if (kill && s2.b[T] !== Go.WHITE) return probSuccess("✔ ¡Capturado!");
  probBox(m === Go.PASS ? "Las blancas no tienen nada mejor y pasan. Sigue." : `Bien. Las blancas responden ${name9(m)}. Sigue.`);
}
function cpuProbMove(m) {
  const ov = S.overlay;
  if (m == null) return;
  const r = Go.play(ov.state, m);
  if (r.error) return;
  ov.state = r.state; ov.last = m;
  renderBoard(); renderBars();
}
// La defensa que más aguanta: la que deja al atacante con menos jugadas ganadoras
function resistantLD(st) {
  const cands = [...P.region].filter(p => st.b[p] === Go.EMPTY && !Go.play(st, p).error);
  let best = Go.PASS, bestN = Infinity;
  for (const m of cands.concat([Go.PASS])) {
    const r = Go.play(st, m);
    if (r.error) continue;
    const res = Go.solveLD(r.state, { target: P.target, region: P.region });
    const n = res.win ? res.moves.length : 0;
    if (n < bestN || (n === bestN && best === Go.PASS && m !== Go.PASS)) { bestN = n; best = m; }
  }
  return best;
}
function resistantCapture(st, T) {
  const g = Go.group(st, T), cands = new Set(g.libs);
  for (const h of Go.adjacentChains(st, T)) if (h.libs.size <= 2) for (const l of h.libs) cands.add(l);
  let best = Go.PASS, bl = -1;
  for (const m of cands) {
    const r = Go.play(st, m);
    if (r.error || r.state.b[T] !== Go.WHITE) continue;
    const l = Go.group(r.state, T).libs.size * 10 + r.captured.length;
    if (l > bl) { bl = l; best = m; }
  }
  return best;
}
function probSuccess(msg) {
  P.done = true;
  if (!P.file && !P.hinted) { const d = solved(); d[P.pr.id] = (d[P.pr.id] || 0) + 1; store("probs", d); }
  probBox(msg, "ok");
  if (activeTab() === "train") renderTrain();
}
function probFail(msg) { P.failed = true; probBox(msg + " Pulsa «↺ Otra vez» para repetir.", "bad"); }
function probSolutions() {
  const pr = P.pr, s = P.start;
  if (pr.kind === "ld") return Go.solveLD(s, { target: P.target, region: P.region }).moves.filter(m => m !== Go.PASS);
  const out = [];
  for (const p of Go.points(s)) {
    if (s.b[p] !== Go.EMPTY) continue;
    const [x, y] = Go.xy(s, p);
    if (Math.abs(x - pr.target[0]) + Math.abs(y - pr.target[1]) > 4) continue;
    const r = Go.play(s, p);
    if (r.error) continue;
    if (r.state.b[P.target] !== Go.WHITE || Go.readCapture(r.state, P.target).captured) out.push(p);
  }
  return out;
}
function probHint() {
  if (!P || P.file) { if (P && P.file) fileProbHint(); return; }
  P.hinted = true;
  const sols = probSolutions();
  if (!sols.length) return;
  // pista: la zona, no el punto exacto
  const [x, y] = Go.xy(P.start, sols[0]);
  toast(P.pr.kind === "ld" ? "Pista: busca el punto que toca a más puntos del espacio de ojos." : `Pista: la jugada está cerca de ${Go.LETTERS[x]}${9 - y}… ¿atari o red?`);
}
function probSolution() {
  if (P.file) return fileProbSolution();
  P.hinted = true;
  const sols = probSolutions();
  S.overlay.state = P.start; S.overlay.last = -1;
  S.overlay.marks = { CR: sols.map(p => Go.xy(P.start, p)) };
  P.failed = true; S.overlay.locked = true;
  renderBoard();
  probBox(`Solución: ${sols.map(name9).join(", ")}.`);
  if (P.pr.explain) $("probBox").querySelector(".retry-msg").insertAdjacentHTML("beforeend", `<div class="small" style="margin-top:6px">${esc(P.pr.explain)}</div>`);
}

// ---------------------------------------------------------------- problemas en SGF
let fileProblems = [];
async function openProblemFiles(files) {
  fileProblems = [];
  for (const f of files) {
    const text = Sgf.decodeBytes(await f.arrayBuffer());
    for (const r of Sgf.parse(text)) if (r.game.root.children.length) fileProblems.push(r.game);
  }
  $("probFileInfo").textContent = fileProblems.length ? `${fileProblems.length} problemas en ${files.length === 1 ? files[0].name : files.length + " ficheros"}` : "No hay problemas en el fichero";
  if (fileProblems.length) startFileProblem(0);
}
const RIGHT_RE = /\b(RIGHT|CORRECT|CORRECTO|BIEN|SOLUCI[OÓ]N)\b|✔/i;
function startFileProblem(i) {
  const g = fileProblems[i];
  let anyMark = false;
  Sgf.walk(g.root, n => { if (RIGHT_RE.test(n.comment || "") || n.nag === "!" || n.nag === "!!") anyMark = true; });
  const correct = new Set();
  if (anyMark) Sgf.walk(g.root, n => { if (RIGHT_RE.test(n.comment || "") || n.nag === "!" || n.nag === "!!") for (let x = n; x; x = x.parent) correct.add(x); });
  else Sgf.mainline(g.root).forEach(n => correct.add(n));
  const s = Sgf.stateAt(g, g.root);
  const first = g.root.children[0] && g.root.children[0].move;
  if (first) s.turn = first.c;
  // vista: el rectángulo de las piedras
  let x0 = g.size, y0 = g.size, x1 = 0, y1 = 0;
  Sgf.walk(g.root, n => {
    const pts = [].concat(n.setup ? n.setup.AB.concat(n.setup.AW) : [], n.move && n.move.x >= 0 ? [[n.move.x, n.move.y]] : []);
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  });
  const view = x0 <= x1 ? { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 } : null;
  P = { file: fileProblems, fi: i, game: g, node: g.root, correct, done: false, failed: false, busy: false, start: s,
    pr: { title: `Problema ${i + 1} de ${fileProblems.length}`, explain: "" } };
  openOverlay({ state: s, view, title: "🧩 " + (g.headers.GN || P.pr.title), komi: 0, status: "", onClick: (x, y) => fileProbClick(x, y), onHint: fileProbHint, blackName: s.turn === 1 ? "Tú" : "Rival", whiteName: s.turn === 2 ? "Tú" : "Rival" });
  probBox((g.root.comment ? esc(g.root.comment) + "<br>" : "") + `Juegan ${COLOR_NAME[s.turn].toLowerCase()}.`);
}
function fileProbClick(x, y) {
  if (P.done || P.failed) return;
  const ov = S.overlay, st = ov.state;
  const r = Go.play(st, Go.pt(st, x, y));
  if (r.error) { flashStatus(KO_MSG[r.error]); return; }
  const child = P.node.children.find(c => c.move && c.move.x === x && c.move.y === y);
  ov.state = r.state; ov.last = Go.pt(st, x, y); clack();
  renderBoard(); renderBars();
  if (!child) { P.failed = true; probBox("✗ Esa jugada no está en la solución del fichero.", "bad"); return; }
  if (!P.correct.has(child)) { P.failed = true; probBox("✗ " + (child.comment ? esc(child.comment) : "Esa no es la solución."), "bad"); return; }
  P.node = child;
  if (!child.children.length) return fileOk(child);
  // respuesta del rival: la primera de sus ramas que sigue en la solución
  const reply = child.children.find(c => P.correct.has(c)) || child.children[0];
  setTimeout(() => {
    const st2 = S.overlay.state;
    if (reply.move && reply.move.x >= 0) { const p = Go.pt(st2, reply.move.x, reply.move.y), rr = Go.play(st2, p); if (!rr.error) { S.overlay.state = rr.state; S.overlay.last = p; } }
    P.node = reply;
    renderBoard(); renderBars();
    if (!reply.children.length) return fileOk(reply);
    probBox("Bien. " + (reply.comment ? esc(reply.comment) : "Sigue."));
  }, 350);
}
function fileOk(n) { P.done = true; probBox("✔ " + (n.comment ? esc(n.comment) : "¡Resuelto!"), "ok"); }
function fileProbHint() {
  const c = P.node.children.find(x => P.correct.has(x));
  if (c && c.move && c.move.x >= 0) { S.hint = Go.pt(S.overlay.state, c.move.x, c.move.y); renderBoard(); }
}
function fileProbSolution() {
  const line = [];
  for (let n = P.node; ;) { const c = n.children.find(x => P.correct.has(x)); if (!c) break; line.push(c); n = c; }
  probBox("Solución: " + line.map(n => n.move && n.move.x >= 0 ? Go.gtp(P.game.size, n.move.x, n.move.y) : "pasa").join(" "));
  P.failed = true;
}

// ---------------------------------------------------------------- errores de tus partidas
async function errorItems() {
  const me = (store("myName") || "").toLowerCase(), only = $("errOnlyMine").checked;
  const out = [];
  for (const rec of await libGames()) {
    if (!rec.analysed) continue;
    const myColor = (rec.pb || "").toLowerCase() === me ? 1 : (rec.pw || "").toLowerCase() === me ? 2 : 0;
    if (only && !myColor) continue;
    const g = Sgf.fromJSON(rec.data);
    for (const n of Sgf.mainline(g.root)) {
      if (!n.move || n.move.x < 0 || !(n.nag === "?" || n.nag === "??") || !n.eval || !n.parent.eval) continue;
      if (only && n.move.c !== myColor) continue;
      out.push({ rec, path: pathOf(n.parent), played: [n.move.x, n.move.y], nag: n.nag, eval: n.parent.eval, komi: parseFloat(g.headers.KM) || 0 });
    }
  }
  return out;
}
let errSession = null;
async function startErrTraining() {
  const list = await errorItems();
  if (!list.length) { toast("No hay errores: analiza antes partidas de tu biblioteca"); return; }
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  errSession = { list, i: 0, ok: 0 };
  showErr();
}
function showErr() {
  const it = errSession.list[errSession.i];
  const g = Sgf.fromJSON(it.rec.data), node = nodeAt(g, it.path), s = Sgf.stateAt(g, node);
  openOverlay({ state: s, last: node.move && node.move.x >= 0 ? Go.pt(s, node.move.x, node.move.y) : -1, title: "❌ " + it.rec.title, komi: it.komi,
    status: `Juegan ${COLOR_NAME[s.turn].toLowerCase()}. En la partida se jugó ${Go.gtp(s.n, it.played[0], it.played[1])} ${it.nag}: busca algo mejor.`,
    onClick: (x, y) => answerByEngine(s, x, y, it.eval, ok => { if (ok) errSession.ok++; feedback(ok); }) });
  feedback(null);
  function feedback(ok) {
    const fb = $("trainFeedback"); fb.hidden = false;
    fb.innerHTML = `<b>❌ Error ${errSession.i + 1} de ${errSession.list.length}</b> · aciertos ${errSession.ok}<br>${ok == null ? "¿Qué jugarías?" : (ok ? "✔ ¡Bien! " : "✗ No es la mejor. ") + esc(S.overlay.lastMsg || "")}
      <div class="controls"><button class="sm-btn info-btn" data-e="best">💡 Ver la mejor</button><button class="sm-btn" data-e="open">↗ Abrir la partida</button>${errSession.i + 1 < errSession.list.length ? '<button class="sm-btn primary" data-e="next">Siguiente ▶</button>' : ""}</div>`;
    fb.querySelectorAll("[data-e]").forEach(b => b.onclick = () => {
      if (b.dataset.e === "best") { const best = it.eval.best; if (best && best[0] >= 0) { S.hint = Go.pt(S.overlay.state, best[0], best[1]); renderBoard(); toast("Mejor: " + Go.gtp(s.n, best[0], best[1])); } }
      if (b.dataset.e === "next") { errSession.i++; showErr(); }
      if (b.dataset.e === "open") { closeOverlay(); openLibGame(it.rec.id, it.path); }
    });
  }
}

// ---------------------------------------------------------------- tarjetas
let cardSession = null;
async function startCards(all) {
  const marks = (await libMarks()).filter(m => m.train && (all || !m.srs || m.srs.due <= Date.now()));
  if (!marks.length) { toast(all ? "No hay tarjetas: marca posiciones con 📌" : "No hay tarjetas pendientes hoy"); return; }
  marks.sort((a, b) => (a.srs ? a.srs.due : 0) - (b.srs ? b.srs.due : 0));
  cardSession = { list: marks, i: 0, ok: 0 };
  showCard();
}
function showCard() {
  const m = cardSession.list[cardSession.i];
  const s = stateFromString(m.size, m.board, m.turn, m.ko, m.cap);
  openOverlay({ state: s, title: "🧠 " + m.cat, komi: m.komi || 0, status: `Juegan ${COLOR_NAME[s.turn].toLowerCase()}. ${m.note ? "Nota: " + m.note : ""}`,
    onClick: (x, y) => answerByEngine(s, x, y, null, async ok => {
      m.srs = m.srs || { step: 0, due: 0 };
      if (ok) { m.srs.due = Date.now() + SRS_DAYS[Math.min(m.srs.step, SRS_DAYS.length - 1)] * 864e5; m.srs.step++; cardSession.ok++; }
      else { m.srs.step = 0; m.srs.due = Date.now() + 10 * 60e3; }
      await DB.put("marks", m); markCache = null; renderMarkCount();
      fb(ok);
    }, { expected: m.next }) });
  fb(null);
  function fb(ok) {
    const el = $("trainFeedback"); el.hidden = false;
    el.innerHTML = `<b>🧠 Tarjeta ${cardSession.i + 1} de ${cardSession.list.length}</b> · aciertos ${cardSession.ok}<br>${ok == null ? "Encuentra la jugada." : (ok ? "✔ ¡Bien! Vuelve dentro de " + SRS_DAYS[Math.min(m.srs.step - 1, SRS_DAYS.length - 1)] + " días. " : "✗ Vuelve dentro de un rato. ") + esc(S.overlay.lastMsg || "")}
      <div class="controls">${m.next ? '<button class="sm-btn info-btn" data-c="show">💡 Jugada de la partida</button>' : ""}${cardSession.i + 1 < cardSession.list.length ? '<button class="sm-btn primary" data-c="next">Siguiente ▶</button>' : ""}${m.gameId ? '<button class="sm-btn" data-c="open">↗ Abrir la partida</button>' : ""}</div>`;
    el.querySelectorAll("[data-c]").forEach(b => b.onclick = () => {
      if (b.dataset.c === "show") { S.hint = Go.pt(S.overlay.state, m.next[0], m.next[1]); renderBoard(); }
      if (b.dataset.c === "next") { cardSession.i++; showCard(); }
      if (b.dataset.c === "open") { closeOverlay(); openLibGame(m.gameId, m.path); }
    });
  }
}

// ---------------------------------------------------------------- ¿quién gana? (contar)
let countQuiz = { n: 0, ok: 0, cur: null };
async function newCountQuiz() {
  $("countQuizBtn").disabled = true;
  $("cqMsg").textContent = "La CPU está jugando una partida de 9×9…";
  $("countQuizBox").hidden = false;
  const res = await EngineHost.selfplay({ n: 9, komi: 6.5, playouts: 260, maxMoves: 120, seed: Date.now() & 0xffff });
  $("countQuizBtn").disabled = false;
  const s = Go.create(9); s.b.set(res.b); s.turn = res.turn; s.cap = res.cap.slice();
  const dead = new Set(res.dead);
  const sc = Go.score(s, { dead, rules: "japanese", komi: 6.5 });
  countQuiz.cur = { s, dead, sc };
  openOverlay({ state: s, title: "🎲 ¿Quién gana?", komi: 6.5, locked: true, status: `Capturas: negras ${s.cap[1]}, blancas ${s.cap[2]}. Reglas japonesas, komi 6,5. Cuenta y responde en 🧮 Recuento.`, blackName: "Negras", whiteName: "Blancas" });
  setTab("score");
  $("cqMsg").textContent = `Capturas: negras ${s.cap[1]}, blancas ${s.cap[2]}. Las piedras claramente muertas cuentan como prisioneras.`;
  $("cqBy").value = "";
}
function checkCountQuiz() {
  const q = countQuiz.cur; if (!q || !S.overlay) return;
  const who = $("cqWho").value, by = parseFloat($("cqBy").value.replace(",", "."));
  const real = q.sc.diff, realWho = real > 0 ? "B" : "W";
  const ok = who === realWho && isFinite(by) && Math.abs(by - Math.abs(real)) <= 1;
  countQuiz.n++; if (ok) countQuiz.ok++;
  $("countQuizScore").textContent = `${countQuiz.ok} / ${countQuiz.n}`;
  $("cqMsg").innerHTML = `${ok ? "✔ ¡Bien!" : "✗ No del todo."} Ganan <b>${realWho === "B" ? "negras" : "blancas"}</b> por <b>${num1(Math.abs(real))}</b>: territorio ${q.sc.terr[1]} + ${q.sc.prisoners[1]} prisioneros contra ${q.sc.terr[2]} + ${q.sc.prisoners[2]} + 6,5 de komi.`;
  S.overlay.owner = q.sc.owner; S.overlay.dead = q.dead;
  renderBoard();
}

function bindTrain() {
  $("probGrid").addEventListener("click", ev => { const b = ev.target.closest("[data-prob]"); if (b) startProblem(+b.dataset.prob); });
  $("probCats").addEventListener("click", ev => {
    const b = ev.target.closest("[data-pc]"); if (!b) return;
    document.querySelectorAll("#probCats [data-pc]").forEach(x => x.classList.toggle("active", x === b));
    renderTrain();
  });
  $("openProbFileBtn").onclick = () => $("probFileInput").click();
  $("probFileInput").onchange = ev => { if (ev.target.files.length) openProblemFiles([...ev.target.files]); ev.target.value = ""; };
  $("errTrainBtn").onclick = startErrTraining;
  $("errOnlyMine").onchange = renderTrain;
  $("cardsDueBtn").onclick = () => startCards(false);
  $("cardsAllBtn").onclick = () => startCards(true);
  $("countQuizBtn").onclick = newCountQuiz;
  $("cqCheckBtn").onclick = checkCountQuiz;
}

// ---------------------------------------------------------------- arranque
async function init() {
  bindUi(); bindPlay(); bindLibrary(); bindTrain();
  renderOpeningsStatic();
  EngineHost.start();
  let loaded = await loadFromHash();
  if (!loaded && settings.autosave) {
    const c = store("current");
    if (c && c.game) {
      try { loadGame(Sgf.fromJSON(c.game), { path: c.path, libId: c.libId, title: c.title, tags: (c.tags || "").split(",").map(t => t.trim()).filter(Boolean), fav: c.fav }); loaded = true; }
      catch (e) { /* partida guardada dañada: se empieza de cero */ }
    }
  }
  if (!loaded) loadGame(Sgf.newGame(19, { rules: settings.rules, DT: today() }));
  renderMarkCount();
  if (location.protocol.startsWith("http") && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  document.body.dataset.ready = "1";
}
