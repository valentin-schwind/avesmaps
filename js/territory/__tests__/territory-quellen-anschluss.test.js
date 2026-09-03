// Der Quellen-Anschluss des Territoriumseditors -- das reine Modul, WIRKLICH ausgefuehrt.
//
// Entwurf: docs/superpowers/specs/2026-09-03-quellen-herrschaftsgebiete-design.md (§2.1),
// Mockup docs/quellen-herrschaftsgebiete-mockup.html.
//
// 🔴 Es montiert das EINE Quellen-Bauteil (mountFeatureSourceEditor, js/review/review-feature-sources.js)
// auf den angezeigten Knoten und baut NICHTS nach. Was es selbst entscheidet, ist genau vierer Art:
//   1. Der Schluessel ist `political_territory.public_id` des Knotens (`node.row.public_id`) --
//      auch bei einem eigenen Knoten (`eigener-knoten:…`), der eine Zeile wie jede andere ist.
//   2. Ein Knoten OHNE Datensatz (abgeleiteter Gruppenknoten) bekommt keinen Kasten: Sektion
//      versteckt, kein Mount.
//   3. 💣 Der Getter liest bei JEDER Anfrage den dann aktuellen Knoten -- nie den beim Mounten
//      eingefrorenen. Der Pfad (Breadcrumb) wechselt den Knoten, ohne dass sich ein Dialog oeffnet;
//      ein eingefrorener Wert schriebe die Quelle auf den vorigen Knoten.
//   4. 💣 Der Host wird vor jedem Mount durch einen Klon ersetzt, und `__fsDetachAutocomplete` des
//      alten laeuft zuerst: das Bauteil haengt Zuhoerer an den Knoten, die Vorschlagsliste ans
//      DOKUMENT -- ohne Austausch stapeln sie sich bei jedem Knotenwechsel (review-labels.js:855).
//
// Aus der Wurzel des Repos:  node js/territory/__tests__/territory-quellen-anschluss.test.js

"use strict";

const assert = require("assert");
const path = require("path");

const modul = require(path.join(__dirname, "..", "territory-quellen-anschluss.js"));
const anschliessen = modul.avesmapsTerritoriumQuellenAnschliessen;
const schluessel = modul.avesmapsTerritoriumQuellenSchluessel;
assert.strictEqual(typeof anschliessen, "function", "avesmapsTerritoriumQuellenAnschliessen wird exportiert");
assert.strictEqual(typeof schluessel, "function", "avesmapsTerritoriumQuellenSchluessel wird exportiert");

// ---- Eine winzige DOM-Attrappe: nur, was das Modul anfasst -------------------------------------
function element(id) {
	const el = {
		id,
		hidden: false,
		ersetztDurch: null,
		cloneNode(tief) {
			assert.strictEqual(tief, false, "der Klon ist FLACH -- die gerenderten Zeilen des alten Mounts sollen weg");
			return element(id);
		},
		replaceWith(neu) { el.ersetztDurch = neu; },
	};
	return el;
}
function sektionMit(host) {
	return { hidden: true, host };
}
function lauf(node, extra) {
	const aufrufe = [];
	const sektion = { hidden: true };
	const host = element("territoryFeatureSources");
	const knoten = { aktuell: node };
	const ergebnis = anschliessen(Object.assign({
		sektion,
		host,
		node,
		aktuellerKnoten: () => knoten.aktuell,
		mount: (ziel, art, getter, opts) => { aufrufe.push({ ziel, art, getter, opts }); },
		escape: (s) => String(s),
	}, extra || {}));
	return { aufrufe, sektion, host, knoten, ergebnis };
}

// ---- 1. Der Schluessel ist die public_id der Zeile ---------------------------------------------
assert.strictEqual(schluessel({ row: { public_id: " 0be6e751-af1f " } }), "0be6e751-af1f", "public_id, getrimmt");
assert.strictEqual(schluessel({ row: { public_id: "", wiki_key: "wiki:sternenbund" } }), "",
	"ohne public_id gibt es keinen Schluessel -- der wiki_key ist KEINER (feature_sources haengt an political_territory.public_id)");
assert.strictEqual(schluessel({ label: "Gruppe" }), "", "ein Knoten ohne Zeile hat keinen Schluessel");
assert.strictEqual(schluessel(null), "", "kein Knoten, kein Schluessel");
assert.strictEqual(schluessel({ row: { public_id: "k-41", wiki_key: "eigener-knoten:knoten041" } }), "k-41",
	"ein eigener Knoten ist eine Zeile wie jede andere");

// ---- 2. Ein normaler Knoten: Sektion sichtbar, Mount auf territory + Klon ----------------------
{
	const t = lauf({ label: "Sternenbund", row: { public_id: "t-1", wiki_key: "wiki:sternenbund" } });
	assert.strictEqual(t.sektion.hidden, false, "die Sektion wird eingeblendet");
	assert.strictEqual(t.aufrufe.length, 1, "genau EIN Mount");
	assert.strictEqual(t.aufrufe[0].art, "territory", "Objektart territory");
	assert.notStrictEqual(t.aufrufe[0].ziel, t.host, "montiert wird auf den KLON, nicht den alten Host");
	assert.strictEqual(t.host.ersetztDurch, t.aufrufe[0].ziel, "der alte Host wurde durch den Klon ersetzt");
	assert.strictEqual(t.aufrufe[0].ziel.id, "territoryFeatureSources", "der Klon behaelt die Kennung");
	assert.strictEqual(typeof t.aufrufe[0].opts.escape, "function", "escape wird durchgereicht");
	assert.strictEqual(t.aufrufe[0].getter(), "t-1", "der Getter liefert die public_id");
	assert.strictEqual(t.ergebnis, t.aufrufe[0].ziel, "zurueck kommt der Klon");
}

// ---- 3. Ein eigener Knoten: derselbe Weg ---------------------------------------------------------
{
	const t = lauf({ label: "Freie Hoefe", row: { public_id: "k-41", wiki_key: "eigener-knoten:knoten041" } });
	assert.strictEqual(t.sektion.hidden, false);
	assert.strictEqual(t.aufrufe.length, 1);
	assert.strictEqual(t.aufrufe[0].getter(), "k-41");
}

// ---- 4. Ein Gruppenknoten ohne Datensatz: versteckt, kein Mount --------------------------------
{
	const t = lauf({ label: "Svellttal" });
	assert.strictEqual(t.sektion.hidden, true, "ohne Datensatz keine Sektion");
	assert.strictEqual(t.aufrufe.length, 0, "kein Mount");
	assert.strictEqual(t.host.ersetztDurch, null, "der Host bleibt unangetastet");
	assert.strictEqual(t.ergebnis, null);
}
{
	const t = lauf({ label: "Zeile ohne Kennung", row: { public_id: "", wiki_key: "wiki:x" } });
	assert.strictEqual(t.sektion.hidden, true, "eine Zeile ohne public_id kann keine Quelle tragen");
	assert.strictEqual(t.aufrufe.length, 0);
}
{
	// Und der Weg zurueck: erst sichtbar, dann ein Gruppenknoten -> wieder versteckt.
	const sektion = { hidden: false };
	const ergebnis = anschliessen({ sektion, host: element("h"), node: { label: "Gruppe" },
		aktuellerKnoten: () => null, mount: () => { throw new Error("darf nicht montieren"); }, escape: String });
	assert.strictEqual(sektion.hidden, true);
	assert.strictEqual(ergebnis, null);
}

// ---- 5. 💣 Der Getter liest den AKTUELLEN Knoten, nicht den eingefrorenen ----------------------
{
	const t = lauf({ label: "A", row: { public_id: "t-a" } });
	assert.strictEqual(t.aufrufe[0].getter(), "t-a");
	t.knoten.aktuell = { label: "B", row: { public_id: "t-b" } };
	assert.strictEqual(t.aufrufe[0].getter(), "t-b",
		"nach einem Knotenwechsel im Pfad schreibt der Kasten auf den NEUEN Knoten");
	t.knoten.aktuell = { label: "Gruppe" };
	assert.strictEqual(t.aufrufe[0].getter(), "", "ohne Zeile liefert der Getter leer -- nie den alten Wert");
}

// ---- 6. 💣 Kein Stapeln: die Vorschlagsliste des alten Mounts wird geloest ---------------------
{
	const sektion = { hidden: true };
	const alt = element("territoryFeatureSources");
	let geloest = 0;
	alt.__fsDetachAutocomplete = () => { geloest += 1; };
	const aufrufe = [];
	anschliessen({ sektion, host: alt, node: { row: { public_id: "t-1" } }, aktuellerKnoten: () => null,
		mount: (ziel) => aufrufe.push(ziel), escape: String });
	assert.strictEqual(geloest, 1, "__fsDetachAutocomplete des alten Hosts laeuft VOR dem Austausch");
	assert.strictEqual(aufrufe.length, 1);
}

// ---- 7. Ohne Bauteil: nichts montieren, nichts versprechen -------------------------------------
{
	const t = lauf({ label: "Sternenbund", row: { public_id: "t-1" } }, { mount: undefined });
	assert.strictEqual(t.sektion.hidden, true, "ohne mountFeatureSourceEditor bleibt die Sektion versteckt -- ein leerer Kasten verspraeche etwas");
	assert.strictEqual(t.host.ersetztDurch, null);
	assert.strictEqual(t.ergebnis, null);
}

console.log("territory-quellen-anschluss: alle Zusicherungen erfuellt");
