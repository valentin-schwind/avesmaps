// Der EINE Lizenzkatalog fuer jeden Bild-Upload -- die JS-Seite.
//
// 💣 DIESE DATEI IST DIE ZWILLINGSSCHWESTER VON api/_internal/media-license.php. Wer hier einen Wert,
// eine Beschriftung oder die Reihenfolge aendert und dort nicht (oder umgekehrt), faehrt einen roten
// js/app/__tests__/media-licenses-parity.test.js. Das ist kein Schikane-Test, sondern die einzige
// Bedingung, unter der die Doppelung ueberhaupt zulaessig ist: ein Generat waere die Bauform, an der
// political-territory-editor-inline.css dreimal gescheitert ist (AGENTS §10), und ein Endpunkt kostete
// je Editorseite einen Request fuer eine Liste, die sich nie zur Laufzeit aendert.
//
// Geladen von den vier Editorseiten per <script src>, jeweils VOR js/ui/media-license-fields.js (die
// andere Reihenfolge faellt erst zur Laufzeit auf). Sie sind html/*.html-Seiten, der Deploy stempelt
// das ?v= also selbst (AGENTS §7). ⚠️ Kein ASSET_VERSION-Bump -- der gilt nur den dynamisch
// nachgeladenen Territorien-Editor-Assets.
// 🪤 Zwischen Phase 1 und Phase 4 lud diese Datei NIEMAND: sie existierte, war geprueft und lag
// bereit, damit jeder Zwischenstand fuer sich deploybar blieb. Wer in einem alten Stand sucht, wer
// sie einbindet, findet zu Recht nichts.

/**
 * Die sieben Kennungen in ANZEIGEREIHENFOLGE, mit Beschriftung und Sichtbarkeit.
 *
 * ⚠️ GLEICHER NAME, ANDERE FORM als drueben: api/_internal/media-license.php nennt seine Liste
 * ebenfalls AVESMAPS_MEDIA_LICENSES, fuehrt dort aber blanke Strings und haelt Beschriftungen und
 * Sichtbarkeit in zwei getrennten Konstanten. Hier sind es Objekte, weil ein <option> Wert und
 * Beschriftung zusammen braucht. Der Paritaetstest vergleicht die Werte, nicht die Struktur.
 *
 * 🔴 `public: false` heisst "wird gespeichert, aber nicht im Frontend gezeigt" -- nicht "darf nicht
 * gewaehlt werden". Der Editor traegt die Angabe vollstaendig ein, nur die Veroeffentlichung
 * unterbleibt (Owner-Entscheid 16.08.2026). Bei CC-BY, weil die Namensnennung am Bild stehen muesste
 * und diese Flaeche es im Frontend nicht gibt; bei Unbekannt/Sonstiges, weil ungeklaerte Herkunft
 * nichts auf einer oeffentlichen Karte zu suchen hat.
 *
 * `hint`: optionaler Ein-Zeiler je Kennung, den js/ui/media-license-fields.js als `title` ans
 * <option> haengt (Designpruefung Befund 3, 16.08.2026). Der Territoriums-Dialog hatte frueher zwei
 * Radios mit erklaerender Klammer ("Gemeinfrei (frei verwendbar)", "CC-BY (Namensnennung)"); die
 * Erklaerung gehoert seit Phase 4 NICHT mehr einem einzelnen Dialog, sondern -- wie Wert und
 * Beschriftung -- dem EINEN Katalog, sonst waere sie eine sechste Abschrift. Nur hier gepflegt,
 * keine PHP-Entsprechung: die Serverseite rendert nie ein <option>, ein Paritaetseintrag haette
 * also kein Gegenstueck zum Vergleichen.
 */
const AVESMAPS_MEDIA_LICENSES = [
	{ value: "unknown_other", label: "Unbekannt/Sonstiges", public: false, hint: "Herkunft ungeklärt – erscheint nicht auf der Karte" },
	{ value: "public_domain", label: "Public Domain", public: true, hint: "Gemeinfrei – frei verwendbar" },
	{ value: "cc0", label: "CC0", public: true, hint: "Gemeinfrei per Lizenz – keine Namensnennung nötig" },
	{ value: "cc_by", label: "CC-BY", public: false, hint: "Erfordert Namensnennung – erscheint deshalb nicht auf der Karte" },
	{ value: "permission_granted", label: "Genehmigung erteilt", public: true, hint: "Urheber hat zugestimmt, auch ohne Namensnennung" },
	{ value: "ai_generated", label: "Von uns KI-generiert", public: true, hint: "Von Avesmaps selbst per KI erzeugt" },
	{ value: "own_work", label: "Eigene Kreation", public: true, hint: "Eigene Aufnahme oder Zeichnung" },
];

/**
 * Vorschlagstext fuer ein LEERES Kommentarfeld bei der Wahl "Genehmigung erteilt" -- nie ueber einen
 * vorhandenen Text schreiben. ⚠️ Wortgleich mit AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE in der
 * PHP-Datei; der Paritaetstest vergleicht beide.
 */
const AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE =
	"Urheber ist mit der Nutzung einverstanden, ausdrücklich auch ohne Namensnennung.";

/**
 * Bringt einen beliebigen Wert auf eine Katalog-Kennung; alles Fremde faellt auf die Vorgabe.
 * 💣 Auch die VORGABE wird geprueft -- sonst reichte ein Tippfehler dort einen katalogfremden Wert
 * an den Server durch. Und es wird NICHT kleingeschrieben: "CC0" ist ein Fehler, keine Schreibvariante.
 */
function avesmapsMediaLicenseNormalize(wert, vorgabe) {
	const rueckfall = AVESMAPS_MEDIA_LICENSES.some((e) => e.value === vorgabe) ? vorgabe : "unknown_other";
	const geputzt = typeof wert === "string" ? wert.trim() : "";

	return AVESMAPS_MEDIA_LICENSES.some((e) => e.value === geputzt) ? geputzt : rueckfall;
}

/**
 * Darf ein Bild mit diesem Wert im Frontend erscheinen?
 * 🔴 Nimmt bewusst KEINE Vorgabe entgegen: mit einem oeffentlichen Rueckfall machte jeder unbekannte
 * String das Bild sichtbar. Erst normalisieren, dann pruefen -- nie umgekehrt.
 */
function avesmapsMediaLicenseIsPublic(wert) {
	const kennung = avesmapsMediaLicenseNormalize(wert);

	return AVESMAPS_MEDIA_LICENSES.some((e) => e.value === kennung && e.public);
}

/** Die deutsche Beschriftung; ein unbekannter Wert bekommt die von "unknown_other". */
function avesmapsMediaLicenseLabel(wert) {
	const kennung = avesmapsMediaLicenseNormalize(wert);
	const eintrag = AVESMAPS_MEDIA_LICENSES.find((e) => e.value === kennung);

	return eintrag ? eintrag.label : "";
}

// Node-Export (im Browser wirkungslos, dort sind die Namen Globals der Editorseiten). Er ist es, der
// den Paritaetstest die echte Liste pruefen laesst statt einer abgetippten Kopie.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_MEDIA_LICENSES: AVESMAPS_MEDIA_LICENSES,
		AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE: AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE,
		avesmapsMediaLicenseNormalize: avesmapsMediaLicenseNormalize,
		avesmapsMediaLicenseIsPublic: avesmapsMediaLicenseIsPublic,
		avesmapsMediaLicenseLabel: avesmapsMediaLicenseLabel,
	};
}
