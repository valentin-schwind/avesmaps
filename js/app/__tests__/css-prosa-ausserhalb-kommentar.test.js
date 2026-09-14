// Ein Kommentar, der zu FRUEH endet, verschluckt die Regel dahinter -- und niemand merkt es.
//
// 💣 DAS GESCHWISTER VON css-comment-balance.test.js, UND DIE BALANCE SIEHT DIESEN FALL NICHT.
// Dort geht es um ein `*/` zu viel oder zu wenig. Hier sind die Kommentare sauber geschlossen -- nur
// eben einen Absatz zu frueh. Der Text danach steht AUSSERHALB des Kommentars, wird Teil des
// Selektors der folgenden Regel, der Selektor ist ungueltig, und der Browser verwirft die GANZE Regel.
// Keine Meldung, die Datei laedt, im Editor sieht der Absatz aus wie der Kommentar darueber.
//
// Passiert am 04.09.2026 (1452e5457) in css/features/ecosystem-layer.css: sieben Zeilen wurden an
// einen Kommentar angehaengt, dessen `*/` schon eine Zeile davor stand. Verschluckt wurde die Regel,
// die die Knopfleisten von „Flaeche zuweisen", „Label zuweisen" und dem Uebertragen-Dialog unten
// festklebt -- zehn Tage lang, obwohl ein Pruefagent sie vor dem Anhaengen im Browser vermessen
// hatte. Gefunden am 14.09.2026 mit `new CSSStyleSheet().replaceSync(text)`: der Selektor stand im
// Text, im CSSOM nicht.
//
// WAS DER TEST TUT: er zerlegt jedes Blatt nach den Regeln der CSS-Syntax (Zeichenketten, url(),
// Klammern, Bloecke, @-Regeln) und prueft zwei Stellen, an denen herrenloser Text landet:
//   • der Kopf einer Regel muss eine gueltige Selektorliste sein -- und ein Elementname muss ein
//     ECHTES Element nennen. Das zweite ist strenger als der Browser, und mit Absicht: Prosa aus
//     lauter Woertern („Wer eines aendert aendert beide") ist syntaktisch ein gueltiger
//     Nachfahren-Selektor ueber unbekannte Elemente. Der Browser behaelt die Regel, sie trifft nur
//     nie etwas -- und dann findet auch die CSSOM-Messung nichts.
//   • jede Deklaration muss mit einem Eigenschaftsnamen und einem Doppelpunkt beginnen.
// ⚠️ Pseudoklassen-NAMEN prueft er nicht (`:hovr` bleibt gruen); das ist ein Tippfehler, keine Prosa.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/css-prosa-ausserhalb-kommentar.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

// ---- Zerlegen (CSS Syntax Level 3, so weit, wie Selektoren und Deklarationen es brauchen) --------

const LEERRAUM = new Set([" ", "\t", "\n", "\r", "\f"]);

function istZiffer(z) {
	return z !== undefined && z >= "0" && z <= "9";
}

function istNamensStart(z) {
	return z !== undefined && (/[A-Za-z_]/.test(z) || z.charCodeAt(0) >= 0x80);
}

function istNamensZeichen(z) {
	return istNamensStart(z) || istZiffer(z) || z === "-";
}

function istEscape(text, i) {
	return text[i] === "\\" && text[i + 1] !== undefined && !"\n\r\f".includes(text[i + 1]);
}

function beginntIdent(text, i) {
	if (text[i] === "-") {
		return istNamensStart(text[i + 1]) || text[i + 1] === "-" || istEscape(text, i + 1);
	}
	return istNamensStart(text[i]) || istEscape(text, i);
}

function beginntZahl(text, i) {
	const z = text[i];
	if (z === "+" || z === "-") {
		return istZiffer(text[i + 1]) || (text[i + 1] === "." && istZiffer(text[i + 2]));
	}
	if (z === ".") {
		return istZiffer(text[i + 1]);
	}
	return istZiffer(z);
}

function leseName(text, i) {
	let name = "";
	while (i < text.length) {
		if (istNamensZeichen(text[i])) {
			name += text[i];
			i++;
		} else if (istEscape(text, i)) {
			let j = i + 1;
			if (/[0-9a-fA-F]/.test(text[j])) {
				let hex = "";
				while (hex.length < 6 && /[0-9a-fA-F]/.test(text[j])) { hex += text[j]; j++; }
				if (LEERRAUM.has(text[j])) { j++; }
				name += String.fromCodePoint(parseInt(hex, 16) || 0xfffd);
			} else {
				name += text[j];
				j++;
			}
			i = j;
		} else {
			break;
		}
	}
	return [name, i];
}

function tokenisiere(text) {
	const tokens = [];
	let i = 0;
	let zeile = 1;
	const zeilenIn = (von, bis) => {
		let n = 0;
		for (let j = von; j < bis; j++) { if (text[j] === "\n") { n++; } }
		return n;
	};
	while (i < text.length) {
		const z = text[i];
		const start = zeile;
		const neu = (typ, wert, extra) => tokens.push({ typ, wert, zeile: start, ...extra });
		if (z === "/" && text[i + 1] === "*") {
			const ende = text.indexOf("*/", i + 2);
			const bis = ende < 0 ? text.length : ende + 2;
			zeile += zeilenIn(i, bis);
			i = bis;
			continue;
		}
		if (LEERRAUM.has(z)) {
			let j = i;
			while (j < text.length && LEERRAUM.has(text[j])) { j++; }
			zeile += zeilenIn(i, j);
			neu("ws", " ");
			i = j;
			continue;
		}
		if (text.startsWith("<!--", i)) { i += 4; continue; }
		if (text.startsWith("-->", i)) { i += 3; continue; }
		if (z === '"' || z === "'") {
			let j = i + 1;
			let wert = "";
			let kaputt = false;
			while (j < text.length && text[j] !== z) {
				if (text[j] === "\\") { wert += text[j + 1] ?? ""; j += 2; continue; }
				if (text[j] === "\n" || text[j] === "\r") { kaputt = true; break; }
				wert += text[j];
				j++;
			}
			neu(kaputt ? "kaputte-zeichenkette" : "string", wert);
			i = kaputt ? j : j + 1;
			continue;
		}
		if (z === "#" && (istNamensZeichen(text[i + 1]) || istEscape(text, i + 1))) {
			const idTyp = beginntIdent(text, i + 1);
			const [name, ende] = leseName(text, i + 1);
			neu("hash", name, { idTyp });
			i = ende;
			continue;
		}
		if (beginntZahl(text, i)) {
			let j = i;
			if (text[j] === "+" || text[j] === "-") { j++; }
			while (istZiffer(text[j])) { j++; }
			if (text[j] === "." && istZiffer(text[j + 1])) { j++; while (istZiffer(text[j])) { j++; } }
			let einheit = "";
			if (text[j] === "%") {
				einheit = "%";
				j++;
			} else if (beginntIdent(text, j)) {
				const [name, ende] = leseName(text, j);
				einheit = name;
				j = ende;
			}
			neu("zahl", text.slice(i, j), { einheit });
			i = j;
			continue;
		}
		if (beginntIdent(text, i)) {
			const [name, ende] = leseName(text, i);
			if (text[ende] === "(") {
				let j = ende + 1;
				while (LEERRAUM.has(text[j])) { j++; }
				// 💣 url() ohne Anfuehrungszeichen ist EIN Token bis zur schliessenden Klammer -- ein
				// data:-Bild traegt Semikolons und Kommas, die sonst als Trenner gelesen wuerden.
				if (name.toLowerCase() === "url" && text[j] !== '"' && text[j] !== "'") {
					while (j < text.length && text[j] !== ")") { if (text[j] === "\\") { j++; } j++; }
					zeile += zeilenIn(i, j);
					neu("url", text.slice(i, j + 1));
					i = j + 1;
					continue;
				}
				neu("funktion", name);
				i = ende + 1;
				continue;
			}
			neu("ident", name);
			i = ende;
			continue;
		}
		if (z === "@" && beginntIdent(text, i + 1)) {
			const [name, ende] = leseName(text, i + 1);
			neu("at", name);
			i = ende;
			continue;
		}
		if ("()[]{},:;".includes(z)) {
			neu(z, z);
			i++;
			continue;
		}
		neu("delim", z);
		i++;
	}
	return tokens;
}

function alsText(tokens) {
	return tokens.map((t) => {
		switch (t.typ) {
			case "hash": return "#" + t.wert;
			case "at": return "@" + t.wert;
			case "funktion": return t.wert + "(";
			case "string": return JSON.stringify(t.wert);
			default: return t.wert;
		}
	}).join("").replace(/\s+/g, " ").trim();
}

function ohneRandLeerraum(tokens) {
	let a = 0;
	let b = tokens.length;
	while (a < b && tokens[a].typ === "ws") { a++; }
	while (b > a && tokens[b - 1].typ === "ws") { b--; }
	return tokens.slice(a, b);
}

function beschreibe(token) {
	return token ? `„${alsText([token]) || token.typ}"` : "Ende";
}

// ---- Selektoren -----------------------------------------------------------------------------------

// Ein Elementname in einem Selektor muss ein echtes Element nennen. HTML ist nicht nach Gross- und
// Kleinschreibung unterschieden, verglichen wird deshalb klein.
const ELEMENTE = new Set((
	// HTML
	"a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption " +
	"cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset " +
	"figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins " +
	"kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option " +
	"output p picture pre progress q rp rt ruby s samp script search section select slot small source " +
	"span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr " +
	"track u ul var video wbr " +
	// SVG
	"svg g path circle ellipse line polyline polygon rect text tspan textpath use defs symbol marker " +
	"clippath mask pattern lineargradient radialgradient stop filter image foreignobject desc switch " +
	// MathML
	"math"
).split(" ").filter(Boolean));

// Ein eigenes Element (Custom Element) traegt einen Bindestrich und ist KLEIN geschrieben. Das Zweite
// ist die Bremse gegen Prosa: „Intro-Blatt" haette sonst als Elementname durchgehen koennen.
function istElementname(name) {
	return ELEMENTE.has(name.toLowerCase()) || /^[a-z][a-z0-9]*-[a-z0-9-]*$/.test(name);
}

const LOGISCHE_PSEUDOKLASSEN = new Set([
	"not", "is", "where", "matches", "-webkit-any", "-moz-any", "has", "host", "host-context", "slotted",
]);

function teileAnKomma(tokens) {
	const teile = [[]];
	let tiefe = 0;
	for (const t of tokens) {
		if (t.typ === "(" || t.typ === "funktion" || t.typ === "[") { tiefe++; }
		else if (t.typ === ")" || t.typ === "]") { tiefe--; }
		if (tiefe === 0 && t.typ === ",") {
			teile.push([]);
		} else {
			teile[teile.length - 1].push(t);
		}
	}
	return teile;
}

function passendeKlammer(s, k) {
	let tiefe = 0;
	for (let j = k; j < s.length; j++) {
		const typ = s[j].typ;
		if (typ === "funktion" || typ === "(" || typ === "[") { tiefe++; }
		else if (typ === ")" || typ === "]") {
			tiefe--;
			if (tiefe === 0) { return j; }
		}
	}
	return -1;
}

function istKombinator(t) {
	return Boolean(t) && t.typ === "delim" && (t.wert === ">" || t.wert === "+" || t.wert === "~");
}

function pruefeAttribut(innen) {
	const a = ohneRandLeerraum(innen);
	let k = 0;
	if (!a[k] || a[k].typ !== "ident") { return "Attributselektor ohne Namen"; }
	k++;
	while (a[k] && a[k].typ === "ws") { k++; }
	if (k >= a.length) { return null; }
	if (a[k].typ === "delim" && a[k].wert === "=") {
		k++;
	} else if (a[k].typ === "delim" && "~|^$*".includes(a[k].wert) && a[k + 1] && a[k + 1].typ === "delim" && a[k + 1].wert === "=") {
		k += 2;
	} else {
		return "Attributselektor mit ungueltigem Vergleich";
	}
	while (a[k] && a[k].typ === "ws") { k++; }
	if (!a[k] || (a[k].typ !== "ident" && a[k].typ !== "string")) { return "Attributselektor ohne Wert"; }
	k++;
	while (a[k] && a[k].typ === "ws") { k++; }
	if (a[k] && a[k].typ === "ident" && /^[is]$/i.test(a[k].wert)) {
		k++;
		while (a[k] && a[k].typ === "ws") { k++; }
	}
	return k >= a.length ? null : "Attributselektor mit ueberzaehligem Inhalt";
}

function pruefeKompound(s, k) {
	const start = k;
	const erstes = s[k];
	if (erstes && (erstes.typ === "ident" || (erstes.typ === "delim" && erstes.wert === "*"))) {
		if (erstes.typ === "ident" && !istElementname(erstes.wert)) {
			return { grund: `„${erstes.wert}" ist kein Element` };
		}
		k++;
	}
	while (k < s.length) {
		const t = s[k];
		if (t.typ === "hash") {
			if (!t.idTyp) { return { grund: `„#${t.wert}" ist keine gueltige ID` }; }
			k++;
			continue;
		}
		if (t.typ === "delim" && t.wert === ".") {
			if (!s[k + 1] || s[k + 1].typ !== "ident") { return { grund: "Punkt ohne Klassennamen" }; }
			k += 2;
			continue;
		}
		if (t.typ === "[") {
			const ende = passendeKlammer(s, k);
			if (ende < 0) { return { grund: "eckige Klammer geht nicht zu" }; }
			const grund = pruefeAttribut(s.slice(k + 1, ende));
			if (grund) { return { grund }; }
			k = ende + 1;
			continue;
		}
		if (t.typ === ":") {
			if (s[k + 1] && s[k + 1].typ === ":") { k++; }
			const name = s[k + 1];
			if (name && name.typ === "ident") {
				k += 2;
				continue;
			}
			if (name && name.typ === "funktion") {
				const ende = passendeKlammer(s, k + 1);
				if (ende < 0) { return { grund: `:${name.wert}( geht nicht zu` }; }
				const pseudo = name.wert.toLowerCase();
				if (LOGISCHE_PSEUDOKLASSEN.has(pseudo)) {
					const innen = ohneRandLeerraum(s.slice(k + 2, ende));
					if (innen.length === 0) { return { grund: `:${pseudo}() ist leer` }; }
					const grund = pruefeSelektorliste(innen, pseudo === "has");
					if (grund) { return { grund: `in :${pseudo}(): ${grund}` }; }
				}
				k = ende + 1;
				continue;
			}
			return { grund: "Doppelpunkt ohne Namen dahinter" };
		}
		break;
	}
	if (k === start) { return { grund: `kein Selektor bei ${beschreibe(s[k])}` }; }
	return { ende: k };
}

function pruefeKomplex(s, relativ) {
	if (s.length === 0) { return "leerer Selektor"; }
	let k = 0;
	if (relativ && istKombinator(s[k])) {
		k++;
		while (s[k] && s[k].typ === "ws") { k++; }
	}
	for (;;) {
		const kompound = pruefeKompound(s, k);
		if (kompound.grund) { return kompound.grund; }
		k = kompound.ende;
		if (k >= s.length) { return null; }
		let leerraum = false;
		while (s[k] && s[k].typ === "ws") { leerraum = true; k++; }
		if (istKombinator(s[k])) {
			k++;
			while (s[k] && s[k].typ === "ws") { k++; }
			if (k >= s.length) { return "Kombinator ohne Selektor dahinter"; }
		} else if (!leerraum) {
			return `unerwartet: ${beschreibe(s[k])}`;
		}
	}
}

function pruefeSelektorliste(tokens, relativ) {
	for (const teil of teileAnKomma(tokens)) {
		const grund = pruefeKomplex(ohneRandLeerraum(teil), relativ);
		if (grund) { return grund; }
	}
	return null;
}

function pruefeKeyframeSelektoren(tokens) {
	for (const teil of teileAnKomma(tokens)) {
		const s = ohneRandLeerraum(teil);
		const t = s[0];
		const gueltig = s.length === 1
			&& ((t.typ === "ident" && /^(from|to)$/i.test(t.wert)) || (t.typ === "zahl" && t.einheit === "%"));
		if (!gueltig) { return "ungueltiger Keyframe-Selektor"; }
	}
	return null;
}

// ---- Regeln, @-Regeln, Deklarationen --------------------------------------------------------------

// Sammelt Tokens bis zu einem Stopper auf Klammertiefe 0; Klammern und Bloecke kommen ausbalanciert
// mit. Der Stopper selbst wird NICHT verbraucht (null = Dateiende).
function sammle(zustand, stopper) {
	const werte = [];
	const offen = [];
	while (zustand.i < zustand.tokens.length) {
		const t = zustand.tokens[zustand.i];
		if (offen.length === 0 && stopper.includes(t.typ)) { return { werte, stopp: t }; }
		if (t.typ === "(" || t.typ === "funktion") { offen.push(")"); }
		else if (t.typ === "[") { offen.push("]"); }
		else if (t.typ === "{") { offen.push("}"); }
		else if (offen.length && t.typ === offen[offen.length - 1]) { offen.pop(); }
		werte.push(t);
		zustand.i++;
	}
	return { werte, stopp: null };
}

function befund(zustand, zeile, grund, tokens) {
	const auszug = alsText(tokens);
	zustand.befunde.push({ zeile, grund, auszug: auszug.length > 90 ? auszug.slice(0, 87) + "..." : auszug });
}

const REGELLISTEN_AT = new Set(["media", "supports", "container", "layer", "document", "scope", "starting-style"]);
const DEKLARATIONS_AT = new Set(["font-face", "page", "property", "counter-style", "font-palette-values", "view-transition"]);

function parseAtRegel(zustand) {
	const at = zustand.tokens[zustand.i];
	zustand.i++;
	const name = at.wert.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, "");
	const { stopp } = sammle(zustand, [";", "{", "}"]);
	if (!stopp || stopp.typ !== "{") {
		if (stopp && stopp.typ === ";") { zustand.i++; }
		return;
	}
	zustand.i++;
	if (REGELLISTEN_AT.has(name)) {
		parseRegelliste(zustand, "verschachtelt");
	} else if (name === "keyframes") {
		parseRegelliste(zustand, "keyframes");
	} else if (DEKLARATIONS_AT.has(name)) {
		parseDeklarationen(zustand, { selektor: "@" + name, deklarationen: [] });
	} else {
		sammle(zustand, ["}"]);
		zustand.i++;
	}
}

function pruefeDeklaration(werte) {
	const s = ohneRandLeerraum(werte);
	if (s[0].typ !== "ident") { return { grund: `Deklaration beginnt mit ${beschreibe(s[0])} statt mit einem Eigenschaftsnamen` }; }
	let k = 1;
	while (s[k] && s[k].typ === "ws") { k++; }
	if (!s[k] || s[k].typ !== ":") { return { grund: `nach „${s[0].wert}" fehlt der Doppelpunkt` }; }
	const eigenschaft = s[0].wert;
	const wert = ohneRandLeerraum(s.slice(k + 1));
	if (!eigenschaft.startsWith("--")) {
		if (wert.length === 0) { return { grund: `„${eigenschaft}" ohne Wert` }; }
		if (wert.some((t) => t.typ === "{")) { return { grund: `Regelblock im Wert von „${eigenschaft}" (fehlt eine schliessende Klammer?)` }; }
	}
	return { eigenschaft: eigenschaft.toLowerCase(), wert: alsText(wert) };
}

function parseDeklarationen(zustand, regel) {
	while (zustand.i < zustand.tokens.length) {
		const t = zustand.tokens[zustand.i];
		if (t.typ === "ws" || t.typ === ";") { zustand.i++; continue; }
		if (t.typ === "}") { zustand.i++; return; }
		if (t.typ === "at") { parseAtRegel(zustand); continue; }
		const { werte, stopp } = sammle(zustand, [";", "}"]);
		const ergebnis = pruefeDeklaration(werte);
		if (ergebnis.grund) {
			befund(zustand, t.zeile, ergebnis.grund, werte);
		} else {
			regel.deklarationen.push(ergebnis);
		}
		if (!stopp) { break; }
	}
	befund(zustand, zustand.tokens[zustand.tokens.length - 1].zeile, `Regelblock von „${regel.selektor}" geht nicht zu`, []);
}

function parseRegelliste(zustand, art) {
	while (zustand.i < zustand.tokens.length) {
		const t = zustand.tokens[zustand.i];
		if (t.typ === "ws") { zustand.i++; continue; }
		if (t.typ === "}" && art !== "stylesheet") { zustand.i++; return; }
		if (t.typ === "at") { parseAtRegel(zustand); continue; }
		const { werte, stopp } = sammle(zustand, art === "stylesheet" ? ["{"] : ["{", "}"]);
		if (!stopp || stopp.typ !== "{") {
			befund(zustand, t.zeile, "Text ohne Regelblock", werte);
			continue;
		}
		zustand.i++;
		const kopf = ohneRandLeerraum(werte);
		const grund = art === "keyframes" ? pruefeKeyframeSelektoren(kopf) : pruefeSelektorliste(kopf, false);
		const regel = { zeile: t.zeile, selektor: alsText(kopf), deklarationen: [] };
		if (grund) {
			befund(zustand, t.zeile, `ungueltiger Regelkopf -- ${grund}`, kopf);
		}
		parseDeklarationen(zustand, regel);
		if (!grund) { zustand.regeln.push(regel); }
	}
	if (art !== "stylesheet") {
		befund(zustand, zustand.tokens[zustand.tokens.length - 1].zeile, "@-Block geht nicht zu", []);
	}
}

function lies(text) {
	const zustand = { tokens: tokenisiere(text), i: 0, regeln: [], befunde: [] };
	parseRegelliste(zustand, "stylesheet");
	return zustand;
}

// ---- Gegenprobe: der Pruefer selbst ---------------------------------------------------------------
//
// 💣 Zuerst an Text, dessen Antwort feststeht -- ein Pruefer, der nie etwas findet, sieht ueber dem
// Repo genau so aus wie ein Repo ohne Fehler.

// Der Fehler vom 04.09.2026 in seiner echten Form: Absatz hinter dem `*/`, direkt vor der Regel.
const FEHLER_VOM_04_09 = [
	"/* Die vier umgestellten Blaetter: die Knopfleiste STEHT.",
	"   Wer eines von beiden aendert, aendert beide. */",
	"   🪤 Und DASS es beim Intro-Blatt ueberhaupt klebt, hat einen subtileren Grund als die drei",
	"      anderen: dort ist die Leiste ein GESCHWISTER des Rumpfes, kein Kind. `position: sticky`",
	"      kein Clipping, Polster 6/14, Knopf vollstaendig sichtbar.",
	".ecosystem-assign-dialog__actions,",
	".label-assign-dialog__actions {",
	"\tposition: sticky;",
	"}",
].join("\r\n");
const alt = lies(FEHLER_VOM_04_09);
assert.strictEqual(alt.befunde.length, 1, "der Fehler vom 04.09.2026 wird gefunden:\n" + JSON.stringify(alt.befunde));
assert.strictEqual(alt.befunde[0].zeile, 3, "und an der Zeile, an der die Prosa beginnt");
assert.strictEqual(alt.regeln.length, 0, "die verschluckte Regel zaehlt nicht als Regel");

const REPARIERT = FEHLER_VOM_04_09.replace("aendert beide. */", "aendert beide.").replace("sichtbar.\r\n", "sichtbar. */\r\n");
const neu = lies(REPARIERT);
assert.deepStrictEqual(neu.befunde, [], "repariert ist er gruen");
assert.strictEqual(neu.regeln.length, 1);
assert.deepStrictEqual(neu.regeln[0].deklarationen, [{ eigenschaft: "position", wert: "sticky" }]);

// Prosa aus lauter Woertern ist fuer den Browser ein GUELTIGER Selektor -- er behaelt die Regel,
// sie trifft nur nie etwas. Genau deshalb prueft der Test Elementnamen.
const nurWoerter = lies("/* Kopf */\nWer eines aendert aendert beide\n.foo { color: red; }\n");
assert.strictEqual(nurWoerter.befunde.length, 1, "Prosa ohne Satzzeichen vor einer Regel wird gefunden");
assert.match(nurWoerter.befunde[0].grund, /„Wer" ist kein Element/);

// Und mitten in einem Regelblock verschluckt die Prosa die Deklaration, an die sie stoesst.
const imBlock = lies(".foo {\n\tcolor: red; /* erster Absatz */\n\tzweiter Absatz, ausserhalb.\n\tpadding: 0;\n}\n");
assert.strictEqual(imBlock.befunde.length, 1, "Prosa im Regelblock wird gefunden");
assert.strictEqual(imBlock.befunde[0].zeile, 3);

// Gegenproben in die andere Richtung: Formen, die dieses Haus wirklich schreibt, bleiben gruen.
const gueltig = lies([
	"@charset \"utf-8\";",
	"@import url(\"base/tokens.css\");",
	":root:not([data-theme=\"light\"]) { --x: 1px; --leer:; }",
	".a > .b + .c ~ .d, :where(.avm-editor-body) button, #map-corner-actions:has(> .m:not([hidden])) { color: red !important; }",
	"li:nth-child(2n+1)::before, input[type=checkbox i], a[href^='http']::after, svg path, *::-webkit-scrollbar { margin: 0; }",
	".x { background: url(data:image/svg+xml;utf8,<svg><path d='M0,0'/></svg>) no-repeat; }",
	"@media (prefers-color-scheme: dark) { :root:not([data-theme=\"light\"]) { --y: 2px; } }",
	"@supports selector(:has(a)) { .z { display: grid; } }",
	"@keyframes blende { from { opacity: 0; } 50%, to { opacity: 1; } }",
	"@font-face { font-family: Test; src: url(test.woff2) format(\"woff2\"); }",
	"my-element { display: block; }",
].join("\n"));
assert.deepStrictEqual(gueltig.befunde, [], "gueltiges CSS bleibt gruen:\n" + JSON.stringify(gueltig.befunde, null, 2));
assert.strictEqual(gueltig.regeln.length, 9, "und alle Regeln werden gesehen (in den @-Bloecken und die zwei Keyframe-Regeln mitgezaehlt)");

// ---- Das Repo -------------------------------------------------------------------------------------

function alleCssDateien(verzeichnis) {
	const gefunden = [];
	for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
		const voll = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			gefunden.push(...alleCssDateien(voll));
		} else if (eintrag.name.endsWith(".css")) {
			gefunden.push(voll);
		}
	}
	return gefunden;
}

const dateien = alleCssDateien(path.join(ROOT, "css"));
assert.ok(dateien.length > 50, `der Laeufer muss die CSS-Dateien wirklich finden -- gesehen: ${dateien.length}`);

const kaputt = [];
let regelnGesamt = 0;
const gelesen = new Map();
for (const datei of dateien) {
	const ergebnis = lies(fs.readFileSync(datei, "utf8"));
	const relativ = path.relative(ROOT, datei).replace(/\\/g, "/");
	gelesen.set(relativ, ergebnis);
	regelnGesamt += ergebnis.regeln.length;
	for (const b of ergebnis.befunde) {
		kaputt.push(`${relativ}:${b.zeile} -- ${b.grund}\n      ${b.auszug}`);
	}
}

// 💣 Zusicherung auf die MENGE: ein Zerleger, der an der ersten @-Regel aussteigt, meldet ebenfalls
// „keine Befunde".
assert.ok(regelnGesamt > 3000, `der Zerleger muss die Regeln wirklich sehen -- gesehen: ${regelnGesamt}`);

assert.deepStrictEqual(kaputt, [],
	"Text steht AUSSERHALB eines Kommentars (oder ein Regelkopf ist kaputt); der Browser verwirft die Regel still:\n  "
	+ kaputt.join("\n  "));

// ---- Und die Stelle, die es erwischt hat, namentlich ----------------------------------------------
//
// 💣 Faengt: der Kommentar ist repariert, aber die Regel, die er verschluckt hatte, ist beim
// Reparieren nicht mehr die, die der Kommentar beschreibt.
const oekosystem = gelesen.get("css/features/ecosystem-layer.css");
const klebeleiste = oekosystem.regeln.find((r) => [
	".ecosystem-assign-dialog__actions",
	".label-assign-dialog__actions",
	".ecosystem-transfer-dialog__actions",
].every((klasse) => r.selektor.split(",").map((teil) => teil.trim()).includes(klasse)));
assert.ok(klebeleiste, 'die Knopfleisten von „Flaeche zuweisen", „Label zuweisen" und dem Uebertragen-Dialog sind EINE gueltige Regel');
assert.ok(klebeleiste.deklarationen.some((d) => d.eigenschaft === "position" && d.wert === "sticky"),
	"und sie kleben unten (position: sticky)");

// 💣 Und sie kleben BUENDIG. Der Rumpf ist hier das Formular und traegt ein Polster; `sticky` richtet
// sich nach dessen CONTENT-Box. Mit `bottom: 0` steht die Leiste deshalb um das Polster UEBER der
// Unterkante, und in diesem Streifen scrollt Inhalt sichtbar durch -- am 14.09.2026 im Browser
// gemessen: 18px, darin „Art" und „Originalflaeche loeschen". Polster, negativer Aussenrand und
// negativer `bottom` sind EIN Wert; getrennt geschrieben stimmen sie heute und beim naechsten Mal nicht.
const deklaration = (regel, name) => (regel.deklarationen.find((d) => d.eigenschaft === name) || {}).wert;
const rumpf = oekosystem.regeln.find((r) => deklaration(r, "padding") && [
	".ecosystem-transfer-dialog__form",
	".ecosystem-assign-dialog__form",
	".label-assign-dialog__form",
].every((klasse) => r.selektor.split(",").map((teil) => teil.trim()).includes(klasse)));
assert.ok(rumpf, "der Rumpf der drei Blaetter traegt sein Polster in EINER Regel");
const polster = deklaration(rumpf, "padding");
assert.ok(/^var\(--[\w-]+\)$/.test(polster), `das Polster des Rumpfes ist EIN Token -- gesehen: ${polster}`);
const aufgehoben = `calc(-1 * ${polster})`;
assert.strictEqual(deklaration(klebeleiste, "bottom"), aufgehoben,
	"die Leiste klebt um genau das Polster tiefer -- buendig an der Unterkante, kein Streifen darunter");
assert.ok(String(deklaration(klebeleiste, "margin")).endsWith(` ${aufgehoben} ${aufgehoben}`),
	`und ihr Aussenrand hebt dasselbe Polster rechts und unten auf -- gesehen: ${deklaration(klebeleiste, "margin")}`);

console.log(`css-prosa-ausserhalb-kommentar: ${dateien.length} Dateien, ${regelnGesamt} Regeln geprueft, kein Text ausserhalb eines Kommentars`);
