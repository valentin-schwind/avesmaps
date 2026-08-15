// Was von der gesetzten Markierung UNVERAENDERT bleibt, nachdem ihr schwebendes Zwei-Kachel-Menue
// (sharePinMenuMarkup) mit der „Was ist hier?"-Verschmelzung (Aufgabe 4, 15.08.2026) ersatzlos
// gefallen ist. Die Zusicherungen ÜBER sharePinMenuMarkup selbst -- seine Kacheln, seinen eigenen
// Kasten, seine CSS-Breite -- gingen mit ihm; sie stehen jetzt (negativ, "ist geloescht") in
// js/map-features/__tests__/was-ist-hier-verdrahtung.test.js. Was hier bleibt, ist Verhalten, das
// von der Existenz dieses Menues nie abhing:
//   1. Die Verschieben-Kachel der Markierung ist am 15.08.2026 vorher schon gefallen ("drag n drop
//      geht ja immer") -- unabhaengig von der Verschmelzung, und ihre Faelle bleiben geprueft.
//   2. Der freie KARTENPUNKT behaelt seine eigene Verschieben-Kachel (er hat keinen Marker zum
//      Anfassen); ihr Kreuz-Symbol wohnt weiterhin an genau einer Stelle (popupMoveIconMarkup).
//   3. Das Ziehen der Markierung selbst -- die Grenzpruefung, der Ruecksprung, dass dragend NICHT
//      setSharePin aufruft -- bleibt unveraendert; nur ruft es jetzt avesmapsShowWhatIsHere() statt
//      marker.openPopup() (Aufgabe 4: der Marker hat kein Popup mehr).
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
const routing = ohneKommentare(read("js", "routing", "routing.js"));
const travel = ohneKommentare(read("js", "routing", "route-travel-here.js"));
const marker = ohneKommentare(read("js", "map-features", "map-features-share-pin.js"));

// ---- 💣 Die Verschieben-Kachel der Markierung ist restlos weg (Owner 15.08.2026) ----------------
// ⚠️ In Anfuehrungszeichen geprueft: ein blosses /move-share-pin/ trifft auch das „remove-share-pin"
//    der Nachbarkachel und war damit immer wahr.
assert.ok(!/"move-share-pin"/.test(js) && !/"move-share-pin"/.test(routing) && !/"move-share-pin"/.test(marker),
	"die Verschieben-Kachel der Markierung ist restlos weg");
assert.ok(!/beginSharePinRelocation/.test(travel) && !/beginSharePinRelocation/.test(routing),
	"und ihr wartender Klick-Zustand mit ihr");
assert.ok(!/popup\.moveMarker/.test(js) && !/popup\.moveMarker/.test(ohneKommentare(read("js", "app", "i18n-en.js"))),
	"auch ihre i18n-Zeile");
assert.ok(/action === "move-map-point"/.test(routing) && /function beginMapPointRelocation\(waypointId\)/.test(travel),
	"der freie Kartenpunkt behaelt seine Kachel");
// 💣 Der Verteiler faellt mit: `pendingRelocation` traegt wieder genau ein Ziel. Ein `kind` mit
//    nur noch einem Wert waere eine Fallunterscheidung, die keinen Fall mehr unterscheidet.
assert.ok(!/kind === "share-pin"|kind: "(share-pin|map-point)"/.test(travel),
	"der wartende Zustand hat keine Fallunterscheidung mehr");

// ---- 💣 Die Reise-Kachel ruft den geteilten Weg, nicht einen zweiten ----------------------------
// „Hierher reisen" im Kartenmenue und „Reiseziel hinzufuegen" an der Markierung (jetzt im
// Aktionsband des Infopanels, map-features-what-is-here.js) sind dieselbe Handlung. travelToMapPoint
// traegt den Punkt als Wegpunkt ein und laesst den Planer rechnen; ein eigener Routenweg fuer die
// Markierung waere genau der zweite Weg, den diese Funktion abgeschafft hat.
assert.ok(/action === "travel-to-share-pin"/.test(routing), "der Klick-Handler kennt die Aktion");
const reiseZweig = routing.slice(routing.indexOf('action === "travel-to-share-pin"'));
const reiseRumpf = reiseZweig.slice(0, reiseZweig.indexOf("\n\t}"));
assert.ok(/travelToMapPoint\(sharePinCoordinates\)/.test(reiseRumpf),
	"sie reist zur MARKIERUNG -- contextMenuLatLng truege die Stelle des letzten Rechtsklicks");
assert.ok(fs.existsSync(path.join(ROOT, "img", "menu", "papierkorb.webp")), "der Papierkorb liegt im Repo");
assert.ok(!/\u{1F5D1}/u.test(js), "kein Papierkorb-Emoji in der Beschriftung");
assert.ok(!/\u{1F5D1}/u.test(read("js", "app", "i18n-en.js")), "auch nicht in der englischen Tabelle");

// ---- 💣 Kein Rest der alten Sonderfassungen ----------------------------------------------------
assert.ok(!/single-action/.test(js), "die Sonderfassung vom 13.08. ist restlos weg");
assert.ok(!/extraClassName/.test(js), "und der Parameter, den nur sie brauchte, ebenfalls");
assert.ok(!/location-popup__icon--share-pin/.test(js), "der Symbol-Slot im Ortskopf ist mit dem Ortskopf gegangen");

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
	"es schreibt, was nicht am Marker haengt: Koordinate und geteilter Link");
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
// 🔴 Aufgabe 4 (15.08.2026): der Marker hat kein Popup mehr -- kein `marker.openPopup()` darf hier
//    stehenbleiben (stiller No-op auf einem Marker ohne gebundenes Popup). Beide Faelle -- normaler
//    Ruecksprung wie Grenzverletzung -- rechnen die Auskunft stattdessen neu.
assert.ok(!/marker\.openPopup\(\)/.test(zieh), "kein openPopup mehr -- der Marker hat keins");
assert.ok((zieh.match(/avesmapsShowWhatIsHere\(marker\.getLatLng\(\)\)/g) || []).length >= 2,
	"nach dem Loslassen rechnet die Auskunft neu -- auch im Zurueckspring-Fall");
// 🔴 Owner-Befund 15.08.2026 (Befund D, live gemessen): der Marker hat ZWEI Gesten -- der Klick ist
// die primaere (oeffnet das Panel), Ziehen die zweitrangige. Bis dahin stand hier `cursor: grab` im
// Ruhezustand -- und war gegen den Kartenhintergrund UNSICHTBAR: der traegt beim Hovern ebenfalls
// `grab` (`.leaflet-grab` in css/third-party/leaflet.css, fuers Kartenverschieben), beide Werte
// gemessen identisch. Die Zusicherung haelt deshalb NICHT nur einen Wert gegen einen erwarteten
// String, sondern BEIDE Regeln gegeneinander -- ein Quelltest, der nur nach "pointer" sucht, wuerde
// nicht auffallen, wenn irgendwann auch der Kartenhintergrund auf "pointer" wechselt.
function letzterCursorWert(block) {
	const treffer = [...block.matchAll(/cursor:\s*([a-zA-Z-]+)\s*;/g)];
	return treffer.length ? treffer[treffer.length - 1][1] : null;
}
const css = ohneKommentare(read("css", "features", "location-popups-markers.css"));
const leafletCss = ohneKommentare(read("css", "third-party", "leaflet.css"));

const kartenGrabRegel = leafletCss.match(/\.leaflet-grab\s*\{([^}]*)\}/);
assert.ok(kartenGrabRegel, "die Leaflet-Bibliothek hat ihre eigene .leaflet-grab-Regel fuer den Kartenhintergrund");
const kartenZeiger = letzterCursorWert(kartenGrabRegel[1]);
assert.strictEqual(kartenZeiger, "grab", "der Kartenhintergrund zeigt grab beim Hovern (Referenzwert)");

const markerRegel = css.match(/\.share-pin-marker\.leaflet-marker-draggable\s*\{([^}]*)\}/);
assert.ok(markerRegel, "die Markierung hat ihre eigene Ruhezustand-Regel");
const markerZeiger = letzterCursorWert(markerRegel[1]);
assert.ok(markerZeiger, "die Regel setzt ueberhaupt einen cursor-Wert");
assert.notStrictEqual(markerZeiger, kartenZeiger,
	"🔴 die Markierung darf NICHT denselben Zeiger tragen wie der Kartenhintergrund -- sonst aendert sich beim Hovern nichts, und die primaere Geste (Klick) bleibt unangekuendigt");
assert.strictEqual(markerZeiger, "pointer",
	"und zwar dieselbe Ankuendigung, die jedes andere Anklickbare dieser Karte traegt (.leaflet-interactive)");

// Die Rueckmeldung WAEHREND des Ziehens (die zweitrangige Geste) bleibt unveraendert `grabbing`.
const ziehRegel = css.match(/\.leaflet-dragging \.share-pin-marker\.leaflet-marker-draggable\s*\{([^}]*)\}/);
assert.ok(ziehRegel, "die Ziehen-Rueckmeldung hat weiterhin ihre eigene Regel");
assert.strictEqual(letzterCursorWert(ziehRegel[1]), "grabbing", "und zeigt waehrend des Ziehens weiterhin grabbing");

// ---- Der freie Kartenpunkt traegt den Schuh, kein Dorf ------------------------------------------
// 💣 settlementRealisticIconMarkup faellt bei unbekanntem Typ auf das DORF zurueck -- die Box
//    behauptete damit eine Ortschaft an einer Stelle, an der nichts steht.
assert.ok(/loc\.isMapPoint\s*\r?\n?\s*\?\s*`<img class="location-popup__icon location-popup__icon--realistic" src="\$\{escapeHtml\(withAssetVersion\("icons\/schuh\.webp"\)\)\}"/.test(routing)
	|| /icons\/schuh\.webp/.test(routing), "der freie Kartenpunkt zeigt den Wanderschuh");
assert.ok(fs.existsSync(path.join(ROOT, "icons", "schuh.webp")), "und der Schuh liegt im Repo");

console.log("share-pin-popup: alle Zusicherungen gehalten");
