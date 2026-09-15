// Die Klickfolge auf der KARTE (Entwurf 2026-09-14 §3): der erste Klick markiert die ganze Strasse, der zweite
// den Abschnitt. Die Regel steht rein in weg-auswahl.js; hier nur Zustand, Linienfarbe, Aufheben und der Klick auf
// den NAMEN eines Wiki-Wegs (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.4).
// 🔴 NUR IM BEARBEITEN-MODUS. Besucher klicken wie bisher (E4 gilt dem Bearbeiten).
// ⚠️ Normales Skript, NICHT in <template data-nur-editor>: der Klick-Zuhoerer in
// map-features-path-rendering.js nennt diese Namen, und der laedt fuer jeden (nur-editor-skripte.test.js).

// Der Strich fremder Traeger: angezeigt, nicht mitbearbeitet (§3.3). Kein Farbwert, daher kein Token.
const AVESMAPS_WEG_AUSWAHL_STRICH = "8 8";

let avesmapsWegAuswahlStand = null;           // {gruppe, publicId|null} oder null
let avesmapsWegAuswahlMarkiert = new Set();   // public_ids mit gelber Linie
let avesmapsWegAuswahlTraeger = new Set();    // fremde Abschnitte mit dem Artikel als weiterer Zuweisung
let avesmapsWegAuswahlVerdrahtet = false;

// 🔴 DAS GELB DER SUCHE (Owner 15.09.2026 abends: „dasselbe gelb wie bei der spotlight suche"; ersetzt das Gold markierter
// Orte aus Nachtrag §9.1): gelesen aus SPOTLIGHT_PATH_HIGHLIGHT_STYLE (js/ui/spotlight-search.js, normales Skript, erst
// zur Klickzeit gelesen) -- so ist es dasselbe Gelb und kein zweiter Farbwert. „Anzeigen" unterscheidet sich weiter durch
// Breite 12 und Leuchtschatten.
function avesmapsWegAuswahlFarbe() {
	return typeof SPOTLIGHT_PATH_HIGHLIGHT_STYLE === "object" && SPOTLIGHT_PATH_HIGHLIGHT_STYLE
		? (SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color || null) : null;
}

/**
 * Kontur und Mittellinie nach dem Zustand faerben. Gerufen am ENDE von updatePathLayerStyle -- damit ueberlebt die
 * Markierung jedes Neufaerben, ohne dass ein Neufaerber sie kennen muss; und weil updatePathLayerStyle Kontur und Mitte
 * vorher auf ihre eigenen Farben setzt, kommt beim Aufheben beides von selbst zurueck.
 * 🔴 Die KONTUR wird mit gelb (Owner 15.09.2026: „bei den wegen wo die kontur anders ist als der pfad auch gelb") --
 * sonst liest sich eine breite Strasse mit weisser Kontur nicht als markiert.
 * 💣 Ein fremder Traeger behaelt die EIGENE Farbe seiner Mitte und bekommt nur den Strich: Gelb auf gelber Kontur
 * gestrichelt saehe durchgezogen aus. In den Luecken scheint die gelbe Kontur durch. Ist die Kontur unsichtbar
 * (Deckkraft 0: Zoom <= 2, Fluss im Landschaftsmodus), traegt die Mitte den gelben Strich wie bisher.
 * 💣 updatePathLayerStyle setzt `dashArray` nie zurueck: der Strich eines ehemaligen Traegers wird HIER entfernt.
 * 💣 ERST DIE MITGLIEDSCHAFT, DANN DIE FARBE: syncPathRendering ruft das bei jedem Zoomschritt fuer alle rund 6.000
 * Wege. Ohne Markierung wird die Farbe gar nicht gelesen.
 */
function avesmapsWegAuswahlStilNachziehen(path) {
	const mitte = path && Array.isArray(path._pathLines) ? path._pathLines[1] : null;
	if (!mitte || typeof mitte.setStyle !== "function") { return; }
	const rand = path._pathLines[0] && typeof path._pathLines[0].setStyle === "function" ? path._pathLines[0] : null;
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	const markiert = avesmapsWegAuswahlMarkiert.has(id);
	const traeger = !markiert && avesmapsWegAuswahlTraeger.has(id);
	const farbe = markiert || traeger ? avesmapsWegAuswahlFarbe() : null;
	const randSichtbar = Boolean(rand) && Number(rand.options && rand.options.opacity !== undefined ? rand.options.opacity : 1) > 0;
	if (farbe && rand) { rand.setStyle({ color: farbe }); }
	if (farbe && markiert) {
		mitte.setStyle({ color: farbe, dashArray: null });
	} else if (farbe && traeger && randSichtbar) {
		mitte.setStyle({ dashArray: AVESMAPS_WEG_AUSWAHL_STRICH });
	} else if (farbe && traeger) {
		mitte.setStyle({ color: farbe, dashArray: AVESMAPS_WEG_AUSWAHL_STRICH });
	} else if (mitte.options && mitte.options.dashArray) {
		mitte.setStyle({ dashArray: null });
	}
}

function avesmapsWegAuswahlNeuZeichnen(ids) {
	ids.forEach((id) => {
		const pfad = typeof findPathByPublicId === "function" ? findPathByPublicId(id) : null;
		if (!pfad) { return; }
		if (typeof updatePathLayerStyle === "function") { updatePathLayerStyle(pfad); }
		// Markierungszeile und Editorband stehen im zwischengespeicherten Markup (path._popupMarkup).
		if (typeof refreshPathLayerPopup === "function") { refreshPathLayerPopup(pfad); }
	});
}

function avesmapsWegAuswahlSetzen(stand, abschnitt) {
	const vorher = new Set([...avesmapsWegAuswahlMarkiert, ...avesmapsWegAuswahlTraeger]);
	avesmapsWegAuswahlStand = stand;
	avesmapsWegAuswahlMarkiert = new Set();
	avesmapsWegAuswahlTraeger = new Set();
	if (stand && abschnitt) {
		const gruppenIds = abschnitt.gruppe.segments.map((way) => way.public_id);
		avesmapsWegAuswahlMarkiert = new Set(avesmapsWegAuswahlIds(stand, gruppenIds));
		// Fremde Traeger nur bei der GANZEN Strasse -- und zwar aller Artikel, die IN ihr stehen. 🔴 Seit die Strasse der Name
		// ist (Owner 15.09.2026), sagt der Gruppenschluessel nichts mehr ueber einen Artikel, und der angeklickte Abschnitt kann
		// selbst keinen tragen, waehrend seine Nachbarn ihn tragen.
		// ⚠️ Ohne typeof-Wache: das Modell laedt fuer jeden (wie wpGroupWays in weg-abschnitte.js). Eine Wache liesse die
		// gestrichelten Traeger bei fehlendem Modell STILL wegfallen -- genau so ist es beim Bau im Test aufgefallen.
		const keys = stand.publicId === null ? wpGruppeHauptzuweisungen(abschnitt.gruppe.segments).filter(Boolean) : [];
		if (keys.length && typeof avesmapsWegTraegerIndex === "function") {
			const index = avesmapsWegTraegerIndex();
			keys.forEach((key) => {
				(index.get(key) || []).forEach((traeger) => {
					const id = getPathPublicId(traeger);
					if (!avesmapsWegAuswahlMarkiert.has(id)) { avesmapsWegAuswahlTraeger.add(id); }
				});
			});
		}
	}
	avesmapsWegAuswahlNeuZeichnen(new Set([...vorher, ...avesmapsWegAuswahlMarkiert, ...avesmapsWegAuswahlTraeger]));
}

function avesmapsWegAuswahlKlick(path) {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) { return null; }
	const abschnitt = typeof avesmapsWegAbschnittAufKarte === "function" ? avesmapsWegAbschnittAufKarte(path) : null;
	if (!abschnitt) { return null; }
	const stand = avesmapsWegAuswahlNachKlick(avesmapsWegAuswahlStand, abschnitt.gruppe.key, abschnitt.way.public_id);
	avesmapsWegAuswahlSetzen(stand, stand ? abschnitt : null);
	return stand;
}

function avesmapsWegAuswahlAufheben() {
	if (!avesmapsWegAuswahlStand) { return; }
	avesmapsWegAuswahlSetzen(null, null);
	if (typeof window !== "undefined" && typeof window.avesmapsRefreshInfopanel === "function") {
		window.avesmapsRefreshInfopanel();
	}
}

/**
 * Laeuft gerade etwas, das einen Karten-Klick fuer sich braucht (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.4)?
 * 🔴 KEINE ZWEITE KLASSENLISTE: die Werkzeuge stehen in TOOL_CLASSES (js/app/keyboard-shortcuts.js, `toolActive`),
 * dazu die drei Zustaende, die keine Klasse an den Kartencontainer haengen.
 * ⚠️ Fehlt das Tastatur-Modul, faellt der Riegel GESCHLOSSEN aus: ein stummer Name ist der alte Zustand, ein
 * Namensklick mitten in einem Werkzeug waere ein neuer Fehler.
 * `menueBeimDruecken`: der Klickweg reicht den Merker aus avesmapsWegKartenVorKlick herein. Der Zeigerweg (Overlay,
 * mousemove) fragt ohne ihn und liest das Menue, wie es JETZT steht.
 */
function avesmapsWegWerkzeugLaeuft(menueBeimDruecken) {
	const tastatur = typeof window !== "undefined" ? window.avesmapsKeyboardShortcuts : null;
	if (!tastatur || typeof tastatur.toolActive !== "function") { return true; }
	if (tastatur.toolActive()) { return true; }
	if (typeof window !== "undefined" && window.__pathAssignPending) { return true; }
	if (typeof activePathGeometryEdit !== "undefined" && activePathGeometryEdit) { return true; }
	return menueBeimDruecken === true || avesmapsWegKontextmenueOffen();
}

function avesmapsWegKontextmenueOffen() {
	const menue = typeof document !== "undefined" && typeof document.getElementById === "function"
		? document.getElementById("map-context-menu")
		: null;
	return Boolean(menue && menue.hidden === false);
}

// 💣 WAR DAS KONTEXTMENUE BEIM DRUECKEN OFFEN? Nur so wirkt der Menue-Riegel im echten Klick: bootstrap.js:1160 meldet
// `closeMapContextMenu` als Karten-Klick-Zuhoerer an, lange BEVOR routing.js:611 (nach dem Datenladen) die Wege-Auswahl
// verdrahtet -- zur Klickzeit ist das Menue schon zu. Leaflet feuert `preclick` vor ALLEN click-Zuhoerern
// (_fireDOMEvent), gleich in welcher Reihenfolge sie angemeldet sind. Der Merker gilt EINEM Klick:
// avesmapsWegKartenKlick setzt ihn zurueck.
let avesmapsWegMenueBeimDruecken = false;

function avesmapsWegKartenVorKlick() {
	avesmapsWegMenueBeimDruecken = avesmapsWegKontextmenueOffen();
}

/** Welcher Abschnitt wird mit diesem Karten-Klick ueber seinen NAMEN angeklickt? Sonst null. */
function avesmapsWegNamenKlickZiel(event) {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE || !event || !event.containerPoint || !event.latlng) { return null; }
	if (typeof window === "undefined" || typeof window.avesmapsWegNamenTreffer !== "function") { return null; }
	if (avesmapsWegWerkzeugLaeuft(avesmapsWegMenueBeimDruecken)) { return null; }
	const treffer = window.avesmapsWegNamenTreffer(event.containerPoint);
	const wikiKey = treffer && treffer.wikiKey ? String(treffer.wikiKey) : "";
	if (!wikiKey || typeof avesmapsWegAbschnittAufKarte !== "function" || typeof findPathByPublicId !== "function"
		|| typeof pathData === "undefined" || !Array.isArray(pathData)) { return null; }
	// 🔴 Die Strasse ist der NAME (Owner 15.09.2026), kein `wiki:<key>`-Schluessel mehr. Das Register kennt nur den Artikel des
	// gezeichneten Namens -- also ein Abschnitt, der ihn traegt, und DESSEN Gruppe (wpGroupKeyOf). Gleichnamige Abschnitte ohne
	// Zuweisung gehoeren damit zu den Kandidaten; der naechste zum Klickpunkt bekommt den Linien-Klick.
	const traeger = pathData.find((pfad) => String(pfad?.properties?.wiki_path?.wiki_key || "") === wikiKey);
	const gruppe = traeger ? ((avesmapsWegAbschnittAufKarte(traeger) || {}).gruppe || null) : null;
	if (!gruppe) { return null; }
	const abschnitte = gruppe.segments.map((way) => {
		const pfad = findPathByPublicId(way.public_id);
		return { public_id: way.public_id, koordinaten: pfad && pfad.geometry ? pfad.geometry.coordinates : [] };
	});
	// ⚠️ GeoJSON-Ordnung: Leaflets latlng ist [y, x].
	const id = avesmapsWegNaechsterAbschnitt(abschnitte, [event.latlng.lng, event.latlng.lat]);
	return id ? findPathByPublicId(id) : null;
}

/**
 * 💣 DER EINE KARTEN-KLICK-ZUHOERER DER WEGE-AUSWAHL (Nachtrag §9.4). Ein Namenstreffer loest den Linien-Klick aus, sonst
 * hebt der Klick die Markierung auf. Zwei getrennte Zuhoerer hingen an ihrer Registrierungsreihenfolge: die Markierung
 * verschwaende im selben Klick wieder, oder der zweite Klick fiele immer auf „ganze Strasse" zurueck.
 * ⭐ Kein zweiter Code-Pfad: `fire("click")` an der Mittellinie faehrt denselben Zuhoerer wie ein Klick auf die Linie
 * (createPathLayer) -- Wiki-Ziel-Pick, Schiedsrichter, Auswahl, Infopanel.
 */
function avesmapsWegKartenKlick(event) {
	const pfad = avesmapsWegNamenKlickZiel(event);
	avesmapsWegMenueBeimDruecken = false;   // der Merker gilt diesem Klick, keinem spaeteren ohne preclick
	const mitte = pfad && Array.isArray(pfad._pathLines) ? pfad._pathLines[1] : null;
	if (mitte && typeof mitte.fire === "function") {
		mitte.fire("click", {
			latlng: event.latlng,
			layerPoint: event.layerPoint,
			containerPoint: event.containerPoint,
			originalEvent: event.originalEvent,
		});
		return;
	}
	avesmapsWegAuswahlAufheben();
}

/** Die Auswahl, wenn DIESER Pfad markiert ist (als Abschnitt oder als Teil der ganzen Strasse); sonst null. */
function avesmapsWegAuswahlFuerPfad(path) {
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	return avesmapsWegAuswahlStand && avesmapsWegAuswahlMarkiert.has(id) ? { ...avesmapsWegAuswahlStand } : null;
}

/** Die Pfade der ganzen Strasse dieses Pfads, in der Nummernfolge des Wege-Editors. */
function avesmapsWegAuswahlGruppenPfade(path) {
	const ways = typeof avesmapsWegGruppeAufKarte === "function" ? avesmapsWegGruppeAufKarte(path) : [];
	return ways
		.map((way) => (typeof findPathByPublicId === "function" ? findPathByPublicId(way.public_id) : null))
		.filter(Boolean);
}

function avesmapsWegAuswahlVerdrahten() {
	if (avesmapsWegAuswahlVerdrahtet || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) { return; }
	if (typeof map === "undefined" || !map || typeof map.on !== "function") { return; }
	avesmapsWegAuswahlVerdrahtet = true;
	// Ein Klick daneben hebt die Markierung auf (§3.1), ein Klick auf den NAMEN eines Wiki-Wegs markiert (Nachtrag §9.4) --
	// beides in EINEM Zuhoerer. Ein Klick AUF eine Linie erreicht die Karte nicht: beide Linien tragen
	// `bubblingMouseEvents: false` (createPathLayer).
	// 💣 VOR dem Klick der Merker, ob das Kontextmenue beim Druecken offen war (avesmapsWegKartenVorKlick): Leaflet feuert
	// `preclick` vor jedem click-Zuhoerer, auch vor dem frueher angemeldeten closeMapContextMenu (bootstrap.js).
	map.on("preclick", avesmapsWegKartenVorKlick);
	map.on("click", avesmapsWegKartenKlick);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWegAuswahlKlick, avesmapsWegAuswahlAufheben, avesmapsWegAuswahlFuerPfad,
		avesmapsWegAuswahlGruppenPfade, avesmapsWegAuswahlStilNachziehen, avesmapsWegAuswahlVerdrahten,
		avesmapsWegWerkzeugLaeuft, avesmapsWegNamenKlickZiel, avesmapsWegKartenKlick, avesmapsWegKartenVorKlick,
	};
}
