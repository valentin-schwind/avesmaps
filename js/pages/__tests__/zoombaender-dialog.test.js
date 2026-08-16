const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Das Fenster „Zoombänder" und sein Endpunkt sprechen dieselben Namen.
//
// 💣 WARUM DAS EINEN TEST BRAUCHT. Zwischen dem Fenster und api/edit/map/zoom-bands.php liegt eine
// JSON-Nutzlast, und die hat keine Signatur. Schickt das Fenster `zoom_bands` und liest der Server
// `bands`, passiert genau NICHTS Sichtbares: der Server lehnt ab oder speichert Leeres, und der
// Fehler faellt erst im Browser des Owners auf. Derselbe Grund wie bei tempowerte-dialog.test.js.
//
// 🔴 FORMWECHSEL: der Bauplan (docs/superpowers/plans/2026-08-16-zoombaender.md, Aufgabe 8,
// eingerueckter Vorspann) ersetzt die im Plan urspruenglich vorgesehenen Zahlentafeln mit Haekchen
// durch einen zieh-bedienbaren Plot (Vorbild: der abgenommene Prototyp docs/zoombaender-mockup.html).
// Dieser Test prueft deshalb NICHT `setZoomBandVisible`/Checkbox-Markup (das alte, ueberholte
// Muster), sondern die Stufenwahl-Knoepfe und die fuenf Zusicherungen, die den Formwechsel
// ueberlebt haben (siehe Vorspann).
//
// ⭐ Der Test liest beide Seiten als TEXT. Das Fenster ist DOM-Code in einer HTML-Datei und laesst
// sich nicht einzeln laden; die Namen stehen aber woertlich da, und genau sie sind der Vertrag.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/zoombaender-dialog.test.js

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const seite = read("html/wiki-sync-settlement-editor.html");
const endpunkt = read("api/edit/map/zoom-bands.php");
const bibliothek = read("api/_internal/app/zoom-bands.php");
const browser = read("js/map-features/location-zoom-bands.js");

// ---- 1. Die Kachel -----------------------------------------------------------------------------
assert.ok(/id="seZoomBands"/.test(seite), "die Kachel traegt die Kennung seZoomBands");
assert.ok(/Zoombänder/.test(seite), "die Kachel heisst „Zoombänder\"");
// 🔴 Owner-Entscheid, Fix-Runde 2 (Clipping bei acht Kacheln): gekuerzt auf "Zoomlevel aller Orte",
// nur die Kachel selbst -- "Nur Auswahl anzeigen" (fremde Kachel) bleibt unangetastet.
assert.ok(/Zoomlevel aller Orte/.test(seite), "und traegt ihre zweite Zeile");
// 🔴 Weich/outline: eine Nebenhandlung ist nie die Haupthandlung des Menuebands (AGENTS.md §12).
// Die Haupthandlung hier heisst „Syncen".
// ⚠️ Den GANZEN Knopf-Tag greifen, nicht „id=… gefolgt von class=" -- im Markup steht class VOR id,
// und ein Muster in der falschen Reihenfolge findet nie etwas und ist damit immer gruen.
const kachelTag = seite.match(/<button[^>]*id="seZoomBands"[^>]*>/);
assert.ok(kachelTag, "der Knopf-Tag der Kachel wurde gefunden");
assert.ok(!/\bprimary\b/.test(kachelTag[0]),
	"die Kachel ist nicht gefuellt -- die Haupthandlung dieses Menuebands heisst „Syncen\": " + kachelTag[0]);

// ---- 2. Die Aktionen ----------------------------------------------------------------------------
const erlaubteAktionen = [...endpunkt.matchAll(/\$action (?:===|!==) '([a-z_]+)'/g)].map((m) => m[1]);
["get", "save", "reset"].forEach((aktion) => {
	assert.ok(erlaubteAktionen.includes(aktion), `der Endpunkt kennt „${aktion}"`);
});
["get", "save", "reset"].forEach((aktion) => {
	assert.ok(new RegExp(`action:\\s*"${aktion}"`).test(seite), `das Fenster ruft „${aktion}"`);
});

// ---- 3. Die Nutzlast heisst „bands" --------------------------------------------------------------
assert.ok(/\$payload\['bands'\]/.test(endpunkt), "der Endpunkt liest payload['bands']");
assert.ok(/\bbands:\s*bands\b/.test(seite), "das Fenster schickt bands");
assert.ok(/ZOOM_BANDS_API\s*=\s*"\/api\/edit\/map\/zoom-bands\.php"/.test(seite),
	"das Fenster ruft den richtigen Endpunkt");

// 🔴 Beim Speichern reist die GANZE Tafel, nicht nur das Geaenderte -- der Server fuehrt keine
// Klassenliste und koennte ein Teilstueck nicht mit dem Bestand verschmelzen.
assert.ok(/function zoomBandsToPayload\(state\)/.test(seite),
	"es gibt eine Funktion, die die GANZE Tafel aus dem Bearbeitungszustand baut");
assert.ok(/bands = zoomBandsToPayload\(zoomBandsState\)/.test(seite),
	"und das Speichern ruft genau sie, nicht ein Teilstueck");
// 🔴 Gespeichert wird unveraendert `null` fuer „nicht sichtbar" (Entwurf §4.4) -- die im Fenster
// gemerkte Zahl einer ausgeblendeten Zelle darf den Server nie erreichen.
assert.ok(/z < st\.start \? null/.test(seite),
	"Zellen vor der Erscheinungsstufe werden beim Senden wieder null, nicht die gemerkte Zahl");

// ---- 4. Der Admin-Riegel steht auf BEIDEN Seiten -------------------------------------------------
assert.ok(/can_save/.test(endpunkt) && /can_save/.test(seite), "beide Seiten kennen can_save");
// 🔴 Der Riegel im Server ist der tragende. Ein ausgegrauter Knopf ist eine Hoeflichkeit.
assert.ok(/avesmapsUserCan\(\$user, 'admin'\)/.test(endpunkt),
	"der Endpunkt prueft die Admin-Faehigkeit selbst");
assert.ok(/'forbidden'/.test(endpunkt), "und weist ohne sie ab");
// 💣 Kein ausgegrauter Knopf: ein Knopf, den man nie druecken darf, ist ein Versprechen, das die
// Seite bricht -- ohne can_save steht ein SATZ, keine `disabled`-Schaltflaeche.
assert.ok(/Zoombänder einstellen dürfen nur Administratoren\./.test(seite),
	"ohne can_save steht der Satz aus AGENTS.md/Bauplan im Fenster");
assert.ok(/zb-nurlesen/.test(seite), "und er traegt eine eigene Klasse, keinen deaktivierten Knopf");

// ---- 5. Die Schranken stehen einmal, GELESEN statt abgeschrieben ---------------------------------
// Server und Browser pruefen dieselben Zahlen; laufen sie auseinander, lehnt der eine ab, was der
// andere anzeigt. Die aktuellen Werte (seit fdb27b3a): Marker 0,5-100 px, Label 4-30 pt.
assert.ok(/'marker' => \[0\.5, 100\.0\]/.test(bibliothek), "der Server kennt die Markerschranken 0,5 bis 100");
assert.ok(/'label' => \[4\.0, 30\.0\]/.test(bibliothek), "und die Schriftschranken 4 bis 30");
assert.ok(/marker:\s*\{\s*min:\s*0\.5,\s*max:\s*100\s*\}/.test(browser), "der Browser ebenso");
assert.ok(/label:\s*\{\s*min:\s*4,\s*max:\s*30\s*\}/.test(browser));
// 💣 Der Prototyp trug an dieser Stelle noch eine veraltete eigene Kopie (200 px / 96 pt) -- die
// darf ins Fenster nie uebernommen werden.
assert.ok(!/\bmax:\s*200\b/.test(seite) && !/\bmax:\s*96\b/.test(seite),
	"das Fenster schreibt die veralteten Grenzen 200/96 nicht ab");
// Und zwar GELESEN: das Fenster fragt die geladenen Konstanten ab, statt eigene Zahlen zu fuehren.
assert.ok(/AVESMAPS_ZOOM_BAND_LIMITS\[kind\]/.test(seite),
	"das Fenster liest AVESMAPS_ZOOM_BAND_LIMITS, statt Zahlen abzuschreiben");
assert.ok(/AVESMAPS_ZOOM_BAND_MAX_ZOOM/.test(seite),
	"und ebenso die hoechste Zoomstufe, statt 7/8 hart einzutragen");

// ---- 6. Die Erscheinungsstufe ersetzt das Haekchen (Formwechsel) ---------------------------------
// 🔴 Ein Klick setzt die ERSCHEINUNGSSTUFE der GANZEN Kurve, nie eine einzelne Zelle -- sonst
// entstehen Loecher, und ein Ort, der bei z3 da ist, bei z4 weg und bei z5 wieder da, sieht wie ein
// Fehler aus. Das Haekchen aus der ueberholten Tabellen-Fassung gibt es hier bewusst nicht mehr.
assert.ok(/function changeZoomBandStart\(kind, cls, newStart\)/.test(seite),
	"es gibt einen eigenen Handgriff fuer die Erscheinungsstufe, getrennt vom Zahlenfeld");
assert.ok(/class="zb-plot"/.test(seite), "die zwei Plots stehen im Markup");
assert.ok(/id="zbPlotMarker"/.test(seite) && /id="zbPlotLabel"/.test(seite),
	"Marker- und Label-Plot sind beide da");
assert.ok(/pointerdown/.test(seite), "die Punkte lassen sich ziehen");

// ⚠️ Die Zahlenfelder bleiben, mit Schrittweite 0,01 -- fuer Werte, die eine Maus nicht trifft, und
// damit die Punkte auch ohne Maus (Tastatur) erreichbar sind.
// 🔴 An das KONKRETE Feld gebunden, kein `||`-Rueckfall auf "irgendwo im Dokument" -- ein
// Rueckfall auf ein blosses /step="0\.01"/.test(seite) waere immer gruen gewesen, weil das
// Dokument die Schrittweite an vielen anderen Stellen ohnehin traegt (Prüfbefund, Fix-Runde 1:
// eine Zusicherung, die ihren Zweig nie verlaesst).
assert.ok(/id="zbSelMarkerInput"[^>]*step="0\.01"/.test(seite), "das Marker-Zahlenfeld traegt Schrittweite 0,01");
assert.ok(/id="zbSelLabelInput"[^>]*step="0\.01"/.test(seite), "das Label-Zahlenfeld traegt Schrittweite 0,01");
assert.ok(/ArrowUp/.test(seite) && /ArrowDown/.test(seite),
	"die Punkte lassen sich mit der Tastatur verstellen");

// ---- 6b. Ein echtes, tastaturerreichbares Schliessen-Kontrollelement in JEDEM Zustand ------------
// 🔴 KRITISCH (Pruefbefund, Fix-Runde 1). Ohne das sass ein Editor ohne Admin-Recht im gesperrten
// Zustand fest: die Aktionsleiste zeigte dort nur den Satz, kein Knopf, und der einzige andere
// Schliessweg (Klick aufs Overlay) ist ein reiner Maus-Mechanismus, den `keydown`/Tab nicht erreicht.
// ⚠️ Die Seite ist CRLF-zeilenendig -- \r?\n, nicht blankes \n, sonst findet das Ende-Muster nie
// etwas und die Probe waere trivial gruen, weil `actionsFn` dann `null` waere und der Test schon an
// der `assert.ok(actionsFn, ...)`-Zeile davor rot wuerde (also nicht heimlich gruen, aber auch nicht
// das, was hier geprueft werden soll).
const actionsFn = seite.match(/function renderZoomBandsActions\(\)[\s\S]*?\r?\n\}\r?\n/);
assert.ok(actionsFn, "renderZoomBandsActions wurde gefunden");
const actionsBody = actionsFn[0];
assert.strictEqual(
	(actionsBody.match(/id="seZoomBandsClose"/g) || []).length,
	2,
	"das Schliessen-Element steht in BEIDEN Zweigen (can_save true und false), nicht nur einem"
);
assert.ok(/\$\("seZoomBandsClose"\)\?\.addEventListener\("click", closeZoomBandsDialog\)/.test(actionsBody),
	"und es ruft die echte Schliessfunktion, nicht nur eine Attrappe");

// ---- 7. Das Fenster laedt die Vorgabetafel, statt sie abzuschreiben ------------------------------
// 🔴 Die Vorgabewerte stehen an EINER Stelle. Eine zweite Tafel im Fenster waere genau die
// Divergenz, die dieser Umbau abbaut.
assert.ok(/src="\/js\/map-features\/location-zoom-bands\.js"/.test(seite),
	"die Seite laedt die Vorgabedatei");
assert.ok(!/6\.65,\s*9\.4,\s*13\.3/.test(seite),
	"und schreibt die Zahlen NICHT ab");
assert.ok(/avesmapsResolveLocationZoomBands\(payload\.bands\)/.test(seite),
	"angezeigt wird die ZUSAMMENGEFUEHRTE Tafel, nicht die rohe Uebersteuerung");

console.log("zoombaender-dialog: alle Zusicherungen erfuellt");
