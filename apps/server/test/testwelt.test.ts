import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { acquireDeriveLock, DeriveBusyError } from "../src/derive/derive-lock.ts";
import { mapOperation, type MapActor } from "../src/editor/map-operation.ts";
import { testweltOffen, testweltZuruecksetzen } from "../src/editor/testwelt.ts";

/**
 * Die Testwelt zurücksetzen (WI-0128 E14; EDIT-0001 W7, N3, §7.1 E14) gegen echtes PostgreSQL (\`avesmaps3d_test\`), in einer EIGENEN
 * Domäne: Das Zurücksetzen räumt die ganze Domäne, und andere Testdateien schreiben gleichzeitig in \`aventuria\`.
 *
 * Problemfälle: Ein neuer Ort überlebt den Zug; eine vom Editor stillgelegte Einzelheit bleibt geschützt und der Import belebt sie nie
 * wieder; das Protokoll der Testwelt wächst über die Tage; der Zug überspringt den Import, obwohl jemand bearbeitet hat (\`offen\`).
 * Landschaften (WI-0178 B4): Eine neue Landschaft, eine eigene Teilfläche oder Beschriftung an einer Legacy-Landschaft überlebt den
 * Zug; der Grad der Kurve bleibt, weil Legacy ihn nicht kennt. Kraftlinien (WI-0205 K4): Ein eigener Abschnitt oder Kraftlinienpunkt
 * überlebt den Zug; ein Legacy-Abschnitt wird mit stillgelegt. Wege (WI-0177 „Neuer Weg“): Ein neuer Weg überlebt den Zug.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAIN = "wi0128-e14";
const SOURCE = "test-wi0128-e14";
const ALT = "e14e14e1-0000-4000-8000-000000000001";
const NEU = "e14e14e1-0000-4000-8000-000000000002";
// Landschaften (B4): eine aus „Legacy“ mit eigener Beschriftung und gesetztem Kurvengrad, eine ganz eigene mit Fläche und Beschriftung.
const LANDSCHAFT_ALT = "e14e14e1-0000-4000-8000-0000000000b1";
const LANDSCHAFT_NEU = "e14e14e1-0000-4000-8000-0000000000b2";
const FLAECHE_NEU = "e14e14e1-0000-4000-8000-0000000000b3";
const BESCHRIFTUNG_ALT = "e14e14e1-0000-4000-8000-0000000000b4";
const BESCHRIFTUNG_EIGEN = "e14e14e1-0000-4000-8000-0000000000b5";
const BESCHRIFTUNG_NEU = "e14e14e1-0000-4000-8000-0000000000b6";
// Kraftlinien (WI-0205 K4): ein Abschnitt aus „Legacy“, ein eigener, ein eigener Kraftlinienpunkt.
const KRAFTLINIE_ALT = "e14e14e1-0000-4000-8000-0000000000c1";
const KRAFTLINIE_NEU = "e14e14e1-0000-4000-8000-0000000000c2";
const PUNKT_NEU = "e14e14e1-0000-4000-8000-0000000000c3";
// Herrschaftsgebiete (WI-0209 B4): ein Gebiet aus „Legacy“ mit eigener Fläche, ein ganz eigenes mit Fläche.
const GEBIET_ALT = "e14e14e1-0000-4000-8000-0000000000d1";
const GEBIET_NEU = "e14e14e1-0000-4000-8000-0000000000d2";
const GEBIETSFLAECHE_ALT = "e14e14e1-0000-4000-8000-0000000000d3";
const GEBIETSFLAECHE_EIGEN = "e14e14e1-0000-4000-8000-0000000000d4";
const GEBIETSFLAECHE_NEU = "e14e14e1-0000-4000-8000-0000000000d5";
// Wege (WI-0177 „Neuer Weg“): einer aus „Legacy“, ein neuer, dazu einer aus „Legacy“, den ein Editor von der Karte nahm (Stufe 3b).
const WEG_ALT = "e14e14e1-0000-4000-8000-0000000000e1";
const WEG_NEU = "e14e14e1-0000-4000-8000-0000000000e2";
const WEG_AB = "e14e14e1-0000-4000-8000-0000000000e3";
// Gipfel (WI-0178 P7 „▲ Gipfel setzen …“): einer aus „Legacy“, ein neuer.
const GIPFEL_ALT = "e14e14e1-0000-4000-8000-0000000000f1";
const GIPFEL_NEU = "e14e14e1-0000-4000-8000-0000000000f2";
const actor: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

describeWithDatabase("Testwelt zurücksetzen (WI-0128 E14)", { timeout: 120_000 }, () => {
    let database: Database;
    /** Die Operation, die eine Rücknahme der Vorbereitung zurücknimmt (`map_operation_revert_link`). */
    let zurueckgenommen = "";

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM job_event WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM map_audit_event WHERE operation_id IN (SELECT operation_id FROM map_operation WHERE map_domain_id = ${DOMAIN})`;
        await database`DELETE FROM map_operation WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM place_detail WHERE place_id IN (SELECT id FROM place WHERE map_domain_id = ${DOMAIN})`;
        await database`DELETE FROM wiki_key_assignment WHERE object_public_id IN (SELECT public_id FROM place WHERE map_domain_id = ${DOMAIN})`;
        await database`DELETE FROM place_unplaced WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM place WHERE map_domain_id = ${DOMAIN}`;
        await database`UPDATE region SET primary_label_id = NULL WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM map_label WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM region_area WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM region WHERE map_domain_id = ${DOMAIN}`;
        await database`
            DELETE FROM powerline_wiki_assignment WHERE powerline_id IN (SELECT id FROM powerline WHERE map_domain_id = ${DOMAIN})
        `;
        await database`
            DELETE FROM wiki_key_assignment WHERE legacy_art = 'kraftlinie'
               AND object_public_id IN (SELECT public_id FROM powerline WHERE map_domain_id = ${DOMAIN})
        `;
        await database`DELETE FROM powerline WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM nodix WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM territory_area WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM territory WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM path WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_peak WHERE map_domain_id = ${DOMAIN}`;
    }

    /** Eine Operation des Editors an der Legacy-Landschaft (Kurvengrad), über dieselbe Schreibnaht. */
    const bearbeiteLandschaft = () =>
        mapOperation(
            database,
            actor,
            { operationId: randomUUID(), operation: "landscape.update", mapDomainId: DOMAIN, body: { curveDegree: 4 } },
            async (tx) => {
                const [landschaft] = await tx<{ revision: number }[]>`
                    UPDATE region SET label_curve_degree = 4 WHERE public_id = ${LANDSCHAFT_ALT}::uuid RETURNING revision::int AS revision
                `;
                return {
                    receipt: { affected: [], derivedWork: [], warnings: [] },
                    entries: [
                        {
                            action: "region.updated",
                            regionId: LANDSCHAFT_ALT,
                            revisionAfter: landschaft!.revision,
                            changes: { curveDegree: { before: null, after: 4 } },
                        },
                    ],
                };
            },
        );

    /**
     * Eine Operation des Editors am alten Ort (ein neuer Name), über die Schreibnaht wie im Ortseditor. Mit `zurueck` eine Rücknahme dieser
     * Operation (Quelle restore, `reverts` im Körper wie im Verlauf): Sie legt eine Zeile in `map_operation_revert_link` an.
     */
    const bearbeite = (name: string, zurueck?: string) =>
        mapOperation(
            database,
            actor,
            {
                operationId: randomUUID(),
                operation: "place.update",
                mapDomainId: DOMAIN,
                body: { name, ...(zurueck === undefined ? {} : { reverts: zurueck }) },
                ...(zurueck === undefined ? {} : { source: "restore" as const }),
            },
            async (tx) => {
                const [ort] = await tx<{ revision: number }[]>`
                    UPDATE place SET name = ${name} WHERE public_id = ${ALT}::uuid RETURNING revision::int AS revision
                `;
                return {
                    receipt: {
                        affected: [{ kind: "place", id: ALT, revision: ort!.revision }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [
                        { action: "place.updated", placeId: ALT, changes: { name: { before: "Alt", after: name } } },
                    ],
                };
            },
        );

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await database`
            INSERT INTO map_domain
            SELECT (jsonb_populate_record(NULL::map_domain, to_jsonb(m) || ${database.json({ id: DOMAIN })})).*
            FROM map_domain m WHERE m.id = 'aventuria'
            ON CONFLICT (id) DO NOTHING
        `;
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ALT}::uuid, ${DOMAIN}, 'Alt', 'stadt', ST_SetSRID(ST_MakePoint(431, 432), 0), ${SOURCE}, TRUE),
                   (${NEU}::uuid, ${DOMAIN}, 'Neu', 'dorf', ST_SetSRID(ST_MakePoint(433, 436), 0), 'avesmaps3d', TRUE)
        `;
        // Am alten Ort hat der Editor alle Felder geleert (stillgelegt, geschützt); am neuen eine Zeile angelegt.
        await database`
            INSERT INTO place_detail (place_id, description, source_system, is_active, retired_at, retired_origin)
            SELECT id, NULL, ${SOURCE}, FALSE, now(), 'editor' FROM place WHERE public_id = ${ALT}::uuid
        `;
        await database`
            INSERT INTO place_detail (place_id, description, source_system, is_active)
            SELECT id, 'Ein neues Dorf.', 'avesmaps3d', TRUE FROM place WHERE public_id = ${NEU}::uuid
        `;
        // Unterirdisch und Entrückt kennt Legacy nicht: Das Zurücksetzen nimmt sie zurück.
        await database`UPDATE place SET is_underground = TRUE WHERE public_id = ${ALT}::uuid`;
        // E16: ein Ort ohne Lage und die eigene Zuordnung des neuen Orts zu einem Wiki-Eintrag.
        await database`
            INSERT INTO place_unplaced (public_id, map_domain_id, name, subtype)
            VALUES ('e14e14e1-0000-4000-8000-000000000003', ${DOMAIN}, 'Ohne Lage', 'dorf')
        `;
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, source_system)
            VALUES ('siedlung', ${NEU}::uuid, 'wiki:wi0128-e14-neu', 'avesmaps3d')
        `;
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system)
            VALUES (${LANDSCHAFT_ALT}::uuid, ${DOMAIN}, 'Alter Wald', 'vegetation', 'wald', ${SOURCE}),
                   (${LANDSCHAFT_NEU}::uuid, ${DOMAIN}, 'Neuer Hain', 'vegetation', 'wald', 'avesmaps3d')
        `;
        await database`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${FLAECHE_NEU}::uuid, id, ${DOMAIN},
                   ST_SetSRID(ST_GeomFromText('POLYGON((440 440, 450 440, 450 450, 440 450, 440 440))'), 0), 'avesmaps3d'
              FROM region WHERE public_id = ${LANDSCHAFT_NEU}::uuid
        `;
        await database`
            INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, source_system)
            SELECT b.id::uuid, ${DOMAIN}, r.id, r.name, ST_SetSRID(ST_MakePoint(445, 445), 0), b.herkunft
              FROM (VALUES (${BESCHRIFTUNG_ALT}, ${LANDSCHAFT_ALT}, ${SOURCE}),
                           (${BESCHRIFTUNG_EIGEN}, ${LANDSCHAFT_ALT}, 'avesmaps3d'),
                           (${BESCHRIFTUNG_NEU}, ${LANDSCHAFT_NEU}, 'avesmaps3d')) AS b (id, region, herkunft)
              JOIN region r ON r.public_id = b.region::uuid
        `;
        await database`
            INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system)
            VALUES (${PUNKT_NEU}::uuid, ${DOMAIN}, 'junction', ST_SetSRID(ST_MakePoint(440, 440), 0), 'avesmaps3d')
        `;
        await database`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
            SELECT k.id::uuid, ${DOMAIN}, 'Linie', ${ALT}::uuid, k.bis::uuid, ST_SetSRID(ST_MakeLine(ST_MakePoint(431, 432), ST_MakePoint(440, 440)), 0),
                   ST_SetSRID(ST_MakeLine(ST_MakePoint(431, 432), ST_MakePoint(440, 440)), 0), k.herkunft
              FROM (VALUES (${KRAFTLINIE_ALT}, ${NEU}, ${SOURCE}), (${KRAFTLINIE_NEU}, ${PUNKT_NEU}, 'avesmaps3d')) AS k (id, bis, herkunft)
        `;
        await database`
            INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
            VALUES (${GEBIET_ALT}::uuid, ${DOMAIN}, 'Alte Baronie', '#b2b065', 0.7, ${SOURCE}),
                   (${GEBIET_NEU}::uuid, ${DOMAIN}, 'Neue Baronie', '#b2b065', 0.7, 'avesmaps3d')
        `;
        await database`
            INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system)
            SELECT f.id::uuid, t.id, ${DOMAIN},
                   ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((460 460, 470 460, 470 470, 460 470, 460 460))'), 0)), f.herkunft
              FROM (VALUES (${GEBIETSFLAECHE_ALT}, ${GEBIET_ALT}, ${SOURCE}),
                           (${GEBIETSFLAECHE_EIGEN}, ${GEBIET_ALT}, 'avesmaps3d'),
                           (${GEBIETSFLAECHE_NEU}, ${GEBIET_NEU}, 'avesmaps3d')) AS f (id, gebiet, herkunft)
              JOIN territory t ON t.public_id = f.gebiet::uuid
        `;
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system)
            VALUES (${WEG_ALT}::uuid, ${DOMAIN}, 'Weg-1', 'Weg', ST_SetSRID(ST_MakeLine(ST_MakePoint(431, 432), ST_MakePoint(433, 436)), 0), ${SOURCE}),
                   (${WEG_NEU}::uuid, ${DOMAIN}, 'Weg-2', 'Weg', ST_SetSRID(ST_MakeLine(ST_MakePoint(433, 436), ST_MakePoint(440, 440)), 0), 'avesmaps3d')
        `;
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active, off_map)
            VALUES (${WEG_AB}::uuid, ${DOMAIN}, 'Weg-3', 'Weg', ST_SetSRID(ST_MakeLine(ST_MakePoint(440, 440), ST_MakePoint(444, 441)), 0), ${SOURCE}, FALSE, TRUE)
        `;
        // Ein Tunnel aus dem Editor (Migration 0172): Legacy kennt das Merkmal nicht, das Zurücksetzen nimmt es zurück.
        await database`UPDATE path SET is_tunnel = TRUE, mark = 'karawanenroute' WHERE public_id = ${WEG_ALT}::uuid`;
        await database`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, source_system)
            VALUES (${GIPFEL_ALT}::uuid, ${DOMAIN}, 'Alte Zinne', 'berggipfel', ST_SetSRID(ST_MakePoint(446, 446), 0), ${SOURCE}),
                   (${GIPFEL_NEU}::uuid, ${DOMAIN}, 'Gipfel-001', 'berggipfel', ST_SetSRID(ST_MakePoint(447, 447), 0), 'avesmaps3d')
        `;
        // Ein Wiki-Artikel, im Editor dem Legacy-Abschnitt zugewiesen (WI-0205): Das Zurücksetzen gibt beide Zuordnungen für den Import frei.
        await database`
            INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, assignment_state, assignment_origin, source_system)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/Testader', 'address_only', 'editor', 'avesmaps3d' FROM powerline
             WHERE public_id = ${KRAFTLINIE_ALT}::uuid
        `;
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, source_system)
            VALUES ('kraftlinie', ${KRAFTLINIE_ALT}::uuid, 'testader', 'https://de.wiki-aventurica.de/wiki/Testader', 'avesmaps3d')
        `;
        // Eine Beschreibung am Legacy-Abschnitt (KF1): kein Import kennt sie, das Zurücksetzen leert sie.
        await database`UPDATE powerline SET description = 'Von Hand.' WHERE public_id = ${KRAFTLINIE_ALT}::uuid`;
        const erste = await bearbeite("Alt (bearbeitet)");
        // Die zweite Bearbeitung nimmt die erste zurück: Ihre Verknüpfung muss das Zurücksetzen mit den Operationen mitnehmen (0262, ON DELETE CASCADE).
        zurueckgenommen = erste.operationId;
        await bearbeite("Alt (noch einmal)", erste.operationId);
        await bearbeiteLandschaft();
    });

    afterAll(async () => {
        await aufraeumen();
        await database`DELETE FROM map_domain WHERE id = ${DOMAIN}`;
        await database.end({ timeout: 5 });
    });

    it("🔴 offen zählt die Operationen des Editors; der Probelauf rechnet alles und ändert nichts", async () => {
        const stand = await testweltOffen(database, DOMAIN);
        expect(stand).toMatchObject({ offen: 3, zuletzt: null });
        expect(stand.seit).toBeInstanceOf(Date);

        const probe = await testweltZuruecksetzen(database, {
            mapDomainId: DOMAIN,
            environment: "test",
            schreiben: false,
        });
        expect(probe).toEqual({
            probelauf: true,
            orteStillgelegt: 1,
            ohneLageStillgelegt: 1,
            merkmaleZurueck: 1,
            zuordnungenStillgelegt: 1,
            einzelheitenFreigegeben: 1,
            einzelheitenStillgelegt: 1,
            landschaftenStillgelegt: 1,
            flaechenStillgelegt: 1,
            beschriftungenStillgelegt: 2,
            kurvengradZurueck: 1,
            abgenommeneLandschaftenZurueck: 0,
            kraftlinienStillgelegt: 1,
            kraftlinienpunkteStillgelegt: 1,
            kraftlinienBeschreibungZurueck: 1,
            abgenommeneKraftlinienZurueck: 0,
            kraftlinienWikiFreigegeben: 2,
            gebieteStillgelegt: 1,
            gebietsflaechenStillgelegt: 2,
            wegeStillgelegt: 1,
            abgenommeneWegeZurueck: 1,
            tunnelZurueck: 1,
            kennzeichenZurueck: 1,
            gipfelStillgelegt: 1,
            operationenGeloescht: 3,
            eintraegeGeloescht: 3,
            operationId: null,
        });
        const [neu] = await database<
            { aktiv: boolean }[]
        >`SELECT is_active AS aktiv FROM place WHERE public_id = ${NEU}::uuid`;
        expect(neu?.aktiv).toBe(true);
        expect((await testweltOffen(database, DOMAIN)).offen).toBe(3);
    });

    it("🔴 zurücksetzen: neue Orte außer Betrieb, Einzelheiten für den Import frei, Protokoll leer bis auf testwelt_reset; danach offen 0", async () => {
        const verknuepfungen = () =>
            database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM map_operation_revert_link WHERE reverted_operation_id = ${zurueckgenommen}::uuid
            `;
        expect((await verknuepfungen())[0]?.n).toBe(1);
        const bericht = await testweltZuruecksetzen(database, {
            mapDomainId: DOMAIN,
            environment: "test",
            schreiben: true,
        });
        expect(bericht).toMatchObject({
            probelauf: false,
            orteStillgelegt: 1,
            ohneLageStillgelegt: 1,
            zuordnungenStillgelegt: 1,
            landschaftenStillgelegt: 1,
            operationenGeloescht: 3,
        });
        const [alt] = await database<{ unterirdisch: boolean }[]>`
            SELECT is_underground AS unterirdisch FROM place WHERE public_id = ${ALT}::uuid
        `;
        expect(alt?.unterirdisch).toBe(false);
        const [ohne] = await database<{ aktiv: boolean; herkunft: string }[]>`
            SELECT is_active AS aktiv, retired_origin AS herkunft FROM place_unplaced WHERE map_domain_id = ${DOMAIN}
        `;
        expect(ohne).toEqual({ aktiv: false, herkunft: "testwelt" });
        expect(bericht.operationId).toEqual(expect.any(String));

        const orte = await database<{ public_id: string; aktiv: boolean }[]>`
            SELECT public_id::text, is_active AS aktiv FROM place WHERE map_domain_id = ${DOMAIN} ORDER BY public_id
        `;
        expect(orte).toEqual([
            { public_id: ALT, aktiv: true },
            { public_id: NEU, aktiv: false },
        ]);
        const einzelheiten = await database<{ public_id: string; aktiv: boolean; herkunft: string }[]>`
            SELECT p.public_id::text, d.is_active AS aktiv, d.retired_origin AS herkunft
              FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.map_domain_id = ${DOMAIN} ORDER BY p.public_id
        `;
        // Der Import belebt beide wieder, wenn der Satz sie nennt (sync-table: nur, was der Import stilllegte).
        expect(einzelheiten).toEqual([
            { public_id: ALT, aktiv: false, herkunft: "import" },
            { public_id: NEU, aktiv: false, herkunft: "import" },
        ]);
        const protokoll = await database<{ source: string; action: string; actor_kind: string }[]>`
            SELECT source, action, actor_kind FROM map_operation WHERE map_domain_id = ${DOMAIN}
        `;
        expect(protokoll).toEqual([{ source: "testwelt_reset", action: "testwelt.reset", actor_kind: "system" }]);
        // Landschaften: die eigenen still, an der Legacy-Landschaft nur die eigene Beschriftung; der Kurvengrad wieder Legacys 3.
        const landschaften = await database<{ public_id: string; aktiv: boolean; grad: number | null }[]>`
            SELECT public_id::text, is_active AS aktiv, label_curve_degree AS grad FROM region
             WHERE map_domain_id = ${DOMAIN} ORDER BY public_id
        `;
        expect(landschaften).toEqual([
            { public_id: LANDSCHAFT_ALT, aktiv: true, grad: null },
            { public_id: LANDSCHAFT_NEU, aktiv: false, grad: null },
        ]);
        const teile = await database<{ public_id: string; aktiv: boolean }[]>`
            SELECT public_id::text, is_active AS aktiv FROM map_label WHERE map_domain_id = ${DOMAIN}
            UNION ALL
            SELECT public_id::text, is_active FROM region_area WHERE map_domain_id = ${DOMAIN}
            ORDER BY public_id
        `;
        expect(teile).toEqual([
            { public_id: FLAECHE_NEU, aktiv: false },
            { public_id: BESCHRIFTUNG_ALT, aktiv: true },
            { public_id: BESCHRIFTUNG_EIGEN, aktiv: false },
            { public_id: BESCHRIFTUNG_NEU, aktiv: false },
        ]);
        // Kraftlinien: der eigene Abschnitt und der eigene Punkt still, der Legacy-Abschnitt bleibt (I8 setzt ihn zurück).
        const kraftlinien = await database<{ public_id: string; aktiv: boolean }[]>`
            SELECT public_id::text, is_active AS aktiv FROM powerline WHERE map_domain_id = ${DOMAIN}
            UNION ALL
            SELECT public_id::text, is_active FROM nodix WHERE map_domain_id = ${DOMAIN}
            ORDER BY public_id
        `;
        // Der Wiki-Artikel des Editors ist für den Import frei: die Zuordnung ohne geschützte Herkunft, der Schlüssel still mit `import`.
        const [frei] = await database<{ herkunft: string; schluessel: boolean; grund: string | null }[]>`
            SELECT w.assignment_origin AS herkunft, k.is_active AS schluessel, k.retired_origin AS grund
              FROM powerline p
              JOIN powerline_wiki_assignment w ON w.powerline_id = p.id
              JOIN wiki_key_assignment k ON k.legacy_art = 'kraftlinie' AND k.object_public_id = p.public_id
             WHERE p.public_id = ${KRAFTLINIE_ALT}::uuid
        `;
        expect(frei).toEqual({ herkunft: "unknown", schluessel: false, grund: "import" });
        expect(kraftlinien).toEqual([
            { public_id: KRAFTLINIE_ALT, aktiv: true },
            { public_id: KRAFTLINIE_NEU, aktiv: false },
            { public_id: PUNKT_NEU, aktiv: false },
        ]);
        // Herrschaftsgebiete: das eigene Gebiet und beide eigenen Flächen still, das Legacy-Gebiet mit seiner Fläche bleibt (I14).
        const gebiete = await database<{ public_id: string; aktiv: boolean }[]>`
            SELECT public_id::text, is_active AS aktiv FROM territory WHERE map_domain_id = ${DOMAIN}
            UNION ALL
            SELECT public_id::text, is_active FROM territory_area WHERE map_domain_id = ${DOMAIN}
            ORDER BY public_id
        `;
        expect(gebiete).toEqual([
            { public_id: GEBIET_ALT, aktiv: true },
            { public_id: GEBIET_NEU, aktiv: false },
            { public_id: GEBIETSFLAECHE_ALT, aktiv: true },
            { public_id: GEBIETSFLAECHE_EIGEN, aktiv: false },
            { public_id: GEBIETSFLAECHE_NEU, aktiv: false },
        ]);
        // Wege: der neue still, der aus „Legacy“ bleibt (I5 setzt seine Linie zurück); der genommene ist nicht mehr genommen, I5 belebt ihn.
        const wege = await database<
            { public_id: string; aktiv: boolean; abgenommen: boolean; tunnel: boolean; mark: string | null }[]
        >`
            SELECT public_id::text, is_active AS aktiv, off_map AS abgenommen, is_tunnel AS tunnel, mark FROM path
             WHERE map_domain_id = ${DOMAIN} ORDER BY public_id
        `;
        expect(wege).toEqual([
            { public_id: WEG_ALT, aktiv: true, abgenommen: false, tunnel: false, mark: null },
            { public_id: WEG_NEU, aktiv: false, abgenommen: false, tunnel: false, mark: null },
            { public_id: WEG_AB, aktiv: false, abgenommen: false, tunnel: false, mark: null },
        ]);
        const gipfel = await database<{ public_id: string; aktiv: boolean }[]>`
            SELECT public_id::text, is_active AS aktiv FROM terrain_peak WHERE map_domain_id = ${DOMAIN} ORDER BY public_id
        `;
        expect(gipfel).toEqual([
            { public_id: GIPFEL_ALT, aktiv: true },
            { public_id: GIPFEL_NEU, aktiv: false },
        ]);
        const [eintraege] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_audit_event e JOIN map_operation o USING (operation_id) WHERE o.map_domain_id = ${DOMAIN}
        `;
        expect(eintraege?.n).toBe(0);
        // Die Verknüpfung der Rücknahme ging mit ihren Operationen (kein Fremdschlüssel hielt das Löschen auf).
        expect((await verknuepfungen())[0]?.n).toBe(0);

        const stand = await testweltOffen(database, DOMAIN);
        expect(stand).toMatchObject({ offen: 0, seit: null });
        expect(stand.zuletzt).toBeInstanceOf(Date);
        // Eine neue Bearbeitung danach ist wieder offen.
        await bearbeite("Alt (nach dem Zug)");
        expect((await testweltOffen(database, DOMAIN)).offen).toBe(1);
    });

    it("hält ein Import die Domäne (exklusive Sperre), wartet das Zurücksetzen nicht und schreibt nichts", async () => {
        const sperre = await acquireDeriveLock(database, DOMAIN, "exclusive");
        try {
            await expect(
                testweltZuruecksetzen(database, { mapDomainId: DOMAIN, environment: "test", schreiben: true }),
            ).rejects.toBeInstanceOf(DeriveBusyError);
        } finally {
            await sperre?.release();
        }
        expect((await testweltOffen(database, DOMAIN)).offen).toBe(1);
    });
});
