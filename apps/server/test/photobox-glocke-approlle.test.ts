import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MediaStore } from "../src/media/storage.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { bildErsetzen } from "../src/photobox/status.ts";
import { einreichung, neueOperation, neueSpuren, pngUpload } from "./support/photobox-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Glocke für neue Reisebilder mit den Rechten der APP-ROLLE, wie auf dem VPS (WI-0272 S3, Aufgabe 19): Die Glocke läuft bestenfalls (Savepoint) und verschluckt einen Rechtefehler, damit
 * die Handlung gilt. Genau deshalb muss ein Test sagen, dass hier keiner auftritt: `benachrichtige()` ausführen, `public.benachrichtigung` lesen und die ungelesene Zeile ändern (die Bündelung) darf
 * die App-Rolle, und `avesmaps_auth.person` und `person_access` liest sie für die Empfänger. Ein Wegwerf-Cluster mit den Rollen des VPS und allen Vorlagen unter `src/db/*.psql`
 * (Muster `photobox-settle-jobsrolle.test.ts`). Ohne PostgreSQL-Binärdateien sichtbar übersprungen.
 */

const ENV = "photoboxglocke";
const describeWithCluster = postgresBin ? describe : describe.skip;
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));

describeWithCluster("Glocke neuer Reisebilder als App-Rolle (WI-0272 S3, Aufgabe 19)", { timeout: 120_000 }, () => {
    let cluster: VpsCluster | undefined;
    let mediaRoot = "";
    let store: MediaStore;
    const spuren = neueSpuren();
    const warnungen: { object: unknown; message: string }[] = [];
    const log = { warn: (object: unknown, message: string) => void warnungen.push({ object, message }) };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN, { mapDomains: true });
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-glocke-approlle-"));
        store = new MediaStore(mediaRoot);
    }, 180_000);

    afterAll(async () => {
        await cluster?.stop();
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    }, 60_000);

    it("🔴 die App-Rolle meldet, bündelt und wächst ohne Rechtefehler: Einreichen, Bild ersetzen, zweite Einreichung", async () => {
        const admin = cluster!.admin;
        const app = cluster!.app;
        const person = async (rolle: string, name: string): Promise<string> => {
            const [row] = await admin<{ id: string }[]>`
                INSERT INTO avesmaps_auth.person (display_name, status, created_via) VALUES (${name}, 'active', 'system') RETURNING id::text`;
            await admin`INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${row!.id}::uuid, 'test', ${rolle})`;
            return row!.id;
        };
        const lena = await person("reviewer", "Lena");
        const tessa = await person("tester", "Tessa");
        const zeilen = () =>
            admin<{ an_person: string; text: string | null; quelle: string; gelesen_at: Date | null }[]>`
                SELECT an_person::text, text, quelle, gelesen_at FROM public.benachrichtigung
                 WHERE art = 'photobox_eingang' AND an_person = ANY(${[lena, tessa]}::uuid[]) ORDER BY id`;

        // Die erste Einreichung legt die Zeile an (INSERT über benachrichtige()).
        const erste = await einreichung(spuren, 1);
        await einreichen(app, store, "test", erste, log);
        expect(warnungen).toEqual([]);
        expect(await zeilen()).toEqual([
            { an_person: lena, text: null, quelle: `photobox_eingang:${erste.operationId}`, gelesen_at: null },
        ]);

        // Die zweite lässt sie wachsen (UPDATE der App-Rolle auf text und erstellt_at), keine zweite Zeile.
        await einreichen(app, store, "test", await einreichung(spuren, 2), log);
        expect(warnungen).toEqual([]);
        expect((await zeilen()).map((zeile) => zeile.text)).toEqual(["2"]);

        // Ein neues Bild für die erste Einreichung: Die Zeile ist noch ungelesen und wächst weiter.
        await bildErsetzen(
            app,
            store,
            "test",
            { operationId: neueOperation(spuren), schluessel: erste.schluessel, bild: await pngUpload(3) },
            log,
        );
        expect(warnungen).toEqual([]);
        expect((await zeilen()).map((zeile) => zeile.text)).toEqual(["3"]);

        // Nach dem Lesen beginnt die nächste Bündelung (INSERT), auch jetzt ohne Rechtefehler.
        await admin`UPDATE public.benachrichtigung SET gelesen_at = now() WHERE an_person = ${lena}::uuid`;
        await einreichen(app, store, "test", await einreichung(spuren, 4), log);
        expect(warnungen).toEqual([]);
        expect((await zeilen()).map((zeile) => [zeile.text, zeile.gelesen_at === null])).toEqual([
            ["3", false],
            [null, true],
        ]);
    });
});
