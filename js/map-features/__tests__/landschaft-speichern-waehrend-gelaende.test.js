// „Speichern" im Landschaftsfenster verlor die Wiki-Zuweisung -- je nach VORGESCHICHTE der Sitzung.
//
// 🚩 Gemeldet am 27.09.2026 („das zuweisen von wiki einträgen mit dem speichern button funktioniert
// nicht immer", konkret am „Hochmoor von Waskir": der Owner konnte speichern, ein Editor nicht).
// Mit Firefox hatte es nichts zu tun. Zwei Fehler, die nur ZUSAMMEN zuschlugen:
//
// 1. DER GELAENDE-MERKER WAR NICHT JE FLAECHE. `renderTerrainControls` setzte `terrainTouched` nur fuer
//    ein Gebirge zurueck (die Zeile stand hinter `if (!zeigt) return;`). Wer erst ein Gebirge und dann
//    ein Moor oeffnete, erbte dessen „angefasst" -- und „Speichern" speicherte am Moor zuerst Gelaende
//    (die Regler der unsichtbaren Falte, samt Hoehenraster), Sekunden lang.
// 2. DIE FLAECHEN-HAELFTE LAS IHR FORMULAR ERST NACH DIESEM WARTEN. „Speichern" schickt beide Haelften
//    gleichzeitig ab; die Beschriftungs-Haelfte ist in der Zeit fertig, schliesst das Fenster und setzt
//    ihr Formular zurueck -- und Name, Art und Anzeigehaken im gemeinsamen Kopf gehoeren per `form=`
//    DIESEM Formular. Danach stieg die Flaechen-Haelfte still aus (`currentPropertiesArea() !== area`,
//    weil der Rueckweg der Beschriftung die Flaechen neu laden liess) oder fand ein leeres Namensfeld.
//    `update_region` -- der einzige Traeger der Wiki-Zuweisung -- ging nie hinaus.
//
// 🔴 Beide Faelle laufen hier ueber das ECHTE Modul (vm-Sandkasten, Dokument-Attrappe, dieselbe Bauart
// wie js/ui/__tests__/wiki-assign-landschaft.test.js). Gegen den Stand vor dem 27.09.2026 gefahren,
// faellt jeder der beiden Teile.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-speichern-waehrend-gelaende.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
let checks = 0;

const SUCHZEILE = {
	wiki_key: "wiki:hochmoor-von-waskir", name: "Hochmoor von Waskir", art: "Moor",
	continent: "Aventurien", region_parent: "Nordmarken", description: "Ein Moor.",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Hochmoor_von_Waskir",
};
const ADRESSLOS = Object.assign({}, SUCHZEILE, { wiki_key: "wiki:ohne-adresse", name: "Ohne Adresse", wiki_url: "" });

// Ein Gebirge MIT gespeichertem Gelaende -- genau das setzt den Merker beim Oeffnen.
const GEBIRGE = {
	public_id: "g1", region_public_id: "rg", region_name: "Waskirer Hoehen", kind: "topographie",
	region_type: "gebirge", wiki_region_key: null, wiki_url: null, label_public_id: "lbl-g",
	terrain_grain: 3.2, terrain_levels: 3, terrain_avg_height: 2000,
};
const MOOR = {
	public_id: "m1", region_public_id: "rm", region_name: "Moor-001", kind: "vegetation",
	region_type: "suempfe_moore", wiki_region_key: null, wiki_url: null, label_public_id: "lbl-m",
};

function scheinFeld(wert) {
	return {
		value: wert === undefined ? "" : wert, options: [], checked: false, disabled: false, hidden: false,
		textContent: "", innerHTML: "", className: "", title: "", dataset: {}, style: {},
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceChildren() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
		focus() {}, select() {}, dispatchEvent() { return true; }, contains() { return false; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
	};
}

/** Ein Behaelter, dessen Zuhoerer wirklich ausgeloest werden -- das Bauteil haengt sich selbst an. */
function scheinBehaelter(id) {
	const zuhoerer = {};
	return Object.assign(scheinFeld(""), {
		id,
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		contains() { return true; },
		feuere(typ, ziel) { if (zuhoerer[typ]) { return zuhoerer[typ]({ target: ziel, preventDefault() {} }); } return undefined; },
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

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 5));

function skripteAus(htmlDatei, muster) {
	const inhalt = fs.readFileSync(path.join(wurzel, htmlDatei), "utf8");
	return (inhalt.match(/<script[^>]+src="([^"]+)"/g) || [])
		.map((tag) => (/src="([^"]+)"/.exec(tag) || [])[1] || "")
		.map((src) => src.replace(/^\//, "").split("?")[0])
		.filter((src) => muster.test(src))
		.filter((src) => fs.existsSync(path.join(wurzel, src)));
}

/**
 * Der Sandkasten: das echte Flaechenmodul samt Wiki-Zuweisung, dazu die Nachbarn, die der Oeffnen-
 * und der Speicherpfad wirklich anfassen. `gelaende` beantwortet `update_area_terrain` -- ein Wert
 * oder eine Zusage, die der Test selbst aufloest.
 */
function sandkasten(flaechen, trefferZeile) {
	const elemente = {
		"label-edit-text": scheinFeld(""),
		"label-edit-type": scheinFeld(""),
		"label-edit-public-id": scheinFeld(""),
		"ecosystem-properties-showname": scheinFeld(""),
		"ecosystem-properties-nodix": scheinFeld(""),
		"ecosystem-properties-overlay": scheinFeld(""),
		"ecosystem-properties-wiki-host": scheinBehaelter("ecosystem-properties-wiki-host"),
		"ecosystem-properties-form": scheinBehaelter("ecosystem-properties-form"),
	};
	elemente["ecosystem-properties-overlay"].hidden = true;
	const aufrufe = [];
	const labelSchreiben = [];
	const toasts = [];
	const steuerung = { gelaende: () => ({ ok: true }) };
	// ⚠️ Das Gebirge traegt ZWEI Beschriftungen: die zweite erreicht nur `applyRegionToLabels` -- ohne sie
	// liefe der Weg „die uebrigen Labels der Flaeche" hier nie (eine Mutation dort blieb gruen).
	const labels = {
		"lbl-g": { publicId: "lbl-g", regionPublicId: "rg", text: "Waskirer Hoehen", showName: true, labelType: "gebirge", isNodix: false, wikiRegion: null },
		"lbl-g2": { publicId: "lbl-g2", regionPublicId: "rg", text: "Waskirer Hoehen", showName: true, labelType: "gebirge", isNodix: false, wikiRegion: null },
		"lbl-m": { publicId: "lbl-m", regionPublicId: "rm", text: "Moor-001", showName: true, labelType: "suempfe_moore", isNodix: false, wikiRegion: null },
	};
	const eintrag = (id) => (labels[id] ? { label: labels[id], marker: { getLatLng: () => ({ lat: 1, lng: 2 }) } } : null);
	const dokument = {
		readyState: "complete",
		getElementById(id) {
			if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = scheinFeld(""); }
			return elemente[id];
		},
		querySelector() { return scheinFeld(""); },
		querySelectorAll() { return []; },
		createElement() { return scheinFeld(""); },
		addEventListener() {},
		body: scheinFeld(""), documentElement: scheinFeld(""),
	};
	const kasten = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
		String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
		isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
		Event: function () {}, Option: function (label, wert) { return { label, value: wert }; },
		document: dokument,
		location: { href: "http://pruefstand.local/", search: "" },
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		MutationObserver: function () { return { observe() {}, disconnect() {} }; },
		confirm: () => true,
		showFeedbackToast: (text, ton) => { toasts.push({ text, ton }); },
		fetch(url) {
			const antwort = String(url).indexOf("action=search") !== -1
				? { ok: true, count: 1, rows: [trefferZeile] }
				: { ok: true, rows: [] };
			return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(antwort) });
		},
		ecosystemLayers: new Map(flaechen.map((f) => [f.public_id, { _ecosystemArea: Object.assign({}, f) }])),
		postEcosystemEdit: (aktion, nutzlast) => {
			aufrufe.push({ aktion, nutzlast });
			if (aktion === "list_regions") {
				const typen = nutzlast.kind === "topographie"
					? [{ type_key: "gebirge", label: "Gebirge" }]
					: [{ type_key: "suempfe_moore", label: "Sümpfe und Moore" }, { type_key: "wald", label: "Wald" }];
				return Promise.resolve({
					ok: true,
					region_types: typen.map((t) => Object.assign({ kind: nutzlast.kind }, t)),
					regions: flaechen.filter((f) => f.kind === nutzlast.kind).map((f) => ({
						public_id: f.region_public_id, name: f.region_name, kind: f.kind, region_type: f.region_type,
						wiki_region_key: null, wiki_url: null, area_count: 1,
					})),
				});
			}
			if (aktion === "update_area_terrain") {
				return Promise.resolve(steuerung.gelaende(nutzlast));
			}
			return Promise.resolve({ ok: true, labels: [] });
		},
		submitMapFeatureEdit: (rumpf) => { labelSchreiben.push(rumpf); return Promise.resolve({ ok: true }); },
		findLabelEntryByPublicId: eintrag,
		labelData: Object.values(labels),
		ecosystemRegionOfLabel: (label) => (label?.regionPublicId ? { public_id: label.regionPublicId } : null),
		linkedEcosystemLabelEntry: (area) => eintrag(String(area?.label_public_id || "")),
		ecosystemDialogTitle: () => "Fläche bearbeiten",
		formatEcosystemRegionCarryNote: () => "1 Fläche",
		ecosystemLabelCountOfRegion: () => 1,
		ecosystemLabelStyleFor: () => ({}),
		ecosystemWikiRegionSnapshot: () => Promise.resolve(null),
		applyLabelFeatureLocally: () => {},
		avesmapsComputeLabelPoint: () => ({ x: 1, y: 1 }),
		tr: (schluessel, rueckfall) => rueckfall,
		t: (schluessel, rueckfall) => rueckfall,
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	const dateien = skripteAus("index.html", /wiki-assign|ecosystem-properties|ecosystem-naming/);
	assert.ok(dateien.indexOf("js/map-features/map-features-ecosystem-properties.js") !== -1,
		"index.html bindet das Flaechenmodul nicht: " + dateien.join(" "));
	dateien.forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	vm.runInContext("var ecosystemLabelsForRegion = function () { return []; };"
		+ "var isEcosystemCascadeEnabled = function () { return false; };"
		+ "var refreshEcosystemAreas = function () { return Promise.resolve(); };", kasten);
	return { kasten, elemente, aufrufe, labelSchreiben, toasts, steuerung };
}

async function oeffnen(k, publicId) {
	await vm.runInContext("window.AvesmapsEcosystemProperties.open(" + JSON.stringify(publicId) + ")", k.kasten);
	await ruhe();
	// Das Oeffnen hat, was die Flaeche traegt, ins Formular geschrieben -- wie im Browser.
	assert.ok(k.elemente["ecosystem-properties-wiki-host"].innerHTML.indexOf("Wiki-Landschaft") !== -1,
		"der Wiki-Kasten ist nicht montiert: " + k.elemente["ecosystem-properties-wiki-host"].innerHTML);
}

async function artikelWaehlen(k) {
	const host = k.elemente["ecosystem-properties-wiki-host"];
	host.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	host.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
}

(async () => {
	// ══ TEIL 1: ERST EIN GEBIRGE, DANN DAS MOOR ═══════════════════════════════════════════════════
	{
		const k = sandkasten([GEBIRGE, MOOR], SUCHZEILE);
		await oeffnen(k, "g1");
		vm.runInContext("window.AvesmapsEcosystemProperties.close()", k.kasten);
		await oeffnen(k, "m1");
		await artikelWaehlen(k);
		assert.strictEqual(k.elemente["label-edit-text"].value, "Hochmoor von Waskir",
			"die Wahl hat den Namen nicht uebernommen -- der Aufbau des Tests stimmt nicht"); checks++;

		const vorher = k.aufrufe.length;
		k.elemente["ecosystem-properties-form"].feuere("submit", k.elemente["ecosystem-properties-form"]);
		await ruhe();
		const danach = k.aufrufe.slice(vorher);
		// 💣 Der Kern von Teil 1: das Moor hat kein Gelaende, und das „angefasst" des Gebirges davor
		// gehoert ihm nicht.
		assert.ok(!danach.some((a) => a.aktion === "update_area_terrain"),
			"das Moor speichert Gelaende, das es nie hatte -- der Merker des zuvor geoeffneten Gebirges lebt weiter: "
			+ JSON.stringify(danach.map((a) => a.aktion))); checks++;
		const region = danach.filter((a) => a.aktion === "update_region")[0];
		assert.ok(region, "das Speichern hat die Region gar nicht geschrieben: " + JSON.stringify(danach.map((a) => a.aktion))); checks++;
		assert.strictEqual(region.nutzlast.public_id, "rm", "die Region des Moors, nicht die des Gebirges"); checks++;
		assert.strictEqual(region.nutzlast.wiki_url, SUCHZEILE.wiki_url, "die Wiki-Zuweisung reist mit"); checks++;
	}

	// ══ TEIL 2: DIE BESCHRIFTUNGS-HAELFTE IST FERTIG, WAEHREND DAS GELAENDE NOCH SPEICHERT ══════════
	// 🔴 Ein Gebirge mit echtem Gelaende -- hier IST das Gelaende-Speichern richtig, und genau darum
	// darf es die Zuweisung nicht kosten.
	{
		const k = sandkasten([GEBIRGE], Object.assign({}, SUCHZEILE, { name: "Waskirer Kamm", wiki_key: "wiki:waskirer-kamm" }));
		await oeffnen(k, "g1");
		await artikelWaehlen(k);
		assert.strictEqual(k.elemente["label-edit-text"].value, "Waskirer Kamm", "Aufbau: der Name ist gesetzt"); checks++;
		// Der Anzeigehaken steht (die Beschriftung ist sichtbar), das Fenster zeigt keine andere offen.
		assert.strictEqual(k.elemente["ecosystem-properties-showname"].checked, true, "Aufbau: der Anzeigehaken steht"); checks++;

		let gelaendeFertig;
		k.steuerung.gelaende = () => new Promise((fertig) => { gelaendeFertig = fertig; });
		const vorher = k.aufrufe.length;
		k.elemente["ecosystem-properties-form"].feuere("submit", k.elemente["ecosystem-properties-form"]);
		await ruhe();
		assert.ok(typeof gelaendeFertig === "function", "Aufbau: das Gelaende wird zuerst gespeichert"); checks++;

		// ── jetzt ist die Beschriftungs-Haelfte fertig: Fenster zu, Formular zurueckgesetzt, Flaechen neu
		// geladen (ihr Rueckweg: scheduleEcosystemAreaReload). So sieht der Kopf danach aus.
		k.elemente["label-edit-text"].value = "";
		k.elemente["label-edit-type"].value = "region";
		k.elemente["ecosystem-properties-showname"].checked = false;
		k.elemente["label-edit-public-id"].value = "";
		k.elemente["ecosystem-properties-overlay"].hidden = true;
		k.kasten.ecosystemLayers.set("g1", { _ecosystemArea: Object.assign({}, GEBIRGE) });

		gelaendeFertig({ ok: true, terrain_grain: 3.2, terrain_levels: 3, terrain_avg_height: 2000 });
		await ruhe();
		await ruhe();

		const danach = k.aufrufe.slice(vorher);
		const region = danach.filter((a) => a.aktion === "update_region")[0];
		assert.ok(region, "nach dem Gelaende ist die Flaechen-Haelfte still ausgestiegen -- die Wiki-Zuweisung "
			+ "ist nie hinausgegangen: " + JSON.stringify(danach.map((a) => a.aktion))); checks++;
		assert.strictEqual(region.nutzlast.name, "Waskirer Kamm",
			"geschrieben wird der Name des KLICKS, nicht das inzwischen geleerte Feld"); checks++;
		assert.strictEqual(region.nutzlast.region_type, "gebirge",
			"geschrieben wird die Art des Klicks, nicht das zurueckgesetzte „region“"); checks++;
		assert.strictEqual(region.nutzlast.wiki_url, SUCHZEILE.wiki_url, "die Wiki-Zuweisung reist mit"); checks++;
		// 💣 Und die eigene Beschriftung bekommt nicht „ausgeblendet" und „region" aus dem geleerten Kopf.
		const anLabel = k.labelSchreiben.filter((r) => r.action === "update_label");
		assert.ok(anLabel.some((r) => r.public_id === "lbl-g"), "der Name wandert an die Beschriftung"); checks++;
		assert.ok(anLabel.some((r) => r.public_id === "lbl-g2"), "und an die zweite Beschriftung der Flaeche"); checks++;
		anLabel.forEach((r) => {
			assert.strictEqual(r.show_name, true, "die Beschriftung wurde durch das geleerte Formular ausgeblendet"); checks++;
			assert.strictEqual(r.feature_subtype, "gebirge", "die Beschriftung bekam die Art des geleerten Formulars"); checks++;
			assert.strictEqual(r.text, "Waskirer Kamm", "die Beschriftung bekam den Namen des Klicks"); checks++;
		});
		assert.ok(k.toasts.some((t) => t.ton === "success"), "der Erfolg wird gemeldet, auch bei geschlossenem Fenster"); checks++;
	}

	// ══ TEIL 3: EIN TREFFER OHNE ADRESSE WIRD ABGELEHNT, NICHT STILL „ZUGEWIESEN" ══════════════════
	// 🔴 Vorher: `setPropertiesError(...); return;` -- das Bauteil las das als Erfolg und zeigte den
	// Artikel samt „Noch nicht gespeichert", die Meldung stand im unsichtbaren Reiter „Fläche".
	{
		const k = sandkasten([MOOR], ADRESSLOS);
		await oeffnen(k, "m1");
		await artikelWaehlen(k);
		const host = k.elemente["ecosystem-properties-wiki-host"];
		assert.ok(host.innerHTML.indexOf("keine Wiki-Adresse") !== -1,
			"der Grund steht nicht am Ort des Klicks: " + host.innerHTML); checks++;
		assert.strictEqual(host.innerHTML.indexOf("Noch nicht gespeichert"), -1,
			"der Kasten behauptet eine Zuweisung, die beim Speichern nie ankommt: " + host.innerHTML); checks++;
		assert.strictEqual(k.elemente["label-edit-text"].value, "Moor-001",
			"ein abgelehnter Treffer benennt nicht um"); checks++;
	}

	console.log("landschaft-speichern-waehrend-gelaende: " + checks + " Zusicherungen gruen");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
