/*
 * Die Ansichts-Kachel in der Kartenecke -- seit 12.08.2026 fuer JEDEN Besucher, nicht mehr hinter
 * einem Pruef-Schalter. Entwurf: docs/superpowers/specs/2026-08-11-ansichts-kacheln-design.md
 *
 * Die Kachel IST das Menue: zugeklappt zeigt sie die eingestellte Ansicht, aufgeklappt faltet sie
 * sich zu allen sechs auf -- am Zeiger als Reihe, am Telefon als 2x3 (das entscheidet CSS).
 */
(function initMapLayerPicker() {
	"use strict";

	// 🪤 NICHT MEHR IN GEBRAUCH seit dem 26.08.2026: die Ansichten sind Vektoren ueber dem
	// gewaehlten Untergrund (OVERLAYS weiter unten). Die Bilder in icons/layer-tiles/ bleiben
	// liegen -- der Deploy loescht nie (AGENTS.md §10), und tools/layer-tiles/capture.js erzeugt
	// sie weiterhin. Wer sie wieder anschliesst, holt sich das Problem zurueck, das die Vektoren
	// loesen: eine Aufnahme traegt ihren Untergrund eingebrannt mit.
	var WURZEL = "icons/layer-tiles/";

	/**
	 * 💣 GEKOPPELT AN css/components/map-layer-picker.css. Das Raster wird erst versteckt, wenn
	 * sein Zuklappen zu Ende ist -- dort stehen 110 ms fuer das Einrollen und 110 ms fuer die
	 * Zellen. Ist diese Zahl kleiner, verschwindet der Kasten mitten in der Bewegung; ist sie
	 * viel groesser, steht ein fertig eingerollter Kasten noch herum und der Bund bleibt so
	 * lange zu hoch. Ein Test haelt beide Seiten zusammen (js/ui/__tests__/map-layer-picker.test.js).
	 * ⚠️ Aufklappen dauert laenger (150 ms) und braucht hier nichts: das Raster ist da, bevor es
	 * sich zeigt.
	 */
	var BLENDE_ZU_MS = 130;

	/**
	 * 🔴 DIE SCHWEBE-ZEITEN GELTEN BEIDEN STUFEN (26.08.2026, Owner: „kannst du das mouseover von
	 * beiden menues gleichmachen?").
	 *
	 * 💣 Das Aufklappen wartet, und das ist kein Komfort, sondern der Sinn: wer ueber die Reihe
	 * faehrt, um zu einer anderen Ansicht zu kommen, reisst sonst jedes Untermenue auf dem Weg auf.
	 * Die zweite Stufe oeffnete bis hierher SOFORT -- damit flackerte sie beim Durchfahren.
	 * ⚠️ Die Zahlen standen vorher dreimal einzeln im Code (140 im Hauptmenue, 260 im Hauptmenue,
	 * 260 in der zweiten Stufe). Zwei Menues mit denselben Zahlen an drei Stellen sind zwei Menues,
	 * die beim naechsten Nachjustieren auseinanderlaufen.
	 * ⭐ Eine offene Stufe WANDERT dagegen ohne Verzoegerung zur naechsten Ansicht: die Absicht ist
	 * dann schon erklaert, und ein zweites Warten liesse die Reihe hinter der Maus herhinken.
	 */
	var SCHWEBE_AUF_MS = 140;
	var SCHWEBE_ZU_MS = 260;

	/**
	 * 🔴 `?layerPanelActive=0` ist der NOTAUSGANG, nicht mehr der Einschalter. Die Kachel laeuft
	 * seit dem 12.08.2026 von sich aus (Owner: „geh live mit dem jetzigen"), und mit ihr
	 * verschwindet die Zeile „Derographie" aus dem Routenplaner. Geht damit etwas schief, holt
	 * dieser eine Parameter die Auswahlbox zurueck, ohne dass jemand deployen muss.
	 * ⚠️ Ein AUSschalter, kein Notaus fuer alle: er wirkt nur in der Adresse, die ihn traegt.
	 * Ein globales Abschalten waere die Sorte stiller Ausfall, die niemandem auffaellt.
	 */
	function abgeschaltet() {
		try {
			var wert = new URLSearchParams(window.location.search).get("layerPanelActive");
			if (wert === null) {
				return false; // ohne Parameter: an
			}
			if (typeof parseBooleanQueryParam === "function") {
				return !parseBooleanQueryParam(wert, true);
			}
			return wert === "0" || wert === "false";
		} catch (e) {
			return false;
		}
	}

	/**
	 * Der Ausschnitt, den die Untergrund-Kacheln zeigen: z3 / map_17_-17 -- der Sternknoten Gareth
	 * mit Strassen, Fluss und Seen, also die Stelle, an der sich die drei Saetze am deutlichsten
	 * unterscheiden (Old traegt dort seine aufgedruckten Namen).
	 *
	 * 🔴 Die Vorschau ist die ECHTE Kachel, kein eigenes Symbol. Damit gibt es nichts, was veralten
	 * kann: aendert sich ein Kachelsatz, aendert sich die Vorschau mit. Eigene Symbolbilder waeren
	 * die Falle, vor der tools/layer-tiles/capture.js selbst warnt ("die Icons sind STATISCHE Bilder.
	 * Aendert sich der Kartenstil, zeigen sie weiter die alte Karte, und niemand bemerkt es").
	 * 💣 Der ORDNER steht NICHT hier, sondern kommt aus MAP_TILE_STYLES[...].url -- dort ist er
	 * ohnehin die Wahrheit. Ein zweites "tiles/old" an dieser Stelle liefe beim naechsten Umzug
	 * auseinander, und zwar lautlos: ein fehlendes Vorschaubild sieht aus wie eine leere Kachel.
	 */
	var GRUND_VORSCHAU = { z: 3, x: 17, y: -17 };

	function grundBildUrl(wert) {
		var stil = typeof MAP_TILE_STYLES !== "undefined" ? MAP_TILE_STYLES[wert] : null;
		if (!stil || !stil.url) {
			return "";
		}
		return String(stil.url)
			.replace("{z}", String(GRUND_VORSCHAU.z))
			.replace("{x}", String(GRUND_VORSCHAU.x))
			.replace("{y}", String(GRUND_VORSCHAU.y));
	}

	/**
	 * DIE ANSICHTEN SIND VEKTOREN, KEINE AUFNAHMEN (26.08.2026, Entwurf:
	 * docs/superpowers/specs/2026-08-26-ansicht-untergrund-kreuzen-design.md).
	 *
	 * 🔴 Eine Aufnahme traegt ihren Untergrund EINGEBRANNT mit -- also braeuchte jede Kreuzung ein
	 * eigenes Bild (5x3, spaeter 5x4 ...). Ein Vektor ist untergrundfrei und liegt ueber JEDER
	 * Kachel: 3 Kacheln + 5 Vektoren decken alle 15 Kombinationen ab. Ein vierter Untergrund kostet
	 * ein Bild, eine sechste Ansicht einen Vektor.
	 * ⭐ Und damit entfaellt die Bedingung, dass alle Ansichten denselben Kartenausschnitt zeigen
	 * muessten -- ein Vektor hat keinen Ort. tools/layer-tiles/capture.js nimmt jede Ansicht an
	 * einem eigenen Ort auf (Owner 11.08.2026); das bleibt unberuehrt, wird hier aber nicht
	 * gebraucht.
	 *
	 * 💣 Die Farben sind die ECHTEN, nicht erfundene -- jede stammt aus der Stelle, die sie auf der
	 * Karte zeichnet. Wer sie „aufraeumt", macht die Kachel zu einem Symbol, das etwas anderes
	 * ankuendigt als die Karte zeigt.
	 * ⚠️ Die Strassen sind aus der Vorlagekachel NACHGEZEICHNET (z3 / map_17_-17, Sternknoten
	 * Gareth), Koordinaten aus dem 256er-Bild geteilt durch 5,33. Weil alle drei Untergruende
	 * denselben Ausschnitt zeigen, DECKT sich der Vektor mit den gemalten Strassen jedes
	 * Kachelsatzes. Diese Zahlen gehoeren zur VORLAGEKACHEL, nicht zur Ansicht: wechselt der
	 * Ausschnitt (GRUND_VORSCHAU oben), wandern sie mit.
	 */
	const OVERLAYS = {
		// Ein VERZWEIGTES Netz statt zweier Linien (Owner 26.08.2026): eine Reichsstrasse quer durch,
		// zwei Abzweige, ein Feldweg -- und die Orte sitzen an den Kreuzungen, wie auf der Karte.
		// Jede Strasse liegt doppelt: dunkler Unterzug, heller Kern. Genau so zeichnet sie die Karte
		// (roadsOutline-Pane unter roads-Pane).
		// 🔴 DIE STRASSEN SIND NACHGEZEICHNET, nicht erfunden (Owner 26.08.2026: "zeichne doch einfach
		// die strassen aus der grafik nach"). Vorlage ist die Kachel, die alle drei Untergruende zeigen
		// (z3 / map_17_-17, der Sternknoten Gareth) -- deshalb DECKT sich der Vektor mit dem, was im
		// Bild darunter ohnehin zu sehen ist, statt daneben zu liegen.
		// ⚠️ Koordinaten aus dem 256er-Bild geteilt durch 5,33. Wechselt die Vorlagekachel, wandern
		// diese Zahlen mit -- sie gehoeren zu IHR, nicht zur Ansicht.
		// 💣 Jede Strasse liegt doppelt: dunkler Unterzug, heller Kern. Genau so zeichnet die Karte sie
		// (roadsOutline-Pane unter roads-Pane); ohne den Unterzug verschwinden helle Strassen auf
		// hellem Grund.
		// 🔴 ALLE STRASSEN SIND KURVEN, und jede MUENDET in einem Ort (Owner 26.08.2026). Deshalb
		// haben die drei langen Strassen ZWEI Kurvenstuecke: das erste endet auf dem Ortspunkt, das
		// zweite laeuft von dort weiter aus dem Bild. Eine durchgehende Kurve ginge am Ort vorbei --
		// sie traefe ihn nur zufaellig, und beim naechsten Nachjustieren nicht mehr.
		// ⚠️ Die Endpunkte liegen ABSICHTLICH ausserhalb (-2, 50): eine Strasse, die am Kachelrand
		// aufhoert, sieht aus wie eine Sackgasse.
		deregraphic:
			'<g fill="none" stroke="#2b2119" stroke-opacity=".45" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M-2 17 C3 16.3 7.5 15.6 11.5 14.5" stroke-width="4.5"/>' +
			'<path d="M11.5 14.5 C9.6 9.9 7 5.2 4.5 0.5" stroke-width="4"/>' +
			'<path d="M11.5 14.5 C12.8 9.4 14 4.4 14.6 -2" stroke-width="3.6"/>' +
			'<path d="M11.5 14.5 C15.2 10.8 19.4 6.2 24 2" stroke-width="3.6"/>' +
			'<path d="M11.5 14.5 C18 16.4 24.4 17.7 30 18 C37 18.4 43 19 50 19.6" stroke-width="5"/>' +
			'<path d="M11.5 14.5 C17.6 20.4 28.4 29.8 40 39 C43 41.4 46 43.8 49.5 46.5" stroke-width="4.5"/>' +
			'<path d="M11.5 14.5 C10.4 21 8.6 27.4 7 34 C6.2 39.4 5.6 44.6 5 50" stroke-width="4"/>' +
			'<path d="M28 30 C27.4 36 26.6 43 26 50" stroke-width="3"/></g>' +
			'<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M-2 17 C3 16.3 7.5 15.6 11.5 14.5" stroke="#efe3cb" stroke-width="2.4"/>' +
			'<path d="M11.5 14.5 C9.6 9.9 7 5.2 4.5 0.5" stroke="#e4d6ba" stroke-width="2"/>' +
			'<path d="M11.5 14.5 C12.8 9.4 14 4.4 14.6 -2" stroke="#e4d6ba" stroke-width="1.8"/>' +
			'<path d="M11.5 14.5 C15.2 10.8 19.4 6.2 24 2" stroke="#d8c8a8" stroke-width="1.8"/>' +
			'<path d="M11.5 14.5 C18 16.4 24.4 17.7 30 18 C37 18.4 43 19 50 19.6" stroke="#fdf8ee" stroke-width="2.8"/>' +
			'<path d="M11.5 14.5 C17.6 20.4 28.4 29.8 40 39 C43 41.4 46 43.8 49.5 46.5" stroke="#efe3cb" stroke-width="2.4"/>' +
			'<path d="M11.5 14.5 C10.4 21 8.6 27.4 7 34 C6.2 39.4 5.6 44.6 5 50" stroke="#e4d6ba" stroke-width="2"/>' +
			'<path d="M28 30 C27.4 36 26.6 43 26 50" stroke="#cbbb9e" stroke-width="1.3" stroke-dasharray="2 2"/></g>' +
			'<g fill="#cc2f2a" stroke="#fff">' +
			'<circle cx="11.5" cy="14.5" r="3.6" stroke-width="1.5"/>' +
			'<circle cx="7" cy="34" r="2.1" stroke-width="1.2"/>' +
			'<circle cx="24" cy="2" r="1.9" stroke-width="1.1"/>' +
			'<circle cx="30" cy="18" r="1.7" stroke-width="1"/>' +
			'<circle cx="40" cy="39" r="1.7" stroke-width="1"/>' +
			'<circle cx="4.5" cy="0.5" r="1.5" stroke-width="1"/></g>',

		// Deckender als zuvor (Owner: "etwas mehr deckend") und mit drei Gebieten statt zweier, damit
		// eine Innengrenze sichtbar wird -- die zeichnet der Layer duenner und gestrichelt.
		political:
			'<path d="M0 0 H25 C23 13 29 19 25 29 L19 48 H0 Z" fill="#a4543f" fill-opacity=".8"/>' +
			'<path d="M25 0 H48 V19 C39 17 33 23 25 29 29 19 23 13 25 0 Z" fill="#5b7a8c" fill-opacity=".8"/>' +
			'<path d="M25 29 C33 23 39 17 48 19 V48 H19 Z" fill="#8a7f4e" fill-opacity=".8"/>' +
			'<g fill="none" stroke="#d3d3d3">' +
			'<path d="M19 48 L25 29 C33 23 39 17 48 19" stroke-width="2.4"/>' +
			'<path d="M25 0 C23 13 29 19 25 29" stroke-width="2.4"/>' +
			'<path d="M25 29 L19 48" stroke-width="1.2" stroke-dasharray="3 2.5" stroke-opacity=".85"/></g>',

		// 🔴 ZWEI KNOTEN, und die Straenge WANDERN AUS DEM BILD (Owner 26.08.2026). Ein Netz, das
		// vollstaendig in 48px passt, sieht aus wie ein Diagramm; Kraftlinien laufen weiter, als man
		// sieht -- deshalb enden alle Linien ausserhalb des viewBox-Randes.
		// 💣 DER GLOW IST EIN DREIFACHER STRANG, kein Schatten -- css/features/powerlines.css:
		//   .powerline--aura  rgba(255, 70, 90, .42)   breit, aussen
		//   .powerline--mid   rgba(255, 105, 130, .82) mittig
		//   .powerline--core  rgba(255, 235, 240, 1)   fast weisser Kern
		// Genau diese drei Lagen, in dieser Reihenfolge. Mit EINER Linie in #ff5f82 (der Zeichenfarbe
		// aus dem JS) fehlt dem Ganzen das Leuchten, das die Ansicht ausmacht.
		// ⚠️ Der Untergrund ist dabei entsaettigt (GRUND_FILTER) -- graue Karte, leuchtende Straenge:
		// das IST das Bild der Kraftlinien-Ansicht.
		powerlines:
			'<g fill="none" stroke-linecap="round">' +
			'<g stroke="rgba(255,70,90,.42)" stroke-width="6">' +
			'<path d="M-4 6 L15 17 L34 31 L54 40"/><path d="M15 17 L21 -4"/><path d="M15 17 L-4 27"/>' +
			'<path d="M34 31 L54 20"/><path d="M34 31 L28 52"/></g>' +
			'<g stroke="rgba(255,105,130,.82)" stroke-width="2.8">' +
			'<path d="M-4 6 L15 17 L34 31 L54 40"/><path d="M15 17 L21 -4"/><path d="M15 17 L-4 27"/>' +
			'<path d="M34 31 L54 20"/><path d="M34 31 L28 52"/></g>' +
			'<g stroke="rgba(255,235,240,1)" stroke-width="1">' +
			'<path d="M-4 6 L15 17 L34 31 L54 40"/><path d="M15 17 L21 -4"/><path d="M15 17 L-4 27"/>' +
			'<path d="M34 31 L54 20"/><path d="M34 31 L28 52"/></g></g>' +
			'<g fill="rgba(255,70,90,.38)"><circle cx="15" cy="17" r="6.5"/><circle cx="34" cy="31" r="5.5"/></g>' +
			'<g fill="rgba(255,105,130,.9)"><circle cx="15" cy="17" r="3.6"/><circle cx="34" cy="31" r="3"/></g>' +
			'<g fill="rgba(255,235,240,1)"><circle cx="15" cy="17" r="1.7"/><circle cx="34" cy="31" r="1.4"/></g>',

		// 🔴 „ALLE" IST DIE UEBERLAGERUNG DER DREI EBENEN-ICONS (Owner 14.09.2026, am gerenderten Bild
		// abgenommen: „du musst dir fuer die icons merken"). Der Wert ist GENAU, in dieser Reihenfolge:
		//   1. die Flaechengruppe aus eco_derographisch (die Gruppe mit fill #575757),
		//   2. eco_vegetation,
		//   3. eco_topographie,
		//   4. die gestrichelte Grenzgruppe aus eco_derographisch.
		// Die Grenzen liegen OBEN -- darunter verschwaenden sie unter Wald und Gebirge. Die Klimazonen
		// gehoeren nicht hinein, und „Alle" traegt nichts Eigenes: kein eigenes Wasser, keinen eigenen Huegel.
		// 💣 Die Teile stehen hier ein ZWEITES Mal, nicht als Verweis: nur dieses Literal laeuft im
		// Zwillings-Test unter vm, eine Konstante davor waere dort unbekannt (ReferenceError). Wer eine
		// der drei Ebenen aendert, aendert „Alle" mit -- der Zwillings-Test haelt die Summe fest und nennt
		// den Teil, der abweicht: tools/__tests__/ansicht-untergrund-vektoren-zwilling.test.js
		// ⚠️ Die zarten Derographie-Fuellungen reisen mit, obwohl die Karte in „Alle" ungefuellt zeichnet:
		// das Icon ist die Summe der Ebenen-Icons, kein Abbild der Karte in dieser Ansicht.
		// Dieselbe Zeichnung traegt die Landschaften-Kachel der ersten Stufe -- aber nur, solange „Alle" gewaehlt ist;
		// sonst traegt die Kachel seit dem 14.09.2026 den Vektor der gewaehlten Ebene (zelle()).
		ecosystem:
			'<g fill="#575757">' +
			'<path d="M14 -2 C16.2 2.6 17.4 6.8 19.4 10 21.6 13.5 22.2 17.5 24 22 22.4 27 18.4 31 16.4 36 14.6 40.6 10.4 45 8 50 H-2 V-2 Z" fill-opacity=".13"/>' +
			'<path d="M24 22 C22.2 17.5 21.6 13.5 19.4 10 17.4 6.8 16.2 2.6 14 -2 H50 V34 C45.5 32.6 41.5 28.8 37 27.8 32.5 26.8 28.5 23.2 24 22 Z" fill-opacity=".2"/>' +
			'<path d="M24 22 C28.5 23.2 32.5 26.8 37 27.8 41.5 28.8 45.5 32.6 50 34 V50 H8 C10.4 45 14.6 40.6 16.4 36 18.4 31 22.4 27 24 22 Z" fill-opacity=".09"/></g>' +
			'<path d="M-0.3 9L0 6.4L0.6 6L3 3.7L4.3 3L6 1.5L7.7 0L9 -0.1L12 -0.2L15 -0.2L18 -0.2L21 -0.1L24 0L24.2 0L27 2.3L27.3 3L29.2 6L30 7L33 9L32.3 12L30.1 15L30 15.1L27.5 18L27 21L24 18.8L22.3 21L21 23L20.5 24L21 25.3L21.9 27L22.7 30L24 30.8L27 30.4L27.3 30L27 29.4L26 27L27 25.9L28.6 24L27 21L30 19.9L33 20.6L34.8 21L36 21.4L39 21.9L42 23.2L42.9 24L42.2 27L45 28.9L48 29.5L48 30L48.2 33L48.2 36L48.2 39L48 42L48 42.3L45 42.1L44.9 42L43.2 39L43.2 36L42 34.1L41.2 33L39.1 30L39 29.9L38.1 30L36 30.2L33.3 33L33 33.5L32.5 36L32.3 39L30.7 42L30 42.9L29.1 45L28.6 48L27 48.2L24 48.2L21 48.2L18 48.1L16.9 48L15 45.8L12 45.2L11.3 45L12 42.9L12.7 42L15 41.3L17.3 39L17 36L15 35.4L12 33.3L11.8 33L9 30.1L7.3 30L6 30L5.9 30L3 31.2L2 33L1.8 36L1.8 39L1 42L0.7 45L0.8 48L0 48.1L-0.1 48L-0.1 45L-0.1 42L-0.2 39L-0.2 36L-0.2 33L-0.1 30L-0.2 27L-0.1 24L-0.3 21L-0.4 18L-0.4 15L-0.4 12ZM46.3 0L48 -0.2L48.2 0L48.2 3L48.1 6L48 9L48 9.9L47.6 9L47.1 6L46.4 3Z" fill="#5f7d33" fill-opacity=".62" fill-rule="evenodd"/>' +
			'<path d="M0 9L0 8.6L3 7.7L5.5 9L4.8 12L3 13.1L1.7 15L0.9 18L3 20.8L6 20L8.5 18L9 16.9L11.6 15L9 13.1L7.7 12L6.9 9L9 8.3L12 7.9L14 6L14.3 3L15 1.9L18 3L18 3L20.5 6L21 6.1L24 6.3L27 6.9L28.7 9L28.8 12L27 13.7L24.7 15L24 15.5L21.4 15L21 14.9L18 14.6L16.9 15L15.6 18L15 21L18 23.7L18.1 24L18 24.5L16.4 27L15 29.4L12 28.5L9 28.4L6 28.1L3 27.7L1.9 27L1.4 24L0 21.3L0 21L-0.1 18L-0.1 15L-0.2 12ZM20.8 36L21 35.3L24 34.4L27 34.7L29.6 36L29.6 39L27.7 42L27.1 45L27 45.4L24 45.5L21 47L19.8 45L19.4 42L20.7 39Z" fill="#3f6b2c" fill-opacity=".72" fill-rule="evenodd"/>' +
			'<g fill="#7a6c5e">' +
			'<path d="M-0.1 0L0 -0.1L3 -0.1L6 -0.1L9 -0.1L12 0L15 0L18 -0.1L21 -0.1L24 -0.1L27 -0.1L30 -0.1L33 -0.1L36 -0.1L39 -0.1L42 -0.1L45 -0.1L48 -0.1L48.1 0L48 3L48.1 6L48 9L48.1 12L48 15L48 15.3L45 15L42 15L43.9 12L43 9L42 7.7L39 7.3L36 7.4L33 7.6L30 6.1L29.9 6L27 3.3L24 3.3L23.7 3L21 0.4L18 0.3L15 1.4L12 2.1L10.9 3L9 5.4L8.7 6L7.8 9L6 9.2L3 9.4L0 9.5L-0.1 9L-0.1 6L-0.1 3ZM30.4 42L33 40.3L36 40.4L39 41.1L40.5 42L42 42.9L43.9 42L42.3 39L42 38.3L41.2 36L40.2 33L40.8 30L42 27.9L43.3 27L45 25.6L45.9 24L48 23.8L48 24L48.1 27L48.1 30L48.1 33L48.1 36L48.1 39L48 42L48 45L48 47.5L47.7 48L45 48L42 48.1L39 48.1L36 48.1L35.6 48L33 45.4L32.6 45ZM-0.1 18L0 17.5L0.5 18L3 20.7L5.7 21L5.1 24L5.2 27L4 30L3.2 33L3.1 36L3 37.1L2.8 39L1.9 42L1.3 45L3 47.6L6 46.3L7.5 45L9 44L11.4 42L12 41.6L15 40.9L18 41.6L19 42L21 43.2L24 43.9L24.1 45L27 47.5L27.5 48L27 48.1L24 48.1L21 48.1L18 48.1L15 48.1L12 48.1L9 48.1L6 48L3 48L0 48L0 48L0 45L0 42L-0.1 39L-0.1 36L-0.1 33L-0.1 30L-0.1 27L-0.1 24L-0.1 21Z" fill-opacity=".62"/>' +
			'<path d="M-0.1 0L0 -0.1L3 -0.1L6 0L9 0L12 0L12.5 0L12 0.1L9 2.2L8.3 3L7 6L6.3 9L6 9L3 9.2L0 9.4L-0.1 9L-0.1 6L-0.1 3ZM-0.1 18L0 17.6L0.4 18L3 20.9L4.1 21L3.4 24L3.2 27L3 27.6L2.5 30L2.2 33L2 36L1.4 39L0.3 42L0 42.9L0 42L0 39L-0.1 36L-0.1 33L-0.1 30L0 27L0 24L-0.1 21ZM6.8 48L9 46L10.1 45L12 43.4L15 42L18 43.2L21 44.8L21.7 45L24 45.4L27 47.7L27.3 48L27 48.1L24 48.1L21 48.1L18 48.1L15 48.1L12 48.1L9 48ZM15.9 0L18 0L21 0L24 -0.1L27 -0.1L30 0L33 0L36 0L39 -0.1L42 -0.1L45 0L48 0L48 0L48 3L48 6L48 9L48 12L48 15L48 15.1L46.9 15L46.5 12L46.2 9L45 7.1L44.2 6L42 4.6L39 5.2L36 5.1L33 4.6L30 4.8L27 3.1L24 3.1L23.9 3L21 0.2L18 0.1ZM32.9 42L33 42L35.9 42L36 42L39 43.9L41.8 45L42 45L44.6 48L42 48L39 48L36 48.1L35.7 48L33 45.2L32.8 45ZM42.6 30L45 28.2L46.1 27L47.8 24L48 24L48 24L48 27L48.1 30L48.1 33L48.1 36L48 39L48 42L48 42.9L47.3 42L45 39.2L44.8 39L43.2 36L42.6 33Z" fill-opacity=".55"/></g>' +
			'<path d="M9.5 20.8L10 20.1L10.8 19.4L12.4 18.3L14.8 17.7L15.9 17.4L16.6 17L17.3 16.3L18 16L19.8 15.9L20.7 16.3L21.2 16.3L21.5 16.1L22.5 14.9L24 14.4L24.7 14.3L26.1 14.9L26.6 15.2L27.1 15.3L27.8 15.3L28.5 15.5L29.2 16.1L29.9 16.9L30.2 18L30.9 18.6L32.3 19.9L33.4 20.5L33.6 20.8L33.6 21.2L33.1 21.7L31.3 22.9L30.6 23.3L29.9 24.2L29.8 24.3L29.8 24.7L31.1 26.1L32.3 27.8L32.7 28.9L32.8 29.9L32.7 30.9L32.3 32L31.2 33.8L29.9 35.4L28.6 36.9L27.5 38.7L27.1 39.7L27.1 40.8L27.4 41.8L27.8 42.6L29.1 44.3L30.6 45.7L33.3 48.4L34.6 50.6L33.2 50.6L32.8 49.8L31.7 48.4L28.8 45.7L27.5 44.2L26.3 42.5L25.9 41.4L25.8 40.1L26.1 38.9L26.4 37.9L27.6 36.2L28.9 34.7L30.2 33.1L31.3 31.3L31.5 30.3L31.4 28.9L30.9 28L30.3 27.1L29.7 26.4L29.2 26.1L28.7 27.1L28.4 28.2L28.1 28.5L27.5 28.6L26.4 28.5L25.3 27.9L24.3 27.6L23.6 27.1L22.4 25.3L21.5 24.9L20.8 24.8L20.2 25L18.7 26.1L18 26.9L17.3 27.5L14.8 27.9L14.5 27.8L14.2 27.4L13.6 26.4L12.3 25L11.3 24L10.7 22.2L9.6 21.2Z" fill="#4c89c6" fill-opacity=".9"/>' +
			'<g fill="none" stroke="#2e2e2e" stroke-opacity=".85" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3.4 2.6">' +
			'<path d="M24 22 C22.2 17.5 21.6 13.5 19.4 10 17.4 6.8 16.2 2.6 14 -2" stroke-width="1.7"/>' +
			'<path d="M24 22 C28.5 23.2 32.5 26.8 37 27.8 41.5 28.8 45.5 32.6 50 34" stroke-width="1.7"/>' +
			'<path d="M24 22 C22.4 27 18.4 31 16.4 36 14.6 40.6 10.4 45 8 50" stroke-width="1.5"/>' +
			'</g>',

		// ---- Die fuenf Ebenen als zweite Stufe (09.09.2026) ---------------------------------------
		// 🔴 „Alle" hat KEINEN eigenen Vektor -- es nimmt `ecosystem` oben. „Alle" ist alle Ebenen
		// uebereinander; zwei getrennte Zeichnungen liefen beim naechsten Umton auseinander.
		// 🔴 Seit 14.09.2026 IST ecosystem die Ueberlagerung von Derographie, Vegetation und Topographie
		// (Regel und Reihenfolge am Eintrag oben). Die Landschaften-Kachel der ersten Stufe traegt sie nur bei „Alle",
		// sonst das Bild der gewaehlten Ebene (Owner 14.09.2026, zelle()).
		// 💣 Die Farben sind die ECHTEN aus css/base/tokens.css, jede aus der Stelle, die sie auf
		// der Karte zeichnet. Wer sie „aufraeumt", macht die Zelle zu einem Symbol, das etwas
		// anderes ankuendigt als die Karte zeigt.
		// ⚠️ KEIN Kachelbild darunter: der Untergrund steht in den Landschaften auf 0 %, und der
		// Grund ist --color-ecosystem-underground (#d3cec2).

		// 🔴 GESTRICHELT, weil die KARTE sie gestrichelt zeichnet (Owner 26.07.2026, Begruendung in
		// css/features/ecosystem-layer.css): eine derographische Flaeche ist ein Verwaltungsbehaelter,
		// und „a container's edge is a convention, not a thing you could walk up to like a forest edge
		// or a ridge" -- die Strichelung gehoert zur ART der Ebene: WENN die Karte die Kontur zeichnet,
		// dann gestrichelt, nie durchgezogen. ⚠️ Zu sehen ist sie auf der Karte aber NUR im Bearbeiten-Modus
		// und nur in einer einzelnen Ebene, nie in „Alle" (--eco-contour in css/features/ecosystem-layer.css).
		// Der gebaute Vektor zog sie zuvor DURCHGEHEND -- falsch.
		// ⚠️ Die drei zarten Fuellungen machen den Behaelter auf 48 px erst LESBAR (ungefuellt las sich
		// die Zelle als „nicht geladen"), ohne die Zelle zu einer Landschaftsebene zu machen. Auf der
		// Karte gilt dasselbe: in ihrer EIGENEN Ansicht fuellt die Flaeche ebenso (--eco-fill: 0.16,
		// css/features/ecosystem-layer.css); ungefuellt (0) bleibt sie nur in „Alle".
		// 🔴 Seit 14.09.2026 „deutlich schraeger" (Owner-Abnahme am gerenderten Bild): DREI Gebiete
		// treffen sich in EINEM Punkt, keine Grenze laeuft mehr waag- oder senkrecht -- drei Flaechen mit
		// je eigener Fuellopazitaet (.13 / .2 / .09), plus drei gestrichelte Grenzlinien, die sich in
		// diesem Punkt treffen. Das runde Element ist ERSATZLOS gefallen: eine Ebene, die
		// Behaelter mit Ecken zeichnet, braucht kein rundes Zeichen darin.
		eco_derographisch:
			'<g fill="#575757">' +
			'<path d="M14 -2 C16.2 2.6 17.4 6.8 19.4 10 21.6 13.5 22.2 17.5 24 22 22.4 27 18.4 31 16.4 36 14.6 40.6 10.4 45 8 50 H-2 V-2 Z" fill-opacity=".13"/>' +
			'<path d="M24 22 C22.2 17.5 21.6 13.5 19.4 10 17.4 6.8 16.2 2.6 14 -2 H50 V34 C45.5 32.6 41.5 28.8 37 27.8 32.5 26.8 28.5 23.2 24 22 Z" fill-opacity=".2"/>' +
			'<path d="M24 22 C28.5 23.2 32.5 26.8 37 27.8 41.5 28.8 45.5 32.6 50 34 V50 H8 C10.4 45 14.6 40.6 16.4 36 18.4 31 22.4 27 24 22 Z" fill-opacity=".09"/></g>' +
			'<g fill="none" stroke="#2e2e2e" stroke-opacity=".85" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3.4 2.6">' +
			'<path d="M24 22 C22.2 17.5 21.6 13.5 19.4 10 17.4 6.8 16.2 2.6 14 -2" stroke-width="1.7"/>' +
			'<path d="M24 22 C28.5 23.2 32.5 26.8 37 27.8 41.5 28.8 45.5 32.6 50 34" stroke-width="1.7"/>' +
			'<path d="M24 22 C22.4 27 18.4 31 16.4 36 14.6 40.6 10.4 45 8 50" stroke-width="1.5"/>' +
			'</g>',

		// Grasland (--color-ecosystem-vegetation #5f7d33) und Wald (--color-ecosystem-vegetation-wald
		// #3f6b2c), je EIN Pfad aus mehreren Teilflaechen (evenodd).
		// 🔴 ZUFAELLIG-ECKIG, NICHT VON HAND GESETZT (Owner 14.09.2026): die Umrisse sind aus einem
		// Rauschfeld mit festem Samen (101) ERZEUGT und vom Owner aus Vorschauen gewaehlt -- ein Ergebnis,
		// keine Zeichnung. Wer hier einen Punkt „glaettet", liefert ein anderes Icon aus, als abgenommen
		// wurde. Steppe, Wuestenfleck und die runden Waldflecken sind dabei gefallen.
		eco_vegetation:
			'<path d="M-0.3 9L0 6.4L0.6 6L3 3.7L4.3 3L6 1.5L7.7 0L9 -0.1L12 -0.2L15 -0.2L18 -0.2L21 -0.1L24 0L24.2 0L27 2.3L27.3 3L29.2 6L30 7L33 9L32.3 12L30.1 15L30 15.1L27.5 18L27 21L24 18.8L22.3 21L21 23L20.5 24L21 25.3L21.9 27L22.7 30L24 30.8L27 30.4L27.3 30L27 29.4L26 27L27 25.9L28.6 24L27 21L30 19.9L33 20.6L34.8 21L36 21.4L39 21.9L42 23.2L42.9 24L42.2 27L45 28.9L48 29.5L48 30L48.2 33L48.2 36L48.2 39L48 42L48 42.3L45 42.1L44.9 42L43.2 39L43.2 36L42 34.1L41.2 33L39.1 30L39 29.9L38.1 30L36 30.2L33.3 33L33 33.5L32.5 36L32.3 39L30.7 42L30 42.9L29.1 45L28.6 48L27 48.2L24 48.2L21 48.2L18 48.1L16.9 48L15 45.8L12 45.2L11.3 45L12 42.9L12.7 42L15 41.3L17.3 39L17 36L15 35.4L12 33.3L11.8 33L9 30.1L7.3 30L6 30L5.9 30L3 31.2L2 33L1.8 36L1.8 39L1 42L0.7 45L0.8 48L0 48.1L-0.1 48L-0.1 45L-0.1 42L-0.2 39L-0.2 36L-0.2 33L-0.1 30L-0.2 27L-0.1 24L-0.3 21L-0.4 18L-0.4 15L-0.4 12ZM46.3 0L48 -0.2L48.2 0L48.2 3L48.1 6L48 9L48 9.9L47.6 9L47.1 6L46.4 3Z" fill="#5f7d33" fill-opacity=".62" fill-rule="evenodd"/>' +
			'<path d="M0 9L0 8.6L3 7.7L5.5 9L4.8 12L3 13.1L1.7 15L0.9 18L3 20.8L6 20L8.5 18L9 16.9L11.6 15L9 13.1L7.7 12L6.9 9L9 8.3L12 7.9L14 6L14.3 3L15 1.9L18 3L18 3L20.5 6L21 6.1L24 6.3L27 6.9L28.7 9L28.8 12L27 13.7L24.7 15L24 15.5L21.4 15L21 14.9L18 14.6L16.9 15L15.6 18L15 21L18 23.7L18.1 24L18 24.5L16.4 27L15 29.4L12 28.5L9 28.4L6 28.1L3 27.7L1.9 27L1.4 24L0 21.3L0 21L-0.1 18L-0.1 15L-0.2 12ZM20.8 36L21 35.3L24 34.4L27 34.7L29.6 36L29.6 39L27.7 42L27.1 45L27 45.4L24 45.5L21 47L19.8 45L19.4 42L20.7 39Z" fill="#3f6b2c" fill-opacity=".72" fill-rule="evenodd"/>',

		// Drei grosse Gebirgsflecken (--color-ecosystem-topographie-gebirge #7a6c5e, zwei Deckkraftlagen)
		// ueber den Rand, in der Mitte ein unregelmaessiger See (--color-water #4c89c6) mit einem duennen,
		// geschlaengelten Fluss, der unten aus der Kachel laeuft -- See und Fluss sind EIN Pfad.
		// 🔴 Wie die Vegetation aus Rauschfeldern mit festem Samen ERZEUGT und vom Owner aus Vorschauen
		// gewaehlt (14.09.2026) -- ein Ergebnis, nicht von Hand gesetzt.
		// ⚠️ Gefallen sind Kamm, Schneekappen, die alte See-Ellipse, das Meer und das Huegelband. Das Meer
		// bleibt auf der Karte anders als der See (--color-ecosystem-topographie-meer), steht aber nicht
		// mehr in der Zelle.
		eco_topographie:
			'<g fill="#7a6c5e">' +
			'<path d="M-0.1 0L0 -0.1L3 -0.1L6 -0.1L9 -0.1L12 0L15 0L18 -0.1L21 -0.1L24 -0.1L27 -0.1L30 -0.1L33 -0.1L36 -0.1L39 -0.1L42 -0.1L45 -0.1L48 -0.1L48.1 0L48 3L48.1 6L48 9L48.1 12L48 15L48 15.3L45 15L42 15L43.9 12L43 9L42 7.7L39 7.3L36 7.4L33 7.6L30 6.1L29.9 6L27 3.3L24 3.3L23.7 3L21 0.4L18 0.3L15 1.4L12 2.1L10.9 3L9 5.4L8.7 6L7.8 9L6 9.2L3 9.4L0 9.5L-0.1 9L-0.1 6L-0.1 3ZM30.4 42L33 40.3L36 40.4L39 41.1L40.5 42L42 42.9L43.9 42L42.3 39L42 38.3L41.2 36L40.2 33L40.8 30L42 27.9L43.3 27L45 25.6L45.9 24L48 23.8L48 24L48.1 27L48.1 30L48.1 33L48.1 36L48.1 39L48 42L48 45L48 47.5L47.7 48L45 48L42 48.1L39 48.1L36 48.1L35.6 48L33 45.4L32.6 45ZM-0.1 18L0 17.5L0.5 18L3 20.7L5.7 21L5.1 24L5.2 27L4 30L3.2 33L3.1 36L3 37.1L2.8 39L1.9 42L1.3 45L3 47.6L6 46.3L7.5 45L9 44L11.4 42L12 41.6L15 40.9L18 41.6L19 42L21 43.2L24 43.9L24.1 45L27 47.5L27.5 48L27 48.1L24 48.1L21 48.1L18 48.1L15 48.1L12 48.1L9 48.1L6 48L3 48L0 48L0 48L0 45L0 42L-0.1 39L-0.1 36L-0.1 33L-0.1 30L-0.1 27L-0.1 24L-0.1 21Z" fill-opacity=".62"/>' +
			'<path d="M-0.1 0L0 -0.1L3 -0.1L6 0L9 0L12 0L12.5 0L12 0.1L9 2.2L8.3 3L7 6L6.3 9L6 9L3 9.2L0 9.4L-0.1 9L-0.1 6L-0.1 3ZM-0.1 18L0 17.6L0.4 18L3 20.9L4.1 21L3.4 24L3.2 27L3 27.6L2.5 30L2.2 33L2 36L1.4 39L0.3 42L0 42.9L0 42L0 39L-0.1 36L-0.1 33L-0.1 30L0 27L0 24L-0.1 21ZM6.8 48L9 46L10.1 45L12 43.4L15 42L18 43.2L21 44.8L21.7 45L24 45.4L27 47.7L27.3 48L27 48.1L24 48.1L21 48.1L18 48.1L15 48.1L12 48.1L9 48ZM15.9 0L18 0L21 0L24 -0.1L27 -0.1L30 0L33 0L36 0L39 -0.1L42 -0.1L45 0L48 0L48 0L48 3L48 6L48 9L48 12L48 15L48 15.1L46.9 15L46.5 12L46.2 9L45 7.1L44.2 6L42 4.6L39 5.2L36 5.1L33 4.6L30 4.8L27 3.1L24 3.1L23.9 3L21 0.2L18 0.1ZM32.9 42L33 42L35.9 42L36 42L39 43.9L41.8 45L42 45L44.6 48L42 48L39 48L36 48.1L35.7 48L33 45.2L32.8 45ZM42.6 30L45 28.2L46.1 27L47.8 24L48 24L48 24L48 27L48.1 30L48.1 33L48.1 36L48 39L48 42L48 42.9L47.3 42L45 39.2L44.8 39L43.2 36L42.6 33Z" fill-opacity=".55"/></g>' +
			'<path d="M9.5 20.8L10 20.1L10.8 19.4L12.4 18.3L14.8 17.7L15.9 17.4L16.6 17L17.3 16.3L18 16L19.8 15.9L20.7 16.3L21.2 16.3L21.5 16.1L22.5 14.9L24 14.4L24.7 14.3L26.1 14.9L26.6 15.2L27.1 15.3L27.8 15.3L28.5 15.5L29.2 16.1L29.9 16.9L30.2 18L30.9 18.6L32.3 19.9L33.4 20.5L33.6 20.8L33.6 21.2L33.1 21.7L31.3 22.9L30.6 23.3L29.9 24.2L29.8 24.3L29.8 24.7L31.1 26.1L32.3 27.8L32.7 28.9L32.8 29.9L32.7 30.9L32.3 32L31.2 33.8L29.9 35.4L28.6 36.9L27.5 38.7L27.1 39.7L27.1 40.8L27.4 41.8L27.8 42.6L29.1 44.3L30.6 45.7L33.3 48.4L34.6 50.6L33.2 50.6L32.8 49.8L31.7 48.4L28.8 45.7L27.5 44.2L26.3 42.5L25.9 41.4L25.8 40.1L26.1 38.9L26.4 37.9L27.6 36.2L28.9 34.7L30.2 33.1L31.3 31.3L31.5 30.3L31.4 28.9L30.9 28L30.3 27.1L29.7 26.4L29.2 26.1L28.7 27.1L28.4 28.2L28.1 28.5L27.5 28.6L26.4 28.5L25.3 27.9L24.3 27.6L23.6 27.1L22.4 25.3L21.5 24.9L20.8 24.8L20.2 25L18.7 26.1L18 26.9L17.3 27.5L14.8 27.9L14.5 27.8L14.2 27.4L13.6 26.4L12.3 25L11.3 24L10.7 22.2L9.6 21.2Z" fill="#4c89c6" fill-opacity=".9"/>',

		// 🔴 Die echten Toene der Temperaturskala, kalt oben nach warm unten. Die Ebene wird nicht
		// gezeichnet, sondern aus Trennlinien ABGELEITET -- deshalb sind die Kanten hier leicht
		// bewegt und nicht schnurgerade: so liegen sie auf der Karte.
		// 🔴 HIER STAND EINE ZAHL ("ACHT Baender"). Eine Zahl liest sich wie eine vollstaendige
		// Liste, und niemand zaehlt nach (AGENTS.md §11): die Zonen sind DATEN
		// (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED in api/_internal/app/ecosystem.php), und die Zelle
		// zeichnet eine Staffel, keine Zaehlung. Die Veralterung ist daneben schon eingetreten --
		// css/base/tokens.css spricht bei derselben Skala von „Sieben Bändern … aus sechs
		// Trennlinien" und fuehrt acht Toene (fremder Umfang, hier bewusst nicht angefasst).
		eco_klima:
			'<path d="M0 0 H48 V6 C36 7.4 24 4.8 12 6.2 8 6.7 4 6 0 6.6 Z" fill="#cfe0eb" fill-opacity=".9"/>' +
			'<path d="M0 6.6 C4 6 8 6.7 12 6.2 24 4.8 36 7.4 48 6 V12 C36 13.6 24 10.8 12 12.4 8 12.9 4 12.2 0 12.8 Z" fill="#a2c3d1" fill-opacity=".9"/>' +
			'<path d="M0 12.8 C4 12.2 8 12.9 12 12.4 24 10.8 36 13.6 48 12 V18.4 C36 19.6 24 17.2 12 18.6 8 19 4 18.4 0 19 Z" fill="#7aada9" fill-opacity=".9"/>' +
			'<path d="M0 19 C4 18.4 8 19 12 18.6 24 17.2 36 19.6 48 18.4 V24.6 C36 26 24 23.4 12 24.8 8 25.2 4 24.6 0 25.2 Z" fill="#bfc888" fill-opacity=".9"/>' +
			'<path d="M0 25.2 C4 24.6 8 25.2 12 24.8 24 23.4 36 26 48 24.6 V31 C36 32.4 24 29.8 12 31.2 8 31.6 4 31 0 31.6 Z" fill="#dcb857" fill-opacity=".9"/>' +
			'<path d="M0 31.6 C4 31 8 31.6 12 31.2 24 29.8 36 32.4 48 31 V37.2 C36 38.6 24 36 12 37.4 8 37.8 4 37.2 0 37.8 Z" fill="#cdb083" fill-opacity=".9"/>' +
			'<path d="M0 37.8 C4 37.2 8 37.8 12 37.4 24 36 36 38.6 48 37.2 V43.4 C36 44.8 24 42.2 12 43.6 8 44 4 43.4 0 44 Z" fill="#d98f3c" fill-opacity=".9"/>' +
			'<path d="M0 44 C4 43.4 8 44 12 43.6 24 42.2 36 44.8 48 43.4 V48 H0 Z" fill="#c65e2e" fill-opacity=".9"/>',

		// „Nur Karte" ist LEER, und das ist die Aussage: hier liegt nichts ueber dem Untergrund.
		none: ""
	};

	// 🔴 Was die ANSICHT mit dem Untergrund macht -- nicht mit sich selbst. Der Wert ist der echte aus
	// js/map-features/map-features-powerlines.js bzw. dem Kommentar in tools/layer-tiles/capture.js
	// ("Die Entsaettigung ist NICHT erfunden: syncPowerlineMapTint faerbt die Grundkarte mit genau
	// diesen Werten"). Als Filter auf der Untergrund-Schicht stimmt er auf JEDEM Kachelsatz --
	// eingebrannt in eine Aufnahme galt er nur fuer den einen, auf dem sie entstand.
	const GRUND_FILTER = {
		powerlines: "saturate(0.1) brightness(0.6)"
	};

	// 🔴 UNTER DER LANDSCHAFTEN-ZELLE LIEGT KEIN UNTERGRUNDBILD (Owner 14.09.2026: in den Landschaften ist der
	// Untergrund fuer Besucher ganz aus -- das Anzeigeprofil schreibt allen fuenf Ebenen 0 % vor, und bei 0 % nimmt
	// syncEcosystemBaseTiles die Kachelebene ganz von der Karte). zelle() legt dort gar kein <img> an; die Huelle traegt
	// --color-ecosystem-underground (#d3cec2), wie die Ebenenzellen der zweiten Stufe und das Mockup
	// (`ohneUntergrund` in tools/bau-ansicht-untergrund-mockup.js).
	// 💣 HIER STAND BIS DAHIN EINE TABELLE `GRUND_DECKKRAFT` mit `ecosystem: 0.25`, und die naheliegende Korrektur waere
	// die falsche gewesen: auf 0 gestellt, ist der Wert FALSY -- die Abfrage `if (GRUND_DECKKRAFT[…])` haette die
	// Deckkraft gar nicht gesetzt, und das Bild stuende mit VOLLER Deckkraft unter dem Vektor. Die Tabelle ist deshalb
	// ENTFERNT, nicht genullt; einen zweiten Eintrag hatte sie nie.

	/**
	 * Welcher Vektor aus OVERLAYS zu welcher Landschafts-Ebene gehoert -- eine EIGENSCHAFTS-Tabelle, keine
	 * Liste der Ebenen: die kommen aus der Reiterleiste (ebenen() unten), und eine Ebene ohne Eintrag hier
	 * bekommt ihre Zelle trotzdem, nur ohne Bild.
	 * 🔴 „Alle" nimmt den Landschafts-Vektor selbst -- er IST Derographie + Vegetation + Topographie
	 * (Owner 14.09.2026, festgehalten in tools/__tests__/ansicht-untergrund-vektoren-zwilling.test.js).
	 */
	var EBENEN_VEKTOR = {
		alle: "ecosystem",
		derographisch: "eco_derographisch",
		vegetation: "eco_vegetation",
		topographie: "eco_topographie",
		klima: "eco_klima"
	};

	/** Die Ansicht, ueber der die zweite Stufe die Ebenen zeigt -- ihr Wert im <select>. */
	var EBENEN_ANSICHT = "ecosystem";

	function ansichten() {
		// 💣 Die EINZIGE Quelle ist das <select>. Eine zweite Liste hier waere die Divergenz, die
		// beim naechsten neuen Modus zuschlaegt: die Auswahlbox kennte ihn, die Kacheln nicht.
		var select = document.getElementById("mapLayerModeSelect");
		if (!select) {
			return [];
		}
		return Array.prototype.map.call(select.options, function (option) {
			return {
				wert: option.value,
				name: (option.textContent || "").trim(),
				gesperrt: Boolean(option.disabled)
			};
		});
	}

	function aktiveAnsicht() {
		var select = document.getElementById("mapLayerModeSelect");
		return select ? String(select.value || "") : "";
	}

	/**
	 * Die Untergruende -- die zweite Stufe des Menues (seit 26.08.2026, Entwurf:
	 * docs/superpowers/specs/2026-08-26-ansicht-untergrund-kreuzen-design.md).
	 *
	 * 💣 Dieselbe Regel wie bei den Ansichten: die EINZIGE Quelle ist das <select>. `#mapStyleSelect`
	 * IST der Zustand -- setMapStyle schreibt seinen Wert, der geteilte Link kommt ueber `?mapstyle=`
	 * dort an. Eine zweite Liste hier liefe beim naechsten Kachelsatz auseinander.
	 * 🔴 „Old" sieht nur der Editor (Owner 26.08.2026): der Satz traegt die aufgedruckten Ortsnamen
	 * und ist als Vorlage fuer die Erfassung gedacht, nicht als Ansicht fuer Besucher.
	 */
	function untergruende() {
		var select = document.getElementById("mapStyleSelect");
		if (!select) {
			return [];
		}
		var imEditor = typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE;
		return Array.prototype.map.call(select.options, function (option) {
			return {
				wert: option.value,
				name: (option.textContent || "").trim(),
				gesperrt: Boolean(option.disabled)
			};
		}).filter(function (eintrag) {
			// 💣 NUR ECHTE KACHELSAETZE. Das <select> traegt seit jeher einen Eintrag mehr:
			// js/ui/route-planner-toggle.js haengt `none` („leerer Hintergrund") nachtraeglich als
			// erstes Kind hinein und wickelt dafuer setMapStyle. `none` ist aber die ABWESENHEIT
			// eines Untergrunds, kein Untergrund -- er steht folgerichtig nicht in MAP_TILE_STYLES,
			// hat also auch kein Vorschaubild. Live gemessen am 26.08.2026: er stand als leere
			// Kachel in der Reihe.
			// ⭐ Gefiltert wird deshalb gegen MAP_TILE_STYLES, nicht gegen den Namen `none`: das
			// haelt auch, wenn irgendwann ein weiterer Eintrag von aussen dazukommt.
			if (typeof MAP_TILE_STYLES === "undefined" || !MAP_TILE_STYLES[eintrag.wert]) {
				return false;
			}
			return imEditor || eintrag.wert !== "old";
		});
	}

	function aktiverUntergrund() {
		var select = document.getElementById("mapStyleSelect");
		var wert = select ? String(select.value || "") : "";
		var liste = untergruende();
		// ⚠️ Ein Wert, den die Rolle nicht sehen darf, faellt auf den ersten erlaubten zurueck --
		// sonst benennt die Kachel einen Untergrund, den das Menue gar nicht anbietet.
		var treffer = liste.filter(function (e) { return e.wert === wert; })[0];
		return treffer || liste[0] || null;
	}

	/**
	 * Die Landschafts-Ebenen -- der Inhalt der zweiten Stufe ueber „Landschaften" (Owner 14.09.2026,
	 * Entwurf docs/superpowers/specs/2026-09-09-landschaften-untermenue-design.md §1/§2).
	 *
	 * 💣 DIESELBE REGEL WIE BEI ANSICHTEN UND UNTERGRUENDEN: die EINZIGE Quelle ist die Reiterleiste
	 * `#ecosystem-layer-switch`. Sie IST der Zustand -- ihr Klick-Zuhoerer setzt Ebene und „Alle", merkt
	 * beides im localStorage und stempelt aria-selected (js/map-features/map-features-ecosystem-layer-switch.js).
	 * Eine zweite Liste hier liefe beim naechsten Ebenentyp auseinander: die Leiste kennte ihn, der
	 * Faecher nicht.
	 * 🔴 „Alle" traegt KEIN data-ecosystem-kind, sondern data-ecosystem-show-all -- isKnownEcosystemKind
	 * kennt „alle" nicht, ein gemerkter Wert fiele still auf die Vorgabe zurueck (index.html erklaert es an
	 * der Leiste). Der Wert "alle" ist deshalb nur der Name dieses einen Reiters hier im Faecher.
	 * ⚠️ Die Leiste bleibt im DOM, auch wenn der Besucher sie nicht sieht (Entwurf §2) -- sonst gaebe es
	 * hier nichts zu lesen.
	 */
	function ebenenReiter() {
		var leiste = document.getElementById("ecosystem-layer-switch");
		if (!leiste) {
			return [];
		}
		return Array.prototype.slice.call(leiste.querySelectorAll("[data-ecosystem-show-all], [data-ecosystem-kind]"));
	}

	function ebenenWert(reiter) {
		return reiter.hasAttribute("data-ecosystem-show-all")
			? "alle"
			: String(reiter.getAttribute("data-ecosystem-kind") || "");
	}

	function ebenen() {
		return ebenenReiter().map(function (reiter) {
			return {
				wert: ebenenWert(reiter),
				name: (reiter.textContent || "").trim(),
				gesperrt: Boolean(reiter.disabled)
			};
		}).filter(function (eintrag) {
			return eintrag.wert !== "";
		});
	}

	/**
	 * Die Ebene, die die Leiste als gewaehlt stempelt -- "" ohne Leiste.
	 * 🔴 Auch AUSSERHALB der Landschaften der gemerkte Stand: die Leiste spiegelt ihn schon beim Laden
	 * (js/map-features/map-features-ecosystem-layer-switch.js, am Dateiende). Bis zum 14.09.2026 trug sie bis zum
	 * ersten Moduswechsel das aria-selected aus dem MARKUP. Kein zweiter Zustand hier.
	 */
	function aktiveEbene() {
		var treffer = ebenenReiter().filter(function (reiter) {
			return reiter.getAttribute("aria-selected") === "true";
		})[0];
		return treffer ? ebenenWert(treffer) : "";
	}

	/**
	 * 💣 GEKLICKT, NICHT GESETZT -- derselbe Weg wie beim <select>, kein zweiter. Am Reiterklick haengen
	 * das Setzen von Ebene bzw. „Alle" in der richtigen Reihenfolge, das Merken im localStorage, die
	 * aria-Zustaende und die Besucherzaehlung (js/app/visitor-tracking.js horcht auf diese Leiste). Ein
	 * eigener Aufruf hier umginge alle auf einmal.
	 * ⚠️ Der Zuhoerer prueft weder Modus noch Recht, und `click()` haelt nur `disabled` auf, nicht
	 * `hidden` -- der Klick wirkt also auch, wenn die Leiste fuer Besucher versteckt ist.
	 */
	function waehleEbene(wert) {
		var treffer = ebenenReiter().filter(function (reiter) {
			return ebenenWert(reiter) === wert;
		})[0];
		if (treffer) {
			treffer.click();
		}
	}

	/** Welche Art die zweite Stufe ueber einer Ansicht traegt: "ebenen" oder "grund". */
	function stufeZweiArtVon(modus) {
		return modus === EBENEN_ANSICHT ? "ebenen" : "grund";
	}

	/**
	 * 🔴 HAT DIESE ANSICHT EINE ZWEITE STUFE? -- je Ansicht gefragt, nie pauschal (Owner 14.09.2026: die
	 * Stufe zeigt, was DIESE Ansicht zu waehlen hat). Bis dahin fragten waehle() und oeffneStufeZwei() nach
	 * der Zahl der Untergruende: mit nur einem erlaubten Untergrund oeffnete Landschaften dann gar nichts,
	 * obwohl seine Ebenen da sind -- und ueber Landschaften oeffneten Untergruende, wo Ebenen hingehoeren.
	 * ⚠️ Untergruende sind erst ab ZWEI eine Wahl (einer ist ohnehin eingestellt); eine Ebene ist schon
	 * allein das, was der Klick waehlt.
	 */
	function hatStufeZwei(modus) {
		if (!modus) {
			return false;
		}
		if (stufeZweiArtVon(modus) === "ebenen") {
			return ebenen().length > 0;
		}
		return untergruende().length > 1;
	}

	/** Die Vektorschicht einer Zelle -- EINE Bauform fuer beide Stufen. */
	function vektorSchicht(zeichnung) {
		var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 48 48");
		svg.setAttribute("class", "map-layer-picker__vektor");
		svg.setAttribute("aria-hidden", "true");
		svg.innerHTML = zeichnung;
		return svg;
	}

	function zelle(ansicht, istAktiv, imMenue) {
		var knopf = document.createElement("button");
		knopf.type = "button";
		knopf.className = "map-layer-picker__cell" + (istAktiv ? " is-active" : "");
		knopf.dataset.mode = ansicht.wert;
		if (imMenue) {
			knopf.setAttribute("role", "radio");
			knopf.setAttribute("aria-checked", istAktiv ? "true" : "false");
			knopf.disabled = ansicht.gesperrt;
		} else {
			// Die zugeklappte Kachel ist kein eigener Knopf: sie sitzt IM Kachel-Knopf und darf
			// dessen Klick nicht abfangen.
			knopf.tabIndex = -1;
			knopf.setAttribute("aria-hidden", "true");
		}

		var huelle = document.createElement("span");
		huelle.className = "map-layer-picker__thumb";
		// 🔴 BEI LANDSCHAFTEN TRAEGT DIE ZELLE DIE GEWAEHLTE EBENE -- NAME UND BILD (Owner 14.09.2026: „wenn ich auf ein
		// element draufklick z.B. derographie steht ‚Landschaften Derographie' dran, aber nicht das icon (das ist von
		// ‚alle')"). Das gilt fuer die zugeklappte Kachel UND fuer die Landschaften-Zelle im Menue: die aktive Zelle liegt
		// beim Aufklappen auf dem Fleck der Kachel, ein anderes Bild wechselte dort sichtbar. Ueber einer anderen Ansicht
		// zeigt die Zelle, was ein Klick auf Landschaften bringt -- die Ebene bleibt gemerkt.
		// 💣 NAME UND BILD KOMMEN AUS EINER AUSKUNFT: aktiveEbene() wird hier genau EINMAL gelesen. Zwei Leser sind genau
		// der gemeldete Fehler -- „Derographie" als Name, das Bild von „Alle" daneben.
		// 🔴 KEIN <img>: dort ist der Untergrund fuer Besucher aus, die Huelle traegt den Ausblendton wie jede Ebenenzelle
		// der zweiten Stufe. Warum die alte Abblendung entfernt und nicht genullt ist, steht ueber EBENEN_VEKTOR.
		// ⚠️ Ohne Leiste oder bei einer Ebene ohne eigenen Vektor faellt das Bild auf das der Landschaften selbst zurueck:
		// die Zelle der ersten Stufe steht fuer die Ansicht und darf nicht leer dastehen.
		var zweiteZeile = "";
		var mitZweiterZeile = istAktiv || !imMenue;
		if (ansicht.wert === EBENEN_ANSICHT) {
			var ebene = aktiveEbene();
			huelle.style.background = "var(--color-ecosystem-underground)";
			var ebenenBild = OVERLAYS[EBENEN_VEKTOR[ebene] || ansicht.wert];
			if (ebenenBild) {
				huelle.appendChild(vektorSchicht(ebenenBild));
			}
			if (mitZweiterZeile) {
				var eintrag = ebenen().filter(function (e) { return e.wert === ebene; })[0];
				zweiteZeile = eintrag ? eintrag.name : "";
			}
		} else {
			var bild = document.createElement("img");
			// 🔴 UNTER dem Vektor liegt der GEWAEHLTE Untergrund -- wechselt er, wechselt das Bild aller
			// Ansichten mit. Genau das konnte die alte Aufnahme nicht: sie trug ihren Untergrund
			// eingebrannt, und „Kraftlinien auf Original" zeigte deshalb Kraftlinien auf Stilisiert.
			var grund = aktiverUntergrund();
			bild.src = grund ? grundBildUrl(grund.wert) : "";
			bild.alt = "";
			bild.width = 48;
			bild.height = 48;
			bild.loading = "lazy";
			// 💣 Was die ANSICHT mit dem Untergrund macht, gehoert auf das BILD, nicht auf die Zelle: an
			// der Zelle entsaettigte der Filter den Vektor gleich mit, und die Kraftlinien waeren grau
			// statt rosa -- also genau das Merkmal weg, das die Ansicht kenntlich macht.
			if (GRUND_FILTER[ansicht.wert]) {
				bild.style.filter = GRUND_FILTER[ansicht.wert];
			}
			huelle.appendChild(bild);
			if (OVERLAYS[ansicht.wert]) {
				huelle.appendChild(vektorSchicht(OVERLAYS[ansicht.wert]));
			}
			if (mitZweiterZeile) {
				zweiteZeile = grund ? grund.name : "";
			}
		}

		var name = document.createElement("span");
		name.className = "map-layer-picker__label";
		name.textContent = ansicht.name;

		knopf.appendChild(huelle);
		knopf.appendChild(name);

		// 🔴 DIE ZWEITE ZEILE -- unter dem Ansichtsnamen der Untergrund (26.08.2026), bei Landschaften die Ebene
		// (14.09.2026, Entwurf §1: sie nennt, was die zweite Stufe DIESER Ansicht waehlt; der Untergrund sagt dort
		// nichts mehr aus).
		// „Standard · Modern" passt NIE in eine Zeile: die Zelle ist 66px breit, gebunden an das
		// laengste Ansichtswort. Deshalb zwei Zeilen statt eines Kuerzels.
		// 💣 Sie bekommen ALLE Zellen, gefuellt nur die aktive -- nur so sind Kachel und aktive
		// Zelle gleich hoch, und nur dann faellt die Kachel beim Aufklappen auf ihren eigenen Fleck.
		// Steht die Zeile nur an der Kachel, springt das Menue um ihre Hoehe.
		// ⚠️ Sichtbar ist sie im offenen Menue ohnehin keine: das CSS blendet sie dort aus, weil man
		// den Untergrund dann in der zweiten Stufe waehlt und die Auskunft veraltet waere.
		var zweite = document.createElement("span");
		zweite.className = "map-layer-picker__label map-layer-picker__label--grund";
		// Leer bleibt sie ein geschuetztes Leerzeichen -- eine leere Zeile fiele zusammen, und die Kachel spraenge.
		zweite.textContent = zweiteZeile || "\u00a0";
		knopf.appendChild(zweite);
		return knopf;
	}

	/** Eine Zelle der zweiten Stufe. Sie traegt keine zweite Zeile -- sie IST der Untergrund. */
	function grundZelle(eintrag, istAktiv) {
		var knopf = document.createElement("button");
		knopf.type = "button";
		knopf.className = "map-layer-picker__cell" + (istAktiv ? " is-active" : "");
		knopf.dataset.grund = eintrag.wert;
		knopf.setAttribute("role", "radio");
		knopf.setAttribute("aria-checked", istAktiv ? "true" : "false");
		knopf.disabled = eintrag.gesperrt;

		var huelle = document.createElement("span");
		huelle.className = "map-layer-picker__thumb";
		var bild = document.createElement("img");
		bild.src = grundBildUrl(eintrag.wert);
		bild.alt = "";
		bild.width = 48;
		bild.height = 48;
		bild.loading = "lazy";
		huelle.appendChild(bild);

		var name = document.createElement("span");
		name.className = "map-layer-picker__label";
		name.textContent = eintrag.name;

		knopf.appendChild(huelle);
		knopf.appendChild(name);
		return knopf;
	}

	/**
	 * Eine Zelle der zweiten Stufe ueber „Landschaften": die Ebene als Vektor. Wie grundZelle traegt sie
	 * keine zweite Zeile -- sie IST die Wahl.
	 * 🔴 KEIN <img>: in den Landschaften ist der Untergrund fuer Besucher ganz aus (Owner 14.09.2026,
	 * Entwurf §0 Punkt 2). Die Huelle traegt stattdessen den Ausblendton, wie im Mockup (Karte „L").
	 */
	function ebenenZelle(eintrag, istAktiv) {
		var knopf = document.createElement("button");
		knopf.type = "button";
		knopf.className = "map-layer-picker__cell" + (istAktiv ? " is-active" : "");
		knopf.dataset.ebene = eintrag.wert;
		knopf.setAttribute("role", "radio");
		knopf.setAttribute("aria-checked", istAktiv ? "true" : "false");
		knopf.disabled = eintrag.gesperrt;

		var huelle = document.createElement("span");
		huelle.className = "map-layer-picker__thumb";
		huelle.style.background = "var(--color-ecosystem-underground)";
		if (EBENEN_VEKTOR[eintrag.wert] && OVERLAYS[EBENEN_VEKTOR[eintrag.wert]]) {
			huelle.appendChild(vektorSchicht(OVERLAYS[EBENEN_VEKTOR[eintrag.wert]]));
		}

		var name = document.createElement("span");
		name.className = "map-layer-picker__label";
		name.textContent = eintrag.name;

		knopf.appendChild(huelle);
		knopf.appendChild(name);
		return knopf;
	}

	function start() {
		var huelle = document.getElementById("map-layer-picker");
		var knopf = document.getElementById("map-layer-button");
		var menue = document.getElementById("map-layer-menu");
		var select = document.getElementById("mapLayerModeSelect");
		var grundSelect = document.getElementById("mapStyleSelect");
		if (!huelle || !knopf || !menue || !select) {
			return;
		}

		/**
		 * DIE ZWEITE STUFE -- EINE Reihe, die je Ansicht einen anderen Inhalt baut: die Untergruende
		 * (26.08.2026, Entwurf: docs/superpowers/specs/2026-08-26-ansicht-untergrund-kreuzen-design.md) und
		 * ueber „Landschaften" die Ebenen (14.09.2026, Entwurf:
		 * docs/superpowers/specs/2026-09-09-landschaften-untermenue-design.md §1).
		 * 🔴 Keine zweite Reihe und keine dritte Stufe -- fuer niemanden (Owner 14.09.2026). Die Reihe heisst
		 * deshalb nach der Stufe, nicht nach ihrem Inhalt (`stufeReihe`, bis dahin `grundReihe`).
		 * ⚠️ Die CSS-Klasse `map-layer-picker__grund` traegt noch den alten Namen; das Blatt und
		 * map-layer-picker.test.js haengen an ihr.
		 *
		 * ⚠️ Sie wird HIER erzeugt und steht nicht im Markup: index.html ist eine vielbefahrene
		 * Datei, und der Picker baut seinen Inhalt ohnehin selbst. Ein Element mehr im Markup waere
		 * ein Stueck Zustand, das zwei Dateien teilen muessten.
		 */
		var stufeReihe = document.createElement("div");
		stufeReihe.className = "map-layer-picker__menu map-layer-picker__grund";
		stufeReihe.setAttribute("role", "radiogroup");
		stufeReihe.hidden = true;
		huelle.insertBefore(stufeReihe, menue);

		// Ueber welcher Ansicht steht die zweite Stufe gerade? `null` heisst: sie ist zu.
		var stufeZwei = null;
		var stufeTimer = null;
		var stufeAufTimer = null;
		/**
		 * 💣 DER ZUSTAND DER ZWEITEN STUFE STEHT HIER, NICHT IN DER KLASSE -- dieselbe Regel wie
		 * `zustandOffen` beim Hauptmenue, und aus demselben Grund: `is-open` wird erst im NAECHSTEN
		 * Bild gesetzt, damit die Bewegung ueberhaupt anlaeuft. Wer sie als Zustand liest, bekommt
		 * genau in diesem Bild `false` -- zwei schnelle Mausbewegungen liessen die Reihe dann
		 * zweimal auffaechern, statt sie wandern zu lassen.
		 * ⚠️ Sie wird zusammen mit `hidden` gesetzt, nie danach.
		 */
		var stufeZweiOffen = false;
		/** Die Art der offenen Reihe: "grund" oder "ebenen" -- "" solange sie zu ist. */
		var stufeZweiArt = "";

		/**
		 * Zeichnet NUR die zugeklappte Kachel und gibt zurueck, was zeichne() fuer das Menue braucht -- `null`, wenn es
		 * keine Ansicht gibt.
		 * ⚠️ Eine eigene Funktion, weil der Beobachter der Reiterleiste bei OFFENEM Menue nur sie ruft (siehe dort).
		 */
		function zeichneKachel() {
			var aktiv = aktiveAnsicht();
			var alle = ansichten();
			var aktuelle = alle.filter(function (a) { return a.wert === aktiv; })[0] || alle[0];
			if (!aktuelle) {
				return null;
			}

			knopf.innerHTML = "";
			knopf.appendChild(zelle(aktuelle, false, false));
			// Die Namen der Ansichten kommen aus den <option> und sind damit schon uebersetzt.
			// Diese beiden Saetze sind die einzigen eigenen -- sie gehoeren in die Tabelle, nicht
			// aus Wortstuecken zusammengeklebt (AGENTS.md §8).
			var uebersetze = (typeof tr === "function")
				? tr
				: function (schluessel, vorgabe, werte) {
					return String(vorgabe).replace(/\{(\w+)\}/g, function (treffer, k) {
						return Object.prototype.hasOwnProperty.call(werte || {}, k) ? werte[k] : treffer;
					});
				};
			knopf.title = uebersetze("view.tile.title", "Ansicht: {name}", { name: aktuelle.name });
			knopf.setAttribute("aria-label",
				uebersetze("view.tile.aria", "Ansicht wählen, aktuell {name}", { name: aktuelle.name }));
			return { alle: alle, aktuelle: aktuelle };
		}

		function zeichne() {
			var stand = zeichneKachel();
			if (!stand) {
				return;
			}
			var alle = stand.alle;
			var aktuelle = stand.aktuelle;

			// 💣 DIE AKTIVE ANSICHT STEHT ZULETZT. Nur dadurch faellt sie im Raster auf den Fleck
			// der zugeklappten Kachel (beide haengen mit derselben Polsterung an derselben Ecke,
			// siehe css/components/map-layer-picker.css). Wer hier sortiert, verschiebt die Kachel
			// beim Aufklappen -- genau das, was nicht passieren darf.
			menue.innerHTML = "";
			// 💣 Die Spaltenzahl ist die ANZAHL, keine feste 6 (26.08.2026). Als CSS-Variable, nicht
			// als Inline-Style: ein Inline-Style schluege die Media Query fuer schmale Telefone, und
			// die Reihe passte dort nicht mehr hinein.
			menue.style.setProperty("--map-layer-spalten", String(alle.length));
			alle.forEach(function (a) {
				if (a.wert !== aktuelle.wert) {
					menue.appendChild(zelle(a, false, true));
				}
			});
			menue.appendChild(zelle(aktuelle, true, true));
			verdrahteStufeZwei();
		}

		/**
		 * Das Ueberfahren einer Ansicht oeffnet ihre zweite Stufe. 💣 Es wird NICHT neu gezeichnet:
		 * neue Zellen starten bei opacity 0, ein zeichne() im mouseenter liesse bei JEDER
		 * Mausbewegung die ganze Reihe samt Staffelung erneut aufblenden. Umgehaengt wird nur die
		 * Marke.
		 */
		function verdrahteStufeZwei() {
			Array.prototype.forEach.call(menue.querySelectorAll(".map-layer-picker__cell"), function (z) {
				z.addEventListener("mouseenter", function () {
					if (!amZeiger || !amZeiger.matches || stufeZwei === z.dataset.mode) {
						return;
					}
					window.clearTimeout(stufeAufTimer);
					// 🔴 DIESELBE REGEL WIE BEIM HAUPTMENUE: erst warten, dann aufklappen. Wer ueber
					// die Reihe faehrt, um zu einer anderen Ansicht zu kommen, reisst sonst jedes
					// Untermenue auf dem Weg auf.
					// ⭐ Ist die Stufe schon offen, wandert sie OHNE Warten weiter -- die Absicht ist
					// dann erklaert, und ein zweites Warten liesse die Reihe hinter der Maus
					// herhinken. oeffneStufeZwei() unterscheidet die beiden Faelle selbst.
					var verzoegerung = stufeZweiOffen ? 0 : SCHWEBE_AUF_MS;
					stufeAufTimer = window.setTimeout(function () {
						stufeZwei = z.dataset.mode;
						markiereQuelle();
						oeffneStufeZwei();
					}, verzoegerung);
				});
				// ⚠️ Wer die Zelle wieder verlaesst, bevor die Zeit um ist, wollte sie nicht --
				// ohne diese Zeile klappte das Untermenue noch auf, nachdem die Maus laengst weiter
				// ist. Genau das macht ein Menue unruhig.
				z.addEventListener("mouseleave", function () {
					window.clearTimeout(stufeAufTimer);
				});
			});
		}

		/** Haengt nur die Marke um -- ohne eine einzige Zelle neu zu bauen. */
		function markiereQuelle() {
			Array.prototype.forEach.call(menue.querySelectorAll(".map-layer-picker__cell"), function (z) {
				z.classList.toggle("is-quelle", z.dataset.mode === stufeZwei);
			});
		}

		/**
		 * Baut den Inhalt der zweiten Stufe -- nach der Art der Ansicht, ueber der sie steht (14.09.2026):
		 * ueber „Landschaften" die Ebenen, sonst die Untergruende.
		 */
		function zeichneStufeZwei() {
			var mitEbenen = stufeZweiArt === "ebenen";
			var liste = mitEbenen ? ebenen() : untergruende();
			stufeReihe.innerHTML = "";
			// ⚠️ Ohne „aktiv zuletzt": die zweite Stufe hat keine zugeklappte Kachel, auf deren Fleck
			// etwas liegen muesste -- die Regel der ersten Stufe gilt hier nicht.
			if (mitEbenen) {
				// Markiert ist eine Ebene nur, wenn die KARTE sie zeigt -- ueber einer anderen Ansicht ist
				// sie gemerkt, aber nicht gewaehlt (Mockup Karte „L").
				var gewaehlt = aktiveAnsicht() === EBENEN_ANSICHT ? aktiveEbene() : "";
				liste.forEach(function (eintrag) {
					stufeReihe.appendChild(ebenenZelle(eintrag, eintrag.wert === gewaehlt));
				});
				// Die Leiste traegt ihren Namen schon uebersetzt (data-i18n-aria-label) -- gelesen statt
				// abgeschrieben, damit er unter ?lang=en mitgeht.
				var leiste = document.getElementById("ecosystem-layer-switch");
				stufeReihe.setAttribute("aria-label", leiste ? String(leiste.getAttribute("aria-label") || "") : "");
			} else {
				var aktiv = aktiverUntergrund();
				liste.forEach(function (eintrag) {
					stufeReihe.appendChild(grundZelle(eintrag, Boolean(aktiv) && eintrag.wert === aktiv.wert));
				});
				// ⚠️ „Untergrund" steht dagegen noch FEST und bleibt unter ?lang=en deutsch. Einen Schluessel
				// bekommt es nicht in diesem Umbau -- das gehoert in die i18n-Etappe M8 (AGENTS.md §8).
				stufeReihe.setAttribute("aria-label", "Untergrund");
			}
			// 💣 Die Spaltenzahl als CSS-VARIABLE, wie beim Hauptmenue -- NICHT als Inline-Style. Der stand hier
			// bis zum 14.09.2026 und haette die Media Query fuer schmale Telefone geschlagen: fuenf Ebenen passten
			// dort nicht in eine Reihe. Wie viele Spalten es am Telefon hoechstens werden, entscheidet das CSS.
			stufeReihe.style.setProperty("--map-layer-spalten", String(liste.length));
		}

		/** Legt die Reihe ueber die Quellzelle -- und klemmt sie am Rand des Bundes. */
		function positioniereStufeZwei() {
			var quelle = menue.querySelector('.map-layer-picker__cell[data-mode="' + stufeZwei + '"]');
			if (!quelle) {
				return;
			}
			var rH = huelle.getBoundingClientRect();
			var rQ = quelle.getBoundingClientRect();
			var mitte = rQ.left + rQ.width / 2 - rH.left;
			var breite = stufeReihe.offsetWidth;
			var links = Math.max(0, Math.min(mitte - breite / 2, rH.width - breite));
			stufeReihe.style.left = Math.round(links) + "px";
			// 💣 Die Teilung beginnt an der QUELLZELLE, nicht in der Mitte der Reihe: das Untermenue
			// faehrt sichtbar aus DIESER Ansicht heraus, und genau das sagt, wozu es gehoert.
			stufeReihe.style.setProperty("--map-layer-spalt", Math.round(mitte - links) + "px");
		}

		/** Faehrt die zweite Stufe heraus -- oder laesst eine offene zur neuen Ansicht hinueberwandern. */
		function oeffneStufeZwei() {
			// Ueber dieser Ansicht liegt nichts zu waehlen. Eine noch offene Reihe gehoert dann zu einer
			// ANDEREN Ansicht und geht -- sonst stuende sie ueber einer Zelle, zu der sie nicht gehoert, und
			// ein Klick darin waehlte eine Kombination, die es nicht gibt.
			if (!hatStufeZwei(stufeZwei)) {
				schliesseStufeZwei();
				return;
			}
			window.clearTimeout(stufeTimer);
			var art = stufeZweiArtVon(stufeZwei);
			// 💣 Eine offene Reihe DERSELBEN Art wird NICHT geschlossen und neu aufgefaechert -- sie wandert.
			// Neu aufklappen sah bei jedem Zellenwechsel aus, als sei etwas kaputt.
			if (stufeZweiOffen) {
				if (art === stufeZweiArt) {
					positioniereStufeZwei();
					return;
				}
				// 🔴 WECHSELT DIE ART (Untergruende <-> Ebenen), wird neu gebaut UND neu aufgefaechert -- nur zu wandern
				// hiesse, dass mitten in der offenen Reihe der Inhalt wechselt.
				// 💣 Erst HART zu: hidden plus eine erzwungene Stilberechnung. Nur is-open zu nehmen und wieder zu setzen
				// faechert NICHT neu auf -- gemessen im Browser (14.09.2026, getAnimations, im selben Takt): danach laeuft
				// gar kein Uebergang, der Wert springt zurueck auf offen. Aus display:none heraus hat die Reihe keinen
				// Ausgangsstil, und das Aufklappen laeuft wieder volle 190 ms von der geschlossenen Kante an.
				stufeReihe.hidden = true;
				void stufeReihe.offsetWidth;
			}
			stufeZweiArt = art;
			zeichneStufeZwei();
			stufeReihe.hidden = false;
			stufeZweiOffen = true;
			stufeReihe.classList.remove("is-open");
			positioniereStufeZwei();
			window.requestAnimationFrame(function () {
				// Wer die Reihe inzwischen wieder geschlossen hat, bekommt sie nicht nachtraeglich aufgeklappt.
				if (stufeZweiOffen) {
					stufeReihe.classList.add("is-open");
				}
			});
		}

		function schliesseStufeZwei() {
			window.clearTimeout(stufeTimer);
			// 💣 Auch ein noch WARTENDES Aufklappen abraeumen -- sonst faehrt die Stufe heraus,
			// nachdem das Menue bereits zugegangen ist.
			window.clearTimeout(stufeAufTimer);
			stufeZwei = null;
			stufeZweiOffen = false;
			stufeZweiArt = "";
			markiereQuelle();
			stufeReihe.classList.remove("is-open");
			window.setTimeout(function () {
				if (!stufeZwei) {
					stufeReihe.hidden = true;
				}
			}, BLENDE_ZU_MS);
		}

		/**
		 * 💣 NICHT SOFORT SCHLIESSEN. Zwischen Ansichtsreihe und Untermenue liegt eine Luecke; wer
		 * hochfaehrt, ist fuer einen Moment ueber nichts, und ein sofortiges Schliessen naehme die
		 * Stufe weg, die der Benutzer gerade ansteuert. Zwei Riegel: die Bruecke im CSS schliesst die
		 * Luecke, dieser Nachlauf faengt alles Uebrige (seitlich vorbei, ruckende Maus). Er ist
		 * derselbe Wert wie beim Hauptmenue.
		 */
		function stufeZweiSpaeterSchliessen() {
			window.clearTimeout(stufeTimer);
			if (festgehalten) {
				return;
			}
			stufeTimer = window.setTimeout(schliesseStufeZwei, SCHWEBE_ZU_MS);
		}

		var blendeTimer = null;

		// 💣 Der Zoom ueber dem Bund haengt an dessen GEMESSENER Hoehe. Es gibt dafuer schon einen
		// ResizeObserver (watchMapScaleBandLift) -- aber der wird wie jede Bildschleife erst zum
		// naechsten Bild zugestellt, und beim Auf- und Zuklappen aendert sich die Hoehe genau JETZT.
		// Deshalb wird zusaetzlich von Hand nachgemessen: einmal zu oft messen ist harmlos, einmal
		// zu spaet laesst den Zoom auf dem Bund sitzen -- der 8-px-Fehler vom 10.08.2026.
		function misstDenBund() {
			if (typeof syncMapCornerStack === "function") {
				syncMapCornerStack();
			}
		}

		/**
		 * 💣 DER ZUSTAND IST DIESE VARIABLE -- weder `hidden` noch die Klasse `is-open` taugen dafuer,
		 * und zwar aus entgegengesetzten Gruenden: `hidden` springt erst NACH dem Zuklappen um, die
		 * Klasse erst im NAECHSTEN BILD (sonst laeuft die Bewegung gar nicht erst an).
		 * Gemessen am 15.08.2026: an der Klasse gelesen kam das Zuklappen beim Verlassen nicht
		 * zustande -- `mouseleave` fragte `offen()`, bekam `false`, weil das Bild noch nicht da war,
		 * und stieg aus. Das Menue blieb offen stehen. Derselbe Fehler und dieselbe Loesung wie beim
		 * Anzeige-Menue nebenan (js/ui/map-display-menu.js), wo er am 12.08.2026 den zweiten
		 * schnellen Klick verschluckt hat.
		 * ⚠️ Sie wird zusammen mit `menue.hidden` gesetzt, nie danach -- sonst gibt es wieder zwei
		 * Wahrheiten.
		 */
		var zustandOffen = false;

		/**
		 * 🔴 EIN KLICK HAELT DAS MENUE OFFEN, bis woanders hingeklickt wird (Owner 15.08.2026:
		 * „mouse over wie bisher, aber wenn ich draufklicke bleibts offen"). Das Ueberfahren bleibt
		 * unveraendert fluechtig: aufgeschwebt faellt es beim Verlassen wieder zu.
		 * 💣 Der Riegel gehoert an die AKTIVE ZELLE, nicht an die Kachel. Sobald das Ueberfahren
		 * geoeffnet hat, ist die Kachel `hidden` -- der Klick, den der Benutzer fuer einen Klick auf
		 * die Kachel haelt, trifft in Wahrheit die aktive Zelle, die genau auf ihrem Fleck liegt.
		 * Sie fuehrte bis hierher nach `waehle()` und damit direkt ins Zuklappen: es sah aus, als
		 * ginge das Menue vom Anklicken zu.
		 * ⚠️ Zurueckgesetzt wird an EINER Stelle, in `schliesse()` -- egal ob Auswahl, Esc oder
		 * Klick auf die Karte geschlossen hat. Ein zweiter Ruecksetzer waere die Sorte, die man beim
		 * dritten Schliessweg vergisst.
		 */
		var festgehalten = false;

		function offen() {
			return zustandOffen;
		}

		function schliesse(fokusZurueck) {
			if (!zustandOffen) {
				if (fokusZurueck) { knopf.focus(); }
				return;
			}
			zustandOffen = false;
			festgehalten = false;
			// Mit dem Menue geht auch die zweite Stufe -- sie kann ohne die Ansichtsreihe nicht
			// bestehen, denn sie haengt an einer ihrer Zellen.
			schliesseStufeZwei();
			menue.classList.remove("is-open");
			knopf.setAttribute("aria-expanded", "false");
			// 💣 Die Kachel kommt erst NACH der Blende zurueck. Waeren beide gleichzeitig im Fluss,
			// waere der Bund fuer die Dauer der Blende doppelt hoch -- am Telefon ein sichtbarer
			// Sprung des Suchknopfes darueber, genau der Ruck, den das Ganze vermeiden soll.
			window.clearTimeout(blendeTimer);
			blendeTimer = window.setTimeout(function () {
				menue.hidden = true;
				knopf.hidden = false;
				misstDenBund();
				if (fokusZurueck) { knopf.focus(); }
			}, BLENDE_ZU_MS);
		}

		function oeffne(mitFokus) {
			window.clearTimeout(blendeTimer);
			zeichne();
			zustandOffen = true;
			menue.hidden = false;
			knopf.hidden = true;
			knopf.setAttribute("aria-expanded", "true");
			// ⚠️ Erst im naechsten Bild anblenden: im selben Durchlauf gesetzt, sieht der Browser
			// keinen Uebergang und das Raster spraenge ohne Blende ins Bild.
			misstDenBund();
			window.requestAnimationFrame(function () {
				menue.classList.add("is-open");
			});
			// 💣 Beim Ueberfahren wird NICHT fokussiert. Ein Fokus ohne Zutun springt mit der Seite
			// zum Element und nimmt der Tastatur ihre Stelle -- wer gerade tippt, verliert sie an ein
			// Menue, das er nur gestreift hat. Nur Klick und Tastatur fokussieren.
			if (!mitFokus) {
				return;
			}
			var aktiv = menue.querySelector(".map-layer-picker__cell.is-active");
			if (aktiv) {
				aktiv.focus();
			}
		}

		/**
		 * Ein Klick auf einen UNTERGRUND waehlt beides zugleich -- die Ansicht, aus der die zweite
		 * Stufe herausgefahren ist, und den Untergrund selbst. Das ist der eigentliche Gewinn der
		 * zweistufigen Form: eine Bewegung fuer eine Kombination.
		 * 🔴 Und danach geht es zu. Eine getroffene Auswahl schliesst das Menue -- offen
		 * stehenzubleiben hiesse: die Auswahl ist getroffen, aber das Menue verdeckt die Karte, an
		 * der man sie gerade pruefen will.
		 */
		function waehleGrund(wert) {
			schwebeGesperrt = true;
			var ansichtDazu = stufeZwei;
			if (grundSelect && wert && grundSelect.value !== wert) {
				// 💣 DERSELBE WEG WIE DIE AUSWAHLBOX, kein zweiter -- ihr change-Handler ruft
				// setMapStyle samt Merken der Handwahl (vergissBasisVorOriginal). Ein eigenes
				// setMapStyle hier umginge genau das und liesse die Ansicht den Untergrund wieder
				// ueberschreiben.
				grundSelect.value = wert;
				grundSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
			if (ansichtDazu && ansichtDazu !== aktiveAnsicht()) {
				select.value = ansichtDazu;
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
			schliesse();
		}

		/**
		 * Ein Klick auf eine EBENE waehlt beides zugleich -- die Landschaften und die Ebene. Dieselbe
		 * Bewegung wie beim Untergrund: eine Wahl fuer eine Kombination, danach geht das Menue zu.
		 *
		 * 🔴 ERST DIE ANSICHT, DANN DER REITER -- die Reihenfolge ist nachgelesen, nicht geschmacklich:
		 *  - Der Klick-Zuhoerer der Reiterleiste wird NICHT beim Laden der Datei gebunden, sondern in
		 *    syncEcosystemControlsVisibility (bindEcosystemLayerSwitch), und die laeuft ueber
		 *    setSelectedMapLayerMode -> syncEcosystemVisibility, also beim Moduswechsel. Erst das <select>,
		 *    dann trifft der Reiterklick auf einen gebundenen Zuhoerer.
		 *    Gemessen am 14.09.2026 (lokal, als Besucher): auf einer frisch geladenen Seite in „Standard"
		 *    aendert ein Reiterklick nichts -- in umgekehrter Reihenfolge klickte der Faecher dort ins Leere.
		 *  - Das Betreten der Landschaften setzt die Ebene NICHT zurueck: syncEcosystemLayerSwitchControls
		 *    stempelt nur, was schon gilt, und keiner der Moduswege setzt Ebene oder „Alle". Der Reiterklick
		 *    danach gewinnt also.
		 * 💣 Beide Schritte gehen den Weg ihres Bedienelements -- das <select> und der Reiter. Kein eigener
		 * Aufruf daneben.
		 */
		function waehleEbeneAusStufe(wert) {
			schwebeGesperrt = true;
			if (aktiveAnsicht() !== EBENEN_ANSICHT) {
				select.value = EBENEN_ANSICHT;
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
			waehleEbene(wert);
			schliesse();
		}

		function waehle(modus) {
			// Nach einer Auswahl steht der Zeiger noch ueber dem Bund. Ohne diesen Riegel klappte
			// das Menue sofort wieder auf -- er faellt erst, wenn der Zeiger die Huelle verlaesst.
			schwebeGesperrt = true;
			// 🔴 EIN KLICK AUF EINE ANSICHT HAELT IHRE ZWEITE STUFE OFFEN -- er waehlt sie NICHT
			// sofort. Erst der zweite Klick auf dieselbe Ansicht waehlt sie allein, mit dem
			// eingestellten Untergrund.
			// ⭐ Daraus faellt das Telefon-Verhalten ab: ohne Ueberfahren ist die zweite Stufe zu,
			// also OEFFNET der erste Tipp und der zweite waehlt -- dasselbe Modell wie am Zeiger,
			// kein zweiter Bedienweg.
			if (modus && modus !== stufeZwei && hatStufeZwei(modus)) {
				festgehalten = true;
				stufeZwei = modus;
				markiereQuelle();
				oeffneStufeZwei();
				return;
			}
			if (!modus || modus === aktiveAnsicht()) {
				// Die eingestellte Ansicht noch einmal zu waehlen aendert nichts -- dieser Klick ist
				// deshalb der HALTE-Klick (siehe `festgehalten`). Ein zweiter auf dieselbe Stelle
				// loest wieder: sonst gaebe es keinen Weg, dort zuzuklappen, wo man aufgeklappt hat.
				if (festgehalten) {
					schliesse();
				} else {
					festgehalten = true;
				}
				return;
			}
			// 💣 DERSELBE WEG WIE DIE AUSWAHLBOX, kein zweiter. Der change-Handler in
			// js/map-features/map-features.js ruft setSelectedMapLayerMode, die Modus-Vorgaben und
			// das Wegschreiben in die Adresszeile -- alles drei wuerde eine eigene Zeile hier
			// halb vergessen.
			select.value = modus;
			select.dispatchEvent(new Event("change", { bubbles: true }));
			schliesse();
		}

		knopf.addEventListener("click", function (ereignis) {
			ereignis.stopPropagation();
			// ⚠️ Am Zeiger ist das der SELTENE Weg: wer schneller klickt als die 140 ms des
			// Ueberfahrens. Danach ist die Kachel `hidden` und der Klick landet auf der aktiven
			// Zelle (`waehle`). Am Finger und an der Tastatur ist es dagegen der einzige Weg --
			// deshalb haelt er genauso fest.
			oeffne(true);
			festgehalten = true;
		});

		/*
		 * 🔴 DIESER BLOCK STAND DREI TAGE IM REPO UND NICHT AUF DEM SERVER (11c49f99, 12.08.2026).
		 * Gemessen am 15.08.2026: die live ausgelieferte Datei war Zeile fuer Zeile die Fassung von
		 * 4eba13f1 -- alles bis hierher, kein Zeichen davon. Die index.html forderte dabei laengst
		 * den NEUEN Stempel `?v=cf7a6361c1` an; hinter dieser Adresse lag der ALTE Inhalt, und jeder
		 * Browser cachte genau den. Ursache: am 12.08.2026 fielen fuenf Deploys hintereinander an
		 * einem FREMDEN Test, und der naechste gruene Lauf trug den neuen Hash ins HTML, ohne die
		 * Datei mitzunehmen (AGENTS.md §9).
		 * 💣 Ein Voll-Deploy heilt das NICHT -- er legt die richtige Datei unter dieselbe, laengst
		 * vergiftete Adresse. Nur eine INHALTSAENDERUNG heilt: neuer Hash, neue Adresse. Dieser
		 * Absatz IST sie.
		 * ⚠️ Der Befund las sich wie ein Code-Fehler („Ueberfahren tut nichts") und war keiner. Wer
		 * hier das naechste Mal sucht, vergleicht ZUERST das Ausgelieferte mit dem Repo:
		 *   curl -s https://avesmaps.de/js/ui/map-layer-picker.js | grep -c mouseenter
	
		 *
		 * 💣 UND ES IST AM SELBEN TAG EIN ZWEITES MAL PASSIERT, mit derselben Datei. Der Commit
		 * caa76799 (schneller aufklappen, Klick haelt fest) ging raus, sein Deploy fiel an einem
		 * FREMDEN Test aus (tools/wikidump/test-dump-reader.php, dessen geteilte Fixture eine Seite
		 * mehr bekommen hatte), und der naechste gruene Lauf trug die neuen Stempel ins HTML, ohne
		 * die Dateien mitzunehmen -- gemessen: `?v=f1d7b45f3e` angefordert, alte Fassung geliefert.
		 * ⚠️ Die Lehre ist keine Ermahnung, sondern eine Reihenfolge: nach jedem Push den LAUF
		 * pruefen (success, nicht bloss gelaufen), und bei rot NICHT auf den naechsten hoffen -- der
		 * macht es schlimmer. Erst den roten Test heilen, dann diese Datei anfassen.
		 */
		/*
		 * Am Zeiger klappt die Kachel schon beim Ueberfahren auf (Owner 12.08.2026).
		 *
		 * 🔴 NUR am Zeiger, und die Bedingung ist `hover: hover` UND `pointer: fine`. Ein
		 * Touchgeraet meldet beim Tippen oft ein synthetisches Hover: das Menue ginge beim ersten
		 * Antippen auf und der Klick liefe gleich in die Zelle darunter, die dann zufaellig dort
		 * liegt. `pointer: fine` allein reicht nicht (Stift), `hover: hover` allein auch nicht.
		 *
		 * 💣 Drei Kleinigkeiten, ohne die es nervt statt hilft:
		 *  - eine kurze Verzoegerung vor dem Aufklappen, sonst geht es auf, wenn man mit der Maus
		 *    nur zum Zoom oder zu „Hinweise" hinueberfaehrt;
		 *  - eine laengere Gnadenfrist beim Verlassen, sonst faellt es zu, waehrend man von der
		 *    Kachel zur zweiten Rasterzeile zieht;
		 *  - nach einer Auswahl ein RIEGEL bis zum Verlassen: der Zeiger steht danach noch ueber
		 *    dem Bund, und ohne den Riegel klappte das Menue sofort wieder auf.
		 */
		var amZeiger = window.matchMedia
			? window.matchMedia("(hover: hover) and (pointer: fine)")
			: null;
		var schwebeTimer = null;
		var schwebeGesperrt = false;

		function schwebenErlaubt() {
			return Boolean(amZeiger && amZeiger.matches) && !schwebeGesperrt;
		}

		huelle.addEventListener("mouseenter", function () {
			window.clearTimeout(schwebeTimer);
			if (!schwebenErlaubt() || offen()) {
				return;
			}
			schwebeTimer = window.setTimeout(function () {
				if (schwebenErlaubt() && !offen()) { oeffne(false); }
			}, SCHWEBE_AUF_MS);
		});

		huelle.addEventListener("mouseleave", function () {
			window.clearTimeout(schwebeTimer);
			schwebeGesperrt = false;   // der Riegel gilt nur, solange der Zeiger draufsteht
			// 🔴 Festgehalten heisst festgehalten: ein angeklicktes Menue ueberlebt das Verlassen
			// und wartet auf den Klick woanders hin (Owner 15.08.2026).
			if (festgehalten) {
				return;
			}
			if (!Boolean(amZeiger && amZeiger.matches) || !offen()) {
				return;
			}
			schwebeTimer = window.setTimeout(function () {
				if (offen()) { schliesse(); }
			}, SCHWEBE_ZU_MS);
		});

		menue.addEventListener("click", function (ereignis) {
			var ziel = ereignis.target.closest(".map-layer-picker__cell");
			if (!ziel || ziel.disabled) {
				return;
			}
			ereignis.stopPropagation();
			waehle(ziel.dataset.mode);
		});

		stufeReihe.addEventListener("click", function (ereignis) {
			var ziel = ereignis.target.closest(".map-layer-picker__cell");
			if (!ziel || ziel.disabled) {
				return;
			}
			ereignis.stopPropagation();
			if (ziel.dataset.ebene) {
				waehleEbeneAusStufe(ziel.dataset.ebene);
				return;
			}
			waehleGrund(ziel.dataset.grund);
		});

		// 💣 Die zweite Stufe faellt weg, sobald der Zeiger die Ansichtsreihe verlaesst -- ausser er
		// geht nach oben in sie hinein. Der Nachlauf (stufeZweiSpaeterSchliessen) und die Bruecke im
		// CSS tragen zusammen den Weg ueber die Luecke.
		menue.addEventListener("mouseleave", function (ereignis) {
			if (stufeReihe.contains(ereignis.relatedTarget)) {
				return;
			}
			stufeZweiSpaeterSchliessen();
		});
		menue.addEventListener("mouseenter", function () {
			window.clearTimeout(stufeTimer);
		});
		stufeReihe.addEventListener("mouseenter", function () {
			window.clearTimeout(stufeTimer);
			window.clearTimeout(schwebeTimer);
		});
		stufeReihe.addEventListener("mouseleave", function (ereignis) {
			if (menue.contains(ereignis.relatedTarget)) {
				return;
			}
			stufeZweiSpaeterSchliessen();
		});

		// Pfeiltasten wandern durch die Zellen -- eine Einfachauswahl bedient man so.
		menue.addEventListener("keydown", function (ereignis) {
			var tasten = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
			if (tasten.indexOf(ereignis.key) < 0) {
				return;
			}
			var zellen = Array.prototype.slice.call(menue.querySelectorAll(".map-layer-picker__cell:not([disabled])"));
			var jetzt = zellen.indexOf(document.activeElement);
			if (jetzt < 0) {
				return;
			}
			ereignis.preventDefault();
			var schritt = (ereignis.key === "ArrowRight" || ereignis.key === "ArrowDown") ? 1 : -1;
			var naechste = zellen[(jetzt + schritt + zellen.length) % zellen.length];
			if (naechste) {
				naechste.focus();
			}
		});

		document.addEventListener("keydown", function (ereignis) {
			if (ereignis.key === "Escape" && offen()) {
				schliesse(true);
			}
		});

		document.addEventListener("click", function () {
			if (offen()) {
				schliesse();
			}
		});

		// 💣 Ein Moduswechsel kommt auch von woanders: Tastenkuerzel (O P K N L I), geteilter Link,
		// Auswahlbox. Es gibt dafuer KEIN Ereignis -- setSelectedMapLayerMode setzt den Wert mit
		// jQuery .val(), und das feuert nichts. Beobachtet wird deshalb die Beschriftung der
		// Auswahlbox: syncTransportControl schreibt sie bei JEDEM Wechsel neu. Kein zweiter Zustand,
		// nur ein Zuhoerer an der Stelle, die sich ohnehin aendert.
		// 💣 UND DER UNTERGRUND BRAUCHT DENSELBEN ZUHOERER (26.08.2026). Der Beobachter unten horcht
		// auf die Beschriftung der ANSICHTS-Auswahlbox -- ein reiner Untergrundwechsel aendert die
		// nicht. Die zugeklappte Kachel behielt dadurch ihr altes Bild UND ihre alte zweite Zeile:
		// wer von „Kraftlinien" auf „Standard · Original" wechselte, sah weiter Kraftlinien.
		// Gemeldet als „standard auf original funktioniert nicht -- da kommen kraftlinien".
		// ⚠️ Am <select> und nicht in waehleGrund(): der Untergrund wechselt auch ueber das
		// Anzeige-Menue des Editors und ueber setMapStyle. Ein Ruf nur im Kachel-Weg liesse genau
		// die anderen Wege wieder danebenlaufen -- dieselbe Lehre wie bei den vier Erzeugern der
		// Querfeldein-Kanten (AGENTS.md §11).
		if (grundSelect) {
			grundSelect.addEventListener("change", function () {
				zeichne();
			});
		}

		var beschriftung = document.getElementById("mapLayerModeLabel");
		if (beschriftung && typeof MutationObserver === "function") {
			new MutationObserver(function () {
				zeichne();
			}).observe(beschriftung, { childList: true, characterData: true, subtree: true });
		}

		// 💣 UND DIE EBENE BRAUCHT IHREN EIGENEN ZUHOERER (14.09.2026) -- derselbe Fehler wie beim Untergrund am
		// 26.08.2026, eine Etage tiefer: ein reiner Ebenenwechsel aendert die Beschriftung der Ansichts-Auswahlbox nicht,
		// und die Kachel behielte Namen und Bild der alten Ebene.
		// ⚠️ Beobachtet wird die LEISTE, nicht der Klick im Faecher: die Ebene wechselt auch ueber die Reiter selbst, ihre
		// Pfeiltasten und den Klick auf eine Flaeche einer anderen Ebene (setActiveEcosystemLayerKind). Alle Wege enden in
		// syncEcosystemLayerSwitchControls, und das stempelt `aria-selected` -- genau das, was aktiveEbene() liest. Kein
		// zweiter Zustand, nur ein Zuhoerer an der Stelle, die sich ohnehin aendert.
		// 💣 BEI OFFENEM MENUE NUR DIE KACHEL. zeichne() baut die Zellen der ersten Stufe neu, auch die unter dem Zeiger.
		// Der Faecher-Klick selbst trifft das nie -- sein Zuhoerer schliesst das Menue, bevor der Beobachter am Ende der
		// Aufgabe zu Wort kommt --, ein Wechsel ueber die Leiste bei offenem Menue schon. Das Menue holt den neuen Stand
		// beim naechsten Oeffnen nach: oeffne() zeichnet ohnehin neu.
		var ebenenLeiste = document.getElementById("ecosystem-layer-switch");
		if (ebenenLeiste && typeof MutationObserver === "function") {
			new MutationObserver(function () {
				if (offen()) {
					zeichneKachel();
					return;
				}
				zeichne();
			}).observe(ebenenLeiste, { attributes: true, attributeFilter: ["aria-selected"], subtree: true });
		}

		// Die Zeile „Derographie" im Routenplaner geht weg -- ein Bedienelement fuer eine Sache.
		// 💣 Nur die ZEILE. Das <select> bleibt im DOM: es IST der Zustand, den
		// getSelectedMapLayerMode liest und ueber den der geteilte Link ankommt.
		var zeile = select.closest(".display-options__select-row");
		if (zeile) {
			zeile.hidden = true;
		}

		zeichne();
		schliesse();
		huelle.hidden = false;

		// Der Knopfbund ist um eine Zeile gewachsen; der Zoom darueber liest seine GEMESSENE Hoehe.
		if (typeof syncMapCornerStack === "function") {
			syncMapCornerStack();
		}
	}

	if (abgeschaltet()) {
		return;
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
