/*
 * Die Ansichts-Kachel in der Kartenecke -- Erprobung hinter ?layerPanelActive=1.
 * Entwurf: docs/superpowers/specs/2026-08-11-ansichts-kacheln-design.md
 *
 * Die Kachel IST das Menue: zugeklappt zeigt sie die eingestellte Ansicht, aufgeklappt faltet sie
 * sich zu allen sechs auf -- am Zeiger als Reihe, am Telefon als 2x3 (das entscheidet CSS).
 */
(function initMapLayerPicker() {
	"use strict";

	var WURZEL = "icons/layer-tiles/";

	function anEinschalter() {
		try {
			var wert = new URLSearchParams(window.location.search).get("layerPanelActive");
			if (wert === null) {
				return false;
			}
			// Tolerant lesen wie der Rest der Adresszeile (?x=1, ?x=true, ?x= leer).
			if (typeof parseBooleanQueryParam === "function") {
				return parseBooleanQueryParam(wert, true);
			}
			return wert !== "0" && wert !== "false";
		} catch (e) {
			return false;
		}
	}

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
		bild.src = WURZEL + ansicht.wert + ".webp";
		bild.alt = "";
		bild.width = 48;
		bild.height = 48;
		bild.loading = "lazy";
		huelle.appendChild(bild);

		var name = document.createElement("span");
		name.className = "map-layer-picker__label";
		name.textContent = ansicht.name;

		knopf.appendChild(huelle);
		knopf.appendChild(name);
		return knopf;
	}

	function start() {
		var huelle = document.getElementById("map-layer-picker");
		var knopf = document.getElementById("map-layer-button");
		var menue = document.getElementById("map-layer-menu");
		var select = document.getElementById("mapLayerModeSelect");
		if (!huelle || !knopf || !menue || !select) {
			return;
		}

		function zeichne() {
			var aktiv = aktiveAnsicht();
			var alle = ansichten();
			var aktuelle = alle.filter(function (a) { return a.wert === aktiv; })[0] || alle[0];
			if (!aktuelle) {
				return;
			}

			knopf.innerHTML = "";
			knopf.appendChild(zelle(aktuelle, false, false));
			knopf.title = "Ansicht: " + aktuelle.name;
			knopf.setAttribute("aria-label", "Ansicht wählen, aktuell " + aktuelle.name);

			// 💣 DIE AKTIVE ANSICHT STEHT ZULETZT. Nur dadurch faellt sie im Raster auf den Fleck
			// der zugeklappten Kachel (beide haengen mit derselben Polsterung an derselben Ecke,
			// siehe css/components/map-layer-picker.css). Wer hier sortiert, verschiebt die Kachel
			// beim Aufklappen -- genau das, was nicht passieren darf.
			menue.innerHTML = "";
			alle.forEach(function (a) {
				if (a.wert !== aktuelle.wert) {
					menue.appendChild(zelle(a, false, true));
				}
			});
			menue.appendChild(zelle(aktuelle, true, true));
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

		// Der Zustand haengt an der Klasse, nicht an `hidden`: waehrend der Ausblende ist das Raster
		// noch da, aber schon zu.
		function offen() {
			return menue.classList.contains("is-open");
		}

		function schliesse(fokusZurueck) {
			if (menue.hidden) {
				if (fokusZurueck) { knopf.focus(); }
				return;
			}
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
			}, 140);
		}

		function oeffne() {
			window.clearTimeout(blendeTimer);
			zeichne();
			menue.hidden = false;
			knopf.hidden = true;
			knopf.setAttribute("aria-expanded", "true");
			// ⚠️ Erst im naechsten Bild anblenden: im selben Durchlauf gesetzt, sieht der Browser
			// keinen Uebergang und das Raster spraenge ohne Blende ins Bild.
			misstDenBund();
			window.requestAnimationFrame(function () {
				menue.classList.add("is-open");
			});
			var aktiv = menue.querySelector(".map-layer-picker__cell.is-active");
			if (aktiv) {
				aktiv.focus();
			}
		}

		function waehle(modus) {
			if (!modus || modus === aktiveAnsicht()) {
				schliesse();
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
			if (offen()) { schliesse(); } else { oeffne(); }
		});

		menue.addEventListener("click", function (ereignis) {
			var ziel = ereignis.target.closest(".map-layer-picker__cell");
			if (!ziel || ziel.disabled) {
				return;
			}
			ereignis.stopPropagation();
			waehle(ziel.dataset.mode);
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

	if (!anEinschalter()) {
		return;
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
