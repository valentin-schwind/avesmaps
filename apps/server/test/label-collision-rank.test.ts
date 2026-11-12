import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Die Kollisionskette (WI-0007, Migration 0017).
 *
 * Gemessen wird gegen echtes PostgreSQL, weil die Kette dort gerechnet wird - ein Nachbau in
 * TypeScript wuerde die eigene Kopie pruefen, nicht die Karte (Kap. 11.10).
 *
 * 💣 Der Anlass ist ein gemessener Fehler, kein Feature: bis 0017 entschied bei gleichrangigen
 * Namen die `public_id`. Albernia verlor gegen neun Nachbarn, weil seine UUID mit `f2d0` beginnt
 * (Finding MCS-010). Der dritte Test bildet genau diese Datenlage nach.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Label-Kollisionsrang gegen PostgreSQL", () => {
    let database: Database;
    const SOURCE = "collision-rank-test";

    /** Ein Ort mit Klasse und redaktioneller Prioritaet. */
    async function place(n: number, subtype: string, priority: number | null): Promise<void> {
        await database.unsafe(`
            INSERT INTO place (public_id, map_domain_id, name, subtype, label_priority, geom, source_system, legacy_public_id, is_active)
            VALUES (
                ('dddddddd-0000-4000-8000-' || lpad(${n}::text, 12, '0'))::uuid,
                'aventuria', 'Rangprobe ${n}', '${subtype}',
                ${priority === null ? "NULL" : priority},
                ST_SetSRID(ST_MakePoint(400 + ${n}, 400), 0),
                '${SOURCE}',
                ('dddddddd-0000-4000-8000-' || lpad(${n}::text, 12, '0'))::uuid,
                TRUE)`);
    }

    async function rankOf(n: number): Promise<number> {
        const [row] = await database.unsafe<{ collision_rank: number }[]>(
            `SELECT collision_rank FROM place_render WHERE name = 'Rangprobe ${n}'`,
        );
        if (!row) {
            throw new Error(`Rangprobe ${n} fehlt in place_render`);
        }
        return row.collision_rank;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await database.unsafe(`DELETE FROM place WHERE source_system = '${SOURCE}'`);
    });

    afterAll(async () => {
        await database.unsafe(`DELETE FROM place WHERE source_system = '${SOURCE}'`);
        await database.unsafe(`DELETE FROM label_class_rank WHERE class_key = 'rangprobe'`);
        await database.end({ timeout: 5 });
    });

    it("🔴 laesst die redaktionelle Prioritaet NIE ueber eine Klassengrenze springen", async () => {
        // Die Betreiberentscheidung, als Zahl gemessen: ein Dorf mit der hoechsten redaktionellen
        // Prioritaet steht immer noch hinter einer Kleinstadt mit der niedrigsten. Waere der
        // Abstand zwischen den Klassen zu klein gewaehlt, faellt genau dieser Test.
        await place(1, "dorf", 5);
        await place(2, "kleinstadt", 1);

        const dorfStark = await rankOf(1);
        const kleinstadtSchwach = await rankOf(2);

        expect(kleinstadtSchwach, "klein gewinnt: die Kleinstadt muss vorn stehen").toBeLessThan(dorfStark);
    });

    it("🔴 sortiert die redaktionelle Prioritaet in LEGACYS Richtung: 5 gewinnt", async () => {
        // 💣 Genau hier lag der Fehler im Style: er nahm `label_priority` roh als sort-key, und
        // MapLibre platziert den NIEDRIGEREN Wert zuerst. Legacy sortiert absteigend
        // (`right.priority - left.priority`), also gewinnt die 5. Ohne die Spiegelung in
        // `label_collision_rank` faellt dieser Test.
        await place(3, "dorf", 5);
        await place(4, "dorf", 1);

        expect(await rankOf(3), "Prioritaet 5 muss vor Prioritaet 1 stehen").toBeLessThan(await rankOf(4));
    });

    it("🪤 wertet eine unbestimmte Prioritaet wie 3, genau wie Legacys `|| 3`", async () => {
        await place(5, "dorf", null);
        await place(6, "dorf", 3);

        expect(await rankOf(5)).toBe(await rankOf(6));
    });

    it("💣 loest den Fall Albernia: bei gleicher Prioritaet gewinnt, was frueher sichtbar war", async () => {
        // Die Datenlage aus MCS-010, nachgebaut: gleiche Prioritaet, unterschiedliche
        // Erscheinungsstufe. Albernia ist ab z1 da, die Nachbarn ab z2.
        //
        // 🪤 Gemessen wird ueber `label_collision_rank` direkt und nicht ueber die Sicht, weil die
        // echten Landschaftslabels aus der Migration stammen und ein Test sie nicht anlegen soll.
        const [ranks] = await database.unsafe<{ frueh: number; spaet: number }[]>(`
            SELECT label_collision_rank(NULL::smallint, 3::smallint, 1::smallint) AS frueh,
                   label_collision_rank(NULL::smallint, 3::smallint, 2::smallint) AS spaet`);
        if (!ranks) {
            throw new Error("label_collision_rank lieferte keine Zeile");
        }
        const { frueh, spaet } = ranks;

        expect(frueh, "ab z1 sichtbar muss vor ab z2 stehen").toBeLessThan(spaet);
    });

    it("⭐ laesst die Klassenordnung ZUR LAUFZEIT aendern, ohne Release", async () => {
        // Der Kern der Betreiberpraezisierung vom 2026-09-21: die globale Klassenpriorität soll
        // nicht pro Objekt ueberschreibbar sein, aber auch nicht als feste Systemkonstante im Code
        // liegen. Dieser Test faellt, sobald jemand die Ordnung zurueck in ein Literal schiebt -
        // dann aendert eine Zeile in der Tabelle den Rang naemlich nicht mehr.
        await place(7, "dorf", 3);
        const vorher = await rankOf(7);

        await database.unsafe(`UPDATE label_class_rank SET rank = 5 WHERE scope = 'place' AND class_key = 'dorf'`);
        const nachher = await rankOf(7);
        await database.unsafe(`UPDATE label_class_rank SET rank = 50 WHERE scope = 'place' AND class_key = 'dorf'`);

        expect(nachher, "ein Dorf auf Rang 5 muss weit nach vorn ruecken").toBeLessThan(vorher);
        expect(await rankOf(7), "und nach dem Zuruecksetzen wieder zurueck").toBe(vorher);
    });

    it("🪤 nimmt einen Ort NICHT von der Karte, wenn seine Klasse keinen Rang hat", async () => {
        // Kap. 2.16: kein stilles Verschlucken. Ein LEFT JOIN statt JOIN - sonst waere eine
        // fehlende Zeile in der Rangtabelle ein unsichtbarer Datenverlust auf der Karte.
        // 🪤 Der Rang wird GEMERKT statt hartkodiert wiederhergestellt. Im ersten Entwurf stand
        // hier eine feste 70; als Migration 0018 den Rang auf 60 korrigierte, legte dieser Test
        // den alten Wert zurueck und liess einen SPAETEREN Test ueber ein Duplikat fallen. Ein
        // Test, der den Zustand eines anderen beschaedigt, meldet Fehler an der falschen Stelle.
        const [vorher] = await database.unsafe<{ rank: number; label: string }[]>(
            `SELECT rank, label FROM label_class_rank WHERE scope = 'place' AND class_key = 'gebaeude'`,
        );
        if (!vorher) {
            throw new Error("gebaeude fehlt in label_class_rank");
        }
        await database.unsafe(`DELETE FROM label_class_rank WHERE scope = 'place' AND class_key = 'gebaeude'`);
        await place(8, "gebaeude", 3);

        const rows = await database.unsafe<{ collision_rank: number }[]>(
            `SELECT collision_rank FROM place_render WHERE name = 'Rangprobe 8'`,
        );
        expect(rows.length, "der Ort bleibt in der Kachel").toBe(1);
        // 🪤 Gemessen wird der KLASSENTERM, nicht der ganze Wert: ein absoluter Vergleich haette
        // auch dann angeschlagen, wenn nur die Prioritaetsformel sich aendert - und der Test haette
        // ueber etwas geklagt, das er gar nicht prueft. Unter 1000 heisst: Klassenterm ist 0.
        expect(rows[0]?.collision_rank).toBeLessThan(1000);

        await database.unsafe(
            `INSERT INTO label_class_rank (scope, class_key, rank, label) VALUES ('place', 'gebaeude', $1, $2)`,
            [vorher.rank, vorher.label],
        );
    });

    it("🔴 liefert den Rang in JEDER Beschriftungsrelation, nicht nur bei den Orten", async () => {
        // Drei Layer, drei Quellen, eine Kette. Vorher stand an den drei Stellen dreierlei.
        for (const relation of ["place_render", "map_label_render", "landscape_label_run_render"]) {
            const rows = await database.unsafe<{ src: string }[]>(
                `SELECT pg_get_viewdef('${relation}'::regclass, true) AS src`,
            );
            expect(rows[0]?.src, `${relation} ohne collision_rank`).toContain("collision_rank");
        }
    });

    it("🔴 haelt die Ortsklassen in Legacys Reihenfolge — gross vor klein", async () => {
        // 🪤 REGRESSION CASE. Migration 0017 hatte `stadtviertel` zwischen Dorf und Gebaeude
        // einsortiert, also als besonders kleine Siedlung. Es ist keine: ein Stadtviertel liegt
        // INNERORTS (Betreiberkorrektur 2026-09-21, Finding MCS-012). Legacys eigene Liste
        // `AVESMAPS_ORTSKLASSEN` in `api/_internal/ortsklassen.php` fuehrt `gebaeude` VOR
        // `stadtviertel` und sagt damit dasselbe.
        //
        // Festgehalten wird die REIHENFOLGE, nicht die Zahlen: Luecken im Rang sind erwuenscht,
        // damit eine neue Klasse dazwischenpasst, ohne alles umzunummerieren.
        const LEGACY_REIHENFOLGE = [
            "metropole",
            "grossstadt",
            "stadt",
            "kleinstadt",
            "dorf",
            "gebaeude",
            "stadtviertel",
        ];

        const rows = await database.unsafe<{ class_key: string }[]>(
            `SELECT class_key FROM label_class_rank WHERE scope = 'place' ORDER BY rank`,
        );
        expect(rows.map((row) => row.class_key)).toEqual(LEGACY_REIHENFOLGE);
    });

    it("🪤 vergibt keine zwei Klassen denselben Rang", async () => {
        // Bei Gleichstand entschiede wieder die `public_id` - genau der Zustand, den dieses Work
        // Item beendet hat. Legacy gibt `dorf`, `gebaeude` und `stadtviertel` denselben Wert 60;
        // wir trennen sie bewusst, und dieser Test haelt die Abweichung fest.
        const rows = await database.unsafe(`
            SELECT rank, count(*)::int AS klassen FROM label_class_rank
            WHERE scope = 'place' GROUP BY rank HAVING count(*) > 1`);
        expect(rows, "Klassen mit gleichem Rang").toEqual([]);
    });
});
