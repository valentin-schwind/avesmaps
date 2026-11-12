import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { photoboxGrantAllowed, type ReisebilderAntwort } from "@avesmaps3d/shared";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore } from "../src/media/storage.ts";
import { PUBLICATION_RULE_SEEDS, seedPublicationRules } from "../src/migration/media-rules.ts";
import {
    BEISPIEL_DATEI_MAX,
    BEISPIEL_PRAEFIX,
    BEISPIEL_VERZEICHNIS,
    ProduktionVerweigert,
    kennzeichen,
    ladeBeispiele,
    legeBeispieleAn,
    pruefeKeineProduktion,
    type GeladeneBeispiele,
} from "../src/photobox/beispiele.ts";
import { pruefeBild } from "../src/photobox/db.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { liesReisebilder, vergissReisebilder } from "../src/photobox/karte.ts";
import { reiheKachelnEin } from "../src/photobox/kacheln.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { file, pngBytes } from "./support/media-operations-fixture.ts";
import { einreichung, neueSpuren, raeumeAuf, type Spuren } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die persistenten Beispielbilder der Reisebilder (WI-0272 S4, Aufgabe 24, `photobox/beispiele.ts`, `npm run photobox:beispiele`) gegen echtes PostgreSQL und einen echten
 * Medienordner: Sie laufen den echten Weg (Einreichen, Rechnen, Freigeben, Veröffentlichen), sind wiederholbar, berühren keine Kartendaten und läuten nicht an der Glocke
 * der Redaktion; in Production gibt es sie nie (die Sperre steht im Aufruf selbst, nicht erst in der Kommandozeile).
 */

const MARKE = "photobox-beispiele-test";
const REGELN = PUBLICATION_RULE_SEEDS.filter((seed) => seed.role === "photobox");
const REGEL_TEXTE = REGELN.map((regel) => regel.scopeText);
const GARETH = "00000000-0000-4000-8000-0000000000a1";
const ROMMILYS = "00000000-0000-4000-8000-0000000000a2";
const WELT = { x0: 0, y0: 0, x1: 1024, y1: 1024 };

/** Das Manifest, wie die Aufgabe es verlangt (Schlüssel, Datei, Ort mit Versatz, gebunden, Entstehung, Nutzung). */
const ERWARTET = [
    ["gareth-1", "reichsstrasse.webp", "Gareth", [1, 1], true, "ai_generated", "avesmaps_only"],
    ["gareth-2", "gebaeude.webp", "Gareth", [-1, 1], true, "drawing", "avesmaps_only"],
    ["gareth-3", "stadt.webp", "Gareth", [1, -1], true, "drawing", "cc-by-4.0"],
    ["rommilys-1", "fluss.webp", "Rommilys", [2, 1], true, "ai_generated", "avesmaps_only"],
    ["buendel-1", "see.webp", "Gareth", [40, 25], false, "ai_generated", "avesmaps_only"],
    ["buendel-2", "gebirge.webp", "Gareth", [42, 27], false, "ai_generated", "avesmaps_only"],
    ["buendel-3", "huegel.webp", "Gareth", [44, 24], false, "avesmaps_capture", "avesmaps_only"],
    ["frei-1", "kulturlandschaft.webp", "Gareth", [-45, -30], false, "ai_generated", "cc-by-4.0"],
] as const;

describe("Das Manifest der Beispielbilder (ohne Datenbank)", () => {
    it("🔴 die acht Einträge stehen so, wie die Aufgabe sie verlangt", async () => {
        const { manifest } = await ladeBeispiele();
        expect(manifest.fassung).toBe("beispielbild-1");
        expect(
            manifest.bilder.map((b) => [b.schluessel, b.datei, b.ort, b.versatz, b.gebunden, b.entstehung, b.nutzung]),
        ).toEqual(ERWARTET.map((zeile) => [...zeile]));
    });

    it("Beschreibungen beginnen mit „Beispielbild:“, der Name ist „Avesmaps-Beispiel“, nur frei-1 hat keinen und eine Blickrichtung 2", async () => {
        const { manifest } = await ladeBeispiele();
        for (const bild of manifest.bilder) {
            expect(bild.beschreibung.startsWith(BEISPIEL_PRAEFIX), bild.schluessel).toBe(true);
            expect(bild.beschreibung.length, bild.schluessel).toBeLessThanOrEqual(300);
            if (bild.schluessel === "frei-1") {
                expect(bild.name).toBeUndefined();
                expect(bild.blickrichtung).toBe(2);
            } else {
                expect(bild.name, bild.schluessel).toBe("Avesmaps-Beispiel");
                expect(bild.blickrichtung, bild.schluessel).toBeUndefined();
            }
        }
        // Fünf KI-Bilder, zwei gezeichnete, eine Aufnahme aus Avesmaps.
        const arten = manifest.bilder.map((b) => b.entstehung);
        expect(arten.filter((art) => art === "ai_generated")).toHaveLength(5);
        expect(arten.filter((art) => art === "drawing")).toHaveLength(2);
        expect(arten.filter((art) => art === "avesmaps_capture")).toHaveLength(1);
    });

    it("🔴 jede Datei besteht die Prüfung des Einreichens, ist höchstens 120 KB groß und liegt wirklich im Ordner; die Lizenzwahl ist erlaubt", async () => {
        const { manifest, bilder } = await ladeBeispiele();
        expect(BEISPIEL_DATEI_MAX).toBe(120 * 1024);
        expect(BEISPIEL_VERZEICHNIS.replace(/\\/gu, "/")).toMatch(/\/config\/photobox\/$/u);
        for (const bild of manifest.bilder) {
            const pfad = join(bilder, bild.datei);
            expect((await stat(pfad)).size, bild.datei).toBeLessThanOrEqual(BEISPIEL_DATEI_MAX);
            const geprueft = pruefeBild(file(await readFile(pfad), bild.datei));
            expect(geprueft.inspection.format, bild.datei).toBe("webp");
            expect(photoboxGrantAllowed(bild.entstehung, bild.nutzung), bild.schluessel).toBe(true);
        }
        // Die Dateien sind Kopien der Typbilder der Oberfläche (config/ liegt im Release, public/ nicht).
        const kopf = fileURLToPath(new URL("../../web/public/icons/header/", import.meta.url));
        for (const bild of manifest.bilder) {
            expect(
                (await readFile(join(bilder, bild.datei))).equals(await readFile(join(kopf, bild.datei))),
                bild.datei,
            ).toBe(true);
        }
    });

    it("das Kennzeichen steht in terms_version: beispielbild-1:<schlüssel>", () => {
        expect(kennzeichen("beispielbild-1", "gareth-1")).toBe("beispielbild-1:gareth-1");
    });

    it("ein ungültiges Manifest wird abgewiesen: kein Präfix, doppelter Schlüssel, Aufnahme unter CC BY", async () => {
        const wurzel = await mkdtemp(join(tmpdir(), "avesmaps3d-beispiele-manifest-"));
        try {
            const { manifest } = await ladeBeispiele();
            const schreibe = async (aendere: (kopie: typeof manifest) => void): Promise<void> => {
                const kopie = structuredClone(manifest);
                aendere(kopie);
                await writeFile(join(wurzel, "beispiele.json"), JSON.stringify(kopie));
            };
            await schreibe((kopie) => {
                kopie.bilder[0]!.beschreibung = "Ein Bild ohne Präfix";
            });
            await expect(ladeBeispiele(wurzel)).rejects.toThrow(/ungültig/u);
            await schreibe((kopie) => {
                kopie.bilder[1]!.schluessel = kopie.bilder[0]!.schluessel;
            });
            await expect(ladeBeispiele(wurzel)).rejects.toThrow(/doppelt/u);
            await schreibe((kopie) => {
                kopie.bilder[6]!.nutzung = "cc-by-4.0";
            });
            await expect(ladeBeispiele(wurzel)).rejects.toThrow(/CC BY/u);
        } finally {
            await rm(wurzel, { recursive: true, force: true });
        }
    });
});

describe("Die Production-Sperre (ohne Datenbank)", () => {
    const datenbank = (name: string): Queryable => (async () => [{ name }]) as unknown as Queryable;

    it("🔴 die Umgebungsvariable, die Umgebung des Aufrufs und der Name der Datenbank verweigern; sonst geht es", async () => {
        await expect(
            pruefeKeineProduktion(datenbank("avesmaps_stage"), "development", { AVESMAPS_ENV: "production" }),
        ).rejects.toBeInstanceOf(ProduktionVerweigert);
        await expect(
            pruefeKeineProduktion(datenbank("avesmaps_stage"), "development", { AVESMAPS_ENV: " Production " }),
        ).rejects.toThrow(/AVESMAPS_ENV/u);
        await expect(pruefeKeineProduktion(datenbank("avesmaps_stage"), "production", {})).rejects.toThrow(/Umgebung/u);
        await expect(pruefeKeineProduktion(datenbank("avesmaps3d_production"), "development", {})).rejects.toThrow(
            /avesmaps3d_production/u,
        );
        await expect(pruefeKeineProduktion(datenbank("AVESMAPS_PRODUCTION_2"), "staging", {})).rejects.toBeInstanceOf(
            ProduktionVerweigert,
        );
        await expect(
            pruefeKeineProduktion(datenbank("avesmaps_stage"), "staging", { AVESMAPS_ENV: "staging" }),
        ).resolves.toBeUndefined();
        await expect(pruefeKeineProduktion(datenbank("avesmaps_dev"), "development", {})).resolves.toBeUndefined();
    });
});

describeWithDatabase("Die Beispielbilder gegen die Datenbank (WI-0272 S4, Aufgabe 24)", { timeout: 240_000 }, () => {
    let database: Database;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: AuthFixture;
    let geladen: GeladeneBeispiele;
    const spuren: Spuren = neueSpuren();

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-beispiele-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        await fixture.person("editor", { name: "Beispiele Redaktion" });
        geladen = await ladeBeispiele();
    }, 120_000);

    beforeEach(async () => {
        await seedPublicationRules(database, REGELN);
        await orte();
    });

    afterEach(async () => {
        await raeumeAlles();
    });

    afterAll(async () => {
        await raeumeAlles();
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${REGEL_TEXTE})`;
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    // --- Hilfen -------------------------------------------------------------------------------------------------------------------

    /** Zwei Orte mit den Namen des Manifests; die Kennungen sortieren vor allen anderen, sie sind also „der erste nach public_id“. */
    async function orte(): Promise<void> {
        await raeumeOrte();
        for (const [publicId, name, x, y] of [
            [GARETH, "Gareth", 500, 450],
            [ROMMILYS, "Rommilys", 300, 700],
        ] as const) {
            await database`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
                VALUES (${publicId}, 'aventuria', ${name}, 'stadt', ST_SetSRID(ST_MakePoint(${x}::float8, ${y}::float8), 0), ${MARKE}, TRUE, FALSE)`;
        }
    }

    async function raeumeOrte(): Promise<void> {
        await database`DELETE FROM place WHERE source_system = ${MARKE}`;
    }

    async function raeumeAlles(): Promise<void> {
        const einreichungen = await database<{ id: string }[]>`
            SELECT id::text AS id FROM media_submission WHERE terms_version LIKE 'beispielbild-%:%'`;
        const ids = einreichungen.map((zeile) => zeile.id);
        const assets = await database<{ id: string; public_id: string }[]>`
            SELECT a.id::text AS id, a.public_id::text AS public_id FROM media_asset a
              JOIN media_ingest i ON i.media_asset_id = a.id WHERE i.submission_id = ANY(${ids}::bigint[])`;
        const assetIds = assets.map((a) => a.id);
        const publicIds = assets.map((a) => a.public_id);
        await database`DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ANY(${publicIds}::text[]))`;
        await database`DELETE FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ANY(${publicIds}::text[])`;
        const operationen = (
            await database<{ operation_id: string }[]>`
                SELECT DISTINCT operation_id::text AS operation_id FROM media_audit_event WHERE media_asset_public_id = ANY(${publicIds}::uuid[])`
        ).map((zeile) => zeile.operation_id);
        await database`DELETE FROM media_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM media_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM photobox_media WHERE media_submission_id = ANY(${ids}::bigint[])`;
        await database`DELETE FROM media_ingest WHERE submission_id = ANY(${ids}::bigint[])`;
        await database`DELETE FROM media_submission WHERE id = ANY(${ids}::bigint[])`;
        await database`DELETE FROM media_quarantine WHERE sha256 IN (SELECT sha256 FROM media_file WHERE media_asset_id = ANY(${assetIds}::bigint[]))`;
        await database`DELETE FROM media_file WHERE media_asset_id = ANY(${assetIds}::bigint[])`;
        await database`DELETE FROM media_rights WHERE media_asset_id = ANY(${assetIds}::bigint[])`;
        await database`DELETE FROM media_creation WHERE media_asset_id = ANY(${assetIds}::bigint[])`;
        await database`DELETE FROM media_asset WHERE id = ANY(${assetIds}::bigint[])`;
        await raeumeAuf(database, spuren);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
        await raeumeOrte();
        vergissReisebilder();
    }

    const lauf = (beispiele: GeladeneBeispiele = geladen) =>
        legeBeispieleAn(database, store, "test", { beispiele, env: {} });

    const lesen = async (): Promise<ReisebilderAntwort> => {
        vergissReisebilder();
        return JSON.parse((await liesReisebilder(database, WELT)).body) as ReisebilderAntwort;
    };
    const beispiele = async (): Promise<ReisebilderAntwort["bilder"]> =>
        (await lesen()).bilder.filter((bild) => bild.beschreibung.startsWith(BEISPIEL_PRAEFIX));

    /** Die Zeilen der Beispielbilder in den Tafeln, die der Weg berührt. */
    async function zahlen(): Promise<Record<string, number>> {
        const [zeile] = await database<Record<string, number>[]>`
            WITH s AS (SELECT id FROM media_submission WHERE terms_version LIKE 'beispielbild-%:%'),
                 a AS (SELECT media_asset_id AS id FROM media_ingest WHERE submission_id IN (SELECT id FROM s))
            SELECT (SELECT count(*) FROM s)::int AS einreichung,
                   (SELECT count(*) FROM a)::int AS asset,
                   (SELECT count(*) FROM media_file WHERE media_asset_id IN (SELECT id FROM a))::int AS datei,
                   (SELECT count(*) FROM photobox_media WHERE media_submission_id IN (SELECT id FROM s))::int AS verwendung,
                   (SELECT count(*) FROM media_ingest WHERE submission_id IN (SELECT id FROM s))::int AS eingang,
                   (SELECT count(*) FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' IN (SELECT public_id::text FROM media_asset WHERE id IN (SELECT id FROM a)))::int AS auftrag,
                   (SELECT count(*) FROM media_operation WHERE operation_id IN (SELECT operation_id FROM media_audit_event WHERE media_asset_public_id IN (SELECT public_id FROM media_asset WHERE id IN (SELECT id FROM a))))::int AS operation`;
        return zeile!;
    }
    const glocken = async (): Promise<number> =>
        (await database<{ n: number }[]>`SELECT count(*)::int AS n FROM public.benachrichtigung`)[0]!.n;
    const kartenstand = async (): Promise<{ n: number; neuester: string | null }> => {
        const [zeile] = await database<
            { n: number; neuester: Date | null }[]
        >`SELECT count(*)::int AS n, max(updated_at) AS neuester FROM place`;
        return { n: zeile!.n, neuester: zeile!.neuester === null ? null : zeile!.neuester.toISOString() };
    };

    // --- Der erste Lauf -----------------------------------------------------------------------------------------------------------

    it("🔴 erster Lauf: acht Bilder in der Antwort über die ganze Welt; Fahnenorte und freie Bilder wie im Manifest", async () => {
        const ergebnis = await lauf();
        expect(ergebnis).toEqual({ angelegt: 8, vorhanden: 0, ohneOrt: [], unveroeffentlicht: [] });
        const bilder = await beispiele();
        expect(bilder).toHaveLength(8);
        for (const [schluessel, datei, , versatz, gebunden, entstehung, nutzung] of ERWARTET) {
            const eintrag = geladen.manifest.bilder.find((b) => b.schluessel === schluessel)!;
            const bild = bilder.find((b) => b.beschreibung === eintrag.beschreibung);
            expect(bild, schluessel).toBeDefined();
            const [ortX, ortY] = schluessel.startsWith("rommilys") ? [300, 700] : [500, 450];
            expect(bild!.lage, schluessel).toEqual({ x: ortX + versatz[0], y: ortY + versatz[1] });
            expect(bild!.entstehung, schluessel).toBe(entstehung);
            // Nur ein gebundenes Bild hängt am Ort (die Fahne); die übrigen stehen frei.
            if (gebunden) {
                expect(bild!.ort, schluessel).toMatchObject({
                    id: schluessel.startsWith("rommilys") ? ROMMILYS : GARETH,
                    name: schluessel.startsWith("rommilys") ? "Rommilys" : "Gareth",
                    subtype: "stadt",
                });
            } else {
                expect(bild, schluessel).not.toHaveProperty("ort");
            }
            // Name nur, wo das Manifest einen nennt; die Lizenz nur bei CC BY.
            if (eintrag.name === undefined) expect(bild).not.toHaveProperty("name");
            else expect(bild!.name, schluessel).toBe(eintrag.name);
            if (nutzung === "cc-by-4.0") expect(bild!.lizenz?.name, schluessel).toMatch(/CC BY/u);
            else expect(bild, schluessel).not.toHaveProperty("lizenz");
            expect(bild!.blickrichtung, schluessel).toBe(eintrag.blickrichtung);
            // Beide Fassungen, die Maße sind die der Datei (die Typbilder sind kleiner als 2048, also nicht vergrößert).
            const meta = await sharp(await readFile(join(geladen.bilder, datei))).metadata();
            expect(bild!.datei, schluessel).toMatchObject({ breite: meta.width, hoehe: meta.height });
            expect(bild!.kachel, schluessel).toBeDefined();
            expect(Math.max(bild!.kachel!.breite, bild!.kachel!.hoehe), schluessel).toBeLessThanOrEqual(480);
        }
        // Keine Datei einer Einreichung ist ohne Zeile, und die öffentlichen liegen im Speicher.
        const dateien = await database<{ storage_key: string }[]>`
            SELECT f.storage_key FROM media_file f
              JOIN media_ingest i ON i.media_asset_id = f.media_asset_id
              JOIN media_submission s ON s.id = i.submission_id
             WHERE s.terms_version LIKE 'beispielbild-1:%' AND f.storage_class = 'published'`;
        expect(dateien).toHaveLength(16);
        for (const datei of dateien) expect(await store.exists(datei.storage_key)).toBe(true);
        // Erkennbar am Kennzeichen, freigegeben als anonymer Handelnder, ohne Person.
        const kennzeichen8 = await database<{ terms_version: string; state: string }[]>`
            SELECT terms_version, state FROM media_submission WHERE terms_version LIKE 'beispielbild-1:%' ORDER BY terms_version`;
        expect(kennzeichen8.map((zeile) => zeile.terms_version)).toEqual(
            geladen.manifest.bilder.map((b) => `beispielbild-1:${b.schluessel}`).sort(),
        );
        expect(new Set(kennzeichen8.map((zeile) => zeile.state))).toEqual(new Set(["approved"]));
        const handelnde = await database<
            { actor_kind: string; actor_label: string | null; actor_person_id: string | null }[]
        >`
            SELECT DISTINCT o.actor_kind, o.actor_label, o.actor_person_id::text AS actor_person_id
              FROM media_operation o JOIN media_audit_event e ON e.operation_id = o.operation_id
              JOIN media_asset a ON a.public_id = e.media_asset_public_id
              JOIN media_ingest i ON i.media_asset_id = a.id JOIN media_submission s ON s.id = i.submission_id
             WHERE s.terms_version LIKE 'beispielbild-1:%'`;
        expect(handelnde).toEqual([{ actor_kind: "anonymous", actor_label: "photobox", actor_person_id: null }]);
    });

    it("🔴 zweiter Lauf: nichts Neues, gleiche Zeilenzahlen, keine neue Datei", async () => {
        await lauf();
        const vorher = await zahlen();
        const dateienVorher = (
            await database<{ storage_key: string }[]>`SELECT storage_key FROM media_file ORDER BY id`
        ).length;
        const ergebnis = await lauf();
        expect(ergebnis).toEqual({ angelegt: 0, vorhanden: 8, ohneOrt: [], unveroeffentlicht: [] });
        expect(await zahlen()).toEqual(vorher);
        expect((await database<{ storage_key: string }[]>`SELECT storage_key FROM media_file ORDER BY id`).length).toBe(
            dateienVorher,
        );
        expect(await beispiele()).toHaveLength(8);
    });

    it("🔴 ohne Freigaberegel: alle unveröffentlicht, die Antwort ist leer, kein Fehler; mit der Regel führt der nächste Lauf sie zu Ende", async () => {
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${REGEL_TEXTE})`;
        const ohne = await lauf();
        expect(ohne.angelegt).toBe(8);
        expect(ohne.unveroeffentlicht.sort()).toEqual(geladen.manifest.bilder.map((b) => b.schluessel).sort());
        expect(await beispiele()).toEqual([]);
        expect((await lesen()).an).toBe(true);
        // Kein Reisebild ist öffentlich, also gibt es nichts nachzuziehen.
        expect(await reiheKachelnEin(database)).toEqual({ eingereiht: 0, wartend: 0 });
        // Der Zustand: freigegeben, aber nicht öffentlich.
        const [zustand] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_submission WHERE terms_version LIKE 'beispielbild-1:%' AND state = 'approved'`;
        expect(zustand!.n).toBe(8);

        await seedPublicationRules(database, REGELN);
        const mit = await lauf();
        expect(mit).toEqual({ angelegt: 0, vorhanden: 8, ohneOrt: [], unveroeffentlicht: [] });
        expect(await beispiele()).toHaveLength(8);
    });

    it("🔴 verdeckte Texte (Abzug) setzt der Lauf aus dem Manifest zurück", async () => {
        await lauf();
        await database`
            UPDATE media_submission
               SET description = repeat('█', 12), attribution_name = '██', pending_description = '██████', editor_message = '██'
             WHERE terms_version IN ('beispielbild-1:gareth-1', 'beispielbild-1:frei-1')`;
        // frei-1 hat im Manifest keinen Namen: Der verdeckte Name muss wieder verschwinden, nicht „zurückgesetzt“ werden.
        const ergebnis = await lauf();
        expect(ergebnis.angelegt).toBe(0);
        const zeilen = await database<
            {
                terms_version: string;
                description: string;
                attribution_name: string | null;
                pending_description: string | null;
                editor_message: string | null;
            }[]
        >`
            SELECT terms_version, description, attribution_name, pending_description, editor_message
              FROM media_submission WHERE terms_version IN ('beispielbild-1:gareth-1', 'beispielbild-1:frei-1') ORDER BY terms_version`;
        for (const zeile of zeilen) {
            const eintrag = geladen.manifest.bilder.find(
                (b) => `beispielbild-1:${b.schluessel}` === zeile.terms_version,
            )!;
            expect(zeile).toEqual({
                terms_version: zeile.terms_version,
                description: eintrag.beschreibung,
                attribution_name: eintrag.name ?? null,
                pending_description: null,
                editor_message: null,
            });
        }
        expect((await beispiele()).map((b) => b.beschreibung)).toContain(
            geladen.manifest.bilder.find((b) => b.schluessel === "gareth-1")!.beschreibung,
        );
    });

    it("🔴 fehlt ein Ort: ohneOrt nennt ihn (einmal), der Rest entsteht", async () => {
        const kopie = structuredClone(geladen.manifest);
        kopie.bilder[0]!.ort = "Nirgendwo";
        kopie.bilder[4]!.ort = "Nirgendwo";
        const ergebnis = await lauf({ ...geladen, manifest: kopie });
        expect(ergebnis).toEqual({ angelegt: 6, vorhanden: 0, ohneOrt: ["Nirgendwo"], unveroeffentlicht: [] });
        expect(await beispiele()).toHaveLength(6);
        // Ein verborgener und ein inaktiver Ort zählen als fehlend.
        await raeumeAlles();
        await orte();
        await database`UPDATE place SET is_hidden = TRUE WHERE public_id = ${ROMMILYS}::uuid`;
        const verborgen = await lauf();
        expect(verborgen.ohneOrt).toEqual(["Rommilys"]);
        expect(verborgen.angelegt).toBe(7);
        await database`UPDATE place SET is_hidden = FALSE, is_active = FALSE WHERE public_id = ${ROMMILYS}::uuid`;
        const inaktiv = await lauf();
        expect(inaktiv.ohneOrt).toEqual(["Rommilys"]);
    });

    it("🔴 keine neue Zeile in benachrichtigung (die Glocke bleibt stumm); ein gewöhnliches Einreichen läutet sie", async () => {
        const vorher = await glocken();
        await lauf();
        expect(await glocken()).toBe(vorher);
        // Gegenprobe: Der Zähler sieht eine Glocke, wenn es eine gibt.
        const body = await einreichung(spuren, 77);
        await einreichen(database, store, "test", { ...body, bild: file(await pngBytes(77, 160, 90), "x.png") });
        expect(await glocken()).toBeGreaterThan(vorher);
    });

    it("🔴 Kartendaten bleiben unberührt: place hat danach dieselbe Anzahl und denselben jüngsten Stand", async () => {
        const vorher = await kartenstand();
        await lauf();
        await lauf();
        expect(await kartenstand()).toEqual(vorher);
    });

    it("🔴 die Production-Sperre greift im Aufruf: Umgebungsvariable, Umgebung und Datenbankname verweigern, und es entsteht nichts", async () => {
        const vorher = await zahlen();
        await expect(
            legeBeispieleAn(database, store, "test", { beispiele: geladen, env: { AVESMAPS_ENV: "production" } }),
        ).rejects.toBeInstanceOf(ProduktionVerweigert);
        await expect(
            legeBeispieleAn(database, store, "production", { beispiele: geladen, env: {} }),
        ).rejects.toBeInstanceOf(ProduktionVerweigert);
        const [name] = await database<{ name: string }[]>`SELECT current_database() AS name`;
        expect(name!.name.toLowerCase()).not.toContain("production");
        expect(await zahlen()).toEqual(vorher);
        expect(vorher.einreichung).toBe(0);
    });

    it("🔴 die Kommandozeile verweigert in Production mit Exit 2 und einem Satz, ohne etwas zu schreiben", async () => {
        const kommando = (env: Record<string, string>) =>
            spawnSync(process.execPath, ["src/migration/photobox-cli.ts", "beispiele"], {
                cwd: fileURLToPath(new URL("../", import.meta.url)),
                env: { ...process.env, DATABASE_URL: testDatabaseUrl as string, MEDIA_ROOT: mediaRoot, ...env },
                encoding: "utf8",
                timeout: 60_000,
            });
        const production = kommando({ AVESMAPS_ENV: "production" });
        expect(production.status).toBe(2);
        expect(production.stderr).toContain("Production");
        expect((await zahlen()).einreichung).toBe(0);

        // Der Datenbankname: eine Datenbank „…production…“ im selben Cluster, falls diese Rolle sie anlegen darf.
        const wurzel = new URL(testDatabaseUrl as string);
        const probe = `avesmaps_production_probe_${randomUUID().slice(0, 8)}`;
        let angelegt = false;
        try {
            await database.unsafe(`CREATE DATABASE ${probe}`);
            angelegt = true;
        } catch {
            // Keine Berechtigung für CREATE DATABASE: Der Name wird dann nur von der Prüfung oben (mit Stellvertreter) belegt.
        }
        if (angelegt) {
            try {
                wurzel.pathname = `/${probe}`;
                const verweigert = kommando({ DATABASE_URL: wurzel.toString(), AVESMAPS_ENV: "staging" });
                expect(verweigert.status).toBe(2);
                expect(verweigert.stderr).toContain(probe);
            } finally {
                await database.unsafe(`DROP DATABASE IF EXISTS ${probe} WITH (FORCE)`);
            }
        }
    });

    // --- photobox:kacheln ---------------------------------------------------------------------------------------------------------

    it("🔴 photobox:kacheln reiht nur Bilder ohne Kachel ein, und nicht doppelt", async () => {
        await lauf();
        // Die Aufträge der Anlage (Einreichen, Freigeben) hat im Betrieb längst der Worker abgearbeitet; hier gibt es keinen.
        const eigene = database`
            SELECT j.id FROM job j
             WHERE j.kind = 'media_settle' AND j.state = 'QUEUED'
               AND j.input_ref ->> 'asset' IN (
                   SELECT a.public_id::text FROM media_asset a
                     JOIN media_ingest i ON i.media_asset_id = a.id
                     JOIN media_submission s ON s.id = i.submission_id
                    WHERE s.terms_version LIKE 'beispielbild-1:%')`;
        await database`DELETE FROM job_event WHERE job_id IN (${eigene})`;
        await database`DELETE FROM job WHERE id IN (${eigene})`;
        expect(await reiheKachelnEin(database)).toEqual({ eingereiht: 0, wartend: 0 });

        // Drei Bilder, wie sie vor der Kachel veröffentlicht wurden: nur die Hauptfassung.
        const ohneKachel = await database<{ id: string; public_id: string; sha: string; key: string }[]>`
            SELECT a.id::text AS id, a.public_id::text AS public_id, k.sha256 AS sha, k.storage_key AS key
              FROM media_submission s JOIN media_ingest i ON i.submission_id = s.id JOIN media_asset a ON a.id = i.media_asset_id
              JOIN media_file k ON k.media_asset_id = a.id AND k.variant = 'photobox_kachel' AND k.storage_class = 'published'
             WHERE s.terms_version IN ('beispielbild-1:gareth-1', 'beispielbild-1:buendel-1', 'beispielbild-1:frei-1')
             ORDER BY s.terms_version`;
        expect(ohneKachel).toHaveLength(3);
        for (const bild of ohneKachel) {
            await database`DELETE FROM media_file WHERE media_asset_id = ${bild.id}::bigint AND variant = 'photobox_kachel'`;
            await store.remove(bild.key);
        }
        // Ein Bild, das offline ist, braucht keine Kachel.
        await database`
            UPDATE photobox_media SET retired_at = now()
             WHERE media_asset_id = ${ohneKachel[0]!.id}::bigint`;
        const erster = await reiheKachelnEin(database);
        expect(erster).toEqual({ eingereiht: 2, wartend: 0 });
        const auftraege = await database<{ actor_ref: string | null; priority: number }[]>`
            SELECT actor_ref, priority::int AS priority FROM job
             WHERE kind = 'media_settle' AND state = 'QUEUED'
               AND input_ref ->> 'asset' = ANY(${ohneKachel.slice(1).map((bild) => bild.public_id)}::text[])
               AND actor_ref = 'photobox' AND priority = 90`;
        expect(auftraege).toHaveLength(2);
        // Wiederholbar: Ein wartender Abgleich wird nicht noch einmal eingereiht.
        expect(await reiheKachelnEin(database)).toEqual({ eingereiht: 0, wartend: 2 });

        // Der Abgleich zieht die Kachel nach, danach ist nichts mehr zu tun.
        for (const bild of ohneKachel.slice(1)) {
            await settleAssetFiles(database, store, { assetPublicId: bild.public_id, role: "photobox" });
        }
        expect(await reiheKachelnEin(database)).toEqual({ eingereiht: 0, wartend: 0 });
    });

    it("die Kommandozeile zeigt bei fehlender Regel den Weg: media:regeln als Grund, Exit 0", async () => {
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${REGEL_TEXTE})`;
        const kommando = spawnSync(process.execPath, ["src/migration/photobox-cli.ts", "beispiele"], {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            env: {
                ...process.env,
                DATABASE_URL: testDatabaseUrl as string,
                MEDIA_ROOT: mediaRoot,
                AVESMAPS_ENV: "test",
            },
            encoding: "utf8",
            timeout: 120_000,
        });
        expect(kommando.status, kommando.stderr).toBe(0);
        expect(kommando.stdout).toContain("8 angelegt");
        expect(kommando.stdout).toContain("npm run media:regeln");
        // Der zweite Aufruf ist wiederholbar und legt nichts an.
        const zweiter = spawnSync(process.execPath, ["src/migration/photobox-cli.ts", "beispiele"], {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            env: {
                ...process.env,
                DATABASE_URL: testDatabaseUrl as string,
                MEDIA_ROOT: mediaRoot,
                AVESMAPS_ENV: "test",
            },
            encoding: "utf8",
            timeout: 120_000,
        });
        expect(zweiter.status).toBe(0);
        expect(zweiter.stdout).toContain("0 angelegt, 8 schon vorhanden");
        // Und die Kacheln: ohne öffentliches Bild nichts zu tun.
        const kacheln = spawnSync(process.execPath, ["src/migration/photobox-cli.ts", "kacheln"], {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            env: { ...process.env, DATABASE_URL: testDatabaseUrl as string, AVESMAPS_ENV: "test" },
            encoding: "utf8",
            timeout: 60_000,
        });
        expect(kacheln.status).toBe(0);
        expect(kacheln.stdout).toContain("0 Abgleiche eingereiht");
    });
});
