// Eine Adresse für das Hinweise-Fenster — und damit für das Impressum (Befund A24).
//
// 💣 DAS IMPRESSUM WAR NUR ANKLICKBAR, NICHT ADRESSIERBAR. Es lebt im Hinweise-Fenster, das
// ausschliesslich sein Knopf oeffnete; es gab also keine Adresse, die man jemandem geben kann, und
// fuer einen Rechteinhaber, der Kontakt sucht, war es praktisch nicht auffindbar.
//
// ⚠️ Eigene Datei, nicht in bootstrap.js: dort waere dieselbe Regel nur ueber ihren Quelltext
// pruefbar, weil die Datei ohne jQuery und ohne die halbe Karte nicht laedt. Hier laesst sie sich
// in einer vm-Sandbox mit einem echten, kleinen DOM ausfuehren -- so wie
// js/app/__tests__/keyboard-shortcuts.test.js es fuer die Tastaturbefehle tut.

// Die acht Abschnitte des Fensters, benannt nach ihrer i18n-Gruppe (`legal.group.*` in index.html).
const AVESMAPS_LEGAL_SECTION_ANCHORS = [
	"legal-usage",
	"legal-project",
	"legal-copyright",
	"legal-content",
	"legal-tech",
	"legal-liability",
	"legal-privacy",
	"legal-contact",
];

// ⚠️ Aliasse, weil das die Woerter sind, die jemand wirklich eintippt oder erwartet -- niemand raet
// „legal-contact". Sie zeigen auf dieselben Abschnitte wie die technischen Anker.
// 🔴 „impressum" MUSS auf `legal-contact` zeigen: der Betreiber-Absatz steht seit dem 05.08.2026 in
// „Kontakt und Impressum", nicht mehr unter „Projekt und rechtlicher Status" (AGENTS.md §11).
const AVESMAPS_LEGAL_ANCHOR_ALIASES = {
	impressum: "legal-contact",
	kontakt: "legal-contact",
	datenschutz: "legal-privacy",
	hinweise: "legal-dialog",
};

// Welchen Abschnitt meint dieser Hash? `null`, wenn keinen -- rein, ohne DOM, ohne Fenster.
function avesmapsResolveLegalAnchor(hash) {
	// ⚠️ ERST trimmen, DANN das Doppelkreuz abschneiden. Andersherum trifft `^#` bei fuehrendem
	// Leerraum nie, und „ #impressum" faellt durch -- vom Test gefunden, nicht vom Nachdenken.
	const raw = String(hash || "").trim().replace(/^#/, "").trim().toLowerCase();
	if (!raw) {
		return null;
	}

	const target = AVESMAPS_LEGAL_ANCHOR_ALIASES[raw] || raw;
	if (target === "legal-dialog" || AVESMAPS_LEGAL_SECTION_ANCHORS.includes(target)) {
		return target;
	}

	return null;
}

// Oeffnet das Fenster und klappt den gemeinten Abschnitt auf. Gibt zurueck, ob etwas passiert ist.
//
// ⚠️ Der Hash wird nur GELESEN, nie geschrieben. Ein Fenster, das beim Oeffnen die Adresszeile
// umschreibt, macht aus jedem Klick einen Eintrag in der Zurueck-Historie -- und die Adresse dieser
// Karte gehoert dem Kartenstand, nicht einem Dialog.
function avesmapsOpenLegalSectionFromHash(doc, hash, openDialog) {
	const target = avesmapsResolveLegalAnchor(hash);
	if (!target) {
		return false;
	}

	if (typeof openDialog === "function") {
		openDialog(true);
	}

	const section = doc && typeof doc.getElementById === "function" ? doc.getElementById(target) : null;
	// ⚠️ Nur ein <details> hat `open`. `legal-dialog` ist das Fenster selbst -- es wird geoeffnet,
	// aber nicht aufgeklappt, und ein `open = true` darauf waere ein stiller Unsinn.
	if (section && String(section.tagName || "").toUpperCase() === "DETAILS") {
		section.open = true;
		if (typeof section.scrollIntoView === "function") {
			section.scrollIntoView({ block: "start" });
		}
	}

	return true;
}

if (typeof module === "object" && module.exports) {
	module.exports = {
		AVESMAPS_LEGAL_SECTION_ANCHORS,
		AVESMAPS_LEGAL_ANCHOR_ALIASES,
		avesmapsResolveLegalAnchor,
		avesmapsOpenLegalSectionFromHash,
	};
}
