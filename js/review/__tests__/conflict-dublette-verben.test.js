// Welche Knöpfe ein Dubletten-Fall im Konfliktzentrum anbietet — und welche NICHT.
//
// 🔴 Der Knopf ist der ganze Sinn der Liste. Eine Beschriftung, die die Label-Kollision verliert,
// wird nicht gezeichnet, und was nicht gezeichnet ist, lässt sich auf der Karte nicht anklicken:
// kein Klick, kein Rechtsklick, kein Löschen. Der Löschweg muss also AUS DER LISTE HERAUS gehen.
//
// 💣 Und er darf nicht überall stehen: an einer Beschriftung, an der eine Landschaftsfläche hängt,
// nimmt ein Löschvorgang womöglich die ganze Fläche mit (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED). Der
// Server lehnt das ohnehin ab — aber ein Knopf, der immer nur eine Fehlermeldung erzeugt, ist eine
// Falle, kein Angebot. Deshalb steht dort der GRUND statt des Knopfes.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox mit einem DOM-Schein (Hausform wie
// conflict-resolve-complaints.test.js und ort-wiki-override-form.test.js): ein Nachbau
// zertifizierte nur den Nachbau.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/conflict-dublette-verben.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(ROOT, "js", "review", "review-conflicts.js"), "utf8");

// Ein Knoten, der sich seine Kinder merkt — nur so lässt sich hinterher fragen, was gebaut wurde.
function knoten(tagName) {
	return {
		tagName,
		children: [],
		className: "",
		textContent: "",
		title: "",
		type: "",
		href: "",
		rel: "",
		target: "",
		hidden: false,
		disabled: false,
		style: { setProperty() {} },
		dataset: {},
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		appendChild(kind) { this.children.push(kind); return kind; },
		// Merkt sich die Zuhörer, statt sie wegzuwerfen: nur so lässt sich der Löschklick wirklich
		// AUSLÖSEN. Ein Test, der bloß nachsieht, ob ein Knopf dasteht, sagt nichts darüber, was er tut.
		_handlers: null,
		addEventListener(typ, fn) {
			if (!this._handlers) { this._handlers = {}; }
			if (!this._handlers[typ]) { this._handlers[typ] = []; }
			this._handlers[typ].push(fn);
		},
		async fire(typ) {
			const liste = (this._handlers && this._handlers[typ]) || [];
			for (const fn of liste) { await fn(); }
		},
		setAttribute() {},
		removeAttribute() {},
		getAttribute() { return null; },
	};
}

const sandbox = {
	console, JSON, Math, Date, Number, String, Array, Object, Boolean, Map, Set, Promise,
	setTimeout, clearTimeout,
	fetch: () => {},
	// Leaflet, so weit resolveConflictPartyLatLng es braucht -- mit echten Koordinaten erscheint
	// auch „Auf der Karte zeigen", und genau so sieht der Editor die Zeile.
	L: { latLng: (lat, lng) => ({ lat, lng }) },
	window: { alert() {}, setTimeout() {} },
	navigator: {},
	document: {
		createElement: (tag) => knoten(tag),
		getElementById: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener() {},
	},
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-conflicts.js" });

const createConflictElement = sandbox.createConflictElement;
assert.strictEqual(typeof createConflictElement, "function", "die echte Funktion ist geladen");

/** Alle Knöpfe eines gebauten Falls, flach, mit ihrer Beschriftung. */
function knopfTexte(wurzel) {
	const gefunden = [];
	(function lauf(el) {
		if (el.tagName === "button") { gefunden.push(String(el.textContent)); }
		(el.children || []).forEach(lauf);
	})(wurzel);
	return gefunden;
}

/** Der gesamte sichtbare Text eines gebauten Falls. */
function ganzerText(wurzel) {
	const teile = [];
	(function lauf(el) {
		if (String(el.textContent) !== "") { teile.push(String(el.textContent)); }
		(el.children || []).forEach(lauf);
	})(wurzel);
	return teile.join(" | ");
}

const DUBLETTE = {
	rule_id: "label.duplicate",
	fingerprint: "abc",
	short_id: "K7M2QX",
	severity: "error",
	status: "open",
	title: "Drei Schwestern",
	wiki_url: "",
	subject_type: "label",
	subject_id: "frei-1",
	parties: [
		{ type: "label", id: "frei-1", label: "Drei Schwestern", type_label: "Region/Landschaft", position: { lat: 647.766, lng: 525.914 }, ecosystem_region_public_id: "", deletable: true, updated_at: "2026-08-20 12:38:09" },
		{ type: "label", id: "frei-2", label: "Drei Schwestern", type_label: "Region/Landschaft", position: { lat: 646.313, lng: 524.063 }, ecosystem_region_public_id: "", deletable: true, updated_at: "2026-08-07 09:50:13" },
	],
};

// ---- Der gemeldete Fall: zwei freie Beschriftungen, beide löschbar -----------------------------
const beide = createConflictElement(DUBLETTE);
const knoepfeBeide = knopfTexte(beide);
const loeschKnoepfe = knoepfeBeide.filter((t) => t.includes("löschen"));
assert.strictEqual(loeschKnoepfe.length, 2, "je Partei ein Löschknopf, nicht einer für den Fall: " + JSON.stringify(knoepfeBeide));
assert.ok(loeschKnoepfe[0].includes("Beschriftung"), "der Knopf sagt, WAS er löscht: " + loeschKnoepfe[0]);

// 🔴 DIE ZWEI ZEILEN MÜSSEN UNTERSCHEIDBAR SEIN. Beide heißen „Drei Schwestern", beide sind
// `berggipfel`, beide zeigen auf denselben Artikel — vor zwei identischen Zeilen mit je einem
// Löschknopf kann niemand entscheiden, welche die überzählige ist. „Zuletzt geändert" ist das
// Merkmal, das ohnehin in der Zeile liegt.
const textBeide = ganzerText(beide);

// 🔴 DIE KOORDINATE IST DAS TRAGENDE MERKMAL, nicht der Zeitstempel. `map_features.updated_at`
// ist `ON UPDATE CURRENT_TIMESTAMP(3)`, und ausgerechnet der Erzeuger dieser Gruppen
// (`avesmapsWikiRegionAssign`) schreibt BEIDE Zeilen im selben Lauf -- dann stehen dort zwei Werte
// im Millisekundenabstand. „20.08. gegen 07.08." ist eine Momentaufnahme, keine Regel. Zwei
// Beschriftungen liegen dagegen nie am selben Fleck, sonst wären sie eine.
assert.ok(textBeide.includes("525,9"), "die Lage der einen steht da: " + textBeide);
assert.ok(textBeide.includes("524,1"), "und die der anderen auch: " + textBeide);
assert.ok(textBeide.includes("647,8") && textBeide.includes("646,3"), "mit beiden Achsen: " + textBeide);

// Der Zeitstempel darf bleiben -- als Beigabe, nicht als Beweis.
assert.ok(textBeide.includes("2026-08-20"), "der Stand der einen steht da: " + textBeide);
assert.ok(textBeide.includes("2026-08-07"), "und der der anderen auch: " + textBeide);

// ⚠️ Und die irreführende Zeile der Artikel-Regel steht NICHT da: beide tragen sehr wohl einen
// Wiki-Artikel — dass es derselbe ist, IST der Fall.
assert.ok(!textBeide.includes("kein eigener Wiki-Artikel"), "keine Falschaussage über den Artikel: " + textBeide);

// ---- 💣 WAS AN DER BESCHRIFTUNG HÄNGT, MUSS SICHTBAR SEIN, BEVOR SIE VERSCHWINDET ---------------
// Ein `berggipfel`-Label trägt seine Höhe in `height_schritt`, und das Höhenfeld der Karte liest
// GENAU DIESE Labels als Stützpunkte (`api/_internal/app/terrain-store.php`, `is_active = 1`). Live
// trägt eine der beiden „Drei Schwestern" 2100 Schritt und die andere gar nichts — wer die falsche
// löscht, nimmt der Karte einen Höhenstützpunkt, ohne es zu merken. Der Wert wird deshalb GEZEIGT;
// entschieden wird nach wie vor vom Editor.
const mitHoehe = createConflictElement(Object.assign({}, DUBLETTE, {
	parties: [
		Object.assign({}, DUBLETTE.parties[0], { height_schritt: 2100 }),
		DUBLETTE.parties[1],
	],
}));
assert.ok(ganzerText(mitHoehe).includes("2100"), "die Höhe steht an der Zeile, die sie trägt: " + ganzerText(mitHoehe));
// Und die ohne Höhe behauptet keine — „0" wäre eine Aussage, die niemand gemacht hat.
assert.ok(!ganzerText(beide).includes("Schritt"), "ohne Höhe steht dort nichts: " + ganzerText(beide));

// 💣 DIE VERBEN DER ARTIKEL-REGEL GEHÖREN HIER NICHT HIN. „Trennen" nimmt der Beschriftung nur den
// Wiki-Link — der Name stünde danach immer noch zweimal auf der Karte. Der Fall sähe erledigt aus
// und wäre es nicht.
["Trennen", "Kein Wiki-Eintrag", "Behält den Link", "Artikel übernehmen"].forEach((verb) => {
	assert.ok(!knoepfeBeide.includes(verb), "„" + verb + "\" darf an einer Dublette nicht stehen");
});

// Die Buchführung bleibt: der Fall lässt sich auch ohne Datenänderung entscheiden.
["Genehmigt", "Zurückstellen", "Archivieren"].forEach((verb) => {
	assert.ok(knoepfeBeide.includes(verb), "„" + verb + "\" fehlt: " + JSON.stringify(knoepfeBeide));
});

// ---- 💣 Flächengebunden: KEIN Knopf, sondern der Grund -----------------------------------------
const gemischt = createConflictElement(Object.assign({}, DUBLETTE, {
	title: "Schwarzer See",
	parties: [
		{ type: "label", id: "frei-1", label: "Schwarzer See", type_label: "Region/Landschaft", position: null, ecosystem_region_public_id: "", deletable: true },
		{ type: "label", id: "gebunden-1", label: "Schwarzer See", type_label: "Region/Landschaft", position: null, ecosystem_region_public_id: "r-see", deletable: false },
	],
}));
const knoepfeGemischt = knopfTexte(gemischt);
assert.strictEqual(
	knoepfeGemischt.filter((t) => t.includes("löschen")).length,
	1,
	"nur die freie Beschriftung bekommt den Knopf: " + JSON.stringify(knoepfeGemischt)
);
assert.ok(
	ganzerText(gemischt).includes("Landschaftsfläche"),
	"und die gebundene sagt, warum sie keinen bekommt: " + ganzerText(gemischt)
);

// ---- Ein entschiedener Fall bietet nichts mehr an ----------------------------------------------
const archiviert = createConflictElement(Object.assign({}, DUBLETTE, { status: "archived" }));
assert.strictEqual(
	knopfTexte(archiviert).filter((t) => t.includes("löschen")).length,
	0,
	"ein archivierter Fall löscht nichts"
);

// ---- ⚠️ Die Artikel-Regel bleibt unangetastet ---------------------------------------------------
// Sie trägt weiter ihre eigenen Verben; die Weiche darf ihr nichts wegnehmen.
const geteilt = createConflictElement({
	rule_id: "wiki.shared_article",
	fingerprint: "def",
	severity: "error",
	status: "open",
	title: "Jergan",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Jergan",
	parties: [
		{ type: "location", id: "o-1", label: "Jergan", type_label: "Ort", position: null, unlinkable: true },
		{ type: "label", id: "l-1", label: "Jergan (Wasserfall)", type_label: "Region/Landschaft", position: null, unlinkable: true },
	],
});
const knoepfeGeteilt = knopfTexte(geteilt);
assert.ok(knoepfeGeteilt.includes("Trennen"), "die Artikel-Regel behält ihre Verben: " + JSON.stringify(knoepfeGeteilt));
assert.strictEqual(
	knoepfeGeteilt.filter((t) => t.includes("löschen")).length,
	0,
	"und bekommt KEINEN Löschknopf — dort ist Löschen nie die Reparatur"
);

// ================================================================================================
// 💣 DIE ZWEITE KASKADE: ein Gipfel-Label IST ein Stützpunkt des Höhenfelds
// ================================================================================================
// `api/_internal/app/terrain-store.php` liest `feature_type='label' AND is_active = 1 AND
// feature_subtype IN ('berggipfel','vulkan')` und nimmt `properties.height_schritt`. Der Löschweg
// setzt `is_active = 0` — der Stützpunkt ist damit weg, lautlos. Owner-Entscheid: KEINE
// Verweigerung (das Löschen ist weich und umkehrbar), aber eine ausdrückliche ZWEITE Rückfrage, die
// die Folge beim Namen nennt.

/** Findet den ersten Knopf mit dieser Beschriftung im gebauten Baum. */
function knopf(wurzel, text) {
	let treffer = null;
	(function lauf(el) {
		if (treffer) { return; }
		if (el.tagName === "button" && String(el.textContent).includes(text)) { treffer = el; return; }
		(el.children || []).forEach(lauf);
	})(wurzel);
	return treffer;
}

/** Baut den Fall, klickt „Beschriftung löschen" an der genannten Partei und protokolliert alles. */
async function loeschKlick(parties, indexDerPartei, antwortenAufConfirm) {
	const gefragt = [];
	const gesendet = [];
	let stelle = 0;
	sandbox.window.confirm = (text) => {
		gefragt.push(String(text));
		const antwort = antwortenAufConfirm[stelle];
		stelle += 1;
		return antwort === undefined ? true : antwort;
	};
	sandbox.window.alert = () => {};
	sandbox.submitConflictAction = async (aktion, rumpf) => { gesendet.push({ aktion, rumpf }); return { ok: true, results: [] }; };
	sandbox.loadConflicts = async () => {};

	const fall = Object.assign({}, DUBLETTE, { parties });
	const element = createConflictElement(fall);
	// Der Knopf der gewünschten Partei: die Parteien stehen in der Reihenfolge des Falls im Baum.
	const parteiKnoepfe = [];
	(function lauf(el) {
		if (el.tagName === "button" && String(el.textContent).includes("Beschriftung löschen")) { parteiKnoepfe.push(el); }
		(el.children || []).forEach(lauf);
	})(element);
	await parteiKnoepfe[indexDerPartei].fire("click");

	return { gefragt, gesendet };
}

const MIT_HOEHE = { type: "label", id: "hoch", label: "Drei Schwestern", type_label: "Region/Landschaft", position: null, ecosystem_region_public_id: "", deletable: true, updated_at: "2026-08-20 12:38:09", height_schritt: 2100 };
const OHNE_HOEHE = { type: "label", id: "flach", label: "Drei Schwestern", type_label: "Region/Landschaft", position: null, ecosystem_region_public_id: "", deletable: true, updated_at: "2026-08-07 09:50:13" };

(async () => {
	// ---- Die HÖHENLOSE Zeile bleibt ein normaler Klick: eine Rückfrage ---------------------------
	const flach = await loeschKlick([MIT_HOEHE, OHNE_HOEHE], 1, [true]);
	assert.strictEqual(flach.gefragt.length, 1, "eine Rückfrage: " + JSON.stringify(flach.gefragt));
	assert.strictEqual(flach.gesendet.length, 1, "und es wird gelöscht");
	assert.strictEqual(flach.gesendet[0].rumpf.mode, "delete_label");
	assert.strictEqual(flach.gesendet[0].rumpf.targets[0].id, "flach");

	// ---- Die HÖHENTRAGENDE bekommt eine ZWEITE, die die Folge beim Namen nennt -------------------
	const hoch = await loeschKlick([MIT_HOEHE, OHNE_HOEHE], 0, [true, true]);
	assert.strictEqual(hoch.gefragt.length, 2, "zwei Rückfragen: " + JSON.stringify(hoch.gefragt));
	const zweite = hoch.gefragt[1];
	assert.ok(zweite.includes("2100"), "sie nennt die Höhe: " + zweite);
	assert.ok(/Höhenfeld/i.test(zweite), "und dass es ein Stützpunkt des Höhenfelds ist: " + zweite);
	assert.ok(/Zwilling|andere/i.test(zweite), "und dass der Zwilling keine trägt: " + zweite);
	assert.strictEqual(hoch.gesendet.length, 1, "nach zweimal Ja wird gelöscht");

	// ---- 🔴 Und ein NEIN auf die zweite hält es auf ------------------------------------------------
	// Ohne diese Zusicherung wäre die zweite Rückfrage Zierde: sie muss den Vorgang wirklich stoppen.
	const abgebrochen = await loeschKlick([MIT_HOEHE, OHNE_HOEHE], 0, [true, false]);
	assert.strictEqual(abgebrochen.gefragt.length, 2);
	assert.strictEqual(abgebrochen.gesendet.length, 0, "nach Nein wird NICHTS gesendet");

	// ---- Ein Nein auf die ERSTE hält es ebenfalls auf, ohne die zweite zu stellen ----------------
	const sofortNein = await loeschKlick([MIT_HOEHE, OHNE_HOEHE], 0, [false]);
	assert.strictEqual(sofortNein.gefragt.length, 1, "die zweite kommt gar nicht erst");
	assert.strictEqual(sofortNein.gesendet.length, 0);

	console.log("conflict-dublette-verben.test.js: OK");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
