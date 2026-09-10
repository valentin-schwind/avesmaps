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
const GENERATOR = path.join(ROOT, "tools", "bau-ansicht-untergrund-mockup.js");

// 💣 DIE MECHANISCHE BACKTICK-PROBE, und sie gehoert VOR den Generatorlauf.
// tools/bau-ansicht-untergrund-mockup.js baut sein ganzes Mockup in EINEM Template-String, und
// ein Backtick darin -- auch in einem Kommentar -- beendet ihn. Der Dateikopf dort nannte dafuer
// erst eine Zahl ("grep -c muss 5 ergeben", falsch: grep -c zaehlt ZEILEN) und danach nur noch
// Prosa ("node --check faellt um, sobald es anders ist"). Auch das ist keine Zusicherung: ein
// EINZELNER Backtick bricht den Parser, ein PAAR um etwas Operator-artiges parst durch und
// verstuemmelt die Ausgabe lautlos. Geprueft wird deshalb die Sache selbst, ohne Zahl: zwischen
// den beiden Grenzen des Template-Strings steht kein Backtick.
// 🔴 DIE GRENZEN WERDEN ZEILENVERANKERT GESUCHT. Ein blankes indexOf("const html =") trifft den
// Satz im DATEIKOPF, der ueber diese Regel spricht -- gemessen 10.09.2026: die Probe haette dann
// ab jenem Kommentar gemessen und sechs voellig legitime Backticks als Fund gemeldet. Die untere
// Grenze ist der Backtick am Zeilenanfang, dem ein Semikolon folgt.
// ⚠️ Sie laeuft zuerst, damit im Fehlerfall DIESE Meldung kommt und nicht der "SyntaxError:
// Unexpected identifier" des abgebrochenen Generatorlaufs, der an einer ganz anderen Zeile steht.
const generatorQuelle = fs.readFileSync(GENERATOR, "utf8");
const aufTreffer = /^const html = `/m.exec(generatorQuelle);
assert.ok(aufTreffer,
	"tools/bau-ansicht-untergrund-mockup.js: die Zeile mit dem oeffnenden Template-Backtick"
	+ " (const html = am Zeilenanfang) ist nicht zu finden -- ohne sie kann die Backtick-Probe"
	+ " nichts pruefen, und sie ist der einzige mechanische Halt dieser Regel.");
const aufIdx = aufTreffer.index + aufTreffer[0].length - 1; // Index des oeffnenden Backticks
const zuIdx = generatorQuelle.indexOf("\n`;", aufIdx); // Backtick am Zeilenanfang, dann Semikolon
assert.ok(zuIdx !== -1,
	"tools/bau-ansicht-untergrund-mockup.js: die schliessende Zeile des Template-Strings"
	+ " (Backtick am Zeilenanfang, dann Semikolon) ist nicht zu finden.");
const rumpf = generatorQuelle.slice(aufIdx + 1, zuIdx + 1);
const streuIdx = rumpf.indexOf("`");
const streuZeile = streuIdx === -1 ? "" : (() => {
	const nr = generatorQuelle.slice(0, aufIdx + 1 + streuIdx).split("\n").length;
	return "\n  Zeile " + nr + ": " + JSON.stringify((generatorQuelle.split("\n")[nr - 1] || "").trim());
})();
assert.ok(streuIdx === -1,
	"tools/bau-ansicht-untergrund-mockup.js: zwischen den beiden Grenzen des Template-Strings steht"
	+ " ein Backtick -- er beendet den String. Benutze einfache Anfuehrungszeichen, auch im"
	+ " Kommentar." + streuZeile);

// In ein Wegwerf-Verzeichnis erzeugen, nie ueber die ausgelieferte Datei -- ein Test, der sein
// Pruefobjekt selbst neu schreibt, ist immer gruen.
//
// 🔴 DAFUER BRAUCHT DER GENERATOR EINE UMLEITUNG (AVESMAPS_MOCKUP_ZIEL). Sein zweites Argument
// taugt NICHT: es erzeugt die ARTEFAKT-Fassung (ohne <html>/<head>/<body>, Bilder als data:-URI)
// und schreibt docs/ansicht-untergrund-mockup.html trotzdem. Ein Testlauf ueber argv[2] haette
// also sein eigenes Pruefobjekt ueberschrieben und danach zwangslaeufig Gleichheit gemeldet.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "avm-mockup-"));
const probeDatei = path.join(tmp, "probe.html");

// ⚠️ ZEILENENDENNEUTRAL vergleichen. Die Arbeitskopie traegt CRLF, actions/checkout legt LF hin
// (AGENTS.md §9) -- ein Byte-Vergleich waere hier gruen und in der CI rot. Und er waere es auch
// auf einem FRISCHEN Windows-Checkout: die Zeilen des Template-Strings kommen immer als LF
// heraus (ECMAScript normalisiert CR LF im Template-String), waehrend die hineinkopierten
// CSS-Dateien ihre CRLF behalten -- die Generatorausgabe ist also gemischt, der ausgecheckte
// Stand nicht. Gemessen 10.09.2026: Ausgabe 1635 CRLF + 711 LF, Blob 2346 LF.
//
// 💣 DAS WEGWERF-VERZEICHNIS WIRD IM finally GERAEUMT. Bricht der Generator ab -- und er bricht
// ausdruecklich ab, wenn ein Token oder ein Ebenen-Vektor fehlt (process.exit(1)) --, dann wirft
// execFileSync, und ein rmSync dahinter wird NIE erreicht: jeder rote Lauf liesse ein
// avm-mockup-XXXX im Temp-Verzeichnis zurueck, also genau dann, wenn man den Test oft faehrt.
let erzeugt;
let geliefert;
try {
	execFileSync(process.execPath, [path.join(ROOT, "tools", "bau-ansicht-untergrund-mockup.js")],
		{ cwd: ROOT, env: Object.assign({}, process.env, { AVESMAPS_MOCKUP_ZIEL: probeDatei }) });
	erzeugt = fs.readFileSync(probeDatei, "utf8").replace(/\r\n/g, "\n");
	geliefert = fs.readFileSync(ZIEL, "utf8").replace(/\r\n/g, "\n");
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}

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
