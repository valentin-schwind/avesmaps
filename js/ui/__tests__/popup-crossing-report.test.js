const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

// Woertlich aus popup-editor-band.test.js -- dort laeuft crossingActionsMarkup schon durch.
function ladePopups({ editMode }) {
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
const markup = editor.crossingActionsMarkup("Kreuzung-2090", "pid-kr");

// 💣 NUR die Melden-Kachel herausschneiden. „Kreuzung verschieben" und „Kreuzung loeschen" tragen
// data-location-name zu Recht -- sie fassen den Marker ueber seinen Namen an. Ein Vergleich gegen
// das GANZE Markup wuerde deshalb immer anschlagen und nichts beweisen.
const kachel = /<button[^>]*data-popup-action="report-crossing"[^>]*>/.exec(markup);
assert.ok(kachel, "der Editor bekommt die Melden-Kachel");
assert.ok(kachel[0].includes('data-public-id="pid-kr"'), "sie traegt die stabile publicId");
assert.ok(!kachel[0].includes("data-location-name"),
	"💣 und NICHT den angezeigten Namen: „Kreuzung-2090\" ist ein laufender Zaehler ueber die Payload-Reihenfolge und verschiebt sich, sobald jemand eine Kreuzung anlegt, die frueher einsortiert");

const besucher = ladePopups({ editMode: false });
assert.strictEqual(besucher.crossingActionsMarkup("Kreuzung-2090", "pid-kr"), "",
	"ein Besucher sieht das Band gar nicht");

// Der Klick-Zweig ist verdrahtet und benutzt den VORHANDENEN Pin-Link-Bauer.
const routing = read("js", "routing", "routing.js");
assert.ok(routing.includes('action === "report-crossing"'), "der Klick-Zweig existiert");
assert.ok(/report-crossing[\s\S]{0,1200}buildSharePinLink/.test(routing),
	"und baut die Adresse mit buildSharePinLink, keinem zweiten Link-Bauer");

console.log("popup crossing report tests passed");
