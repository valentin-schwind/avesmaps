// „Speichern" im vereinigten Landschaftsfenster ist EIN Ablauf -- die zwei Hälften NACHEINANDER.
//
// 🚩 Anlass (27.09.2026): „Hochmoor von Waskir" -- der Owner konnte die Wiki-Zuweisung speichern, ein
// Editor nicht. Die Wurzel war ein Rennen: „Speichern" schickte BEIDE Formulare gleichzeitig ab
// (`requestSubmit`), und wer zuerst fertig war, entschied, was ankam:
//   - die Beschriftung schloss das Fenster und leerte den gemeinsamen Kopf, während die Fläche noch las;
//   - beide schrieben DIESELBE Beschriftung mit derselben Revision -- der Zweite bekam 409;
//   - beide schrieben die Region (die Fläche direkt, die Beschriftung über ihren Rückweg).
// Owner: „kannst du eigentlich mal die scheiss race conditions von flächen und label bereinigen?"
//
// TEIL A fährt den Ablauf (js/map-features/landschaft-dialog.js) mit Attrappen-Hälften: Reihenfolge,
// kein Überlappen, erst prüfen dann schreiben, Abbruch, EIN Schliessen, EIN Lauf.
// TEIL B fährt ihn mit den ECHTEN Hälften -- dem Flächenmodul und dem Speicherauftrag der Beschriftung
// (js/review/review-editor-submit.js): wer schreibt welche Zeile, wie oft, und wann.
// TEIL C fährt den gemeinsamen Kopf: was der Editor in der Lücke vor dem Gegenpart tippt, bleibt.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-ablauf.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
let checks = 0;

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 5));
const ruhig = async (n) => { for (let i = 0; i < (n || 4); i++) { await ruhe(); } };

function aufgeschoben() {
	let erfuellen;
	let ablehnen;
	const zusage = new Promise((ja, nein) => { erfuellen = ja; ablehnen = nein; });
	return { zusage, erfuellen, ablehnen };
}

function scheinFeld(wert) {
	return {
		value: wert === undefined ? "" : wert, options: [], checked: false, disabled: false, hidden: false,
		textContent: "", innerHTML: "", className: "", title: "", dataset: {}, style: {},
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceChildren() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
		focus() {}, select() {}, click() {}, dispatchEvent() { return true; }, contains() { return false; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
	};
}

/**
 * Ein Element, dessen Zuhörer wirklich ausgelöst werden -- ALLE, in Anmeldereihenfolge.
 * 🪤 Mit nur einem Zuhörer je Ereignis überschrieb die Kopf-Verdrahtung der Hülle (`input`/`change`)
 * den Zuhörer des Flächenmoduls am selben Feld, und eine Zusicherung darüber lief ins Leere.
 */
function scheinBehaelter(id, wert) {
	const zuhoerer = {};
	return Object.assign(scheinFeld(wert), {
		id,
		addEventListener(typ, fn) { (zuhoerer[typ] = zuhoerer[typ] || []).push(fn); },
		removeEventListener(typ, fn) { zuhoerer[typ] = (zuhoerer[typ] || []).filter((f) => f !== fn); },
		contains() { return true; },
		feuere(typ, ziel) {
			let ergebnis;
			(zuhoerer[typ] || []).slice().forEach((fn) => {
				ergebnis = fn({ target: ziel || this, currentTarget: this, preventDefault() {} });
			});
			return ergebnis;
		},
	});
}

function scheinZiel(merkmal, wert) {
	const element = {
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	};
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

function dokumentAus(elemente) {
	return {
		readyState: "complete",
		getElementById(id) {
			if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = scheinFeld(""); }
			return elemente[id];
		},
		querySelector() { return null; },
		querySelectorAll() { return []; },
		createElement() { return scheinFeld(""); },
		addEventListener() {},
		body: scheinFeld(""), documentElement: scheinFeld(""),
	};
}

const GRUNDWERTE = {
	console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
	String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
	isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
};

// ══ TEIL A: DER ABLAUF MIT ATTRAPPEN-HÄLFTEN ═══════════════════════════════════════════════════════

/**
 * `haelften.flaeche` / `haelften.beschriftung`: `{ fehler }` oder `{ warten, wirft, name }`. Jede
 * Hälfte schreibt in `log`, was sie tut -- der Test liest daraus Reihenfolge und Überlappen.
 */
function huelle(haelften) {
	const log = [];
	const toasts = [];
	const elemente = { "landschaft-dialog-overlay": scheinFeld("") };
	const macheHaelfte = (name, einstellung) => (optionen) => {
		log.push("vorbereiten:" + name + ":" + (optionen && optionen.verbund === true ? "verbund" : "allein"));
		if (einstellung.fehler) {
			return { fehler: einstellung.fehler };
		}
		return {
			name: einstellung.name || "",
			ausfuehren: async () => {
				log.push("start:" + name);
				if (einstellung.warten) { await einstellung.warten.zusage; }
				if (einstellung.wirft) { throw new Error(einstellung.wirft); }
				log.push("ende:" + name);
				return {};
			},
			abschliessen: async ({ leise = false } = {}) => { log.push("abschluss:" + name + ":" + (leise ? "leise" : "laut")); },
			fehlgeschlagen: () => { log.push("fehlgeschlagen:" + name); },
		};
	};
	const kasten = Object.assign({}, GRUNDWERTE, {
		document: dokumentAus(elemente),
		showFeedbackToast: (text, ton) => { toasts.push({ text, ton }); },
	});
	kasten.window = kasten;
	kasten.globalThis = kasten;
	if (haelften.flaeche) {
		kasten.AvesmapsEcosystemProperties = { speicherAuftrag: macheHaelfte("flaeche", haelften.flaeche) };
	}
	if (haelften.beschriftung) {
		kasten.avesmapsBeschriftungSpeicherAuftrag = macheHaelfte("beschriftung", haelften.beschriftung);
	}
	vm.createContext(kasten);
	vm.runInContext(lies("js/map-features/landschaft-dialog.js"), kasten, { filename: "landschaft-dialog.js" });
	const lauf = (code) => vm.runInContext(code, kasten);
	lauf('avesmapsLandschaftDialogHaelfte("flaeche", ' + Boolean(haelften.flaecheGeladen !== false) + ");"
		+ 'avesmapsLandschaftDialogHaelfte("beschriftung", ' + Boolean(haelften.beschriftungGeladen !== false) + ");");
	const status = () => ({
		text: elemente["landschaft-dialog-status"] ? elemente["landschaft-dialog-status"].textContent : "",
		art: elemente["landschaft-dialog-status"] ? elemente["landschaft-dialog-status"].dataset.status : undefined,
	});
	const gesperrt = () => Boolean(elemente["landschaft-dialog-save"] && elemente["landschaft-dialog-save"].disabled);
	return { kasten, log, toasts, lauf, status, gesperrt, elemente };
}

(async () => {
	// ── A1. Die Fläche zuerst, die Beschriftung DANACH -- nie gleichzeitig ──────────────────────
	{
		const warten = aufgeschoben();
		const h = huelle({ flaeche: { warten, name: "Hochmoor von Waskir" }, beschriftung: { name: "Hochmoor von Waskir" } });
		const zusage = h.lauf("avesmapsLandschaftDialogSpeichern()");
		await ruhig();
		// 💣 Der Kern: BEIDE sind vorbereitet, bevor eine schreibt -- und solange die Fläche schreibt,
		// hat die Beschriftung nicht angefangen.
		assert.deepStrictEqual(h.log.slice(), [
			"vorbereiten:flaeche:verbund", "vorbereiten:beschriftung:verbund", "start:flaeche",
		], "erst beide vorbereiten, dann die Fläche -- die Beschriftung wartet: " + h.log.join(", ")); checks++;
		assert.strictEqual(h.gesperrt(), true, "während des Laufs ist die Leiste gesperrt"); checks++;
		assert.strictEqual(h.status().art, "pending", "…und die Zeile sagt, dass gespeichert wird"); checks++;

		// ⚠️ Ein zweiter Klick bekommt DIESELBE Zusage -- kein zweiter Lauf.
		const zweite = h.lauf("avesmapsLandschaftDialogSpeichern()");
		assert.strictEqual(zweite, zusage, "ein zweiter Klick während des Laufs startet keinen zweiten"); checks++;

		warten.erfuellen();
		const ergebnis = await zusage;
		assert.strictEqual(ergebnis.gespeichert, true, "der Lauf meldet Erfolg"); checks++;
		assert.deepStrictEqual(h.log.slice(3), [
			"ende:flaeche", "start:beschriftung", "ende:beschriftung",
			// 🔴 EINMAL schliessen, erst wenn beides steht -- die Beschriftung zuerst, die Fläche danach.
			"abschluss:beschriftung:leise", "abschluss:flaeche:leise",
		], "nach der Fläche die Beschriftung, dann EIN Abschluss je Hälfte: " + h.log.join(", ")); checks++;
		assert.strictEqual(h.log.filter((z) => z === "start:flaeche").length, 1, "die Fläche lief genau einmal"); checks++;
		// 🔴 EINE Meldung für beide -- zwei Toasts für ein Speichern lesen sich wie zwei Vorgänge.
		assert.strictEqual(h.toasts.length, 1, "genau eine Erfolgsmeldung: " + JSON.stringify(h.toasts)); checks++;
		assert.ok(h.toasts[0].text.indexOf("Hochmoor von Waskir") !== -1 && h.toasts[0].ton === "success",
			"sie nennt den Namen: " + h.toasts[0].text); checks++;
		assert.strictEqual(h.gesperrt(), false, "danach ist die Leiste wieder frei"); checks++;
		assert.strictEqual(h.status().text, "", "und die Zeile leer"); checks++;
	}

	// ── A2. Ungültig heisst: NICHTS geschrieben ────────────────────────────────────────────────────
	{
		const h = huelle({ flaeche: {}, beschriftung: { fehler: "Text: Bitte ausfüllen." } });
		const ergebnis = await h.lauf("avesmapsLandschaftDialogSpeichern()");
		assert.strictEqual(ergebnis.gespeichert, false, "ein ungültiges Formular speichert nicht"); checks++;
		assert.ok(!h.log.some((z) => z.indexOf("start:") === 0),
			"💣 die Fläche ist NICHT schon geschrieben, wenn die Beschriftung ungültig ist: " + h.log.join(", ")); checks++;
		assert.ok(!h.log.some((z) => z.indexOf("abschluss:") === 0), "das Fenster bleibt offen"); checks++;
		assert.strictEqual(h.status().art, "error", "die Zeile zeigt den Fehler"); checks++;
		assert.ok(h.status().text.indexOf("Beschriftung") === 0 && h.status().text.indexOf("Bitte ausfüllen") !== -1,
			"…mit der Hälfte und dem Grund: " + h.status().text); checks++;
	}

	// ── A3. Scheitert die Fläche, läuft die Beschriftung NICHT ──────────────────────────────────────
	{
		const h = huelle({ flaeche: { wirft: "Konflikt (409)." }, beschriftung: {} });
		const ergebnis = await h.lauf("avesmapsLandschaftDialogSpeichern()");
		assert.strictEqual(ergebnis.gespeichert, false, "der Lauf meldet den Fehlschlag"); checks++;
		assert.ok(!h.log.includes("start:beschriftung"),
			"die Beschriftung baute auf einem Stand auf, den es nicht gibt -- sie läuft nicht: " + h.log.join(", ")); checks++;
		assert.ok(h.log.includes("fehlgeschlagen:flaeche"), "die Fläche erfährt ihren Fehlschlag"); checks++;
		assert.ok(!h.log.some((z) => z.indexOf("abschluss:") === 0), "das Fenster bleibt offen"); checks++;
		assert.ok(/^Fläche nicht: Konflikt/.test(h.status().text), "die Zeile sagt, was nicht steht: " + h.status().text); checks++;
		assert.strictEqual(h.gesperrt(), false, "die Leiste ist auch nach einem Fehlschlag wieder frei"); checks++;
	}

	// ── A4. Scheitert die Beschriftung, sagt die Zeile, dass die Fläche schon steht ─────────────────
	{
		const h = huelle({ flaeche: {}, beschriftung: { wirft: "Label gesperrt." } });
		await h.lauf("avesmapsLandschaftDialogSpeichern()");
		assert.ok(/^Fläche gespeichert — Beschriftung nicht: Label gesperrt/.test(h.status().text),
			"halb gespeichert wird BENANNT, nicht verschwiegen: " + h.status().text); checks++;
		assert.ok(h.log.includes("fehlgeschlagen:beschriftung"), "die Beschriftung erfährt ihren Fehlschlag"); checks++;
		assert.ok(!h.log.some((z) => z.indexOf("abschluss:") === 0), "das Fenster bleibt offen"); checks++;
	}

	// ── A5. Nur eine Hälfte geladen: kein Verbund, eigene Meldung ──────────────────────────────────
	{
		const h = huelle({ flaeche: { name: "Moor-001" }, beschriftungGeladen: false });
		await h.lauf("avesmapsLandschaftDialogSpeichern()");
		assert.deepStrictEqual(h.log.slice(), [
			"vorbereiten:flaeche:allein", "start:flaeche", "ende:flaeche", "abschluss:flaeche:laut",
		], "allein: kein Verbund, und die Hälfte meldet sich selbst: " + h.log.join(", ")); checks++;
		assert.strictEqual(h.toasts.length, 0, "keine zweite Meldung neben der eigenen der Hälfte"); checks++;
	}

	// ── A6. Fehlt das Skript einer GELADENEN Hälfte, wird nichts geschrieben ─────────────────────────
	{
		const h = huelle({ flaeche: {} });
		const ergebnis = await h.lauf("avesmapsLandschaftDialogSpeichern()");
		assert.strictEqual(ergebnis.gespeichert, false, "eine fehlende Hälfte ist ein Fehler, kein stilles Weglassen"); checks++;
		assert.ok(!h.log.some((z) => z.indexOf("start:") === 0), "…und die andere wird nicht allein geschrieben"); checks++;
		assert.ok(h.status().text.indexOf("Beschriftung") === 0, "die Zeile nennt die fehlende Hälfte: " + h.status().text); checks++;
	}

	// ── A7. Beide submit-Zuhörer geben an den Ablauf ab, sobald es das Fenster gibt ──────────────────
	{
		const h = huelle({});
		assert.strictEqual(h.lauf("avesmapsLandschaftDialogUebernimmtSpeichern()"), true, "mit dem Fenster: der Ablauf übernimmt"); checks++;
		delete h.elemente["landschaft-dialog-overlay"];
		h.kasten.document.getElementById = (id) => h.elemente[id] || null;
		assert.strictEqual(h.lauf("avesmapsLandschaftDialogUebernimmtSpeichern()"), false, "ohne Fenster speichert jede Hälfte allein"); checks++;
		const eco = lies("js/map-features/map-features-ecosystem-properties.js");
		const lbl = lies("js/review/review-editor-submit.js");
		const zuhoererFlaeche = eco.slice(eco.indexOf("async function submitEcosystemPropertiesDialog("));
		const zuhoererLabel = lbl.slice(lbl.indexOf("async function handleLabelEditFormSubmit("));
		[zuhoererFlaeche, zuhoererLabel].forEach((rumpf, i) => {
			const anfang = rumpf.slice(0, 700);
			assert.ok(/avesmapsLandschaftDialogUebernimmtSpeichern\(\)/.test(anfang)
				&& /return avesmapsLandschaftDialogSpeichern\(\)/.test(anfang),
			(i === 0 ? "die Fläche" : "die Beschriftung") + " gibt ihr submit (auch Enter) an den Ablauf ab"); checks++;
		});
	}

	// ══ TEIL B: DIE ECHTEN HÄLFTEN ═══════════════════════════════════════════════════════════════
	await teilB();
	// ══ TEIL C: DER GEMEINSAME KOPF ══════════════════════════════════════════════════════════════
	await teilC();

	console.log("landschaft-dialog-ablauf: " + checks + " Zusicherungen gruen");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});

const SUCHZEILE = {
	wiki_key: "wiki:hochmoor-von-waskir", name: "Hochmoor von Waskir", art: "Moor",
	continent: "Aventurien", region_parent: "Nordmarken", description: "Ein Moor.",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Hochmoor_von_Waskir",
};
const MOOR = {
	public_id: "m1", region_public_id: "rm", region_name: "Moor-001", kind: "vegetation",
	region_type: "suempfe_moore", wiki_region_key: null, wiki_url: null, label_public_id: "lbl-m",
	auto_name: false,
};
const HEIDE = {
	public_id: "h1", region_public_id: "rh", region_name: "Waskirer Heide", kind: "vegetation",
	region_type: "suempfe_moore", wiki_region_key: null, wiki_url: null, label_public_id: "lbl-h",
	auto_name: true,
};

function skripteAus(htmlDatei, muster) {
	const inhalt = fs.readFileSync(path.join(wurzel, htmlDatei), "utf8");
	return (inhalt.match(/<script[^>]+src="([^"]+)"/g) || [])
		.map((tag) => (/src="([^"]+)"/.exec(tag) || [])[1] || "")
		.map((src) => src.replace(/^\//, "").split("?")[0])
		.filter((src) => muster.test(src))
		.filter((src, i, alle) => alle.indexOf(src) === i)
		.filter((src) => fs.existsSync(path.join(wurzel, src)));
}

/**
 * Das echte Flächenmodul samt Wiki-Zuweisung, die echte Hülle, und der echte Speicherauftrag der
 * Beschriftung (ab `avesmapsBeschriftungUngueltigText` bis zum Dateiende von review-editor-submit.js).
 * Alles, was geschrieben wird, landet in EINEM Protokoll -- nur so ist die Reihenfolge prüfbar.
 */
function echteHaelften(flaechen) {
	const protokoll = [];
	const toasts = [];
	const rueckwege = [];
	const steuerung = { region: null, labelGueltig: true, labelWirft: null };
	const KOPF = ["label-edit-text", "label-edit-type", "ecosystem-properties-showname", "label-edit-is-nodix"];
	const elemente = {
		"landschaft-dialog-overlay": scheinFeld(""),
		"label-edit-public-id": scheinFeld(""),
		"ecosystem-properties-wiki-host": scheinBehaelter("ecosystem-properties-wiki-host"),
		"ecosystem-properties-form": scheinBehaelter("ecosystem-properties-form"),
		"landschaft-dialog-save": scheinBehaelter("landschaft-dialog-save"),
	};
	KOPF.forEach((id) => { elemente[id] = scheinBehaelter(id, ""); });
	elemente["landschaft-dialog-overlay"].hidden = true;
	const labels = {
		"lbl-m": { publicId: "lbl-m", regionPublicId: "rm", text: "Moor-001", showName: true, labelType: "suempfe_moore", isNodix: false, wikiRegion: null, size: 18, minZoom: 0 },
		"lbl-m2": { publicId: "lbl-m2", regionPublicId: "rm", text: "Moor-001", showName: true, labelType: "suempfe_moore", isNodix: false, wikiRegion: null, size: 18, minZoom: 0 },
		"lbl-h": { publicId: "lbl-h", regionPublicId: "rh", text: "Waskirer Heide", showName: true, labelType: "suempfe_moore", isNodix: false, wikiRegion: null, size: 18, minZoom: 0 },
	};
	const eintraege = {};
	Object.keys(labels).forEach((id) => { eintraege[id] = { label: labels[id], marker: { getLatLng: () => ({ lat: 1, lng: 2 }) } }; });
	const kasten = Object.assign({}, GRUNDWERTE, {
		Event: function () {}, Option: function (label, wert) { return { label, value: wert }; },
		document: dokumentAus(elemente),
		location: { href: "http://pruefstand.local/", search: "" },
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		MutationObserver: function () { return { observe() {}, disconnect() {} }; },
		confirm: () => true,
		showFeedbackToast: (text, ton) => { toasts.push({ text, ton }); },
		fetch(url) {
			const antwort = String(url).indexOf("action=search") !== -1 ? { ok: true, count: 1, rows: [SUCHZEILE] } : { ok: true, rows: [] };
			return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(antwort) });
		},
		ecosystemLayers: new Map(flaechen.map((f) => [f.public_id, { _ecosystemArea: Object.assign({}, f) }])),
		postEcosystemEdit: (aktion, nutzlast) => {
			if (aktion === "list_regions") {
				return Promise.resolve({
					ok: true,
					region_types: [{ type_key: "suempfe_moore", label: "Sümpfe und Moore" }, { type_key: "wald", label: "Wald" }]
						.map((t) => Object.assign({ kind: nutzlast.kind }, t)),
					regions: flaechen.filter((f) => f.kind === nutzlast.kind).map((f) => ({
						public_id: f.region_public_id, name: f.region_name, kind: f.kind, region_type: f.region_type,
						wiki_region_key: null, wiki_url: null, area_count: 1, auto_name: f.auto_name,
					})),
				});
			}
			protokoll.push({ wer: "region", aktion, nutzlast, laeuft: true });
			const eintrag = protokoll[protokoll.length - 1];
			const antwort = aktion === "update_region" && steuerung.region
				? steuerung.region.zusage
				: Promise.resolve({ ok: true, labels: [] });
			return antwort.then((wert) => { eintrag.laeuft = false; return wert; },
				(fehler) => { eintrag.laeuft = false; throw fehler; });
		},
		submitMapFeatureEdit: (rumpf) => {
			protokoll.push({ wer: "label", aktion: rumpf.action, public_id: rumpf.public_id, rumpf,
				regionLaeuft: protokoll.some((z) => z.wer === "region" && z.laeuft) });
			if (steuerung.labelWirft && rumpf.public_id === steuerung.labelWirft) {
				return Promise.reject(new Error("Konflikt (409)."));
			}
			return Promise.resolve({ ok: true, feature: null });
		},
		findLabelEntryByPublicId: (id) => eintraege[String(id)] || null,
		labelData: Object.values(labels),
		ecosystemRegionOfLabel: (label) => (label?.regionPublicId ? { public_id: label.regionPublicId } : null),
		linkedEcosystemLabelEntry: (area) => eintraege[String(area?.label_public_id || "")] || null,
		findLabelEntriesByEcosystemRegion: (regionId) => Object.values(eintraege).filter((e) => e.label.regionPublicId === regionId),
		ecosystemDialogTitle: () => "Fläche bearbeiten",
		formatEcosystemRegionCarryNote: () => "1 Fläche",
		ecosystemLabelCountOfRegion: () => 1,
		ecosystemLabelStyleFor: () => ({ size: 18, minZoom: 0 }),
		ecosystemWikiRegionSnapshot: () => Promise.resolve(null),
		applyLabelFeatureLocally: () => {},
		applyLabelFeaturesLocally: () => {},
		avesmapsComputeLabelPoint: () => ({ x: 1, y: 1 }),
		tr: (schluessel, rueckfall) => rueckfall,
		t: (schluessel, rueckfall) => rueckfall,
		// ── die Nachbarn des Beschriftungs-Auftrags ──
		attachActiveReviewReportContext: (rumpf) => rumpf,
		buildLabelEditPayload: () => ({
			action: elemente["label-edit-public-id"].value ? "update_label" : "create_label",
			public_id: elemente["label-edit-public-id"].value,
			text: String(elemente["label-edit-text"].value || "").trim(),
			feature_subtype: String(elemente["label-edit-type"].value || "region"),
			show_name: elemente["ecosystem-properties-showname"].checked === true,
			size: 18, min_zoom: 0,
		}),
		setLabelEditStatus: () => {},
		applyLabelFeatureResponse: () => {},
		updateRevisionFromEditResponse: () => {},
		loadChangeLog: () => Promise.resolve(),
		setLabelMoveActive: () => {},
		ecosystemPushLabelChangesToRegion: (label) => { rueckwege.push(label.publicId); return Promise.resolve(); },
	});
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	const dateien = skripteAus("index.html", /wiki-assign|ecosystem-properties|ecosystem-naming|landschaft-dialog\.js/);
	assert.ok(dateien.indexOf("js/map-features/landschaft-dialog.js") !== -1
		&& dateien.indexOf("js/map-features/map-features-ecosystem-properties.js") !== -1,
	"index.html bindet Hülle oder Flächenmodul nicht: " + dateien.join(" "));
	dateien.forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	const submitQuelle = lies("js/review/review-editor-submit.js");
	const ab = submitQuelle.indexOf("function avesmapsBeschriftungUngueltigText(");
	assert.ok(ab !== -1, "den Speicherauftrag der Beschriftung gibt es");
	vm.runInContext("class HTMLFormElement {}; this.HTMLFormElement = HTMLFormElement;"
		+ "var labelEditEntry = null; var pendingLabelMoveAfterEditEntry = null;"
		+ "var activeReviewReportId = null; var activeReviewReportSource = null;"
		+ "var ecosystemLabelsForRegion = function () { return []; };"
		+ "var isEcosystemCascadeEnabled = function () { return false; };"
		+ "var refreshEcosystemAreas = function () { return Promise.resolve(); };", kasten);
	vm.runInContext(submitQuelle.slice(ab), kasten, { filename: "review-editor-submit.js#auftrag" });
	const formular = new kasten.HTMLFormElement();
	Object.assign(formular, scheinBehaelter("label-edit-form"), {
		elements: [],
		reportValidity: () => steuerung.labelGueltig,
	});
	elemente["label-edit-form"] = formular;
	// Das Schliessen der Beschriftung, wie im Haus: abmelden, Fenster zu, Formular UND Kopf zurück.
	kasten.setLabelEditDialogOpen = (offen) => {
		protokoll.push({ wer: "schliessen:beschriftung" });
		vm.runInContext('avesmapsLandschaftDialogHaelfte("beschriftung", ' + Boolean(offen) + "); avesmapsLandschaftDialogSichtbar(" + Boolean(offen) + ");", kasten);
		if (!offen) {
			elemente["label-edit-text"].value = "";
			elemente["label-edit-type"].value = "region";
			elemente["ecosystem-properties-showname"].checked = false;
			elemente["label-edit-public-id"].value = "";
			vm.runInContext("labelEditEntry = null;", kasten);
		}
	};
	/** Die Beschriftung ist offen, wie nach ihrem Öffner (als Gegenpart der Fläche). */
	const beschriftungOffen = (id) => {
		elemente["label-edit-public-id"].value = id;
		kasten.__eintrag = eintraege[id];
		vm.runInContext('labelEditEntry = __eintrag; avesmapsLandschaftDialogHaelfte("beschriftung", true);', kasten);
	};
	return { kasten, elemente, protokoll, toasts, rueckwege, steuerung, beschriftungOffen };
}

async function flaecheOeffnen(k, publicId) {
	await vm.runInContext("window.AvesmapsEcosystemProperties.open(" + JSON.stringify(publicId) + ")", k.kasten);
	await ruhig();
	assert.ok(k.elemente["ecosystem-properties-wiki-host"].innerHTML.indexOf("Wiki-Landschaft") !== -1,
		"Aufbau: der Wiki-Kasten ist nicht montiert");
}

async function artikelWaehlen(k) {
	const host = k.elemente["ecosystem-properties-wiki-host"];
	host.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	host.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
}

async function teilB() {
	// ── B1. Verbund: die Region zuerst, die offene Beschriftung EINMAL, danach ────────────────────
	{
		const k = echteHaelften([MOOR]);
		await flaecheOeffnen(k, "m1");
		k.beschriftungOffen("lbl-m");
		await artikelWaehlen(k);
		assert.strictEqual(k.elemente["label-edit-text"].value, "Hochmoor von Waskir", "Aufbau: der Artikel benennt um");

		const region = aufgeschoben();
		k.steuerung.region = region;
		// 🔴 ENTER IM NAMENSFELD: das Feld gehört per `form=` der Beschriftung, und bis zum 27.09.2026
		// speicherte Enter dort NUR sie -- die Wiki-Zuweisung der Fläche ging mit dem Schliessen verloren.
		const lauf = vm.runInContext("handleLabelEditFormSubmit", k.kasten)({ preventDefault() {}, currentTarget: k.elemente["label-edit-form"] });
		await ruhig();
		const regionZeile = k.protokoll.filter((z) => z.wer === "region" && z.aktion === "update_region");
		assert.strictEqual(regionZeile.length, 1, "Enter in der Beschriftung schreibt AUCH die Region: "
			+ JSON.stringify(k.protokoll.map((z) => z.wer + ":" + (z.aktion || "")))); checks++;
		assert.strictEqual(regionZeile[0].nutzlast.wiki_url, SUCHZEILE.wiki_url, "…samt Wiki-Zuweisung"); checks++;
		assert.strictEqual(regionZeile[0].nutzlast.name, "Hochmoor von Waskir", "…und dem neuen Namen"); checks++;
		assert.strictEqual(k.protokoll.filter((z) => z.wer === "label").length, 0,
			"💣 solange die Region schreibt, schreibt NIEMAND eine Beschriftung"); checks++;
		// ⚠️ Ein zweiter Klick (Speichern-Knopf) mitten hinein bekommt keinen zweiten Lauf.
		k.elemente["landschaft-dialog-save"].feuere("click");
		k.elemente["ecosystem-properties-form"].feuere("submit");
		await ruhig();
		assert.strictEqual(k.protokoll.filter((z) => z.aktion === "update_region").length, 1,
			"ein zweiter Klick schreibt die Region nicht noch einmal"); checks++;

		region.erfuellen({ ok: true, labels: [] });
		await lauf;
		await ruhig();
		const labelZeilen = k.protokoll.filter((z) => z.wer === "label");
		assert.ok(labelZeilen.every((z) => z.regionLaeuft === false), "keine Beschriftung während der Region"); checks++;
		const offene = labelZeilen.filter((z) => z.public_id === "lbl-m");
		// 💣 DER 409 VON FRÜHER: zwei Schreiber derselben Zeile mit derselben Revision.
		assert.strictEqual(offene.length, 1, "die offene Beschriftung wird GENAU EINMAL geschrieben: "
			+ JSON.stringify(labelZeilen.map((z) => z.public_id))); checks++;
		assert.strictEqual(offene[0].rumpf.size, 18, "…und zwar von IHRER Hälfte (mit ihrer Darstellung)"); checks++;
		assert.strictEqual(offene[0].rumpf.text, "Hochmoor von Waskir", "…mit dem Namen des Klicks"); checks++;
		assert.ok(labelZeilen.some((z) => z.public_id === "lbl-m2"), "die zweite Beschriftung der Fläche zieht die Fläche nach"); checks++;
		const iOffen = k.protokoll.indexOf(offene[0]);
		const iGeschwister = k.protokoll.findIndex((z) => z.public_id === "lbl-m2");
		assert.ok(iGeschwister < iOffen, "erst schreibt die Fläche fertig, dann die Beschriftung"); checks++;
		assert.deepStrictEqual(k.rueckwege.slice(), [],
			"💣 im Verbund KEIN Rückweg der Beschriftung an die Region -- die hat die Fläche gerade geschrieben"); checks++;
		assert.strictEqual(k.protokoll.filter((z) => z.wer === "schliessen:beschriftung").length, 1, "EIN Schliessen der Beschriftung"); checks++;
		assert.strictEqual(k.elemente["landschaft-dialog-overlay"].hidden, true, "das Fenster ist zu"); checks++;
		assert.strictEqual(k.toasts.filter((t) => t.ton === "success").length, 1,
			"EINE Erfolgsmeldung: " + JSON.stringify(k.toasts)); checks++;
		assert.strictEqual(k.elemente["landschaft-dialog-save"].disabled, false, "die Leiste ist wieder frei"); checks++;
	}

	// ── B1b. Offen ist die ZWEITE Beschriftung der Fläche -- auch sie wird nur einmal geschrieben ────
	// ⚠️ Die primäre zieht renameLinkedEcosystemLabel nach, die übrigen applyRegionToLabels -- beide
	// müssen die offene auslassen, sonst gibt es den 409 bei jeder zweiten Beschriftung einer Fläche.
	{
		const k = echteHaelften([MOOR]);
		await flaecheOeffnen(k, "m1");
		k.beschriftungOffen("lbl-m2");
		await artikelWaehlen(k);
		await vm.runInContext("avesmapsLandschaftDialogSpeichern()", k.kasten);
		const labelZeilen = k.protokoll.filter((z) => z.wer === "label");
		assert.strictEqual(labelZeilen.filter((z) => z.public_id === "lbl-m2").length, 1,
			"die offene zweite Beschriftung wird GENAU EINMAL geschrieben: " + JSON.stringify(labelZeilen.map((z) => z.public_id))); checks++;
		assert.strictEqual(labelZeilen.filter((z) => z.public_id === "lbl-m").length, 1,
			"die primäre zieht die Fläche nach, einmal"); checks++;
	}

	// ── B2. Ist die Beschriftung ungültig, bleibt auch die Fläche ungeschrieben ─────────────────────
	{
		const k = echteHaelften([MOOR]);
		await flaecheOeffnen(k, "m1");
		k.beschriftungOffen("lbl-m");
		await artikelWaehlen(k);
		k.steuerung.labelGueltig = false;
		await vm.runInContext("avesmapsLandschaftDialogSpeichern()", k.kasten);
		assert.strictEqual(k.protokoll.filter((z) => z.wer === "region" || z.wer === "label").length, 0,
			"nichts geschrieben: " + JSON.stringify(k.protokoll)); checks++;
		assert.strictEqual(k.elemente["landschaft-dialog-overlay"].hidden, false, "das Fenster bleibt offen"); checks++;
		assert.strictEqual(k.elemente["landschaft-dialog-status"].dataset.status, "error", "und sagt, woran es hängt"); checks++;
		// …und ein zweiter Versuch, jetzt gültig, schreibt beides.
		k.steuerung.labelGueltig = true;
		await vm.runInContext("avesmapsLandschaftDialogSpeichern()", k.kasten);
		assert.strictEqual(k.protokoll.filter((z) => z.aktion === "update_region").length, 1, "der zweite Versuch schreibt die Region"); checks++;
		assert.strictEqual(k.protokoll.filter((z) => z.public_id === "lbl-m").length, 1, "…und die Beschriftung"); checks++;
	}

	// ── B3. Scheitert die Region, wird keine Beschriftung geschrieben ───────────────────────────────
	{
		const k = echteHaelften([MOOR]);
		await flaecheOeffnen(k, "m1");
		k.beschriftungOffen("lbl-m");
		const region = aufgeschoben();
		k.steuerung.region = region;
		const lauf = vm.runInContext("avesmapsLandschaftDialogSpeichern()", k.kasten);
		await ruhig();
		region.ablehnen(new Error("Die Region wurde inzwischen geändert."));
		const ergebnis = await lauf;
		assert.strictEqual(ergebnis.gespeichert, false, "der Lauf meldet den Fehlschlag"); checks++;
		assert.strictEqual(k.protokoll.filter((z) => z.wer === "label").length, 0, "keine Beschriftung geschrieben"); checks++;
		assert.strictEqual(k.elemente["landschaft-dialog-overlay"].hidden, false, "das Fenster bleibt offen, nichts ist verloren"); checks++;
		assert.ok(/^Fläche nicht: Die Region wurde inzwischen geändert/.test(k.elemente["landschaft-dialog-status"].textContent),
			"die Zeile sagt es: " + k.elemente["landschaft-dialog-status"].textContent); checks++;
	}

	// ── B4. Die Art der Beschriftung („keine Art" = region) ist an einer Vegetationsfläche KEINE Art ──
	{
		const k = echteHaelften([MOOR]);
		await flaecheOeffnen(k, "m1");
		k.beschriftungOffen("lbl-m");
		// So stand es, wenn der Aufbau der Beschriftung das Auswahlfeld zuletzt gebaut hatte.
		k.elemente["label-edit-type"].value = "region";
		await vm.runInContext("avesmapsLandschaftDialogSpeichern()", k.kasten);
		const regionZeile = k.protokoll.filter((z) => z.aktion === "update_region")[0];
		assert.ok(regionZeile, "die Region wird geschrieben"); checks++;
		assert.strictEqual(regionZeile.nutzlast.region_type, "",
			"💣 `region` reist nicht als Flächenart -- der Server lehnt sie an einer Vegetationsfläche mit 400 ab"); checks++;
	}
}

async function teilC() {
	// ── C1. Der Editor tippt in der Lücke, bevor die Fläche als Gegenpart kommt ─────────────────────
	{
		const k = echteHaelften([MOOR]);
		// Einstieg über die Beschriftung: der Kopf beginnt unberührt, der Editor tippt …
		vm.runInContext("avesmapsLandschaftDialogSichtbar(true); avesmapsLandschaftDialogKopfNeu();", k.kasten);
		k.beschriftungOffen("lbl-m");
		k.elemente["label-edit-text"].value = "Waskirer Hochmoor";
		k.elemente["label-edit-text"].feuere("input");
		// … und erst jetzt kommt die Fläche (nach avesmapsEcosystemAreaPublicIdOfLabel).
		await vm.runInContext('window.AvesmapsEcosystemProperties.open("m1", { paar: false })', k.kasten);
		await ruhig();
		assert.strictEqual(k.elemente["label-edit-text"].value, "Waskirer Hochmoor",
			"💣 die Fläche überschreibt den getippten Namen nicht mit ihrem gespeicherten"); checks++;
		await vm.runInContext("avesmapsLandschaftDialogSpeichern()", k.kasten);
		const regionZeile = k.protokoll.filter((z) => z.aktion === "update_region")[0];
		assert.ok(regionZeile && regionZeile.nutzlast.name === "Waskirer Hochmoor", "gespeichert wird der getippte Name"); checks++;
	}

	// ── C2. Ohne Anfassen gewinnt die Region (die Ladeordnung bleibt) ───────────────────────────────
	{
		const k = echteHaelften([MOOR]);
		vm.runInContext("avesmapsLandschaftDialogSichtbar(true); avesmapsLandschaftDialogKopfNeu();", k.kasten);
		k.beschriftungOffen("lbl-m");
		k.elemente["label-edit-text"].value = "Beschriftungstext";
		await vm.runInContext('window.AvesmapsEcosystemProperties.open("m1", { paar: false })', k.kasten);
		await ruhig();
		assert.strictEqual(k.elemente["label-edit-text"].value, "Moor-001",
			"unberührt schreibt die Fläche ihren Namen -- der Kopf gehört der Region"); checks++;
	}

	// ── C3. Der Auto-Name ist beim Öffnen UNBEKANNT, nicht „aus" ───────────────────────────────────
	{
		const k = echteHaelften([HEIDE, MOOR]);
		await flaecheOeffnen(k, "h1");
		const haken = k.elemente["ecosystem-properties-autoname"];
		assert.strictEqual(haken.checked, true, "Aufbau: die Heide trägt den Auto-Namen");
		vm.runInContext("window.AvesmapsEcosystemProperties.close()", k.kasten);
		// Das Moor öffnen, aber list_regions noch nicht antworten lassen.
		const liste = aufgeschoben();
		const echt = k.kasten.postEcosystemEdit;
		k.kasten.postEcosystemEdit = (aktion, nutzlast) => (aktion === "list_regions" ? liste.zusage.then(() => echt(aktion, nutzlast)) : echt(aktion, nutzlast));
		const oeffnen = vm.runInContext('window.AvesmapsEcosystemProperties.open("m1")', k.kasten);
		await ruhe();
		assert.strictEqual(haken.checked, false, "💣 der Haken der zuvor geöffneten Heide reist nicht mit ins Moor"); checks++;
		assert.strictEqual(haken.disabled, true, "…und ist gesperrt, bis der Stand da ist"); checks++;
		// ⚠️ Auch ein Nachziehen in der Lücke (Artwechsel -> syncPropertiesAutoName) gibt ihn nicht frei.
		k.elemente["label-edit-type"].feuere("change");
		assert.strictEqual(haken.disabled, true, "das Nachziehen des Hakens hält die Sperre, solange der Stand fehlt"); checks++;
		const auftrag = vm.runInContext("window.AvesmapsEcosystemProperties.speicherAuftrag({ verbund: false })", k.kasten);
		assert.ok(!auftrag.fehler, "Aufbau: der Auftrag ist gültig: " + auftrag.fehler);
		await auftrag.ausfuehren();
		const regionZeile = k.protokoll.filter((z) => z.aktion === "update_region").pop();
		assert.ok(!Object.prototype.hasOwnProperty.call(regionZeile.nutzlast, "auto_name"),
			"⚠️ unbekannt heisst: `auto_name` reist GAR NICHT -- ein `false` löschte einen gespeicherten Haken"); checks++;
		assert.ok(!Object.prototype.hasOwnProperty.call(regionZeile.nutzlast, "label_public_id"),
			"…und es werden keine Beschriftungen entfernt"); checks++;
		liste.erfuellen();
		await oeffnen;
		await ruhig();
		assert.strictEqual(haken.disabled, false, "mit dem Stand wird der Haken bedienbar"); checks++;
	}
}
