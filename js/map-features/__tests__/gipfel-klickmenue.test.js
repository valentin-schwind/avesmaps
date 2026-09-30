const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "../../..");

function originalfunktion(datei, name) {
	const quelle = fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
	const anfang = quelle.indexOf(`function ${name}(`);
	assert.notEqual(anfang, -1, name);
	const ende = quelle.indexOf("\n}", anfang);
	assert.notEqual(ende, -1, name);
	return quelle.slice(anfang, ende + 2);
}

async function pruefeGipfel(labelType, topographie) {
	let speichernAbschliessen;
	let gespeichert = 0;
	let invalidiert = 0;
	let sperren = 0;
	let entsperren = 0;
	const speichern = new Promise((resolve) => { speichernAbschliessen = resolve; });
	const label = { publicId: "gipfel-1", text: "Testgipfel", labelType, coordinates: [10, 20] };
	const kontext = {
		IS_EDIT_MODE: true,
		IS_INFOPANEL_MODE: false,
		avesmapsLabelBedarfAktiv: () => true,
		avesmapsLabelPlatzhalterIcon: () => ({}),
		syncLabelMarkerVisibility: () => {},
		selectEcosystemAreaOfLabel: () => {},
		avesmapsLabelMenueFlaechenzahlNachziehen: () => {},
		isEcosystemPeakActive: () => topographie,
		isEcosystemPeakSubtype: (typ) => ["berggipfel", "vulkan"].includes(typ),
		ecosystemRegionOfLabel: () => null,
		labelPopupSubtitle: () => labelType,
		locationPopupMarkup: (werte) => werte.actionsMarkup,
		locationPopupEditorBandMarkup: (kacheln) => kacheln.join(""),
		popupActionButtonMarkup: ({ label: titel, attributes }) => `<button data-popup-action="${attributes["data-popup-action"]}">${titel}</button>`,
		popupActionGlyphMarkup: () => "",
		getPowerlineEndpointByPublicId: () => null,
		isEligiblePowerlineEndpoint: () => false,
		saveLabelPosition: () => { gespeichert += 1; return speichern; },
		invalidateEcosystemHeightForPeak: () => { invalidiert += 1; },
		acquireFeatureSoftLock: () => { sperren += 1; },
		releaseFeatureSoftLock: () => { entsperren += 1; },
		showFeedbackToast: () => {},
		L: {
			marker: (koordinaten, optionen) => {
				const ereignisse = new Map();
				let ziehbar = optionen.draggable;
				return {
					options: optionen,
					dragging: {
						enable() { ziehbar = true; },
						disable() { ziehbar = false; },
						enabled() { return ziehbar; },
					},
					on(name, callback) {
						ereignisse.set(name, [...(ereignisse.get(name) || []), callback]);
						return this;
					},
					fire(name) { (ereignisse.get(name) || []).forEach((callback) => callback()); },
					bindPopup(bauer, popupOptionen) { this.popup = bauer; this.popupOptionen = popupOptionen; },
					closePopup() { this.geschlossen = true; },
				};
			},
		},
	};
	vm.createContext(kontext);
	for (const name of ["createLabelMarkerEntry", "refreshLabelMarkerPopup", "setLabelMoveActive"]) {
		vm.runInContext(originalfunktion("js/map-features/map-features-labels.js", name), kontext);
	}
	for (const name of ["labelPopupMarkup", "labelEditorBandMarkup", "labelActionsMarkup"]) {
		vm.runInContext(originalfunktion("js/ui/popups.js", name), kontext);
	}
	const entry = kontext.createLabelMarkerEntry(label);
	assert.equal(entry.marker.dragging.enabled(), false, "Neue Gipfel sind nicht sofort ziehbar.");
	assert.match(entry.marker.popupOptionen.className, /floating-location-popup/);
	entry.marker.fire("click");
	assert.equal(entry.marker.dragging.enabled(), false, "Ein Labelklick startet keinen Verschiebemodus.");
	assert.equal(gespeichert, 0, "Ein Labelklick speichert keine neue Position.");
	const menue = entry.marker.popup();
	for (const titel of ["Label verschieben", "Bearbeiten", "Label duplizieren", "Label löschen"]) {
		assert.ok(menue.includes(`>${titel}</button>`), titel);
	}
	assert.equal((menue.match(/<button /g) || []).length, 4);
	kontext.setLabelMoveActive(entry, true);
	assert.equal(entry.marker.dragging.enabled(), true);
	assert.equal(entry.marker.geschlossen, true);
	assert.equal(sperren, 1);
	entry.marker.fire("dragend");
	assert.equal(gespeichert, 1);
	assert.equal(entry.marker.dragging.enabled(), false, "Loslassen beendet auch beim Gipfel den Verschiebemodus.");
	assert.equal(entsperren, 1);
	assert.equal(invalidiert, 0, "Das Höhenfeld wartet auf die gespeicherte Position.");
	speichernAbschliessen();
	await speichern;
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(invalidiert, topographie ? 1 : 0);
}

(async () => {
	for (const typ of ["berggipfel", "vulkan"]) {
		await pruefeGipfel(typ, true);
		await pruefeGipfel(typ, false);
	}
	console.log("Gipfel-Kachelmenü: Erstellen, Klick, Verschieben und Speichern geprüft.");
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
