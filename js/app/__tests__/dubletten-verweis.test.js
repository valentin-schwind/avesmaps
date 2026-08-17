const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Der Verweis auf den blockierenden Ort (Bug #46, zweiter Teil, 17.08.2026).
//
// Die Meldung „Ein Ort namens … existiert bereits" NANNTE den Blocker schon immer, aber man kam
// nicht hin. Der Owner lief am 17.08.2026 hinein: er zog am Ort „Koschim" das Namensfeld per
// Ruecksetzer auf den Wiki-Stand „Hallen von Koschim" -- den ein zweiter Ort bereits trug.
//
// 🔴 DER VERWEIS STEHT NICHT IM MELDUNGSTEXT. Der Satz ist wortgleich in PHP und JS gepflegt und
// wird an jeder Anzeigestelle per textContent gesetzt; Markup darin erschiene roh. Die KENNUNG
// reist daneben, in `error.duplicate_location` -- und dieser Test faehrt genau diesen Weg ab:
//
//   A) beide Leser (api-client.js und das eigene Dokument des Ortseditors) sagen dasselbe,
//   B) submitMapFeatureEdit haengt die Kennung wirklich an den geworfenen Error,
//   C) mapFeaturesEditPost im Ortseditor ebenso,
//   D) die Statuszeile baut den Knopf NUR mit Kennung -- und laesst den Text unangetastet.
//
// B/C sind Verdrahtungstests: ein geworfener Error traegt nur einen String, alles andere muss
// ausdruecklich drangehaengt werden. Ein reiner Lesertest waere gruen, waehrend die Kennung eine
// Zeile vor ihrem Empfaenger stirbt.
//
// Lauf vom Repo-Wurzelverzeichnis:  node js/app/__tests__/dubletten-verweis.test.js

const API_CLIENT_SOURCE = fs.readFileSync(path.join(__dirname, "..", "api-client.js"), "utf8");
const SETTLEMENT_EDITOR_SOURCE = fs.readFileSync(
	path.join(__dirname, "..", "..", "..", "html", "wiki-sync-settlement-editor.html"),
	"utf8"
);
const REVIEW_STATUS_SOURCE = fs.readFileSync(
	path.join(__dirname, "..", "..", "review", "review-status.js"),
	"utf8"
);

// Wie in js/routing/__tests__/duplicate-location-name.test.js: die Dateien sind Browser-Skripte
// ohne module.exports, also wird die Deklaration aus dem ECHTEN Quelltext geschnitten und
// ausgewertet. Eine hierher kopierte Fassung wuerde gar nichts pruefen.
function cutDeclaration(source, label, startsWith, endsWith) {
	const start = source.indexOf(startsWith);
	assert.notStrictEqual(start, -1, `Deklaration nicht gefunden in ${label}: ${startsWith}`);
	const end = source.indexOf(endsWith, start);
	assert.notStrictEqual(end, -1, `Ende der Deklaration nicht gefunden in ${label}: ${startsWith}`);
	return source.slice(start, end + endsWith.length);
}

// ── A) Die zwei Leser sind Zwillinge ────────────────────────────────────────────────────────────
// Der Ortseditor laeuft in einem eigenen Dokument und laedt api-client.js nicht; die Funktion ist
// deshalb abgeschrieben (dieselbe Lage wie bei js/ui/wiki-assign-ort.js). Genau EIN Datensatz
// laeuft hier durch BEIDE Fassungen -- wer eine aendert und die andere nicht, faellt damit um.
const LESER_QUELLE = {
	"js/app/api-client.js": cutDeclaration(
		API_CLIENT_SOURCE, "js/app/api-client.js", "function duplicateLocationFromApiError(", "\n}"
	),
	"html/wiki-sync-settlement-editor.html": cutDeclaration(
		SETTLEMENT_EDITOR_SOURCE, "html/wiki-sync-settlement-editor.html",
		"function duplicateLocationFromApiError(", "\n}"
	),
};

const HALLEN_ID = "63e2adfd-16b4-4500-84c0-58b9967c972d";

// Antwort => erwartete Kennung. Die erste Zeile ist der echte Fall vom 17.08.2026.
const KORPUS = [
	{
		was: "die Dublettenablehnung des Servers",
		antwort: { ok: false, error: { code: "invalid_request", message: "…existiert bereits…", duplicate_location: { public_id: HALLEN_ID, name: "Hallen von Koschim" } } },
		erwartet: { publicId: HALLEN_ID, name: "Hallen von Koschim" },
	},
	{
		was: "eine Kennung ohne Namen (der Text nennt ihn ohnehin)",
		antwort: { error: { duplicate_location: { public_id: HALLEN_ID } } },
		erwartet: { publicId: HALLEN_ID, name: "" },
	},
	// 🔴 Ohne public_id gibt es KEINEN Verweis -- nie ein Objekt mit leerer Kennung. Eine
	// Oberflaeche erkennt den Verweis genau daran; ein leerer Platzhalter baute einen Knopf ins Nichts.
	{ was: "eine leere Kennung", antwort: { error: { duplicate_location: { public_id: "", name: "X" } } }, erwartet: null },
	{ was: "eine Kennung, die keine Zeichenkette ist", antwort: { error: { duplicate_location: { public_id: 42 } } }, erwartet: null },
	{ was: "eine Beilage ohne Kennung", antwort: { error: { duplicate_location: {} } }, erwartet: null },
	{ was: "jede andere Ablehnung", antwort: { ok: false, error: { code: "invalid_request", message: "Der Ortsname fehlt." } }, erwartet: null },
	// ⚠️ Mehrere Endpunkte geben laut AGENTS.md §4 noch flaches `error:"string"` heraus. Der
	// Ortseditor trifft das nicht (gemessen: api/edit/map/features.php faehrt die volle Huelle),
	// aber der Leser darf daran nicht zerbrechen.
	{ was: "die alte flache Fehlerform", antwort: { ok: false, error: "Der Ortsname fehlt." }, erwartet: null },
	{ was: "eine Antwort ohne error", antwort: { ok: false }, erwartet: null },
	{ was: "gar keine Antwort", antwort: null, erwartet: null },
	{ was: "undefined", antwort: undefined, erwartet: null },
];

for (const [datei, quelle] of Object.entries(LESER_QUELLE)) {
	const lies = new Function(`${quelle}\nreturn duplicateLocationFromApiError;`)();
	for (const fall of KORPUS) {
		assert.deepStrictEqual(
			lies(fall.antwort), fall.erwartet,
			`${datei} liest ${fall.was} falsch`
		);
	}
}
console.log(`beide Leser deuten ${KORPUS.length} Antworten gleich ok`);

// ── B) submitMapFeatureEdit haengt die Kennung an den geworfenen Error ───────────────────────────
async function fahreTransport(quelle, rueckgabeName, antwort, status) {
	const umgebung = new Function(
		"stubs",
		"const { fetch, readJsonResponse, apiErrorMessage, withExpectedRevision, pollLiveMapUpdates,"
		+ " MAP_FEATURE_UPDATE_API_URL, MAP_FEATURES_EDIT_API } = stubs;\n"
		+ `${quelle}\nreturn ${rueckgabeName};`
	)({
		fetch: async () => ({ ok: status === 200, status, json: async () => antwort }),
		readJsonResponse: async () => antwort,
		apiErrorMessage: (data, fallback) => (data && data.error && data.error.message) || fallback,
		withExpectedRevision: (payload) => payload,
		pollLiveMapUpdates: () => {},
		MAP_FEATURE_UPDATE_API_URL: "/api/edit/map/features.php",
		MAP_FEATURES_EDIT_API: "/api/edit/map/features.php",
	});
	try {
		await umgebung({ action: "update_point", name: "Hallen von Koschim" });
		return null;
	} catch (fehler) {
		return fehler;
	}
}

const DUBLETTEN_ANTWORT = {
	ok: false,
	error: {
		code: "invalid_request",
		message: 'Ein Ort namens "Hallen von Koschim" existiert bereits.',
		duplicate_location: { public_id: HALLEN_ID, name: "Hallen von Koschim" },
	},
};
const ANDERE_ANTWORT = { ok: false, error: { code: "invalid_request", message: "Der Ortsname fehlt." } };

const TRANSPORTE = [
	{
		datei: "js/app/api-client.js",
		quelle: LESER_QUELLE["js/app/api-client.js"] + "\n"
			+ cutDeclaration(API_CLIENT_SOURCE, "js/app/api-client.js", "async function submitMapFeatureEdit(", "\n}"),
		name: "submitMapFeatureEdit",
	},
	{
		datei: "html/wiki-sync-settlement-editor.html",
		quelle: LESER_QUELLE["html/wiki-sync-settlement-editor.html"] + "\n"
			+ cutDeclaration(SETTLEMENT_EDITOR_SOURCE, "html/wiki-sync-settlement-editor.html", "async function mapFeaturesEditPost(", "\n}"),
		name: "mapFeaturesEditPost",
	},
];

(async () => {
	for (const transport of TRANSPORTE) {
		const dublette = await fahreTransport(transport.quelle, transport.name, DUBLETTEN_ANTWORT, 400);
		assert.ok(dublette, `${transport.datei}: eine abgelehnte Anfrage muss werfen`);
		assert.ok(
			dublette.message.includes("existiert bereits"),
			`${transport.datei}: der Satz des Servers muss unveraendert durchkommen`
		);
		// DAS ist die Zusicherung, an der es haengt. Ohne sie ist der Leser gruen und die Kennung
		// stirbt trotzdem eine Zeile vor der Oberflaeche.
		assert.deepStrictEqual(
			dublette.duplicateLocation, { publicId: HALLEN_ID, name: "Hallen von Koschim" },
			`${transport.datei}: der geworfene Error muss die Kennung des Blockers tragen`
		);
		// 🔴 Die Kennung darf NICHT im Text stehen -- dort waere sie fuer eine Oberflaeche wertlos
		// und stuende als roher Text im Bild.
		assert.ok(
			!dublette.message.includes(HALLEN_ID),
			`${transport.datei}: die Kennung gehoert neben den Satz, nicht hinein`
		);

		const andere = await fahreTransport(transport.quelle, transport.name, ANDERE_ANTWORT, 400);
		assert.ok(andere, `${transport.datei}: auch jede andere Ablehnung muss werfen`);
		assert.strictEqual(
			andere.duplicateLocation, null,
			`${transport.datei}: eine Ablehnung ohne Blocker traegt keine Kennung`
		);
	}
	console.log(`${TRANSPORTE.length} Transporte reichen die Kennung an den Error durch ok`);

	// ── D) Die Statuszeile baut den Knopf nur mit Kennung ────────────────────────────────────────
	// Winziges DOM: die Zeile ist ein <p>, dem setDialogStatus den textContent setzt und an das
	// setDialogStatusWithBlockingLocation danach einen <button> haengt.
	function macheElement(tag) {
		return {
			tagName: tag,
			kinder: [],
			dataset: {},
			className: "",
			type: "",
			title: "",
			zuhoerer: {},
			_text: "",
			get textContent() { return this._text; },
			// textContent zu setzen raeumt in einem echten DOM alle Kinder weg -- genau darauf beruht,
			// dass eine neue Meldung den alten Knopf mitnimmt.
			set textContent(wert) { this._text = String(wert); this.kinder.length = 0; },
			appendChild(kind) { this.kinder.push(kind); this._text += kind.textContent; return kind; },
			addEventListener(art, fn) { this.zuhoerer[art] = fn; },
		};
	}

	const statusQuelle = cutDeclaration(REVIEW_STATUS_SOURCE, "review-status.js", "function setDialogStatus(", "\n}")
		+ "\n"
		+ cutDeclaration(REVIEW_STATUS_SOURCE, "review-status.js", "function setDialogStatusWithBlockingLocation(", "\n}");
	const gefolgt = [];
	const setDialogStatusWithBlockingLocation = new Function(
		"document",
		"focusLocationOnMapByPublicId",
		`${statusQuelle}\nreturn setDialogStatusWithBlockingLocation;`
	)({ createElement: macheElement }, (id) => gefolgt.push(id));

	const SATZ = 'Ein Ort namens "Hallen von Koschim" existiert bereits.';

	const mitVerweis = macheElement("p");
	setDialogStatusWithBlockingLocation(mitVerweis, SATZ, "error", { publicId: HALLEN_ID, name: "Hallen von Koschim" });
	assert.strictEqual(mitVerweis.kinder.length, 1, "mit Kennung gehoert genau ein Verweis in die Zeile");
	assert.strictEqual(mitVerweis.dataset.status, "error");
	// Der Satz bleibt Wort fuer Wort der des Servers -- der Knopf steht DANEBEN, nicht darin.
	assert.ok(mitVerweis.textContent.startsWith(SATZ), "der Meldungstext darf nicht angetastet werden");
	assert.ok(!SATZ.includes(mitVerweis.kinder[0].textContent), "die Beschriftung gehoert nicht in den Satz");
	mitVerweis.kinder[0].zuhoerer.click();
	assert.deepStrictEqual(gefolgt, [HALLEN_ID], "ein Klick muss genau den Blocker anspringen");

	const ohneVerweis = macheElement("p");
	setDialogStatusWithBlockingLocation(ohneVerweis, "Der Ortsname fehlt.", "error", null);
	assert.strictEqual(ohneVerweis.kinder.length, 0, "ohne Kennung bleibt die Zeile wie bisher");
	assert.strictEqual(ohneVerweis.textContent, "Der Ortsname fehlt.");

	// Eine Kennung ohne public_id ist KEINE Kennung -- sonst stuende dort ein Knopf ins Nichts.
	const leereKennung = macheElement("p");
	setDialogStatusWithBlockingLocation(leereKennung, SATZ, "error", { publicId: "", name: "Hallen von Koschim" });
	assert.strictEqual(leereKennung.kinder.length, 0, "eine leere Kennung baut keinen Knopf");

	// Die naechste Meldung nimmt den alten Verweis mit (textContent raeumt die Kinder weg).
	setDialogStatusWithBlockingLocation(mitVerweis, "Speichert…", "pending", null);
	assert.strictEqual(mitVerweis.kinder.length, 0, "eine neue Meldung darf keinen alten Verweis stehen lassen");
	console.log("Statuszeile baut den Verweis nur mit Kennung und laesst den Satz unberuehrt ok");

	console.log("ALL OK");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
