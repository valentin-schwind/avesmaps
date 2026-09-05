"use strict";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// „Hinweise" und „Neuigkeiten": jede Zone traegt ihr Polster selbst.
//
// 💣 DIE LEHRE, UM DIE ES HIER GEHT. Der Fenster-Umbau vom 04.09.2026 stellte die Huelle auf
//    `padding: 0` -- die tragende Zeile des Bauteils (css/components/fenster.css): jede Zone
//    traegt ihr Polster selbst, damit Trenner ohne negative Aussenraender von Kante zu Kante
//    laufen. Bei diesen beiden Fenstern wurde die ERSTE Haelfte gebaut und die zweite nicht:
//    die Huelle verlor `padding: 16px 18px`, und die Zonen darunter bekamen nichts.
//    Live gemessen am 05.09.2026: Einleitung, Liste und Fusszeile von „Neuigkeiten" begannen bei
//    x=824, dem linken Rand des Fensters; das Ehrenzeichen und alle acht Abschnitte von
//    „Hinweise" bei x=734 -- waehrend der Titel darueber 14px Einzug hatte. Der Text klebte an
//    der Kante, Impressum und Datenschutzerklaerung eingeschlossen.
//    Gemeldet hat es der Owner, gesehen hat es kein Test: die Zusicherungen des Umbaus prueften
//    Kopfzeile, Titel, Schliessknopf und den Rumpf-SCROLL -- niemand fragte nach dem Polster.
//
// ⭐ Diese Datei fragt danach, und zwar an beiden Enden: die Huelle muss den lokalen
//    --avm-col-pad setzen (sonst steht der Rumpf 2px enger als der Kopf), und JEDE Zone muss
//    ein Polster tragen -- als Token, nie als nackte Zahl (AGENTS.md §12).
// ═══════════════════════════════════════════════════════════════════════════════════════════

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8");

// 🪤 Kommentare RAUS, bevor irgendetwas gesucht wird. Die beiden Blaetter erklaeren ihre Fallen
//    im Klartext und schreiben dabei `padding: 16px 18px` und `top: 0` hin -- ein Test, der den
//    Quelltext mitsamt Kommentaren liest, schlaegt an der Warnung an, die vor dem Muster warnt.
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const regel = (css, selektor) => {
	const m = new RegExp("(?:^|\\})\\s*" + selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		+ "\\s*\\{([^}]*)\\}").exec(css);
	return m ? m[1] : null;
};

const changelogCss = ohneKommentare(lies("css", "components", "changelog-dialog.css"));
const legalCss = ohneKommentare(lies("css", "components", "legal-dialog.css"));
const bauteilCss = ohneKommentare(lies("css", "components", "fenster.css"));
const markup = lies("index.html");

// ---- 1 · Die Kante steht lokal ---------------------------------------------------------------
//
// 🔴 --avm-col-pad steht global noch auf 8/12 (tokens.css sagt warum: neun Fenster lesen ihn
//    gleichzeitig). Ohne den lokalen Wert stuende der Rumpf auf 12 und der Kopf auf 14 -- zwei
//    Pixel Versatz zwischen Titel und Inhalt, genau die Sorte Abweichung, die niemand meldet und
//    die trotzdem jedes Fenster ein bisschen anders aussehen laesst.
[["Neuigkeiten", changelogCss, ".changelog-dialog"],
 ["Hinweise", legalCss, ".legal-dialog"]].forEach(([name, css, selektor]) => {
	const huelle = regel(css, selektor);
	assert.ok(huelle, `${name}: die Huellenregel ${selektor} gibt es`);
	assert.ok(/--avm-col-pad:\s*var\(--[\w-]+\)\s+var\(--space-12\)/.test(huelle),
		`${name}: die Huelle setzt --avm-col-pad lokal auf den 14er-Seiteneinzug -- ohne das steht`
		+ " der Rumpf 2px enger als der Kopf darueber");
	assert.ok(!/padding\s*:/.test(huelle),
		`${name}: die HUELLE traegt kein eigenes Polster -- das ist die tragende Zeile des`
		+ " Bauteils (padding: 0), und ein Polster hier naehme jedem Trenner seine Kante");
});

// ---- 2 · Jede Zone traegt ihr Polster ---------------------------------------------------------
//
// 💣 Alle drei Zonen von „Neuigkeiten" lesen DENSELBEN Wert. Ein eigener je Zone waere die
//    Divergenz, um die es beim ganzen Fenster-Umbau geht -- und der Seiteneinzug muss an EINER
//    Stelle nachzuzaehlen sein, sonst steht die Einleitung anders als die Liste darunter.
[[".changelog-dialog__intro", "Einleitung"],
 [".changelog-dialog__foot", "Fusszeile"]].forEach(([selektor, name]) => {
	const r = regel(changelogCss, selektor);
	assert.ok(r, `Neuigkeiten: die Regel ${selektor} gibt es`);
	assert.ok(/padding:\s*var\(--avm-col-pad\)/.test(r),
		`Neuigkeiten/${name}: traegt das geteilte Polster --avm-col-pad -- ohne das klebt ihr Text`
		+ " an der Fensterkante, waehrend der Titel darueber eingerueckt steht");
});

// Die zwei Scroll-Zonen holen Polster UND Scroll aus dem Bauteil, tragen es also im MARKUP.
// ⚠️ Namentlich, nicht als Menge: eine Zahl („mindestens neun Fenster tragen den Rumpf") bliebe
//    gruen, wenn ausgerechnet eines dieser beiden ihn verloere.
[['class="legal-dialog__scroll avm-fenster__rumpf"', "Hinweise"],
 ['class="changelog-dialog__scroll avm-fenster__rumpf"', "Neuigkeiten"]].forEach(([m, name]) => {
	assert.ok(markup.includes(m),
		`${name}: die Scroll-Zone traegt .avm-fenster__rumpf -- daher kommen Polster und Scroll`);
});
const rumpfRegel = regel(bauteilCss, ".avm-fenster__rumpf");
assert.ok(rumpfRegel && /padding:\s*var\(--avm-col-pad\)/.test(rumpfRegel),
	"und der Rumpf des Bauteils polstert wirklich -- die Klasse allein waere nur eine Behauptung");

// Und keine der beiden Dateien schreibt das Polster nochmal selbst hin.
[["Neuigkeiten", changelogCss, ".changelog-dialog__scroll"],
 ["Hinweise", legalCss, ".legal-dialog__scroll"]].forEach(([name, css, selektor]) => {
	const r = regel(css, selektor);
	if (r === null) return;   // Hinweise hat gar keine eigene Regel mehr -- das ist der Idealfall
	assert.ok(!/padding\s*:|overflow\s*:|flex\s*:/.test(r),
		`${name}: ${selektor} schreibt Polster, Scroll oder Flex NICHT noch einmal hin -- das`
		+ " stuende dann zweimal da und liefe beim naechsten Mal auseinander");
});

// ---- 3 · Das klebende Monatsband deckt das Polster ab ------------------------------------------
//
// 💣 DER NEBENEFFEKT, DEN DAS POLSTER ERZEUGT HAT, und der ohne diese Wache zurueckkommt:
//    `position: sticky; top: 0` klebt an der CONTENT-Box des Rumpfes, also --changelog-luft
//    UNTER dessen Kante -- und in diesem Streifen scrollt Text sichtbar durch. Im Browser
//    gemessen: das Band stand 8,0px unterhalb der Rumpfkante, darueber lief der Eintragstext
//    hindurch. Erst mit dem negativen `top` klebt es bei 0,0px.
// ⚠️ Abgedeckt wird mit einem Schlagschatten, NICHT mit einem zweiten Polster: ein hoeheres
//    padding-top wuerde auch den UNgeklebten Abstand aendern (gemessen 24 -> 32px zwischen
//    Eintrag und Monatsband), und darum ging es hier nicht.
const band = regel(changelogCss, ".changelog-month");
assert.ok(band, "die Regel .changelog-month gibt es");
assert.ok(/position:\s*sticky/.test(band), "das Monatsband klebt");
assert.ok(!/top:\s*0\s*;/.test(band),
	"das Band steht NICHT auf `top: 0` -- damit klebte es --changelog-luft unter der Rumpfkante,"
	+ " und in diesem Streifen scrollt Text sichtbar durch");
assert.ok(/top:\s*calc\(-1\s*\*\s*var\(--changelog-luft\)\)/.test(band),
	"es wird um genau das Rumpfpolster hoeher gezogen und liest dafuer --changelog-luft");
assert.ok(/box-shadow:\s*0\s+calc\(-1\s*\*\s*var\(--changelog-luft\)\)\s+0\s+0\s+var\(--color-panel\)/
	.test(band),
	"und deckt den Streifen mit einem Schatten in der Panelfarbe ab -- derselbe Wert, dieselbe"
	+ " Variable; drei gekoppelte Werte, eine Quelle");

// 🔴 Und die Variable, an der alle drei haengen, muss die senkrechte Haelfte von --avm-col-pad
//    SEIN -- nicht nur zufaellig gleich gross. Steht sie einmal woanders, klafft der Streifen
//    wieder auf, und zwar lautlos: das Band sieht im Standbild richtig aus und zeigt den Fehler
//    erst beim Scrollen.
const huelleChangelog = regel(changelogCss, ".changelog-dialog");
assert.ok(/--changelog-luft:\s*var\(--space-6\)/.test(huelleChangelog),
	"--changelog-luft ist definiert");
assert.ok(/--avm-col-pad:\s*var\(--changelog-luft\)\s+var\(--space-12\)/.test(huelleChangelog),
	"und --avm-col-pad liest sie als seine senkrechte Haelfte -- sonst sind es zwei Zahlen, die"
	+ " heute gleich sind und morgen nicht mehr");

console.log("fenster-zonen-polster tests passed");
