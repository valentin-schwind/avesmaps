const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Das reine Fundament der Beschriftungs-Platzierung (22.08.2026).
//
// 🔴 ES GIBT DAS VERFAHREN GENAU EINMAL. Zwei Aufrufer: die Karte
// (map-features-label-collisions.js) und das Vorschaupanel im Fenster „Zoombänder"
// (html/wiki-sync-settlement-editor.html). Der Prototyp docs/zoombaender-vorschau-mockup.html trug
// bewusst eine zweite Fassung, damit er per file:// läuft -- im Fenster wäre genau das der Fehler:
// eine Vorschau, die beim ersten Eingriff etwas anderes zeigt als die Karte, ist schlimmer als
// keine. Abschnitt G nagelt das fest.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/label-placement.test.js

const lies = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

globalThis.location = { search: "" };
vm.runInThisContext(lies("../location-zoom-bands.js"), { filename: "location-zoom-bands.js" });
vm.runInThisContext(lies("../label-placement.js"), { filename: "label-placement.js" });
avesmapsApplyLocationZoomBands(null);

// Ein Eintrag, wie ihn beide Aufrufer bauen: Kasten bei Offset 0, Grundstellung, Kandidaten.
const BREITE = 100;
const HOEHE = 20;
function eintrag(x, y, opts) {
	const o = opts || {};
	const basis = { x: 10, y: 0 };
	const roh = {
		left: x + basis.x, top: y + basis.y,
		right: x + basis.x + BREITE, bottom: y + basis.y + HOEHE,
		width: BREITE, height: HOEHE,
	};
	return {
		kollisionsRect: expandRect(roh, o.repel || 0),
		basisOffset: basis,
		kandidaten: avesmapsLabelCandidatePlacements(basis, BREITE, HOEHE, o.abstaende),
		gruppe: o.gruppe || "",
		relativ: o.relativ !== false,
		prioritaet: o.prioritaet || 0,
		minZoom: 0,
	};
}

// ---- A. Zwei Labels, die sich überlappen: das zweite weicht aus -----------------------------------
// Von Hand nachgerechnet (Versatz 8, Höhe 20): "rechts" und die beiden kleinen Schritte liegen noch
// auf A, "rechts oben" ragt mit seiner Unterkante hinein -- erst "rechts unten" ist frei.
let r = avesmapsResolveLabelPlacements([eintrag(0, 0), eintrag(0, 10)], {});
assert.strictEqual(r.ergebnisse[0].kandidat.name, "right", "das erste Label behaelt die Normalstellung");
assert.strictEqual(r.ergebnisse[1].kandidat.name, "bottom-right", "das zweite weicht auf die erste freie Stelle aus");
assert.strictEqual(r.ergebnisse[1].kollidiert, false, "und wird nicht ausgeblendet");
assert.strictEqual(r.belegt.length, 2, "beide Rechtecke sind danach belegt");

// ---- B. Der Deckel schneidet -- und blendet aus, wenn darunter nichts frei ist --------------------
// "rechts unten" driftet um Hoehe + Versatz = 28. Ein Deckel von 30 laesst es zu, einer von 20 nicht.
r = avesmapsResolveLabelPlacements([eintrag(0, 0), eintrag(0, 10)], { maxDrift: 30 });
assert.strictEqual(r.ergebnisse[1].kandidat.name, "bottom-right", "Deckel 30 laesst die Stelle zu (Drift 28)");

// 💣 UND DIE LINKE SEITE MUSS DAFUER MIT ZUGEHALTEN WERDEN. Seit dem 24.08.2026 kostet der
// Seitenwechsel nur seinen senkrechten Anteil, „links" hat also Drift 0 und ueberlebt JEDEN Deckel
// -- ohne diese Vorbelegung wiche das Label dorthin aus, statt zu verschwinden, und der Abschnitt
// pruefte nicht mehr, was er zu pruefen behauptet.
const LINKS_ZU = { left: -300, top: -100, right: 0, bottom: 100, width: 300, height: 200 };
r = avesmapsResolveLabelPlacements([eintrag(0, 0), eintrag(0, 10)], { maxDrift: 20, seedRects: [LINKS_ZU] });
assert.strictEqual(r.ergebnisse[1].kollidiert, true,
	"Deckel 20: keine erlaubte Stelle mehr frei -> ausgeblendet, NICHT weiter weg gesetzt");
assert.strictEqual(r.ergebnisse[1].kandidat.name, "right",
	"ein ausgeblendetes Label faellt auf die Normalstellung zurueck (Drift 0, immer erlaubt)");
assert.strictEqual(r.belegt.length, 2, "ein verstecktes Label ist KEIN Hindernis (nur Sperre + Label 1)");

// 🔴 Und die Gegenprobe zur Vorbelegung: steht links Platz, geht das Label DORTHIN statt zu
// verschwinden. Das ist die eigentliche Wirkung des Owner-Entscheids vom 24.08.2026.
r = avesmapsResolveLabelPlacements([eintrag(0, 0), eintrag(0, 10)], { maxDrift: 20 });
assert.strictEqual(r.ergebnisse[1].kandidat.name, "left",
	"ohne Sperre weicht es nach links aus -- der Seitenwechsel ueberlebt auch einen engen Deckel");
assert.strictEqual(r.ergebnisse[1].kollidiert, false, "und bleibt sichtbar");

// 💣 Der Deckel darf die Normalstellung NIE wegschneiden -- sonst haette der Rueckfall ein Loch.
r = avesmapsResolveLabelPlacements([eintrag(0, 0)], { maxDrift: 0 });
assert.strictEqual(r.ergebnisse[0].kandidat.name, "right", "Deckel 0 laesst die Normalstellung stehen");
assert.strictEqual(r.ergebnisse[0].kollidiert, false, "und blendet ein freistehendes Label nicht aus");

// ---- C. Die Rangfolge entscheidet, WER den guten Platz bekommt ------------------------------------
r = avesmapsResolveLabelPlacements([
	eintrag(0, 0, { prioritaet: 60 }),
	eintrag(0, 10, { prioritaet: 100 }),
], {});
assert.strictEqual(r.ergebnisse[1].kandidat.name, "right", "das hoeher priorisierte Label kommt zuerst dran");
// ⚠️ Nach OBEN, nicht nach unten: A liegt hoeher als B, also ist die freie Seite die obere.
// (Von Hand zuerst falsch angesetzt -- der Testlauf hat es korrigiert, nicht die Vermutung.)
assert.strictEqual(r.ergebnisse[0].kandidat.name, "top-right", "das andere weicht aus");
// ⚠️ Die Ergebnisse kommen in EINGABEreihenfolge zurueck, nicht in Bearbeitungsreihenfolge -- sonst
// schriebe der Aufrufer die Offsets auf die falschen Elemente.
assert.strictEqual(r.ergebnisse.length, 2, "ein Ergebnis je Eintrag, in Eingabereihenfolge");

// ---- D. `gruppe` heisst NUR NOCH „darf mit der eigenen Flaeche ueberlappen" ----------------------
// 💣 SIE TRUG BIS ZUM 31.08.2026 ZWEI BEDEUTUNGEN, und die zweite ist gefallen (Entwurf
// docs/superpowers/specs/2026-08-31-landschaften-label-kollision-design.md §3):
//   bleibt:  „Labels DERSELBEN Flaeche duerfen einander ueberlappen" (Owner 2026-07-28, Finsterkamm)
//   faellt:  „ein Flaechen-Label wird NIE ausgeblendet"
// Beide hingen an derselben Zeile (`const gesetzt = gruppe !== ""`). Dieser Abschnitt haelt sie
// auseinander -- wer sie beim naechsten Umbau wieder zusammenzieht, faellt hier auf.
r = avesmapsResolveLabelPlacements([
	eintrag(0, 0, { gruppe: "finsterkamm" }),
	eintrag(0, 10, { gruppe: "finsterkamm" }),
], {});
assert.strictEqual(r.ergebnisse[1].kandidat.name, "right",
	"DIE BLEIBENDE HAELFTE: Labels derselben Flaeche duerfen einander ueberlappen (Owner 2026-07-28)");
assert.strictEqual(r.ergebnisse[1].kollidiert, false, "und keines von beiden verschwindet deswegen");

// 🔴 DIE GEFALLENE HAELFTE. Grund (Owner 31.08.2026): seit dem 23.08.2026 traegt ein Label im
// Bearbeiten-Modus keinen Marker mehr, der Weg zu ihm fuehrt ueber das Kontextmenue der FLAECHE
// („Beschriftung bearbeiten"). Es ist damit nicht mehr der einzige Anfasser seiner Flaeche, und
// drei gestapelte Namen sind unlesbarer als zwei.
r = avesmapsResolveLabelPlacements([eintrag(0, 0), eintrag(0, 10, { gruppe: "tal" })],
	{ maxDrift: 20, seedRects: [LINKS_ZU] });
assert.strictEqual(r.ergebnisse[1].kollidiert, true,
	"ein Flaechen-Label ohne freien Platz verschwindet jetzt, statt liegenzubleiben");
assert.strictEqual(r.belegt.length, 2,
	"und sein Rechteck ist KEIN Hindernis mehr -- es ist ja nicht mehr da (Sperre + Label 1)");

// ⚠️ Die Gegenprobe: ein Flaechen-Label, das einen Platz FINDET, verschwindet natuerlich nicht.
r = avesmapsResolveLabelPlacements([eintrag(0, 0), eintrag(0, 10, { gruppe: "tal" })], { maxDrift: 20 });
assert.strictEqual(r.ergebnisse[1].kollidiert, false, "wer ausweichen kann, weicht aus");
assert.strictEqual(r.ergebnisse[1].kandidat.name, "left", "hier nach links");

// ---- E. Vorbelegung (Gebietsnamen) blockiert jeden ------------------------------------------------
const sperre = { left: 0, top: -40, right: 200, bottom: 40, width: 200, height: 80 };
r = avesmapsResolveLabelPlacements([eintrag(0, 0)], { seedRects: [sperre] });
assert.notStrictEqual(r.ergebnisse[0].kandidat.name, "right", "die Vorbelegung verdraengt aus der Normalstellung");
assert.ok(r.belegt.length >= 2, "die Vorbelegung reist in der Endlage mit");
// Eine Vorbelegung hat KEINE Gruppe und blockiert deshalb auch ein Gruppen-Label.
r = avesmapsResolveLabelPlacements([eintrag(0, 0, { gruppe: "tal" })], { seedRects: [sperre] });
assert.notStrictEqual(r.ergebnisse[0].kandidat.name, "right", "auch fuer ein Gruppen-Label");

// ---- F. Freie Kartenlabels: ihr Kandidat IST der Offset, und der Deckel gilt jetzt auch --------
// 💣 EINE STELLE OHNE `drift` BLEIBT UNGEDECKELT, und das ist die sichere Richtung: der Riegel
// prueft weiterhin `typeof kandidat.drift === "number"`. Gefallen ist nur das `relativ &&` davor
// (31.08.2026). Ein Aufrufer mit schlichten {dx, dy} wird also nie beschnitten -- der schlimmste
// Fall ist „ein Name weicht weiter aus als gedacht", nicht „alle Namen verschwinden".
const freiesLabel = {
	kollisionsRect: { left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20 },
	basisOffset: { x: 0, y: 0 },
	kandidaten: [{ dx: 0, dy: 0 }, { dx: 8, dy: 0 }],
	gruppe: "",
	relativ: false,
	prioritaet: 1000,
	minZoom: 0,
};
r = avesmapsResolveLabelPlacements([freiesLabel], { maxDrift: 0 });
assert.deepStrictEqual(r.ergebnisse[0].kandidat, { dx: 0, dy: 0 },
	"eine Stelle ohne `drift` wird vom Deckel nicht angefasst");

// 🔴 MIT `drift` schneidet er sehr wohl -- das ist der ganze Sinn des Reglers „Drift" fuer die
// Landschaftsnamen. Gemessen an zwei Kandidaten, deren zweiter 24 px driftet.
const mitDrift = (dx, dy) => ({
	kollisionsRect: { left: dx, top: dy, right: dx + 50, bottom: dy + 20, width: 50, height: 20 },
	basisOffset: { x: 0, y: 0 },
	kandidaten: [
		{ name: "mitte", dx: 0, dy: 0, drift: 0 },
		{ name: "unten", dx: 0, dy: 24, drift: 24 },
	],
	gruppe: "",
	relativ: false,
	prioritaet: 1000,
	minZoom: 0,
});
r = avesmapsResolveLabelPlacements([mitDrift(0, 0), mitDrift(0, 10)], { maxDrift: 24 });
assert.strictEqual(r.ergebnisse[1].kandidat.name, "unten", "Deckel 24 laesst die Stelle mit Drift 24 zu");
r = avesmapsResolveLabelPlacements([mitDrift(0, 0), mitDrift(0, 10)], { maxDrift: 16 });
assert.strictEqual(r.ergebnisse[1].kollidiert, true, "Deckel 16 schneidet sie weg -> ausgeblendet");

// 💣 UND DER DECKEL GILT JE EINTRAG, NICHT JE AUFRUF. Orts- und Landschaftsnamen liegen in EINEM
// Durchgang (resolveLabelCollisions ruft den Loeser einmal mit beiden Familien) und haben seit dem
// 31.08.2026 EIGENE Regler. Ein gemeinsamer Wert fuer zwei Familien ist damit nicht baubar.
const engEintrag = { ...mitDrift(0, 10), maxDrift: 16 };
r = avesmapsResolveLabelPlacements([mitDrift(0, 0), engEintrag], { maxDrift: 24 });
assert.strictEqual(r.ergebnisse[1].kollidiert, true,
	"der eigene Deckel des Eintrags schlaegt die Aufrufoption");
const weitEintrag = { ...mitDrift(0, 10), maxDrift: 24 };
r = avesmapsResolveLabelPlacements([mitDrift(0, 0), weitEintrag], { maxDrift: 0 });
assert.strictEqual(r.ergebnisse[1].kandidat.name, "unten",
	"und zwar in beide Richtungen -- ein weiter Eintrag ueberlebt einen engen Aufruf");

// ---- G. Die Reinheit -- und sie ist die Bedingung dafuer, dass es das Panel geben kann ------------
const quelle = lies("../label-placement.js");
// ⚠️ Ohne Kommentare pruefen. Sonst schlaegt die Reinheitspruefung an der eigenen Begruendung an
// ("...statt getBoundingClientRect aufzurufen") -- ein Test, der Prosa fuer Code haelt, ist nur
// laestig und wird beim naechsten Mal entschaerft statt ernst genommen.
const kern = quelle
	.split("// ⚠️ NUR FÜR DIE NODE-TESTS")[0]
	.replace(/^[ \t]*\/\/.*$/gm, "");
[
	["document\\.", "document"],
	["window\\.", "window"],
	["getBoundingClientRect", "eine DOM-Messung"],
	["querySelector", "eine DOM-Suche"],
	["\\bmap\\.", "die Leaflet-Karte"],
].forEach(([muster, was]) => {
	assert.ok(!new RegExp(muster).test(kern),
		`label-placement.js fasst ${was} nicht an -- sonst kann das Fenster es nicht rufen`);
});
// 💣 Und kein Modulzustand: eine Funktion, die sich zwischen zwei Aufrufen etwas merkt, liefert dem
// Panel und der Karte verschiedene Antworten.
assert.ok(!/^let |^var /m.test(kern), "kein veraenderlicher Zustand auf Dateiebene");

// ---- H. Verdrahtung: BEIDE Aufrufer rufen wirklich dieses Fundament -------------------------------
const karte = lies("../map-features-label-collisions.js");
const fenster = lies("../../../html/wiki-sync-settlement-editor.html");

assert.ok(/avesmapsResolveLabelPlacements\(/.test(karte), "die Karte ruft den geteilten Loeser");
assert.ok(/avesmapsLabelCandidatePlacements\(/.test(karte), "die Karte ruft die geteilten Ausweichstellen");
assert.ok(/avesmapsResolveLabelPlacements\(/.test(fenster), "das Fenster ruft denselben Loeser");
assert.ok(/avesmapsLabelCandidatePlacements\(/.test(fenster), "das Fenster ruft dieselben Ausweichstellen");
assert.ok(/avesmapsLabelBaseOffset\(/.test(fenster), "und dieselbe Grundstellungs-Formel");

// 💣 DIE ENTSCHEIDENDE HAELFTE: keiner der beiden darf eine EIGENE Fassung tragen. Gemessen wird an
// den Namen der zwoelf Stellen -- wer sie abschreibt, schreibt sie mit.
[["die Karte", karte], ["das Fenster", fenster]].forEach(([wer, text]) => {
	assert.ok(!/name: "bottom-left"/.test(text),
		`${wer} fuehrt keine eigene Liste der zwoelf Ausweichstellen`);
});
// Und beide laden die Datei ueberhaupt.
assert.ok(/label-placement\.js/.test(lies("../../../index.html")), "index.html laedt das Fundament");
assert.ok(/label-placement\.js/.test(fenster), "die Editorseite laedt es ebenfalls");

// ---- I. Das Panel zeigt UNGESPEICHERTE Werte -----------------------------------------------------
// 💣 Ohne die Uebersteuerung muesste das Fenster _avesmapsLocationZoomBands umbiegen, um sich selbst
// zu zeichnen -- eine Falle fuer den naechsten Leser.
avesmapsApplyLocationZoomBands(null);
const mitVorgabe = avesmapsLabelCandidatePlacements({ x: 10, y: 0 }, BREITE, HOEHE);
const mitUeber = avesmapsLabelCandidatePlacements({ x: 10, y: 0 }, BREITE, HOEHE, { versatz: 20 });
assert.strictEqual(mitVorgabe[1].drift, 8, "ohne Uebersteuerung gilt die Vorgabe (Versatz 8)");
assert.strictEqual(mitUeber[1].drift, 20, "mit Uebersteuerung der mitgegebene Wert");
assert.strictEqual(avesmapsLocationLabelSpacing("versatz"), 8,
	"und der globale Zustand bleibt dabei unberuehrt");

// ---- J. Die Polsterung des Namensbildes -- der Name links steht sonst 2 x padX zu weit ----------
// 💣 `labelWidth` IST DIE BILDBREITE. Das Namens-<img> traegt links und rechts je `padX`
// durchsichtige Polsterung (Platz fuer den Halo, rund 10 px bei einem Dorf auf z5). Rechts faellt
// das nicht auf, weil das Bild um genau diesen Betrag zurueckgeschoben wird -- links wurde die
// volle Bildbreite gespiegelt und die Polsterung zaehlte DOPPELT. Owner 24.08.2026: „linksbuendig
// ist - nur mit etwas zu viel abstand auf der rechten seite".
const PAD = 10;
const basisJ = { x: 14, y: 0 };
const ohnePad = avesmapsLabelCandidatePlacements(basisJ, BREITE, HOEHE);
const mitPad = avesmapsLabelCandidatePlacements(basisJ, BREITE, HOEHE, undefined, PAD);
const stelleJ = (liste, name) => liste.find((s2) => s2.name === name);

// 🔴 DIE REGEL IST SPIEGELUNG DES SICHTBAREN TEXTES, und so wird sie gemessen: rechts beginnt er
// bei baseOffset.x, links endet er beim selben Abstand auf der anderen Seite.
const spalt = Math.max(LOCATION_LABEL_GAP, basisJ.x);
const textbreite = BREITE - PAD * 2;
assert.strictEqual(stelleJ(mitPad, "left").dx + textbreite, -spalt,
	"der sichtbare Text endet links genau `scaledGap` vor dem Punkt");
assert.strictEqual(stelleJ(mitPad, "right").dx, basisJ.x,
	"und beginnt rechts genau `baseOffset.x` dahinter -- dieselbe Weite, gespiegelt");

// Und die Differenz zur alten Rechnung ist genau die doppelte Polsterung.
assert.strictEqual(stelleJ(mitPad, "left").dx - stelleJ(ohnePad, "left").dx, PAD * 2,
	"gegen die alte Rechnung rueckt der Name um 2 x padX naeher an den Punkt");
["left-up", "left-down", "top-left", "bottom-left"].forEach((name) => {
	assert.strictEqual(stelleJ(mitPad, name).dx, stelleJ(mitPad, "left").dx,
		`${name} teilt die Korrektur -- sonst zappelt der Name beim Ausweichen waagerecht`);
});

// ⚠️ Ohne Angabe bleibt alles wie bisher: das Vorschaupanel setzt echten Text ohne Polsterung.
assert.strictEqual(stelleJ(ohnePad, "left").dx, -BREITE - spalt, "ohne padX die alte Rechnung");
assert.strictEqual(avesmapsLabelCandidatePlacements(basisJ, BREITE, HOEHE, undefined, 0)[5].dx,
	stelleJ(ohnePad, "left").dx, "und padX = 0 ist dasselbe");

// 💣 Der Seitenwechsel bleibt gratis -- die Korrektur darf den Deckel nicht anfassen.
assert.strictEqual(stelleJ(mitPad, "left").drift, 0, "die Polsterung aendert den Drift nicht");

// 💣 UND DIE VERDRAHTUNG, sonst ist die Rechnung oben folgenlos (Hausregel): der Renderer muss die
// Polsterung als lesbaren Wert ausgeben, und der Loeser der Karte muss sie holen.
const renderer = lies("../map-features-location-name-labels.js");
assert.ok(/--location-label-pad-x:\$\{image\.padX\}px/.test(renderer),
	"der Renderer gibt padX als CSS-Variable aus");
assert.ok(/left:calc\(.*var\(--location-label-pad-x\)\)/.test(renderer),
	"und dasselbe `left:calc` benutzt sie -- EINE Quelle, kein zweiter Zahlenwert daneben");
const karteJ = lies("../map-features-label-collisions.js");
assert.ok(/getLocationNameLabelPadX\(element\)/.test(karteJ),
	"getLocationNameLabelOffsets reicht die Polsterung durch");
assert.ok(/getPropertyValue\("--location-label-pad-x"\)/.test(karteJ),
	"und liest sie aus derselben Variablen, statt sie nachzurechnen");

// ---- K. Die Ausweichstellen eines FREIEN Kartenlabels (31.08.2026) -------------------------------
// 🔴 Ein Landschaftsname sitzt MITTIG auf seinem Punkt, nicht neben einem Marker -- die zwoelf
// Stellen der Ortsnamen lassen sich deshalb nicht abschreiben. Ein Ring um den Punkt ist die
// Entsprechung. Vorher waren es NEUN feste Stellen mit hoechstens ±12 px waagerecht und ±8 px
// senkrecht (getLabelOffsetCandidates), und bei 179-296 px Namensbreite bewegte das nichts.
const ring = avesmapsFreeLabelCandidatePlacements(8, 24);

assert.deepStrictEqual(
	{ name: ring[0].name, dx: ring[0].dx, dy: ring[0].dy, drift: ring[0].drift },
	{ name: "mitte", dx: 0, dy: 0, drift: 0 },
	"die Normalstellung steht zuerst und driftet nicht -- sie traegt den Rueckfall");

// 💣 SENKRECHT ZUERST, und das ist begruendet, nicht Geschmack: breite Namen ueberlappen stark
// waagerecht und nur wenig senkrecht, der kuerzeste Ausweg ist also nach oben oder unten. Dieselbe
// Begruendung steht seit jeher an den Territoriumsnamen (getRegionLabelOffsetCandidates).
assert.deepStrictEqual([ring[1].dx, ring[1].dy], [0, -8], "die zweite Stelle geht nach OBEN");
assert.deepStrictEqual([ring[2].dx, ring[2].dy], [0, 8], "die dritte nach UNTEN");
const ersteWaagerecht = ring.findIndex((k) => k.dy === 0 && k.dx !== 0);
const ersteSenkrecht = ring.findIndex((k) => k.dx === 0 && k.dy !== 0);
assert.ok(ersteSenkrecht < ersteWaagerecht, "senkrecht kommt vor waagerecht");

// Der Ring waechst in Schritten von `versatz` bis `deckel` -- und KEINE Stelle darueber hinaus.
assert.ok(ring.every((k) => k.drift <= 24 + 1e-9), "keine Stelle liegt jenseits des Deckels");
assert.ok(ring.some((k) => Math.round(k.drift) === 16), "der zweite Ring (2 x 8) ist dabei");
assert.ok(ring.some((k) => Math.round(k.drift) === 24), "und der dritte");
// ⚠️ Die Diagonale eines Rings liegt weiter als seine Achse: bei Schritt 24 ist sie 33,9 und faellt
// damit aus einem Deckel von 24 heraus. Genau das soll `drift` leisten -- Luftlinie, nicht Ringnummer.
assert.ok(!ring.some((k) => k.dx === 24 && k.dy === 24), "die Diagonale des dritten Rings faellt heraus");
assert.strictEqual(
	ring.filter((k) => k.dx === 8 && k.dy === -8).length, 1,
	"die Diagonale des ersten Rings (Drift 11,3) bleibt");

// Jede Stelle kommt genau einmal vor -- eine Wiederholung waere ein verschenkter Versuch.
const schluessel = ring.map((k) => `${k.dx}|${k.dy}`);
assert.strictEqual(new Set(schluessel).size, schluessel.length, "keine Stelle steht doppelt");

// 💣 EIN VERSATZ VON 0 DARF NICHT ENDLOS SCHLEIFEN. Der Regler laesst ihn nicht zu, aber ein
// kaputter gespeicherter Wert erreicht diese Funktion trotzdem -- und eine Endlosschleife im
// Kollisionsdurchgang friert die Karte ein, statt nur schlecht auszusehen.
assert.deepStrictEqual(avesmapsFreeLabelCandidatePlacements(0, 56).length, 1,
	"Versatz 0 ergibt genau die Normalstellung");
assert.deepStrictEqual(avesmapsFreeLabelCandidatePlacements(-5, 56).length, 1, "ein negativer ebenso");
assert.deepStrictEqual(avesmapsFreeLabelCandidatePlacements(NaN, 56).length, 1, "und NaN auch");
assert.deepStrictEqual(avesmapsFreeLabelCandidatePlacements(8, 0).length, 1,
	"Deckel 0 heisst: gar kein Ausweichen, nur die Normalstellung");

// ---- L. Verdrahtung: die Karte benutzt den Bauer, statt ihre neun Stellen zu behalten ------------
const karteL = lies("../map-features-label-collisions.js");
assert.ok(/avesmapsFreeLabelCandidatePlacements\(/.test(karteL),
	"die Karte ruft den geteilten Kandidatenbauer fuer freie Labels");
// 💣 Und sie fuehrt keine eigene Liste mehr. Gemessen an der alten Tafel: sie trug [12, -6] als
// einzige Stelle mit dieser Form -- wer sie abschreibt, schreibt sie mit.
assert.ok(!/\[12,\s*-6\]/.test(karteL),
	"die neun festen Stellen sind weg, nicht neben dem Bauer stehengeblieben");
assert.ok(/maxDrift:/.test(karteL), "und sie reicht den Deckel JE EINTRAG durch");

// 💣 Der Repel je Familie: der Landschaftsname darf nicht laenger den Regler der ORTSCHAFTEN lesen
// (avesmapsLocationLabelSpacing("repel") war bis 31.08.2026 die Vorgabe fuer ALLE Elemente des
// Durchgangs -- eine Kopplung, die nirgends stand).
assert.ok(/avesmapsEcosystemDisplayAbstand\(/.test(karteL),
	"freie Labels lesen ihre Abstaende aus der Landschafts-Darstellungstafel");

console.log("label-placement: alle Zusicherungen erfuellt");
