import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    COMMUNITY_RETENTION_KIND,
    communityAufbewahrung,
    communityAufbewahrungBereit,
} from "../src/community/aufbewahrung.ts";
import { abschliessen, melden, revision, rueckfrage, sichten, uebernehmen } from "../src/community/db.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/**
 * Die Aufbewahrung der Community als aufgezeichneter Job `community_aufbewahrung` (WI-0268; wie `auth-retention.test.ts` für die Anmeldedaten):
 * Die Pflege ruft `community_purge_expired()` einmal je Abstand, das Ergebnis steht in der Tafel der Aufträge. Die Fristen selbst (Archiv nach 30 Tagen,
 * Kontaktdaten nach 90, Papierkorb nach 30) prüft `community-datenmodell.test.ts`. Mit der Umgebung der Glocke prüft derselbe Lauf auch die Fristen der
 * Rückfragen (WI-0268 C5): Die Zahlen stehen im Ergebnis des aufgezeichneten Jobs; die Meldungen selbst prüft `community-glocke.test.ts`.
 */
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function pflegeWorker(
    database: Database,
    release: string,
    communityRetentionEveryMs?: number,
    glockenUmgebung?: "test",
): JobWorker {
    return new JobWorker({
        database,
        config: testJobsConfig(),
        mapDomainId: "aventuria",
        release,
        deriveScope: uniqueScope("derive"),
        spawnChild: fakeSpawner().spawn,
        memory: fakeMemory().probe,
        ...(communityRetentionEveryMs === undefined ? {} : { communityRetentionEveryMs }),
        ...(glockenUmgebung === undefined ? {} : { glockenUmgebung }),
    });
}

describeWithDatabase("Community: Aufbewahrung als Job", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let lena: string;
    const release = `community-aufbewahrung-${randomUUID()}`;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        lena = (await fixture.person("reviewer", { name: "Lena" })).id;
    });

    beforeEach(async () => {
        await database`DELETE FROM avesmaps_community.vorgang`;
    });

    afterAll(async () => {
        await database`DELETE FROM job WHERE release = ${release}`.catch(() => undefined);
        await database`DELETE FROM avesmaps_community.vorgang`.catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const jobs = (forRelease: string) =>
        database<
            { state: string; origin: string; result: Record<string, number> | null; error_code: string | null }[]
        >`SELECT state, origin, result, error_code FROM job WHERE kind = ${COMMUNITY_RETENTION_KIND} AND release = ${forRelease} ORDER BY id`;

    it("die Funktion ist da, und ein erledigter Vorgang nach 31 Tagen wandert ins Archiv (Zähler im Ergebnis)", async () => {
        expect(await communityAufbewahrungBereit(database)).toBe(true);
        const id = await melden(database, {
            operationId: randomUUID(),
            schluessel: randomBytes(32).toString("base64url"),
            kategorie: "lage",
            text: "Wehrheim liegt zu weit im Westen, laut Regionalband näher an der Reichsstraße.",
            bezug: { art: "stelle", lage: { x: 500, y: 400 } },
        });
        await sichten(database, { id, person: lena, revision: (await revision(database, id))! });
        await abschliessen(database, {
            id,
            person: lena,
            revision: (await revision(database, id))!,
            ergebnis: "bereits_richtig",
            begruendung: "Die Lage stimmt.",
        });
        await database`UPDATE avesmaps_community.vorgang SET abgeschlossen_at = now() - interval '31 days' WHERE id = ${id}`;
        expect(await communityAufbewahrung(database)).toEqual({ archiviert: 1, kontakt: 0, geloescht: 0 });
        // Ein zweiter Lauf findet nichts mehr.
        expect(await communityAufbewahrung(database)).toEqual({ archiviert: 0, kontakt: 0, geloescht: 0 });
    });

    it("🔴 die Pflege ruft sie als aufgezeichneten Job: einmal je Abstand, mit Ergebnis auf der Statusseite; ohne Abstand gar nicht", async () => {
        await database`DELETE FROM job WHERE kind = ${COMMUNITY_RETENTION_KIND}`;
        expect(await pflegeWorker(database, release, 3_600_000).pflege()).toMatchObject({ communityRetention: true });
        // Ein zweiter Ausführer (ein neuer Prozess, nichts im Speicher) liest den letzten Lauf aus der Tafel: noch nicht fällig.
        expect(await pflegeWorker(database, release, 3_600_000).pflege()).toMatchObject({ communityRetention: false });
        const laeufe = await jobs(release);
        expect(laeufe).toHaveLength(1);
        expect(laeufe[0]).toMatchObject({ state: "SUCCEEDED", origin: "recorded", error_code: null });
        expect(Object.keys(laeufe[0]!.result ?? {}).sort()).toEqual([
            "archiviert",
            "beitraegeGeloescht",
            "beitraegeVerfallen",
            "geloescht",
            "kontakt",
        ]);

        const quiet = `${release}-ohne`;
        await database`DELETE FROM job WHERE kind = ${COMMUNITY_RETENTION_KIND}`;
        expect(await pflegeWorker(database, quiet).pflege()).toMatchObject({ communityRetention: false });
        expect(await database`SELECT 1 FROM job WHERE release = ${quiet}`).toHaveLength(0);
    });

    it("🔴 mit der Umgebung der Glocke prüft der Lauf auch die Fristen der Rückfragen und meldet sie einmal; die Zahlen stehen im Ergebnis", async () => {
        const mitGlocke = `${release}-glocke`;
        await database`DELETE FROM job WHERE kind = ${COMMUNITY_RETENTION_KIND}`;
        const id = await melden(database, {
            operationId: randomUUID(),
            schluessel: randomBytes(32).toString("base64url"),
            kategorie: "lage",
            text: "Wehrheim liegt zu weit im Westen, laut Regionalband näher an der Reichsstraße.",
            bezug: { art: "stelle", lage: { x: 500, y: 400 } },
        });
        await uebernehmen(database, { id, person: lena, revision: (await revision(database, id))! });
        await rueckfrage(database, {
            id,
            person: lena,
            revision: (await revision(database, id))!,
            text: "Welche Seite genau?",
        });
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ${lena}::uuid`;
        await database`UPDATE avesmaps_community.vorgang SET rueckfrage_at = now() - interval '35 days' WHERE id = ${id}::bigint`;

        expect(await pflegeWorker(database, mitGlocke, 3_600_000, "test").pflege()).toMatchObject({
            communityRetention: true,
        });
        const laeufe = await jobs(mitGlocke);
        expect(laeufe).toHaveLength(1);
        expect(laeufe[0]).toMatchObject({ state: "SUCCEEDED", error_code: null });
        // Dazu die Zahlen der Beiträge des Social Hubs (WI-0270): Frischeprüfung und Papierkorb, die Vorschläge der Routine in der Glocke.
        expect(Object.keys(laeufe[0]!.result ?? {}).sort()).toEqual([
            "archiviert",
            "beitraegeGeloescht",
            "beitraegeVerfallen",
            "faellig",
            "geloescht",
            "gemeldet",
            "kontakt",
            "vorschlaege",
            "vorschlaegeGemeldet",
        ]);
        expect(laeufe[0]!.result).toMatchObject({ faellig: 1 });
        const gemeldet = await database<{ text: string }[]>`
            SELECT text FROM public.benachrichtigung WHERE an_person = ${lena}::uuid AND art = 'community_frist'
        `;
        expect(gemeldet.map((zeile) => zeile.text)).toEqual([`COM-${String(id).padStart(6, "0")}`]);
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ${lena}::uuid`;
    });
});
