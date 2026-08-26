// Der Rollentausch der zwei Wegenamen-Zeichenflaechen gehoert an EINE Stelle.
//
// 💣 DER FEHLER, DEN DIESER TEST VERHINDERT, HAT JEDEN ZWEITEN ANIMIERTEN ZOOM DIE WEGE- UND
// FLUSSNAMEN GEKOSTET. Es gab den Tausch zweimal: einmal in `zeichneJetzt` (dort wurde `ctx` neu
// geholt) und einmal von Hand im `zoomanim`-Handler (dort nicht). `ctx` blieb damit an EINER
// Flaeche kleben, waehrend `vorne`/`hinten` bei jedem Zoomschritt tauschten -- gezeichnet wurde
// abwechselnd in die sichtbare und in die unsichtbare Flaeche.
//
// Live gemessen am 27.08.2026 (Owner: „ich seh weder strassen noch flussnamen auf zoomstufe 6"):
// die unsichtbare Flaeche trug 36.528 gefuellte Bildpunkte, die sichtbare 0. Und die Zoomfolge
// 3->4->5->6->5->4 lieferte abwechselnd richtig/falsch/richtig/falsch/richtig -- das Kennzeichen
// eines Zustands, der mitwandert, statt zu passen.
//
// 🪤 UND WARUM ES SO LANGE UNBEMERKT BLIEB: ein Zoom mit `animate:false` nimmt diesen Weg gar
// nicht. Wer so prueft -- und das tut man beim Automatisieren fast von selbst --, sieht den Fehler
// NIE. Erst ein animierter Zoom stellt ihn her.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/wegenamen-flaechentausch.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const datei = "js/map-features/map-features-path-label-canvas-overlay.js";
// ⚠️ Zeilenendenneutral (Arbeitskopie CRLF, Tor LF) und OHNE Kommentare -- sonst schlaegt der Test
// an der Warnung an, die vor der Falle warnt, und der naechste Leser loescht die Warnung.
const roh = fs.readFileSync(path.join(wurzel, datei), "utf8").split("\r\n").join("\n");
const quelle = roh
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const zaehle = (muster) => (quelle.match(muster) || []).length;

// --- Es gibt GENAU EINEN Tausch ------------------------------------------------------------------
assert.strictEqual(zaehle(/vorne\s*=\s*hinten/g), 1,
	"💣 `vorne = hinten` steht mehr als einmal -- der Rollentausch ist wieder verteilt, und die "
	+ "zweite Stelle vergisst `ctx` genauso zuverlaessig wie beim ersten Mal.");
assert.strictEqual(zaehle(/hinten\s*=\s*tausch/g), 1,
	"💣 Die Gegenzuweisung des Tauschs steht mehr als einmal.");

// --- Und er zieht `ctx` mit ----------------------------------------------------------------------
const tauscher = quelle.slice(quelle.indexOf("function tauscheLabelFlaechen"));
const rumpf = tauscher.slice(0, tauscher.indexOf("\n\t}") + 3);
assert.ok(/function tauscheLabelFlaechen/.test(quelle),
	"Der gemeinsame Tauscher fehlt.");
assert.ok(/vorne\s*=\s*hinten/.test(rumpf) && /hinten\s*=\s*tausch/.test(rumpf),
	"Der Tausch steht nicht im gemeinsamen Tauscher.");
assert.ok(/ctx\s*=\s*vorne\.getContext\(/.test(rumpf),
	"💣 Der Tauscher holt `ctx` nicht neu -- genau der Fehler vom 27.08.2026: gezeichnet wird dann "
	+ "in die unsichtbare Flaeche.");

// 🔴 `ctx` darf NUR dort und bei der Erstbelegung gesetzt werden. Eine dritte Zuweisung waere eine
// zweite Wahrheit darueber, in welche Flaeche gerade gezeichnet wird.
assert.strictEqual(zaehle(/ctx\s*=\s*[a-zA-Z]+\.getContext\(/g), 2,
	"🔴 `ctx` wird an mehr als zwei Stellen belegt (Erstbelegung + Tauscher).");

// --- Beide Aufrufer benutzen ihn -----------------------------------------------------------------
// 💣 Ohne diese Zusicherung koennte der Tauscher dastehen und der zoomanim-Handler wieder von Hand
// vertauschen -- der Zustand vor der Reparatur, nur mit totem Code daneben.
// 🪤 MIT SEMIKOLON GESUCHT. `tauscheLabelFlaechen\(\)` allein trifft die DEFINITIONSZEILE mit --
// der Test zaehlte 3 statt 2 und war beim ersten Lauf rot, obwohl der Code stimmte. Dieselbe Falle
// wie bei `includes("fn(data)")`, das den geloeschten Aufruf gruen laesst.
assert.strictEqual(zaehle(/tauscheLabelFlaechen\(\);/g), 2,
	"💣 Der Tauscher wird nicht von BEIDEN Stellen gerufen (zeichneJetzt und zoomanim).");

const zoomanim = quelle.slice(quelle.indexOf('map.on("zoomanim"'));
assert.ok(/tauscheLabelFlaechen\(\)/.test(zoomanim),
	"💣 Der zoomanim-Handler tauscht nicht ueber den gemeinsamen Tauscher -- das war die kaputte "
	+ "Stelle.");
assert.ok(!/vorne\s*=\s*hinten/.test(zoomanim),
	"💣 Der zoomanim-Handler vertauscht wieder von Hand.");

console.log("OK: der Rollentausch der Wegenamen-Flaechen steht an genau einer Stelle und zieht `ctx` mit.");
