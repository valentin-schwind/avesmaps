// Die Zoomstufe an der Karte (Fall #100, 25.08.2026).
//
// Geprueft wird, was hier nicht selbsterklaerend ist und beim naechsten Anfassen lautlos kippt:
//
//   1. Sie steht UEBER den +/- Knoepfen -- das haengt einzig daran, dass sie IM Behaelter des
//      Zoom-Controls haengt statt daneben. Im Editormodus verlegt infopanel.css die Knoepfe per
//      `position: fixed` nach unten rechts; als Nachbar-Control blieb die Zahl 967px entfernt oben
//      stehen (live gemessen, beim Bauen genau einmal passiert).
//   2. Nur im Editormodus. Ohne den Riegel sieht sie jeder Besucher.
//   3. Kein Kaestchen (Owner-Entscheid) und weisse Schrift, die auf HELLER Karte lesbar bleibt --
//      der Rueckhalt ist woertlich der aus .location-name-label span. Zwei Rezepturen fuer
//      dieselbe Frage sind hier die Divergenz, die AGENTS.md §12 meint.
//   4. Gerundet, nicht abgeschnitten, und ein nicht-endlicher Zoom schreibt gar nichts.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/zoomstufe-anzeige.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

/** 💣 Die Prosa in diesen Dateien beschreibt genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function ohneKommentare(quelle) {
	return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const css = ohneKommentare(read("css", "components", "zoomstufe-anzeige.css"));
const labelCss = ohneKommentare(read("css", "features", "map-labels.css"));
const bootstrap = ohneKommentare(read("js", "app", "bootstrap.js"));
// 💣 OHNE KOMMENTARE gelesen: ein Dateipfad in einem <!-- --> ist fuer `indexOf` ein
// frueheres script-Tag. Das dreht eine Reihenfolgepruefung um (falsch ROT) und macht eine
// Vorhandenseinspruefung falsch GRUEN. Am 02.09.2026 genau so passiert.
const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
const styles = read("css", "styles.css");

/** Findet den ERSTEN Block, dessen Selektorliste den gesuchten Selektor enthaelt -- er darf also
 *  Teil einer Kommaliste sein (`.map-label span, .location-name-label span { … }`). */
function regel(quelle, selektor) {
	const gesucht = selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// Entweder der Selektor schliesst den Kopf ab (`… {`) oder es folgen weitere (`…, … {`).
	const treffer = quelle.match(new RegExp(`(?:^|\\})[^{}]*?${gesucht}\\s*(?:,[^{}]*?)?\\{([^}]*)\\}`));
	assert.ok(treffer, `die Regel fuer \`${selektor}\` ist auffindbar`);
	return treffer[1];
}

// ---- 1. Die VERSCHACHTELUNG ist die Position ----------------------------------------------------
// 💣 Der Kern dieses Bauteils, und beim Bauen genau einmal falsch gemacht: die Zahl haengt IM
// Behaelter der +/- Knoepfe, nicht als eigenes Control daneben. Im Editormodus reisst
// `.avesmaps-infopanel-mode .leaflet-control-zoom` (css/features/infopanel.css) die Knoepfe per
// `position: fixed` aus Leaflets Ecke nach unten rechts -- als Nachbar blieb die Zahl oben stehen,
// live gemessen 967px daneben, und zwar in genau dem Modus, in dem sie ueberhaupt sichtbar ist.
const stelleEigen = bootstrap.indexOf("avesmapsZoomstufeAnhaengen");
assert.ok(stelleEigen > -1, "bootstrap.js haengt die Zoomstufe ueberhaupt ein");
assert.ok(
	/avesmapsZoomstufeAnhaengen\(\s*map\s*,\s*\w+\.getContainer\(\)\s*\)/.test(bootstrap),
	"sie bekommt den Behaelter des Zoom-Controls (getContainer()) -- daran haengt, dass sie jeder "
		+ "Verlegung folgt, statt eine zweite Positionsregel zu brauchen"
);

const stelleZoom = bootstrap.indexOf("L.control.zoom(");
assert.ok(stelleZoom > -1, "und L.control.zoom steht weiterhin da");
assert.ok(
	stelleZoom < stelleEigen,
	"das Zoom-Control entsteht ZUERST -- vorher gibt es keinen Behaelter zum Einhaengen"
);

// ---- 2. Nur im Editormodus ---------------------------------------------------------------------
const riegel = bootstrap.slice(Math.max(0, stelleEigen - 200), stelleEigen);
assert.ok(
	/IS_EDIT_MODE/.test(riegel),
	"der Aufruf steht hinter IS_EDIT_MODE -- ein Besucher sieht die Zahl nicht"
);

// ---- 3a. Kein Kaestchen ------------------------------------------------------------------------
const huelle = regel(css, ".zoomstufe-anzeige");
for (const verboten of ["background", "border", "border-radius", "box-shadow"]) {
	assert.ok(
		!new RegExp(`(^|;|\\s)${verboten}\\s*:`).test(huelle),
		`kein \`${verboten}\` an der Huelle -- der Owner wollte ausdruecklich KEIN Kaestchen`
	);
}
assert.ok(/color:\s*#ffffff/i.test(huelle), "die Schrift ist weiss");

// ---- 3a'. Sie schwebt UEBER der Knopfleiste, statt ihre Lage zu rechnen -------------------------
assert.ok(
	/position:\s*absolute/.test(huelle) && /bottom:\s*100%/.test(huelle),
	"sie steht absolut auf `bottom: 100%` des Zoom-Behaelters -- also immer direkt darueber, egal "
		+ "wohin infopanel.css die Knoepfe legt. Eine gerechnete Koordinate waere die zweite Antwort."
);
assert.ok(
	!/(^|;|\s)(top|right)\s*:/.test(huelle),
	"und sie setzt weder `top` noch `right` -- das waeren genau die Werte, die bei der Verlegung "
		+ "veralten"
);

// ---- 3b. Derselbe Rueckhalt wie die Kartenbeschriftungen ---------------------------------------
// 🔴 DIE tragende Zusicherung. Weisse Schrift ohne Kasten auf heller Pergamentkarte ist die
// Aufgabe, die die Ortsnamen seit jeher loesen. Weicht der Schatten hier ab, ist eine zweite
// Rezeptur fuer dieselbe Frage entstanden -- und die eine wandert beim naechsten Feinschliff,
// die andere nicht.
// 💣 Bezug ist `.location-name-label span`, NICHT `.map-label span`: beide stehen in derselben
// Sammelregel, aber fuer .map-label wird der Schatten zwei Regeln spaeter auf `none`
// zurueckgenommen (jene Labels sind Canvas-<img>). Wer dort vergleicht, prueft gegen "kein
// Schatten" und der Test wuerde die Absicht genau umdrehen.
const schattenNormalisieren = (block) => {
	const treffer = block.match(/text-shadow:\s*([^;]+);/);
	assert.ok(treffer, "die Regel setzt einen text-shadow");
	return treffer[1].replace(/\s+/g, " ").trim();
};
assert.strictEqual(
	schattenNormalisieren(huelle),
	schattenNormalisieren(regel(labelCss, ".location-name-label span")),
	"der Schatten ist woertlich der aus .location-name-label span -- keine zweite Rezeptur"
);

// ⚠️ Die Gegenprobe: ohne sie bewiese der Vergleich oben nur, dass zwei leere Werte gleich sind.
assert.ok(
	schattenNormalisieren(huelle).includes("rgba(0, 0, 0"),
	"und er traegt wirklich einen dunklen Rueckhalt, ist also nicht `none`"
);

// ---- 3c. Die Schriftgroessen -------------------------------------------------------------------
// 🔴 Die Beschriftung liegt UNTER der 11px-Untergrenze aus AGENTS.md §12, und das ist ENTSCHIEDEN,
// nicht passiert: Owner am 25.08.2026 -- "das zoom ist zu groß, machs kleiner", auf Nachfrage
// "design entscheid für dieses eine UI-element, editor-spezifisch".
// 🔴 Die Reichweite gehoert zur Entscheidung: DIESES Element, nur im Editormodus, kein
// Praezedenzfall. Auf einer Listenzeile bleiben 11px die Grenze -- dort ist sie zweimal
// versehentlich gefallen, und genau davor schuetzt die Regel.
// 💣 Ein Boden bleibt trotzdem stehen: ohne ihn landet der naechste "etwas kleiner"-Wunsch bei 6px,
// und dann ist es kein Wort mehr, sondern ein Fleck.
const wort = regel(css, ".zoomstufe-anzeige__wort");
const wortGroesse = Number((wort.match(/font-size:\s*(\d+)px/) || [])[1]);
assert.ok(wortGroesse >= 9, `die Beschriftung faellt nicht unter 9px (ist: ${wortGroesse}px)`);

const zahl = regel(css, ".zoomstufe-anzeige__zahl");
const zahlGroesse = Number((zahl.match(/font-size:\s*(\d+)px/) || [])[1]);
assert.ok(
	zahlGroesse >= wortGroesse * 2,
	"die Zahl bleibt das Hauptelement -- mindestens doppelt so gross wie ihre Beschriftung "
		+ `(Zahl ${zahlGroesse}px, Wort ${wortGroesse}px)`
);
assert.ok(
	/font-variant-numeric:\s*tabular-nums/.test(zahl),
	"die Ziffern laufen auf fester Breite -- sonst springt die Zahl beim Wechsel 1 -> 7"
);

// ---- 4. Der Schreiber: runden, und NaN nicht durchlassen ---------------------------------------
const sandkasten = { module: { exports: {} }, document: undefined };
vm.createContext(sandkasten);
vm.runInContext(read("js", "ui", "zoomstufe-anzeige.js"), sandkasten);

const element = { textContent: "" };
const karte = (stufe) => ({ getZoom: () => stufe });

sandkasten.avesmapsZoomstufeSchreiben(element, karte(4));
assert.strictEqual(element.textContent, "4", "eine ganze Stufe steht als ganze Zahl da");

sandkasten.avesmapsZoomstufeSchreiben(element, karte(4.6));
assert.strictEqual(
	element.textContent,
	"5",
	"stufenloser Zoom wird GERUNDET -- abgeschnitten zeigte 4, waehrend die Karte fast auf 5 steht"
);

sandkasten.avesmapsZoomstufeSchreiben(element, karte(3.2));
assert.strictEqual(element.textContent, "3", "und nach unten ebenso");

// 💣 Der NaN-Riegel: ein nicht-endlicher Zoom hat hier schon einmal eine ganze Kette vergiftet.
// Die alte Zahl bleibt stehen -- "NaN" auf der Karte waere schlimmer.
sandkasten.avesmapsZoomstufeSchreiben(element, karte(Number.NaN));
assert.strictEqual(element.textContent, "3", "ein NaN-Zoom laesst die zuletzt gute Zahl stehen");

sandkasten.avesmapsZoomstufeSchreiben(element, karte(Number.POSITIVE_INFINITY));
assert.strictEqual(element.textContent, "3", "und Unendlich ebenso");

// Ohne Karte / ohne Element faellt er still durch, statt zu werfen.
sandkasten.avesmapsZoomstufeSchreiben(element, null);
assert.strictEqual(element.textContent, "3", "eine fehlende Karte wirft nicht");
sandkasten.avesmapsZoomstufeSchreiben(null, karte(2));

// ---- 5. Die Verdrahtung: geladen und importiert -------------------------------------------------
// 💣 Ein Bauteil, dessen CSS niemand importiert, sieht im Test perfekt aus und live nach nichts.
assert.ok(
	/@import url\("components\/zoomstufe-anzeige\.css"\);/.test(styles),
	"das Stilblatt haengt in css/styles.css -- sonst greift keine einzige Regel"
);

const stelleSkript = html.indexOf("js/ui/zoomstufe-anzeige.js");
const stelleBootstrap = html.indexOf("js/app/bootstrap.js");
assert.ok(stelleSkript > -1, "index.html laedt das Bauteil");
assert.ok(
	stelleSkript < stelleBootstrap,
	"und zwar VOR bootstrap.js -- dort wird die Funktion aufgerufen"
);

// ⚠️ Die Datei darf auf oberster Ebene nichts ausfuehren: zum Ladezeitpunkt gibt es weder `map`
// noch `L`. Das ist derselbe Vertrag, den map-features-region-operation-chip.js im Kopf nennt.
const quelle = ohneKommentare(read("js", "ui", "zoomstufe-anzeige.js"));
const obersteEbene = quelle
	.split("\n")
	.filter((zeile) => zeile.trim() !== "" && !/^[\s})\]]/.test(zeile) && !/^function /.test(zeile));
assert.deepStrictEqual(
	obersteEbene,
	[],
	`die Datei enthaelt nur Funktionsdeklarationen. Ausserhalb steht: ${obersteEbene.join(" | ")}`
);

console.log("zoomstufe-anzeige: alle Zusicherungen gruen.");
