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

// ---- D. Die Gruppenregel: eigene Flaeche blockiert nicht, und sie wird NIE ausgeblendet -----------
r = avesmapsResolveLabelPlacements([
	eintrag(0, 0, { gruppe: "finsterkamm" }),
	eintrag(0, 10, { gruppe: "finsterkamm" }),
], {});
assert.strictEqual(r.ergebnisse[1].kandidat.name, "right",
	"Labels DERSELBEN Flaeche duerfen einander ueberlappen (Owner 2026-07-28)");

// Eine Gruppe ohne jeden freien Platz bleibt stehen statt zu verschwinden -- ihr Label ist der
// einzige garantierte Anfasser ihrer Flaeche.
r = avesmapsResolveLabelPlacements([eintrag(0, 0), eintrag(0, 10, { gruppe: "tal" })], { maxDrift: 20 });
assert.strictEqual(r.ergebnisse[1].kollidiert, false, "ein Flaechen-Label wird NIE ausgeblendet");
assert.strictEqual(r.belegt.length, 2, "und sein Rechteck ist trotzdem ein Hindernis -- es ist ja sichtbar");

// ---- E. Vorbelegung (Gebietsnamen) blockiert jeden ------------------------------------------------
const sperre = { left: 0, top: -40, right: 200, bottom: 40, width: 200, height: 80 };
r = avesmapsResolveLabelPlacements([eintrag(0, 0)], { seedRects: [sperre] });
assert.notStrictEqual(r.ergebnisse[0].kandidat.name, "right", "die Vorbelegung verdraengt aus der Normalstellung");
assert.ok(r.belegt.length >= 2, "die Vorbelegung reist in der Endlage mit");
// Eine Vorbelegung hat KEINE Gruppe und blockiert deshalb auch ein Gruppen-Label.
r = avesmapsResolveLabelPlacements([eintrag(0, 0, { gruppe: "tal" })], { seedRects: [sperre] });
assert.notStrictEqual(r.ergebnisse[0].kandidat.name, "right", "auch fuer ein Gruppen-Label");

// ---- F. Freie Kartenlabels: kein Drift, kein relativer Versatz -------------------------------------
// 💣 Ihr Kandidat IST der Offset (nicht die Ziellage), und sie tragen keinen `drift` -- ein Deckel
// darf sie deshalb nie wegschneiden.
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
	"ein freies Kartenlabel wird vom Deckel nicht angefasst");

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

console.log("label-placement: alle Zusicherungen erfuellt");
