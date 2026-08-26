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

		// 🔴 VIER FLAECHENARTEN, jede in ihrer echten Farbe (Owner 26.08.2026: "gruen fuer wald, blau
		// fuer see, braun fuer gebirge"):
		//   Wald      --color-ecosystem-vegetation-wald      #3f6b2c
		//   Grasland  --color-ecosystem-vegetation           #5f7d33
		//   Steppe    --color-ecosystem-vegetation-steppe    #a8bd8a
		//   See       --color-ecosystem-topographie-see      #4a86b8
		//   Gebirge   --color-ecosystem-topographie-gebirge  #7a6c5e
		//   Huegel    --color-ecosystem-topographie-huegelland #7d8f6e
		// ⚠️ Die Waldflecken liegen dort, wo die Vorlagekachel ihre Waelder hat, und der See auf ihrem
		// Flusslauf -- dieselbe Regel wie bei den Strassen: nachgezeichnet, nicht danebengelegt.
		// 💣 Ausgefranste Raender, keine Baender: so liegen die Flaechen auf der Karte.
		ecosystem:
			'<path d="M0 22 C7 17 12 23 18 19 26 14 33 20 40 15 44 12 46 16 48 14 V30 C43 33 38 27 31 31 24 35 18 29 11 33 6 36 3 31 0 34 Z" fill="#5f7d33" fill-opacity=".8"/>' +
			'<path d="M0 34 C3 31 6 36 11 33 18 29 24 35 31 31 38 27 43 33 48 30 V40 C42 43 37 38 30 41 23 44 17 39 10 42 5 44 3 41 0 43 Z" fill="#a8bd8a" fill-opacity=".78"/>' +
			'<g fill="#3f6b2c" fill-opacity=".85">' +
			'<path d="M2 3 C6 0 11 1 13 4 15 8 11 11 7 10 3 9 0 6 2 3 Z"/>' +
			'<path d="M30 2 C35 0 40 2 41 6 42 10 37 12 33 10 29 8 27 4 30 2 Z"/>' +
			'<path d="M36 20 C41 18 46 21 46 25 46 29 41 30 38 27 35 25 33 22 36 20 Z"/>' +
			'<path d="M13 24 C17 22 21 24 21 27 21 30 17 31 15 29 12 27 11 25 13 24 Z"/>' +
			'<path d="M22 41 C27 39 32 41 32 45 32 48 27 48 24 47 21 45 20 42 22 41 Z"/></g>' +
			'<g fill="#7a6c5e" fill-opacity=".8">' +
			'<path d="M0 44 C4 40 8 45 13 42 18 39 22 44 26 42 L28 48 H0 Z"/></g>' +
			'<path d="M40 44 C43 41 46 44 48 42 V48 H38 Z" fill="#7d8f6e" fill-opacity=".78"/>' +
			'<g fill="#4a86b8" fill-opacity=".85">' +
			'<path d="M0 13 C6 12 10 15 16 15 24 15 32 17 48 18 V21 C32 20 24 18 16 18 10 18 6 16 0 16 Z"/>' +
			'<ellipse cx="20" cy="6" rx="3.4" ry="2"/><ellipse cx="27" cy="9" rx="2.6" ry="1.6"/></g>',

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

	// 🔴 Die Landschaften-Ansicht BLENDET den Untergrund ab (Owner 26.08.2026). Der echte Wert fuer
	// Besucher ist ECOSYSTEM_UNDERGROUND_FRONTEND = 25 (%), nicht 50 -- Editoren haben dafuer einen
	// Regler. Ausgeblendet wird gegen --color-ecosystem-underground (#d3cec2), NICHT gegen Weiss:
	// deshalb steht hinter dem Bild eine Flaeche in genau diesem Ton, sonst schiene das Panel durch
	// und der Farbeindruck waere ein anderer als auf der Karte.
	const GRUND_DECKKRAFT = {
		ecosystem: 0.25
	};

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
		// ⚠️ Abblenden heisst: auf den Ausblendton der Ebene durchscheinen lassen, nicht auf das
		// Panel -- sonst saehe die Kachel heller aus als die Karte, die sie ankuendigt.
		if (GRUND_DECKKRAFT[ansicht.wert]) {
			bild.style.opacity = String(GRUND_DECKKRAFT[ansicht.wert]);
			huelle.style.background = "var(--color-ecosystem-underground)";
		}
		huelle.appendChild(bild);
		if (OVERLAYS[ansicht.wert]) {
			var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 48 48");
			svg.setAttribute("class", "map-layer-picker__vektor");
			svg.setAttribute("aria-hidden", "true");
			svg.innerHTML = OVERLAYS[ansicht.wert];
			huelle.appendChild(svg);
		}

		var name = document.createElement("span");
		name.className = "map-layer-picker__label";
		name.textContent = ansicht.name;

		knopf.appendChild(huelle);
		knopf.appendChild(name);

		// 🔴 DIE ZWEITE ZEILE -- der Untergrund unter dem Ansichtsnamen (26.08.2026).
		// „Standard · Modern" passt NIE in eine Zeile: die Zelle ist 66px breit, gebunden an das
		// laengste Ansichtswort. Deshalb zwei Zeilen statt eines Kuerzels.
		// 💣 Sie bekommen ALLE Zellen, gefuellt nur die aktive -- nur so sind Kachel und aktive
		// Zelle gleich hoch, und nur dann faellt die Kachel beim Aufklappen auf ihren eigenen Fleck.
		// Steht die Zeile nur an der Kachel, springt das Menue um ihre Hoehe.
		// ⚠️ Sichtbar ist sie im offenen Menue ohnehin keine: das CSS blendet sie dort aus, weil man
		// den Untergrund dann in der zweiten Stufe waehlt und die Auskunft veraltet waere.
		var zweite = document.createElement("span");
		zweite.className = "map-layer-picker__label map-layer-picker__label--grund";
		var grund = istAktiv || !imMenue ? aktiverUntergrund() : null;
		zweite.textContent = grund ? grund.name : "";
		if (!zweite.textContent) {
			zweite.textContent = " ";
		}
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
		 * DIE ZWEITE STUFE -- die Untergrund-Reihe (26.08.2026, Entwurf:
		 * docs/superpowers/specs/2026-08-26-ansicht-untergrund-kreuzen-design.md).
		 *
		 * ⚠️ Sie wird HIER erzeugt und steht nicht im Markup: index.html ist eine vielbefahrene
		 * Datei, und der Picker baut seinen Inhalt ohnehin selbst. Ein Element mehr im Markup waere
		 * ein Stueck Zustand, das zwei Dateien teilen muessten.
		 */
		var grundReihe = document.createElement("div");
		grundReihe.className = "map-layer-picker__menu map-layer-picker__grund";
		grundReihe.setAttribute("role", "radiogroup");
		grundReihe.setAttribute("aria-label", "Untergrund");
		grundReihe.hidden = true;
		huelle.insertBefore(grundReihe, menue);

		// Welche Ansicht zeigt gerade ihre Untergruende? `null` heisst: die zweite Stufe ist zu.
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

		function zeichne() {
			var aktiv = aktiveAnsicht();
			var alle = ansichten();
			var aktuelle = alle.filter(function (a) { return a.wert === aktiv; })[0] || alle[0];
			if (!aktuelle) {
				return;
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
		 * Das Ueberfahren einer Ansicht oeffnet ihre Untergruende. 💣 Es wird NICHT neu gezeichnet:
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

		function zeichneGrundReihe() {
			var liste = untergruende();
			var aktiv = aktiverUntergrund();
			grundReihe.innerHTML = "";
			// ⚠️ Ohne „aktiv zuletzt": die zweite Stufe hat keine zugeklappte Kachel, auf deren Fleck
			// etwas liegen muesste -- die Regel der ersten Stufe gilt hier nicht.
			liste.forEach(function (eintrag) {
				grundReihe.appendChild(grundZelle(eintrag, Boolean(aktiv) && eintrag.wert === aktiv.wert));
			});
			grundReihe.style.gridTemplateColumns = "repeat(" + liste.length + ", auto)";
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
			var breite = grundReihe.offsetWidth;
			var links = Math.max(0, Math.min(mitte - breite / 2, rH.width - breite));
			grundReihe.style.left = Math.round(links) + "px";
			// 💣 Die Teilung beginnt an der QUELLZELLE, nicht in der Mitte der Reihe: das Untermenue
			// faehrt sichtbar aus DIESER Ansicht heraus, und genau das sagt, wozu es gehoert.
			grundReihe.style.setProperty("--map-layer-spalt", Math.round(mitte - links) + "px");
		}

		/** Faehrt die zweite Stufe heraus -- oder laesst eine offene zur neuen Ansicht hinueberwandern. */
		function oeffneStufeZwei() {
			if (!stufeZwei || untergruende().length < 2) {
				return;
			}
			window.clearTimeout(stufeTimer);
			// 💣 Eine bereits offene Reihe wird NICHT geschlossen und neu aufgefaechert -- sie wandert.
			// Neu aufklappen sah bei jedem Zellenwechsel aus, als sei etwas kaputt.
			if (stufeZweiOffen) {
				positioniereStufeZwei();
				return;
			}
			zeichneGrundReihe();
			grundReihe.hidden = false;
			stufeZweiOffen = true;
			grundReihe.classList.remove("is-open");
			positioniereStufeZwei();
			window.requestAnimationFrame(function () {
				grundReihe.classList.add("is-open");
			});
		}

		function schliesseStufeZwei() {
			window.clearTimeout(stufeTimer);
			// 💣 Auch ein noch WARTENDES Aufklappen abraeumen -- sonst faehrt die Stufe heraus,
			// nachdem das Menue bereits zugegangen ist.
			window.clearTimeout(stufeAufTimer);
			stufeZwei = null;
			stufeZweiOffen = false;
			markiereQuelle();
			grundReihe.classList.remove("is-open");
			window.setTimeout(function () {
				if (!stufeZwei) {
					grundReihe.hidden = true;
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
			if (modus && modus !== stufeZwei && untergruende().length > 1) {
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

		grundReihe.addEventListener("click", function (ereignis) {
			var ziel = ereignis.target.closest(".map-layer-picker__cell");
			if (!ziel || ziel.disabled) {
				return;
			}
			ereignis.stopPropagation();
			waehleGrund(ziel.dataset.grund);
		});

		// 💣 Die zweite Stufe faellt weg, sobald der Zeiger die Ansichtsreihe verlaesst -- ausser er
		// geht nach oben in sie hinein. Der Nachlauf (stufeZweiSpaeterSchliessen) und die Bruecke im
		// CSS tragen zusammen den Weg ueber die Luecke.
		menue.addEventListener("mouseleave", function (ereignis) {
			if (grundReihe.contains(ereignis.relatedTarget)) {
				return;
			}
			stufeZweiSpaeterSchliessen();
		});
		menue.addEventListener("mouseenter", function () {
			window.clearTimeout(stufeTimer);
		});
		grundReihe.addEventListener("mouseenter", function () {
			window.clearTimeout(stufeTimer);
			window.clearTimeout(schwebeTimer);
		});
		grundReihe.addEventListener("mouseleave", function (ereignis) {
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
