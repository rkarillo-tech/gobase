/* GoBase · interfaz: tablero, árbol de jugadas, estudio, motor, análisis e informe, editor, marcas y exportación */

const $ = id => document.getElementById(id);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = x => (Math.round(x * 1000) / 10).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
const num1 = x => (Math.round(x * 10) / 10).toLocaleString("es-ES", { maximumFractionDigits: 1 });
const COLOR_NAME = { 1: "Negras", 2: "Blancas" };
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}
function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem("gobase." + key)); localStorage.setItem("gobase." + key, JSON.stringify(val)); } catch (e) { return null; } }

// ---------------------------------------------------------------- ajustes
const DEFAULTS = { theme: "wood", style: "real", sound: true, coords: true, last: true, ghost: true, autosave: true, wheel: true, varHints: true,
  analysis: 2, multi: 5, rules: "japanese", ko: "superko", cand: true, own: false, numbers: false, sgfEngine: true, branch: "variation" };
const settings = Object.assign({}, DEFAULTS, store("settings") || {});
function saveSettings() { store("settings", settings); }

// ---------------------------------------------------------------- estado
const S = {
  game: Sgf.newGame(19), cur: null,
  libId: null, fav: false, dirty: false,
  mode: "normal",           // normal | edit | score | cpu
  overlay: null,            // posición temporal (problemas, repasos): { state, last, region, view, onClick, title }
  engine: null,             // último resultado del motor para la posición actual
  live: false, markTool: null, edTool: 1,
  analysing: false, cpu: null, score: null, coll: [], hover: null, autoplay: 0
};
S.cur = S.game.root;

const komi = () => { const k = parseFloat(String(S.game.headers.KM || "0").replace(",", ".")); return isFinite(k) ? k : 0; };
const rulesOf = g => /chin|aga|area|nz/i.test(g.headers.RU || "") ? "chinese" : "japanese";
const curState = () => Sgf.stateAt(S.game, S.cur);
const shownState = () => S.overlay ? S.overlay.state : curState();

// ---------------------------------------------------------------- motor (Worker)
const EngineHost = (() => {
  let worker = null, nextId = 1, local = null;
  const handlers = new Map();
  function onMessage(m) { const h = handlers.get(m.id); if (h) { h(m); if (m.type === "done") handlers.delete(m.id); } }
  function start() {
    try {
      const blob = new Blob([ENGINE_SRC], { type: "text/javascript" });
      worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = e => onMessage(e.data);
      worker.onerror = () => { worker = null; startLocal(); };
    } catch (e) { startLocal(); }
  }
  function startLocal() {
    if (local) return;
    // Sin Worker (algunas vistas previas): el mismo código corre en el hilo principal, a trozos
    const fakeSelf = {};
    local = new Function("self", "window", ENGINE_SRC + "\nreturn { onMsg, setPost: f => { post = f; } };")(fakeSelf, undefined);
    local.setPost(m => setTimeout(() => onMessage(m), 0));
    $("engineBadge").textContent = "⚙ Motor GoBase (sin Worker)";
  }
  function send(msg) { if (worker) worker.postMessage(msg); else { startLocal(); local.onMsg(msg); } }
  function posMsg(s) { return { n: s.n, b: Array.from(s.b), turn: s.turn, ko: s.ko, cap: s.cap.slice() }; }
  return {
    start,
    stop() { handlers.clear(); send({ cmd: "stop" }); },
    analyze(s, opts, onInfo) {
      const id = nextId++;
      handlers.clear();
      return new Promise(resolve => {
        handlers.set(id, m => { if (m.type === "info") onInfo && onInfo(m.res); else { onInfo && onInfo(m.res); resolve(m.res); } });
        send(Object.assign({ cmd: "analyze", id, pos: posMsg(s) }, opts));
      });
    },
    dead(s, playouts) {
      const id = nextId++;
      handlers.clear();
      return new Promise(resolve => { handlers.set(id, m => resolve(m.res)); send({ cmd: "dead", id, pos: posMsg(s), playouts }); });
    },
    selfplay(opts) {
      const id = nextId++;
      handlers.clear();
      return new Promise(resolve => { handlers.set(id, m => resolve(m.res)); send(Object.assign({ cmd: "selfplay", id }, opts)); });
    },
    get usingWorker() { return !!worker; }
  };
})();

function superkoForbidden(s, node) {
  // jugadas que repetirían una posición anterior (superko posicional)
  if (settings.ko !== "superko") return null;
  const hist = Sgf.historyKeys(S.game, node), out = [];
  let caps = 0;
  for (const p of Go.points(s)) {
    if (s.b[p] !== Go.EMPTY) continue;
    let adjOpp = false;
    for (const q of Go.nbrs(s, p)) if (s.b[q] === Go.other(s.turn)) adjOpp = true;
    if (!adjOpp) continue; // sólo una captura puede repetir una posición
    const r = Go.play(s, p);
    if (!r.error && r.captured.length && hist.has(Go.key(r.state))) { out.push(p); caps++; }
  }
  return out.length ? out : null;
}

function playoutsFor(n, factor = 1) { return Math.round((n <= 9 ? 3000 : n <= 13 ? 2200 : 1600) * factor); }

// ---------------------------------------------------------------- análisis en vivo
let liveTimer = 0;
function restartLive() {
  clearTimeout(liveTimer);
  S.engine = null;
  if (!S.live || S.mode === "edit" || S.mode === "score" || S.analysing || (S.cpu && S.cpu.thinking)) { renderEngine(); return; }
  liveTimer = setTimeout(() => {
    const s = shownState(), node = S.cur;
    if (S.overlay && !S.overlay.allowLive) { renderEngine(); return; }
    EngineHost.analyze(s, { komi: S.overlay ? (S.overlay.komi ?? komi()) : komi(), playouts: 0, interval: 400, multi: settings.multi, forbidden: S.overlay ? null : superkoForbidden(s, node) }, res => {
      if (!S.live) return;
      S.engine = res; S.engine.state = s;
      renderEngine(); renderBoard();
    });
  }, 120);
}
function setLive(on) {
  S.live = on; $("liveToggle").checked = on;
  if (!on) { EngineHost.stop(); S.engine = null; }
  restartLive(); renderBoard();
}

function wrText(wr) { return pct(wr); }
function renderEngine() {
  const box = $("engineLines"), meta = $("engineMeta");
  const e = S.engine;
  const s = shownState();
  const nodeEval = !S.overlay && S.cur.eval && S.cur.eval.wr != null ? S.cur.eval : null;
  let wrB = e ? e.winrateBlack : nodeEval ? nodeEval.wr : null;
  const outer = $("evalBarOuter");
  if (wrB == null) { outer.classList.add("hidden-eval"); $("evalTopText").textContent = ""; $("evalBotText").textContent = ""; }
  else {
    outer.classList.remove("hidden-eval");
    $("evalBarWhite").style.height = ((1 - wrB) * 100).toFixed(1) + "%";
    $("evalTopText").textContent = Math.round((1 - wrB) * 100);
    $("evalBotText").textContent = Math.round(wrB * 100);
  }
  if (!e) {
    if (nodeEval) {
      meta.textContent = "análisis guardado";
      box.innerHTML = `<div class="pv-line"><span class="pv-moves">⚫ ${pct(nodeEval.wr)} · ⚪ ${pct(1 - nodeEval.wr)} · ventaja ${leadText(nodeEval.lead)}${nodeEval.best ? " · mejor " + coordName(nodeEval.best) : ""}</span></div>`;
    } else {
      meta.textContent = "";
      box.innerHTML = `<div class="pv-empty">${S.live ? "Pensando…" : "Pulsa «Analizar» (E) para que el motor piense en esta posición."}</div>`;
    }
    $("liveEstimate").textContent = "—";
    return;
  }
  meta.textContent = `${fmtK(e.playouts)} partidas simuladas · ventaja ${leadText(e.scoreLead)}`;
  $("liveEstimate").innerHTML = `Probabilidad de ganar: <b>⚫ ${pct(e.winrateBlack)}</b> · <b>⚪ ${pct(1 - e.winrateBlack)}</b><br>Ventaja estimada: <b>${leadText(e.scoreLead)}</b> (komi ${num1(komi())} incluido)`;
  const mover = e.mover;
  box.innerHTML = e.moves.slice(0, settings.multi).map((m, i) => {
    const pv = m.pv.map((p, k) => ((k % 2 === 0) === (mover === 1) ? "⚫" : "⚪") + Go.moveName(s, p)).join(" ");
    return `<div class="pv-line" data-i="${i}" title="Clic: jugar ${Go.moveName(s, m.p)}"><span class="pv-score">${pct(m.wr)}</span><span class="pv-visits">${fmtK(m.visits)}</span><span class="pv-moves">${pv}</span></div>`;
  }).join("") || `<div class="pv-empty">Pensando…</div>`;
}
function fmtK(n) { return n >= 10000 ? Math.round(n / 1000) + " k" : n >= 1000 ? num1(n / 1000) + " k" : String(n); }
function leadText(l) { if (l == null) return "—"; const a = Math.abs(l); return a < 0.5 ? "igualada" : (l > 0 ? "⚫ +" : "⚪ +") + num1(a); }
function coordName(xy) { if (!xy || xy[0] < 0) return "pasar"; return Go.gtp(S.game.size, xy[0], xy[1]); }

// ---------------------------------------------------------------- tablero
function renderBoard() {
  const svg = $("goban");
  const ov = S.overlay;
  const s = shownState(), n = s.n, node = S.cur;
  let last = -1;
  if (ov) last = ov.last ?? -1;
  else if (node.move && node.move.x >= 0) last = Go.pt(s, node.move.x, node.move.y);
  const o = { n, b: s.b, theme: settings.theme, style: settings.style, coords: settings.coords, idp: "gb",
    last: settings.last ? last : -1, view: ov ? ov.view : null };
  if (!ov) {
    o.marks = node.marks;
    if (settings.numbers) o.numbers = moveNumbers(node);
    if (settings.varHints && node.children.length > 1) o.varHints = node.children.filter(c => c.move && c.move.x >= 0).map((c, i) => [c.move.x, c.move.y, i > 0]);
    if (s.ko >= 0) o.ko = s.ko;
  } else {
    o.marks = ov.marks; o.problemRegion = ov.region;
    if (ov.owner) { o.owner = ov.owner; o.dead = ov.dead; }
  }
  if (S.mode === "score" && S.score) { o.dead = S.score.dead; o.owner = S.score.res.owner; o.marks = null; }
  if (S.live && S.engine && S.engine.state === s) {
    if (settings.cand && S.mode !== "cpu") {
      const top = S.engine.moves.slice(0, settings.multi), max = top.length ? top[0].visits : 1;
      o.candidates = top.map(m => ({ p: m.p, label: Math.round(m.wr * 100), sub: fmtK(m.visits), rel: m.visits / max }));
    }
    if (settings.own) o.ownership = S.engine.ownership;
  }
  if (S.hint != null) o.hint = S.hint;
  svg.innerHTML = BoardSvg(o).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  svg.setAttribute("viewBox", boardGeom(n, settings.coords, o.view).vb.join(" "));
  svg.classList.toggle("locked", isLocked());
  renderGhost();
}

function moveNumbers(node) {
  // números de las jugadas en el camino hasta aquí (sólo de las piedras que siguen en el tablero)
  const map = new Map(), s = curState();
  const path = Sgf.path(node);
  let k = 0;
  for (const nd of path) {
    if (!nd.move) continue;
    k++;
    if (nd.move.x < 0) continue;
    const p = Go.pt(s, nd.move.x, nd.move.y);
    map.set(p, k);
  }
  for (const [p] of map) if (s.b[p] !== Go.BLACK && s.b[p] !== Go.WHITE) map.delete(p);
  return map;
}
function isLocked() {
  if (S.mode === "cpu" && S.cpu && (S.cpu.thinking || S.cpu.over || curState().turn === S.cpu.cpuColor)) return true;
  if (S.overlay && S.overlay.locked) return true;
  return false;
}
function renderGhost() {
  const g = $("gbghost");
  if (!g) return;
  const h = S.hover;
  if (!settings.ghost || !h || isLocked() || S.mode === "score") { g.innerHTML = ""; return; }
  const s = shownState();
  const p = Go.pt(s, h[0], h[1]);
  if (s.b[p] !== Go.EMPTY && S.mode !== "edit") { g.innerHTML = ""; return; }
  const geo = boardGeom(s.n, settings.coords, null);
  let c = s.turn;
  if (S.mode === "edit") c = S.edTool === 0 ? 0 : S.edTool === "alt" ? s.turn : S.edTool;
  if (S.markTool) { g.innerHTML = `<circle cx="${geo.X(h[0])}" cy="${geo.Y(h[1])}" r="8" fill="none" stroke="#ffa726" stroke-width="2.5"/>`; return; }
  if (!c) { g.innerHTML = `<circle cx="${geo.X(h[0])}" cy="${geo.Y(h[1])}" r="9" fill="rgba(239,83,80,.7)"/>`; return; }
  g.innerHTML = stoneSvg(geo.X(h[0]), geo.Y(h[1]), c, "flat", "", 0.45);
}

// ---------------------------------------------------------------- jugadores, estado y comentario
function renderBars() {
  const h = S.game.headers, s = shownState();
  $("blackName").textContent = (S.overlay && S.overlay.blackName) || h.PB || "Negras";
  $("whiteName").textContent = (S.overlay && S.overlay.whiteName) || h.PW || "Blancas";
  $("blackRank").textContent = !S.overlay && h.BR ? "(" + h.BR + ")" : "";
  $("whiteRank").textContent = !S.overlay && h.WR ? "(" + h.WR + ")" : "";
  $("blackCaps").textContent = s.cap[1] + (s.cap[1] === 1 ? " captura" : " capturas");
  $("whiteCaps").textContent = s.cap[2] + (s.cap[2] === 1 ? " captura" : " capturas");
  $("bottomBar").classList.toggle("to-move", s.turn === Go.BLACK);
  $("topBar").classList.toggle("to-move", s.turn === Go.WHITE);
  $("infoBanner").textContent = S.overlay ? (S.overlay.title || "Ejercicio") :
    `${S.game.size}×${S.game.size} · komi ${num1(komi())} · ${rulesOf(S.game) === "chinese" ? "chinas" : "japonesas"}${h.HA ? " · hándicap " + h.HA : ""}${h.RE ? " · " + resultText(h.RE) : ""}`;
}
function resultText(re) {
  if (!re) return "";
  const m = /^([BW])\+(.*)$/i.exec(re.trim());
  if (!m) return re === "0" || /^draw|jigo/i.test(re) ? "empate (jigo)" : re;
  const who = m[1].toUpperCase() === "B" ? "ganan negras" : "ganan blancas";
  const how = m[2];
  if (/^r/i.test(how)) return who + " por abandono";
  if (/^t/i.test(how)) return who + " por tiempo";
  if (/^f/i.test(how)) return who + " por incomparecencia";
  return how ? `${who} por ${how.replace(".", ",")}` : who;
}
function renderStatus() {
  const st = $("statusText");
  st.className = "status-line";
  if (S.overlay) { st.textContent = S.overlay.status || ""; return; }
  const s = curState(), node = S.cur;
  const num = Sgf.moveNumber(node);
  let t = num ? `Jugada ${num}` : "Posición inicial";
  if (node.move) t += ` · ${COLOR_NAME[node.move.c]} ${node.move.x < 0 ? "pasan" : coordName([node.move.x, node.move.y])}`;
  if (node._captured && node._captured.length) t += ` (captura ${node._captured.length})`;
  if (node._illegal) t += " · ⚠ jugada ilegal en el SGF";
  const passes = node.move && node.move.x < 0 && node.parent && node.parent.move && node.parent.move.x < 0;
  if (passes) { t += " · los dos han pasado: pulsa 🧮 Recuento"; st.classList.add("check"); }
  else t += ` · juegan ${COLOR_NAME[s.turn].toLowerCase()}`;
  if (S.mode === "edit") t = "✏ Colocando piedras";
  if (S.mode === "score") t = "🧮 Recuento: pulsa un grupo para marcarlo vivo o muerto";
  st.textContent = t;
}
function renderComment() {
  const node = S.cur;
  $("annotation").value = node.comment || "";
  $("annotation").disabled = !!S.overlay;
  const num = Sgf.moveNumber(node);
  $("currentMoveBadge").textContent = node.move ? `${num}. ${COLOR_NAME[node.move.c]} ${node.move.x < 0 ? "pasan" : coordName([node.move.x, node.move.y])}` : (node.parent ? "Colocación" : "Posición inicial");
  document.querySelectorAll(".nag-btn").forEach(b => b.classList.toggle("on", !!b.dataset.nag && b.dataset.nag === node.nag));
  const en = $("engineNote");
  en.hidden = !!S.overlay || !(node.eval && node.eval.note);
  if (!en.hidden) en.textContent = "🤖 " + node.eval.note;
  $("posNag").value = node.pos || "";
}

// ---------------------------------------------------------------- lista de jugadas
const NAG_CLASS = { "!": "nag-good", "!!": "nag-brilliant", "?": "nag-mistake", "??": "nag-blunder", "?!": "nag-inacc", "!?": "nag-good" };
function renderMoves() {
  const box = $("moves"), out = [];
  const root = S.game.root;
  if (root.comment) out.push(`<span class="mvcomment">${esc(root.comment.slice(0, 200))}</span> `);
  const span = n => {
    const active = n === S.cur ? " active" : "";
    let label;
    if (n.move) {
      const k = Sgf.moveNumber(n);
      label = `<span class="mvnum">${k}</span><span class="chip ${n.move.c === 1 ? "b" : "w"}"></span>${n.move.x < 0 ? "pasa" : coordName([n.move.x, n.move.y])}`;
    } else label = "✏";
    let extra = "";
    if (n.nag) extra += `<span class="nag ${NAG_CLASS[n.nag] || ""}">${esc(n.nag)}</span>`;
    if (n.markId) extra += `<span class="mv-mark">📌</span>`;
    let html = `<span class="mv${active}" data-id="${n.id}">${label}${extra}</span>`;
    if (n.comment) html += ` <span class="mvcomment">${esc(n.comment.length > 140 ? n.comment.slice(0, 140) + "…" : n.comment)}</span>`;
    if (n.eval && n.eval.loss != null && (n.nag === "?" || n.nag === "??") && n.parent.eval && n.parent.eval.best) html += ` <span class="mvengine">🤖 −${Math.round(n.eval.loss * 100)} % · mejor ${coordName(n.parent.eval.best)}</span>`;
    return html;
  };
  function line(n) {
    while (n.children.length) {
      const main = n.children[0];
      out.push(span(main), " ");
      for (const v of n.children.slice(1)) { out.push(`<span class="var">`, span(v), " "); line(v); out.push("</span>"); }
      n = main;
    }
  }
  line(root);
  box.innerHTML = out.length ? out.join("") : `<span class="empty-moves">Juega en el tablero, importa un SGF o pulsa 🤖 Jugar vs CPU.</span>`;
  const act = box.querySelector(".mv.active");
  if (act) { const top = act.offsetTop - box.offsetTop; if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = top - box.clientHeight / 2; }
}
function findNode(id) { let f = null; Sgf.walk(S.game.root, n => { if (n.id === id) f = n; }); return f; }

function renderAll() {
  renderBoard(); renderBars(); renderStatus(); renderComment(); renderMoves(); renderEngine(); renderChart(); renderNav(); renderSaveState();
  if (activeTab() === "openings") renderExplorer();
}
function renderNav() {
  const locked = !!S.overlay || S.mode === "edit";
  for (const id of ["startBtn", "back10Btn", "backBtn"]) $(id).disabled = locked || !S.cur.parent;
  for (const id of ["forwardBtn", "fwd10Btn", "endBtn", "playBtn"]) $(id).disabled = locked || !S.cur.children.length;
  $("undoBtn").disabled = locked || !S.cur.parent || S.mode === "cpu";
  $("passBtn").disabled = S.mode === "edit" || S.mode === "score" || (S.overlay && !S.overlay.allowPass);
  $("editPosBtn").disabled = !!S.overlay || S.mode === "cpu" || S.mode === "score";
  $("promoteVarBtn").disabled = locked || !S.cur.parent || S.cur.parent.children[0] === S.cur;
  $("mainVarBtn").disabled = locked || Sgf.isMainline(S.cur);
}

// ---------------------------------------------------------------- jugar y navegar
let audioCtx = null;
function clack() {
  if (!settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime, len = 0.06;
    const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * len), audioCtx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const f = audioCtx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2200; f.Q.value = 1.4;
    const g = audioCtx.createGain(); g.gain.value = 0.7;
    src.connect(f); f.connect(g); g.connect(audioCtx.destination); src.start(t);
  } catch (e) { /* sin sonido */ }
}
const KO_MSG = { occupied: "Ese punto ya está ocupado.", ko: "Ko: no puedes recapturar enseguida; juega antes en otro sitio (amenaza de ko).", suicide: "Suicidio: esa piedra (o su grupo) se quedaría sin libertades.", superko: "Superko: esa jugada repetiría una posición anterior." };

/* Jugar en (x, y) o pasar (x < 0) en la partida. Devuelve el nodo nuevo o null si es ilegal. */
function playMove(x, y, opts = {}) {
  const s = curState(), c = s.turn;
  const p = x < 0 ? Go.PASS : Go.pt(s, x, y);
  const r = Go.play(s, p, c, { history: settings.ko === "superko" && p !== Go.PASS ? Sgf.historyKeys(S.game, S.cur) : null });
  if (r.error) { flashStatus(KO_MSG[r.error] || "Jugada ilegal"); return null; }
  const move = { c, x: p === Go.PASS ? -1 : x, y: p === Go.PASS ? -1 : y };
  let node;
  const existing = S.cur.children.find(ch => Sgf.sameMove(ch.move, move));
  if (existing) node = existing;
  else if (S.cur.children.length && $("branchMode").value === "overwrite" && !opts.variation) {
    S.cur.children = [];
    node = Sgf.addChild(S.cur, move).node;
  } else node = Sgf.addChild(S.cur, move).node;
  S.cur = node;
  if (p !== Go.PASS) clack();
  markDirty();
  onPosition();
  return node;
}
function flashStatus(msg) { const st = $("statusText"); st.textContent = "⚠ " + msg; st.className = "status-line over"; toast(msg); }
function goTo(node) {
  if (!node || S.overlay) return;
  S.cur = node; S.hint = null;
  onPosition();
}
function onPosition() {
  S.hint = null;
  if (S.mode === "score") exitScore(true);
  renderAll();
  restartLive();
  autosaveSoon();
  if (S.mode === "cpu") cpuAfterPosition();
}
function step(k) {
  let n = S.cur;
  if (k > 0) for (let i = 0; i < k && n.children.length; i++) n = n.children[0];
  else for (let i = 0; i < -k && n.parent; i++) n = n.parent;
  goTo(n);
}
function siblingStep(d) {
  const p = S.cur.parent; if (!p) return;
  const i = p.children.indexOf(S.cur), j = i + d;
  if (j >= 0 && j < p.children.length) goTo(p.children[j]);
}
function toggleAutoplay() {
  if (S.autoplay) { clearInterval(S.autoplay); S.autoplay = 0; $("playBtn").textContent = "▶ Auto"; return; }
  $("playBtn").textContent = "⏸ Pausa";
  S.autoplay = setInterval(() => { if (!S.cur.children.length) { toggleAutoplay(); return; } step(1); }, 900);
}

// ---------------------------------------------------------------- clics en el tablero
function onBoardClick(ev) {
  const s = shownState();
  const pt = pointFromEvent($("goban"), ev, s.n, settings.coords);
  if (!pt) return;
  const [x, y] = pt;
  const alt = ev.button === 2 || ev.shiftKey;
  if (S.overlay) { if (!S.overlay.locked && S.overlay.onClick) S.overlay.onClick(x, y, alt); return; }
  if (S.mode === "edit") return editClick(x, y, alt);
  if (S.mode === "score") return scoreClick(x, y);
  if (S.markTool || $("clickMode").value === "mark") return markClick(x, y);
  if (S.mode === "cpu") return cpuUserClick(x, y);
  if (ev.button === 2) return;
  playMove(x, y);
}

// ---------------------------------------------------------------- marcas
function markClick(x, y) {
  const tool = S.markTool || "TR";
  const n = S.cur;
  n.marks = n.marks || {};
  const m = n.marks;
  const has = (k) => (m[k] || []).findIndex(p => p[0] === x && p[1] === y);
  const removeAll = () => { for (const k of ["TR", "SQ", "CR", "MA", "LB"]) if (m[k]) m[k] = m[k].filter(p => !(p[0] === x && p[1] === y)); };
  if (tool === "DEL") removeAll();
  else if (tool === "LBA" || tool === "LB1") {
    const i = has("LB");
    if (i >= 0) m.LB.splice(i, 1);
    else {
      removeAll();
      const used = new Set((m.LB || []).map(l => l[2]));
      let t;
      if (tool === "LBA") { for (let k = 0; k < 26; k++) { t = String.fromCharCode(65 + k); if (!used.has(t)) break; } }
      else { for (let k = 1; k < 400; k++) { t = String(k); if (!used.has(t)) break; } }
      (m.LB = m.LB || []).push([x, y, t]);
    }
  } else {
    const i = has(tool);
    if (i >= 0) m[tool].splice(i, 1);
    else { removeAll(); (m[tool] = m[tool] || []).push([x, y]); }
  }
  markDirty(); renderBoard();
}
function setMarkTool(t) {
  S.markTool = S.markTool === t ? null : t;
  document.querySelectorAll("#markTools [data-mk]").forEach(b => b.classList.toggle("active", b.dataset.mk === S.markTool));
  renderGhost();
}

// ---------------------------------------------------------------- editor de posición
let editNode = null;
function enterEdit() {
  if (S.mode === "cpu") return;
  stopAnalysis();
  const n = S.cur;
  if (!n.parent && !n.children.length) editNode = n;
  else if (!n.move && n.setup && !n.children.length) editNode = n;
  else { editNode = Sgf.node(n); n.children.push(editNode); }
  editNode.setup = editNode.setup || { AB: [], AW: [], AE: [] };
  S.cur = editNode;
  S.mode = "edit";
  document.body.classList.add("editing");
  $("editorPanel").hidden = false;
  $("edTurn").value = String(curState().turn);
  setLive(false);
  renderAll();
}
function exitEdit() {
  if (S.mode !== "edit") return;
  S.mode = "normal";
  document.body.classList.remove("editing");
  $("editorPanel").hidden = true;
  const st = editNode.setup;
  if (editNode.parent && !st.AB.length && !st.AW.length && !st.AE.length && !editNode.pl && !editNode.children.length) {
    const p = editNode.parent; Sgf.cut(editNode); S.cur = p;
  }
  editNode = null;
  markDirty();
  onPosition();
}
function editClick(x, y, alt) {
  const n = editNode, st = n.setup;
  const parentState = n.parent ? Sgf.stateAt(S.game, n.parent) : Go.create(S.game.size);
  const s = curState(), p = Go.pt(s, x, y);
  let want = S.edTool === "alt" ? (s.b[p] === Go.EMPTY ? Go.BLACK : s.b[p] === Go.BLACK ? Go.WHITE : Go.EMPTY) : S.edTool;
  if (alt && want) want = Go.other(want);
  if (S.edTool !== "alt" && s.b[p] === want && want !== 0) want = Go.EMPTY;
  for (const k of ["AB", "AW", "AE"]) st[k] = st[k].filter(q => !(q[0] === x && q[1] === y));
  if (parentState.b[p] !== want) st[want === 1 ? "AB" : want === 2 ? "AW" : "AE"].push([x, y]);
  Sgf.invalidate(n);
  markDirty();
  renderBoard(); renderBars();
}

// ---------------------------------------------------------------- análisis de la partida
let analysisCancel = false;
function stopAnalysis() { analysisCancel = true; }
const LOSS = { inacc: 0.06, mistake: 0.12, blunder: 0.24 };
async function analyseLine(fromVariation) {
  if (S.analysing) return;
  const nodes = fromVariation ? Sgf.path(S.cur).concat(Sgf.mainline(S.cur).slice(1)) : Sgf.mainline(S.game.root);
  if (nodes.length < 2) { toast("No hay jugadas que analizar"); return; }
  S.analysing = true; analysisCancel = false;
  const live = S.live; setLive(false);
  $("analyseBtn").disabled = true; $("cancelAnalysisBtn").hidden = false;
  const prog = $("analysisProgress"); prog.classList.add("show");
  const factor = +settings.analysis || 2;
  const po = playoutsFor(S.game.size, factor / 2);
  const km = komi();
  const t0 = Date.now();
  for (let i = 0; i < nodes.length && !analysisCancel; i++) {
    const nd = nodes[i];
    const s = Sgf.stateAt(S.game, nd);
    // posición terminada (dos pases): no hace falta pensar
    const next = nodes[i + 1] && nodes[i + 1].parent === nd ? nodes[i + 1].move : null;
    const track = next && next.c === s.turn ? (next.x < 0 ? Go.PASS : Go.pt(s, next.x, next.y)) : null;
    const res = await EngineHost.analyze(s, { komi: km, playouts: po, interval: 100000, multi: 4, seed: 1234 + i, forbidden: superkoForbidden(s, nd), track });
    storeEval(nd, s, res, next);
    prog.firstElementChild.style.width = ((i + 1) / nodes.length * 100).toFixed(1) + "%";
    const el = (Date.now() - t0) / (i + 1), left = Math.round(el * (nodes.length - i - 1) / 1000);
    $("analysisStatus").textContent = `Analizando ${i + 1} de ${nodes.length}… quedan unos ${left} s`;
    if (i % 4 === 0) renderChart();
  }
  const cancelled = analysisCancel;
  S.analysing = false;
  $("analyseBtn").disabled = false; $("cancelAnalysisBtn").hidden = true;
  prog.classList.remove("show");
  annotateLine(nodes);
  $("analysisStatus").textContent = cancelled ? "Análisis detenido: se comentan las jugadas ya analizadas." : `Análisis terminado en ${Math.round((Date.now() - t0) / 1000)} s.`;
  markDirty();
  renderAll();
  renderReport(nodes);
  if (live) setLive(true);
}
function storeEval(nd, s, res, next) {
  const toXY = p => p < 0 ? [-1, -1] : Go.xy(s, p);
  nd.eval = Object.assign(nd.eval || {}, {
    wr: res.winrateBlack, lead: res.scoreLead, best: res.moves.length ? toXY(res.best) : null,
    top: res.moves.slice(0, 4).map(m => ({ m: toXY(m.p), wr: m.wr, v: m.visits })),
    pv: (res.moves[0] ? res.moves[0].pv : []).slice(0, 8).map(toXY), po: res.playouts,
    next: next && res.tracked ? { m: [next.x, next.y], wr: res.tracked.wr, v: res.tracked.visits } : null
  });
}
/* Pérdida de una jugada (para quien la juega). Si la búsqueda de la posición anterior exploró bastante la jugada
   de la partida, se compara con la mejor dentro de esa misma búsqueda (mucho menos ruido); si no, se compara
   con la evaluación de la posición siguiente. */
function moveLoss(nd) {
  if (!nd.move || !nd.parent || !nd.eval || !nd.parent.eval || nd.eval.wr == null || nd.parent.eval.wr == null) return null;
  const pe = nd.parent.eval, mover = nd.move.c;
  const before = pe.wr, beforeMover = mover === Go.BLACK ? before : 1 - before;
  const bestWr = pe.top && pe.top[0] ? pe.top[0].wr : beforeMover;
  const played = [nd.move.x, nd.move.y];
  const isBest = pe.best && pe.best[0] === played[0] && pe.best[1] === played[1];
  const after = nd.eval.wr, afterCross = mover === Go.BLACK ? after : 1 - after;
  let afterMover = afterCross;
  if (isBest) afterMover = bestWr;
  else if (pe.next && pe.next.m[0] === played[0] && pe.next.m[1] === played[1] && pe.next.v >= 30) {
    // las dos medidas, con más peso a la de la misma búsqueda cuanto más se exploró
    const w = Math.min(1, pe.next.v / 150) * 0.75;
    afterMover = w * pe.next.wr + (1 - w) * afterCross;
  }
  const loss = isBest ? 0 : Math.max(0, bestWr - afterMover);
  return { loss, beforeMover: bestWr, afterMover };
}
function annotateLine(nodes) {
  for (const nd of nodes) {
    const L = moveLoss(nd);
    if (!L) continue;
    const pe = nd.parent.eval;
    const best = pe.best, played = [nd.move.x, nd.move.y];
    const isBest = best && best[0] === played[0] && best[1] === played[1];
    nd.eval.loss = L.loss;
    nd.eval.match = isBest || (pe.top || []).some(t => t.m[0] === played[0] && t.m[1] === played[1] && pe.top[0] && pe.top[0].wr - t.wr < 0.02);
    let nag = "";
    const decided = L.beforeMover < 0.04 || L.beforeMover > 0.97;
    if (!decided) {
      if (L.loss >= LOSS.blunder) nag = "??"; else if (L.loss >= LOSS.mistake) nag = "?"; else if (L.loss >= LOSS.inacc) nag = "?!";
    }
    if (!nd.nag || nd.autoNag) { nd.nag = nag; nd.autoNag = !!nag; }
    nd.eval.note = engineNote(nd, L, nag);
  }
}
function describeMove(nd) {
  // descripción en español de lo que hace la jugada
  if (!nd.move || nd.move.x < 0) return nd.move ? "Pasa." : "";
  const s0 = Sgf.stateAt(S.game, nd.parent), s1 = Sgf.stateAt(S.game, nd), n = s0.n;
  const p = Go.pt(s1, nd.move.x, nd.move.y), c = nd.move.c, opp = Go.other(c);
  const out = [];
  const cap = (nd._captured || []).length;
  if (cap) out.push(cap === 1 ? "Captura una piedra" : `Captura ${cap} piedras`);
  const mine = Go.group(s1, p);
  if (mine && mine.libs.size === 1 && !cap) out.push(mine.stones.length > 1 ? `deja su grupo de ${mine.stones.length} piedras en atari` : "se pone en atari");
  let ataris = 0, cutGroups = new Set();
  for (const q of Go.nbrs(s1, p)) if (s1.b[q] === opp) { const g = Go.group(s1, q); if (g.libs.size === 1) ataris++; cutGroups.add(g.stones[0]); }
  if (ataris) out.push(ataris > 1 ? "da doble atari" : "da atari");
  // salva piedras que estaban en atari
  for (const q of Go.nbrs(s0, p)) if (s0.b[q] === c && Go.libCount(s0, q, 2) === 1 && mine.libs.size > 1) { out.push("salva sus piedras del atari"); break; }
  // conecta dos grupos propios
  const own = new Set();
  for (const q of Go.nbrs(s0, p)) if (s0.b[q] === c) own.add(Go.group(s0, q).stones[0]);
  if (own.size >= 2) out.push("conecta sus piedras");
  const [x, y] = [nd.move.x, nd.move.y], line = Math.min(x, y, n - 1 - x, n - 1 - y) + 1;
  const k = Sgf.moveNumber(nd);
  if (n >= 13 && k <= 16 && line >= 3 && line <= 4) {
    const corner = Math.max(x, n - 1 - x) >= n - 6 && Math.max(y, n - 1 - y) >= n - 6;
    const dx = Math.min(x, n - 1 - x) + 1, dy = Math.min(y, n - 1 - y) + 1;
    if (corner && dx <= 5 && dy <= 5) {
      const name = dx === 4 && dy === 4 ? "el punto estrella (4-4)" : dx === 3 && dy === 3 ? "el 3-3" : (dx === 3 && dy === 4) || (dx === 4 && dy === 3) ? "el komoku (3-4)" : (dx === 3 && dy === 5) || (dx === 5 && dy === 3) ? "el mokuhazushi (3-5)" : (dx === 4 && dy === 5) || (dx === 5 && dy === 4) ? "el takamoku (4-5)" : "";
      if (name) out.push("ocupa " + name + " de una esquina");
    }
  }
  if (line === 1 && k < n * 2 && !cap && !ataris) out.push("juega en la primera línea muy pronto");
  if (!out.length) return "";
  const t = out.join(", ");
  return t[0].toUpperCase() + t.slice(1) + ".";
}
function engineNote(nd, L, nag) {
  const pe = nd.parent.eval, mover = nd.move.c;
  const parts = [];
  const desc = describeMove(nd);
  if (desc) parts.push(desc);
  if (nag && pe.best) {
    const bestWr = L.beforeMover;
    parts.push(`Pierde ${pct(L.loss)} de probabilidad de ganar. Mejor era ${coordName(pe.best)} (${pct(bestWr)} para ${COLOR_NAME[mover].toLowerCase()}, frente a ${pct(L.afterMover)}).`);
    if (pe.pv && pe.pv.length > 1) parts.push("Línea: " + pe.pv.slice(0, 6).map(coordName).join(" ") + ".");
  } else if (nd.eval.match) parts.push("Es la jugada que elige el motor.");
  return parts.join(" ");
}

// ---------------------------------------------------------------- informe
function phaseOf(k, total, n) {
  const open = Math.round(n * n * 0.14);
  if (k <= open) return 0;
  if (total > open * 2 && k > total * 0.7) return 2;
  return 1;
}
function renderReport(nodes) {
  nodes = nodes || Sgf.mainline(S.game.root);
  const st = { 1: mk(), 2: mk() };
  function mk() { return { n: 0, loss: 0, match: 0, inacc: 0, mistake: 0, blunder: 0, phase: [[0, 0], [0, 0], [0, 0]], errs: [] }; }
  const n = S.game.size, total = nodes.filter(x => x.move).length;
  const moments = [];
  for (const nd of nodes) {
    if (!nd.move || !nd.eval || nd.eval.loss == null || nd.move.x < 0) continue;
    const c = nd.move.c, r = st[c], k = Sgf.moveNumber(nd);
    r.n++; r.loss += nd.eval.loss; if (nd.eval.match) r.match++;
    if (nd.nag === "?!") r.inacc++; else if (nd.nag === "?") r.mistake++; else if (nd.nag === "??") r.blunder++;
    const ph = phaseOf(k, total, n); r.phase[ph][0] += nd.eval.loss; r.phase[ph][1]++;
    if (nd.nag === "?" || nd.nag === "??") r.errs.push(nd);
    moments.push(nd);
  }
  if (!st[1].n && !st[2].n) { $("reportBox").classList.remove("show"); return; }
  $("reportBox").classList.add("show");
  const h = S.game.headers;
  $("repBName").textContent = h.PB || "Negras"; $("repWName").textContent = h.PW || "Blancas";
  for (const [c, k] of [[1, "B"], [2, "W"]]) {
    const r = st[c];
    $("rep" + k + "Match").textContent = r.n ? Math.round(r.match / r.n * 100) + " %" : "–";
    $("rep" + k + "Loss").textContent = r.n ? pct(r.loss / r.n) : "–";
    $("rep" + k + "Inacc").textContent = r.inacc; $("rep" + k + "Mistake").textContent = r.mistake; $("rep" + k + "Blunder").textContent = r.blunder;
  }
  moments.sort((a, b) => b.eval.loss - a.eval.loss);
  const key = moments.filter(x => x.nag === "?" || x.nag === "??").slice(0, 6);
  const last = nodes[nodes.length - 1];
  const wrEnd = last.eval ? last.eval.wr : null;
  let summary = "";
  const name = c => c === 1 ? (h.PB || "Negras") : (h.PW || "Blancas");
  if (wrEnd != null) {
    const fav = wrEnd >= 0.5 ? 1 : 2;
    summary = `Al final de la línea, el motor da a ${esc(name(fav))} un ${pct(fav === 1 ? wrEnd : 1 - wrEnd)} de probabilidad de ganar (ventaja ${leadText(last.eval.lead)}). `;
  }
  if (key.length) {
    const k0 = key[0];
    summary += `El momento decisivo fue la jugada ${Sgf.moveNumber(k0)} de ${esc(name(k0.move.c))} (${coordName([k0.move.x, k0.move.y])}), que perdió ${pct(k0.eval.loss)}.`;
  } else summary += "No hubo errores graves según el motor: partida equilibrada en sus decisiones.";
  const phases = ["Apertura", "Medio juego", "Final (yose)"];
  let html = `<h3>Resumen</h3><p class="rep-summary">${summary}</p>`;
  if (key.length) html += `<h3>Momentos clave</h3><ol class="rep-key">${key.map(k => `<li><button class="link-inline" data-goto="${k.id}">${Sgf.moveNumber(k)}. ${coordName([k.move.x, k.move.y])}</button> (${esc(name(k.move.c))}) ${k.nag ? `<span class="nag ${NAG_CLASS[k.nag]}">${k.nag}</span>` : ""}: pierde ${pct(k.eval.loss)}. Mejor ${coordName(k.parent.eval.best)}.</li>`).join("")}</ol>`;
  html += `<h3>Por fases (pérdida media por jugada)</h3><table class="rep-phases"><thead><tr><th></th><th>${esc(name(1))}</th><th>${esc(name(2))}</th></tr></thead><tbody>` +
    phases.map((p, i) => `<tr><td>${p}</td><td>${st[1].phase[i][1] ? pct(st[1].phase[i][0] / st[1].phase[i][1]) : "–"}</td><td>${st[2].phase[i][1] ? pct(st[2].phase[i][0] / st[2].phase[i][1]) : "–"}</td></tr>`).join("") + "</tbody></table>";
  html += "<h3>Qué practicar</h3>";
  for (const c of [1, 2]) {
    const r = st[c];
    if (!r.n) continue;
    const tips = [];
    const worst = [0, 1, 2].filter(i => r.phase[i][1]).sort((a, b) => r.phase[b][0] / r.phase[b][1] - r.phase[a][0] / r.phase[a][1])[0];
    if (worst === 0) tips.push("La apertura: esquinas primero, extensiones desde tus grupos y la dirección del juego (🌍 Aperturas).");
    if (worst === 1) tips.push("La lectura en los combates: vida y muerte y capturas (🎯 Entrenar › Problemas).");
    if (worst === 2) tips.push("El final: calcula el tamaño de cada jugada de yose y cuenta antes de pasar (🧮 Recuento).");
    const selfAtari = r.errs.filter(nd => /atari/.test(nd.eval.note || "")).length;
    if (selfAtari) tips.push(`Revisa las libertades antes de jugar: ${selfAtari} de tus errores tuvieron que ver con un atari.`);
    if (r.blunder) tips.push(`Repasa tus ${r.blunder + r.mistake} errores con «🎯 Aprende de tus errores».`);
    html += `<div class="rep-player"><b>${esc(name(c))}</b><ul>${tips.map(t => `<li>${t}</li>`).join("")}</ul></div>`;
  }
  $("reportExtra").innerHTML = html;
  const errs = st[1].errs.concat(st[2].errs);
  const rs = $("retryStart");
  rs.hidden = !errs.length;
  rs.innerHTML = errs.length ? `<button class="primary" data-retry="0">🎯 Aprende de tus errores (${errs.length})</button>` +
    (st[1].errs.length ? `<button class="sm-btn" data-retry="1">Sólo ${esc(name(1))} (${st[1].errs.length})</button>` : "") +
    (st[2].errs.length ? `<button class="sm-btn" data-retry="2">Sólo ${esc(name(2))} (${st[2].errs.length})</button>` : "") : "";
}

// ---------------------------------------------------------------- gráfico
function renderChart() {
  const svg = $("evalChartSvg"), msg = $("chartMsg");
  const line = Sgf.mainline(S.game.root);
  const pts = line.map((nd, i) => nd.eval && nd.eval.wr != null ? [i, nd.eval.wr] : null);
  if (!pts.some(Boolean) || line.length < 2) { svg.innerHTML = ""; msg.hidden = false; $("chartLegend").hidden = true; return; }
  msg.hidden = true; $("chartLegend").hidden = false;
  const W = 600, H = 64, N = line.length - 1;
  const X = i => i / N * W, Y = wr => wr * H; // arriba blancas (wr negro bajo), abajo negras
  let d = "", area = `M0 ${H / 2}`;
  pts.forEach(p => { if (!p) return; const x = X(p[0]), y = H - Y(p[1]); d += (d ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); area += `L${x.toFixed(1)} ${y.toFixed(1)}`; });
  let s = `<rect width="${W}" height="${H}" fill="#e8ecf2"/><path d="${area}L${W} ${H / 2}Z" fill="#1e293b" opacity=".0"/>`;
  // zona negra: desde la curva hacia abajo
  const lastX = X(pts.filter(Boolean).slice(-1)[0][0]);
  s += `<path d="${d}L${lastX} ${H}L0 ${H}Z" fill="#141a24"/>`;
  s += `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#7a8699" stroke-dasharray="4 4" stroke-width="1"/>`;
  s += `<path d="${d}" fill="none" stroke="#29b6f6" stroke-width="1.6"/>`;
  line.forEach((nd, i) => {
    if (!nd.nag || !/\?/.test(nd.nag)) return;
    const col = nd.nag === "??" ? "#ef5350" : nd.nag === "?" ? "#ff7043" : "#ffca28";
    const wr = nd.eval && nd.eval.wr != null ? nd.eval.wr : 0.5;
    s += `<circle cx="${X(i)}" cy="${H - Y(wr)}" r="3" fill="${col}"/>`;
  });
  const ci = line.indexOf(S.cur);
  if (ci >= 0) s += `<line x1="${X(ci)}" y1="0" x2="${X(ci)}" y2="${H}" stroke="#ffa726" stroke-width="2"/>`;
  svg.innerHTML = s;
}

// ---------------------------------------------------------------- aprende de tus errores
let retry = null;
function startRetry(who) {
  const errs = Sgf.mainline(S.game.root).filter(nd => nd.move && (nd.nag === "?" || nd.nag === "??") && nd.eval && nd.parent.eval && (!who || nd.move.c === who));
  if (!errs.length) { toast("No hay errores que repasar"); return; }
  retry = { list: errs, i: 0, ok: 0 };
  showRetry();
}
function showRetry() {
  const nd = retry.list[retry.i];
  const base = nd.parent, s = Sgf.stateAt(S.game, base);
  S.cur = base;
  openOverlay({
    state: s, last: base.move && base.move.x >= 0 ? Go.pt(s, base.move.x, base.move.y) : -1, title: "🎯 Aprende de tus errores", komi: komi(),
    status: `Error ${retry.i + 1} de ${retry.list.length}: juegan ${COLOR_NAME[s.turn].toLowerCase()}. Encuentra una jugada mejor que ${coordName([nd.move.x, nd.move.y])}.`,
    onClick: (x, y) => answerByEngine(s, x, y, base.eval, ok => {
      if (ok) retry.ok++;
      retryBox(ok ? "✔ ¡Bien!" : "✗ No es la mejor", ok);
    })
  });
  retryBox(null);
}
function retryBox(result, ok) {
  const nd = retry.list[retry.i], box = $("retryBox");
  box.hidden = false;
  box.innerHTML = `<div class="retry-head">🎯 Aprende de tus errores · ${retry.i + 1}/${retry.list.length} · aciertos ${retry.ok}</div>
    <div>En la partida se jugó <b>${coordName([nd.move.x, nd.move.y])}</b> ${nd.nag}. ${result ? `<div class="retry-msg">${result}${S.overlay.lastMsg ? " " + S.overlay.lastMsg : ""}</div>` : '<div class="retry-q">¿Qué jugarías tú?</div>'}</div>
    <div class="controls"><button class="sm-btn info-btn" data-r="sol">💡 Ver la mejor</button>${retry.i + 1 < retry.list.length ? '<button class="sm-btn primary" data-r="next">Siguiente ▶</button>' : ""}<button class="sm-btn danger" data-r="end">✖ Terminar</button></div>`;
  box.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
    const a = b.dataset.r;
    if (a === "sol") { const best = nd.parent.eval.best; if (best && best[0] >= 0) { S.hint = Go.pt(S.overlay.state, best[0], best[1]); renderBoard(); } toast("Mejor: " + coordName(best)); }
    if (a === "next") { retry.i++; showRetry(); }
    if (a === "end") { closeOverlay(); box.hidden = true; retry = null; }
  });
}
/* Comprueba una jugada con el motor: correcta si es la mejor o casi igual de buena (≤ 4 %). */
async function answerByEngine(s, x, y, refEval, done, opts = {}) {
  const p = Go.pt(s, x, y);
  const r = Go.play(s, p);
  if (r.error) { flashStatus(KO_MSG[r.error]); return; }
  const ov = S.overlay;
  ov.locked = true; ov.state = r.state; ov.last = p; S.hint = null;
  renderBoard(); clack();
  const best = refEval && refEval.best;
  if (best && best[0] === x && best[1] === y) { ov.lastMsg = "Es la jugada del motor."; done(true); return; }
  if (opts.expected && opts.expected[0] === x && opts.expected[1] === y) { ov.lastMsg = "Es la jugada de la partida."; done(true); return; }
  ov.status = "El motor comprueba tu jugada…"; renderStatus();
  const po = playoutsFor(s.n, 0.8);
  let ref = refEval && refEval.top && refEval.top[0] ? refEval.top[0].wr : null;
  if (ref == null) {
    const r0 = await EngineHost.analyze(s, { komi: ov.komi ?? komi(), playouts: po, interval: 1e6, multi: 3 });
    ref = r0.moves[0] ? r0.moves[0].wr : 0.5;
  }
  const after = await EngineHost.analyze(r.state, { komi: ov.komi ?? komi(), playouts: po, interval: 1e6, multi: 3 });
  const mine = 1 - (after.moves[0] ? after.moves[0].wr : 1 - (s.turn === 1 ? after.winrateBlack : 1 - after.winrateBlack));
  const diff = ref - mine;
  ov.lastMsg = diff <= 0.04 ? `Casi igual de buena que la mejor (${pct(mine)} frente a ${pct(ref)}).` : `Con ella te quedas con ${pct(mine)}; la mejor da ${pct(ref)}.`;
  ov.status = "";
  done(diff <= 0.04);
}

// ---------------------------------------------------------------- capa temporal (ejercicios)
function openOverlay(o) {
  if (S.mode === "edit") exitEdit();
  if (S.mode === "score") exitScore(true);
  S.overlay = Object.assign({ locked: false }, o);
  S.hint = null;
  $("exBackBtn").hidden = false;
  renderAll(); restartLive();
}
function closeOverlay() {
  if (!S.overlay) return;
  const cb = S.overlay.onClose;
  S.overlay = null; S.hint = null;
  $("exBackBtn").hidden = true;
  $("probBox").hidden = true; $("retryBox").hidden = true; $("trainFeedback").hidden = true;
  if (cb) cb();
  renderAll(); restartLive();
}

// ---------------------------------------------------------------- guardar, exportar, compartir
function markDirty() { S.dirty = true; renderSaveState(); if (S.libId) librarySaveSoon(); autosaveSoon(); }
let autosaveT = 0;
function autosaveSoon() {
  clearTimeout(autosaveT);
  autosaveT = setTimeout(() => {
    if (!settings.autosave) return;
    store("current", { game: Sgf.toJSON(S.game), path: pathOf(S.cur), libId: S.libId, title: $("gameName").value, tags: $("gameTags").value, fav: S.fav });
  }, 600);
}
function pathOf(node) { const out = []; for (let n = node; n.parent; n = n.parent) out.push(n.parent.children.indexOf(n)); return out.reverse(); }
function nodeAt(game, path) { let n = game.root; for (const i of path || []) { if (!n.children[i]) break; n = n.children[i]; } return n; }
function sgfText(game = S.game) {
  if (!settings.sgfEngine) return Sgf.serialize(game);
  // copia con los comentarios del motor dentro de C[]
  const g = Sgf.fromJSON(Sgf.toJSON(game));
  Sgf.walk(g.root, n => {
    if (n.eval && n.eval.note && n.nag && /\?/.test(n.nag)) n.comment = (n.comment ? n.comment + "\n" : "") + "[GoBase] " + n.eval.note;
    if (n.eval && n.eval.wr != null) { n.extra = n.extra || {}; n.extra.GBW = [String(Math.round(n.eval.wr * 1000) / 1000)]; }
  });
  return Sgf.serialize(g);
}
function download(name, text, mime = "application/x-go-sgf") {
  const blob = text instanceof Blob ? text : new Blob([text], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function gameFileName(ext) {
  const h = S.game.headers;
  const base = ($("gameName").value || [h.PB, h.PW].filter(Boolean).join(" vs ") || "partida").replace(/[^\p{L}\p{N} _.-]+/gu, "").trim() || "partida";
  return base + "." + ext;
}
async function copyText(t, msg) {
  try { await navigator.clipboard.writeText(t); toast(msg || "Copiado"); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast(msg || "Copiado"); } catch (e2) { toast("No se pudo copiar"); } ta.remove(); }
}
async function exportPng() {
  const s = shownState();
  const svgText = BoardSvg({ n: s.n, b: s.b, theme: settings.theme, style: settings.style, coords: settings.coords, idp: "png",
    last: S.overlay ? S.overlay.last : (S.cur.move && S.cur.move.x >= 0 ? Go.pt(s, S.cur.move.x, S.cur.move.y) : -1),
    marks: S.overlay ? S.overlay.marks : S.cur.marks, numbers: settings.numbers && !S.overlay ? moveNumbers(S.cur) : null, px: 900 });
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
  await img.decode().catch(() => {});
  const c = document.createElement("canvas"); c.width = 900; c.height = 900;
  c.getContext("2d").drawImage(img, 0, 0, 900, 900);
  c.toBlob(async blob => {
    if (!blob) { toast("No se pudo crear la imagen"); return; }
    download(gameFileName("png").replace(/\.png$/, "") + "-" + Sgf.moveNumber(S.cur) + ".png", blob);
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Imagen descargada y copiada al portapapeles"); } catch (e) { toast("Imagen descargada"); }
  }, "image/png");
}
async function makeLink() {
  const sgf = Sgf.serialize(S.game);
  let enc;
  try {
    const cs = new CompressionStream("deflate-raw");
    const stream = new Blob([sgf]).stream().pipeThrough(cs);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    enc = "z" + b64url(buf);
  } catch (e) { enc = "u" + b64url(new TextEncoder().encode(sgf)); }
  const url = location.href.split("#")[0] + "#sgf=" + enc + "&m=" + pathOf(S.cur).join(".");
  copyText(url, "Enlace copiado: abre esta partida en esta jugada");
}
function b64url(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64url(t) { const s = atob(t.replace(/-/g, "+").replace(/_/g, "/")); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
async function loadFromHash() {
  const m = /#sgf=([^&]+)(?:&m=([\d.]*))?/.exec(location.hash);
  if (!m) return false;
  try {
    let bytes = unb64url(m[1].slice(1)), text;
    if (m[1][0] === "z") {
      const ds = new DecompressionStream("deflate-raw");
      text = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
    } else text = new TextDecoder().decode(bytes);
    const r = Sgf.parse(text);
    if (!r.length) return false;
    loadGame(r[0].game, { path: (m[2] || "").split(".").filter(Boolean).map(Number) });
    toast("Partida abierta desde el enlace");
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- impresión: figuras de 50 jugadas
function printGame() {
  const line = Sgf.mainline(S.game.root), h = S.game.headers;
  const moves = line.filter(n => n.move);
  const per = 50;
  let html = `<h1>${esc($("gameName").value || [h.PB || "Negras", h.PW || "Blancas"].join(" – "))}</h1>
    <div class="pmeta">⚫ ${esc(h.PB || "Negras")} ${esc(h.BR || "")} · ⚪ ${esc(h.PW || "Blancas")} ${esc(h.WR || "")} · ${S.game.size}×${S.game.size} · komi ${esc(h.KM || "0")}${h.HA ? " · hándicap " + esc(h.HA) : ""}${h.RE ? " · " + esc(resultText(h.RE)) : ""}${h.DT ? " · " + esc(h.DT) : ""}${h.EV ? " · " + esc(h.EV) : ""}</div>`;
  if (S.game.root.comment) html += `<p class="pcom">${esc(S.game.root.comment)}</p>`;
  for (let f = 0; f * per < Math.max(moves.length, 1); f++) {
    const from = f * per, to = Math.min(moves.length, from + per);
    const startNode = from === 0 ? S.game.root : moves[from - 1];
    const endNode = to ? moves[to - 1] : S.game.root;
    const sEnd = Sgf.stateAt(S.game, endNode), sStart = Sgf.stateAt(S.game, startNode);
    // piedras: las del principio de la figura + las jugadas numeradas de la figura (aunque luego se capturen)
    const b = sStart.b.slice(), numbers = new Map(), notes = [];
    for (let k = from; k < to; k++) {
      const nd = moves[k];
      if (nd.move.x < 0) { notes.push(`${k + 1}: pasa`); continue; }
      const p = Go.pt(sEnd, nd.move.x, nd.move.y);
      if (numbers.has(p) || (b[p] && !numbers.has(p))) { notes.push(`${k + 1} en ${numbers.get(p) || coordName([nd.move.x, nd.move.y])}`); continue; }
      b[p] = nd.move.c; numbers.set(p, k + 1);
    }
    const svg = BoardSvg({ n: S.game.size, b, theme: "paper", style: "flat", coords: true, idp: "pr" + f, numbers });
    html += `<figure>${svg}<figcaption>Figura ${f + 1}: jugadas ${from + 1}–${to}${notes.length ? " · " + esc(notes.join(", ")) : ""}</figcaption></figure>`;
    const coms = moves.slice(from, to).filter(nd => nd.comment || nd.nag);
    for (const nd of coms) html += `<p class="pcom"><b>${Sgf.moveNumber(nd)}${nd.nag ? " " + esc(nd.nag) : ""}</b> ${esc(nd.comment || "")}</p>`;
  }
  html += `<div class="pfoot">GoBase ${APP_VERSION}</div>`;
  $("printView").innerHTML = html;
  setTimeout(() => window.print(), 50);
}

// ---------------------------------------------------------------- cargar partidas
function loadGame(game, opts = {}) {
  if (S.mode === "cpu") endCpu(true);
  if (S.mode === "edit") exitEdit();
  if (S.mode === "score") exitScore(true);
  closeOverlay();
  stopAnalysis();
  S.game = game;
  S.cur = opts.path ? nodeAt(game, opts.path) : game.root;
  S.libId = opts.libId ?? null; S.fav = !!opts.fav; S.dirty = false;
  $("gameName").value = opts.title || "";
  $("gameTags").value = (opts.tags || []).join ? (opts.tags || []).join(", ") : (opts.tags || "");
  $("favToggle").classList.toggle("on", S.fav); $("favToggle").textContent = S.fav ? "★" : "☆";
  fillHeaders();
  $("reportBox").classList.remove("show");
  if (Sgf.mainline(game.root).some(n => n.eval && n.eval.loss != null)) renderReport();
  onPosition();
}
function fillHeaders() {
  document.querySelectorAll("[data-h]").forEach(i => { i.value = S.game.headers[i.dataset.h] || ""; });
  $("scKomi").value = komi(); $("scRules").value = rulesOf(S.game);
}
function importText(text, append) {
  text = text.trim();
  if (!text) { $("importResult").innerHTML = '<span class="msg-err">Pega antes un SGF o unas jugadas.</span>'; return; }
  if (Sgf.looksLikeSgf(text)) {
    const res = Sgf.parse(text);
    if (!res.length) { $("importResult").innerHTML = '<span class="msg-err">No encuentro ninguna partida SGF en el texto.</span>'; return; }
    if (append) { $("importResult").innerHTML = '<span class="msg-err">«Añadir desde aquí» sólo admite jugadas sueltas.</span>'; return; }
    if (res.length > 1) { openCollection(res.map(r => r.game), "texto pegado"); }
    loadGame(res[0].game);
    const errs = res[0].errors;
    $("importResult").innerHTML = `<span class="msg-ok">✔ ${res[0].moves} jugadas importadas${res.length > 1 ? ` (y ${res.length - 1} partidas más en 📚 › 🗂 Fichero)` : ""}.</span>${errs.length ? " ⚠ " + esc(errs.slice(0, 3).join("; ")) : ""}`;
    return;
  }
  const size = append ? S.game.size : S.game.size;
  const start = append ? curState().turn : (S.game.root.setup && S.game.root.pl ? S.game.root.pl : Go.BLACK);
  const r = Sgf.parseMoves(text, size, start);
  if (r.error && !r.moves.length) { $("importResult").innerHTML = `<span class="msg-err">${esc(r.error)}</span>`; return; }
  if (!append) loadGame(Sgf.newGame(size, { komi: komi(), rules: rulesOf(S.game) }));
  let count = 0;
  for (const m of r.moves) { if (!playMove(m.x, m.y, { variation: true })) break; count++; }
  $("importResult").innerHTML = `<span class="msg-ok">✔ ${count} jugadas.</span>${r.error ? ' <span class="msg-err">' + esc(r.error) + "</span>" : ""}`;
}
async function openSgfFiles(files) {
  const games = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const text = Sgf.decodeBytes(buf);
    for (const r of Sgf.parse(text)) { r.game._file = f.name; games.push(r.game); }
  }
  if (!games.length) { toast("No hay partidas SGF en el fichero"); return; }
  if (games.length === 1) { loadGame(games[0], { title: files[0].name.replace(/\.sgf$/i, "") }); toast("Partida abierta (no se ha guardado)"); }
  else { openCollection(games, files.length === 1 ? files[0].name : files.length + " ficheros"); loadGame(games[0]); toast(`${games.length} partidas abiertas en 📚 › 🗂 Fichero`); }
}

// ---------------------------------------------------------------- nueva partida
function newGameFromModal() {
  const size = +$("ngSize").value, ha = +$("ngHandicap").value;
  const km = parseFloat($("ngKomi").value.replace(",", ".")) || 0;
  const g = Sgf.newGame(size, { komi: km, handicap: ha, rules: $("ngRules").value, PB: $("ngPB").value, PW: $("ngPW").value, DT: today() });
  loadGame(g);
  closeModal("newModal");
}
function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

// ---------------------------------------------------------------- modales y pestañas
function openModal(id) { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }
function activeTab() { const b = document.querySelector(".tab-btn.active"); return b ? b.dataset.tab : "study"; }
function setTab(t) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.toggle("active", p.id === "tab-" + t));
  if (t === "openings") renderExplorer();
  if (t === "library") { renderLibrary(); renderStorage(); }
  if (t === "train") renderTrain();
}

// ---------------------------------------------------------------- eventos
function bindUi() {
  const svg = $("goban");
  svg.addEventListener("pointerdown", ev => { if (ev.button === 1) return; ev.preventDefault(); onBoardClick(ev); });
  svg.addEventListener("contextmenu", ev => ev.preventDefault());
  svg.addEventListener("pointermove", ev => {
    if (ev.pointerType === "touch") return;
    const s = shownState();
    const p = pointFromEvent(svg, ev, s.n, settings.coords);
    if (String(p) !== String(S.hover)) { S.hover = p; renderGhost(); }
  });
  svg.addEventListener("pointerleave", () => { S.hover = null; renderGhost(); });
  svg.addEventListener("wheel", ev => {
    if (!settings.wheel || S.overlay || S.mode !== "normal") return;
    ev.preventDefault();
    step(ev.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  $("startBtn").onclick = () => goTo(S.game.root);
  $("backBtn").onclick = () => step(-1);
  $("forwardBtn").onclick = () => step(1);
  $("back10Btn").onclick = () => step(-10);
  $("fwd10Btn").onclick = () => step(10);
  $("endBtn").onclick = () => step(9999);
  $("playBtn").onclick = toggleAutoplay;
  $("passBtn").onclick = () => {
    if (S.overlay) { if (S.overlay.onPass) S.overlay.onPass(); return; }
    if (S.mode === "cpu") return cpuUserPass();
    playMove(-1, -1);
  };
  $("undoBtn").onclick = () => { if (!S.cur.parent) return; const p = Sgf.cut(S.cur); S.cur = p; markDirty(); onPosition(); };
  $("editPosBtn").onclick = () => S.mode === "edit" ? exitEdit() : enterEdit();
  $("edDoneBtn").onclick = exitEdit;
  document.querySelectorAll("#edTools [data-ed]").forEach(b => b.onclick = () => {
    S.edTool = b.dataset.ed === "alt" ? "alt" : +b.dataset.ed;
    document.querySelectorAll("#edTools [data-ed]").forEach(x => x.classList.toggle("active", x === b));
  });
  $("edTurn").onchange = () => { if (editNode) { editNode.pl = +$("edTurn").value; Sgf.invalidate(editNode); markDirty(); renderAll(); } };
  $("edClearBtn").onclick = () => {
    if (!editNode) return;
    const parentState = editNode.parent ? Sgf.stateAt(S.game, editNode.parent) : Go.create(S.game.size);
    editNode.setup = { AB: [], AW: [], AE: [] };
    for (const p of Go.points(parentState)) if (parentState.b[p] === 1 || parentState.b[p] === 2) editNode.setup.AE.push(Go.xy(parentState, p));
    Sgf.invalidate(editNode); markDirty(); renderAll();
  };
  $("moves").addEventListener("click", ev => { const m = ev.target.closest(".mv"); if (m) goTo(findNode(+m.dataset.id)); });
  $("promoteVarBtn").onclick = () => { Sgf.promote(S.cur); markDirty(); renderAll(); };
  $("mainVarBtn").onclick = () => { Sgf.makeMain(S.cur); markDirty(); renderAll(); };
  $("hintBtn").onclick = showHint;
  $("numToggle").checked = settings.numbers;
  $("numToggle").onchange = () => { settings.numbers = $("numToggle").checked; saveSettings(); renderBoard(); };
  $("liveToggle").onchange = () => setLive($("liveToggle").checked);
  $("candToggle").checked = settings.cand; $("ownToggle").checked = settings.own;
  $("candToggle").onchange = () => { settings.cand = $("candToggle").checked; saveSettings(); renderBoard(); };
  $("ownToggle").onchange = () => { settings.own = $("ownToggle").checked; saveSettings(); if (settings.own && !S.live) setLive(true); renderBoard(); };
  $("playBestBtn").onclick = () => {
    const e = S.engine;
    if (!e || !e.moves.length) { toast("Enciende antes «Analizar»"); return; }
    const s = shownState(), p = e.moves[0].p;
    if (S.overlay) return;
    if (p < 0) playMove(-1, -1); else { const [x, y] = Go.xy(s, p); playMove(x, y); }
  };
  $("engineLines").addEventListener("click", ev => {
    const l = ev.target.closest(".pv-line[data-i]"); if (!l || !S.engine || S.overlay) return;
    const m = S.engine.moves[+l.dataset.i]; if (!m) return;
    const s = curState();
    if (m.p < 0) playMove(-1, -1); else { const [x, y] = Go.xy(s, m.p); playMove(x, y, { variation: true }); }
  });
  $("evalChartWrap").onclick = ev => {
    const line = Sgf.mainline(S.game.root); if (line.length < 2 || S.overlay) return;
    const r = $("evalChartWrap").getBoundingClientRect();
    const i = Math.round((ev.clientX - r.left) / r.width * (line.length - 1));
    goTo(line[Math.max(0, Math.min(line.length - 1, i))]);
  };
  $("moveTyped").addEventListener("keydown", ev => {
    if (ev.key !== "Enter") return;
    const t = $("moveTyped").value.trim();
    if (!t) return;
    const s = shownState();
    if (/^(pasa|pasar|pass)$/i.test(t)) { $("passBtn").click(); $("moveTyped").value = ""; return; }
    const xy = Go.fromGtp(s.n, t) || (/^[a-y]{2}$/.test(t) ? Go.fromSgf(t) : null);
    if (!xy) { flashStatus("No entiendo «" + t + "»: escribe por ejemplo D4, Q16 o pd"); return; }
    $("moveTyped").value = "";
    if (S.overlay) { S.overlay.onClick && !S.overlay.locked && S.overlay.onClick(xy[0], xy[1], false); return; }
    if (S.mode === "cpu") return cpuUserClick(xy[0], xy[1]);
    playMove(xy[0], xy[1]);
  });
  // estudio
  $("analyseBtn").onclick = () => analyseLine(false);
  $("analyseVarBtn").onclick = () => analyseLine(true);
  $("cancelAnalysisBtn").onclick = stopAnalysis;
  $("retryStart").addEventListener("click", ev => { const b = ev.target.closest("[data-retry]"); if (b) startRetry(+b.dataset.retry); });
  $("reportExtra").addEventListener("click", ev => { const b = ev.target.closest("[data-goto]"); if (b) goTo(findNode(+b.dataset.goto)); });
  document.querySelectorAll("[data-h]").forEach(i => i.addEventListener("change", () => {
    S.game.headers[i.dataset.h] = i.value.trim();
    if (i.dataset.h === "KM") $("scKomi").value = komi();
    markDirty(); renderBars(); restartLive();
  }));
  $("branchMode").value = settings.branch;
  $("branchMode").onchange = () => { settings.branch = $("branchMode").value; saveSettings(); };
  $("importBtn").onclick = () => importText($("moveInput").value, false);
  $("appendBtn").onclick = () => importText($("moveInput").value, true);
  $("openSgfBtn").onclick = () => $("sgfFileInput").click();
  $("openFileBtn").onclick = () => $("sgfFileInput").click();
  $("sgfFileInput").onchange = ev => { if (ev.target.files.length) openSgfFiles([...ev.target.files]); ev.target.value = ""; };
  $("copySgfBtn").onclick = () => copyText(sgfText(), "SGF copiado");
  $("downloadSgfBtn").onclick = () => download(gameFileName("sgf"), sgfText());
  $("downloadJsonBtn").onclick = () => download(gameFileName("json"), JSON.stringify({ app: "GoBase", version: APP_VERSION, title: $("gameName").value, game: Sgf.toJSON(S.game) }), "application/json");
  $("sgfEngineToggle").checked = settings.sgfEngine;
  $("sgfEngineToggle").onchange = () => { settings.sgfEngine = $("sgfEngineToggle").checked; saveSettings(); };
  $("annotation").addEventListener("input", () => { if (S.overlay) return; S.cur.comment = $("annotation").value; markDirty(); });
  $("annotation").addEventListener("change", renderMoves);
  document.querySelectorAll(".nag-btn").forEach(b => b.onclick = () => { if (S.overlay || !S.cur.move) return; S.cur.nag = b.dataset.nag; S.cur.autoNag = false; markDirty(); renderComment(); renderMoves(); });
  $("posNag").onchange = () => { S.cur.pos = $("posNag").value; markDirty(); };
  $("explainMoveBtn").onclick = explainCurrentMove;
  document.querySelectorAll("#markTools [data-mk]").forEach(b => b.onclick = () => setMarkTool(b.dataset.mk));
  $("clearMarksBtn").onclick = () => { S.cur.marks = null; markDirty(); renderBoard(); };
  $("pngBtn").onclick = exportPng;
  $("printBtn").onclick = printGame;
  $("linkBtn").onclick = makeLink;
  // pestañas y modales
  document.querySelectorAll(".tab-btn").forEach(b => b.onclick = () => setTab(b.dataset.tab));
  document.querySelectorAll(".modal-back").forEach(m => {
    m.addEventListener("click", ev => { if (ev.target === m || ev.target.closest("[data-close]")) m.classList.remove("open"); });
  });
  $("newGame").onclick = () => { $("ngRules").value = settings.rules; openModal("newModal"); };
  $("ngHandicap").onchange = () => { $("ngKomi").value = +$("ngHandicap").value ? "0.5" : "6.5"; };
  $("ngStartBtn").onclick = newGameFromModal;
  $("settingsBtn").onclick = () => openModal("settingsModal");
  $("helpBtn").onclick = () => openModal("helpModal");
  $("licBtn").onclick = () => openModal("licModal");
  $("menuBtn").onclick = () => { const h = document.querySelector("header"); h.classList.toggle("menu-open"); $("menuBtn").setAttribute("aria-expanded", h.classList.contains("menu-open")); };
  $("themeSelect").value = settings.theme; $("stoneStyleSelect").value = settings.style;
  document.body.dataset.theme = settings.theme;
  $("themeSelect").onchange = () => { settings.theme = $("themeSelect").value; document.body.dataset.theme = settings.theme; saveSettings(); renderBoard(); };
  $("stoneStyleSelect").onchange = () => { settings.style = $("stoneStyleSelect").value; saveSettings(); renderBoard(); };
  $("soundToggle").textContent = settings.sound ? "🔊" : "🔇";
  $("soundToggle").onclick = () => { settings.sound = !settings.sound; $("soundToggle").textContent = settings.sound ? "🔊" : "🔇"; saveSettings(); };
  // ajustes
  const bindSet = (id, key, isCheck, after) => {
    const el = $(id);
    if (isCheck) el.checked = !!settings[key]; else el.value = String(settings[key]);
    el.onchange = () => { settings[key] = isCheck ? el.checked : (isNaN(+el.value) ? el.value : +el.value); saveSettings(); after && after(); };
  };
  bindSet("setAnalysis", "analysis"); bindSet("setMulti", "multi", false, () => { restartLive(); });
  bindSet("setRules", "rules"); bindSet("setKo", "ko");
  bindSet("setCoords", "coords", true, renderBoard); bindSet("setLast", "last", true, renderBoard); bindSet("setGhost", "ghost", true, renderBoard);
  bindSet("setAutosave", "autosave", true); bindSet("setWheel", "wheel", true); bindSet("setVarHints", "varHints", true, renderBoard);
  // ayuda
  $("helpSearch").addEventListener("input", () => {
    const q = $("helpSearch").value.trim().toLowerCase();
    document.querySelectorAll("#helpBody details").forEach(d => {
      const hit = !q || d.textContent.toLowerCase().includes(q);
      d.hidden = !hit; if (q && hit) d.open = true;
    });
  });
  $("helpExpand").onclick = () => { const all = [...document.querySelectorAll("#helpBody details")]; const open = !all.every(d => d.open); all.forEach(d => (d.open = open)); };
  $("exBackBtn").onclick = () => { if (S.overlay && S.overlay.onBack) S.overlay.onBack(); closeOverlay(); };
  // teclado
  document.addEventListener("keydown", ev => {
    const tag = (ev.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    if (k === "Escape") { document.querySelectorAll(".modal-back.open").forEach(m => m.classList.remove("open")); if (S.markTool) setMarkTool(S.markTool); return; }
    if (document.querySelector(".modal-back.open")) return;
    const map = {
      ArrowLeft: () => step(-1), ArrowRight: () => step(1), ArrowUp: () => siblingStep(-1), ArrowDown: () => siblingStep(1),
      Home: () => goTo(S.game.root), End: () => step(9999), PageUp: () => step(-10), PageDown: () => step(10),
      " ": toggleAutoplay, e: () => setLive(!S.live), E: () => setLive(!S.live), t: toggleOwn, T: toggleOwn, h: showHint, H: showHint,
      n: () => { $("numToggle").click(); }, N: () => { $("numToggle").click(); }, m: openMarkModal, M: openMarkModal,
      p: () => $("passBtn").click(), P: () => $("passBtn").click(), "?": () => openModal("helpModal")
    };
    if (map[k]) { ev.preventDefault(); map[k](); }
  });
  // instalación
  let deferred = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("installBtn").hidden = false; });
  $("installBtn").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("installBtn").hidden = true; };
}
function toggleOwn() { $("ownToggle").checked = !$("ownToggle").checked; $("ownToggle").onchange(); }
function engineBusy() {
  if (S.analysing || (S.cpu && S.cpu.thinking)) { toast("El motor está ocupado: espera un momento"); return true; }
  return false;
}
async function showHint() {
  const s = shownState();
  if (S.mode === "cpu" && !S.overlay) { toast("Durante la partida contra la CPU no hay pistas"); return; }
  if (S.overlay && S.overlay.onHint) { S.overlay.onHint(); return; }
  if (S.engine && S.engine.state === s && S.engine.moves.length) { S.hint = S.engine.moves[0].p; renderBoard(); toast("Pista: " + Go.moveName(s, S.hint)); return; }
  if (engineBusy()) return;
  toast("Buscando la mejor jugada…");
  const res = await EngineHost.analyze(s, { komi: S.overlay ? (S.overlay.komi ?? komi()) : komi(), playouts: playoutsFor(s.n, 0.7), interval: 1e6, multi: 3 });
  if (shownState() !== s) return;
  S.hint = res.best; renderBoard();
  toast("Pista: " + Go.moveName(s, res.best));
  restartLive();
}
async function explainCurrentMove() {
  const nd = S.cur;
  if (!nd.move || !nd.parent) { toast("Ve a una jugada para comentarla"); return; }
  if (engineBusy()) return;
  toast("El motor analiza la jugada…");
  const km = komi();
  for (const x of [nd.parent, nd]) {
    if (x.eval && x.eval.wr != null && x.eval.top && (x !== nd.parent || x.eval.next)) continue;
    const s = Sgf.stateAt(S.game, x);
    const next = x === nd.parent ? nd.move : null;
    const track = next ? (next.x < 0 ? Go.PASS : Go.pt(s, next.x, next.y)) : null;
    const res = await EngineHost.analyze(s, { komi: km, playouts: playoutsFor(s.n, 1), interval: 1e6, multi: 4, track });
    storeEval(x, s, res, next);
  }
  annotateLine([nd]);
  const text = nd.eval.note || "Jugada normal: el motor no ve nada especial.";
  nd.comment = nd.comment ? nd.comment + "\n" + text : text;
  markDirty(); renderAll(); restartLive();
}

const APP_VERSION = "{{VERSION}}";
