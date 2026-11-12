import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore } from "../src/media/storage.ts";
import { settleAssetFiles, type SettleCommit } from "../src/media-editor/settle.ts";
import { PUBLICATION_RULE_SEEDS, seedPublicationRules } from "../src/migration/media-rules.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { einreichung, neueSpuren, raeumeAuf } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Der Abgleich der Dateien (`media_settle`, `media-editor/settle.ts`) für ein ABGELEHNTES Asset (WI-0272 S2, Review I1): Ein Reisebild, das der Einreicher
 * zurückzog oder offline nahm, ist `rejected`. Der Abgleich rechnet dafür nichts: keine interne Vorschau (die Aufbewahrung löscht gerade alle Dateien, eine
 * neue Vorschau aus dem Original ließe sie wieder auferstehen), keine Veröffentlichung, kein Lesen des Originals; der technische Zustand bleibt. Er endet ohne
 * Fehler, der Auftrag schließt sich ab. Nur das Netz bleibt: Eine veröffentlichte Datei, die noch da ist, fällt weg (unter einem Notaus nicht, wie überall).
 */

const PHOTOBOX_REGELN = PUBLICATION_RULE_SEEDS.filter((seed) => seed.role === "photobox");

describeWithDatabase("Abgleich für abgelehnte Assets (WI-0272 S2, Review I1)", { timeout: 120_000 }, () => {
    let database: Database;
    let mediaRoot = "";
    let store: MediaStore;
    const spuren = neueSpuren();

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-media-settle-rejected-"));
        store = new MediaStore(mediaRoot);
    }, 120_000);

    afterEach(async () => {
        await raeumeAuf(database, spuren);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
    });

    afterAll(async () => {
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${PHOTOBOX_REGELN.map((regel) => regel.scopeText)})`;
        await raeumeAuf(database, spuren);
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    /** Ein eingereichtes Reisebild (Asset `pending`, Quelldatei, kein Abgleich bisher). */
    async function neuesBild(seed: number): Promise<{ id: string; publicId: string }> {
        const body = await einreichung(spuren, seed);
        const eingang = await einreichen(database, store, "test", body);
        const [asset] = await database<{ id: string; public_id: string }[]>`
            SELECT a.id::text AS id, a.public_id::text AS public_id
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${eingang.publicId}::uuid`;
        if (asset === undefined) throw new Error("Asset nicht angelegt");
        return { id: asset.id, publicId: asset.public_id };
    }
    const abgleich = (publicId: string, commit?: SettleCommit) =>
        settleAssetFiles(database, store, { assetPublicId: publicId, role: "photobox" }, commit);
    const ablehnen = (id: string) =>
        database`UPDATE media_asset SET moderation_state = 'rejected' WHERE id = ${id}::bigint`;
    const dateien = (id: string) =>
        database<{ id: string; storage_class: string; storage_key: string }[]>`
            SELECT id::text AS id, storage_class, storage_key FROM media_file WHERE media_asset_id = ${id}::bigint ORDER BY id`;
    const zustand = async (id: string): Promise<string | undefined> => {
        const [row] = await database<
            { technical_state: string }[]
        >`SELECT technical_state FROM media_asset WHERE id = ${id}::bigint`;
        return row?.technical_state;
    };
    const unterDerivate = async (): Promise<string[]> =>
        (await readdir(join(mediaRoot, "derivatives"), { recursive: true }).catch(() => [])).sort();

    it("Gegenprobe: ein Asset in Prüfung (pending) bekommt vom Abgleich seine interne Vorschau und den Zustand ok", async () => {
        const bild = await neuesBild(1);
        const ergebnis = await abgleich(bild.publicId);
        expect(ergebnis).toMatchObject({ technicalState: "ok", published: false, unchanged: false });
        expect((await dateien(bild.id)).map((datei) => datei.storage_class).sort()).toEqual([
            "derivative",
            "private_source",
        ]);
        expect(await zustand(bild.id)).toBe("ok");
    });

    it("🔴 ein abgelehntes Asset: keine Vorschau, keine Veröffentlichung, der technische Zustand bleibt, kein Fehler", async () => {
        const bild = await neuesBild(2);
        await ablehnen(bild.id);
        const vorher = await unterDerivate();
        const ergebnis = await abgleich(bild.publicId);
        expect(ergebnis).toMatchObject({
            asset: bild.publicId,
            role: "photobox",
            technicalState: "pending",
            published: false,
            unchanged: true,
            reasons: ["moderation_rejected"],
            findings: [],
        });
        // Nur das Original steht in der Tafel, nichts wurde gerechnet, nichts liegt neu im Speicher.
        expect((await dateien(bild.id)).map((datei) => datei.storage_class)).toEqual(["private_source"]);
        expect(await zustand(bild.id)).toBe("pending");
        expect(await unterDerivate()).toEqual(vorher);
    });

    it("🔴 offline nach der Vorschau: wurde die Vorschau gelöscht, rechnet der Abgleich keine neue aus dem Original (sie ließe die Dateien auferstehen)", async () => {
        const bild = await neuesBild(3);
        await abgleich(bild.publicId);
        const vorschau = (await dateien(bild.id)).filter((datei) => datei.storage_class === "derivative");
        expect(vorschau).toHaveLength(1);
        // So steht das Asset nach dem Lauf der Aufbewahrung: Vorschau weg, Original (noch) da; dann wird es abgelehnt.
        await database`DELETE FROM media_file WHERE id = ${vorschau[0]!.id}::bigint`;
        await ablehnen(bild.id);
        const ergebnis = await abgleich(bild.publicId);
        expect(ergebnis).toMatchObject({ published: false, unchanged: true });
        expect((await dateien(bild.id)).map((datei) => datei.storage_class)).toEqual(["private_source"]);
        // Die Gegenprobe zum Vorher: für ein Asset in Prüfung wäre dieselbe Lage ein Fall für eine neue Vorschau.
        await database`UPDATE media_asset SET moderation_state = 'pending' WHERE id = ${bild.id}::bigint`;
        await abgleich(bild.publicId);
        expect((await dateien(bild.id)).map((datei) => datei.storage_class).sort()).toEqual([
            "derivative",
            "private_source",
        ]);
    });

    it("das Original muss nicht einmal mehr da sein: ein abgelehntes Asset wird nie missing_file", async () => {
        const bild = await neuesBild(4);
        await abgleich(bild.publicId);
        await database`DELETE FROM media_file WHERE media_asset_id = ${bild.id}::bigint`;
        await ablehnen(bild.id);
        const ergebnis = await abgleich(bild.publicId);
        expect(ergebnis).toMatchObject({ technicalState: "ok", findings: [], unchanged: true });
        expect(await zustand(bild.id)).toBe("ok");
    });

    it("🔴 der Auftrag schließt sich ab: der Abgleich ruft den Abschluss auch dann (sonst bliebe der Job liegen)", async () => {
        const bild = await neuesBild(5);
        await ablehnen(bild.id);
        let abschluesse = 0;
        const zaehlt: SettleCommit = async (_schreiben, ergebnis) => {
            abschluesse += 1;
            expect(ergebnis.unchanged).toBe(true);
            return "ok";
        };
        await abgleich(bild.publicId, zaehlt);
        expect(abschluesse).toBe(1);
    });

    it("das Netz bleibt: eine veröffentlichte Datei eines abgelehnten Assets fällt weg, samt Zeile; sonst wird nichts angelegt", async () => {
        const bild = await neuesBild(6);
        const fassung = await store.store("published", Buffer.from("veroeffentlichte-fassung-settle-6"), "webp");
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                    derivative_recipe, recipe_version)
            VALUES (${bild.id}::bigint, 'photobox_2048', 'published', ${fassung.key}, 'image/webp', 64, 48, ${fassung.byteSize},
                    ${fassung.sha256}, 'photobox_2048-recipe', '1')`;
        expect(await store.exists(fassung.key)).toBe(true);
        await ablehnen(bild.id);
        const ergebnis = await abgleich(bild.publicId);
        expect(ergebnis).toMatchObject({ published: false, unchanged: false, reasons: ["moderation_rejected"] });
        expect(await store.exists(fassung.key)).toBe(false);
        expect((await dateien(bild.id)).map((datei) => datei.storage_class)).toEqual(["private_source"]);
        // Ein zweiter Lauf findet nichts mehr.
        expect(await abgleich(bild.publicId)).toMatchObject({ unchanged: true });
    });

    it("eine Datei, die ein anderes Werk mitträgt, bleibt liegen (bytegleiche Werke teilen sich ihre Datei)", async () => {
        const bild = await neuesBild(7);
        const fremd = await neuesBild(8);
        const fassung = await store.store("published", Buffer.from("geteilte-fassung-settle-7"), "webp");
        for (const id of [bild.id, fremd.id]) {
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                        derivative_recipe, recipe_version)
                VALUES (${id}::bigint, 'photobox_2048', 'published', ${fassung.key}, 'image/webp', 64, 48, ${fassung.byteSize},
                        ${fassung.sha256}, 'photobox_2048-recipe', '1')`;
        }
        await ablehnen(bild.id);
        await abgleich(bild.publicId);
        expect(await store.exists(fassung.key)).toBe(true);
        expect((await dateien(bild.id)).map((datei) => datei.storage_class)).toEqual(["private_source"]);
        expect((await dateien(fremd.id)).map((datei) => datei.storage_class).sort()).toEqual([
            "private_source",
            "published",
        ]);
    });

    describe("🔴 Offline zwischen Entscheidung und Abschluss (WI-0272 S3, Fixrunde G, Review M4)", () => {
        /** Freigegeben wie nach `freigeben` (Medium und Einreichung, Verwendung), mit der Freigaberegel der Rolle: der Abgleich würde veröffentlichen. */
        async function freigegeben(seed: number): Promise<{ id: string; publicId: string }> {
            const bild = await neuesBild(seed);
            await abgleich(bild.publicId);
            const [einreichung] = await database<{ id: string }[]>`
                SELECT i.submission_id::text AS id FROM media_ingest i WHERE i.media_asset_id = ${bild.id}::bigint`;
            await database`UPDATE media_asset SET moderation_state = 'approved' WHERE id = ${bild.id}::bigint`;
            await database`
                UPDATE media_submission SET state = 'approved', decided_at = now(), approved_media_asset_id = ${bild.id}::bigint
                 WHERE id = ${einreichung!.id}::bigint`;
            await database`INSERT INTO photobox_media (media_submission_id, media_asset_id) VALUES (${einreichung!.id}::bigint, ${bild.id}::bigint)`;
            return bild;
        }
        const veroeffentlichte = async (id: string): Promise<string[]> =>
            (await dateien(id))
                .filter((datei) => datei.storage_class === "published")
                .map((datei) => datei.storage_key);

        it("Gegenprobe: ohne Offline veröffentlicht der Abgleich mit der Regel", async () => {
            await seedPublicationRules(database, PHOTOBOX_REGELN);
            const bild = await freigegeben(20);
            const ergebnis = await abgleich(bild.publicId);
            expect(ergebnis).toMatchObject({ published: true, reasons: [] });
            // Zwei öffentliche Dateien: die Hauptfassung und die Kachel (WI-0272 S4, Aufgabe 22).
            expect(await veroeffentlichte(bild.id)).toHaveLength(2);
        });

        it("🔴 wird das Medium zwischen Entscheidung und Abschluss abgelehnt (Offline), legt der Abschluss nichts an; eine schon veröffentlichte Zeile fällt samt Datei", async () => {
            await seedPublicationRules(database, PHOTOBOX_REGELN);
            const bild = await freigegeben(21);
            const vorher = await abgleich(bild.publicId);
            expect(vorher.published).toBe(true);
            const alt = await veroeffentlichte(bild.id);
            expect(alt).toHaveLength(2);

            // Die Fassung ändert sich (neuer Rezeptstand), damit der Abgleich neu veröffentlichen WILL: Die alte Zeile verschwindet, eine neue käme.
            await database`UPDATE media_file SET recipe_version = 'alt' WHERE media_asset_id = ${bild.id}::bigint AND storage_class = 'published'`;
            let abgelehntVorAbschluss = false;
            const offlineDazwischen: SettleCommit = async (schreiben) => {
                // Zwischen der Entscheidung (approved, veröffentlichen) und dem Festschreiben nimmt der Einsender das Bild offline.
                await database`UPDATE media_asset SET moderation_state = 'rejected' WHERE id = ${bild.id}::bigint`;
                abgelehntVorAbschluss = true;
                await database.begin((tx) => schreiben(tx));
                return "ok";
            };
            await abgleich(bild.publicId, offlineDazwischen);
            expect(abgelehntVorAbschluss).toBe(true);

            expect(await veroeffentlichte(bild.id)).toEqual([]);
            // Keine Datei der Fassung liegt übrig (weder die alte noch eine frisch gerechnete), und keine neue interne Vorschau entstand.
            for (const key of alt) expect(await store.exists(key), key).toBe(false);
            expect((await dateien(bild.id)).map((datei) => datei.storage_class)).toEqual(["private_source"]);
        });
    });
});
