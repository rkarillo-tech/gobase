/* GoBase · código del Worker del motor (se une a core.js y engine.js en un Blob al arrancar) */
let job = null;
function stateFrom(m) {
  const s = Go.create(m.n);
  s.b.set(m.b); s.turn = m.turn; s.ko = m.ko; s.cap = m.cap.slice();
  return s;
}
function pack(res) {
  return { playouts: res.playouts, mover: res.mover, tracked: res.tracked, winrateBlack: res.winrateBlack, scoreLead: res.scoreLead, best: res.best, moves: res.moves, ownership: res.ownership };
}
function loop(j) {
  if (job !== j) return;
  const t0 = Date.now();
  while (Date.now() - t0 < 45 && j.S.playouts < j.total && Date.now() < j.deadline) j.S.run(16);
  const done = j.S.playouts >= j.total || Date.now() >= j.deadline;
  if (done || Date.now() - j.lastPost >= j.interval) {
    j.lastPost = Date.now();
    post({ type: done ? "done" : "info", id: j.id, res: pack(j.S.result(j.multi)) });
  }
  if (done) { job = null; return; }
  setTimeout(() => loop(j), 0);
}
function selfplay(m) {
  // Partida rápida de la CPU contra sí misma (para el ejercicio de contar)
  let s = Go.create(m.n);
  let passes = 0, moves = 0;
  Engine.setSeed(m.seed || Date.now());
  while (passes < 2 && moves < m.maxMoves) {
    const r = Engine.analyze(s, { komi: m.komi, playouts: m.playouts, multi: 1, passAllowed: moves > m.n * m.n * 0.6 });
    let p = r.best;
    if (p !== Go.PASS && Go.play(s, p).error) p = Go.PASS;
    s = Go.play(s, p).state;
    passes = p === Go.PASS ? passes + 1 : 0;
    moves++;
  }
  const d = Engine.estimateDead(s, { playouts: 1200 });
  post({ type: "done", id: m.id, res: { b: Array.from(s.b), turn: s.turn, cap: s.cap, dead: [...d.dead], moves } });
}
function onMsg(m) {
  if (m.cmd === "stop") { job = null; return; }
  if (m.cmd === "analyze") {
    if (m.seed) Engine.setSeed(m.seed);
    const s = stateFrom(m.pos);
    const S = new Engine.Search(s, { komi: m.komi, forbidden: m.forbidden ? new Set(m.forbidden) : null, passAllowed: m.passAllowed !== false, track: m.track ?? null });
    job = { id: m.id, S, total: m.playouts || Infinity, deadline: m.timeMs ? Date.now() + m.timeMs : Infinity, interval: m.interval || 350, lastPost: Date.now(), multi: m.multi || 5 };
    loop(job);
  } else if (m.cmd === "dead") {
    job = null;
    const s = stateFrom(m.pos);
    const d = Engine.estimateDead(s, { playouts: m.playouts || 1500 });
    post({ type: "done", id: m.id, res: { dead: [...d.dead], ownership: d.ownership } });
  } else if (m.cmd === "selfplay") {
    job = null;
    selfplay(m);
  }
}
let post = msg => self.postMessage(msg);
if (typeof window === "undefined") self.onmessage = e => onMsg(e.data);
