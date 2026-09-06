const assert = require("assert");

// ===== DIE REGEL =====
// „Zuweisen" war beim ANLEGEN gesperrt: die Zuweisung schreibt serverseitig an eine public_id, und
// die gibt es vor dem Speichern nicht. Die AUSWAHL braucht aber keine -- nur das Schreiben.
// Im Anlege-Fall merkt sich der Dialog die gewählte Siedlung deshalb lokal (liest sie read-only per
// ?action=preview) und füllt das versteckte wiki_url-Feld. Verbunden wird danach vom Auto-Connect,
// der nach create_point ohnehin läuft (review-editor-submit.js).
//
// 💣 Es darf dabei NICHTS geschrieben werden -- ein assign_to ohne public_id wirft serverseitig
// („title/public_id fehlt"), und ein halb entsperrter Knopf, der die Auswahl dann verweigert, ist
// schlechter als ein gesperrter.

const fields = new Map();
function putField(id, value) {
	const element = { value, textContent: "", innerHTML: "", hidden: false, disabled: false, focus() {} };
	fields.set(id, element);
	return element;
}

global.document = {
	addEventListener() {},
	getElementById(id) {
		return fields.get(id) || null;
	},
	createElement() {
		return {
			set textContent(value) { this._text = String(value); },
			get textContent() { return this._text || ""; },
			get innerHTML() { return String(this._text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"); },
		};
	},
};
global.window = {};
global.showFeedbackToast = () => {};
global.apiErrorMessage = (_response, fallback) => fallback;
global.locationEditPendingWikiSettlement = null;

// ANLEGEN: es gibt noch keinen Marker und damit keine public_id.
global.locationEditMarkerEntry = null;

const PREVIEW_URL = "https://de.wiki-aventurica.de/wiki/Gareth";
const requests = [];
// 🔴 STEUERBAR, weil der Server seit dem 07.09.2026 sagen kann, dass seine Antwort aus dem
// Zwischenspeicher stammt: war der Drosselplatz des Wikis belegt, nimmt er die zuletzt geholte
// Infobox statt abzusagen (`aus_vorrat`, api/_internal/wiki/settlements.php).
let antwortAusVorrat = false;
global.fetch = (url, options) => {
	requests.push({ url: String(url), method: (options && options.method) || "GET" });
	return Promise.resolve({
		json: () => Promise.resolve({
			ok: true,
			settlement: { title: "Gareth", name: "Gareth", wiki_url: PREVIEW_URL },
			wiki_name: "Gareth",
			aus_vorrat: antwortAusVorrat,
		}),
	});
};

// Was der Editor wirklich liest -- der Spion ersetzt die leere Attrappe von oben.
const toasts = [];
global.showFeedbackToast = (text, art) => {
	toasts.push({ text: String(text), art: String(art) });
};

// Seit dem 16.08.2026 (Aufgabe 5 der Wiki-Zuweisung) steuert review-settlement-wiki.js nur noch den
// DATENWEG bei; Rumpf, Antwortpruefung und Treffer-Anreicherung liefert der geteilte reine Baustein
// js/ui/wiki-assign-ort.js. Im Browser legen die <script>-Zeilen diese Namen als Globale an -- in
// Node muessen sie von Hand gesetzt werden.
const ort = require("../../ui/wiki-assign-ort.js");
global.avesmapsWikiAssignOrtZuweisungsKoerper = ort.avesmapsWikiAssignOrtZuweisungsKoerper;
global.avesmapsWikiAssignOrtAntwortPruefen = ort.avesmapsWikiAssignOrtAntwortPruefen;
global.avesmapsWikiAssignOrtTrefferAnreichern = ort.avesmapsWikiAssignOrtTrefferAnreichern;

const { selectSettlementWikiResult, removeSettlementWiki } = require("../review-settlement-wiki.js");

(async () => {
	putField("location-edit-wiki-url", "");
	putField("settlement-wiki-picker-status", "");
	putField("settlement-wiki-reference-list", "");
	putField("settlement-wiki-assign", "");
	putField("settlement-wiki-remove", "");
	putField("settlement-wiki-picker", "");

	await selectSettlementWikiResult("Gareth");

	// 1) Kein Schreibzugriff.
	const writes = requests.filter((r) => r.method === "POST");
	assert.strictEqual(writes.length, 0, "beim Anlegen darf nichts geschrieben werden (kein assign_to)");
	assert.ok(
		requests.some((r) => r.url.includes("action=preview") && r.url.includes("Gareth")),
		"die Siedlung wird read-only per preview gelesen"
	);

	// 2) Die Wahl ist gemerkt und trägt alles, was der Auto-Connect danach braucht.
	assert.ok(global.locationEditPendingWikiSettlement, "die Auswahl wird gemerkt");
	assert.strictEqual(global.locationEditPendingWikiSettlement.title, "Gareth");
	assert.strictEqual(global.locationEditPendingWikiSettlement.wiki_url, PREVIEW_URL);

	// 3) Das versteckte Feld ist der Träger: daran hängt autoConnectSettlementWikiByUrl.
	assert.strictEqual(
		fields.get("location-edit-wiki-url").value,
		PREVIEW_URL,
		"ohne die wiki_url im Formular verbindet der Auto-Connect nach dem Anlegen nichts"
	);

	// 4) Zurücknehmen muss auch ohne public_id gehen -- sonst klebt die Wahl bis zum Speichern fest.
	await removeSettlementWiki();
	assert.strictEqual(global.locationEditPendingWikiSettlement, null, "Entfernen löscht die gemerkte Wahl");
	assert.strictEqual(fields.get("location-edit-wiki-url").value, "", "und leert das versteckte Feld");
	assert.strictEqual(
		requests.filter((r) => r.method === "POST").length,
		0,
		"auch das Zurücknehmen schreibt beim Anlegen nichts"
	);

	// 5) DER ZWISCHENSPEICHER WIRD BENANNT -- ausgefuehrt, nicht als Zeichenkette geprueft.
	// 💣 Diese Zusicherung gibt es, weil die erste Fassung des Satzes `data?.aus_vorrat` LAS, und
	// `data` steht mit `const` im try-Block darueber: ein ReferenceError im Erfolgsfall, den kein
	// Quelltext-Test gesehen haette. Dieselbe Klasse wie der Ausfall vom 03.09.2026, bei dem zwei
	// gruene Tests einen fehlenden Geltungsbereich uebersahen -- gefunden hat ihn dort erst die
	// Konsole der Live-Seite.
	toasts.length = 0;
	antwortAusVorrat = true;
	await selectSettlementWikiResult("Gareth");
	assert.ok(toasts.length > 0, "der Anlege-Fall meldet sich ueberhaupt");
	assert.ok(
		toasts.some((t) => t.text.includes("Zwischenspeicher")),
		"eine Vorschau aus dem Zwischenspeicher sagt es: " + JSON.stringify(toasts)
	);

	// 6) Und der BEARBEITEN-Fall genauso -- dort wird wirklich geschrieben, also wiegt es schwerer.
	// ⚠️ Ab hier gibt es einen Marker, damit `selectSettlementWikiResult` den assign_to-Zweig nimmt.
	toasts.length = 0;
	global.locationEditMarkerEntry = { publicId: "abc-123", location: {} };
	global.refreshLocationMarkerPopup = () => {};
	await selectSettlementWikiResult("Gareth", {});
	assert.ok(
		requests.some((r) => r.method === "POST"),
		"der Bearbeiten-Fall schreibt (assign_to)"
	);
	assert.ok(
		toasts.some((t) => t.text.includes("Zwischenspeicher") && t.art === "info"),
		"eine Zuweisung aus dem Zwischenspeicher sagt es, und zwar als Hinweis statt als Erfolg: "
			+ JSON.stringify(toasts)
	);

	// 7) Der Normalfall bleibt der Normalfall -- sonst stuende der Hinweis an jeder Zuweisung.
	toasts.length = 0;
	antwortAusVorrat = false;
	await selectSettlementWikiResult("Gareth", {});
	assert.ok(
		toasts.some((t) => t.art === "success" && !t.text.includes("Zwischenspeicher")),
		"eine frische Zuweisung meldet schlicht Erfolg: " + JSON.stringify(toasts)
	);

	console.log("OK - Zuweisen beim Anlegen merkt sich die Auswahl, ohne zu schreiben");
	console.log("OK - und eine Antwort aus dem Zwischenspeicher wird in beiden Faellen benannt");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
