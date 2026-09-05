"use strict";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Die Adressen in den „Neuigkeiten" sind Links — und externe tragen Farbe und Pfeil.
//
// Owner 05.09.2026: „kannst du in den nachrichten in ‚Neuigkeiten' externe links gemaess
// unserer regeln markieren." Die Regel steht in AGENTS.md §12: Links lesen --color-link
// (goldbraun, nie blau), und ein Link nach ausserhalb bekommt ein nachlaufendes ↗.
//
// 🚩 Gemessen am Livebestand 05.09.2026: 82 Eintraege, davon 3 mit einer Adresse im Text --
//    und alle drei standen als KLARTEXT da. `changelog-dialog.js` baut per textContent, es gab
//    also nicht einen einzigen klickbaren Link im ganzen Fenster. Die CSS-Regel fuer den Pfeil
//    lief seit Monaten ins Leere: sie gilt `.changelog-dialog__foot a`, und dort gibt es
//    ebenfalls keinen (die Fusszeile nennt Discord im Fliesstext, ohne Verweis).
//
// 🔴 GEBAUT WIRD WEITER PER DOM, NIE PER innerHTML. Der Dateikopf von changelog-dialog.js sagt
//    warum: die Eintraege sind Datenbankinhalt und gehen grundsaetzlich nicht als Markup ins
//    DOM. Der Text wird deshalb in SEGMENTE zerlegt -- eine reine Funktion ohne DOM --, und der
//    Renderer haengt daraus Textknoten und <a> an. Wer das je auf innerHTML umstellt, macht aus
//    einem Eintragstext eine Skriptquelle.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8");

const quelle = lies("js", "app", "changelog-dialog.js");

// Nur die reine Funktion herausschneiden und ausfuehren -- die IIFE darunter braucht ein DOM.
// 🪤 Gesucht wird bis zur schliessenden Klammer AUF SPALTE 0; ein Klammerzaehler, der am ersten
//    `{` nach dem Funktionskopf beginnt, endet bei einem `options = {}` nach zwei Zeichen
//    (dieselbe Falle wie beim Landschafts-Umzug, AGENTS.md §11).
const anfang = quelle.indexOf("function avesmapsChangelogTextSegmente");
assert.ok(anfang > -1, "es gibt die reine Funktion avesmapsChangelogTextSegmente");
const rumpf = quelle.slice(anfang);
// zeilenendenneutral: erst \r\n, dann \n -- und NIE ueber `||` auf ein indexOf (AGENTS.md §9)
let ende = rumpf.indexOf("\r\n}");
let laenge = ende > -1 ? ende + 3 : -1;
if (laenge < 0) {
	ende = rumpf.indexOf("\n}");
	laenge = ende > -1 ? ende + 2 : rumpf.length;
}
const kontext = { console };
vm.createContext(kontext);
vm.runInContext(rumpf.slice(0, laenge), kontext);
// 🪤 BEIDE Ebenen muessen Host-Objekte werden. Ein Array aus dem vm-Kontext traegt einen fremden
//    Array.prototype, seine Elemente einen fremden Object.prototype -- `deepStrictEqual` faellt
//    dann bei zeichengleichem Inhalt, und die Fehlermeldung zeigt zwei identische Strukturen
//    nebeneinander. `.map()` allein reicht NICHT: es liefert wieder ein vm-Array.
const segmente = (t) => [...kontext.avesmapsChangelogTextSegmente(t)].map((s) => ({ ...s }));

// ---- 1 · Text ohne Adresse bleibt ein Stueck --------------------------------------------------
assert.deepStrictEqual(segmente("Nur Text, keine Adresse."),
	[{ art: "text", wert: "Nur Text, keine Adresse." }],
	"ein Text ohne Adresse ist genau EIN Segment");
assert.deepStrictEqual(segmente(""), [], "leerer Text ergibt gar kein Segment");

// ---- 2 · Der echte Livefall: Adresse am Satzende, mit Punkt -----------------------------------
//
// 💣 DIE FALLE DIESER AUFGABE. Der Eintrag vom 04.09.2026 endet auf
//    „…YouTube Kanal vom SteamTinkerer: https://www.youtube.com/watch?v=gBJn-d_B3w4."
//    Der Punkt gehoert dem SATZ, nicht der Adresse -- ein naiver Greifer nimmt ihn mit, und der
//    Link fuehrt auf eine Videokennung, die es nicht gibt. Er faellt nicht auf: der Link sieht
//    richtig aus, YouTube antwortet mit seiner eigenen Fehlerseite, und niemand vermutet die
//    Ursache im Changelog.
assert.deepStrictEqual(
	segmente("Aufnahme hier: https://www.youtube.com/watch?v=gBJn-d_B3w4."),
	[{ art: "text", wert: "Aufnahme hier: " },
	 { art: "link", wert: "https://www.youtube.com/watch?v=gBJn-d_B3w4",
	   adresse: "https://www.youtube.com/watch?v=gBJn-d_B3w4" },
	 { art: "text", wert: "." }],
	"der Satzpunkt bleibt Text und wandert NICHT in die Adresse");

// Und die uebrigen Satzzeichen ebenso.
[",", ";", ":", "!", "?", "…"].forEach((z) => {
	const s = segmente("x https://avesmaps.de/a" + z);
	assert.strictEqual(s[1].adresse, "https://avesmaps.de/a",
		`„${z}" am Ende gehoert dem Satz, nicht der Adresse`);
	assert.strictEqual(s[2].wert, z, `und bleibt als Text stehen`);
});

// ---- 3 · Klammern: die unbalancierte faellt weg, die gehoerende bleibt ------------------------
//
// ⚠️ Wikipedia-Adressen tragen Klammern IM Pfad (`…/Aventurien_(Welt)`). Wer stumpf jede
//    schliessende Klammer abschneidet, zerlegt genau die Adressen, die eine brauchen; wer keine
//    abschneidet, schluckt die Klammer eines eingeklammerten Satzes. Gezaehlt wird deshalb.
assert.strictEqual(segmente("(siehe https://avesmaps.de/x)")[1].adresse, "https://avesmaps.de/x",
	"eine schliessende Klammer OHNE oeffnende in der Adresse gehoert dem Satz");
assert.strictEqual(
	segmente("siehe https://de.wikipedia.org/wiki/Aventurien_(Welt)")[1].adresse,
	"https://de.wikipedia.org/wiki/Aventurien_(Welt)",
	"eine Klammer MIT Gegenstueck in der Adresse bleibt drin");

// ---- 4 · Mehrere Adressen, und Adressen am Rand -----------------------------------------------
const zwei = segmente("a https://x.de/1 b https://y.de/2 c");
assert.strictEqual(zwei.filter((s) => s.art === "link").length, 2, "zwei Adressen, zwei Links");
assert.strictEqual(zwei[0].wert, "a ", "der Text davor bleibt erhalten");
assert.strictEqual(zwei[4].wert, " c", "und der dahinter auch");
assert.strictEqual(segmente("https://x.de/1")[0].art, "link",
	"eine Adresse ganz allein ist ein Link, kein Text");

// ---- 5 · Was KEINE Adresse ist -----------------------------------------------------------------
//
// 🔴 Erkannt wird ausschliesslich `http://` und `https://`. Das ist der Riegel gegen
//    `javascript:`-Verweise aus Datenbankinhalt -- und zugleich der Grund, warum ein nacktes
//    „www.example.de" NICHT verlinkt wird: ob eine Zeichenkette mit Punkt eine Adresse ist,
//    kann man nur raten, und ein geratener Link im Fliesstext ist schlimmer als keiner.
// ⭐ ES SIND ZWEI RIEGEL, und das ist gemessen, nicht behauptet: das Suchmuster und die Pruefung
//    nach dem Satzzeichen-Schnitt. Mutationsprobe 05.09.2026 -- jeden EINZELN auf `\w+://`
//    gelockert bleibt diese Zusicherung gruen (der jeweils andere faengt es), BEIDE zusammen
//    gelockert wird sie rot. Wer hier also einen der beiden als „doppelt" wegraeumt, sieht keinen
//    roten Test und hat trotzdem die halbe Sicherung verloren. Sie bleiben beide.
["javascript:alert(1)", "data:text/html,x", "ftp://x.de", "www.avesmaps.de", "avesmaps.de"]
	.forEach((s) => {
		assert.deepStrictEqual(segmente("vor " + s + " nach"),
			[{ art: "text", wert: "vor " + s + " nach" }],
			`„${s}" wird NICHT zum Link -- nur http und https zaehlen`);
	});

// ---- 6 · Der Renderer benutzt sie wirklich -----------------------------------------------------
//
// 💣 Eine reine Funktion, die niemand ruft, ist gruen und wirkungslos -- genau die Luecke, die
//    `citymaps-suggest-form.test.js` am 04.09.2026 gekostet hat („ein Bauer ohne Aufrufer").
//    Deshalb wird der Quelltext des Renderers gemessen, nicht nur die Regel.
const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.ok(/avesmapsChangelogTextSegmente\s*\(/.test(
	ohneKommentare.slice(ohneKommentare.indexOf("changelog-entry__text"))),
	"der Renderer des Eintragstextes ruft die Regel wirklich");
assert.ok(!/\.innerHTML\s*=/.test(ohneKommentare),
	"und baut weiterhin OHNE innerHTML -- Eintraege sind Datenbankinhalt");
assert.ok(/createTextNode/.test(ohneKommentare),
	"die Textstuecke gehen als Textknoten ins DOM");
assert.ok(/rel\s*=\s*["']noopener noreferrer["']|setAttribute\(\s*["']rel["']\s*,\s*["']noopener noreferrer["']/
	.test(ohneKommentare),
	"jeder gebaute Link traegt rel=noopener noreferrer -- Pflicht neben target=_blank");

// ---- 7 · Farbe und Pfeil stehen in EINER Regel mit der Fusszeile --------------------------------
//
// 🔴 AGENTS.md §12: Links lesen --color-link, externe bekommen ein nachlaufendes ↗. Beides steht
//    fuer Eintragstext und Fusszeile in DERSELBEN Selektorliste -- abgeschriebene Werte waeren
//    die Divergenz, vor der §12 warnt, und die Fusszeile trug die Regel schon.
const css = lies("css", "components", "changelog-dialog.css").replace(/\/\*[\s\S]*?\*\//g, "");
const farbregel = /([^{}]*\.changelog-entry__text a[^{}]*)\{([^}]*)\}/.exec(css);
assert.ok(farbregel, "es gibt eine Regel fuer die Links im Eintragstext");
assert.ok(/--color-link/.test(farbregel[2]), "sie liest --color-link, nie einen eigenen Ton");
assert.ok(/\.changelog-dialog__foot a/.test(farbregel[1]),
	"und die Fusszeile steht in DERSELBEN Liste -- zwei Regeln waeren zwei Wahrheiten");

const pfeilregel = /([^{}]*\.changelog-entry__text a\[target="_blank"\][^{}]*)\{([^}]*)\}/.exec(css);
assert.ok(pfeilregel, "es gibt eine Pfeilregel fuer externe Links im Eintragstext");
assert.ok(/content:\s*" ↗"/.test(pfeilregel[2]), "der Pfeil ist ↗, wie ueberall im Haus");
assert.ok(/\.changelog-dialog__foot a\[target="_blank"\]/.test(pfeilregel[1]),
	"auch hier gemeinsam mit der Fusszeile");

// ⚠️ Und die lange Adresse muss umbrechen duerfen. Der Eintrag vom 14.08.2026 traegt eine
//    88 Zeichen lange Adresse; ohne das schiebt sie die Spalte auf oder haengt dem Rumpf eine
//    waagerechte Bildlaufleiste an -- in einem Fenster, das gerade erst seine Kante bekommen hat.
assert.ok(/overflow-wrap:\s*anywhere/.test(farbregel[2]),
	"eine lange Adresse darf umbrechen (overflow-wrap: anywhere)");

console.log("changelog-externe-links tests passed");
