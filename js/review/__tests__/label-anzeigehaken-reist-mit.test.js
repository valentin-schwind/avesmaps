// Der Haken „Auf der Karte anzeigen" muss im Rumpf des Beschriftungsformulars ANKOMMEN.
//
// 🔴 DER BEFUND (Meldung #137, Tigersprung, 18.09.2026): „Die Änderungen des Labels, den Haken
// ‚Auf der Karte anzeigen' zu entfernen, wird in vielen Fällen nicht gespeichert. Andere Änderungen
// werden problemlos gespeichert. Es erscheint auch ein kleines Feld ‚Label gespeichert'."
//
// 💣 DIE URSACHE WAR EINE FEHLENDE FORMULARZUGEHOERIGKEIT. Der Haken steht im Beschriftungsreiter
// des vereinigten Landschaftsfensters, aber HINTER dem `</form>` von `#label-edit-form` -- und ohne
// `form="label-edit-form"`. `new FormData(formElement)` sieht ihn deshalb nicht, `buildLabelEditPayload`
// kannte `show_name` gar nicht, und der Server liest einen FEHLENDEN Schluessel bewusst als „nicht
// geaendert" (features.php:3302). Alle uebrigen Felder wurden geschrieben -- daher der Erfolgs-Toast.
// Geschrieben wurde `show_name` nur ueber den FLAECHEN-Weg (`renameLinkedEcosystemLabel`, an
// `update_region` gehaengt); wer im Beschriftungsreiter speicherte, verlor die Aenderung. Das ist das
// „in vielen Faellen".
//
// ⚠️ Das funktionierende Vorbild stand daneben: `label-edit-is-nodix` ist dieselbe Bauart und liegt
// INNERHALB des Formulars. Der Unterschied war genau ein Attribut.
//
// 💣 UND DIE GEGENRICHTUNG IST DIE TEURERE: sobald `show_name` mitreist, MUSS der Haken beim Oeffnen
// aus dem Label befuellt werden -- auch bei einer FREIEN Beschriftung (229 von 1011 tragen keine
// Flaeche). Sonst schickte jedes Speichern ein `show_name: false` aus einer nie befuellten Box und
// machte die Beschriftung unsichtbar. Beim ANLEGEN gilt dasselbe: `create_label` faellt serverseitig
// auf `true`, ein ausdrueckliches `false` aus einer leeren Box ueberschriebe diesen Rueckfall.
//
// Drei Stationen, jede am echten Gegenstand:
//   1. index.html          -> die Box gehoert dem Formular (sonst sieht FormData sie nie)
//   2. review-labels.js    -> `buildLabelEditPayload` traegt `show_name`
//   3. review-labels.js    -> `populateLabelEditForm` befuellt die Box aus dem Label
//
// Run: node js/review/__tests__/label-anzeigehaken-reist-mit.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, `actions/checkout` legt LF hin (AGENTS.md §9).
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
let checks = 0;

// ---- Station 1: Sieht FormData die Box ueberhaupt? -----------------------------------------------

const html = lies("index.html");

const formPos = html.indexOf('id="label-edit-form"');
assert.ok(formPos > -1, "das Beschriftungsformular #label-edit-form steht in index.html"); checks++;
const formEnde = html.indexOf("</form>", formPos);
assert.ok(formEnde > -1, "und es wird geschlossen"); checks++;

const boxPos = html.indexOf('id="ecosystem-properties-showname"');
assert.ok(boxPos > -1, "der Haken #ecosystem-properties-showname steht in index.html"); checks++;

// Das ganze <input>-Tag der Box -- daran haengt die Frage.
const tagStart = html.lastIndexOf("<input", boxPos);
const boxTag = html.slice(tagStart, html.indexOf(">", boxPos) + 1);
assert.ok(/name="show_name"/.test(boxTag), 'die Box traegt name="show_name"'); checks++;

// 💣 DIE TRAGENDE ZUSICHERUNG. Entweder liegt die Box im Formular, oder sie nennt es per
// `form`-Attribut. Nichts davon heisst: ihr Wert erreicht den Rumpf NIE, und der Haken laesst sich
// im Beschriftungsreiter nicht abschalten.
const imFormular = tagStart > formPos && tagStart < formEnde;
const nenntFormular = /form="label-edit-form"/.test(boxTag);
assert.ok(imFormular || nenntFormular,
	'der Haken gehoert dem Beschriftungsformular -- innerhalb oder per form="label-edit-form" (Meldung #137)'); checks++;

// Die Gegenprobe am funktionierenden Vorbild: dieselbe Bauart, damit ein spaeterer Umbau nicht
// ausgerechnet dieses Paar auseinanderzieht.
const nodixPos = html.indexOf('id="label-edit-is-nodix"');
assert.ok(nodixPos > -1, "das Vorbild label-edit-is-nodix steht da"); checks++;
const nodixStart = html.lastIndexOf("<input", nodixPos);
const nodixTag = html.slice(nodixStart, html.indexOf(">", nodixPos) + 1);
assert.ok((nodixStart > formPos && nodixStart < formEnde) || /form="label-edit-form"/.test(nodixTag),
	"und es gehoert dem Formular -- es ist der Grund, warum Nodix immer funktionierte"); checks++;

// ---- Station 2: Der Rumpf, echt ausgefuehrt ------------------------------------------------------

const dokument = {
	readyState: "complete",
	getElementById: () => null,
	querySelectorAll: () => [],
	querySelector: () => null,
	addEventListener: () => {},
};

function baueRumpfSandkasten() {
	const kasten = {
		console,
		document: dokument,
		window: { addEventListener: () => {} },
		JSON,
		Number,
		String,
		Array,
		Boolean,
		Object,
		FormData: class {
			constructor(form) { this.werte = form.werte; }
			get(name) { return Object.prototype.hasOwnProperty.call(this.werte, name) ? this.werte[name] : null; }
		},
	};
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	vm.runInContext(lies("js/review/review-labels.js"), kasten, { filename: "review-labels.js" });
	return kasten;
}

// ⚠️ Eine ANGEHAKTE Checkbox erscheint als "on", eine abgehakte erscheint GAR NICHT -- genau so
// verhaelt sich FormData im Browser, und genau daran haengt die Umrechnung im Bauer.
const formular = (werte) => ({
	werte: Object.assign({
		public_id: "lbl-1", text: "Cronwald", feature_subtype: "wald",
		size: "18", rotation: "0", min_zoom: "2", max_zoom: "7", priority: "3",
		lat: "500", lng: "500",
	}, werte),
});

const kasten = baueRumpfSandkasten();

const angehakt = kasten.buildLabelEditPayload(formular({ show_name: "on" }));
assert.strictEqual(angehakt.show_name, true, "angehakt -> show_name true"); checks++;

const abgehakt = kasten.buildLabelEditPayload(formular({}));
assert.strictEqual(abgehakt.show_name, false,
	"abgehakt -> show_name false (das ist der gemeldete Fall: er muss im Rumpf ANKOMMEN)"); checks++;

// 💣 Der Schluessel muss WIRKLICH dastehen. Ein `undefined` verschwindet beim JSON-Kodieren, und der
// Server liest einen fehlenden Schluessel als „nicht geaendert" -- der Fehler waere unveraendert da.
assert.ok(Object.prototype.hasOwnProperty.call(abgehakt, "show_name"),
	"und zwar als eigener Schluessel, nicht als undefined"); checks++;

// Auch beim Anlegen: `create_label` faellt serverseitig auf `true`, aber wenn der Rumpf hier etwas
// sagt, muss es der Stand der Box sein.
const neu = kasten.buildLabelEditPayload(formular({ public_id: "", show_name: "on" }));
assert.strictEqual(neu.action, "create_label", "ohne public_id ist es ein Anlegen"); checks++;
assert.strictEqual(neu.show_name, true, "und der Haken reist auch dort mit"); checks++;

// ---- Station 3: Die Befuellung, echt ausgefuehrt --------------------------------------------------

function baueDialogSandkasten() {
	const elemente = new Map();
	const stub = () => ({
		value: "", checked: false, hidden: false, textContent: "", options: [],
		appendChild() {}, focus() {}, querySelector: () => null,
	});
	const doc = {
		getElementById(id) {
			if (!elemente.has(id)) { elemente.set(id, stub()); }
			return elemente.get(id);
		},
		querySelectorAll: () => [],
		createElement: () => ({ label: "", appendChild() {} }),
		addEventListener() {},
	};
	const sandkasten = {
		console, document: doc, window: undefined,
		L: { latLng: (wert) => wert },
		Option: function Option(text, wert) { return { text: String(text), value: String(wert) }; },
		$: () => ({ prop() {} }),
		acquireFeatureSoftLock: () => {},
		syncModalDialogBodyState: () => {},
		setLabelEditStatus: () => {},
		ECOSYSTEM_KINDS: ["derographisch", "vegetation", "topographie"],
		ECOSYSTEM_KIND_LABELS: {},
		ecosystemRegionsByKind: {},
		ecosystemRegionTypesByKind: {},
		ecosystemRegionOfLabel: () => null,
		loadEcosystemRegions: async () => {},
		ecosystemDialogTitle: () => "",
		isEcosystemPeakSubtype: () => false,
		labelMarkers: [],
	};
	vm.createContext(sandkasten);
	vm.runInContext(lies("js/review/review-labels.js"), sandkasten, { filename: "review-labels.js" });
	return { sandkasten, elemente };
}

function oeffne(label) {
	const { sandkasten, elemente } = baueDialogSandkasten();
	// Eine FREIE Beschriftung: `ecosystemRegionOfLabel` gibt null, also keine Flaeche -- der Fall, in
	// dem `syncPropertiesShowName(area)` NIE laeuft und die Box sonst unbefuellt bliebe.
	sandkasten.populateLabelEditForm(label
		? { labelEntry: { label, marker: { getLatLng: () => ({ lat: 500, lng: 500 }) } } }
		: { latlng: { lat: 500, lng: 500 } });
	return elemente.get("ecosystem-properties-showname");
}

// 💣 Das ist die Zusicherung, die die Gegenrichtung verhindert. Ohne sie steht die Box bei einer
// freien Beschriftung auf ihrem HTML-Vorgabewert, und das erste Speichern macht sie unsichtbar.
const sichtbar = oeffne({ publicId: "lbl-1", text: "Cronwald", showName: true });
assert.strictEqual(sichtbar.checked, true, "ein sichtbares Label oeffnet mit gesetztem Haken"); checks++;

const versteckt = oeffne({ publicId: "lbl-2", text: "Cronwald", showName: false });
assert.strictEqual(versteckt.checked, false, "ein ausgeblendetes Label oeffnet OHNE Haken"); checks++;

// ⚠️ `showName` fehlt an alten Zeilen. Der Lesepfad des Hauses rechnet ueberall `!== false`, also
// heisst „fehlt" SICHTBAR -- die sichere Richtung.
const ohneAngabe = oeffne({ publicId: "lbl-3", text: "Cronwald" });
assert.strictEqual(ohneAngabe.checked, true, "fehlende Angabe heisst sichtbar (!== false)"); checks++;

const neuesLabel = oeffne(null);
assert.strictEqual(neuesLabel.checked, true,
	"ein NEUES Label beginnt sichtbar -- sonst legte der Dialog eine unsichtbare Beschriftung an"); checks++;

console.log(`OK -- ${checks} Zusicherungen (Meldung #137: der Anzeigehaken reist mit)`);
