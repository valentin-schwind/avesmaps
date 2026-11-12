import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import {
    LORE_READING,
    MapPointDetail,
    RouteStageLoreResponse,
    SubjectDetail,
    SubjectLoreSection,
} from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { importLore } from "../src/migration/lore-import.ts";
import { createSubjectService, type DetailRequest, type SubjectService } from "../src/subjects/service.ts";
import { MAP_DOMAIN } from "./support/catalog-fixture.ts";
import {
    C,
    answer,
    cleanLoreFixtures,
    entry,
    insertLoreFixtures,
    place,
    type LoreIds,
} from "./support/lore-fixture.ts";

/**
 * Der LESEPFAD der Vorkommen (WI-0091) gegen echtes PostgreSQL: die Abnahmefälle A1 bis A8 und A10 des Work Items. A9 (Telefon,
 * 360 px) ist eine Sichtprüfung und steht auf dem Abnahmeblatt (`scripts/review/vorkommen-im-panel.*`).
 *
 * 🔴 Geprüft wird vor allem, was NICHT da ist: keine Namensliste in der Detailantwort (A3), kein „(0)“ (A2, A8), kein toter
 * Objektlink (A5), keine Kontinentzeile im Ortsbezogenen (A6) und keine Zahl, die den Kontinent mitzählt (A7).
 *
 * Die Welt kommt aus der Fixture von D5 (`lore-fixture.ts`, Träger von D3/D2) und wird über den ECHTEN Import gefüllt
 * (`importLore`): So steht in `lore_place_target` genau das, was der Zug schreiben würde - der Leser bekommt keine
 * handgelegten Ziele, die es im Betrieb nicht gäbe.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Einträge: eine Pflanze, ein Tier, eine Spezies, zwei Waren - und drei Sonderfälle für die Links. */
const ALRAUNE = "p74t-alraune";
const GOBLIN = "p74t-goblin";
const ORK = "p74t-ork";
const WEIZEN = "p74t-weizen";
const LEINOEL = "p74t-leinoel";
/** Ein Eintrag, dessen EIGENER Wiki-Schlüssel genau ein Kartenobjekt trägt (A4; in Legacy ist das die Ware „Schattenstein“). */
const NAMENSGLEICH = "p68t-ort-a";
/** Ein Schlüssel, den ZWEI Orte tragen: mehrdeutig heißt kein Link (A5). */
const MEHRDEUTIG = "p68t-ort-geteilt";
/** Kontinentweite Einträge (Rang 3). */
const UEBERALL_FLORA = "p74t-ueberall-flora";
const UEBERALL_WARE = "p74t-ueberall-ware";
/** Ein Eintrag, der NUR an einem Untergebiet hängt: unter `contains` erreicht er den Ort NICHT mehr. */
const UNTERGEBIET_FLORA = "p74t-untergebiet-flora";
/** Ein Eintrag, der NUR am tiefsten Gebiet am Punkt hängt - also „Direkt von hier“, und am Kindgebiet „Aus der Region“. */
const OBERGEBIET_FLORA = "p74t-obergebiet-flora";
/** Ein Eintrag, der NUR an der Landschaft hängt, die den Ort ENTHÄLT: der Beleg für „Aus der Region“. */
const REGION_FLORA = "p74t-region-flora";

/**
 * Eine eigene Landschaft, die den Kontinentschlüssel trägt - in den echten Daten ist das die Landschaft „Aventurien“ (gemessen:
 * `aventurien` löst auf genau ein Kartenobjekt auf). Ihre Fläche liegt weit weg von allen Trägern, damit sie niemanden enthält:
 * Geprüft wird das LINKZIEL, nicht das Enthaltensein.
 */
const KONTINENT = "68000000-0000-4000-8000-0000000074a1";

/** Die Form, die diese Datei der GETEILTEN Landschaft A gibt - eigene Kennung, damit nur sie selbst sie wieder entfernt. */
const REGION_A_AREA = "68000000-0000-4000-8000-0000000074a2";

/**
 * 🔴 Ein WEG, der wirklich durch die Landschaft A und das Gebiet A LÄUFT (WI-0103, Betreiber 2026-10-07: „Wege sollen
 * abgeleitete Vorkommen haben (‚Aus der Region‘)“). Die Wege der Catalog-Fixture liegen bei y = 430 und berühren keinen
 * Träger - sie belegen den LEEREN Fall. Dieser hier ist der belegte.
 */
const WEG_DURCH = "68000000-0000-4000-8000-0000000074a3";

/**
 * 🚩 **WI-0107 F1: eine Landschaft, deren Flächen GEOS beim Vereinigen zerbrechen.** Drei Schleifen, die einander
 * überlappen - gemessen dieselbe Ausnahme wie bei den fünf echten Landschaften (`TopologyException: side location
 * conflict`), und das kleinste Gebilde, das sie auslöst: eine einzelne Schleife, ein Loch außerhalb der Schale oder
 * zwei überlappende Rechtecke tun es NICHT, GEOS räumt sie klaglos auf.
 *
 * 🔴 Die Form ist ERFUNDEN, nicht aus den Daten kopiert: Die fünf echten Flächen sind redaktionell und stehen unter dem
 * Cutoff. Was in den Daten kaputt ist, wird befundet, nicht in eine Fixture gehoben - geprüft wird der LESEPFAD.
 *
 * Sie liegt bei 450..461 / 450..459, weit weg von Ort A (400/400), dem Gipfel (420/420) und den Wegen (y = 430):
 * kein anderer Fall dieser Datei sieht sie.
 */
const KAPUTTE_FLAECHE = "68000000-0000-4000-8000-0000000074a4";
const KAPUTTE_TEILE = [
    "68000000-0000-4000-8000-0000000074a5",
    "68000000-0000-4000-8000-0000000074a6",
    "68000000-0000-4000-8000-0000000074a7",
];
const SCHLEIFEN = [
    "MULTIPOLYGON(((450 450,456 456,456 450,450 456,450 450)))",
    "MULTIPOLYGON(((453 453,459 459,459 453,453 459,453 453)))",
    "MULTIPOLYGON(((455 450,461 456,461 450,455 456,455 450)))",
];

/** Die Fläche, die die kaputte ENTHÄLT und größer ist: nur über ihren Prüfpunkt kann die kaputte etwas erben. */
const HUELLE = "68000000-0000-4000-8000-0000000074a8";
const HUELLE_AREA = "68000000-0000-4000-8000-0000000074a9";
const HUELLE_FLORA = "p74t-huelle-flora";

/**
 * 🚩 **WI-0107: eine Fläche, die sich zu NICHTS repariert** - ein Splitter ohne Flächeninhalt. `ST_MakeValid` macht daraus
 * `MULTIPOLYGON EMPTY`, `ST_X` gibt NULL, und `Number(null)` wäre **0**: Ohne Riegel prüfte die Landschaft ihr
 * Enthaltensein am Nullpunkt der Karte. Dort liegt in dieser Datei die Landschaft `NULLPUNKT` - und sie trägt einen
 * Eintrag, den der Splitter NICHT erben darf.
 */
const SPLITTER = "68000000-0000-4000-8000-0000000074b1";
const SPLITTER_AREA = "68000000-0000-4000-8000-0000000074b2";
const NULLPUNKT = "68000000-0000-4000-8000-0000000074b3";
const NULLPUNKT_AREA = "68000000-0000-4000-8000-0000000074b4";
const NULLPUNKT_FLORA = "p74t-nullpunkt-flora";

/** Die Probe, wie `areaProbe` sie vor WI-0107 rechnete: über die ROHEN Flächen. Die Gegenprobe der Fixture hängt daran. */
const ROHE_PROBE = `SELECT ST_X(ST_PointOnSurface(g)) AS x
     FROM (SELECT ST_UnaryUnion(ST_Collect(a.geom)) AS g FROM region_area a
           JOIN region r ON r.id = a.region_id
           WHERE r.public_id = $1::uuid AND a.is_active) u WHERE g IS NOT NULL`;

/**
 * 🔴 Ein ZWEITER Weg, der durch einen ANDEREN Träger läuft (WI-0106): das Gebiet B, Kind des tiefsten Gebiets am Ort. Nur mit
 * ihm lässt sich beweisen, dass eine ETAPPE aus mehreren Wegen die VEREINIGUNG erbt - mit zwei Wegen durch dieselbe Fläche
 * wäre jede Summe dieselbe Menge, und der Fall bewiese nichts.
 */
const WEG_FERN = "68000000-0000-4000-8000-0000000074c1";

const ORT: DetailRequest = { kind: "place", id: C.ortA };
const ORT_OHNE: DetailRequest = { kind: "place", id: C.ortOhneZuordnung };
const GEBIET: DetailRequest = { kind: "territory", id: C.gebietA };
const KINDGEBIET: DetailRequest = { kind: "territory", id: C.gebietB };
const LANDSCHAFT: DetailRequest = { kind: "area", id: C.regionA };
const GIPFEL: DetailRequest = { kind: "peak", id: C.gipfelA };
const ZERBROCHEN: DetailRequest = { kind: "area", id: KAPUTTE_FLAECHE };
const OHNE_PUNKT: DetailRequest = { kind: "area", id: SPLITTER };

describeWithDatabase("Die Vorkommen erscheinen im Panel (WI-0091) gegen PostgreSQL", () => {
    let database: Database;
    let service: SubjectService;
    let ids: LoreIds;
    let restoreState: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        // Die Testdaten entstehen mit dem Schreibweg des Imports; der Besitz des Bereichs ist hier nicht Gegenstand.
        legacyImportOffen();
        // 🪤 Ein kleiner Pool: der gemeinsame Entwicklungscluster lässt nur 50 Verbindungen zu.
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
        await cleanLoreFixtures(database);
        ids = await insertLoreFixtures(database);

        // Die Gebietsableitung gehört I15; der Leser braucht nur ihren Stand und zwei Formen (wie in `lore.test.ts`).
        const [state] = await database<{ derived_revision: string | null; derived_year_bf: number | null }[]>`
            SELECT derived_revision, derived_year_bf FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN}
        `;
        if (state === undefined) {
            await database`INSERT INTO territory_state (map_domain_id, derived_revision, derived_year_bf) VALUES (${MAP_DOMAIN}, '000000000091', 1040)`;
            restoreState = async () => {
                await database`DELETE FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN} AND derived_revision = '000000000091'`;
            };
        } else if (state.derived_revision === null || state.derived_year_bf === null) {
            await database`UPDATE territory_state SET derived_revision = '000000000091', derived_year_bf = 1040 WHERE map_domain_id = ${MAP_DOMAIN}`;
        }
        // Gebiet A liegt ÜBER dem Ort A (400/400), Gebiet B (sein Kind) daneben: das tiefste Gebiet am Ort ist damit A,
        // und ein Eintrag an B steht am Ort unter „Aus Untergebieten“ (Rang 1). 🪤 Die Form reicht NICHT bis zum Ort ohne
        // Zuordnung (404/400) - sonst bekäme auch er die Einträge der Untergebiete, und A8 wäre kein leerer Fall mehr.
        const shape = async (publicId: string, box: string): Promise<void> => {
            await database.unsafe(
                `INSERT INTO territory_shape (band, territory_id, depth, source_count, area, geom, render_geom, label_geom)
                 VALUES (0, $1, 0, 1, 1, ST_GeomFromText($2, 0), ST_SetSRID(ST_GeomFromText($2), 3857),
                         ST_SetSRID(ST_MakePoint(400, 400), 0))`,
                [ids.carriers[publicId] as string, box],
            );
        };
        await shape(C.gebietA, "MULTIPOLYGON(((399 399,401 399,401 401,399 401,399 399)))");
        await shape(C.gebietB, "MULTIPOLYGON(((500 500,510 500,510 510,500 510,500 500)))");
        // Die Fixture weist nur dem Gebiet B einen Wiki-Key zu; für den Vererbungstest braucht auch A einen.
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key)
            VALUES ('gebiet', ${C.gebietA}::uuid, 'wiki:p68t-gebiet-a')
        `;
        // 🔴 Die Landschaft A ENTHÄLT den Ort A (398..402 um seinen Punkt 400/400), nicht aber den Ort ohne Zuordnung (404/400)
        // und nicht den Gipfel (420/420): So trägt genau ein Gegenstand eine Gruppe „Aus der Region“, und A8 bleibt leer.
        // 💣 Die Landschaft A ist ein GETEILTER Träger (`catalog-fixture.ts`): Diese Form bekommt darum eine feste eigene
        // Kennung und wird am Ende genau an ihr wieder entfernt - nie „alle Formen dieser Landschaft“. Ein Rundumschlag
        // nähme die Form einer anderen Testdatei mit, die gleichzeitig läuft, und machte sie rot.
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (${REGION_A_AREA}, ${MAP_DOMAIN}, ${ids.carriers[C.regionA] as string},
                    ST_GeomFromText('POLYGON((398 398,402 398,402 402,398 402,398 398))', 0), TRUE)
        `;
        // Die Landschaft, die den Kontinentschlüssel trägt: das Ziel des Links „Überall in Aventurien“.
        const [kontinent] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active, wiki_url, wiki_region_key)
            VALUES (${KONTINENT}, ${MAP_DOMAIN}, 'P74T Aventurien', 'topographie', 'wald', TRUE,
                    'https://de.wiki-aventurica.de/wiki/Aventurien', 'aventurien')
            RETURNING id::text
        `;
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (gen_random_uuid(), ${MAP_DOMAIN}, ${(kontinent as { id: string }).id},
                    ST_GeomFromText('POLYGON((900 900,910 900,910 910,900 910,900 900))', 0), TRUE)
        `;
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key)
            VALUES ('landschaft', ${KONTINENT}::uuid, 'wiki:aventurien')
        `;
        // 🚩 WI-0107 F1: die kaputte Landschaft und ihre Hülle. Drei Schleifen als drei Zeilen - genau so liegen die fünf
        // echten da (Silker Hain etwa trägt vier Flächen, einzeln bricht keine, erst ihre Vereinigung).
        const [zerbrochen] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${KAPUTTE_FLAECHE}, ${MAP_DOMAIN}, 'P74T Zerbrochener Hain', 'topographie', 'wald', TRUE)
            RETURNING id::text
        `;
        for (const [at, wkt] of SCHLEIFEN.entries()) {
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${KAPUTTE_TEILE[at] as string}, ${MAP_DOMAIN}, ${(zerbrochen as { id: string }).id},
                        ST_GeomFromText(${wkt}, 0), TRUE)
            `;
        }
        // Die Hülle (440..470) enthält den Prüfpunkt der kaputten Landschaft und ist größer als sie: nur über diese
        // Schranke erbt eine Fläche überhaupt etwas (`largerRegionsAt`).
        const [huelle] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${HUELLE}, ${MAP_DOMAIN}, 'P74T Hülle', 'topographie', 'wald', TRUE)
            RETURNING id::text
        `;
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (${HUELLE_AREA}, ${MAP_DOMAIN}, ${(huelle as { id: string }).id},
                    ST_GeomFromText('POLYGON((440 440,470 440,470 470,440 470,440 440))', 0), TRUE)
        `;
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key)
            VALUES ('landschaft', ${HUELLE}::uuid, 'wiki:p74t-huelle')
        `;
        // 🚩 WI-0107: der Splitter und die Landschaft am Nullpunkt, die er NICHT erben darf.
        const [splitter] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${SPLITTER}, ${MAP_DOMAIN}, 'P74T Splitter', 'topographie', 'wald', TRUE) RETURNING id::text
        `;
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (${SPLITTER_AREA}, ${MAP_DOMAIN}, ${(splitter as { id: string }).id},
                    ST_GeomFromText('MULTIPOLYGON(((470 470,471 471,472 472,470 470)))', 0), TRUE)
        `;
        // 🪤 Die Ecke der Kartendomäne IST der Nullpunkt (`region_area_inside_domain` lässt nichts Negatives zu): Die Fläche
        // beginnt darum bei 0/0, und ein Punkt auf ihrem Rand schneidet sie.
        const [nullpunkt] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${NULLPUNKT}, ${MAP_DOMAIN}, 'P74T Nullpunkt', 'topographie', 'wald', TRUE) RETURNING id::text
        `;
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (${NULLPUNKT_AREA}, ${MAP_DOMAIN}, ${(nullpunkt as { id: string }).id},
                    ST_GeomFromText('POLYGON((0 0,20 0,20 20,0 20,0 0))', 0), TRUE)
        `;
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key)
            VALUES ('landschaft', ${NULLPUNKT}::uuid, 'wiki:p74t-nullpunkt')
        `;

        // Der Weg läuft von 399/400 nach 401/400: mitten durch die Fläche der Landschaft A (398..402) und durch die Form
        // des Gebiets A (399..401). Er trägt selbst nichts - `lore_place_target` hat keine `path_id`.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${WEG_DURCH}, ${MAP_DOMAIN}, 'P74T Weg durch die Region', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(399, 400), ST_MakePoint(401, 400)), 0), 'test', TRUE)
        `;
        // Der zweite Weg läuft mitten durch die Form des Gebiets B (500..510), die WEG_DURCH nicht berührt.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${WEG_FERN}, ${MAP_DOMAIN}, 'P74T Weg durch das Untergebiet', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(501, 505), ST_MakePoint(509, 505)), 0), 'test', TRUE)
        `;

        await importLore(
            database,
            answer({
                entries: [
                    entry(ALRAUNE, "flora", {
                        name: "P74T Alraune",
                        wiki_url: "https://de.wiki-aventurica.de/wiki/Alraune",
                    }),
                    entry(GOBLIN, "fauna", { name: "P74T Goblin", wiki_url: null }),
                    entry(ORK, "spezies", { name: "P74T Ork" }),
                    entry(WEIZEN, "ware", { name: "P74T Weizen" }),
                    entry(LEINOEL, "ware", { name: "P74T Leinöl" }),
                    entry(NAMENSGLEICH, "ware", { name: "P74T Namensgleich" }),
                    entry(MEHRDEUTIG, "ware", { name: "P74T Mehrdeutig" }),
                    entry(UEBERALL_FLORA, "flora", { name: "P74T Überall Flora" }),
                    entry(UEBERALL_WARE, "ware", { name: "P74T Überall Ware" }),
                    entry(UNTERGEBIET_FLORA, "flora", { name: "P74T Untergebiet Flora" }),
                    entry(OBERGEBIET_FLORA, "flora", { name: "P74T Obergebiet Flora" }),
                    entry(REGION_FLORA, "flora", { name: "P74T Region Flora" }),
                    entry(HUELLE_FLORA, "flora", { name: "P74T Hülle Flora" }),
                    entry(NULLPUNKT_FLORA, "flora", { name: "P74T Nullpunkt Flora" }),
                ],
                places: [
                    // Rang 0 am Ort A: alle vier Arten (A1).
                    place(ALRAUNE, "p68t-ort-a"),
                    place(GOBLIN, "p68t-ort-a"),
                    place(ORK, "p68t-ort-a", { relation: "vorkommen" }),
                    place(WEIZEN, "p68t-ort-a"),
                    // „Von hier“: eine Ware mit Relation `herkunft` steht NUR dort.
                    place(LEINOEL, "p68t-ort-a", { relation: "herkunft" }),
                    // A4 und A5: beide hängen am Ort A, ihre eigenen Schlüssel treffen ein beziehungsweise zwei Objekte.
                    place(NAMENSGLEICH, "p68t-ort-a"),
                    place(MEHRDEUTIG, "p68t-ort-a"),
                    // Hängt NUR an Gebiet B, dem Kind des tiefsten Gebiets am Ort: Unter `contains` erreicht er den Ort NICHT
                    // mehr (Information fällt herab, sie steigt nicht auf) - unter `contains-and-below` schon.
                    place(UNTERGEBIET_FLORA, "wiki:p68t-gebiet-b"),
                    place(OBERGEBIET_FLORA, "wiki:p68t-gebiet-a"),
                    // 🔴 Hängt NUR an der Landschaft, die den Ort enthält: der Beleg für „Aus der Region“.
                    place(REGION_FLORA, "p68t-region-a", { relation: "regionen" }),
                    // Kontinentweit (A6): zwei Einträge, die am Ort nur noch als LINK erscheinen.
                    place(UEBERALL_FLORA, "aventurien"),
                    place(UEBERALL_WARE, "aventurien"),
                    // Landschaft und Gipfel tragen eigene Vorkommen (gemessen: sie sind der Haupt- und ein Randfall).
                    place(ORK, "p68t-region-a", { relation: "regionen" }),
                    // 🚩 WI-0107 F1: hängt NUR an der Hülle - die kaputte Landschaft kann ihn allein über ihren
                    // Prüfpunkt erben. Bleibt er aus, taugt der Punkt nicht, auch wenn die Antwort steht.
                    place(HUELLE_FLORA, "p74t-huelle", { relation: "regionen" }),
                    place(NULLPUNKT_FLORA, "p74t-nullpunkt", { relation: "regionen" }),
                    place(WEIZEN, "p68t-gipfel-a", { relation: "regionen" }),
                ],
            }),
        );
        service = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        await database.unsafe(
            `DELETE FROM territory_shape WHERE territory_id IN (${[C.gebietA, C.gebietB]
                .map((id) => `'${ids.carriers[id] as string}'`)
                .join(",")})`,
        );
        // Die eigenen Formen und die Kontinent-Landschaft wieder weg; `cleanLoreFixtures` kennt sie nicht.
        await database`DELETE FROM lore_place_target WHERE region_id IN (SELECT id FROM region WHERE public_id = ${KONTINENT}::uuid)`;
        await database`DELETE FROM path WHERE public_id IN (${WEG_DURCH}::uuid, ${WEG_FERN}::uuid)`;
        await database`DELETE FROM region_area WHERE public_id = ${REGION_A_AREA}::uuid`;
        const eigene = [KAPUTTE_FLAECHE, HUELLE, SPLITTER, NULLPUNKT];
        await database`DELETE FROM lore_place_target WHERE region_id IN (SELECT id FROM region WHERE public_id = ANY(${eigene}::uuid[]))`;
        await database`DELETE FROM region_area WHERE public_id = ANY(${[...KAPUTTE_TEILE, HUELLE_AREA, SPLITTER_AREA, NULLPUNKT_AREA]}::uuid[])`;
        await database`DELETE FROM wiki_key_assignment WHERE object_public_id = ANY(${[HUELLE, NULLPUNKT]}::uuid[])`;
        await database`DELETE FROM region WHERE public_id = ANY(${eigene}::uuid[])`;
        await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE public_id = ${KONTINENT}::uuid)`;
        await database`DELETE FROM wiki_key_assignment WHERE object_public_id = ${KONTINENT}::uuid`;
        await database`DELETE FROM region WHERE public_id = ${KONTINENT}::uuid`;
        await restoreState?.();
        await cleanLoreFixtures(database);
        await database.end({ timeout: 5 });
    });

    /** Der Link auf die Infobox eines Vorkommens: `lore_entry.public_id` ist die Kennung, die Suche und Panel nennen (WI-0257). */
    const eintragRef = async (key: string): Promise<{ kind: "loreEntry"; id: string }> => {
        const [row] = await database<
            { public_id: string }[]
        >`SELECT public_id::text AS public_id FROM lore_entry WHERE wiki_key = ${key}`;
        expect(row, key).toBeDefined();
        return { kind: "loreEntry", id: (row as { public_id: string }).public_id };
    };

    /** Die Namen einer Zeile, egal in welcher Gruppe. */
    const namesOf = (section: SubjectLoreSection | null, kind: string): string[] =>
        (section?.rows.find((row) => row.kind === kind)?.groups ?? []).flatMap((group) =>
            group.entries.map((item) => item.name),
        );

    describe("A1 · Ein Ort mit allen vier Arten", () => {
        it("zählt alle vier Arten, und die Zahlen stimmen gegen die Datenbank", async () => {
            const detail = await service.detail(ORT);
            expect(Value.Check(SubjectDetail, detail)).toBe(true);
            // „Direkt von hier“: Alraune, Obergebiet-Flora (über das tiefste Gebiet am Punkt), Goblin, Ork, Weizen, Leinöl,
            // Namensgleich, Mehrdeutig. „Aus der Region“: die Flora der Landschaft, die den Ort enthält. Die Flora des
            // Untergebiets erreicht den Ort gar nicht mehr.
            // 🔴 Die kontinentweiten (je eine Ware und eine Flora) stehen als LINK da und zählen seit WI-0104 NICHT mit
            // (`countScope: "own"`, Betreiber 2026-10-07: „kannst du ‚überall in aventurien‘ von der zahl im header von
            // vorkommen abziehen?“). Die Zahl ist also genau die Länge der beiden Listen.
            expect(detail?.counts?.lore).toEqual({ ware: 4, fauna: 1, flora: 3, spezies: 1 });
        });

        it("die Sektion trägt vier Zeilen in Legacys Reihenfolge: Waren, Fauna, Flora, Spezies", async () => {
            const section = await service.lore(ORT);
            expect(Value.Check(SubjectLoreSection, section)).toBe(true);
            expect(section?.rows.map((row) => row.kind)).toEqual(["ware", "fauna", "flora", "spezies"]);
        });

        it("🔴 die Zahl der Zeile ist dieselbe wie im Detail - Satz und Liste kommen aus einer Regel", async () => {
            const detail = await service.detail(ORT);
            const section = await service.lore(ORT);
            for (const row of section?.rows ?? []) {
                expect(row.count, row.kind).toBe(detail?.counts?.lore?.[row.kind]);
            }
        });
    });

    describe("A2 · Ein Gegenstand ohne eine Art", () => {
        it("🔴 der Gipfel: Fauna und Spezies FEHLEN ganz - eine Art ohne jeden Inhalt steht nicht als 0 da", async () => {
            // Eigenes: eine Ware (Weizen). 🔴 Fauna und Spezies gibt es kontinentweit nicht, und der Gipfel trägt davon
            // nichts: Diese zwei Zeilen entstehen gar nicht. „Leer ist unsichtbar“ (WI-0063 5.3) gilt also weiter - der
            // Link ist nur kein leerer Inhalt. 🪤 Die Flora-Zeile STEHT, und ihre Zahl ist 0: Eigenes hat der Gipfel keine,
            // der Link trägt sie allein (WI-0104).
            expect((await service.detail(GIPFEL))?.counts?.lore).toEqual({ ware: 1, flora: 0 });
            expect((await service.lore(GIPFEL))?.rows.map((row) => row.kind)).toEqual(["ware", "flora"]);
        });

        it("🔴 die Landschaft trägt Flora und Spezies, keine Fauna", async () => {
            // Flora: die eigene (Region Flora) und die des Gebiets, das sie enthält (Obergebiet Flora) - die kontinentweite
            // steht am Link und zählt nicht. Spezies: der Ork. Waren hat sie keine eigenen, die Zeile besteht allein aus
            // dem Link und sagt darum 0. Fauna fehlt ganz.
            expect((await service.detail(LANDSCHAFT))?.counts?.lore).toEqual({ ware: 0, flora: 2, spezies: 1 });
            expect((await service.lore(LANDSCHAFT))?.rows.map((row) => row.kind)).toEqual(["ware", "flora", "spezies"]);
        });
    });

    describe("A3 · Verzögert geladen", () => {
        it("🔴 in der Detailantwort steht KEIN Name, nur die vier Zahlen", async () => {
            const detail = await service.detail(ORT);
            const text = JSON.stringify(detail);
            expect(text).not.toContain("P74T Alraune");
            expect(text).not.toContain("P74T Weizen");
            expect(detail?.counts?.lore).toBeDefined();
        });

        it("die Detailantwort wächst dadurch nur um die Zahlen (unter 200 Byte)", async () => {
            const detail = await service.detail(ORT);
            const mit = Buffer.byteLength(JSON.stringify(detail), "utf8");
            const ohne = structuredClone(detail) as { counts?: { lore?: unknown } };
            delete ohne.counts?.lore;
            expect(mit - Buffer.byteLength(JSON.stringify(ohne), "utf8")).toBeLessThan(200);
        });

        it("die Namen stehen in der Sektion", async () => {
            expect(namesOf(await service.lore(ORT), "flora")).toContain("P74T Alraune");
        });
    });

    describe("A4 · Ein Name, dessen Wiki-Schlüssel genau ein Kartenobjekt trägt", () => {
        it("🔴 wird ein Objektlink - über dieselbe Schleuse wie jeder andere Link, nie über den Namen", async () => {
            const row = (await service.lore(ORT))?.rows.find((item) => item.kind === "ware");
            const found = (row?.groups ?? [])
                .flatMap((group) => group.entries)
                .find((item) => item.name === "P74T Namensgleich");
            expect(found?.ref).toEqual({ kind: "place", id: C.ortA });
        });
    });

    describe("A5 · Ein Name ohne Kartenobjekt", () => {
        it("🔴 führt auf die Infobox des Vorkommens (`loreEntry`) und wird NIE ein toter Objektlink", async () => {
            const names = (await service.lore(ORT))?.rows.flatMap((row) =>
                row.groups.flatMap((group) => group.entries),
            );
            const goblin = names?.find((item) => item.name === "P74T Goblin");
            expect(goblin).toEqual({ name: "P74T Goblin", ref: await eintragRef(GOBLIN) });
            expect(Value.Check(SubjectLoreSection, await service.lore(ORT))).toBe(true);
        });

        it("🔴 ein mehrdeutiger Schlüssel (zwei Orte) ist KEIN Kartenobjekt-Link, der Name öffnet das Vorkommen", async () => {
            const names = (await service.lore(ORT))?.rows.flatMap((row) =>
                row.groups.flatMap((group) => group.entries),
            );
            expect(names?.find((item) => item.name === "P74T Mehrdeutig")?.ref).toEqual(await eintragRef(MEHRDEUTIG));
        });

        it("🔴 auch mit Wiki-Adresse öffnet der Name die Infobox, nicht den Artikel (der steht dort im Quellenkasten)", async () => {
            const names = (await service.lore(ORT))?.rows.flatMap((row) =>
                row.groups.flatMap((group) => group.entries),
            );
            expect(names?.find((item) => item.name === "P74T Alraune")).toEqual({
                name: "P74T Alraune",
                ref: await eintragRef(ALRAUNE),
            });
        });

        it("🔴 kein Name einer Vorkommenszeile trägt noch eine Wiki-Adresse (`url`): jeder hat ein Ziel in der Karte", async () => {
            const section = await service.lore(ORT);
            const names = section?.rows.flatMap((row) => row.groups.flatMap((group) => group.entries)) ?? [];
            expect(names.length).toBeGreaterThan(0);
            for (const name of names) {
                expect(name.url, name.name).toBeUndefined();
                expect(name.ref, name.name).toBeDefined();
            }
        });
    });

    describe("A6 · Die drei Teile: zwei Listen und ein Link", () => {
        it("🔴 „Direkt von hier“ und „Aus der Region“ stehen getrennt, in dieser Reihenfolge", async () => {
            const flora = (await service.lore(ORT))?.rows.find((row) => row.kind === "flora");
            expect(flora?.groups.map((group) => group.group)).toEqual(["here", "region"]);
            expect(flora?.groups.find((group) => group.group === "here")?.entries.map((item) => item.name)).toEqual([
                "P74T Alraune",
                "P74T Obergebiet Flora",
            ]);
            expect(flora?.groups.find((group) => group.group === "region")?.entries).toEqual([
                { name: "P74T Region Flora", ref: await eintragRef(REGION_FLORA) },
            ]);
        });

        it("„Von hier“ trennt die Herkunft: eine Ware mit Relation `herkunft` steht NUR dort", async () => {
            const ware = (await service.lore(ORT))?.rows.find((row) => row.kind === "ware");
            expect(ware?.groups.find((group) => group.group === "origin")?.entries).toEqual([
                { name: "P74T Leinöl", ref: await eintragRef(LEINOEL) },
            ]);
            expect(
                ware?.groups.find((group) => group.group === "here")?.entries.map((item) => item.name),
            ).not.toContain("P74T Leinöl");
        });

        it("🔴 „Überall in Aventurien“ ist ein LINK auf die Landschaft - und KEIN einziger Name reist mit", async () => {
            const section = await service.lore(ORT);
            const flora = section?.rows.find((row) => row.kind === "flora");
            expect(flora?.everywhere).toEqual({ ref: { kind: "area", id: KONTINENT }, count: 1 });
            // Der Beweis, dass nichts mitreist: die kontinentweiten Namen stehen nirgends in der Antwort.
            const text = JSON.stringify(section);
            expect(text).not.toContain("P74T Überall Flora");
            expect(text).not.toContain("P74T Überall Ware");
        });

        it("🔴 am Linkziel selbst gibt es keinen Link - dort sind dieselben Einträge „Direkt von hier“", async () => {
            const section = await service.lore({ kind: "area", id: KONTINENT });
            expect(section?.rows.map((row) => row.kind)).toEqual(["ware", "flora"]);
            for (const row of section?.rows ?? []) expect(row.everywhere, row.kind).toBeUndefined();
            expect(section?.rows.find((row) => row.kind === "flora")?.groups.flatMap((group) => group.entries)).toEqual(
                [{ name: "P74T Überall Flora", ref: await eintragRef(UEBERALL_FLORA) }],
            );
        });

        it("🪤 ein Eintrag steht nie zweimal: dieselbe Zeile hat keinen Namen doppelt", async () => {
            for (const request of [ORT, GEBIET, LANDSCHAFT]) {
                const section = await service.lore(request);
                for (const row of section?.rows ?? []) {
                    const names = row.groups.flatMap((group) => group.entries.map((item) => item.name));
                    expect(new Set(names).size, `${request.kind}/${row.kind}`).toBe(names.length);
                }
            }
        });
    });

    describe("A7 · Was die Zahl im Satz zählt", () => {
        it("🔴 NUR, was als Liste dasteht - der Link wird abgezogen (Betreiber 2026-10-07, WI-0104)", async () => {
            // Wörtlich: „außerdem kannst du ‚überall in aventurien‘ von der zahl im header von vorkommen abziehen?“, dazu
            // sein Soll „4 Handelswaren gelistet · Direkt hier 2 … Aus der Region 2 … Überall in Aventurien (302)“.
            expect(LORE_READING.countScope).toBe("own");
            const detail = await service.detail(ORT);
            // Flora: zwei „Direkt von hier“, eine „Aus der Region“ - die kontinentweite steht am Link und zählt nicht.
            expect(detail?.counts?.lore?.flora).toBe(3);
            const flora = (await service.lore(ORT))?.rows.find((row) => row.kind === "flora");
            expect(flora?.count).toBe(3);
            // 🔴 Satz und Liste sind Zeichen für Zeichen dasselbe: die Zahl IST die Länge der Gruppen.
            expect((flora?.groups ?? []).flatMap((group) => group.entries).length).toBe(3);
            // Die Zahl am Link steht daneben und bleibt draußen.
            expect(flora?.everywhere?.count).toBe(1);
        });

        it("🔴 die Zahl ist an JEDER Zeile die Summe ihrer Gruppen - keine Ausnahme je Art", async () => {
            for (const row of (await service.lore(ORT))?.rows ?? []) {
                expect(row.count, row.kind).toBe(row.groups.flatMap((group) => group.entries).length);
            }
        });

        it("🔴 Gegenprobe: mit `all` zählt der Satz den Link MIT - die Umstellung ist EINE Zeile", async () => {
            const vorher = LORE_READING.countScope;
            try {
                LORE_READING.countScope = "all";
                expect((await service.detail(ORT))?.counts?.lore?.flora).toBe(4);
                expect((await service.lore(ORT))?.rows.find((row) => row.kind === "flora")?.count).toBe(4);
            } finally {
                LORE_READING.countScope = vorher;
            }
        });

        it("💣 am Linkziel selbst zählt der Kontinent NICHT doppelt - dort steht er schon als Liste", async () => {
            // Die Landschaft, die den Kontinentschlüssel trägt, hat ihre kontinentweiten Einträge als „Direkt von hier“.
            // Ohne die Bedingung „nur wo der Link auch steht“ stünden sie zusätzlich in der Zahl: 2 statt 1.
            const section = await service.lore({ kind: "area", id: KONTINENT });
            for (const row of section?.rows ?? []) {
                expect(row.everywhere, row.kind).toBeUndefined();
                expect(row.count, row.kind).toBe(row.groups.flatMap((group) => group.entries).length);
            }
        });

        it("🔴 die Lesart der Kontinentzeilen steht an derselben EINEN Stelle und wirkt auf die Zahl am Link", async () => {
            const vorher = LORE_READING.continentReading;
            try {
                // `replacing`: ein Eintrag, der zusätzlich einzelne Orte nennt, gilt nicht mehr überall. Beide kontinentweiten
                // Einträge der Fixture nennen keinen Ort und bleiben.
                LORE_READING.continentReading = "replacing";
                const flora = (await service.lore(ORT))?.rows.find((row) => row.kind === "flora");
                expect(flora?.everywhere?.count).toBe(1);
            } finally {
                LORE_READING.continentReading = vorher;
            }
        });
    });

    describe("A8 / A11 · Ein Gegenstand ohne Eigenes und ohne Regionales", () => {
        it("🔴 bekommt die LINKZEILE - „Überall in Aventurien“ steht überall (Betreiber 2026-10-07)", async () => {
            // Wörtlich: „und ‚Überall in Aventurien‘ muss natürlich auch überall stehen, wenns in Aventurien ist :)“.
            // 🪤 Das dreht A11 um: Bis zum 2026-10-07 bekam dieser Ort KEINE Zeile („leer ist unsichtbar“). Die Zeile ist
            // aber nicht leer - sie trägt den Link. Der Ort ohne Zuordnung (404/400) liegt außerhalb jeder Fläche und
            // jedes Gebiets; kontinentweit gelten für ihn je eine Ware und eine Flora.
            const detail = await service.detail(ORT_OHNE);
            // 🔴 DER GRENZFALL VON WI-0104: Der Satz zählt nur die Listen, und die sind leer - die Zahl ist 0.
            expect(detail?.counts?.lore).toEqual({ ware: 0, flora: 0 });
            const rows = (await service.lore(ORT_OHNE))?.rows ?? [];
            expect(rows.map((row) => row.kind)).toEqual(["ware", "flora"]);
            // 🔴 Die Zeile trägt NUR den Link: keine einzige Gruppe, Zähler 0, und die Zahl am Ziel steht am Link.
            expect(rows[0]?.groups).toEqual([]);
            expect(rows[0]?.count).toBe(0);
            expect(rows[0]?.everywhere).toEqual({ ref: { kind: "area", id: KONTINENT }, count: 1 });
        });

        it("🔴 UND SIE VERSCHWINDET NICHT - „leer ist unsichtbar“ greift hier NICHT (WI-0104)", async () => {
            // 💣 Die Zeile hängt seit WI-0104 an `loreRowStands`, nicht an ihrer Zahl. Hinge sie weiter an `count > 0`,
            // nähme die 0 die Betreiberentscheidung vom 2026-10-07 still zurück („und ‚Überall in Aventurien‘ muss
            // natürlich auch überall stehen, wenns in Aventurien ist :)“). Das ist der Fall, der das verhindert.
            const rows = (await service.lore(ORT_OHNE))?.rows ?? [];
            expect(rows.length).toBe(2);
            for (const row of rows) {
                expect(row.count, row.kind).toBe(0);
                expect(row.groups, row.kind).toEqual([]);
                expect(row.everywhere, row.kind).toBeDefined();
            }
            // Die Detailantwort trägt die Art ebenfalls - ohne sie baute das Panel die Zeile nicht.
            expect(Object.keys((await service.detail(ORT_OHNE))?.counts?.lore ?? {})).toEqual(["ware", "flora"]);
        });

        it("🔴 Gegenprobe mit `all`: dann steht dort die Zahl des Links, nicht die 0", async () => {
            // Belegt, dass die Zeile NICHT an einer zweiten Stelle festgehalten wird: Nur die ZAHL hängt an `countScope`,
            // das Dasein der Zeile an `loreRowStands` - und beide Lesarten liefern dieselben zwei Zeilen.
            const vorher = LORE_READING.countScope;
            try {
                LORE_READING.countScope = "all";
                expect((await service.detail(ORT_OHNE))?.counts?.lore).toEqual({ ware: 1, flora: 1 });
                expect((await service.lore(ORT_OHNE))?.rows.map((row) => row.count)).toEqual([1, 1]);
            } finally {
                LORE_READING.countScope = vorher;
            }
        });

        it("🔴 eine Art, die es auch kontinentweit nicht gibt, bleibt weg: kein „(0)“ (WI-0063 5.3)", async () => {
            const rows = (await service.lore(ORT_OHNE))?.rows ?? [];
            expect(rows.map((row) => row.kind)).not.toContain("fauna");
            expect(rows.map((row) => row.kind)).not.toContain("spezies");
        });

        it("ein Gegenstand, den es nicht gibt, antwortet mit `null` (die Route macht daraus 404)", async () => {
            expect(await service.lore({ kind: "place", id: "80000000-0000-4000-8000-0000000000ff" })).toBeNull();
        });
    });

    describe("🔴 Der WEG erbt, was seine Linie enthält (WI-0103, Betreiber 2026-10-07)", () => {
        const WEG: DetailRequest = { kind: "path", anchor: WEG_DURCH };

        it("🔴 nur „Aus der Region“ - ein Weg kann strukturell nichts Eigenes tragen", async () => {
            const section = await service.lore(WEG);
            expect(Value.Check(SubjectLoreSection, section)).toBe(true);
            // Der Weg läuft durch die Landschaft A (Region Flora, Ork) und durch das Gebiet A (Obergebiet Flora).
            const flora = section?.rows.find((row) => row.kind === "flora");
            expect(flora?.groups.map((group) => group.group)).toEqual(["region"]);
            expect(flora?.groups[0]?.entries.map((item) => item.name).sort()).toEqual([
                "P74T Obergebiet Flora",
                "P74T Region Flora",
            ]);
            // 🔴 Keine Gruppe `here` und keine Gruppe `origin`, an keiner Zeile: `lore_place_target` hat keine `path_id`,
            // und der CHECK `lore_place_target_one_target` erzwingt genau eines von Ort, Gebiet, Region, Gipfel.
            for (const row of section?.rows ?? []) {
                expect(
                    row.groups.map((group) => group.group),
                    row.kind,
                ).not.toContain("here");
                expect(
                    row.groups.map((group) => group.group),
                    row.kind,
                ).not.toContain("origin");
            }
        });

        it("🔴 und die Linkzeile - ein Weg liegt genauso in Aventurien wie alles andere", async () => {
            const section = await service.lore(WEG);
            expect(section?.rows.map((row) => row.kind)).toEqual(["ware", "flora", "spezies"]);
            // Ware: nichts Eigenes, nichts Regionales - die Zeile besteht allein aus dem Link und sagt darum 0.
            const ware = section?.rows.find((row) => row.kind === "ware");
            expect(ware?.groups).toEqual([]);
            expect(ware?.count).toBe(0);
            expect(ware?.everywhere).toEqual({ ref: { kind: "area", id: KONTINENT }, count: 1 });
            // Spezies gibt es kontinentweit nicht: dort steht nur das Geerbte, ohne Link.
            const spezies = section?.rows.find((row) => row.kind === "spezies");
            expect(spezies?.everywhere).toBeUndefined();
            expect(spezies?.count).toBe(1);
        });

        it("🔴 die Zahl steht auch im Detail des Wegs - sonst gäbe es die Zeile im Panel nicht", async () => {
            const detail = await service.detail(WEG);
            expect(detail?.counts?.lore).toEqual({ ware: 0, flora: 2, spezies: 1 });
            // A3 gilt am Weg genauso: kein Name in der Detailantwort.
            expect(JSON.stringify(detail)).not.toContain("P74T Region Flora");
        });

        it("🪤 ein Weg, der keinen Träger berührt, hat trotzdem die Linkzeile - und keine Gruppe", async () => {
            // Die Wege der Catalog-Fixture liegen bei y = 430, weit weg von jedem Träger.
            const section = await service.lore({ kind: "path", anchor: C.wegA1 });
            expect(section?.rows.map((row) => row.kind)).toEqual(["ware", "flora"]);
            for (const row of section?.rows ?? []) {
                expect(row.groups, row.kind).toEqual([]);
                expect(row.count, row.kind).toBe(0);
                expect(row.everywhere?.count, row.kind).toBe(1);
            }
        });
    });

    describe("🔴 Die ROUTENETAPPE erbt aus ihrer ganzen Wegkette (WI-0106, Betreiber 2026-10-07)", () => {
        /**
         * Was im Zählsatz stehen MUSS, abgeleitet aus `LORE_READING.countScope` - nicht abgeschrieben.
         *
         * 🔴 Die Lesart gehört dem Betreiber und hat sich am 2026-10-07 schon einmal gedreht (WI-0103 `all`, WI-0104 `own`).
         * Eine festgeschriebene Zahl wäre hier nur eine zweite Stelle, die mit ihr auseinanderläuft.
         */
        const rowCountOf = (own: number, everywhere: number): number =>
            own + (LORE_READING.countScope === "all" ? everywhere : 0);

        /** Alle Namen einer Antwort, egal in welcher Gruppe und Zeile. */
        const namen = (rows: readonly { groups: readonly { entries: readonly { name: string }[] }[] }[]): string[] =>
            rows
                .flatMap((row) => row.groups.flatMap((group) => group.entries.map((item) => item.name)))
                .sort()
                .filter((name, at, all) => all.indexOf(name) === at);

        it("🔴 EINE Etappe über EINEN Weg antwortet Zeichen für Zeichen wie der Weg selbst - dieselbe Stelle", async () => {
            const stage = await service.stageLore([WEG_DURCH]);
            expect(Value.Check(RouteStageLoreResponse, stage)).toBe(true);
            const path = await service.lore({ kind: "path", anchor: WEG_DURCH });
            // 🔴 Der Beweis, dass die Etappe KEINE zweite Rechnung bekommen hat: Die Zeilen sind dieselben.
            expect(stage.rows).toEqual(path?.rows);
        });

        it("🔴 eine Etappe aus ZWEI Wegen erbt die VEREINIGUNG, und keiner der beiden allein", async () => {
            const beide = await service.stageLore([WEG_DURCH, WEG_FERN]);
            const durch = await service.stageLore([WEG_DURCH]);
            const fern = await service.stageLore([WEG_FERN]);
            // Der eine Weg läuft durch Landschaft A und Gebiet A, der andere durch Gebiet B.
            expect(namen(durch.rows)).toEqual(["P74T Obergebiet Flora", "P74T Ork", "P74T Region Flora"]);
            expect(namen(fern.rows)).toEqual(["P74T Untergebiet Flora"]);
            expect(namen(beide.rows)).toEqual([
                "P74T Obergebiet Flora",
                "P74T Ork",
                "P74T Region Flora",
                "P74T Untergebiet Flora",
            ]);
            // 🪤 Jeder Eintrag steht EINMAL, auch wenn zwei Wege denselben Träger berühren (`place()` entscheidet je Eintrag).
            const doppelt = await service.stageLore([WEG_DURCH, WEG_DURCH]);
            expect(doppelt.rows).toEqual(durch.rows);
        });

        it("🔴 nie „Direkt von hier“ und nie „Von hier“ - wie am Weg, und aus demselben Grund (Schema)", async () => {
            const stage = await service.stageLore([WEG_DURCH, WEG_FERN]);
            // 🪤 Entweder genau „Aus der Region“ oder GAR keine Gruppe (dann ist der Link der ganze Inhalt der Zeile) -
            // nie `here`, nie `origin`, an keiner der vier Zeilen.
            for (const row of stage.rows) {
                const groups = row.groups.map((group) => group.group);
                expect(groups.length === 0 || groups.join() === "region", `${row.kind}: ${groups.join()}`).toBe(true);
            }
        });

        it("🪤 eine Etappe OHNE Weg (Querfeldein, freie Seefahrt) hat nur die Linkzeile - und keine Gruppe", async () => {
            const stage = await service.stageLore([]);
            expect(Value.Check(RouteStageLoreResponse, stage)).toBe(true);
            // 🔴 Gemessen: 8 von 73 Etappen einer Reise tragen keinen einzigen Wegabschnitt. Sie bekommen trotzdem Zeilen,
            // weil „Überall in Aventurien“ seit dem 2026-10-07 überall steht.
            expect(stage.rows.map((row) => row.kind)).toEqual(["ware", "flora"]);
            for (const row of stage.rows) {
                expect(row.groups, row.kind).toEqual([]);
                expect(row.everywhere?.ref, row.kind).toEqual({ kind: "area", id: KONTINENT });
                // 🪤 **Keine Zahl festgeschrieben**: Ob der Satz den Link mitzählt, entscheidet `LORE_READING.countScope`
                // (WI-0104, heute `own`, also 0; mit `all` wäre es 1). Die Zusicherung dieses Falls ist, DASS die Zeile
                // dasteht und ihr ganzer Inhalt der Link ist - nicht, was im Satz steht.
                expect(row.count, row.kind).toBe(rowCountOf(0, 1));
            }
        });

        it("🪤 ein Weg, der es nicht gibt, ist kein Fehler - er trägt nur keine Geometrie bei", async () => {
            const fremd = "68000000-0000-4000-8000-0000000074ff";
            expect((await service.stageLore([fremd])).rows).toEqual((await service.stageLore([])).rows);
            expect((await service.stageLore([WEG_DURCH, fremd])).rows).toEqual(
                (await service.stageLore([WEG_DURCH])).rows,
            );
        });
    });

    describe("🔴 Der KARTENPUNKT „Was ist hier?“ trägt die Vorkommen seiner Flächen (WI-0110, Editoren 2026-10-08)", () => {
        it("🔴 die Antwort des Punkts trägt die Zeilen MIT - ein Kartenpunkt hat keine Sektionsadresse", async () => {
            const point = await service.mapPoint(400, 400);
            expect(
                Value.Check(MapPointDetail, point),
                JSON.stringify([...Value.Errors(MapPointDetail, point)].slice(0, 2)),
            ).toBe(true);
            expect(point.lore?.map((row) => row.kind)).toEqual(["ware", "flora", "spezies"]);
        });

        it("⭐ DIESELBE Stelle wie der Weg durch denselben Punkt - Zeichen für Zeichen, keine zweite Fassung", async () => {
            // Der Weg läuft von 399/400 nach 401/400, also DURCH diesen Punkt: dieselbe Landschaft A, dasselbe Gebiet A.
            // 🔴 Der Beweis, dass `LoreSpot` den Punktfall nimmt und nicht eine zweite Rechnung entstanden ist.
            const point = await service.mapPoint(400, 400);
            const path = await service.lore({ kind: "path", anchor: WEG_DURCH });
            expect(point.lore).toEqual(path?.rows);
        });

        it("🔴 nur „Aus der Region“ und der Link, nie „Direkt von hier“ - eine Koordinate ist kein Lore-Ziel", async () => {
            const point = await service.mapPoint(400, 400);
            // 🪤 Am ORT 400/400 liegt Ort A mit allen vier Arten als „Direkt von hier“ - der Kartenpunkt übernimmt davon
            // NICHTS. `lore_place_target` kennt Ort, Gebiet, Region und Gipfel, keine Koordinate.
            for (const row of point.lore ?? []) {
                const groups = row.groups.map((group) => group.group);
                expect(groups.length === 0 || groups.join() === "region", `${row.kind}: ${groups.join()}`).toBe(true);
            }
            expect(JSON.stringify(point)).not.toContain("P74T Goblin");
            // Gegenprobe am Ort selbst: dort steht derselbe Eintrag sehr wohl.
            expect(JSON.stringify(await service.lore(ORT))).toContain("P74T Goblin");
        });

        it("🔴 ALLE Gebiete am Punkt stehen in „Aus der Region“ - keines wird als „tiefstes“ ausgezeichnet", async () => {
            const point = await service.mapPoint(400, 400);
            const flora = point.lore?.find((row) => row.kind === "flora");
            // Gebiet A (Obergebiet Flora) und Landschaft A (Region Flora) - und das tiefste Gebiet am Ort bleibt nicht
            // als eigene Gruppe übrig, wie es am ORT geschieht.
            expect(flora?.groups.map((group) => group.group)).toEqual(["region"]);
            expect(flora?.groups[0]?.entries.map((item) => item.name).sort()).toEqual([
                "P74T Obergebiet Flora",
                "P74T Region Flora",
            ]);
        });

        it("🪤 ein Punkt ohne jeden Träger hat trotzdem die Linkzeile - „Überall in Aventurien“ steht überall", async () => {
            // 430/430 liegt neben allem: die Wege der Catalog-Fixture liegen dort, und keiner berührt einen Träger.
            const leer = await service.mapPoint(430, 430);
            expect(leer.lore?.map((row) => row.kind)).toEqual(["ware", "flora"]);
            for (const row of leer.lore ?? []) {
                expect(row.groups, row.kind).toEqual([]);
                expect(row.everywhere?.ref, row.kind).toEqual({ kind: "area", id: KONTINENT });
                // 🪤 Keine Zahl festgeschrieben: Ob der Satz den Link mitzählt, entscheidet `LORE_READING.countScope`
                // (heute `own`, also 0). Zugesichert ist, DASS die Zeile dasteht - der Wortlaut bei 0 liegt beim Betreiber.
                expect(row.count, row.kind).toBe(LORE_READING.countScope === "all" ? 1 : 0);
            }
        });

        it("🪤 die Ansicht (`layers`) formt die Landschaften der Auskunft, nicht die Vorkommen", async () => {
            // 🔴 Dieselbe Begründung wie bei Gebietskette und Klimaband: Was in einer Fläche vorkommt, beschreibt die
            // STELLE, nicht das Kartenbild. Eine Ansicht ohne die Ebene der Landschaft A lässt die Zeilen unberührt.
            const alle = await service.mapPoint(400, 400);
            const nurVegetation = await service.mapPoint(400, 400, ["vegetation"]);
            expect(nurVegetation.lore).toEqual(alle.lore);
        });

        it("🪤 zwei Hundertstel in derselben Hundertstel sind dieselbe Antwort (die Kennung ist gerundet)", async () => {
            expect((await service.mapPoint(400.001, 400.004)).lore).toEqual((await service.mapPoint(400, 400)).lore);
        });
    });

    describe("🔴 Aus der Region · Enthaltensein statt Bindung (Betreiber 2026-10-06)", () => {
        /** Alle Namen einer Sektion, egal in welcher Gruppe. */
        const namen = (section: Awaited<ReturnType<SubjectService["lore"]>>): string[] =>
            (section?.rows ?? []).flatMap((row) =>
                row.groups.flatMap((group) => group.entries.map((item) => item.name)),
            );

        it("🔴 ein Ort listet, was der Fläche gehört, die ihn ENTHÄLT - „altenmohn ist im herz des kontinents“", async () => {
            const flora = (await service.lore(ORT))?.rows.find((row) => row.kind === "flora");
            expect(flora?.groups.find((group) => group.group === "region")?.entries).toEqual([
                { name: "P74T Region Flora", ref: await eintragRef(REGION_FLORA) },
            ]);
        });

        it("🔴 Information fällt herab: am Kindgebiet B steht der Eintrag seines Elterngebiets A", async () => {
            const unten = await service.lore(KINDGEBIET);
            expect(
                unten?.rows
                    .find((row) => row.kind === "flora")
                    ?.groups.filter((group) => group.group === "region")
                    .flatMap((group) => group.entries.map((item) => item.name)),
            ).toEqual(["P74T Obergebiet Flora"]);
        });

        it("🔴 und umgekehrt NICHT: der Eintrag des Kindes steht am Elterngebiet nicht mehr", async () => {
            // 🪤 Das ist die UMKEHRUNG von Legacys Regel „Information steigt auf“ (Owner 2026-07-21). Der Widerspruch ist
            // benannt, nicht still aufgelöst: `LORE_READING.regionReading` trägt beide Richtungen (WI-0091 §7).
            expect(namen(await service.lore(GEBIET))).not.toContain("P74T Untergebiet Flora");
            expect(namen(await service.lore(KINDGEBIET))).toContain("P74T Untergebiet Flora");
        });

        it("🔴 der Umschalter auf Legacys Richtung ist EINE Zeile", async () => {
            const vorher = LORE_READING.regionReading;
            try {
                LORE_READING.regionReading = "contains-and-below";
                expect(namen(await service.lore(GEBIET))).toContain("P74T Untergebiet Flora");
                expect(namen(await service.lore(ORT))).toContain("P74T Untergebiet Flora");
            } finally {
                LORE_READING.regionReading = vorher;
            }
        });

        it("🪤 ein Gegenstand außerhalb der Fläche erbt nichts von ihr", async () => {
            // Der Gipfel (420/420) liegt weder in der Landschaft A (398..402) noch in einem Gebiet: er trägt nur sein Eigenes.
            const section = await service.lore(GIPFEL);
            expect(namen(section)).toEqual(["P74T Weizen"]);
        });
    });

    describe("🚩 WI-0107 F1 · Eine Landschaft, deren Flächen GEOS beim Vereinigen zerbrechen", () => {
        it("🪤 ZUERST die Gegenprobe: die alte Rechnung bricht an dieser Form wirklich", async () => {
            // Ohne diesen Fall prüfte der nächste nichts: Eine Fixture, die GEOS klaglos schluckt, wäre immer grün.
            await expect(database.unsafe(ROHE_PROBE, [KAPUTTE_FLAECHE])).rejects.toThrow(/TopologyException/);
        });

        it("🔴 die Landschaft ANTWORTET - vor WI-0107 war sie ein 500, und zwar seit WI-0091", async () => {
            // Gemessen am 2026-10-08: fünf echte Landschaften (Düsterholz, Tal des Nader, Silker Hain, Vorgebirge der
            // Drachensteine, Farindelwald) fielen so aus. Der Fehler reiste aus `areaProbe` ungebremst bis zur Route.
            const detail = await service.detail(ZERBROCHEN);
            expect(Value.Check(SubjectDetail, detail)).toBe(true);
            const section = await service.lore(ZERBROCHEN);
            expect(Value.Check(SubjectLoreSection, section)).toBe(true);
        });

        it("🔴 und ihr Prüfpunkt TAUGT: sie erbt, was die Fläche trägt, die sie enthält", async () => {
            // Eine bloß gefangene Ausnahme gäbe auch eine Antwort - aber eine ohne jedes Geerbte. Dieser Fall
            // unterscheidet die Reparatur vom Auffangen.
            const flora = (await service.lore(ZERBROCHEN))?.rows.find((row) => row.kind === "flora");
            expect(flora?.groups.find((group) => group.group === "region")?.entries).toEqual([
                { name: "P74T Hülle Flora", ref: await eintragRef(HUELLE_FLORA) },
            ]);
            // 🪤 Die Ware steht mit 0 daneben: ihre Zeile besteht allein aus der Linkzeile (WI-0104), und die steht überall.
            expect((await service.detail(ZERBROCHEN))?.counts?.lore).toEqual({ ware: 0, flora: 1 });
        });

        it("💣 eine Fläche, die sich zu NICHTS repariert, erbt NICHTS - nicht, was am Nullpunkt liegt", async () => {
            // `ST_X` eines leeren Gebildes ist NULL, und `Number(null)` ist 0. Ohne den Riegel `NOT ST_IsEmpty` prüfte der
            // Splitter sein Enthaltensein bei 0/0 und erbte die Flora der Landschaft, die dort liegt.
            const section = await service.lore(OHNE_PUNKT);
            expect(Value.Check(SubjectLoreSection, section)).toBe(true);
            expect(
                (section?.rows ?? []).flatMap((row) => row.groups.flatMap((group) => group.entries.map((e) => e.name))),
            ).toEqual([]);
            expect(JSON.stringify(section)).not.toContain("P74T Nullpunkt Flora");
        });
    });

    describe("A10 · Derselbe Gegenstand zweimal", () => {
        it("liefert dieselbe Antwort (der Zwischenspeicher sitzt im Panel, der Server bleibt zustandslos)", async () => {
            const first = await service.lore(ORT);
            const second = await service.lore(ORT);
            expect(second).toEqual(first);
        });
    });
});
