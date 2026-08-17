// Die reine Diff-Rechnung der Sync-Vorschau (Aufgabe 2, Entwurf §6, docs/superpowers/specs/
// 2026-08-15-wiki-zuweisung-vereinheitlichung-design.md). REIN: kein DOM, kein `fetch`, kein
// Zustand -- eine Erklaerung (die `felder`-Liste aus dem Feldregister, Aufgabe 1) plus drei
// Werte-Quellen rein, eine Liste von Unterschieds-Zeilen raus. Das Bauteil, das daraus eine
// Oberflaeche macht (Trefferliste, Haekchen, Knoepfe), kommt in Aufgabe 3 und benutzt nur die hier
// gelieferte Liste.
//
// 💣 NUR UNTERSCHIEDE LANDEN IN DER LISTE: was ohnehin mit dem Wiki uebereinstimmt, waere Rauschen
// -- in einem Kasten voller Haekchen sucht man sonst die eine Zeile, die zaehlt (dieselbe
// Begruendung wie bei der grossen Uebernahme-Vorschau, docs/superpowers/specs/2026-08-06-sync-
// uebernahme-design.md). Sind alle Angaben gleich, ist die Rueckgabe eine leere Liste -- die
// Oberflaeche zeigt dann "Alles stimmt bereits mit dem Wiki ueberein", statt eine leere
// Haekchenliste zu rendern.
//
// 🔴 VORANGEHAKT IST NUR, WAS EINE LUECKE FUELLT (Owner-Entscheid 16.08.2026, woertlich: „Eine
// Zeile, die einen bereits GEFUELLTEN Kartenwert ersetzen wuerde, startet ungehakt -- mit dem Grund
// ‚auf der Karte steht bereits ein Wert'. Ein leeres Feld zu fuellen bleibt vorangehakt.").
//
// Die fuenf Faelle, in der Reihenfolge, in der sie geprueft werden:
//   1. gleich                                    -> gar nicht gelistet
//   2. Wiki sagt nichts, Karte hat etwas         -> gelistet, NIE gehakt ("wuerde die Angabe leeren")
//   3. Herkunft "manual"                         -> gelistet, NIE gehakt ("wuerde zurueckgedreht")
//   4. Herkunft "wiki"                           -> gelistet und VORANGEHAKT (der neue Fall)
//   5. Kartenwert GEFUELLT, Herkunft unbekannt   -> gelistet, NICHT gehakt
//      Kartenwert LEER, Wiki sagt etwas          -> gelistet und VORANGEHAKT (die Luecke)
//
// ⚠️ DIE REIHENFOLGE IST DIE REGEL, vom spezifischsten zum allgemeinsten: 3 steht VOR 4 und 4 vor 5.
// Eine handgesetzte Angabe ist per Definition auch gefuellt -- der spezifischere Grund muss den
// allgemeinen stechen, sonst laese der Editor „auf der Karte steht bereits ein Wert" statt „von Hand
// gesetzt, wuerde zurueckgedreht" und wuesste nicht, dass er selbst der Grund ist.
//
// 🔴 FALL 4 IST NEU (17.08.2026, Entwurf 2026-08-17-wiki-override-fuer-alle-design.md §2.6) und
// nimmt den Owner-Entscheid vom 16.08. NICHT zurueck. Der lautete „konservativ, weil niemand wissen
// kann, ob ein Wert von Hand kam" -- seit es die Feldherkunft gibt, KANN man es wissen, und ein
// Wert, der zuletzt selbst aus dem Wiki kam, laesst sich gefahrlos auffrischen: dabei geht nichts
// von uns verloren.
// 💣 AM ERSTEN TAG AENDERT SICH DADURCH NICHTS. Ohne gespeicherte Herkunft greift weder 3 noch 4,
// und alles verhaelt sich exakt wie heute -- das ist eine Zusicherung im Test, keine Hoffnung.
//
// 💣 DIE TRAGWEITE IST GROESSER ALS „EIN KLICK MEHR": ein Ortsname und eine Ortsart sind praktisch
// immer gefuellt, also ist in der Praxis fast nichts mehr vorangehakt und „Alle anhaken" wird der
// normale Weg. Das ist die GEWAEHLTE Seite des Tauschs (kein unbedachtes Ueberschreiben), nicht ein
// Nebeneffekt. Wer sie zurueckdrehen will, dreht damit den Owner-Entscheid zurueck.
//
// Alle drei ungehakten Faelle tragen einen `grund`-Klartext, damit der Editor sieht, WARUM die Zeile
// ungehakt ist, statt es zu erraten.
//
// 🔴 Eine Feldzeile mit `karte: ""` ist eine ANZEIGE-Zeile ohne Ziel (so tragen die Kraftlinien ihre
// vier Wiki-Felder, js/ui/wiki-assign-registry.js) -- sie kann per Definition nichts uebernehmen und
// steht deshalb NIE in der Diff-Liste, unabhaengig davon, was ihr Wiki-Wert sagt.

/**
 * REIN: normalisiert einen Wert fuer den Vergleich UND die Anzeige -- `null`/`undefined` sind
 * dasselbe wie `""`, Ränder werden beschnitten. Sonst meldet ein `null` gegen ein `""` einen
 * Unterschied, den niemand sieht.
 */
function avesmapsWikiAssignDiffNormalize(wert) {
	return String(wert ?? "").trim();
}

/**
 * REIN: rechnet die Sync-Vorschau einer einzelnen Objektzeile aus.
 *
 * @param {Array<{wiki: string, karte: string, label?: string}>} felder  die Erklaerung aus dem
 *   Feldregister (Aufgabe 1), in der Reihenfolge, in der sie angezeigt werden soll.
 * @param {Object} kartenwerte  aktuelle Werte auf der Karte, indiziert nach `feld.karte`.
 * @param {Object} wikiwerte    Werte aus dem Wiki, indiziert nach `feld.wiki`.
 * @param {Object} [herkunft]   `{<kartenFeld>: "manual"|"wiki"}` -- die gespeicherte Feldherkunft
 *   (`properties.field_origins` bzw. `adventure.field_origins_json`). Ein Feld OHNE Eintrag heisst
 *   „nicht bekannt", nie „vom Wiki".
 *   ⚠️ HIER STAND BIS ZUM 17.08.2026 EINE LISTE (`handgesetzt: string[]`), und es gibt bewusst
 *   KEINEN Rueckfall auf die alte Form: ein toleranter Leser, der beide nimmt, ist genau die
 *   Divergenz, auf die dieser Umbau verzichtet. Es gab zwei Stellen, und beide sind mitgezogen
 *   (js/ui/wiki-assign.js, js/ui/wiki-assign-literatur.js).
 * @returns {Array<{karte: string, label: string, alt: string, neu: string, gehakt: boolean, grund: string}>}
 *   nur die Zeilen, die sich unterscheiden, in der Reihenfolge von `felder`.
 */
function avesmapsWikiAssignDiff(felder, kartenwerte, wikiwerte, herkunft) {
	const woher = herkunft || {};
	const karten = kartenwerte || {};
	const wiki = wikiwerte || {};
	const zeilen = [];

	(felder || []).forEach((feld) => {
		if (!feld || String(feld.karte || "") === "") {
			return; // Anzeige-Zeile ohne Kartenziel -- kann per Definition nichts uebernehmen
		}

		const alt = avesmapsWikiAssignDiffNormalize(karten[feld.karte]);
		const neu = avesmapsWikiAssignDiffNormalize(wiki[feld.wiki]);
		if (alt === neu) {
			return; // ohnehin gleich -- kein Rauschen in der Liste
		}

		const label = feld.label || feld.karte;
		let gehakt = true;
		let grund = "";
		if (neu === "") {
			// Das Wiki sagt nichts, die Karte schon: der Fall "Geloescht" -- gelistet, NIE gehakt.
			gehakt = false;
			grund = "das Wiki sagt nichts — würde die Angabe leeren";
		} else if (woher[feld.karte] === "manual") {
			// Von Hand korrigiert: gelistet, markiert, aber nicht gehakt.
			// 🔴 VOR den zwei Regeln darunter: eine handgesetzte Angabe ist immer auch gefuellt, und
			// dieser Grund ist der genauere. Getauscht laese der Editor den allgemeinen Satz und
			// wuesste nicht, dass seine eigene Korrektur der Grund ist.
			gehakt = false;
			grund = "von Hand gesetzt — würde zurückgedreht";
		} else if (woher[feld.karte] === "wiki") {
			// 🔴 Der Wert kam zuletzt selbst aus dem Wiki -- ihn aufzufrischen kann per Definition
			// nichts von uns ueberschreiben. VOR der Regel darunter, sonst stuende hier „auf der
			// Karte steht bereits ein Wert" und der Fall waere von einem unbekannten nicht zu
			// unterscheiden. Vorangehakt heisst: KEIN Grund -- ein Grund erklaert immer nur, warum
			// eine Zeile NICHT gehakt ist.
			gehakt = true;
			grund = "";
		} else if (alt !== "") {
			// 🔴 Der Kartenwert ist GEFUELLT und das Wiki sagt etwas anderes -- ueberschreiben ist eine
			// Entscheidung, kein Vorschlag (Owner 16.08.2026). Nur das Fuellen einer LUECKE bleibt
			// vorangehakt.
			gehakt = false;
			grund = "auf der Karte steht bereits ein Wert";
		}

		zeilen.push({ karte: feld.karte, label: label, alt: alt, neu: neu, gehakt: gehakt, grund: grund });
	});

	return zeilen;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikiAssignDiff: avesmapsWikiAssignDiff,
	};
}
