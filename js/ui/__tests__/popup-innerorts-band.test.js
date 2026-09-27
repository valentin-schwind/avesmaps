// Die Kachel „⊖ Von der Karte nehmen" im Kachelband der Infobox -- nur bei einem Punkt mit
// gesetztem „Innerorts" (Entwurf docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md
// §4.1, Mockup docs/innerorts-mockup.html Szene 3).
//
// popups.js ist ein globales Skript ohne module.exports -- es wird hier in einer vm-Umgebung mit
// Attrappen ausgeführt (dieselbe Rezeptur wie popup-editor-band.test.js/popup-crossing-report.test.js).
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/ui/__tests__/popup-innerorts-band.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

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
		// Die EINE Antwort auf „Bauwerk?" im Browser -- aus der echten Datei, nicht nachgebaut.
		avesmapsIstBauwerksklasse: require(path.join(ROOT, "js", "ui", "ortsklassen.js")).avesmapsIstBauwerksklasse,
		console,
		window: {},
		document: { querySelector: () => null, querySelectorAll: () => [] },
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read("js", "ui", "popups.js"), sandbox, { filename: "popups.js" });
	return sandbox;
}

// ---- Ohne "Innerorts" gibt es die Kachel nicht, "Ort löschen" bleibt unverändert ------------------
{
	const editor = ladePopups({ editMode: true });
	const markup = editor.locationActionsMarkup("Neu-Gareth", "pid-1", { coordinates: [1, 2] });
	assert.ok(!markup.includes("Von der Karte nehmen"), "kein innerorts -> keine Kachel");
	assert.ok(markup.includes(">Ort löschen<"), "„Ort löschen“ bleibt trotzdem da");
	console.log("ohne innerorts: OK");
}

// ---- Mit "Innerorts" steht sie VOR "Ort löschen", trägt die richtigen Attribute -------------------
{
	const editor = ladePopups({ editMode: true });
	const location = { coordinates: [1, 2], locationType: "stadtviertel", innerorts: { ort: "pid-gareth" } };
	const markup = editor.locationActionsMarkup("Neu-Gareth", "pid-1", location);

	const nehmenAt = markup.indexOf(">Von der Karte nehmen<");
	assert.ok(nehmenAt > -1, "die Kachel steht da");
	const loeschenAt = markup.indexOf(">Ort löschen<");
	assert.ok(loeschenAt > -1 && nehmenAt < loeschenAt, "sie steht VOR „Ort löschen“");
	const bearbeitenAt = markup.indexOf(">Bearbeiten<");
	assert.ok(bearbeitenAt > -1 && bearbeitenAt < nehmenAt, "und NACH „Bearbeiten“ (Mockup Szene 3)");

	// Genau die Kachel herausschneiden (nicht das ganze Markup vergleichen).
	const kachelMatch = /<button[^>]*data-popup-action="take-location-off-map"[^>]*>[\s\S]*?<\/button>/.exec(markup);
	assert.ok(kachelMatch, "die Kachel trägt data-popup-action=\"take-location-off-map\"");
	const kachel = kachelMatch[0];
	assert.ok(kachel.includes('data-public-id="pid-1"'), "sie trägt die publicId");
	assert.ok(kachel.includes('data-location-name="Neu-Gareth"'), "und den Namen");
	assert.ok(kachel.includes(">⊖<"), "das Zeichen ist ⊖");
	assert.ok(!kachel.includes("location-popup__action-button--danger"),
		"sie ist NICHT rot -- sie ist umkehrbar (anders als „Ort löschen“)");

	console.log("mit innerorts: OK");
}

// ---- M2 der Gesamtpruefung: die Kachel haengt AUCH an der Ortsgroesse -----------------------------
// Der Server verweigert „Von der Karte nehmen" an jeder Ortsgroesse ausser Stadtviertel/Bauwerk -- ein
// Dorf mit (liegengebliebenem) innerorts bekaeme sonst eine Kachel, die nur absagt.
{
	const editor = ladePopups({ editMode: true });
	const dorf = editor.locationActionsMarkup("Neu-Gareth", "pid-1", { coordinates: [1, 2], locationType: "dorf", innerorts: { ort: "pid-gareth" } });
	assert.ok(!dorf.includes("Von der Karte nehmen"), "ein Dorf bekommt die Kachel nicht, auch mit innerorts");
	const ohneTyp = editor.locationActionsMarkup("Neu-Gareth", "pid-1", { coordinates: [1, 2], innerorts: { ort: "pid-gareth" } });
	assert.ok(!ohneTyp.includes("Von der Karte nehmen"), "ohne bekannte Ortsgroesse keine Kachel (die sichere Richtung)");
	const bauwerk = editor.locationActionsMarkup("Tempel", "pid-2", { coordinates: [1, 2], locationType: "gebaeude", innerorts: { ort: "pid-gareth" } });
	assert.ok(bauwerk.includes(">Von der Karte nehmen<"), "ein Bauwerk bekommt sie");
	console.log("Kachel haengt an der Ortsgroesse: OK");
}

// ---- Ein Besucher sieht das ganze Band nicht, auch nicht mit gesetztem Innerorts ------------------
{
	const besucher = ladePopups({ editMode: false });
	const location = { coordinates: [1, 2], locationType: "stadtviertel", innerorts: { ort: "pid-gareth" } };
	const markup = besucher.locationActionsMarkup("Neu-Gareth", "pid-1", location);
	assert.ok(!markup.includes("Von der Karte nehmen"), "kein Bearbeiten-Modus -> keine Kachel");
	assert.ok(!markup.includes("location-popup__editor-band"), "und gar kein Band");
	console.log("Besucher: OK");
}

console.log("popup-innerorts-band: alle Zusicherungen erfüllt");
