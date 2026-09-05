// Der Doppelungs-Scan des Ueberwachungsmodus (Entwurf §9.1): normalisierte Funktionsruempfe
// ueber Dateien hinweg -- Kommentare raus, Whitespace auf ein Leerzeichen, jeder Bezeichner
// (ausser Schluesselwoertern) auf $N in Reihenfolge des ersten Auftretens. Gleiche Ruempfe in
// VERSCHIEDENEN Dateien sind Kandidaten (gleichheit 1); nahe (Jaccard ueber 3-Gramme >= 0,9) auch.
//
// 🔴 Ein Fund ist KEIN Paket. Zwei Fassungen derselben Funktion unterscheiden sich fast immer in
// einem Detail, das jemand absichtlich gebaut hat -- das Paket entsteht erst nach dem
// Historiker-Lauf (Entwurf §9.3: Unterschied · Warum · Empfehlung · Beleg) und steht auf GO noetig.
//
// Aufruf: node tools/refactoring/doppelungen.mjs [--wurzel .] [--min 8]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findeFunktionen, codeMaske, alleDateien } from "./vorpruefung.mjs";

const SCHLUESSEL = new Set(("function return if else for while do switch case break continue const let var new this true false null undefined typeof instanceof in of try catch finally throw class extends super import export default async await yield delete void " +
	"foreach as array string int float bool echo isset empty unset static public private protected fn match use namespace declare require include elseif endif endforeach list").split(" "));

export function normalisiereRumpf(text, sprache = "js") {
	const maske = codeMaske(text, sprache);
	let code = "";
	for (let i = 0; i < text.length; i++) code += maske[i] !== 0 ? text[i] : (text[i] === "\n" ? "\n" : " ");
	const klammer = code.indexOf("{");
	code = klammer >= 0 ? code.slice(klammer) : code; // Rumpf ab der ersten {; Kopf (Name, Parameter) faellt weg
	const namen = new Map(); let n = 0;
	code = code.replace(/\$?[A-Za-z_][\w]*/g, (w) => {
		if (SCHLUESSEL.has(w)) return w;
		if (!namen.has(w)) namen.set(w, "$" + (n++));
		return namen.get(w);
	});
	return code.replace(/\s+/g, " ").trim();
}

function dreiGramme(s) {
	const t = s.split(" ");
	const g = new Set();
	for (let i = 0; i + 2 < t.length; i++) g.add(t[i] + "" + t[i + 1] + "" + t[i + 2]);
	return g;
}
function jaccard(a, b) { let s = 0; for (const x of a) if (b.has(x)) s++; return s / (a.size + b.size - s || 1); }

// dateien: relative Pfade; liesText(datei) -> Text. minZeilen: Ruempfe darunter werden ignoriert.
export function findeDoppelungen(dateien, liesText, minZeilen = 8) {
	const eintraege = [];
	for (const datei of dateien) {
		const text = liesText(datei);
		const sprache = datei.endsWith(".php") ? "php" : "js";
		for (const f of findeFunktionen(text, sprache)) {
			if (f.bis - f.von + 1 < minZeilen) continue;
			eintraege.push({ datei, name: f.name, zeilen: f.bis - f.von + 1, norm: normalisiereRumpf(text.slice(f.start, f.ende), sprache), gramme: null });
		}
	}
	const aus = [];
	const gesehen = new Set();
	const nachNorm = new Map();
	for (const e of eintraege) { if (!nachNorm.has(e.norm)) nachNorm.set(e.norm, []); nachNorm.get(e.norm).push(e); }
	for (const gruppe of nachNorm.values()) {
		for (let i = 0; i < gruppe.length; i++) for (let j = i + 1; j < gruppe.length; j++) {
			if (gruppe[i].datei === gruppe[j].datei) continue;
			gesehen.add(gruppe[i].datei + "#" + gruppe[i].name + "|" + gruppe[j].datei + "#" + gruppe[j].name);
			aus.push({ a: { datei: gruppe[i].datei, name: gruppe[i].name, zeilen: gruppe[i].zeilen }, b: { datei: gruppe[j].datei, name: gruppe[j].name, zeilen: gruppe[j].zeilen }, gleichheit: 1 });
		}
	}
	// Naehe ueber 3-Gramme: nur Ruempfe aehnlicher Laenge (Aufwand begrenzen -- ~7000 Funktionen im Bestand)
	const nachLaenge = [...eintraege].sort((p, q) => p.norm.length - q.norm.length);
	for (let i = 0; i < nachLaenge.length; i++) {
		const a = nachLaenge[i];
		for (let j = i + 1; j < nachLaenge.length; j++) {
			const b = nachLaenge[j];
			if (b.norm.length - a.norm.length > a.norm.length * 0.15) break; // sortiert: ab hier nur laenger
			if (a.datei === b.datei || a.norm === b.norm) continue;
			a.gramme ||= dreiGramme(a.norm); b.gramme ||= dreiGramme(b.norm);
			const g = jaccard(a.gramme, b.gramme);
			if (g >= 0.9) aus.push({ a: { datei: a.datei, name: a.name, zeilen: a.zeilen }, b: { datei: b.datei, name: b.name, zeilen: b.zeilen }, gleichheit: Math.round(g * 100) / 100 });
		}
	}
	return aus.sort((p, q) => q.gleichheit - p.gleichheit || q.a.zeilen - p.a.zeilen);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const a = process.argv; const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
	const wurzel = opt("--wurzel", ".");
	const dateien = alleDateien(wurzel, ["js", "api", "html"], [".js", ".php", ".html"]).filter((f) => !/__tests__|(^|\/)test-/.test(f));
	const erg = findeDoppelungen(dateien, (f) => fs.readFileSync(path.join(wurzel, f), "utf8"), +opt("--min", 8));
	process.stdout.write(JSON.stringify(erg, null, 1) + "\n");
}
