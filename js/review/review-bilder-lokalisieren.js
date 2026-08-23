/*
 * „🖼️ Bilder lokalisieren" -- treibt den Lauf, der jedes fehlende Wiki-Bild EINMAL auf unsere
 * Platte holt (Ortswappen, Regionen- und Wege-Bilder).
 *
 * 🔴 DER CLIENT TREIBT DIE WIEDERHOLUNG, nicht der Server. STRATO hat keinen Cron, und ein langer
 * Lauf in einem Request belegt einen PHP-Worker -- dieselbe Bauform wie „Dump holen" und der
 * Autoget-Lauf (AGENTS.md §10). Der Server holt je Aufruf einen kleinen Schub und meldet, wie
 * viele noch offen sind.
 *
 * ⭐ Hausform „Status IN den Knopf": der Fortschritt steht im Knopf, nicht daneben.
 *
 * 💣 KEINE ENDLOSSCHLEIFE OHNE FORTSCHRITT. Bewegt sich `remaining` zwei Schuebe lang nicht,
 * bricht der Lauf ab. Ohne diese Bremse liefe er bei einem Serverfehler ewig weiter und schickte
 * genau die Flut ans Wiki, die dieses Feature beenden soll.
 */

(function () {
	"use strict";

	var ENDPUNKT = "api/edit/wiki/bilder-lokalisieren.php";
	var knopf = null;
	var laeuft = false;
	var ruhelabel = "🖼️ Bilder lokalisieren";

	function setze(text) {
		if (knopf) {
			knopf.textContent = text;
		}
	}

	function ruf(action) {
		return fetch(ENDPUNKT, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: action })
		}).then(function (antwort) {
			return antwort.json().then(function (nutzlast) {
				// 💣 Ein Fehler muss ABLEHNEN, nie mit etwas Leerem aufloesen -- sonst liest der
				// Aufrufer „0 offen" als „fertig" und meldet Erfolg, wo keiner war.
				if (!antwort.ok || !nutzlast || nutzlast.ok !== true) {
					throw new Error((nutzlast && nutzlast.error && nutzlast.error.message) || ("HTTP " + antwort.status));
				}
				return nutzlast;
			});
		});
	}

	function zeigeStand() {
		if (laeuft || !knopf) {
			return;
		}
		ruf("status").then(function (s) {
			var offen = Number(s.remaining || 0);
			setze(offen > 0 ? ruhelabel + " — " + offen + " offen" : ruhelabel + " — ✓ alle lokal");
		}).catch(function () {
			// Still: der Knopf behaelt seine Ruhebeschriftung. Wer nicht angemeldet ist, sieht
			// hier keinen Fehler, sondern schlicht keinen Stand.
			setze(ruhelabel);
		});
	}

	function lauf() {
		if (laeuft) {
			return;
		}
		laeuft = true;
		var geholt = 0;
		var tot = 0;
		var letztesOffen = -1;
		var ohneFortschritt = 0;

		function schub() {
			return ruf("run").then(function (r) {
				geholt += Number(r.geholt || 0);
				tot += Number(r.tot || 0);
				var offen = Number(r.remaining || 0);
				setze("🖼️ Lädt… " + geholt + " geholt, noch " + offen);

				// 💣 Die Bremse: bewegt sich nichts, wird abgebrochen.
				if (offen === letztesOffen) {
					ohneFortschritt++;
				} else {
					ohneFortschritt = 0;
				}
				letztesOffen = offen;

				if (offen > 0 && ohneFortschritt < 2) {
					return schub();
				}
				return null;
			});
		}

		schub().then(function () {
			var teile = [];
			if (geholt > 0) { teile.push(geholt + " geholt"); }
			if (tot > 0) { teile.push(tot + " nicht im Wiki"); }
			setze(ruhelabel + " — " + (teile.length ? teile.join(", ") : "nichts zu tun"));
		}).catch(function (fehler) {
			setze("🖼️ Fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : "unbekannt"));
		}).then(function () {
			laeuft = false;
			window.setTimeout(zeigeStand, 4000);
		});
	}

	function start() {
		knopf = document.getElementById("wiki-sync-images-localize");
		if (!knopf) {
			return;
		}
		knopf.addEventListener("click", lauf);
		zeigeStand();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
