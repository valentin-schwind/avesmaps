// Das Drei-Strich-Menue in der Kopfzeile der Editor-Huelle (edit/index.php).
// Entwurf: docs/hauptleiste-menue-mockup.html
//
// 💣 Diese Datei baut das Menue NICHT -- sie ergaenzt es. Das Aufklappen ist ein natives
// <details>/<summary>: Klick, Enter, Leertaste, Fokus und der Vorlese-Zustand kommen vom
// Browser. Faellt dieses Skript aus, bleibt das Menue vollstaendig bedienbar. Hier stehen
// nur die zwei Handgriffe, die <details> von sich aus nicht kennt: „Klick daneben schliesst"
// und Esc.

(function () {
	"use strict";

	var menue = document.querySelector(".edit-shell__menu");
	if (!menue) {
		return;
	}

	function schliesse() {
		if (menue.open) {
			menue.open = false;
		}
	}

	// Ein Klick irgendwo sonst im Dokument klappt zu. `contains` haelt Klicks INNERHALB des
	// Menues heraus -- sonst schluckte der Riegel den Absende-Klick auf „Abmelden".
	document.addEventListener("click", function (ereignis) {
		if (!menue.open || menue.contains(ereignis.target)) {
			return;
		}
		schliesse();
	});

	// 💣 DER FALL, DEN „Klick daneben" NICHT SIEHT: unter der Leiste liegt die ganze Karte in
	// einem <iframe>, und ein Klick DORT erzeugt in diesem Dokument ueberhaupt kein Ereignis.
	// Das Menue bliebe offen ueber der Karte stehen, waehrend der Benutzer laengst woanders
	// arbeitet. Der Fokuswechsel ist das einzige Signal, das die Rahmengrenze ueberquert.
	window.addEventListener("blur", function () {
		var aktiv = document.activeElement;
		if (aktiv && aktiv.tagName === "IFRAME") {
			schliesse();
		}
	});

	// Esc schliesst und gibt den Fokus an den Knopf zurueck -- wer mit der Tastatur aufgeklappt
	// hat, steht sonst am Seitenanfang.
	document.addEventListener("keydown", function (ereignis) {
		if (ereignis.key !== "Escape" || !menue.open) {
			return;
		}
		schliesse();
		var knopf = menue.querySelector("summary");
		if (knopf) {
			knopf.focus();
		}
	});
}());
