// Die Kurvenform im Kraftlinien-Editor. Quelltext-Test, weil die Seite ein eigenstaendiges
// iframe-Dokument ohne Modulgrenzen ist. Lauf:
//   node js/pages/__tests__/kraftlinie-kurve-editor.test.js
//
// 🔴 EINEN SCHIEBER FUER DIE GANZE LINIE GIBT ES NICHT MEHR (Owner 29.08.2026: „die kurvenform bei
// ‚eigenschaften' brauchen wir nicht mehr, wenn die segmente einzeln eingestellt werden koennen").
// Die Kurve ist ausschliesslich eine Eigenschaft des einzelnen Segments.
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §13
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const datei = path.join(__dirname, "..", "..", "..", "html", "wiki-sync-powerline-editor.html");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
const quelle = fs.readFileSync(datei, "utf8").replace(/\r\n/g, "\n");
// ⚠️ Kommentare wegschneiden, sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt
// -- und der naechste Leser loescht dann den Kommentar, um den Test gruen zu bekommen.
const ohneKommentare = quelle
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[ \t]*\/\/.*$/gm, "");

// ---- 1. Der Linien-Schieber ist WEG ----------------------------------------------------------
// 💣 Und zwar restlos: ein zurueckgebliebener `$("plCurve")` greift ins Leere und wirft beim ersten
// Klick -- der Editor stuende dann still, ohne dass jemand die Ursache sieht.
assert.ok(!/id="plCurve"/.test(ohneKommentare), "der Schieber fuer die ganze Linie steht wieder da");
assert.ok(!/plCurveVal/.test(ohneKommentare), "die Anzeige des Linien-Schiebers ist noch da");
assert.ok(!/curveLineTouched/.test(ohneKommentare),
	"das Merkmal des Linien-Schiebers ist noch da -- toter Zustand");
assert.ok(!/curveOfLine/.test(ohneKommentare),
	"curveOfLine rechnet noch einen Linienwert, den niemand mehr anzeigt");
assert.ok(!/renderLineCurveValue/.test(ohneKommentare), "renderLineCurveValue ist verwaist");
assert.ok(!/gemischt/.test(ohneKommentare),
	"der Zustand 'gemischt' gehoerte zum Linien-Schieber und ist ohne ihn sinnlos");

// ---- 2. Der Weg auf die Karte bleibt, im Identitaet-Block -----------------------------------
// 🔴 KEIN eigener dt-grp-Abschnitt: die Abschnittsfolge dieses Fensters ist eine feste Owner-Liste
// (16.08.2026), gewacht von editor-abschnittsreihenfolge.test.js.
const posShowLabel = ohneKommentare.indexOf('id="plShowLabel"');
const posKnopf = ohneKommentare.indexOf('id="plCurveOnMap"');
const posBeschreibung = ohneKommentare.indexOf('"dt-grp">Beschreibung<');
assert.ok(posShowLabel > -1, "das Haekchen plShowLabel steht nicht mehr da -- umbenannt?");
assert.ok(posKnopf > -1, "der Knopf fuer das Einstellen auf der Karte fehlt");
assert.ok(posKnopf > posShowLabel && posKnopf < posBeschreibung,
	"der Knopf ist aus dem Identitaet-Block herausgerutscht");
// 🔴 OHNE Beschriftungsspalte: seit der Linien-Schieber gefallen ist, steht hier keine Eigenschaft
// mehr, sondern eine HANDLUNG. Im Label-Raster blieb links ein leerer Fleck -- der Owner hat am
// 29.08.2026 genau darauf gezeigt.
const knopfZeile = ohneKommentare.slice(posKnopf - 300, posKnopf);
assert.ok(/dt-grid stack/.test(knopfZeile),
	"der Knopf steht wieder im Label-Raster -- links bleibt ein leerer Fleck");
assert.ok(!/<div class="k">Kurvenform<\/div>/.test(ohneKommentare),
	"die leere Beschriftungszelle 'Kurvenform' ist zurueck");

// ---- 3. Der Knopf reicht die SEGMENTE herueber ----------------------------------------------
// 💣 Nicht mehr einen einzelnen Wert: auf der Karte wird ein Stueck angeklickt und einzeln gebogen,
// der Regler braucht dafuer die Liste mit Kennung, Wert und Beschriftung.
assert.ok(/start\(line\.name, segmente\)/.test(ohneKommentare),
	"der Knopf reicht dem Kartenregler keine Segmentliste");
assert.ok(/public_id: seg\.public_id/.test(ohneKommentare), "den Segmenten fehlt ihre Kennung");
assert.ok(/curve: curveOfSegment\(seg\)/.test(ohneKommentare),
	"die Segmente reisen ohne ihren aktuellen Entwurfsstand");
assert.ok(/label: nodeName\(/.test(ohneKommentare),
	"den Segmenten fehlt die Beschriftung -- auf der Karte waeren sie nicht unterscheidbar");

// ---- 4. Der Schieber JE SEGMENT, in BEIDEN Zweigen ------------------------------------------
// 🔴 Owner vor dem „Faecher der Macht" (4 Kanten sternfoermig von Kreuzung-4): ein gemeinsamer Wert
// kann dort nicht richtig sein, weil die vier Kanten in vier Richtungen zeigen.
assert.ok(/data-curve-seg="/.test(ohneKommentare), "es gibt keinen Schieber je Segment");
// 🪤 Gemessen wird je ZWEIG, nicht irgendwo in der Datei: ein Muster, das nur „kommt vor" prueft,
// ist fuer zwei Zweige derselben Funktion wertlos -- der Schieber koennte allein in der Kantenliste
// stehen, und der Normalfall (die meisten Linien sind Straenge) haette keinen.
const strangVon = ohneKommentare.indexOf('t.shape === "strand"');
const strangBis = ohneKommentare.indexOf("Verzweigte Linie");
assert.ok(strangVon > -1 && strangBis > strangVon, "der Strang-Zweig laesst sich nicht abgrenzen");
const strangZweig = ohneKommentare.slice(strangVon, strangBis);
assert.ok(/curveSegMarkup\(segmentBetween\(/.test(strangZweig),
	"beim Strang haengt an der Verbindung kein Segment-Schieber");
assert.ok(/pl-conn/.test(strangZweig), "die Verbindung .pl-conn ist aus dem Strang-Zweig verschwunden");
const kantenZweig = ohneKommentare.slice(strangBis, ohneKommentare.indexOf("renderAddPanel(line)", strangBis));
assert.ok(/curveSegMarkup\(seg\)/.test(kantenZweig),
	"in der Kantenliste haengt an keiner Kante ein Segment-Schieber");

// ---- 5. Die Segment-Schieber sind verdrahtet -------------------------------------------------
// 🪤 „Das Element ist da" ist auch dann erfuellt, wenn niemand darauf hoert -- die Schieber liessen
// sich ziehen, und nichts passierte.
assert.ok(/querySelectorAll\("\[data-curve-seg\]"\)/.test(ohneKommentare),
	"niemand hoert auf das Ziehen der Segment-Schieber");
assert.ok(/curveDraft\[pid\] = Number\(schieber\.value\)/.test(ohneKommentare),
	"der gezogene Wert landet nicht im Entwurf");

// ---- 6. Der Rumpf schickt NUR Angefasstes ----------------------------------------------------
// 💣 Der Server liest die Abwesenheit als „nicht geaendert" (avesmapsApplyPowerlineCurve). Ginge
// etwas bedingungslos mit, machte JEDES Speichern -- auch eine reine Beschreibungsaenderung -- die
// eingestellten Kurven platt. Die andere Haelfte steht im Server (array_key_exists statt `?? 0`);
// die zwei gehoeren zusammen und duerfen nicht einzeln zurueckgedreht werden.
assert.ok(/rumpf\.curves = curveDraft;/.test(ohneKommentare),
	"saveLine schickt die Segmentwerte (curves) nicht mit");
assert.ok(/if \(Object\.keys\(curveDraft\)\.length > 0\)/.test(ohneKommentare),
	"die Segmentwerte reisen bedingungslos mit statt nur bei Anfassen");
assert.ok(!/rumpf\.curve\s*=/.test(ohneKommentare),
	"der Linienwert reist wieder mit -- den Schieber dafuer gibt es nicht mehr");
assert.ok(/curveDraft = \{\};/.test(ohneKommentare), "die Segment-Entwuerfe werden nie geleert");

// ---- 7. Der Rueckweg von der Karte traegt eine KARTE ----------------------------------------
// 💣 Die Werte wandern in denselben ENTWURF wie die Kantenregler -- damit gilt fuer sie dieselbe
// Regel „nur Angefasstes reist mit". Ohne das stellte man die Kurve auf der Karte ein, drueckte
// „Speichern", und der Server bekaeme nichts: von „hat nicht funktioniert" nicht zu unterscheiden.
const rueckweg = ohneKommentare.slice(
	ohneKommentare.indexOf("avesmapsPowerlineCurveResult"),
	ohneKommentare.indexOf("avesmapsPowerlineSelect"));
assert.ok(rueckweg.length > 0, "der Rueckweg von der Karte laesst sich nicht abgrenzen");
assert.ok(/curveDraft\[pid\] = wert;/.test(rueckweg),
	"die auf der Karte eingestellten Werte landen nicht im Entwurf");
assert.ok(/Number\.isFinite\(wert\)/.test(rueckweg),
	"ein unlesbarer Wert von der Karte rutscht ungeprueft in den Entwurf");

// ---- 8. Die Attrappe traegt das Feld ---------------------------------------------------------
// ⚠️ Ohne curve in demoData laeuft der Vorschau-Modus gegen undefined, und ein Entwickler ohne
// Datenbank sieht einen Fehler, den es in der Wirklichkeit nicht gibt.
assert.ok(/curve:\s*0/.test(ohneKommentare), "die Demo-Segmente tragen kein curve");
assert.ok(/function curveText\(/.test(ohneKommentare), "curveText() fehlt -- wer formatiert dann?");
assert.ok(/"\s*%"/.test(ohneKommentare) || /'\s*%'/.test(ohneKommentare),
	"die Anzeige nennt die Einheit (Prozent) nicht");

// ---- 9. TABELLENFORM MIT FESTEN SPALTEN (Owner 29.08.2026) ----------------------------------
// 🔴 Mit Flex verschob jeder Name die Position aller folgenden Elemente -- bei „Kreuzung-4 —
// Nadoret" gegen „Kreuzung-4 — Festum" stand jeder Schieber woanders.
const edgeRegel = quelle.slice(quelle.indexOf(".pl-edge {"), quelle.indexOf(".pl-edge {") + 400);
assert.ok(/display:\s*grid/.test(edgeRegel), ".pl-edge ist kein Raster mehr -- die Spalten flattern");
assert.ok(/grid-template-columns:/.test(edgeRegel), ".pl-edge hat keine feste Spaltenvorlage");
// 💣 minmax(0,1fr) und NICHT auto: eine auto-Spalte waechst mit ihrem laengsten Inhalt, und genau
// das ist der Flattersatz, der hier weg soll. Die 0 als Untergrenze ist tragend -- ohne sie
// schrumpft eine Grid-Spalte nicht unter ihren Inhalt, und das Ellipsieren bliebe wirkungslos.
assert.ok(/minmax\(0,\s*1fr\)/.test(edgeRegel),
	"die Namensspalten sind nicht minmax(0,1fr) -- sie wachsen mit ihrem Inhalt");
// ⚠️ Der Flex-Trick fuer „ganz rechts" schoebe die Knoepfe aus ihrer Rasterspalte.
assert.ok(!/\.pl-edge \.pl-icon-btn \{[^}]*margin-left:\s*auto/.test(quelle),
	"margin-left:auto steht wieder an den Kantenknoepfen -- das bricht die Spalte");
// 💣 EIN Wert fuer die Kurvenspalte, geteilt von Kantenliste und Verbindung. Stuenden hier zwei
// Zahlen, liefen die beiden Ansichten beim ersten Nachjustieren auseinander.
assert.ok(/--pl-curve-col:/.test(quelle), "die Breite der Kurvenspalte ist kein geteilter Wert");
assert.ok(/var\(--pl-curve-col/.test(quelle), "die Kantenliste benutzt den geteilten Wert nicht");
const cssDatei = fs.readFileSync(path.join(__dirname, "..", "..", "..", "css", "components", "editor-page.css"), "utf8");
assert.ok(/var\(--pl-curve-col/.test(cssDatei),
	"der Schieber-Block nimmt eine eigene Breite statt der geteilten Spalte");

console.log("OK: Kraftlinien-Kurve -- nur noch je Segment, Kartenweg, Tabellenform.");
