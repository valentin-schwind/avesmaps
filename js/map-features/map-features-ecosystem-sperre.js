/*
 * Landschaften: die Klick-Sperre einer Region (19.08.2026).
 *
 * Owner, wörtlich: „‚Element sperren‘ zur Option stellen, dass der Mauscursor diese nicht abfängt.
 * tooltips sollen erhalten bleiben. es geht nur um die klicks."
 *
 * 💣 DESHALB IST `pointer-events: none` DIE FALSCHE ANTWORT — obwohl es die naheliegende ist.
 * Der Schwebezettel hängt an `layer.bindTooltip(…, { sticky: true })` und öffnet auf `mouseover`.
 * Ohne Zeigerereignisse gibt es kein `mouseover`, also keinen Zettel. Wer die Sperre über CSS baut,
 * erfüllt die halbe Anforderung und merkt es nicht: beim Prüfen wartet niemand darauf, ob ein Zettel
 * kommt, der ja auch vorher schon eine Sekunde brauchte.
 *
 * Stattdessen nimmt die gesperrte Fläche Zeigerereignisse weiter an (Zettel, Hover, Kontur bleiben
 * unverändert) und REICHT DEN KLICK WEITER:
 *   1. die Pfade ALLER gesperrten Flächen kurz durchlässig stellen,
 *   2. `document.elementFromPoint` fragen, was darunter liegt,
 *   3. zurückstellen,
 *   4. gehört der Treffer zu einer anderen Fläche, bekommt DIESE das Ereignis; sonst steigt der
 *      Aufrufer ohne `stopPropagation` aus, und Leaflets Kartenhandler übernimmt.
 *
 * 🪤 In Schritt 1 sind ALLE gesperrten durchlässig, nicht nur die getroffene: liegen zwei
 * übereinander, liefe das Verfahren sonst je Schicht erneut. So läuft es genau einmal, und ein
 * weitergereichtes Ereignis kann nie wieder auf einer gesperrten Fläche landen.
 *
 * 🔴 NUR IM BEARBEITEN-MODUS (`canOperateEcosystemLayers`) — dieselbe Frage, an der auch
 * `isEcosystemReaderClick` hängt. Für einen Besucher wäre eine gesperrte Region eine Region ohne
 * Infopanel: ein Funktionsverlust, den er nicht erklären und nicht rückgängig machen kann.
 *
 * 💣 ALLE ZEIGERGESTEN DER FLÄCHE GEHEN DURCH DIESE EINE WEICHE. Keine Zahl in diesem Kommentar:
 * „Eingang 1 von 4" liest sich wie eine vollständige Liste, und genau daran ist die
 * Verkehrsmittel-Sperre am 14.08.2026 gescheitert — es suchte niemand weiter. Wer eine Geste
 * hinzufügt, fragt `avesmapsEcosystemReichtWeiter`, und der Test
 * js/map-features/__tests__/ecosystem-sperre-eingaenge.test.js zählt zur LAUFZEIT mit.
 *
 * ⭐ Die ZIELWAHL der Zwei-Flächen-Gesten („Mit anderer vereinigen" …) braucht keine eigene Sperre:
 * sie hängt am Klickhandler der Fläche und bekommt den Klick erst, nachdem diese Weiche ihn
 * durchgelassen hat. Bei einer gesperrten Region läuft der Handler der Fläche DARUNTER — und die
 * wird damit zum Ziel, was genau die gewünschte Antwort ist.
 */
(function initEcosystemSperre() {
	"use strict";

	// ---- die reine Frage (einzeln geprüft) ---------------------------------------------------------

	// Greift die Sperre dieser Fläche gerade?
	//
	// 🔴 Zwei Bedingungen, und die zweite ist keine Formsache: `darfBearbeiten` ist der Riegel, der
	// den Besucher heraushält. Ohne ihn verlöre eine gesperrte Region ihr Infopanel für jeden.
	//
	// ⚠️ `is_locked` reist als BOOLEAN im Payload (api/_internal/app/ecosystem.php). Ein fehlender
	// Wert heisst „nicht gesperrt" — die sichere Richtung: im Zweifel bleibt die Fläche bedienbar.
	function avesmapsEcosystemSperreGreift(area, darfBearbeiten) {
		return Boolean(area && area.is_locked === true) && darfBearbeiten === true;
	}

	function darfBearbeiten() {
		return typeof canOperateEcosystemLayers === "function" && canOperateEcosystemLayers() === true;
	}

	// Ist DIESE Fläche gerade gesperrt? Der Weg, den alles ausserhalb dieser Datei benutzt.
	function avesmapsEcosystemIstGesperrt(area) {
		return avesmapsEcosystemSperreGreift(area, darfBearbeiten());
	}

	// ---- das Weiterreichen -------------------------------------------------------------------------

	function gesperrtePfade() {
		const pfade = [];
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return pfade;
		}
		const bearbeiten = darfBearbeiten();
		ecosystemLayers.forEach((layer) => {
			if (layer && layer._path && avesmapsEcosystemSperreGreift(layer._ecosystemArea, bearbeiten)) {
				pfade.push(layer._path);
			}
		});

		return pfade;
	}

	// Was liegt an dieser Stelle unter den gesperrten Flächen?
	function elementDarunter(clientX, clientY) {
		if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") {
			return null;
		}
		const pfade = gesperrtePfade();
		const vorher = pfade.map((pfad) => pfad.style.pointerEvents);
		pfade.forEach((pfad) => { pfad.style.pointerEvents = "none"; });
		let treffer = null;
		try {
			treffer = document.elementFromPoint(clientX, clientY);
		} finally {
			// 💣 Im `finally`: wirft elementFromPoint (oder fehlt die Stelle), bliebe die ganze Ebene
			// sonst dauerhaft klickdurchlässig — und zwar unauffällig, denn sie sähe unverändert aus.
			pfade.forEach((pfad, index) => { pfad.style.pointerEvents = vorher[index]; });
		}

		return treffer;
	}

	// Das Ereignis an das gefundene Element weitergeben.
	//
	// 🪤 Ein frisches MouseEvent, kein `dispatchEvent(original)`: ein bereits zugestelltes Ereignis
	// lässt sich nicht ein zweites Mal versenden. Die Stelle (`clientX`/`clientY`) reist mit, weil
	// Leaflet daraus die Koordinate rechnet — ohne sie landete der Klick in der Kartenmitte.
	function reicheWeiter(ziel, original) {
		if (!ziel || typeof MouseEvent !== "function" || typeof ziel.dispatchEvent !== "function") {
			return false;
		}
		const nachbau = new MouseEvent(original.type, {
			bubbles: true,
			cancelable: true,
			view: typeof window !== "undefined" ? window : undefined,
			clientX: original.clientX,
			clientY: original.clientY,
			button: original.button,
			buttons: original.buttons,
			ctrlKey: original.ctrlKey,
			shiftKey: original.shiftKey,
			altKey: original.altKey,
			metaKey: original.metaKey,
			detail: original.detail,
		});
		ziel.dispatchEvent(nachbau);

		return true;
	}

	// Die Weiche. `true` heisst: der Aufrufer ist fertig und steigt SOFORT aus — ohne
	// `stopPropagation`, damit ein nicht weitergereichtes Ereignis bei Leaflets Kartenhandler ankommt.
	//
	// ⚠️ Der Aufrufer übergibt das LEAFLET-Ereignis; die Zeigerstelle steckt in `originalEvent`.
	function avesmapsEcosystemReichtWeiter(layer, event) {
		const original = event && event.originalEvent ? event.originalEvent : null;
		if (!original || !avesmapsEcosystemIstGesperrt(layer && layer._ecosystemArea)) {
			return false;
		}

		const ziel = elementDarunter(original.clientX, original.clientY);
		// Nichts Brauchbares darunter, oder es ist die Karte selbst: durchfallen lassen. Genau das
		// gibt dem Editor die freie Karte zurück — Kartenmenü, „Hier hinzufügen", „Hierher reisen".
		if (ziel && ziel !== original.target) {
			reicheWeiter(ziel, original);
		}

		return true;
	}

	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemSperre = {
			greift: avesmapsEcosystemSperreGreift,
			istGesperrt: avesmapsEcosystemIstGesperrt,
			reichtWeiter: avesmapsEcosystemReichtWeiter,
		};
		// Die drei Namen stehen auch global, weil map-features-ecosystem-rendering.js ein schlichtes
		// <script> daneben ist und seine Nachbarn genauso ruft (kein Modulsystem, AGENTS.md §3).
		window.avesmapsEcosystemIstGesperrt = avesmapsEcosystemIstGesperrt;
		window.avesmapsEcosystemReichtWeiter = avesmapsEcosystemReichtWeiter;
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			avesmapsEcosystemSperreGreift,
		};
	}
})();
