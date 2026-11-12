import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { UMZUG } from "../src/media-editor/merge.ts";
import { activeUsagesSql, MEDIA_USAGE_TABLES, retiredUsagesSql } from "../src/media-editor/usage-sql.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * 🔴 **Wer auf ein Asset zeigt** — die Liste, die das Zusammenführen bytegleicher Werke (D1, WI-0068 §21) umhängen muss.
 *
 * Betreiber 2026-10-13: „bytegleiche bilder die doppelt sind sollen zu einem werden — verlier die referenzen nicht.“ Genau das
 * ist hier festgehalten: Verschwindet ein Asset zugunsten eines anderen, muss JEDE dieser Stellen mitwandern. Eine vergessene
 * Tafel fällt beim Zusammenführen nicht auf (der Fremdschlüssel hält, die Zeile zeigt eben weiter auf das alte Werk) — sie
 * fällt erst Monate später auf, wenn irgendwo ein Bild fehlt oder doppelt steht.
 *
 * 🪤 **Der Test prüft die DATENBANK, nicht den Code.** Legt jemand eine neue Tafel mit einem Asset-Fremdschlüssel an, fällt er,
 * bis sie hier steht — und wer sie einträgt, muss sich entscheiden, was beim Zusammenführen mit ihr geschieht. Das ist der Sinn:
 * Die Entscheidung soll beim Anlegen fallen, nicht beim Zusammenführen.
 *
 * Was D1 mit jeder Stelle zu tun hat, steht in der Spalte „beim Zusammenführen“ — als Vorgabe, nicht als gebauter Code. Gebaut
 * ist D1 nicht (Migration `media_merge` existiert nicht).
 */
describeWithDatabase("Referenzen auf ein Asset (WI-0068 D1)", { timeout: 120_000 }, () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
    }, 120_000);

    afterAll(async () => {
        await database?.end({ timeout: 5 });
    });

    /**
     * Jede Stelle, die auf `media_asset(id)` zeigt, und was mit ihr geschieht, wenn zwei bytegleiche Werke eins werden.
     *
     * - `umhaengen`: Die Zeile zeigt danach auf das bleibende Werk. Dabei kann eine Eindeutigkeit greifen (ein Ort hat ein
     *   Wappen, eine Galerie führt ein Asset einmal) — dann bleibt die vorhandene Zeile und die andere wird zurückgezogen,
     *   statt sie zu verdoppeln.
     * - `faellt`: Die Zeile gehört zum verschwindenden Werk selbst und hat danach keinen Gegenstand mehr.
     * - `bleibt`: Die Zeile beschreibt die HERKUNFT des verschwindenden Werks. Sie muss bleiben, sonst wüsste niemand mehr,
     *   woher es kam — und der Legacy-Zug fände seinen Schlüssel nicht wieder.
     */
    const REFERENZEN: Readonly<Record<string, "umhaengen" | "faellt" | "bleibt">> = {
        // Verwendungen an Fachobjekten: Sie sind der Grund, warum das Werk überhaupt gebraucht wird.
        "place_media.media_asset_id": "umhaengen",
        "territory_media.media_asset_id": "umhaengen",
        "adventure_media.media_asset_id": "umhaengen",
        "citymap_media.media_asset_id": "umhaengen",
        "media_gallery_item.media_asset_id": "umhaengen",
        // Der ★ einer Typbildkategorie (Migration 0113): zeigt auf ein Asset wie jede andere Verwendung.
        "media_type_image.media_asset_id": "umhaengen",
        // Reisebilder (WI-0272 S3, Migration 0293): die Verwendung der Rolle photobox, eine Zeile je freigegebener Einreichung. 🔴 Ein Reisebild nimmt an
        // keiner Zusammenführung teil (`merge.ts`, Vorschau und Sammellauf lassen es aus): die Zeile bleibt bei ihrem Werk und ihrer Einreichung.
        "photobox_media.media_asset_id": "bleibt",
        // 🔴 Der Notaus steht auf den BYTES (`source_sha256`), eindeutig je Datei; das Asset nennt die Zeile nur als Anlass.
        // Beide Werke tragen dieselben Bytes, er wirkt also ohnehin für beide — ihn umzuhängen änderte NICHTS und nähme der
        // Zeile nur ihren Anlass. 🪤 Hier stand bis zum Bau von D1 „umhaengen“: Der Wächter unten hat den Widerspruch gegen
        // `UMZUG` gefunden, nicht ein Mensch.
        "media_publication_suspension.media_asset_id": "bleibt",
        // Dateien, Rechte und Entstehung gehören zum Werk selbst und verschwinden mit ihm.
        "media_file.media_asset_id": "faellt",
        "media_rights.media_asset_id": "faellt",
        "media_rights_evidence.media_asset_id": "faellt",
        "media_creation.media_asset_id": "faellt",
        // 🔴 Herkunft: Sie MUSS bleiben. `media_ingest` trägt den Legacy-Schlüssel, über den der Import wiederfindet, was er
        // einmal angelegt hat; `media_legacy_source` die Quelle. Ohne sie legte der nächste Zug das Werk neu an — und die
        // Zusammenführung wäre beim nächsten Import wieder aufgehoben (Betreiber 2026-10-11, Entscheid A: einmal genügt).
        "media_ingest.media_asset_id": "bleibt",
        "media_legacy_source.media_asset_id": "bleibt",
        // Reisebilder (WI-0272): Die Einreichung nennt das Werk, das ihre Freigabe angelegt hat. Das ist Herkunft wie beim Eingang;
        // die Statusseite des Einsenders liest darüber, was aus seinem Bild wurde.
        "media_submission.approved_media_asset_id": "bleibt",
        // Karte vorschlagen (WI-0275, Migration 0295): Der Vorschlag nennt das Werk, das er mitbrachte. Herkunft wie bei der Einreichung.
        "citymap_suggestion.media_asset_id": "bleibt",
        // Kartenvorschau (WI-0287 Punkt 5, Migration 0320): Die erzeugte Vorschau nennt die Karte, aus der sie gerechnet wurde. Das ist Herkunft wie beim
        // Eingang und bleibt beim verschwindenden Werk; der Notaus findet die Vorschauen aller Karten mit denselben Bytes (`media/notaus.ts`, Verbindung über
        // `generated_from_asset_id` und `source_sha256`), die Zusammenführung ändert daran nichts.
        "media_asset.generated_from_asset_id": "bleibt",
        // 🪤 Die Zusammenfuehrung selbst zeigt auf BEIDE Werke - sie ist der Verlauf und bleibt, wie sie ist. Wuerde sie
        // mitwandern, zeigte sie am Ende auf sich selbst, und "aufheben" wuesste nicht mehr, wer worin aufgegangen ist.
        "media_merge.merged_asset_id": "bleibt",
        "media_merge.kept_asset_id": "bleibt",
    };

    it("🔴 die Datenbank kennt genau diese Stellen - eine neue fällt hier auf, nicht erst beim Zusammenführen", async () => {
        const rows = await database<{ tafel: string; spalte: string }[]>`
            SELECT tc.table_name AS tafel, kcu.column_name AS spalte
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
              JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND ccu.table_name = 'media_asset' AND ccu.column_name = 'id'
             ORDER BY tc.table_name, kcu.column_name
        `;
        // 🪤 Beide Seiten mit DERSELBEN Ordnung vergleichen: Postgres sortiert nach Tafel und Spalte getrennt, hier steht
        // der Punkt dazwischen - `media_rights` und `media_rights_evidence` kippen sonst gegeneinander.
        const gefunden = rows.map((row) => `${row.tafel}.${row.spalte}`).sort();
        expect(
            gefunden,
            "Steht hier eine Tafel zu viel oder zu wenig: Trage sie in REFERENZEN ein und entscheide, was D1 mit ihr tut.",
        ).toEqual(Object.keys(REFERENZEN).sort());
    });

    it("jede Stelle hat eine Entscheidung, und mindestens eine muss umgehängt werden", () => {
        const werte = Object.values(REFERENZEN);
        expect(werte.every((wert) => ["umhaengen", "faellt", "bleibt"].includes(wert))).toBe(true);
        expect(werte.filter((wert) => wert === "umhaengen").length).toBeGreaterThan(0);
        // 🪤 Die Herkunft darf nie fallen: Sonst legt der nächste Legacy-Zug das zusammengeführte Werk wieder neu an.
        expect(REFERENZEN["media_ingest.media_asset_id"]).toBe("bleibt");
    });

    it("🔴 jede Tafel, die laut Tafel UMZIEHT, haengt der Code auch wirklich um", async () => {
        // Dieser Fall stand bis zum Bau von D1 als Gegenteil hier: "D1 ist NICHT gebaut, `media_merge` gibt es nicht". Ein
        // Waechter, der die ABWESENHEIT von etwas zusichert, gehoert beim Bau umgedreht und nicht nur ergaenzt - sonst stuende in
        // der Historie, D1 sei nie gebaut worden. Seine Aufgabe ist jetzt die schaerfere: Tafel und Code muessen uebereinstimmen.
        const [vorhanden] = await database<{ da: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_merge') AS da
        `;
        expect(vorhanden?.da, "Migration 0121 ist angewandt").toBe(true);

        const sollenUmziehen = Object.entries(REFERENZEN)
            .filter(([, wert]) => wert === "umhaengen")
            .map(([stelle]) => stelle.split(".")[0]!)
            .sort();
        // Der Typbild-★ steht im Code nicht in `UMZUG`, sondern als eigener Block (er hat keine Rolle, sondern eine
        // Kategorie); deshalb kommt er hier dazu. `photobox_media` zieht nie um und steht darum nirgends im Code des Umzugs.
        const haengtUm = [...UMZUG.map((spec) => spec.tafel), "media_type_image"].sort();
        expect(
            haengtUm,
            "Steht eine Tafel als `umhaengen` in der Tafel, muss `merge.ts` sie bewegen - und umgekehrt.",
        ).toEqual(sollenUmziehen);
    });

    it("🔴 jede Tafel, die umzieht, ist auch eine Verwendung in Reverse Usage, Liste und Quarantäne (S8-03)", () => {
        // Sonst gilt ein Asset dort als unbenutzt, das hier noch hängt (so lange beim Typbild-★, Code-Review 2026-10-16).
        const verwendungen = activeUsagesSql("");
        const zurueckgezogen = retiredUsagesSql("");
        for (const tafel of [...UMZUG.map((spec) => spec.tafel), "media_type_image", "photobox_media"]) {
            expect(verwendungen, `${tafel} fehlt in activeUsagesSql`).toContain(`FROM ${tafel} `);
            expect(zurueckgezogen, `${tafel} fehlt in retiredUsagesSql`).toContain(`FROM ${tafel} `);
        }
    });

    it("🔴 Reverse Usage und endgültiges Löschen zählen aus DERSELBEN Liste - genau die Tafeln, die umziehen (WI-0068 R4)", () => {
        // Fehlte dort eine, gälte ein Werk als unbenutzt und ließe sich löschen, obwohl ein Fachobjekt es noch zeigt. Dazu kommt die Verwendung der Reisebilder: Sie zählt
        // als Verwendung (und hält die Aufbewahrung), zieht aber nie um.
        expect([...MEDIA_USAGE_TABLES].sort()).toEqual(
            [...UMZUG.map((spec) => spec.tafel), "media_type_image", "photobox_media"].sort(),
        );
    });

    it("🪤 keine Tafel steht zugleich als `bleibt` und im Umzug - das waere ein Widerspruch", () => {
        const bleiben = new Set(
            Object.entries(REFERENZEN)
                .filter(([, wert]) => wert !== "umhaengen")
                .map(([stelle]) => stelle.split(".")[0]!),
        );
        for (const spec of UMZUG) {
            expect(bleiben.has(spec.tafel), `${spec.tafel} zieht um und darf nicht als bleibend gelten`).toBe(false);
        }
    });
});
