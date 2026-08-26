// DIE BREMSE VOR DEM LABEL-LÖSCHEN — Fälle #80/#81 („Landschaftsmodus: Wenn man auf Label löschen
// geht, löscht er auch zu gleich die dazugehörige Ebene.", Thomas 19.08.2026).
//
// 🔴 Das MITLÖSCHEN ist die Regel (Owner 2026-07-28, serverseitig in
// avesmapsEcosystemCascadeAfterRemoval, ausgeführt festgenagelt in
// api/_internal/app/__tests__/ecosystem-label-kaskade-test.php). Was daran fehlte, war die ANSAGE:
// „Das ist die einzige Bremse davor" steht wörtlich am Schalter — und sie griff genau dann nicht,
// wenn sie gebraucht wurde.
//
// 💣 DIE FALLE: `ecosystemRegionOfLabel` liefert für ein Label mit eigenem Zeiger `{ public_id }`
// OHNE Namen, sobald die Regionsliste seiner Ebene nicht geladen ist — und `ecosystemRegionsByKind`
// hält im Normalfall nur die AKTIVE Ebene (syncEcosystemRegionCache), ausserhalb des
// Landschaftsmodus gar nichts. Die Rückfrage las „kein Name" als „kein Landschafts-Label" und
// stellte die harmlose Frage. Das ist derselbe Fehler wie `null` als `false` zu lesen, vor dem im
// selben Modul zweimal gewarnt wird — nur an der Stelle, an der er eine Fläche kostet.
//
// 💣 UND DER LÖSCHWEG GING AN DEM VORBEI, WAS SEINE ZWEI NACHBARN TUN: `duplicateLabelEntry` und
// `selectEcosystemAreaOfLabel` holen beide die Regionslisten ALLER Ebenen, bevor sie die Fläche
// eines Labels auflösen („🪤 Erst die Regionslisten holen. Ausserhalb des Landschaftsmodus sind sie
// leer"). `deleteLabelEntry` — der einzige der drei, der etwas zerstört — tat es nicht.
//
// Lauf: node js/map-features/__tests__/ecosystem-label-loeschen-bremse.test.js

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { formatEcosystemLabelDeleteConfirmation } = require("../map-features-ecosystem-label-writeback.js");

// ==================================================================================================
// TEIL 1 — die Rückfrage kennt DREI Zustände, nicht zwei
// ==================================================================================================

// (a) Kein Landschafts-Label. Ein Kontinentname, ein Meer, ein freier Kartentitel: hier geht nichts
//     mit, und eine Warnung wäre eine Lüge in die andere Richtung.
assert.strictEqual(
	formatEcosystemLabelDeleteConfirmation("Riesland", null, 0, null),
	"Riesland wirklich löschen?",
	"ein Label ohne Fläche bekommt die schlichte Frage"
);

// (b) 💣 DER GEMELDETE FALL. Das Label GEHÖRT zu einer Fläche — die Zeile der Region ist nur nicht
//     geladen, also fehlen Name und Flächenzahl. Vorher: die schlichte Frage, und die Fläche war
//     danach weg. Jetzt: die Warnung, ohne Namen zu erfinden.
const nurKennung = formatEcosystemLabelDeleteConfirmation("Finsterkamm", { public_id: "r-1" }, 0, null);
assert.ok(
	nurKennung.includes("Finsterkamm wirklich löschen?"),
	"die Frage steht weiterhin oben"
);
assert.ok(
	/Fl(ä|ae)che/.test(nurKennung),
	"💣 eine bekannte Zugehörigkeit MUSS die Folge nennen, auch ohne geladene Regionszeile: " + JSON.stringify(nurKennung)
);
assert.notStrictEqual(
	nurKennung,
	"Finsterkamm wirklich löschen?",
	"💣 sonst ist die einzige Bremse vor einem Kaskadenlöschen genau dann weg, wenn niemand sie sieht"
);
assert.ok(
	!nurKennung.includes("undefined") && !nurKennung.includes("Ohne Namen"),
	"und erfindet keinen Regionsnamen, den sie nicht kennt: " + JSON.stringify(nurKennung)
);

// (b2) Dieselbe Lage bei ausgeschalteter Kaskade: dann bleibt die Fläche stehen, und das darf sie
//      auch sagen. Nur ein ausdrückliches `false` beruhigt — dieselbe Regel wie bei der bekannten
//      Region.
const nurKennungOhneKaskade = formatEcosystemLabelDeleteConfirmation("Finsterkamm", { public_id: "r-1" }, 0, false);
assert.ok(
	!/verschwind/.test(nurKennungOhneKaskade),
	"bei ausdrücklich abgeschalteter Kaskade wird kein Mitlöschen angekündigt"
);

// (c) Vollständig bekannte Region: unverändert die ausführliche Fassung mit Namen und Zahl.
const vollstaendig = formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 3 }, 1, true);
assert.ok(vollstaendig.includes("LETZTE"), "der bekannte Fall bleibt, wie er war");
assert.ok(vollstaendig.includes("ihre 3 Flächen"), "samt Zahl");

// Und die Geschwister-Fassung ebenfalls: mehrere Labels, nichts geht mit.
const mehrere = formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 2 }, 3, true);
assert.ok(mehrere.includes("behält 2 weitere Labels"), "1:N bleibt 1:N");

// ==================================================================================================
// TEIL 2 — die Verdrahtung: erst die Listen holen, DANN fragen
//
// 💣 ZUR LAUFZEIT GEPRÜFT, NICHT PER GREP. Ein Suchmuster findet, was jemand hingeschrieben hat;
// dieser Test findet die Reihenfolge, in der es wirklich läuft — und genau die Reihenfolge ist die
// Aussage: eine Liste, die nach der Rückfrage eintrifft, hilft niemandem mehr.
// ==================================================================================================

const quelle = fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8");

function buehne({ ohneEigenenZeiger = false } = {}) {
	const protokoll = [];
	const kontext = {
		console: { warn() {}, error() {} },
		Map,
		Set,
		Array,
		Number,
		String,
		Boolean,
		Object,
		JSON,
		Math,
		Promise,
		document: { fonts: null, getElementById: () => null, createElement: () => ({ style: {} }) },
		ECOSYSTEM_KINDS: ["derographisch", "vegetation", "topographie"],
		// Die Nachbarn des Löschwegs, jeder als Aufzeichnung.
		loadEcosystemRegions: (kind) => {
			protokoll.push("laden:" + kind);
			return Promise.resolve();
		},
		ecosystemRegionOfLabel: (label) => {
			protokoll.push("aufloesen");
			// Der Auflöser, wie er sich wirklich verhält (map-features-ecosystem-region-store.js):
			// mit geladener Liste die ganze Zeile — ohne sie nur die Kennung (Label MIT eigenem
			// Zeiger) bzw. GAR NICHTS (Label ohne eigenen Zeiger, die grosse Mehrheit). Genau dieser
			// Unterschied ist der Grund, warum die Reihenfolge zählt.
			if (protokoll.includes("laden:vegetation")) {
				return { public_id: "r-1", name: "Finsterkamm", area_count: 2 };
			}
			return ohneEigenenZeiger ? null : { public_id: "r-1" };
		},
		ecosystemLabelCountOfRegion: () => 1,
		isEcosystemCascadeEnabled: () => null,
		formatEcosystemLabelDeleteConfirmation,
		refusePowerlineAnchoredDeletion: () => false,
		showFeedbackToast: () => {},
		setLabelEditStatus: () => {},
		setLabelEditDialogOpen: () => {},
		removeLabelEntryLocally: () => {},
		updateRevisionFromEditResponse: () => {},
		loadChangeLog: () => {},
		removeEcosystemCascadedLabels: () => {},
		invalidateEcosystemRegionCache: () => {},
		scheduleEcosystemAreaReload: () => {},
		submitMapFeatureEdit: (payload) => {
			protokoll.push("senden:" + payload.action);
			return Promise.resolve({ public_id: payload.public_id, deleted: true });
		},
		window: {
			confirm: (text) => {
				protokoll.push("fragen");
				kontext.gestellteFrage = text;
				return true;
			},
		},
		gestellteFrage: "",
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(quelle, kontext, { filename: "map-features-labels.js" });

	return { kontext, protokoll };
}

const { kontext, protokoll } = buehne();
const eintrag = {
	label: { publicId: "l-1", text: "Finsterkamm", ecosystemRegionPublicId: "r-1" },
	marker: { closePopup() {} },
};

return (async () => {
	await kontext.deleteLabelEntry(eintrag);

	// 💣 Die Regionslisten ALLER Ebenen, bevor gefragt wird. „Alle" und nicht „die aktive": ein Label
	// löscht man überall, und die Fläche dahinter kann in jeder der drei liegen.
	const ersteFrage = protokoll.indexOf("fragen");
	assert.notStrictEqual(ersteFrage, -1, "es wird überhaupt gefragt");
	["derographisch", "vegetation", "topographie"].forEach((kind) => {
		const geladen = protokoll.indexOf("laden:" + kind);
		assert.notStrictEqual(geladen, -1, `💣 die Ebene ${kind} wird geladen — sonst ist die Rückfrage blind: ` + protokoll.join(" > "));
		assert.ok(geladen < ersteFrage, `💣 und zwar VOR der Rückfrage (${kind}): ` + protokoll.join(" > "));
	});

	// Und die Frage sagt danach, was mitgeht — mit dem Namen, den erst das Laden geliefert hat.
	assert.ok(
		kontext.gestellteFrage.includes("Finsterkamm") && /verschwind/.test(kontext.gestellteFrage),
		"die Rückfrage nennt die Folge: " + JSON.stringify(kontext.gestellteFrage)
	);

	// Erst danach wird gelöscht — und genau einmal.
	assert.strictEqual(
		protokoll.filter((eintrag) => eintrag === "senden:delete_feature").length,
		1,
		"genau eine Löschung: " + protokoll.join(" > ")
	);
	assert.ok(protokoll.indexOf("senden:delete_feature") > ersteFrage, "und nie vor der Rückfrage");

	// 💣 DER HÄUFIGSTE FALL: ein Bestandslabel OHNE eigenen Zeiger. Seine Fläche kennt nur die
	// Regionsliste — ohne sie ist es für den Auflöser gar kein Landschafts-Label, und die Rückfrage
	// hat nichts zu warnen. Erst das Laden macht die Bremse überhaupt möglich.
	const bestand = buehne({ ohneEigenenZeiger: true });
	await bestand.kontext.deleteLabelEntry({
		label: { publicId: "l-alt", text: "Farindel" },     // kein ecosystemRegionPublicId
		marker: { closePopup() {} },
	});
	assert.ok(
		/verschwind/.test(bestand.kontext.gestellteFrage),
		"💣 auch ohne eigenen Zeiger muss die Folge in der Rückfrage stehen: " + JSON.stringify(bestand.kontext.gestellteFrage)
	);

	// 🔴 Ein NEIN an der Rückfrage löscht nichts. Die Bremse muss auch bremsen.
	const abgelehnt = buehne();
	abgelehnt.kontext.window.confirm = () => {
		abgelehnt.protokoll.push("fragen");
		return false;
	};
	await abgelehnt.kontext.deleteLabelEntry({
		label: { publicId: "l-1", text: "Finsterkamm", ecosystemRegionPublicId: "r-1" },
		marker: { closePopup() {} },
	});
	assert.ok(
		!abgelehnt.protokoll.some((eintrag) => eintrag.startsWith("senden:")),
		"abgelehnt heisst: nichts gesendet — " + abgelehnt.protokoll.join(" > ")
	);

	console.log("ok - ecosystem-label-loeschen-bremse");
})();
