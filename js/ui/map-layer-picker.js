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
					stufeZwei = z.dataset.mode;
					markiereQuelle();
					oeffneStufeZwei();
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
			stufeTimer = window.setTimeout(schliesseStufeZwei, 260);
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
