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

// Klammertiefe je Zeichen (nur Code zaehlt): 0 = oberste Ebene.
function klammertiefen(text, maske) {
	const tiefe = new Int32Array(text.length);
	let t = 0;
	for (let i = 0; i < text.length; i++) {
		tiefe[i] = t;
		if (maske[i] !== 1) continue;
		if (text[i] === "{") t++;
		else if (text[i] === "}") t = Math.max(0, t - 1);
	}
	return tiefe;
}

// GLOBALE Funktionsdeklarationen samt Rumpf -- global heisst Klammertiefe 0, nicht Spalte 0:
// eine eingerueckte Deklaration im Rumpf einer IIFE (wege-editor.js, review-garetien-importer.js)
// ist eine Closure und kein Ziel; eine eingerueckte auf oberster Ebene eines Inline-Scripts ist global.
// `start` zeigt auf das `function`/`async`-Wort, `ende` hinter die schliessende Klammer (exklusiv).
export function findeFunktionen(text, sprache) {
	const maske = codeMaske(text, sprache);
	const tiefen = klammertiefen(text, maske);
	const ergebnis = [];
	for (const m of text.matchAll(DEKLARATION)) {
		const start = m.index + m[0].search(/\S/);
		if (maske[start] !== 1) continue; // steht in einem Kommentar oder String
		if (tiefen[start] !== 0) continue; // Closure in einer IIFE, Methode, verschachtelte Funktion
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

// -- Dateisystem: jede Datei einzeln lesen (kein grep-Strom -- NUL-Bytes in powerline-topology.js).
export function alleDateien(wurzel, unterordner, endungen) {
	const aus = [];
	const gehe = (dir) => {
		let eintraege = [];
		try { eintraege = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of eintraege) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) { if (e.name !== "third-party" && e.name !== "node_modules") gehe(p); }
			else if (endungen.some((x) => e.name.endsWith(x))) aus.push(path.relative(wurzel, p).split(path.sep).join("/"));
		}
	};
	for (const u of unterordner) gehe(path.join(wurzel, u));
	return aus.sort();
}

function lies(wurzel, rel) { return fs.readFileSync(path.join(wurzel, rel), "utf8"); }

// Pruefung 2: handgepflegte Dateiregister -- der Zielpfad steht in Anfuehrungszeichen in js/ oder tools/.
// Ob ein Treffer ein Register ist, das nachgezogen werden muss, entscheidet der Lauf (eine Zeile,
// wie das <script>-Tag); der Agent prueft, ob er es getan hat.
export function findeRegister(zielpfad, wurzel) {
	const funde = [];
	for (const rel of alleDateien(wurzel, ["js", "tools"], [".js", ".mjs"])) {
		if (rel === zielpfad) continue;
		const zeilen = lies(wurzel, rel).split("\n");
		zeilen.forEach((z, idx) => {
			if (z.includes(`"${zielpfad}"`) || z.includes(`'${zielpfad}'`)) funde.push({ datei: rel, zeile: idx + 1 });
		});
	}
	return funde;
}

const IST_TEST = (rel) => /__tests__\/[^/]+\.test\.js$/.test(rel) || /(^|\/)test-[^/]+\.mjs$/.test(rel);

// Ein Test „nennt" die Zieldatei nur, wenn ihr Basisname in einem String-Literal steht
// (readFileSync(..., "route-plan.js"), "js/routing/route-plan.js") -- eine Erwaehnung im
// Kommentar („liest NICHT route-plan.js") ist keine Bindung.
function nenntDatei(text, basis) {
	const b = basis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp("[\"'][^\"'\\n]*" + b + "[\"']").test(text);
}

// Pruefung 3: Tests, die die Zieldatei als Text lesen und Funktionen beim Namen herausschneiden.
// Muster: extractFunction(quelle, "NAME"), extract("NAME"), indexOf("function NAME"),
// Regex-Literal /function\s+NAME\b/ bzw. /function NAME\(/.
export function findeQuelltextTests(zielpfad, wurzel) {
	const basis = path.posix.basename(zielpfad);
	const funde = [];
	for (const rel of alleDateien(wurzel, ["js", "tools"], [".js", ".mjs"])) {
		if (!IST_TEST(rel)) continue;
		const text = lies(wurzel, rel);
		if (!nenntDatei(text, basis)) continue;
		const namen = new Set();
		// extractFunction(quelle, "name") · extract("name") · lift("name") · holeFunktion("name") · schneide…("name")
		for (const m of text.matchAll(/(?:extract\w*|lift|hole\w*|schneide\w*)\(\s*[^,()"']*,\s*["']([A-Za-z_$][\w$]*)["']/g)) namen.add(m[1]);
		for (const m of text.matchAll(/(?:extract\w*|lift|hole\w*|schneide\w*)\(\s*["']([A-Za-z_$][\w$]*)["']/g)) namen.add(m[1]);
		for (const m of text.matchAll(/indexOf\(\s*["'](?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) namen.add(m[1]);
		// Regex-Literal im Test: /function\s+NAME\b/ oder /function NAME\(/ -- hier als Text gelesen,
		// deshalb steht `\\s\+` (die Zeichen Backslash-s-Backslash-Plus) neben `\s+` (echter Leerraum).
		for (const m of text.matchAll(/\/function(?:\\s\+|\s+)([A-Za-z_$][\w$]*)(?:\\b|\\\(|\()/g)) namen.add(m[1]);
		if (namen.size) funde.push({ datei: rel, namen: [...namen] });
	}
	return funde;
}

// Pruefung 3b: PHP-Tests, die den QUELLTEXT der Zieldatei lesen (file_get_contents / file() /
// token_get_all) und darin Funktionsnamen als STRING suchen -- verweildauer-test.php zaehlt so die
// Aufrufer von avesmapsVisitorFinishLiveRun, citymap-delete-parity sucht avesmapsDeleteCitymap*.
// Ein Name, der in so einem Test NUR bar vorkommt (als Aufruf ueber die require-Kette), bindet nicht;
// einer, der in einem String-Literal steht, bindet -- nach dem Umzug findet ihn der Test dort nicht mehr.
// Auch ein Praefix-String ("avesmapsDeleteCitymap") bindet alle Namen, die mit ihm beginnen.
// Kalibriert am 05.09.2026 an acht echten Tests: ein Name in einer ASSERT-MELDUNG bindet nicht,
// ein `file_get_contents` auf eine LOGDATEI liest keine Lib. Gebunden ist ein Name nur, wenn er als
// String in einem SUCH-Aufruf steht (str_contains/strpos/substr_count/preg_match ...) oder als Argument
// eines Ausschneide-Helfers ($rumpfVon('name'), $quelleVon(...)), UND der Test die Zieldatei liest.
const PHP_SUCHE = /(str_contains|str_starts_with|str_ends_with|strpos|stripos|strrpos|substr_count|preg_match|preg_match_all|preg_replace|preg_split|preg_quote|strstr|mb_strpos|mb_substr_count)\s*\(([^;]*)/g;
const PHP_HELFER = /\$?(\w*(?:rumpf|quelle|source|extract|schneide|hole|lift|body|snippet)\w*)\s*\(\s*['"]([A-Za-z_][\w]*)['"]/gi;

export function findePhpQuelltextTests(zielpfad, wurzel, funktionsnamen) {
	if (!zielpfad.endsWith(".php")) return [];
	const basis = path.posix.basename(zielpfad);
	const b = basis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// Der Basisname muss das ENDE des Pfad-Strings sein ("…/features.php'") -- eine Logdatei
	// "visitor-analytics.php.log" ist nicht die Lib.
	const liestZiel = new RegExp("(file_get_contents|\\bfile|token_get_all|PhpToken::tokenize)\\s*\\([^;]{0,200}?" + b + "['\"]|\\(\\s*['\"][^'\"\\n]*" + b + "['\"]\\s*\\)", "s");
	const funde = [];
	for (const rel of alleDateien(wurzel, ["api", "tools"], [".php"])) {
		if (!(/__tests__\/[^/]+\.php$/.test(rel) || /(^|\/)test-[^/]+\.php$/.test(rel))) continue;
		const text = lies(wurzel, rel);
		if (!nenntDatei(text, basis)) continue;
		if (!/file_get_contents|\bfile\(|token_get_all|PhpToken::tokenize/.test(text)) continue;
		if (!liestZiel.test(text)) continue;
		const strings = [];
		for (const m of text.matchAll(PHP_SUCHE)) for (const s of m[2].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) strings.push(s[1] ?? s[2]);
		for (const m of text.matchAll(PHP_HELFER)) strings.push(m[2]);
		const namen = new Set();
		for (const s of strings) {
			for (const n of funktionsnamen) {
				if (s === n || s.includes(n)) { namen.add(n); continue; }
				// Praefix: der String ist ein Anfangsstueck des Namens (citymap-delete-parity sucht "avesmapsDeleteCitymap")
				if (s.length >= 12 && /^[A-Za-z_][\w]*$/.test(s) && n.startsWith(s)) namen.add(n);
			}
		}
		if (namen.size) funde.push({ datei: rel, namen: [...namen] });
	}
	return funde;
}

const VM_LAUF = /runInContext|runInNewContext|runInThisContext|vm\.Script|new Script\(/;
const AUSSCHNITT = /\.slice\(|\.substring\(|\.substr\(|indexOf\(|extract\w*\(|lift\(|hole\w*\(|schneide\w*\(|schnipsel/;

// Laedt dieser Test die Zieldatei GANZ in einen vm-Kontext? Nur dann gilt die Aufrufkette:
// eine Geschwisterdatei existiert in diesem Kontext nicht, und jeder Aufruf dorthin ist ein
// ReferenceError. Ein Test, der nur STUECKE ausschneidet (slice/extract/lift), hat die Kette
// heute schon nicht -- er faellt unter Pruefung 3 (die Namen, die er schneidet).
// Drei Wege, gemessen an den Tests des Hauses (05.09.2026):
//   (a) direkt:   vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../route-plan.js"), "utf8"))
//   (b) Variable: const quelle = fs.readFileSync(...review-path-sync.js...); vm.runInContext(quelle, ...)
//       -- auch ueber eine Ableitung ohne Ausschnitt (quelle.replace(...), oberflaechenQuelle() mit
//       match(/<script>/) fuer den groessten Inline-Block einer Editorseite)
//   (c) Lade-Hilfsfunktion: function lade(rel) { vm.runInThisContext(fs.readFileSync(...)) } + lade("…/ziel.js")
//       oder eine Liste von Pfaden, die mit ihr durchlaufen wird.
// ⚠️ Heuristik. Ein uebersehener Fall kostet einen verworfenen Schnitt am roten Testfeld VOR dem
// Push, nie eine Regression -- deshalb darf sie im Zweifel FREI sagen, wenn kein Ganz-Lade-Beleg da ist.
export function laedtGanz(text, basis) {
	const b = basis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const zielString = "[\"'][^\"'\\n]*" + b + "[\"']";
	// (a) direkt
	if (new RegExp("(runIn\\w*Context|vm\\.Script|new Script)\\(\\s*(?:fs\\.)?readFileSync\\([^;]{0,240}?" + b, "s").test(text)) return "direkt";
	// (b) Variable + Ableitungen
	const getaint = new Set();
	for (const m of text.matchAll(new RegExp("(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(?:fs\\.)?(?:readFileSync|readFile)\\([^;]{0,240}?" + b, "gs"))) getaint.add(m[1]);
	let gewachsen = true;
	while (gewachsen) {
		gewachsen = false;
		for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]{1,400});/gs)) {
			if (getaint.has(m[1])) continue;
			const tok = wortTokens(m[2]);
			if ([...getaint].some((v) => tok.has(v)) && !AUSSCHNITT.test(m[2])) { getaint.add(m[1]); gewachsen = true; }
		}
		for (const f of findeFunktionen(text, "js")) {
			if (getaint.has(f.name)) continue;
			const rumpf = text.slice(f.start, f.ende);
			const tok = wortTokens(rumpf);
			if ([...getaint].some((v) => tok.has(v)) && !AUSSCHNITT.test(rumpf)) { getaint.add(f.name); gewachsen = true; }
		}
	}
	for (const v of getaint) {
		if (new RegExp("(runIn\\w*Context|vm\\.Script|new Script)\\(\\s*" + v.replace(/\$/g, "\\$") + "\\b").test(text)) return "variable " + v;
	}
	// (c) Lade-Hilfsfunktion
	for (const f of findeFunktionen(text, "js")) {
		const rumpf = text.slice(f.start, f.ende);
		if (!/(runIn\w*Context|vm\.Script|new Script)\(\s*(?:fs\.)?readFileSync\(/s.test(rumpf)) continue;
		const h = f.name.replace(/\$/g, "\\$");
		if (new RegExp(h + "\\(\\s*" + zielString).test(text)) return "helfer " + f.name;
		// Pfadliste, die mit der Hilfsfunktion durchlaufen wird
		for (const m of text.matchAll(/\[[^\]]{0,2000}\]/gs)) {
			if (!new RegExp(zielString).test(m[0])) continue;
			const danach = text.slice(m.index + m[0].length, m.index + m[0].length + 400);
			if (new RegExp("(forEach|map)\\(\\s*" + h + "\\b|" + h + "\\(").test(danach)) return "helfer " + f.name + " (Liste)";
		}
	}
	return null;
}

// Pruefung 4a: Tests, die die Zieldatei GANZ in einen vm-Kontext laden. Genannt gilt als gerufen
// (konservativ); `wie` sagt, welcher der drei Ladewege erkannt wurde.
export function findeVmTests(zielpfad, wurzel, funktionsnamen) {
	const basis = path.posix.basename(zielpfad);
	const funde = [];
	for (const rel of alleDateien(wurzel, ["js", "tools"], [".js", ".mjs"])) {
		if (!IST_TEST(rel)) continue;
		const text = lies(wurzel, rel);
		if (!nenntDatei(text, basis)) continue;
		if (!VM_LAUF.test(text)) continue;
		const wie = laedtGanz(text, basis);
		if (!wie) continue;
		const tokens = wortTokens(text);
		const genannt = funktionsnamen.filter((n) => tokens.has(n));
		funde.push({ datei: rel, genannt, wie });
	}
	return funde;
}

// Pruefung 4b: Aufrufgraph innerhalb der Datei -- welche Blocknamen stehen im Rumpf welcher Funktion?
export function aufrufgraph(text, funktionen) {
	const namen = new Set(funktionen.map((f) => f.name));
	const graph = new Map();
	for (const f of funktionen) {
		const tokens = wortTokens(text.slice(f.start, f.ende));
		const ziele = new Set();
		for (const n of namen) if (n !== f.name && tokens.has(n)) ziele.add(n);
		graph.set(f.name, ziele);
	}
	return graph;
}

// Pruefung 4c: transitiver Abschluss -- alles, was ein gebundener Name ruft, ist gebunden.
// 💣 Das ist die Lehre vom 04.09.2026: „welche Namen nennt ein Test" sah 21 gebundene, es waren 51.
export function fixpunkt(startnamen, graph) {
	const aus = new Set(startnamen);
	const stapel = [...startnamen];
	while (stapel.length) {
		const n = stapel.pop();
		for (const z of graph.get(n) || []) if (!aus.has(z)) { aus.add(z); stapel.push(z); }
	}
	return aus;
}

// -- PHP: Konstanten, die der Block liest, muessen VOR der Blockstelle definiert sein (Entwurf §3 C).
// Bezeichner, die nirgends in der Datei definiert werden (PHP_EOL, JSON_THROW_ON_ERROR), sagen nichts
// und werden weggelassen. `von`/`bis` sind Indizes in `funktionen`.
export function konstantenImBlock(text, funktionen, von, bis) {
	const start = funktionen[von].start;
	const rumpf = funktionen.slice(von, bis + 1).map((f) => text.slice(f.start, f.ende)).join("\n");
	const namen = new Set([...rumpf.matchAll(/(?<![\w$])([A-Z][A-Z0-9_]{3,})(?![\w$])/g)].map((m) => m[1]));
	const aus = [];
	for (const name of namen) {
		const def = new RegExp("(define\\(\\s*['\"]" + name + "['\"]|const\\s+" + name + "\\s*=)", "g");
		let zeile = null; let definiertVor = false; let irgendwo = false;
		for (const m of text.matchAll(def)) {
			irgendwo = true;
			if (m.index < start) { definiertVor = true; zeile = zeileVon(text, m.index); break; }
		}
		if (!irgendwo) continue;
		aus.push({ name, definiertVor, zeile });
	}
	return aus;
}

// -- HTML: der groesste Inline-<script>-Block. `zeilenVersatz` ist die Zeilennummer der <script>-Zeile;
// Zeile z des Blocktexts liegt in der HTML-Datei auf z + zeilenVersatz - 1 (Zeile 1 des Blocks ist der
// Rest der <script>-Zeile selbst).
export function inlineScript(html) {
	let best = null;
	for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
		if (!best || m[1].length > best.text.length) best = { text: m[1], zeilenVersatz: zeileVon(html, m.index) };
	}
	return best || { text: "", zeilenVersatz: 0 };
}

// -- Freie Bloecke: Laeufe ungebundener Funktionen, zwischen denen nichts als Leerraum/Kommentar steht.
export function freieBloecke(text, funktionen, gebunden, minZeilen, sprache = "js") {
	const aus = [];
	let lauf = [];
	const schliesse = () => {
		if (lauf.length) {
			const zeilen = lauf[lauf.length - 1].bis - lauf[0].von + 1;
			if (zeilen >= minZeilen) aus.push({ von: lauf[0].von, bis: lauf[lauf.length - 1].bis, namen: lauf.map((f) => f.name), zeilen });
		}
		lauf = [];
	};
	for (const f of funktionen) {
		if (gebunden.has(f.name)) { schliesse(); continue; }
		if (lauf.length) {
			const zwischen = text.slice(lauf[lauf.length - 1].ende, f.start);
			if (/\S/.test(ohneKommentare(zwischen, sprache))) schliesse();
		}
		lauf.push(f);
	}
	schliesse();
	return aus;
}

// Blob-Hash wie git ihn im Index fuehrt (Clean-Filter inklusive, also CRLF -> LF im Repo).
// Ausserhalb eines Repos hasht `git hash-object` den Rohinhalt; ohne git: null.
export function gitBlob(wurzel, rel) {
	try {
		return childProcess.execFileSync("git", ["-C", wurzel, "hash-object", rel], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch { return null; }
}

// Was dieses Skript NICHT sieht -- steht in JEDER Ausgabe als Satz, nie als Schweigen (Entwurf §5).
export const NICHT_GESEHEN = [
	"Closures in IIFE-Modulen (der Scan sieht nur globale Deklarationen)",
	"dynamisch zusammengesetzte Namen (window[\"avesmaps\" + x], new Function, eval)",
	"Aufrufe aus .php-Seiten, die JS inline erzeugen (edit/*.php)",
	"Inline-Handler in HTML-Attributen (onclick=\"name(\") und CSS-Klassen, die ein Block per String erzeugt",
];

// -- Der Orchestrator: eine Datei, alle Pruefungen, ein JSON.
export function vorpruefung({ datei, wurzel = ".", von = null, bis = null, min = 150 }) {
	const endung = path.posix.extname(datei);
	const roh = lies(wurzel, datei);
	let sprache; let text; let versatz = 0;
	if (endung === ".php") { sprache = "php"; text = roh; }
	else if (endung === ".js" || endung === ".mjs") { sprache = "js"; text = roh; }
	else if (endung === ".html") { sprache = "js"; const inl = inlineScript(roh); text = inl.text; versatz = inl.zeilenVersatz ? inl.zeilenVersatz - 1 : 0; }
	else throw new Error("unbekannte Endung: " + endung);

	const fns = findeFunktionen(text, sprache).map((f) => ({ ...f, von: f.von + versatz, bis: f.bis + versatz }));
	const namen = fns.map((f) => f.name);
	const oberste = blendeRuempfeAus(text, fns);
	const zustand = pruefeZustand(oberste, sprache).map((z) => ({ zeile: z.zeile + versatz, text: z.text }));
	const gruende = new Map(namen.map((n) => [n, []]));
	const merke = (n, g) => { if (gruende.has(n)) gruende.get(n).push(g); };

	const lade = pruefeLadezeit(oberste, namen, sprache);
	for (const [n, zeilen] of lade) merke(n, "ladezeit: Z. " + zeilen.map((z) => z + versatz).join(", "));

	const register = findeRegister(datei, wurzel);
	const quelltextTests = [...findeQuelltextTests(datei, wurzel), ...findePhpQuelltextTests(datei, wurzel, namen)];
	for (const t of quelltextTests) for (const n of t.namen) merke(n, "quelltext: " + t.datei);

	let vmTests = [];
	if (sprache === "js") {
		vmTests = findeVmTests(datei, wurzel, namen);
		const graph = aufrufgraph(text, fns);
		// Die Aufrufkette zaehlt NUR im vm-Kontext (dort fehlt die Geschwisterdatei). Ein Ladezeit-Bezug
		// bindet nur den Namen selbst: seine Aufrufe laufen spaeter und finden die Geschwisterdatei vor.
		const start = new Set(vmTests.flatMap((t) => t.genannt));
		for (const t of vmTests) for (const n of t.genannt) merke(n, "vm: " + t.datei);
		for (const n of fixpunkt([...start], graph)) {
			if (start.has(n)) continue;
			const ueber = [...start].find((s) => fixpunkt([s], graph).has(n));
			merke(n, "vm-transitiv: ueber " + ueber);
		}
	}

	let konstanten = [];
	let i0 = 0; let i1 = fns.length - 1;
	if (von && bis) { i0 = namen.indexOf(von); i1 = namen.indexOf(bis); }
	if (sprache === "php" && fns.length) {
		// Je FUNKTION: eine Konstante, die erst nach ihrem eigenen Start definiert wird, bindet nur sie --
		// nicht die ganze Datei (sonst band eine spaete Konstante alle 100 Funktionen von ecosystem.php).
		fns.forEach((f, i) => {
			for (const k of konstantenImBlock(text, fns, i, i)) if (!k.definiertVor) merke(f.name, "konstante: " + k.name + " erst nach dieser Funktion definiert");
		});
		// Fuer den vorgeschlagenen Block zaehlt die BLOCKSTELLE (dort steht spaeter das require_once).
		if (i0 >= 0 && i1 >= i0) konstanten = konstantenImBlock(text, fns, i0, i1);
	}

	const gebunden = new Set([...gruende].filter(([, g]) => g.length).map(([n]) => n));
	const bloecke = freieBloecke(text, fns, gebunden, min, sprache);

	let block = null;
	if (von && bis) {
		const bg = [];
		if (i0 < 0 || i1 < 0 || i1 < i0) bg.push("Blockgrenzen nicht gefunden oder verkehrt");
		else {
			for (const f of fns.slice(i0, i1 + 1)) for (const g of gruende.get(f.name)) bg.push(f.name + " -- " + g);
			for (const k of konstanten) if (!k.definiertVor) bg.push("konstante: " + k.name + " nicht vor der Blockstelle definiert");
			const dazwischen = ohneKommentare(text.slice(fns[i0].start, fns[i1].ende), sprache);
			const nurRuempfe = blendeRuempfeAus(dazwischen, findeFunktionen(dazwischen, sprache));
			if (/\S/.test(nurRuempfe)) bg.push("Zustand oder Ladezeit-Code zwischen den Funktionen des Blocks");
		}
		block = { von, bis, frei: bg.length === 0, gruende: bg };
	}

	return {
		datei, sprache, blob: gitBlob(wurzel, datei),
		funktionen: fns.map((f) => ({ name: f.name, von: f.von, bis: f.bis, gebunden: gruende.get(f.name) })),
		zustand, register, quelltextTests, vmTests, konstanten, freieBloecke: bloecke, block, nichtGesehen: NICHT_GESEHEN,
	};
}

// -- CLI: node tools/refactoring/vorpruefung.mjs <datei> [--wurzel .] [--von a --bis b] [--min 150]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const opt = {}; const frei = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--")) { opt[args[i].slice(2)] = args[i + 1]; i++; }
		else frei.push(args[i]);
	}
	try {
		if (!frei[0]) throw new Error("Aufruf: vorpruefung.mjs <datei> [--wurzel .] [--von a --bis b] [--min 150]");
		const erg = vorpruefung({ datei: frei[0], wurzel: opt.wurzel || ".", von: opt.von || null, bis: opt.bis || null, min: Number(opt.min || 150) });
		process.stdout.write(JSON.stringify(erg, null, 2) + "\n");
	} catch (e) { process.stderr.write(String(e.message) + "\n"); process.exit(2); }
}
