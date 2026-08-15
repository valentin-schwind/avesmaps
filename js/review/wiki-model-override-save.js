// Die Speicher-Entscheidung der Override-Maske des Hierarchiemodells („Wiki-Daten und Eigene
// Overrides", html/wiki-sync-monitor.html). Herausgeloest, damit sie ohne Browser pruefbar ist —
// die Seite ist eine Standalone-Seite mit Inline-Skript, und genau dort lag Fall #72 unbemerkt.
//
// 💣 Der Server liefert `name` und `continent` GEFALTET aus: sync-monitor-tree.php setzt
// name = Staging-Name ?? Override-Name ?? wiki_key und continent = Dump-Wert ?? „Aventurien"
// (letzteres nur fuer eigene Knoten, sonst filtert der Editor sie weg). Wer diese Felder fuer
// den Wiki-Stand haelt, vergleicht bei einem eigenen Knoten den Override mit sich selbst — und
// der Zweig „gleich -> Override loeschen" loescht dann den Namen, den niemand angefasst hat.
// Der ROHE Stand steht deshalb getrennt in wiki_name/wiki_continent.
//
// ⚠️ Fehlt das rohe Feld (aeltere Antwort im Cache), gilt LEER — nie der Rueckfall auf das
// gefaltete Feld. Leer fuehrt in den harmlosen „setzen"-Zweig, der Rueckfall in den loeschenden.
//
// Test: js/review/__tests__/wiki-model-override-save.test.js

"use strict";

// Felder, in die der Server bereits etwas hineinfaltet -> ihr roher Stand steht woanders.
const AVESMAPS_WIKI_MODEL_RAW_FIELD_ALIAS = {
	name: "wiki_name",
	continent: "wiki_continent",
};

function avesmapsWikiModelRawValue(node, fieldKey) {
	if (!node || !fieldKey) {
		return "";
	}

	const aliasKey = AVESMAPS_WIKI_MODEL_RAW_FIELD_ALIAS[fieldKey];
	if (aliasKey) {
		const aliased = Object.prototype.hasOwnProperty.call(node, aliasKey) ? node[aliasKey] : null;
		return aliased === null || typeof aliased === "undefined" ? "" : String(aliased);
	}

	const value = node[fieldKey];
	return value === null || typeof value === "undefined" ? "" : String(value);
}

function avesmapsWikiModelHasOverride(node, fieldKey) {
	return !!(node && node.overrides && Object.prototype.hasOwnProperty.call(node.overrides, fieldKey));
}

// Aus den Formularfeldern die Liste der Endpunkt-Aufrufe bauen. Jedes Feld ist
// { key, value, initialValue, clearWhenEmpty? }; `initialValue` ist der Wert, mit dem das Feld
// GERENDERT wurde (im DOM: input.defaultValue bzw. die option mit defaultSelected).
function avesmapsWikiModelPlanOverrideSaves(node, fields) {
	const plan = [];
	const list = Array.isArray(fields) ? fields : [];

	for (const field of list) {
		const fieldKey = String((field && field.key) || "");
		if (!fieldKey) {
			continue;
		}

		const value = String((field && field.value) ?? "");
		const initialValue = String((field && field.initialValue) ?? "");

		// 💣 Fall #72: ein Feld, das der Benutzer nicht angefasst hat, loest gar nichts aus.
		// Ohne diese Zeile entschied ein Wertvergleich ueber einen Override, den niemand
		// bearbeiten wollte — und loeschte ihn.
		if (value === initialValue) {
			continue;
		}

		// „— (Wiki)" beim Kontinent heisst KEIN Override; ein leerer Wert darf dort nie als
		// Override geschrieben werden, auch nicht bei gefuelltem Wiki-Stand.
		if (field.clearWhenEmpty === true && value === "") {
			if (avesmapsWikiModelHasOverride(node, fieldKey)) {
				plan.push({ action: "clear_field_override", fieldKey });
			}
			continue;
		}

		if (value === avesmapsWikiModelRawValue(node, fieldKey)) {
			if (avesmapsWikiModelHasOverride(node, fieldKey)) {
				plan.push({ action: "clear_field_override", fieldKey });
			}
			continue;
		}

		plan.push({ action: "set_field_override", fieldKey, value });
	}

	return plan;
}

if (typeof window !== "undefined") {
	window.avesmapsWikiModelRawValue = avesmapsWikiModelRawValue;
	window.avesmapsWikiModelHasOverride = avesmapsWikiModelHasOverride;
	window.avesmapsWikiModelPlanOverrideSaves = avesmapsWikiModelPlanOverrideSaves;
}
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikiModelRawValue,
		avesmapsWikiModelHasOverride,
		avesmapsWikiModelPlanOverrideSaves,
	};
}
