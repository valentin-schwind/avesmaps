// Die Warteschlange der gemeldeten Quellen ERREICHT den Quellenkasten -- beide Oeffner aus der Meldung
// wirklich ausgefuehrt, gegen die echten openLocationEditDialog / populateLocationEditForm /
// mountLocationEditFeatureSources aus review-locations.js.
//
// 🪤 Der Fehler, den dieser Test festhaelt (Owner 03.09.2026: „irgendwie sieht das anders aus"): die Oeffner
// befuellten `activeReviewReportSourceQueue` NACH openLocationEditDialog(...), der Quellenkasten wird aber
// beim Oeffnen montiert und liest die Warteschlange SYNCHRON in `opts.meldung` -- die gemeldete Quelle kam
// nie an, der Dialog zeigte den Kasten leer und die Falte zu. Vor Paket 2 hatte dieselbe Reihenfolge
// funktioniert, weil die alte Vorschlagsgruppe erst im `.then` NACH der Serverliste gelesen wurde --
// eine Zusage aus dem Timing, keine aus dem Code. Deshalb reist die Warteschlange jetzt MIT dem Oeffnen-
// Aufruf (`meldungQuellen`), nicht ueber den Modulzustand danach.
//
// 💣 Ausgefuehrt, nicht gelesen: ein Regex „beide Oeffner fuellen die Warteschlange" war gruen, waehrend
// der Kasten leer blieb (meldung-im-quellenkasten.test.js, Abschnitt 6, bis 03.09.2026 abends).
//
// Aus der Wurzel des Repos:  node js/review/__tests__/meldung-warteschlange-erreicht-den-mount.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");

// ---- Dokument-Attrappe: jedes Element existiert, traegt Wert/Haken/Text und ein wenig DOM-Oberflaeche -----
function element(id) {
	const el = {
		id: id || "", value: "", checked: false, hidden: false, textContent: "", innerHTML: "", disabled: false,
		dataset: {}, style: {}, children: [],
		classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
		addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
		removeAttribute() {}, focus() {}, blur() {}, reset() {}, reportValidity() { return true; },
		// Nie null: der Dialog schreibt in Unterknoten, ohne sie zu pruefen (Wunsch-Kasten, Statuszeilen).
		querySelector(sel) { return element(String(sel)); }, querySelectorAll() { return []; },
		appendChild(k) { this.children.push(k); return k; }, removeChild() {}, remove() {}, after() {}, before() {},
		closest() { return null; }, getBoundingClientRect() { return { width: 500, height: 40, left: 0, top: 0 }; },
		cloneNode() { return element(this.id); }, replaceWith() {}, scrollIntoView() {},
	};
	return el;
}
const elemente = new Map();
const hole = (id) => { if (!elemente.has(id)) { elemente.set(id, element(id)); } return elemente.get(id); };

// jQuery-Attrappe: jede Methode gibt die Kette zurueck -- das Fenster braucht nur prop()/hide()/show().
const kette = new Proxy(function () {}, {
	get(_, prop) { if (prop === "length") { return 0; } return () => kette; },
	apply() { return kette; },
});

function macheKontext() {
	const mounts = [];
	const context = {
		console, setTimeout, clearTimeout, Promise, URL, URLSearchParams, Map, Set,
		// Fenster-Oberflaeche, die runtime-state.js beim Laden anfasst.
		addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
		innerWidth: 1400, innerHeight: 900, location: { href: "https://avesmaps.de/", search: "", pathname: "/", origin: "https://avesmaps.de" },
		navigator: { userAgent: "node", maxTouchPoints: 0 }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
		requestAnimationFrame: (f) => setTimeout(f, 0), performance: { now: () => 0 }, screen: { width: 1400, height: 900 },
		window: null, globalThis: null, module: undefined, require: undefined,
		document: {
			getElementById: hole,
			querySelector: () => null, querySelectorAll: () => [],
			createElement: () => element(""), body: element("body"),
			addEventListener() {}, removeEventListener() {}, activeElement: null,
		},
		$: kette, jQuery: kette,
		L: { latLng: (a, b) => (typeof a === "object" && a ? { lat: Number(a.lat), lng: Number(a.lng) } : { lat: Number(a), lng: Number(b) }) },
		// Das Bauteil: nur der Aufruf zaehlt -- was der Mount als `meldung` bekommt.
		mountFeatureSourceEditor(containerEl, entityType, publicIdGetter, opts) { mounts.push({ entityType, publicId: publicIdGetter(), meldung: opts && opts.meldung ? opts.meldung : null }); return Promise.resolve({ ok: true, sources: [], revision: 7 }); },
		createPendingFeatureSourceStore: () => ({ request: async () => ({ ok: true, sources: [] }), toSuggestions: () => [], count: () => 0 }),
		// Helfer des Dialogs, die hier nichts zur Sache tun.
		escapeHtml: (s) => String(s), normalizeLocationType: (t) => String(t || "dorf"), formatLocationReportCoordinates: () => "0 / 0",
		getWikiLocationLink: () => ({ url: "", label: "" }), acquireFeatureSoftLock: async () => true, releaseFeatureSoftLock: async () => true,
		showFeedbackToast() {}, renderSettlementCoatSection: async () => {}, syncSettlementWikiFromServer: async () => {},
		syncModalDialogBodyState() {}, getLocationEditDialogElement: () => hole("location-edit-dialog"),
		fetch: async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }),
		markChangeReportFields() {}, clearChangeReportFieldMarks() {}, showLocationEditChangeRequest() {}, hideLocationEditChangeRequest() {},
		setLocationEditStatus() {}, syncLabelPriorityOutput() {}, openLabelEditDialog() {},
		renderSettlementWikiReference() {}, settlementWikiUebernommenLeeren() {}, settlementWikiZeichneAbweichungen() {},
		attachSettlementNameAutocomplete: undefined, attachPlaceKindAutocomplete: undefined,
		// Ein Marker-Eintrag fuer den Aenderungswunsch: ein bestehender Ort mit Kennung.
		findLocationMarkerByPublicId: (publicId) => (publicId === "ort-1" ? { publicId: "ort-1", name: "Hirschfurten", locationType: "dorf", marker: { getLatLng: () => ({ lat: 500, lng: 500 }) }, location: { name: "Hirschfurten", revision: 3 } } : null),
		// Die uebrigen Helfer der zwei Dateien (aus anderen Skripten des Hauptfensters) -- Leerlauf, mit den Rueckgaben, die der Ablauf braucht.
		getLocationEditFormElement: () => hole("location-edit-form"), getLocationReportDialogElement: () => hole("location-report-dialog"),
		getLocationReportFormElement: () => hole("location-report-form"), getLocationReportServiceNoteElement: () => hole("location-report-service-note"),
		tr: (k, f) => f, isWithinMapBounds: () => true, findLocationMarkerByName: () => null, findDuplicateLocationByName: () => null, duplicateLocationNameMessage: () => "",
		sizeSlugFromLocationType: (t) => String(t || ""), refreshLocationMarkerPopup() {}, syncLocationMarkerVisibility() {}, setFieldContextLocked() {},
		setLabelEditDialogOpen() {}, setLocationReportStatus() {}, setLocationReportSubmitPending() {}, submitLocationReportRequest: async () => ({ ok: true }),
		isLocationReportServiceConfigured: () => true, loadChangeLog() {}, loadReviewReports() {}, updateReviewReportStatus: async () => ({ ok: true }),
		clearReviewReportMarker() {}, createCitymapFromReviewReport: async () => ({}), addCitymapLinksFromReviewReport: async () => ({}), openAvesmapsCitymapEditorOverlay() {},
		attachSourceAutocomplete: () => () => {}, apiErrorMessage: (e) => String(e && e.message || e),
		avesmapsMediaLicenseFieldsMarkup: () => "", avesmapsMediaLicenseIsPublic: () => false, avesmapsMediaLicenseNoteVorschlag: () => "", avesmapsMediaLicenseSyncSelectHidden() {},
		settlementWikiKeinArtikelFuerPayload: () => null, settlementWikiUebernommenFuerPayload: () => [],
		locationEditNameAutocompleteDetach: null, locationEditPlaceKindAutocompleteDetach: null,
		// Der Kontextmenue-Weg (map-features-location-editing.js): oeffnet den Dialog fuer einen Marker-Eintrag.
		editLocationDetails(markerEntry) { return context.openLocationEditDialog({ markerEntry }); },
		mounts,
	};
	context.window = context; context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(lies("js/app/runtime-state.js"), context);
	vm.runInContext(lies("js/review/review-locations.js"), context);
	vm.runInContext(lies("js/review/review-report-flow.js"), context);
	return context;
}

const QUELLE = { url: "https://www.garetien.de/index.php/Baronie_Hirschfurten", source_id: 0, label: "", pages: "12", reference_kind: "", license: "", attribution: "",
	vorbelegung: { url: "https://www.garetien.de/index.php/Baronie_Hirschfurten", state: "neu", http_status: 0, title: "", site: "", corpus: null, existing: null } };
const ALTFORM = { url: "", source_id: 0, label: "Von Eigenen Gnaden", pages: "6" };

// ---- 1. Neuer Ort aus der Meldung: die Warteschlange steht im Mount (Anlege-Puffer) --------------------------
{
	const ctx = macheKontext();
	ctx.openLocationEditDialogFromReport({ id: 5, name: "Hirschfurten", report_subtype: "dorf", comment: "", wiki_url: "", sources: [QUELLE, ALTFORM] }, { lat: 500, lng: 500 });
	assert.strictEqual(ctx.mounts.length, 1, "der Quellenkasten wird beim Oeffnen genau einmal montiert");
	const m = ctx.mounts[0];
	assert.strictEqual(m.entityType, "settlement", "… auf settlement");
	assert.strictEqual(m.publicId, "", "… im Anlege-Fall ohne Kennung (Puffer)");
	assert.ok(m.meldung && Array.isArray(m.meldung.quellen), "… und der Mount BEKOMMT die Warteschlange -- nicht erst der Modulzustand danach: " + JSON.stringify(m.meldung));
	assert.strictEqual(m.meldung.quellen.length, 1, "… genau die verknuepfbare Quelle (die Altform ohne Link bleibt Beschreibungszeile)");
	assert.strictEqual(m.meldung.quellen[0].url, QUELLE.url, "… mit der gemeldeten Adresse");
	assert.ok(hole("location-edit-description").value.includes("Quelle: Von Eigenen Gnaden, S. 6"), "die Altform steht weiter in der Beschreibung");
	assert.strictEqual(vm.runInContext("activeReviewReportSourceQueue", ctx).length, 1, "der Laufzeitzustand traegt sie ebenfalls (die Speichern-Wege lesen ihn)");
}

// ---- 2. Aenderungswunsch an einem bestehenden Ort: dieselbe Zusage ------------------------------------------
{
	const ctx = macheKontext();
	const ok = ctx.openLocationEditDialogFromChangeReport({ id: 6, report_source: "map_reports", entity_public_id: "ort-1", name: "Hirschfurten", comment: "", sources: [QUELLE], changes: {} });
	assert.notStrictEqual(ok, false, "der Oeffner findet den Ort");
	assert.strictEqual(ctx.mounts.length, 1, "genau ein Mount");
	assert.strictEqual(ctx.mounts[0].publicId, "ort-1", "… auf den bestehenden Ort");
	assert.ok(ctx.mounts[0].meldung && ctx.mounts[0].meldung.quellen.length === 1 && ctx.mounts[0].meldung.quellen[0].url === QUELLE.url,
		"… und die gemeldete Quelle steht im Mount: " + JSON.stringify(ctx.mounts[0].meldung));
}

// ---- 3. Ein normaler Dialog (Kontextmenue) bekommt KEINE Warteschlange -- auch nicht die des vorigen Oeffnens -
{
	const ctx = macheKontext();
	ctx.openLocationEditDialogFromReport({ id: 5, name: "Hirschfurten", report_subtype: "dorf", sources: [QUELLE] }, { lat: 500, lng: 500 });
	ctx.openLocationEditDialog({ markerEntry: ctx.findLocationMarkerByPublicId("ort-1") });
	assert.strictEqual(ctx.mounts.length, 2, "zwei Mounts");
	assert.strictEqual(ctx.mounts[1].meldung, null, "der zweite, normale Dialog traegt keine Warteschlange -- der Zustand der Meldung bleibt nicht kleben");
	assert.strictEqual(vm.runInContext("activeReviewReportSourceQueue", ctx).length, 0, "… und der Laufzeitzustand ist geleert");
}

console.log("meldung-warteschlange-erreicht-den-mount: alle Zusicherungen erfuellt");
