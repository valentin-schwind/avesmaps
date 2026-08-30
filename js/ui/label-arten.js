/*
 * Die ART einer Beschriftung als deutsches Wort -- EINE Tabelle.
 * =============================================================
 * "Was fuer ein Ding ist dieses Label?" wurde im Haus an VIER Stellen beantwortet, jede mit
 * ihrer eigenen Abschrift: das Auswahlfeld des Label-Editors (#label-edit-type in index.html),
 * die Spotlight-Suche (getSpotlightLabelTypeLabel), der Meldedialog (review-panels.js) und die
 * Kartensuche auf dem Server (api/app/map-search.php). Die Abschriften waren messbar
 * auseinandergelaufen -- live am 28.08.2026 gezaehlt:
 *
 *   - 70 Beschriftungen hiessen in der Suche schlicht "Label", weil ihre Art in der dortigen
 *     Tabelle fehlte (flussland_flusstal 33, dschungel 13, wuestenoase 9, tiefebene 5,
 *     hochebene 4, wadi 4, flussdelta 2).
 *   - "wueste" stand dort ohne Umlaut ("Wueste"), im Auswahlfeld mit ("Wueste"/"Wüste").
 *
 * 🔴 DAS AUSWAHLFELD IST DIE QUELLE. Diese Tabelle ist Zeichen fuer Zeichen die Liste, aus der
 * ein Editor die Art waehlt -- eine neue Art wird dort UND hier eingetragen, und
 * js/ui/__tests__/label-arten.test.js haelt beide gegeneinander. Genau dieselbe Begruendung
 * steht ueber labelPopupSubtitle (js/ui/popups.js), die das Auswahlfeld direkt ausliest: "eine
 * neue Kategorie waere sonst sofort in einem der beiden Orte vergessen."
 *
 * ⚠️ Die Tabelle traegt NUR das Vokabular, nie die Rueckfall-Politik. Was passiert, wenn eine
 * Art unbekannt ist, entscheidet der Aufrufer -- und das unterscheidet sich zu Recht: die
 * Suchzeile MUSS etwas anzeigen ("Label"), die Infobox hat mit der Wiki-Art eine eigene Kette
 * davor. Ein gemeinsamer Rueckfall waere genau die Divergenz, die diese Datei abschafft.
 *
 * ⚠️ Und sie uebersetzt nicht. Die englische Fassung steht als "spotlight.labelType.<art>" in
 * js/app/i18n-en.js; wer den Namen ANZEIGT, legt tr() darum. Wer ihn als SCHLUESSEL benutzt
 * (das Kopfbild der Infobox schlaegt ueber die deutsche Art nach), nimmt ihn roh.
 */

const AVESMAPS_LABEL_ART_NAMEN = {
	auenlandschaft: "Auenlandschaft",
	berggipfel: "Berggipfel",
	dschungel: "Dschungel",
	ebene: "Ebene",
	fluss: "Fluss",
	flussdelta: "Flussdelta",
	flussland_flusstal: "Flussland/Flusstal",
	gebirge: "Gebirge",
	graslandschaft: "Graslandschaft",
	hochebene: "Hochebene",
	huegelland: "Hügelland",
	insel: "Insel",
	inselgruppe: "Inselgruppe",
	kontinent: "Kontinent",
	kulturlandschaft: "Kulturlandschaft",
	kueste: "Küste",
	meer: "Meer",
	region: "Region",
	schlucht: "Schlucht",
	see: "See",
	sonstiges: "Sonstiges",
	steppe: "Steppe",
	suempfe_moore: "Sümpfe & Moore",
	tal: "Tal",
	tiefebene: "Tiefebene",
	tundra: "Tundra",
	urwald: "Urwald",
	vulkan: "Vulkan",
	wadi: "Wadi",
	wald: "Wald",
	wueste: "Wüste",
	wuestenoase: "Wüstenoase",
};

/**
 * Der deutsche Name einer Label-Art.
 *
 * @param {string} labelType der gespeicherte Schluessel (map_features.feature_subtype)
 * @returns {string} der Name, oder "" fuer eine unbekannte/leere Art -- der Aufrufer entscheidet
 */
function avesmapsLabelArtName(labelType) {
	const key = String(labelType === null || labelType === undefined ? "" : labelType).trim();
	return Object.prototype.hasOwnProperty.call(AVESMAPS_LABEL_ART_NAMEN, key)
		? AVESMAPS_LABEL_ART_NAMEN[key]
		: "";
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { AVESMAPS_LABEL_ART_NAMEN, avesmapsLabelArtName };
}
