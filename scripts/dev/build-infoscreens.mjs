#!/usr/bin/env node
/**
 * Die zwei Infoscreens: Wartung und Störung (WI-0127 SYS-6; Bauplan SYS-0001 §5.1, §6.6; Betreiber 2026-10-10, WI-0119 F1: „zwei
 * getrennte Seiten … dieselbe visuelle Hülle, getrennte Inhalte und getrennte Auslöser“). Grundlage ist die abgenommene Vorlage
 * `project-control/mockups/wi-0119/infoscreen-bau.py` (Blatt WI-0119 Fassung 2, Abschnitt C), hier in Node statt Python.
 *
 * - **Wartung** (`wartung.html`) ist bewusst gesetzt: die Wartungsdatei auf dem Server, und im eingeschränkten Betrieb das 403 der
 *   Tür. **Störung** (`stoerung.html`) ist der technische Rückfall: 500, 502, 504 und ein Scheitern der Türfrage. Welche Seite kommt,
 *   entscheiden Nginx, Tür und Betriebszustand, nie der Browser. Ausgeliefert werden sie von Nginx aus Claudios root-Verzeichnis,
 *   mit 503 und dem Header `X-Avesmaps-Infoscreen` (SYS-0001 §4.3, §5.1).
 * - 🔴 **Statisch und autark:** kein Skript, keine Schrift und kein Bild von außen, keine fremde Adresse. Die Wortmarke steht als
 *   Pfad in der Hausschrift (Markup, kein Bild, kein Schriftabruf), das Bild (Sextant) als `data:`-WebP, das CSS inline. So gehen
 *   beide Seiten auch dann, wenn Fastify, das Frontend und die Datenbank tot sind, und die CSP der Stage hält sie (`img-src 'self'
 *   data:`, `style-src 'self' 'unsafe-inline'`, `font-src 'self'` - deshalb keine eingebettete Schrift).
 * - Fließtext in der Rückfallschrift des Kanons ohne die Hausschrift: Wer sie installiert hat, sähe sonst eine andere Seite als alle.
 * - Farben, Schatten, Radius und Schriftgrößen aus `config/design-canon/avesmaps.json`, hell und dunkel über `prefers-color-scheme`.
 * - Deutsch mit einer englischen Zeile (`lang="en"`), ohne Anrede; die Seite lädt alle fünf Minuten von selbst neu.
 * - Je Seite `<meta name="avesmaps-infoscreen" content="wartung|stoerung">`, damit eine Probe die Seite am Inhalt erkennt.
 *
 * Bytegleich reproduzierbar: kein Zeitstempel, keine Zufallszahl. `apps/web/test/infoscreen.test.ts` prüft die Regeln und dass die
 * Dateien dem Generator entsprechen.
 *
 *   node scripts/dev/build-infoscreens.mjs
 *
 * Ausgabe: `apps/server/static/infoscreen/` (🔴 nie unter `ops/**`: dorthin übernimmt Claudio die Dateien selbst, SYS-0001 §5.1).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const INFOSCREEN_DIR = join("apps", "server", "static", "infoscreen");
export const INFOSCREEN_FILES = ["wartung.html", "stoerung.html"];

/** Die Wortmarke als SVG-Pfad in Font-Einheiten (y nach unten, Grundlinie bei der Oberlänge), auf ganze Einheiten gerundet. */
function wortmarke(fontPath, text) {
    const font = fontkit.openSync(fontPath);
    const run = font.layout(text);
    let x = 0;
    const teile = [];
    run.glyphs.forEach((glyph, index) => {
        const position = run.positions[index];
        const pfad = glyph.path.transform(1, 0, 0, -1, x + position.xOffset, font.ascent - position.yOffset).toSVG();
        teile.push(pfad.replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g, (zahl) => String(Math.round(Number(zahl)) + 0)));
        x += position.xAdvance;
    });
    return { pfad: teile.join(""), breite: Math.round(x), hoehe: Math.round(font.ascent - font.descent) };
}

function stil(canon) {
    const hell = canon.colour;
    const dunkel = { ...hell, ...canon.colourDark };
    const groesse = canon.typography.size;
    // Die Rückfallschrift: der Stapel der Oberfläche ohne die Hausschrift (siehe oben).
    const rueckfall = canon.typography.fontFamily
        .split(",")
        .map((teil) => teil.trim())
        .filter((teil) => !teil.includes("Faculty Glyphic"))
        .join(",");
    const farben = (tafel, schatten) =>
        `--seite:${tafel.pageBg};--panel:${tafel.panel};--kante:${tafel.border};--linie:${tafel.divider};` +
        `--text:${tafel.text};--stark:${tafel.textStrong};--leise:${tafel.textMuted};--schatten:${schatten}`;
    const raum = canon.space;
    return [
        `:root{color-scheme:light dark;${farben(hell, canon.shadow.panel)}}`,
        `@media (prefers-color-scheme:dark){:root{${farben(dunkel, canon.shadowDark.panel)}}}`,
        "*{box-sizing:border-box}",
        "html{hyphens:auto}",
        `body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;` +
            `padding:${raum["24"]}px ${raum["12"]}px;background:var(--seite);color:var(--text);` +
            `font:${groesse.toast}px/${canon.typography.leading.normal} ${rueckfall}}`,
        `main{width:100%;max-width:34rem;padding:${raum["24"]}px ${raum["24"]}px ${raum["16"]}px;` +
            `border:1px solid var(--kante);border-radius:${canon.radius.lg}px;background:var(--panel);box-shadow:var(--schatten)}`,
        `.marke{display:flex;align-items:center;gap:${raum["10"]}px;margin:0 0 ${raum["16"]}px}`,
        ".marke img{width:46px;height:46px;flex:none}",
        ".marke svg{height:30px;width:auto;fill:var(--stark)}",
        `h1{margin:0 0 ${raum["8"]}px;color:var(--stark);font-size:${groesse.display}px;font-weight:400;` +
            `line-height:${canon.typography.leading.snug}}`,
        `p{margin:0 0 ${raum["8"]}px}`,
        `.leise{color:var(--leise);font-size:${groesse.body}px}`,
        `.en{margin:${raum["12"]}px 0 0;padding-top:${raum["10"]}px;border-top:1px solid var(--linie);color:var(--leise);` +
            `font-size:${groesse.body}px}`,
        `footer{margin-top:${raum["12"]}px;color:var(--leise);font-size:${groesse.caption}px}`,
    ].join("\n");
}

function seite({ art, titel, ueberschrift, saetze, englisch }, marke, bild, css) {
    const absaetze = saetze.map((satz) => `<p>${satz}</p>`).join("\n");
    return `<!doctype html>
<!--
  Avesmaps-Infoscreen „${art}“ (WI-0127 SYS-6, SYS-0001 §6.6): ausgeliefert von Nginx, nicht von der Anwendung. Statisch: kein
  Skript, keine Schrift und keine Adresse von außen, Bild nur als data:, CSS inline. Erzeugt von scripts/dev/build-infoscreens.mjs
  aus dem Designkanon; nicht von Hand ändern.
-->
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="avesmaps-infoscreen" content="${art}">
<meta http-equiv="refresh" content="300">
<title>${titel}</title>
<style>
${css}
</style>
</head>
<body>
<main>
<div class="marke"><img src="${bild}" alt="" width="46" height="46"><svg viewBox="0 0 ${marke.breite} ${marke.hoehe}" role="img" aria-label="Avesmaps"><path d="${marke.pfad}"/></svg></div>
<h1>${ueberschrift}</h1>
${absaetze}
<p class="en" lang="en">${englisch}</p>
<footer>Avesmaps, die Karte Aventuriens · Nicht-kommerzielles Fanprojekt</footer>
</main>
</body>
</html>
`;
}

/**
 * Die Inhalte, wörtlich aus dem abgenommenen Blatt WI-0119 Fassung 2 (Abschnitt C, B „zwei Seiten“). Wartung sagt „bewusst
 * geschlossen“, Störung „gerade gestört“; beide versprechen nur, was stimmt: Links bleiben gültig, die Seite lädt selbst neu. Die
 * englischen Sätze des Blatts stehen in EINER Zeile.
 */
const SEITEN = [
    {
        datei: "wartung.html",
        art: "wartung",
        titel: "Avesmaps: Wartung",
        ueberschrift: "Die Karte wird gerade gewartet.",
        saetze: [
            "Wir haben sie für Arbeiten kurz geschlossen. Danach ist sie wie gewohnt da.",
            "Links, Routen und Kurzlinks bleiben gültig.",
            '<span class="leise">Diese Seite lädt alle fünf Minuten von selbst neu.</span>',
        ],
        englisch:
            "The map is closed for maintenance and will be back as usual. Links, routes and short links stay valid; this page reloads every five minutes.",
    },
    {
        datei: "stoerung.html",
        art: "stoerung",
        // Vali 2026-11-01: „Die Karte ist gerade gestört.“ beim offline screen überarbeiten zu „Wartungsarbeiten, wir sind bald wieder da.“
        titel: "Avesmaps: Wartungsarbeiten",
        ueberschrift: "Wartungsarbeiten, wir sind bald wieder da.",
        saetze: [
            "Links, Routen und Kurzlinks bleiben gültig.",
            '<span class="leise">Diese Seite lädt alle fünf Minuten von selbst neu.</span>',
        ],
        englisch:
            "Maintenance in progress, we will be back soon. Links, routes and short links stay valid; this page reloads every five minutes.",
    },
];

/** Beide Seiten als Text, je Dateiname. */
export function renderInfoscreens(root = repositoryRoot) {
    const canon = JSON.parse(readFileSync(join(root, "config", "design-canon", "avesmaps.json"), "utf8"));
    const marke = wortmarke(join(root, "assets", "fonts", "FacultyGlyphic-Regular.ttf"), "Avesmaps");
    const bild = `data:image/webp;base64,${readFileSync(join(root, "apps", "web", "public", "icons", "menu", "sextant.webp")).toString("base64")}`;
    const css = stil(canon);
    return Object.fromEntries(SEITEN.map((eintrag) => [eintrag.datei, seite(eintrag, marke, bild, css)]));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const ziel = join(repositoryRoot, INFOSCREEN_DIR);
    mkdirSync(ziel, { recursive: true });
    for (const [datei, inhalt] of Object.entries(renderInfoscreens())) {
        writeFileSync(join(ziel, datei), inhalt, "utf8");
        console.log(`${datei}: ${String(Buffer.byteLength(inhalt))} Bytes -> ${join(INFOSCREEN_DIR, datei)}`);
    }
}
