import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";

/**
 * Deterministische Kachelbytes (Migration 0016).
 *
 * 💣 Ohne feste Zeilenreihenfolge liefert dieselbe Datenlage auf zwei Maschinen verschiedene
 * Kacheln. Am 2026-09-21 an `place_render/5/17/16` gemessen: Stage und localhost, gleiche Größe,
 * anderer Hash, identischer Inhalt. Das kostet doppelt - der byteweise Unveränderlichkeitsnachweis
 * des Deploys schlägt grundlos Alarm, und bei gleichrangigen Symbolen entscheidet die Reihenfolge
 * mit, welches Label eine Kollision gewinnt.
 *
 * 🪤 Der Test hat seine Gegenprobe EINGEBAUT, und das ist hier keine Feinheit: der erste Versuch
 * nutzte `VACUUM FULL`, um den Heap umzuordnen - das schreibt die Tabelle aber in derselben
 * logischen Reihenfolge neu und ändert gar nichts. Der Nachweis wäre grün gewesen, ohne etwas zu
 * prüfen. Deshalb läuft eine Kontrollsicht OHNE `ORDER BY` mit: wechselt sie nicht, war der
 * Heap-Umbau wirkungslos und der Test sagt das, statt stillschweigend zu bestehen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Die Relationen, die Martin als Kachelquelle liest, mit ihrem stabilen Schlüssel. */
const RENDER_RELATIONS = [
    { relation: "place_render", key: "public_id" },
    { relation: "region_area_render", key: "public_id" },
    { relation: "map_label_render", key: "public_id" },
    { relation: "climate_band_render", key: "type_key" },
    { relation: "landscape_label_run_render", key: "run_id::text" },
    // 💣 Die Wege-Relationen fehlten hier. Sie kamen mit WI-0010 nach diesem Test dazu, und
    // niemand hat die Liste nachgezogen — der Wächter zählte weiter „fünf" und bewachte fünf,
    // während sieben Relationen ausgeliefert wurden. Ein Wächter mit einer festen Liste bewacht
    // genau das, was beim Schreiben bekannt war; alles Spätere fällt lautlos durch.
    { relation: "path_render", key: "public_id" },
    { relation: "powerline_render", key: "public_id" },
    { relation: "ley_node_render", key: "public_id" },
    { relation: "path_label_run_render", key: "name || ':' || subtype || ':' || part || ':' || instance" },
    // 🪤 Diese beiden hat nicht ein Mensch nachgetragen, sondern der Test darunter. Er liest die
    // Migrationen und verlangt jede `*_render`-Sicht in dieser Liste — beim ersten Lauf meldete er
    // sofort zwei, an die seit WI-0012 beziehungsweise WI-0010 niemand gedacht hatte. Beide waren
    // in Ordnung; unbewacht waren sie trotzdem.
    { relation: "climate_label_render", key: "type_key || ':' || seite" },
    { relation: "path_label_render", key: "name || ':' || subtype" },
    // WI-0055: die Höhenlinien und Höhenstufen der aktuellen Revision und die Gipfel.
    { relation: "terrain_contour_render", key: "id::text" },
    { relation: "terrain_contour_detail_render", key: "id::text" },
    { relation: "terrain_height_band_render", key: "id::text" },
    { relation: "terrain_water_render", key: "public_id::text" },
    { relation: "terrain_peak_render", key: "public_id::text" },
    // WI-0062: Flächen, Namensanker und Grenzen der Herrschaftsgebiete (abgeleitet, Schlüssel Band und Gebiet).
    { relation: "territory_fill_render", key: "band::text || ':' || territory_public_id::text" },
    { relation: "territory_label_render", key: "band::text || ':' || territory_public_id::text" },
    { relation: "territory_border_render", key: "band::text || ':' || kind || ':' || territory_public_id::text" },
    // Nachtrag 2026-09-30: die Schraffurflächen umstrittener Gebiete (Schlüssel Band und umstrittenes Gebiet).
    { relation: "territory_claim_render", key: "band::text || ':' || claimed_public_id::text" },
    // WI-0261: die Sprachflächen (S2, 0254) und ihre Mischgebiete (S5a, 0257, Schlüssel Paar und Teil).
    { relation: "sprache_flaeche_render", key: "public_id::text" },
    { relation: "sprache_misch_render", key: "schluessel_a || ':' || schluessel_b || ':' || teil::text" },
    // WI-0283: was die Kachelfunktionen über den Index lesen (0315).
    { relation: "map_domain_bounds_render", key: "map_domain_id" },
    { relation: "place_basis_render", key: "public_id::text" },
    { relation: "ley_node_basis_render", key: "public_id::text" },
    { relation: "path_basis_render", key: "public_id::text" },
    { relation: "region_area_rund_render", key: "public_id::text" },
    { relation: "region_area_eckig_render", key: "public_id::text" },
    { relation: "terrain_water_rund_render", key: "public_id::text" },
    { relation: "terrain_water_eckig_render", key: "public_id::text" },
    { relation: "path_label_run_basis_render", key: "name || ':' || subtype || ':' || part || ':' || instance" },
] as const;

/**
 * 💣 DIE LISTE OBEN IST EINE HANDGEPFLEGTE LISTE, und genau daran ist sie gescheitert: die
 * Wege-Relationen kamen mit WI-0010 dazu und wurden nicht eingetragen. Der Waechter zaehlte
 * weiter fuenf und bewachte fuenf, waehrend sieben ausgeliefert wurden — lautlos, weil eine
 * Liste nicht bemerkt, was ihr fehlt.
 *
 * ⭐ Dieser Test bewacht die LISTE. Er liest, welche `*_render`-Sichten die Migrationen
 * ueberhaupt anlegen, und verlangt, dass jede davon oben steht. Wer die naechste Renderrelation
 * baut, bekommt einen roten Test statt einer stillen Luecke.
 */
describe("Die Liste der Renderrelationen bewacht sich selbst", () => {
    it("🔴 kennt jede `*_render`-Sicht, die eine Migration anlegt", async () => {
        const { readdir, readFile } = await import("node:fs/promises");
        const { fileURLToPath } = await import("node:url");
        const verzeichnis = fileURLToPath(new URL("../migrations/", import.meta.url));

        const angelegt = new Set<string>();
        for (const datei of (await readdir(verzeichnis)).filter((name) => name.endsWith(".sql"))) {
            const sql = await readFile(verzeichnis + datei, "utf8");
            for (const treffer of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+_render)\b/gi)) {
                angelegt.add((treffer[1] as string).toLowerCase());
            }
        }

        // 🪤 Die Gegenprobe zuerst: hat das Lesen ueberhaupt etwas gefunden? Ein leerer Fund
        // waere gruen und wertlos - genau die Falle, die dieser Test schliessen soll.
        expect(angelegt.size, "keine einzige _render-Sicht in den Migrationen gefunden").toBeGreaterThan(4);

        const bewacht = new Set(RENDER_RELATIONS.map((eintrag) => eintrag.relation));
        const fehlend = [...angelegt].filter((name) => !bewacht.has(name as never)).sort();
        expect(fehlend, "Renderrelationen ohne Reihenfolge-Nachweis").toEqual([]);
    });
});

describeWithDatabase("Renderreihenfolge gegen PostgreSQL", () => {
    let database: Database;

    /**
     * Genug Zeilen, damit ueberhaupt etwas zu ordnen ist.
     *
     * 🪤 Der erste Entwurf verliess sich auf den Bestand der Testdatenbank - darin lagen ZWEI Orte.
     * Bei zwei Zeilen liefert jeder Ausfuehrungsplan dieselbe Reihenfolge und CLUSTER ordnet nichts
     * um: beide Nachweise waren gruen, ohne etwas zu pruefen. Die Namen laufen der `public_id`
     * absichtlich ENTGEGEN, damit eine Sortierung nach Name garantiert anders ausfaellt.
     */
    const FIXTURE_ROWS = 200;
    const FIXTURE_SOURCE = "render-order-test";

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await seedMapDomains(database);
        await database.unsafe(`DELETE FROM place WHERE source_system = '${FIXTURE_SOURCE}'`);
        await database.unsafe(`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, legacy_public_id, is_active)
            SELECT
                ('cccccccc-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
                'aventuria',
                'Ort ' || lpad((${FIXTURE_ROWS} - i)::text, 4, '0'),
                'dorf',
                ST_SetSRID(ST_MakePoint(400 + (i % 50), 400 + (i / 50)), 0),
                '${FIXTURE_SOURCE}',
                ('cccccccc-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
                TRUE
            FROM generate_series(1, ${FIXTURE_ROWS}) AS i`);
    });

    afterAll(async () => {
        await database.unsafe(`DELETE FROM place WHERE source_system = '${FIXTURE_SOURCE}'`);
        await database.end({ timeout: 5 });
    });

    /** Die Reihenfolge, in der eine Relation ihre Zeilen liefert. */
    async function rowOrder(relation: string, key: string): Promise<string> {
        const [row] = await database.unsafe<{ hash: string }[]>(
            `SELECT COALESCE(md5(string_agg(k, ',')), 'leer') AS hash FROM (SELECT (${key})::text AS k FROM ${relation}) t`,
        );
        if (!row) {
            throw new Error(`${relation}: keine Zeile`);
        }
        return row.hash;
    }

    it("🔴 sortiert JEDE Renderrelation, die Martin liest", async () => {
        // 🪤 Hier stand zuerst ein Test, der vier Ausführungspläne durchprobierte. Er blieb in der
        // Mutationsprobe GRÜN: bei einer kleinen Tabelle waehlt PostgreSQL ohnehin denselben Plan,
        // und `enable_seqscan = off` ist ein Kostenaufschlag, kein Verbot. Ein Nachweis, der ohne
        // den Fix nicht faellt, prueft nichts - also ist er hier durch den direkten ersetzt: steht
        // die Sortierung in der Definition, die Martin liest?
        for (const { relation } of RENDER_RELATIONS) {
            const rows = await database.unsafe<{ src: string }[]>(
                `SELECT pg_get_viewdef('${relation}'::regclass, true) AS src`,
            );
            const definition = rows[0]?.src;
            expect(definition, `${relation} ohne ORDER BY`).toContain("ORDER BY");
        }
    });

    it("💣 liefert dieselben Kachelbytes, nachdem der Heap physisch umgeordnet wurde", async () => {
        // Der Nachweis, den der Betreiber verlangt: gleiche Daten, andere physische Reihenfolge,
        // gleiche Kachel.
        //
        // 🪤 Der Test bringt seine Daten SELBST mit. Der erste Versuch verliess sich auf den
        // Bestand der Testdatenbank - darin lagen zwei Orte, und bei zwei Zeilen ordnet CLUSTER
        // nichts um. Der Nachweis waere gruen gewesen, ohne etwas zu pruefen; seine eingebaute
        // Gegenprobe hat genau das gemeldet. Die Namen laufen der `public_id` absichtlich
        // ENTGEGEN, damit eine Sortierung nach Name garantiert eine andere Reihenfolge ergibt.
        await database.unsafe(`CREATE OR REPLACE VIEW render_order_control AS
            SELECT p.public_id FROM place p WHERE p.is_active AND p.source_system = 'render-order-test'`);
        await database.unsafe(`CREATE INDEX IF NOT EXISTS render_order_probe_name_idx ON place (name)`);
        await database.unsafe(`CREATE INDEX IF NOT EXISTS render_order_probe_id_idx ON place (public_id)`);

        try {
            await database.unsafe(`CLUSTER place USING render_order_probe_id_idx`);
            const before = new Map<string, string>();
            for (const { relation, key } of RENDER_RELATIONS) {
                before.set(relation, await rowOrder(relation, key));
            }
            const controlBefore = await rowOrder("render_order_control", "public_id");

            await database.unsafe(`CLUSTER place USING render_order_probe_name_idx`);

            // 🪤 Die Gegenprobe zuerst: hat der Umbau ueberhaupt gewirkt? Ohne sie koennte der Test
            // gruen sein, weil sich nichts geaendert hat - nicht, weil die Sortierung haelt.
            const controlAfter = await rowOrder("render_order_control", "public_id");
            expect(
                controlAfter,
                "CLUSTER hat die Reihenfolge nicht veraendert - der Nachweis prueft dann nichts",
            ).not.toBe(controlBefore);

            for (const { relation, key } of RENDER_RELATIONS) {
                expect(await rowOrder(relation, key), relation).toBe(before.get(relation));
            }
        } finally {
            await database.unsafe(`ALTER TABLE place SET WITHOUT CLUSTER`);
            await database.unsafe(`DROP INDEX IF EXISTS render_order_probe_name_idx`);
            await database.unsafe(`DROP INDEX IF EXISTS render_order_probe_id_idx`);
            await database.unsafe(`DROP VIEW IF EXISTS render_order_control`);
        }
    });

    it("🔴 sortiert die Kachelfunktion im Aggregat, nicht in der Sicht darunter", async () => {
        // Bei einer Sicht baut Martin das `ST_AsMVT` selbst; dort ist die Sortierung der Sicht
        // gemessen zuverlässig, aber nicht formal zugesichert. Wo wir das Aggregat schreiben, steht
        // sie deshalb DARIN - der LATERAL-Join der Funktion würde eine Sortierung der Sicht
        // ohnehin nicht durchreichen.
        const quelle = await database.unsafe<{ src: string }[]>(
            `SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p WHERE p.proname = 'landscape_label_run_tile'`,
        );
        const definition = quelle[0]?.src;
        expect(definition).toContain("ST_AsMVT(source, 'landscape_label_run' ORDER BY");
    });

    it("hält fest, dass der Schlüssel ein Tie-Breaker ist und keine Priorität", async () => {
        // 🔴 Aus `public_id` folgt NICHTS über die Wichtigkeit eines Labels. Die Kollisionspriorität
        // gehört in `symbol-sort-key` im Style (WI-0007). Wer hier eine Rangfolge hineinliest,
        // vermischt eine technische Zusicherung mit einer fachlichen Entscheidung.
        const rows = await database.unsafe<{ src: string }[]>(
            `SELECT pg_get_viewdef('place_render'::regclass, true) AS src`,
        );
        const definition = rows[0]?.src;
        expect(definition).toContain("ORDER BY");
        expect(definition).toContain("public_id");
        // Die Sicht ordnet NUR nach dem Tie-Breaker: keine fachliche Sortierung schleicht sich ein.
        // (PostgreSQL gibt die Definition normalisiert zurück, ohne den Alias der Quelle.)
        expect(definition?.split("ORDER BY")[1]?.trim()).toMatch(/^(p\.)?public_id;?$/);
    });
});
