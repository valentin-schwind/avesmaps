// Der Quellen-Anschluss des Territoriumseditors -- REIN: kein `document`, kein `fetch`, kein
// Modulzustand. Die Oberflaeche (territory-editor-embedded.js, renderInfoBox) reicht Sektion, Host,
// Knoten und das Bauteil herein; hier wird nur entschieden und montiert.
//
// Entwurf: docs/superpowers/specs/2026-09-03-quellen-herrschaftsgebiete-design.md (§2.1),
// Mockup docs/quellen-herrschaftsgebiete-mockup.html. Test: __tests__/territory-quellen-anschluss.test.js
// (das Modul wird dort AUSGEFUEHRT, gegen Mutationen gefahren).
//
// 🔴 ES MONTIERT DAS EINE BAUTEIL UND BAUT NICHTS NACH. Die Quellen eines Herrschaftsgebiets liegen
// in `sources` + `feature_sources` (AGENTS.md §5), Objektart `territory`, Schluessel
// `political_territory.public_id`. Genau dieses Paar liest die Karte schon, wenn sie die Quellenzeile
// der Infobox zeichnet (renderFeatureSourceLine("territory", …)). Owner 03.09.2026: „achte darauf das
// quellensystem zu nehmen, das wir haben und nicht wieder alles neu zu implementieren".
//
// Was hier entschieden wird, ist genau vierer Art:
//   1. Der Schluessel ist `node.row.public_id` -- auch bei einem EIGENEN Knoten (`eigener-knoten:…`),
//      denn der ist eine Zeile in `political_territory` wie jede andere; er hat nur keinen Artikel.
//      ⚠️ Der `wiki_key` ist KEIN Schluessel: feature_sources haengt an der public_id.
//   2. Ein Knoten OHNE Datensatz (abgeleiteter Gruppenknoten, `node.row` fehlt) traegt keine Quellen:
//      Sektion versteckt, kein Mount. Ebenso, wenn das Bauteil gar nicht geladen ist -- ein leerer
//      Kasten verspraeche etwas.
//   3. 💣 DER GETTER LIEST BEI JEDER ANFRAGE DEN DANN AKTUELLEN KNOTEN, nie den beim Mounten
//      eingefrorenen. Der Pfad (Breadcrumb) wechselt den Knoten, ohne dass sich ein Dialog oeffnet;
//      ein eingefrorener Wert schriebe die Quelle auf den vorigen Knoten. Dieselbe Warnung steht an
//      allen acht anderen Montagestellen (review-labels.js:855, review-locations.js:604).
//   4. 💣 DER HOST WIRD VOR JEDEM MOUNT DURCH EINEN FLACHEN KLON ERSETZT, und `__fsDetachAutocomplete`
//      des alten laeuft zuerst: das Bauteil haengt Zuhoerer an den Knoten, die Vorschlagsliste ans
//      DOKUMENT -- ohne Austausch stapeln sie sich bei jedem Knotenwechsel, und ein Klick loeste die
//      Aktion so oft aus, wie Knoten gezeigt wurden.

"use strict";

/**
 * Der Schluessel, unter dem die Quellen dieses Knotens liegen: `political_territory.public_id`.
 * Leer, wenn der Knoten keinen Datensatz hat.
 */
function avesmapsTerritoriumQuellenSchluessel(node) {
	if (!node || !node.row) {
		return "";
	}
	const id = node.row.public_id;
	return String(id === null || id === undefined ? "" : id).trim();
}

/**
 * Montiert (oder versteckt) den Quellenkasten fuer den gezeigten Knoten.
 *
 * @param {object} opts
 *   sektion         die Sektion „Quellen" (bekommt `hidden`)
 *   host            der AKTUELLE Host-Knoten im Dokument (wird durch einen Klon ersetzt)
 *   node            der gezeigte Knoten (entscheidet, ob es einen Kasten gibt)
 *   aktuellerKnoten () => der Knoten, der GERADE gezeigt wird -- fuer den Getter
 *   mount           mountFeatureSourceEditor (oder nichts -> kein Kasten)
 *   escape          optionaler HTML-Maskierer, durchgereicht ans Bauteil
 * @returns {object|null} der frische Host, oder null, wenn nichts montiert wurde
 */
function avesmapsTerritoriumQuellenAnschliessen(opts) {
	const o = opts || {};
	const sektion = o.sektion || null;
	const host = o.host || null;
	const mount = typeof o.mount === "function" ? o.mount : null;
	const schluessel = avesmapsTerritoriumQuellenSchluessel(o.node);

	if (!sektion || !host || !mount || schluessel === "") {
		if (sektion) {
			sektion.hidden = true;
		}
		return null;
	}

	if (typeof host.__fsDetachAutocomplete === "function") {
		host.__fsDetachAutocomplete();
		host.__fsDetachAutocomplete = null;
	}
	const frisch = host.cloneNode(false);
	host.replaceWith(frisch);
	sektion.hidden = false;

	const aktuellerKnoten = typeof o.aktuellerKnoten === "function" ? o.aktuellerKnoten : () => o.node;
	const mountOpts = typeof o.escape === "function" ? { escape: o.escape } : {};
	// `void`: das Bauteil gibt eine Zusage zurueck (die erste Liste); hier wartet niemand darauf --
	// der Kasten fuellt sich, wenn sie kommt, und ein Fehler steht in seiner eigenen Meldezeile.
	void mount(frisch, "territory", () => avesmapsTerritoriumQuellenSchluessel(aktuellerKnoten()), mountOpts);
	return frisch;
}

if (typeof window !== "undefined") {
	window.avesmapsTerritoriumQuellenSchluessel = avesmapsTerritoriumQuellenSchluessel;
	window.avesmapsTerritoriumQuellenAnschliessen = avesmapsTerritoriumQuellenAnschliessen;
}
if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsTerritoriumQuellenSchluessel, avesmapsTerritoriumQuellenAnschliessen };
}
