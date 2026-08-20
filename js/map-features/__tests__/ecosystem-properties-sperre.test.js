// Der Haken „Für Klicks gesperrt" im Eigenschaften-Dialog (Owner 19.08.2026: „du kannst die
// eigenschaft auch hier anbieten").
//
// ⭐ EIN NAMENSVERTRAG ZWISCHEN ZWEI DATEIEN, und deshalb ausnahmsweise ein Text-Test: das Markup
// steht in index.html, der Zugriff in map-features-ecosystem-properties.js, und die Klammer dazwischen
// ist die Zeichenkette „locked". Bricht sie, fällt nichts um — der Haken steht einfach da und tut
// nichts. Vorbild: js/pages/__tests__/tempowerte-dialog.test.js.
//
// ⚠️ Was der Haken TUT (durchreichen), prüft ecosystem-sperre-durchlass.test.js; dass ihn jede
// Zeigergeste beachtet, ecosystem-sperre-eingaenge.test.js. Hier geht es nur um die Verdrahtung.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const js = fs.readFileSync(
	path.join(wurzel, "js/map-features/map-features-ecosystem-properties.js"),
	"utf8"
);

// ---- Das Markup ----------------------------------------------------------------------------------

assert.ok(
	html.includes('id="ecosystem-properties-locked"'),
	"Der Haken fehlt in index.html. propertiesElement(\"locked\") sucht #ecosystem-properties-locked."
);
assert.ok(
	html.includes('data-i18n="ecosystem.properties.locked"'),
	"Die Beschriftung braucht einen i18n-Schlüssel — das Markup steht in index.html, der "
		+ "Übersetzungslauf findet es also (anders als bei injizierten Menüeinträgen)."
);
assert.ok(
	html.includes('data-i18n="ecosystem.properties.lockedHint"'),
	'Die Erklärzeile fehlt. „Gesperrt" allein hat in diesem Haus fünf mögliche Bedeutungen — '
		+ "unter anderem die befristete Bearbeitungssperre aus map_feature_locks."
);

// Er steht bei den ANDEREN Haken, nicht irgendwo: Auto-Name · Regionname anzeigen · Nodix · Sperre.
const nodixStelle = html.indexOf('id="ecosystem-properties-nodix"');
const sperrStelle = html.indexOf('id="ecosystem-properties-locked"');
const artStelle = html.indexOf('id="ecosystem-properties-type"');
assert.ok(nodixStelle > 0 && sperrStelle > nodixStelle && sperrStelle < artStelle,
	'Der Haken gehört zwischen „Nodix" und die Artauswahl — zu den übrigen Haken der Identität.');

// ---- Der Zugriff ----------------------------------------------------------------------------------

assert.ok(
	js.includes('propertiesElement("locked")'),
	"map-features-ecosystem-properties.js greift den Haken nicht ab."
);
assert.ok(
	js.includes("syncPropertiesLocked"),
	"Beim Öffnen muss der Haken gefüllt werden, sonst startet er immer leer und das nächste "
		+ "Speichern entsperrt eine gesperrte Region."
);

// 🔴 ÜBER DIE VORHANDENE SPEICHERLEISTE, nicht mit einem eigenen Aufruf daneben. Ein zweiter Aufruf
// machte „Abbrechen" für genau diesen einen Wert wirkungslos.
assert.ok(
	js.includes("payload.is_locked = Boolean("),
	'Die Sperre muss in den update_region-Rumpf, den „Speichern" ohnehin schickt.'
);
const eigeneAufrufe = (js.match(/postEcosystemEdit\("update_region"/g) || []).length;
assert.strictEqual(
	eigeneAufrufe,
	1,
	`Es darf genau EINEN update_region-Aufruf in diesem Dialog geben, gefunden: ${eigeneAufrufe}. `
		+ "Zwei Schreibwege für dasselbe Fenster laufen beim nächsten Umbau auseinander."
);

// Und der Zähler in der Leiste erfährt davon — über das Nachbarmodul, damit dieser Datei kein
// zweiter Zählweg gehört.
assert.ok(
	js.includes("AvesmapsEcosystemStapel?.merkeSperre"),
	"Nach dem Speichern muss der geladene Bestand nachgezogen werden, sonst zeigt der Zähler "
		+ "die alte Zahl und die Karte lässt die Region weiter Klicks abfangen."
);

console.log("ok - ecosystem-properties-sperre");
