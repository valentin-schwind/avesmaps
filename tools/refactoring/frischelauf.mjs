// Der Frischelauf der Routine: jedes offene Paket gegen origin/master (Entwurf
// docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md §4).
//
// 🔴 Ein Paket gilt nicht, weil es in der Liste steht, sondern weil es HEUTE nachgeprueft wurde.
// Verglichen wird der Blob-Hash der Zieldatei (`git rev-parse origin/master:<pfad>`) mit dem im
// Paket. Gleich -> gilt. Anders -> ueberholt: die Vorpruefung laeuft fuer die Datei neu, mit den
// Blockgrenzen aus dem Block-Feld (erster und letzter Funktionsname), damit die Routine nachziehen
// oder verwerfen kann. Datei weg -> datei-weg.
//
// ⚠️ Die CLI liest die Datei fuer die Vorpruefung aus dem ARBEITSBAUM, vergleicht aber gegen
// origin/master. Die Routine ruft sie deshalb im Wegwerf-Worktree, der auf origin/master steht --
// dort ist beides dasselbe. Im geteilten Checkout kann der Baum aelter oder fremd geaendert sein.
//
// Aufruf: node tools/refactoring/frischelauf.mjs [--wurzel .]

import path from "node:path";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import { ladeArbeitspakete } from "./arbeitspakete.mjs";
import { vorpruefung } from "./vorpruefung.mjs";

const OFFEN = new Set(["offen", "GO nötig", "in Arbeit"]);

// liesBlob(datei) -> Blob-Hash auf origin/master oder null (Datei weg). Wird nur fuer offene
// Pakete gefragt -- ein git-Aufruf je Paket, Sekunden fuer die ganze Liste.
export function pruefeFrische(pakete, liesBlob) {
	return pakete.map((p) => {
		if (!OFFEN.has(p.status)) return { id: p.id, datei: p.datei, ergebnis: "nicht-offen", blobJetzt: null };
		const jetzt = liesBlob(p.datei);
		if (jetzt === null) return { id: p.id, datei: p.datei, ergebnis: "datei-weg", blobJetzt: null };
		return { id: p.id, datei: p.datei, ergebnis: jetzt === p.blob ? "gilt" : "überholt", blobJetzt: jetzt };
	});
}

// „<Thema>“ — <erster> … <letzter> (...)  ->  { von, bis }
export function blockGrenzen(blockFeld) {
	const m = String(blockFeld || "").match(/—\s*([A-Za-z_$][\w$]*)\s*…\s*([A-Za-z_$][\w$]*)/);
	return m ? { von: m[1], bis: m[2] } : null;
}

export function blobAufOrigin(wurzel, datei) {
	try {
		return childProcess.execFileSync("git", ["-C", wurzel, "rev-parse", "origin/master:" + datei], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch { return null; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const i = process.argv.indexOf("--wurzel");
	const wurzel = i >= 0 ? process.argv[i + 1] : ".";
	const { sperre, pakete } = ladeArbeitspakete(wurzel);
	const erg = pruefeFrische(pakete, (d) => blobAufOrigin(wurzel, d));
	for (const e of erg) {
		if (e.ergebnis !== "überholt") continue;
		const p = pakete.find((x) => x.id === e.id);
		const g = blockGrenzen(p.block);
		try { e.vorpruefung = vorpruefung({ datei: p.datei, wurzel, von: g?.von ?? null, bis: g?.bis ?? null }); }
		catch (err) { e.vorpruefung = { fehler: String(err.message) }; }
	}
	process.stdout.write(JSON.stringify({ sperre, pakete: erg }, null, 2) + "\n");
}
