"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "../../..");
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
const labelQuelle = lies("js/review/review-labels.js");
const ruhe = () => new Promise((resolve) => setImmediate(resolve));

function funktion(name, asynchron = false) {
	const anfang = labelQuelle.indexOf(`function ${name}(`);
	assert.ok(anfang >= 0, name);
	const ende = labelQuelle.indexOf("\n}", anfang);
	assert.ok(ende > anfang, name);
	return (asynchron ? "async " : "") + labelQuelle.slice(anfang, ende + 2);
}

function verzogert() {
	let beantworten;
	const promise = new Promise((resolve) => { beantworten = resolve; });
	return { promise, beantworten };
}

function feld(value = "") {
	return {
		value, hidden: false, innerHTML: "", textContent: "", options: [], dataset: {},
		classList: { add() {}, remove() {}, toggle() {} },
		addEventListener() {}, querySelectorAll: () => [], setAttribute() {},
		appendChild(option) { this.innerHTML += `<option value="${option.value}">${option.text}</option>`; },
	};
}

function pruefstand() {
	const elemente = {
		"label-edit-public-id": feld(),
		"label-edit-type": feld(),
		"label-edit-carriers": feld(),
		"landschaft-dialog-overlay": feld(),
	};
	const volleListe = '<option value="region">Region</option><option value="wald">Wald</option><option value="berggipfel">Berggipfel</option>';
	elemente["label-edit-type"].innerHTML = volleListe;
	const suchen = [];
	const regionen = [];
	const geoeffnet = [];
	const texte = [];
	const k = {
		document: { getElementById: (id) => elemente[id] || null, querySelectorAll: () => [], querySelector: () => null },
		window: { AvesmapsEcosystemProperties: { open: (id) => { geoeffnet.push(id); } } },
		Option: function (text, value) { this.text = text; this.value = value; },
		labelEditStartReiter: "", labelCurveGeladen: null, labelCurveSchnappschuss: null,
		ECOSYSTEM_KINDS: ["vegetation"], ecosystemRegionsByKind: {},
		ecosystemRegionTypesByKind: {
			vegetation: [{ type_key: "wald", label: "Wald" }],
			topographie: [{ type_key: "gebirge", label: "Gebirge" }],
		},
		loadEcosystemRegions: () => { const antwort = verzogert(); regionen.push(antwort); return antwort.promise; },
		avesmapsEcosystemAreaPublicIdOfLabel: () => { const antwort = verzogert(); suchen.push(antwort); return antwort.promise; },
		ecosystemRegionOfLabel: (label) => label.region || null,
		resetLabelEditForm() {},
		populateLabelEditForm: ({ labelEntry }) => { elemente["label-edit-public-id"].value = labelEntry.label.publicId; },
		syncLabelEditGeschwisterwahl() {}, avesmapsLabelZeichneVorgabeMarken() {},
		setLabelEditDialogOpen: (offen) => { elemente["landschaft-dialog-overlay"].hidden = !offen; },
		syncLabelHeightRow() {}, syncLabelCurveControls() {}, fillLabelRegionSelect() {},
		setLabelEditDialogTitle: (kind) => { texte.push(kind); },
		labelEmptyTypeLabel: () => "Keine Art",
	};
	vm.createContext(k);
	vm.runInContext(lies("js/map-features/landschaft-dialog.js"), k);
	const deklaration = labelQuelle.match(/^(?:let|const) labelTypeFullMarkup\s*=[\s\S]*?;/m);
	assert.ok(deklaration, "Das vollständige Vokabular wird bei der Initialisierung erfasst.");
	vm.runInContext(deklaration[0], k);
	for (const name of ["openLabelEditDialog", "applyLabelTypeVocabulary"]) {
		vm.runInContext(funktion(name), k);
	}
	vm.runInContext(funktion("renderLabelCarrierNote", true), k);
	return { k, elemente, suchen, regionen, geoeffnet, texte, volleListe };
}

const wald = { publicId: "A", labelType: "wald", region: { kind: "vegetation", name: "Wald", area_count: 1 } };
const gebirge = { publicId: "B", labelType: "gebirge", region: { kind: "topographie", name: "Gebirge", area_count: 1 } };
const oeffne = (p, label) => p.k.openLabelEditDialog({ labelEntry: { label } });

async function pruefeSuchrennen() {
	const p = pruefstand();
	p.k.avesmapsLandschaftDialogHaelfte("flaeche", true);
	oeffne(p, wald);
	assert.equal(p.k.avesmapsLandschaftDialogStand().hatFlaeche, false,
		"Ein Label-Einstieg meldet die vorherige Fläche sofort ab.");
	oeffne(p, gebirge);
	p.suchen[1].beantworten("flaeche-B");
	await ruhe();
	p.suchen[0].beantworten("flaeche-A");
	await ruhe();
	assert.deepEqual(p.geoeffnet, ["flaeche-B"], "Die späte Waldsuche darf das Gebirge nicht ersetzen.");

	const q = pruefstand();
	oeffne(q, wald);
	oeffne(q, gebirge);
	oeffne(q, wald);
	q.suchen[2].beantworten("A-neu");
	await ruhe();
	q.suchen[0].beantworten("A-alt");
	q.suchen[1].beantworten("B-alt");
	await ruhe();
	assert.deepEqual(q.geoeffnet, ["A-neu"], "A→B→A braucht eine Öffnungsidentität, nicht nur die public_id.");

	for (const wechsel of ["schliessen", "flaeche"]) {
		const r = pruefstand();
		oeffne(r, wald);
		if (wechsel === "schliessen") {
			r.k.avesmapsLandschaftDialogSichtbar(false);
		} else {
			// Der Flächeneinstieg beginnt denselben neuen Kopf wie Properties.open.
			r.k.avesmapsLandschaftDialogKopfNeu();
			r.k.avesmapsLandschaftDialogHaelfte("flaeche", true);
		}
		r.suchen[0].beantworten("alter-wald");
		await ruhe();
		assert.deepEqual(r.geoeffnet, [], `${wechsel}: die alte Suche darf keine Fläche öffnen.`);
	}
}

async function pruefeVokabularrennen() {
	for (const wechsel of ["anderes-label", "gleiches-label-erneut", "schliessen", "flaeche"]) {
		const p = pruefstand();
		oeffne(p, wald);
		const alt = p.k.renderLabelCarrierNote(wald);
		if (wechsel === "schliessen") {
			p.k.avesmapsLandschaftDialogSichtbar(false);
		} else if (wechsel === "flaeche") {
			p.k.avesmapsLandschaftDialogKopfNeu();
			p.k.avesmapsLandschaftDialogHaelfte("flaeche", true);
		} else {
			oeffne(p, gebirge);
			if (wechsel === "gleiches-label-erneut") {
				oeffne(p, wald);
			}
		}
		p.elemente["label-edit-type"].innerHTML = "aktueller-kopf";
		p.regionen[0].beantworten();
		await alt;
		assert.equal(p.elemente["label-edit-type"].innerHTML, "aktueller-kopf", wechsel);
		assert.deepEqual(p.texte, [], `${wechsel}: kein verspäteter Titel oder Trägerhinweis.`);
	}
	const p = pruefstand();
	oeffne(p, wald);
	const aktuell = p.k.renderLabelCarrierNote(wald);
	p.regionen[0].beantworten();
	await aktuell;
	assert.match(p.elemente["label-edit-type"].innerHTML, />Wald</);
	assert.doesNotMatch(p.elemente["label-edit-type"].innerHTML, />Gebirge</);
	assert.equal(p.elemente["label-edit-carriers"].hidden, false, "Die aktuelle Antwort wird weiterhin angewandt.");
}

function pruefeVolleListe() {
	const p = pruefstand();
	// Eine Fläche kann die gemeinsame Auswahl vor dem ersten Label-Aufruf einschränken.
	p.elemente["label-edit-type"].innerHTML = '<option value="gebirge">Gebirge</option>';
	p.k.applyLabelTypeVocabulary(null, { labelType: "berggipfel" });
	assert.equal(p.elemente["label-edit-type"].innerHTML, p.volleListe,
		"Ein freier Gipfel erhält die ursprüngliche Liste, nicht das letzte Flächenvokabular.");
}

(async () => {
	await pruefeSuchrennen();
	await pruefeVokabularrennen();
	pruefeVolleListe();
	console.log("Landschafts-Laderennen: Antwortreihenfolge, Wiederöffnen, Schließen und Vokabular geprüft.");
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
