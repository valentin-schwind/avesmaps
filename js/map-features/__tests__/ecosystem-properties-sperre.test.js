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
// 🔴 DIE ERKLAERZEILE IST RAUS (Owner 23.08.2026, woertlich: den Satz „Klicks fallen durch die
// Region hindurch ..." aus dem Dialogfenster entfernen). Hier stand bis dahin eine Zusicherung, die
// sie VERLANGTE, mit dieser Begruendung: „Gesperrt" allein hat in diesem Haus fuenf moegliche
// Bedeutungen -- unter anderem die befristete Bearbeitungssperre aus map_feature_locks.
// ⚠️ Die Begruendung war richtig und ist nicht widerlegt, sondern ueberstimmt: der Owner bedient
// diesen Dialog taeglich und nimmt die Mehrdeutigkeit in Kauf. Sie steht hier, damit der naechste
// Leser weiss, was der Satz geleistet hat -- und nicht meint, er sei versehentlich verschwunden.
// KEINE Zusicherung auf Abwesenheit: wer ihn spaeter wieder haben will, soll ihn ohne roten Test
// zurueckholen koennen.

// 🪤 HIER STAND: „Der Haken gehoert zwischen ‚Nodix' und die Artauswahl." Das galt, solange der
// Flaechendialog ein eigenes Fenster war. Seit der Vereinigung (25.08.2026) gibt es „Nodix" im
// Flaechenteil NICHT MEHR -- es war ein Zwilling des Hakens im Beschriftungsteil und bediente
// denselben Wert. Die Nachbarschaft, an der sich diese Zusicherung festhielt, ist damit weg.
//
// 🔴 Was BLEIBT und hier jetzt steht: der Haken gehoert in den Reiter „Flaeche" -- er gilt der
// REGION und allen ihren Teilflaechen, nicht der Beschriftung. Ein Sperr-Haken im
// Beschriftungsreiter waere eine Aussage ueber das falsche Objekt.
const iFlaeche = html.indexOf('data-landschaft-bereich="flaeche"');
const iBeschriftung = html.indexOf('data-landschaft-bereich="beschriftung"');
const sperrStelle = html.indexOf('id="ecosystem-properties-locked"');
assert.ok(iFlaeche > 0 && iBeschriftung > iFlaeche, "die zwei Reiter stehen in dieser Reihenfolge");
assert.ok(sperrStelle > iFlaeche && sperrStelle < iBeschriftung,
	'Der Haken steht im Reiter „Fläche" — er gilt der Region, nicht der Beschriftung.');

// ⚠️ Und er steht bei der Artauswahl derselben Haelfte, nicht irgendwo dahinter.
const artStelle = html.indexOf('id="ecosystem-properties-type"');
assert.ok(artStelle > 0 && sperrStelle < artStelle,
	'Der Haken steht vor der Artauswahl der Fläche.');

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
