// Was zeigt eine Feldzeile ueber ihr Verhaeltnis zum Wiki? REIN -- kein DOM, kein `fetch`, kein
// Zustand; dieselbe Bauform wie js/ui/wiki-assign-diff.js.
//
// Entwurf: docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md §3.1
// Mockup:  docs/wiki-override-mockup.html
//
// Der Territoriumseditor (html/wiki-sync-monitor.html) kann drei Dinge, die sonst niemand kann: er
// zeigt die Abweichung DAUERHAFT (Wiki-Wert durchgestrichen), er faerbt die Beschriftung, wenn WIR
// das Feld gesetzt haben, und er nimmt es feldweise mit ↺ zurueck. Diese Datei beantwortet die
// Frage, die alle drei brauchen -- einmal, fuer alle Objektarten.
//
// 🔴 ZWEI SICHTBARE ZUSTAENDE, NICHT VIER (Owner 17.08.2026: „bau doch einfach territorien nach"):
//   Beschriftung braun + durchgestrichener Wiki-Wert + ↺  -> herkunft === "manual", wir waren es
//   Beschriftung normal + durchgestrichener Wiki-Wert + ↺  -> weicht ab, Herkunft unbekannt
//   nichts                                                 -> kein Unterschied / kein Artikel
// Ein erster Entwurf trug drei Abzeichen (`✎ von uns` · `≠` · `⇣ Wiki`); die mittlere war redundant
// zur Durchstreichung, die dritte staende an fast jedem gepflegten Feld. `herkunft === "wiki"` wird
// deshalb MITGESCHRIEBEN, aber nicht angezeigt -- sie wirkt beim Vorhaekeln (wiki-assign-diff.js).
//
// 💣 DIE NORMALISIERUNG IST WORTGLEICH ZU avesmapsWikiAssignDiffNormalize, und das ist tragend,
// keine Bequemlichkeit: zwei Normalisierungen sind zwei Wahrheiten. Die Zeile zeigte dann eine
// Abweichung („5.900" gegen " 5.900"), die die Sync-Vorschau daneben nicht listet -- ein ↺, das
// nichts zu holen hat, und ein Editor, der den Fehler bei sich sucht.
//
// 🔴 EINE ANZEIGE-ZEILE (`karte: ""`) KOMMT NICHT VOR. Sie hat kein Kartenziel, kann also weder
// abweichen noch zurueckgesetzt werden -- dieselbe Regel wie in der Diff-Rechnung. So tragen die
// Kraftlinien ihre vier Wiki-Felder, und genau deshalb bekommt diese Objektart hier nichts.

/**
 * REIN: normalisiert einen Wert fuer den Vergleich. Wortgleich zu
 * avesmapsWikiAssignDiffNormalize (js/ui/wiki-assign-diff.js) -- siehe den Kopf.
 */
function avesmapsWikiFeldNormalize(wert) {
	return String(wert ?? "").trim();
}

/**
 * REIN: was jede Feldzeile mit Kartenziel ueber ihr Verhaeltnis zum Wiki zu sagen hat.
 *
 * @param {Array<{wiki: string, karte: string, label?: string}>} felder  die Erklaerung aus dem
 *   Feldregister (js/ui/wiki-assign-registry.js).
 * @param {Object} kartenwerte  heutiger Stand auf der Karte, indiziert nach `feld.karte`.
 * @param {Object} wikiwerte    Werte aus dem Wiki, indiziert nach `feld.wiki`.
 * @param {Object} [herkunft]   `{<kartenFeld>: "manual"|"wiki"}` aus `properties.field_origins`.
 *   Ein Feld OHNE Eintrag heisst „nicht bekannt" -- nie „vom Wiki".
 * @returns {Object} `{ <kartenFeld>: { wikiWert, abweicht, herkunft } }` -- eine Angabe je Feld
 *   mit Kartenziel, in der Reihenfolge von `felder`.
 */
function avesmapsWikiFeldStand(felder, kartenwerte, wikiwerte, herkunft) {
	const karten = kartenwerte || {};
	const wiki = wikiwerte || {};
	const quelle = herkunft || {};
	const stand = {};

	(felder || []).forEach((feld) => {
		const ziel = String((feld && feld.karte) || "");
		if (ziel === "") {
			return; // Anzeige-Zeile ohne Kartenziel
		}

		const alt = avesmapsWikiFeldNormalize(karten[ziel]);
		const neu = avesmapsWikiFeldNormalize(wiki[feld.wiki]);
		// 🔴 Nur "manual" und "wiki" sind Herkuenfte. Alles andere -- auch ein aelterer, unbekannter
		// Wert aus einer kuenftigen Fassung -- gilt als NICHT BEKANNT und faellt damit auf das
		// heutige Verhalten zurueck, statt eine Aussage zu erfinden.
		const woher = quelle[ziel] === "manual" || quelle[ziel] === "wiki" ? quelle[ziel] : "";

		stand[ziel] = {
			wikiWert: neu,
			// ⚠️ Ein LEERER Wiki-Wert ist keine Abweichung, die man zuruecknehmen koennte: das ↺
			// wuerde die Angabe leeren, und genau das ist in der Sync-Vorschau der Fall, der NIE
			// vorangehakt ist. Die Zeile bleibt deshalb still.
			abweicht: neu !== "" && alt !== neu,
			herkunft: woher,
		};
	});

	return stand;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikiFeldNormalize: avesmapsWikiFeldNormalize,
		avesmapsWikiFeldStand: avesmapsWikiFeldStand,
	};
}
