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
		// 🔴 WANN DER KASTEN SCHREIBT -- gemessen am 17.08.2026, nicht angenommen.
		// `wikiAssignZuweisen`/`-Loesen` (html/wiki-sync-powerline-editor.html) setzen NUR eine
		// Meldung; geschrieben wird in `saveLine` ueber `lies()`.
		schreibt: "speichern",
		extra: {
			// 🔴 KEIN dritter Zustand IM EDITOR -- gefallen am 16.08.2026, Owner-Entscheid nach dem
			// Durchklicken aller Oberflaechen („passt, aber ‚Kein Wiki-Artikel vorhanden‘ brauchen wir
			// nicht explizit"). Das ist eine ENTSCHEIDUNG UEBER DEN ORT, nicht ueber den Merker:
			// `properties.wiki_no_article` bleibt, wird weiter gelesen (avesmapsConflictRuleMissingKey,
			// api/_internal/conflicts/rules.php) und weiter GESETZT -- nur eben im Konfliktzentrum
			// (AVESMAPS_CONFLICT_NO_ARTICLE_FLAG, api/_internal/conflicts/repair.php). Dort steht der
			// Fall samt Belegen beider Parteien; hier stand ein Haekchen ohne jeden Kontext.
			// ⚠️ Damit reist der Merker aus dieser Oberflaeche nur noch, wenn eine ZUWEISUNG ihn
			// beantwortet hat -- saveLine schickt `wiki_no_article` ausschliesslich bei
			// `kein_artikel_geaendert` (html/wiki-sync-powerline-editor.html), und der Schreibweg liest
			// einen fehlenden Schluessel seit dem 16.08.2026 als „nicht geaendert"
			// (avesmapsUpdatePowerlineLine). Beide Haelften gehoeren zusammen: mit dem alten
			// `?? false` haette JEDES Speichern die Entscheidung des Konfliktzentrums geloescht.
			keinArtikelHaken: false,
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
		// 🔴 SOFORT, in BEIDEN Oberflaechen -- gemessen am 17.08.2026.
		// `wikiAssignZuweisen` (js/pages/wege-editor.js) und `pathWikiZuweisen`
		// (js/review/review-path-wiki.js) fahren `assign_to` bzw. `clear_assign` gegen
		// /api/edit/wiki/paths.php; die Antwort steht in der Datenbank, bevor der Kasten neu zeichnet.
		// ⚠️ Deshalb gibt es hier KEIN „Abbrechen": der Rueckweg heisst „Entfernen", und der fragt
		// beim Weg ohnehin zurueck, ob nur dieses Segment oder der ganze Namensverbund gemeint ist.
		schreibt: "sofort",
		extra: {
			// 🔴 KEIN dritter Zustand IM EDITOR -- gefallen am 16.08.2026, Owner-Entscheid nach dem
			// Durchklicken aller Oberflaechen. Er hat den Weg AUSDRUECKLICH genannt, und beim Weg ist die
			// Begruendung die staerkste von allen vieren: die Entscheidung wirkt ueber den ganzen
			// NAMENSVERBUND (avesmapsApplyPathWikiNoArticleToNameGroup) -- also genau so weit wie die
			// Reparatur-Verben des Konfliktzentrums (avesmapsConflictRepairSpansNameGroup), und das
			// Haekchen konnte diese Reichweite nur NACHBAUEN. Zwei Knoepfe mit derselben Reichweite an
			// zwei Orten sind eine Divergenz, die auf ihren ersten Unterschied wartet.
			// ⚠️ WEG IST NUR DAS BEDIENELEMENT. `properties.wiki_no_article` bleibt: die Leseseite ehrt
			// ihn vor jeder Typweiche (avesmapsEnrichMapFeatureWikiUrl, api/app/map-features.php), die
			// Konfliktregel liest ihn fuer `path` (api/_internal/conflicts/rules.php), der Schreibweg
			// avesmapsApplyPathWikiNoArticle samt Verbund-Reichweite steht unveraendert -- gesetzt wird
			// er jetzt im Konfliktzentrum, wo der Fall samt Belegen steht.
			// 💣 UND KEINE DER BEIDEN OBERFLAECHEN SCHICKT IHN NOCH MIT (buildPathEditPayload in
			// js/review/review-paths.js, saveDraft in js/pages/wege-editor.js). Das ist tragbar, WEIL
			// avesmapsApplyPathWikiNoArticle einen fehlenden Schluessel als „nicht geaendert" liest und
			// JEDER Zuweiser den Merker selbst loescht (drei -- gezaehlt im Test, nicht aufgezaehlt).
			// Ohne die erste Haelfte loeschte jedes Speichern die Entscheidung des Konfliktzentrums.
			// 🪤 UND DAS SETZEN LEERT WEITERHIN EINE GESPEICHERTE FLACHE `properties.wiki_url`
			// (Owner-Entscheid 16.08.2026, ausgeschrieben an der Schreibstelle). Das ist KEINE Regel des
			// Haekchens gewesen, sondern eine des Merkers -- sie gilt jetzt fuer die Reparatur des
			// Konfliktzentrums genauso und bleibt deshalb unangetastet.
			keinArtikelHaken: false,
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
		// 🔴 SOFORT -- gemessen am 17.08.2026: `settlementWikiAssignZuweisen`/`-Loesen`
		// (html/wiki-sync-settlement-editor.html) und `selectSettlementWikiResult`/
		// `removeSettlementWiki` (js/review/review-settlement-wiki.js) fahren alle vier `assign_to`
		// bzw. `clear_assign` gegen den Server.
		// 🪤 UND EINE AUSNAHME, DIE DIE ERKLAERUNG NICHT TRAGEN KANN: im Kartendialog gibt es den
		// ANLEGEFALL -- ein Ort ohne `public_id`. Dort merkt sich `selectSettlementWikiResultWhileCreating`
		// die Wahl nur oertlich („wird beim Anlegen verbunden") und schreibt erst mit `create_point`.
		// Das ist keine Eigenschaft der OBJEKTART, sondern des Augenblicks -- deshalb nennt diese
		// Zeile den Regelfall, und der Kartendialog uebersteuert sie fuer genau diesen einen Zustand
		// per `schreibt`-Option am `mount` (die EINZIGE Uebersteuerung im ganzen Haus).
		schreibt: "sofort",
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
		// 🔴 ERST MIT „Speichern" -- gemessen am 17.08.2026 in BEIDEN Oberflaechen.
		// Im Editorfenster (html/landschaften-editor.html) fuellen `wikiAssignZuweisen`/`-Loesen` nur
		// `wikiStand`/`wikiSchnappschuss`; im Kartendialog
		// (js/map-features/map-features-ecosystem-properties.js) nur `pendingWikiRegion`.
		// ⚠️ Ein sofortiges Schreiben ist hier nicht bloss unnoetig, sondern schaedlich: es loeste
		// `loadData()` aus und wuerfe die ungespeicherten Eingaben im selben Block weg.
		schreibt: "speichern",
		extra: {
			// 🔴 KEIN dritter Zustand -- gefallen am 16.08.2026, Owner-Entscheid nach dem Durchklicken
			// aller Oberflaechen. Er hat den REGIONEN-EDITOR genannt (html/landschaften-editor.html);
			// gemessen traegt die Erklaerung `landschaft` ZWEI Oberflaechen -- daneben den Dialog
			// „Fläche bearbeiten" auf der Karte (js/map-features/map-features-ecosystem-properties.js).
			// Das Haekchen faellt in beiden, weil es EINE Objektart ist. Der Label-Dialog ist davon NICHT
			// betroffen: er ist die eigene Erklaerung `landschaftslabel` weiter unten und behaelt es.
			// 💣 UND HIER WAR ER OHNEHIN DER SCHWAECHSTE DER FUENF: eine `ecosystem_region` steht in
			// KEINER Konfliktliste (avesmapsConflictLoadMapRows liest ausschliesslich `map_features` --
			// location|path|label|powerline). Der Merker hielt hier die ENTSCHEIDUNG fest und sonst
			// nichts, und genau deshalb versprach sein Hinweis als einziger keine Konfliktliste.
			// 🔧 DARAUS FOLGT EINE OFFENE FRAGE, UND SIE STEHT HIER, DAMIT SIE NICHT STILL BLEIBT: bei
			// Ort, Weg und Karte wandert die Entscheidung ins Konfliktzentrum, wo der Fall samt Belegen
			// steht -- die Flaeche erreicht es nie, hier kann sie also NIEMAND mehr setzen. Fuer die
			// `ecosystem_region` ist die Spalte damit faktisch tot. Das ist die ehrliche Folge des
			// Entscheids, kein Versehen; wer sie wiederbeleben will, macht die Flaeche zur
			// Konfliktpartei (avesmapsConflictLoadMapRows) -- nicht dieses Haekchen wieder auf.
			// ⚠️ WEG IST NUR DAS BEDIENELEMENT. Die Spalte `ecosystem_region.properties_json`, der
			// Leseweg (`list_regions`) und der Schreibweg (`update_region`,
			// avesmapsEcosystemApplyRegionNoArticle) bleiben unveraendert.
			// ⭐ BEIDE Oberflaechen schicken `wiki_no_article` ab jetzt GAR NICHT mehr, und das ist
			// tragbar, weil avesmapsEcosystemApplyRegionNoArticle schon beide Haelften kann: ein
			// fehlender Schluessel heisst „nicht geaendert", und eine ZUWEISUNG beantwortet den Merker
			// von selbst (`if (!$gefordert && $noArticle && $effectiveWikiUrl !== '')`). Der Server
			// braucht dafuer keine Zeile Aenderung -- gemessen, nicht angenommen.
			keinArtikelHaken: false,
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
		// 🔴 DER STECKBRIEF KLAPPT ZU (Owner 25.08.2026). Offen bleibt, was beim Zuweisen zaehlt:
		// der Artikel und die Art. Schluessel, Name, Lage, Staat, Kontinent, Einwohner, Sprache,
		// Vegetation und Verkehrswege stehen einen Klick tiefer -- gemessen 232 px, von denen rund
		// 120 verschwinden. Der Beschriftungsdialog steht bei 1270 px und kappt bei 760.
		// ⚠️ STABILE SCHLUESSEL, keine Beschriftungen: `artikel` ist eine Kopfzeile des Bauteils,
		// `art` ein Registerfeld darunter. Ein Wortlaut ist uebersetzbar, ein Schluessel nicht.
		// 💣 Die Angabe ist OPT-IN und steht heute NUR hier -- die uebrigen zehn Oberflaechen zeigen
		// ihren Steckbrief unveraendert offen.
		steckbriefOffen: ["artikel", "art"],
		sync: true, // zwei Kartenziele (text, feature_subtype) -- also ein Knopf
		// 🔴 ERST MIT „Speichern" -- gemessen am 17.08.2026: `labelWikiAssignZuweisen`/`-Loesen`
		// (js/review/review-label-wiki.js) setzen `currentLabelWikiRegion`/`labelWikiSchnappschuss`,
		// und `buildLabelEditPayload` nimmt die Zuweisung beim Speichern mit.
		schreibt: "speichern",
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
		// 🔴 ERST MIT „Speichern" -- gemessen am 17.08.2026: `territoryWikiAssignZuweisen`/`-Loesen`
		// (js/review/review-region-wiki-picker.js) fuellen die Formularfelder `region-edit-wiki-id`/
		// `-wiki-url` (und ggf. das Wappen); geschrieben wird mit `update_territory`.
		schreibt: "speichern",
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
			//      (api/_internal/conflicts/rules.php:144) verbindet `political_territory` per
			//      INNER JOIN mit `political_territory_wiki` (:165) und verlangt `w.wiki_url <> ''`
			//      (:168) -- ein Gebiet ohne Wiki-Bezug erreicht die Beobachtungsliste nie, und die
			//      erzeugte Zeile (:195-203, `$rows[] = ['type' => 'territory', …]`) setzt keinen
			//      `no_article`-Schluessel, den avesmapsConflictRuleMissingKey (:432) lesen koennte.
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
		// html/game-literature-editor.html:1098, weisse Liste `$editableFields` in
		// api/_internal/app/game-literature.php:929). 🪤 Hier stand „weisse Liste :928" -- ohne
		// Dateinamen und unmittelbar hinter einer Zeile aus dem Editor-HTML, also als DIESE Datei zu
		// lesen; :928 ist dort das Ankreuzfeld „Offizielles Produkt". Zwei Fehler in einer Angabe,
		// und der zweite hielt sich noch: der Eintrag `isbn` steht auf 929, nicht 928. Wer eine
		// Zeilennummer notiert, notiert die Datei mit, sobald die vorige eine andere war.
		// Der MASSENabgleich uebertraegt sie trotzdem nicht (sie fehlt in
		// AVESMAPS_GAME_LITERATURE_WIKI_FIELDS). Das ist kein Widerspruch,
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
		// 🔴 ERST MIT „Speichern" -- gemessen am 17.08.2026: `aeWikiUngespeichert`
		// (html/game-literature-editor.html) setzt nur die Meldung der Speicherleiste; der Wert reist
		// ueber `lies()` in `saveStammdaten`.
		schreibt: "speichern",
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
			//      (api/_internal/conflicts/rules.php:209) verlangt
			//      `status = 'approved' AND wiki_url IS NOT NULL AND wiki_url <> ''` (:213); ein
			//      Eintrag OHNE Zuweisung erreicht die Liste nie. Und die Watchlist-Regel
			//      avesmapsConflictRuleMissingKey bekommt ohnehin nur die Kartenzeilen (:599, das
			//      Argument heisst dort `$rows`) -- Literatur landet allein in `$claimRows` (:594),
			//      und der geht nur an die Kollisionsregel avesmapsConflictRuleSharedArticle (:598).
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
		// 🔴 `wiki_sync_pages` fuehrt heute NUR Orts- und Bauwerksseiten. 🪤 OHNE ZAHL UND OHNE
		// NAMENSLISTE, und zwar nach einem Fehlgriff: hier standen zwei Erzeuger, und beide Haelften
		// waren falsch -- avesmapsWikiDumpPersistSettlementRecords SCHREIBT gar nicht selbst (es ruft
		// avesmapsWikiSyncUpsertPageCache), und das Bauwerks-Upsert
		// (api/_internal/wiki/settlements.php:124) fehlte ganz. Eine Aufzaehlung liest sich wie eine
		// vollstaendige Liste, und niemand zaehlt nach (AGENTS.md §11). Wer es wissen will, misst:
		// `grep -rn "INSERT INTO wiki_sync_pages\|INSERT INTO ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE" api/`
		// -- am 16.08.2026 zwei Schreibstellen, beide fuer Siedlungen bzw. Bauwerke.
		// Ein Editor, der hier waehlt, greift also fast immer nach der Seite
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
			// 🔴 DIE DRITTE ZEILE BESCHREIBT NICHT DIE SEITE, SONDERN DIE ZUWEISUNG -- und sie ist
			// die einzige ihrer Art im ganzen Register. Seit dem Massenlauf vom 17.08.2026 traegt
			// `article_url` bei einer Wiki-Karte die Seite der PUBLIKATION, in der die Karte
			// abgedruckt ist -- nicht ihren eigenen Artikel. Ohne diese Zeile gaebe der Kasten die
			// Publikation stillschweigend als eigenen Artikel aus, und genau diese Verwechslung hat
			// den ganzen Strang gekostet. Owner 17.08.2026: „weil ich sehen will, was gesynct und
			// was von uns editiert ist."
			// ⚠️ Der Wert kommt NICHT aus der Registry, sondern aus `citymap.article_origin` --
			// avesmapsWikiAssignKarteArtikel mischt ihn in `werte` (js/ui/wiki-assign-karte.js).
			// Deshalb traegt eine TREFFERZEILE der Suche ihn nicht, und dort faellt er weg: die
			// Registry beschreibt die Seite und weiss nicht, warum eine Karte auf sie zeigt.
			{ wiki: "herkunft", karte: "", label: "Zuweisung" },
		],
		sync: false, // kein Ziel -- also auch kein Knopf
		// 🔴 ERST MIT „Speichern" -- gemessen am 17.08.2026: `ceWikiUngespeichert`
		// (html/citymap-editor.html) setzt nur die Meldung der Speicherleiste; der Wert reist ueber
		// `lies()` in `saveStamm`.
		schreibt: "speichern",
		extra: {
			// 🔴 Der Rat des Leerzustands, objektart-eigen wie bei Ort und Literatur, und hier sagt er
			// die BESCHRAENKUNG: die Registry kennt nur Orts- und Bauwerksseiten. Steht der Artikel
			// einer Karte woanders im Wiki, hilft kein anderer Suchbegriff, sondern nur das Haekchen
			// darunter. „Keine Treffer" allein sagte nur, DASS nichts da ist.
			// 🪤 DER ZWEITE HALBSATZ IST AM 16.08.2026 GEFALLEN und stand hier vorher als „— sonst hilft
			// das Häkchen darunter". Ein Rat, der auf ein Bedienelement zeigt, das es nicht mehr gibt,
			// ist schlimmer als kein Rat: der Editor sucht danach und findet nichts.
			keineTrefferHinweis: "Die Wiki-Registry führt nur Orts- und Bauwerksseiten.",
			// 🔴 KEIN dritter Zustand -- gefallen am 16.08.2026, Owner-Entscheid nach dem Durchklicken
			// aller Oberflaechen; der Karten-Editor ist einer der vier ausdruecklich genannten.
			// 🪤 ER WAR HIER EINMAL OWNER-WUNSCH („gibt natürlich auch welche von uns", Entwurf §2.5,
			// selbst gezeichnete Karten ohne Wiki-Artikel) -- derselbe Owner, spaeterer Blick auf die
			// gebaute Oberflaeche. Der Widerspruch ist echt und wird hier nicht geschoent: die Absicht
			// von §2.5 bleibt richtig, nur traegt sie das Konfliktzentrum, nicht dieser Kasten.
			// ⚠️ WEG IST NUR DAS BEDIENELEMENT. Die Spalte `citymap.no_article` bleibt
			// (avesmapsCitymapsEnsureTables), sie steht weiter in der weissen Liste von
			// avesmapsUpsertCitymap und reist weiter im Detail-Payload mit.
			// 💣 UND DIE KARTE IST DIE EINE DER VIER, DIE `no_article` NOCH SCHICKT -- gemessen, nicht
			// aus Nachlaessigkeit: `upsert_citymap` hat weder einen Widerspruchsriegel noch die Regel
			// „eine Zuweisung beantwortet den Merker" (die Landschaft hat sie, der Weg hat sie in
			// `assign_to`). Die drei Zeilen in html/citymap-editor.html haengen deshalb NICHT am
			// Haekchen, sondern an der ZUWEISUNG: `kein_artikel_geaendert` kann jetzt nur noch wahr
			// werden, wenn `trefferWaehlen` den Merker beantwortet hat. Sie zu loeschen liesse eine
			// Karte mit Artikel UND `no_article = 1` zurueck.
			keinArtikelHaken: false,
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
