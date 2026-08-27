// Die Ortsnamen gehoeren der ANSICHT, nicht dem Untergrund (27.08.2026).
//
// Gemeldet vom Owner: „standard: original muss die labels der orte und regionen einschalten (alles
// sichtbar wie bei modern auch)". Live gemessen war der Unterschied zwischen „Standard × Modern"
// und „Standard × Original" genau EINE Gruppe: 189 Beschriftungen gegen 86, und die fehlenden 103
// waren ausschliesslich Ortsnamen -- Landschafts- und Regionsbeschriftungen standen in beiden
// Faellen da.
//
// Ursache war `activeMapStyle !== "stylized"` in shouldShowLocationNameLabel. Das war richtig,
// solange „Original" eine eigene ANSICHT ohne Overlays war; seit dem Kartenfaecher (26.08.2026)
// ist der Untergrund frei mit jeder Ansicht kreuzbar, und die Bedingung sperrte `original` und
// `none` mit aus, obwohl die gar nichts aufgedruckt haben.
//
// 💣 Vor diesem Test nagelte KEINE Zusicherung die Regel fest: alle fuenf Tests, die
// `activeMapStyle` ueberhaupt erwaehnen, blieben beim Umbau gruen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/ortsnamen-auf-jedem-untergrund.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, `actions/checkout` legt LF hin (AGENTS.md §9).
const read = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8").replace(/\r\n/g, "\n");
/** 💣 Die Prosa beschreibt genau das, wonach gesucht wird -- ein Treffer im Kommentar ist kein
 *  Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts haelt. */
const ohneKommentare = (quelle) => quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * Schneidet einen `{…}`-Block heraus und zaehlt Klammern NUR ausserhalb von Strings.
 * 💣 Die naive Zaehlung stolpert ueber MAP_TILE_STYLES: dessen Adressen tragen `{z}`, `{x}` und
 * `{y}` mitten im String, und der Block schloesse viel zu frueh.
 */
function schneideBlock(quelle, ab) {
	const auf = quelle.indexOf("{", ab);
	assert.ok(ab >= 0 && auf > 0, "der Block ist auffindbar");
	let tiefe = 0;
	let imString = null;
	for (let i = auf; i < quelle.length; i += 1) {
		const zeichen = quelle[i];
		if (imString) {
			if (zeichen === "\\") { i += 1; } else if (zeichen === imString) { imString = null; }
			continue;
		}
		if (zeichen === "\"" || zeichen === "'" || zeichen === "`") { imString = zeichen; continue; }
		if (zeichen === "{") { tiefe += 1; } else if (zeichen === "}") {
			tiefe -= 1;
			if (tiefe === 0) { return quelle.slice(auf, i + 1); }
		}
	}
	throw new Error("der Block schliesst nicht");
}

// ---- 1. Die Tabelle: GENAU EIN Kachelsatz traegt seine Namen im Bild -----------------------------
const konfig = ohneKommentare(read("js", "config.js"));
const stile = new Function("return " + schneideBlock(konfig, konfig.indexOf("MAP_TILE_STYLES")))();

assert.deepStrictEqual(Object.keys(stile).sort(), ["old", "original", "stylized"],
	"js/config.js fuehrt die drei Kachelsaetze -- kommt einer dazu, gehoert er in diesen Test");
assert.deepStrictEqual(Object.keys(stile).filter((k) => stile[k].ortsnamenImBild), ["old"],
	"🔴 NUR `old` traegt die Ortsnamen aufgedruckt (GARETH, Vierok, Wiesengrund). `original` ist"
	+ " dieselbe Karte OHNE sie -- wer das Feld dort setzt, loescht dem Owner die Namen wieder weg");

// ---- 2. Der Zeichner: die Regel wird GEFAHREN, nicht gelesen -------------------------------------
const zeichnerQuelle = read("js", "map-features", "map-features-location-name-labels.js");
const ab = zeichnerQuelle.indexOf("const untergrund =");
assert.ok(ab > 0, "die Bedingung ist auffindbar");
const bis = zeichnerQuelle.indexOf("}", zeichnerQuelle.indexOf("isCrossingLocation(entry.location)", ab));
assert.ok(bis > ab, "...und schliesst");
const bedingung = zeichnerQuelle.slice(ab, bis + 1);

/** Faehrt die echte Bedingung. `true` heisst: der Ortsname wird gezeichnet. */
function zeichnetNamen(untergrund, istKreuzung = false, quelltext = bedingung) {
	return new Function("MAP_TILE_STYLES", "activeMapStyle", "isCrossingLocation", "entry",
		quelltext + "\nreturn true;")(stile, untergrund, () => istKreuzung, { location: {} }) === true;
}

assert.strictEqual(zeichnetNamen("stylized"), true, "auf `Modern` stehen die Ortsnamen -- wie bisher");
assert.strictEqual(zeichnetNamen("original"), true,
	"🔴 auf `Original` AUCH: das ist die Meldung des Owners vom 27.08.2026. Die Karte traegt dort"
	+ " keine aufgedruckten Namen, also muss die Ansicht sie zeichnen");
assert.strictEqual(zeichnetNamen("old"), false,
	"💣 auf `Old` NICHT -- dort stehen sie im Bild, und gezeichnete kaemen doppelt");
assert.strictEqual(zeichnetNamen("none"), true,
	"⚠️ ohne Untergrund (`none` = gar kein Bild) ebenfalls: aufgedruckt ist dort nichts");
assert.strictEqual(zeichnetNamen("stylized", true), false,
	"eine Kreuzung bekommt nie einen Namen -- diese zweite Haelfte der Bedingung bleibt unberuehrt");

// ---- 3. Gegenproben: haelt das ueberhaupt etwas? -------------------------------------------------
// 💣 Ohne sie waere alles oben auch dann gruen, wenn die Bedingung gar nicht mehr auf die
// Eigenschaft schaute -- der haeufigste Weg zu einem Test, der nichts haelt.
const ohneEigenschaft = bedingung.replace("untergrund.ortsnamenImBild", "false");
assert.notStrictEqual(ohneEigenschaft, bedingung, "die Mutationsprobe hat wirklich etwas ersetzt");
assert.strictEqual(zeichnetNamen("old", false, ohneEigenschaft), true,
	"ohne die Eigenschaft bekaeme `old` seine Namen doppelt -- die Zusicherung darueber haelt also");

// 🪤 Und der Rueckfall in die alte Fassung: `activeMapStyle !== "stylized"` sperrt `original` und
// `none` mit aus. Er darf nicht zurueckkommen -- auch nicht als „kleine Vereinfachung".
// 💣 Kommentare vorher strippen: die Begruendung an der Codestelle nennt genau diesen Ausdruck,
// und der Test schluege sonst an seiner eigenen Warnung an.
assert.ok(!/activeMapStyle\s*!==\s*"stylized"/.test(ohneKommentare(zeichnerQuelle)),
	"der Zeichner fragt NICHT mehr, ob der Untergrund `stylized` heisst, sondern ob er seine"
	+ " Ortsnamen selbst traegt");

console.log("ortsnamen-auf-jedem-untergrund tests passed");
