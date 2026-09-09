// Eigennamen werden NICHT vom Woerterbuch getrennt -- und laufen trotzdem nicht ueber.
// ===================================================================================
// Discord-Fall #119 (Nottel, 09.09.2026): „Fehlerhafte Silbentrennung im Kasten Fauna.
// Andere Kaesten auch pruefen."
//
// Ursache, live in Chrome nachgemessen: `.region-info-box__row dd` traegt `hyphens: auto`
// (location-popups-markers.css) -- fuer FLIESSTEXT gedacht und dort richtig. Die Namens-
// listen der Vorkommen (Waren/Fauna/Flora/Spezies) und der Besonderen Staetten stehen
// aber in genau diesen dd-Zellen und ERBEN es. Die deutsche Trennhilfe raet dann an
// aventurischen Eigennamen: „Totenko-pfaeffchen" (richtig waere Totenkopf-aeffchen),
// „Maraskant-arantel", „Regenbogenan-beter", „Tuz-aker", „Ku-ckucks-Otter" -- dazu
// Trennungen nach zwei Buchstaben („Ma-raskanfeder"). Allein in Gareths Staetten-Deckel
// waren es 168 getrennte Namen, im Was-ist-hier-Panel auf Maraskan 40 in einer Liste.
//
// 💣 DIE ZWEITE HAELFTE IST DER GRUND, WARUM MAN `hyphens` HIER UEBERHAUPT ANFASSEN DARF:
//    `overflow-wrap: anywhere` MUSS stehen bleiben. Es faengt die Namen, die auch
//    ungetrennt breiter sind als die gemessenen 91px der Namensspalte
//    (Khoramsflederechse, Maraskankakerlake). Ohne es laufen sie waagerecht aus ihrer
//    Spalte heraus -- live gemessen 249px Inhalt in einem 225px-Kasten. Wer also die
//    Trennung abschaltet und dabei `anywhere` „mit aufraeumt", tauscht einen falschen
//    Trennstrich gegen einen Ueberlauf. Dieser Test haelt BEIDE Zeilen zusammen.
//
// ⚠️ `manual`, nicht `none`: an einem echten Bindestrich („Amdeggyn-Springsalamander")
//    und am Leerzeichen wird weiter umbrochen. Das war nie das Problem, und `none`
//    verboete es auch nicht -- aber `manual` sagt die Absicht („nur, wo wir es hinschreiben").
//
// 🪤 Der Kommentar ueber der Regel nennt die Woerter `hyphens`, `manual` und `anywhere`
//    selbst. Ein Test, der die Datei blank durchsucht, ist deshalb ein VAKUUM: er bliebe
//    gruen, wenn nur noch der Kommentar davon spraeche. Gemessen wird darum ausschliesslich
//    der RUMPF der Regel, mit vorher entfernten Kommentaren.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/eigennamen-ohne-silbentrennung.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const regeln = (css) => Array.from(ohneKommentare(css).matchAll(/([^{}]+)\{([^}]*)\}/g))
	.map((m) => ({ sel: m[1].trim(), rumpf: m[2] }));

// ---- 1. Die Namensliste trennt nicht automatisch, faengt aber den Ueberlauf -------------------
{
	const lore = regeln(lies("css/features/lore.css"));
	const treffer = lore.filter((r) => r.sel === ".avesmaps-lore__names");
	assert.strictEqual(treffer.length, 1,
		".avesmaps-lore__names muss GENAU EINE Regel haben -- zwei koennen auseinanderlaufen.");
	const rumpf = treffer[0].rumpf;

	assert.match(rumpf, /(^|[^-])hyphens:\s*manual\s*;/,
		"Die Namenslisten der Vorkommen und Staetten duerfen NICHT vom Woerterbuch getrennt "
		+ "werden (Fall #119): `hyphens: manual` fehlt im Rumpf von .avesmaps-lore__names.");
	assert.match(rumpf, /-webkit-hyphens:\s*manual\s*;/,
		"Das -webkit-Praefix steht in diesem Haus neben jeder hyphens-Zeile -- ohne es trennen "
		+ "aeltere WebKit-Fassungen weiter.");
	assert.match(rumpf, /overflow-wrap:\s*anywhere\s*;/,
		"overflow-wrap: anywhere MUSS bleiben: es ist der einzige Riegel gegen Namen, die "
		+ "breiter sind als ihre 91px-Spalte (Khoramsflederechse). Ohne ihn laeuft die Liste "
		+ "waagerecht aus dem Kasten.");
	assert.doesNotMatch(rumpf, /hyphens:\s*auto/,
		"hyphens: auto ist genau der gemeldete Fehler -- es darf hier nicht zurueckkommen.");
}

// ---- 2. Die geteilte Fliesstext-Regel bleibt unangetastet ------------------------------------
// Sie ist der GRUND, aus dem die Ausnahme oben noetig ist. Faellt sie weg, ist die Ausnahme
// wirkungslos geworden, ohne dass es jemandem auffiele -- und die naechste Sitzung raeumt sie
// als „ueberfluessig" weg.
{
	const popups = regeln(lies("css/features/location-popups-markers.css"));
	const geteilt = popups.find((r) => /\.region-info-box__row dd\b/.test(r.sel)
		&& /hyphens:/.test(r.rumpf));
	assert.ok(geteilt,
		"Die geteilte Regel `.region-info-box__row dd { hyphens: auto }` ist weg. Dann ist "
		+ "`hyphens: manual` in lore.css keine Ausnahme mehr, sondern eine Zeile ohne Gegenstand "
		+ "-- beide gehoeren gemeinsam geprueft.");
	assert.match(geteilt.rumpf, /hyphens:\s*auto\s*;/,
		"Die geteilte Regel soll Fliesstext weiterhin trennen -- nur Eigennamen nicht.");
}

// ---- 3. Jeder Name geht wirklich durch .avesmaps-lore__names ---------------------------------
// Die Ausnahme haengt an DIESER einen Huelle. Baut jemand einen zweiten Erzeuger, der die
// Namen ohne sie ausgibt, trennt das Woerterbuch dort wieder -- und der Test oben bliebe gruen.
{
	const lore = lies("js/map-features/map-features-lore.js");
	const staetten = lies("js/map-features/map-features-settlement-places.js");
	const quelle = ohneKommentare(lore + staetten).replace(/\/\/[^\n]*/g, "");

	const namen = quelle.match(/avesmaps-lore__name(?!s)/g) || [];
	assert.strictEqual(namen.length, 1,
		"Es gibt genau EINEN Erzeuger fuer einen Lore-Namen (avesmapsLoreNameMarkup). Kommt ein "
		+ "zweiter dazu, muss er ebenfalls in .avesmaps-lore__names stehen -- sonst trennt das "
		+ "Woerterbuch dort weiter.");

	const huellen = quelle.match(/avesmaps-lore__names/g) || [];
	assert.ok(huellen.length >= 3,
		"Die drei bekannten Ausgabewege (kurze Liste, Buchstabenblock, Staetten-Rueckfall) "
		+ "muessen die Huelle .avesmaps-lore__names setzen; gefunden: " + huellen.length);
}

console.log("eigennamen-ohne-silbentrennung: alle Zusicherungen erfuellt");
