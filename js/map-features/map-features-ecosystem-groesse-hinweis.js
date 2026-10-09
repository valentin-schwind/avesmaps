// Landschaften: der Hinweisstreifen „Fläche wird zu groß" (09.10.2026).
//
// Owner: „kannst du den leuten anzeigen, wenn sie zuviel punkte gemalt und KB produziert haben". Die
// Regel (Grenze, Stufen, Text) steht in ecosystem-groesse.js; hier steht nur, was sie anzeigt.
//
// 🔴 EIN STREIFEN, KEIN TOAST. Ein Toast verschwindet nach zwei Sekunden und kann keinen Knopf tragen --
// und der Pinsel speichert nach JEDEM Strich: als Toast käme die Warnung bei jedem Strich neu. Der
// Streifen steht, zählt beim nächsten Speichern einfach mit und trägt den Ausweg („Fläche vereinfachen")
// dort, wo man die Warnung liest. Dieselbe Überlegung wie beim Ansage-Streifen der Isolation daneben.
//
// Zwei Stufen, beide aus derselben Regel:
//   * „gross" (ab 75 %): gespeichert ist, aber bald nicht mehr -- gelb.
//   * „zu_gross" (über 128 KB): NICHT gespeichert -- rot. Der Riegel in postEcosystemEdit hat gar nicht
//     erst gesendet.
//
// ⚠️ Er geht von selbst weg, sobald DIESELBE Fläche wieder unter 75 % gespeichert wird (z. B. nach dem
// Vereinfachen). Wer ihn mit × schliesst, bekommt ihn für diese Fläche erst wieder, wenn sie um
// mindestens 8 KB wächst oder die Stufe kippt -- sonst stünde er nach jedem Pinselstrich wieder da.
(function avesmapsEcosystemGroesseHinweis() {
	"use strict";

	const WIEDER_ZEIGEN_AB_BYTES = 8 * 1024;

	let stand = null;        // { publicId, name, punkte, bytes, stufe }
	let geschlossen = null;  // { publicId, bytes, stufe } -- was der Editor weggeklickt hat
	let gebunden = false;

	const el = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);

	function satz(eintrag) {
		const zahlen = typeof avesmapsEcosystemGroesseText === "function"
			? avesmapsEcosystemGroesseText(eintrag.punkte, eintrag.bytes)
			: "";
		const werte = { name: eintrag.name || avesmapsGroesseTr("ecosystem.size.thisArea", "Diese Fläche"), zahlen };
		// Eine NEUE Fläche hat noch keinen Namen und keine Kennung -- eigener Satz statt „„“ ist zu groß".
		if (!eintrag.publicId) {
			return eintrag.stufe === "zu_gross"
				? avesmapsGroesseTr("ecosystem.size.newTooBig", "Die neue Fläche ist zu groß zum Speichern: {zahlen}. Gespeichert wurde nichts.", werte)
				: avesmapsGroesseTr("ecosystem.size.newBig", "Die neue Fläche wird groß: {zahlen} – bald vereinfachen.", werte);
		}
		return eintrag.stufe === "zu_gross"
			? avesmapsGroesseTr("ecosystem.size.tooBig", "„{name}“ ist zu groß zum Speichern: {zahlen}. Gespeichert wurde nichts.", werte)
			: avesmapsGroesseTr("ecosystem.size.big", "„{name}“ wird groß: {zahlen} – bald vereinfachen.", werte);
	}

	function kannVereinfachen(eintrag) {
		if (!eintrag || !eintrag.publicId || typeof window === "undefined") {
			return false;
		}
		const geladen = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			&& ecosystemLayers.has(String(eintrag.publicId));
		return geladen && typeof window.AvesmapsEcosystemSimplify?.open === "function";
	}

	function zeichnen() {
		const streifen = el("ecosystem-groesse-note");
		if (!streifen) {
			return;
		}
		binden();
		streifen.hidden = !stand;
		if (!stand) {
			return;
		}
		streifen.dataset.stufe = stand.stufe;
		const text = el("ecosystem-groesse-text");
		if (text) {
			text.textContent = satz(stand);
		}
		const knopf = el("ecosystem-groesse-vereinfachen");
		if (knopf) {
			knopf.hidden = !kannVereinfachen(stand);
		}
	}

	function binden() {
		if (gebunden) {
			return;
		}
		gebunden = true;
		el("ecosystem-groesse-vereinfachen")?.addEventListener("click", () => {
			if (stand && kannVereinfachen(stand)) {
				// 💣 Erst das laufende Werkzeug beenden: Pinsel und Ecken-Editor halten einen eigenen Stand
				// der Fläche, und das Fenster vereinfacht den GESPEICHERTEN. Liefe der Pinsel weiter, schickte
				// der nächste Strich wieder seine alte, zu große Arbeitsgeometrie. Was sich nicht speichern
				// liess, haben beide schon verworfen; was sich speichern lässt, schreiben sie beim Beenden weg.
				window.AvesmapsEcosystemBrush?.stop?.();
				if (typeof closeEcosystemGeometryEdit === "function") {
					closeEcosystemGeometryEdit({ flush: true });
				}
				window.AvesmapsEcosystemSimplify.open(stand.publicId);
			}
		});
		el("ecosystem-groesse-schliessen")?.addEventListener("click", () => {
			if (stand) {
				geschlossen = { publicId: stand.publicId, bytes: stand.bytes, stufe: stand.stufe };
			}
			stand = null;
			zeichnen();
		});
	}

	// Der eine Eingang: nach jedem Speicherversuch mit Geometrie (gelungen oder vom Riegel abgelehnt).
	// eintrag: { publicId ("" bei einer neuen Fläche), name, punkte, bytes }
	function melden(eintrag) {
		if (!eintrag || typeof avesmapsEcosystemGroesseStufe !== "function") {
			return;
		}
		const publicId = String(eintrag.publicId || "");
		const stufe = avesmapsEcosystemGroesseStufe(eintrag.bytes);
		// Eine eben GESPEICHERTE neue Fläche erledigt den Hinweis über die abgelehnte neue Fläche davor --
		// sonst stünde nach dem Erfolg weiter „Gespeichert wurde nichts".
		if (eintrag.ersetztNeu && stand && stand.publicId === "") {
			stand = null;
			zeichnen();
		}
		if (stufe === "ok") {
			// Wieder im grünen Bereich: ein Hinweis über GENAU diese Fläche hat sich erledigt.
			if (stand && stand.publicId === publicId) {
				stand = null;
				zeichnen();
			}
			if (geschlossen && geschlossen.publicId === publicId) {
				geschlossen = null;
			}
			return;
		}
		const weggeklickt = geschlossen && geschlossen.publicId === publicId && geschlossen.stufe === stufe
			&& Number(eintrag.bytes) < geschlossen.bytes + WIEDER_ZEIGEN_AB_BYTES;
		if (weggeklickt) {
			return;
		}
		geschlossen = null;
		stand = { publicId, name: String(eintrag.name || ""), punkte: Number(eintrag.punkte) || 0, bytes: Number(eintrag.bytes) || 0, stufe };
		zeichnen();
	}

	if (typeof window !== "undefined") {
		window.avesmapsEcosystemGroesseMelden = melden;
		// Für die Prüfung: was der Streifen gerade sagt.
		window.avesmapsEcosystemGroesseHinweisStand = () => (stand ? { ...stand, satz: satz(stand) } : null);
	}
})();
