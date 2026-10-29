#!/usr/bin/env node
/* Genera los PNG del icono a partir de assets/icon.svg (requiere Playwright con Chromium).
     node tools/gen_icons.js
   Produce: assets/icon-32.png (pestaña), icon-180.png (iOS, a sangre), icon-192.png y icon-512.png (aplicación instalada)
   e icon-maskable-512.png (con margen para los iconos adaptativos de Android). */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const svg = fs.readFileSync(path.join(ROOT, "assets", "icon.svg"), "utf8");
const square = svg.replace('rx="14"', 'rx="0"');
const maskable = square.replace('<rect width="64" height="64" rx="0" fill="#0b0e14"/>', '<rect width="64" height="64" fill="#0b0e14"/><g transform="translate(6.4 6.4) scale(.8)">').replace("</svg>", "</g></svg>");
const variants = { "icon-32.png": [32, svg, true], "icon-180.png": [180, square, false], "icon-192.png": [192, svg, true], "icon-512.png": [512, svg, true], "icon-maskable-512.png": [512, maskable, false] };
(async () => {
  const browser = await chromium.launch();
  for (const [name, [size, src, transparent]] of Object.entries(variants)) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const uri = "data:image/svg+xml;base64," + Buffer.from(src).toString("base64");
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="${uri}" width="${size}" height="${size}">`);
    await page.waitForTimeout(50);
    await page.screenshot({ path: path.join(ROOT, "assets", name), omitBackground: transparent });
    await page.close();
  }
  await browser.close();
  console.log("Iconos generados en assets/: " + Object.keys(variants).join(", "));
})();
