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
global.fetch = (url, options) => {
	requests.push({ url: String(url), method: (options && options.method) || "GET" });
	return Promise.resolve({
		json: () => Promise.resolve({
			ok: true,
			settlement: { title: "Gareth", name: "Gareth", wiki_url: PREVIEW_URL },
		}),
	});
};

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

	console.log("OK - Zuweisen beim Anlegen merkt sich die Auswahl, ohne zu schreiben");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
