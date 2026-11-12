import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SubjectDetail, SubjectStaettenSection } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { createSubjectService, type DetailRequest, type SubjectService } from "../src/subjects/service.ts";
import { C, cleanCatalogFixtures, insertCatalogCarriers } from "./support/catalog-fixture.ts";

/**
 * Der SICHTBARE Lesepfad der Stätten nach Lesart B (Betreiberentscheid 2026-10-13 „ja zu allen drei“,
 * `project-control/state/entscheidungen.md`; Fallblatt `…/wi-0063-restauftrag-2026-10-13/staetten-fallblatt.md`), gegen echtes
 * PostgreSQL.
 *
 * 🔴 Die Regel, die hier geprüft wird: **Beziehung, sonst der ERSTE genannte Ort der Kette.** Nie ein Name, nie eine Faltung.
 * Den Import der Rohquellen prüft `staetten-rohquellen.test.ts`, Legacys alte Tafel `settlement_place` prüft `staetten.test.ts`
 * - diese Datei prüft allein, was davon im Panel ankommt.
 *
 * 🔴 **Die Namen sind erfunden.** Legacys Inhalte sind redaktionelle Arbeit Dritter; geprüft werden Regeln, nicht Inhalte.
 *
 * Problemfälle: Die Zahl verrät die Namen; eine Art fällt in den falschen Eimer; ein fremder Host wird verlinkt; der Sprung ⊕
 * zeigt auf einen Punkt, den es nicht mehr gibt; eine Kette, die zwei Orte nennt, erscheint an beiden; eine gespeicherte
 * Beziehung verliert gegen die Kette; die Wiki-Registry fehlt oder zählt doppelt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const QUELLE = "test-sicht-b";
const KEY_A = "wiki:c68t-ort-a";
const KEY_B = "wiki:c68t-ort-b";
const ORT: DetailRequest = { kind: "place", id: C.ortA };
const ORT_B: DetailRequest = { kind: "place", id: C.ortB };
const LANDSCHAFT: DetailRequest = { kind: "area", id: C.regionA };

describeWithDatabase("Sichtbare Stätten, Lesart B (WI-0128 E18)", { timeout: 120_000 }, () => {
    let database: Database;
    let service: SubjectService;

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM site_named_place WHERE site_id IN (SELECT id FROM site WHERE source_system = ${QUELLE})`;
        await database`DELETE FROM site_settlement WHERE site_id IN (SELECT id FROM site WHERE source_system = ${QUELLE})`;
        await database`DELETE FROM site WHERE source_system = ${QUELLE}`;
        await database`DELETE FROM wiki_settlement_registry_named_place WHERE registry_id IN (
            SELECT id FROM wiki_settlement_registry WHERE source_system = ${QUELLE})`;
        await database`DELETE FROM wiki_settlement_registry WHERE source_system = ${QUELLE}`;
        await database`DELETE FROM wiki_key_assignment WHERE wiki_key IN (${KEY_A}, ${KEY_B})`;
    }

    /** Eine Stätte mit ihrer Kette; `kette` sind die Keys in der Reihenfolge des Quelltexts. */
    async function staette(felder: {
        name: string;
        art?: string | null;
        kind?: string;
        key?: string;
        url?: string | null;
        kette?: string[];
        anOrt?: string;
    }): Promise<string> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO site (source_kind, source_key, name, site_type, wiki_url, source_system)
            VALUES (${felder.kind ?? "gespeichert"}, ${felder.key ?? felder.name}, ${felder.name}, ${felder.art ?? null},
                    ${felder.url ?? null}, ${QUELLE})
            RETURNING id::text AS id
        `;
        const id = row!.id;
        for (const [position, key] of (felder.kette ?? []).entries())
            await database`
                INSERT INTO site_named_place (site_id, position, target_raw, target_key)
                VALUES (${id}::bigint, ${position}, ${key}, ${key})
            `;
        if (felder.anOrt !== undefined)
            await database`
                INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
                VALUES (${id}::bigint, ${felder.anOrt}::uuid,
                        (SELECT id FROM place WHERE public_id = ${felder.anOrt}::uuid), 'gespeichert', ${QUELLE})
            `;
        return id;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
        await cleanCatalogFixtures(database);
        await insertCatalogCarriers(database);
        await aufraeumen();
        service = createSubjectService(database);

        for (const [key, id] of [
            [KEY_A, C.ortA],
            [KEY_B, C.ortB],
        ] as const)
            await database`
                INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, is_active)
                VALUES ('siedlung', ${id}::uuid, ${key}, TRUE)
            `;

        // Sechs Zeilen an Ort A: fünf über die Kette, eine über die gespeicherte Beziehung.
        await staette({
            name: "SB Ahnentempel",
            art: "Tempel",
            kette: [KEY_A],
            url: "https://de.wiki-aventurica.de/wiki/SB%20Ahnentempel",
        });
        await staette({ name: "SB Feuertempel", art: "Tempel", kette: [KEY_A] });
        await staette({
            name: "SB Schwarze Flotte",
            art: "Flotte",
            kette: [KEY_A],
            url: "https://www.garetien.de/flotte",
        });
        await staette({ name: "SB Grosse Bibliothek", art: "Bibliothek", kette: [KEY_A] });
        // 🔴 Ohne Art: Der Rückfall „Bauwerk“ ist Anzeige und gehört der Sprachtafel, nicht der Antwort.
        await staette({ name: "SB Namenloses Haus", art: null, kette: [KEY_A] });
        await staette({ name: "SB Kanzlei", art: "Palast", anOrt: C.ortA, kette: [KEY_B] });

        // Zwei Punkte: einer steht noch auf der Karte (Sprung ⊕), einer ist stillgelegt (nie ein toter Link).
        await staette({ name: "SB Punkt auf der Karte", art: "Turm", kind: "punkt", key: C.ortB, kette: [KEY_A] });
        await staette({ name: "SB Punkt stillgelegt", art: "Turm", kind: "punkt", key: C.ortInaktiv, kette: [KEY_A] });

        // Eine Kette, die ZWEI Orte nennt: Sie gehört dem ERSTEN, also Ort B.
        await staette({ name: "SB Zwei Namen", art: "Kontor", kette: [KEY_B, KEY_A] });

        // Die Wiki-Registry zählt mit, liefert aber keine `site`-Zeile.
        const [reg] = await database<{ id: string }[]>`
            INSERT INTO wiki_settlement_registry (wiki_key, title, settlement_class, building_type, source_system, is_active)
            VALUES ('wiki:sb-registry-haus', 'SB Registerhaus', 'gebaeude', 'Kontor', ${QUELLE}, TRUE)
            RETURNING id::text AS id
        `;
        await database`
            INSERT INTO wiki_settlement_registry_named_place (registry_id, position, target_raw, target_key)
            VALUES (${reg!.id}::bigint, 0, ${KEY_A}, ${KEY_A})
        `;

        // Eine Zeile mit `building_type_excluded`: lineare Infrastruktur, die Legacys Bauwerks-Crawl als Gebäude eintrug.
        const [mauer] = await database<{ id: string }[]>`
            INSERT INTO wiki_settlement_registry (wiki_key, title, settlement_class, building_type,
                                                  building_type_excluded, source_system, is_active)
            VALUES ('wiki:sb-registry-mauer', 'SB Stadtmauer', 'gebaeude', 'Mauer', TRUE, ${QUELLE}, TRUE)
            RETURNING id::text AS id
        `;
        await database`
            INSERT INTO wiki_settlement_registry_named_place (registry_id, position, target_raw, target_key)
            VALUES (${mauer!.id}::bigint, 0, ${KEY_A}, ${KEY_A})
        `;
    });

    afterAll(async () => {
        await aufraeumen();
        await cleanCatalogFixtures(database);
        await database?.end({ timeout: 5 });
    });

    it("🔴 die Detailantwort trägt NUR die Zahl, nie die Namen", async () => {
        const detail = await service.detail(ORT);
        // Sechs über die Kette, eine über die Beziehung, zwei Punkte, dazu die beiden Registry-Zeilen.
        expect(detail?.counts?.staetten).toBe(10);
        expect(Value.Check(SubjectDetail, detail)).toBe(true);
        expect(JSON.stringify(detail)).not.toContain("SB Ahnentempel");
    });

    it("🔴 die Sektion gliedert nach ART, der leere Wert bleibt leer", async () => {
        const section = await service.staetten(ORT);
        expect(Value.Check(SubjectStaettenSection, section)).toBe(true);
        expect(section?.count).toBe(10);
        expect(new Map(section?.groups.map((group) => [group.type, group.entries.length]))).toEqual(
            new Map([
                ["", 1],
                ["Bibliothek", 1],
                ["Flotte", 1],
                ["Kontor", 1],
                ["Mauer", 1],
                ["Palast", 1],
                ["Tempel", 2],
                ["Turm", 2],
            ]),
        );
        // 🔴 Der Rückfall „Bauwerk“ steht NICHT in der Antwort.
        expect(JSON.stringify(section)).not.toContain("Bauwerk");
    });

    it("🔴 verlinkt nur die Wiki Aventurica; alles andere bleibt Text", async () => {
        const section = await service.staetten(ORT);
        const eintrag = (name: string) =>
            section?.groups.flatMap((group) => group.entries).find((candidate) => candidate.name === name);
        expect(eintrag("SB Ahnentempel")?.url).toBe("https://de.wiki-aventurica.de/wiki/SB%20Ahnentempel");
        expect(eintrag("SB Schwarze Flotte")?.url).toBeUndefined();
        expect(eintrag("SB Grosse Bibliothek")?.url).toBeUndefined();
    });

    it("🔴 der Sprung ⊕ entsteht nur, wo die Kennung einen AKTIVEN Ort trifft", async () => {
        const section = await service.staetten(ORT);
        const tuerme = section?.groups.find((group) => group.type === "Turm")?.entries ?? [];
        expect(tuerme.find((entry) => entry.name === "SB Punkt auf der Karte")?.jump).toEqual({
            kind: "place",
            id: C.ortB,
        });
        expect(tuerme.find((entry) => entry.name === "SB Punkt stillgelegt")?.jump).toBeUndefined();
    });

    it("🔴 die gespeicherte Beziehung schlägt die Kette", async () => {
        // „SB Kanzlei“ nennt Ort B, ist aber an Ort A gebunden: Sie steht bei A und nirgends sonst.
        const a = await service.staetten(ORT);
        const b = await service.staetten(ORT_B);
        expect(a?.groups.flatMap((g) => g.entries).map((e) => e.name)).toContain("SB Kanzlei");
        expect(b?.groups.flatMap((g) => g.entries).map((e) => e.name)).not.toContain("SB Kanzlei");
    });

    it("🔴 nennt die Kette zwei Orte, gilt der ERSTE - und nur er", async () => {
        const a = await service.staetten(ORT);
        const b = await service.staetten(ORT_B);
        expect(b?.groups.flatMap((g) => g.entries).map((e) => e.name)).toContain("SB Zwei Namen");
        expect(a?.groups.flatMap((g) => g.entries).map((e) => e.name)).not.toContain("SB Zwei Namen");
    });

    it("🔴 die Wiki-Registry zählt mit, Legacys gefalteter Name nicht mehr", async () => {
        const section = await service.staetten(ORT);
        expect(section?.groups.flatMap((g) => g.entries).map((e) => e.name)).toContain("SB Registerhaus");
        // Eine Zeile allein in `settlement_place` am gefalteten Namen erscheint nicht mehr.
        await database`
            INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, source_system, is_active, state)
            VALUES ('c68t ort a', 'C68T Ort A', 'SB Nur In Legacy', 'Tempel', ${QUELLE}, TRUE, 'active')
        `;
        try {
            const nachher = await service.staetten(ORT);
            expect(nachher?.count).toBe(section?.count);
            expect(JSON.stringify(nachher)).not.toContain("SB Nur In Legacy");
        } finally {
            await database`DELETE FROM settlement_place WHERE source_system = ${QUELLE}`;
        }
    });

    it("🔴 `building_type_excluded` schließt im Panel nichts aus - es ist ein Begriff der Registry", async () => {
        /*
         * 💣 Der Filter stand eine Zeit lang hier und ließ 12 Zeilen verschwinden, die Legacys sichtbare Liste zeigt -
         * Talmauer, Kaiserallee, „Kanalisation in Gareth“ und neun weitere. Gemessen auf `avesmaps3d_dev` am 2026-10-13:
         * 22 aktive Zeilen tragen das Merkmal, 12 davon zeigt Legacy heute, 16 haben eine auflösbare Kette. Das Merkmal
         * gehört in die Editoransicht der Registry (`wiki-settlement-rows.ts`), nicht in den Leser des Panels: Die Freigabe
         * lautet „Beziehung, sonst der erste genannte Ort“, und diese Zeilen erfüllen sie.
         */
        const section = await service.staetten(ORT);
        expect(section?.groups.flatMap((g) => g.entries).map((e) => e.name)).toContain("SB Stadtmauer");
    });

    it("ein Ort ohne Stätten trägt keine Zahl, eine Landschaft nie", async () => {
        expect((await service.detail({ kind: "place", id: C.ortOhneZuordnung }))?.counts?.staetten).toBeUndefined();
        expect((await service.detail(LANDSCHAFT))?.counts?.staetten).toBeUndefined();
        expect(await service.staetten(LANDSCHAFT)).toMatchObject({ count: 0, groups: [] });
    });
});
