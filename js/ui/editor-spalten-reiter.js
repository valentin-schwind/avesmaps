/**
 * Aus den Spalten einer Editorseite werden am schmalen Fenster REITER.
 *
 * Eine Editorseite legt ihre Arbeitsflächen nebeneinander („Noch nicht modellierte
 * Herrschaftsgebiete" | „Hierarchiemodell" | „Wiki-Daten und Eigene Overrides"). In einem 366px
 * breiten Fenster teilen sich die drei exakt zu Dritteln — je ~110px, jede Überschrift
 * abgeschnitten, jede Listenzeile mehrzeilig. Dieses Bauteil baut über den Wirt eine Reiterleiste
 * und zeigt dort genau eine Spalte.
 *
 * Entwurf: docs/superpowers/specs/2026-09-12-sync-monitor-am-telefon-design.md
 *
 * 🔴 DIE FORM IST DIE HAUSFORM, KEINE NEUE: `.avm-tabs` / `.avm-tab` aus
 * `css/components/editor-body.css` (Unterstrich). AGENTS.md §12 hat das am 04.09.2026 entschieden —
 * „im Fenster Unterstrich, frei auf der Karte gefüllter Umschalter: der ORT entscheidet" —, und
 * damals fielen sieben von neun Rezepturen. Hier entsteht keine zehnte.
 *
 * 🔴 DER RIEGEL IST DIE FENSTERBREITE, NICHT `html.avesmaps-phone`, und beide Gründe tragen:
 *  (a) Gefragt ist „haben die Spalten Platz", nicht „ist das ein Telefon" — ein auf 600px gezogenes
 *      Desktopfenster hat genau dasselbe Problem.
 *  (b) Die Klasse kommt aus `js/app/runtime-state.js`, und DIE LÄDT NUR `index.html`. Die
 *      Editorseiten sind eigenständige iframe-Dokumente; ein `html.avesmaps-phone` wäre dort eine
 *      Regel, die nie greift.
 *
 * 💣 DESHALB SETZT DIESES BAUTEIL NUR EINE KLASSE, UND CSS ENTSCHEIDET, OB SIE WIRKT. Die
 * versteckte Spalte bekommt `.avm-spalte-aus`; das `display: none` dazu steht IN der Media-Query
 * (`editor-body.css`). Damit gibt es keinen Zustand, der beim Drehen oder Größerziehen
 * auseinanderläuft — über der Schwelle stehen alle Spalten da, ohne dass ein Ereignis abgewartet
 * werden muss, und es braucht keinen `resize`-Zuhörer.
 *
 * 💣 UND DESHALB NIE `hidden`: `[hidden] { display: none !important }` gilt in JEDER Breite (global
 * in `css/base/reset.css`, in den Editorseiten über `editor-page.css`). Die zwei anderen Spalten
 * wären auch am 1400px-Fenster weg, und ein `!important` nimmt keine Media-Query zurück.
 *
 * ⚠️ Ein zweiter Aufruf auf demselben Wirt gibt die vorhandene Steuerung zurück — die
 * Doppelanmeldung, die das Sammelmenü am 23.08.2026 live unbrauchbar gemacht hat (AGENTS.md §11:
 * zwei registrierte Klick-Zuhörer, der erste öffnet, der zweite schließt im selben Klick).
 *
 * 🔴 ABHÄNGIGKEITSFREI wie `js/ui/ribbon-menu.js` und `js/ui/filter-menu.js` daneben: kein `$`,
 * kein `escapeHtml`, keine App-Globalen — nur DOM.
 */

(function () {
	"use strict";

	/**
	 * Hängt eine Reiterleiste über einen Spalten-Wirt.
	 *
	 * @param {HTMLElement} wirt      Das Element, dessen Kinder die Spalten sind (z. B. `.cols`).
	 * @param {Object} [optionen]
	 * @param {HTMLElement[]} [optionen.spalten]  Die Spalten. Vorgabe: alle Element-Kinder des Wirts.
	 * @param {Function} [optionen.name]  `(spalte, index) => string` — die Reiterbeschriftung.
	 *   Vorgabe: `data-reiter`, sonst die erste Überschrift, sonst „Spalte N".
	 * @returns {{zeige: Function, aktiv: Function, wirkt: Function, leiste: HTMLElement}|null}
	 *   `null`, wenn der Wirt fehlt oder weniger als zwei Spalten hat — mit einer Spalte gibt es
	 *   nichts umzuschalten, und ein Reiter für nichts ist ein Klick für nichts (AGENTS.md §11 zum
	 *   Sammelmenü: „nichts unter drei Einträgen").
	 */
	function avesmapsSpaltenReiterAttach(wirt, optionen) {
		if (!wirt) return null;
		// Zweiter Aufruf auf demselben Wirt: die vorhandene Steuerung, kein zweiter Handlersatz.
		if (wirt.__avmSpaltenReiter) return wirt.__avmSpaltenReiter;

		const einstellungen = optionen || {};
		const spalten = Array.isArray(einstellungen.spalten) && einstellungen.spalten.length
			? einstellungen.spalten.filter(Boolean)
			: Array.prototype.filter.call(wirt.children, function (kind) { return kind.nodeType === 1; });
		if (spalten.length < 2) return null;

		function beschriftung(spalte, index) {
			if (typeof einstellungen.name === "function") {
				const eigener = einstellungen.name(spalte, index);
				if (eigener) return String(eigener);
			}
			if (spalte.dataset && spalte.dataset.reiter) return spalte.dataset.reiter;
			const kopf = spalte.querySelector("h1, h2, h3");
			const text = kopf && kopf.textContent ? kopf.textContent.trim() : "";
			return text || ("Spalte " + (index + 1));
		}

		const leiste = document.createElement("div");
		// Beide Klassen: `.avm-tabs` ist die FORM (Flex, Trennlinie, Abstand), `.avm-spalten-reiter`
		// entscheidet, ob die Leiste überhaupt sichtbar ist. Die zwei Regeln stehen in derselben
		// Datei untereinander, damit die Reihenfolge nachlesbar ist statt zufällig zu sein.
		leiste.className = "avm-tabs avm-spalten-reiter";
		leiste.setAttribute("role", "tablist");
		const knoepfe = spalten.map(function (spalte, index) {
			const knopf = document.createElement("button");
			knopf.type = "button";
			knopf.className = "avm-tab";
			knopf.setAttribute("role", "tab");
			knopf.textContent = beschriftung(spalte, index);
			knopf.addEventListener("click", function () { zeigeIndex(index); });
			leiste.appendChild(knopf);
			return knopf;
		});
		wirt.parentNode.insertBefore(leiste, wirt);

		let aktiverIndex = 0;

		function zeigeIndex(index) {
			if (!(index >= 0 && index < spalten.length)) return;
			aktiverIndex = index;
			spalten.forEach(function (spalte, i) {
				spalte.classList.toggle("avm-spalte-aus", i !== index);
			});
			knoepfe.forEach(function (knopf, i) {
				knopf.classList.toggle("is-active", i === index);
				knopf.setAttribute("aria-selected", i === index ? "true" : "false");
			});
		}

		/**
		 * Wirken die Reiter gerade? ⚠️ Gefragt wird die GERECHNETE Sichtbarkeit der Leiste, nie die
		 * Schwellenzahl ein zweites Mal: die steht im CSS, und eine Kopie hier liefe beim nächsten
		 * Nachjustieren auseinander (dieselbe Klasse Fehler wie ein abgeschriebener Tokenwert).
		 * Fällt GESCHLOSSEN aus — ohne `getComputedStyle` gilt „die Reiter wirken nicht", und dann
		 * stehen die Spalten wie bisher nebeneinander.
		 */
		function wirkt() {
			try {
				return window.getComputedStyle(leiste).display !== "none";
			} catch (fehler) {
				return false;
			}
		}

		/**
		 * Zeigt die Spalte, in der `ziel` liegt — oder die Spalte selbst, oder einen Index.
		 * ⚠️ Tut NICHTS, solange die Reiter nicht wirken: am breiten Fenster ist schon alles
		 * sichtbar, und ein stilles Umschalten dort setzte eine Klasse, die niemand liest.
		 */
		function zeige(ziel) {
			if (!wirkt()) return;
			if (typeof ziel === "number") { zeigeIndex(ziel); return; }
			if (!ziel) return;
			for (let i = 0; i < spalten.length; i += 1) {
				if (spalten[i] === ziel || spalten[i].contains(ziel)) { zeigeIndex(i); return; }
			}
		}

		zeigeIndex(0);

		const steuerung = {
			zeige: zeige,
			aktiv: function () { return aktiverIndex; },
			wirkt: wirkt,
			leiste: leiste,
			spalten: spalten,
			knoepfe: knoepfe,
		};
		wirt.__avmSpaltenReiter = steuerung;
		return steuerung;
	}

	/**
	 * Die Steuerung eines Wirts nachschlagen, oder `null`.
	 *
	 * ⚠️ ES GIBT IHN, DAMIT NIEMAND SIE SICH MERKEN MUSS. Eine Seite, die das Ergebnis von
	 * `attach` in eine `const` legt und später aus einer Funktion darauf zugreift, hängt an der
	 * Reihenfolge zweier Blöcke in EINER Datei: steht der Zugriff vor der Zuweisung, ist die
	 * Variable in der temporalen Todeszone und wirft `ReferenceError` — und ein Fehler beim ersten
	 * Klick sieht wie ein kaputtes Bauteil aus, nicht wie eine verschobene Zeile. Dieselbe Klasse
	 * Fehler wie die `const` hinter dem `try`-Block, die den Wege-Editor am 19.08.2026 mit leerem
	 * Rumpf antworten ließ (AGENTS.md §11). Bei JEDER Anfrage nachschlagen, nie einmal merken.
	 *
	 * @param {HTMLElement|string} wirt  Das Element oder ein Selektor dafür.
	 */
	function avesmapsSpaltenReiter(wirt) {
		const element = typeof wirt === "string" ? document.querySelector(wirt) : wirt;
		return (element && element.__avmSpaltenReiter) || null;
	}

	if (typeof window !== "undefined") {
		window.avesmapsSpaltenReiterAttach = avesmapsSpaltenReiterAttach;
		window.avesmapsSpaltenReiter = avesmapsSpaltenReiter;
	}
	// Für den Unit-Test (node) — im Browser ist `module` nicht definiert.
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { avesmapsSpaltenReiterAttach, avesmapsSpaltenReiter };
	}
})();
