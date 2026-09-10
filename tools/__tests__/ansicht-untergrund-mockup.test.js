// 💣 docs/ansicht-untergrund-mockup.html IST EIN BUILD-PRODUKT. Von Hand hineingeschriebene
// Regeln wirken sofort und sind beim naechsten Generatorlauf weg -- dieselbe Falle wie beim
// gescopten Editor-CSS (AGENTS.md §10), die dort DREIMAL zugeschlagen hat, bevor
// tools/__tests__/scope-editor-css.test.js sie gefangen hat. Fuer dieses Build-Produkt gab es
// bis zum 09.09.2026 keinen Waechter.
//
//   node tools/__tests__/ansicht-untergrund-mockup.test.js

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..", "..");
const ZIEL = path.join(ROOT, "docs", "ansicht-untergrund-mockup.html");

// In ein Wegwerf-Verzeichnis erzeugen, nie ueber die ausgelieferte Datei -- ein Test, der sein
// Pruefobjekt selbst neu schreibt, ist immer gruen.
//
// 🔴 DAFUER BRAUCHT DER GENERATOR EINE UMLEITUNG (AVESMAPS_MOCKUP_ZIEL). Sein zweites Argument
// taugt NICHT: es erzeugt die ARTEFAKT-Fassung (ohne <html>/<head>/<body>, Bilder als data:-URI)
// und schreibt docs/ansicht-untergrund-mockup.html trotzdem. Ein Testlauf ueber argv[2] haette
// also sein eigenes Pruefobjekt ueberschrieben und danach zwangslaeufig Gleichheit gemeldet.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "avm-mockup-"));
const probe = path.join(tmp, "probe.html");
execFileSync(process.execPath, [path.join(ROOT, "tools", "bau-ansicht-untergrund-mockup.js")],
	{ cwd: ROOT, env: Object.assign({}, process.env, { AVESMAPS_MOCKUP_ZIEL: probe }) });

// ⚠️ ZEILENENDENNEUTRAL vergleichen. Die Arbeitskopie traegt CRLF, actions/checkout legt LF hin
// (AGENTS.md §9) -- ein Byte-Vergleich waere hier gruen und in der CI rot. Und er waere es auch
// auf einem FRISCHEN Windows-Checkout: die Zeilen des Template-Strings kommen immer als LF
// heraus (ECMAScript normalisiert CR LF im Template-String), waehrend die hineinkopierten
// CSS-Dateien ihre CRLF behalten -- die Generatorausgabe ist also gemischt, der ausgecheckte
// Stand nicht. Gemessen 10.09.2026: Ausgabe 1635 CRLF + 711 LF, Blob 2346 LF.
const erzeugt = fs.readFileSync(probe, "utf8").replace(/\r\n/g, "\n");
const geliefert = fs.readFileSync(ZIEL, "utf8").replace(/\r\n/g, "\n");
fs.rmSync(tmp, { recursive: true, force: true });

// 💣 DIE ERSTE ABWEICHENDE ZEILE WIRD GESUCHT, und die Meldung nennt NUR sie.
// assert.strictEqual auf zwei 148-KB-Zeichenketten schuettet rund viertausend Zeilen
// hineinkopiertes Token-CSS aus und begraebt seine eigene Meldung darin -- gemessen beim Bau
// dieses Waechters. Geprueft wird dasselbe (=== ueber den ganzen Text), nur das Rot ist lesbar.
// Wer hier strictEqual zurueckbaut, nimmt dem Test genau die Auskunft, um die es geht: WO von
// Hand hineingeschrieben wurde.
const aZ = geliefert.split("\n");
const bZ = erzeugt.split("\n");
let erste = -1;
for (let i = 0; i < Math.max(aZ.length, bZ.length); i++) {
	if (aZ[i] !== bZ[i]) { erste = i; break; }
}
const kurz = (t) => (t === undefined ? "(Zeile fehlt)" : JSON.stringify(t.length > 160 ? t.slice(0, 160) + " …" : t));

assert.ok(erste === -1,
	"docs/ansicht-untergrund-mockup.html ist zeichengleich mit der Ausgabe seines Generators."
	+ " Ist es das nicht, hat jemand von Hand hineingeschrieben -- erzeuge neu:"
	+ " node tools/bau-ansicht-untergrund-mockup.js"
	+ "\n  erste abweichende Zeile: " + (erste + 1)
	+ "\n  ausgeliefert: " + kurz(aZ[erste])
	+ "\n  Generator:    " + kurz(bZ[erste]));

console.log("ansicht-untergrund-mockup.test.js: Build-Produkt ist aktuell");
