// Der Kurvenform-Schieber im Kraftlinien-Editor. Quelltext-Test, weil die Seite ein
// eigenstaendiges iframe-Dokument ohne Modulgrenzen ist. Lauf:
//   node js/pages/__tests__/kraftlinie-kurve-editor.test.js
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §8
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

// ---- 1. Der Schieber steht IM Identitaet-Block ----------------------------------------------
// 🔴 Ausdruecklich KEIN eigener dt-grp-Abschnitt: editor-abschnittsreihenfolge.test.js fuehrt die
// Abschnittsfolge dieses Fensters als feste Owner-Liste (Identitaet -> Beschreibung ->
// Wiki-Zuweisung -> Quellen -> Speicherleiste). Ein neuer Kopf hiesse eine sechste Zeile darin --
// fuer EIN Feld, das eine Darstellungsentscheidung ist wie das Haekchen darueber.
const posShowLabel = ohneKommentare.indexOf('id="plShowLabel"');
const posCurve = ohneKommentare.indexOf('id="plCurve"');
const posBeschreibung = ohneKommentare.indexOf('"dt-grp">Beschreibung<');
assert.ok(posShowLabel > -1, "das Haekchen plShowLabel steht nicht mehr da -- umbenannt?");
assert.ok(posCurve > -1, "der Kurvenform-Schieber (#plCurve) fehlt");
assert.ok(posBeschreibung > -1, "der Abschnitt Beschreibung steht nicht mehr da");
assert.ok(posCurve > posShowLabel,
	"der Schieber gehoert UNTER das Haekchen 'Name auf der Karte anzeigen' (Owner-Bild 29.08.2026)");
assert.ok(posCurve < posBeschreibung,
	"der Schieber ist aus dem Identitaet-Block herausgerutscht");

// ---- 2. Der Bereich ist der des Entwurfs ----------------------------------------------------
const schieber = ohneKommentare.slice(posCurve - 200, posCurve + 200);
assert.ok(/type="range"/.test(schieber), "#plCurve ist kein Schieber");
assert.ok(/min="-45"/.test(schieber), "der Bereich beginnt nicht bei -45");
assert.ok(/max="45"/.test(schieber), "der Bereich endet nicht bei 45");

// ---- 3. Der Wert wird ueberhaupt gelesen ----------------------------------------------------
// ⚠️ Seit dem 29.08.2026 reist er NICHT mehr bedingungslos mit (siehe 10) -- gelesen werden muss er
// trotzdem, sonst tut der Schieber gar nichts.
assert.ok(/\$\("plCurve"\)\.value/.test(ohneKommentare),
	"der Linien-Schieber wird nirgends ausgelesen");

// ---- 4. Der geladene Wert wird angezeigt ----------------------------------------------------
// 💣 WEDER some()/every() (das sind Wahrheitswerte, curve ist eine Zahl, und `some` laese eine
// gespeicherte 0 als „nicht gesetzt") NOCH fieldSample: seit dem 29.08.2026 kann eine Linie
// UNEINIGE Segmente haben, und fieldSample nimmt den erstbesten -- der Linien-Schieber behauptete
// dann einen Wert, den nur ein Teil der Segmente traegt.
assert.ok(/curveOfLine\(line\)/.test(ohneKommentare),
	"renderDetail rechnet den Linienwert nicht ueber curveOfLine");
assert.ok(!/fieldSample\(line,\s*"curve"\)/.test(ohneKommentare),
	"fieldSample nimmt den erstbesten Segmentwert -- bei uneinigen Segmenten ist das eine Luege");
assert.ok(!/segments\.some\(\(s\)\s*=>\s*s\.curve\)/.test(ohneKommentare),
	"curve ist eine ZAHL -- some() liest 0 und -0 als 'nicht gesetzt'");

// ---- 5. Die Attrappe traegt das Feld --------------------------------------------------------
// ⚠️ Ohne curve in demoData laeuft der Vorschau-Modus der Seite gegen undefined, und ein Entwickler
// ohne Datenbank sieht einen Fehler, den es in der Wirklichkeit nicht gibt.
assert.ok(/curve:\s*0/.test(ohneKommentare), "die Demo-Segmente tragen kein curve");

// ---- 6. Die Anzeige nennt eine Einheit ------------------------------------------------------
// Eine nackte Zahl an einem Schieber sagt nicht, ob sie Prozent, Grad oder Meilen ist.
assert.ok(/id="plCurveVal"/.test(ohneKommentare), "es gibt keine Wertanzeige zum Schieber");
assert.ok(/function curveText\(/.test(ohneKommentare), "curveText() fehlt -- wer formatiert dann?");
assert.ok(/"\s*%"/.test(ohneKommentare) || /'\s*%'/.test(ohneKommentare),
	"die Anzeige nennt die Einheit (Prozent) nicht");

// ---- 7. Der Schieber ist mit der Anzeige verdrahtet -----------------------------------------
// 🪤 „Das Element ist da" ist auch dann erfuellt, wenn niemand darauf hoert -- der Schieber liesse
// sich ziehen, und die Zahl daneben bliebe stehen.
assert.ok(/\$\("plCurve"\)\.addEventListener\("input"/.test(ohneKommentare),
	"niemand hoert auf das Ziehen des Schiebers -- die Anzeige bliebe stehen");

// ---- 8. JE SEGMENT (29.08.2026, Entwurf 13) -------------------------------------------------
// 🔴 Owner vor dem „Faecher der Macht" (4 Kanten sternfoermig von Kreuzung-4): ein gemeinsamer Wert
// kann dort nicht richtig sein, weil die vier Kanten in vier Richtungen zeigen.
// Die Kantenliste (verzweigt/Ring) bekommt je Kante einen Schieber ...
assert.ok(/data-curve-seg="/.test(ohneKommentare),
	"die Kantenliste hat keinen Schieber je Segment");
// ... und beim STRANG die Verbindung zwischen zwei Nodices (.pl-conn ist optisch das Segment).
// 🪤 Gemessen wird im STRANG-ZWEIG, nicht irgendwo in der Datei: ein Muster, das nur „kommt vor"
// prueft, ist fuer zwei Zweige derselben Funktion wertlos -- der Schieber koennte allein in der
// Kantenliste stehen, und der Normalfall (54 von 61 Linien sind Straenge) haette keinen.
const strangVon = ohneKommentare.indexOf('t.shape === "strand"');
const strangBis = ohneKommentare.indexOf("Verzweigte Linie");
assert.ok(strangVon > -1 && strangBis > strangVon, "der Strang-Zweig laesst sich nicht abgrenzen");
const strangZweig = ohneKommentare.slice(strangVon, strangBis);
assert.ok(/curveSegMarkup\(segmentBetween\(/.test(strangZweig),
	"beim Strang haengt an der Verbindung kein Segment-Schieber");
assert.ok(/pl-conn/.test(strangZweig), "die Verbindung .pl-conn ist aus dem Strang-Zweig verschwunden");

// Und die Kantenliste (verzweigt/Ring) ebenso -- BEIDE Zweige, sonst hat einer von beiden nichts.
const kantenZweig = ohneKommentare.slice(strangBis, ohneKommentare.indexOf("renderAddPanel(line)", strangBis));
assert.ok(/curveSegMarkup\(seg\)/.test(kantenZweig),
	"in der Kantenliste haengt an keiner Kante ein Segment-Schieber");

// ---- 9. „gemischt" ist ein eigener Zustand ---------------------------------------------------
// 💣 Sind die Segmente uneinig, darf der Linien-Schieber KEINEN Wert behaupten -- sonst macht ein
// Speichern jede gewollte Ausnahme platt, und zwar lautlos.
// 🪤 Und zwar aus der RECHNUNG heraus, nicht als blosses Vorkommen des Wortes: eine Zusicherung
// auf /gemischt/ allein bleibt gruen, wenn linienKurve fest auf „einheitlich" steht -- der Zustand
// waere dann nie erreichbar. Am 29.08.2026 per Mutationsprobe gefunden.
assert.ok(/linienKurve\.einheitlich \?[^:]*: "gemischt"/.test(ohneKommentare),
	"die Anzeige 'gemischt' haengt nicht an linienKurve.einheitlich");
// 🪤 MIT der Zuweisung, nicht nur mit dem Aufruf: `curveOfLine(line)` trifft auch die
// DEFINITIONSZEILE `function curveOfLine(line) {` -- die Zusicherung waere Vakuum, und genau so
// ueberlebte die Mutation „linienKurve fest auf einheitlich".
assert.ok(/const linienKurve = curveOfLine\(line\);/.test(ohneKommentare),
	"linienKurve kommt nicht aus curveOfLine -- der Zustand waere geraten");

// ---- 10. Der Rumpf schickt beides GETRENNT ---------------------------------------------------
// 💣 Der Linienwert reist NUR mit, wenn jemand ihn angefasst hat -- der Server liest seine
// Abwesenheit seit heute als „nicht geaendert" (avesmapsApplyPowerlineCurve). Ginge er immer mit,
// setzte jedes Speichern alle Segmente gleich.
assert.ok(/rumpf\.curves\s*=/.test(ohneKommentare),
	"saveLine schickt die Segmentwerte (curves) nicht mit");
assert.ok(!/^\s*curve: Number\(\$\("plCurve"\)\.value\)/m.test(ohneKommentare),
	"curve reist immer noch bedingungslos im Rumpf mit -- das setzt alle Segmente bei jedem Speichern gleich");
assert.ok(/if \(curveLineTouched\)/.test(ohneKommentare),
	"der Linienwert haengt an keiner Bedingung -- er muss NUR bei Anfassen mitreisen");
// 🪤 Und das Merkmal muss auch wirklich GESETZT werden: ein `let curveLineTouched = false`, das
// niemand auf true zieht, laesst die Bedingung oben nie greifen -- der Linien-Schieber waere dann
// stumm wirkungslos.
assert.ok(/curveLineTouched\s*=\s*true/.test(ohneKommentare),
	"curveLineTouched wird nirgends auf true gesetzt -- der Linien-Schieber wirkte nie");
// Und nach erfolgreichem Speichern muessen die Entwuerfe fallen, sonst schickt der naechste
// Speichervorgang alte Segmentwerte erneut mit.
assert.ok(/curveDraft\s*=\s*\{\}/.test(ohneKommentare),
	"die Segment-Entwuerfe werden nie geleert");

// ---- 11. Der Rueckweg von der Karte zaehlt als ANFASSEN ---------------------------------------
// 💣 Der Kartenregler schickt seinen Wert per postMessage ins Formular. Seit 10 reist der Linienwert
// nur noch bei Anfassen mit -- ohne curveLineTouched an dieser Stelle stellt man die Kurve auf der
// Karte ein, drueckt „Speichern", und der Server bekommt NICHTS. Von „hat nicht funktioniert" ist
// das nicht zu unterscheiden.
const rueckweg = ohneKommentare.slice(
	ohneKommentare.indexOf("avesmapsPowerlineCurveResult"),
	ohneKommentare.indexOf("avesmapsPowerlineSelect"));
assert.ok(rueckweg.length > 0, "der Rueckweg von der Karte laesst sich nicht abgrenzen");
assert.ok(/curveLineTouched\s*=\s*true/.test(rueckweg),
	"der Kartenwert kommt ins Formular, gilt aber nicht als angefasst -- er wuerde nie gespeichert");

// ---- 12. TABELLENFORM MIT FESTEN SPALTEN (Owner 29.08.2026) ---------------------------------
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
assert.ok(/var\(--pl-curve-col/.test(quelle) , "die Kantenliste benutzt den geteilten Wert nicht");
const cssDatei = fs.readFileSync(path.join(__dirname, "..", "..", "..", "css", "components", "editor-page.css"), "utf8");
assert.ok(/var\(--pl-curve-col/.test(cssDatei),
	"der Schieber-Block nimmt eine eigene Breite statt der geteilten Spalte");

console.log("OK: Kraftlinien-Kurve -- Schieber je Linie UND je Segment, gemischt, Tabellenform.");
