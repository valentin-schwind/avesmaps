(function () {
	"use strict";

	/*
	 * Das Fenster „Garetien Importer" — Knopf, Hülle, Liste, Einzelansicht, Handlungen.
	 *
	 * 🔴 DIESE DATEI VERSCHWINDET BEIM ABBAU DES IMPORTERS (Auftrag §5.5). Sie kennt deshalb die
	 *    internen Speichertabellen des Importers nicht und darf sie nie kennen (der Wächtertest
	 *    api/_internal/import/__tests__/garetien-abbau-waechter-test.php prüft das): was diese
	 *    Tabellen kennt, steht ausschließlich innerhalb von api/_internal/import/. Der Griff für
	 *    „woher kam das" ist feature_sources.origin.
	 * 🔴 SIE RECHNET NICHTS NACH. Urteil, Grund, Geometrie (fertig in Karteneinheiten) und die
	 *    getroffenen Abschnitte kommen aus after_json. Der Browser wählt aus, blendet ein und
	 *    schickt Häkchen — er transformiert keine Koordinate und bildet kein Urteil.
	 * 🔴 UND ER SCHREIBT NUR DURCH EINE TÜR: api/edit/wiki/sync-plan.php mit kind:'garetien'.
	 *
	 * 🔴 AUFGABE 10: das Fenster bleibt LEER. Liste, Filter und Einzelansicht sind Aufgabe 11 ff.
	 *    Hier stehen nur der Knopf, die verschiebbare Hülle (dialog-drag.js erledigt das Ziehen
	 *    ohne eine Zeile Verdrahtung -- sie sucht nach der FORM, nicht nach dieser Datei), der
	 *    Rechte-Riegel und der eine Sender für Aufgabe 11-16.
	 */

	const hasDocument = typeof document !== "undefined";

	// Die zwei erlaubten Adressen für avesmapsGaretienRufe() (Auftrag §5.4):
	//   lesend  -- /api/edit/map/garetien-import.php
	//   schreibend -- /api/edit/wiki/sync-plan.php
	// In dieser Aufgabe ruft noch niemand -- das Fenster bleibt leer (Aufgabe 11 ff. füllen es).
	// Kein Aufrufer baut sich eine eigene fetch()-Stelle; der Test aus Aufgabe 15 zählt die
	// fetch(-Vorkommen dieser Datei.

	// ---- der Rechte-Riegel (unter Test in js/review/__tests__/garetien-fenster-huelle.test.js) ---
	//
	// 🔴 Fällt GESCHLOSSEN aus: bis die Auskunft da ist — und für immer, wenn sie nie kommt —
	// bleibt der Knopf verborgen. Nur echtes `true` zählt; eine als JSON geparste Fehlerseite,
	// eine 1 statt true, ein Proxy mit "0" sind alle truthy und würden den Knopf sonst freigeben.
	function avesmapsGaretienDarfOeffnen(sitzung) {
		return !!(sitzung && sitzung.capabilities && sitzung.capabilities.admin === true);
	}

	// ---- Zustand ---------------------------------------------------------------------------------
	//
	// Die volle Form ist die Schnittstelle für Aufgabe 11-16 (avesmapsGaretienFensterZustand()).
	// In dieser Aufgabe bleibt sie leer/aus -- das Fenster zeigt noch keine Liste.
	const zustand = {
		offen: false,
		planRunId: null,
		importRunId: null,
		objekte: [],
		auswahl: [],
		stand: null,
		filter: null,
	};

	function avesmapsGaretienFensterZustand() {
		// Eine Kopie -- Aufrufer sollen den internen Zustand nicht direkt mutieren können.
		return {
			offen: zustand.offen,
			planRunId: zustand.planRunId,
			importRunId: zustand.importRunId,
			objekte: zustand.objekte.slice(),
			auswahl: zustand.auswahl.slice(),
			stand: zustand.stand,
			filter: zustand.filter,
		};
	}

	// ---- die Hülle --------------------------------------------------------------------------------

	function fensterElement() {
		return hasDocument ? document.getElementById("garetien-importer") : null;
	}

	function avesmapsGaretienFensterOeffnen() {
		const win = fensterElement();
		if (win) { win.hidden = false; }
		zustand.offen = true;
	}

	function avesmapsGaretienFensterSchliessen() {
		const win = fensterElement();
		if (win) { win.hidden = true; }
		zustand.offen = false;
	}

	// ---- der eine Sender (Auftrag §5.4) -------------------------------------------------------
	//
	// POST, JSON, credentials same-origin, wirft bei ok !== true mit error.message. Alle
	// Aufrufer (Aufgabe 11-16) gehen hier durch, nie mit einem eigenen fetch().
	function avesmapsGaretienRufe(pfad, rumpf) {
		return fetch(pfad, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(rumpf || {}),
		})
			.then(function (antwort) { return antwort.json(); })
			.then(function (daten) {
				if (!daten || daten.ok !== true) {
					const nachricht = (daten && daten.error && typeof daten.error.message === "string")
						? daten.error.message
						: "Unbekannter Fehler beim Garetien-Importer.";
					throw new Error(nachricht);
				}
				return daten;
			});
	}

	// ---- Verdrahtung + Rechte-Riegel ---------------------------------------------------------------

	function bindFenster() {
		const schliessenBtn = hasDocument ? document.getElementById("garetien-importer-close") : null;
		if (schliessenBtn) {
			schliessenBtn.addEventListener("click", avesmapsGaretienFensterSchliessen);
		}
	}

	function bindKnopf() {
		const oeffnenBtn = hasDocument ? document.getElementById("garetien-importer-open") : null;
		if (oeffnenBtn) {
			oeffnenBtn.addEventListener("click", avesmapsGaretienFensterOeffnen);
		}
	}

	// ⚠️ Kein zweiter Rechteweg: dieselbe Auskunft, die js/app/session.js ohnehin einmal holt
	// (window.AvesmapsSession.load() liefert ein geteiltes, gecachtes Versprechen zurück).
	function anwendeRechteRiegel() {
		const sitzung = (typeof window !== "undefined" && window.AvesmapsSession)
			? window.AvesmapsSession.current()
			: null;
		const darf = avesmapsGaretienDarfOeffnen(sitzung);
		const oeffnenBtn = hasDocument ? document.getElementById("garetien-importer-open") : null;
		if (oeffnenBtn) { oeffnenBtn.hidden = !darf; }
		return darf;
	}

	function boot() {
		bindFenster();
		bindKnopf();
		if (typeof window !== "undefined" && window.AvesmapsSession) {
			window.AvesmapsSession.load().then(function () {
				anwendeRechteRiegel();
			});
		}
	}

	if (hasDocument) {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", boot);
		} else {
			boot();
		}
	}

	if (typeof window !== "undefined") {
		window.avesmapsGaretienImporter = {
			oeffnen: avesmapsGaretienFensterOeffnen,
			schliessen: avesmapsGaretienFensterSchliessen,
			zustand: avesmapsGaretienFensterZustand,
			rufe: avesmapsGaretienRufe,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			avesmapsGaretienDarfOeffnen,
			avesmapsGaretienFensterZustand,
			avesmapsGaretienRufe,
		};
	}
})();
