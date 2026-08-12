/*
 * Das Anzeige-Menue (Auge) in der Kartenecke -- was auf der Karte zu sehen ist.
 * Entwurf: docs/superpowers/specs/2026-08-12-anzeige-menue-design.md
 *
 * 💣 Diese Datei bedient das Menue, sie besitzt die Schalter NICHT. Die Ortsklassen und die
 * Ebenen-Haken sind aus dem Routenplaner UMGEZOGEN und behalten ihre IDs; ihre Verdrahtung
 * (map-features.js, display-mode.js, die URL-Persistenz) laeuft unveraendert weiter. Wer hier
 * anfaengt, Sichtbarkeit selbst zu setzen, baut den zweiten Zustand, den der Umzug vermeidet.
 */
(function initMapDisplayMenu() {
	"use strict";

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
		 * 💣 Der Zoom ueber dem Bund haengt an dessen GEMESSENER Hoehe. Es gibt dafuer schon einen
		 * ResizeObserver, aber der wird wie jede Bildschleife erst zum naechsten Bild zugestellt --
		 * und beim Auf- und Zuklappen aendert sich die Hoehe genau JETZT. Einmal zu oft messen ist
		 * harmlos, einmal zu spaet laesst den Zoom auf dem Bund sitzen (der 8-px-Fehler vom
		 * 10.08.2026).
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
