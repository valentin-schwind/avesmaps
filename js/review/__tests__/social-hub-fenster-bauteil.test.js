"use strict";

/*
 * Der Social Media Hub haengt am geteilten Fenster-Bauteil (A11 des Bauplans
 * docs/superpowers/plans/2026-09-04-fenster-vereinheitlichung.md).
 *
 * 💣 WARUM ES DIESEN TEST GIBT. Dieses Fenster war der schlimmste Einzelfall der Messung vom
 *    04.09.2026: FUENF Abweichungen auf einmal -- Titel 17px (auf keiner Stufe der Skala),
 *    Polster 16/24, ein Schliessknopf als 18px-Glyphe OHNE Trefferflaeche, Huelle --radius-lg
 *    wie ein Blatt statt --radius-sm, und ein leerer <span> als dritte Rezeptur fuer
 *    "rechtsbuendig". Keine davon hat je einen Test rot gemacht; sie sind alle nur beim
 *    Nachmessen aufgefallen. Genau deshalb steht hier eine Zusicherung je Abweichung.
 *
 * ⚠️ Geprueft wird die VERDRAHTUNG (Markup + welche Datei die Regel haelt), nicht das gerechnete
 *    Bild -- Spezifitaet und Ladereihenfolge sieht ein Quelltexttest nicht. Dafuer gibt es den
 *    Blick im Browser; die Masse stehen im Kommentar am Ende.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8");
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const html = lies("index.html");
const hubCss = ohneKommentare(lies("css", "components", "social-hub.css"));
const bauteil = ohneKommentare(lies("css", "components", "fenster.css"));

let zusicherungen = 0;
function wahr(bedingung, text) {
	assert.ok(bedingung, text);
	zusicherungen++;
}

// --- Der Ausschnitt: nur das Hub-Fenster, nicht die halbe index.html ---------------------------
// 💣 Ohne den Schnitt trifft jede Suche irgendwo im Dokument etwas und die Zusicherung ist
//    Vakuum -- dieselbe Falle wie ein `includes()` auf die ganze Datei.
const von = html.indexOf('<div class="social-hub');
wahr(von > 0, "das Hub-Fenster fehlt in index.html");
const bis = html.indexOf('<div id="review-overlay"', von);
wahr(bis > von, "der Schnitt hinter dem Hub-Fenster fehlt -- ohne ihn misst der Test die halbe Seite");
const hub = html.slice(von, bis);
wahr(hub.length < 14000, `der Ausschnitt ist ${hub.length} Zeichen -- das ist nicht mehr ein Fenster`);

// --- 1) Die Huelle traegt das Bauteil ----------------------------------------------------------
wahr(/class="social-hub avm-fenster avm-fenster--werkzeug"/.test(hub),
	"die Huelle traegt `.avm-fenster .avm-fenster--werkzeug` nicht -- dann gilt weder Radius noch "
	+ "Polster noch Rumpf-Scroll des Bauteils");

// 🔴 Werkzeugfenster, nicht Blatt: es bleibt offen, waehrend man daneben arbeitet, und traegt
//    eine Fussleiste. Vorher stand es auf --radius-lg, also der Blatt-Fassung.
wahr(!/avm-fenster--blatt/.test(hub),
	"der Hub ist ein WERKZEUGFENSTER -- die Blatt-Fassung waere die falsche Bauart");

// --- 2) Kopfleiste, Griff, Titel, Zusatz -------------------------------------------------------
wahr(/class="social-hub__head avm-fenster__kopf"/.test(hub),
	"die Kopfzeile traegt `.avm-fenster__kopf` nicht");
wahr(/class="avm-fenster__griff"[^>]*>⁝⁝</.test(hub),
	"der Griff fehlt oder traegt nicht die zwei Punktspalten (U+205D zweimal)");
wahr(/id="social-hub-title" class="avm-fenster__titel"/.test(hub),
	"der Titel traegt `.avm-fenster__titel` nicht -- er stand auf 17px, das ist keine Skalenstufe");
wahr(/class="avm-fenster__zusatz" id="social-hub-subtitle"/.test(hub),
	"der Zusatz „— Beitrag verfassen\" ist Beiwerk und traegt `.avm-fenster__zusatz`");

// --- 3) Der Schliessknopf ----------------------------------------------------------------------
// 💣 Er war eine 18px-Glyphe OHNE Breite, Hoehe und Trefferflaeche. Jetzt 32x32 gefasst.
wahr(/id="social-hub-close" class="avm-fenster__knopf avm-fenster__knopf--gefasst"/.test(hub),
	"der Schliessknopf traegt die Bauteilklassen nicht");
wahr(!/social-hub__close/.test(hubCss),
	"`.social-hub__close` steht noch im Blatt -- zwei Rezepturen fuer denselben Knopf");

// --- 4) Rumpf und Fussleiste -------------------------------------------------------------------
wahr(/class="social-hub__body avm-fenster__rumpf"/.test(hub),
	"der Rumpf traegt `.avm-fenster__rumpf` nicht -- dann scrollt wieder die Huelle");
wahr(/class="social-hub__foot avm-fenster__fuss"/.test(hub),
	"die Fussleiste traegt `.avm-fenster__fuss` nicht");
wahr(/class="avm-fenster__fuss-haupt"/.test(hub),
	"die Knopfgruppe traegt `.avm-fenster__fuss-haupt` nicht -- ohne sie steht sie nicht rechts");
wahr(!/social-hub__spacer/.test(hubCss),
	"`.social-hub__spacer` ist zurueck -- ein leerer <span> war die DRITTE Rezeptur fuer "
	+ "„rechtsbuendig\", neben `justify-content` und `margin-left: auto`");

// --- 5) Keine zweite Fassung im Blatt ----------------------------------------------------------
// 💣 Das Blatt darf tragen, was NUR dieses Fenster betrifft (Breite, Raster). Alles, was das
//    Bauteil liefert, waere die Abschrift, aus der die 13 Schliessknopf-Rezepturen entstanden.
for (const eigenschaft of ["border-radius", "box-shadow"]) {
	const huelle = /\.social-hub \{([^}]*)\}/.exec(hubCss);
	wahr(huelle && !new RegExp("\\b" + eigenschaft + "\\s*:").test(huelle[1]),
		`\`.social-hub\` setzt \`${eigenschaft}\` wieder selbst -- das gehoert `
		+ "`.avm-fenster--werkzeug`, und bei gleicher Spezifitaet gewinnt die spaeter geladene Datei");
}

// --- 6) Die Kante, lokal ------------------------------------------------------------------------
// 🔴 --avm-col-pad steht global noch auf 12 (neun Fenster lesen ihn). Ohne den lokalen
//    Ueberschreiber saessen Kopf und Fuss auf 14 und der Rumpf auf 12 -- im Browser gemessen,
//    bevor die Zeile dastand. Genau der 2px-Versatz, den dieser Umbau beseitigt.
const huelleRegel = /\.social-hub \{([^}]*)\}/.exec(hubCss);
wahr(huelleRegel && /--avm-col-pad:\s*var\(--space-6\)\s*var\(--space-12\)/.test(huelleRegel[1]),
	"der lokale `--avm-col-pad` fehlt -- dann steht der Rumpf 2px enger als Kopf und Fuss");

// --- 7) Das Bauteil liefert wirklich, worauf sich das Markup verlaesst --------------------------
// 💣 Beide Haelften, nie nur eine: die Klasse ohne die Regel wirkt so wenig wie die Regel ohne
//    die Klasse. Genau daran ist die Huellen-Zusicherung des Garetien Importers am 04.09.2026
//    zuerst vorbeigelaufen.
for (const regel of ["\\.avm-fenster__kopf", "\\.avm-fenster__titel", "\\.avm-fenster__zusatz",
                     "\\.avm-fenster__knopf", "\\.avm-fenster__rumpf", "\\.avm-fenster__fuss",
                     "\\.avm-fenster__fuss-haupt", "\\.avm-fenster__fuss-hinweis"]) {
	wahr(new RegExp("(^|\\n)" + regel + "\\s*\\{").test(bauteil),
		`\`${regel.replace(/\\\\/g, "")}\` fehlt im Bauteil -- das Markup verlaesst sich darauf`);
}

/* Im Browser gemessen am 04.09.2026 (echte Produktions-CSS, dunkles Thema):
 *   Kopfleiste · Rumpf · Fussleiste   je 14px / 14px  -- EINE Kante, vorher 24 / 24 / 24 gegen 14
 *   Huelle                            radius 5px, padding 0, overflow hidden (vorher radius 10)
 *   Kopfleiste                        44,7px hoch (vorher 16+17+16 = rund 53)
 *   Titel                             16px (vorher 17)
 *   Schliessknopf                     32x32, radius 8 (vorher 18px-Glyphe ohne Trefferflaeche)
 *   Griff                             8,8px breit
 *   letzter Fussknopf rechts          14,7px von der Kante
 *   scrollt                           NUR .social-hub__body, nicht die Huelle
 */
console.log(`social-hub-fenster-bauteil: ${zusicherungen} Zusicherungen gruen.`);
