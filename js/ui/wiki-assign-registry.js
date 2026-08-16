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
		extra: {
			// 🔴 DER DRITTE ZUSTAND, seit 16.08.2026 auch beim Weg (Aufgabe 5c). Bis dahin stand hier
			// „KEIN dritter Zustand", und der Grund war gemessen richtig: die LESESEITE trug den Merker
			// laengst -- die Anreicherung ehrt ihn vor jeder Typweiche
			// (avesmapsEnrichMapFeatureWikiUrl, api/app/map-features.php:983) und die Konfliktregel
			// liest ihn auch fuer `path` (api/_internal/conflicts/rules.php:29 + :371) --, aber es gab
			// keinen SCHREIBWEG. Er steht jetzt in avesmapsApplyPathWikiNoArticle
			// (api/_internal/map/features.php:2351), und BEIDE Payload-Bauer schicken den Merker:
			// buildPathEditPayload (js/review/review-paths.js:180) und saveDraft
			// (js/pages/wege-editor.js:774). Der Wege-Editor bekommt ihn ueber die weisse Liste seiner
			// Wegeliste (api/edit/map/paths-editor.php:150), der Kartendialog ueber den Kartenpayload.
			// WIRKLICHKEIT nach dem Umbau gemessen, nicht davor.
			// 💣 Nur einen der zwei PAYLOAD-BAUER zu bedienen waere die „vier Erzeuger"-Fehlerklasse aus
			// AGENTS.md §11 gewesen: die andere Oberflaeche koennte den Merker nie aendern.
			// 🪤 Und JEDER Zuweiser des Wegs loescht den Merker beim Zuweisen -- hier stand am
			// 16.08.2026 „ZWEI Zuweiser" samt Namen, und es waren DREI (avesmapsWikiPathAssignAll
			// fehlte; gefunden von der Konsistenz-Pruefung, nicht vom Test). Eine ZAHL liest sich wie
			// eine vollstaendige Liste. Gezaehlt wird deshalb im Test
			// (api/_internal/map/__tests__/weg-wiki-no-article-test.php, Zusicherung 7): er sucht JEDE
			// Funktion, die `['wiki_path'] = ` schreibt, und verlangt von jeder das `unset`.
			// 🔴 UND DAS ANHAKEN LEERT EINE GESPEICHERTE FLACHE `properties.wiki_url` (Owner-Entscheid
			// 16.08.2026). Der Weg hat in keiner seiner zwei Oberflaechen ein Adressfeld; ein
			// serverseitiger Riegel waere hier eine Absage ohne Ausweg. Die Begruendung steht
			// ausgeschrieben an der Schreibstelle.
			keinArtikelHaken: true,
			// ⚠️ Der letzte Halbsatz ist tragend (wie bei Ort und Kraftlinie): der Merker ist NICHT
			// endgueltig -- taucht im Wiki ein Artikel auf, kommt der Fall von selbst zurueck. Ohne ihn
			// liest er sich als „nie wieder" und die Wiedervorlage wirkt wie ein Fehler.
			// 🪤 UND DER ERSTE HALBSATZ IST EINE KORREKTUR. Hier stand bis zum 16.08.2026 „Nimmt diesen
			// Weg aus der Konfliktliste", und das war gemessen falsch: der Merker traf nur das
			// bearbeitete Wegstueck, der Fall blieb im Zentrum als „2 von 3 Segmenten" stehen. Seit
			// avesmapsApplyPathWikiNoArticleToNameGroup reicht er ueber den ganzen Namensverbund --
			// dieselbe Weite wie „Zuweisen" im selben Kasten und wie die Reparatur-Verben des
			// Konfliktzentrums. Der Satz sagt die Reichweite jetzt AUSDRUECKLICH, weil ein Editor sie
			// dem Haekchen sonst nicht ansieht.
			// ⚠️ ANDERS ALS BEI „ENTFERNEN" WIRD NICHT NACHGEFRAGT, und das ist kein Versehen: dessen
			// Reichweite SCHWANKT (ein Segment / der ganze Weg / die wiki_key-Vereinigung), deshalb
			// misst es sie erst und fragt dann. Die des Haekchens ist immer dieselbe -- eine Rueckfrage
			// koennte nur wiederholen, was hier schon steht, und stuende bei jedem Klick im Weg.
			keinArtikelHinweis: "Gilt für alle Abschnitte dieses Wegs und nimmt ihn aus der Konfliktliste — bis im Wiki einer auftaucht.",
		},
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
		// 🔴 EINWOHNER, LAGE UND HERRSCHER HABEN SEIT DEM 16.08.2026 EIN KARTENZIEL (Owner-Entscheid).
		// Hier stand bis dahin das Gegenteil, und es war gemessen richtig: es gab kein Feld dafuer.
		// Genau das war der Befund aus Aufgabe 5 -- das zentrale Sync-Beispiel des Entwurfs („beim Ort
		// sind es fuenf, darunter Einwohnerzahl und Herrscher") beschrieb Felder, die niemand gebaut
		// hatte. Sie heissen jetzt auf der Karte wie im Nest (einwohner/lage/oberhaupt), deshalb ist
		// jede Zeile eine Zeile und niemand uebersetzt; die Liste der Kartenfelder steht in
		// js/ui/wiki-assign-ort.js (AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER) und wird gegen diese
		// Erklaerung geprueft.
		// ⚠️ `lage` ist ABGELEITET wie `ortsgroesse`: der Parser liest `region` und `staat` einzeln und
		// setzt daraus „Region · Staat" zusammen (settlements.php:607-610). Die zwei Haelften bleiben
		// als Anzeige-Zeilen stehen -- sie sind eigene Infoboxfelder und brauchen eine Erklaerung,
		// sonst meldet Pruefung 2 sie als vergessen. Drei Zeilen sagen damit dasselbe; nur eine hat
		// ein Ziel.
		// 🔴 KEIN Kartenziel fuer `bevoelkerung`, `handelszone`, `verkehrswege`, `tempel` und `art` --
		// dafuer gibt es weiterhin kein Feld, und hier wird nichts auf Vorrat erklaert.
		felder: [
			{ wiki: "name", karte: "name", label: "Name" },
			{ wiki: "art", karte: "", label: "Art" },
			{ wiki: "ortsgroesse", karte: "feature_subtype", label: "Ortsgröße" },
			{ wiki: "einwohner", karte: "einwohner", label: "Einwohner" },
			{ wiki: "bevoelkerung", karte: "", label: "Bevölkerung" },
			{ wiki: "oberhaupt", karte: "oberhaupt", label: "Herrscher" },
			{ wiki: "region", karte: "", label: "Region" },
			{ wiki: "staat", karte: "", label: "Staat" },
			{ wiki: "lage", karte: "lage", label: "Lage" },
			{ wiki: "handelszone", karte: "", label: "Handelszone" },
			{ wiki: "verkehrswege", karte: "", label: "Verkehrswege" },
			{ wiki: "tempel", karte: "", label: "Tempel" },
		],
		sync: true, // fuenf Kartenziele -- also ein Knopf
		extra: {
			// 🔴 Der Rat des Leerzustands, und er ist objektart-eigen, weil die QUELLE es ist: die
			// Ortssuche liest die Registry `wiki_sync_pages` (settlements.php:710), nicht das Wiki --
			// wer dort nichts findet, muss den Orte-Sync laufen lassen, nicht anders suchen. Der Satz
			// stand wortgleich im alten Picker („Keine Treffer in der Registry. Ggf. erst die
			// Orte-Sync laufen lassen.") und waere mit dem Umbau ersatzlos verschwunden -- „Keine
			// Treffer" allein sagt nur, DASS nichts da ist, nicht, was zu tun ist.
			keineTrefferHinweis: "Ggf. erst die Orte-Sync laufen lassen.",
			// 🔴 DER DRITTE ZUSTAND, seit 16.08.2026 auch beim Ort -- und hier ist er nicht bloss ein
			// Ordnungsmerkmal wie bei den Kraftlinien, sondern die REPARATUR: ohne ihn raet
			// avesmapsEnrichMapFeatureWikiUrl (api/app/map-features.php:983) beim naechsten
			// Kartenladen eine Adresse aus dem Ortsnamen zurueck, „geloescht" und „nie gesetzt" sind
			// fuer sie dasselbe, und ein entfernter Wiki-Link kehrt wieder. Das IST Discord #38.
			// Geschrieben wird der Merker von `update_point` (avesmapsApplyPointWikiFields).
			keinArtikelHaken: true,
			// ⚠️ Der zweite Halbsatz ist tragend (wie bei den Kraftlinien): der Merker ist NICHT
			// endgueltig -- taucht im Wiki ein Artikel auf, kommt der Fall von selbst zurueck. Ohne
			// ihn liest er sich als „nie wieder" und die Wiedervorlage wirkt wie ein Fehler.
			keinArtikelHinweis: "Hält die Löschung — und nimmt den Ort aus der Konfliktliste, bis im Wiki einer auftaucht.",
		},
	},
	landschaft: {
		label: "Wiki-Landschaft",
		// Gemessen am Endpunkt: avesmapsWikiRegionSearch (api/_internal/wiki/regions.php:1086-1122)
		// beantwortet `?action=search&q=…&limit=40` mit `{ok, count, rows}`. Dieselbe Adresse und
		// dasselbe Limit wie die zwei alten Picker (map-features-ecosystem-properties.js:233 und
		// js/review/review-label-wiki.js:215, Stand 16.08.2026).
		suche: { art: "server", url: "/api/edit/wiki/regions.php" },
		// KEIN Objektart-Vorsatz: die Trefferzeile beginnt mit der Wiki-Art („Wald", „Gebirge") --
		// das sagt genauer, was der Treffer ist, als das Wort „Landschaft". Wortgleich zu dem, was
		// BEIDE alten Picker als Meta-Zeile zeigten: `[row.art, row.region_parent, row.continent]`.
		// ⚠️ DIE FELDNAMEN SIND DIE DER STAGING-SPALTEN, nicht huebschere: `region_parent`,
		// `affiliation_staat`, `continent`. Damit deckt sich die Erklaerung Zeile fuer Zeile mit dem,
		// was der Parser liefert (avesmapsWikiRegionParse…, api/_internal/wiki/regions.php:589-596),
		// und niemand uebersetzt -- dieselbe Regel wie beim Ort, wo `einwohner`/`lage`/`oberhaupt`
		// auf der Karte heissen wie im Nest. Die Beschriftung macht `label`.
		treffer: ["art", "region_parent", "continent"],
		// 💣 ZWEI ZEILEN FUER DIE ART, UND DAS IST ABSICHT -- dieselbe Trennung wie `art`/`wegtyp`
		// beim Weg und `art`/`ortsgroesse` beim Ort. `art` ist der freie Wikitext („Mischregion,
		// Wald"), `landschaftsart` der daraus geprueften Flaechenart-Schluessel („wald"). Nur der
		// Schluessel darf nach `region_type`; roh verglichen meldete die Vorschau bei fast JEDER
		// Landschaft einen Unterschied und boete an, freien Text in ein Schluesselfeld zu schreiben.
		// Die Abbildung steht in avesmapsWikiAssignLandschaftArt (js/ui/wiki-assign-landschaft.js),
		// weil sie fuer beide Oberflaechen dieselbe sein muss -- und weil sie die einzige Stelle ist,
		// an der die Ordnung „eigenes Vokabular vor Server-Synonymen" steht (dort begruendet).
		// ⚠️ `landschaftsart` ist damit ein ABGELEITETES Wiki-Feld: der Parser liefert `art`, die
		// Oberflaeche rechnet den Schluessel. Pruefung 2 aus §3b sieht das nicht (sie prueft nur die
		// andere Richtung) -- deshalb steht es hier ausdruecklich.
		//
		// 🔴 EINE Zeile fuer `name` MIT Kartenziel. Anders als beim Weg (dort schreibt der Server den
		// kanonischen Namen selbst) besitzt die Wiki-Landschaft den Namen zwar auch -- aber das
		// Umbenennen macht der CLIENT: `pickWikiRegion` schreibt ihn ins Namensfeld, der Server fasst
		// `ecosystem_region.name` bei einer Zuweisung nicht an (avesmapsUpdateEcosystemRegion schreibt
		// nur, was im Rumpf steht). Der Name bleibt also ein Kartenfeld, das der Sync fuellen kann.
		// 🔴 KEIN Kartenziel fuer Staat, Kontinent, Einwohner, Sprache, Vegetation und Verkehrswege:
		// `ecosystem_region` hat dafuer KEINE Spalte (gemessen an der DDL,
		// api/_internal/app/ecosystem.php:243-265 -- name/kind/region_type/origin/wiki_*/label/
		// properties_json, mehr nicht). Hier wird nichts auf Vorrat erklaert.
		felder: [
			{ wiki: "name", karte: "name", label: "Name" },
			{ wiki: "art", karte: "", label: "Art" },
			{ wiki: "landschaftsart", karte: "region_type", label: "Landschaftsart" },
			{ wiki: "region_parent", karte: "", label: "Lage" },
			{ wiki: "affiliation_staat", karte: "", label: "Staat" },
			{ wiki: "continent", karte: "", label: "Kontinent" },
			{ wiki: "einwohner", karte: "", label: "Einwohner" },
			{ wiki: "sprache", karte: "", label: "Sprache" },
			{ wiki: "vegetation", karte: "", label: "Vegetation" },
			{ wiki: "verkehrswege", karte: "", label: "Verkehrswege" },
		],
		sync: true, // zwei Kartenziele (name, region_type) -- also ein Knopf
		extra: {
			// 🔴 DER DRITTE ZUSTAND, seit 16.08.2026 auch bei der Landschaft (Aufgabe 6). Er liegt in
			// `ecosystem_region.properties_json` -- die Spalte gab es seit V2.3, sie war nur von KEINEM
			// Leseweg herausgegeben und von keinem Client beschrieben (gemessen: `properties` erreichte
			// avesmapsEcosystemReadRegionFields nie, und `list_regions` waehlte die Spalte nicht aus).
			// Geschrieben wird der Merker von `update_region` (avesmapsEcosystemApplyRegionNoArticle),
			// gelesen aus `list_regions` -- der EINEN Aktion, aus der BEIDE Oberflaechen ohnehin ihr
			// Art-Vokabular ziehen.
			// 🪤 UND WAS ER HIER NICHT TUT, steht ausdruecklich hier, damit es niemand versehentlich
			// verspricht: eine `ecosystem_region` steht in KEINER Konfliktliste.
			// avesmapsConflictLoadMapRows liest ausschliesslich `map_features`
			// (location|path|label|powerline, api/_internal/conflicts/rules.php:372-376), und
			// avesmapsEnrichMapFeatureWikiUrl raet ebenfalls nur dort Adressen zusammen. Der Merker
			// haelt heute also die ENTSCHEIDUNG fest und sonst nichts -- der Satz unten verspricht
			// deshalb bewusst keine Konfliktliste (anders als bei Ort, Weg und Kraftlinie).
			keinArtikelHaken: true,
			// ⚠️ Der zweite Halbsatz ist tragend (wie bei allen drei bisherigen): der Merker ist NICHT
			// endgueltig -- taucht im Wiki ein Artikel auf, gilt er nicht mehr. Ohne ihn liest er sich
			// als „nie wieder".
			keinArtikelHinweis: "Hält fest, dass im Wiki nichts zu dieser Landschaft steht — bis dort einer auftaucht.",
		},
	},
	// Die uebrigen drei kommen in den Aufgaben 7-9 dazu, jede mit IHRER Aufgabe -- nicht auf Vorrat:
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
