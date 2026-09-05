// Die Perf-Gerueche des Ueberwachungsmodus (Entwurf §9.1): je Geruch ein Treffer und ein Nicht-Treffer.
// Ein Geruch ist ein Paketvorschlag, kein Befund -- gemessen wird erst im Perf-Paket (Riegel D).
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/refactoring/__tests__/perf-gerueche.test.js

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
	const m = await import(pathToFileURL(path.join(__dirname, "..", "perf-gerueche.mjs")).href);

	const php = [
		"<?php",
		"function liesAlle(PDO $pdo, array $ids): array {",
		"\tforeach ($ids as $id) {",
		"\t\t$st = $pdo->prepare('SELECT 1');",
		"\t\t$st->execute([$id]);",
		"\t}",
		"\t$pdo->query('SHOW COLUMNS FROM x');",
		"\treturn [];",
		"}",
		"function avesmapsEnsureTabelle(PDO $pdo): void { $pdo->exec('CREATE TABLE IF NOT EXISTS t (id INT)'); }",
		"function einmal(PDO $pdo): void { $pdo->query('SELECT 2'); }",
		"function nachDerSchleife(PDO $pdo, array $ids): void {",
		"\tforeach ($ids as $id) { $x = $id; }",
		"\t$pdo->query('SELECT 3'); // NACH der Schleife -- kein Geruch",
		"}",
		"",
	].join("\n");
	const g = m.findePerfGerueche(php, "php");
	assert.deepStrictEqual(g.map((x) => [x.geruch, x.zeile]).sort(),
		[["abfrage-in-schleife", 4], ["abfrage-in-schleife", 5], ["ddl-in-funktion", 7]]);

	const js = [
		"function f() {",
		"\tfor (const el of els) { const w = getComputedStyle(el).width; }",
		"\tconst k = JSON.parse(JSON.stringify(o));",
		"\tconst einmal = document.querySelectorAll('.x');",
		"\tels.forEach((el) => { el.querySelectorAll('.y'); });",
		"}",
		"",
	].join("\n");
	assert.deepStrictEqual(m.findePerfGerueche(js, "js").map((x) => [x.geruch, x.zeile]).sort(),
		[["dom-abfrage-in-schleife", 2], ["dom-abfrage-in-schleife", 5], ["tiefe-kopie", 3]]);

	// Mutationsprobe: die Schleife weg -> die Abfrage ist keine mehr
	const ohne = php.replace("\tforeach ($ids as $id) {\n\t\t$st = $pdo->prepare('SELECT 1');\n\t\t$st->execute([$id]);\n\t}", "\t$st = $pdo->prepare('SELECT 1');");
	assert.ok(!m.findePerfGerueche(ohne, "php").some((x) => x.geruch === "abfrage-in-schleife"));

	console.log("perf-gerueche: ok");
})().catch((e) => { console.error(e); process.exit(1); });
