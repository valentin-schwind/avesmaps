// Der Deckel (Owner 2026-08-12, „4 is mega, das wollen wir").
//
// Geprueft wird das MARKUP -- das Auf- und Zuklappen selbst gehoert dem nativen <details> und wird
// auf der Pruefseite mit echter CSS-Kette abgenommen, nicht hier: eine Hoehe hat in node niemand.
const assert = require("assert");
const { buildInfoboxLid, avesmapsInfoboxLidProse } = require("../infobox-lid.js");

// ---- der Satz -------------------------------------------------------------------------------
// 💣 Einzahl und Mehrzahl. „1 Tierarten leben hier" ist der Satz, den es NIE geben darf, und er
// entsteht von selbst, sobald jemand nur den Plural hinterlegt.
assert.ok(avesmapsInfoboxLidProse(11, "Ware wird hier gehandelt", "Waren werden hier gehandelt")
	.includes("Waren werden hier gehandelt"), "Mehrzahl bei 11");
assert.ok(avesmapsInfoboxLidProse(1, "Ware wird hier gehandelt", "Waren werden hier gehandelt")
	.includes("Ware wird hier gehandelt"), "Einzahl bei 1");
assert.ok(avesmapsInfoboxLidProse(0, "Ort auf dem Weg", "Orte auf dem Weg")
	.includes("Orte auf dem Weg"), "null ist Mehrzahl, nicht Einzahl");

// 🔴 Die Zahl ist ein eigenes Stueck, kein in den Satz geklebter String -- nur so kann sie eine
// eigene Farbe und Tabellenziffern tragen.
const satz = avesmapsInfoboxLidProse(33, "Ort auf dem Weg", "Orte auf dem Weg");
assert.ok(satz.includes('<span class="infobox-lid__count">33</span>'),
	"die Zahl steht ausgezeichnet im Satz: " + satz);

// Der Satz kommt aus dem Wiki-nahen Umfeld nicht, aber die Zahl schon aus einer Rechnung -- und der
// Satz selbst wird escaped, damit eine spaetere Uebersetzung keine Luecke reisst.
assert.ok(!avesmapsInfoboxLidProse(2, "x", '<img src=x onerror=alert(1)>').includes("<img"),
	"der Satz wird escaped");

// ---- der oeffenbare Deckel ------------------------------------------------------------------
const auf = buildInfoboxLid({
	preview: '<a href="#">Trallop</a> → … → <a href="#">Punin</a>',
	full: '<a href="#">Trallop</a> → <a href="#">Eichenau</a> → <a href="#">Punin</a>',
	count: 33,
	singular: "Ort auf dem Weg",
	plural: "Orte auf dem Weg",
});

// 💣 NATIVES <details>. Der Grund ist die Seitensuche: Strg+F findet Text in einem zugeklappten
// <details> und klappt es selbst auf. Ein selbstgebautes Klappen mit display:none nimmt ihr den Text.
assert.ok(auf.startsWith("<details class=\"infobox-lid\">"), "ein natives <details>: " + auf.slice(0, 60));
assert.ok(auf.includes('<summary class="infobox-lid__summary">'), "mit einem summary");

// 💣 Der volle Inhalt liegt IM DOKUMENT, nicht erst nach dem Klick -- sonst faende die Seitensuche
// ihn nie. Das ist der ganze Unterschied zum „+N"-Fenster, das er ersetzt.
assert.ok(auf.includes("Eichenau"), "der volle Inhalt steht von Anfang an im Markup");

// 💣 preview und full werden NICHT nachgeescapet: sie kommen aus Bauern, die selbst escapen. Ein
// zweites Escaping machte aus jedem Link sichtbare Tags.
assert.ok(auf.includes('<a href="#">Trallop</a>'), "vorgefertigtes Markup bleibt Markup");

// 🔴 Der Oeffner ist seit dem 12.08.2026 ein PFEIL, kein Wort (Owner: „nimm den pfeil"). Er steht
// im Stylesheet und liest `[open]` -- im Markup ist er ein leeres, `aria-hidden` gesetztes Zeichen.
// Der zugaengliche Name kommt vom <summary>, das den Satz traegt; der Zustand von <details> selbst.
assert.ok(/<span class="infobox-lid__more" aria-hidden="true"><\/span>/.test(auf),
	"der Oeffner ist ein leeres, verstecktes Zeichen -- der Pfeil kommt aus dem Stylesheet: " + auf);
assert.ok(!/alle anzeigen|zuklappen/.test(auf), "und kein Wort mehr im Markup");
assert.ok(auf.includes("33"), "die Zahl steht im Satz daneben");

// ---- der statische Deckel --------------------------------------------------------------------
// Es steht schon alles da: der Satz bleibt (er ist eine Angabe), der Oeffner entfaellt (er waere
// eine Aufforderung ins Leere), und ein <details> gaebe es auch nicht.
const statisch = buildInfoboxLid({
	preview: "Griswolf", full: "Griswolf", count: 1,
	singular: "Tierart lebt hier", plural: "Tierarten leben hier",
	openable: false,
});
assert.ok(!statisch.includes("<details"), "kein <details> ohne etwas zu zeigen: " + statisch);
assert.ok(!statisch.includes("infobox-lid__more"), "und kein Oeffner");
assert.ok(statisch.includes("infobox-lid--static"), "aber als Deckel erkennbar (Hover haengt daran)");
assert.ok(statisch.includes("Tierart lebt hier"), "der Satz bleibt, in der Einzahl");

// ---- nichts zu sagen --------------------------------------------------------------------------
assert.strictEqual(buildInfoboxLid(null), "", "ohne Angabe kein Deckel");
assert.strictEqual(buildInfoboxLid({ preview: "", full: "", count: 0 }), "",
	"ohne Inhalt kein Deckel -- kein leerer Kasten mit „0 Orte auf dem Weg\"");

console.log("OK: der Deckel -- <details>, Einzahl/Mehrzahl, statisch ohne Oeffner");

// ---- der Satz steht OBEN (Owner 2026-08-12) ---------------------------------------------------
// 💣 Sonst springt er beim Aufklappen: unter der Vorschau stehend wandert er nach oben, sobald die
// Vorschau weicht -- derselbe Satz an zwei Stellen, je nach Zustand. Oben ruehrt er sich nie.
// „waer schoen, wenn die Woerter moeglichst stabil an der Stelle bleiben."
const stabil = buildInfoboxLid({
	preview: "VORSCHAU", full: "VOLL", count: 11,
	singular: "Ware wird hier gehandelt", plural: "Waren werden hier gehandelt",
});
assert.ok(stabil.indexOf("infobox-lid__foot") < stabil.indexOf("infobox-lid__preview"),
	"💣 der Satz steht VOR der Vorschau, sonst springt er beim Aufklappen: " + stabil);
assert.ok(stabil.indexOf("infobox-lid__preview") < stabil.indexOf("infobox-lid__full"),
	"und die Vorschau vor dem vollen Inhalt");

const stabilStatisch = buildInfoboxLid({
	preview: "VORSCHAU", full: "VORSCHAU", count: 2,
	singular: "Pflanzenart wächst hier", plural: "Pflanzenarten wachsen hier",
	openable: false,
});
assert.ok(stabilStatisch.indexOf("infobox-lid__foot") < stabilStatisch.indexOf("infobox-lid__preview"),
	"auch im statischen Deckel steht der Satz oben -- sonst saehen die beiden verschieden aus");

console.log("OK: der Satz steht oben und bleibt beim Aufklappen an seiner Stelle");
