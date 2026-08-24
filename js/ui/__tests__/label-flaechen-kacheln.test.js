// Die zwei Handgriffe an der FLÄCHE unter einer Beschriftung: „Eigenschaften" und „Fläche bearbeiten".
//
// 🔴 WARUM SIE AM LABEL HÄNGEN (Owner 24.08.2026). Beide gibt es im Kontextmenü der Fläche seit
// jeher -- nur kommt man an die Fläche nicht immer heran: sobald eine Region ihre Kurve trägt, meldet
// der Kurvenriegel den Label-Marker ab, und im Standardmodus sind die Flächen gar nicht geladen. Die
// Beschriftung steht aber da und ist anklickbar. Owner: „hier wechselt die ansicht in die landschaft
// (topographisch, vegetation, derographisch) und entspricht dann dem klick auf ‚Eigenschaften‘ im
// kontextmenü."
//
// 🔴 NUR MIT FLÄCHE. Ein freies Label und ein Gipfel haben keine -- dort wären beide Kacheln Knöpfe,
// die nichts tun können, und das sieht aus wie ein Fehler.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/label-flaechen-kacheln.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

function ladePopups({ editMode = true } = {}) {
	const sandbox = {
		IS_EDIT_MODE: editMode,
		CROSSING_LOCATION_TYPE: "kreuzung",
		pendingPathCreationStart: null,
		pendingPowerlineCreationStart: null,
		escapeHtml: (v) => String(v == null ? "" : v)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
		buildHtmlAttributes: (attrs) => Object.entries(attrs || {})
			.filter(([, v]) => v !== undefined && v !== null)
			.map(([k, v]) => ` ${k}="${String(v)}"`).join(""),
		tr: (key, german) => german,
		withAssetVersion: (u) => u,
		findWaypointIdByLocationName: () => "",
		findLocationMarkerByPublicId: () => null,
		findLabelEntryByPublicId: () => null,
		buildSuggestChangeButtonSpec: () => null,
		console,
		window: {},
		document: { querySelector: () => null, querySelectorAll: () => [] },
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read("js", "ui", "popups.js"), sandbox, { filename: "popups.js" });
	return sandbox;
}

const editor = ladePopups({ editMode: true });

// ---- mit Fläche: beide Kacheln ----------------------------------------------------------------------

const mitFlaeche = editor.labelActionsMarkup("lab-1", "", { hatFlaeche: true });
assert.ok(mitFlaeche.includes('data-popup-action="label-area-properties"'),
    "die Kachel „Eigenschaften“ steht da");
assert.ok(mitFlaeche.includes('data-popup-action="label-area-geometry"'),
    "und die Kachel „Fläche bearbeiten“");
assert.ok(mitFlaeche.includes("Eigenschaften") && mitFlaeche.includes("Fläche bearbeiten"),
    "beide mit den Worten des Kontextmenüs");

// 🔴 Dieselben Zeichen wie im Kontextmenü: ⚙ Eigenschaften, ✎ die Geometrie selbst anfassen.
// Ein Editor darf nicht zwei Vokabulare für dieselbe Handlung lernen.
assert.ok(mitFlaeche.includes("⚙"), "⚙ für Eigenschaften -- wie im Kontextmenü");
assert.ok(mitFlaeche.includes("✎"), "✎ für die Geometrie -- wie „Grenzen bearbeiten“");

// ---- ohne Fläche: keine von beiden -------------------------------------------------------------------

const ohneFlaeche = editor.labelActionsMarkup("lab-1", "", { hatFlaeche: false });
assert.ok(!ohneFlaeche.includes("label-area-properties"),
    "💣 ein freies Label bekommt keinen Knopf, der nichts tun kann");
assert.ok(!ohneFlaeche.includes("label-area-geometry"), "und auch nicht den zweiten");
assert.ok(ohneFlaeche.includes("delete-label"),
    "⚠️ die übrigen Kacheln bleiben aber -- geprüft, damit die Bedingung nicht zu viel wegnimmt");

// 🪤 Der Vorgabewert ist „keine Fläche". Ein Aufrufer, der die Frage nicht beantwortet, bekommt die
// Kacheln NICHT -- die sichere Richtung: ein fehlender Knopf ist ärgerlich, ein toter irreführend.
assert.ok(!editor.labelActionsMarkup("lab-1").includes("label-area-properties"),
    "ohne Angabe bleiben sie weg");

// ---- der Besucher sieht gar nichts davon -------------------------------------------------------------

const besucher = ladePopups({ editMode: false });
assert.strictEqual(besucher.labelActionsMarkup("lab-1", "", { hatFlaeche: true }), "",
    "🔴 das ganze Band gehört dem Editor -- ohne Bearbeiten-Modus kein Markup");

// ---- und der Aufrufer beantwortet die Frage auch --------------------------------------------------
//
// 💣 Eine grüne Kachel-Funktion beweist nichts, solange niemand `hatFlaeche` übergibt: dann stünden
// die zwei Kacheln nirgends. Geprüft am Quelltext ohne Kommentare.
const popupsQuelle = read("js", "ui", "popups.js");
const ohneKommentare = popupsQuelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(/labelActionsMarkup\([^)]*hatFlaeche/.test(ohneKommentare),
    "💣 labelPopupMarkup sagt der Kachelfunktion, ob eine Fläche da ist");

// ---- die Handgriffe sind verdrahtet ------------------------------------------------------------------

const routingOhneKommentare = read("js", "routing", "routing.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(routingOhneKommentare.includes('"label-area-properties"'),
    "💣 der Klick auf „Eigenschaften“ wird behandelt");
assert.ok(routingOhneKommentare.includes('"label-area-geometry"'),
    "und der auf „Fläche bearbeiten“");
assert.ok(routingOhneKommentare.includes("avesmapsLabelFlaechenHandgriff("),
    "🔴 beide über DIESELBE Auflösung Label -> Region -> nächste Fläche, kein zweiter Weg");

// ---- und das Kachelmenü erreicht auch ein Kurvenlabel ------------------------------------------------
//
// 💣 Der Kurvenriegel meldet den Marker ab, und mit ihm sein Popup. Ohne diesen Weg wäre ein
// Kurvenlabel im Standardmodus über KEINEN Weg mehr zu bearbeiten -- dieselbe Klasse Fehler wie bei
// den verwaisten Aussenhüllen.
const overlayOhneKommentare = read("js", "map-features", "map-features-path-label-canvas-overlay.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(overlayOhneKommentare.includes("avesmapsOeffneLabelKachelmenue("),
    "💣 der Klick auf den GEMALTEN Namen öffnet das Kachelmenü");

const labelsOhneKommentare = read("js", "map-features", "map-features-labels.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(labelsOhneKommentare.includes("function avesmapsOeffneLabelKachelmenue"),
    "und es gibt sie");
assert.ok(/avesmapsOeffneLabelKachelmenue[\s\S]{0,700}labelPopupMarkup\(/.test(labelsOhneKommentare),
    "🔴 mit DEMSELBEN Markup wie am Marker -- kein zweites, mageres Menü");
assert.ok(/avesmapsOeffneLabelKachelmenue[\s\S]{0,700}IS_EDIT_MODE/.test(labelsOhneKommentare),
    "⚠️ und nur für Editoren");

// 🔴 Die Ansicht wechselt mit -- sonst zeigt „Eigenschaften“ im Standardmodus auf Flächen, die gar
// nicht geladen sind, und der Handgriff liefe ins Leere.
assert.ok(labelsOhneKommentare.includes("wechsleAnsicht"),
    "die Auflösung kann die Ansicht wechseln");
assert.ok(/avesmapsLabelFlaechenHandgriff[\s\S]{0,400}wechsleAnsicht: true/.test(labelsOhneKommentare),
    "💣 und die beiden Kacheln nutzen genau das (Owner: „hier wechselt die ansicht in die landschaft“)");

console.log("label-flaechen-kacheln.test.js: OK");
