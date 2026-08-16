// Der Datenweg der LANDSCHAFT -- EINE Fassung fuer ALLE DREI Oberflaechen (Flaechen-Eigenschaften,
// Regionen-Editor und der Label-Dialog).
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md
// Bauteil: js/ui/wiki-assign.js -- das weiss nichts ueber Landschaften. Was objektart-eigen ist,
// steht hier. Vorbilder: js/ui/wiki-assign-weg.js (Aufgabe 4) und js/ui/wiki-assign-ort.js (5).
//
// 💣 WARUM DIESE DATEI EXISTIERT: dieselbe Wiki-Landschaft wird an DREI Stellen zugewiesen, und
// zwei davon leben in eigenen Dokumenten mit eigenem `window` -- der Dialog „Fläche bearbeiten"
// (index.html), der Regionen-Editor im iframe (html/landschaften-editor.html) und der Label-Dialog
// „Region bearbeiten" (index.html). Keine sieht eine Funktion der anderen.
//
// 🔴 SIE IST REIN: kein DOM, kein `fetch`, kein Zustand. Alle drei Oberflaechen bringen ihren
// eigenen Netzweg mit und schicken die Antwort hier durch die Pruefung.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 💣 DIE FALLE DIESER OBJEKTART -- „LANDSCHAFT" IST NICHT „LABEL", UND DIE ART-TABELLE DES SERVERS
//    GEHOERT DEM LABEL
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Drei Oberflaechen im Haus suchen gegen `/api/edit/wiki/regions.php?action=search`. ZWEI davon
// heften die gefundene Wiki-Landschaft an eine **`ecosystem_region`** (die gezeichnete Flaeche) --
// Erklaerung `landschaft`. Die dritte, der Label-Dialog (js/review/review-label-wiki.js), heftet sie
// an ein **`map_features`-Label** und schreibt in ein ganz anderes Feld
// (`properties.wiki_region`) -- Erklaerung `landschaftslabel`. Sie benutzen ALLE DREI diesen
// Datenweg; getrennt sind nur die zwei Erklaerungen im Register (Vergleichstabelle weiter unten).
//
// 🔴 DARAN HAENGT DIE ART-REGEL, und sie war der einzige echte Entscheidungspunkt dieser Aufgabe.
// Es gab sie GEMESSEN in drei Fassungen mit ZWEI Zielvokabularen:
//
//   (a) CLIENT, Flaechen-Dialog (map-features-ecosystem-properties.js:304-308, Stand 16.08.2026):
//       erste Komponente einer mehrwertigen Art („Tal|Grube" -> „Tal"), dann EXAKTER Vergleich gegen
//       `label` bzw. `type_key` der Arten DIESER Ebene. Ziel: `ecosystem_region.region_type`.
//   (b) SERVER (api/_internal/wiki/regions.php:68-128 + :146-150, avesmapsWikiRegionArtToSubtype): dieselbe
//       erste Komponente, dann eine Nachschlagetabelle MIT SYNONYMEN. Ziel: der LABEL-Subtype.
//   (c) eine zweite JS-Abschrift von (b) in js/review/review-label-wiki.js -- die sich vom
//       Original inzwischen unterschied (sie fuehrte `gebirgskette`, `berg`, `gipfel`, `forst`,
//       `fluss`, die PHP-Tabelle keines davon). ✅ ERSATZLOS GELOESCHT am 16.08.2026: seit der
//       Label-Dialog dieselbe Ordnung benutzt, gibt es im Browser genau EINE Art-Regel. Was der
//       Wegfall der fuenf Schluessel kostet, steht im Kopf jener Datei.
//
// 💣 (b) BLIND ZU SPIEGELN WAERE EINE VERSCHLECHTERUNG GEWESEN, und das ist gemessen, nicht
// vermutet: die Server-Tabelle bildet `Schlucht => 'tal'` ab (regions.php:83, begruendet am
// 27.07.2026, als es nur den Label-Subtype `tal` gab). Die FLAECHENART `schlucht` entstand einen Tag
// spaeter (api/_internal/app/ecosystem.php:123, Owner 28.07.2026). Mit der reinen Server-Regel
// wuerde aus einer Wiki-Schlucht auf der Karte ein Tal, obwohl die Landschaft „Schlucht" kennt --
// und (a) trifft sie heute schon richtig. Dasselbe gilt umgekehrt fuer `Ebene`/`Tiefland`/
// `Flachland` -> `ebene`, `Berggipfel`, `Vulkan` und `Fluss`: das sind LABEL-Subtypen und
// ueberhaupt keine `ecosystem_region_type`.
//
// 🔴 DAHER DIE ORDNUNG, und sie erfindet KEINE dritte Abbildung -- sie stellt die zwei gemessenen
// hintereinander und laesst die Wirklichkeit entscheiden:
//   1. das EIGENE Vokabular dieser Ebene, exakt (Regel a) -- es ist das einzige, das weiss, welche
//      Arten es hier ueberhaupt gibt;
//   2. sagt das nichts, die SYNONYME des Servers (Regel b) -- Abschrift, kein neues Wissen;
//   3. und was dabei herauskommt, MUSS ein `type_key` dieser Ebene sein, sonst `""`.
// Schritt 3 ist der Riegel, der (b)s fremdes Vokabular aussortiert, und Schritt 1 vor 2 ist der,
// der `Schlucht` bei der Schlucht laesst.
//
// ⭐ NEU GETROFFEN werden durch Schritt 2 genau die Arten, die Schritt 1 nicht kennt und die auf
// eine echte Flaechenart zeigen (gemessen gegen AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED):
//   Mischregion · Großregion · Halbinsel -> region
//   Flusstal · Klamm · Talkessel        -> tal
//   Hochland                            -> huegelland
//   Klippe                              -> kueste
//   Sumpf · Moor · Marschland           -> suempfe_moore
//   Halbwüste                           -> wueste
//   Meeresteil · Meerenge · Bucht · Golf-> meer
//   Seenlandschaft                      -> see
// Das ist die Verhaltensaenderung dieser Aufgabe, und sie ist gewollt: bis heute liess der Sync
// diese Arten stehen.

// Die bearbeitbaren KARTENFELDER der Landschaft -- die einzige Liste davon im Browser.
//
// 🔴 SIE IST DIE GEGENPROBE ZUM FELDREGISTER, nicht seine Wiederholung (dieselbe Rolle wie
// AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER). Beide muessen sich decken, und genau das nagelt
// js/ui/__tests__/wiki-assign-landschaft.test.js fest.
//
// ⚠️ Es sind ZWEI, und mehr gibt es nicht: `ecosystem_region` traegt sonst nur `kind` (die Ebene,
// die kein Wiki-Feld beschreibt), `origin`, die abgeleiteten Wiki-Spalten und `label_public_id`.
// Einwohner, Sprache, Vegetation und Verkehrswege liefert das Staging zwar, aber die Landschaft hat
// dafuer KEIN Feld -- sie bleiben Anzeige-Zeilen. Hier wird nichts auf Vorrat erklaert.
const AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER = ["name", "region_type"];

// Die bearbeitbaren KARTENFELDER des LANDSCHAFTS-LABELS -- eine ZWEITE Objektart, kein zweiter
// Datenweg.
//
// 🔴 DIESELBE WIKI-SEITE, EINE ANDERE KARTEN-SEITE, und das ist der ganze Grund, warum es zwei
// Erklaerungen gibt statt einer (gemessen 16.08.2026):
//
//   | | Landschaft (Flaeche) | Label |
//   | Tabelle          | `ecosystem_region`                  | `map_features` (feature_type='label') |
//   | Ablage           | Spalten `wiki_url` + `wiki_region_key` | `properties.wiki_region` -- ein ganzes NEST |
//   | Schreibweg       | `update_region`                     | `update_label` |
//   | Name             | `name`                              | `text` |
//   | Art              | `region_type`, Vokabular JE EBENE   | `feature_subtype`, EIN Vokabular aus 30 Werten |
//   | kennt berggipfel/vulkan/ebene/fluss? | nein            | JA |
//   | Konfliktzentrum  | nein                                | JA |
//
// Zusammenzulegen waere eine erzwungene Gemeinsamkeit: schon die Feldnamen stimmen nicht ueberein,
// und das Zielvokabular der Art ist ein anderes. Geteilt wird alles, was WIRKLICH dasselbe ist --
// die Suche, die Werte, der Treffer, die erste Komponente, die Synonymtabelle und die Art-Ordnung.
const AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER = ["text", "feature_subtype"];

/**
 * Abschrift von AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE (api/_internal/wiki/regions.php:68-128), Stand
 * 16.08.2026 -- Schluessel kleingeschrieben.
 *
 * 🔴 ABSCHRIFT, KEINE ZWEITE REGEL. Der Server faltet seine Schluessel mit
 * avesmapsWikiSyncCreateMatchKey; im Browser gibt es diese Faltung nicht, deshalb steht jede
 * Umlaut-Art hier ZWEIMAL -- einmal mit, einmal ohne Umlaut. Genau so macht es die aeltere
 * JS-Abschrift, die bis zum 16.08.2026 im Label-Dialog stand, und aus
 * demselben Grund: eine von Hand gefaltete Form waere tot (AGENTS.md §5).
 *
 * ⚠️ Die Zeilen `ebene`/`tiefland`/`flachland`, `berggipfel`, `vulkan` zeigen auf LABEL-Subtypen,
 * die es als Flaechenart nicht gibt. Sie stehen trotzdem hier, weil dies eine Abschrift ist und
 * keine Auswahl -- avesmapsWikiAssignLandschaftArt wirft sie in Schritt 3 heraus. Wer sie
 * weglaesst, macht aus der Abschrift eine Meinung, und die naechste neue Flaechenart („Vulkan"
 * kaeme als erste in Frage) muesste dann an zwei Stellen nachgetragen werden statt an einer.
 */
const AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_ART_SYNONYME = {
	region: "region", mischregion: "region", "großregion": "region", grossregion: "region",
	halbinsel: "region",
	tal: "tal", flusstal: "tal", schlucht: "tal", klamm: "tal", talkessel: "tal",
	steppe: "steppe",
	graslandschaft: "graslandschaft", auenlandschaft: "auenlandschaft",
	"hügelland": "huegelland", hugelland: "huegelland", hochland: "huegelland",
	tundra: "tundra",
	"küste": "kueste", kuste: "kueste", klippe: "kueste",
	ebene: "ebene", tiefland: "ebene", flachland: "ebene",
	gebirge: "gebirge", wald: "wald",
	insel: "insel", inselgruppe: "inselgruppe",
	meer: "meer", meeresteil: "meer", meerenge: "meer", bucht: "meer", golf: "meer",
	see: "see", seenlandschaft: "see",
	sumpf: "suempfe_moore", moor: "suempfe_moore", marschland: "suempfe_moore",
	"wüste": "wueste", wuste: "wueste", "halbwüste": "wueste", halbwuste: "wueste",
	berggipfel: "berggipfel", kontinent: "kontinent",
	vulkan: "vulkan",
	wadi: "wadi",
};

function avesmapsWikiAssignLandschaftText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

/**
 * REIN: die erste Komponente einer mehrwertigen Wiki-Art, kleingeschrieben.
 *
 * 💣 DIE TRENNZEICHEN SIND `|` UND `,` -- wortgleich zum preg_split-Muster `\s*[|,]\s*` in
 * avesmapsWikiRegionArtToSubtype (regions.php:159). Ohne sie trifft „Tal|Grube" nie den Typ „Tal",
 * und genau daran ist die alte Fassung des Label-Pfeils an jedem mehrwertigen Artikel lautlos
 * gescheitert.
 */
function avesmapsWikiAssignLandschaftArtErsteKomponente(art) {
	return avesmapsWikiAssignLandschaftText(art).split(/\s*[|,]\s*/)[0].trim().toLowerCase();
}

/**
 * REIN: die Wiki-Art auf einen `ecosystem_region_type`-SCHLUESSEL DIESER Ebene abbilden. Leer heisst
 * „das Wiki sagt dazu nichts, was diese Ebene kennt".
 *
 * Die dreistufige Ordnung ist im Kopf dieser Datei begruendet: eigenes Vokabular · Server-Synonyme ·
 * Riegel gegen das fremde Vokabular.
 *
 * 🔴 KEIN RUECKFALL, wie beim Weg (avesmapsWikiAssignWegWegtyp) und beim Ort
 * (avesmapsWikiAssignOrtOrtsgroesse). Unbekannt heisst `""` -- die Diff-Rechnung macht daraus die
 * Zeile „das Wiki sagt nichts — würde die Angabe leeren", und die ist NIE vorangehakt (Aufgabe 2).
 * Etwas zu raten waere hier besonders teuer: die Art entscheidet ueber FARBE, Label-Zoom und den
 * Reisewiderstand der Flaeche.
 *
 * @param {string} art    die rohe Wiki-Art (darf mehrwertig sein)
 * @param {Array}  arten  das Vokabular DIESER Ebene: [{ type_key, label }] aus `list_regions`
 */
function avesmapsWikiAssignLandschaftArt(art, arten) {
	const erste = avesmapsWikiAssignLandschaftArtErsteKomponente(art);
	if (erste === "") {
		return "";
	}
	const liste = Array.isArray(arten) ? arten : [];
	// Schritt 1: das eigene Vokabular, exakt -- Beschriftung ODER Schluessel.
	const eigen = liste.filter((typ) => typ
		&& (avesmapsWikiAssignLandschaftText(typ.label).toLowerCase() === erste
			|| avesmapsWikiAssignLandschaftText(typ.type_key).toLowerCase() === erste))[0];
	if (eigen) {
		return avesmapsWikiAssignLandschaftText(eigen.type_key);
	}
	// Schritt 2: die Synonyme des Servers. Schritt 3: der Riegel -- der Wert MUSS eine Art dieser
	// Ebene sein, sonst faellt er heraus (so bleiben `ebene`, `berggipfel`, `vulkan`, `fluss` aussen).
	const synonym = AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_ART_SYNONYME[erste] || "";
	if (synonym === "") {
		return "";
	}
	const erlaubt = liste.filter((typ) => typ
		&& avesmapsWikiAssignLandschaftText(typ.type_key).toLowerCase() === synonym)[0];
	return erlaubt ? avesmapsWikiAssignLandschaftText(erlaubt.type_key) : "";
}

/**
 * REIN: die Werte, die die Erklaerung `landschaft` erwartet -- aus einer Suchzeile ODER aus dem
 * Staging-Schnappschuss derselben Wiki-Landschaft. Beide tragen dieselben Spaltennamen (beide lesen
 * `wiki_region_staging`, avesmapsWikiRegionSearch:1102 und der `staging_sample`-Zweig daneben),
 * deshalb genuegt EIN Bauer.
 *
 * 🔴 `landschaftsart` ist ABGELEITET, nicht geliefert: `art` ist der freie Wikitext („Mischregion,
 * Wald"), `landschaftsart` der daraus geprueften Flaechenart-Schluessel. Nur der Schluessel darf
 * nach `region_type`; roh verglichen meldete die Vorschau bei fast JEDER Landschaft einen
 * Unterschied und boete an, freien Text in ein Schluesselfeld zu schreiben -- dieselbe Trennung wie
 * `wegtyp` beim Weg und `ortsgroesse` beim Ort.
 * ⚠️ Pruefung 2 aus §3b sieht ein abgeleitetes Feld nicht (sie prueft nur die andere Richtung) --
 * deshalb steht es im Register ausdruecklich.
 *
 * ⚠️ DIE NAMEN SIND DIE DER SPALTEN, nicht huebschere -- `region_parent`, `affiliation_staat`,
 * `continent` stehen genau so im Register. Es wird an KEINER Stelle uebersetzt; die Beschriftung
 * („Lage", „Staat", „Kontinent") macht `label` im Register. Ein Uebersetzungsschritt hier waere die
 * zweite Wahrheit, die Pruefung 2 aus §3b (geliefert, aber nicht erklaert) gerade verhindern soll.
 * ⚠️ `continent` ist beim Parser ABGELEITET (aus Titel, Nav-Vorlagen und Kategorien,
 * regions.php:550) und damit kein Infoboxwert -- wie `kind` beim Weg. Es steht trotzdem als
 * Anzeige-Zeile im Register, weil die Suche es liefert und die Trefferzeile es zeigt.
 */
function avesmapsWikiAssignLandschaftWerte(quelle, arten) {
	const q = quelle || {};
	return {
		name: avesmapsWikiAssignLandschaftText(q.name),
		art: avesmapsWikiAssignLandschaftText(q.art),
		landschaftsart: avesmapsWikiAssignLandschaftArt(q.art, arten),
		region_parent: avesmapsWikiAssignLandschaftText(q.region_parent),
		affiliation_staat: avesmapsWikiAssignLandschaftText(q.affiliation_staat),
		continent: avesmapsWikiAssignLandschaftText(q.continent),
		einwohner: avesmapsWikiAssignLandschaftText(q.einwohner),
		sprache: avesmapsWikiAssignLandschaftText(q.sprache),
		vegetation: avesmapsWikiAssignLandschaftText(q.vegetation),
		verkehrswege: avesmapsWikiAssignLandschaftText(q.verkehrswege),
	};
}

/**
 * REIN: eine Zeile der Server-Suche (`?action=search`) in die Treffer-Form des Bauteils.
 *
 * ⚠️ Anders als beim ORT liefert die Suche hier BEREITS alle Anzeigewerte (avesmapsWikiRegionSearch
 * gibt 21 Spalten heraus, darunter art/region_parent/continent) -- eine Anreicherung nach dem
 * Schreiben wie avesmapsWikiAssignOrtTrefferAnreichern braucht die Landschaft deshalb nicht.
 *
 * 🔴 `roh` reist mit: der Flaechen-Dialog legt daraus sein `pendingWikiRegion` an, und der
 * Label-Durchtrag (createEcosystemRegionLabel) braucht Beschreibung und Staat, die im Kasten selbst
 * gar nicht stehen.
 * 🔴 Und `wiki_url` ist die ADRESSE der Zuweisung, nicht der Schluessel: `update_region` leitet
 * `wiki_region_key` serverseitig aus der URL ab (avesmapsEcosystemWikiRegionKey), ein vom Client
 * geschickter Schluessel wird gar nicht gelesen.
 */
function avesmapsWikiAssignLandschaftTreffer(zeile, arten) {
	const z = zeile || {};
	return {
		name: avesmapsWikiAssignLandschaftText(z.name),
		wiki_url: avesmapsWikiAssignLandschaftText(z.wiki_url),
		wiki_key: avesmapsWikiAssignLandschaftText(z.wiki_key),
		werte: avesmapsWikiAssignLandschaftWerte(z, arten),
		roh: z,
	};
}

/**
 * REIN: die gespeicherte Zuweisung in die Artikel-Form des Bauteils. `null` heisst „nichts
 * zugewiesen" -- ein gueltiger Zustand, kein Fehler (origin='own': eine Flaeche, die es bei uns
 * gibt und im Wiki nicht).
 *
 * 💣 DIE LANDSCHAFT SPEICHERT NUR ADRESSE UND SCHLUESSEL. `ecosystem_region` traegt `wiki_url` und
 * `wiki_region_key`, sonst nichts vom Wiki -- kein `art`, kein `lage`. Genau deshalb konnte der
 * alte „Sync" bei einer GESPEICHERTEN Zuweisung nur den Namen zuruecksetzen: `effectiveWikiRegion`
 * gab `{wiki_key, name, wiki_url}` heraus, `wiki.art` war `undefined`, und die Art-Haelfte von
 * syncFromWikiRegion lief ins Leere (gemessen 16.08.2026,
 * map-features-ecosystem-properties.js:118-128). Deshalb holen BEIDE Oberflaechen in ihrem `laden`
 * den Staging-Schnappschuss dazu und reichen ihn hier herein.
 *
 * ⚠️ Ein Schnappschuss, den es NICHT mehr gibt (verwaister Schluessel), ist kein Fehler: der
 * Artikel steht dann mit Adresse und Schluessel da, und die Anzeige-Zeilen fallen weg (das Bauteil
 * laesst leere Felder ohnehin weg).
 *
 * @param {Object|null} gespeichert  { wiki_key, wiki_url, name } aus der Regionszeile
 * @param {Object|null} schnappschuss die Staging-Zeile dazu, oder null
 */
function avesmapsWikiAssignLandschaftArtikel(gespeichert, schnappschuss, arten) {
	const g = gespeichert || {};
	const schluessel = avesmapsWikiAssignLandschaftText(g.wiki_key);
	const adresse = avesmapsWikiAssignLandschaftText(g.wiki_url);
	if (schluessel === "" && adresse === "") {
		return null;
	}
	const s = (schnappschuss && typeof schnappschuss === "object") ? schnappschuss : null;
	const werte = avesmapsWikiAssignLandschaftWerte(s || {}, arten);
	return {
		name: werte.name || avesmapsWikiAssignLandschaftText(g.name),
		wiki_url: adresse || avesmapsWikiAssignLandschaftText(s && s.wiki_url),
		wiki_key: schluessel || avesmapsWikiAssignLandschaftText(s && s.wiki_key),
		werte: werte,
	};
}

/**
 * 🔴 DER ZUSTAND -- UND ER WIRFT, STATT ETWAS LEERES ZU LIEFERN.
 *
 * Der Vertrag aus dem Kopfkommentar von js/ui/wiki-assign.js: ein `laden`, das im Fehlerfall
 * AUFLOEST, ist ununterscheidbar von „nichts zugewiesen". Das Bauteil malte dann den offenen
 * Zustand, `lies()` gaebe Leerstrings -- und weil BEIDE Landschafts-Oberflaechen erst beim
 * „Speichern" schreiben, schriebe der naechste Klick eine LEERE Zuweisung ueber eine bestehende.
 *
 * 💣 UND HIER IST DER FEHLERFALL ECHTES HTTP. Beim Weg und beim Ort lag der Stand im Speicher; die
 * Landschaft muss ihren Schnappschuss holen (siehe avesmapsWikiAssignLandschaftArtikel), und der
 * Hausstil dafuer -- `ecosystemWikiRegionSnapshot` (map-features-ecosystem-draw.js:440) -- FAENGT
 * seinen Fehler ab und gibt einen Rueckfall zurueck. Genau das darf ein `laden` nicht: ein 403
 * saehe dann aus wie „diese Landschaft hat keine Angaben". Die Oberflaechen bringen deshalb ihren
 * eigenen, WERFENDEN Netzweg mit und benutzen jene Funktion nicht.
 *
 * 💣 DIE KARTENWERTE WERDEN ERST BEIM LESEN GEHOLT, wenn der Aufrufer eine Funktion uebergibt --
 * derselbe Grund wie bei Weg und Ort: `laden` laeuft EINMAL, die Sync-Vorschau entsteht erst beim
 * Druck auf „Sync", und dazwischen kann der Editor Namensfeld und Artauswahl angefasst haben.
 *
 * @param {Object|null} quelle { wiki_key, wiki_url, wiki_name, schnappschuss, arten, kein_artikel,
 *   name, region_type } -- die zwei Kartenfelder je Wert ODER Lesefunktion.
 */
function avesmapsWikiAssignLandschaftKartenwerte(quelle, felder) {
	const kartenwerte = {};
	(Array.isArray(felder) ? felder : []).forEach((feld) => {
		if (typeof quelle[feld] === "function") {
			Object.defineProperty(kartenwerte, feld, {
				enumerable: true,
				get: () => avesmapsWikiAssignLandschaftText(quelle[feld]()),
			});
		} else {
			kartenwerte[feld] = avesmapsWikiAssignLandschaftText(quelle[feld]);
		}
	});
	return kartenwerte;
}

function avesmapsWikiAssignLandschaftZustand(quelle) {
	if (!quelle || typeof quelle !== "object" || Array.isArray(quelle)) {
		throw new Error("Wiki-Landschaft: keine Fläche gewählt — der Stand ist unbekannt.");
	}
	const arten = Array.isArray(quelle.arten) ? quelle.arten : [];
	const kartenwerte = avesmapsWikiAssignLandschaftKartenwerte(quelle, AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER);
	return {
		artikel: avesmapsWikiAssignLandschaftArtikel(
			{ wiki_key: quelle.wiki_key, wiki_url: quelle.wiki_url, name: quelle.wiki_name },
			quelle.schnappschuss || null,
			arten
		),
		keinArtikel: quelle.kein_artikel === true,
		kartenwerte: kartenwerte,
		// 🔴 Die Klimazone ist ABGELEITET: ihre Art sagt, WELCHE der Zonen das ist, und daran haengt,
		// welche Trennlinien ihr Band begrenzen. Der Server lehnt eine Aenderung ab
		// (avesmapsUpdateEcosystemRegion, ecosystem.php:2345-2352), also darf die Vorschau sie gar
		// nicht erst anbieten. 💣 Der Riegel gehoert an die ZEILE, nicht an den Knopf -- der NAME
		// einer Klimazone bleibt aenderbar, und ein Knopfriegel naehme ihn mit.
		gesperrt: avesmapsWikiAssignLandschaftText(quelle.kind) === "klima"
			? { region_type: "Die Art einer Klimazone steht fest" }
			: {},
	};
}

/**
 * 🔴 DER ZUSTAND DES LANDSCHAFTS-LABELS -- und er wirft aus demselben Grund.
 *
 * ⚠️ Der Artikel kommt hier NICHT aus zwei Spalten, sondern aus dem NEST `properties.wiki_region`,
 * das schon alle Anzeigewerte traegt (avesmapsReadLabelWikiRegion schreibt genau die Staging-Form).
 * Ein Schnappschuss wird trotzdem geholt und geht VOR: „Sync" heisst hier wie ueberall „was steht
 * HEUTE im Wiki" -- der alte Knopf `label-wiki-sync` tat nichts anderes, er schrieb das Nest aus
 * `?action=staging_sample` neu. 💣 Ohne ihn verglaeche die Vorschau gegen ein Nest, das beim
 * Zuweisen eingefroren wurde, und „Sync" haette seine Bedeutung verloren.
 * ⚠️ Faellt der Schnappschuss aus (verwaister Schluessel), traegt das NEST den Kasten -- deshalb
 * steht es als Rueckfall dahinter und nicht bloss `null`.
 *
 * @param {Object|null} quelle { wiki_region (das Nest), schnappschuss, arten, kein_artikel,
 *   text, feature_subtype } -- die zwei Kartenfelder je Wert ODER Lesefunktion.
 */
function avesmapsWikiAssignLandschaftslabelZustand(quelle) {
	if (!quelle || typeof quelle !== "object" || Array.isArray(quelle)) {
		throw new Error("Wiki-Landschaft: kein Label gewählt — der Stand ist unbekannt.");
	}
	const arten = Array.isArray(quelle.arten) ? quelle.arten : [];
	const nest = (quelle.wiki_region && typeof quelle.wiki_region === "object") ? quelle.wiki_region : null;
	return {
		artikel: avesmapsWikiAssignLandschaftArtikel(
			{ wiki_key: nest && nest.wiki_key, wiki_url: nest && nest.wiki_url, name: nest && nest.name },
			quelle.schnappschuss || nest,
			arten
		),
		keinArtikel: quelle.kein_artikel === true,
		kartenwerte: avesmapsWikiAssignLandschaftKartenwerte(quelle, AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER),
		// Ein Label kennt keine abgeleitete Ebene -- es gibt hier nichts zu sperren.
		gesperrt: {},
	};
}

/**
 * REIN: der Rumpf, mit dem BEIDE Oberflaechen zuweisen bzw. loesen. Es ist derselbe wie zum
 * Speichern des Namens -- `update_region` ist ein TEILSCHREIBER und fasst nur an, was im Rumpf
 * steht.
 *
 * 🔴 NUR `wiki_url`, NIEMALS `wiki_region_key`. Der Server leitet den Schluessel aus der Adresse ab
 * (avesmapsEcosystemWikiRegionKey, ecosystem.php:1851); ein vom Client geschickter Schluessel wird
 * gar nicht gelesen und waere eine zweite Ableitung -- genau die Datenmigration ueber ~10 Tabellen,
 * vor der AGENTS.md §5 warnt.
 * ⚠️ Eine LEERE Adresse ist der Weg zurueck (Verhaltensdoku §7a): sie loescht Adresse UND Schluessel.
 */
function avesmapsWikiAssignLandschaftZuweisungsKoerper(publicId, wikiUrl) {
	return {
		public_id: avesmapsWikiAssignLandschaftText(publicId),
		wiki_url: avesmapsWikiAssignLandschaftText(wikiUrl),
	};
}

/**
 * 🔴 WIRFT BEI JEDEM NEIN DES SERVERS. Fuer den Schnappschuss-Abruf (`?action=staging_sample`), den
 * beide Oberflaechen in ihrem `laden` fahren.
 *
 * 💣 `fetch` loest auch bei 401/403/500 AUF -- die HTTP-Haelfte pruefen die Oberflaechen selbst
 * (`response.ok`), diese hier prueft die JSON-Haelfte. Ohne beide wird aus einer abgelaufenen
 * Sitzung eine Landschaft ohne Angaben.
 */
function avesmapsWikiAssignLandschaftAntwortPruefen(antwort) {
	if (!antwort || typeof antwort !== "object" || Array.isArray(antwort) || antwort.ok !== true) {
		const meldung = antwort && antwort.error
			? (antwort.error.message || antwort.error)
			: "Unerwartete Antwort";
		throw new Error(String(meldung));
	}
	return antwort;
}

/**
 * REIN: welche Kartenfelder die ANGEHAKTEN Sync-Zeilen setzen wollen. `null` heisst „diese Angabe
 * ist nicht dabei".
 *
 * 🔴 DIE ZIELE KOMMEN AUS `AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER`, nicht aus einer zweiten
 * Liste hier -- dieselbe Lehre wie beim Ort (Aufgabe 5b): ein drittes Feld im Register erzeugte
 * sonst eine Sync-Zeile, die diese Funktion lautlos verwirft. Das Bauteil zeigt sie, der Haken tut
 * nichts.
 */
function avesmapsWikiAssignLandschaftSyncWerteFuer(zeilen, felder) {
	const liste = Array.isArray(zeilen) ? zeilen : [];
	const werte = {};
	(Array.isArray(felder) ? felder : []).forEach((feld) => { werte[feld] = null; });
	liste.forEach((zeile) => {
		if (!zeile || !Object.prototype.hasOwnProperty.call(werte, zeile.karte)) {
			return;
		}
		const wert = avesmapsWikiAssignLandschaftText(zeile.neu);
		werte[zeile.karte] = wert === "" ? null : wert;
	});
	return werte;
}

/** REIN: hat die Uebernahme ueberhaupt etwas zu tun? Zaehlt ALLE Ziele, nie zwei davon von Hand. */
function avesmapsWikiAssignLandschaftSyncLeerFuer(werte, felder) {
	const w = werte || {};
	return (Array.isArray(felder) ? felder : []).every((feld) => w[feld] === null || w[feld] === undefined);
}

// 🔴 ZWEI Objektarten, EINE Rechnung. Hier standen bis zum 16.08.2026 zwei zeichengleiche
// Abschriften nebeneinander, in denen nur die Konstante wechselte -- 22 Zeilen Abschrift in einem
// Umbau, dessen ganzer Zweck das Abschaffen von Abschriften ist. Die Feldliste ist jetzt ein
// Argument, genau wie bei avesmapsWikiAssignLandschaftKartenwerte darueber; die vier Namen bleiben,
// weil die Oberflaechen sie rufen und ein Aufrufer nicht wissen soll, welche Liste seine ist.
function avesmapsWikiAssignLandschaftSyncWerte(zeilen) {
	return avesmapsWikiAssignLandschaftSyncWerteFuer(zeilen, AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER);
}

function avesmapsWikiAssignLandschaftSyncLeer(werte) {
	return avesmapsWikiAssignLandschaftSyncLeerFuer(werte, AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER);
}

function avesmapsWikiAssignLandschaftslabelSyncWerte(zeilen) {
	return avesmapsWikiAssignLandschaftSyncWerteFuer(zeilen, AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER);
}

function avesmapsWikiAssignLandschaftslabelSyncLeer(werte) {
	return avesmapsWikiAssignLandschaftSyncLeerFuer(werte, AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER: AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER,
		AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER: AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER,
		avesmapsWikiAssignLandschaftslabelZustand: avesmapsWikiAssignLandschaftslabelZustand,
		avesmapsWikiAssignLandschaftslabelSyncWerte: avesmapsWikiAssignLandschaftslabelSyncWerte,
		avesmapsWikiAssignLandschaftslabelSyncLeer: avesmapsWikiAssignLandschaftslabelSyncLeer,
		AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_ART_SYNONYME: AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_ART_SYNONYME,
		avesmapsWikiAssignLandschaftArtErsteKomponente: avesmapsWikiAssignLandschaftArtErsteKomponente,
		avesmapsWikiAssignLandschaftArt: avesmapsWikiAssignLandschaftArt,
		avesmapsWikiAssignLandschaftWerte: avesmapsWikiAssignLandschaftWerte,
		avesmapsWikiAssignLandschaftTreffer: avesmapsWikiAssignLandschaftTreffer,
		avesmapsWikiAssignLandschaftArtikel: avesmapsWikiAssignLandschaftArtikel,
		avesmapsWikiAssignLandschaftZustand: avesmapsWikiAssignLandschaftZustand,
		avesmapsWikiAssignLandschaftZuweisungsKoerper: avesmapsWikiAssignLandschaftZuweisungsKoerper,
		avesmapsWikiAssignLandschaftAntwortPruefen: avesmapsWikiAssignLandschaftAntwortPruefen,
		avesmapsWikiAssignLandschaftSyncWerte: avesmapsWikiAssignLandschaftSyncWerte,
		avesmapsWikiAssignLandschaftSyncLeer: avesmapsWikiAssignLandschaftSyncLeer,
	};
}
