// Die Perf-Gerueche des Ueberwachungsmodus (Entwurf §9.1) -- vier Muster, jedes mit Zeile:
//   abfrage-in-schleife      PHP: ->query( / ->prepare( / ->execute( / ->exec( im Rumpf einer Schleife
//   ddl-in-funktion          PHP: CREATE TABLE / ALTER TABLE / SHOW COLUMNS / SHOW INDEX in einer Funktion,
//                            deren Name nicht „ensure" enthaelt (die Ensure-Helfer des Hauses sind gewollt)
//   dom-abfrage-in-schleife  JS: querySelectorAll( / getComputedStyle( im Rumpf einer Schleife
//   tiefe-kopie              JS: JSON.parse(JSON.stringify(
//
// 🔴 Ein Geruch ist ein PAKETVORSCHLAG, kein Befund und keine Messung. Vor dem Anlegen gegen
// AGENTS.md §10/§11 halten: was dort als erledigt steht (DDL-Riegel avesmapsSchemaEnsureOnce,
// Derived-N+1, Delta-Abruf), ist kein Paket. Gemessen wird erst im Paket (Riegel D).
//
// Aufruf: node tools/refactoring/perf-gerueche.mjs [--wurzel .]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findeFunktionen, codeMaske, alleDateien } from "./vorpruefung.mjs";

const SCHLEIFE = /(^|[^\w$.])(foreach|for|while)\s*\(|\.forEach\s*\(|\.map\s*\(/;

// Zeilen, die im Rumpf einer Schleife liegen: Klammertiefe ab der Schleifenzeile verfolgen.
// Eine einzeilige Schleife (`foreach (...) { ... }` auf EINER Zeile) zaehlt selbst als „drin".
function schleifenZeilen(text, sprache) {
	const maske = codeMaske(text, sprache);
	const zeilen = text.split("\n");
	const drin = new Set();
	let offset = 0; let tiefe = 0;
	const stapel = []; // Tiefen, bei denen eine Schleife begann
	zeilen.forEach((z, idx) => {
		const startetSchleife = SCHLEIFE.test(z);
		if (startetSchleife) stapel.push(tiefe);
		let rumpfAufDieserZeile = false; // die Zeile war irgendwann in einem Schleifenrumpf (auch einzeilig)
		for (let i = 0; i < z.length; i++) {
			if (maske[offset + i] !== 1) continue;
			if (z[i] === "{") { tiefe++; if (stapel.length) rumpfAufDieserZeile = true; }
			else if (z[i] === "}") { tiefe--; while (stapel.length && tiefe <= stapel[stapel.length - 1]) stapel.pop(); }
		}
		if ((stapel.length && !startetSchleife) || rumpfAufDieserZeile) drin.add(idx + 1);
		offset += z.length + 1;
	});
	return drin;
}

// Steht die Abfrage im RUMPF der Schleife oder in ihrem KOPF (`foreach ($pdo->query(...) as $row)`)?
// Auf einer Zeile, die eine Schleife beginnt, zaehlt nur, was hinter der ersten { steht.
function imRumpfDerZeile(z, muster) {
	const m = z.match(muster);
	if (!m) return false;
	if (!SCHLEIFE.test(z)) return true;
	const klammer = z.indexOf("{");
	return klammer >= 0 && m.index > klammer;
}

export function findePerfGerueche(text, sprache) {
	const aus = [];
	const zeilen = text.split("\n");
	const drin = schleifenZeilen(text, sprache);
	const fns = findeFunktionen(text, sprache);
	zeilen.forEach((z, idx) => {
		const nr = idx + 1;
		if (sprache === "php") {
			if (drin.has(nr) && imRumpfDerZeile(z, /->(query|prepare|execute|exec)\s*\(/)) aus.push({ geruch: "abfrage-in-schleife", zeile: nr, text: z.trim() });
			if (/CREATE TABLE|ALTER TABLE|SHOW COLUMNS|SHOW INDEX/i.test(z)) {
				const f = fns.find((x) => nr >= x.von && nr <= x.bis);
				if (f && !/ensure/i.test(f.name)) aus.push({ geruch: "ddl-in-funktion", zeile: nr, text: z.trim() });
			}
		} else {
			if (drin.has(nr) && imRumpfDerZeile(z, /querySelectorAll\s*\(|getComputedStyle\s*\(/)) aus.push({ geruch: "dom-abfrage-in-schleife", zeile: nr, text: z.trim() });
			if (/JSON\.parse\(\s*JSON\.stringify\(/.test(z)) aus.push({ geruch: "tiefe-kopie", zeile: nr, text: z.trim() });
		}
	});
	return aus;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const i = process.argv.indexOf("--wurzel"); const wurzel = i >= 0 ? process.argv[i + 1] : ".";
	const aus = [];
	for (const f of alleDateien(wurzel, ["js", "api"], [".js", ".php"]).filter((x) => !/__tests__|(^|\/)test-/.test(x))) {
		const g = findePerfGerueche(fs.readFileSync(path.join(wurzel, f), "utf8"), f.endsWith(".php") ? "php" : "js");
		for (const x of g) aus.push({ datei: f, ...x });
	}
	process.stdout.write(JSON.stringify(aus, null, 1) + "\n");
}
