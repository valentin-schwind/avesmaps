import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ABZUG_PLATZHALTER_UUID, type AbzugManifest, type AbzugPlan } from "@avesmaps3d/shared";
import { liesAbzug, pruefeAbzug } from "../src/abzug/pruefen.ts";
import {
    betroffeneTafeln,
    EinspielenFehler,
    pgDumpPfad,
    spieleAbzugEin,
    type EinspielenBericht,
} from "../src/abzug/einspielen.ts";
import { leseKatalog, type Katalog } from "../src/abzug/katalog.ts";
import { baueAbzugPlan } from "../src/abzug/plan.ts";
import { ladeRegeln, type GeladeneRegeln } from "../src/abzug/regeln.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { schreibeAbzug, tarBytes } from "./support/abzug-export.ts";

/**
 * Der Abzug für lokal, Roundtrip (WI-0251): ein Plan wird gegen die Testdatenbank ausgeführt (der Referenz-Export `support/abzug-export.ts`
 * tut, was Claudios Korridor tun soll), die Daten werden verändert, und das Einspielen stellt den Stand des Abzugs wieder her.
 *
 * Problemfälle: Personenfelder leer oder verdeckt, eine Tafel im Kreis (Landschaft und Beschriftung), ein Zähler mit `GENERATED ALWAYS`,
 * eine lokal mitzuleerende Tafel (Genehmigungsbelege), lokale Konten und Aufträge bleiben, Benutzer-Trigger sind danach wieder an,
 * eine verfälschte Prüfsumme und ein zu altes Journal halten an, ohne dass etwas verändert ist.
 * Soll: nach dem Einspielen ist die Datenbank der Abzug, die Folgen laufen weiter, und jedes „nicht verändert“ stimmt.
 *
 * Mediendateien: vier Zeilen von `media_file` (ein Original mit langem Namen im Tar, zwei Zeilen auf dasselbe veröffentlichte Bild, eine Ableitung, deren Datei an der Quelle
 * fehlt). Sie kommen mit, werden vor dem Ersetzen geprüft, danach atomar nach `MEDIA_ROOT` gelegt (lokale Zusatzdateien bleiben), und scheitert eine
 * Datei beim Ablegen, steht sie als `offen` im Ergebnis, bis ein erneutes Einspielen sie nachholt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const pgDump = pgDumpPfad();

const ID = {
    stadt: "00000000-0000-4000-8000-000000251001",
    dorf: "00000000-0000-4000-8000-000000251002",
    landschaft: "00000000-0000-4000-8000-000000251003",
    beschriftung: "00000000-0000-4000-8000-000000251004",
};
function sha(daten: Buffer): string {
    return createHash("sha256").update(daten).digest("hex");
}
function schluessel(klasse: string, hash: string, endung: string): string {
    return `${klasse}/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.${endung}`;
}
const MEDIEN = {
    original: Buffer.from("Das Original eines Bildes. ".repeat(40)),
    bild: Buffer.from("Ein veröffentlichtes Bild. ".repeat(25)),
    fehlt: Buffer.from("Diese Datei liegt an der Quelle nicht mehr. ".repeat(3)),
};
const MEDIEN_PFAD = {
    original: schluessel("private/source", sha(MEDIEN.original), "jpg"),
    bild: schluessel("published", sha(MEDIEN.bild), "webp"),
    fehlt: schluessel("derivatives", sha(MEDIEN.fehlt), "png"),
};

const PERSON = {
    nachricht: "11111111-1111-4111-8111-111111111111",
    recht: "22222222-2222-4222-8222-222222222222",
    herkunft: "33333333-3333-4333-8333-333333333333",
    einstellung: "44444444-4444-4444-8444-444444444444",
};

describeWithDatabase("Abzug für lokal: erstellen nach Plan und einspielen (PostgreSQL)", { timeout: 180_000 }, () => {
    let db: Database;
    let katalog: Katalog;
    let regeln: GeladeneRegeln;
    let plan: AbzugPlan;
    let ordner: string;
    let tar: string;
    let manifest: AbzugManifest;
    /** Das `MEDIA_ROOT` der Quelle (hier liegen zwei der drei Dateien) und eine frische lokale Wurzel je Fall. */
    let quelle: string;
    let ziele = 0;

    function neueWurzel(): string {
        ziele += 1;
        return join(ordner, `lokal-medien-${String(ziele)}`);
    }

    /** Alle Dateien unter einem Ordner, relativ und mit `/`. */
    function dateienUnter(wurzel: string, praefix = ""): string[] {
        if (!existsSync(wurzel)) return [];
        return readdirSync(wurzel, { withFileTypes: true }).flatMap((eintrag) =>
            eintrag.isDirectory()
                ? dateienUnter(join(wurzel, eintrag.name), `${praefix}${eintrag.name}/`)
                : [`${praefix}${eintrag.name}`],
        );
    }

    async function zaehle(sql: string): Promise<number> {
        const [zeile] = await db.unsafe<{ n: string }[]>(`SELECT count(*)::text AS n FROM (${sql}) AS q`);
        return Number(zeile?.n);
    }

    /** Entfernt die Zeilen dieser Datei, auch Reste früherer Läufe. */
    async function raeume(): Promise<void> {
        await db`DELETE FROM media_file WHERE media_asset_id IN (SELECT id FROM media_asset WHERE source_ref = 'abzug-251')`;
        await db`DELETE FROM media_rights_evidence WHERE description = 'Probe-Beleg 251'`;
        await db`DELETE FROM media_ingest WHERE source_ref = 'abzug-251'`;
        await db`DELETE FROM media_rights WHERE media_asset_id IN (SELECT id FROM media_asset WHERE source_ref = 'abzug-251')`;
        await db`DELETE FROM media_asset WHERE source_ref = 'abzug-251'`;
        await db`UPDATE region SET primary_label_id = NULL WHERE public_id = ${ID.landschaft}`;
        await db`DELETE FROM map_label WHERE public_id = ${ID.beschriftung}`;
        await db`DELETE FROM region WHERE public_id = ${ID.landschaft}`;
        await db`DELETE FROM place WHERE public_id IN (${ID.stadt}, ${ID.dorf}) OR name LIKE '%251'`;
        await db`DELETE FROM news_entry WHERE titel LIKE 'Probe 251%'`;
        await db`DELETE FROM map_setting WHERE key = 'abzugProbe251'`;
    }

    beforeAll(async () => {
        db = createDatabase(testDatabaseUrl!, { max: 4 });
        await migrate(db);
        katalog = await leseKatalog(db);
        regeln = ladeRegeln();
        plan = baueAbzugPlan(katalog, regeln, "staging");
        ordner = mkdtempSync(join(tmpdir(), "abzug-test-"));
        await raeume();

        await db`INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                 VALUES (${ID.stadt}, 'aventuria', 'Probestadt 251', 'stadt', ST_SetSRID(ST_MakePoint(100, 100), 0), 'test', TRUE),
                        (${ID.dorf}, 'aventuria', 'Probedorf 251', 'dorf', ST_SetSRID(ST_MakePoint(110, 110), 0), 'test', TRUE)`;
        // Zwei Tafeln, die aufeinander zeigen: die Landschaft auf ihre Hauptbeschriftung und die Beschriftung auf die Landschaft.
        await db`INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                 VALUES (${ID.landschaft}, 'aventuria', 'Probeland 251', 'topographie', 'gebirge', TRUE)`;
        const [beschriftung] = await db<{ id: string }[]>`
            INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, source_system)
            SELECT ${ID.beschriftung}::uuid, 'aventuria', id, 'Probeland 251', ST_SetSRID(ST_MakePoint(105, 105), 0), 'test'
              FROM region WHERE public_id = ${ID.landschaft}
            RETURNING id::text`;
        await db`UPDATE region SET primary_label_id = ${beschriftung!.id} WHERE public_id = ${ID.landschaft}`;
        // Personenfelder: leer (nullbar), verdeckt (das Schema verlangt einen Wert).
        await db`INSERT INTO news_entry (datum, titel, text, rubrik, herkunft, von_person)
                 VALUES ('2026-10-24', 'Probe 251', 'Ein Satz.', 'Karte', 'test', ${PERSON.nachricht})`;
        const [asset] = await db<{ id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, source_system, source_ref, ingest_actor_legacy)
            VALUES ('image', 'legacy_import', 'test', 'abzug-251', 'Legacy-Nutzer') RETURNING id::text`;
        await db`INSERT INTO media_rights (media_asset_id, rights_basis, creator, reviewed_by, reviewed_by_person, reviewed_at)
                 VALUES (${asset!.id}, 'unknown', 'Eine Malerin', 'Ein Prüfer', ${PERSON.recht}, now())`;
        await db`INSERT INTO media_ingest (media_asset_id, ingest_kind, actor_person_id, source_ref)
                 VALUES (${asset!.id}, 'editor_upload', ${PERSON.herkunft}, 'abzug-251')`;
        await db`INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, description)
                 VALUES (${asset!.id}, 'operator_note', 'Probe-Beleg 251')`;
        await db`INSERT INTO map_setting (key, value, changed_by, changed_by_label)
                 VALUES ('abzugProbe251', '1', ${PERSON.einstellung}, 'Jemand')
                 ON CONFLICT (key) DO UPDATE SET changed_by = EXCLUDED.changed_by, changed_by_label = EXCLUDED.changed_by_label`;
        // Drei Mediendateien: zwei liegen an der Quelle, die dritte fehlt dort.
        quelle = join(ordner, "quelle-medien");
        for (const [name, pfad] of [
            ["original", MEDIEN_PFAD.original],
            ["bild", MEDIEN_PFAD.bild],
        ] as const) {
            mkdirSync(dirname(join(quelle, ...pfad.split("/"))), { recursive: true });
            writeFileSync(join(quelle, ...pfad.split("/")), MEDIEN[name]);
        }
        await db`INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
                 VALUES (${asset!.id}, 'source', 'private_source', ${MEDIEN_PFAD.original}, 'image/jpeg', NULL, NULL, ${MEDIEN.original.length}, ${sha(MEDIEN.original)}, NULL, NULL),
                        (${asset!.id}, 'probe_web', 'published', ${MEDIEN_PFAD.bild}, 'image/webp', 10, 10, ${MEDIEN.bild.length}, ${sha(MEDIEN.bild)}, 'probe', '1'),
                        -- Zwei Zeilen, eine Datei: Veröffentlichte Bilder liegen nach Inhalt, das Manifest nennt den Schlüssel einmal.
                        (${asset!.id}, 'probe_zweit', 'published', ${MEDIEN_PFAD.bild}, 'image/webp', 10, 10, ${MEDIEN.bild.length}, ${sha(MEDIEN.bild)}, 'probe', '1'),
                        (${asset!.id}, 'probe_gross', 'derivative', ${MEDIEN_PFAD.fehlt}, 'image/png', NULL, NULL, ${MEDIEN.fehlt.length}, ${sha(MEDIEN.fehlt)}, 'probe', '1')`;
        // Der Abzug entsteht aus diesem Stand.
        tar = join(ordner, "abzug.tar");
        manifest = await schreibeAbzug(db, plan, {
            ziel: tar,
            kennung: "20261024T120000Z-test251",
            medienWurzel: quelle,
        });
    });

    afterAll(async () => {
        await raeume();
        await db.end({ timeout: 5 });
        rmSync(ordner, { recursive: true, force: true });
    });

    it("das Manifest nennt jede mitgenommene Tafel mit Zeilen und Prüfsumme, Personenfelder sind im Abzug leer", async () => {
        const gelesen = await liesAbzug(tar);
        expect(gelesen.probleme).toEqual([]);
        expect(gelesen.manifest?.tafeln.map((tafel) => tafel.tafel)).toEqual(plan.tafeln.map((tafel) => tafel.tafel));
        expect(manifest.tafeln.find((tafel) => tafel.tafel === "public.place")?.zeilen).toBeGreaterThanOrEqual(2);
        expect(manifest.tafeln.find((tafel) => tafel.tafel === "public.news_entry")?.leeren).toEqual(["von_person"]);
        // Das Personenfeld ist leer, bevor irgendetwas lokal eingespielt wird: schon die Abfrage des Plans liefert NULL beziehungsweise den Platzhalter.
        const news = plan.tafeln.find((tafel) => tafel.tafel === "public.news_entry")!;
        expect(
            await zaehle(
                `SELECT * FROM (${news.abfrage}) AS p WHERE p.titel = 'Probe 251' AND p.von_person IS NOT NULL`,
            ),
        ).toBe(0);
        const ingest = plan.tafeln.find((tafel) => tafel.tafel === "public.media_ingest")!;
        expect(
            await zaehle(
                `SELECT * FROM (${ingest.abfrage}) AS p WHERE p.source_ref = 'abzug-251' AND p.actor_person_id = '${ABZUG_PLATZHALTER_UUID}'`,
            ),
        ).toBe(1);
        expect(plan.tafeln.some((tafel) => tafel.tafel === "public.job" || tafel.tafel.startsWith("avesmaps_"))).toBe(
            false,
        );
    });

    it("das Manifest nennt die Mediendateien mit Größe und Prüfsumme; eine Zeile ohne Datei an der Quelle steht unter medienFehlend", async () => {
        expect(plan.medien.tafel).toBe("public.media_file");
        expect(plan.medien.abfrage).toContain('"storage_key" AS pfad');
        expect(manifest.medien).toEqual(
            expect.arrayContaining([
                { pfad: MEDIEN_PFAD.original, groesse: MEDIEN.original.length, sha256: sha(MEDIEN.original) },
                { pfad: MEDIEN_PFAD.bild, groesse: MEDIEN.bild.length, sha256: sha(MEDIEN.bild) },
            ]),
        );
        expect(manifest.medienFehlend).toContain(MEDIEN_PFAD.fehlt);
        // Das Original hat im Tar einen Namen über 100 Zeichen; der Leser findet ihn trotzdem (ustar-Präfix oder GNU-Langname).
        const gelesen = await liesAbzug(tar);
        expect(gelesen.probleme).toEqual([]);
        const original = gelesen.eintraege.find((eintrag) => eintrag.name === `medien/${MEDIEN_PFAD.original}`);
        expect(original?.name.length).toBeGreaterThan(100);
        expect(original?.groesse).toBe(MEDIEN.original.length);
        // Nichts aus den Belegen, nichts, was kein Medium der Liste ist.
        expect(gelesen.eintraege.every((eintrag) => !eintrag.name.includes("evidence"))).toBe(true);
    });

    it("🔴 stellt den Stand des Abzugs her, behält Aufträge, räumt mitzuleerende Tafeln und lässt Personenfelder leer", async () => {
        // Danach verändern wir, was der Abzug zurückholen muss.
        await db`UPDATE place SET name = 'Verändert' WHERE public_id = ${ID.stadt}`;
        await db`DELETE FROM place WHERE public_id = ${ID.dorf}`;
        await db`UPDATE news_entry SET titel = 'Probe 251 anders' WHERE titel = 'Probe 251'`;
        await db`INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                 VALUES (gen_random_uuid(), 'aventuria', 'Nur lokal 251', 'dorf', ST_SetSRID(ST_MakePoint(1, 1), 0), 'test', TRUE)`;
        await db`INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, description)
                 SELECT id, 'operator_note', 'Probe-Beleg 251' FROM media_asset WHERE source_ref = 'abzug-251' LIMIT 1`;
        const [auftrag] = await db<{ id: string }[]>`
            INSERT INTO job (kind, map_domain_id) VALUES ('probe', 'aventuria') RETURNING id::text`;
        const auftraegeVorher = await zaehle("SELECT id FROM job");

        // Lokal liegt schon eine eigene Datei im Medienordner: Sie bleibt.
        const lokal = neueWurzel();
        mkdirSync(join(lokal, "published"), { recursive: true });
        writeFileSync(join(lokal, "published", "nur-lokal.txt"), "bleibt");

        const berichte: EinspielenBericht[] = [];
        const ergebnis = await spieleAbzugEin({
            databaseUrl: testDatabaseUrl!,
            tarPfad: tar,
            regeln,
            ablage: ordner,
            pgDump,
            medienWurzel: lokal,
            bericht: (bericht) => berichte.push(bericht),
        });
        expect(ergebnis.tafeln).toBe(manifest.tafeln.length);
        expect(ergebnis.zeilen).toBe(manifest.tafeln.reduce((summe, tafel) => summe + tafel.zeilen, 0));
        expect(ergebnis.sicherung).toMatch(/^vorher-20261024T120000Z-test251-.*\.dump$/u);
        expect(berichte.map((bericht) => bericht.phase)).toEqual(
            expect.arrayContaining([
                "pruefen",
                "medienpruefen",
                "sicherung",
                "leeren",
                "laden",
                "folgen",
                "medien",
                "fertig",
            ]),
        );
        // Mediendateien: die zwei von der Quelle liegen, byte-gleich; die fehlende nicht; die lokale Zusatzdatei ist unberührt.
        expect(ergebnis.medien).toMatchObject({ dateien: 2, geschrieben: 2, vorhanden: 0, offen: 0 });
        expect(readFileSync(join(lokal, ...MEDIEN_PFAD.original.split("/")))).toEqual(MEDIEN.original);
        expect(readFileSync(join(lokal, ...MEDIEN_PFAD.bild.split("/")))).toEqual(MEDIEN.bild);
        expect(existsSync(join(lokal, ...MEDIEN_PFAD.fehlt.split("/")))).toBe(false);
        expect(readFileSync(join(lokal, "published", "nur-lokal.txt"), "utf8")).toBe("bleibt");
        expect(dateienUnter(lokal).filter((name) => name.endsWith(".part"))).toEqual([]);
        // Die Zeilen sind da.
        expect(
            await zaehle(
                `SELECT 1 FROM media_file WHERE storage_key IN ('${MEDIEN_PFAD.original}', '${MEDIEN_PFAD.bild}', '${MEDIEN_PFAD.fehlt}')`,
            ),
        ).toBe(4);
        // Noch einmal eingespielt: nichts wird neu geschrieben, die Dateien sind gleich groß.
        const nochmal = await spieleAbzugEin({
            databaseUrl: testDatabaseUrl!,
            tarPfad: tar,
            regeln,
            ablage: ordner,
            pgDump,
            medienWurzel: lokal,
        });
        expect(nochmal.medien).toMatchObject({ dateien: 2, geschrieben: 0, vorhanden: 2, offen: 0 });

        // Der Stand des Abzugs.
        expect(await zaehle(`SELECT 1 FROM place WHERE public_id = '${ID.stadt}' AND name = 'Probestadt 251'`)).toBe(1);
        expect(await zaehle(`SELECT 1 FROM place WHERE public_id = '${ID.dorf}'`)).toBe(1);
        expect(await zaehle(`SELECT 1 FROM place WHERE name = 'Nur lokal 251'`)).toBe(0);
        expect(await zaehle(`SELECT 1 FROM news_entry WHERE titel = 'Probe 251'`)).toBe(1);
        // Personenfelder: leer beziehungsweise Platzhalter, nie die Person.
        expect(await zaehle(`SELECT 1 FROM news_entry WHERE von_person IS NOT NULL`)).toBe(0);
        expect(
            await zaehle(
                `SELECT 1 FROM map_setting WHERE key = 'abzugProbe251' AND changed_by IS NULL AND changed_by_label IS NULL`,
            ),
        ).toBe(1);
        expect(
            await zaehle(
                `SELECT 1 FROM media_ingest WHERE source_ref = 'abzug-251' AND actor_person_id = '${ABZUG_PLATZHALTER_UUID}'`,
            ),
        ).toBe(1);
        expect(
            await zaehle(
                `SELECT 1 FROM media_rights WHERE reviewed_by_person = '${ABZUG_PLATZHALTER_UUID}' AND creator IS NULL AND reviewed_by IS NULL`,
            ),
        ).toBe(1);
        expect(
            await zaehle(
                `SELECT 1 FROM media_asset WHERE source_ref = 'abzug-251' AND ingest_actor_legacy IS NOT NULL`,
            ),
        ).toBe(0);
        // Der Kreis ist geschlossen und geprüft.
        expect(
            await zaehle(
                `SELECT 1 FROM region r JOIN map_label l ON l.id = r.primary_label_id AND l.region_id = r.id WHERE r.public_id = '${ID.landschaft}'`,
            ),
        ).toBe(1);
        // Lokale Aufträge bleiben, mitzuleerende Belege sind weg.
        expect(await zaehle("SELECT id FROM job")).toBe(auftraegeVorher);
        expect(await zaehle(`SELECT 1 FROM job WHERE id = ${auftrag!.id}`)).toBe(1);
        expect(await zaehle(`SELECT 1 FROM media_rights_evidence WHERE description = 'Probe-Beleg 251'`)).toBe(0);
        // Benutzer-Trigger sind wieder an, die Fremdschlüssel im Kreis wieder sofort.
        expect(
            await zaehle(
                `SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.place'::regclass AND NOT tgisinternal AND tgenabled <> 'O'`,
            ),
        ).toBe(0);
        expect(
            await zaehle(
                `SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conrelid IN ('public.region'::regclass, 'public.map_label'::regclass) AND condeferrable`,
            ),
        ).toBe(0);
        // Die Folgen laufen über dem größten Wert weiter.
        const [neu] = await db<{ id: string }[]>`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system)
            VALUES (gen_random_uuid(), 'aventuria', 'Danach 251', 'dorf', ST_SetSRID(ST_MakePoint(2, 2), 0), 'test') RETURNING id::text`;
        const [groesster] = await db<
            { id: string }[]
        >`SELECT max(id)::text AS id FROM place WHERE name <> 'Danach 251'`;
        expect(Number(neu?.id)).toBeGreaterThan(Number(groesster?.id));
        await db`DELETE FROM place WHERE name = 'Danach 251'`;
        await db`DELETE FROM job WHERE id = ${auftrag!.id}`;
    });

    it("hält vor jeder Änderung an, wenn die Prüfsumme einer Tafel nicht stimmt", async () => {
        const kaputt = join(ordner, "kaputt.tar");
        await schreibeAbzug(db, plan, {
            ziel: kaputt,
            kennung: "20261024T120100Z-kaputt251",
            // Eine Tafel verfälschen, die Prüfsumme des Manifests bleibt die der echten Bytes.
            veraendereTafel: () => Buffer.from("das ist kein COPY-Strom"),
            veraendereManifest: (m) => ({
                ...m,
                tafeln: m.tafeln.map((tafel) => ({ ...tafel, sha256: "0".repeat(64) })),
            }),
        });
        await db`UPDATE place SET name = 'Unverändert 251' WHERE public_id = ${ID.stadt}`;
        await expect(
            spieleAbzugEin({
                databaseUrl: testDatabaseUrl!,
                tarPfad: kaputt,
                regeln,
                ablage: ordner,
                pgDump,
                medienWurzel: neueWurzel(),
            }),
        ).rejects.toBeInstanceOf(EinspielenFehler);
        expect(await zaehle(`SELECT 1 FROM place WHERE name = 'Unverändert 251'`)).toBe(1);
        await db`UPDATE place SET name = 'Probestadt 251' WHERE public_id = ${ID.stadt}`;
    });

    it("🔴 eine Tafel, die der Abzug nicht trägt: in Ordnung, wenn der lokale Stand voraus ist, sonst abgewiesen (Cutoff, lokal lebt von Abzügen)", async () => {
        const fehlt = "public.place_review";
        const entferne = (tafeln: AbzugManifest["tafeln"]): AbzugManifest["tafeln"] =>
            tafeln.filter((tafel) => tafel.tafel !== fehlt);
        const gleicherStand = join(ordner, "tafel-fehlt.tar");
        await schreibeAbzug(db, plan, {
            ziel: gleicherStand,
            kennung: "20261024T120150Z-tafelfehlt",
            veraendereManifest: (m) => ({ ...m, tafeln: entferne(m.tafeln) }),
        });
        const abgewiesen = await pruefeAbzug(db, gleicherStand, regeln, katalog);
        expect(abgewiesen.probleme.map((problem) => problem.code)).toContain("regeln");

        const aelter = join(ordner, "aelter.tar");
        await schreibeAbzug(db, plan, {
            ziel: aelter,
            kennung: "20261024T120155Z-aelter",
            veraendereManifest: (m) => ({ ...m, migrationen: m.migrationen.slice(0, -1), tafeln: entferne(m.tafeln) }),
        });
        const voraus = await pruefeAbzug(db, aelter, regeln, katalog);
        expect(voraus.probleme.map((problem) => problem.code)).not.toContain("regeln");
        expect(voraus.neueTafeln).toEqual([fehlt]);
        expect(betroffeneTafeln(voraus.manifest!, regeln, voraus.neueTafeln).alle).toContain(fehlt);
    });

    it("🔴 weist ein zu altes lokales Journal, eine fremde Kartendomäne und ein falsches Format ab", async () => {
        const mitMigration = join(ordner, "migration.tar");
        await schreibeAbzug(db, plan, {
            ziel: mitMigration,
            kennung: "20261024T120200Z-migration",
            veraendereManifest: (m) => ({
                ...m,
                migrationen: [...m.migrationen, { version: "9999_gibt_es_nicht", checksum: "x" }],
            }),
        });
        const pruefung = await pruefeAbzug(db, mitMigration, regeln, katalog);
        expect(pruefung.probleme.map((problem) => problem.code)).toEqual(["migrationen_lokal_alt"]);
        expect(pruefung.probleme[0]?.detail).toBe("9999_gibt_es_nicht");

        const andereDomaene = join(ordner, "domaene.tar");
        await schreibeAbzug(db, plan, {
            ziel: andereDomaene,
            kennung: "20261024T120300Z-domaene",
            veraendereManifest: (m) => ({
                ...m,
                kartendomaenen: m.kartendomaenen.map((d) => ({ ...d, pruefsumme: "fremd" })),
            }),
        });
        expect((await pruefeAbzug(db, andereDomaene, regeln, katalog)).probleme.map((p) => p.code)).toEqual([
            "kartendomaene",
        ]);

        const keinAbzug = join(ordner, "kein.tar");
        writeFileSync(
            keinAbzug,
            tarBytes([{ name: "manifest.json", daten: Buffer.from(JSON.stringify({ format: "etwas-anderes" })) }]),
        );
        expect((await liesAbzug(keinAbzug)).probleme.map((p) => p.code)).toEqual(["format"]);
        const nichtTar = join(ordner, "text.tar");
        writeFileSync(nichtTar, "das ist kein Tar".repeat(100));
        expect((await liesAbzug(nichtTar)).probleme.map((p) => p.code)).toEqual(["datei"]);
    });

    it("nimmt nur Abzüge an, die mindestens so streng sind wie die Regeln dieses Stands", async () => {
        const locker = join(ordner, "locker.tar");
        await schreibeAbzug(db, plan, {
            ziel: locker,
            kennung: "20261024T120400Z-locker",
            veraendereManifest: (m) => ({
                ...m,
                tafeln: m.tafeln.map((tafel) =>
                    tafel.tafel === "public.news_entry" ? { ...tafel, leeren: [] } : tafel,
                ),
            }),
        });
        const pruefung = await pruefeAbzug(db, locker, regeln, katalog);
        expect(pruefung.probleme.map((p) => p.code)).toEqual(["regeln"]);
        expect(pruefung.probleme[0]?.detail).toContain("public.news_entry: von_person");
    });

    it("🔴 hält vor jeder Änderung an, wenn eine Mediendatei nicht zur Prüfsumme des Manifests passt", async () => {
        const verfaelscht = join(ordner, "medien-kaputt.tar");
        await schreibeAbzug(db, plan, {
            ziel: verfaelscht,
            kennung: "20261024T120500Z-medienkaputt",
            medienWurzel: quelle,
            // Gleich groß, ein Byte anders: nur der Hash merkt es.
            veraendereMedium: (pfad, daten) =>
                pfad === MEDIEN_PFAD.bild ? Buffer.concat([daten.subarray(0, -1), Buffer.from("X")]) : daten,
        });
        await db`UPDATE place SET name = 'Unverändert 251' WHERE public_id = ${ID.stadt}`;
        const lokal = neueWurzel();
        const fehler = await spieleAbzugEin({
            databaseUrl: testDatabaseUrl!,
            tarPfad: verfaelscht,
            regeln,
            ablage: ordner,
            pgDump,
            medienWurzel: lokal,
        }).catch((error: unknown) => error);
        expect(fehler).toBeInstanceOf(EinspielenFehler);
        expect((fehler as EinspielenFehler).code).toBe("pruefsumme");
        // Weder die Datenbank noch der Medienordner wurden angefasst, auch die gute Datei nicht.
        expect(await zaehle(`SELECT 1 FROM place WHERE name = 'Unverändert 251'`)).toBe(1);
        expect(dateienUnter(lokal)).toEqual([]);
        await db`UPDATE place SET name = 'Probestadt 251' WHERE public_id = ${ID.stadt}`;
    });

    it("🔴 hält an und nimmt die Datenbank zurück, wenn Medienzeilen und Dateiliste nicht zusammenpassen", async () => {
        const luecke = join(ordner, "medien-luecke.tar");
        await schreibeAbzug(db, plan, {
            ziel: luecke,
            kennung: "20261024T120600Z-medienluecke",
            medienWurzel: quelle,
            // Die fehlende Datei wird nicht mehr als fehlend genannt: Eine Zeile hat dann weder Datei noch Vermerk.
            veraendereManifest: (m) => ({ ...m, medienFehlend: [] }),
        });
        await db`UPDATE place SET name = 'Unverändert 251' WHERE public_id = ${ID.stadt}`;
        const lokal = neueWurzel();
        const fehler = await spieleAbzugEin({
            databaseUrl: testDatabaseUrl!,
            tarPfad: luecke,
            regeln,
            ablage: ordner,
            pgDump,
            medienWurzel: lokal,
        }).catch((error: unknown) => error);
        expect(fehler).toBeInstanceOf(EinspielenFehler);
        expect((fehler as EinspielenFehler).code).toBe("medien");
        expect((fehler as EinspielenFehler).message).toContain("Nichts wurde verändert");
        expect(await zaehle(`SELECT 1 FROM place WHERE name = 'Unverändert 251'`)).toBe(1);
        expect(dateienUnter(lokal)).toEqual([]);
        await db`UPDATE place SET name = 'Probestadt 251' WHERE public_id = ${ID.stadt}`;
    });

    it("🔴 verweigert Pfade im Manifest, die aus MEDIA_ROOT hinausführen, und schreibt nichts", async () => {
        const boese = join(ordner, "medien-pfad.tar");
        await schreibeAbzug(db, plan, {
            ziel: boese,
            kennung: "20261024T120700Z-medienpfad",
            medienWurzel: quelle,
            veraendereManifest: (m) => ({
                ...m,
                medien: m.medien.map((medium, index) =>
                    index === 0 ? { ...medium, pfad: "published/../../ausserhalb.txt" } : medium,
                ),
            }),
        });
        const lokal = neueWurzel();
        const pruefung = await pruefeAbzug(db, boese, regeln, katalog, { wurzel: lokal });
        expect(pruefung.probleme.map((problem) => problem.code)).toEqual(expect.arrayContaining(["medien_pfad"]));
        await expect(
            spieleAbzugEin({
                databaseUrl: testDatabaseUrl!,
                tarPfad: boese,
                regeln,
                ablage: ordner,
                pgDump,
                medienWurzel: lokal,
            }),
        ).rejects.toBeInstanceOf(EinspielenFehler);
        expect(existsSync(join(ordner, "ausserhalb.txt"))).toBe(false);
        expect(dateienUnter(lokal)).toEqual([]);
    });

    it("lässt einen Abzug mit Mediendateien ohne eingerichtetes MEDIA_ROOT nicht zu", async () => {
        const ohne = await pruefeAbzug(db, tar, regeln, katalog, { wurzel: undefined });
        expect(ohne.probleme.map((problem) => problem.code)).toEqual(["medien_ablage"]);
        const mit = await pruefeAbzug(db, tar, regeln, katalog, { wurzel: neueWurzel() });
        expect(mit.probleme).toEqual([]);
        // Zu wenig Platz: Das Manifest nennt eine Datei, die kein Laufwerk fasst.
        const riesig = join(ordner, "medien-riesig.tar");
        await schreibeAbzug(db, plan, {
            ziel: riesig,
            kennung: "20261024T120800Z-medienriesig",
            medienWurzel: quelle,
            veraendereManifest: (m) => ({
                ...m,
                medien: m.medien.map((medium, index) => (index === 0 ? { ...medium, groesse: 2 ** 50 } : medium)),
            }),
        });
        const voll = await pruefeAbzug(db, riesig, regeln, katalog, { wurzel: neueWurzel() });
        expect(voll.probleme.map((problem) => problem.code)).toEqual(expect.arrayContaining(["medien_platz"]));
    });

    it("🔴 legt, was scheitert, als offen ab und holt es beim erneuten Einspielen derselben Datei nach", async () => {
        const lokal = neueWurzel();
        // An die Stelle der einen Datei tritt ein Ordner: Das atomare Umbenennen scheitert, die andere Datei kommt trotzdem an.
        const blockiert = join(lokal, ...MEDIEN_PFAD.bild.split("/"));
        mkdirSync(blockiert, { recursive: true });
        await db`UPDATE place SET name = 'Vorher 251' WHERE public_id = ${ID.stadt}`;
        const erst = await spieleAbzugEin({
            databaseUrl: testDatabaseUrl!,
            tarPfad: tar,
            regeln,
            ablage: ordner,
            pgDump,
            medienWurzel: lokal,
        });
        // Die Datenbank ist ersetzt (der Abzug gilt), die Medien sind unvollständig.
        expect(await zaehle(`SELECT 1 FROM place WHERE name = 'Probestadt 251'`)).toBe(1);
        expect(erst.medien).toMatchObject({ dateien: 2, geschrieben: 1, offen: 1 });
        expect(erst.medien.ersterFehler).toContain(MEDIEN_PFAD.bild);
        expect(readFileSync(join(lokal, ...MEDIEN_PFAD.original.split("/")))).toEqual(MEDIEN.original);
        expect(dateienUnter(lokal).filter((name) => name.endsWith(".part"))).toEqual([]);

        // Der Fehler ist behoben; dasselbe Einspielen noch einmal holt die fehlende Datei nach.
        rmSync(blockiert, { recursive: true, force: true });
        const zweit = await spieleAbzugEin({
            databaseUrl: testDatabaseUrl!,
            tarPfad: tar,
            regeln,
            ablage: ordner,
            pgDump,
            medienWurzel: lokal,
        });
        expect(zweit.medien).toMatchObject({ dateien: 2, geschrieben: 1, vorhanden: 1, offen: 0 });
        expect(readFileSync(join(lokal, ...MEDIEN_PFAD.bild.split("/")))).toEqual(MEDIEN.bild);
    });
});
