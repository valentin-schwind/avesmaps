// Kommentare in CSS muessen sich schliessen -- und zwar genau einmal.
//
// 💣 WARUM DAS EINEN EIGENEN TEST BRAUCHT: ein ueberzaehliges `*/` erzeugt KEINEN Fehler. Die Datei
// laedt, der Browser meldet nichts, im Editor sieht alles aus wie Prosa. Der CSS-Parser aber liest
// den Text danach als Deklaration und verwirft ihn bis zum naechsten Semikolon -- und mit ihm die
// Regel oder das Token, das dort zufaellig steht.
//
// Zweimal passiert, beide Male unbemerkt:
//   • css/base/tokens.css (03.08.2026, gefunden am 12.08.): verschluckte
//     `--color-ecosystem-klima`, den Rueckfallton der Klimazonen. Neun Tage lang nicht definiert,
//     waehrend die sieben Baender daneben standen -- sichtbar erst, wenn der Rueckfall greift.
//   • css/components/map-display-menu.css (12.08.2026): verschluckte die Regel, die den Knopfbund
//     ueber die Routenplaner-Lasche hebt. Der Owner meldete „die lasche ist immer noch über dem
//     menü", und die Suche ging zuerst in die Stapelordnung -- der Fehler lag 200 Zeilen davor.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/css-comment-balance.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

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

/**
 * Zaehlt Kommentar-Tiefe zeichenweise.
 * ⚠️ Nicht per Regex ueber die beiden Zeichenpaare zaehlen: in einem Wert wie einer url() oder in
 * einer Zeichenkette stuenden sie ohne Bedeutung. Wir folgen deshalb dem Text und ueberspringen
 * einfache wie doppelte Anfuehrungszeichen -- so, wie der Parser es auch tut.
 * (Diese Zeile selbst nennt die Zeichen bewusst nicht: sie wuerden diesen Kommentar schliessen.)
 */
function pruefeDatei(text) {
	let i = 0, tiefe = 0, zeile = 1;
	const befunde = [];
	while (i < text.length) {
		const z = text[i];
		if (z === "\n") { zeile++; i++; continue; }
		if (tiefe === 0 && (z === '"' || z === "'")) {
			const ende = z;
			i++;
			while (i < text.length && text[i] !== ende) {
				if (text[i] === "\\") { i++; }
				if (text[i] === "\n") { zeile++; }
				i++;
			}
			i++;
			continue;
		}
		if (z === "/" && text[i + 1] === "*") { tiefe++; i += 2; continue; }
		if (z === "*" && text[i + 1] === "/") {
			tiefe--;
			if (tiefe < 0) {
				befunde.push({ zeile, art: "ueberzaehliges */" });
				tiefe = 0;
			}
			i += 2;
			continue;
		}
		i++;
	}
	if (tiefe > 0) { befunde.push({ zeile, art: "nicht geschlossener Kommentar" }); }
	return befunde;
}

const dateien = alleCssDateien(path.join(ROOT, "css"));

// 💣 Zusicherung auf die MENGE. Ein Laeufer, der nichts findet, weil er nichts betreten hat, ist
// der gefaehrlichste gruene Test -- genau so hat ein CSSOM-Laeufer am 12.08.2026 stundenlang
// „keine Regel gefunden" gemeldet, obwohl 3000 dastanden.
assert.ok(dateien.length > 50,
	`der Laeufer muss die CSS-Dateien wirklich finden -- gesehen: ${dateien.length}`);

const kaputt = [];
for (const datei of dateien) {
	const befunde = pruefeDatei(fs.readFileSync(datei, "utf8"));
	for (const b of befunde) {
		kaputt.push(`${path.relative(ROOT, datei).replace(/\\/g, "/")}:${b.zeile} -- ${b.art}`);
	}
}

assert.deepStrictEqual(kaputt, [],
	"CSS-Kommentare sind unbalanciert; alles nach der Stelle wird stillschweigend verworfen:\n  "
	+ kaputt.join("\n  "));

// ---- Und die zwei Stellen, die es schon einmal erwischt hat, namentlich ---------------------------
//
// 💣 Faengt: die Balance stimmt wieder, aber das, was der Fehler verschluckt hatte, ist beim
// Reparieren nicht zurueckgekommen. Die Balance ist die Ursache, diese zwei sind die Wirkung.
const tokens = fs.readFileSync(path.join(ROOT, "css", "base", "tokens.css"), "utf8");
assert.ok(/--color-ecosystem-klima:\s*#[0-9a-fA-F]{3,8}/.test(tokens),
	"--color-ecosystem-klima ist definiert (der Rueckfallton der Klimazonen)");

const menue = fs.readFileSync(path.join(ROOT, "css", "components", "map-display-menu.css"), "utf8");
assert.ok(/#map-corner-actions:has\(\.map-display-menu:not\(\[hidden\]\)\)/.test(menue),
	"die Regel, die den Knopfbund ueber die Routenplaner-Lasche hebt, steht in der Datei");

console.log(`css-comment-balance: ${dateien.length} Dateien geprueft, alle Kommentare geschlossen`);
