// 🔴 Die Übernahme-Vorschau geht nach JEDEM Abgleich auf — auch wenn nichts anders ist.
//
// Owner-Entscheid 2026-08-07. Bis dahin galt das Gegenteil, und zwar an vier von fünf Aufrufstellen:
// „ein leeres Blatt nach zehn Minuten Arbeit ist Lärm". Der Denkfehler darin: wer einen Abgleich
// anstößt, fragt nicht „gibt es Arbeit", sondern „hat sich etwas getan" — und ein Fenster, das mal
// kommt und mal nicht, beantwortet weder das eine noch das andere. Das leere Blatt sagt es jetzt
// selbst (syncPlanVerdict, geprüft in sync-plan-sheet.test.js).
//
// 💣 WARUM ALS QUELLTEXT-PRÜFUNG: diese fünf Aufrufe stehen in vier Dateien, die alle ein `document`,
// ein `window.parent` und einen angemeldeten Editor brauchen — sie sind vor dem Deploy an keiner
// anderen Stelle beweisbar. Und es ist genau die Sorte Regel, die beim nächsten „ich mach das hier
// mal wieder zu" lautlos zurückfällt: es sieht wie eine Aufräumung aus.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/sync-plan-always-opens.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

// Kommentare raus, BEVOR gezählt wird: diese Datei hier nennt die alte Bedingung selbst mehrfach, und
// die Begründungen im Code tun es auch. Sonst zertifiziert der Test die Doku statt des Codes.
function code(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !/^\s*(\/\/|<!--)/.test(line))
		.join("\n");
}

/**
 * Jede `if`-Bedingung mit ihrem Text und der Stelle dahinter. Klammern werden ausgezählt, weil eine
 * echte Bedingung dieser Dateien selbst welche enthält: `if (Number(result.run_id || 0) > 0 && …)`.
 * Ein `[^)]*`-Ausdruck bricht dort mitten drin ab und prüft danach die falsche Zeichenkette.
 */
function ifConditions(body) {
	const found = [];
	const opener = /\bif\s*\(/g;
	let match = opener.exec(body);
	while (match !== null) {
		let depth = 1;
		let i = match.index + match[0].length;
		while (i < body.length && depth > 0) {
			if (body[i] === "(") depth += 1;
			else if (body[i] === ")") depth -= 1;
			i += 1;
		}
		found.push({ text: body.slice(match.index + match[0].length, i - 1), end: i });
		match = opener.exec(body);
	}

	return found;
}

const CALLERS = [
	{ file: ["js", "review", "review-wiki-sync.js"], calls: 3, what: "Quellen, Literatur, Vorkommen" },
	{ file: ["html", "citymap-editor.html"], calls: 2, what: "Karten-Editor: nach dem Lauf und über die Statuszeile" },
	{ file: ["html", "game-literature-editor.html"], calls: 2, what: "Literatur-Editor: dito" },
];

CALLERS.forEach((caller) => {
	const body = code(read(...caller.file));
	const name = caller.file.join("/");

	const opens = body.match(/openSyncPlanSheet\(\{/g) || [];
	assert.strictEqual(opens.length, caller.calls,
		`${name}: ${caller.calls} Aufrufe erwartet (${caller.what}), ${opens.length} gefunden — kam einer `
		+ "dazu, gehört er in diese Tabelle und unter dieselbe Regel");

	// 🔴 DIE REGEL. Kein Aufruf darf hinter einer BEDINGUNG stehen, die die Zahl der Unterschiede
	// prüft. `run_id > 0` ist ausdrücklich erlaubt und etwas anderes: keine Lauf-Nummer heißt, dass
	// die Rechen-Hälfte gar nicht fertig wurde — dann gibt es nichts zu zeigen.
	//
	// ⚠️ Nur `if`-Bedingungen, mit ausgezählten Klammern. Der naheliegende „steht die Zahl in den drei
	// Zeilen davor"-Test schlägt sofort falsch an: direkt über jedem Aufruf steht der Statussatz
	// („12 Unterschiede — Vorschau offen" : „Keine Unterschiede …"), und der DARF die Zahl prüfen. Nur
	// das Öffnen darf nicht daran hängen.
	ifConditions(body).forEach((condition) => {
		if (!/\b(?:total|differences|counts\.total)\s*>\s*0/i.test(condition.text)) {
			return;
		}
		assert.ok(!/openSyncPlanSheet/.test(body.slice(condition.end, condition.end + 400)),
			`${name}: die Bedingung „${condition.text.trim().replace(/\s+/g, " ")}" steht als Riegel vor `
			+ "einem openSyncPlanSheet. Die Vorschau kommt seit 2026-08-07 IMMER; für den Statussatz darf "
			+ "die Zahl geprüft werden, für das Öffnen nicht.");
	});
});

// ⚠️ Der Territorien-Monitor ist ausgenommen und war es immer: dort ist „Vorschau öffnen" ein eigener
// Knopf, kein Nachspiel eines Laufs. Er darf gar nicht erst in der Tabelle stehen — steht er doch
// einmal drin, ist diese Zeile der Hinweis, warum das falsch wäre.
const monitor = code(read("html", "wiki-sync-monitor.html"));
assert.ok(/openSyncPlanSheet/.test(monitor), "der Monitor ruft das Blatt (unverändert, ungeprüft)");

console.log("sync-plan-always-opens ok");
