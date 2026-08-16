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
		// Der Name der OBJEKTART -- er steht dem Rest der Trefferzeile voran (Mockup: "Kraftlinie ·
		// kontinental · Maraskan"). Reine Beschriftung, nie ein Schluessel.
		art: "Kraftlinie",
		// ✅ ERLEDIGT AM 16.08.2026 (Aufgabe 3). Hier stand: die Nutzlast projiziere `wiki_articles`
		// nur auf name/wiki_url/wiki_key, staerke und regionen erreichten den Browser also gar
		// nicht, obwohl der Parser sie liefert -- die zweite Trefferzeile waere still leer
		// geblieben. Die Projektion in api/edit/map/powerlines.php traegt seither alle vier
		// Anzeigefelder, mit denselben Schluesseln wie das Nest `properties.wiki_powerline`.
		treffer: ["staerke", "regionen"],
		// Vier Wiki-Felder (api/_internal/wiki/powerlines.php: staerke, affinitaet, laenge,
		// regionen), aber KEIN bearbeitbares Kartenfeld -- jede Zeile bleibt trotzdem erklaert
		// (karte: ""), sonst meldete Pruefung 2 (§3b) alle vier faelschlich als "vergessen".
		// ⚠️ `label` ist hier NICHT bequem, sondern noetig: die Rueckfallkette des Bauteils lautet
		// label -> karte -> wiki, und `karte` ist bei einer Anzeige-Zeile leer -- ohne Beschriftung
		// staende im Kasten "staerke" statt "Stärke".
		felder: [
			{ wiki: "staerke", karte: "", label: "Stärke" },
			{ wiki: "affinitaet", karte: "", label: "Affinität" },
			{ wiki: "laenge", karte: "", label: "Länge" },
			{ wiki: "regionen", karte: "", label: "Regionen" },
		],
		sync: false, // kein Ziel -- also auch kein Knopf
		extra: {
			keinArtikelHaken: true,
			// 🔴 Der zweite Halbsatz ist tragend: der Merker ist NICHT endgueltig -- der Abgleich
			// macht ihn wieder auf, sobald im Wiki ein passender Artikel auftaucht. Ohne ihn liest
			// er sich als endgueltig, und die Wiedervorlage wirkt wie ein Fehler. Der Satz stand
			// wortgleich in html/wiki-sync-powerline-editor.html und ist mit umgezogen; die
			// allgemeine Fassung des Bauteils sagt "das Objekt" statt "die Linie".
			keinArtikelHinweis: "Nimmt die Linie aus der Konfliktliste — bis im Wiki einer auftaucht.",
		},
	},
	weg: {
		label: "Wiki-Weg",
		// Gemessen am Endpunkt, nicht am (mit diesem Umbau geloeschten) alten Picker:
		// avesmapsWikiPathSearch (api/_internal/wiki/paths.php:707-733) beantwortet
		// `?action=search&q=…&limit=40` mit `{ok, count, rows}`; die Suchspalten stehen auf
		// :711-712. Dieselbe Adresse und dasselbe Limit wie der alte Picker.
		suche: { art: "server", url: "/api/edit/wiki/paths.php" },
		// KEIN Objektart-Vorsatz: die Trefferzeile beginnt mit „Fluss" bzw. „Straße/Weg" (das Feld
		// `kind`), und das sagt genauer, was der Treffer ist, als das Wort „Weg" -- es entscheidet
		// naemlich, ob der Server die Zuweisung ueberhaupt annimmt (Typriegel Fluss <-> Strasse).
		// Wortgleich zur Meta-Zeile, die der alte Picker zeigte: Art des Wegs, dann `art`, dann
		// `lage` -- nachgefahren im Ablauf, siehe den Bericht zu Aufgabe 4.
		treffer: ["kind", "art", "lage"],
		// 💣 ZWEI ZEILEN FUER EINE SACHE, UND DAS IST ABSICHT. `art` ist der freie Wikitext
		// („Reichsstraße"), `wegtyp` der daraus abgebildete Schluessel („Reichsstrasse",
		// PATH_SUBTYPE_KEYS). Nur der Schluessel darf nach `feature_subtype` -- roh verglichen
		// meldete die Vorschau bei JEDEM Weg einen Unterschied und boete an, freien Text in ein
		// Schluesselfeld zu schreiben. Die Abbildung steht in avesmapsWikiAssignWegWegtyp
		// (js/ui/wiki-assign-weg.js), weil sie fuer beide Oberflaechen dieselbe sein muss.
		// ⚠️ `wegtyp` ist damit ein ABGELEITETES Wiki-Feld: der Parser liefert es nicht, die
		// Oberflaeche rechnet es. Pruefung 2 aus §3b sieht das nicht (sie prueft nur die andere
		// Richtung: geliefert, aber nicht erklaert) -- deshalb steht es hier ausdruecklich.
		//
		// 🔴 KEINE Zeile fuer `name`. Das Mockup schreibt „Name→name" (docs/wiki-zuweisung-
		// mockup.html:262), aber ein zugewiesener Wiki-Weg BESITZT den Namen: `assign_to` schreibt
		// den kanonischen Namen serverseitig auf alle getroffenen Segmente (R1,
		// api/_internal/wiki/paths.php:1057), und beide Oberflaechen sperren das Namensfeld
		// daraufhin. Eine Sync-Zeile dafuer koennte nur etwas anbieten, was der Server ohnehin
		// schon getan hat.
		// 🔴 KEIN Kartenziel fuer `laenge`. Das Mockup schreibt „Länge→laenge" -- ein solches Feld
		// gibt es nicht: die Laenge eines Weges entsteht aus seiner Geometrie
		// (`detail.length_units`, js/pages/wege-editor.js:791/794), sie wird nicht gepflegt. Die Zeile
		// bleibt Anzeige.
		felder: [
			{ wiki: "art", karte: "", label: "Art" },
			{ wiki: "wegtyp", karte: "feature_subtype", label: "Wegtyp" },
			{ wiki: "lage", karte: "", label: "Lage" },
			{ wiki: "laenge", karte: "", label: "Länge" },
		],
		sync: true, // ein Kartenziel (feature_subtype) -- also ein Knopf
		// ⚠️ KEIN dritter Zustand. Entwurf §2.7 gilt fuer alle Objektarten, aber der Weg hat heute
		// keinen Ort, an dem „es gibt keinen Artikel" gespeichert werden koennte: `wiki_path`
		// fehlt oder ist da, ein Merker daneben existiert nicht. Ihn zu zeigen hiesse, ein
		// Haekchen anzubieten, das nichts merkt. Offen gemeldet, nicht geraten.
	},
	ort: {
		label: "Wiki-Ort",
		// Gemessen am Endpunkt: avesmapsWikiSettlementSearch (api/_internal/wiki/settlements.php:710)
		// beantwortet `?action=search&q=…&limit=40` mit `{ok, query, rows}`. Dieselbe Adresse und
		// dasselbe Limit wie der alte Picker (js/review/review-settlement-wiki.js, Stand 16.08.2026).
		suche: { art: "server", url: "/api/edit/wiki/settlements.php" },
		// KEIN Objektart-Vorsatz: die Trefferzeile beginnt mit der Ortsgroesse („Stadt", „Dorf") --
		// das sagt genauer, was der Treffer ist, als das Wort „Ort", und ist wortgleich zu dem, was
		// der alte Picker als Meta-Zeile zeigte (`row.settlement_label`).
		// 💣 MEHR KANN DORT NICHT STEHEN. Die Suche liest `wiki_sync_pages` und liefert genau
		// title/name/wiki_key/settlement_class/settlement_label/wiki_url -- KEINE Infoboxwerte
		// (settlements.php:710-758). Die Infobox wird erst beim Zuweisen geparst; wer hier `art`
		// oder `einwohner` hineinschreibt, baut eine zweite Trefferzeile, die immer leer bleibt.
		treffer: ["settlement_label"],
		// 💣 ZWEI ZEILEN FUER DIE GROESSE, UND DAS IST ABSICHT -- dieselbe Trennung wie beim Weg.
		// `art` ist der freie Infoboxtext („Handelsstadt", faellt auf das Klassen-Label zurueck),
		// `ortsgroesse` der daraus gepruefte Schluessel („grossstadt"). Nur der Schluessel darf nach
		// `feature_subtype`; roh verglichen meldete die Vorschau bei fast JEDEM Ort einen
		// Unterschied und boete an, freien Text in ein Schluesselfeld zu schreiben. Die Abbildung
		// steht in avesmapsWikiAssignOrtOrtsgroesse (js/ui/wiki-assign-ort.js), weil sie fuer beide
		// Oberflaechen dieselbe sein muss.
		// ⚠️ `ortsgroesse` ist damit ein ABGELEITETES Wiki-Feld: der Parser liefert
		// `settlement_class`, die Oberflaeche prueft daraus den Schluessel. Pruefung 2 aus §3b sieht
		// das nicht (sie prueft nur die andere Richtung) -- deshalb steht es hier ausdruecklich.
		//
		// 🔴 EINE Zeile fuer `name`, und hier ANDERS ALS BEIM WEG. Der Weg bekommt seinen Namen bei
		// der Zuweisung vom Server (R1); der Ort NICHT: avesmapsWikiSettlementAssignTo schreibt nur
		// `properties.wiki_settlement` und fasst `map_features.name` nicht an
		// (settlements.php:807-857). Der Ortsname bleibt also ein Kartenfeld, das der Editor pflegt
		// -- und genau dafuer gab es bis zum 16.08.2026 den „↻"-Knopf neben dem Namensfeld.
		// 🔴 KEIN Kartenziel fuer Einwohner, Lage und Herrscher. Das Mockup schreibt
		// „Einwohner→einwohner" (docs/wiki-zuweisung-mockup.html:257) -- ein solches Feld gibt es
		// nicht: kein Speicherweg des Ortes kennt eine Einwohnerzahl (weder
		// buildLocationEditPayload noch buildSettlementSavePayload, und update_point schreibt sie
		// nirgends). Dieselbe Sorte Mockup-Fehler wie „Länge→laenge" beim Weg. Anzeige-Zeilen.
		felder: [
			{ wiki: "name", karte: "name", label: "Name" },
			{ wiki: "art", karte: "", label: "Art" },
			{ wiki: "ortsgroesse", karte: "feature_subtype", label: "Ortsgröße" },
			{ wiki: "einwohner", karte: "", label: "Einwohner" },
			{ wiki: "bevoelkerung", karte: "", label: "Bevölkerung" },
			{ wiki: "oberhaupt", karte: "", label: "Herrscher" },
			{ wiki: "region", karte: "", label: "Region" },
			{ wiki: "staat", karte: "", label: "Staat" },
			{ wiki: "handelszone", karte: "", label: "Handelszone" },
			{ wiki: "verkehrswege", karte: "", label: "Verkehrswege" },
			{ wiki: "tempel", karte: "", label: "Tempel" },
		],
		sync: true, // zwei Kartenziele (name, feature_subtype) -- also ein Knopf
		// ⚠️ KEIN dritter Zustand, und diesmal NICHT, weil der Speicherplatz fehlt: `wiki_no_article`
		// gibt es im `properties_json` bereits, der Leseweg ehrt ihn (avesmapsEnrichMapFeatureWikiUrl,
		// api/app/map-features.php:983), und das Konfliktzentrum setzt ihn (repair.php:328). Was fehlt,
		// ist ein SCHREIBWEG der beiden Ort-Oberflaechen: `update_point` liest den Merker nicht
		// (avesmapsUpdatePointFeatureDetails, api/_internal/map/features.php:1252-1305 -- es reicht
		// ihn nur unveraendert durch), und der Siedlungs-Endpunkt kennt ihn ebenfalls nicht. Ein
		// Haekchen anzubieten, das nichts merkt, waere schlimmer als keins. Offen gemeldet
		// (.superpowers/sdd/…/aufgabe-5-bericht.md), nicht geraten.
	},
	// Die uebrigen sieben kommen in den Aufgaben 6-9 dazu, jede mit IHRER Aufgabe -- nicht auf Vorrat:
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
