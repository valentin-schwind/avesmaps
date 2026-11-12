import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BENACHRICHTIGUNG_ARTEN, PHOTOBOX_GLOCKEN_ARTEN, type Role } from "@avesmaps3d/shared";
import { rollenMit } from "../src/community/glocke.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { BENACHRICHTIGUNG_JOB_ARTEN } from "../src/jobs/benachrichtigung-job.ts";
import { MediaStore } from "../src/media/storage.ts";
import { technikNachziehen } from "../src/photobox/db.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { freigeben, rueckfragen } from "../src/photobox/redaktion.ts";
import { beschreibungSetzen, bildErsetzen } from "../src/photobox/status.ts";
import { authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { einreichung, neueOperation, neueSpuren, pngUpload, raeumeAuf } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Glocke für neue Reisebilder (WI-0272 S3, Aufgabe 19; Klarstellungen der Leitung 2 bis 5): `photobox_eingang` an alle aktiven Personen mit
 * `moderate_submissions` (ab Reviewer), **gebündelt** wie `community_neu`, ausgelöst von Einreichen, Bild ersetzen und einer wartenden Beschreibung.
 *
 * - Solange eine Person eine ungelesene hat, wächst die Zahl im `text`, statt eine zweite Zeile anzulegen; die erste Einreichung trägt keinen Text.
 * - 🔴 Nie Beschreibung oder Name des Einsenders im `text` oder in der Quelle: nur die Zahl.
 * - Dieselbe Kennung der Operation noch einmal meldet nichts. Scheitert die Glocke, gilt die Handlung trotzdem (Savepoint, `bestenfalls`).
 */

describeWithDatabase("Glocke: neue Reisebilder (WI-0272 S3, Aufgabe 19)", { timeout: 180_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let mediaRoot = "";
    let store: MediaStore;
    const spuren = neueSpuren();
    let lena: { id: string };
    let emil: { id: string };
    let adrian: { id: string };
    let olaf: { id: string };
    let tessa: { id: string };
    let gesperrt: { id: string };
    let alle: string[];
    let bearbeitende: string[];
    const warnungen: { object: unknown; message: string }[] = [];
    const log = { warn: (object: unknown, message: string) => void warnungen.push({ object, message }) };

    const raeumen = async (): Promise<void> => {
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-glocke-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        const person = async (role: Role, name: string) => fixture.person(role, { name });
        lena = await person("reviewer", "Lena");
        emil = await person("editor", "Emil");
        adrian = await person("admin", "Adrian");
        olaf = await person("operator", "Olaf");
        tessa = await person("tester", "Tessa");
        gesperrt = await fixture.person("reviewer", { name: "Gesperrt", status: "locked" });
        alle = [lena.id, emil.id, adrian.id, olaf.id, tessa.id, gesperrt.id];
        bearbeitende = [lena.id, emil.id, adrian.id, olaf.id];
    }, 120_000);

    beforeEach(async () => {
        warnungen.length = 0;
        await raeumen();
    });

    afterEach(async () => {
        await database`DROP TRIGGER IF EXISTS photobox_glocke_sperre ON public.benachrichtigung`;
        await database`DROP FUNCTION IF EXISTS public.photobox_glocke_sperre()`;
        await raeumeAuf(database, spuren);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
    });

    afterAll(async () => {
        await raeumen().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    interface Zeile {
        id: string;
        an_person: string;
        art: string;
        text: string | null;
        quelle: string;
        von_art: string;
        von_person: string | null;
        bezug_ops: string | null;
        gelesen_at: Date | null;
        erstellt_at: Date;
    }

    /** Alle Zeilen der Art an die Personen dieses Tests, in der Reihenfolge ihrer Entstehung. */
    const glocke = (): Promise<Zeile[]> =>
        database<Zeile[]>`
            SELECT id::text, an_person::text, art, text, quelle, von_art, von_person::text, bezug_ops::text, gelesen_at, erstellt_at
              FROM public.benachrichtigung
             WHERE an_person = ANY(${alle}::uuid[]) AND art = 'photobox_eingang'
             ORDER BY public.benachrichtigung.id
        `;
    const personen = (zeilen: readonly Zeile[]): string[] => zeilen.map((zeile) => zeile.an_person).sort();
    const alsGelesen = async (person: string): Promise<void> => {
        await database`UPDATE public.benachrichtigung SET gelesen_at = now() WHERE an_person = ${person}::uuid AND gelesen_at IS NULL`;
    };

    let seed = 5000;
    /** Reicht ein Bild ein (so wie die Route es tut: mit dem Protokoll der Anfrage). */
    async function reicheEin(patch: Parameters<typeof einreichung>[2] = {}) {
        seed += 1;
        const body = await einreichung(spuren, seed, patch);
        const { publicId } = await einreichen(database, store, "test", body, log);
        return { body, publicId };
    }
    async function zeileDer(publicId: string) {
        const [row] = await database<{ id: string; revision: number; asset: string; asset_public_id: string }[]>`
            SELECT s.id::text AS id, s.revision::int AS revision, a.id::text AS asset, a.public_id::text AS asset_public_id
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${publicId}::uuid
             ORDER BY i.id DESC LIMIT 1`;
        return row!;
    }
    /** Die technische Prüfung ist gelaufen und der Übergang nachgezogen: die Einreichung steht auf `pending`. */
    async function geprueft(publicId: string): Promise<number> {
        const fall = await zeileDer(publicId);
        await database`UPDATE media_asset SET technical_state = 'ok' WHERE id = ${fall.asset}::bigint`;
        expect(await technikNachziehen(database, fall.id)).toBe(1);
        return (await zeileDer(publicId)).revision;
    }
    const akteur = () => ({ personId: lena.id, environment: "test" }) as const;

    it("die Art steht im Katalog, in einer eigenen Gruppe, und kommt nie über die Warteschlange; Empfänger sind genau die ab Reviewer", () => {
        expect(BENACHRICHTIGUNG_ARTEN as readonly string[]).toContain("photobox_eingang");
        for (const art of PHOTOBOX_GLOCKEN_ARTEN) {
            expect(BENACHRICHTIGUNG_ARTEN as readonly string[]).toContain(art);
            expect(BENACHRICHTIGUNG_JOB_ARTEN as readonly string[]).not.toContain(art);
        }
        expect(rollenMit("moderate_submissions")).toEqual(["reviewer", "editor", "admin", "operator"]);
    });

    it("🔴 eine Einreichung meldet sich bei jeder bearbeitenden aktiven Person genau einmal, ohne Text und ohne Absender", async () => {
        const { body } = await reicheEin({ name: "Alrike", beschreibung: "Wehrheim liegt zu weit im Westen" });
        const zeilen = await glocke();
        // Reviewer, Editor, Admin, Operator je eine; nicht der Tester, nicht die gesperrte Person.
        expect(personen(zeilen)).toEqual([...bearbeitende].sort());
        for (const zeile of zeilen) {
            expect(zeile).toMatchObject({
                art: "photobox_eingang",
                text: null,
                von_art: "system",
                von_person: null,
                bezug_ops: null,
                gelesen_at: null,
            });
            // Die Quelle trägt die Kennung der Operation: Sie hält die Wiederholung zurück und verrät nichts.
            expect(zeile.quelle).toBe(`photobox_eingang:${body.operationId}`);
        }
    });

    it("🔴 bündelt: zwei Einreichungen ergeben EINE ungelesene Zeile mit der Zahl 2, die dritte macht 3; die Quelle bleibt die der ersten", async () => {
        const erste = await reicheEin();
        const vorher = await glocke();
        await reicheEin();
        const zwei = await glocke();
        expect(zwei).toHaveLength(4);
        expect(zwei.map((zeile) => zeile.text)).toEqual(["2", "2", "2", "2"]);
        expect(new Set(zwei.map((zeile) => zeile.quelle))).toEqual(
            new Set([`photobox_eingang:${erste.body.operationId}`]),
        );
        // Die Zeile wächst, sie wird nicht ersetzt, und ihre Zeit zieht mit.
        expect(zwei.map((zeile) => zeile.id)).toEqual(vorher.map((zeile) => zeile.id));
        for (const zeile of zwei) {
            const frueher = vorher.find((v) => v.an_person === zeile.an_person)!;
            expect(zeile.erstellt_at.getTime()).toBeGreaterThanOrEqual(frueher.erstellt_at.getTime());
        }
        await reicheEin();
        expect((await glocke()).map((zeile) => zeile.text)).toEqual(["3", "3", "3", "3"]);
    });

    it("nach dem Lesen beginnt die nächste Bündelung: für die lesende Person eine neue Zeile ohne Text, für die anderen wächst die alte", async () => {
        await reicheEin();
        await reicheEin();
        await alsGelesen(lena.id);
        await reicheEin();
        const zeilen = await glocke();
        const lenas = zeilen.filter((zeile) => zeile.an_person === lena.id);
        expect(lenas.map((zeile) => [zeile.text, zeile.gelesen_at === null])).toEqual([
            ["2", false],
            [null, true],
        ]);
        for (const zeile of zeilen.filter((z) => z.an_person !== lena.id)) expect(zeile.text).toBe("3");
    });

    it("🔴 dieselbe Kennung der Operation noch einmal meldet nichts (die Wiederholung findet die Quittung vor)", async () => {
        const { body } = await reicheEin();
        for (let i = 0; i < 3; i++) await einreichen(database, store, "test", body, log);
        const zeilen = await glocke();
        expect(zeilen).toHaveLength(4);
        for (const zeile of zeilen) expect(zeile.text).toBeNull();
        // Eine zweite, andere Einreichung macht daraus zwei, nicht vier.
        await reicheEin();
        expect((await glocke()).map((zeile) => zeile.text)).toEqual(["2", "2", "2", "2"]);
    });

    it("🔴 nie die Beschreibung, nie der Name des Einsenders: weder im Text noch in der Quelle noch im Absender", async () => {
        await reicheEin({ name: "Alrike Sonnenschein", beschreibung: "Die Türme von Wehrheim im Abendlicht" });
        await reicheEin({ name: "Boron", beschreibung: "Ein Hohlweg bei Gareth" });
        for (const zeile of await glocke()) {
            for (const feld of [zeile.text ?? "", zeile.quelle]) {
                for (const fremd of ["Alrike", "Sonnenschein", "Boron", "Wehrheim", "Gareth", "Türme"]) {
                    expect(feld).not.toContain(fremd);
                }
            }
            expect(zeile.text === null || /^[0-9]{1,6}$/u.test(zeile.text)).toBe(true);
        }
    });

    it("🔴 Bild ersetzen meldet sich wie eine neue Einreichung; dieselbe Kennung noch einmal nicht", async () => {
        const { body } = await reicheEin();
        await alsGelesen(lena.id);
        const ersetzen = { operationId: neueOperation(spuren), schluessel: body.schluessel, bild: await pngUpload(77) };
        await bildErsetzen(database, store, "test", ersetzen, log);
        const nach = (await glocke()).filter((zeile) => zeile.an_person === lena.id);
        // Die erste ist gelesen, die neue ungelesen.
        expect(nach.map((zeile) => [zeile.text, zeile.gelesen_at === null])).toEqual([
            [null, false],
            [null, true],
        ]);
        expect(nach[1]!.quelle).toBe(`photobox_eingang:${ersetzen.operationId}`);
        await bildErsetzen(database, store, "test", ersetzen, log);
        expect((await glocke()).filter((zeile) => zeile.an_person === lena.id)).toHaveLength(2);
    });

    it("🔴 eine Beschreibung meldet sich nur, wenn sie auf Prüfung wartet: nach der Freigabe und als Antwort auf eine Rückfrage, nie vorher", async () => {
        const { body, publicId } = await reicheEin();
        const beschreibe = (text: string) => {
            const operationId = neueOperation(spuren);
            return {
                operationId,
                lauf: () =>
                    beschreibungSetzen(
                        database,
                        "test",
                        { operationId, schluessel: body.schluessel, beschreibung: text },
                        log,
                    ),
            };
        };
        await alsGelesen(lena.id);
        const lenas = async () => (await glocke()).filter((zeile) => zeile.an_person === lena.id);

        // Vor der Freigabe liegt die Einreichung schon im Korb: nichts Neues.
        await beschreibe("Etwas genauer gefasst").lauf();
        expect(await lenas()).toHaveLength(1);

        // Rückfrage und Antwort darauf: Die Einreichung kehrt in den Korb „offen“ zurück.
        let revision = await geprueft(publicId);
        await rueckfragen(database, akteur(), publicId, {
            operationId: neueOperation(spuren),
            baseRevision: revision,
            nachricht: "Welcher Hafen?",
        });
        expect(await lenas()).toHaveLength(1);
        const antwort = beschreibe("Der Hafen von Havena");
        await antwort.lauf();
        const nachAntwort = await lenas();
        expect(nachAntwort).toHaveLength(2);
        expect(nachAntwort[1]!.quelle).toBe(`photobox_eingang:${antwort.operationId}`);

        // Nach der Freigabe wartet eine neue Beschreibung auf Prüfung.
        revision = (await zeileDer(publicId)).revision;
        await freigeben(database, akteur(), publicId, { operationId: neueOperation(spuren), baseRevision: revision });
        await alsGelesen(lena.id);
        const neu = beschreibe("Der Hafen von Havena bei Sonnenaufgang");
        await neu.lauf();
        const nachFreigabe = await lenas();
        expect(nachFreigabe).toHaveLength(3);
        expect(nachFreigabe[2]).toMatchObject({ text: null, gelesen_at: null });
        expect(nachFreigabe[2]!.quelle).toBe(`photobox_eingang:${neu.operationId}`);
        // Dieselbe Kennung noch einmal: nichts.
        await neu.lauf();
        expect(await lenas()).toHaveLength(3);

        // 🔴 Eine zweite Änderung, solange die erste auf Prüfung wartet, meldet nichts (Review M8): Die Glocke zählt Einreichungen, nicht Änderungen; Zahl und Zeitpunkt bleiben.
        const nochmal = beschreibe("Der Hafen von Havena bei Sonnenaufgang, vom Leuchtturm aus");
        await nochmal.lauf();
        const nachNochmal = await lenas();
        expect(nachNochmal).toHaveLength(3);
        expect(nachNochmal[2]).toMatchObject({ text: null, gelesen_at: null });
        expect(nachNochmal[2]!.erstellt_at).toEqual(nachFreigabe[2]!.erstellt_at);

        // Hat die Redaktion die wartende Beschreibung übernommen, meldet sich die nächste Änderung wieder.
        revision = (await zeileDer(publicId)).revision;
        await freigeben(database, akteur(), publicId, { operationId: neueOperation(spuren), baseRevision: revision });
        await alsGelesen(lena.id);
        const spaeter = beschreibe("Der Hafen von Havena, Abendstimmung");
        await spaeter.lauf();
        const nachUebernahme = await lenas();
        expect(nachUebernahme).toHaveLength(4);
        expect(nachUebernahme[3]!.quelle).toBe(`photobox_eingang:${spaeter.operationId}`);
    });

    it("🔴 scheitert die Glocke, gilt die Handlung trotzdem: die Einreichung steht, das Protokoll sagt, was fehlt", async () => {
        await database`
            CREATE FUNCTION public.photobox_glocke_sperre() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.art = 'photobox_eingang' THEN RAISE EXCEPTION 'Glocke gesperrt (Test)'; END IF;
                RETURN NEW;
            END $$`;
        await database`
            CREATE TRIGGER photobox_glocke_sperre BEFORE INSERT ON public.benachrichtigung
            FOR EACH ROW EXECUTE FUNCTION public.photobox_glocke_sperre()`;
        const { publicId } = await reicheEin();
        const [vorhanden] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_submission WHERE public_id = ${publicId}::uuid`;
        expect(vorhanden!.n).toBe(1);
        expect(await glocke()).toHaveLength(0);
        expect(warnungen.map((warnung) => warnung.message)).toEqual([
            expect.stringContaining("Glocke (neues Reisebild) nicht gemeldet"),
        ]);
    });
});
