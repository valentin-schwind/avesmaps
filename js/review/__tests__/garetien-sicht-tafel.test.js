// Die Sicht-Tafel: welche FORM und welche FARBE ein importiertes Objekt auf der Karte bekommt.
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §4.1
// Brief:   .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-3-brief.md
// Nachtrag: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-3-nachtrag.md
//
// Ausfuehren: node js/review/__tests__/garetien-sicht-tafel.test.js
//
// 🔴 RULING R3 (Nachtrag §3): `Wege`, `Grenzen` und `Sonstiges` fehlen ABSICHTLICH in der Tafel --
// sie muessen ueber `neutral: true` laufen, nicht ueber einen erfundenen Tokennamen.
// 🔴 DIE BEGRUENDUNG HAT SICH AM 02.09.2026 GEAENDERT, DIE REGEL NICHT. Hier stand „ihre
// Kartenfarben (Weiss, Grau, Hellwarm) haben KEIN Token" -- seit dem 02.09.2026 haben sie eins
// (`--color-path-reichsstrasse/-strasse/-weg`, Abschnitt 5a). Die Tafel bekommt trotzdem keine
// Zeile `Wege`: sie greift nur, wenn KEIN `subtyp` vorliegt -- und dann ist gerade nicht bekannt,
// WELCHE der drei Arten es ist. Eine geratene waere schlimmer als der zurueckhaltende Rueckfall.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

let checks = 0;
function gleich(i, s, w) { assert.strictEqual(i, s, w || ""); checks++; }
function wahr(b, w) { assert.ok(b, w || ""); checks++; }

const karte = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));
const sicht = karte.avesmapsGaretienSichtFuer;
wahr(typeof sicht === "function", "avesmapsGaretienSichtFuer fehlt im Export");
wahr(typeof karte.AVESMAPS_GARETIEN_SICHT_EBENE === "object" && karte.AVESMAPS_GARETIEN_SICHT_EBENE !== null,
	"AVESMAPS_GARETIEN_SICHT_EBENE fehlt im Export");

// ---- 1. Mit Vorschlag gewinnt die SERVER-Auskunft -----------------------------------------------
//
// 🔴 `kind` + `subtyp` erlauben den Tokennamen nach der HAUSKONVENTION herzuleiten
// (`--color-ecosystem-<kind>-<subtyp mit _ als ->`, css/base/tokens.css:282). Kein zweiter
// Tabelleneintrag, keine zweite Wahrheit.
gleich(sicht({ ebene: "Gewaesser", typ: "See", kind: "topographie", subtyp: "see",
	geometrie_typ: "Polygon" }).token, "--color-ecosystem-topographie-see",
	"ein See mit Vorschlag bekommt SEINE echte Kartenfarbe, hergeleitet aus kind+subtyp");
gleich(sicht({ ebene: "Gewaesser", typ: "See", kind: "topographie", subtyp: "see",
	geometrie_typ: "Polygon" }).form, "flaeche",
	"und `geometrie_typ` entscheidet die Form -- die Auskunft des Erzeugers ueber sich selbst");
// Die DIFFERENZ: derselbe Vorschlag als LineString ist eine Linie, keine Flaeche.
gleich(sicht({ ebene: "Gewaesser", typ: "See", kind: "topographie", subtyp: "see",
	geometrie_typ: "LineString" }).form, "linie",
	"ohne Polygon bleibt es eine Linie, auch mit Vorschlag");

gleich(sicht({ ebene: "Gewaesser", typ: "Fluss", subtyp: "Flussweg",
	geometrie_typ: "LineString" }).token, "--color-path-flussweg",
	"ein Weg-Ziel hat kein `kind` und leitet aus dem `subtyp` her -- kleingeschrieben");
gleich(sicht({ ebene: "Gewaesser", typ: "Sumpf", kind: "vegetation", subtyp: "suempfe_moore",
	geometrie_typ: "Polygon" }).token, "--color-ecosystem-vegetation-suempfe-moore",
	"ein Unterstrich im `subtyp` wird zum Bindestrich -- so wie die Hauskonvention es verlangt");

// ---- 2. OHNE Vorschlag entscheidet die EBENE ----------------------------------------------------
//
// 🔴 DER HAEUFIGSTE FALL. `subtyp` und `geometrie_typ` sind ohne Vorschlag LEER (beide kommen aus
// `after`, das es ohne Vorschlag nicht gibt) -- ihr `ebene` dagegen ist immer da. Wer die genaue
// Zahl der moeglichen Werte braucht, zaehlt sie in AVESMAPS_GARETIEN_EBENEN
// (api/_internal/import/garetien-abruf.php) nach, statt einer Zahl hier zu glauben.
gleich(sicht({ ebene: "Berge", typ: "Berg", subtyp: "", geometrie_typ: "" }).form, "punkt",
	"ein Berg ohne Vorschlag ist ein PUNKT -- als Linie gezeichnet waere er unsichtbar");
gleich(sicht({ ebene: "Ortschaften_3", typ: "Dorf", subtyp: "", geometrie_typ: "" }).form, "punkt",
	"alle vier Ortschaften-Ebenen sind Punkte");
gleich(sicht({ ebene: "Ortschaften_1", typ: "Dorf", subtyp: "", geometrie_typ: "" }).token,
	"--color-marker-settlement", "Ortschaften_1 traegt dasselbe Siedlungstoken");
gleich(sicht({ ebene: "Detail_2", typ: "Bauwerk", subtyp: "", geometrie_typ: "" }).form, "punkt",
	"Detail_1/2 sind ebenfalls Punkte");
gleich(sicht({ ebene: "Waelder", typ: "Forst", subtyp: "", geometrie_typ: "" }).token,
	"--color-ecosystem-vegetation-wald", "ein Wald ist gruen, auch ohne Vorschlag");
gleich(sicht({ ebene: "Waelder", typ: "Forst", subtyp: "", geometrie_typ: "" }).form, "flaeche",
	"ein Wald ohne Vorschlag ist eine Flaeche");
gleich(sicht({ ebene: "Gewaesser", typ: "See", subtyp: "", geometrie_typ: "" }).token,
	"--color-path-flussweg",
	"ein Gewaesser ohne Vorschlag bekommt die grobe Wasserfarbe -- 'See' im Feld `typ` aendert "
	+ "daran nichts, `typ` wird hier NICHT gelesen");

// Die DIFFERENZ zwischen den Ebenen: zwei verschiedene Ebenen ergeben zwei verschiedene Tokens.
wahr(sicht({ ebene: "Berge", subtyp: "", geometrie_typ: "" }).token
	!== sicht({ ebene: "Waelder", subtyp: "", geometrie_typ: "" }).token,
	"Berge und Waelder muessten sich sonst nicht unterscheiden -- die Tafel waere Vakuum");

// `geometrie_typ` schlaegt auch bei einem Tafeleintrag durch, falls es (untypisch) doch gefuellt
// waere -- es ist die Auskunft des Erzeugers ueber sich selbst, die Tafel nur die Faustregel.
gleich(sicht({ ebene: "Berge", typ: "Berg", subtyp: "", geometrie_typ: "Polygon" }).form, "flaeche",
	"ein gefuelltes `geometrie_typ` gewinnt auch gegen die Tafel");

// ---- 3. RULING R3: Wege, Grenzen und Sonstiges fallen ABSICHTLICH neutral aus -------------------
//
// Fuer diese drei Ebenen gibt es KEIN Kartentoken (tokens.css:530 fuer Wege/Grenzen; Sonstiges ist
// der Sammeltopf ohne eigene Bedeutung). Ein erfundenes Token waere die zweite Farbwahrheit, die
// AGENTS.md §12 verbietet -- und ein Tokenname, den es nicht gibt, liesse die Form lautlos
// verschwinden (leerer `var()`).
["Wege", "Grenzen", "Sonstiges"].forEach(function (ebene) {
	const r = sicht({ ebene: ebene, typ: "irgendwas", subtyp: "", geometrie_typ: "" });
	gleich(r.neutral, true, "Ebene " + ebene + " hat KEINE eigene Sicht-Regel (RULING R3)");
	gleich(r.token, "--color-marker-active",
		"Ebene " + ebene + " faellt auf den Gold-Rueckfall zurueck, nicht auf ein erfundenes Token");
});
gleich(Object.prototype.hasOwnProperty.call(karte.AVESMAPS_GARETIEN_SICHT_EBENE, "Wege"), false,
	"die Tafel darf keinen Eintrag fuer `Wege` bekommen -- es gibt kein Kartentoken dafuer");
gleich(Object.prototype.hasOwnProperty.call(karte.AVESMAPS_GARETIEN_SICHT_EBENE, "Grenzen"), false,
	"die Tafel darf keinen Eintrag fuer `Grenzen` bekommen -- es gibt kein Kartentoken dafuer");

// ---- 4. Unbekannt faellt NEUTRAL aus, und sagt es ------------------------------------------------
//
// ⚠️ Die zurueckhaltende Richtung: eine unbekannte Ebene wird gezeichnet wie bisher (goldene Linie),
// nie gar nicht. Ein nicht gezeichnetes Objekt ist von „liegt da nichts" nicht zu unterscheiden.
const unbekannt = sicht({ ebene: "Sternenhimmel", typ: "Komet", subtyp: "", geometrie_typ: "" });
gleich(unbekannt.form, "linie", "unbekannt heisst Linie -- das Bild von vor dieser Aufgabe");
gleich(unbekannt.token, "--color-marker-active", "und Gold");
gleich(unbekannt.neutral, true,
	"🔴 und es SAGT, dass es geraten hat -- die Bilanzzeile meldet es, sonst sieht ein Rueckfall "
	+ "aus wie „so sieht das Objekt eben aus\"");
// Die DIFFERENZ: ein getroffener Fall meldet sich NICHT als neutral.
gleich(sicht({ ebene: "Berge", typ: "Berg", subtyp: "", geometrie_typ: "" }).neutral, false,
	"ein Treffer in der Tafel ist kein Rueckfall");
gleich(sicht({ ebene: "Gewaesser", typ: "Fluss", subtyp: "Flussweg",
	geometrie_typ: "LineString" }).neutral, false,
	"und ein Treffer ueber `subtyp` erst recht nicht");
// Ohne jede Auskunft (kein `ebene`, kein `subtyp`) ist es ebenfalls neutral -- nicht etwa ein Wurf.
gleich(sicht({}).neutral, true, "ein leeres Objekt ist neutral, nicht kaputt");
gleich(sicht(null).neutral, true, "und `null` erst recht");

// ---- 5. Jedes Token der Tafel existiert wirklich -------------------------------------------------
//
// 🪤 Ein Tokenname, den es nicht gibt, macht `var()` ungueltig und `getComputedStyle` liefert "" --
// der Strich verschwindet dann lautlos, ohne Fehler und ohne Warnung (task-3-nachtrag.md). Diese
// Probe haette `--color-path-strasse`/`--color-territory-boundary` aus dem urspruenglichen Brief
// VOR dem Bauen verworfen.
const tokensCss = fs.readFileSync(path.join(WURZEL, "css", "base", "tokens.css"), "utf8");
function tokenDefiniert(name) {
	return new RegExp("^\\s*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:", "m")
		.test(tokensCss);
}
wahr(tokenDefiniert("--color-marker-active"),
	"die Gegenprobe muss ein WIRKLICH vorhandenes Token finden, sonst prueft sie nichts");
wahr(!tokenDefiniert("--color-path-strasse-die-es-nicht-gibt"),
	"und ein erfundenes Token darf sie nicht finden, sonst prueft sie nichts");

const ebenenTokens = Object.keys(karte.AVESMAPS_GARETIEN_SICHT_EBENE)
	.map(function (k) { return karte.AVESMAPS_GARETIEN_SICHT_EBENE[k].token; });
wahr(ebenenTokens.length > 0, "die Tafel darf nicht leer sein -- sonst prueft die Schleife nichts");
Array.from(new Set(ebenenTokens.concat([karte.AVESMAPS_GARETIEN_SICHT_NEUTRAL.token])))
	.forEach(function (token) {
		wahr(tokenDefiniert(token), "Tafel-Token " + token + " steht nicht in css/base/tokens.css");
	});

// ---- 5a. JEDE Wegart, die der Importer vergeben kann, hat ihr Token (02.09.2026) ----------------
//
// 💣 DIE LUECKE, DIE ABSCHNITT 5 NICHT SAH: er prueft die Tokens der EBENEN-Tafel. Der weitaus
// haeufigere Weg in die Farbe ist aber die HERLEITUNG aus `subtyp` (`--color-path-<subtyp
// klein>`), und die steht in keiner Tafel -- es gibt dort nichts zu durchlaufen. Live gemeldet am
// 02.09.2026: „Weg Pulsahain-Reichsstrasse" leitete `--color-path-weg` her, das es nicht gab.
// Betroffen waren Reichsstrasse, Strasse und Weg -- DREI der fuenf Wegarten, die
// api/_internal/import/garetien-abgleich.php ueberhaupt vergibt (die zwei uebrigen sind Pfad und
// Flussweg). Jede importierte Strasse wurde golden gezeichnet, mit einer Konsolenmeldung je Objekt.
//
// 🔴 GEPRUEFT WIRD DIE HERLEITUNG, NICHT EINE ZWEITE LISTE. Der Test ruft `sicht()` und liest den
// Tokennamen, den sie WIRKLICH baut -- eine hier abgeschriebene Liste von Tokennamen liefe beim
// naechsten Umbau der Herleitung auseinander und wuerde weiter gruen melden.
// ⚠️ Die Namensquelle ist `PATH_SUBTYPE_KEYS` (js/config.js), die EINE Liste der Wegarten des
// Hauses -- sie deckt die fuenf des Importers ab und drei weitere, die er heute nicht vergibt.
// Das ist Absicht: der Deckel darf nicht enger sein als das Vokabular, sonst faellt eine neue
// Zeile in garetien-abgleich.php still durch.
// 🪤 `tokenDefiniert` (Abschnitt 5) reicht hier NICHT, und der Mutationstest hat es gezeigt: es
// sucht ueber die GANZE Datei, findet ein Token also auch dann, wenn es nur im dunklen Block
// steht. Genau so ueberlebte die Probe das Entfernen des hellen `--color-path-weg`. Eine Farbe,
// die nur ein Thema kennt, faellt im anderen auf den Wert des ersten zurueck -- und der ist dort
// gebaut, um sich vom GEGENTEILIGEN Grund abzuheben (dieselbe Lehre wie in
// js/pages/__tests__/wege-art-farben.test.js). Fuer diese Familie ist „in BEIDEN Bloecken" der
// Vertrag; die uebrigen Tokens duerfen sehr wohl nur einen Block haben (das dunkle Thema
// ueberschreibt nur, was es ueberschreiben muss) -- deshalb ein eigener Pruefer statt einer
// Verschaerfung von `tokenDefiniert`.
// 💣 KOMMENTARE ZUERST RAUS: tokens.css ERWAEHNT `:root[data-theme="dark"]` schon in seiner
// Kopfzeile, um zu begruenden, warum das dunkle Thema nicht an `prefers-color-scheme` haengt --
// ein `indexOf` ueber den Rohtext schnitte den hellen Block nach neun Zeilen ab, und dann fehlte
// scheinbar JEDES Token.
const tokensOhneKommentare = tokensCss.replace(/\/\*[\s\S]*?\*\//g, "");
const dunkelStart = tokensOhneKommentare.indexOf(':root[data-theme="dark"]');
wahr(dunkelStart > 0, 'Der Block :root[data-theme="dark"] fehlt in css/base/tokens.css');
const THEMEN_BLOCK = {
	hell: tokensOhneKommentare.slice(0, dunkelStart),
	dunkel: tokensOhneKommentare.slice(dunkelStart),
};
function tokenImBlock(block, name) {
	return new RegExp("^\\s*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:", "m")
		.test(block);
}
// Die Gegenprobe der Gegenprobe: beide Bloecke muessen wirklich Tokens enthalten, sonst prueft die
// Schleife darunter zweimal nichts.
wahr(tokenImBlock(THEMEN_BLOCK.hell, "--color-path-pfad")
	&& tokenImBlock(THEMEN_BLOCK.dunkel, "--color-path-pfad"),
	"die Blocktrennung hat nicht funktioniert -- --color-path-pfad steht in beiden Themen");

const konfigJs = fs.readFileSync(path.join(WURZEL, "js", "config.js"), "utf8");
const wegartenZeile = konfigJs.match(/const PATH_SUBTYPE_KEYS\s*=\s*\[([^\]]*)\]/);
wahr(wegartenZeile !== null, "PATH_SUBTYPE_KEYS steht nicht (mehr) in js/config.js");
const WEGARTEN = wegartenZeile[1].split(",")
	.map(function (t) { return t.trim().replace(/^["']|["']$/g, ""); })
	.filter(function (t) { return t !== ""; });
wahr(WEGARTEN.length >= 5, "PATH_SUBTYPE_KEYS wirkt leer gelesen -- dann prueft die Schleife nichts");
WEGARTEN.forEach(function (art) {
	// `kind: ""` ist der Weg-Zweig: genau die Form, die garetien-abgleich.php fuer `ziel:'path'`
	// liefert (`kind => null`).
	const gebaut = sicht({ ebene: "Wege", typ: art, subtyp: art, kind: "", geometrie_typ: "LineString" });
	wahr(/^--color-path-[a-z]+$/.test(gebaut.token),
		"Wegart " + art + " leitet keinen Weg-Tokennamen her, sondern " + gebaut.token);
	["hell", "dunkel"].forEach(function (thema) {
		wahr(tokenImBlock(THEMEN_BLOCK[thema], gebaut.token),
			"Wegart " + art + " leitet " + gebaut.token + " her, aber css/base/tokens.css kennt das "
			+ "Token im " + thema + "en Thema nicht -- `var()` wird ungueltig, das Objekt faellt "
			+ "auf Gold zurueck und meldet je Vorkommen einmal in die Konsole "
			+ "(garetienSichtTokenFehlt).");
	});
});
// Die GEGENPROBE, ohne die die Schleife Vakuum waere: eine erfundene Wegart muss durchfallen.
wahr(!tokenImBlock(THEMEN_BLOCK.hell, sicht({ subtyp: "Karrenspur", kind: "", geometrie_typ: "LineString" }).token),
	"eine erfundene Wegart darf kein Token finden -- sonst prueft die Schleife nichts");

// ---- 5b. Eine Siedlungsklasse (30.08.2026) --------------------------------------------------------
//
// 🔴 GEFUNDEN BEIM BAU DER ORTSMARKIERUNGS-GROESSE: `ziel:'location'` traegt bei einem Vorschlag
// `subtyp` = settlement_class UND `kind: null` -- also GENAU dieselbe Form wie ein Weg-Subtyp
// (Flussweg/Strasse/...), der ebenfalls `kind: null` traegt. Ohne eine eigene Weiche fiel eine
// Siedlungsklasse in die Weg-Ableitung (`--color-path-dorf`, ein Tokenname, den es nicht gibt) und
// landete -- lautlos bis auf eine Konsolenmeldung -- als Gold-Linie auf der Karte, obwohl die
// Ebenen-Tafel eine Zeile weiter unten (Ortschaften_1..4/Detail_1..2) fuer genau diesen Fall schon
// das richtige Marker-Token bereithaelt.
gleich(sicht({ ebene: "Ortschaften_2", typ: "Dorf", subtyp: "dorf", kind: "", geometrie_typ: "" }).token,
	"--color-marker-settlement",
	"eine Siedlungsklasse MIT Vorschlag bekommt ihr eigenes Marker-Token, nicht den kaputten "
	+ "Weg-Rueckfall");
gleich(sicht({ ebene: "Ortschaften_2", typ: "Dorf", subtyp: "dorf", kind: "", geometrie_typ: "" }).form,
	"punkt", "eine erkannte Siedlungsklasse ist ein PUNKT, nie eine Linie");
gleich(sicht({ ebene: "Ortschaften_2", typ: "Dorf", subtyp: "dorf", kind: "", geometrie_typ: "" }).neutral,
	false, "ein Treffer in der Siedlungsklasse ist kein Rueckfall");
// Alle sechs Klassen, nicht nur eine -- eine Weiche, die nur "dorf" kennt, waere Vakuum.
["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"].forEach(function (klasse) {
	gleich(sicht({ ebene: "Detail_1", typ: "x", subtyp: klasse, kind: "", geometrie_typ: "" }).token,
		"--color-marker-settlement", "Klasse " + klasse + " muss ebenfalls das Siedlungstoken tragen");
});
// Die DIFFERENZ, ohne die die Weiche Vakuum waere: ein WEG-Subtyp bleibt beim alten Verhalten.
wahr(sicht({ ebene: "Gewaesser", typ: "Fluss", subtyp: "Flussweg", kind: "", geometrie_typ: "LineString" }).token
	!== "--color-marker-settlement",
	"ein Weg-Subtyp darf nicht faelschlich als Siedlungsklasse erkannt werden");
gleich(sicht({ ebene: "Gewaesser", typ: "Fluss", subtyp: "Flussweg", kind: "", geometrie_typ: "LineString" }).token,
	"--color-path-flussweg", "und traegt weiterhin sein eigenes Weg-Token");
// Und die zweite DIFFERENZ: `kind` gefuellt schlaegt die Siedlungsklasse nie (kann in der Praxis
// nicht vorkommen, `garetien-abgleich.php` setzt `kind: null` fuer `ziel:'location'` -- aber die
// Ordnung "kind zuerst" muss trotzdem gelten, sonst waere sie nur zufaellig richtig).
wahr(sicht({ ebene: "Ortschaften_2", typ: "Dorf", subtyp: "dorf", kind: "vegetation",
	geometrie_typ: "" }).token !== "--color-marker-settlement",
	"ein gefuelltes `kind` schlaegt die Siedlungsklasse -- sie greift nur, wenn `kind` leer ist");

wahr(typeof karte.garetienSiedlungsKlasse === "function", "garetienSiedlungsKlasse fehlt im Export");
gleich(karte.garetienSiedlungsKlasse({ subtyp: "dorf" }), "dorf", "eine bekannte Klasse kommt zurueck");
gleich(karte.garetienSiedlungsKlasse({ subtyp: "Flussweg" }), "",
	"ein Weg-Subtyp ist KEINE Siedlungsklasse");
gleich(karte.garetienSiedlungsKlasse({ subtyp: "see" }), "", "ein Regions-Subtyp auch nicht");
gleich(karte.garetienSiedlungsKlasse({}), "", "ohne subtyp keine Klasse");
gleich(karte.garetienSiedlungsKlasse(null), "", "und ohne Objekt erst recht nicht");

// ---- 5c. Das `kind` fuer die Flaechen-Deckkraft -- eine ORDNUNG (30.08.2026) --------------------
wahr(typeof karte.garetienObjektKind === "function", "garetienObjektKind fehlt im Export");
gleich(karte.garetienObjektKind({ kind: "topographie", ebene: "Waelder" }), "topographie",
	"die Server-Auskunft (kind) schlaegt die Ebenen-Tafel");
gleich(karte.garetienObjektKind({ ebene: "Waelder" }), "vegetation",
	"ohne `kind` gilt die Tafel -- 'Waelder' ist unzweideutig Vegetation");
gleich(karte.garetienObjektKind({ ebene: "Gewaesser" }), "",
	"'Gewaesser' traegt KEIN `kind` in der Tafel -- die Ebene ist mehrdeutig (See/Meer/Sumpf/Fluss)");
gleich(karte.garetienObjektKind({ ebene: "Sternenhimmel" }), "", "eine unbekannte Ebene bleibt leer");
gleich(karte.garetienObjektKind({}), "", "ein leeres Objekt bleibt leer");
gleich(karte.garetienObjektKind(null), "", "und `null` erst recht");

// ---- 5d. Die Flaechen-Deckkraft -- die VORHANDENE Regel, nicht ihre Zahlen (30.08.2026) ---------
//
// 🪤 Die teuerste Fehlerklasse hier ist die VAKUUM-Zusicherung: es reicht nicht, dass IRGENDEINE
// Zahl herauskommt -- zwei verschiedene Arten muessen sich unterscheiden, sonst koennte die Tafel
// wirkungslos verdrahtet sein.
wahr(typeof karte.garetienFlaechenDeckkraft === "function", "garetienFlaechenDeckkraft fehlt im Export");
const deckkraftAbfragen = [];
global.avesmapsEcosystemDisplayDeckkraft = function (kind, typeKey) {
	deckkraftAbfragen.push([kind, typeKey]);
	const TAFEL = { derographisch: 0.16, vegetation: 0.72, topographie: 0.72, klima: 0.30 };
	return typeof TAFEL[String(kind || "")] === "number" ? TAFEL[String(kind || "")] : 0.72;
};
gleich(karte.garetienFlaechenDeckkraft({ kind: "vegetation", subtyp: "wald" }), 0.72,
	"Vegetation ruft die VORHANDENE Regel und bekommt ihre echte Deckkraft");
gleich(karte.garetienFlaechenDeckkraft({ kind: "derographisch", subtyp: "kontinent" }), 0.16,
	"die DIFFERENZ: derographisch bekommt eine ANDERE Deckkraft als Vegetation");
wahr(deckkraftAbfragen.some((a) => a[0] === "vegetation" && a[1] === "wald"),
	"der `subtyp` muss wirklich mitgereicht werden -- eine Uebersteuerung je Typ braucht ihn");
// Ohne bekanntes `kind` (mehrdeutige Ebene) bleibt es beim alten, niedrigen Festwert -- NICHT bei
// der Vegetation-Zahl, auch wenn die Regel verfuegbar waere.
gleich(karte.garetienFlaechenDeckkraft({ ebene: "Gewaesser" }), 0.14,
	"eine mehrdeutige Ebene rundet NICHT auf 0,72 hoch, sie bleibt beim zurueckhaltenden Rueckfall");
// Und ohne die Regel selbst (z.B. eine Seite, die ecosystem-display.js nicht laedt) ebenfalls.
delete global.avesmapsEcosystemDisplayDeckkraft;
gleich(karte.garetienFlaechenDeckkraft({ kind: "vegetation", subtyp: "wald" }), 0.14,
	"fehlt die Regel selbst, bleibt es beim alten Festwert -- kein Wurf, kein Raten");

// ---- 6. Rot heisst: bei uns liegt etwas, und eine Frage ist offen (Aufgabe 4, Entwurf §4.2) -----
//
// 🔴 Genau die drei Urteile, bei denen bei uns etwas an derselben Stelle liegt UND eine Frage offen
// ist. Eine Kollision betrifft BEIDE Seiten (ihre Form UND unsere) -- diese Probe prueft nur das
// reine Praedikat; die Verdrahtung beider Hoefe steht in garetien-karte.test.js Abschnitt 11e.
const kollidiert = karte.avesmapsGaretienKollidiert;
wahr(typeof kollidiert === "function", "avesmapsGaretienKollidiert fehlt im Export");
gleich(kollidiert({ urteil: "widerspruch" }), true, "ein Widerspruch gluet rot");
gleich(kollidiert({ urteil: "zweifel" }), true, "ein Zweifel auch");
gleich(kollidiert({ urteil: "ergaenzung" }), true, "und eine Ergaenzungsfrage auch");

// 🔴 DIE DIFFERENZ, und sie traegt die Aussage: wo nichts kollidiert, glueht auch nichts.
gleich(kollidiert({ urteil: "neu" }), false,
	"bei „neu\" liegt bei uns NICHTS -- ein rotes Gluehen behauptete eine Kollision, die es "
	+ "nicht gibt");
gleich(kollidiert({ urteil: "deckt_sich" }), false,
	"bei „deckt sich\" ist nichts zu entscheiden");
gleich(kollidiert({ urteil: "uebersprungen" }), false, "und uebersprungen ist keine Kollision");
gleich(kollidiert({}), false, "ohne Urteil: kein Gluehen (die zurueckhaltende Richtung)");
gleich(kollidiert(null), false, "und `null` erst recht nicht");

// 💣 Der Wert heisst in den Daten `widerspruch`, NICHT `widerspricht` (task-4-nachtrag.md §4) --
// diese Verwechslung hat am 29.08.2026 dazu gefuehrt, dass ein ganzer Objekttyp durch alle Filter
// fiel. Wer den Tippfehler in die Liste schriebe, verloere lautlos jede Kollisionsmeldung dieser Art.
gleich(kollidiert({ urteil: "widerspricht" }), false,
	"„widerspricht\" ist NICHT der Datenwert -- die Liste normalisiert, hier steht der normalisierte "
	+ "Wert");

console.log(`garetien-sicht-tafel: ${checks} Pruefungen bestanden.`);
