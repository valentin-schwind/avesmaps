// Das Bauteil der Übernahme-Vorschau: was vorangehäkelt ankommt, was die Fußzeile rechnet, und wann
// der Löschriegel zumacht. Entwurf: docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox OHNE DOM — das ist beides Absicht: ein Stub
// zertifizierte den Stub, und eine Datei, die beim Laden schon ein `document` braucht, lässt sich
// nicht prüfen, bevor sie im Browser steht.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/sync-plan-sheet.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(ROOT, "js", "review", "sync-plan-sheet.js"), "utf8");

const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "sync-plan-sheet.js" });

const footer = sandbox.syncPlanFooterState;
const markup = sandbox.syncPlanSheetMarkup;
const fieldLabel = sandbox.syncPlanFieldLabel;
assert.strictEqual(typeof footer, "function", "die echten Funktionen sind geladen");
assert.strictEqual(typeof markup, "function");
assert.strictEqual(typeof fieldLabel, "function");

// ---- Die Fußzeile ------------------------------------------------------------------------------

assert.strictEqual(footer({ selected: 42, deletions: 0, confirmed: false }).applyDisabled, false);
assert.strictEqual(footer({ selected: 0, deletions: 0, confirmed: false }).applyDisabled, true,
	"ohne ein einziges Häkchen gibt es nichts zu übernehmen");

// 🔴 DER RIEGEL. Solange eine Löschung angehäkelt und nicht bestätigt ist, geht GAR NICHTS — auch die
// harmlosen Übernahmen nicht. Sonst wäre die zweite Bestätigung eine Empfehlung, die man umgeht,
// indem man erst den Rest übernimmt.
assert.strictEqual(footer({ selected: 43, deletions: 1, confirmed: false }).applyDisabled, true);
assert.strictEqual(footer({ selected: 43, deletions: 1, confirmed: true }).applyDisabled, false);
assert.strictEqual(footer({ selected: 43, deletions: 1, confirmed: false }).gateVisible, true);
assert.strictEqual(footer({ selected: 43, deletions: 0, confirmed: false }).gateVisible, false,
	"ohne angehäkelte Löschung erscheint die zweite Bestätigung gar nicht");

// Der Knopf sagt, was er tut — „Übernehmen" allein verschweigt die Löschungen.
assert.strictEqual(footer({ selected: 43, deletions: 2, confirmed: true }).applyLabel, "Übernehmen und 2 löschen");
assert.strictEqual(footer({ selected: 43, deletions: 0, confirmed: true }).applyLabel, "Übernehmen");

// Ein/Mehrzahl, und das Wort gehört zur Art des Abgleichs (bei den Vorkommen sind es „Zuordnungen").
assert.ok(footer({ selected: 1, deletions: 1, kind: "citymap" }).gateText.includes("1 Karte wirklich"));
assert.ok(footer({ selected: 3, deletions: 3, kind: "citymap" }).gateText.includes("3 Karten wirklich"));

// 💣 Die ausgeblendeten Zeilen zählen MIT. Sie stehen mit ihrem Häkchen in der Datenbank, „alle
// übernehmen" erreicht sie also — behauptete die Fußzeile „200 von 5.012", wäre das schlicht falsch.
assert.strictEqual(footer({ selected: 200, hidden: 4812, deletions: 0 }).selectedTotal, 5012);

// ---- Die Feldnamen -----------------------------------------------------------------------------
//
// Ein roher Spaltenname in der Vorschau ist keine Antwort: „has_scale → 1" sagt niemandem etwas.
["title", "map_url", "art", "is_color", "is_labeled", "format", "has_scale", "author", "publisher",
	"note", "place", "source", "links"].forEach((field) => {
	const label = fieldLabel(field);
	assert.notStrictEqual(label, field, `${field} hat eine deutsche Beschriftung`);
	assert.ok(label.length > 0, `${field} ist nicht leer beschriftet`);
});
// Ein unbekanntes Feld wird durchgereicht statt verschluckt — sichtbar ist besser als verschwunden.
assert.strictEqual(fieldLabel("wurstsalat"), "wurstsalat");

// ---- Das Markup --------------------------------------------------------------------------------

function planWith(overrides) {
	return Object.assign({
		kind: "citymap",
		run: {
			id: 7,
			state: "open",
			created_at: "2026-08-06 21:14:00",
			source_stamp: "2026-08-06 20:02:11",
			counts: { new: 1, changed: 1, deleted: 1, total: 3 },
		},
		items: {
			new: [{ id: 1, entity_key: "k1", change_type: "new", label: "Elenvina – Werftviertel",
				before: {}, after: { title: "Elenvina – Werftviertel", art: "stadtplan" }, override: {},
				selected: true, skipped_count: 0, last_skipped_at: "" }],
			changed: [{ id: 2, entity_key: "k2", change_type: "changed", label: "Havena – Hafenviertel",
				before: { title: "Havena, Hafen" }, after: { title: "Havena – Hafenviertel" }, override: {},
				selected: true, skipped_count: 0, last_skipped_at: "" }],
			deleted: [{ id: 3, entity_key: "k3", change_type: "deleted", label: "Punin – Altstadt",
				before: { place_count: 4, link_count: 1, related_count: 0, source_count: 2 }, after: {},
				override: {}, selected: false, skipped_count: 0, last_skipped_at: "" }],
		},
		truncated: { new: 0, changed: 0, deleted: 0 },
		declined_count: 0,
	}, overrides || {});
}

const html = markup(planWith());
assert.ok(html.includes("Elenvina – Werftviertel") && html.includes("Punin – Altstadt"), "alle drei Gruppen stehen drin");
assert.ok(html.includes("<details"), "die Gruppen sind <details> — Strg+F findet Text auch zugeklappt");
assert.ok(html.includes("grp--del"), "die Löschgruppe ist als solche gekennzeichnet");
// Vorangehäkelt: Neu und Geändert ja, Gelöscht nie.
const deletedRow = html.slice(html.indexOf("Punin – Altstadt") - 400, html.indexOf("Punin – Altstadt"));
assert.ok(!deletedRow.includes("checked"), "🔴 keine Löschzeile kommt angehäkelt an");
// Was mit der Karte ginge, steht an der Zeile — sonst ist „löschen" eine Zahl ohne Gewicht.
assert.ok(html.includes("4 Fundorte"), "die Löschzeile nennt, was mitginge");

// 🔴 KEIN „alle" ÜBER DEN LÖSCHUNGEN. Bei 168 neuen Zeilen ist Einzelklicken keine Bedienung; bei
// Löschungen ist es genau der Punkt. Ein Knopf, der 37 auf einmal anhäkelt, macht die zweite
// Bestätigung zur einzigen Hürde und die erste zur Formsache.
const delGroup = html.slice(html.indexOf('class="grp grp--del"'));
assert.ok(!delGroup.slice(0, delGroup.indexOf("</summary>")).includes("data-bulk"),
	"die Löschgruppe hat keine Sammelknöpfe");
assert.ok(html.slice(0, html.indexOf('class="grp grp--del"')).includes("data-bulk"),
	"Neu und Geändert haben sie sehr wohl");

// ⚠️ Eine NEUE Karte beschreibt sich, sie vergleicht nicht: „Titel — → Elenvina" behauptet ein
// Vorher, das es nie gab, und füllt die Zeile mit Gedankenstrichen.
const newRow = html.slice(html.indexOf("Elenvina"), html.indexOf("Havena"));
assert.ok(!newRow.includes('class="old"'), "eine neue Zeile zeigt kein durchgestrichenes Vorher");
assert.ok(newRow.includes("Titel: Elenvina"), "sondern schlicht, was ankommt");

// Ein einzelner Fundort „gehen" nicht — diese Zeile wird gelesen, wenn Sorgfalt zählt.
const one = planWith();
one.items.deleted[0].before = { place_count: 1, link_count: 0, related_count: 0, source_count: 0 };
assert.ok(markup(one).includes("Mit ihr verschwindet 1 Fundort"), "Einzahl im Verb");
assert.ok(html.includes("Mit ihr verschwinden 4 Fundorte"), "und Mehrzahl sonst");

// 💣 Escaping. Ein Kartentitel ist Wiki-Text, kein Vertrauensbeweis — und diese Vorschau zeigt genau
// die Zeichenketten, die ein Fremder ins Wiki geschrieben hat.
const evil = planWith();
evil.items.new[0].label = '<img src=x onerror="alert(1)">';
evil.items.changed[0].after.title = '"><script>alert(2)</script>';
const evilHtml = markup(evil);
assert.ok(!evilHtml.includes("<img src=x"), "der Titel wird escaped");
assert.ok(!evilHtml.includes("<script>alert(2)"), "auch ein Wert im Unterschied wird escaped");
assert.ok(evilHtml.includes("&lt;img"), "und er ist noch da, nur unschädlich");

// Die gekürzte Liste sagt, dass sie gekürzt ist — schweigend abschneiden liest sich wie Vollständigkeit.
const short = planWith();
short.run.counts = { new: 5012, changed: 1, deleted: 1, total: 5014 };
short.truncated = { new: 4812, changed: 0, deleted: 0 };
const shortHtml = markup(short);
assert.ok(shortHtml.includes("4.812") || shortHtml.includes("4812"), "die Restzahl steht da");

// Ein leerer Plan ist kein Fehler, sondern die beste Nachricht des Tages.
const emptyHtml = markup(planWith({
	run: { id: 8, state: "open", created_at: "", source_stamp: "", counts: { new: 0, changed: 0, deleted: 0, total: 0 } },
	items: { new: [], changed: [], deleted: [] },
}));
assert.ok(emptyHtml.length > 0 && !emptyHtml.includes("undefined"), "leerer Plan rendert ohne undefined");

// ---- Der übersprungene Eintrag -----------------------------------------------------------------
//
// „⤴ 3× übersprungen" ist ein Zustand, keine Warnung: dass etwas liegenbleibt, ist erlaubt.
const skipped = planWith();
skipped.items.changed[0].skipped_count = 3;
skipped.items.changed[0].last_skipped_at = "2026-07-28 10:00:00";
skipped.items.changed[0].selected = false;
const skippedHtml = markup(skipped);
assert.ok(skippedHtml.includes("3×") || skippedHtml.includes("3&times;"), "die Zahl der Übersprünge steht an der Zeile");
assert.ok(skippedHtml.includes("28.07."), "und wann zuletzt");

console.log("sync-plan-sheet ok");
