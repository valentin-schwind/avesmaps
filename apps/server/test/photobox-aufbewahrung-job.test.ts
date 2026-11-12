import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JOB_KIND_CATALOG } from "../src/jobs/kinds.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { PHOTOBOX_RETENTION_KIND, veroeffentlichterHash, type PhotoboxAblage } from "../src/photobox/aufbewahrung.ts";
import { MediaStore, quarantineKey, storageKey } from "../src/media/storage.ts";
import { cleanMediaFixtures, insertAsset, insertGallery } from "./support/media-fixture.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/**
 * Die Aufbewahrung der Reisebilder als aufgezeichneter Job `photobox_aufbewahrung` (WI-0272 S2, Aufgabe 11; wie `community-aufbewahrung.test.ts`):
 * Die Pflege ruft `photobox_aufbewahren(now())` einmal je Abstand, löscht danach genau die Dateien, die die Funktion nennt und die keine Zeile mehr
 * hält, und meldet das Ergebnis an die Tafel der Aufträge. Die Fristen und was stehen bleibt prüft `photobox-aufbewahrung-db.test.ts`.
 *
 * Die Datenbank liefert hier den echten Weg (echte Einreichungen, echte Dateien in einem echten `MediaStore`); wo ein Fehler gebraucht wird, den PostgreSQL
 * nicht von selbst macht (ein Recht, das fehlt, ein Upload zwischen Funktion und Dateien), steht ein Haken um die Verbindung.
 */
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describe("veroeffentlichterHash", () => {
    it("liest den Hash aus dem Schlüssel einer veröffentlichten Datei, aus nichts sonst", () => {
        const hash = createHash("sha256").update("x").digest("hex");
        expect(veroeffentlichterHash(storageKey("published", hash, "webp"))).toBe(hash);
        expect(veroeffentlichterHash(storageKey("private_source", hash, "jpg"))).toBeUndefined();
        expect(veroeffentlichterHash(storageKey("derivative", hash, "webp"))).toBeUndefined();
        expect(veroeffentlichterHash(quarantineKey(hash))).toBeUndefined();
        expect(
            veroeffentlichterHash(`published/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/kurz.webp`),
        ).toBeUndefined();
        expect(veroeffentlichterHash(`../${storageKey("published", hash, "webp")}`)).toBeUndefined();
    });

    it("die Art steht im Katalog der Aufträge: aufgezeichnet, ohne Sperre der Kartendomäne", () => {
        expect(JOB_KIND_CATALOG[PHOTOBOX_RETENTION_KIND]).toMatchObject({
            kind: "photobox_aufbewahrung",
            origin: "recorded",
            holdsSharedDomainLock: false,
            threads: 0,
        });
    });
});

const MARK = "photobox-aufbewahrung-job-test";
const TAG_MS = 24 * 60 * 60 * 1000;

/** Was ein Haken um die Verbindung tut (nur der Aufruf von `photobox_aufbewahren` und seine Bereitschaft werden berührt). */
interface Haken {
    /** Die Bereitschaftsprüfung (`to_regprocedure`) sagt „Funktion fehlt“. */
    funktionFehlt?: boolean;
    /** Der Aufruf der Funktion scheitert mit diesem Fehler, bevor die Datenbank etwas tut. */
    aufrufScheitert?: Error;
    /** Läuft NACH der Funktion (sie hat festgeschrieben) und vor den Dateien: ein Upload, der einen Schlüssel wieder hält. */
    nachFunktion?: (schluessel: string[]) => Promise<void>;
}

function mitHaken(database: Database, haken: Haken): Database {
    return new Proxy(database, {
        apply(target, thisArg, args: unknown[]) {
            const strings = args[0];
            const text = Array.isArray(strings) ? (strings as string[]).join("?") : "";
            const echt = (): Promise<unknown> => Reflect.apply(target, thisArg, args) as Promise<unknown>;
            if (text.includes("to_regprocedure") && text.includes("photobox_aufbewahren")) {
                return haken.funktionFehlt === true ? Promise.resolve([{ ok: false }]) : echt();
            }
            if (text.includes("photobox_aufbewahren(now())")) {
                if (haken.aufrufScheitert !== undefined) return Promise.reject(haken.aufrufScheitert);
                const nachher = haken.nachFunktion;
                if (nachher === undefined) return echt();
                return echt().then(async (zeilen) => {
                    await nachher((zeilen as { storage_key: string }[]).map((zeile) => zeile.storage_key));
                    return zeilen;
                });
            }
            return echt();
        },
        get(target, property) {
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
    });
}

/** Eine Ablage, die aufschreibt, was sie löschen soll, und nur dann wirklich löscht, wenn der Fehler nichts anderes sagt. */
function aufzeichnendeAblage(
    store: MediaStore,
    fehler: (key: string) => Error | undefined = () => undefined,
): PhotoboxAblage & { geloescht: string[]; quarantaene: string[] } {
    const geloescht: string[] = [];
    const quarantaene: string[] = [];
    return {
        geloescht,
        quarantaene,
        async removeAfterDelete(key) {
            geloescht.push(key);
            const problem = fehler(key);
            if (problem !== undefined) throw problem;
            return store.removeAfterDelete(key);
        },
        async removeQuarantined(sha256) {
            quarantaene.push(sha256);
            return store.removeQuarantined(sha256);
        },
    };
}

describeWithDatabase("Reisebilder: Aufbewahrung als Job", { timeout: 120_000 }, () => {
    let database: Database;
    let store: MediaStore;
    let mediaRoot = "";
    let sequence = 0;
    const release = `photobox-aufbewahrung-job-${randomUUID()}`;

    const vor = (tage: number): string => new Date(Date.now() - tage * TAG_MS).toISOString();

    function arbeiter(
        db: Database,
        optionen: { abstandMs?: number | undefined; ablage?: PhotoboxAblage | undefined; release?: string } = {},
    ): JobWorker {
        return new JobWorker({
            database: db,
            config: testJobsConfig(),
            mapDomainId: "aventuria",
            release: optionen.release ?? release,
            deriveScope: uniqueScope("derive"),
            spawnChild: fakeSpawner().spawn,
            memory: fakeMemory().probe,
            ...(optionen.abstandMs === undefined ? {} : { photoboxRetentionEveryMs: optionen.abstandMs }),
            ...(optionen.ablage === undefined ? {} : { photoboxAblage: optionen.ablage }),
        });
    }

    async function raeumeAuf(): Promise<void> {
        await database`DELETE FROM media_ingest WHERE submission_id IN (SELECT id FROM media_submission WHERE terms_version = ${MARK})`;
        await database`DELETE FROM media_submission WHERE terms_version = ${MARK}`;
        await cleanMediaFixtures(database);
        await database`DELETE FROM job WHERE kind = ${PHOTOBOX_RETENTION_KIND}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await seedMapDomains(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-aufbewahrung-"));
        store = new MediaStore(mediaRoot);
    }, 120_000);

    beforeEach(raeumeAuf);
    afterEach(raeumeAuf);

    afterAll(async () => {
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    interface Fall {
        submissionId: string;
        assetId: string;
        original: string;
        veroeffentlicht: string;
        beleg: string;
        /** Der Hash der veröffentlichten Datei und der Schlüssel ihrer Kopie in der Quarantäne. */
        hash: string;
        quarantaene: string;
    }

    /**
     * Eine Einreichung im Zustand `state`, deren letzter Wechsel `tage` Tage her ist, mit einem Medium: Original, veröffentlichte Fassung samt Kopie in
     * der Quarantäne und Beleg, alles als echte Dateien im Speicher und als Zeilen in der Datenbank.
     */
    async function fall(spec: { state: string; tage: number }): Promise<Fall> {
        sequence += 1;
        const ref = `photobox-job:${String(sequence)}`;
        const asset = await insertAsset(database, { ref, published: [] });
        const original = await store.store("private_source", Buffer.from(`${ref}/original`), "jpg");
        const veroeffentlicht = await store.store("published", Buffer.from(`${ref}/veroeffentlicht`), "webp");
        const beleg = await store.storeEvidence(Buffer.from(`${ref}/beleg`), "pdf");
        const quarantaene = quarantineKey(veroeffentlicht.sha256);
        await mkdir(dirname(store.pathFor(quarantaene)), { recursive: true });
        await writeFile(store.pathFor(quarantaene), Buffer.from(`${ref}/veroeffentlicht`));
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, byte_size, sha256)
            VALUES (${asset.id}, 'source', 'private_source', ${original.key}, 'image/jpeg', ${original.byteSize}, ${original.sha256})`;
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                    derivative_recipe, recipe_version)
            VALUES (${asset.id}, 'photobox', 'published', ${veroeffentlicht.key}, 'image/webp', 64, 48, ${veroeffentlicht.byteSize},
                    ${veroeffentlicht.sha256}, 'photobox-recipe', '1')`;
        await database`
            INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, storage_key, sha256)
            VALUES (${asset.id}, 'pdf', ${beleg.key}, ${beleg.sha256})`;
        const freigegeben = spec.state === "approved" || spec.state === "offline" ? asset.id : null;
        const [row] = await database<{ id: string }[]>`
            INSERT INTO media_submission (status_key_hash, map_domain_id, geom, creation_kind, usage_grant, description, terms_version,
                                          state, approved_media_asset_id, submitted_at, state_changed_at)
            VALUES (${createHash("sha256").update(`${MARK}/${ref}`).digest()}, 'aventuria', 'SRID=0;POINT(300 300)', 'photo', 'avesmaps_only',
                    'Der Blick vom Hafen', ${MARK}, ${spec.state}, ${freigegeben}, ${vor(spec.tage)}, ${vor(spec.tage)})
            RETURNING id`;
        if (row === undefined) throw new Error("Einreichung nicht angelegt");
        await database`INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id) VALUES (${asset.id}, 'community_upload', ${row.id})`;
        return {
            submissionId: row.id,
            assetId: asset.id,
            original: original.key,
            veroeffentlicht: veroeffentlicht.key,
            beleg: beleg.key,
            hash: veroeffentlicht.sha256,
            quarantaene,
        };
    }

    const schluesselDes = (einzelner: Fall): string[] => [
        einzelner.original,
        einzelner.veroeffentlicht,
        einzelner.beleg,
    ];
    const dateienDa = async (einzelner: Fall): Promise<boolean[]> => [
        ...(await Promise.all(schluesselDes(einzelner).map((key) => store.exists(key)))),
        await store.exists(einzelner.quarantaene),
    ];
    const einreichungDa = async (einzelner: Fall): Promise<boolean> => {
        const [row] = await database<{ da: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM media_submission WHERE id = ${einzelner.submissionId}) AS da`;
        return row?.da === true;
    };
    const laeufeVon = (forRelease: string = release) =>
        database<
            {
                state: string;
                origin: string;
                result: Record<string, number> | null;
                error_code: string | null;
                error_summary: string | null;
            }[]
        >`SELECT state, origin, result, error_code, error_summary FROM job
           WHERE kind = ${PHOTOBOX_RETENTION_KIND} AND release = ${forRelease} ORDER BY id`;

    it("🔴 der Lauf ruft die Funktion, löscht genau die gelieferten Dateien samt Kopie in der Quarantäne und meldet ok mit Zahlen", async () => {
        const weg = await fall({ state: "withdrawn", tage: 31 });
        const jung = await fall({ state: "withdrawn", tage: 5 });
        const freigegeben = await fall({ state: "approved", tage: 90 });
        const verwendet = await fall({ state: "offline", tage: 45 });
        const galerie = await insertGallery(database, "photobox-job:verwendet");
        await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galerie.id}, ${verwendet.assetId}, 0)`;
        expect(await dateienDa(weg)).toEqual([true, true, true, true]);

        const ablage = aufzeichnendeAblage(store);
        expect(await arbeiter(database, { abstandMs: 3_600_000, ablage }).pflege()).toMatchObject({
            photoboxRetention: true,
        });

        // Die Zeilen sind weg, die Dateien auch: Original, öffentliche Fassung, Beleg und die Kopie in der Quarantäne.
        expect(await einreichungDa(weg)).toBe(false);
        expect(await dateienDa(weg)).toEqual([false, false, false, false]);
        // Alles andere bleibt, Zeile wie Datei: zu jung, freigegeben, und das Bild, das irgendwo hängt.
        for (const bleibt of [jung, freigegeben, verwendet]) {
            expect(await einreichungDa(bleibt)).toBe(true);
            expect(await dateienDa(bleibt)).toEqual([true, true, true, true]);
        }
        // Genau die gelieferten Schlüssel wurden angefasst, kein anderer.
        expect(ablage.geloescht).toEqual(expect.arrayContaining(schluesselDes(weg)));
        for (const bleibt of [jung, freigegeben, verwendet]) {
            for (const key of schluesselDes(bleibt)) expect(ablage.geloescht).not.toContain(key);
            expect(ablage.quarantaene).not.toContain(bleibt.hash);
        }
        expect(ablage.quarantaene).toContain(weg.hash);

        const laeufe = await laeufeVon();
        expect(laeufe).toHaveLength(1);
        expect(laeufe[0]).toMatchObject({
            state: "SUCCEEDED",
            origin: "recorded",
            error_code: null,
            error_summary: null,
        });
        expect(Object.keys(laeufe[0]!.result ?? {}).sort()).toEqual([
            "dateien",
            "fehlgeschlagen",
            "gehalten",
            "schluessel",
        ]);
        expect(laeufe[0]!.result).toMatchObject({ gehalten: 0, fehlgeschlagen: 0 });
        expect(laeufe[0]!.result!["schluessel"]).toBeGreaterThanOrEqual(3);
        expect(laeufe[0]!.result!["dateien"]).toBeGreaterThanOrEqual(3);
    });

    it("🔴 offline seit einem Tag: der nächste Lauf löscht Original, öffentliche Fassung und Kopie in der Quarantäne; Beleg und Einreichung bleiben bis zu den 30 Tagen (Review I1)", async () => {
        const offline = await fall({ state: "offline", tage: 1 });
        const abgelehnt = await fall({ state: "rejected", tage: 1 });
        expect(await dateienDa(offline)).toEqual([true, true, true, true]);

        const ablage = aufzeichnendeAblage(store);
        await arbeiter(database, { abstandMs: 3_600_000, ablage }).pflege();

        // Original (mit EXIF und GPS), veröffentlichte Fassung und ihre Kopie in der Quarantäne sind weg; der Beleg ist keine Bilddatei der Besucher.
        expect(await dateienDa(offline)).toEqual([false, false, true, false]);
        expect(await einreichungDa(offline)).toBe(true);
        expect(ablage.geloescht).toEqual(expect.arrayContaining([offline.original, offline.veroeffentlicht]));
        expect(ablage.geloescht).not.toContain(offline.beleg);
        expect(ablage.quarantaene).toContain(offline.hash);
        // Eine abgelehnte Einreichung behält ihre Dateien bis zu den 30 Tagen.
        expect(await dateienDa(abgelehnt)).toEqual([true, true, true, true]);
        expect(await einreichungDa(abgelehnt)).toBe(true);
    });

    it("🔴 einmal je Abstand mit Ergebnis in der Tafel; ohne Abstand gar nicht", async () => {
        const ablage = aufzeichnendeAblage(store);
        expect(await arbeiter(database, { abstandMs: 3_600_000, ablage }).pflege()).toMatchObject({
            photoboxRetention: true,
        });
        // Ein zweiter Ausführer (ein neuer Prozess, nichts im Speicher) liest den letzten Lauf aus der Tafel: noch nicht fällig.
        expect(await arbeiter(database, { abstandMs: 3_600_000, ablage }).pflege()).toMatchObject({
            photoboxRetention: false,
        });
        expect(await laeufeVon()).toHaveLength(1);

        const still = `${release}-ohne`;
        await database`DELETE FROM job WHERE kind = ${PHOTOBOX_RETENTION_KIND}`;
        expect(await arbeiter(database, { ablage, release: still }).pflege()).toMatchObject({
            photoboxRetention: false,
        });
        expect(await database`SELECT 1 FROM job WHERE release = ${still}`).toHaveLength(0);
    });

    it("🔴 eine Datei, die eine Zeile inzwischen wieder nennt (Upload zwischen Funktion und Dateien), bleibt liegen; alles andere fällt", async () => {
        const weg = await fall({ state: "withdrawn", tage: 31 });
        const ablage = aufzeichnendeAblage(store);
        const haken = mitHaken(database, {
            nachFunktion: async (schluessel) => {
                // Die Funktion hat festgeschrieben und die Schlüssel genannt; ein bytegleicher Upload eines anderen Werks hält die öffentliche Datei wieder.
                expect(schluessel).toContain(weg.veroeffentlicht);
                const anderes = await insertAsset(database, { ref: "photobox-job:upload-dazwischen", published: [] });
                await database`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                            derivative_recipe, recipe_version)
                    VALUES (${anderes.id}, 'photobox', 'published', ${weg.veroeffentlicht}, 'image/webp', 64, 48, 99, ${weg.hash}, 'photobox-recipe', '1')`;
            },
        });
        expect(await arbeiter(haken, { abstandMs: 3_600_000, ablage }).pflege()).toMatchObject({
            photoboxRetention: true,
        });

        expect(await store.exists(weg.veroeffentlicht)).toBe(true);
        // Auch die Kopie in der Quarantäne gehört zu dieser Datei und bleibt.
        expect(await store.exists(weg.quarantaene)).toBe(true);
        expect(ablage.geloescht).not.toContain(weg.veroeffentlicht);
        expect(await store.exists(weg.original)).toBe(false);
        expect(await store.exists(weg.beleg)).toBe(false);
        const [lauf] = await laeufeVon();
        expect(lauf).toMatchObject({ state: "SUCCEEDED" });
        expect(lauf!.result).toMatchObject({ gehalten: 1, fehlgeschlagen: 0 });
    });

    it("🔴 ein Löschfehler bricht den Lauf nicht ab: die übrigen Dateien fallen, der Fehler steht in der Zusammenfassung des Laufs", async () => {
        const weg = await fall({ state: "expired", tage: 40 });
        const ablage = aufzeichnendeAblage(store, (key) =>
            key === weg.original
                ? Object.assign(new Error("EPERM: operation not permitted, unlink 'x'"), { code: "EPERM" })
                : undefined,
        );
        // Kein Absturz: Die Pflege kehrt zurück und meldet, dass sie lief.
        expect(await arbeiter(database, { abstandMs: 3_600_000, ablage }).pflege()).toMatchObject({
            photoboxRetention: true,
        });

        expect(await store.exists(weg.original)).toBe(true);
        expect(await store.exists(weg.veroeffentlicht)).toBe(false);
        expect(await store.exists(weg.beleg)).toBe(false);
        expect(await store.exists(weg.quarantaene)).toBe(false);
        // Die Zeilen sind gelöscht (die Funktion hat festgeschrieben); nur die eine Datei blieb liegen.
        expect(await einreichungDa(weg)).toBe(false);

        const [lauf] = await laeufeVon();
        expect(lauf).toMatchObject({
            state: "FAILED",
            origin: "recorded",
            error_code: "photobox_retention_files_failed",
        });
        expect(lauf!.error_summary).toMatch(/^1 von \d+ Dateien nicht gelöscht \(EPERM\)$/);
        // Keine Meldung des Dateisystems (sie nennt Pfade) in der Zusammenfassung.
        expect(lauf!.error_summary).not.toContain("unlink");
        expect(lauf!.result).toMatchObject({ fehlgeschlagen: 1, gehalten: 0 });
        expect(lauf!.result!["dateien"]).toBeGreaterThanOrEqual(2);
    });

    it("🔴 scheitert die Funktion (Recht der Jobs-Rolle fehlt): errorCode statt Absturz, keine Datei fällt, nichts ist gelöscht", async () => {
        const weg = await fall({ state: "withdrawn", tage: 31 });
        const ablage = aufzeichnendeAblage(store);
        const haken = mitHaken(database, {
            aufrufScheitert: Object.assign(new Error("permission denied for function photobox_aufbewahren"), {
                code: "42501",
            }),
        });
        expect(await arbeiter(haken, { abstandMs: 3_600_000, ablage }).pflege()).toMatchObject({
            photoboxRetention: true,
        });

        expect(ablage.geloescht).toEqual([]);
        expect(await dateienDa(weg)).toEqual([true, true, true, true]);
        expect(await einreichungDa(weg)).toBe(true);
        const laeufe = await laeufeVon();
        expect(laeufe).toHaveLength(1);
        expect(laeufe[0]).toMatchObject({
            state: "FAILED",
            origin: "recorded",
            error_code: "photobox_retention_failed",
            error_summary: "SQLSTATE 42501",
        });
        // Ein Fehler ohne SQLSTATE ist trotzdem ein Eintrag, kein Absturz.
        await database`DELETE FROM job WHERE kind = ${PHOTOBOX_RETENTION_KIND}`;
        const ohneCode = mitHaken(database, { aufrufScheitert: new Error("Verbindung weg") });
        await expect(arbeiter(ohneCode, { abstandMs: 3_600_000, ablage }).pflege()).resolves.toMatchObject({
            photoboxRetention: true,
        });
        expect((await laeufeVon())[0]).toMatchObject({
            error_code: "photobox_retention_failed",
            error_summary: "SQLSTATE unbekannt",
        });
    });

    it("fehlt die Funktion (vor Migration 0284), gibt es nichts zu tun: kein Lauf, keine Zeile in der Tafel", async () => {
        const weg = await fall({ state: "withdrawn", tage: 31 });
        const ablage = aufzeichnendeAblage(store);
        const haken = mitHaken(database, { funktionFehlt: true });
        expect(await arbeiter(haken, { abstandMs: 3_600_000, ablage }).pflege()).toMatchObject({
            photoboxRetention: false,
        });
        expect(await laeufeVon()).toHaveLength(0);
        expect(await einreichungDa(weg)).toBe(true);
        expect(ablage.geloescht).toEqual([]);
    });

    it("🔴 ohne Ablage (MEDIA_ROOT fehlt) rührt der Lauf nichts an und steht rot da: die Funktion nennt ihre Schlüssel nur dieses eine Mal", async () => {
        const weg = await fall({ state: "withdrawn", tage: 31 });
        expect(await arbeiter(database, { abstandMs: 3_600_000 }).pflege()).toMatchObject({ photoboxRetention: true });

        expect(await einreichungDa(weg)).toBe(true);
        expect(await dateienDa(weg)).toEqual([true, true, true, true]);
        const laeufe = await laeufeVon();
        expect(laeufe).toHaveLength(1);
        expect(laeufe[0]).toMatchObject({
            state: "FAILED",
            origin: "recorded",
            error_code: "photobox_retention_no_store",
        });
    });
});
