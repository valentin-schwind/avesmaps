"use strict";
// Die Weg-Ebene des Wege-Editors: was die Abschnitte gemeinsam haben, und was ein
// Sammel-Speichern daraus wirklich schreiben darf.
//
// 🔴 DIE ZUSICHERUNG, UM DIE ES HIER GEHT, IST DIE ZWEITE: ein Fahrtyp auf „teils" darf NICHT in
// `fields` landen. Steht er drin, macht ein Sammel-Speichern jede gewollte Ausnahme platt -- am
// Schattenbachpass die Kutsche in 2 von 8 Abschnitten, und zwar lautlos. Derselbe Fehler ist am
// 17.08.2026 in avesmapsUpsertGameLiterature gemessen worden (AGENTS.md §11).
//
// Entwurf: docs/superpowers/specs/2026-08-19-wege-editor-weg-ebene-design.md §4

const assert = require("node:assert/strict");
const {
	wpGroupFieldStates,
	wpGroupChangedFields,
	wpGroupTransportDecisions
} = require("../wege-editor-model.js");

// 💣 Ohne das hier meldet jeder assert() gruen und beweist nichts -- dieselbe Wache wie in den
// PHP-Tests des Hauses.
assert.throws(() => assert.equal(1, 2), "assert ist wirkungslos");

const TRANSPORTE = ["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"];

// Der Schattenbachpass, wie ihn die Liste liefert: acht Abschnitte, sechs Gebirgspass, zwei Pfad,
// die Kutsche nur in zweien.
function schattenbachpass() {
	const machen = (nr, subtype, transporte) => ({
		public_id: "p" + nr,
		name: "Schattenbachpass",
		feature_subtype: subtype,
		show_label: false,
		allowed_transports: transporte,
		other_source: null
	});
	const grund = ["groupFoot", "lightWalker"];
	return [
		machen(1, "Gebirgspass", grund),
		machen(2, "Gebirgspass", grund),
		machen(3, "Gebirgspass", grund.concat(["horseCarriage"])),
		machen(4, "Pfad", grund),
		machen(5, "Gebirgspass", grund.concat(["horseCarriage"])),
		machen(6, "Gebirgspass", grund),
		machen(7, "Pfad", grund),
		machen(8, "Gebirgspass", grund)
	];
}

// ── 1) Was gleich ist, steht als Wert da; was uneins ist, traegt KEINEN Wert ──────────────────
{
	const stand = wpGroupFieldStates(schattenbachpass(), TRANSPORTE);

	assert.equal(stand.gesamt, 8);
	assert.equal(stand.name.gleich, true);
	assert.equal(stand.name.wert, "Schattenbachpass");

	assert.equal(stand.feature_subtype.gleich, false, "sechs Gebirgspass und zwei Pfad sind nicht gleich");
	assert.equal(stand.feature_subtype.wert, null,
		"ein uneiniges Feld darf KEINEN Wert tragen -- der saehe aus wie eine Aussage ueber alle acht");
	assert.deepEqual(stand.feature_subtype.verteilung, [
		{ wert: "Gebirgspass", anzahl: 6 },
		{ wert: "Pfad", anzahl: 2 }
	], "die Verteilung steht haeufigster zuerst -- daraus wird „6× Gebirgspass, 2× Pfad“");

	assert.equal(stand.transports.groupFoot.zustand, "an");
	assert.equal(stand.transports.caravan.zustand, "aus");
	assert.equal(stand.transports.horseCarriage.zustand, "teils");
	assert.equal(stand.transports.horseCarriage.an, 2);
	assert.equal(stand.transports.horseCarriage.gesamt, 8);
}

// ── 2) 🔴 EIN STEHENGEBLIEBENES „teils" WIRD NICHT GESCHRIEBEN ────────────────────────────────
{
	const vorher = wpGroupFieldStates(schattenbachpass(), TRANSPORTE);
	// Die Maske, unberuehrt geoeffnet und sofort gespeichert.
	const entwurf = {
		name: "Schattenbachpass",
		show_label: false,
		feature_subtype: null,           // „— gemischt lassen —"
		other_source: null,
		transports: {
			caravan: "aus", groupFoot: "an", lightWalker: "an",
			horseCarriage: "teils", groupHorse: "aus", lightRider: "aus"
		}
	};

	assert.deepEqual(wpGroupChangedFields(vorher, entwurf), [],
		"ein unberuehrtes Sammel-Speichern darf NICHTS schreiben");
	assert.deepEqual(wpGroupTransportDecisions(vorher, entwurf), {},
		"ein halber Haken ist keine Entscheidung");
}

// ── 3) Ein angeklickter halber Haken gilt fuer alle ───────────────────────────────────────────
{
	const vorher = wpGroupFieldStates(schattenbachpass(), TRANSPORTE);
	const entwurf = {
		name: "Schattenbachpass", show_label: false, feature_subtype: null, other_source: null,
		transports: {
			caravan: "aus", groupFoot: "an", lightWalker: "an",
			horseCarriage: "an", groupHorse: "aus", lightRider: "aus"
		}
	};

	assert.deepEqual(wpGroupChangedFields(vorher, entwurf), ["allowed_transports"]);
	assert.deepEqual(wpGroupTransportDecisions(vorher, entwurf), { horseCarriage: true },
		"genau EIN Fahrtyp wurde entschieden -- die uebrigen fuenf stehen unveraendert");
}

// ── 4) Ausgeschaltet ist auch eine Entscheidung, und zwar eine andere als „teils" ─────────────
{
	const vorher = wpGroupFieldStates(schattenbachpass(), TRANSPORTE);
	const entwurf = {
		name: "Schattenbachpass", show_label: false, feature_subtype: null, other_source: null,
		transports: {
			caravan: "aus", groupFoot: "an", lightWalker: "an",
			horseCarriage: "aus", groupHorse: "aus", lightRider: "aus"
		}
	};
	assert.deepEqual(wpGroupTransportDecisions(vorher, entwurf), { horseCarriage: false },
		"„aus“ nach „teils“ ist eine Entscheidung -- und sie nimmt zwei Abschnitten die Kutsche");
}

// ── 5) Der Wegtyp: „gemischt lassen" gegen eine echte Wahl ────────────────────────────────────
{
	const vorher = wpGroupFieldStates(schattenbachpass(), TRANSPORTE);
	const rumpf = {
		name: "Schattenbachpass", show_label: false, other_source: null,
		transports: {
			caravan: "aus", groupFoot: "an", lightWalker: "an",
			horseCarriage: "teils", groupHorse: "aus", lightRider: "aus"
		}
	};

	assert.deepEqual(wpGroupChangedFields(vorher, Object.assign({}, rumpf, { feature_subtype: null })), [],
		"„gemischt lassen“ ist keine Aenderung");
	assert.deepEqual(
		wpGroupChangedFields(vorher, Object.assign({}, rumpf, { feature_subtype: "Gebirgspass" })),
		["feature_subtype"],
		"eine Wahl macht alle acht gleich -- auch die sechs, die schon Gebirgspass sind");
}

// ── 6) Eine EINIGE Gruppe: dieselbe Art nochmal gewaehlt ist keine Aenderung ──────────────────
{
	const einig = schattenbachpass().map((s) => Object.assign({}, s, { feature_subtype: "Gebirgspass" }));
	const vorher = wpGroupFieldStates(einig, TRANSPORTE);
	assert.equal(vorher.feature_subtype.gleich, true);
	assert.equal(vorher.feature_subtype.wert, "Gebirgspass");

	const entwurf = {
		name: "Schattenbachpass", show_label: false, feature_subtype: "Gebirgspass", other_source: null,
		transports: {
			caravan: "aus", groupFoot: "an", lightWalker: "an",
			horseCarriage: "teils", groupHorse: "aus", lightRider: "aus"
		}
	};
	assert.deepEqual(wpGroupChangedFields(vorher, entwurf), [],
		"nichts anfassen, was sich nicht aendert -- sonst hebt ein Speichern ohne Aenderung die "
		+ "Revision jedes Segments und schickt jedem warmen Client die halbe Karte neu");
}

// ── 7) Die andere Quelle vergleicht Adresse UND Linktext ──────────────────────────────────────
{
	const mitQuelle = schattenbachpass().map((s) => Object.assign({}, s, {
		other_source: { url: "https://beispiel.invalid/a", label: "Quelle" }
	}));
	const vorher = wpGroupFieldStates(mitQuelle, TRANSPORTE);
	assert.equal(vorher.other_source.gleich, true);

	const rumpf = {
		name: "Schattenbachpass", show_label: false, feature_subtype: null,
		transports: {
			caravan: "aus", groupFoot: "an", lightWalker: "an",
			horseCarriage: "teils", groupHorse: "aus", lightRider: "aus"
		}
	};
	assert.deepEqual(wpGroupChangedFields(vorher, Object.assign({}, rumpf, {
		other_source: { url: "https://beispiel.invalid/a", label: "Quelle" }
	})), [], "derselbe Eintrag ist keine Aenderung");
	assert.deepEqual(wpGroupChangedFields(vorher, Object.assign({}, rumpf, {
		other_source: { url: "https://beispiel.invalid/a", label: "Geographia" }
	})), ["other_source"], "derselbe Link mit anderem Text IST eine Aenderung");
}

// ── 8) Randfaelle: leere Gruppe, unbekannter Fahrtyp ──────────────────────────────────────────
{
	const leer = wpGroupFieldStates([], TRANSPORTE);
	assert.equal(leer.gesamt, 0);
	assert.equal(leer.transports.caravan.zustand, "aus", "0 von 0 ist „aus“, nicht „teils“");
	assert.deepEqual(leer.feature_subtype.verteilung, []);

	// Ein Fahrtyp, den der Stand gar nicht kennt (neue Wasserart am Landweg o. ae.): sicherheits-
	// halber als Aenderung lesen, nie stillschweigend verschlucken.
	const vorher = wpGroupFieldStates(schattenbachpass(), TRANSPORTE);
	assert.deepEqual(wpGroupChangedFields(vorher, {
		name: null, show_label: null, feature_subtype: null, other_source: null,
		transports: { riverSailer: "an" }
	}), ["allowed_transports"]);
}

// ── 9) DIE VERDRAHTUNG — EINE RECHNUNG OHNE AUFRUFER IST DER FEHLER, DEN SIE VERHINDERN SOLL ──
//
// 🪤 Genau das ist im Haus schon passiert: eine getestete Funktion, die niemand rief, kam durch
// sechs Code-Reviews. Deshalb wird hier am DOKUMENT nachgezaehlt, statt es anzunehmen.
{
	const fs = require("node:fs");
	const path = require("node:path");
	const lies = (...teile) => fs.readFileSync(path.resolve(__dirname, "..", "..", "..", ...teile), "utf8");
	const editor = lies("js", "pages", "wege-editor.js");

	assert.ok(editor.includes("wpGroupFieldStates(gruppe.segments"),
		"der Editor rechnet den Vergleichsstand nicht aus -- ohne ihn kann er nicht sagen, welches "
		+ "Feld jemand angefasst hat");
	assert.ok(editor.includes("wpGroupChangedFields(state.groupStand, state.groupDraft)"),
		"der Speicherweg fragt nicht, was sich geaendert hat -- er schriebe alle Felder");
	assert.ok(editor.includes("wpGroupTransportDecisions(state.groupStand, state.groupDraft)"),
		"die Fahrtypen reisen nicht als Entscheidungen -- ein halber Haken waere dann ein „aus“");
	assert.ok(editor.includes("action: \"update_path_group_details\""),
		"der Sammel-Schreibweg wird nicht gerufen");

	// 🔴 Zwei Gesten an einer Zeile: der Pfeil klappt auf und zu, die Zeile waehlt den Weg.
	assert.ok(editor.includes("event.target.closest(\".wp-group__twist\")"),
		"der Aufklapp-Pfeil ist nicht mehr vom Rest der Zeile getrennt -- dann waehlt jedes "
		+ "Zuklappen den Weg mit aus");
	assert.ok(editor.includes("void selectGroup(groupKey)"),
		"die Gruppenzeile waehlt den Weg nicht aus");

	// 💣 Ein einteiliger Weg behaelt die Abschnittsmaske -- zwei Masken fuer dasselbe Objekt sind
	// eine Divergenz, die auf ihren ersten Unterschied wartet.
	assert.ok(editor.includes("gruppe.segments.length < 2"),
		"ein einteiliger Weg bekommt die Weg-Ebene -- er soll sie nicht bekommen");

	// Die beiden Ebenen schliessen einander aus.
	assert.ok(editor.includes("state.selectedGroup = null;"),
		"die Abschnittsauswahl raeumt die Weg-Ebene nicht ab");

	// 💣 Der dritte Haken-Zustand liegt im ENTWURF, nicht im Kaestchen: `indeterminate` ist eine
	// Anzeige und ueberlebt keinen Klick.
	assert.ok(editor.includes("state.groupDraft.transports[key] = box.checked"),
		"der Haken-Zustand wird nicht in den Entwurf geschrieben");

	const seite = lies("html", "wege-editor.html");
	assert.ok(seite.includes("/js/pages/wege-editor-model.js"),
		"die Seite laedt das Modell nicht -- die Rechnung waere unerreichbar");
}

console.log("wege-gruppe-felder.test.js: alle Zusicherungen gruen");
