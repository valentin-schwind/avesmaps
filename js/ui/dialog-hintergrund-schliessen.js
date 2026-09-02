"use strict";

/*
 * Klick auf den Hintergrund schliesst das Fenster (Owner-Wunsch 02.09.2026: "ansonsten ist das das
 * normale verhalten von fenstern").
 *
 * Das Verhalten gab es im Haus laengst -- `if (event.target === overlay) close()` steht an rund 25
 * Stellen (Hinweise, Neuigkeiten, Spotlight, Social-Hub, Territorien-Editor, Kartensammlung,
 * Literatur, Landschaftsdialog ...). Es fehlte ausgerechnet bei den BEARBEITEN-Fenstern, also dort,
 * wo ein Fehlgriff etwas kostet. Genau deshalb steht die Regel hier einmal statt ein 26. Mal
 * abgeschrieben: die vorhandenen Abschriften kennen die Ziehfalle unten nicht, und eine Regel, die
 * einen von vielen Erzeugern bindet, ist keine Regel. (Die 25 alten werden hier NICHT umgeschrieben
 * -- das waere unbestellter Umbau; wer eine anfasst, holt sie hierher.)
 *
 * 💣 DER ZUHOERER HAENGT AM OVERLAY, NIE AM DOCUMENT. Am Dokument delegiert -- wie es
 * changelog-dialog.js fuer Escape tut -- braeche der Ablauf "Neue Position vorschlagen"
 * (review-locations.js, startChangePositionPick): der blendet sein Overlay auf `hidden` und laesst
 * den Nutzer EINEN Punkt auf der Karte waehlen. Dieser Kartenklick waere am Dokument ein
 * Hintergrundklick, und Schliessen heisst hier `resetForm: true` -- der halb geschriebene Vorschlag
 * waere weg, im Moment der Positionswahl, und es saehe wie ein verschluckter Klick aus.
 *
 * 🔴 Und die Regel, die den Umfang bestimmt: ein Hintergrundklick schliesst nur ein Fenster, dessen
 * Hintergrund ein SCHLEIER ist -- nie eines, dessen Hintergrund die ARBEITSFLAECHE ist. Die vier
 * Fenster, die an der Karte arbeiten ("Flaeche vereinfachen", "Grenze aus Territorien", "Flaeche
 * bearbeiten", der Eigenschaften-Dialog; Owner 28.07.2026) und der VERKLEINERTE Konflikte-Dialog
 * tragen `pointer-events: none` an ihrer Huelle und reichen Zeiger an die Karte durch. Die Regel
 * setzt sich damit von selbst durch -- solange niemand am Dokument lauscht.
 */

(function () {
	/*
	 * Warum drei Ereignisse und nicht nur `click`:
	 *
	 * 💣 `click` feuert am naechsten gemeinsamen VORFAHREN von Druck- und Loslass-Ziel. Wer in einem
	 * Eingabefeld Text markiert und dabei ueber den Fensterrand hinauszieht, druckt im Fenster und
	 * laesst auf dem Hintergrund los -- der gemeinsame Vorfahre IST das Overlay, `event.target ===
	 * overlay` ist wahr, und ein Formular mit zwanzig Feldern ist weg. Bei einem Anzeigefenster
	 * faellt das nie auf, weil dort nichts zu verlieren ist; das ist der Grund, warum die 25
	 * Abschriften damit durchkommen. Geschlossen wird deshalb nur, wenn DRUCK UND LOSLASSEN beide
	 * auf dem Hintergrund lagen.
	 *
	 * Die Merker koennen nur MEHR verhindern, nie mehr schliessen -- ein Riegel, kein Ausloeser.
	 */
	function avesmapsDialogHintergrundSchliessen(overlay, schliessen) {
		if (!overlay || typeof overlay.addEventListener !== "function") {
			// Faellt offen aus: bootstrap.js haengt sieben Fenster in EINEM Durchgang an, und eine
			// umbenannte Kennung (so ist `#label-edit-overlay` gestorben) darf die uebrigen sechs
			// nicht mitreissen.
			return null;
		}

		// Zweiter Aufruf auf demselben Overlay: die vorhandene Steuerung, kein zweiter Handlersatz.
		// Zwei Anmeldungen sind hier still -- das Fenster geht zu, es geht nur zweimal zu.
		if (overlay.__avmHintergrundSchliesser) {
			return overlay.__avmHintergrundSchliesser;
		}

		var druckAufHintergrund = false;
		var losAufHintergrund = false;

		function vergiss() {
			druckAufHintergrund = false;
			losAufHintergrund = false;
		}

		// Nur die linke Taste. Ein Rechtsklick oeffnet auf der Karte das Kontextmenue und darf keinen
		// Merker hinterlassen, der einem spaeteren Klick als Erlaubnis dient.
		function istLinkeTaste(event) {
			return !event || event.button === undefined || event.button === 0;
		}

		overlay.addEventListener("pointerdown", function (event) {
			druckAufHintergrund = istLinkeTaste(event) && event.target === overlay;
			losAufHintergrund = false;
		});

		overlay.addEventListener("pointerup", function (event) {
			losAufHintergrund = istLinkeTaste(event) && event.target === overlay;
		});

		overlay.addEventListener("click", function (event) {
			var aufHintergrund = druckAufHintergrund && losAufHintergrund
				&& istLinkeTaste(event) && event.target === overlay;
			// Immer vergessen, auch wenn nicht geschlossen wird: sonst bewertet EIN Hintergrunddruck
			// zwei Klicks, und der zweite kommt aus einem ganz anderen Ablauf.
			vergiss();
			if (aufHintergrund && typeof schliessen === "function") {
				schliessen();
			}
		});

		var steuerung = { vergiss: vergiss };
		overlay.__avmHintergrundSchliesser = steuerung;
		return steuerung;
	}

	/** Bequemlichkeit fuer die Verdrahtung, die ihre Fenster ueber IDs kennt. */
	function avesmapsDialogHintergrundSchliessenById(overlayId, schliessen) {
		return avesmapsDialogHintergrundSchliessen(
			typeof document !== "undefined" ? document.getElementById(overlayId) : null,
			schliessen
		);
	}

	if (typeof window !== "undefined") {
		window.avesmapsDialogHintergrundSchliessen = avesmapsDialogHintergrundSchliessen;
		window.avesmapsDialogHintergrundSchliessenById = avesmapsDialogHintergrundSchliessenById;
	}
	// Fuer den Unit-Test (node) -- im Browser ist `module` nicht definiert.
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { avesmapsDialogHintergrundSchliessen, avesmapsDialogHintergrundSchliessenById };
	}
})();
