import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    emptyKnown,
    findAll,
    findFindings,
    statementsOf,
    type Finding,
    type MigrationFile,
    type RuleId,
} from "./migration-rules.ts";

/**
 * 🔴 Erst erweitern, dann umstellen, dann entfernen (WI-0075, Betreiber 2026-10-04: „Vorlage JOBS-0001: alles wie
 * empfohlen“, R4). Die Regel steht in AGENTS.md, Abschnitt „Migrationen: erst erweitern, dann umstellen, dann entfernen“.
 *
 * Läuft kurz alter und neuer Servercode nebeneinander (Blue/Green), und muss der Rückweg gegen das neue Schema laufen,
 * darf eine Migration dem alten Code nichts wegnehmen. Dieser Test liest ALLE Migrationen und meldet, was das tut:
 *
 * | Regel                          | Beispiel                                                                  |
 * |--------------------------------|---------------------------------------------------------------------------|
 * | `drop-column`                  | `ALTER TABLE t DROP COLUMN c`                                             |
 * | `drop-object`                  | `DROP TABLE`, `DROP VIEW`                                                 |
 * | `rename`                       | `ALTER … RENAME …` (Tabelle, Spalte, Constraint, Sicht)                   |
 * | `set-not-null`                 | `ALTER COLUMN c SET NOT NULL`                                             |
 * | `add-not-null-without-default` | `ADD COLUMN c … NOT NULL` ohne `DEFAULT`: der alte `INSERT` scheitert     |
 * | `add-check`                    | `ADD CONSTRAINT … CHECK` auf eine Tabelle früherer Migrationen            |
 * | `function-signature`           | `DROP FUNCTION`, oder eine Funktion mit anderer Argumentliste als bisher  |
 * | `view-calls-new-function`      | eine bestehende Sicht ruft eine in derselben Migration NEUE Funktion auf  |
 *
 * Wie `KNOWN_DROPPERS` in `render-grants.test.ts`: Was ausgeliefert ist, steht in `KNOWN_EXCEPTIONS` mit Begründung; ein
 * neuer Fall OHNE Eintrag lässt den Test fallen. Dann gibt es zwei Wege: die Migration in Schritte aufteilen (ein
 * Release erweitert, das nächste stellt um, ein späteres entfernt), oder, wenn der Schritt dran ist, ihn hier mit der
 * Begründung eintragen, woran man erkennt, dass das alte Release ihn nicht mehr braucht (Stage-Release des Umstellens,
 * Fundstelle).
 *
 * 🪤 Der Test sieht, was in den Anweisungen steht, nicht was sie bewirken: `EXECUTE 'ALTER TABLE …'` und `DO`-Blöcke
 * entgehen ihm, und ein CHECK auf einer NEUEN Tabelle ist erlaubt. Dafür gibt es das Review gegen die Regel.
 */

interface KnownException {
    migration: string;
    rule: RuleId;
    /** Warum es ausgeliefert ist und das alte Release es nicht mehr braucht. */
    reason: string;
}

const KNOWN_EXCEPTIONS: readonly KnownException[] = [
    {
        migration: "0341_region_gefahrenlage",
        rule: "add-check",
        reason:
            "Die CHECK `region_hazards_known` gilt nur der neuen Spalte `region.hazards` (WI-0308, Gefahrenlage), die mit Vorgabe `'{}'` kommt: Jede bestehende Zeile " +
            "erfüllt sie, das vorige Release liest und schreibt die Spalte nie, sein `INSERT` bekommt die Vorgabe.",
    },
    {
        migration: "0340_besucher_ohne_kurzbesuche",
        rule: "add-check",
        reason: "Nur gelockert (OPS-000118, Besuche unter 10 s ausblendbar): Die Sorte in `visitor_metric` nimmt `visitor_lang` dazu und keinen Wert weg. Jede gespeicherte Zeile erfüllt sie, das vorige Release schreibt und liest `visitor_lang` nie.",
    },
    {
        migration: "0339_meldung_rollen",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0279, Meldungen an Sonderrollen): Die CHECK `ereignis_art` des Community-Verlaufs nimmt `rollen` und `rollen_eingang` dazu und keinen Wert weg. Das vorige Release schreibt " +
            "keines der neuen Wörter, jede gespeicherte Zeile besteht die Regel; seine Leser zeigen ein unbekanntes Ereignis als Wort (`ereignisSatz`, Rückfall). Die neuen Tafeln `vorgang_rolle` und " +
            "`vorgang_region` tragen ihre Prüfungen von Anfang an und werden vom vorigen Release nie gelesen.",
    },
    {
        migration: "0338_meldung_fehlt_arten",
        rule: "add-check",
        reason: "Nur gelockert (WI-0279): `vorgang_fehlt_art` nimmt `insel`, `landschaft`, `herrschaft` und `sprache` dazu und keinen Wert weg; jede bestehende Zeile erfüllt sie, das vorige Release schreibt die neuen Werte nie.",
    },
    {
        migration: "0334_wikisync_vorkommen_liste",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0299, Unterseite „Liste“ eines Vorkommens): `wiki_lore_snapshot_text_not_blank` prüft die neue, nullbare Spalte `liste` mit, `wiki_lore_snapshot_unbekannt_known` kennt " +
            "das neue Wort `liste`; nichts wird entfernt. Das vorige Release liest und schreibt die Spalte nie, legt neue Stände mit der Vorgabe an (die das Wort enthält) und schreibt `unbekannt` nur aus " +
            "Wörtern, die es kennt: Was vorher erlaubt war, bleibt erlaubt, und jede gespeicherte Zeile besteht die Regeln (Vorbild 0252).",
    },
    {
        migration: "0332_kanal_an_community",
        rule: "add-check",
        reason: "Die CHECK `vorgang_abschluss` des Kanals wird weiter (nimmt `an_community` dazu, keinen Wert weg); die neue CHECK `vorgang_an_community` bindet den Abschluss an die neue, nullbare Spalte `community`. Jede bestehende Zeile erfüllt beide, das vorige Release schreibt weder `an_community` noch `community`.",
    },
    {
        migration: "0328_photobox_bild_loeschen",
        rule: "add-check",
        reason: "Die CHECK `media_submission_approved_has_asset` wird weiter: Eine freigegebene oder offline genommene Einreichung darf ohne Werk sein, wenn `media_deleted_at` steht (neue, nullbare Spalte). Jede bestehende Zeile erfüllt sie, das vorige Release schreibt die Spalte nie und liest eine Einreichung ohne Werk über `photobox_media` und LEFT JOIN.",
    },
    {
        migration: "0327_wetter_mahlstrom",
        rule: "add-check",
        reason: "Die CHECKs der Tafel `weather_symbol` (Art, Richtung oder Drehsinn) werden weiter: Sie nehmen die Art `mahlstrom` dazu und keinen Wert weg, jede bestehende Zeile erfüllt sie, das vorige Release schreibt `mahlstrom` nie.",
    },
    {
        migration: "0322_kartenvorschlag_datei_geloescht",
        rule: "add-check",
        reason: "Die CHECK `citymap_suggestion_file_has_asset` wird weiter: Ein angenommener Dateivorschlag darf ohne Werk sein, wenn `media_deleted_at` steht (neue, nullbare Spalte). Jede bestehende Zeile erfüllt sie, das vorige Release schreibt die Spalte nie und liest einen Vorschlag ohne Werk mit LEFT JOIN.",
    },
    {
        migration: "0310_landmarke_nur_gelaende",
        rule: "add-check",
        reason: "Die CHECK der Merkmale wird weiter: Sie nimmt `nur_gelaende` dazu und keinen Wert weg, jede bestehende Zeile erfüllt sie, das vorige Release schreibt den neuen Wert nicht.",
    },
    {
        migration: "0301_social_post_kategorie",
        rule: "add-check",
        reason: "Die CHECKs von Asset-Typ und Freigaberegel werden weiter: Sie nehmen `social_post` dazu und keinen Wert weg, jede bestehende Zeile erfüllt sie, das vorige Release schreibt den neuen Wert nie.",
    },
    {
        migration: "0297_landmarke_ortsmerkmale",
        rule: "add-check",
        reason: "Die CHECK der Merkmale wird weiter: Sie nimmt vier Werte dazu und keinen weg, jede bestehende Zeile erfüllt sie, das vorige Release schreibt die neuen Werte nicht.",
    },
    {
        migration: "0294_discord_test_kanal_entfernen",
        rule: "drop-column",
        reason:
            "Der Testkanal ist abgeschafft (Vali 2026-10-26, WI-0255). Das Umstellen liest und schreibt `discord_routine.test_kanal` nicht mehr (e2f4114ea) und ist auf Stage und " +
            "Production ausgeliefert; das vorige Release kennt die Spalte nicht mehr, nichts liest sie. Jetzt fällt sie samt Prüfung `discord_routine_test_kanal_kennung`.",
    },
    {
        migration: "0282_wikisync_objekt_gipfel",
        rule: "add-check",
        reason:
            "Wiki-Box für Gipfel und Landmarken (WI-0271 L4). `wikisync_objekt_art_check` nur gelockert: die bisherigen fünf Arten bleiben, `gipfel` kommt " +
            "dazu. Das vorige Release schreibt nie `gipfel`, jede bestehende Zeile erfüllt die neue Bedingung.",
    },
    {
        migration: "0292_landmarke_umwandeln",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0271 L8): `terrain_peak_bezug_rolle_known` lässt neben den bisherigen Rollen `umgewandelt_aus` zu. Das vorige Release schreibt das Wort nie, was vorher erlaubt war, bleibt erlaubt, und jede " +
            "gespeicherte Zeile besteht die Regel.",
    },
    {
        migration: "0319_wiki_eintraege_ohne_flaeche",
        rule: "add-check",
        reason:
            "Nur gelockert, wie 0290 (WI-0284): Die Prüfungen der WikiSync-Tafeln lassen die Objektart `region_artikel` zu, `wiki_region_snapshot_retired_consistent` die Herkunft `wikisync`, `map_audit_event_has_target` die nullbare neue Spalte " +
            "`region_artikel_public_id`. Das vorige Release schreibt keines der neuen Wörter und setzt die neue Spalte nie; was vorher erlaubt war, bleibt erlaubt, und jede gespeicherte Zeile besteht die Regeln.",
    },
    {
        migration: "0330_wikisync_ortsartikel",
        rule: "add-check",
        reason:
            "Nur gelockert, wie 0319 (WI-0295): `wiki_settlement_registry_retired_consistent` und `wiki_settlement_snapshot_retired_consistent` lassen die Herkunft `wikisync` zu, die Prüfungen der WikiSync-Tafeln die Objektart " +
            "`ort_artikel`, `map_audit_event_has_target` die nullbare neue Spalte `ort_artikel_public_id`. Das vorige Release schreibt keines der neuen Wörter und setzt die neue Spalte nie; was vorher erlaubt war, " +
            "bleibt erlaubt, und jede gespeicherte Zeile besteht die Regeln.",
    },
    {
        migration: "0290_wikisync_landmarken",
        rule: "add-check",
        reason:
            "Nur gelockert, wie 0255 (WI-0271 L7): Die Prüfungen der WikiSync-Tafeln lassen neben den bisherigen Bereichen den Bereich `landmarken` und die Objektart " +
            "`landmarke_artikel` zu; `map_audit_event_has_target` lässt neben den bisherigen Zielen die nullbare neue Spalte `landmarke_artikel_public_id` zu. Neu ist die Tafel " +
            "`wiki_landmarke_artikel` mit ihren Prüfungen von Anfang an. Das vorige Release schreibt keines der neuen Wörter, setzt die neue Spalte nie und liest die neue Tafel nicht; " +
            "was vorher erlaubt war, bleibt erlaubt, und jede gespeicherte Zeile besteht die Regeln.",
    },
    {
        migration: "0283_community_discord",
        rule: "add-check",
        reason:
            "„Mit Discord verbinden“ für Melder (WI-0268 C8). `oauth_flow_purpose_check` nur gelockert: die bisherigen vier Zwecke (`login`, `link`, `invitation`, `confirm`) bleiben, " +
            "der Zweck `melder` kommt dazu; das vorige Release schreibt ihn nie, bestehende Zeilen erfüllen die Bedingung. `oauth_flow_melder_hash` sitzt auf der NEUEN, nullablen " +
            "Spalte `melder_hash` (Hash des Statusschlüssels, nur für den neuen Zweck); das vorige Release schreibt sie nie und liest sie nie. Nichts wird entfernt.",
    },
    {
        migration: "0276_terrain_peak_landmarken",
        rule: "add-check",
        reason:
            "Landmarken in `terrain_peak` (WI-0271 L2, Vali 2026-10-31 „Ja, D“). `terrain_peak_subtype_check` nur gelockert: die bisherigen Werte `berggipfel` " +
            "und `vulkan` bleiben, die Landmarkenarten kommen dazu. `terrain_peak_merkmale_known` gilt nur der neuen Spalte `merkmale` (Vorgabe leer, das vorige " +
            "Release schreibt sie nie). `terrain_peak_hoehe_nur_gelaende` (Höhe nur bei Berggipfel und Vulkan): Das vorige Release schreibt nur diese zwei Arten, " +
            "jede bestehende Zeile erfüllt sie (L1-Nachweis, Zählung auf der Stage vor der ersten Landmarke). Die Geländeleser lesen seit 0268 die Sicht.",
    },
    {
        migration: "0274_photobox_submission",
        rule: "add-check",
        reason:
            "Reisebilder (WI-0272 S1): Nur erweitert um `photobox`; das vorige Release schreibt den Wert nie, bestehende Zeilen erfüllen jede Bedingung. " +
            "Vier Listen alter Tafeln behalten alle bisherigen Werte und bekommen `photobox` dazu: `media_gallery_kind_known` (Art der Galerie), " +
            "`publication_rule_role_known` (Rolle der Freigaberegel), `place_media_gallery_role_known` und `place_media_gallery_origin_known` (Bindung Ort - Galerie). " +
            "Der Fremdschlüssel `media_ingest_submission_fk` auf die NEUE Tafel `media_submission` ist keine Regel dieses Tests: `submission_id` blieb bisher " +
            "unbelegt, das vorige Release schreibt nur NULL. Die Prüfungen der neuen Tafel gelten von Anfang an.",
    },
    {
        migration: "0273_map_redact_person",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0265 B7, Konto auflösen schwärzt das Kartenprotokoll): `map_operation_request_from_runner` (0091) verlangte für Operationen des Editors Hash UND " +
            "Quittung, künftig genügt die Quittung; der Hash darf nach dem Schwärzen fehlen (`redact_person_map_operation`), wie `media_operation.request_hash` seit 0088. Das " +
            "vorige Release schreibt jede Operation weiter mit Hash und kann die neue Bedingung nicht verletzen, bestehende Zeilen erfüllen sie. Es liest die Spalte nur in " +
            "`MAP_OPERATION_STORE.find` und `replay()`, und beide behandeln NULL seit 0088 als „andere Handlung“ (409), nicht als Fehler. Nichts wird entfernt.",
    },
    {
        migration: "0266_place_review_community",
        rule: "add-check",
        reason:
            "Bewertungen im Community-Modul (WI-0269 C10). NEU und nur auf den neuen Spalten oder dem neuen Wert: `place_review_zustand`, `place_review_grund`, " +
            "`place_review_zaehler` (alle Spalten tragen eine Vorgabe oder sind nullable; das vorige Release schreibt sie nie, der Import legt " +
            "Zeilen mit der Vorgabe `gesichtet` ohne Grund an), `bezug_bewertung` auf den neuen nullablen Spalten `bewertung_id` und `bewertung_grund`. " +
            "`place_review_herkunft` verlangt `legacy_review_id` und `legacy_created_at` nur noch für die Herkunft `legacy` (beide Spalten werden nullable, " +
            "Website-Bewertungen haben sie nicht); das vorige Release und der Import schreiben weiter nur Zeilen mit Herkunft `legacy` und beiden Werten, bestehende " +
            "Zeilen erfüllen sie. GELOCKERT: `vorgang_kategorie` lässt zusätzlich die Kategorie `bewertung` zu (Meldung zu einer Bewertung, Fachkonzept §14.5); " +
            "nichts wird entfernt, das vorige Release schreibt nur die bisherigen Kategorien.",
    },
    {
        migration: "0260_kanal_discord_zurueckziehen",
        rule: "add-check",
        reason:
            "`/erledigt` des Melders aus Discord (WI-0255 Paket 2). GEWEITET: `eintrag_von` lässt zusätzlich einen Eintrag mit der NEUEN Spalte " +
            "`von_discord` (Vorgabe false) ohne Person und Agent zu; mit `von_discord = false` gilt wie bisher genau eines von Person und Agent. Das " +
            "vorige Release schreibt `von_discord` nie, kann die Bedingung also nicht verletzen; bestehende Zeilen erfüllen sie.",
    },
    {
        migration: "0237_wikisync_d2",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0253 D-2): `wikisync_uebernahme_befund_befund_check` lässt zu den bisherigen Befundwörtern vier weitere zu (`weitere_zuweisung`, " +
            "`schnappschuss_schlank`, `wert_unzulaessig`, `name_gesperrt`); nichts wird entfernt. Das vorige Release schreibt nur die bisherigen Wörter und kann die " +
            "Bedingung nicht verletzen, bestehende Zeilen erfüllen sie. Die neue Tafel `wikisync_artikel` trägt ihre Prüfungen von Anfang an und wird vom vorigen Release nie gelesen.",
    },
    {
        migration: "0236_inhalte_korpora",
        rule: "add-check",
        reason:
            "Nur erweitert, wie 0232 bis 0234 (WI-0254, Runde 4): `map_audit_event_has_target` lässt neben den bisherigen Zielen auch den Korpus (`corpus_public_id`) zu; " +
            "`source_corpus_source_type_known` sitzt auf der NEUEN, nullablen Spalte `source_corpus.source_type` und lässt NULL zu. Das vorige Release schreibt weder " +
            "ein neues Ziel noch die neue Spalte, kann also keine Bedingung verletzen; bestehende Zeilen erfüllen beide. Die neuen Spalten (`public_id`, `revision`) " +
            "tragen eine Vorgabe, `is_official` und `editor_note` sind nullable.",
    },
    {
        migration: "0235_inhalte_vorkommen_ohne_wiki",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0254, Vali wählte B am Gate „Vorkommen ohne Wiki-Artikel“): `lore_entry.wiki_key` und `lore_place.place_wiki_key` werden nullable, " +
            "nichts wird entfernt. Der neue CHECK `lore_place_target_present` verlangt Schlüssel ODER Namen (`place_title`); das vorige Release schreibt " +
            "immer einen Schlüssel und kann ihn nicht verletzen, bestehende Zeilen tragen alle einen.",
    },
    {
        migration: "0234_inhalte_vorkommen",
        rule: "add-check",
        reason:
            "Nur erweitert, wie 0232 und 0233 (WI-0254): `map_audit_event_has_target` lässt neben den bisherigen Zielen auch den Lore-Eintrag (`lore_public_id`) zu. " +
            "Das vorige Release schreibt kein neues Ziel; was vorher erlaubt war, bleibt erlaubt. Die neuen Spalten an `lore_entry` (`public_id`, `revision`, " +
            "`editor_note`) tragen eine Vorgabe oder sind nullable.",
    },
    {
        migration: "0233_inhalte_literatur",
        rule: "add-check",
        reason:
            "Nur erweitert, wie 0232 (WI-0254): `map_audit_event_has_target` lässt neben den bisherigen Zielen auch das Werk (`work_public_id`) zu. " +
            "Das vorige Release schreibt kein neues Ziel; was vorher erlaubt war, bleibt erlaubt. Die neuen Spalten an `adventure` (`revision`, " +
            "`editor_note`) und `feature_source` (`editor_note`) tragen eine Vorgabe oder sind nullable.",
    },
    {
        migration: "0232_inhalte_quellen",
        rule: "add-check",
        reason:
            "Nur erweitert, wie 0205 (WI-0254): `map_audit_event_has_target` lässt neben den bisherigen Zielen die Katalogquelle (`source_public_id`) zu. " +
            "Das vorige Release schreibt kein neues Ziel; was vorher erlaubt war, bleibt erlaubt. Die neuen Spalten an `feature_source` (`public_id`, " +
            "`revision`) tragen eine Vorgabe.",
    },
    {
        migration: "0231_kanal_discord_vorgaenge",
        rule: "add-check",
        reason:
            "Vorgänge aus Discord (WI-0255 Paket 2). GEWEITET: `vorgang_status` um `zu_sichten`, `vorgang_rest` lässt statt einer Person auch einen " +
            "Melder aus Discord zu. NEU und nur auf den neuen Spalten oder dem neuen Wert: `vorgang_quelle`, `vorgang_melder_name`, " +
            "`vorgang_melder_kennung`, `vorgang_melder_quelle`, `vorgang_zu_sichten_quelle`. Das vorige Release schreibt `quelle` nie (Vorgabe `app`), " +
            "keinen Melder und nie `zu_sichten`, kann also keine Bedingung verletzen; bestehende Zeilen erfüllen alle.",
    },
    {
        migration: "0225_wikisync_uebernahme",
        rule: "add-check",
        reason:
            "`map_operation_source_known` wird um das Wort `wikisync` GEWEITET (WI-0253 D-1: eine Übernahme des WikiSync ist eine Operation an der Karte); editor, import, " +
            "restore und testwelt_reset bleiben erlaubt. Das vorige Release schreibt nur diese vier, kann die neue Bedingung also nicht verletzen, und bestehende Zeilen " +
            "erfüllen sie. `map_operation_request_from_runner` bleibt unberührt: Eine Übernahme läuft über `runOperation` und trägt Hash und Quittung.",
    },
    {
        migration: "0223_kanon_tafeln",
        rule: "add-check",
        reason:
            "Sechs Mal LOCKERT `<träger>_canon_designator_not_unlabelled` den alten `<träger>_canon_designator_only_unofficial`: Ein Bezeichner " +
            "war nur bei unofficial erlaubt, jetzt bei official und unofficial, nur bei unlabelled bleibt er verboten (WI-0253, Vali 2026-10-25: " +
            "OFFIZIELL | Art). Was das vorige Release schreibt (der Import: official ohne Bezeichner, unofficial mit, unlabelled ohne), erfüllt " +
            "beide Fassungen; bestehende Zeilen erfüllen die neue, weil unlabelled nie einen Bezeichner trug.",
    },
    {
        migration: "0122_production_freigabe",
        rule: "add-check",
        reason:
            "Drei CHECKs werden ERWEITERT, keiner verengt: `vorgang_art` um `freigabe`, `nachweis_station` um die zwei " +
            "Production-Stationen, und `nachweis_release_pflicht` verlangt ein Release künftig auch bei ihnen. Das vorige " +
            "Release schreibt keinen der neuen Werte (es kennt sie nicht), kann also keine der Bedingungen verletzen; was " +
            "vorher erlaubt war, bleibt erlaubt.",
    },
    {
        migration: "0127_kanal_betreiber_abschluss",
        rule: "add-check",
        reason:
            "Der CHECK sitzt auf der NEUEN Spalte `vorgang.abschluss` (nullable, ohne DEFAULT) und lässt NULL zu. Das " +
            "vorige Release kennt die Spalte nicht und schreibt sie nie, kann die Bedingung also nicht verletzen; an " +
            "bestehenden Spalten ändert 0127 nichts. Die Zeilen, die es schon gibt, setzt dieselbe Migration auf " +
            "`abnahme` — ein erlaubter Wert.",
    },
    {
        migration: "0005_place_render_typed",
        rule: "drop-object",
        reason: "Vor der Regel (Phase 2). Das DROP VIEW nahm der Kachelrolle das Leserecht; `avesmaps3d-postmigrate` stellt es wieder her (`render-grants.test.ts`, `KNOWN_DROPPERS`).",
    },
    {
        migration: "0006_place_admin_overrides",
        rule: "rename",
        reason: "Vor der Regel (ADR-0006): `label_*_zoom` und `show_name` heißen seitdem `*_override`. Heutiger Code liest nur die neuen Namen.",
    },
    {
        migration: "0007_place_render_overrides",
        rule: "drop-object",
        reason: "Vor der Regel, wie 0005: `DROP VIEW place_render`, Leserecht über `avesmaps3d-postmigrate` (`KNOWN_DROPPERS`).",
    },
    {
        migration: "0009_place_render_flags",
        rule: "drop-object",
        reason: "Vor der Regel, wie 0005: `DROP VIEW place_render`, Leserecht über `avesmaps3d-postmigrate` (`KNOWN_DROPPERS`).",
    },
    {
        migration: "0017_label_collision_rank",
        rule: "view-calls-new-function",
        reason: "Vor der Regel: `place_render`, `map_label_render` und `landscape_label_run_render` rufen die neue `label_collision_rank()` auf; bis `avesmaps3d-db-grants` fehlt der Kachelrolle das EXECUTE (der Fall von 0067).",
    },
    {
        migration: "0039_drop_powerline_label_tile",
        rule: "function-signature",
        reason: "Schritt „entfernen“: `powerline_label_tile` fragt seit a240338 niemand mehr an (WI-0025, Namen kommen aus `powerline_render`); Martin danach neu starten.",
    },
    {
        migration: "0046_region_area_drop_trial",
        rule: "drop-column",
        reason: "Schritt „entfernen“ (WI-0048 Stufe 2): Stage lief mit Stufe 1 (`097042e`), die die Spalte weder liest noch schreibt, bevor die Migration kam; der Rückweg fragt sie nicht ab.",
    },
    {
        migration: "0050_terrain_path_samples",
        rule: "add-check",
        reason: "Die Bedingung gilt der neuen, nullbaren Spalte `samples`; bestehende Zeilen und das vorige Release (schreibt NULL) erfüllen sie.",
    },
    {
        migration: "0056_territory_border_names",
        rule: "add-check",
        reason: "Erweitert `kind` um `name` und bindet die neue, nullbare Spalte `label_name` daran; das vorige Release schreibt `outer` und `inner` ohne Namen, beides erfüllt die Bedingung.",
    },
    {
        migration: "0059_territory_claim_hatch_bands",
        rule: "function-signature",
        reason: "Schritt „entfernen“: `territory_band_for_zoom(integer)` wählt das Band nicht mehr aus dem Kachelzoom (WI-0062 Nachtrag). Nur die Kachelfunktionen riefen sie, und dieselbe Migration ersetzt beide; kein Servercode ruft sie.",
    },
    {
        migration: "0062_terrain_domain_raster_8k",
        rule: "add-check",
        reason: "Erweitert die erlaubten Größen um 8192, 4096 bleibt gültig („4096² bleibt gültig (Rückweg)“, WI-0070).",
    },
    {
        migration: "0063_terrain_dem_format",
        rule: "add-check",
        reason: "Erweitert die erlaubten Formate; die neue Spalte hat den Standard 'png', das vorige Release schreibt weiter, ohne sie zu kennen (WI-0073).",
    },
    {
        migration: "0067_region_area_smooth",
        rule: "view-calls-new-function",
        reason: "Ausgeliefert (Stage ea2512a): `region_area_render` ruft die neue `region_area_is_smoothed()` auf. Bis `db-grants` antworten die Flächenkacheln mit 500, deshalb migrate und db-grants unmittelbar hintereinander (Handover 2026-10-04-landflaechen-glaettung, 2026-10-04-rollout-ohne-neustart-antwort).",
    },
    {
        migration: "0086_media_mam",
        rule: "add-check",
        reason: "Nur gelockert, erweitert oder an neue, nullbare Spalten gebunden (WI-0068 P1): `*_approved_has_decision` lässt neben dem Zitat eine Person zu, `media_gallery_kind_known` nimmt `editorial` dazu; die übrigen gelten `title`, `publication_state`, `origin` (Vorgabe erfüllt sie), `override_decided_by`, `reviewed_by_person` und `revoked_by_person`, die das vorige Release nie schreibt.",
    },
    {
        migration: "0091_map_operation",
        rule: "add-check",
        reason: "`place_own_without_legacy_id` gilt nur Orten mit `source_system = 'avesmaps3d'` (WI-0128 E8); das vorige Release schreibt nur `legacy`, kein bestehender Ort trifft die Bedingung.",
    },
    {
        migration: "0092_publication_rule_creation",
        rule: "add-check",
        reason: "`publication_rule_creation_method_known` gilt nur der neuen, nullbaren Spalte `creation_method` (WI-0068, Betreiber 2026-10-10); das vorige Release schreibt sie nie, NULL erfüllt die Bedingung.",
    },
    {
        migration: "0095_media_asset_type",
        rule: "add-check",
        reason: "`media_asset_type_known` gilt nur der neuen, nullbaren Spalte `asset_type` (WI-0068 P4b, Betreiber 2026-10-10: Wappen sind ein eigener Typ); das vorige Release schreibt sie nie, NULL erfüllt die Bedingung.",
    },
    {
        migration: "0096_landscape_display_band_8",
        rule: "add-check",
        reason: "Nur gelockert (WI-0129, Betreiber 2026-10-10 E2 A): dieselben zwei Bedingungen unter demselben Namen mit Obergrenze 8 statt 7. Das vorige Release schreibt höchstens 7 und erfüllt sie; bestehende Zeilen ebenso.",
    },
    {
        migration: "0097_person_responsible_for",
        rule: "add-check",
        reason: "`person_responsible_for_line` gilt nur der neuen, nullbaren Spalte `responsible_for` (WI-0133, Betreiber 2026-10-10: „Verantwortlich für:“); das vorige Release schreibt sie nie, NULL erfüllt die Bedingung.",
    },
    {
        migration: "0130_warteschlange_pause",
        rule: "add-check",
        reason:
            "Die zwei CHECKs gelten allein den drei NEUEN Spalten der Pause (WI-0160): `queue_paused` kommt mit " +
            "`DEFAULT false`, und dann ist `system_state_queue_paused_reason` immer erfüllt; " +
            "`system_state_queue_paused_by_one` verlangt nur, dass Person und Kommandozeile nicht beide dastehen, und " +
            "beide bleiben NULL. Das vorige Release kennt die Spalten nicht und schreibt sie nie, kann die Bedingungen " +
            "also nicht verletzen; an bestehenden Spalten ändert 0130 nichts.",
    },
    {
        migration: "0137_landscape_revision",
        rule: "add-check",
        reason:
            "Nur gelockert oder an neue, nullbare Spalten und an die eigene Herkunft gebunden (WI-0178 B1): " +
            "`map_audit_event_has_target` lässt neben Ort und Weg drei weitere Ziele zu; `map_label_placement_known`, " +
            "`map_label_curve_count_with_placement` und `map_label_sort_order_positive` gelten den neuen Spalten, die das vorige " +
            "Release nie schreibt (NULL erfüllt sie); `*_own_without_legacy_id` gilt nur `source_system = 'avesmaps3d'`, das das " +
            "vorige Release nie schreibt, wie `place_own_without_legacy_id` (0091).",
    },
    {
        migration: "0143_powerline_revision",
        rule: "add-check",
        reason:
            "Nur gelockert oder an die eigene Herkunft gebunden (WI-0205 K4), wie 0137: `map_audit_event_has_target` lässt " +
            "neben Ort, Weg und Landschaft zwei weitere Ziele zu; `powerline_own_without_legacy_id` und " +
            "`nodix_own_without_legacy_id` gelten nur `source_system = 'avesmaps3d'`, das das vorige Release nie schreibt " +
            "(sein Import schreibt `legacy`).",
    },
    {
        migration: "0145_territory_revision",
        rule: "add-check",
        reason:
            "Nur gelockert oder an die eigene Herkunft gebunden (WI-0209 B1), wie 0137 und 0143: `map_audit_event_has_target` " +
            "lässt neben Ort, Weg, Landschaft und Kraftlinie zwei weitere Ziele zu; `territory_own_without_legacy_id` und " +
            "`territory_area_own_without_legacy_id` gelten nur `source_system = 'avesmaps3d'`, das das vorige Release nie schreibt " +
            "(sein Import schreibt `legacy`). Der Zyklus-Trigger lehnt nur ab, was der Gebietsimport selbst schon ablehnt.",
    },
    {
        migration: "0196_media_file_wahrnehmung",
        rule: "add-check",
        reason:
            "Der CHECK gilt der NEUEN, nullbaren Spalte `media_file.perceptual_hash` (WI-0068 D2) und lässt NULL zu; das vorige " +
            "Release kennt die Spalte nicht und schreibt sie nie, bestehende Zeilen tragen NULL.",
    },
    {
        migration: "0197_kartensammlung_bearbeiten",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0068 R5), wie 0145 an `map_audit_event`: `media_audit_event_has_target` lässt neben Asset, Galerie " +
            "und Freigaberegel die Karte als viertes Ziel zu. Das vorige Release setzt immer eines der drei alten Ziele und " +
            "erfüllt die Bedingung weiter.",
    },
    {
        migration: "0202_gelaende_lokal_ruhe",
        rule: "function-signature",
        reason:
            "Schritt „erweitern“ (WI-0223, Sammelzeit gleitend): `terrain_local_enqueue` bekommt eine ZWEITE Form mit fünf " +
            "Argumenten; die Form mit vier aus 0169 bleibt unverändert, und das vorige Release ruft genau sie. Postgres löst beide " +
            "Aufrufe eindeutig auf (verschiedene Anzahl), EXECUTE für die App-Rolle kommt über die Standardrechte. Ein späteres " +
            "Release entfernt die alte Form.",
    },
    {
        migration: "0205_terrain_peak_revision",
        rule: "add-check",
        reason:
            "Nur erweitert, wie 0145 (WI-0178 P1): `editor_lock_object_kind_check` lässt neben Ort, Weg, Landschaft, Gebiet und " +
            "Kraftlinie den Gipfel (`peak`) zu, `map_audit_event_has_target` das Ziel `peak_public_id`. Das vorige Release schreibt " +
            "keinen der neuen Werte; was vorher erlaubt war, bleibt erlaubt.",
    },
    {
        migration: "0211_path_allowed_transports_catalog",
        rule: "add-check",
        reason:
            "Nur erweitert (WI-0177, Stage-Fund 2026-10-19): `path_allowed_transports_check` lässt neben Legacys elf Mitteln die " +
            "sechs des Reisemodells seit WI-0069 zu (Karren, Fuhrwerk, Schlitten, Flussgaleere, Ruderboot, Kurierdromone). Das " +
            "vorige Release schreibt nur die alten Mittel; jede gespeicherte Liste besteht die neue Regel.",
    },
    {
        migration: "0240_wikisync_literatur",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0253, Scheibe Literatur): Die Prüfungen der WikiSync-Tafeln lassen neben den bisherigen Bereichen den Bereich `literatur` " +
            "(`wikisync_lauf.bereiche`, `wikisync_lauf_zeile.bereich`, `wikisync_bereich_setting.bereich`, `wikisync_uebernahme.bereich`) und die Objektart `work` " +
            "(`wikisync_lauf_zeile.objekt_art`, `wikisync_uebernahme_befund.objekt_art`) zu. Das vorige Release schreibt keinen der neuen Werte; was vorher erlaubt war, bleibt erlaubt.",
    },
    {
        migration: "0241_wikisync_ortslisten",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0253, Scheibe Ortslisten): `adventure_place_retired_consistent` lässt neben den bisherigen Herkünften des Stilllegens (`import`, `editor`) " +
            "`wikisync` zu. Das vorige Release legt nur mit `import` und `editor` still; jede gespeicherte Zeile besteht die neue Regel.",
    },
    {
        migration: "0242_wikisync_quellen",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0253, Scheibe Quellen): Die Prüfungen der WikiSync-Tafeln lassen neben den bisherigen Bereichen den Bereich `quelle` " +
            "(`wikisync_lauf.bereiche`, `wikisync_lauf_zeile.bereich`, `wikisync_bereich_setting.bereich`, `wikisync_uebernahme.bereich`) und die Objektart `source` " +
            "(`wikisync_lauf_zeile.objekt_art`, `wikisync_uebernahme_befund.objekt_art`) zu. Das vorige Release schreibt keinen der neuen Werte; was vorher erlaubt war, bleibt erlaubt.",
    },
    {
        migration: "0243_wikisync_quellen_anlegen",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0253 §21): `place_source`, `path_source`, `territory_source`, `region_source`, `terrain_peak_source` und `feature_source` lassen in " +
            "`*_retired_consistent` neben `import` und `editor` die Herkunft des Stilllegens `wikisync` zu. Das vorige Release legt nur mit `import` und `editor` still " +
            "und schreibt das neue Wort nie; jede gespeicherte Zeile besteht die neue Regel.",
    },
    {
        migration: "0244_wikisync_gipfelhoehe",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0253 §21): `field_origin_object_kind_check` lässt neben Ort, Weg, Landschaft, Gebiet und Kraftlinie die Art `peak` (den Vermerk der Gipfelhöhe) zu; " +
            "dazu kommt die nullbare Spalte `wiki_region_snapshot.height_schritt`, die das vorige Release nie liest. Das vorige Release schreibt keinen Vermerk der Art `peak`; was vorher erlaubt war, bleibt erlaubt.",
    },
    {
        migration: "0245_wikisync_wiki_teil_wiederverwendet",
        rule: "add-check",
        reason:
            "Neu (WI-0253 §20 Nachtrag): zwei nullbare Spalten an `wikisync_wiki_teil_bereich` (`wiederverwendet_von`, `wiederverwendet_am`) und die Prüfung, dass beide zugleich leer oder gesetzt sind. " +
            "Das vorige Release liest und schreibt die Spalten nie, in jeder bestehenden Zeile sind beide leer: Die Prüfung gilt für alles, was es schreibt.",
    },
    {
        migration: "0247_wikisync_vorkommen",
        rule: "add-check",
        reason:
            "Gelockert und neu (WI-0253 §23): Die Prüfungen der WikiSync-Tafeln lassen neben den bisherigen Bereichen den Bereich `vorkommen` und die Objektart `lore` zu; " +
            "`lore_place_retired_consistent` lässt neben `import`, `editor` und `legacy` die Herkunft des Stilllegens `wikisync` zu. Neu ist die nullbare Spalte `lore_place.role` " +
            "mit ihrer Prüfung (NULL bleibt erlaubt und gilt als Ort) und die Tafel `wiki_lore_snapshot` mit ihren Prüfungen von Anfang an. Das vorige Release schreibt keinen der " +
            "neuen Werte und liest weder die Spalte noch die Tafel; was vorher erlaubt war, bleibt erlaubt, und jede gespeicherte Zeile besteht die Regeln.",
    },
    {
        migration: "0248_wikisync_regeln",
        rule: "add-check",
        reason:
            "Gelockert und neu (WI-0253 §24, F1/F4): `lore_rule_term_join_op_known` lässt neben `und` und `oder` die dritte Verknüpfung `ohne` zu, `lore_rule_retired_consistent` neben `import`, `editor` und `legacy` " +
            "die Herkunft des Stilllegens `wikisync`. Neu sind die nullbare Spalte `lore_rule_term.wiki_area_title` mit ihrer Prüfung (NULL bleibt erlaubt) und die Tafeln der Begriffstafel, des Protokolls der " +
            "Ableitung und der Übernahmen mit ihren Prüfungen von Anfang an. Das vorige Release schreibt weder `ohne` noch eine offene Fläche noch die neue Herkunft und liest keine der neuen Tafeln; " +
            "was vorher erlaubt war, bleibt erlaubt, und jede gespeicherte Zeile besteht die Regeln.",
    },
    {
        migration: "0250_lore_rule_term_lage",
        rule: "add-check",
        reason:
            "Neu (WI-0254, Lage zu einer Linie): drei nullbare Spalten an `lore_rule_term` (`line_direction`, `line_place_a_id`, `line_place_b_id`) und die Prüfung, dass alle drei leer sind oder " +
            "eine der vier Richtungen mit gesetztem Ort A gilt. Das vorige Release liest und schreibt die Spalten nie, in jeder bestehenden Zeile sind alle drei leer: Die Prüfung gilt für alles, " +
            "was es schreibt, und nichts, was vorher erlaubt war, wird verboten.",
    },
    {
        migration: "0252_lore_kurzbeschreibung",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0260, Kurzbeschreibung eines Vorkommens): `lore_entry_field_origin_field_known` lässt neben den bisherigen Feldnamen das Feld `kurzbeschreibung` zu, " +
            "`wiki_lore_snapshot_text_not_blank` prüft die neue Spalte mit und `wiki_lore_snapshot_unbekannt_known` kennt das neue Wort; nichts wird entfernt. Die zwei neuen Spalten " +
            "(`lore_entry.kurzbeschreibung`, `wiki_lore_snapshot.kurzbeschreibung`) sind nullbar: Das vorige Release liest und schreibt sie nie und kann keine Prüfung verletzen, " +
            "jede gespeicherte Zeile besteht die Regeln.",
    },
    {
        migration: "0255_wikisync_sprachen",
        rule: "add-check",
        reason:
            "Nur gelockert (WI-0261 S3): Die Prüfungen der WikiSync-Tafeln lassen neben den bisherigen Bereichen den Bereich `sprachen` und die Objektart `sprache_artikel` zu; " +
            "`map_audit_event_has_target` lässt neben den bisherigen Zielen die nullbare neue Spalte `sprache_artikel_public_id` zu. Neu sind die Tafeln `wiki_sprache_artikel` und " +
            "`sprache_wiki` mit ihren Prüfungen von Anfang an. Das vorige Release schreibt keines der neuen Wörter, setzt die neue Spalte nie und liest keine der neuen Tafeln; " +
            "was vorher erlaubt war, bleibt erlaubt, und jede gespeicherte Zeile besteht die Regeln.",
    },
    {
        migration: "0258_spracheditor",
        rule: "add-check",
        reason:
            "Nur erweitert, wie 0205 und 0255 (WI-0261 S5d, Spracheditor): `map_audit_event_has_target` lässt neben den bisherigen Zielen die nullbaren neuen Spalten " +
            "`sprache_public_id` und `sprache_flaeche_public_id` zu; `editor_lock_object_kind_check` und `editor_lock_request_object_kind_check` lassen neben Ort, Weg, " +
            "Landschaft, Gebiet, Kraftlinie und Gipfel die Sprache (`sprache`) zu. Das vorige Release setzt die neuen Spalten nie und schreibt das neue Wort nie; was " +
            "vorher erlaubt war, bleibt erlaubt, und jede gespeicherte Zeile besteht die Regeln.",
    },
    {
        migration: "0309_community_kontakt_themen",
        rule: "add-check",
        reason:
            "Die Themen des Kontaktformulars (WI-0268, Betreiber 2026-11-04). GELOCKERT: `vorgang_kategorie` lässt zusätzlich `lob`, `allgemein` und `problem` zu; " +
            "nichts wird entfernt, das vorige Release schreibt nur die bisherigen Kategorien.",
    },
];

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

async function readMigrations(): Promise<MigrationFile[]> {
    const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
    return Promise.all(
        names.map(async (name) => ({
            name: name.replace(/\.sql$/, ""),
            sql: await readFile(new URL(name, `file://${migrationsDirectory.replace(/\\/g, "/")}`), "utf8"),
        })),
    );
}

/** Die Befunde, für die es keinen Eintrag in `exceptions` gibt (eine Zeile je Migration und Regel). */
function unexplained(files: readonly MigrationFile[], exceptions: readonly KnownException[]): string[] {
    const lines: string[] = [];
    for (const { name, findings } of findAll(files)) {
        for (const rule of new Set(findings.map((finding) => finding.rule))) {
            if (exceptions.some((entry) => entry.migration === name && entry.rule === rule)) continue;
            const first = findings.find((finding) => finding.rule === rule) as Finding;
            lines.push(`${name}: ${rule} (${first.detail})`);
        }
    }
    return lines;
}

describe("🔴 Migrationen: erst erweitern, dann umstellen, dann entfernen", () => {
    it("jede Migration nimmt dem alten Code nichts weg, außer den bekannten Schritten in KNOWN_EXCEPTIONS", async () => {
        const files = await readMigrations();
        // Der Test prüft etwas: Es gibt Migrationen, und die Regeln finden an ihnen etwas.
        expect(files.length).toBeGreaterThan(60);
        expect(unexplained(files, KNOWN_EXCEPTIONS)).toEqual([]);
    });

    it("jeder Eintrag der Ausnahmeliste trifft noch, nennt eine vorhandene Migration und begründet sich", async () => {
        const files = await readMigrations();
        const found = new Set(
            findAll(files).flatMap(({ name, findings }) => findings.map((finding) => `${name}:${finding.rule}`)),
        );
        const names = new Set(files.map((file) => file.name));
        const stale = KNOWN_EXCEPTIONS.filter((entry) => !found.has(`${entry.migration}:${entry.rule}`)).map(
            (entry) => `${entry.migration}: ${entry.rule}`,
        );
        expect(stale).toEqual([]);
        expect(KNOWN_EXCEPTIONS.filter((entry) => !names.has(entry.migration))).toEqual([]);
        expect(KNOWN_EXCEPTIONS.filter((entry) => entry.reason.length < 40).map((entry) => entry.migration)).toEqual(
            [],
        );
        const keys = KNOWN_EXCEPTIONS.map((entry) => `${entry.migration}:${entry.rule}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("🔴 eine neue Migration mit DROP COLUMN, RENAME, SET NOT NULL oder einer Sicht auf eine neue Funktion fällt ohne Eintrag", async () => {
        const files = await readMigrations();
        const fabricated: MigrationFile[] = [
            { name: "9990_drop", sql: "ALTER TABLE place DROP COLUMN name;" },
            { name: "9991_rename", sql: "ALTER TABLE place RENAME COLUMN name TO title;" },
            { name: "9992_not_null", sql: "ALTER TABLE place ALTER COLUMN name SET NOT NULL;" },
            { name: "9993_column", sql: "ALTER TABLE place ADD COLUMN extra TEXT NOT NULL;" },
            {
                name: "9994_view",
                sql: "CREATE OR REPLACE FUNCTION neu_hilfe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;\nCREATE OR REPLACE VIEW place_render AS SELECT neu_hilfe() AS eins FROM place;",
            },
            { name: "9995_signature", sql: "DROP FUNCTION IF EXISTS label_collision_rank(integer);" },
        ];
        const lines = unexplained([...files, ...fabricated], KNOWN_EXCEPTIONS);
        expect(lines.map((line) => line.split(":")[0])).toEqual([
            "9990_drop",
            "9991_rename",
            "9992_not_null",
            "9993_column",
            "9994_view",
            "9995_signature",
        ]);
        // Mit Eintrag ist es erlaubt: so trägt ein gewollter Schritt (Entfernen ein Release später) sich ein.
        const withEntry = unexplained(fabricated, [
            ...KNOWN_EXCEPTIONS,
            { migration: "9990_drop", rule: "drop-column", reason: "x".repeat(40) },
        ]);
        expect(withEntry.map((line) => line.split(":")[0])).not.toContain("9990_drop");
    });
});

describe("der Leser findet, was dem alten Code etwas wegnimmt, und nur das", () => {
    const rules = (sql: string, setup = ""): RuleId[] => {
        const known = emptyKnown();
        if (setup) findFindings(setup, known);
        return findFindings(sql, known).map((finding) => finding.rule);
    };

    it("drop-column: DROP COLUMN und die Kurzform, nicht DROP CONSTRAINT, DROP NOT NULL oder DROP DEFAULT", () => {
        expect(rules("ALTER TABLE t DROP COLUMN c;")).toEqual(["drop-column"]);
        expect(rules("ALTER TABLE IF EXISTS t DROP COLUMN IF EXISTS c;")).toEqual(["drop-column"]);
        expect(rules("ALTER TABLE t DROP c;")).toEqual(["drop-column"]);
        expect(rules("ALTER TABLE t ADD COLUMN a INT, DROP COLUMN b;")).toEqual(["drop-column"]);
        expect(rules("ALTER TABLE t DROP CONSTRAINT IF EXISTS c;")).toEqual([]);
        expect(rules("ALTER TABLE t ALTER COLUMN c DROP NOT NULL;")).toEqual([]);
        expect(rules("ALTER TABLE t ALTER COLUMN c DROP DEFAULT;")).toEqual([]);
    });

    it("drop-object: DROP TABLE und DROP VIEW, auch mit IF EXISTS", () => {
        expect(rules("DROP TABLE t;")).toEqual(["drop-object"]);
        expect(rules("DROP VIEW IF EXISTS v;")).toEqual(["drop-object"]);
        expect(rules("DROP MATERIALIZED VIEW v;")).toEqual(["drop-object"]);
        expect(rules("DROP INDEX i;")).toEqual([]);
    });

    it("rename: Tabelle, Spalte, Constraint und Sicht", () => {
        expect(rules("ALTER TABLE t RENAME COLUMN a TO b;")).toEqual(["rename"]);
        expect(rules("ALTER TABLE t RENAME TO u;")).toEqual(["rename"]);
        expect(rules("ALTER TABLE t RENAME CONSTRAINT a TO b;")).toEqual(["rename"]);
        expect(rules("ALTER VIEW v RENAME TO w;")).toEqual(["rename"]);
        expect(rules("ALTER TABLE t ADD COLUMN rename_flag BOOLEAN;")).toEqual([]);
    });

    it("set-not-null: SET NOT NULL, nicht DROP NOT NULL", () => {
        expect(rules("ALTER TABLE t ALTER COLUMN c SET NOT NULL;")).toEqual(["set-not-null"]);
        expect(rules("ALTER TABLE t ALTER c SET NOT NULL;")).toEqual(["set-not-null"]);
        expect(rules("ALTER TABLE t ALTER COLUMN c DROP NOT NULL;")).toEqual([]);
    });

    it("add-not-null-without-default: nur NOT NULL ohne Vorgabe; mit DEFAULT oder nullbar ist es erweitern", () => {
        expect(rules("ALTER TABLE t ADD COLUMN c TEXT NOT NULL;")).toEqual(["add-not-null-without-default"]);
        expect(rules("ALTER TABLE t ADD COLUMN IF NOT EXISTS c TEXT NOT NULL;")).toEqual([
            "add-not-null-without-default",
        ]);
        expect(rules("ALTER TABLE t ADD COLUMN a INT NOT NULL DEFAULT 0, ADD COLUMN b INT NOT NULL;")).toEqual([
            "add-not-null-without-default",
        ]);
        expect(rules("ALTER TABLE t ADD COLUMN c TEXT NOT NULL DEFAULT 'png';")).toEqual([]);
        expect(rules("ALTER TABLE t ADD COLUMN c TEXT;")).toEqual([]);
        expect(rules("ALTER TABLE t ADD COLUMN c NUMERIC(4, 1) CHECK (c IS NULL OR c BETWEEN 4 AND 30);")).toEqual([]);
        expect(rules("ALTER TABLE t ADD COLUMN c BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL;")).toEqual([]);
    });

    it("add-check: nur auf einer Tabelle früherer Migrationen, nicht auf einer neuen", () => {
        expect(rules("ALTER TABLE t ADD CONSTRAINT c CHECK (a > 0);", "CREATE TABLE t (a INT);")).toEqual([
            "add-check",
        ]);
        expect(rules("ALTER TABLE t ADD CHECK (a > 0);", "CREATE TABLE IF NOT EXISTS t (a INT);")).toEqual([
            "add-check",
        ]);
        expect(rules("CREATE TABLE t (a INT);\nALTER TABLE t ADD CONSTRAINT c CHECK (a > 0);")).toEqual([]);
        expect(rules("ALTER TABLE t ADD CONSTRAINT c UNIQUE (a);", "CREATE TABLE t (a INT);")).toEqual([]);
    });

    it("function-signature: DROP FUNCTION und eine andere Argumentliste, nicht dieselbe mit anderer Vorgabe", () => {
        const setup =
            "CREATE FUNCTION f(a integer, b text DEFAULT 'x') RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;";
        expect(rules("DROP FUNCTION IF EXISTS f(integer, text);", setup)).toEqual(["function-signature"]);
        expect(
            rules(
                "CREATE OR REPLACE FUNCTION f(a integer, b text, c integer) RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;",
                setup,
            ),
        ).toEqual(["function-signature"]);
        expect(
            rules(
                "CREATE OR REPLACE FUNCTION f(a integer, b text DEFAULT 'y') RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;",
                setup,
            ),
        ).toEqual([]);
        expect(rules("CREATE FUNCTION g(a integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;", setup)).toEqual(
            [],
        );
    });

    it("view-calls-new-function (der Fall von 0067): eine bestehende Sicht ruft eine neue Funktion auf", () => {
        const view = "CREATE OR REPLACE VIEW v AS SELECT hilfe(1) AS x FROM t;";
        const fresh = "CREATE OR REPLACE FUNCTION hilfe(a integer) RETURNS integer LANGUAGE sql AS $$ SELECT a $$;";
        // Die Sicht gab es schon, die Funktion ist neu: bis zu ihrem EXECUTE-Recht antwortet die Sicht mit einem Fehler.
        expect(rules(`${fresh}\n${view}`, "CREATE VIEW v AS SELECT 1 AS x;")).toEqual(["view-calls-new-function"]);
        expect(rules(`${view}\n${fresh}`, "CREATE VIEW v AS SELECT 1 AS x;")).toEqual([]);
        // Eine neue Sicht liest noch kein altes Release.
        expect(rules(`${fresh}\n${view}`)).toEqual([]);
        // Eine ersetzte Funktion (dieselbe Argumentliste) behält ihr Recht.
        expect(rules(`${fresh}\n${view}`, `CREATE VIEW v AS SELECT 1 AS x;\n${fresh}`)).toEqual([]);
        // Ein Aufruf in einer Zeichenkette ist keiner.
        expect(
            rules(
                `${fresh}\nCREATE OR REPLACE VIEW v AS SELECT 'hilfe(1)' AS x FROM t;`,
                "CREATE VIEW v AS SELECT 1 AS x;",
            ),
        ).toEqual([]);
    });

    it("liest Kommentare, Zeichenketten und Rümpfe nicht als Anweisungen", () => {
        const sql = [
            "-- ALTER TABLE t DROP COLUMN c;",
            "/* ALTER TABLE t DROP COLUMN c; /* verschachtelt */ DROP TABLE t; */",
            "COMMENT ON TABLE t IS 'ALTER TABLE t DROP COLUMN c; DROP VIEW v';",
            "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN DROP TABLE x; ALTER TABLE t DROP COLUMN c; END $body$;",
            "DO $$ BEGIN ALTER TABLE t RENAME COLUMN a TO b; END $$;",
        ].join("\n");
        expect(rules(sql)).toEqual([]);
        expect(statementsOf(sql)).toHaveLength(3);
    });
});
