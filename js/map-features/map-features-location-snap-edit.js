// Alt+Ziehen einer Kreuzung (oder eines Orts -- derselbe Ziehweg): beim Loslassen rastet sie auf die
// nächste Ecke einer SICHTBAREN Landschaftsfläche ein, sonst auf den nächsten Punkt ihrer Umrisslinie.
// Ohne Alt rastet nichts ein. Anlass (Discord, 2026-10-15): „um Mündungen exakt mit dem Meer oder Seen
// zu verbinden" -- und mit Taste, weil ein Schnappen ohne Taste auch jede Kreuzung an einer Straße an
// den nächsten Waldrand zöge. Owner-GO 2026-10-15.
//
// 🔴 ALT, NICHT STRG. Strg heißt beim Ziehen eines Orts schon „angeschlossene Wege bleiben liegen"
// (Discord #43, map-features-location-detach-edit.js) -- und für eine Mündung wäre genau das falsch: die
// Kreuzung säße am Meeresrand, das Flussende bliebe zurück. Bei den Landschaftsflächen heißt Strg
// außerdem „NICHT schnappen"; Strg als „schnappen" stünde an zwei Stellen für das Gegenteil.
// ⚠️ Die beiden Tasten sind unabhängig: Alt und Strg zusammen rasten ein UND lassen die Wege liegen.
// 💣 SHIFT GEHT NICHT: Leaflets Draggable._onDown gibt bei gedrückter Shift-Taste auf und überlässt den
// Druck dem Zoom-Rahmen -- der Marker ließe sich gar nicht erst ziehen.
//
// 🔴 KEINE ZWEITE SCHNAPP-REGEL. Reichweite (10 Bildschirmpixel), „Ecke vor Kante" und der Vorschau-Ring
// kommen aus dem Landschaften-Editor (ecosystemEditSnapTarget und Nachbarn); hier steht nur, WANN gefragt
// wird. Flüsse sind ausdrücklich kein Ziel (`mitFluessen: false`, dort begründet).
//
// 🔴 ZIEL SIND NUR DIE FLÄCHEN, DIE MAN SIEHT: Ansicht „Landschaften", sichtbare Ebene(n) -- dieselbe
// Menge, an der eine Flächenecke einrastet. In jeder anderen Ansicht ist der Flächenspeicher
// (`ecosystemLayers`) leer -- syncEcosystemVisibility leert ihn beim Verlassen --, und ein Hinweis sagt,
// warum nichts passiert, statt dass Alt wortlos ins Leere läuft. Die Ansichtsfrage in flaechenSichtbar()
// ist doppelte Absicherung, falls die Leerung je ausbleibt.
// 🔧 Offen: der Haken „Flüsse" blendet See-Flächen nur per Klasse aus; sie bleiben im Speicher und damit
// ein Ziel -- für eine Kreuzung wie für eine Flächenecke (dieselbe Regel).
// ⚠️ Gemeint ist die LINKE Alt-Taste. AltGr meldet unter Windows Strg+Alt und löst damit zusätzlich das
// Liegenlassen der Wege aus (Windows-Eigenart, hier nicht gemessen).
//
// 💣 GESPEICHERT WIRD ÜBER DEN EINEN TRICHTER. Zwei Ziehwege münden in saveMovedLocationMarker (die
// normalen Ortsmarker in routing.js, neu angelegte Punkte in map-features-location-marker-entry.js), und
// genau dort wird das Ziel abgeholt -- wie die Strg-Absicht daneben. An einem der beiden dragend-Handler
// hängend, wäre der andere stumm geblieben.
(function initializeLocationSnapEditing() {
	let altGedrueckt = false;
	// Hat UNSER keydown die Alt-Taste geschluckt? Nur dann auch ihr keyup -- sonst nähmen wir dem Browser
	// eine Taste weg, die er mit uns nie geteilt hat.
	let altUnterdrueckt = false;
	let scharfgestellt = null;
	let ziehtGerade = null;
	let hinweisGezeigt = false;

	function istVerfuegbar() {
		return typeof IS_EDIT_MODE !== "undefined"
			&& Boolean(IS_EDIT_MODE)
			&& typeof L !== "undefined"
			&& typeof map !== "undefined"
			&& Boolean(map);
	}

	// --- die Ziele ------------------------------------------------------------------------------

	function flaechenSichtbar() {
		if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
			return false;
		}

		return typeof ecosystemEditSnapCandidates === "function" && ecosystemEditSnapCandidates("").length > 0;
	}

	// { latLng, kind } oder null. [lat, lng] hinein, [lat, lng] heraus.
	function schnappZiel(latLng) {
		if (!latLng || !flaechenSichtbar() || typeof ecosystemEditSnapTarget !== "function") {
			return null;
		}

		return ecosystemEditSnapTarget(L.latLng(latLng), "", { mitFluessen: false });
	}

	// --- der Ring ---------------------------------------------------------------------------------

	function ringWeg() {
		if (typeof clearEcosystemEditSnapPreview === "function") {
			clearEcosystemEditSnapPreview();
		}
	}

	function hinweisOhneFlaechen() {
		if (hinweisGezeigt || typeof showFeedbackToast !== "function") {
			return;
		}

		hinweisGezeigt = true;
		showFeedbackToast("Einrasten (Alt) geht nur in der Ansicht Landschaften, an den sichtbaren Flächen.", "info");
	}

	function ringNachziehen() {
		if (!ziehtGerade) {
			return;
		}
		if (!altGedrueckt) {
			ringWeg();
			return;
		}
		if (!flaechenSichtbar()) {
			ringWeg();
			hinweisOhneFlaechen();
			return;
		}
		if (typeof renderEcosystemEditSnapPreview === "function") {
			renderEcosystemEditSnapPreview(schnappZiel(ziehtGerade.marker.getLatLng()));
		}
	}

	// --- die Taste --------------------------------------------------------------------------------

	function istAlt(event) {
		return event?.key === "Alt";
	}

	document.addEventListener("keydown", (event) => {
		if (!istAlt(event)) {
			return;
		}

		altGedrueckt = true;
		// 💣 Windows-Browser springen beim Loslassen einer ALLEIN gedrückten Alt-Taste ins Browsermenü.
		// Solange ein Marker zum Ziehen bereitsteht, gehört die Taste dem Einrasten -- und nur dann.
		if (scharfgestellt) {
			event.preventDefault();
			altUnterdrueckt = true;
		}
		ringNachziehen();
	}, true);

	document.addEventListener("keyup", (event) => {
		if (!istAlt(event)) {
			return;
		}

		altGedrueckt = false;
		if (altUnterdrueckt) {
			event.preventDefault();
			altUnterdrueckt = false;
		}
		ringNachziehen();
	}, true);

	// Ein Fensterwechsel verschluckt das keyup -- ohne das bliebe Alt hängen, und der nächste Zug rastete
	// ungefragt ein.
	window.addEventListener("blur", () => {
		altGedrueckt = false;
		altUnterdrueckt = false;
		ringWeg();
	});

	// --- der Zug ------------------------------------------------------------------------------------

	function verdrahteMarker(markerEntry) {
		const marker = markerEntry?.marker;
		if (!marker || marker._avesmapsSnapTrackingWired) {
			return;
		}

		marker._avesmapsSnapTrackingWired = true;
		marker.on("dragstart", () => {
			if (scharfgestellt !== markerEntry) {
				return;
			}
			ziehtGerade = markerEntry;
			hinweisGezeigt = false;
		});
		marker.on("drag", (event) => {
			if (ziehtGerade !== markerEntry) {
				return;
			}
			// Die Mausbewegung trägt den ECHTEN Stand der Taste -- auch wenn ihr keydown nie ankam (Alt
			// schon gedrückt, bevor das Fenster den Fokus hatte).
			const altAmZeiger = event?.originalEvent?.altKey;
			if (typeof altAmZeiger === "boolean") {
				altGedrueckt = altAmZeiger;
			}
			ringNachziehen();
		});
	}

	window.avesmapsArmLocationSnapTracking = function avesmapsArmLocationSnapTracking(markerEntry) {
		if (!istVerfuegbar() || !markerEntry?.marker) {
			return;
		}

		scharfgestellt = markerEntry;
		ziehtGerade = null;
		verdrahteMarker(markerEntry);
	};

	window.avesmapsDisarmLocationSnapTracking = function avesmapsDisarmLocationSnapTracking() {
		scharfgestellt = null;
		ziehtGerade = null;
		ringWeg();
	};

	// Einmal je Speichern, aus saveMovedLocationMarker: die eingerastete Position oder null.
	// 🔴 Nur für den Marker, der GERADE GEZOGEN wurde. Der Weg über eine Änderungsmeldung
	// (review-editor-submit.js) ruft denselben Trichter ohne jedes Ziehen -- dort darf nichts einrasten.
	// 🔴 Entschieden wird an der Taste BEIM LOSLASSEN, wie bei der Flächenecke: was der Ring zuletzt
	// zeigte, ist, wo der Marker landet. Wer Alt vor der Maus loslässt, sieht den Ring verschwinden und
	// bekommt die freie Position.
	window.avesmapsConsumeLocationSnapLatLng = function avesmapsConsumeLocationSnapLatLng(markerEntry, latLng) {
		if (!ziehtGerade || ziehtGerade !== markerEntry) {
			return null;
		}

		ziehtGerade = null;
		ringWeg();
		if (!altGedrueckt) {
			return null;
		}

		const ziel = schnappZiel(latLng);
		return ziel ? ziel.latLng : null;
	};
})();
