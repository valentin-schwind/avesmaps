// Der Anzeigehaken gehört der Beschriftung, die das Fenster BEARBEITET -- nicht dem primären Label
// ihrer Fläche.
//
// 🔴 WARUM DAS ERST JETZT ZÄHLT. Bis zur Meldung #137 schickte das Beschriftungsformular kein
// `show_name`; der Haken war im Beschriftungsreiter reine ANZEIGE und wirkte nur über den
// Flächen-Weg (`renameLinkedEcosystemLabel`) auf das PRIMÄRE Label. Dass
// `syncPropertiesShowName(area)` die Box mit dem Stand des primären Labels füllt, war deshalb
// höchstens ein Anzeigefehler. Seit der Haken mitreist, wäre es ein SCHREIBfehler: die Box zeigte
// Label 1, gespeichert würde auf das offene Label 2.
//
// 💣 DIE REIHENFOLGE MACHT ES UNVERMEIDLICH. `openLabelEditDialog` füllt zuerst das Formular
// (`populateLabelEditForm` setzt `#label-edit-public-id`) und reicht die Fläche ZULETZT nach
// (`AvesmapsEcosystemProperties.open(…, { paar: false })`). Der Flächen-Öffner ruft danach
// `syncPropertiesShowName(area)` -- er ist also der LETZTE Schreiber der Box und überstimmt die
// Befüllung der Beschriftung.
//
// ⚠️ Betroffen sind die Flächen mit MEHREREN Beschriftungen (13 von 1026, AGENTS.md §11) -- erreichbar
// über die Geschwisterwahl im Beschriftungsreiter. Bei einer Fläche mit genau einem Label sind beide
// Wege dasselbe Label, und nichts ändert sich.
//
// 🔴 Ein FREMDER Dialogstand zählt nicht: nennt `#label-edit-public-id` ein Label, das gar nicht an
// dieser Fläche hängt (alter Stand aus einem vorher geöffneten Fenster), gilt wieder das primäre.
// Sonst entschied die Reihenfolge zweier Öffner darüber, welches Objekt man bearbeitet.
//
// Run: node js/map-features/__tests__/anzeigehaken-gehoert-der-offenen-beschriftung.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral (AGENTS.md §9).
const quelle = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-properties.js"), "utf8")
	.replace(/\r\n/g, "\n");
let checks = 0;

// Den Rumpf einer Funktion ausschneiden -- der Klammerzähler beginnt an der ERSTEN `{` des Rumpfs.
// 💣 Ein Regex auf den Quelltext wäre hier ein Vakuum: er kennt keinen Geltungsbereich und bestünde
// auch dann, wenn die Zeile in einem Zweig steht, den nie jemand betritt. Also wirklich AUSFÜHREN.
function schneide(kopf) {
	const von = quelle.indexOf(kopf);
	assert.ok(von > -1, `${kopf} steht in der Datei`); checks++;
	let tiefe = 0;
	for (let i = quelle.indexOf("{", von); i < quelle.length; i++) {
		if (quelle[i] === "{") { tiefe++; }
		else if (quelle[i] === "}") {
			tiefe--;
			if (tiefe === 0) { return quelle.slice(von, i + 1); }
		}
	}
	assert.fail(`der Rumpf von ${kopf} ist nicht abgegrenzt`);
}

// ---- Teil 1: die BEFÜLLUNG der Box ---------------------------------------------------------------

const rumpfSync = schneide("function syncPropertiesShowName(area) {");

function fahre({ offeneId, labels, area }) {
	const box = { checked: false, disabled: true };
	const kasten = {
		console, String, Boolean, Object,
		document: {
			getElementById(id) {
				if (id === "ecosystem-properties-showname") { return box; }
				if (id === "label-edit-public-id") { return { value: offeneId }; }
				return null;
			},
		},
		propertiesElement: (suffix) => (suffix === "showname" ? box : null),
		findLabelEntryByPublicId: (id) => {
			const label = labels.find((row) => row.publicId === String(id));
			return label ? { label } : null;
		},
		// Dieselbe Frage wie in applyRegionToLabels: hängt dieses Label an DIESER Fläche?
		ecosystemRegionOfLabel: (label) => (label && label.regionPublicId ? { public_id: label.regionPublicId } : null),
		linkedEcosystemLabelEntry: (flaeche) => {
			const label = labels.find((row) => row.publicId === String(flaeche?.label_public_id || ""));
			return label ? { label } : null;
		},
	};
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	vm.runInContext(`${rumpfSync} this.__lauf = syncPropertiesShowName;`, kasten, { filename: "syncPropertiesShowName" });
	kasten.__lauf(area);
	return box;
}

// Eine Fläche mit ZWEI Beschriftungen: die primäre ist sichtbar, die zweite ausgeblendet.
const FLAECHE = { region_public_id: "eco-1", label_public_id: "lbl-primaer" };
const LABELS = [
	{ publicId: "lbl-primaer", regionPublicId: "eco-1", showName: true },
	{ publicId: "lbl-zweite", regionPublicId: "eco-1", showName: false },
	// Ein Label einer ANDEREN Fläche -- ein alter Dialogstand.
	{ publicId: "lbl-fremd", regionPublicId: "eco-9", showName: false },
];

// 💣 DER KERNFALL: der Dialog bearbeitet die zweite Beschriftung (ausgeblendet). Die Box muss DEREN
// Stand zeigen -- sonst schreibt das Speichern das „sichtbar" der primären auf sie.
const zweite = fahre({ offeneId: "lbl-zweite", labels: LABELS, area: FLAECHE });
assert.strictEqual(zweite.checked, false,
	"die offene (ausgeblendete) Beschriftung bestimmt die Box, nicht das primäre Label"); checks++;

// Und andersherum, damit der Test nicht nur ein konstantes `false` prüft.
const primaer = fahre({ offeneId: "lbl-primaer", labels: LABELS, area: FLAECHE });
assert.strictEqual(primaer.checked, true, "ist das primäre Label offen, zeigt die Box dessen Stand"); checks++;

// Kein Dialog offen (Flächen-Einstieg): das primäre Label gilt -- der Stand von vorher.
const keins = fahre({ offeneId: "", labels: LABELS, area: FLAECHE });
assert.strictEqual(keins.checked, true, "ohne offene Beschriftung gilt das primäre Label"); checks++;

// 🔴 Ein FREMDES Label im Feld (alter Dialogstand) darf nicht gelten.
const fremdeBox = fahre({ offeneId: "lbl-fremd", labels: LABELS, area: FLAECHE });
assert.strictEqual(fremdeBox.checked, true,
	"ein Label einer anderen Fläche zählt nicht -- es gilt wieder das primäre"); checks++;

// Fläche ganz ohne Label: die Box ist leer, und Anhaken legt eines an (bestehendes Verhalten).
const ohne = fahre({ offeneId: "", labels: [], area: { region_public_id: "eco-2", label_public_id: "" } });
assert.strictEqual(ohne.checked, false, "Fläche ohne Label: Box leer"); checks++;
assert.strictEqual(ohne.disabled, false, "und NICHT gesperrt -- Anhaken legt ein Label an"); checks++;

// ---- Teil 2: der SCHREIBweg des Flächen-Knopfs ---------------------------------------------------
//
// 🔴 `renameLinkedEcosystemLabel` liest dieselbe Box, schreibt aber auf das PRIMÄRE Label. Zeigt die
// Box den Stand einer anderen (offenen) Beschriftung, darf ihr Wert hier NICHT gelten -- sonst
// schriebe der Haken der einen Beschriftung auf die andere.

const rumpfRename = schneide("async function renameLinkedEcosystemLabel(area, name) {");

async function schreibe({ offeneId, labels, area }) {
	const geschrieben = [];
	// Die Box steht auf dem Stand der OFFENEN Beschriftung -- hier: abgehakt.
	const box = { checked: false, disabled: false };
	const kasten = {
		console, String, Number, Boolean, Object, Array, Promise,
		document: {
			getElementById: (id) => (id === "label-edit-public-id" ? { value: offeneId } : null),
		},
		propertiesElement: (suffix) => {
			if (suffix === "showname") { return box; }
			if (suffix === "type") { return { value: "wald" }; }
			if (suffix === "nodix") { return { checked: false, disabled: false }; }
			return null;
		},
		findLabelEntryByPublicId: (id) => {
			const label = labels.find((row) => row.publicId === String(id));
			return label ? { label, marker: { getLatLng: () => ({ lat: 1, lng: 2 }) } } : null;
		},
		ecosystemRegionOfLabel: (label) => (label?.regionPublicId ? { public_id: label.regionPublicId } : null),
		labelData: labels,
		submitMapFeatureEdit: async (rumpf) => { geschrieben.push(rumpf); return { feature: null }; },
		effectiveWikiRegion: () => null,
		pendingWikiRegion: undefined,
		currentRegionWikiSnapshot: async () => null,
		ecosystemLabelStyleFor: () => null,
		createEcosystemRegionLabel: async () => {},
		applyLabelFeatureLocally: () => {},
		setPropertiesStatus: () => {},
	};
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	vm.runInContext(`${rumpfRename} this.__lauf = renameLinkedEcosystemLabel;`, kasten, { filename: "renameLinkedEcosystemLabel" });
	await kasten.__lauf(area, "Cronwald");
	return geschrieben;
}

(async () => {
	// 💣 Der Kernfall: Label 2 ist offen und abgehakt, das primäre ist sichtbar. Der Flächen-Knopf
	// darf das „abgehakt" NICHT auf das primäre schreiben.
	const fremd = await schreibe({ offeneId: "lbl-zweite", labels: LABELS, area: FLAECHE });
	assert.strictEqual(fremd.length, 1, "das primäre Label wird geschrieben (der Name wandert)"); checks++;
	assert.strictEqual(fremd[0].public_id, "lbl-primaer", "und zwar das primäre"); checks++;
	assert.strictEqual(fremd[0].show_name, true,
		"sein show_name bleibt SEIN geladener Stand -- der Haken der offenen Beschriftung gilt hier nicht"); checks++;

	// Ist keine Beschriftung offen (Flächen-Einstieg), gehört die Box diesem Label -- dann gilt sie.
	const eigen = await schreibe({ offeneId: "", labels: LABELS, area: FLAECHE });
	assert.strictEqual(eigen[0].show_name, false,
		"ohne offene Beschriftung schreibt der Flächen-Knopf den Stand der Box"); checks++;

	// Und wenn das primäre selbst offen ist, ebenso.
	const selbst = await schreibe({ offeneId: "lbl-primaer", labels: LABELS, area: FLAECHE });
	assert.strictEqual(selbst[0].show_name, false, "ist das primäre offen, gilt die Box für es"); checks++;

	console.log(`OK -- ${checks} Zusicherungen (der Anzeigehaken gehört der offenen Beschriftung)`);
})();
