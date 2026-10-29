/* GoBase · jugar contra la CPU (niveles, hándicap, reloj con byo-yomi, pasar y rendirse) y recuento final */

const CPU_PLAYOUTS = [0, 120, 350, 900, 2000, 4000, 8000, 15000, 30000];
const CPU_TIME = [0, 600, 1200, 2500, 4000, 6000, 9000, 13000, 20000];

function startCpuFromModal() {
  const size = +$("cpuSize").value, ha = +$("cpuHandicap").value;
  let color = +$("cpuColor").value;
  if (!color) color = Math.random() < 0.5 ? 1 : 2;
  const km = parseFloat($("cpuKomi").value.replace(",", ".")) || 0;
  const level = +$("cpuLevel").value;
  const g = Sgf.newGame(size, { komi: km, handicap: ha, rules: $("cpuRules").value, DT: today(),
    PB: color === 1 ? "Tú" : "CPU nivel " + level, PW: color === 2 ? "Tú" : "CPU nivel " + level });
  closeModal("cpuModal");
  loadGame(g, { title: `Contra la CPU (${size}×${size}, nivel ${level})`, tags: ["contra la CPU"] });
  const main = +$("cpuMain").value * 60, byo = +$("cpuByo").value;
  S.cpu = {
    cpuColor: Go.other(color), userColor: color, level, thinking: false, over: false,
    clock: main ? { main: { 1: main, 2: main }, byo, periods: { 1: byo === 60 ? 5 : 3, 2: byo === 60 ? 5 : 3 }, inByo: { 1: false, 2: false }, left: { 1: byo, 2: byo }, running: 0, last: 0 } : null
  };
  S.mode = "cpu";
  setLive(false);
  renderCpuBox();
  startClock();
  cpuAfterPosition();
}
function renderCpuBox() {
  const box = $("cpuBox"), c = S.cpu;
  if (!c) { box.hidden = true; return; }
  box.hidden = false;
  const s = curState();
  const yourTurn = s.turn === c.userColor && !c.over;
  let msg = c.over ? `🏁 ${esc(c.result || "Partida terminada")}` : c.thinking ? "🤖 La CPU piensa…" : yourTurn ? "Te toca: juega o pasa." : "";
  box.innerHTML = `<div class="retry-head">🤖 Contra la CPU · nivel ${c.level} · juegas con ${c.userColor === 1 ? "⚫ negras" : "⚪ blancas"}</div>
    <div>${msg}</div>
    <div class="controls">
      ${c.over ? "" : `<button class="sm-btn" data-c="pass" ${yourTurn ? "" : "disabled"}>✋ Pasar</button>
      <button class="sm-btn danger" data-c="resign">🏳 Rendirse</button>
      <button class="sm-btn" data-c="undo" ${c.clock || !yourTurn ? "disabled" : ""} title="Sólo sin reloj">↶ Deshacer</button>`}
      <button class="sm-btn info-btn" data-c="again">🔁 Revancha</button>
      <button class="sm-btn" data-c="leave">✖ Dejar de jugar</button>
    </div>`;
  box.querySelectorAll("[data-c]").forEach(b => b.onclick = () => {
    const a = b.dataset.c;
    if (a === "pass") cpuUserPass();
    if (a === "resign") finishCpu(Go.other(c.userColor) === 1 ? "B+R" : "W+R", "Te has rendido.");
    if (a === "undo") cpuUndo();
    if (a === "again") openModal("cpuModal");
    if (a === "leave") endCpu(false);
  });
}
function cpuUserClick(x, y) {
  const c = S.cpu;
  if (!c || c.over || c.thinking || curState().turn !== c.userColor) return;
  S.cur = lastNode();
  playMove(x, y);
}
function cpuUserPass() {
  const c = S.cpu;
  if (!c || c.over || c.thinking || curState().turn !== c.userColor) return;
  S.cur = lastNode();
  playMove(-1, -1);
}
function lastNode() { let n = S.cur; while (n.children.length) n = n.children[0]; return n; }
function cpuUndo() {
  const c = S.cpu;
  let n = lastNode(), k = 0;
  while (n.parent && n.move && k < 2) { const p = n.parent; Sgf.cut(n); n = p; k++; if (n.move && n.move.c === c.userColor) continue; }
  // quedarse con el turno del usuario
  while (n.parent && n.move && Sgf.stateAt(S.game, n).turn !== c.userColor) { const p = n.parent; Sgf.cut(n); n = p; }
  S.cur = n; markDirty(); onPosition();
}
function bothPassed(n) { return n.move && n.move.x < 0 && n.parent && n.parent.move && n.parent.move.x < 0; }
function cpuAfterPosition() {
  const c = S.cpu;
  if (!c || c.over) return;
  renderCpuBox();
  if (S.cur !== lastNode()) return;
  if (bothPassed(S.cur)) { endByPasses(); return; }
  switchClock(curState().turn);
  if (curState().turn === c.cpuColor && !c.thinking) cpuMove();
}
async function cpuMove() {
  const c = S.cpu, node = S.cur, s = curState(), n = s.n;
  c.thinking = true; renderCpuBox(); renderBoard();
  const scale = n <= 9 ? 1 : n <= 13 ? 0.6 : 0.35;
  let playouts = Math.max(60, Math.round(CPU_PLAYOUTS[c.level] * scale));
  let timeMs = CPU_TIME[c.level];
  if (c.clock) { const left = clockLeft(c.cpuColor); timeMs = Math.min(timeMs, Math.max(400, left * 1000 / (c.clock.inByo[c.cpuColor] ? 2.2 : 25))); }
  const passAllowed = Sgf.moveNumber(node) > n * n * 0.35 || (node.move && node.move.x < 0);
  const t0 = Date.now();
  const res = await EngineHost.analyze(s, { komi: komi(), playouts, timeMs, interval: 1e6, multi: 8, passAllowed, forbidden: superkoForbidden(s, node) });
  // pausa mínima para que se vea que piensa
  const wait = 350 - (Date.now() - t0);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  if (S.cpu !== c || c.over || S.cur !== node) { c.thinking = false; return; }
  c.thinking = false;
  const myWr = c.cpuColor === 1 ? res.winrateBlack : 1 - res.winrateBlack;
  const myLead = c.cpuColor === 1 ? res.scoreLead : -res.scoreLead;
  const moveNo = Sgf.moveNumber(node);
  // rendirse si va claramente perdida
  if (moveNo > n * n * 0.3 && myWr < 0.04 && myLead < -Math.max(10, n)) {
    finishCpu(c.userColor === 1 ? "B+R" : "W+R", "La CPU se rinde.");
    return;
  }
  let p = res.best;
  // el rival pasó y la CPU va ganando: pasa también
  if (node.move && node.move.x < 0 && myLead > 0) p = Go.PASS;
  // todas las candidatas caen en zonas ya decididas: pasar
  if (p !== Go.PASS && moveNo > n * n * 0.55) {
    const own = res.ownership;
    const useful = res.moves.slice(0, 5).some(m => m.p >= 0 && Math.abs(own[m.p]) < 0.8);
    if (!useful && myLead > 0) p = Go.PASS;
  }
  // niveles bajos: algo de azar entre las mejores
  if (p !== Go.PASS && c.level <= 3 && res.moves.length > 1) {
    const k = c.level === 1 ? 5 : c.level === 2 ? 3 : 2;
    const cands = res.moves.slice(0, k).filter(m => m.p >= 0 && m.visits > res.moves[0].visits * (c.level === 1 ? 0.05 : 0.2));
    if (cands.length) p = cands[Math.floor(Math.random() * cands.length)].p;
  }
  if (p !== Go.PASS && Go.play(s, p, s.turn, { history: settings.ko === "superko" ? Sgf.historyKeys(S.game, node) : null }).error) p = Go.PASS;
  if (c.clock) spend(c.cpuColor);
  if (p === Go.PASS) { playMove(-1, -1); toast("La CPU pasa"); }
  else { const [x, y] = Go.xy(s, p); playMove(x, y); }
}
async function endByPasses() {
  const c = S.cpu;
  stopClock();
  c.thinking = true; renderCpuBox();
  await enterScore();
  c.thinking = false;
  c.awaitingScore = true;
  const box = $("cpuBox");
  box.hidden = false;
  box.innerHTML = `<div class="retry-head">🧮 Los dos habéis pasado: recuento</div><div>Comprueba las piedras muertas (pulsa un grupo para cambiarlo) y acepta el resultado.</div>
    <div class="controls"><button class="sm-btn primary" data-c="accept">✔ Aceptar el resultado</button><button class="sm-btn" data-c="resume">↩ Seguir jugando</button></div>`;
  box.querySelector('[data-c="accept"]').onclick = () => { const r = S.score.res; exitScore(true); finishCpu(r.result, "Resultado: " + resultText(r.result) + "."); };
  box.querySelector('[data-c="resume"]').onclick = () => { exitScore(true); c.awaitingScore = false; S.cur = lastNode(); startClock(); renderCpuBox(); cpuAfterPosition(); };
}
function finishCpu(re, msg) {
  const c = S.cpu; if (!c) return;
  c.over = true; c.thinking = false; c.result = msg + " " + resultText(re);
  stopClock();
  S.game.headers.RE = re;
  fillHeaders(); markDirty();
  renderCpuBox(); renderAll();
  toast(c.result, 4000);
}
function endCpu(silent) {
  stopClock();
  S.cpu = null;
  if (S.mode === "cpu") S.mode = "normal";
  $("cpuBox").hidden = true;
  $("whiteClock").hidden = true; $("blackClock").hidden = true;
  if (!silent) renderAll();
}

// ---------------------------------------------------------------- reloj (tiempo principal + byo-yomi japonés)
let clockTimer = 0;
function startClock() {
  const c = S.cpu;
  if (!c || !c.clock) { $("whiteClock").hidden = true; $("blackClock").hidden = true; return; }
  $("whiteClock").hidden = false; $("blackClock").hidden = false;
  c.clock.last = Date.now();
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 200);
  renderClocks();
}
function stopClock() { clearInterval(clockTimer); clockTimer = 0; if (S.cpu && S.cpu.clock) S.cpu.clock.running = 0; }
function switchClock(color) {
  const c = S.cpu; if (!c || !c.clock) return;
  const k = c.clock;
  if (k.running && k.running !== color) {
    // al terminar una jugada en byo-yomi se repone el periodo
    if (k.inByo[k.running]) k.left[k.running] = k.byo;
  }
  k.running = color; k.last = Date.now();
  renderClocks();
}
function spend() { /* el tiempo se descuenta en tickClock */ }
function clockLeft(color) { const k = S.cpu.clock; return k.inByo[color] ? k.left[color] : k.main[color]; }
function tickClock() {
  const c = S.cpu; if (!c || !c.clock || c.over || c.awaitingScore) return;
  const k = c.clock, col = k.running;
  if (!col) return;
  const now = Date.now(), dt = (now - k.last) / 1000; k.last = now;
  if (!k.inByo[col]) {
    k.main[col] -= dt;
    if (k.main[col] <= 0) { const over = -k.main[col]; k.main[col] = 0; k.inByo[col] = true; k.left[col] = k.byo - over; if (!k.byo) return timeLoss(col); }
  } else {
    k.left[col] -= dt;
    if (k.left[col] <= 0) {
      k.periods[col]--;
      if (k.periods[col] <= 0 || !k.byo) return timeLoss(col);
      k.left[col] += k.byo;
    }
  }
  renderClocks();
}
function timeLoss(col) { finishCpu(col === 1 ? "W+T" : "B+T", col === S.cpu.userColor ? "Se te ha acabado el tiempo." : "A la CPU se le ha acabado el tiempo."); }
function fmtClock(sec) { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
function renderClocks() {
  const c = S.cpu; if (!c || !c.clock) return;
  const k = c.clock;
  for (const [col, id] of [[1, "blackClock"], [2, "whiteClock"]]) {
    const el = $(id);
    el.textContent = k.inByo[col] ? `${fmtClock(k.left[col])} (${k.periods[col]})` : fmtClock(k.main[col]);
    el.classList.toggle("running", k.running === col && !c.over);
    el.classList.toggle("low", k.inByo[col] && k.left[col] < 10);
  }
}

// ---------------------------------------------------------------- recuento
async function enterScore() {
  if (S.overlay) closeOverlay();
  if (S.mode === "edit") exitEdit();
  const s = curState();
  S.mode = S.cpu ? "cpu" : "score";
  document.body.classList.add("scoring");
  $("scoreBox").hidden = false;
  $("statusText").textContent = "🤖 El motor busca las piedras muertas…";
  setLive(false);
  const d = await EngineHost.dead(s, playoutsFor(s.n, 0.6));
  S.score = { dead: new Set(d.dead), res: null, state: s };
  S.mode = "score";
  recount();
  setTab("score");
}
function recount() {
  const sc = S.score;
  const rules = $("scRules").value, km = parseFloat(String($("scKomi").value).replace(",", ".")) || 0;
  sc.res = Go.score(sc.state, { dead: sc.dead, rules, komi: km });
  const r = sc.res;
  $("scBT").textContent = r.terr[1]; $("scWT").textContent = r.terr[2];
  $("scBP").textContent = r.prisoners[1]; $("scWP").textContent = r.prisoners[2];
  $("scBS").textContent = r.stones[1]; $("scWS").textContent = r.stones[2];
  $("scPrisRow").hidden = rules === "chinese"; $("scStonesRow").hidden = rules !== "chinese";
  $("scKm").textContent = num1(km);
  $("scBTot").innerHTML = "<b>" + num1(r.black) + "</b>"; $("scWTot").innerHTML = "<b>" + num1(r.white) + "</b>";
  $("scResult").textContent = r.diff === 0 ? "Empate (jigo)" : (r.diff > 0 ? "Ganan negras por " : "Ganan blancas por ") + num1(Math.abs(r.diff));
  const left = $("scoreBoxLeft");
  left.hidden = false;
  left.innerHTML = `<b>🧮 ${esc($("scResult").textContent)}</b> · ⚫ ${num1(r.black)} · ⚪ ${num1(r.white)} <span class="small">(pulsa un grupo para marcarlo vivo o muerto)</span>`;
  renderBoard(); renderStatus();
}
function scoreClick(x, y) {
  const sc = S.score; if (!sc) return;
  const s = sc.state, p = Go.pt(s, x, y);
  if (s.b[p] !== Go.BLACK && s.b[p] !== Go.WHITE) return;
  const g = Go.group(s, p);
  const dead = !sc.dead.has(p);
  // también las cadenas del mismo color unidas por puntos vacíos que no tocan al rival vivo
  for (const q of g.stones) dead ? sc.dead.add(q) : sc.dead.delete(q);
  recount();
}
function exitScore(silent) {
  if (!S.score && S.mode !== "score") return;
  S.score = null;
  document.body.classList.remove("scoring");
  $("scoreBox").hidden = true; $("scoreBoxLeft").hidden = true;
  if (S.mode === "score") S.mode = S.cpu ? "cpu" : "normal";
  if (!silent) renderAll();
}
function bindPlay() {
  $("playCpuToggle").onclick = () => { $("cpuRules").value = settings.rules; openModal("cpuModal"); };
  $("cpuHandicap").onchange = () => { $("cpuKomi").value = +$("cpuHandicap").value ? "0.5" : "6.5"; };
  $("cpuStartBtn").onclick = startCpuFromModal;
  $("cpuMain").onchange = () => { $("cpuByo").disabled = $("cpuMain").value === "0"; };
  $("cpuByo").disabled = $("cpuMain").value === "0";
  $("scoreBtn").onclick = () => { if (S.mode === "score") exitScore(); else enterScore(); };
  $("scAutoBtn").onclick = async () => { if (!S.score) return; const d = await EngineHost.dead(S.score.state, playoutsFor(S.game.size, 0.8)); S.score.dead = new Set(d.dead); recount(); };
  $("scRules").onchange = () => { if (S.score) recount(); };
  $("scKomi").onchange = () => { if (S.score) recount(); };
  $("scSetResultBtn").onclick = () => {
    if (!S.score) return;
    S.game.headers.RE = S.score.res.result;
    S.game.headers.KM = String(parseFloat(String($("scKomi").value).replace(",", ".")) || 0);
    S.game.headers.RU = $("scRules").value === "chinese" ? "Chinese" : "Japanese";
    fillHeaders(); markDirty(); renderBars(); toast("Resultado: " + resultText(S.score.res.result));
  };
  $("scExitBtn").onclick = () => exitScore();
}
