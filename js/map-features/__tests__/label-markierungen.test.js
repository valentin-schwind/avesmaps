// Der Trichter: welchen Kasten traegt eine Beschriftung -- und hebt er ihr Zoomband auf?
//
// 💣 ZWEI WERKZEUGE MAL DREI LESER SIND SECHS STELLEN. Der Trichter existiert, damit die Frage
// „traegt dieses Label einen Kasten?" genau EINMAL beantwortet wird -- vom waagerechten Namen
// (CSS-Klasse), vom gebogenen (gemalte Farbe) und von der Sichtbarkeit. Wer eine der drei an einem
// Werkzeug vorbeifuehrt, bekommt einen Kasten ohne Sichtbarkeit oder umgekehrt, und beides sieht
// aus wie ein halb gezeichnetes Bild.
//
// ⭐ Der Test FAEHRT den Trichter mit zwei gefaelschten Werkzeugen, statt seinen Quelltext zu lesen.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/label-markierungen.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const ist = (a, b, was) => { assert.strictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };

// Der Trichter liest die zwei Werkzeuge ueber globalThis und den Farbton ueber getComputedStyle.
global.getComputedStyle = () => ({ getPropertyValue: (n) => (n === "--color-check-duplicate-label" ? " #111111 " : " #222222 ") });
global.document = { documentElement: {} };
const T = require(path.join(wurzel, "js", "map-features", "label-markierungen.js"));

const doppelt = { text: "Inoscha" };
const bunt = { text: "Rôn" };
const nichts = { text: "Gareth" };

global.avesmapsDoppelteBeschriftungMarke = (l) => l === doppelt;
global.avesmapsFreieLabelMarke = (l) => l === doppelt || l === bunt;

// ---- A. Welche Marke? -------------------------------------------------------------------------
// 🔴 Der BEFUND schlaegt den Scheinwerfer -- „Inoscha" traegt beide Fragen und bekommt „doppelt".
ist(T.avesmapsLabelMarke(doppelt), "doppelt", "der Befund gewinnt gegen den Scheinwerfer");
ist(T.avesmapsLabelMarke(bunt), "markiert", "nur der Scheinwerfer -> markiert");
ist(T.avesmapsLabelMarke(nichts), "", "keins von beiden -> keine Marke");
ist(T.avesmapsLabelMarke(null), "", "kein Label wirft nicht");

// ---- B. Die drei Leser ------------------------------------------------------------------------
ist(T.avesmapsLabelMarkeKlasse(doppelt), " map-label--doppelt", "die Klasse traegt ein fuehrendes Leerzeichen");
ist(T.avesmapsLabelMarkeKlasse(bunt), " map-label--markiert", "und nennt das jeweilige Werkzeug");
ist(T.avesmapsLabelMarkeKlasse(nichts), "", "ohne Marke keine Klasse");

ist(T.avesmapsLabelMarkeFarbe("doppelt"), "#111111", "der Befund liest seinen Token");
ist(T.avesmapsLabelMarkeFarbe("markiert"), "#222222", "der Scheinwerfer seinen");
ist(T.avesmapsLabelMarkeFarbe(""), "", "ohne Marke keine Farbe");
ist(T.avesmapsLabelMarkeFarbe("erfunden"), "", "und eine unbekannte Marke ergibt auch keine");

ist(T.avesmapsLabelMarkeHebtZoomband(doppelt), true, "ein markierter Name ueberspringt sein Zoomband");
ist(T.avesmapsLabelMarkeHebtZoomband(bunt), true, "auch der bloss angeleuchtete");
ist(T.avesmapsLabelMarkeHebtZoomband(nichts), false, "ein unmarkierter nicht");

// ---- C. Fehlt ein Werkzeug, faellt es offen aus ------------------------------------------------
delete global.avesmapsDoppelteBeschriftungMarke;
ist(T.avesmapsLabelMarke(doppelt), "markiert",
	"ohne den Befund-Melder bleibt der Scheinwerfer -- kein Absturz");
delete global.avesmapsFreieLabelMarke;
ist(T.avesmapsLabelMarke(doppelt), "", "ohne beide gar keine Marke");
ist(T.avesmapsLabelMarkeHebtZoomband(doppelt), false, "und dann auch kein Zoomband-Sprung");

// ⚠️ Ein Melder, der etwas Wahrheitswertiges statt `true` liefert, zaehlt NICHT -- sonst waere ein
// zurueckgereichter Name oder eine Zahl still eine Marke.
global.avesmapsFreieLabelMarke = () => "ja";
ist(T.avesmapsLabelMarke(bunt), "", "ein wahrheitswertiger Wert ist kein `true`");
global.avesmapsFreieLabelMarke = () => true;
ist(T.avesmapsLabelMarke(bunt), "markiert", "erst `true` zaehlt");

// ---- D. Die Verdrahtung: die drei Leser fragen wirklich den Trichter --------------------------
// 💣 Kommentare raus -- die Begruendungen im Code nennen die Funktionsnamen mehrfach.
function ohneKommentare(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((z) => z.replace(/(^|[^:])\/\/.*$/, "$1"))
		.join("\n");
}
const lies = (...t) => ohneKommentare(fs.readFileSync(path.join(wurzel, ...t), "utf8"));
const LABELS = lies("js", "map-features", "map-features-labels.js");
const KURVE = lies("js", "map-features", "map-features-path-label-canvas-overlay.js");

pruefe(LABELS.includes("avesmapsLabelMarkeKlasse(label)"), "der waagerechte Name fragt den Trichter");
pruefe(LABELS.includes("avesmapsLabelMarkeHebtZoomband(entry.label)"), "die Sichtbarkeit fragt ihn");
pruefe(KURVE.includes("avesmapsLabelMarke(label)"), "der gebogene Name fragt ihn");
pruefe(KURVE.includes("avesmapsLabelMarkeFarbe(marke)"), "und holt seine Farbe von ihm");
// 🪤 KEIN Werkzeug darf an den Lesern vorbei direkt gefragt werden -- genau so entstuenden die
// sechs Stellen wieder.
pruefe(!LABELS.includes("avesmapsFreieLabelMarke("), "der Zeichner kennt den Scheinwerfer NICHT mehr direkt");
pruefe(!KURVE.includes("avesmapsFreieLabelMarke("), "und der Kurvenmaler auch nicht");
pruefe(!LABELS.includes("avesmapsDoppelteBeschriftungMarke("), "den Befund-Melder ebenso wenig");
pruefe(!KURVE.includes("avesmapsDoppelteBeschriftungMarke("), "auf keiner der beiden Flaechen");

// 💣 Der Kasten muss NACH paintGlyphs kommen -- davor maelten die Buchstaben ihn zu.
const iPaint = KURVE.indexOf("paintGlyphs(f.glyphs, f.chars, eintrag.halo, eintrag.fill)");
const iRahmen = KURVE.indexOf("zeichneMarkierungsrahmen(f.glyphs");
pruefe(iPaint > -1 && iRahmen > iPaint, "der Kasten wird NACH den Buchstaben gemalt");
// ⚠️ Und die Marke wird beim RECHNEN in die Ablage gelegt, nicht im Maler: der laeuft je FENSTER,
// die Antwort gilt aber dem ganzen Namen.
pruefe(/marke:\s*typeof avesmapsLabelMarke === "function"/.test(KURVE),
	"die Kurvenablage merkt sich die Marke beim Rechnen");

// 💣 Das Band darf nur ODER-verknuepft sein, nie ersetzt: ohne Marke gilt es weiter.
pruefe(/\(markiert \|\| avesmapsLabelImBand\(entry\.label, bandZoom\)\)/.test(LABELS),
	"das Zoomband gilt weiter, wo keine Marke ist");

// 💣 UND NUR DAS BAND. Das Culling am Bildrand bleibt unangetastet -- sonst baut ein einziger
// gesetzter Haken Marker fuer ALLE 1017 Beschriftungen der ganzen Karte statt fuer den Ausschnitt.
// Die Mutationsprobe hat genau diese Luecke gefunden: der Test kannte die Regel „nur das Band"
// nur als Kommentar.
pruefe(/&& isLatLngInRenderBounds\(entry\.marker\.getLatLng\(\), renderBounds\);/.test(LABELS),
	"das Culling am Bildrand gilt UNVERAENDERT -- keine Marke hebt es auf");
// ⚠️ Und die vier `return false` darueber ebenso: ein Werkzeug, das einen AUSGESCHALTETEN Schalter
// ueberstimmt, ist keine Hilfe mehr. Gemessen wird die Reihenfolge -- die Marke wird ERST NACH
// ihnen gelesen.
const iRiegel = LABELS.indexOf("if (editorOverride === false) {");
const iMarke = LABELS.indexOf("avesmapsLabelMarkeHebtZoomband(entry.label)");
pruefe(iRiegel > -1 && iMarke > iRiegel,
	"die Marke wird NACH den Verbergen-Riegeln gelesen, nicht davor");

console.log(`label-markierungen.test: OK (${pruefungen} Zusicherungen)`);
