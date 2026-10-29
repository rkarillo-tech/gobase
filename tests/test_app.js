#!/usr/bin/env node
/* Pruebas de extremo a extremo de GoBase con Playwright (Chromium).
   Uso: npm install playwright && npx playwright install chromium && node tests/test_app.js
   Se sirve la aplicación por http en un puerto local (para probar también el service worker)
   y se comprueba que no hay errores de JavaScript en ningún momento. */
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const fallos = [];
function comprobar(cond, msg) {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) { fallos.push(msg); if (process.env.GITHUB_ACTIONS) console.log(`::error title=Prueba fallida::${msg}`); }
}

const SGF_PARTIDA = `(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[6.5]RU[Japanese]PB[Ana]PW[Luis]RE[B+5.5]DT[2026-05-01]
;B[ee]C[Tengen];W[cg];B[gc](;W[cc];B[cd];W[dc];B[ed];W[bd];B[ce];W[be];B[cf];W[bf];B[dg];W[ch];B[dh];W[gg];B[fg];W[gf];B[ge];W[hf]
;B[he];W[eh];B[di];W[fh];B[ef])(;W[gg]N[Otra idea];B[cc]))`;

function serve() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}

(async () => {
  const srv = await serve();
  const URL0 = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", e => errores.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errores.push(m.text()); });
  page.on("dialog", d => d.accept());
  const ready = async () => page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });
  const txt = sel => page.textContent(sel);
  // pulsar el punto (x, y) del tablero (0 = izquierda / arriba)
  async function clickPoint(x, y, button = "left") {
    const g = await page.evaluate(() => { const vb = document.getElementById("goban").viewBox.baseVal; const n = shownState().n; return { vb: [vb.x, vb.y, vb.width, vb.height], n, coords: settings.coords }; });
    const M = g.coords ? 38 : 24, CELL = 40;
    await page.$eval("#goban", e => e.scrollIntoView({ block: "center" }));
    const box = await (await page.$("#goban")).boundingBox();
    const px = M + x * CELL, py = M + y * CELL;
    await page.mouse.click(box.x + (px - g.vb[0]) / g.vb[2] * box.width, box.y + (py - g.vb[1]) / g.vb[3] * box.height, { button });
  }
  const gtp = async (name, button) => { const [x, y] = await page.evaluate(n => Go.fromGtp(shownState().n, n), name); await clickPoint(x, y, button); };

  try {
    await page.goto(URL0);
    await ready();
    console.log("Arranque");
    comprobar(await page.$$eval("#goban circle", c => c.length) >= 9, "dibuja el tablero de 19×19 con sus puntos estrella");
    comprobar((await txt("#infoBanner")).includes("19×19"), "cabecera con tamaño, komi y reglas");

    console.log("Jugar y reglas");
    await page.evaluate(() => { $("ngSize").value = "9"; $("ngHandicap").value = "0"; newGameFromModal(); });
    await gtp("E5"); await gtp("E6"); await gtp("D6"); await gtp("A1"); await gtp("F6"); await gtp("A2");
    await gtp("E7");
    comprobar(await page.evaluate(() => Sgf.moveNumber(S.cur)) === 7, "se juegan piedras alternando colores");
    comprobar(await page.evaluate(() => curState().b[Go.pt(curState(), 4, 3)]) === 0 && (await txt("#blackCaps")).startsWith("1"), "captura de la piedra blanca rodeada (E6) y contador de capturas");
    await gtp("E5");
    comprobar((await txt("#statusText")).includes("ocupado"), "avisa de un punto ocupado");
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
    comprobar(await page.evaluate(() => Sgf.moveNumber(S.cur)) === 5, "navegar con las flechas");
    await gtp("J9");
    comprobar(await page.evaluate(() => S.cur.parent.children.length) === 2, "jugar en mitad de la partida crea una variante");
    comprobar(await page.$$eval("#moves .var", v => v.length) === 1, "la variante aparece en la lista de jugadas");
    await page.click("#passBtn");
    comprobar(await page.evaluate(() => S.cur.move.x === -1), "pasar");
    await page.fill("#moveTyped", "C3"); await page.press("#moveTyped", "Enter");
    comprobar(await page.evaluate(() => coordName([S.cur.move.x, S.cur.move.y])) === "C3", "escribir la jugada con el teclado");

    console.log("SGF");
    await page.fill("#moveInput", SGF_PARTIDA);
    await page.click("#importBtn");
    comprobar((await txt("#importResult")).includes("✔"), "importa un SGF con variantes");
    comprobar(await page.evaluate(() => Sgf.mainline(S.game.root).length) === 26 && (await txt("#blackName")) === "Ana", "jugadas y datos de la partida");
    await page.keyboard.press("End");
    comprobar(await page.evaluate(() => Sgf.moveNumber(S.cur)) === 25, "Fin lleva a la última jugada");
    const dl = page.waitForEvent("download");
    await page.click("#downloadSgfBtn");
    const sgfFile = await (await dl).path();
    const sgfOut = fs.readFileSync(sgfFile, "utf8");
    comprobar(/PB\[Ana\]/.test(sgfOut) && /N\[Otra idea\]/.test(sgfOut) && /\(;W\[gg\]/.test(sgfOut.replace(/\n/g, "")), "descarga el .sgf con datos y variantes");

    console.log("Motor");
    await page.click("#liveToggle");
    await page.waitForFunction(() => S.engine && S.engine.playouts > 500, null, { timeout: 15000 });
    comprobar(await page.$$eval("#engineLines .pv-line", l => l.length) >= 3, "el análisis continuo muestra varias candidatas");
    comprobar(/partidas simuladas/.test(await txt("#engineMeta")), "muestra las simulaciones y la ventaja");
    await page.click("#ownToggle");
    await page.waitForTimeout(600);
    comprobar(await page.evaluate(() => settings.own && !!S.engine), "mapa de territorio");
    await page.click("#ownToggle");
    await page.click("#liveToggle");

    console.log("Análisis de la partida");
    await page.evaluate(() => { settings.analysis = 1; });
    await page.click("#analyseBtn");
    await page.waitForFunction(() => !S.analysing && document.getElementById("reportBox").classList.contains("show"), null, { timeout: 120000 });
    comprobar(await page.evaluate(() => Sgf.mainline(S.game.root).every(n => n.eval && n.eval.wr != null)), "evalúa todas las posiciones");
    comprobar(await page.$$eval("#evalChartSvg path", p => p.length) >= 2, "dibuja el gráfico");
    comprobar((await txt("#reportExtra")).includes("Resumen") && (await txt("#repBMatch")) !== "–", "informe con resumen y coincidencia con el motor");
    const nErr = await page.evaluate(() => Sgf.mainline(S.game.root).filter(n => n.nag === "?" || n.nag === "??").length);
    if (nErr) {
      await page.click("#retryStart [data-retry='0']");
      comprobar(!!(await page.evaluate(() => S.overlay)) && !(await page.isHidden("#retryBox")), "«Aprende de tus errores» abre el primer error");
      await page.click("#retryBox [data-r='end']");
    } else comprobar(true, "(sin errores que repasar en esta partida)");

    console.log("Biblioteca y marcadores");
    await page.fill("#gameName", "Ana contra Luis");
    await page.click("#saveGame");
    await page.waitForFunction(() => S.libId);
    comprobar((await txt("#saveState")).includes("Guardada"), "guarda la partida en la biblioteca");
    await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
    await page.keyboard.press("m");
    await page.fill("#markNote", "Ojo con el corte");
    await page.click("#markSaveBtn");
    await page.waitForTimeout(300);
    await page.click('.tab-btn[data-tab="library"]');
    await page.waitForTimeout(300);
    comprobar(await page.$$eval("#libBody tr[data-id]", r => r.length) === 1, "la partida aparece en la biblioteca");
    await page.click('.sub-btn[data-sub="marks"]');
    await page.waitForTimeout(200);
    comprobar((await txt("#markList")).includes("Ojo con el corte"), "el marcador aparece con su nota");
    await page.click('.sub-btn[data-sub="search"]');
    await page.fill("#commentSearch", "tengen");
    await page.click("#commentSearchBtn");
    await page.waitForTimeout(300);
    comprobar((await page.$$("#searchResults .mark-card")).length >= 1, "busca en los comentarios");
    await page.click('.sub-btn[data-sub="stats"]');
    await page.fill("#statsName", "Ana");
    await page.click("#statsBtn");
    await page.waitForTimeout(400);
    comprobar((await txt("#statsOut")).includes("Victorias"), "estadísticas por jugador");
    await page.click('.tab-btn[data-tab="openings"]');
    await page.keyboard.press("Home");
    await page.waitForTimeout(400);
    comprobar((await txt("#explorerBody")).includes("E5"), "el explorador encuentra la primera jugada en tus partidas");

    console.log("Recarga: partida y biblioteca se conservan");
    await page.reload(); await ready();
    comprobar((await page.inputValue("#gameName")) === "Ana contra Luis" && await page.evaluate(() => !!S.libId), "recuerda la partida al recargar");
    comprobar(await page.evaluate(async () => (await libGames()).length) === 1, "la biblioteca sigue ahí");

    console.log("Tarjetas");
    await page.click('.tab-btn[data-tab="train"]');
    await page.click("#cardsAllBtn");
    await page.waitForFunction(() => S.overlay && S.overlay.title.includes("🧠"));
    comprobar(!(await page.isHidden("#trainFeedback")), "la tarjeta del marcador se abre");
    await page.click("#exBackBtn");

    console.log("Problemas");
    await page.evaluate(() => startProblem(PROBLEMS.findIndex(p => p.id === "ld-recta3-m")));
    await gtp("A9");
    await page.waitForFunction(() => P && (P.failed || P.done));
    comprobar(await page.evaluate(() => P.failed) && (await txt("#probBox")).includes("✗"), "una jugada equivocada se refuta");
    await page.click('#probBox [data-pb="retry"]');
    await gtp("B9");
    await page.waitForFunction(() => P && !P.busy && P.correct >= 1);
    comprobar(await page.evaluate(() => !P.failed), "la jugada vital es correcta y la CPU responde");
    for (let k = 0; k < 6 && !(await page.evaluate(() => P.done)); k++) {
      const m = await page.evaluate(() => { const s = S.overlay.state; const r = Go.solveLD(s, { target: P.target, region: P.region }); const p = r.moves.find(x => x !== Go.PASS); return p == null ? null : Go.moveName(P.start, p); });
      if (!m) break;
      await gtp(m);
      await page.waitForFunction(() => P && !P.busy);
    }
    comprobar(await page.evaluate(() => P.done) && (await txt("#probBox")).includes("✔"), "problema de vida y muerte resuelto");
    await page.evaluate(() => startProblem(PROBLEMS.findIndex(p => p.id === "cap-escalera")));
    await gtp("F5");
    await page.waitForFunction(() => P && (P.failed || P.done));
    comprobar(await page.evaluate(() => P.failed), "el atari del lado equivocado deja escapar a la piedra");
    await page.click('#probBox [data-pb="retry"]');
    await gtp("E6");
    await page.waitForFunction(() => P && !P.busy);
    for (let k = 0; k < 8 && !(await page.evaluate(() => P.done || P.failed)); k++) {
      const m = await page.evaluate(() => { const s = S.overlay.state; for (const p of Go.points(s)) { if (s.b[p]) continue; const r = Go.play(s, p); if (r.error) continue; if (r.state.b[P.target] !== 2 || Go.readCapture(r.state, P.target).captured) return Go.moveName(P.start, p); } return null; });
      await gtp(m);
      await page.waitForFunction(() => P && !P.busy);
    }
    comprobar(await page.evaluate(() => P.done), "escalera resuelta jugando contra la defensa perfecta");
    await page.click('#probBox [data-pb="end"]');
    comprobar(await page.$$eval("#probGrid .prob-card.done", c => c.length) === 2, "los problemas resueltos quedan marcados");

    console.log("Jugar contra la CPU y recuento");
    await page.evaluate(() => { $("cpuSize").value = "9"; $("cpuColor").value = "1"; $("cpuLevel").value = "1"; $("cpuHandicap").value = "0"; $("cpuMain").value = "0"; startCpuFromModal(); });
    await gtp("E5");
    await page.waitForFunction(() => Sgf.moveNumber(lastNode()) === 2 && !S.cpu.thinking, null, { timeout: 15000 });
    comprobar(true, "la CPU responde a tu jugada");
    await gtp("C3");
    await page.waitForFunction(() => Sgf.moveNumber(lastNode()) === 4 && !S.cpu.thinking, null, { timeout: 15000 });
    await page.click('#cpuBox [data-c="undo"]');
    comprobar(await page.evaluate(() => Sgf.moveNumber(lastNode())) === 2, "deshacer quita tu jugada y la de la CPU");
    await page.click('#cpuBox [data-c="resign"]');
    comprobar((await page.evaluate(() => S.game.headers.RE)) === "W+R" && (await txt("#cpuBox")).includes("🏁"), "rendirse termina la partida (W+R)");
    await page.click('#cpuBox [data-c="leave"]');

    await page.click('.tab-btn[data-tab="study"]');
    await page.fill("#moveInput", "(;SZ[9]KM[0.5];B[cc];W[gg];B[cg];W[gc];B[ee];W[ec];B[dc];W[ed];B[de];W[fe];B[ef];W[ff];B[eg];W[fg];B[eh];W[fh];B[ei];W[fi];B[db];W[eb];B[da];W[ea];B[];W[])");
    await page.click("#importBtn");
    await page.keyboard.press("End");
    await page.click('.tab-btn[data-tab="score"]');
    await page.click("#scoreBtn");
    await page.waitForFunction(() => S.score && S.score.res, null, { timeout: 15000 });
    const res1 = await page.evaluate(() => S.score.res.diff);
    comprobar((await txt("#scResult")).includes("Ganan"), "recuento con resultado (" + res1 + ")");
    await page.evaluate(() => { const s = S.score.state; const p = Go.points(s).find(q => s.b[q] === 2); scoreClick(...Go.xy(s, p)); });
    comprobar(await page.evaluate(d => S.score.res.diff !== d, res1), "marcar un grupo como muerto cambia el resultado");
    await page.click("#scSetResultBtn");
    comprobar(/^[BW]\+/.test(await page.evaluate(() => S.game.headers.RE)), "pone el resultado en la partida");
    await page.click("#scExitBtn");

    console.log("Editor, marcas e impresión");
    await page.click("#editPosBtn");
    await gtp("A1"); await page.click('#edTools [data-ed="2"]'); await gtp("B1");
    await page.click("#edDoneBtn");
    comprobar(await page.evaluate(() => { const s = curState(); return s.b[Go.pt(s, 0, 8)] === 1 && s.b[Go.pt(s, 1, 8)] === 2; }), "colocar piedras de los dos colores");
    await page.click('.tab-btn[data-tab="study"]');
    await page.click('#markTools [data-mk="TR"]');
    await gtp("E5");
    await page.click('#markTools [data-mk="TR"]');
    comprobar(await page.evaluate(() => (S.cur.marks.TR || []).length === 1), "marca de triángulo en el tablero");
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await page.click("#printBtn");
    await page.waitForTimeout(200);
    comprobar(await page.evaluate(() => window.__printed && document.querySelectorAll("#printView figure").length >= 1), "vista de impresión con figuras numeradas");

    console.log("Enlace");
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click("#linkBtn");
    await page.waitForTimeout(400);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    comprobar(/#sgf=z/.test(link), "copia un enlace comprimido");
    const p2 = await ctx.newPage();
    p2.on("pageerror", e => errores.push(e.message));
    await p2.goto(link); await p2.waitForSelector('body[data-ready="1"]');
    comprobar(await p2.evaluate(() => Sgf.mainline(S.game.root).length) > 20, "el enlace abre la partida");
    await p2.close();

    console.log("Móvil");
    const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mob.on("pageerror", e => errores.push(e.message));
    await mob.goto(URL0); await mob.waitForSelector('body[data-ready="1"]');
    const over = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar(over <= 1, "sin desplazamiento horizontal en el móvil");
    const navTop = await mob.evaluate(() => document.getElementById("navControls").getBoundingClientRect().top - document.getElementById("goban").getBoundingClientRect().bottom);
    comprobar(navTop >= 0 && navTop < 120, "los botones de navegación quedan justo debajo del tablero");
    await mob.close();

    console.log("Sin conexión (service worker)");
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; });
    comprobar(sw, "registra el service worker");
  } catch (e) {
    comprobar(false, "error inesperado: " + (e.stack || e.message));
  }
  comprobar(!errores.length, "sin errores de JavaScript" + (errores.length ? ": " + errores.slice(0, 5).join(" | ") : ""));
  await browser.close();
  srv.close();
  console.log(fallos.length ? `\n${fallos.length} pruebas fallidas` : "\nTodas las pruebas de la aplicación pasan.");
  process.exit(fallos.length ? 1 : 0);
})();
