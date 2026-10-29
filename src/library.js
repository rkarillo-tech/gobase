/* GoBase · biblioteca en el navegador (IndexedDB): partidas, marcadores, búsqueda, estadísticas,
   ficheros abiertos sólo en memoria y explorador de aperturas de tus partidas (con las 8 simetrías) */

const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open("gobase", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("games")) db.createObjectStore("games", { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains("marks")) db.createObjectStore("marks", { keyPath: "id", autoIncrement: true });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode), st = t.objectStore(store);
      let out;
      Promise.resolve(fn(st)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    all: store => tx(store, "readonly", st => req(st.getAll())),
    get: (store, id) => tx(store, "readonly", st => req(st.get(id))),
    put: (store, obj) => tx(store, "readwrite", st => req(st.put(obj))),
    del: (store, id) => tx(store, "readwrite", st => req(st.delete(id))),
    clear: store => tx(store, "readwrite", st => req(st.clear()))
  };
})();

let libCache = null, markCache = null;
async function libGames() { if (!libCache) { try { libCache = await DB.all("games"); } catch (e) { libCache = []; } } return libCache; }
async function libMarks() { if (!markCache) { try { markCache = await DB.all("marks"); } catch (e) { markCache = []; } } return markCache; }
function invalidateLib() { libCache = null; explorerIndex = null; }

function gameRecord() {
  const h = S.game.headers;
  const moves = Sgf.mainline(S.game.root).filter(n => n.move).length;
  const rec = {
    title: $("gameName").value.trim() || [h.PB || "Negras", h.PW || "Blancas"].join(" – "),
    fav: S.fav, tags: $("gameTags").value.split(",").map(t => t.trim()).filter(Boolean),
    data: Sgf.toJSON(S.game), pb: h.PB || "", pw: h.PW || "", re: h.RE || "", dt: h.DT || "", ev: h.EV || "", size: S.game.size, moves,
    analysed: Sgf.mainline(S.game.root).some(n => n.eval && n.eval.loss != null), updated: Date.now()
  };
  if (S.libId) rec.id = S.libId;
  return rec;
}
async function saveToLibrary() {
  const rec = gameRecord();
  const old = S.libId ? (await libGames()).find(g => g.id === S.libId) : null;
  rec.created = old ? old.created : Date.now();
  const id = await DB.put("games", rec);
  S.libId = id; S.dirty = false;
  invalidateLib();
  renderSaveState();
  if (activeTab() === "library") renderLibrary();
  return id;
}
let libSaveT = 0;
function librarySaveSoon() { clearTimeout(libSaveT); libSaveT = setTimeout(() => { if (S.libId) saveToLibrary().catch(() => {}); }, 900); }
function renderSaveState() {
  const el = $("saveState");
  if (!S.libId) { el.textContent = "No guardada en la biblioteca"; el.className = "save-state"; return; }
  el.textContent = S.dirty ? "Guardando cambios…" : "✔ Guardada en la biblioteca (los cambios se guardan solos)";
  el.className = "save-state " + (S.dirty ? "dirty" : "saved");
}
async function openLibGame(id, path) {
  const rec = (await libGames()).find(g => g.id === id);
  if (!rec) return;
  const g = Sgf.fromJSON(rec.data);
  loadGame(g, { libId: rec.id, fav: rec.fav, title: rec.title, tags: rec.tags, path });
  setTab("study");
}

// ---------------------------------------------------------------- lista de la biblioteca
async function renderLibrary() {
  const games = await libGames();
  $("libCount").textContent = games.length;
  const q = $("libFilter").value.trim().toLowerCase(), tag = $("libTagFilter").value, sort = $("libSort").value;
  const tags = [...new Set(games.flatMap(g => g.tags || []))].sort();
  const tsel = $("libTagFilter"), keep = tsel.value;
  tsel.innerHTML = '<option value="">Todas</option>' + tags.map(t => `<option ${t === keep ? "selected" : ""}>${esc(t)}</option>`).join("");
  $("tagList").innerHTML = tags.map(t => `<option value="${esc(t)}">`).join("");
  let list = games.filter(g => (!tag || (g.tags || []).includes(tag)) && (!q || [g.title, g.pb, g.pw, g.ev, g.dt, (g.tags || []).join(" ")].join(" ").toLowerCase().includes(q)));
  list.sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "date" ? String(b.dt).localeCompare(String(a.dt)) : (b.fav - a.fav) || (b.updated - a.updated));
  $("libBody").innerHTML = list.map(g => `<tr data-id="${g.id}" class="${g.id === S.libId ? "current" : ""}">
    <td><input type="checkbox" class="lib-sel" data-id="${g.id}" aria-label="Seleccionar"></td>
    <td class="star-cell" data-star="${g.id}">${g.fav ? "★" : "☆"}</td>
    <td><div class="lib-title">${esc(g.title)}</div><div class="lib-sub">${g.size}×${g.size} · ${g.moves} jugadas${g.dt ? " · " + esc(g.dt) : ""}${g.ev ? " · " + esc(g.ev) : ""}${g.analysed ? " · 🤖" : ""}</div></td>
    <td>${esc(g.re || "")}</td>
    <td class="hide-sm">${(g.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</td>
    <td class="row-actions"><button class="sm-btn danger" data-del="${g.id}" title="Borrar">🗑</button></td></tr>`).join("") || `<tr><td colspan="6" class="small">${games.length ? "Ninguna partida coincide." : "Tu biblioteca está vacía: pulsa 💾 Guardar en biblioteca en una partida."}</td></tr>`;
  $("libStatus").textContent = list.length !== games.length ? `${list.length} de ${games.length} partidas` : "";
  updateLibSel();
  renderMarkCount();
}
function selectedLibIds() { return [...document.querySelectorAll(".lib-sel:checked")].map(i => +i.dataset.id); }
function updateLibSel() { $("libDeleteSel").disabled = !selectedLibIds().length; }

// ---------------------------------------------------------------- ocupación
async function renderStorage() {
  const games = await libGames(), marks = await libMarks();
  const libBytes = new Blob([JSON.stringify(games), JSON.stringify(marks)]).size;
  const collBytes = S.coll.reduce((a, g) => a + (g._bytes || 2000), 0);
  let quota = 0, usage = 0;
  try { const e = await navigator.storage.estimate(); quota = e.quota || 0; usage = e.usage || 0; } catch (e) { /* sin estimación */ }
  const mb = b => (b / 1048576).toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " MB";
  $("meterLib").style.width = Math.min(100, quota ? usage / quota * 100 * 20 : libBytes / 5e7 * 100).toFixed(1) + "%";
  $("meterLibTxt").textContent = mb(libBytes) + (quota ? " de " + mb(quota) : "");
  $("meterColl").style.width = Math.min(100, collBytes / 5e7 * 100).toFixed(1) + "%";
  $("meterCollTxt").textContent = S.coll.length ? `${S.coll.length} partidas · ${mb(collBytes)}` : "nada abierto";
  $("storageDetail").textContent = `${games.length} partidas y ${marks.length} marcadores guardados.`;
  try { const p = await navigator.storage.persisted(); $("storagePersist").textContent = p ? "🔒 protegidos" : ""; $("persistBtn").hidden = p; } catch (e) { $("persistBtn").hidden = true; }
}

// ---------------------------------------------------------------- marcadores
const MARK_CATS = ["💡 Idea", "⚔ Táctica", "☠ Vida y muerte", "🏗 Forma", "⚠ Error típico", "🗺 Plan / dirección", "🧮 Yose", "⭐ Otra"];
let markCat = MARK_CATS[0], editingMark = null;
function openMarkModal() {
  if (S.overlay) { toast("Vuelve a la partida para marcar"); return; }
  editingMark = null;
  $("markNote").value = ""; $("markTrain").checked = true; $("markDeleteBtn").hidden = true; $("markMsg").textContent = "";
  renderMarkCats();
  openModal("markModal");
  setTimeout(() => $("markNote").focus(), 30);
}
function renderMarkCats() {
  $("markCats").innerHTML = MARK_CATS.map(c => `<button class="sm-btn cat-chip ${c === markCat ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  $("markCats").querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { markCat = b.dataset.cat; renderMarkCats(); });
}
async function saveMark() {
  if (!S.libId) await saveToLibrary();
  const s = curState(), node = S.cur;
  const next = node.children[0] && node.children[0].move ? [node.children[0].move.x, node.children[0].move.y] : null;
  const rec = editingMark || { created: Date.now(), srs: { due: Date.now(), step: 0 } };
  Object.assign(rec, {
    gameId: S.libId, path: pathOf(node), cat: markCat, note: $("markNote").value.trim(), train: $("markTrain").checked,
    size: s.n, board: boardString(s), turn: s.turn, ko: s.ko, cap: s.cap, komi: komi(), next,
    title: $("gameName").value || [S.game.headers.PB, S.game.headers.PW].filter(Boolean).join(" – ") || "Partida", move: Sgf.moveNumber(node)
  });
  await DB.put("marks", rec);
  markCache = null;
  closeModal("markModal");
  toast("📌 Posición marcada");
  renderMarkCount();
}
function boardString(s) { let t = ""; for (const p of Go.points(s)) t += s.b[p]; return t; }
function stateFromString(n, str, turn, ko = -1, cap) {
  let s = Go.create(n); const list = [];
  Go.points(s).forEach((p, i) => { const c = +str[i]; if (c) list.push([p, c]); });
  s = Go.setup(s, list); s.turn = turn; s.ko = ko; if (cap) s.cap = cap.slice();
  return s;
}
async function renderMarkCount() {
  const marks = await libMarks();
  $("markCount").textContent = marks.length;
  const due = marks.filter(m => m.train && m.srs && m.srs.due <= Date.now()).length;
  const b = $("cardDueBadge"); b.textContent = due + " pendientes"; b.classList.toggle("due", due > 0);
}
async function renderMarks() {
  const marks = await libMarks();
  const q = $("markFilter").value.trim().toLowerCase();
  const sel = $("markCatFilter");
  if (!sel.options.length) sel.innerHTML = '<option value="">Todas las categorías</option>' + MARK_CATS.map(c => `<option>${esc(c)}</option>`).join("");
  const cat = sel.value;
  const list = marks.filter(m => (!cat || m.cat === cat) && (!q || (m.note + " " + m.title).toLowerCase().includes(q))).sort((a, b) => b.created - a.created);
  $("markList").innerHTML = list.map(m => {
    const s = stateFromString(m.size, m.board, m.turn);
    return `<div class="mark-card" data-mid="${m.id}">${miniBoard(m.size, s.b)}
      <div><div class="mark-head">${esc(m.cat)} · ${esc(m.title)}</div><div class="mark-note">${q ? highlight(m.note, q) : esc(m.note || "(sin nota)")}</div>
      <div class="mark-meta">Jugada ${m.move} · juegan ${COLOR_NAME[m.turn].toLowerCase()}${m.train ? " · 🧠 tarjeta" : ""}</div></div>
      <div class="mark-actions"><button class="sm-btn" data-mopen="${m.id}">↗ Abrir</button><button class="sm-btn danger" data-mdel="${m.id}">🗑</button></div></div>`;
  }).join("") || '<p class="small">Sin marcadores. Pulsa 📌 (o M) en una posición que quieras recordar.</p>';
}
function highlight(text, q) {
  const t = esc(text || ""), i = t.toLowerCase().indexOf(esc(q).toLowerCase());
  return i < 0 ? t : t.slice(0, i) + "<mark>" + t.slice(i, i + esc(q).length) + "</mark>" + t.slice(i + esc(q).length);
}

// ---------------------------------------------------------------- búsqueda en comentarios
async function searchComments() {
  const q = $("commentSearch").value.trim().toLowerCase();
  const out = [];
  if (q.length < 2) { $("searchResults").innerHTML = '<p class="small">Escribe al menos dos letras.</p>'; return; }
  for (const g of await libGames()) {
    const game = Sgf.fromJSON(g.data);
    Sgf.walk(game.root, n => {
      const texts = [n.comment, n.eval && n.eval.note].filter(Boolean);
      for (const t of texts) if (t.toLowerCase().includes(q)) { out.push({ g, path: pathOf(n), text: t, move: Sgf.moveNumber(n) }); break; }
    });
    if (out.length > 300) break;
  }
  for (const m of await libMarks()) if ((m.note || "").toLowerCase().includes(q)) out.push({ mark: m, text: m.note });
  $("searchResults").innerHTML = out.slice(0, 300).map((r, i) => `<div class="mark-card" style="grid-template-columns:1fr auto" data-sr="${i}"><div>
      <div class="mark-head">${r.mark ? "📌 " + esc(r.mark.title) : esc(r.g.title)} · jugada ${r.mark ? r.mark.move : r.move}</div><div class="mark-note">${highlight(r.text.slice(0, 300), q)}</div></div><div class="mark-actions"><button class="sm-btn">↗ Abrir</button></div></div>`).join("") || '<p class="small">Nada encontrado.</p>';
  $("searchResults").querySelectorAll("[data-sr]").forEach(el => el.onclick = () => {
    const r = out[+el.dataset.sr];
    if (r.mark) openLibGame(r.mark.gameId, r.mark.path); else openLibGame(r.g.id, r.path);
  });
}

// ---------------------------------------------------------------- estadísticas
async function renderStats() {
  const name = $("statsName").value.trim().toLowerCase();
  store("myName", $("statsName").value.trim());
  if (!name) { $("statsOut").innerHTML = '<p class="small">Escribe tu nombre.</p>'; return; }
  const games = (await libGames()).filter(g => [g.pb, g.pw].some(p => (p || "").toLowerCase() === name));
  if (!games.length) { $("statsOut").innerHTML = '<p class="small">No hay partidas tuyas con ese nombre en la biblioteca.</p>'; return; }
  const t = { n: 0, w: 0, l: 0, byColor: { 1: [0, 0], 2: [0, 0] }, bySize: {}, an: 0, match: 0, mv: 0, err: 0, phase: [[0, 0], [0, 0], [0, 0]], loss: 0 };
  for (const g of games) {
    const me = (g.pb || "").toLowerCase() === name ? 1 : 2;
    const re = /^([BW])\+/i.exec(g.re || "");
    t.n++;
    const sz = t.bySize[g.size] = t.bySize[g.size] || [0, 0];
    if (re) {
      const win = (re[1].toUpperCase() === "B") === (me === 1);
      if (win) { t.w++; t.byColor[me][0]++; sz[0]++; } else { t.l++; t.byColor[me][1]++; sz[1]++; }
    }
    if (g.analysed) {
      t.an++;
      const game = Sgf.fromJSON(g.data), line = Sgf.mainline(game.root), total = line.filter(n => n.move).length;
      for (const n of line) {
        if (!n.move || n.move.c !== me || !n.eval || n.eval.loss == null) continue;
        t.mv++; if (n.eval.match) t.match++; t.loss += n.eval.loss;
        if (n.nag === "?" || n.nag === "??") t.err++;
        const ph = phaseOf(Sgf.moveNumber(n), total, g.size); t.phase[ph][0] += n.eval.loss; t.phase[ph][1]++;
      }
    }
  }
  const ratio = (a, b) => a + b ? Math.round(a / (a + b) * 100) + " %" : "–";
  const tile = (l, v) => `<div class="st-tile"><span>${l}</span><b>${v}</b></div>`;
  let html = `<div class="st-tiles">${tile("Partidas", t.n)}${tile("Victorias", ratio(t.w, t.l))}${tile("Con negras", ratio(...t.byColor[1]))}${tile("Con blancas", ratio(...t.byColor[2]))}${tile("Analizadas", t.an)}${t.mv ? tile("Coincidencia con el motor", Math.round(t.match / t.mv * 100) + " %") + tile("Errores por partida", num1(t.err / t.an)) : ""}</div>`;
  html += `<h3>Por tamaño de tablero</h3><table class="cb-table"><thead><tr><th>Tablero</th><th class="num">Ganadas</th><th class="num">Perdidas</th><th class="num">%</th></tr></thead><tbody>` +
    Object.entries(t.bySize).map(([k, v]) => `<tr><td>${k}×${k}</td><td class="num">${v[0]}</td><td class="num">${v[1]}</td><td class="num">${ratio(v[0], v[1])}</td></tr>`).join("") + "</tbody></table>";
  if (t.mv) {
    const names = ["la apertura", "el medio juego", "el final"];
    const avg = t.phase.map(p => p[1] ? p[0] / p[1] : 0);
    const worst = avg.indexOf(Math.max(...avg));
    html += `<h3>Conclusiones</h3><ul class="small" style="padding-left:18px"><li>Donde más pierdes es en <b>${names[worst]}</b> (${pct(avg[worst])} por jugada).</li>
      <li>${t.err ? `Tienes ${t.err} errores (? y ??) para repasar en 🎯 Entrenar › Errores de tus partidas.` : "No hay errores graves en tus partidas analizadas."}</li>
      ${t.an < t.n ? `<li>${t.n - t.an} partidas sin analizar: ábrelas y pulsa 🤖 Analizar y comentar.</li>` : ""}</ul>`;
  }
  $("statsOut").innerHTML = html;
}

// ---------------------------------------------------------------- fichero abierto (colección en memoria)
function openCollection(games, name) {
  S.coll = games.map((g, i) => { g._i = i + 1; return g; });
  S.collName = name;
  $("collCount").textContent = S.coll.length;
  explorerIndex = null;
  renderCollection();
}
function renderCollection() {
  const q = $("dbFilterInput").value.trim().toLowerCase();
  const list = S.coll.filter(g => !q || [g.headers.PB, g.headers.PW, g.headers.EV, g.headers.RE, g.headers.DT].join(" ").toLowerCase().includes(q));
  $("collBody").innerHTML = list.slice(0, 2000).map(g => `<tr data-ci="${g._i}"><td>${g._i}</td><td>${esc(g.headers.PB || "?")}</td><td>${esc(g.headers.PW || "?")}</td><td class="hide-sm">${esc(g.headers.EV || "")} ${esc(g.headers.DT || "")}</td><td>${esc(g.headers.RE || "")}</td>
    <td class="row-actions"><button class="sm-btn" data-csave="${g._i}" title="Guardar en la biblioteca">💾</button></td></tr>`).join("") || '<tr><td colspan="6" class="small">Ningún fichero abierto.</td></tr>';
  $("dbStatus").textContent = S.coll.length ? `${list.length} de ${S.coll.length} partidas${S.collName ? " · " + S.collName : ""}${list.length > 2000 ? " (se muestran 2000)" : ""}` : "";
  return list;
}
async function saveCollGames(list) {
  for (const g of list) {
    const h = g.headers;
    await DB.put("games", { title: [h.PB || "Negras", h.PW || "Blancas"].join(" – "), fav: false, tags: [], data: Sgf.toJSON(g), pb: h.PB || "", pw: h.PW || "", re: h.RE || "", dt: h.DT || "", ev: h.EV || "", size: g.size,
      moves: Sgf.mainline(g.root).filter(n => n.move).length, analysed: false, created: Date.now(), updated: Date.now() });
  }
  invalidateLib();
  toast(list.length === 1 ? "Partida guardada en la biblioteca" : `${list.length} partidas guardadas en la biblioteca`);
  renderLibrary();
}

// ---------------------------------------------------------------- explorador de aperturas (simetrías)
let explorerIndex = null;
const ZX = {};
function zTable(n) {
  if (ZX[n]) return ZX[n];
  const t = new Int32Array(n * n * 2 * 2);
  let x = 0x51A3 ^ n;
  for (let i = 0; i < t.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; t[i] = x; }
  return (ZX[n] = t);
}
// clave canónica de una posición: la mínima de las 8 simetrías, y cuál es
function canonical(s) {
  const n = s.n, z = zTable(n);
  const h = new Array(8).fill(0).map(() => [0, 0]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = s.b[Go.pt(s, x, y)];
    if (c !== 1 && c !== 2) continue;
    for (let t = 0; t < 8; t++) {
      const [a, b] = Sgf.transform(x, y, n, t), k = ((b * n + a) * 2 + c - 1) * 2;
      h[t][0] ^= z[k]; h[t][1] ^= z[k + 1];
    }
  }
  let best = -1, bk = null;
  for (let t = 0; t < 8; t++) { const k = (h[t][0] >>> 0) + ":" + (h[t][1] >>> 0) + ":" + s.turn; if (bk === null || k < bk) { bk = k; best = t; } }
  return { key: bk, t: best };
}
async function buildExplorer() {
  const idx = new Map();
  const games = (await libGames()).map(r => ({ g: null, r })).concat(S.coll.map(g => ({ g })));
  let count = 0;
  for (const it of games.slice(0, 5000)) {
    const g = it.g || Sgf.fromJSON(it.r.data);
    if (it.r) g.headers.RE = it.r.re || g.headers.RE;
    const re = /^([BW])\+/i.exec(g.headers.RE || ""), win = re ? (re[1].toUpperCase() === "B" ? 1 : 2) : 0;
    const line = Sgf.mainline(g.root);
    for (let i = 0; i < Math.min(line.length - 1, 40); i++) {
      const nd = line[i], nx = line[i + 1];
      if (!nx.move) break;
      const s = Sgf.stateAt(g, nd);
      const { key, t } = canonical(s);
      const mv = nx.move.x < 0 ? "pass" : Sgf.transform(nx.move.x, nx.move.y, g.size, t).join(",");
      const k = g.size + "|" + key;
      let e = idx.get(k); if (!e) idx.set(k, e = new Map());
      const r = e.get(mv) || { n: 0, b: 0, w: 0 };
      r.n++; if (win === 1) r.b++; if (win === 2) r.w++;
      e.set(mv, r);
    }
    // liberar la caché de posiciones de las partidas de la biblioteca
    if (it.r) Sgf.walk(g.root, n => { n._st = null; });
    count++;
  }
  explorerIndex = { idx, count };
}
async function renderExplorer() {
  if (S.overlay) { $("explorerBody").innerHTML = '<tr><td colspan="3" class="small">—</td></tr>'; return; }
  if (!explorerIndex) { $("explorerInfo").textContent = "preparando…"; await buildExplorer(); }
  const s = curState();
  const { key, t } = canonical(s);
  const e = explorerIndex.idx.get(S.game.size + "|" + key);
  $("explorerInfo").textContent = `${explorerIndex.count} partidas`;
  if (!e) { $("explorerBody").innerHTML = '<tr><td colspan="3" class="small">Esta posición no aparece en tus partidas.</td></tr>'; return; }
  const inv = Sgf.inverse(t);
  const rows = [...e.entries()].sort((a, b) => b[1].n - a[1].n).map(([mv, r]) => {
    let xy = [-1, -1];
    if (mv !== "pass") { const [a, b] = mv.split(",").map(Number); xy = Sgf.transform(a, b, S.game.size, inv); }
    const dec = r.b + r.w, pb = dec ? Math.round(r.b / dec * 100) : 0;
    return `<tr data-ex="${xy.join(",")}"><td><b>${coordName(xy)}</b></td><td class="num">${r.n}</td><td><div class="wdl-bar">${dec ? `<div class="wdl-b" style="width:${pb}%">${pb >= 15 ? pb + "%" : ""}</div><div class="wdl-w" style="width:${100 - pb}%">${100 - pb >= 15 ? 100 - pb + "%" : ""}</div>` : '<div class="wdl-b" style="width:100%;opacity:.4">sin resultado</div>'}</div></td></tr>`;
  });
  $("explorerBody").innerHTML = rows.join("");
}
function renderOpeningsStatic() {
  $("cornerBody").innerHTML = CORNER_POINTS.map((c, i) => `<tr data-corner="${i}"><td><b>${esc(c.name)}</b></td><td>${c.pt}</td><td class="hide-sm small">${esc(c.idea)}</td></tr>`).join("");
  $("fusekiList").innerHTML = FUSEKI.map((f, i) => `<button class="sm-btn" data-fuseki="${i}" title="${esc(f.idea)}">${esc(f.name)}</button>`).join("") +
    '<span class="small">Pulsa uno para verlo como partida nueva de 19×19 (negras juegan las de su formación).</span>';
  $("openingTips").innerHTML = OPENING_TIPS.map(t => `<li>${esc(t)}</li>`).join("");
}

function bindLibrary() {
  $("saveGame").onclick = async () => { await saveToLibrary(); toast("💾 Guardada en la biblioteca"); };
  $("favToggle").onclick = () => { S.fav = !S.fav; $("favToggle").classList.toggle("on", S.fav); $("favToggle").textContent = S.fav ? "★" : "☆"; if (S.fav && !S.libId) saveToLibrary(); else markDirty(); };
  $("gameName").addEventListener("change", () => markDirty());
  $("gameTags").addEventListener("change", () => markDirty());
  $("markBtn").onclick = openMarkModal; $("markBtn2").onclick = openMarkModal;
  $("markSaveBtn").onclick = saveMark;
  $("libFilter").oninput = renderLibrary; $("libTagFilter").onchange = renderLibrary; $("libSort").onchange = renderLibrary;
  $("libBody").addEventListener("click", async ev => {
    const del = ev.target.closest("[data-del]"), star = ev.target.closest("[data-star]");
    if (ev.target.classList.contains("lib-sel")) { updateLibSel(); return; }
    if (del) { if (!confirm("¿Borrar esta partida de la biblioteca?")) return; await DB.del("games", +del.dataset.del); if (S.libId === +del.dataset.del) { S.libId = null; renderSaveState(); } invalidateLib(); renderLibrary(); return; }
    if (star) { const g = (await libGames()).find(x => x.id === +star.dataset.star); g.fav = !g.fav; await DB.put("games", g); invalidateLib(); renderLibrary(); return; }
    const tr = ev.target.closest("tr[data-id]"); if (tr) openLibGame(+tr.dataset.id);
  });
  $("libSelectAll").onchange = () => { document.querySelectorAll(".lib-sel").forEach(i => (i.checked = $("libSelectAll").checked)); updateLibSel(); };
  $("libDeleteSel").onclick = async () => {
    const ids = selectedLibIds(); if (!ids.length || !confirm(`¿Borrar ${ids.length} partidas de la biblioteca?`)) return;
    for (const id of ids) await DB.del("games", id);
    if (ids.includes(S.libId)) { S.libId = null; renderSaveState(); }
    invalidateLib(); renderLibrary();
  };
  $("libExportSgf").onclick = async () => {
    const ids = selectedLibIds(), games = await libGames();
    const list = ids.length ? games.filter(g => ids.includes(g.id)) : games;
    download("biblioteca-gobase.sgf", Sgf.serializeAll(list.map(g => Sgf.fromJSON(g.data))));
  };
  $("libBackup").onclick = async () => download("gobase-copia-" + today() + ".json", JSON.stringify({ app: "GoBase", version: APP_VERSION, games: await libGames(), marks: await libMarks() }), "application/json");
  $("libRestore").onclick = () => $("jsonFileInput").click();
  $("jsonFileInput").onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      if (o.game && !o.games) { loadGame(Sgf.fromJSON(o.game), { title: o.title }); return; }
      if (!Array.isArray(o.games)) throw new Error("formato");
      const idMap = new Map();
      for (const g of o.games) { const old = g.id; delete g.id; const id = await DB.put("games", g); idMap.set(old, id); }
      for (const m of o.marks || []) { delete m.id; m.gameId = idMap.get(m.gameId) ?? null; await DB.put("marks", m); }
      invalidateLib(); markCache = null; renderLibrary(); renderStorage();
      toast(`Restauradas ${o.games.length} partidas y ${(o.marks || []).length} marcadores`);
    } catch (e) { toast("Ese fichero no es una copia de GoBase"); }
  };
  document.querySelectorAll(".sub-btn").forEach(b => b.onclick = () => {
    document.querySelectorAll(".sub-btn").forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll(".subpane").forEach(p => (p.hidden = p.id !== "sub-" + b.dataset.sub));
    if (b.dataset.sub === "marks") renderMarks();
    if (b.dataset.sub === "collection") renderCollection();
  });
  $("markFilter").oninput = renderMarks; $("markCatFilter").onchange = renderMarks;
  $("markList").addEventListener("click", async ev => {
    const del = ev.target.closest("[data-mdel]");
    if (del) { await DB.del("marks", +del.dataset.mdel); markCache = null; renderMarks(); renderMarkCount(); return; }
    const card = ev.target.closest("[data-mid]"); if (!card) return;
    const m = (await libMarks()).find(x => x.id === +card.dataset.mid);
    if (m && m.gameId) openLibGame(m.gameId, m.path);
  });
  $("commentSearchBtn").onclick = searchComments;
  $("commentSearch").addEventListener("keydown", ev => { if (ev.key === "Enter") searchComments(); });
  $("statsName").value = store("myName") || "";
  $("statsBtn").onclick = renderStats;
  $("closeCollBtn").onclick = () => { S.coll = []; $("collCount").textContent = 0; explorerIndex = null; renderCollection(); renderStorage(); };
  $("dbFilterInput").oninput = renderCollection;
  $("collBody").addEventListener("click", ev => {
    const sv = ev.target.closest("[data-csave]");
    if (sv) { saveCollGames([S.coll[+sv.dataset.csave - 1]]); return; }
    const tr = ev.target.closest("tr[data-ci]"); if (!tr) return;
    const g = S.coll[+tr.dataset.ci - 1];
    loadGame(g, { title: [g.headers.PB, g.headers.PW].filter(Boolean).join(" – ") });
    setTab("study");
  });
  $("saveCollFilteredBtn").onclick = () => { const list = renderCollection(); if (list.length && confirm(`¿Guardar ${list.length} partidas en la biblioteca?`)) saveCollGames(list); };
  $("persistBtn").onclick = async () => { try { const ok = await navigator.storage.persist(); toast(ok ? "🔒 Datos protegidos" : "El navegador no lo ha permitido"); renderStorage(); } catch (e) { toast("No disponible en este navegador"); } };
  $("storageRefreshBtn").onclick = renderStorage;
  $("explorerBody").addEventListener("click", ev => {
    const tr = ev.target.closest("tr[data-ex]"); if (!tr) return;
    const [x, y] = tr.dataset.ex.split(",").map(Number);
    if (S.mode === "cpu") return;
    playMove(x, y, { variation: true });
  });
  $("cornerBody").addEventListener("click", ev => {
    const tr = ev.target.closest("tr[data-corner]"); if (!tr) return;
    const c = CORNER_POINTS[+tr.dataset.corner];
    if (S.game.size !== 19 || Sgf.mainline(S.game.root).length > 1) loadGame(Sgf.newGame(19, { komi: 6.5 }));
    const xy = Go.fromGtp(19, c.pt);
    S.cur.marks = { TR: [xy] };
    renderBoard(); toast(c.name + ": " + c.pt);
  });
  $("fusekiList").addEventListener("click", ev => {
    const b = ev.target.closest("[data-fuseki]"); if (!b) return;
    const f = FUSEKI[+b.dataset.fuseki];
    loadGame(Sgf.newGame(19, { komi: 6.5 }), { title: f.name });
    const pts = f.moves.split(" ");
    // negras juegan las de la formación; blancas, las esquinas libres
    const white = ["D16", "Q4", "D4", "Q16"].filter(p => !pts.includes(p));
    let wi = 0;
    for (const p of pts) {
      const [x, y] = Go.fromGtp(19, p);
      if (curState().turn === Go.WHITE) { const w = white[wi++] || "K10"; const [a, c] = Go.fromGtp(19, w); playMove(a, c); }
      playMove(x, y);
    }
    S.cur.comment = S.cur.comment || f.idea;
    renderAll();
  });
}
