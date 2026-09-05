// Die Vorpruefung der Refactoring-Routine: darf dieser Lauf globaler Funktionen in eine
// Geschwisterdatei ziehen, ohne dass sich etwas aendert?
//
// Vier Pruefungen, jede an einem Lauf der Routine gelernt (Entwurf
// docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md §5):
//   1 Ladezeit-Bezug         (Dump-Bericht, 01.09.2026)
//   2 Dateiregister          (loadLoreList, 02.09.2026)
//   3 Quelltext-Tests        (route-plan.js, 03.09.2026)
//   4 vm-Bindung, transitiv  (review-path-sync.js, 04.09.2026)
// dazu Pruefung 0: kein Zustand, kein Ladezeit-Code im Block.
//
// 💣 Werkzeugfallen, die hier festgeschrieben sind: kein `\b` in RegExp (Wort-Token per split),
// jede Datei einzeln lesen (NUL-Bytes in powerline-topology.js vergiften jeden grep-Strom),
// `^(async\s+)?function\s+` als Deklarationsmuster, Kommentare werden NIE per `sed 's://.*::'`
// gestrippt (frisst https://) -- der Scanner unten weiss, wo ein Kommentar ist.
//
// Drei Nutzer, ein Werkzeug: die Analyse, die Routine taeglich, die Agenten beim Pruefen.
//
// Aufruf: node tools/refactoring/vorpruefung.mjs <datei> [--wurzel <repo>] [--von <name> --bis <name>] [--min 150]

import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";

// -- Scanner: je Zeichen 1 = Code, 2 = Stringinhalt (samt Anfuehrungszeichen), 0 = Kommentar.
// Regex-Literale (JS) werden heuristisch erkannt: ein `/` nach ( , = : [ ! & | ? { } ; oder `return`,
// oder am Anfang; sie zaehlen als String (2), damit ihre Klammern die Zaehlung nicht kippen.
export function codeMaske(text, sprache) {
	const n = text.length;
	const maske = new Uint8Array(n);
	let i = 0;
	const vorher = (pos) => {
		let j = pos - 1;
		while (j >= 0 && /\s/.test(text[j])) j--;
		if (j < 0) return "";
		if (/return$/.test(text.slice(Math.max(0, j - 5), j + 1))) return "return";
		return text[j];
	};
	while (i < n) {
		const c = text[i];
		const c2 = text[i + 1];
		if (c === "/" && c2 === "/") { while (i < n && text[i] !== "\n") i++; continue; }
		if (sprache === "php" && c === "#") { while (i < n && text[i] !== "\n") i++; continue; }
		if (c === "/" && c2 === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
		if (c === "\"" || c === "'" || (sprache === "js" && c === "`")) {
			const q = c; maske[i] = 2; i++;
			while (i < n && text[i] !== q) {
				if (text[i] === "\\") { maske[i] = 2; i++; }
				if (i < n) { maske[i] = 2; i++; }
			}
			if (i < n) maske[i] = 2;
			i++; continue;
		}
		if (sprache === "js" && c === "/" && (i === 0 || /[(,=:[!&|?{};]|return|^$/.test(vorher(i)))) {
			maske[i] = 2; i++; let klasse = false;
			while (i < n && (klasse || text[i] !== "/") && text[i] !== "\n") {
				if (text[i] === "\\") { maske[i] = 2; i++; }
				else if (text[i] === "[") klasse = true;
				else if (text[i] === "]") klasse = false;
				if (i < n) { maske[i] = 2; i++; }
			}
			if (i < n) maske[i] = 2;
			i++; continue;
		}
		maske[i] = 1; i++;
	}
	return maske;
}

const DEKLARATION = /^[ \t]*(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;

function zeileVon(text, pos) {
	let z = 1;
	for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) z++;
	return z;
}

// Globale Funktionsdeklarationen (Spalte 0, oder eingerueckt im Inline-Script eines HTML) samt Rumpf.
// `start` zeigt auf das `function`/`async`-Wort, `ende` hinter die schliessende Klammer (exklusiv).
export function findeFunktionen(text, sprache) {
	const maske = codeMaske(text, sprache);
	const ergebnis = [];
	for (const m of text.matchAll(DEKLARATION)) {
		const start = m.index + m[0].search(/\S/);
		if (maske[start] !== 1) continue; // steht in einem Kommentar oder String
		let i = m.index + m[0].length;
		while (i < text.length && !(text[i] === "{" && maske[i] === 1)) i++; // Parameterliste ueberspringen
		let tiefe = 0; let ende = -1;
		for (; i < text.length; i++) {
			if (maske[i] !== 1) continue;
			if (text[i] === "{") tiefe++;
			else if (text[i] === "}") { tiefe--; if (tiefe === 0) { ende = i + 1; break; } }
		}
		if (ende < 0) continue;
		ergebnis.push({ name: m[2], async: Boolean(m[1]), start, ende, von: zeileVon(text, start), bis: zeileVon(text, ende - 1) });
	}
	return ergebnis;
}

// Ruempfe (samt Koepfen) durch Leerzeichen ersetzen -- Zeilen bleiben, damit Zeilenangaben stimmen.
export function blendeRuempfeAus(text, funktionen) {
	const teile = text.split("");
	for (const f of funktionen) {
		for (let i = f.start; i < f.ende; i++) if (teile[i] !== "\n") teile[i] = " ";
	}
	return teile.join("");
}

export function wortTokens(text) {
	return new Set(text.split(/[^A-Za-z0-9_$]+/).filter(Boolean));
}

// Nur die KOMMENTARE entfernen; Strings bleiben stehen (ein Blockname in einem Top-Level-String
// ist ein Ladezeit-Bezug -- dynamische Namen sind die naechste Stufe, siehe NICHT_GESEHEN).
export function ohneKommentare(text, sprache = "js") {
	const maske = codeMaske(text, sprache);
	const teile = text.split("");
	for (let i = 0; i < teile.length; i++) if (maske[i] === 0 && teile[i] !== "\n") teile[i] = " ";
	return teile.join("");
}

const ZUSTAND = /^\s*(var|let|const|window\.|document\.|\$\(|\(\s*function|\(\s*\(|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\b|[A-Za-z_$][\w$.[\]"']*\s*\(|[A-Za-z_$][\w$.[\]"']*\s*=[^=])/;

// Pruefung 0: Zeilen auf oberster Ebene, die Zustand halten oder beim Laden etwas tun.
export function pruefeZustand(oberste, sprache = "js") {
	const zeilen = ohneKommentare(oberste, sprache).split("\n");
	const funde = [];
	zeilen.forEach((z, idx) => {
		if (!z.trim()) return;
		if (/^\s*(["'`]use strict["'`];?|\}|\);?|\]\);?|<\?php|declare\s*\(.*\);?)\s*$/.test(z)) return;
		if (ZUSTAND.test(z)) funde.push({ zeile: idx + 1, text: z.trim() });
	});
	return funde;
}

// Pruefung 1: welche Blocknamen kommen auf oberster Ebene als Wort vor (window.x = f, f(), [f, g] ...)?
export function pruefeLadezeit(oberste, namen, sprache = "js") {
	const treffer = new Map();
	const zeilen = ohneKommentare(oberste, sprache).split("\n");
	zeilen.forEach((z, idx) => {
		const tokens = wortTokens(z);
		for (const name of namen) {
			if (tokens.has(name)) {
				if (!treffer.has(name)) treffer.set(name, []);
				treffer.get(name).push(idx + 1);
			}
		}
	});
	return treffer;
}
