// Der Doppelungs-Scan des Ueberwachungsmodus (Entwurf §9.1): normalisierte Funktionsruempfe
// ueber Dateien hinweg. Umbenannt und kommentiert ist dieselbe Funktion; eine andere Rechnung nicht.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/refactoring/__tests__/doppelungen.test.js

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
	const m = await import(pathToFileURL(path.join(__dirname, "..", "doppelungen.mjs")).href);

	const a = "function summe(liste) {\n\t// addiert\n\tlet s = 0;\n\tfor (const x of liste) s += x;\n\treturn s;\n}";
	const b = "function total(items) {\n\tlet acc = 0;\n\tfor (const it of items) acc += it;\n\treturn acc;\n}";
	assert.strictEqual(m.normalisiereRumpf(a, "js"), m.normalisiereRumpf(b, "js"), "umbenannt und kommentiert ist dieselbe Funktion");
	const c = "function anders(l) {\n\tlet s = 1;\n\tfor (const x of l) s *= x;\n\treturn s;\n}";
	assert.notStrictEqual(m.normalisiereRumpf(a, "js"), m.normalisiereRumpf(c, "js"));
	// Schluesselwoerter bleiben Schluesselwoerter, Bezeichner werden $N in Reihenfolge des Auftretens
	assert.strictEqual(m.normalisiereRumpf("function f(a) { return a + b; }", "js"), "{ return $0 + $1; }");

	const texte = {
		"x.js": a + "\n" + "function klein() { return 1; }\n",
		"y.js": b + "\n",
		"z.js": c + "\n",
	};
	const d = m.findeDoppelungen(Object.keys(texte), (f) => texte[f], 3);
	assert.strictEqual(d.length, 1);
	assert.deepStrictEqual([d[0].a.name, d[0].b.name, d[0].gleichheit], ["summe", "total", 1]);

	// Mutationsprobe 1: dieselbe Datei zaehlt nicht
	assert.strictEqual(m.findeDoppelungen(["x.js"], () => a + "\n" + b + "\n", 3).length, 0);
	// Mutationsprobe 2: unter der Mindestzeilenzahl faellt das Paar weg
	assert.strictEqual(m.findeDoppelungen(Object.keys(texte), (f) => texte[f], 8).length, 0);

	// Naehe: eine Zeile mehr in einer sonst gleichen Funktion -> unter 1, aber ueber 0,9 bei genug Laenge
	const lang = (name, extra) => "function " + name + "(v) {\n" + Array.from({ length: 30 }, (_, i) => `\tconst k${i} = v[${i}] * 2 + 1;`).join("\n") + (extra ? "\n\tconst z = 0;" : "") + "\n\treturn v;\n}";
	const n = m.findeDoppelungen(["p.js", "q.js"], (f) => (f === "p.js" ? lang("eins", false) : lang("zwei", true)), 3);
	assert.strictEqual(n.length, 1);
	assert.ok(n[0].gleichheit >= 0.9 && n[0].gleichheit < 1, "gemessen " + n[0].gleichheit);

	// PHP: Ruempfe werden mit dem PHP-Scanner gelesen (# ist Kommentar)
	const p1 = "function a(array $l): int {\n\t# zaehlt\n\t$n = 0;\n\tforeach ($l as $x) { $n += $x; }\n\treturn $n;\n}";
	const p2 = "function b(array $q): int {\n\t$c = 0;\n\tforeach ($q as $y) { $c += $y; }\n\treturn $c;\n}";
	assert.strictEqual(m.normalisiereRumpf(p1, "php"), m.normalisiereRumpf(p2, "php"));

	console.log("doppelungen: ok");
})().catch((e) => { console.error(e); process.exit(1); });
