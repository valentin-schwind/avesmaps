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
		// Gemessen am Endpunkt: avesmapsWikiRegionSearch (api/_internal/wiki/regions.php:1098-1134)
		// beantwortet `?action=search&q=…&limit=40` mit `{ok, count, rows}`. Dieselbe Adresse und
		// dasselbe Limit wie die zwei alten Picker (map-features-ecosystem-properties.js und js/review/review-label-wiki.js,
		// beide am 16.08.2026 durch das Bauteil abgeloest).
		suche: { art: "server", url: "/api/edit/wiki/regions.php" },
		// KEIN Objektart-Vorsatz: die Trefferzeile beginnt mit der Wiki-Art („Wald", „Gebirge") --
		// das sagt genauer, was der Treffer ist, als das Wort „Landschaft". Wortgleich zu dem, was
		// BEIDE alten Picker als Meta-Zeile zeigten: `[row.art, row.region_parent, row.continent]`.
		// ⚠️ DIE FELDNAMEN SIND DIE DER STAGING-SPALTEN, nicht huebschere: `region_parent`,
		// `affiliation_staat`, `continent`. Damit deckt sich die Erklaerung Zeile fuer Zeile mit dem,
		// was der Parser liefert (avesmapsWikiRegionParsePage, api/_internal/wiki/regions.php:589-596),
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
			// (location|path|label|powerline, api/_internal/conflicts/rules.php:96-101), und
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
	// 🔴 DIE ZWEITE HAELFTE DER LANDSCHAFT -- und eine EIGENE Objektart, gemessen, nicht angenommen.
	// Der Label-Dialog sucht dieselbe Wiki-Landschaft gegen denselben Endpunkt, heftet sie aber an ein
	// `map_features`-LABEL statt an die gezeichnete Flaeche. Die Kartenseite ist eine andere: andere
	// Tabelle, anderer Schreibweg (`update_label`), andere Feldnamen (`text`/`feature_subtype` statt
	// `name`/`region_type`) und ein anderes Zielvokabular fuer die Art (EINE Liste aus 30 Werten, die
	// `berggipfel`, `vulkan`, `ebene` und `fluss` kennt -- die Flaechenarten nicht). Die volle Messung
	// steht im Kopf von js/ui/wiki-assign-landschaft.js.
	// ⚠️ Zusammenzulegen waere eine erzwungene Gemeinsamkeit. Geteilt wird der DATENWEG (Werte,
	// Treffer, Artikel, Art-Ordnung, Synonymtabelle) -- nicht die Erklaerung.
	landschaftslabel: {
		label: "Wiki-Landschaft",
		suche: { art: "server", url: "/api/edit/wiki/regions.php" },
		treffer: ["art", "region_parent", "continent"],
		// 🔴 `name` zeigt auf `text` -- so heisst das Namensfeld eines Labels. Dafuer gab es bis zum
		// 16.08.2026 den „↻"-Knopf neben dem Textfeld („Text aus dem Wiki uebernehmen"); er ist mit
		// dem Umbau gefallen, weil die Sync-Vorschau dasselbe tut und dabei ZEIGT, was sie aendert.
		// 🔴 `landschaftsart` zeigt hier auf `feature_subtype` -- derselbe abgeleitete Wiki-Feldname
		// wie bei der Flaeche, ein anderes Ziel. Auch dafuer gab es einen „↻"-Knopf („Kategorie aus
		// dem Wiki uebernehmen"), und auch der ist gefallen.
		// 🔴 KEIN Kartenziel fuer den Rest: Groesse, Drehung, Zoom-Baender und Prioritaet gehoeren dem
		// Label allein und haben im Wiki keine Entsprechung; Einwohner, Sprache und Vegetation haben
		// am Label kein Feld.
		felder: [
			{ wiki: "name", karte: "text", label: "Name" },
			{ wiki: "art", karte: "", label: "Art" },
			{ wiki: "landschaftsart", karte: "feature_subtype", label: "Kategorie" },
			{ wiki: "region_parent", karte: "", label: "Lage" },
			{ wiki: "affiliation_staat", karte: "", label: "Staat" },
			{ wiki: "continent", karte: "", label: "Kontinent" },
			{ wiki: "einwohner", karte: "", label: "Einwohner" },
			{ wiki: "sprache", karte: "", label: "Sprache" },
			{ wiki: "vegetation", karte: "", label: "Vegetation" },
			{ wiki: "verkehrswege", karte: "", label: "Verkehrswege" },
		],
		sync: true, // zwei Kartenziele (text, feature_subtype) -- also ein Knopf
		extra: {
			// 🔴 UND HIER VERSPRICHT DER HINWEIS DIE KONFLIKTLISTE ZU RECHT -- anders als bei der
			// Flaeche daneben. Ein Label IST eine Konfliktpartei (`feature_type='label'` -> Typ
			// „Region/Landschaft", api/_internal/conflicts/rules.php), und die Regel `wiki.missing_key`
			// liest `properties.wiki_no_article` seit dem 15.08.2026. Es fehlte nur der Schreibweg;
			// den traegt seit dem 16.08.2026 `update_label`.
			keinArtikelHaken: true,
			keinArtikelHinweis: "Nimmt das Label aus der Konfliktliste — bis im Wiki einer auftaucht.",
		},
	},
	territorium: {
		label: "Wiki-Herrschaftsgebiet",
		// 🔴 KEINE Server-Suche, und das ist gemessen, nicht bequem: unter api/edit/wiki/ hat NUR
		// territories.php keinen `search`-Arm (36 Zeilen, reine Seed-Liste), und der GET-Verteiler des
		// Politik-Endpunkts kennt list/wiki/wiki_list/hierarchy -- kein `search`
		// (api/_internal/political/territories-endpoint.php:149-169). Die Kandidaten kommen wie bisher
		// aus `?action=wiki_list` (avesmapsPoliticalListWikiReferences,
		// api/_internal/political/territories-read.php:373-413) und werden IM BROWSER gefiltert --
		// genau das beschreibt Entwurf §1 mit „Eine (`region`) filtert im Browser".
		// 💣 UND DIESE QUELLE IST PFLICHT, nicht eine von zweien: `update_territory` will die
		// `wiki_id` (= political_territory_wiki.id, api/_internal/political/territories-write.php:239),
		// und die gibt es NUR dort. Der Modellbaum (`?action=model_tree`) traegt sie nicht -- wer die
		// Kandidaten von dort holt, kann nicht mehr zuweisen.
		// 🔴 ACHT SUCHFELDER UND EIN DECKEL VON 250 -- das ist KEINE Ausschmueckung, sondern die
		// Erhaltung dessen, was der abgeloeste Picker konnte (`getWikiReferenceSearchText`,
		// js/review/review-region-wiki-picker.js vor dem Umbau; Deckel `.slice(0, 250)`). Auf „nur der
		// Name, hoechstens 40" umgestellt, faende ein Editor ein Gebiet, das er bisher ueber seinen
		// Herrscher oder seine Hauptstadt gefunden hat, nicht mehr -- eine EINBUSSE, keine
		// Vereinfachung. Der eine Filter im Bauteil bleibt einer; er bekommt die Liste als Argument
		// (dasselbe Muster wie avesmapsWikiAssignLandschaftArt mit seinem Vokabular).
		// ⚠️ ALLE ACHT KOMMEN AUCH AN: `?action=wiki_list` gibt sie heraus
		// (avesmapsPoliticalWikiReferenceRowToPublic), und avesmapsWikiAssignTerritoriumWerte legt sie
		// unter `werte` ab -- was die Suche nicht liefert, kann man nicht durchsuchen, und das waere
		// hier eine leere Behauptung statt einer Zeile.
		// 🔴 `name` steht NICHT in der Liste: den durchsucht der Filter immer.
		suche: {
			art: "liste", quelle: "territorien", limit: 250,
			felder: ["type", "affiliation_raw", "affiliation_root", "status", "capital_name", "seat_name", "ruler"],
		},
		// KEIN Objektart-Vorsatz: die Trefferzeile beginnt mit der Staatsform („Königreich",
		// „Baronie") -- das sagt genauer, was der Treffer ist, als das Wort „Herrschaftsgebiet".
		// Wortgleich zu dem, was der alte Picker als Meta-Zeile zeigte: `[entry.type,
		// entry.affiliation_root, entry.continent, buildWikiReferencePeriod(entry)]`
		// (js/review/review-region-wiki-picker.js, Stand 16.08.2026).
		treffer: ["type", "affiliation_root", "continent", "zeitraum"],
		// 💣 DIE GESPERRTE ZEILE IST `eltern`, UND IHR ZIELNAME IST NICHT `parent_public_id`.
		// Verglichen werden NAMEN („Kaiserreich Mittelreich" gegen „Fürstentum Kosch"); eine
		// public_id in einer Vorschauzeile liest niemand, und der Editor koennte nicht beurteilen,
		// was er anhakt. Die public_id reist getrennt (avesmapsWikiAssignTerritoriumEltern) und wird
		// erst beim Uebernehmen geschrieben -- 🔴 aufgeloest wird NIE ueber den Namen: ein Name ist
		// keine Kennung (`á` gegen `â` hat im Politik-Layer schon ein zweites Gebiet erzeugt).
		// 🔴 `eltern` ist damit ein ABGELEITETES Wiki-Feld wie `wegtyp` beim Weg: der Modellbaum
		// liefert `auto_parent_wiki_key`, der Datenweg macht daraus Name + public_id. Pruefung 2 aus
		// §3b sieht das nicht -- deshalb steht es hier ausdruecklich.
		// 🔴 KEIN Kartenziel fuer Status, Zugehoerigkeit, Wurzel, Hauptstadt, Herrschaftssitz,
		// Oberhaupt, Kontinent, Gegruendet und Aufgeloest: `#region-edit-dialog` reicht diese Felder
		// gar nicht ein (regionEditPayloadToPayload, js/review/review-region-tabs-payload.js:129-151),
		// und `political_territory` hat fuer Oberhaupt/Herrschaftssitz-Text ueberhaupt keine Spalte
		// (sql/political-territories.sql:48-84). Hier wird nichts auf Vorrat erklaert.
		// ⚠️ `zeitraum` ist abgeleitet (Gegruendet + Aufgeloest, wortgleich zu
		// buildWikiReferencePeriod) und traegt nur die Trefferzeile -- `valid_from_bf`/`valid_to_bf`
		// bekommen KEIN Ziel, weil `wiki_list` die BF-Zahlen gar nicht herausgibt, nur die Texte.
		felder: [
			{ wiki: "name", karte: "name", label: "Name" },
			{ wiki: "type", karte: "type", label: "Staatsform" },
			{ wiki: "eltern", karte: "eltern", label: "Eltern" },
			{ wiki: "coat_of_arms_url", karte: "coat_of_arms_url", label: "Wappen" },
			{ wiki: "status", karte: "", label: "Status" },
			{ wiki: "affiliation_raw", karte: "", label: "Zugehörigkeit" },
			{ wiki: "affiliation_root", karte: "", label: "Wurzel" },
			{ wiki: "affiliation_path", karte: "", label: "Zugehörigkeits-Pfad" },
			{ wiki: "capital_name", karte: "", label: "Hauptstadt" },
			{ wiki: "seat_name", karte: "", label: "Herrschaftssitz" },
			{ wiki: "ruler", karte: "", label: "Oberhaupt" },
			{ wiki: "continent", karte: "", label: "Kontinent" },
			{ wiki: "founded_text", karte: "", label: "Gegründet" },
			{ wiki: "dissolved_text", karte: "", label: "Aufgelöst" },
			{ wiki: "zeitraum", karte: "", label: "Zeitraum" },
		],
		sync: true, // vier Kartenziele (name, type, eltern, coat_of_arms_url) -- also ein Knopf
		extra: {
			// 🪤 KEIN dritter Zustand, und das ist eine MESSUNG, keine Auslassung (Aufgabe 7,
			// 16.08.2026). Der Owner-Entscheid §2.7 gilt fuer alle Objektarten -- das Territorium kann
			// den Merker heute nur nicht TRAGEN.
			//
			// 🔴 UND ES IST EINE BEGRUENDETE AUSNAHME, KEINE LUECKE (Owner-Nachtrag 16.08.2026): der
			// ZWECK des Haekchens ist beim Gebiet schon durch die BAUWEISE erfuellt. Ein eigener Knoten
			// taucht in der Konfliktliste gar nicht erst auf -- avesmapsConflictLoadTerritoryRows
			// (api/_internal/conflicts/rules.php:133) verbindet `political_territory` per INNER JOIN mit
			// `political_territory_wiki` (:154) und verlangt zusaetzlich `w.wiki_url <> ''` (:157). Ein
			// Gebiet ohne Wiki-Bezug faellt also zweimal heraus, bevor irgendeine Regel es sieht. Bei
			// Ort, Weg und Landschaftslabel ist das anders: die stehen ueber `map_features` IMMER auf der
			// Liste, und nur der Merker nimmt sie herunter -- deshalb brauchen die drei ihn und dieses
			// eine nicht.
			// 🪤 Der Anlass zu diesem Absatz nannte als Beleg „political_territory.wiki_key ist NOT NULL
			// mit Unique-Key, jedes Gebiet hat also einen Schluessel". NACHGEMESSEN IST DAS FALSCH, und
			// zwar mit vertauschten Haelften: `political_territory.wiki_key` ist
			// `VARCHAR(255) NULL` (sql/political-territories.sql:52) unter einem NICHT-eindeutigen
			// `KEY idx_political_territory_wiki_key` (:80). `NOT NULL` samt `UNIQUE KEY` gehoert der
			// ANDEREN Tabelle, `political_territory_wiki.wiki_key` (:3 bzw. :43). Ein Gebiet OHNE
			// Schluessel ist also sehr wohl moeglich -- die Ausnahme traegt der INNER JOIN oben, nicht
			// die Spaltendefinition. Der Satz steht hier, damit der falsche Beleg nicht das naechste Mal
			// als Begruendung wiederkehrt.
			//
			// Die drei Gruende, warum er nicht getragen werden KANN:
			//   1. `political_territory` hat keine JSON-/Eigenschaftsspalte. Die vollstaendige
			//      Spaltenliste steht in sql/political-territories.sql:48-84 und wird von genau EINEM
			//      ALTER ergaenzt (wiki_key, api/_internal/political/territory.php:151); das einzige
			//      freie Textfeld ist `editor_notes` und ist kein Merker. Ort, Weg und Landschaft
			//      hatten alle drei ein `properties_json` -- deshalb kostete es dort keine Migration.
			//   2. `wiki_territory_model.metadata_overrides_json` haengt am WIKI-Knoten, nicht am
			//      Kartenobjekt -- ein Gebiet OHNE Artikel hat dort gar keine Zeile. Der Merker
			//      koennte also genau den Fall nicht festhalten, fuer den er da ist.
			//   3. Und er waere heute WIRKUNGSLOS: avesmapsConflictLoadTerritoryRows
			//      (api/_internal/conflicts/rules.php:151-158) verbindet `political_territory` per
			//      INNER JOIN mit `political_territory_wiki` und verlangt `w.wiki_url <> ''` -- ein
			//      Gebiet ohne Wiki-Bezug erreicht die Beobachtungsliste nie, und die erzeugte Zeile
			//      (:184-192) setzt keinen `no_article`-Schluessel, den avesmapsConflictRuleMissingKey
			//      (:371) lesen koennte.
			// 🔧 Der ehrliche Weg waere eine Spalte an `political_territory` plus ein Schreibweg in
			// `update_territory` plus die zwei Zeilen in der Konfliktregel -- eine Owner-Entscheidung,
			// kein Nachtrag. Hier nichts erfinden.
			keinArtikelHaken: false,
		},
	},
	literatur: {
		label: "Wiki-Literatur",
		// 🔴 DIE SUCHE GAB ES NICHT -- sie ist mit dieser Aufgabe entstanden (16.08.2026). Am
		// Livecode nachgemessen: `wiki_adventure_catalog` wurde an genau sieben Stellen gelesen, JEDE
		// ueber einen exakten `wiki_key` oder einen Cursor (api/_internal/wiki/game-literature-sync.php
		// :652, :909, :967, :1033, :1105, game-literature-plan-apply.php:63,
		// api/edit/map/game-literature-cover.php:69) -- kein `LIKE`, kein `q`, kein `action=search`.
		// Die Literatur war damit die einzige Objektart, deren Wiki-Adresse man TIPPEN musste.
		// ⚠️ EIGENE DATEI, nicht ein Arm von api/edit/map/game-literature.php: jene ist POST-only (ihr
		// `match` liest `$payload['action']`), das Bauteil holt seine Treffer per GET.
		suche: { art: "server", url: "/api/edit/wiki/game-literature.php" },
		// KEIN Objektart-Vorsatz: die Trefferzeile beginnt mit der Wiki-Art („Abenteuer", „Kampagne",
		// „Regionalband") -- das sagt genauer, was der Treffer ist, als das Wort „Literatur".
		// ⚠️ `art` ist der ROHE Infoboxtext und kommt aus dem PUBLIKATIONS-Katalog, `product_type` der
		// daraus gefaltete Schluessel aus dem Literatur-Katalog. Der Endpunkt verbindet beide.
		treffer: ["art", "edition", "series"],
		// 💣 ZWEI ZEILEN FUER DIE ART, UND DAS IST ABSICHT -- dieselbe Trennung wie `art`/`wegtyp` beim
		// Weg, `art`/`ortsgroesse` beim Ort und `art`/`landschaftsart` bei der Landschaft. `art` ist der
		// freie Wikitext („Gruppenabenteuer", „Kampagne", auch „Abenteuer"), `product_type` der daraus
		// gefaltete Schluessel („gruppenabenteuer", PRODUCT_TYPE_GROUPS). Nur der Schluessel darf nach
		// `adventure.product_type`.
		// ⭐ UND HIER FAELLT DIE ABBILDUNG WEG, wo sie bei den drei anderen im Datenweg steht: der
		// Dump-Lauf hat sie SCHON GEMACHT (avesmapsWikiNormalizeGameLiteratureProductType, beim
		// Schreiben in `wiki_adventure_catalog.product_type`). Beide Seiten des Vergleichs sind damit
		// derselbe Schluesselvorrat -- eine zweite Abbildung im Browser waere die dritte Wahrheit.
		//
		// 🔴 EINE Zeile fuer `title` MIT Kartenziel, obwohl der Kasten den Artikelnamen ohnehin schon
		// als „Artikel" zeigt. Ohne sie koennte die Sync-Vorschau den Titel nie anbieten -- und der
		// Massenabgleich tut es sehr wohl (`title` steht in AVESMAPS_GAME_LITERATURE_WIKI_FIELDS,
		// game-literature-sync.php:35). Dieselbe Doppelung tragen Ort, Landschaft und Territorium.
		// 🔴 KEIN Kartenziel fuer `publisher` und `cover_file`: `adventure` hat keine Verlagsspalte
		// (die DDL steht in api/_internal/app/game-literature.php:25-52), und `cover_file` ist ein
		// Wiki-DATEINAME, keine Adresse -- das Bild holt der Sync selbst und legt es unter `cover_url`
		// ab (game-literature-sync.php:707-722). Eine Sync-Zeile koennte dort nur einen Dateinamen in
		// ein Adressfeld schreiben. Beide bleiben Anzeige.
		// 🔴 KEIN Kartenziel fuer `bf_year`/`bf_label`: die `{{Infobox Produkt}}` fuehrt kein
		// BF-Jahr (ausdruecklich vermerkt in game-literature-sync.php:34) -- es gibt schlicht nichts zu
		// uebernehmen. `is_official` fehlt aus dem umgekehrten Grund: der Katalog schreibt dort hart 1
		// (:425), das ist eine Konstante und keine Auskunft des Artikels.
		// ⚠️ `isbn` HAT beides -- Quelle (wiki_publication_catalog.isbn, publication-sync.php:36) und
		// Ziel (`adventure.isbn`, nachgezogene Spalte :107-111, Formularfeld „ISBN (für DNB)" in
		// html/game-literature-editor.html:1098, weisse Liste :928). Der MASSENabgleich uebertraegt sie
		// trotzdem nicht (sie fehlt in AVESMAPS_GAME_LITERATURE_WIKI_FIELDS). Das ist kein Widerspruch,
		// den es aufzuloesen gaelte: die Vorschau ZEIGT, was sie tut, und der Editor entscheidet je
		// Zeile -- genau dafuer gibt es sie.
		felder: [
			{ wiki: "title", karte: "title", label: "Titel" },
			{ wiki: "art", karte: "", label: "Art" },
			{ wiki: "product_type", karte: "product_type", label: "Produkttyp" },
			{ wiki: "edition", karte: "edition", label: "Regelsystem" },
			{ wiki: "series", karte: "series", label: "Serie / Reihe" },
			{ wiki: "authors", karte: "authors", label: "Autoren" },
			{ wiki: "genre", karte: "genre", label: "Genre" },
			{ wiki: "complexity_gm", karte: "complexity_gm", label: "Komplexität (SL)" },
			{ wiki: "complexity_pl", karte: "complexity_pl", label: "Komplexität (Spieler)" },
			{ wiki: "fshop_code", karte: "fshop_code", label: "F-Shop-Code" },
			{ wiki: "isbn", karte: "isbn", label: "ISBN" },
			{ wiki: "publisher", karte: "", label: "Verlag" },
			{ wiki: "cover_file", karte: "", label: "Cover-Datei" },
		],
		sync: true, // zehn Kartenziele -- also ein Knopf
		extra: {
			// 🔴 Der Rat des Leerzustands, objektart-eigen wie beim Ort und aus demselben Grund: die
			// Quelle ist ein STAGING-Katalog, kein Wiki-Abruf. Wer dort nichts findet, muss den
			// Literatur-Abgleich laufen lassen (Knopf „Syncen" im Menueband dieses Fensters), nicht
			// anders suchen.
			keineTrefferHinweis: "Ggf. erst „Syncen“ laufen lassen.",
			// 🪤 KEIN dritter Zustand -- gemessen, nicht vergessen (Aufgabe 8, 16.08.2026). Das ist der
			// zweite Fall nach dem Territorium, und die Gruende sind andere:
			//   1. `adventure` hat KEINE Eigenschaftsspalte. Die DDL (api/_internal/app/game-literature.php
			//      :25-52) fuehrt als einzige JSON-Spalte `field_origins_json`, und die traegt die
			//      Feldherkunft -- ein Merker darin kollidierte mit der Override-Regel, die sie liest
			//      (avesmapsGameLiteratureFieldPlan, game-literature-sync.php:65). Ort, Weg und
			//      Landschaft hatten alle drei ein `properties_json`; deshalb kostete es dort keine
			//      Schemaaenderung.
			//   2. Er waere in der KONFLIKTLISTE wirkungslos -- also genau dort, wofuer ihn die drei
			//      anderen Hinweise versprechen. avesmapsConflictLoadGameLiteratureRows
			//      (api/_internal/conflicts/rules.php:198) verlangt
			//      `status='approved' AND wiki_url IS NOT NULL AND wiki_url <> ''` (:201-202); ein
			//      Eintrag OHNE Zuweisung erreicht die Liste nie. Und die Watchlist-Regel
			//      avesmapsConflictRuleMissingKey laeuft ohnehin nur ueber die Kartenzeilen (:520) --
			//      Literatur reicht nur in die Kollisionsregel hinein (:519).
			//   3. Die EINE Stelle, an der er beissen WUERDE, ist eine andere als bei allen Vorbildern:
			//      avesmapsGameLiteratureFindOrAdoptRow (game-literature-sync.php:581-584) adoptiert
			//      eine manuelle Zeile OHNE `wiki_key` ueber ihren exakten TITEL und setzt Schluessel
			//      und Herkunft. Eine bewusst geloeste Zuweisung kaeme beim naechsten Abgleich also von
			//      selbst zurueck -- die Fehlerklasse aus Discord #38, nur an anderer Stelle. Sie
			//      abzufangen braeuchte einen eigenen Riegel IN der Adoption, und das ist ein zweiter
			//      Mechanismus, kein Spiegeln der vorhandenen Bauform.
			// 🔧 Der ehrliche Weg waere eine Spalte an `adventure`, ein Schreibweg in
			// `upsert_adventure`, der Riegel in der Adoption und zwei Zeilen in der Konfliktregel --
			// eine Owner-Entscheidung, kein Nachtrag. Hier nichts erfinden.
			keinArtikelHaken: false,
		},
	},
	karte: {
		label: "Wiki-Artikel",
		// 💣 BEI DEN KARTEN HEISST SCHON ZWEIERLEI „wiki", UND DIESE ZUWEISUNG IST EIN DRITTES DING.
		// Am Livecode gemessen (16.08.2026); beide bleiben unangetastet, an ihnen haengt der laufende
		// Karten-Abgleich:
		//   `citymap.wiki_key`  -- ein BAUSCHLUESSEL aus vier Teilen, `index:stadt:quelle:variante`
		//     (avesmapsCitymapWikiKey, api/_internal/wiki/citymap-sync.php:103; Spalte angelegt :1310).
		//     Er sagt, aus welcher INDEX-SEITE die Zeile stammt, und ist KEINE Seitenidentitaet.
		//   `citymap.map_url`   -- der Karten-Link. Bei einer Wiki-Karte baut ihn der Abgleich aus der
		//     QUELLE, also aus der Publikation (avesmapsCitymapWikiUrlForSource, citymap-sync.php:1508):
		//     er zeigt auf das BUCH, in dem die Karte steckt, nie auf die Karte.
		// 🪤 Eine Spalte `citymap.wiki_url` GIBT ES NICHT -- Entwurf §8 nennt sie, und das ist an der
		// Wirklichkeit gemessen falsch (gemeint ist `map_url`). Der eigene Artikel heisst deshalb
		// `article_url`/`article_key`/`article_title` (Spalten: api/_internal/app/citymaps.php:368-381,
		// weisse Liste des Schreibwegs :1418-1423): haette er `wiki_url` geheissen, faende ein
		// `git grep wiki_url` drei verschiedene Sachen unter einem Namen -- dieselbe
		// Verwechslungsklasse wie „Literatur" gegen „Quellen".
		//
		// 🔴 DIE SUCHE GAB ES NICHT, UND ES GIBT KEINEN KATALOG VON KARTEN-ARTIKELN. Gemessen:
		// `wiki_citymap_catalog` traegt INDEXZEILEN (Bauschluessel, keine Seite),
		// `wiki_publication_catalog` traegt BUECHER (das ist `map_url`). Die EINZIGE Tabelle im Haus,
		// die einen Seitentitel auf seine Adresse abbildet, ist `wiki_sync_pages`; dagegen sucht der
		// mit dieser Aufgabe entstandene Endpunkt (avesmapsWikiCitymapArticleSearch,
		// api/_internal/wiki/citymap-article.php:62; der Arm fuer einen bereits zugewiesenen Artikel
		// :138).
		// ⚠️ EIGENE DATEI, nicht ein Arm von api/edit/map/citymaps.php: jene ist POST-only, das
		// Bauteil holt seine Treffer per GET.
		suche: { art: "server", url: "/api/edit/wiki/citymaps.php" },
		// KEIN Objektart-Vorsatz: die Trefferzeile beginnt mit der SEITENART („Metropole", „Dorf",
		// „Gebäude") -- und die ist hier mehr als eine Beschriftung.
		// 🔴 `wiki_sync_pages` fuehrt heute NUR Orts- und Bauwerksseiten (geschrieben von
		// avesmapsWikiSyncUpsertPageCache, api/_internal/wiki/locations-helpers.php:332, und
		// avesmapsWikiDumpPersistSettlementRecords, api/_internal/wiki/dump-entity-scan.php:1493 --
		// beide ausschliesslich dafuer). Ein Editor, der hier waehlt, greift also fast immer nach der Seite
		// eines ORTES -- die Seitenart sagt ihm das VOR dem Klick, und die Kollisionsregel des
		// Konfliktzentrums faengt den Missgriff danach (avesmapsConflictLoadCitymapRows,
		// api/_internal/conflicts/rules.php:270, angeschlossen :595).
		treffer: ["settlement_label", "continent"],
		// 🔴 KEIN EINZIGES KARTENZIEL, und das ist gemessen, nicht vergessen. Die weisse Liste des
		// Schreibwegs (`$editableFields`, avesmapsUpsertCitymap, api/_internal/app/citymaps.php)
		// fuehrt Titel, Links, Lizenzen, Art, Format, BF-Jahre, Urheber, Verlag und Notiz -- zu
		// KEINEM davon sagt eine Registry-Zeile etwas: sie beschreibt die SEITE (Ortsklasse,
		// Kontinent), nicht die Karte. Der Titel einer Karte („Stadtplan von Al'Anfa (Al'Anfa und der
		// tiefe Süden)") baut der Abgleich aus Ort und Quelle, nie aus einem Artikelnamen.
		// ⚠️ Beide Zeilen bleiben trotzdem ERKLAERT (`karte: ""`), sonst meldete Pruefung 2 (§3b) sie
		// als vergessen -- dieselbe Bauform wie bei den Kraftlinien, die ebenfalls vier Wiki-Felder
		// ohne Ziel fuehren.
		felder: [
			{ wiki: "settlement_label", karte: "", label: "Seitenart" },
			{ wiki: "continent", karte: "", label: "Kontinent" },
		],
		sync: false, // kein Ziel -- also auch kein Knopf
		extra: {
			// 🔴 Der Rat des Leerzustands, objektart-eigen wie bei Ort und Literatur, und hier sagt er
			// die BESCHRAENKUNG: die Registry kennt nur Orts- und Bauwerksseiten. Steht der Artikel
			// einer Karte woanders im Wiki, hilft kein anderer Suchbegriff, sondern nur das Haekchen
			// darunter. „Keine Treffer" allein sagte nur, DASS nichts da ist.
			keineTrefferHinweis: "Die Wiki-Registry führt nur Orts- und Bauwerksseiten — sonst hilft das Häkchen darunter.",
			// 🔴 DER DRITTE ZUSTAND, und bei den Karten ist er OWNER-WUNSCH, nicht Kür: „gibt
			// natürlich auch welche von uns" (Entwurf §2.5). Die selbst gezeichneten Karten haben
			// keinen Wiki-Artikel und werden nie einen bekommen.
			// ⚠️ Er ist tragbar, weil diese Aufgabe ohnehin Spalten anlegt: `no_article` steht neben
			// `article_url` in `citymap` (avesmapsCitymapsEnsureTables, api/_internal/app/citymaps.php:380).
			// Territorium und Literatur
			// konnten ihn nicht tragen -- dort haette er eine Schemaaenderung ohne eigenen Anlass
			// gekostet.
			keinArtikelHaken: true,
			// 🪤 UND WAS ER HIER NICHT TUT, steht ausdruecklich da -- wie bei der Landschaft: er nimmt
			// die Karte aus KEINER Liste. avesmapsConflictLoadCitymapRows (api/_internal/conflicts/
			// rules.php:270) reicht nur Karten MIT Artikel in die Kollisionsregel (:595); eine Karte
			// ohne Artikel erreicht das Konfliktzentrum
			// gar nicht erst, und die Beobachtungsliste (`wiki.missing_key`) laeuft ohnehin nur ueber
			// `map_features`. Der Merker haelt also die ENTSCHEIDUNG fest und sonst nichts -- der
			// Satz unten verspricht deshalb bewusst keine Konfliktliste.
			// ⚠️ Der zweite Halbsatz ist tragend (wie bei allen anderen): der Merker ist NICHT
			// endgueltig. Ohne ihn liest er sich als „nie wieder".
			keinArtikelHinweis: "Hält fest, dass im Wiki kein Artikel zu dieser Karte steht — bis dort einer auftaucht.",
		},
	},
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
