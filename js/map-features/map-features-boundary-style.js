"use strict";

/*
 * Ebenenbasierte Linienstil-Presets für politische Aussengrenzen (Phase B, Schritt 1).
 *
 * Ziel (Europa-Analogie): eine Reichsgrenze sieht anders aus als eine
 * Grafschaftsgrenze (Landes- vs. Bundesgrenze). Die Tiefe in der
 * Wiki-Affiliation bestimmt den Stil: oberste Ebene dick, tiefere Ebenen
 * duenner / gestrichelt.
 *
 * Bewusst klein und reversibel:
 * - Wirkt vorerst NUR auf abgeleitete Aussengrenzen (is_derived_geometry),
 *   nicht auf die manuell gepflegten Quellgeometrien.
 * - Rein clientseitig, kein Schema, keine Persistenz. Später kommt die
 *   wählbare/persistente Stil-Wahl pro Territorium (eigene Tabelle, mit dem
 *   Nutzer abzustimmen).
 *
 * Fuellung (color/opacity) bleibt unangetastet -- dieses Modul liefert nur
 * Linien-Eigenschaften (weight, dashArray).
 */
(function initAvesmapsBoundaryStyle() {
	// Index 0 = oberste Ebene (Reich). Danach zunehmend feiner.
	const LEVEL_PRESETS = [
		{ weight: 4, dashArray: null },   // Reich / Wurzel
		{ weight: 3, dashArray: null },   // 2. Ebene (z. B. Herzogtum/Bergfreischaft)
		{ weight: 2, dashArray: "6 4" },  // 3. Ebene (Grafschaft) gestrichelt
		{ weight: 2, dashArray: "3 3" },  // 4. Ebene feiner gestrichelt
	];
	const DEEPEST_PRESET = { weight: 1, dashArray: "2 3" };

	// Bestimmt die Hierarchie-Tiefe eines regionEntry aus der Wiki-Affiliation.
	// 0 = oberste Ebene. Fällt auf 0 zurück, wenn keine Pfadinfo vorhanden ist.
	function levelOf(regionEntry) {
		const path = Array.isArray(regionEntry?.affiliationPath) ? regionEntry.affiliationPath : [];
		// affiliationPath enthält die Vorfahrenkette (ohne den Knoten selbst);
		// laenge = Anzahl Vorfahren = Tiefe.
		const depth = path.length;
		return Number.isFinite(depth) && depth >= 0 ? depth : 0;
	}

	function presetForLevel(level) {
		if (level < LEVEL_PRESETS.length) return LEVEL_PRESETS[level];
		return DEEPEST_PRESET;
	}

	// Liefert { weight, dashArray } oder null, wenn dieses Modul für den Eintrag
	// (noch) keinen ebenenbasierten Stil vorgibt.
	function lineStyleFor(regionEntry) {
		if (!regionEntry || regionEntry.isDerivedGeometry !== true) {
			return null;
		}
		// SICHERHEIT: Die verlaessliche Hierarchie-Tiefe-Quelle ist noch offen.
		// affiliationPath ist der Wiki-Zugehoerigkeitspfad und entspricht NICHT
		// der politischen Ebenen-Tiefe (Wurzel-Reiche haben dort schon Laenge >0).
		// Bis die Tiefe-Quelle mit dem Nutzer geklaert ist, geben wir keinen
		// ebenenbasierten Stil vor -> Renderer fällt auf das bewaehrte Verhalten
		// zurück. So rendert nichts mit falscher Ebene.
		if (!levelSourceIsReliable()) {
			return null;
		}
		return presetForLevel(levelOf(regionEntry));
	}

	// Solange false: ebenenbasierter Stil ist deaktiviert (kein Live-Risiko).
	// Wird true, sobald eine verlaessliche Tiefe-Quelle feststeht (z. B. eine
	// politische Ancestor-Kette oder ein explizites level-Feld im Layer-Feature).
	function levelSourceIsReliable() {
		return false;
	}

	window.AvesmapsBoundaryStyle = {
		lineStyleFor,
		levelOf,
		LEVEL_PRESETS,
		DEEPEST_PRESET,
	};
})();
