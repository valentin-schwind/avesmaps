/*
 * Die Ansichts-Kachel in der Kartenecke -- seit 12.08.2026 fuer JEDEN Besucher, nicht mehr hinter
 * einem Pruef-Schalter. Entwurf: docs/superpowers/specs/2026-08-11-ansichts-kacheln-design.md
 *
 * Die Kachel IST das Menue: zugeklappt zeigt sie die eingestellte Ansicht, aufgeklappt faltet sie
 * sich zu allen sechs auf -- am Zeiger als Reihe, am Telefon als 2x3 (das entscheidet CSS).
 */
(function initMapLayerPicker() {
	"use strict";

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

		function waehle(modus) {
			// Nach einer Auswahl steht der Zeiger noch ueber dem Bund. Ohne diesen Riegel klappte
			// das Menue sofort wieder auf -- er faellt erst, wenn der Zeiger die Huelle verlaesst.
			schwebeGesperrt = true;
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
			}, 140);
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
			}, 260);
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

	if (abgeschaltet()) {
		return;
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
