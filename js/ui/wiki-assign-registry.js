// Das Feldregister. REINE DATEN -- eine Zeile je Feld, mehr braucht eine neue Objektart nicht.
//
// 💣 Es gibt KEINE automatische Erkennung, und das ist eine Entscheidung, keine Faulheit
// (Entwurf §3a): dasselbe Wiki-Feld "Art" zeigt je Objektart auf ein anderes Kartenfeld, die
// Landschaft braucht zusaetzlich eine eigene Regel fuer mehrwertige Arten ("Tal|Grube" -> erste
// Komponente), und die Kraftlinien fuehren vier Wiki-Felder, die auf gar kein bearbeitbares Feld
// zeigen. Raten schriebe echte Daten -- die Fehlerklasse aus Discord #38.
//
// 🔴 Was hier NICHT hingehoert: Freitext-Adressen. Eine Nicht-Wiki-Quelle gehoert in den
// Quellen-Abschnitt ("Andere Quelle"). Ein Feld, in das man alles tippen kann, ist der Grund,
// warum bei den Kraftlinien ein Tippfehler unsichtbar blieb (15.08.2026).
const AVESMAPS_WIKI_ASSIGN_REGISTRY = {
	kraftlinie: {
		label: "Wiki-Artikel",
		// Kein Server noetig: die ~23 gestagten Artikel reisen mit dem Leseweg des Editors mit
		// (html/wiki-sync-powerline-editor.html, wikiArticles aus data.wiki_articles).
		suche: { art: "liste", quelle: "wiki_articles" },
		treffer: ["staerke", "regionen"],
		// Vier Wiki-Felder (api/_internal/wiki/powerlines.php: staerke, affinitaet, laenge,
		// regionen), aber KEIN bearbeitbares Kartenfeld -- jede Zeile bleibt trotzdem erklaert
		// (karte: ""), sonst meldete Pruefung 2 (§3b) alle vier faelschlich als "vergessen".
		felder: [
			{ wiki: "staerke", karte: "" },
			{ wiki: "affinitaet", karte: "" },
			{ wiki: "laenge", karte: "" },
			{ wiki: "regionen", karte: "" },
		],
		sync: false, // kein Ziel -- also auch kein Knopf
		extra: { keinArtikelHaken: true },
	},
	// Die uebrigen neun kommen in den Aufgaben 4-9 dazu, jede mit IHRER Aufgabe -- nicht auf Vorrat:
	//   weg          (A4)  Name · Art · Laenge          suche: /api/edit/wiki/paths.php
	//   ort          (A5)  Name · Art · Einwohner · Lage · Herrscher   suche: /api/edit/wiki/settlements.php
	//   landschaft   (A6)  Name · Art (mehrwertig -> erste Komponente) suche: /api/edit/wiki/regions.php
	//   territorium  (A7)  Felder aus A7 Schritt 1 · Eltern GESPERRT bei parent_locked
	//   literatur    (A8)  Felder aus A8 Schritt 1
	//   karte        (A9)  eigener Artikel -- NICHT wiki_key, NICHT wiki_url
	// Die genauen Kartenfeld-Namen stehen in Schritt 1 der jeweiligen Aufgabe. Hier nichts raten.
};

/**
 * REIN: Schlaegt eine Objektart im Register nach. Erklaerung oder null -- keine Seiteneffekte,
 * kein Werfen.
 */
function avesmapsWikiAssignSubject(subject) {
	return AVESMAPS_WIKI_ASSIGN_REGISTRY[subject] || null;
}

/**
 * REIN: Was stimmt zwischen Register und Wirklichkeit nicht? Leere Liste = alles gut.
 *
 * $wirklichkeit ist `{ [subject]: { karte: string[], wiki: string[] } }` -- welche Felder es bei
 * dieser Objektart wirklich gibt. `null` heisst "nicht pruefbar" und ueberspringt ALLE Pruefungen.
 *
 * Drei Pruefungen (Entwurf §3b), je Fund genau EIN Eintrag:
 *   1. Ein erklaertes Kartenfeld, das es bei dieser Objektart nicht gibt.
 *   2. Ein Wiki-Feld, das die Wirklichkeit liefert und das keine Erklaerung beansprucht --
 *      DIE Zeile, die eine vergessene Erklaerung sichtbar macht.
 *   3. Eine Objektart, die es in der Wirklichkeit gibt, aber nicht im Register.
 */
function avesmapsWikiAssignRegistryProbleme(registry, wirklichkeit) {
	const probleme = [];
	if (wirklichkeit === null || wirklichkeit === undefined) {
		return probleme;
	}
	const reg = registry || {};

	Object.keys(reg).forEach((subject) => {
		const erklaerung = reg[subject] || {};
		const fakten = wirklichkeit[subject];
		if (!fakten) {
			return; // fuer diese Objektart liegt keine Wirklichkeit vor -- nicht pruefbar
		}
		const karteFelder = Array.isArray(fakten.karte) ? fakten.karte : [];
		const wikiFelder = Array.isArray(fakten.wiki) ? fakten.wiki : [];
		const felder = Array.isArray(erklaerung.felder) ? erklaerung.felder : [];

		// 1) Ein erklaertes Kartenfeld, das es bei dieser Objektart nicht gibt.
		felder.forEach((feld) => {
			const karte = String((feld && feld.karte) || "");
			if (karte !== "" && karteFelder.indexOf(karte) === -1) {
				probleme.push(
					'Objektart "' + subject + '": Kartenfeld "' + karte + '" ist im Register erklaert, existiert aber nicht.'
				);
			}
		});

		// 2) Ein Wiki-Feld, das die Wirklichkeit liefert und das keine Erklaerung beansprucht.
		const erklaerteWikiFelder = felder.map((feld) => String((feld && feld.wiki) || ""));
		wikiFelder.forEach((wikiFeld) => {
			if (erklaerteWikiFelder.indexOf(wikiFeld) === -1) {
				probleme.push(
					'Objektart "' + subject + '": Wiki-Feld "' + wikiFeld + '" wird geliefert, hat aber keine Erklaerung im Register.'
				);
			}
		});
	});

	// 3) Eine Objektart, die es in der Wirklichkeit gibt, aber nicht im Register.
	Object.keys(wirklichkeit).forEach((subject) => {
		if (!Object.prototype.hasOwnProperty.call(reg, subject)) {
			probleme.push('Objektart "' + subject + '" wird geliefert, hat aber keine Erklaerung im Register.');
		}
	});

	return probleme;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ASSIGN_REGISTRY: AVESMAPS_WIKI_ASSIGN_REGISTRY,
		avesmapsWikiAssignSubject: avesmapsWikiAssignSubject,
		avesmapsWikiAssignRegistryProbleme: avesmapsWikiAssignRegistryProbleme,
	};
}
