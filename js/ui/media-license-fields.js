// Der EINE Markup-Bauer der fünf Lizenz-Dialoge.
//
// 💣 Fünf Oberflächen zeigen dieselbe Reihe -- Lizenz, Urheber, Kommentar, darunter das Protokoll.
// Sobald eine davon ihr Markup selbst schreibt, laufen sie auseinander. Das Haus hat das mit der
// Listenzeile in SIEBEN Rezepturen bezahlt, eine davon mit dem Kommentar "Referenz .se-row" über
// sich, und beim Abschreiben fiel die Schriftgröße unter die 11px-Grenze (AGENTS §11).
//
// Die WERTE kommen aus js/app/media-licenses.js und werden hier nie abgeschrieben.
//
// Form: die Reihe folgt .ce-row aus html/citymap-editor.html (Label links in fester Breite, Feld
// rechts, EIN Feld je Zeile) -- das trifft "Lizenz · Urheber · Kommentar" direkter als die kompakte
// Bild-Mini-Box .dt-img-license aus html/wiki-sync-settlement-editor.html, die für EIN Bild neben
// seinem Vorschaubild gedacht ist, nicht für eine eigenständige Feldgruppe. Eigener Klassenname
// (.mlf-*) statt .ce-row: dessen Regeln stehen bislang NUR lokal in citymap-editor.html, eine
// gleichnamige zweite Fassung wäre die Divergenz, vor der AGENTS §10 warnt (political-territory-
// editor-inline.css, dreimal danebengegangen). Die CSS-Regeln liegen deshalb einmal in
// css/components/editor-page.css, das alle vier Editorseiten ohnehin schon binden.

// Der Katalog ist im Browser ein Global (die vier Editorseiten laden media-licenses.js VOR dieser
// Datei). In Node gibt es das nicht, also wird er hier nachgereicht -- VOR den Funktionen, damit
// beide Welten denselben Namen sehen. Gleiche Form wie js/routing/transport-season.js mit
// travel-calendar.js: nicht "aufraeumen", ohne das laeuft dieser Test ins Leere.
if (typeof module !== "undefined" && module.exports) {
	const katalog = require("../app/media-licenses.js");
	global.AVESMAPS_MEDIA_LICENSES = katalog.AVESMAPS_MEDIA_LICENSES;
	global.AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE = katalog.AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE;
	global.avesmapsMediaLicenseNormalize = katalog.avesmapsMediaLicenseNormalize;
}

/** HTML-Maskierung -- Urheber und Kommentar sind freier Editortext. */
function avesmapsMediaLicenseEscape(wert) {
	return String(wert == null ? "" : wert)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Die Reihe für einen Dialog.
 * @param {{license?:string, author?:string, note?:string, uploaded_by?:string, uploaded_at?:string}} werte
 * @param {{prefix:string, vorgabe:string, mitNotiz?:boolean}} optionen
 */
function avesmapsMediaLicenseFieldsMarkup(werte, optionen) {
	const w = werte || {};
	const o = optionen || {};
	const prefix = String(o.prefix || "ml");
	// 🔴 Der gespeicherte Wert schlägt die Vorgabe; ein leerer oder fremder fällt auf sie zurück.
	const gewaehlt = avesmapsMediaLicenseNormalize(w.license, o.vorgabe || "unknown_other");

	const optionen_html = AVESMAPS_MEDIA_LICENSES.map(function (e) {
		// ⚠️ KEIN disabled für die stillen Werte: "wird nicht angezeigt" heißt nicht "nicht wählbar".
		// Der Editor trägt die Angabe vollständig ein, nur die Veröffentlichung unterbleibt. Eine
		// eigene Klasse markiert sie dezent (gedämpfte Schrift, kein Riegel).
		return '<option value="' + e.value + '"' + (e.value === gewaehlt ? " selected" : "")
			+ (e.public ? "" : ' class="mlf-option--muted"') + ">"
			+ avesmapsMediaLicenseEscape(e.label) + "</option>";
	}).join("");

	// --- MARKUP 1: die Auswahlzeile (data-<prefix>-license) ---------------------------------------
	const lizenzZeile = '<div class="mlf-row">'
		+ '<span class="mlf-row__label">Lizenz</span>'
		+ '<select class="mlf-select" data-' + prefix + '-license'
		+ ' title="Bestimmt, ob die Angabe im Frontend erscheint">'
		+ optionen_html
		+ '</select></div>';

	// --- MARKUP 2: die Urheber-Zeile (data-<prefix>-author), IMMER da, bei jedem Wert -------------
	const urheberZeile = '<div class="mlf-row">'
		+ '<span class="mlf-row__label">Urheber</span>'
		+ '<input type="text" class="mlf-input" data-' + prefix + '-author'
		+ ' value="' + avesmapsMediaLicenseEscape(w.author) + '"'
		+ ' placeholder="Name oder Kürzel"></div>';

	// --- MARKUP 3: die Kommentar-Zeile (data-<prefix>-note), nur wenn o.mitNotiz ------------------
	const kommentarZeile = o.mitNotiz
		? '<div class="mlf-row">'
			+ '<span class="mlf-row__label">Kommentar</span>'
			+ '<textarea class="mlf-textarea" data-' + prefix + '-note rows="2"'
			+ ' placeholder="Kommentar, z. B. Quelle oder KI-Prompt">'
			+ avesmapsMediaLicenseEscape(w.note) + '</textarea></div>'
		: "";

	// Darunter avesmapsMediaLicenseProtokollZeile(w.uploaded_by, w.uploaded_at).
	return '<div class="mlf-fields">'
		+ lizenzZeile + urheberZeile + kommentarZeile
		+ avesmapsMediaLicenseProtokollZeile(w.uploaded_by, w.uploaded_at)
		+ '</div>';
}

/**
 * "hochgeladen von X am TT.MM.JJJJ" -- oder nichts, wenn beides fehlt.
 * ⚠️ Fehlt nur der Name, heißt er "unbekannt". Phase 2 hat ihn dort bewusst leer gelassen, wo er
 * nicht belegbar war -- ein erfundener wäre von einem echten nicht zu unterscheiden.
 */
function avesmapsMediaLicenseProtokollZeile(uploadedBy, uploadedAt) {
	const name = String(uploadedBy || "").trim();
	const zeit = String(uploadedAt || "").trim();
	if (name === "" && zeit === "") {
		return "";
	}
	// Beide Formen aus Phase 2 lesen: "2026-08-16 14:54:17" (Spalten) und "2026-08-16T14:54:17Z" (JSON).
	const t = zeit.match(/^(\d{4})-(\d{2})-(\d{2})/);
	const datum = t ? t[3] + "." + t[2] + "." + t[1] : "";

	// --- MARKUP 4: die graue Zeile ---------------------------------------------------------------
	const anzeigeName = avesmapsMediaLicenseEscape(name === "" ? "unbekannt" : name);
	const datumTeil = datum === "" ? "" : " am " + datum;
	return '<div class="mlf-protocol">hochgeladen von ' + anzeigeName + datumTeil + '</div>';
}

/**
 * Der Vorschlagstext für "Genehmigung erteilt".
 * 💣 NUR in ein leeres Feld, nie über einen vorhandenen Text -- sonst überschreibt eine
 * Lizenzänderung die Notiz, die der Editor gerade getippt hat.
 */
function avesmapsMediaLicenseNoteVorschlag(license, aktuelleNotiz) {
	if (String(aktuelleNotiz || "").trim() !== "") {
		return aktuelleNotiz;
	}

	return license === "permission_granted" ? AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE : (aktuelleNotiz || "");
}

// Node-Export (im Browser wirkungslos, dort sind es Globals der Editorseiten) -- er ist es, der den
// Test das echte Markup prüfen lässt statt einer abgetippten Kopie.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsMediaLicenseFieldsMarkup: avesmapsMediaLicenseFieldsMarkup,
		avesmapsMediaLicenseProtokollZeile: avesmapsMediaLicenseProtokollZeile,
		avesmapsMediaLicenseNoteVorschlag: avesmapsMediaLicenseNoteVorschlag,
	};
}
