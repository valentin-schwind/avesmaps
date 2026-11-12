import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MEDIA_USAGE_TABLES } from "../src/media-editor/usage-sql.ts";
import { evidenceKey, storageKey } from "../src/media/storage.ts";
import { cleanMediaFixtures, insertAsset, insertGallery, insertPublishedFile, sha } from "./support/media-fixture.ts";

/**
 * Die Aufbewahrung der Reisebilder gegen echtes PostgreSQL (WI-0272 S2, Migration 0284): `photobox_aufbewahren(p_jetzt)` lässt offene
 * Einreichungen nach 60 Tagen verfallen und löscht abgelehnte, zurückgezogene, verfallene und offline genommene 30 Tage nach dem
 * Zustandswechsel wirklich (erst die Assets samt Dateizeilen, Rechten und Eingang, dann die Einreichung). Sie gibt die Speicherschlüssel
 * der gelöschten Dateizeilen zurück; die Dateien selbst löscht der Job.
 *
 * 🔴 Ein Asset mit aktiver Verwendung bleibt stehen, samt Eingang und Einreichung: Das Löschen darf nie ein Bild treffen, das irgendwo
 * öffentlich hängt (Tafeln aus `MEDIA_USAGE_TABLES`).
 *
 * Die Funktion arbeitet auf ALLEN Einreichungen; die Tests übergeben deshalb die echte Zeit als `p_jetzt` und altern nur ihre eigenen
 * Zeilen (`state_changed_at` in der Vergangenheit), damit sie die Zeilen anderer Testdateien nie erreichen.
 *
 * Alles trägt Marken: Einreichungen die Fassung `photobox-aufbewahrung-test`, Medienfixtures ihre eigenen (Quellsystem `media-test`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MARK = "photobox-aufbewahrung-test";
const MAP_DOMAIN = "aventuria";
const TAG_MS = 24 * 60 * 60 * 1000;

describeWithDatabase("Aufbewahrung der Reisebilder (WI-0272 S2, Migration 0284)", () => {
    let database: Database;
    let sequence = 0;

    const keyHash = (): Buffer =>
        createHash("sha256")
            .update(`photobox-aufbewahrung/${String(++sequence)}`)
            .digest();

    /** Vor `tage` Tagen, als ISO-Zeit (Zeitpunkte rechnet die Datenbank gegen `p_jetzt`, das hier die echte Zeit ist). */
    const vor = (tage: number): string => new Date(Date.now() - tage * TAG_MS).toISOString();

    async function cleanSubmissions(): Promise<void> {
        await database`DELETE FROM media_ingest WHERE submission_id IN (SELECT id FROM media_submission WHERE terms_version = ${MARK})`;
        await database`DELETE FROM media_submission WHERE terms_version = ${MARK}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
    }, 120_000);

    afterAll(async () => {
        await cleanSubmissions();
        await cleanMediaFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanSubmissions();
        await cleanMediaFixtures(database);
    });

    afterEach(async () => {
        await cleanSubmissions();
        await cleanMediaFixtures(database);
    });

    interface Fall {
        submissionId: string;
        assetIds: string[];
        /** Die Speicherschlüssel aller Dateizeilen und Belege der Assets dieses Falls (das, was die Funktion zurückgeben soll). */
        schluessel: string[];
    }

    /**
     * Eine Einreichung im Zustand `state`, deren letzter Zustandswechsel `tage` Tage her ist, mit `assets` Medien (je eine
     * veröffentlichte und eine private Datei, Rechte, Entstehung, Beleg, Eingang). Freigegeben und offline brauchen ihr Asset.
     */
    async function fall(spec: {
        state: string;
        tage: number;
        ref: string;
        assets?: number;
        /** Welches Asset die Redaktion freigab (Standard: das erste); nur bei approved und offline. */
        freigegeben?: number;
        /** Wie alt die Eingänge sind (Standard: eben erst); das letzte Asset ist das aktuelle Bild, die davor sind ersetzt. */
        eingangTage?: number;
    }): Promise<Fall> {
        const anzahl = spec.assets ?? 1;
        const assetIds: string[] = [];
        const schluessel: string[] = [];
        for (let nummer = 0; nummer < anzahl; nummer += 1) {
            const ref = `${spec.ref}:${String(nummer)}`;
            const asset = await insertAsset(database, { ref });
            assetIds.push(asset.id);
            const original = sha(`${ref}/original`);
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, byte_size, sha256)
                VALUES (${asset.id}, 'source', 'private_source', ${storageKey("private_source", original, "jpg")}, 'image/jpeg', 99, ${original})`;
            const beleg = sha(`${ref}/beleg`);
            await database`
                INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, storage_key, sha256)
                VALUES (${asset.id}, 'pdf', ${evidenceKey(beleg, "pdf")}, ${beleg})`;
            await database`INSERT INTO media_creation (media_asset_id, tool) VALUES (${asset.id}, 'photobox-test')`;
        }
        // Freigegeben und offline verlangen ihr Medium (`media_submission_approved_has_asset`).
        const approved =
            spec.state === "approved" || spec.state === "offline" ? assetIds[spec.freigegeben ?? 0] : undefined;
        const [row] = await database<{ id: string }[]>`
            INSERT INTO media_submission (status_key_hash, map_domain_id, geom, creation_kind, usage_grant, description, terms_version,
                                          state, approved_media_asset_id, submitted_at, state_changed_at)
            VALUES (${keyHash()}, ${MAP_DOMAIN}, 'SRID=0;POINT(300 300)', 'photo', 'avesmaps_only', 'Der Blick vom Hafen', ${MARK},
                    ${spec.state}, ${approved ?? null}, ${vor(spec.tage)}, ${vor(spec.tage)})
            RETURNING id`;
        if (row === undefined) throw new Error("Einreichung nicht angelegt");
        for (const assetId of assetIds) {
            await database`
                INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id, created_at)
                VALUES (${assetId}, 'community_upload', ${row.id}, ${vor(spec.eingangTage ?? 0)})`;
        }
        const dateien = await database<{ storage_key: string }[]>`
            SELECT storage_key FROM media_file WHERE media_asset_id = ANY(${assetIds}::bigint[])
            UNION ALL
            SELECT storage_key FROM media_rights_evidence WHERE media_asset_id = ANY(${assetIds}::bigint[]) AND storage_key IS NOT NULL`;
        schluessel.push(...dateien.map((datei) => datei.storage_key));
        return { submissionId: row.id, assetIds, schluessel };
    }

    async function aufbewahren(): Promise<string[]> {
        const rows = await database<{ storage_key: string }[]>`
            SELECT storage_key FROM photobox_aufbewahren(${new Date().toISOString()}::timestamptz)`;
        return rows.map((row) => row.storage_key).sort();
    }

    async function zustand(submissionId: string): Promise<string | undefined> {
        const [row] = await database<
            { state: string }[]
        >`SELECT state FROM media_submission WHERE id = ${submissionId}`;
        return row?.state;
    }

    async function bestand(fallInfo: Fall): Promise<{
        einreichung: number;
        assets: number;
        dateien: number;
        belege: number;
        rechte: number;
        entstehung: number;
        eingang: number;
    }> {
        const [row] = await database<
            {
                einreichung: number;
                assets: number;
                dateien: number;
                belege: number;
                rechte: number;
                entstehung: number;
                eingang: number;
            }[]
        >`
            SELECT (SELECT count(*) FROM media_submission WHERE id = ${fallInfo.submissionId})::int AS einreichung,
                   (SELECT count(*) FROM media_asset WHERE id = ANY(${fallInfo.assetIds}::bigint[]))::int AS assets,
                   (SELECT count(*) FROM media_file WHERE media_asset_id = ANY(${fallInfo.assetIds}::bigint[]))::int AS dateien,
                   (SELECT count(*) FROM media_rights_evidence WHERE media_asset_id = ANY(${fallInfo.assetIds}::bigint[]))::int AS belege,
                   (SELECT count(*) FROM media_rights WHERE media_asset_id = ANY(${fallInfo.assetIds}::bigint[]))::int AS rechte,
                   (SELECT count(*) FROM media_creation WHERE media_asset_id = ANY(${fallInfo.assetIds}::bigint[]))::int AS entstehung,
                   (SELECT count(*) FROM media_ingest WHERE submission_id = ${fallInfo.submissionId})::int AS eingang`;
        if (row === undefined) throw new Error("kein Bestand");
        return row;
    }

    const VOLL = { einreichung: 1, assets: 1, dateien: 2, belege: 1, rechte: 1, entstehung: 1, eingang: 1 };
    const LEER = { einreichung: 0, assets: 0, dateien: 0, belege: 0, rechte: 0, entstehung: 0, eingang: 0 };

    describe("Verfall: offene Einreichungen nach 60 Tagen", () => {
        it("eine offene Einreichung mit 61 Tagen wird expired, mit 59 Tagen bleibt sie; die Frist des Löschens beginnt erst jetzt", async () => {
            const alt = await fall({ state: "incoming", tage: 61, ref: "verfall:alt" });
            const jung = await fall({ state: "incoming", tage: 59, ref: "verfall:jung" });
            expect(await aufbewahren()).toEqual([]);
            expect(await zustand(alt.submissionId)).toBe("expired");
            expect(await zustand(jung.submissionId)).toBe("incoming");
            // Verfallen ist noch nicht gelöscht: Asset und Einreichung stehen, der Zustandswechsel gilt ab jetzt.
            expect(await bestand(alt)).toEqual(VOLL);
            const [stand] = await database<{ frisch: boolean }[]>`
                SELECT state_changed_at > now() - interval '1 minute' AS frisch FROM media_submission WHERE id = ${alt.submissionId}`;
            expect(stand?.frisch).toBe(true);
        });

        it("jeder offene Zustand verfällt: incoming, pending, changes_requested und technical_failed (sonst bliebe sie samt Dateien für immer)", async () => {
            const faelle = [];
            for (const offen of ["incoming", "pending", "changes_requested", "technical_failed"]) {
                faelle.push(await fall({ state: offen, tage: 61, ref: `verfall:${offen}` }));
            }
            await aufbewahren();
            for (const einzelner of faelle) expect(await zustand(einzelner.submissionId)).toBe("expired");
        });

        it("entschiedene Zustände verfallen nicht: eine freigegebene Einreichung mit 61 Tagen bleibt approved", async () => {
            const freigegeben = await fall({ state: "approved", tage: 61, ref: "verfall:approved" });
            const abgelehnt = await fall({ state: "rejected", tage: 29, ref: "verfall:rejected" });
            await aufbewahren();
            expect(await zustand(freigegeben.submissionId)).toBe("approved");
            expect(await zustand(abgelehnt.submissionId)).toBe("rejected");
        });
    });

    describe("Löschen: 30 Tage nach der Entscheidung", () => {
        for (const beendet of ["rejected", "withdrawn", "expired", "offline"]) {
            it(`${beendet} mit 31 Tagen: Asset, Dateizeilen, Rechte, Entstehung, Beleg, Eingang und Einreichung sind weg; die Rückgabe nennt die Schlüssel`, async () => {
                const einzelner = await fall({ state: beendet, tage: 31, ref: `loeschen:${beendet}` });
                expect(await bestand(einzelner)).toEqual(VOLL);
                expect(einzelner.schluessel).toHaveLength(3);
                expect(await aufbewahren()).toEqual([...einzelner.schluessel].sort());
                expect(await bestand(einzelner)).toEqual(LEER);
            });
        }

        it("mit 29 Tagen bleibt alles stehen, ein zweiter Lauf nach dem Löschen findet nichts mehr", async () => {
            const jung = await fall({ state: "rejected", tage: 29, ref: "loeschen:jung" });
            const alt = await fall({ state: "withdrawn", tage: 31, ref: "loeschen:alt" });
            expect(await aufbewahren()).toEqual([...alt.schluessel].sort());
            expect(await bestand(jung)).toEqual(VOLL);
            expect(await bestand(alt)).toEqual(LEER);
            expect(await aufbewahren()).toEqual([]);
        });

        it("offene und freigegebene Einreichungen werden nicht gelöscht, auch wenn der Zustandswechsel 31 Tage her ist", async () => {
            const bleibende = [];
            for (const offen of ["incoming", "pending", "changes_requested", "approved", "technical_failed"]) {
                bleibende.push(await fall({ state: offen, tage: 31, ref: `loeschen:${offen}` }));
            }
            expect(await aufbewahren()).toEqual([]);
            for (const einzelner of bleibende) expect(await bestand(einzelner)).toEqual(VOLL);
        });

        it("ein ersetztes Bild: beide Assets der Einreichung gehen mit ihr", async () => {
            const einzelner = await fall({ state: "rejected", tage: 40, ref: "loeschen:zwei", assets: 2 });
            expect(einzelner.assetIds).toHaveLength(2);
            expect(await aufbewahren()).toEqual([...einzelner.schluessel].sort());
            expect(await bestand(einzelner)).toEqual({ ...LEER });
        });

        it("bytegleiche Dateien eines anderen Werks bleiben: der Schlüssel wird nur genannt, wenn ihn keine Zeile mehr hält", async () => {
            const einzelner = await fall({ state: "rejected", tage: 31, ref: "loeschen:geteilt" });
            // Ein fremdes Werk (kein Reisebild) trägt dieselben Bytes der veröffentlichten Fassung.
            const [gehoert] = await database<{ sha256: string; storage_key: string }[]>`
                SELECT sha256, storage_key FROM media_file WHERE media_asset_id = ${einzelner.assetIds[0]!} AND storage_class = 'published'`;
            const fremd = await insertAsset(database, { ref: "loeschen:fremd", published: [] });
            await insertPublishedFile(database, fremd.id, "loeschen:fremd", { variant: "coat", sha: gehoert!.sha256 });
            const erwartet = einzelner.schluessel.filter((key) => key !== gehoert!.storage_key).sort();
            expect(erwartet).toHaveLength(2);
            expect(await aufbewahren()).toEqual(erwartet);
            const [uebrig] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_file WHERE storage_key = ${gehoert!.storage_key}`;
            expect(uebrig?.n).toBe(1);
        });
    });

    describe("🔴 Offline: die Dateien gehen beim nächsten Lauf, die Angaben nach 30 Tagen (Review I1, Datenschutztext §15)", () => {
        /** Was nach dem Lauf eines frisch offline genommenen Bildes stehen bleibt: alles außer den Dateizeilen. */
        const OHNE_DATEIEN = { ...VOLL, dateien: 0 };

        /** Die Schlüssel der Dateizeilen (ohne die Belege) eines Falls. */
        const dateischluessel = async (einzelner: Fall): Promise<string[]> =>
            (
                await database<{ storage_key: string }[]>`
                    SELECT storage_key FROM media_file WHERE media_asset_id = ANY(${einzelner.assetIds}::bigint[])`
            )
                .map((datei) => datei.storage_key)
                .sort();

        it("offline seit einem Tag: alle Dateizeilen sind weg und ihre Schlüssel kommen zurück; Asset, Rechte, Beleg, Eingang und Einreichung bleiben", async () => {
            const einzelner = await fall({ state: "offline", tage: 1, ref: "offline:tag1" });
            const dateien = await dateischluessel(einzelner);
            expect(dateien).toHaveLength(2);
            expect(await aufbewahren()).toEqual(dateien);
            expect(await bestand(einzelner)).toEqual(OHNE_DATEIEN);
            expect(await zustand(einzelner.submissionId)).toBe("offline");
            // Der nächste Lauf findet keine Datei mehr; die Angaben bleiben bis zum Löschen nach 30 Tagen stehen.
            expect(await aufbewahren()).toEqual([]);
            expect(await bestand(einzelner)).toEqual(OHNE_DATEIEN);
        });

        it("auch sofort nach dem Offline-Nehmen (heute): die Frist von 30 Tagen gilt nur für das Löschen der Angaben", async () => {
            const einzelner = await fall({ state: "offline", tage: 0, ref: "offline:heute" });
            const dateien = await dateischluessel(einzelner);
            expect(await aufbewahren()).toEqual(dateien);
            expect(await bestand(einzelner)).toEqual(OHNE_DATEIEN);
        });

        it("mit 29 Tagen sind die Dateien längst weg und die Angaben noch da, mit 31 Tagen geht der Rest (der Beleg kommt dann zurück)", async () => {
            const einzelner = await fall({ state: "offline", tage: 29, ref: "offline:frist" });
            const dateien = await dateischluessel(einzelner);
            expect(await aufbewahren()).toEqual(dateien);
            expect(await bestand(einzelner)).toEqual(OHNE_DATEIEN);
            // Der Zustandswechsel rückt 31 Tage zurück: jetzt fällt der Rest.
            await database`UPDATE media_submission SET state_changed_at = ${vor(31)} WHERE id = ${einzelner.submissionId}`;
            const beleg = einzelner.schluessel.filter((key) => !dateien.includes(key));
            expect(beleg).toHaveLength(1);
            expect(await aufbewahren()).toEqual(beleg);
            expect(await bestand(einzelner)).toEqual(LEER);
        });

        it("ein ersetztes Bild: die Dateien aller Assets der Einreichung gehen mit", async () => {
            const einzelner = await fall({ state: "offline", tage: 2, ref: "offline:zwei", assets: 2 });
            const dateien = await dateischluessel(einzelner);
            expect(dateien).toHaveLength(4);
            expect(await aufbewahren()).toEqual(dateien);
            expect(await bestand(einzelner)).toEqual({
                ...OHNE_DATEIEN,
                assets: 2,
                belege: 2,
                rechte: 2,
                entstehung: 2,
                eingang: 2,
            });
        });

        it("die übrigen beendeten Zustände (rejected, withdrawn, expired) behalten ihre Dateien bis zu den 30 Tagen", async () => {
            const faelle = [];
            for (const beendet of ["rejected", "withdrawn", "expired"]) {
                faelle.push(await fall({ state: beendet, tage: 1, ref: `offline:${beendet}` }));
            }
            expect(await aufbewahren()).toEqual([]);
            for (const einzelner of faelle) expect(await bestand(einzelner)).toEqual(VOLL);
        });

        it("bytegleiche Dateien eines anderen Werks bleiben: die Zeile geht, der Schlüssel kommt nur zurück, wenn ihn keine andere Zeile hält", async () => {
            const einzelner = await fall({ state: "offline", tage: 1, ref: "offline:geteilt" });
            const [gehoert] = await database<{ sha256: string; storage_key: string }[]>`
                SELECT sha256, storage_key FROM media_file WHERE media_asset_id = ${einzelner.assetIds[0]!} AND storage_class = 'published'`;
            const fremd = await insertAsset(database, { ref: "offline:fremd", published: [] });
            await insertPublishedFile(database, fremd.id, "offline:fremd", { variant: "coat", sha: gehoert!.sha256 });
            const erwartet = (await dateischluessel(einzelner)).filter((key) => key !== gehoert!.storage_key);
            expect(erwartet).toHaveLength(1);
            expect(await aufbewahren()).toEqual(erwartet);
            expect((await bestand(einzelner)).dateien).toBe(0);
            const [uebrig] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_file WHERE storage_key = ${gehoert!.storage_key}`;
            expect(uebrig?.n).toBe(1);
        });

        it("was aktiv hängt, behält seine Dateien: offline mit einem Galerieeintrag verliert nichts", async () => {
            const einzelner = await fall({ state: "offline", tage: 1, ref: "offline:haengt" });
            const galerie = await insertGallery(database, "offline:haengt");
            await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galerie.id}, ${einzelner.assetIds[0]!}, 0)`;
            expect(await aufbewahren()).toEqual([]);
            expect(await bestand(einzelner)).toEqual(VOLL);
        });
    });

    describe("🔴 Verwendung: was irgendwo hängt, wird nicht gelöscht", () => {
        it("offline mit einem aktiven Galerieeintrag: Asset, Eingang und Einreichung bleiben, nichts wird zurückgegeben", async () => {
            const einzelner = await fall({ state: "offline", tage: 45, ref: "verwendung:aktiv" });
            const galerie = await insertGallery(database, "verwendung:aktiv");
            await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galerie.id}, ${einzelner.assetIds[0]!}, 0)`;
            expect(await aufbewahren()).toEqual([]);
            expect(await bestand(einzelner)).toEqual(VOLL);
            expect(await zustand(einzelner.submissionId)).toBe("offline");
        });

        it("ein zurückgezogener Galerieeintrag hält nichts mehr: das Werk geht, sein toter Eintrag mit", async () => {
            const einzelner = await fall({ state: "offline", tage: 45, ref: "verwendung:tot" });
            const galerie = await insertGallery(database, "verwendung:tot");
            await database`
                INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order, retired_at)
                VALUES (${galerie.id}, ${einzelner.assetIds[0]!}, 0, now())`;
            expect(await aufbewahren()).toEqual([...einzelner.schluessel].sort());
            expect(await bestand(einzelner)).toEqual(LEER);
            const [rest] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM media_gallery_item WHERE gallery_id = ${galerie.id}`;
            expect(rest?.n).toBe(0);
        });

        it("hängt nur eines von zwei Assets, bleibt die ganze Einreichung (die Freigabe zeigt auf ein Asset, das nicht fehlen darf)", async () => {
            const einzelner = await fall({ state: "offline", tage: 45, ref: "verwendung:eins", assets: 2 });
            const galerie = await insertGallery(database, "verwendung:eins");
            await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galerie.id}, ${einzelner.assetIds[1]!}, 0)`;
            expect(await aufbewahren()).toEqual([]);
            expect(await bestand(einzelner)).toEqual({
                ...VOLL,
                assets: 2,
                dateien: 4,
                belege: 2,
                rechte: 2,
                entstehung: 2,
                eingang: 2,
            });
        });

        it("eine unabhängige Einreichung wird trotzdem gelöscht, wenn die Nachbarin bleibt", async () => {
            const bleibt = await fall({ state: "offline", tage: 45, ref: "verwendung:nachbar-bleibt" });
            const geht = await fall({ state: "rejected", tage: 45, ref: "verwendung:nachbar-geht" });
            const galerie = await insertGallery(database, "verwendung:nachbar");
            await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galerie.id}, ${bleibt.assetIds[0]!}, 0)`;
            expect(await aufbewahren()).toEqual([...geht.schluessel].sort());
            expect(await bestand(bleibt)).toEqual(VOLL);
            expect(await bestand(geht)).toEqual(LEER);
        });

        it("ein Notaus am Werk hält es ebenfalls (der Fremdschlüssel liefe sonst ins Leere und der Lauf bräche ab)", async () => {
            const einzelner = await fall({ state: "rejected", tage: 45, ref: "verwendung:notaus" });
            const [original] = await database<{ sha256: string }[]>`
                SELECT sha256 FROM media_file WHERE media_asset_id = ${einzelner.assetIds[0]!} AND storage_class = 'private_source'`;
            await database`
                INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                VALUES (${original!.sha256}, ${einzelner.assetIds[0]!}, 'Test', '7e570000-0000-4000-8000-0000000000aa')`;
            expect(await aufbewahren()).toEqual([]);
            expect(await bestand(einzelner)).toEqual(VOLL);
        });
    });

    describe("🔴 Ersetzte Bilder fallen im täglichen Lauf (WI-0272 S3, Fixrunde C, Review I3)", () => {
        /** Die Schlüssel der Dateizeilen und Belege dieser Assets, vor dem Lauf. */
        const schluesselVon = async (assetIds: readonly string[]): Promise<string[]> =>
            (
                await database<{ storage_key: string }[]>`
                    SELECT storage_key FROM media_file WHERE media_asset_id = ANY(${assetIds}::bigint[])
                    UNION ALL
                    SELECT storage_key FROM media_rights_evidence WHERE media_asset_id = ANY(${assetIds}::bigint[]) AND storage_key IS NOT NULL`
            )
                .map((zeile) => zeile.storage_key)
                .sort();
        const assetsDa = async (assetIds: readonly string[]): Promise<string[]> =>
            (
                await database<{ id: string }[]>`
                    SELECT id::text AS id FROM media_asset WHERE id = ANY(${assetIds}::bigint[]) ORDER BY id`
            ).map((zeile) => zeile.id);
        const eingaenge = async (einzelner: Fall): Promise<string[]> =>
            (
                await database<{ id: string }[]>`
                    SELECT media_asset_id::text AS id FROM media_ingest WHERE submission_id = ${einzelner.submissionId} ORDER BY id`
            ).map((zeile) => zeile.id);
        const teil = (einzelner: Fall, ...nummern: number[]): Fall => ({
            ...einzelner,
            assetIds: nummern.map((nummer) => einzelner.assetIds[nummer]!),
        });
        /** Die Kennungen in der Reihenfolge, in der \`assetsDa\` sie liefert (nach Zahl). */
        const sortiert = (...assetIds: string[]): string[] => [...assetIds].sort((a, b) => Number(a) - Number(b));

        for (const offen of ["incoming", "pending", "changes_requested", "technical_failed"]) {
            it(`${offen}: die ersetzten Assets (nicht das aktuelle Bild) sind samt Dateizeilen, Beleg, Rechten, Entstehung und Eingang weg; die Einreichung und das aktuelle Bild bleiben`, async () => {
                const einzelner = await fall({
                    state: offen,
                    tage: 3,
                    ref: `ersetzt:${offen}`,
                    assets: 3,
                    eingangTage: 3,
                });
                const [alt1, alt2, aktuell] = einzelner.assetIds as [string, string, string];
                const erwartet = await schluesselVon([alt1, alt2]);
                expect(erwartet).toHaveLength(6);

                expect(await aufbewahren()).toEqual(erwartet);
                expect(await bestand(teil(einzelner, 0, 1))).toEqual({ ...LEER, einreichung: 1, eingang: 1 });
                expect(await assetsDa(einzelner.assetIds)).toEqual([aktuell]);
                expect(await eingaenge(einzelner)).toEqual([aktuell]);
                expect(await zustand(einzelner.submissionId)).toBe(offen);
                expect(await bestand(teil(einzelner, 2))).toEqual(VOLL);
                // Ein zweiter Lauf findet nichts mehr.
                expect(await aufbewahren()).toEqual([]);
            });
        }

        it("🔴 freigegeben: das ersetzte Original fällt, das freigegebene (und aktuelle) Bild bleibt samt Verweis der Einreichung", async () => {
            const einzelner = await fall({
                state: "approved",
                tage: 5,
                ref: "ersetzt:freigegeben",
                assets: 2,
                freigegeben: 1,
                eingangTage: 5,
            });
            const [alt, freigegeben] = einzelner.assetIds as [string, string];
            const erwartet = await schluesselVon([alt]);
            expect(erwartet).toHaveLength(3);
            expect(await aufbewahren()).toEqual(erwartet);
            expect(await assetsDa(einzelner.assetIds)).toEqual([freigegeben]);
            expect(await bestand(teil(einzelner, 1))).toEqual(VOLL);
            const [row] = await database<{ approved: string | null }[]>`
                SELECT approved_media_asset_id::text AS approved FROM media_submission WHERE id = ${einzelner.submissionId}`;
            expect(row?.approved).toBe(freigegeben);
            expect(await zustand(einzelner.submissionId)).toBe("approved");
        });

        it("das freigegebene Asset bleibt auch, wenn es nicht das aktuelle ist; nur das dazwischen fällt", async () => {
            const einzelner = await fall({
                state: "approved",
                tage: 5,
                ref: "ersetzt:freigegeben-alt",
                assets: 3,
                freigegeben: 0,
                eingangTage: 5,
            });
            const [freigegeben, dazwischen, aktuell] = einzelner.assetIds as [string, string, string];
            const erwartet = await schluesselVon([dazwischen]);
            expect(await aufbewahren()).toEqual(erwartet);
            expect(await assetsDa(einzelner.assetIds)).toEqual(sortiert(freigegeben, aktuell));
        });

        it("🔴 eine Schonfrist von einem Tag nach dem Ersetzen: ein eben ersetztes Bild bleibt noch (die Ersetzung und der Abgleich sind womöglich im Gang)", async () => {
            const eben = await fall({ state: "pending", tage: 0, ref: "ersetzt:eben", assets: 2, eingangTage: 0 });
            const gestern = await fall({
                state: "pending",
                tage: 0,
                ref: "ersetzt:gestern",
                assets: 2,
                eingangTage: 2,
            });
            const erwartet = await schluesselVon([gestern.assetIds[0]!]);
            expect(await aufbewahren()).toEqual(erwartet);
            expect(await assetsDa(eben.assetIds)).toEqual(sortiert(...eben.assetIds));
            expect(await assetsDa(gestern.assetIds)).toEqual([gestern.assetIds[1]!]);
        });

        it("🔴 ein ersetztes Asset mit aktiver Verwendung bleibt, eine zurückgezogene Verwendung geht mit ihm (sonst bräche der Lauf am Fremdschlüssel)", async () => {
            const haengt = await fall({ state: "pending", tage: 3, ref: "ersetzt:haengt", assets: 2, eingangTage: 3 });
            const galerie = await insertGallery(database, "ersetzt:haengt");
            await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galerie.id}, ${haengt.assetIds[0]!}, 0)`;
            const zurueck = await fall({
                state: "pending",
                tage: 3,
                ref: "ersetzt:zurueck",
                assets: 2,
                eingangTage: 3,
            });
            const galerie2 = await insertGallery(database, "ersetzt:zurueck");
            await database`
                INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order, retired_at)
                VALUES (${galerie2.id}, ${zurueck.assetIds[0]!}, 0, now())`;
            const erwartet = await schluesselVon([zurueck.assetIds[0]!]);
            expect(await aufbewahren()).toEqual(erwartet);
            expect(await assetsDa(haengt.assetIds)).toEqual(sortiert(...haengt.assetIds));
            expect(await assetsDa(zurueck.assetIds)).toEqual([zurueck.assetIds[1]!]);
            const [uebrig] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM media_gallery_item WHERE gallery_id = ${galerie2.id}`;
            expect(uebrig?.n).toBe(0);
        });

        it("ein Notaus am ersetzten Werk hält es (der Fremdschlüssel liefe sonst ins Leere)", async () => {
            const einzelner = await fall({
                state: "pending",
                tage: 3,
                ref: "ersetzt:notaus",
                assets: 2,
                eingangTage: 3,
            });
            const [original] = await database<{ sha256: string }[]>`
                SELECT sha256 FROM media_file WHERE media_asset_id = ${einzelner.assetIds[0]!} AND storage_class = 'private_source'`;
            await database`
                INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                VALUES (${original!.sha256}, ${einzelner.assetIds[0]!}, 'Test', '7e570000-0000-4000-8000-0000000000aa')`;
            expect(await aufbewahren()).toEqual([]);
            expect(await assetsDa(einzelner.assetIds)).toHaveLength(2);
        });

        it("bytegleiche Dateien eines anderen Werks bleiben: der Schlüssel kommt nur zurück, wenn ihn keine Zeile mehr hält", async () => {
            const einzelner = await fall({
                state: "pending",
                tage: 3,
                ref: "ersetzt:geteilt",
                assets: 2,
                eingangTage: 3,
            });
            const [gehoert] = await database<{ sha256: string; storage_key: string }[]>`
                SELECT sha256, storage_key FROM media_file WHERE media_asset_id = ${einzelner.assetIds[0]!} AND storage_class = 'published'`;
            const fremd = await insertAsset(database, { ref: "ersetzt:fremd", published: [] });
            await insertPublishedFile(database, fremd.id, "ersetzt:fremd", { variant: "coat", sha: gehoert!.sha256 });
            const erwartet = (await schluesselVon([einzelner.assetIds[0]!])).filter(
                (key) => key !== gehoert!.storage_key,
            );
            expect(erwartet).toHaveLength(2);
            expect(await aufbewahren()).toEqual(erwartet);
        });

        it("🔴 jede Tafel aus MEDIA_USAGE_TABLES wird auch beim Löschen ersetzter Bilder auf aktive Verwendung geprüft (zwei Stellen in der Funktion)", async () => {
            const [funktion] = await database<{ prosrc: string }[]>`
                SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'photobox_aufbewahren'`;
            for (const tafel of MEDIA_USAGE_TABLES) {
                const stelle = `FROM ${tafel} WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL`;
                expect(
                    funktion!.prosrc.split(stelle).length - 1,
                    `${tafel} fehlt in einem der beiden Löschschritte`,
                ).toBeGreaterThanOrEqual(2);
            }
        });
    });

    describe("die Funktion selbst", () => {
        it("SECURITY DEFINER mit festem search_path; PUBLIC darf sie nicht rufen", async () => {
            const [funktion] = await database<{ definer: boolean; config: string[] | null; public_darf: boolean }[]>`
                SELECT p.prosecdef AS definer, p.proconfig AS config,
                       has_function_privilege('public', p.oid, 'EXECUTE') AS public_darf
                  FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'photobox_aufbewahren'`;
            expect(funktion?.definer).toBe(true);
            expect(funktion?.config).toEqual(["search_path=public, pg_temp"]);
            expect(funktion?.public_darf).toBe(false);
        });

        it("🔴 jede Tafel aus MEDIA_USAGE_TABLES wird auf aktive Verwendung geprüft: eine neue Verwendungsart muss in die Funktion", async () => {
            const [funktion] = await database<{ prosrc: string }[]>`
                SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'photobox_aufbewahren'`;
            for (const tafel of MEDIA_USAGE_TABLES) {
                expect(funktion?.prosrc, `${tafel} fehlt in photobox_aufbewahren`).toContain(
                    `FROM ${tafel} WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL`,
                );
            }
        });

        it("ohne Einreichungen im Stand: leere Rückgabe, kein Fehler", async () => {
            expect(await aufbewahren()).toEqual([]);
        });
    });
});
