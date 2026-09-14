// Der Dialog „Weg bearbeiten" fuer die GANZE Strasse (Entwurf 2026-09-14 §3.5) -- die reinen Teile. Die Regeln selbst
// (was uneinig ist, was angefasst wurde, welcher Rumpf) stehen im Modell des Wege-Editors (wpGroupFieldStates,
// wpGroupRumpf in js/pages/wege-editor-model.js); hier nur der Weg von den Kartenpfaden dorthin.
// ⚠️ Normales Skript, NICHT in <template data-nur-editor> (nur-editor-skripte.test.js, Teil C).

/**
 * REIN: Kartenpfade als Zeilen fuer wpGroupFieldStates.
 * @param {{name?: Function, zeigeName?: Function, transporte?: Function}} lesen  die Leser der Karte
 */
function avesmapsPathGruppeZeilen(pfade, lesen) {
	const l = lesen || {};
	return (Array.isArray(pfade) ? pfade : []).map((pfad) => {
		const p = (pfad && pfad.properties) || {};
		return {
			public_id: String(p.public_id || ""),
			// 💣 Ohne Leser der ECHTE Name: properties.name traegt im Browser den Maschinennamen <Wegart>-<n>.
			name: typeof l.name === "function" ? String(l.name(pfad) || "") : String(p.display_name || p.original_name || p.name || ""),
			show_label: typeof l.zeigeName === "function" ? l.zeigeName(pfad) === true : p.show_label === true,
			feature_subtype: String(p.feature_subtype || ""),
			allowed_transports: typeof l.transporte === "function" ? (l.transporte(pfad) || []).slice() : [],
		};
	});
}

/** REIN: „Speichern für 10 Abschnitte" -- ein Abschnitt heisst nur „Speichern". */
function avesmapsPathGruppeKnopfText(anzahl) {
	const n = Number(anzahl) || 0;
	return n > 1 ? "Speichern für " + n + " Abschnitte" : "Speichern";
}

/** REIN: der Hinweis an einem halben Haken, „teils · 7 von 10". */
function avesmapsPathGruppeTeilsText(zustand) {
	return "teils · " + Number((zustand && zustand.an) || 0) + " von " + Number((zustand && zustand.gesamt) || 0);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsPathGruppeZeilen, avesmapsPathGruppeKnopfText, avesmapsPathGruppeTeilsText };
}
