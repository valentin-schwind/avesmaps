/**
 * M5b (Hardening Review 2026-09-28): EINE Quelle für die Ableitungsreihenfolge I1–I12. Bisher stand sie
 * zweimal - in `legacy-update-cli.ts` (Kommentare und die Reihenfolge der `record("Ix", …)`-Aufrufe) und
 * in `ops/deploy/staging-import.sh` (`do_import()`, `step "Ix …"` und die `importer_*`/`derive_*`/
 * `terrain_*`/`relief_*`-Funktionen) - und beide sind schon auseinandergelaufen (vier Fehler in der CLI,
 * siehe `legacy-update.ts`/`legacy-update-cli.ts`). `pipeline-steps.ts` ist jetzt die eine Wahrheit: die
 * CLI nimmt IDs, Labels und Reihenfolge von hier, und `pipeline-parity.test.ts` prüft beide Seiten
 * (reiner Text, führt kein Bash aus) dagegen.
 *
 * `reads`/`writes` sind Tabellennamen wie im Befund, Anhang E - eine fachliche Annäherung (kein
 * vollständiger Datenbank-Katalog), aber genau die, die `pipeline-parity.test.ts` für die Kantenprüfung
 * braucht. Fachlich HARTE Kanten (dürfen nie fehlen, siehe M5 "kleinster Eingriff"): I2→I3; I2→I10→I11→
 * I12→I13; I5→I6→I7; I5→I11; {I1,I2,I4}→I9; I14→I15 (WI-0062); I16→I3 (WI-0064). Alles andere ist Deployment-Konvention (etwa I8 nach I5,
 * siehe der korrigierte Kopfkommentar in `legacy-update-cli.ts`) und bleibt frei.
 */

export interface PipelineStep {
    /** I1…I12, wie in `legacy-update-cli.ts` (`record("Ix", …)`) und `staging-import.sh` (`step "Ix …"`). */
    readonly id: string;
    readonly label: string;
    /**
     * Pfad des gebauten CLI-Werkzeugs unter `apps/server/dist/`, ohne Endung - `staging-import.sh` ruft
     * `dist/<stageCli>.js` auf (`run_cli`/`run_cli_nice`).
     */
    readonly stageCli: string;
    /** Tabellen, die dieser Schritt als fachliche Eingabe braucht (Ergebnis früherer Schritte). */
    readonly reads: readonly string[];
    /** Tabellen, die dieser Schritt schreibt oder ableitet. */
    readonly writes: readonly string[];
    /** Migration, die diesen Schritt erst freischaltet (WI-0049/0054); ohne sie überspringt Stage ihn (`TERRAIN`/`RELIEF`). */
    readonly gate?: string;
    /**
     * Flag-NAMEN (kein Wert), wie `staging-import.sh` sie beim gebauten CLI setzt - Pflichtargumente
     * (Quelldateien, z. B. `--source`) und Laufzeit-Politik (`--workers`, `nice`, `--expose-gc`). Die Freigabe der Schritte im
     * Korridor (I17 bis I27) reicht das Skript als `"${ATTEST[@]}"` durch: `--operator-said "<Zitat>"` oder `--auftrag <Job>`
     * (WI-0127 SYS-14b/c, Claudio `858e0d42`); genau diese Zeichenfolge steht deshalb hier.
     */
    readonly stageFlags: readonly string[];
    /** Dieselben Flags, wie `legacy-update-cli.ts` bzw. das zugehörige npm-Skript sie lokal setzt. */
    readonly localFlags: readonly string[];
    /** Kriterium des zweiten Laufs (Idempotenzprobe) in Worten; der Code dazu steht in `legacy-update.ts`. */
    readonly idempotence: string;
    /**
     * Noch nicht im Stage-Korridor: benennt das Handover, das den Schritt dort nachträgt (Claudios
     * Bereich, `ops/deploy/**`). Entfällt, sobald `staging-import.sh` den Schritt kennt.
     */
    readonly stagePending?: string;
}

/**
 * Tabellen, die ein Schritt liest, ohne dass ein FRÜHERER Schritt sie schreibt - weil sie direkt aus den
 * Legacy-Snapshot-Dateien befüllt werden, nicht aus einer pipeline-internen Vorstufe. Heute leer: jeder
 * `reads`-Eintrag unten hat eine schreibende Vorstufe. `pipeline-parity.test.ts` prüft dagegen.
 */
export const LEGACY_INPUT_TABLES: readonly string[] = [];

/**
 * Die Tafeln, die die Editoren schreiben (`apps/server/src/editor/`, Rechte in `apps/server/src/db/map-grants.psql`; Landschaften mit
 * ihrem Editor, EDIT-0004). 🔴 Ein Zugschritt, der eine davon schreibt, nimmt dabei die Sperre der Kartendomäne exklusiv
 * (`withZugSperre` in `derive/derive-lock.ts`, EDIT-0003 T17), damit kein Speichern zwischen seine Zeilen fällt.
 * `zug-sperre.test.ts` hält die Schritte und ihre Eingangsfunktionen gegen diese Liste. Schreibt ein Editor eine neue Tafel, kommt
 * sie hierher.
 */
export const EDITOR_TABELLEN: readonly string[] = [
    "place",
    "place_unplaced",
    "place_detail",
    "place_wiki_assignment",
    "wiki_key_assignment",
    "path",
    "path_visual",
    "site_settlement",
    "region",
    "region_area",
    "map_label",
    // Die Kraftlinien (WI-0205 K4): Abschnitte, Kraftlinienpunkte und die Wiki-Zuordnung je Abschnitt.
    "powerline",
    "nodix",
    "powerline_wiki_assignment",
    // Die Herrschaftsgebiete (WI-0209 B1, Migration 0145): Gebiet, Fläche, Anspruch; die 17 Detailfelder samt Vermerken (G6, 0076).
    "territory",
    "territory_area",
    "territory_claim",
    "territory_detail",
    "territory_detail_field_origin",
    // Die Kartensammlung (WI-0068 R5, Migration 0197): Eigenschaften und Typen einer Karte schreibt die Medienverwaltung.
    "citymap",
    "citymap_type",
    // Das Gebirge (Landschafts-Editor, WI-0178): Gebirgswerte (`terrain/gebirge-editor.ts`) und Gipfel (`editor/peak-update.ts`, 0205).
    // Der Zugschritt I10 schreibt beide; ohne Eintrag fiel ein Speichern zwischen seine Zeilen (Befund Topographie 2026-10-20).
    "terrain_control",
    "terrain_peak",
    // Das gezeichnete Netz am Gebirge (WI-0245, 0212): Kämme und Nebengipfel, geschrieben mit den Gebirgswerten in `area.gebirge`.
    "terrain_ridge_edge",
    "terrain_ridge_point",
    "terrain_valley_edge",
    "terrain_hollow_point",
    // Eigene Höhen an Flüssen und Seen (WI-0249, 0230), mit dem Netz geschrieben.
    "terrain_water_height",
    // Der Spracheditor (WI-0261 S5d): Sprachen, ihre Teilflächen und Wiki-Artikel. Kein Zugschritt schreibt sie; der Import der Sprachenkarte
    // (`migration/sprachen-import.ts`) nimmt die Sperre selbst (`withZugSperre`).
    "sprache",
    "sprache_flaeche",
    "sprache_wiki",
];

export const PIPELINE_STEPS: readonly PipelineStep[] = [
    {
        id: "I1",
        label: "Orte",
        stageCli: "migration/cli",
        reads: [],
        writes: ["place"],
        stageFlags: ["--source"],
        localFlags: [],
        idempotence: "created+updated+retired = 0 (unchanged bleibt)",
    },
    {
        id: "I2",
        label: "Regionen",
        stageCli: "migration/region-cli",
        reads: [],
        writes: ["region", "region_area", "map_label"],
        stageFlags: ["--regions", "--areas", "--labels"],
        localFlags: [],
        idempotence: "regions+areas+labels je created+updated+retired = 0",
    },
    {
        // WI-0064: die Darstellungstafel der Landschaften als fuenfte Legacy-Quelle (`legacy-ecosystem-display.json`, Stempel
        // `stamp`). Die Nummer folgt der Einfuehrung, nicht der Reihenfolge: die Tafel steht VOR den Schriftlaeufen (I3), weil
        // deren Baender, Groessen und Hoechstzahlen auf sie zurueckfallen, wo ein Label keinen eigenen Wert traegt
        // (`map_label_effective`, Migration 0057). Sie liest keine Tabelle eines frueheren Schrittes: die Arten kommen aus Legacys
        // Vorgaben (`config/landscape-display/`) und Uebersteuerungen, die Zuordnung zu einem Label geschieht erst beim Lesen.
        id: "I16",
        label: "Darstellungstafel",
        stageCli: "migration/landscape-display-cli",
        reads: [],
        writes: ["landscape_display_art", "landscape_display_source"],
        stageFlags: ["--source"],
        localFlags: [],
        idempotence: "arts created+updated+retired = 0, Stempel/SHA-256/Vorgabenbezug gleich",
    },
    {
        id: "I3",
        label: "Schriftläufe",
        stageCli: "derive/cli",
        // `landscape_display_art`: die Baender und Groessen der Labels ohne eigenen Wert (WI-0064, harte Kante I16 -> I3).
        reads: ["region", "region_area", "map_label", "landscape_display_art"],
        writes: ["landscape_label_run"],
        stageFlags: [],
        localFlags: [],
        idempotence: "written = 0 (unchanged bleibt)",
    },
    {
        id: "I4",
        label: "Klima",
        stageCli: "migration/climate-cli",
        reads: [],
        writes: ["climate_divider", "climate_band"],
        stageFlags: ["--areas", "--features"],
        localFlags: [],
        idempotence: "Import meldet 'unveraendert', alle Klimazonen-Pruefungen bestanden",
    },
    {
        id: "I5",
        label: "Wege",
        stageCli: "migration/path-cli",
        reads: [],
        // Seit WI-0132 Release N keine Kreuzungen mehr: Die Tabelle `crossing` bleibt bis N+1 nur als Rückweg stehen.
        writes: ["path"],
        stageFlags: ["--source"],
        localFlags: [],
        idempotence: "created+updated+retired = 0 (unchanged bleibt)",
    },
    {
        id: "I6",
        label: "Wegkurve",
        stageCli: "derive/path-visual-cli",
        // Contract paths.yaml: MUSS vor I7 laufen, sonst liegen die Wegnamen auf der Rohgeometrie.
        reads: ["path"],
        writes: ["path_visual"],
        stageFlags: [],
        localFlags: [],
        idempotence: "geschrieben = 0 (unveraendert bleibt)",
    },
    {
        id: "I7",
        label: "Wegnamen-Schriftläufe",
        stageCli: "derive/path-run-cli",
        reads: ["path_visual"],
        writes: ["path_label_run"],
        stageFlags: [],
        localFlags: [],
        // Kein eigenes "unveraendert" (anders als I3/I6): der Vergleich sind die gemeldeten Zahlen selbst
        // gegen den letzten Lauf - siehe pathRunsChanged in legacy-update.ts (Hardening Review M5, Fund).
        idempotence: "Ketten/Teilstuecke/Laeufe gleich dem letzten Lauf (kein eigenes 'unveraendert')",
    },
    {
        id: "I8",
        label: "Kraftlinien",
        stageCli: "migration/powerline-cli",
        // Fachlich unabhängig (Anhang E); NACH I5 ist Deployment-Konvention, keine harte Kante - siehe
        // der korrigierte Kopfkommentar in legacy-update-cli.ts. Der Verifier V7 prüft die Enden gegen Orte (I1)
        // und die eigenen Kraftlinienpunkte (`nodix`), nicht gegen Kreuzungen; er läuft ohnehin ganz am Ende.
        reads: [],
        writes: ["powerline", "nodix"],
        stageFlags: ["--source"],
        localFlags: ["--dry-run"],
        idempotence: "created+updated+retired = 0, Kraftlinien UND Kraftlinienpunkte (unchanged bleibt)",
    },
    {
        id: "I9",
        label: "Seegraph",
        stageCli: "derive/sea-route-cli",
        reads: ["place", "region_area", "climate_band"],
        writes: ["sea_route_graph"],
        stageFlags: [],
        localFlags: [],
        idempotence: "geschrieben = nein (Quellen unveraendert)",
    },
    {
        id: "I10",
        label: "Gelände-Eingaben",
        stageCli: "migration/terrain-cli",
        gate: "0048_terrain_dem",
        reads: ["region_area"],
        writes: ["terrain_control", "terrain_peak"],
        stageFlags: ["--areas", "--features"],
        localFlags: [],
        idempotence: "controls+peaks je created+updated+retired = 0",
    },
    {
        id: "I11",
        label: "Gelände ableiten",
        stageCli: "derive/terrain-cli",
        gate: "0048_terrain_dem",
        // Flusswege für die Täler, Landwege für die Wegprofile (Anhang E).
        reads: ["terrain_control", "terrain_peak", "region_area", "path"],
        writes: ["terrain_raster", "terrain_domain_raster", "terrain_dem", "terrain_dem_tile", "terrain_path_profile"],
        stageFlags: ["--workers", "--expose-gc"],
        localFlags: ["--only-current"],
        // Wie Stage (idempotence(), "Gelaende ableiten"): computed=0 UND revisionChanged=false UND
        // profiles.computed=0 - siehe terrainDeriveChanged in legacy-update.ts (Hardening Review M5, Fund:
        // die CLI zaehlte vorher nur revisionChanged).
        idempotence: "computed=0, revisionChanged=false, profiles.computed=0",
    },
    {
        id: "I12",
        label: "Domain-DEM verifizieren",
        stageCli: "derive/verify-domain-terrain-cli",
        gate: "0061_terrain_domain_raster",
        reads: [
            "terrain_domain_raster",
            "terrain_dem",
            "terrain_dem_tile",
            "terrain_path_profile",
            "region_area",
            "path",
        ],
        writes: [],
        stageFlags: ["--expose-gc"],
        localFlags: [],
        idempotence: "read-only verification; no writes",
    },
    {
        // WI-0055, ADR-0012, Kapitel 5.32a: nur Darstellung. Nach dem Relief, an dessen Revision und an die
        // des Geländes gebunden; die Ableitung bricht ab, wenn das Relief nicht zum Gelände passt.
        id: "I13",
        label: "Anzeigehöhen ableiten",
        stageCli: "derive/display-height-cli",
        gate: "0053_terrain_display_height",
        reads: ["terrain_domain_raster", "terrain_dem", "region_area"],
        writes: ["terrain_display_height", "terrain_contour", "terrain_height_band"],
        stageFlags: ["--expose-gc"],
        localFlags: ["--only-current", "--expose-gc"],
        idempotence: "computed=false, revisionChanged=false",
    },
    {
        // WI-0062, ADR-0014: die Herrschaftsgebiete als vierte Legacy-Quelle (`legacy-political-territories.json`,
        // eigener Stempel `territories_revision`, bedingter Abruf über `X-Avesmaps-ETag`). Ganz am Ende, weil nichts
        // sonst von ihnen abhängt; Hauptstadt und Sitz sind Verweise auf Orte ohne Fremdschlüssel.
        id: "I14",
        label: "Herrschaftsgebiete",
        stageCli: "migration/territory-cli",
        reads: [],
        writes: ["territory", "territory_area", "territory_claim", "territory_state"],
        stageFlags: ["--source"],
        localFlags: [],
        idempotence: "territories+areas+claims je created+updated+retired = 0, parentsChanged = 0",
    },
    {
        // WI-0062, ADR-0014: Flächen, Grenzen, Namensanker und Hauptstadtzeiger. Derived Data, nur Anzeige.
        id: "I15",
        label: "Gebietsflächen ableiten",
        stageCli: "derive/territory-cli",
        reads: ["territory", "territory_area", "territory_claim", "territory_state"],
        writes: [
            "territory_display_area",
            "territory_shape",
            "territory_border",
            "territory_capital_band",
            "territory_inner_edge",
        ],
        stageFlags: [],
        localFlags: [],
        idempotence: "computed=false (Revision unverändert)",
    },
    {
        // WI-0063 P3, Vertrag subject-details.yaml (D6): Wiki-Zuordnung und Detailfelder der Subjects. Quelle ist dieselbe
        // `map-features.json` wie bei I1, I5, I8 und I10, kein neuer Abruf; der Schritt steht NACH den Trägern (Orte, Regionen
        // und ihre Beschriftungen, Wege, Kraftlinien, Gelände-Eingaben), weil er an ihre Zeilen anhängt, und schreibt nur seine
        // eigenen Tabellen.
        id: "I17",
        label: "Detailfelder und Wiki-Zuordnung",
        stageCli: "migration/subject-details-cli",
        gate: "0065_subject_details",
        reads: ["place", "path", "map_label", "terrain_peak", "powerline"],
        writes: [
            "wiki_settlement_snapshot",
            "wiki_settlement_traffic_link",
            "wiki_path_snapshot",
            "wiki_region_snapshot",
            "wiki_region_snapshot_neighbor",
            "wiki_region_snapshot_synonym",
            "wiki_powerline_snapshot",
            "place_wiki_assignment",
            "path_wiki_assignment",
            "terrain_peak_wiki_assignment",
            "powerline_wiki_assignment",
            "place_detail",
        ],
        stageFlags: ["--source", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "alle zwölf Tabellen je created+updated+retired = 0 (unchanged bleibt)",
    },
    {
        // WI-0063 P3, Vertrag sources.yaml (D1): Quellenkatalog, Korpus, Verknüpfungen je Trägerart und Kanon. Dieselbe
        // `map-features.json`; NACH D6 (I17), den Trägern und den Herrschaftsgebieten (I14), denn Kartensammlung, Literatur und
        // Lore binden später über dieselben Tabellen und die Wiki-Zuordnung an. Fehlt ein Block der Quelle oder ist der Katalog
        // leer, schreibt der Schritt nichts und meldet `source_block_missing` (kein Tor).
        id: "I18",
        label: "Quellen und Kanon",
        stageCli: "migration/sources-cli",
        gate: "0066_sources",
        reads: ["place", "path", "territory", "region", "map_label", "terrain_peak", "powerline"],
        writes: [
            "source_corpus",
            "feature_source",
            "place_source",
            "path_source",
            "territory_source",
            "region_source",
            "terrain_peak_source",
            "place_canon",
            "path_canon",
            "territory_canon",
            "region_canon",
            "terrain_peak_canon",
            "powerline_canon",
        ],
        stageFlags: ["--source", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence:
            "alle dreizehn Tabellen je created+updated+retired = 0, Tombstones geändert = 0 (unchanged bleibt)",
    },
    {
        // WI-0055, Migration 0067; seit WI-0077 (Migration 0072) alle Flächen aller Ebenen in einem Netz (jede gemeinsame Kette
        // einmal glätten, auch über Ebenen) und die Klimabänder mit geglätteten Übergängen. Derived Data, nur Anzeige; liest die
        // Flächen und ihre Regionen (I2) und die Klimatafeln (I4) und ändert sonst nichts. Ohne Änderung der Eingaben rechnet der
        // Schritt nichts, bei wenigen geänderten Flächen nur sie und ihre Nachbarn; eine veraltete Fläche zeigt die Renderansicht
        // eckig, bis er gelaufen ist. Label, CLI und Ausgabe wie bisher (Korridor I19).
        id: "I19",
        label: "Landflächen glätten",
        stageCli: "derive/land-smooth-cli",
        gate: "0067_region_area_smooth",
        reads: ["region", "region_area", "climate_divider", "climate_band"],
        writes: ["region_area_smooth", "climate_band_smooth"],
        stageFlags: [],
        localFlags: [],
        idempotence: "gerechnet=false (Eingaben unverändert)",
    },
    {
        // WI-0063 P3, Vertrag literature.yaml (D3): Werke der Spielliteratur mit geordneter Ortsliste, weiteren Links und (mit der Datei der
        // privaten Felder) Herkunftsvermerken. Quelle ist die Antwort von `game-literature.php`, EIN Abruf je Zug, nur mit dem Zuruf des
        // Betreibers (ohne ihn wird nichts abgerufen); fällt der Abruf aus oder ist die Antwort leer oder abgeschaltet, entfällt nur dieser
        // Schritt (Befund, kein Tor). Er steht NACH den Trägern (Orte I1, Regionen I2, Wege I5, Gelände-Eingaben I10, Herrschaftsgebiete I14),
        // NACH D6 (I17: die Wiki-Zuordnung löst die Ortsbezüge über den Schlüssel auf) und NACH D1 (I18), und schreibt nur seine eigenen
        // Tabellen. Die Auflösung der Ortsbezüge liest die Träger und leitet nichts ab.
        id: "I20",
        label: "Spielliteratur",
        stageCli: "migration/literature-cli",
        gate: "0068_literature",
        reads: [
            "place",
            "territory",
            "region",
            "map_label",
            "terrain_peak",
            "path",
            "wiki_settlement_snapshot",
            "wiki_path_snapshot",
            "wiki_region_snapshot",
            "place_wiki_assignment",
            "path_wiki_assignment",
            "terrain_peak_wiki_assignment",
        ],
        writes: ["adventure", "adventure_field_origin", "adventure_place", "adventure_link"],
        stageFlags: ["--source", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "alle vier Tabellen je created+updated+retired = 0 (unchanged bleibt)",
    },
    {
        // WI-0063 P3, Vertrag citymaps.yaml (D2): Karten der Kartensammlung mit Typen, Beziehungen, Ortsbezug, Fundstellen und der
        // Quellenverknüpfung. Quelle ist die Antwort von `citymaps.php` (EIN Abruf je Zug, nur mit dem Zuruf des Betreibers; der GET schreibt in
        // Legacy heute Schemaheilung und die Rückfüllung color_mode) und die `map-features.json` desselben Zuges (Träger `citymap:<id>` in
        // `feature_sources`). Er steht NACH D1 (I18: die Quellen müssen schon da sein) und nach D3 (voneinander unabhängig). Fällt der Abruf
        // aus oder ist die Antwort leer oder abgeschaltet, entfällt nur dieser Schritt.
        id: "I21",
        label: "Kartensammlung",
        stageCli: "migration/citymaps-cli",
        gate: "0069_citymaps",
        reads: [
            "place",
            "territory",
            "region",
            "map_label",
            "terrain_peak",
            "path",
            "wiki_settlement_snapshot",
            "wiki_path_snapshot",
            "wiki_region_snapshot",
            "place_wiki_assignment",
            "path_wiki_assignment",
            "terrain_peak_wiki_assignment",
            "feature_source",
        ],
        writes: [
            "citymap",
            "citymap_type",
            "citymap_related",
            "citymap_place",
            "citymap_link",
            "citymap_source",
            "citymap_wiki_assignment",
        ],
        stageFlags: ["--source", "--features", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "alle sieben Tabellen je created+updated+retired = 0, parentsChanged = 0 (unchanged bleibt)",
    },
    {
        // WI-0063 P3, Vertrag reviews.yaml (D4, Legacy-Export E3): die sichtbaren Bewertungen von Orten, ohne Personenspalte. Quelle ist
        // die Antwort von `location-reviews-export.php`, EIN Abruf je Zug, nur mit dem Zuruf des Betreibers (ohne ihn wird nichts
        // abgerufen); fällt der Abruf aus oder ist die Antwort unbrauchbar, widersprüchlich oder leer ohne Beleg, entfällt nur dieser
        // Schritt (Befund, kein Tor). Er steht NACH den Orten (I1: der Ortsbezug löst gegen aktive `place`-Zeilen auf), ist von D6, D1, D3
        // und D2 unabhängig und leitet nichts ab. Was Legacy nicht mehr als sichtbar nennt, wird HART GELÖSCHT (Datenschutz, kein Tombstone).
        id: "I22",
        label: "Bewertungen",
        stageCli: "migration/reviews-cli",
        gate: "0075_place_review",
        reads: ["place"],
        writes: ["place_review"],
        stageFlags: ["--source", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "place_review created+updated+gelöscht = 0 (unchanged bleibt)",
    },
    {
        // WI-0063 P3, Vertrag territory-details.yaml (E4): die wirksamen Detailfelder der Herrschaftsgebiete mit Herkunft je Feld. Quelle
        // ist DIESELBE `legacy-political-territories.json` wie bei I14, kein neuer Abruf; der Schritt steht NACH I14 (die Zeilen, an denen die
        // Details hängen) und ist von I15 unabhängig. Er schreibt nur seine zwei Tabellen: der Wappenzustand gehört dem Media Core und wird
        // vom Medienimport geschrieben, hier nur durchgerechnet und gemeldet. Dazu der Wiki-Schnappschuss der Gebiete (WI-0209, Migration 0162). Trägt kein Gebiet das Objekt `detail` (älterer Export),
        // schreibt der Schritt nichts und legt nichts still (`source_block_missing`, kein Tor).
        id: "I23",
        label: "Gebietsdetails",
        stageCli: "migration/territory-details-cli",
        gate: "0076_territory_detail",
        reads: ["territory"],
        writes: [
            "territory_detail",
            "territory_detail_field_origin",
            "wiki_territory_snapshot",
            "wiki_territory_snapshot_unknown",
        ],
        stageFlags: ["--source", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "beide Tabellen je created+updated+retired = 0 (unchanged bleibt)",
    },
    {
        // WI-0063 27.12, Vertrag wiki-link-targets.yaml: Legacys zwei lesende Exporte (Commits 562638021 und 04a85a54f, 2026-10-05) - X1 die Linkziele je Artikel und
        // Feld (`wiki-linkziele-export.php`), X2 die Zuordnungstafel Wiki-Key -> Objekt (`wiki-zuordnung-export.php`). Je Endpunkt EIN Abruf je Zug, nur
        // mit dem Zuruf des Betreibers (ohne ihn wird nichts geholt); faellt ein Abruf aus oder ist eine Antwort leer, entfaellt nur dieser Teil
        // (Befund, kein Tor). Der Import schreibt nur seine drei Tabellen und loest nichts gegen Traeger auf: Welches Objekt hinter einem Key steht, loest
        // der Leser zur Laufzeit ueber den Lookup auf (`subjects/wiki-key-lookup.ts`), deshalb liest der Schritt keine Traegertabelle (der Pruefer V18 tut es,
        // und er steht am Ende der Kette). Er ersetzt die Verkehrswege-Tafel von I17 (`wiki_settlement_traffic_link`) als Quelle der Verweise, ohne sie zu
        // entfernen (erst erweitern, dann umstellen, dann entfernen).
        id: "I24",
        label: "Wiki-Linkziele und Zuordnung",
        stageCli: "migration/wiki-link-targets-cli",
        gate: "0073_wiki_link_targets",
        reads: [],
        writes: ["wiki_key_assignment", "wiki_link_page", "wiki_link_target"],
        stageFlags: ["--zuordnung", "--linkziele", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "alle drei Tabellen je created+updated+retired = 0 (unchanged bleibt)",
    },
    {
        // WI-0063 P3, Vertrag lore.yaml (D5): Lore und Vorkommen (Flora, Fauna, Spezies, Handelswaren) mit Ortszeilen und ihren typisierten
        // Zielen, den Verbreitungsregeln als Daten, den Herkunftsvermerken und den Quellenverknüpfungen. Quelle ist die Antwort von
        // `lore-export.php` (Legacy E2 und E2+), EIN Abruf je Zug, nur mit dem Zuruf des Betreibers (gross und teuer fuer Legacy); faellt
        // der Abruf aus oder ist die Antwort unbrauchbar, leer, abgeschaltet oder passen ihre Kopfzaehler nicht, entfaellt nur dieser
        // Schritt (Befund, kein Tor). Er steht NACH den Traegern (Orte I1, Regionen I2, Wege I5, Gelaende-Eingaben I10, Herrschaftsgebiete
        // I14), NACH der Zuordnung X2 (I24: der Lookup nach Wiki-Key, DERSELBE wie der der Objektlinks, loest die Ortszeilen auf) und NACH D1 (I18: die Quellen der
        // Verknuepfungen haengen am Katalog desselben Zuges), und schreibt nur seine eigenen Tabellen. Die Aufloesung liest die Traeger
        // und leitet nichts ab; die Regeln werden nicht ausgewertet.
        id: "I25",
        label: "Lore und Vorkommen",
        stageCli: "migration/lore-cli",
        gate: "0074_lore",
        reads: [
            // Der Lookup nach Wiki-Key (Zuordnung X2) und die Traeger, die er aufloest: Orte, Gipfel, Beschriftungen und Regionen, Kraftlinien, Wege samt ihren
            // Wiki-Zuordnungen (Wegegruppen) und Herrschaftsgebiete samt abgeleiteter Form.
            "wiki_key_assignment",
            "place",
            "territory",
            "territory_shape",
            "territory_state",
            "region",
            "map_label",
            "terrain_peak",
            "path",
            "powerline",
            "wiki_path_snapshot",
            "path_wiki_assignment",
            // Das Vergleichsmass: die Traeger ueber D6 (nur fuer den Befund place_target_differs_from_carriers).
            "wiki_settlement_snapshot",
            "wiki_region_snapshot",
            "place_wiki_assignment",
            "terrain_peak_wiki_assignment",
            "feature_source",
        ],
        writes: [
            "lore_entry",
            "lore_entry_field_origin",
            "lore_place",
            "lore_place_target",
            "lore_rule",
            "lore_rule_term",
            "lore_rule_term_type",
            "lore_entry_source",
        ],
        stageFlags: ["--source", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "alle acht Tabellen je created+updated+retired = 0 (unchanged bleibt)",
    },
    {
        // WI-0063 MEDIA-M8 (Vertrag media.yaml, `umsetzung_m8_m10`): die METADATEN der Legacy-Medien aus dem Medien-Manifest E5 (Assets, Rechte,
        // Legacy-Herkunft, Galerien der Ortsbilder, Bindungen von Wappen, Covern und Karten, Unterdrückungen, die Freigaberegeln mit
        // Betreiberzitat). Quelle ist das öffentliche Manifest A (`media-export.php`, EIN Abruf je Zug, nur mit dem Zuruf des Betreibers)
        // oder, als Datei vom Betreiber, das private B (nie abgerufen; nur B zieht zurück, was Legacy nicht mehr nennt). Der Schritt steht
        // NACH den Orten (I1), den Gebieten (I14), den Werken (I20) und den Karten (I21): die Bindungen lösen über die Legacy-Kennung auf.
        // KEIN Byte: die Dateien holt `legacy:media-fetch` und legt `migrate:media-files` ab, nie der normale Zug (Plan Abschnitt 10).
        // Fällt der Abruf aus, ist das Manifest unbrauchbar oder leer oder fehlt die Migration, entfällt nur der Schritt (Befund, kein Tor).
        id: "I26",
        label: "Medien (Metadaten)",
        stageCli: "migration/media-cli",
        gate: "0077_media_legacy_source",
        reads: ["place", "territory", "adventure", "citymap"],
        writes: [
            "media_asset",
            "media_rights",
            "media_creation",
            "media_legacy_source",
            // WI-0068 P1 (Migration 0086): die Provenienz je Asset, mit dem Asset geschrieben.
            "media_ingest",
            "media_gallery",
            "media_gallery_item",
            "place_media_gallery",
            "place_media",
            "territory_media",
            "adventure_media",
            "citymap_media",
            "place_media_suppression",
            "territory_media_suppression",
            "publication_rule",
        ],
        stageFlags: ["--source", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "alle Medientabellen je created+updated+retired+reappeared = 0 (unchanged bleibt)",
    },
    {
        // WI-0109, Vertrag staetten.yaml (D7): die Staetten der Orte (`in_settlement_places`). DIESELBE `map-features.json` wie
        // I1, I5, I8, I10 und I17 - KEIN neuer Abruf. Der Schritt steht NACH den Orten (I1), weil er seine Aufloesung gegen deren
        // Namen meldet; geschrieben wird nur die eigene Tabelle. Fehlt der Block oder ist er leer (Legacys Erzeuger ist
        // fail-open), entfaellt nur der Schritt (Befund, kein Tor).
        // WI-0134 (Migration 0099): davor die Staetten ueber Kennungen aus Legacys Rohquellen-Export X4 (EIN Abruf je Zug, nur mit Zuruf,
        // `--rohquellen` im Werkzeug): Objekt, Beziehung nur aus der Kennung (liest `place`), genannte Orte (gezaehlt ueber die Zuordnung X2,
        // liest `wiki_key_assignment` aus I24). Ohne X4 bleibt es beim bisherigen Teil (Befund `staetten_nur_namen`). Im Stage-Korridor laeuft
        // der Schritt weiter nur mit `--source`; X4 dort nachzuziehen ist ein Handover an Claudio.
        id: "I27",
        label: "Staetten der Orte",
        stageCli: "migration/staetten-cli",
        gate: "0078_settlement_place",
        reads: ["place", "wiki_key_assignment"],
        writes: ["site", "site_settlement", "site_named_place", "settlement_place"],
        stageFlags: ["--source", '"${ATTEST[@]}"'],
        localFlags: [],
        idempotence: "settlement_place created+updated+retired = 0 (unchanged bleibt)",
    },
    {
        // WI-0128 E4, Migration 0089: Legacys Export der Wiki-Siedlungsregistry (X3 `wiki-siedlungen-export.php`, Betreiberentscheid 2026-10-10 „A“),
        // die Grundlage des Reiters „Fehlt“ der Ortsliste. EIN Abruf je Zug, nur mit dem Zuruf des Betreibers (ohne ihn wird nichts geholt); faellt
        // der Abruf aus oder ist die Antwort unbrauchbar oder leer, entfaellt nur dieser Schritt (Befund, kein Tor). Der Import schreibt nur seine
        // Tabelle und bindet nichts an einen Ort: ob eine Siedlung platziert ist, fragt der Leser zur Laufzeit ueber denselben Wiki-Key gegen die
        // Zuordnung X2 (I24, `editor/wiki-settlement-rows.ts`). Er liest deshalb keine Tabelle eines frueheren Schritts; der Pruefer V22 tut es und
        // steht am Ende der Kette.
        id: "I28",
        label: "Wiki-Siedlungsregistry",
        stageCli: "migration/wiki-settlements-cli",
        gate: "0089_wiki_settlement_registry",
        reads: [],
        // WI-0134 (Migration 0099): dazu die Linkziele der Standortkette als genannte Orte (Evidenz, keine Bindung).
        writes: ["wiki_settlement_registry", "wiki_settlement_registry_named_place"],
        stageFlags: ["--source", "--operator-said"],
        localFlags: [],
        idempotence: "wiki_settlement_registry created+updated+retired = 0 (unchanged bleibt)",
        stagePending: "WI-0128 E4: Stage-Korridor für I28 (Handover an Claudio folgt)",
    },
];
