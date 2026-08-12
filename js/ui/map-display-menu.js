/*
 * Das Anzeige-Menue (Auge) in der Kartenecke -- was auf der Karte zu sehen ist.
 * Entwurf: docs/superpowers/specs/2026-08-12-anzeige-menue-design.md
 *
 * 💣 Diese Datei lag am 12.08.2026 mit HTTP 404 auf dem Server, waehrend index.html sie schon
 * anforderte -- das Menue stand also da und tat NICHTS. Ursache: fuenf Deploys scheiterten an
 * einem roten Test, und der naechste gruene Lauf hielt die Datei fuer bereits hochgeladen.
 * Geheilt hat das nur eine INHALTSAENDERUNG; dieser Absatz ist sie.
 *
 * 💣 Diese Datei bedient das Menue, sie besitzt die Schalter NICHT. Die Ortsklassen und die
 * Ebenen-Haken sind aus dem Routenplaner UMGEZOGEN und behalten ihre IDs; ihre Verdrahtung
 * (map-features.js, display-mode.js, die URL-Persistenz) laeuft unveraendert weiter. Wer hier
 * anfaengt, Sichtbarkeit selbst zu setzen, baut den zweiten Zustand, den der Umzug vermeidet.
 */
(function initMapDisplayMenu() {
	"use strict";

	/**
	 * 💣 EINE TABELLE, VOLLSTAENDIG -- alle sechs Ansichten, auch die mit leerem Eintrag.
	 * „Hier ist nichts gesperrt" ist eine Aussage, kein Weglassen. Genau dieser Unterschied liess
	 * FRONTEND_LAYER_MODE_DEFAULTS bis zum 05.08.2026 zwei Ansichten die Lage ihres VORGAENGERS
	 * erben: dieselbe Ansicht sah verschieden aus, je nachdem woher man kam.
	 *
	 * Ein Eintrag heisst: dieser Schalter kann in dieser Ansicht NICHTS bewirken. Er wird dann
	 * ausgegraut und nennt den Grund -- statt sich umlegen zu lassen und sichtbar nichts zu tun.
	 * Die Gruende stehen im Code und sind NICHT Teil dieses Menues:
	 *   • Grenzen -- TERRITORY_BOUNDARY_MODES (map-features-political-territory-loader.js:18) laedt
	 *     die Territoriumsdaten nur in political/deregraphic/ecosystem. Anderswo haette der
	 *     Zeichner nichts zu zeichnen.
	 *   • Kraftlinien -- shouldShowPathOnMap steigt fuer "powerlines" VOR jeder Haken-Pruefung aus
	 *     („Magiersicht"), und shouldShowLocationMarker zeigt dort nur Nodices.
	 */
	var GESPERRT = {
		none:        { toggleTerritoryBorders: "borders" },
		original:    { toggleTerritoryBorders: "borders" },
		deregraphic: {},
		political:   {},
		powerlines:  {
			togglePaths: "powerlines",
			toggleRivers: "powerlines",
			// ⚠️ Seewege gehoeren dazu: sie sind Pfade, und shouldShowPathOnMap steigt fuer
			// "powerlines" VOR der Unterscheidung nach Wegart aus. Sie fehlten hier zunaechst,
			// weil sie erst mit dem Editor-Teil ins Menue kamen -- genau die Sorte Luecke, gegen
			// die eine vollstaendige Tabelle steht.
			toggleSeaPaths: "powerlines",
			toggleTerritoryBorders: "powerlines",
			orte: "powerlines"
		},
		ecosystem:   {}
	};

	/** Die Begruendungen. Sie stehen im Titel der gesperrten Zeile -- ein Riegel ohne Grund liest
	 *  sich wie ein Fehler. */
	var GRUND = {
		borders: ["display.disabled.borders", "In dieser Ansicht sind keine Gebietsgrenzen geladen."],
		powerlines: ["display.disabled.powerlines", "Die Kraftlinien-Ansicht zeigt nur Nodices und Kraftlinien."]
	};

	function uebersetze(schluessel, vorgabe) {
		return (typeof tr === "function") ? tr(schluessel, vorgabe) : vorgabe;
	}

	function start() {
		var knopf = document.getElementById("map-display-button");
		var menue = document.getElementById("map-display-menu");
		if (!knopf || !menue) {
			return;
		}

		var blendeTimer = null;
		/**
		 * 💣 DER ZUSTAND IST DIESE VARIABLE, nicht `menue.hidden` und nicht die Klasse.
		 * `hidden` springt erst NACH der 120-ms-Blende um: wer in dieser Zeitspanne ein zweites
		 * Mal klickt -- und das ist bei einem Knopf, der auf- und zuklappt, der Normalfall --
		 * bekaeme sonst das Gegenteil dessen, was er will (gemessen 12.08.2026: Klick 2 schloss,
		 * Klick 3 oeffnete nicht mehr). Die Klasse `is-open` taugt aus dem Gegengrund nicht: sie
		 * wird erst im naechsten Bild gesetzt, damit die Blende ueberhaupt laeuft.
		 */
		var zustandOffen = false;

		function offen() {
			return zustandOffen;
		}

		/**
		 * Der Zoom ueber dem Bund haengt an dessen GEMESSENER Hoehe.
		 * ⚠️ Seit das Menue schwebt (Owner 12.08.2026), aendert das Auf- und Zuklappen die Bundhoehe
		 * nicht mehr -- dieser Aufruf ist damit meist folgenlos. Er bleibt trotzdem: der Bund
		 * enthaelt weiter Elemente, die ihre Hoehe aendern koennen (Ansichts-Menue, Sprache,
		 * Umbruch der Verweiszeile), und einmal zu oft messen ist harmlos. Einmal zu spaet laesst
		 * den Zoom auf dem Bund sitzen -- der 8-px-Fehler vom 10.08.2026.
		 */
		function misstDenBund() {
			if (typeof syncMapCornerStack === "function") {
				syncMapCornerStack();
			}
		}

		function oeffne() {
			window.clearTimeout(blendeTimer);
			zustandOffen = true;
			menue.hidden = false;
			knopf.setAttribute("aria-expanded", "true");
			misstDenBund();
			// ⚠️ Erst im naechsten Bild anblenden: im selben Durchlauf gesetzt, sieht der Browser
			// keinen Uebergang und das Menue spraenge ohne Blende ins Bild.
			// ⚠️ ZWEI Ausloeser, absichtlich: requestAnimationFrame feuert in einem verborgenen
			// Tab gar nicht, und das Menue bliebe dann bei opacity 0 stehen -- sichtbar im DOM,
			// unsichtbar auf dem Schirm. Die Klasse zu setzen ist idempotent, der zweite Ausloeser
			// im Normalfall also folgenlos.
			window.requestAnimationFrame(function () {
				menue.classList.add("is-open");
			});
			window.setTimeout(function () {
				menue.classList.add("is-open");
			}, 0);
		}

		function schliesse(fokusZurueck) {
			if (!zustandOffen) {
				if (fokusZurueck) { knopf.focus(); }
				return;
			}
			zustandOffen = false;
			menue.classList.remove("is-open");
			knopf.setAttribute("aria-expanded", "false");
			window.clearTimeout(blendeTimer);
			// Der Bund schrumpft erst NACH der Blende -- sonst faellt der Suchknopf darunter
			// nach unten, waehrend das Menue darueber noch sichtbar ausblendet.
			blendeTimer = window.setTimeout(function () {
				menue.hidden = true;
				misstDenBund();
				if (fokusZurueck) { knopf.focus(); }
			}, 120);
		}

		knopf.addEventListener("click", function () {
			// 💣 KEIN stopPropagation, anders als beim Ansichts-Knopf nebenan. Der Klick SOLL das
			// Dokument erreichen: dort haengt der Zuhoerer von js/ui/map-layer-picker.js, der das
			// Ansichts-Menue zuklappt. So ist immer nur eines der beiden offen, ohne dass die eine
			// Datei die andere kennen muss -- zwei offene Menuees addieren ihre Hoehen und
			// schoeben den halben Bund aus dem Bild.
			if (offen()) { schliesse(); } else { oeffne(); }
		});

		/**
		 * 💣 CAPTURE-Phase (das `true` am Ende), und das ist der ganze Trick an dieser Zeile.
		 * Der Ansichts-Knopf nebenan ruft in seinem eigenen Handler stopPropagation -- ein
		 * gewoehnlicher Zuhoerer am Dokument bekaeme dessen Klick nie zu sehen, und dieses Menue
		 * bliebe offen, waehrend daneben das zweite aufgeht. In der Capture-Phase laeuft dieser
		 * Zuhoerer VOR dem Ziel, also bevor irgendjemand die Ausbreitung stoppen kann.
		 */
		document.addEventListener("click", function (ereignis) {
			if (!offen()) {
				return;
			}
			if (knopf.contains(ereignis.target) || menue.contains(ereignis.target)) {
				return;
			}
			schliesse();
		}, true);

		document.addEventListener("keydown", function (ereignis) {
			if (ereignis.key === "Escape" && offen()) {
				schliesse(true);
			}
		});

		/**
		 * Graut aus, was die aktuelle Ansicht ohnehin sperrt.
		 * ⚠️ Eine UNBEKANNTE Ansicht sperrt nichts. Ein Modus, der nicht in GESPERRT steht, heisst
		 * „die Tabelle hinkt hinterher" -- dann lieber alles bedienbar lassen als etwas grundlos
		 * verriegeln. Ein zu viel gesperrter Schalter ist der teurere Fehler: er sieht kaputt aus
		 * und laesst sich nicht widerlegen.
		 */
		function setzeRiegel() {
			var modus = (typeof getSelectedMapLayerMode === "function") ? getSelectedMapLayerMode() : "";
			var gesperrt = GESPERRT[modus] || {};

			["togglePaths", "toggleMapLabels", "toggleTerritoryBorders", "toggleRivers", "toggleSeaPaths"].forEach(function (id) {
				var box = document.getElementById(id);
				var zeile = box && box.closest(".map-display-menu__row");
				if (!zeile) {
					return; // steht (noch) nicht im Menue
				}
				var grund = gesperrt[id];
				// 💣 `disabled`, nicht nur eine Klasse. Ein ausgegrauter, aber klickbarer Schalter ist
				// schlimmer als ein normaler: er sieht kaputt aus UND tut etwas.
				box.disabled = Boolean(grund);
				zeile.classList.toggle("is-locked", Boolean(grund));
				if (grund) {
					zeile.setAttribute("aria-disabled", "true");
					zeile.title = uebersetze(GRUND[grund][0], GRUND[grund][1]);
				} else {
					zeile.removeAttribute("aria-disabled");
					zeile.removeAttribute("title");
				}
			});

			// Die Ortsklassen sind Knoepfe, keine Haken -- gesperrt wird die ganze Gruppe auf einmal.
			var orteGruppe = document.getElementById("display-group-places");
			var orteGrund = gesperrt.orte;
			if (orteGruppe) {
				orteGruppe.classList.toggle("is-locked", Boolean(orteGrund));
				if (orteGrund) {
					orteGruppe.title = uebersetze(GRUND[orteGrund][0], GRUND[orteGrund][1]);
				} else {
					orteGruppe.removeAttribute("title");
				}
				Array.prototype.forEach.call(orteGruppe.querySelectorAll(".location-toggle"), function (b) {
					b.disabled = Boolean(orteGrund);
				});
			}
		}

		/**
		 * 💣 DER RIEGEL WIRD BEI JEDEM ANSICHTSWECHSEL NEU GESETZT, nicht einmal beim Aufbau. Ein
		 * beim Aufbau eingefrorenes `disabled` waere ab dem naechsten Wechsel gelogen -- genau der
		 * Fehler, den die Transport-Combobox schon einmal hatte.
		 * ⚠️ Einen Moduswechsel gibt es als Ereignis NICHT: setSelectedMapLayerMode setzt den Wert
		 * mit jQuery `.val()`, und das feuert nichts. Beobachtet wird deshalb die Beschriftung der
		 * Auswahlbox -- syncTransportControl schreibt sie bei JEDEM Wechsel neu, egal ob er von der
		 * Ansichts-Kachel, einem Tastenkuerzel oder einem geteilten Link kommt. Kein zweiter
		 * Zustand, nur ein Zuhoerer an der Stelle, die sich ohnehin aendert (derselbe Weg wie in
		 * js/ui/map-layer-picker.js).
		 */
		var beschriftung = document.getElementById("mapLayerModeLabel");
		if (beschriftung && typeof MutationObserver === "function") {
			new MutationObserver(setzeRiegel).observe(beschriftung, {
				childList: true,
				characterData: true,
				subtree: true
			});
		}
		setzeRiegel();

		// Zugeklappt starten und den Bund einmal nachmessen: er ist um eine Knopfreihe gewachsen.
		schliesse();
		menue.hidden = true;
		misstDenBund();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
