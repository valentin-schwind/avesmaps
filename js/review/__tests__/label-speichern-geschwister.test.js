// EIN LABEL SPEICHERN ZIEHT SEINE GESCHWISTER SOFORT AUF DIE KARTE -- handleLabelEditFormSubmit ausgefuehrt.
//
// 🔴 DER ANLASS (15.09.2026, „eine Quelle, die Region"): haengt ein Label an einer Flaeche und aendert sein
// Speichern die Wiki-Landschaft, schreibt der Server den Artikel an die REGION, und die uebrigen Beschriftungen
// der Flaeche folgen (api/_internal/app/landschaft-wiki.php). Sie reisen als `labels` in der Antwort. Der
// Browser holt die Kartennutzlast nach einem Speichern nicht neu -- ohne diese Zeile zeigte die Infobox des
// Geschwisters bis zum naechsten Live-Abgleich den alten Artikel.
//
// ⭐ Die Funktion wird AUSGEFUEHRT (vm), nicht per Regex gelesen: ein Regex kennt keinen Geltungsbereich.

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "..", "review-editor-submit.js"), "utf8");

async function speichern(antwort, aktion = "update_label") {
	const angewandt = [];
	const reihenfolge = [];
	class HTMLFormElement {
		reportValidity() {
			return true;
		}
	}
	const kontext = {
		HTMLFormElement,
		console,
		attachActiveReviewReportContext: (rumpf) => rumpf,
		buildLabelEditPayload: () => ({ action: aktion, public_id: aktion === "update_label" ? "l-1" : "", text: "Weydenauer See" }),
		labelEditEntry: aktion === "update_label" ? { label: { publicId: "l-1" } } : null,
		pendingLabelMoveAfterEditEntry: null,
		setLabelEditStatus: () => {},
		submitMapFeatureEdit: async () => antwort,
		applyLabelFeatureResponse: () => reihenfolge.push("eigenes"),
		addCreatedLabelFeature: () => ({ label: { publicId: "neu" } }),
		commitLabelDisplayPreview: () => {},
		updateRevisionFromEditResponse: () => {},
		applyLabelFeaturesLocally: (features) => {
			angewandt.push(features);
			reihenfolge.push("geschwister");
		},
		ecosystemPushLabelChangesToRegion: async () => reihenfolge.push("rueckweg"),
		loadChangeLog: async () => {},
		activeReviewReportId: null,
		setLabelEditDialogOpen: () => {},
		setLabelMoveActive: () => {},
		showFeedbackToast: () => {},
	};
	vm.createContext(kontext);
	vm.runInContext(quelle, kontext);
	await kontext.handleLabelEditFormSubmit({ preventDefault() {}, currentTarget: new HTMLFormElement() });
	return { angewandt, reihenfolge };
}

(async () => {
	// 1. Die Antwort traegt mitgezogene Geschwister -> sie gehen auf die Karte.
	const geschwister = [{ id: "l-2", properties: { public_id: "l-2", wiki_region: { wiki_key: "weydenauer-see" } } }];
	const mit = await speichern({ ok: true, feature: { id: "l-1" }, labels: geschwister });
	assert.strictEqual(mit.angewandt.length, 1, "1: die Geschwister werden einmal angewandt");
	assert.strictEqual(mit.angewandt[0][0].id, "l-2", "1: und zwar genau die aus der Antwort");
	assert.ok(mit.reihenfolge.indexOf("geschwister") > mit.reihenfolge.indexOf("eigenes"),
		"1: NACH dem eigenen Label -- sonst ueberschriebe dessen alter Stand nichts, aber die Reihenfolge der Antwort waere verdreht");

	// 2. Ohne `labels` (der Normalfall) wird nichts angewandt.
	const ohne = await speichern({ ok: true, feature: { id: "l-1" } });
	assert.strictEqual(ohne.angewandt.length, 0, "2: ohne mitgezogene Geschwister kein Aufruf");

	// 3. Eine leere Liste ist dasselbe wie keine -- kein Neuzeichnen fuer nichts.
	const leer = await speichern({ ok: true, feature: { id: "l-1" }, labels: [] });
	assert.strictEqual(leer.angewandt.length, 0, "3: eine leere Liste zeichnet nichts neu");

	console.log("OK -- label-speichern-geschwister: mitgezogene Beschriftungen gehen sofort auf die Karte");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
