// Die Rangliste der Refactoring-Routine: Rangwert = Zeilen x Commits der letzten 180 Tage,
// dazu Alter in Tagen, Zahl der globalen Funktionen und die IIFE-Kennung (0 globale Funktionen
// in einer .js -> Closure-Modul, kein Ziel fuer den Schnitt). Port des Laufs vom 05.09.2026.
//
// Immer frisch rechnen, NIE auf Vorrat: eine wochenalte Liste kennt bei 64 % der Dateien die
// Abkuehlfrist falsch (Entwurf v1 §3.1). Produktivdateien = getrackte .js .php .css .html ohne
// third-party/, __tests__, test-*, tools/, docs/.
//
// Aufruf: node tools/refactoring/rangliste.mjs [--wurzel .] [--tage 180] [--abgekuehlt N] [--min-zeilen N]
// Ausgabe: JSON-Liste, sortiert nach rang absteigend.

import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import { findeFunktionen } from "./vorpruefung.mjs";

export function rangliste({ wurzel = ".", tage = 180, abgekuehlt = 0, minZeilen = 0, heute = new Date() } = {}) {
	const git = (...a) => childProcess.execFileSync("git", ["-C", wurzel, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
	const log = git("log", `--since=${tage} days ago`, "--date=short", "--pretty=format:@%ad", "--name-only");
	const commits = new Map(); const zuletzt = new Map(); let d = null;
	for (const z of log.split("\n")) {
		if (z.startsWith("@")) { d = z.slice(1); continue; }
		if (!z.trim()) continue;
		commits.set(z, (commits.get(z) || 0) + 1);
		if (!zuletzt.has(z)) zuletzt.set(z, d);
	}
	const aus = [];
	for (const f of git("ls-files").split("\n")) {
		if (!/\.(js|php|css|html)$/.test(f)) continue;
		if (/(^|\/)(third-party|__tests__|tools|docs)\//.test(f) || /(^|\/)test-[^/]*$/.test(f)) continue;
		if (!commits.has(f)) continue;
		let text; try { text = fs.readFileSync(path.join(wurzel, f), "utf8"); } catch { continue; }
		const zeilen = text.split("\n").length;
		const c = commits.get(f);
		const alterTage = Math.floor((heute - new Date(zuletzt.get(f))) / 86400000);
		const sprache = f.endsWith(".php") ? "php" : "js";
		const gf = /\.(js|php|html)$/.test(f) ? findeFunktionen(text, sprache).length : 0;
		const iife = f.endsWith(".js") && gf === 0;
		if (zeilen < minZeilen || alterTage < abgekuehlt) continue;
		aus.push({ datei: f, zeilen, commits: c, alterTage, rang: zeilen * c, globaleFunktionen: gf, iife });
	}
	return aus.sort((a, b) => b.rang - a.rang);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const a = process.argv; const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
	const liste = rangliste({ wurzel: opt("--wurzel", "."), tage: +opt("--tage", 180), abgekuehlt: +opt("--abgekuehlt", 0), minZeilen: +opt("--min-zeilen", 0) });
	process.stdout.write(JSON.stringify(liste, null, 1) + "\n");
}
