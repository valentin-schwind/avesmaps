// Der Knopf „📥 Dump holen" zeigt den letzten LAUF, nicht den Download.
//
// 💣 Zwei Zeitpunkte, und der Knopf zeigte den falschen. `last_ok_at` sagt, wann die DATEI
// geholt wurde; `last_read_run_at`, wann zuletzt ueber sie GELESEN wurde. Wer auf den Knopf
// sieht, fragt „ist mein Lauf durch?" -- und fand bis zum 15.08.2026 den Download-Zeitpunkt.
// Beide Zahlen stimmten (18:29 geholt, 19:56 gelesen), nur beantwortete die angezeigte die
// andere Frage; den Lauf kannte allein das Konflikte-Panel.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Nur die beiden reinen Formatierer aus der Datei ziehen -- der Rest braucht ein ganzes
// Editor-DOM und hat mit dieser Frage nichts zu tun.
const quelle = fs.readFileSync(path.join(__dirname, "..", "review-wiki-sync.js"), "utf8");
const schnipsel = ["formatWikiSyncDumpRunStatusText", "formatWikiSyncDumpFetchedStatusText"]
	.map((name) => {
		const start = quelle.indexOf(`function ${name}(`);
		assert.ok(start >= 0, `${name} nicht gefunden -- umbenannt?`);
		// bis zur schliessenden Klammer am Zeilenanfang
		const ende = quelle.indexOf("\n}", start);
		assert.ok(ende > start, `${name}: Ende nicht gefunden`);
		return quelle.slice(start, ende + 2);
	})
	.join("\n");
vm.runInThisContext(schnipsel, { filename: "review-wiki-sync.js (Auszug)" });

// ------------------------------------------------------------------ DER LAUF ---
assert.strictEqual(
	formatWikiSyncDumpRunStatusText({ last_read_run_at: "2026-08-15 19:56:03.000" }),
	"Lauf: 15.08.2026, 19:56",
	"der abgeschlossene Lauf wird als Datum+Uhrzeit gezeigt",
);

// ⭐ Ohne Lauf ein LEERER String -- der Aufrufer faellt dann auf den Download-Zeitpunkt zurueck.
// „gar keine Angabe" waere schlechter als die zweitbeste.
assert.strictEqual(formatWikiSyncDumpRunStatusText({}), "");
assert.strictEqual(formatWikiSyncDumpRunStatusText({ last_read_run_at: null }), "");
assert.strictEqual(formatWikiSyncDumpRunStatusText({ last_read_run_at: "" }), "");
assert.strictEqual(formatWikiSyncDumpRunStatusText(null), "");

// Ein unparsbarer Wert wird ROH gezeigt, nicht verschluckt: eine sichtbare Merkwuerdigkeit
// ist besser als eine stille Leerstelle (dieselbe Regel wie in der Nachbarzeile).
assert.strictEqual(formatWikiSyncDumpRunStatusText({ last_read_run_at: "kaputt" }), "Lauf: kaputt");

// ------------------------------------------------- UND DER DOWNLOAD BLEIBT, WAS ER WAR ---
// ⚠️ Die Nachbarfunktion wird NICHT umgebaut: sie sagt weiterhin „Dump geholt", und das ist
// richtig -- sie beschreibt die Datei. Falsch war nur, sie als Antwort auf die Lauf-Frage
// hinzustellen.
assert.strictEqual(
	formatWikiSyncDumpFetchedStatusText({ last_ok_at: "2026-08-15 18:29:00.000" }),
	"Dump geholt: 15.08.2026, 18:29",
);
assert.strictEqual(formatWikiSyncDumpFetchedStatusText({ present: true }), "Dump geholt: unbekannt");
assert.strictEqual(formatWikiSyncDumpFetchedStatusText({}), "Noch kein Dump geholt");

// 💣 Die beiden duerfen nie dasselbe sagen -- sonst ist der eine ueberfluessig und irgendwann
// erklaert jemand den anderen fuer redundant.
const status = { last_ok_at: "2026-08-15 18:29:00.000", last_read_run_at: "2026-08-15 19:56:03.000" };
assert.notStrictEqual(
	formatWikiSyncDumpRunStatusText(status),
	formatWikiSyncDumpFetchedStatusText(status),
	"zwei Zeitpunkte, zwei Aussagen",
);

console.log("dump-button-run-date: alle Faelle ok");
