// Der JS-Katalog und der PHP-Katalog muessen Wert fuer Wert dasselbe sagen.
//
// 💣 WARUM ES DIESEN TEST GIBT: der Katalog steht zweimal im Haus -- einmal in
// api/_internal/media-license.php fuer die Endpunkte, einmal in js/app/media-licenses.js fuer die
// vier Editorseiten. Das ist eine bewusste Doppelung (ein Endpunkt, der die Liste ausliefert, kostete
// je Editorseite einen Request und einen Ladezustand fuer etwas, das sich nie zur Laufzeit aendert;
// ein Generat waere die Bauform, an der political-territory-editor-inline.css DREIMAL gescheitert
// ist, siehe AGENTS §10). Zulaessig ist die Doppelung nur, solange DIESER Test sie zusammenhaelt.
//
// Er liest die PHP-Datei als TEXT und fuehrt sie nicht aus: der JS-Lauf des Deploy-Workflows kennt
// nur `node`, kein PHP.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/media-licenses-parity.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const PHP_DATEI = path.join(ROOT, "api", "_internal", "media-license.php");

const js = require(path.join(ROOT, "js", "app", "media-licenses.js"));
const phpText = fs.readFileSync(PHP_DATEI, "utf8");

/**
 * Zieht eine PHP-Konstante der Form `const NAME = [ 'a', 'b' ];` als Liste heraus.
 * ⚠️ Ueber [\s\S] statt . gesucht, weil der Block mehrzeilig ist -- und die Repo-Dateien CRLF
 * tragen, ein auf \n gebauter Regex also entweder danebengreift oder das \r mitnimmt.
 */
function phpListe(name) {
	const treffer = phpText.match(new RegExp("const\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\];"));
	assert.ok(treffer, `PHP-Konstante ${name} nicht gefunden -- wurde sie umbenannt?`);
	return [...treffer[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Dasselbe fuer eine Zuordnung der Form `const NAME = [ 'k' => 'v', ];`. */
function phpZuordnung(name) {
	const treffer = phpText.match(new RegExp("const\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\];"));
	assert.ok(treffer, `PHP-Konstante ${name} nicht gefunden -- wurde sie umbenannt?`);
	const paare = {};
	for (const m of treffer[1].matchAll(/'([^']+)'\s*=>\s*'([^']*)'/g)) {
		paare[m[1]] = m[2];
	}
	return paare;
}

const phpWerte = phpListe("AVESMAPS_MEDIA_LICENSES");
const phpOeffentlich = phpListe("AVESMAPS_MEDIA_LICENSES_PUBLIC");
const phpBeschriftungen = phpZuordnung("AVESMAPS_MEDIA_LICENSE_LABELS");

// Der Regex darf nicht ins Leere greifen und dann "beide leer, also gleich" melden.
assert.strictEqual(phpWerte.length, 7, "PHP-Katalog hat nicht sieben Werte");
assert.strictEqual(phpOeffentlich.length, 5, "PHP-Katalog hat nicht fuenf oeffentliche Werte");

// ---- Werte und REIHENFOLGE ------------------------------------------------------------------------
// Stelle fuer Stelle: die Reihenfolge ist die des Auswahlfelds und damit Teil des Vertrags.
assert.deepStrictEqual(
	js.AVESMAPS_MEDIA_LICENSES.map((e) => e.value),
	phpWerte,
	"JS- und PHP-Katalog stimmen in Werten oder Reihenfolge nicht ueberein"
);

// ---- die oeffentliche Teilmenge -------------------------------------------------------------------
assert.deepStrictEqual(
	js.AVESMAPS_MEDIA_LICENSES.filter((e) => e.public).map((e) => e.value),
	phpOeffentlich,
	"JS und PHP sind sich uneins, welche Werte im Frontend erscheinen duerfen"
);

// ---- Beschriftungen -------------------------------------------------------------------------------
for (const eintrag of js.AVESMAPS_MEDIA_LICENSES) {
	assert.strictEqual(
		eintrag.label,
		phpBeschriftungen[eintrag.value],
		`Beschriftung von ${eintrag.value} weicht ab`
	);
}

// ---- der Vorschlagstext ---------------------------------------------------------------------------
const phpNotiz = phpText.match(
	/const\s+AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE\s*=\s*\r?\n?\s*'([^']*)'/
);
assert.ok(phpNotiz, "AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE nicht gefunden");
assert.strictEqual(js.AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE, phpNotiz[1], "Vorschlagstext weicht ab");

// ---- dieselben Zusicherungen wie auf der PHP-Seite -------------------------------------------------
// 🔴 Die tragende: unbekannt ist nie oeffentlich. Sie muss auf BEIDEN Seiten gelten -- die JS-Seite
// entscheidet in Phase 4, ob ein Dialog einen Wert als "wird nicht angezeigt" kennzeichnet.
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("public_domain"), true);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("cc_by"), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("unknown_other"), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("voellig_erfunden"), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic(""), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic(null), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("PUBLIC_DOMAIN"), false);

assert.strictEqual(js.avesmapsMediaLicenseNormalize("  cc0  "), "cc0");
assert.strictEqual(js.avesmapsMediaLicenseNormalize(""), "unknown_other");
assert.strictEqual(js.avesmapsMediaLicenseNormalize(null), "unknown_other");
assert.strictEqual(js.avesmapsMediaLicenseNormalize(42), "unknown_other");
assert.strictEqual(js.avesmapsMediaLicenseNormalize("", "ai_generated"), "ai_generated");
assert.strictEqual(js.avesmapsMediaLicenseNormalize("cc0", "ai_generated"), "cc0");
// Auch hier: eine Vorgabe mit Tippfehler wird nicht durchgereicht.
assert.strictEqual(js.avesmapsMediaLicenseNormalize("", "ai_generatd"), "unknown_other");

assert.strictEqual(js.avesmapsMediaLicenseLabel("cc_by"), "CC-BY");
assert.strictEqual(js.avesmapsMediaLicenseLabel("voellig_erfunden"), "Unbekannt/Sonstiges");

console.log("media-licenses-parity: OK (" + phpWerte.length + " Werte, " + phpOeffentlich.length + " oeffentlich)");
