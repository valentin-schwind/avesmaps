// Das Menue der gesetzten Markierung (sharePinMenuMarkup in js/ui/popups.js).
//
// Zwei Kacheln, in dieser Reihenfolge: Verschieben, dann Entfernen. Wer danebengeklickt hat, will
// ruecken statt wegwerfen und neu setzen -- dieselbe Reihenfolge wie am freien Kartenpunkt.
//
//   1. 💣 DIE MARKIERUNG IST KEIN ORT (Owner 14.08.2026, zehnte Meldung: „design loeschen und
//      nochmal beginnen"). Zehn Runden lang war dieses Menue der ORTSKASTEN mit Sonderregeln davor
//      -- erst eine eigene Zeilenfassung, dann das vierspaltige Kachelraster der Infobox fuer zwei
//      Knoepfe (gemessen: 43 px breit, 86 px hoch). Der Kasten hier erbt vom Ortskasten NICHTS
//      mehr; die Zusicherungen unten halten diese Trennung.
//   2. 💣 Das Verschieben-Zeichen wohnt an EINER Stelle (popupMoveIconMarkup). Zwei Popups tragen
//      es; zwei Abschriften desselben SVG laufen auseinander.
//   3. 💣 EIN wartender Verschiebe-Zustand fuer alle Punktarten (route-travel-here.js). Zwei
//      gleichzeitig wartende Zustaende koennten denselben Klick beide beanspruchen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/share-pin-popup.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const js = ohneKommentare(read("js", "ui", "popups.js"));
const css = ohneKommentare(read("css", "features", "location-popups-markers.css"));
const routing = ohneKommentare(read("js", "routing", "routing.js"));
const travel = ohneKommentare(read("js", "routing", "route-travel-here.js"));
const marker = ohneKommentare(read("js", "map-features", "map-features-share-pin.js"));

// ---- Die zwei Kacheln, in ihrer Reihenfolge ----------------------------------------------------
const start = js.indexOf("function sharePinMenuMarkup");
assert.ok(start > 0, "der Bauer steht in popups.js");
const bauer = js.slice(start, js.indexOf("\nfunction ", start + 10));
const posReise = bauer.indexOf("travel-to-share-pin");
const posEntfernen = bauer.indexOf("remove-share-pin");
assert.ok(posReise > 0 && posEntfernen > 0, "beide Aktionen sind da");
// 💣 Die aufbauende Aktion zuerst, die zerstoerende zuletzt -- eine Loeschkachel neben oder vor
//    einer anderen ist der Knopf, den man beim Zielen trifft.
assert.ok(posReise < posEntfernen, "die Reise-Kachel steht vor dem Entfernen");
// 🔴 KEINE Verschieben-Kachel mehr (Owner 15.08.2026: „verschieben kann wieder weg, drag n drop
//    geht ja immer"). Sie wird am Marker gezogen; eine Kachel fuer das, was die Geste ohnehin kann,
//    ist eine Kachel zu viel. Am freien KARTENPUNKT bleibt sie -- ihn gibt es auch als
//    Wegpunkt-Zeile im Planer, wo kein Marker zum Anfassen danebensteht.
// ⚠️ In Anfuehrungszeichen geprueft: ein blosses /move-share-pin/ trifft auch das „remove-share-pin"
//    der Nachbarkachel und war damit immer wahr -- der erste Anlauf dieser Zeile ist genau darueber
//    gestolpert (und hat, waere er andersherum geschrieben gewesen, nie etwas gemeldet).
assert.ok(!/"move-share-pin"/.test(bauer) && !/"move-share-pin"/.test(routing) && !/"move-share-pin"/.test(marker),
	"die Verschieben-Kachel der Markierung ist restlos weg");
assert.ok(!/beginSharePinRelocation/.test(travel) && !/beginSharePinRelocation/.test(routing),
	"und ihr wartender Klick-Zustand mit ihr");
// ⚠️ Ohne Kommentare gelesen: die i18n-Tabelle ERKLAERT in einer Kommentarzeile, warum der Schluessel
//    gefallen ist -- ein roher Dateitext liesse diese Zusicherung an der Begruendung scheitern.
assert.ok(!/popup\.moveMarker/.test(js) && !/popup\.moveMarker/.test(ohneKommentare(read("js", "app", "i18n-en.js"))),
	"auch ihre i18n-Zeile");
assert.ok(/action === "move-map-point"/.test(routing) && /function beginMapPointRelocation\(waypointId\)/.test(travel),
	"der freie Kartenpunkt behaelt seine Kachel");
// 💣 Und der Verteiler faellt mit: `pendingRelocation` traegt wieder genau ein Ziel. Ein `kind` mit
//    nur noch einem Wert waere eine Fallunterscheidung, die keinen Fall mehr unterscheidet.
assert.ok(!/kind === "share-pin"|kind: "(share-pin|map-point)"/.test(travel),
	"der wartende Zustand hat keine Fallunterscheidung mehr");

// ---- 💣 Die Reise-Kachel ruft den geteilten Weg, nicht einen zweiten ----------------------------
// „Hierher reisen" im Kartenmenue und diese Kachel sind dieselbe Handlung. travelToMapPoint traegt
// den Punkt als Wegpunkt ein und laesst den Planer rechnen; ein eigener Routenweg fuer die
// Markierung waere genau der zweite Weg, den diese Funktion abgeschafft hat.
assert.ok(/action === "travel-to-share-pin"/.test(routing), "der Klick-Handler kennt die Aktion");
const reiseZweig = routing.slice(routing.indexOf('action === "travel-to-share-pin"'));
const reiseRumpf = reiseZweig.slice(0, reiseZweig.indexOf("\n\t}"));
assert.ok(/travelToMapPoint\(sharePinCoordinates\)/.test(reiseRumpf),
	"sie reist zur MARKIERUNG -- contextMenuLatLng truege die Stelle des letzten Rechtsklicks");
// 🔴 Und sie ist GANZ die Kachel, die es fuer diese Handlung schon gibt (Owner 14.08.2026: „das
//    typische symbol für reiseziel hinzufügen ist das +"): dasselbe Plus, dieselbe i18n-Zeile,
//    dieselbe gefuellte Fuellung wie routeToggleActionButtonMarkup an einer Ortschaft. Der
//    Wanderschuh gehoert dem REISEN („Hierher reisen"), nicht dem Hinzufuegen zur Liste.
const reiseKachel = bauer.slice(bauer.indexOf("travel-to-share-pin") - 700, bauer.indexOf("travel-to-share-pin"));
assert.ok(/location-popup__action-icon" aria-hidden="true">\+</.test(reiseKachel), "sie traegt das Plus");
assert.ok(!/schuh\.webp/.test(bauer), "und nicht den Wanderschuh");
assert.ok(/popup\.addToRoutePlain/.test(reiseKachel), "Beschriftung aus derselben i18n-Zeile wie am Ort");
assert.ok(!/popup\.sharePinTravel/.test(js) && !/popup\.sharePinTravel/.test(read("js", "app", "i18n-en.js")),
	"keine zweite i18n-Zeile fuer dieselbe Handlung");
assert.ok(/location-popup__action-button--accent/.test(reiseKachel),
	"und die Fuellung der Hauptaktion, wie am Ort (docs/design-language.md)");
assert.ok(/img\/menu\/papierkorb\.webp/.test(bauer), "Entfernen traegt den Papierkorb");
assert.ok(fs.existsSync(path.join(ROOT, "img", "menu", "papierkorb.webp")), "und das Bild liegt im Repo");
assert.ok(!/popupMoveIconMarkup\(\)/.test(bauer), "und kein Verschieben-Kreuz mehr -- die Kachel ist weg");
assert.ok(!/\u{1F5D1}/u.test(bauer), "kein Papierkorb-Emoji in der Beschriftung");
assert.ok(!/\u{1F5D1}/u.test(read("js", "app", "i18n-en.js")), "auch nicht in der englischen Tabelle");

// ---- 💣 Der Kasten ist ein EIGENER, kein geliehener Ortskasten ----------------------------------
// Das ist der Kern der Neufassung: jede der zehn Runden davor hat am Rahmen des Ortskastens
// geschraubt, statt der Markierung einen eigenen zu geben. Faellt eine dieser Zusicherungen, ist
// genau dieser Rueckschritt passiert.
assert.ok(!/locationPopupMarkup/.test(bauer), "das Menue baut NICHT den Ortskasten");
assert.ok(!/\blocation-popup__(?!action-button|action-img|action-icon)/.test(bauer),
	"und leiht sich aus dem Ortskasten nur den Kachel-Knopf, keine Rahmen-Klasse");
assert.ok(/class="share-pin-menu__box"/.test(bauer), "es hat seinen eigenen Kasten");
assert.ok(/class="share-pin-menu__actions"/.test(bauer), "und sein eigenes Kachelband");
assert.ok(/className: "share-pin-menu"/.test(marker) && !/floating-location-popup/.test(marker),
	"der Marker haengt das Menue in die eigene Huelle, nicht in die des Ortskastens");
// 💣 KACHELN (Owner 14.08.2026: „lass doch die kacheln") -- aber ohne die feste 90-px-Breite der
//    Infobox, die den Kasten auf 208 px trieb („braucht es keine riesige breite bei 2 buttons").
//    Der Kniff ist das Paar `width: max-content` am Band + `1fr`-Spalten: erst die Wunschbreite,
//    dann gleichmaessig darin teilen. Ohne max-content faellt 1fr auf die Mindestbreite zusammen
//    (gemessen 45 px), ohne 1fr laufen die zwei Kacheln unterschiedlich breit auseinander.
const knopfRegel = css.slice(css.indexOf(".share-pin-menu .location-popup__action-button {"));
assert.ok(/flex-direction:\s*column/.test(knopfRegel.slice(0, knopfRegel.indexOf("}"))),
	"die Kachel stellt das Symbol UEBER die Beschriftung");
const band = (() => { const s = css.slice(css.indexOf(".share-pin-menu__actions {")); return s.slice(0, s.indexOf("}")); })();
const knopf = knopfRegel.slice(0, knopfRegel.indexOf("}"));
assert.ok(/grid-auto-flow:\s*column/.test(band) && /grid-auto-columns:\s*1fr/.test(band),
	"so viele gleich breite Spalten wie Kacheln -- die Zahl steht nirgends");
assert.ok(/width:\s*max-content/.test(band), "und das Band nimmt sich erst seine Wunschbreite");
// 💣 Die drei haengen zusammen: max-content gleicht die Spalten an, die Deckelung haelt eine lange
//    Beschriftung davon ab, die Reihe aufzuziehen (ungedeckelt waeren es 140 px je Kachel).
assert.ok(/max-width:\s*90px/.test(knopf), "die Kachel deckelt sich auf die 90 px des Hauses");
assert.ok(!/(?<!max-)width:\s*90px/.test(knopf),
	"aber sie sind eine OBERGRENZE, nicht die feste Breite der Infobox");
assert.ok(/white-space:\s*normal/.test(knopf), "damit lange Beschriftungen an der Grenze umbrechen");
assert.ok(/\.share-pin-menu \.leaflet-popup-content\s*\{[^}]*width:\s*auto\s*!important/.test(css),
	"die Kastenbreite kommt vom Inhalt, nicht von einer gerechneten Zahl");

// 💣 Der Trenner geht bis an die SICHTBARE Kante. Er war schon einmal exakt so breit wie sein
//    Kasten und ging trotzdem nicht durch: Leaflets Huelle hat `padding: 1px`, also blieb links und
//    rechts ein Haarstrich stehen. Beide Haelften der Loesung gehoeren zusammen.
assert.ok(/\.share-pin-menu \.leaflet-popup-content-wrapper\s*\{[^}]*padding:\s*0/.test(css),
	"die Leaflet-Huelle polstert nicht mehr -- sonst endet der Trenner 1 px vor der Kante");
assert.ok(/\.share-pin-menu__divider\s*\{[^}]*margin:[^;]*calc\(-1 \* var\(--share-pin-menu-pad\)\)/.test(css),
	"und der Trenner rechnet die Polsterung des Kastens negativ zurueck");

// 💣 Die Kopfzeile haelt den Platz von Leaflets Schliesskreuz frei. Bei 208 px fiel das nicht auf;
//    seit der Kasten sich am Titel misst, sass das ✕ sonst mitten auf „Stelle".
assert.ok(/\.share-pin-menu__header\s*\{[^}]*padding-right:\s*var\(--share-pin-menu-close\)/.test(css),
	"der Titel weicht dem Schliesskreuz aus");
assert.ok(!/\.share-pin-menu[^{,]*\.location-popup__actions/.test(css),
	"und faellt nicht in die vierspaltige Selektorliste der Infobox zurueck");

// ---- 💣 Kein Rest der alten Sonderfassungen ----------------------------------------------------
assert.ok(!/single-action/.test(js) && !/single-action/.test(css),
	"die Sonderfassung vom 13.08. ist restlos weg");
assert.ok(!/extraClassName/.test(js), "und der Parameter, den nur sie brauchte, ebenfalls");
assert.ok(!/location-popup__icon--share-pin/.test(js) && !/location-popup__icon--share-pin/.test(css),
	"der Symbol-Slot im Ortskopf ist mit dem Ortskopf gegangen");

// ---- 💣 Das Kreuz kommt aus EINER Stelle --------------------------------------------------------
assert.ok(/function popupMoveIconMarkup\(\)/.test(js), "es gibt genau einen Bauer fuer das Kreuz");
assert.ok(/iconMarkup: popupMoveIconMarkup\(\)/.test(routing), "auch der freie Kartenpunkt ruft ihn");
[["popups.js", js], ["routing.js", routing]].forEach(([name, quelle]) => {
	const eigene = (quelle.match(/action-icon--move[^]{0,80}<svg/g) || []).length;
	assert.strictEqual(eigene, name === "popups.js" ? 1 : 0, name + ": kein zweites handgeschriebenes SVG");
});

// ---- 💣 EIN wartender Zustand ------------------------------------------------------------------
assert.ok(/let pendingRelocation = null/.test(travel), "es gibt genau einen wartenden Zustand");
assert.ok(!/pendingMapPointRelocationWaypointId/.test(travel), "die alte Einzelfall-Variable ist weg");

// ---- 💣 Ziehen am Marker -- der EINZIGE Weg, die Markierung zu verschieben ----------------------
// Owner 15.08.2026: „kann ich nicht auch ziehen? drag n drop?" -- und danach: „verschieben kann
// wieder weg, drag n drop geht ja immer."
const zieh = (() => { const s = marker.slice(marker.indexOf("function bindSharePinDragging")); return s.slice(0, s.indexOf("\nfunction ")); })();
assert.ok(zieh.length > 0, "es gibt einen Bauer fuers Ziehen");
assert.ok(/draggable:\s*true/.test(marker), "der Marker ist ziehbar");
// 💣 setSharePin wirft den Marker weg und baut einen neuen -- im dragend waere das der Marker, an
//    dem Leaflet gerade noch aufraeumt (TypeError in finishDrag, am Kartenpunkt schon passiert).
assert.ok(!/setSharePin\(/.test(zieh), "das dragend ruft NICHT setSharePin");
assert.ok(/sharePinCoordinates = droppedAt/.test(zieh) && /syncPlannerStateToUrl\(\)/.test(zieh),
	"es schreibt nur, was nicht am Marker haengt: Koordinate und geteilter Link");
// 💣 Die Kartengrenze gilt fuers Ziehen wie fuers Setzen -- sonst laege die Markierung ausserhalb
//    der Karte und ihr Link liesse sich nicht mehr oeffnen.
assert.ok(/isWithinMapBounds\(droppedAt\)/.test(zieh), "ausserhalb der Karte wird abgelehnt");
assert.ok(/marker\.setLatLng\(sharePinCoordinates\)/.test(zieh), "und der Marker springt zurueck");
// 💣 Und es raeumt KEIN wartendes Verschieben ab. Bis zum 15.08.2026 stand hier ein
//    cancelMapPointRelocation() -- richtig, solange die Markierung selbst eine Verschieben-Kachel
//    hatte. Warten kann jetzt nur noch der KARTENPUNKT, und den geht das Ziehen der Markierung
//    nichts an: ihn abzuraeumen naehme dem Nutzer eine andere, laufende Handlung weg.
assert.ok(!/cancelMapPointRelocation\(\)/.test(zieh),
	"das Ziehen fasst den wartenden Zustand des Kartenpunkts nicht an");
// Beide Wege enden im selben Bild: das Menue geht wieder auf (wie completeMapPointRelocationAt).
assert.ok((zieh.match(/marker\.openPopup\(\)/g) || []).length >= 2,
	"nach dem Loslassen geht das Menue wieder auf -- auch im Zurueckspring-Fall");
// Und man muss dem Marker ANSEHEN, dass er ziehbar ist: Leaflet setzt den Greifzeiger nur waehrend
// des Ziehens, im Ruhezustand bliebe es beim pointer von .leaflet-interactive.
assert.ok(/\.share-pin-marker\.leaflet-marker-draggable\s*\{[^}]*cursor:\s*grab/.test(css),
	"der ruhende Marker zeigt den Greifzeiger");

// ---- Der freie Kartenpunkt traegt den Schuh, kein Dorf ------------------------------------------
// 💣 settlementRealisticIconMarkup faellt bei unbekanntem Typ auf das DORF zurueck -- die Box
//    behauptete damit eine Ortschaft an einer Stelle, an der nichts steht.
assert.ok(/loc\.isMapPoint\s*\r?\n?\s*\?\s*`<img class="location-popup__icon location-popup__icon--realistic" src="\$\{escapeHtml\(withAssetVersion\("icons\/schuh\.webp"\)\)\}"/.test(routing)
	|| /icons\/schuh\.webp/.test(routing), "der freie Kartenpunkt zeigt den Wanderschuh");
assert.ok(fs.existsSync(path.join(ROOT, "icons", "schuh.webp")), "und der Schuh liegt im Repo");

console.log("share-pin-popup: alle Zusicherungen gehalten");
