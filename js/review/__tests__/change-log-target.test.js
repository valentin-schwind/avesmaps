// Was in der Zielspalte des Fensters „Änderungen" steht — und was dort NIE stehen darf.
//
// 💣 EINE TECHNISCHE KENNUNG IST KEIN NAME. Bis zum 22.08.2026 endete die Rückfallkette auf
// `entry.public_id`, und der politische Lesepfad schrieb seine Geometrie-Kennung sogar direkt in
// `name`. In der Liste stand dann `f74ea2ed-29a9-460d-8d3f-3832e4fbc86b`, wo ein Editor den Namen
// des Gebiets erwartet. Der Server ist repariert (aenderungen-gebietsname-test.php); dieser Riegel
// hier ist der zweite Gurt und fängt JEDE Quelle, die je wieder eine Kennung durchreicht.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox, nicht eine abgeschriebene Kopie der Regel.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/change-log-target.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const QUELLE = path.join(ROOT, "js", "review", "review-panels-change-log.js");
const source = fs.readFileSync(QUELLE, "utf8");

const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-panels-change-log.js" });

const changeLogEntryTarget = sandbox.changeLogEntryTarget;
const changeLogEntryDetail = sandbox.changeLogEntryDetail;
assert.strictEqual(typeof changeLogEntryTarget, "function", "die echte Funktion ist geladen");
assert.strictEqual(typeof changeLogEntryDetail, "function", "die echte Funktion ist geladen");

// ---- Der Fall, um den es geht --------------------------------------------------------------------

const KENNUNG = "f74ea2ed-29a9-460d-8d3f-3832e4fbc86b";

assert.strictEqual(
	changeLogEntryTarget({ name: KENNUNG, feature_subtype: "region", public_id: KENNUNG }),
	"region",
	"eine Kennung im Namen wird uebersprungen, nicht angezeigt",
);
assert.strictEqual(
	changeLogEntryTarget({ name: "", feature_subtype: "", public_id: KENNUNG }),
	"Unbenannt",
	"ohne jeden Namen steht 'Unbenannt' da -- nie die Kennung",
);
// 💣 Grossbuchstaben sind dieselbe Kennung. Ohne /i faellt genau diese Schreibweise durch.
assert.strictEqual(
	changeLogEntryTarget({ name: KENNUNG.toUpperCase(), feature_subtype: "" }),
	"Unbenannt",
	"auch in Grossschreibung ist eine Kennung kein Name",
);

// ---- Der uebliche Fall bleibt, wie er war ---------------------------------------------------------

assert.strictEqual(changeLogEntryTarget({ name: "Ferdok" }), "Ferdok", "ein echter Name steht da");
assert.strictEqual(
	changeLogEntryTarget({ name: "  Baronie Hügelsee  " }),
	"Baronie Hügelsee",
	"Leerraum wird abgeschnitten",
);
assert.strictEqual(
	changeLogEntryTarget({ name: "", feature_subtype: "kleinstadt" }),
	"kleinstadt",
	"ohne Namen traegt die Art die Zeile",
);
assert.strictEqual(changeLogEntryTarget(null), "Unbenannt", "und null wirft nicht");
assert.strictEqual(changeLogEntryTarget(undefined), "Unbenannt", "undefined auch nicht");

// ⚠️ Ein Name, der eine Kennung nur ENTHAELT, ist ein Name. Der Riegel gilt der nackten Kennung --
// „Ruine f74ea2ed-…" waere haesslich, aber es ist, was jemand hingeschrieben hat.
assert.strictEqual(
	changeLogEntryTarget({ name: `Ruine ${KENNUNG}` }),
	`Ruine ${KENNUNG}`,
	"nur die NACKTE Kennung wird verworfen, kein Text, der eine enthaelt",
);

// ---- Die Erklaerzeile -----------------------------------------------------------------------------

assert.strictEqual(
	changeLogEntryDetail({ detail: "Name, Einwohner geändert" }),
	"Name, Einwohner geändert",
	"was der Server sagt, steht da",
);
// 🔴 Fehlt sie, wird NICHTS behauptet -- die Zeile faellt weg, statt „geändert" zu raten.
assert.strictEqual(changeLogEntryDetail({}), "", "ohne Angabe bleibt sie leer");
assert.strictEqual(changeLogEntryDetail({ detail: "   " }), "", "Leerraum ist keine Angabe");
assert.strictEqual(changeLogEntryDetail(null), "", "und null wirft nicht");

// ---- Verdrahtung: eine gepruefte Funktion, die niemand aufruft, beweist nichts ---------------------
// 💣 Genau das war hier schon einmal die Luecke. Die alte Rueckfallkette stand INLINE im Zeichner;
// haette ich nur die neue Funktion geprueft, waere der Test gruen und die Liste unveraendert.

assert.ok(
	source.includes("changeLogEntryTarget(entry)"),
	"der Zeichner ruft die Funktion wirklich auf",
);
assert.ok(
	source.includes("changeLogEntryDetail(entry)"),
	"die Erklaerzeile wird wirklich gefuellt",
);
// ⚠️ Gezielt auf die ANZEIGE-Kette, nicht auf `entry.public_id` überhaupt: `dataset.publicId` und
// das Hinspringen brauchen die Kennung weiterhin und sind völlig in Ordnung. Ein zu breites Muster
// wäre hier eine Zusicherung, die den Falschen fängt — genau das ist beim ersten Lauf passiert.
assert.ok(
	!/feature_subtype \|\| entry\.public_id/.test(source),
	"die alte Anzeige-Rueckfallkette auf die Kennung ist weg -- sie ist der Fehler selbst",
);
assert.ok(
	/dataset\.publicId = entry\.public_id/.test(source),
	"die Kennung bleibt am Element haengen -- Hinspringen und Zuruecknehmen brauchen sie",
);
// Und die Blase auf der Karte liest denselben Erzeuger: sonst steht dort die Kennung, die die
// Zeile daneben gerade vermeidet.
assert.ok(
	/getChangeLogFocusTooltip[\s\S]{0,220}changeLogEntryTarget\(entry\)/.test(source),
	"die Karten-Blase benutzt denselben Erzeuger wie die Liste",
);

console.log("change-log-target ok");
