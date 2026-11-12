import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFindings } from "../src/blocking-checks.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { renderZoomForBand } from "@avesmaps3d/shared";
import { deriveRegion, type RegionInput } from "../src/derive/label-runs.ts";
import { deriveAll, refreshLabelCurve } from "../src/derive/refresh-label-curve.ts";
import { verifyRuns } from "../src/derive/verify-runs.ts";

/**
 * Die Ableitung der Schriftläufe von Ende zu Ende, an echtem PostGIS (WI-0004, ADR-0007).
 *
 * Geprüft wird an einer Fixture, deren Achse man von Hand kennt: ein langer, leicht gebogener
 * Streifen. Eine echte Landschaftsfläche sagte hier weniger - dort ist jede Abweichung plausibel,
 * und nichts wäre falsifizierbar.
 *
 * 🪤 Dieselben Invarianten prüft `npm run verify:runs` gegen den echten Bestand. Beide rufen
 * `verifyRuns` auf: zwei Abschriften derselben Abfrage wären zwei Wahrheiten, und die eine, die
 * niemand ausführt, wäre irgendwann die falsche.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Ein Streifen von `length` x `height` Karteneinheiten, mittig um (cx, cy), leicht gebogen. */
function stripWkt(cx: number, cy: number, length: number, height: number, bulge: number): string {
    const steps = 48;
    const top: string[] = [];
    const bottom: string[] = [];
    for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const x = cx - length / 2 + t * length;
        const middle = cy + Math.sin(t * Math.PI) * bulge;
        top.push(`${String(x)} ${String(middle + height / 2)}`);
        bottom.push(`${String(x)} ${String(middle - height / 2)}`);
    }
    bottom.reverse();
    return `POLYGON((${[...top, ...bottom, top[0] as string].join(",")}))`;
}

describeWithDatabase("Ableitung der Schriftläufe", () => {
    let database: Database;
    let regionId = 0;
    let labelId = 0;

    const input = (overrides: Partial<RegionInput> = {}): RegionInput => ({
        regionId,
        regionPublicId: "00000000-0000-4000-8000-0000000004a1",
        name: "Teststreifen",
        styleLabelId: labelId,
        labelText: "Teststreifen",
        labelSize: 18,
        labelType: null,
        labelMinZoom: 2,
        labelMaxZoom: 7,
        curveMax: 1,
        curveDegree: 3,
        ...overrides,
    });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);

        // Eigener Bestand: was schon in der Testdatenbank liegt, darf das Ergebnis nicht färben.
        await database`DELETE FROM landscape_label_run`;
        const [region] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active,
                                label_curve_enabled, label_curve_max)
            VALUES ('00000000-0000-4000-8000-0000000004a1', 'aventuria', 'Teststreifen',
                    'topographie', true, true, 3)
            ON CONFLICT (public_id) DO UPDATE SET label_curve_max = 3
            RETURNING id::text
        `;
        regionId = Number(region?.id);

        const [label] = await database<{ id: string }[]>`
            INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active,
                                   label_size, label_min_zoom, label_max_zoom, label_priority, region_id)
            VALUES ('00000000-0000-4000-8000-0000000004b1', 'aventuria', 'Teststreifen',
                    ST_SetSRID(ST_MakePoint(500, 500), 0), true, 18, 2, 7, 3, ${regionId})
            ON CONFLICT (public_id) DO UPDATE SET region_id = ${regionId}
            RETURNING id::text
        `;
        labelId = Number(label?.id);
        await database`UPDATE region SET primary_label_id = ${labelId} WHERE id = ${regionId}`;

        await database`DELETE FROM region_area WHERE region_id = ${regionId}`;
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active,
                                     geometry_revision)
            VALUES ('00000000-0000-4000-8000-0000000004c1', 'aventuria', ${regionId},
                    ST_SetSRID(ST_GeomFromText(${stripWkt(500, 500, 120, 14, 8)}), 0), true, 1)
        `;
    });

    afterAll(async () => {
        await database`DELETE FROM landscape_label_run WHERE region_id = ${regionId}`;
        await database`UPDATE region SET primary_label_id = NULL WHERE id = ${regionId}`;
        await database`DELETE FROM map_label WHERE id = ${labelId}`;
        await database`DELETE FROM region_area WHERE region_id = ${regionId}`;
        await database`DELETE FROM region WHERE id = ${regionId}`;
        await database.end({ timeout: 5 });
    });

    it("legt die Kurve der Länge nach durch den Streifen", async () => {
        const result = await deriveRegion(database, input());
        expect(result.skipped).toBeUndefined();
        // Ein Name, aber ein Lauf je Stufe seines Erscheinungsbands (WI-0018).
        expect(result.runs).toHaveLength(renderZoomForBand(7) - renderZoomForBand(2) + 1);
        expect(new Set(result.runs.map((run) => run.instanceCount))).toEqual(new Set([1]));
        // Der Streifen ist 120 Einheiten lang. Die Kurve deckt den größten Teil davon ab - nicht
        // alles, weil Vereinfachung und Beruhigung an den Enden kürzen.
        expect(result.curveLength).toBeGreaterThan(80);
        expect(result.curveLength).toBeLessThan(130);
    });

    it("I6 - zweimal dieselbe Fläche ergibt denselben Lauf, Koordinate für Koordinate", async () => {
        const first = await deriveRegion(database, input());
        const second = await deriveRegion(database, input());
        expect(second.fingerprint).toEqual(first.fingerprint);
        expect(second.runs).toEqual(first.runs);
    });

    it("I6 - eine geänderte Revision entwertet den Fingerabdruck", async () => {
        const before = await deriveRegion(database, input());
        await database`UPDATE region_area SET geometry_revision = 2 WHERE region_id = ${regionId}`;
        const after = await deriveRegion(database, input());
        await database`UPDATE region_area SET geometry_revision = 1 WHERE region_id = ${regionId}`;
        expect(after.fingerprint).not.toEqual(before.fingerprint);
    });

    it("verteilt drei Instanzen erst ab der Stufe, auf der sie passen", async () => {
        const result = await deriveRegion(database, input({ curveMax: 3 }));
        expect(result.skipped).toBeUndefined();

        // Seit WI-0018 trägt ein Satz einen Lauf JE STUFE; sein Band ist die Spanne dieser Stufen.
        const bands = new Map<number, { min: number; max: number }>();
        for (const run of result.runs) {
            const band = bands.get(run.instanceCount);
            bands.set(run.instanceCount, {
                min: Math.min(band?.min ?? run.runMinZoom, run.runMinZoom),
                max: Math.max(band?.max ?? run.runMaxZoom, run.runMaxZoom),
            });
        }
        // 🔴 Der UNTERSTE Satz reicht bis an das untere Ende des Erscheinungsbands — und das ist
        // seit WI-0015 dessen RENDER-Stufe, nicht die Bandzahl selbst.
        //
        // 🪤 Hier stand „der Satz mit EINER Instanz", und das war eine Aussage über diesen
        // Teststreifen, nicht über die Regel. Mit der richtigen Zoomabbildung ist eine Stufe
        // doppelt so fein, also passen hier schon unten zwei Instanzen — der Name fällt dadurch
        // nicht aus, und genau das ist die Zusicherung (I7). Der Test prüft sie jetzt, statt die
        // Instanzzahl festzuschreiben, die dieser eine Streifen zufällig ergibt.
        const unterster = [...bands.values()].reduce((a, b) => (a.min <= b.min ? a : b));
        expect(unterster.min).toBe(renderZoomForBand(2));
        // Mehr Instanzen heißt: höher im Band, ohne Loch und ohne Überschneidung.
        const ordered = [...bands.entries()].sort((a, b) => a[0] - b[0]);
        for (let index = 1; index < ordered.length; index += 1) {
            const lower = ordered[index - 1]?.[1] as { min: number; max: number };
            const upper = ordered[index]?.[1] as { min: number; max: number };
            expect(upper.min).toBe(lower.max + 1);
        }
        expect(ordered[ordered.length - 1]?.[1]?.max).toBe(renderZoomForBand(7));
    });

    it("I7 - eine Region ohne Fläche kostet die Kurve, nicht den Namen", async () => {
        // Der Fall aus dem echten Bestand: zwölf stillgelegte Legacy-Reste tragen ein Label und
        // keine Fläche (PC-0001). Die Ableitung sagt, WARUM sie nichts tut - sie tut nicht still
        // nichts -, und das Label bleibt unberührt und damit auf der Karte.
        await database`UPDATE region_area SET is_active = false WHERE region_id = ${regionId}`;
        const result = await deriveRegion(database, input());
        expect(result.runs).toEqual([]);
        expect(result.skipped).toBe("keine aktive Flaeche");

        const [label] = await database<{ is_active: boolean }[]>`
            SELECT is_active FROM map_label WHERE id = ${labelId}
        `;
        expect(label?.is_active, "das Punktlabel bleibt sichtbar").toBe(true);

        await database`UPDATE region_area SET is_active = true WHERE region_id = ${regionId}`;
    });

    it("erfüllt alle Invarianten, sobald die Läufe geschrieben sind", async () => {
        // Geschrieben über denselben Weg wie das CLI und später das Kontextmenü - nicht über ein
        // eigenes INSERT im Test, das der echten Schreibstelle nur ähnlich sieht.
        const outcome = await refreshLabelCurve(database, "00000000-0000-4000-8000-0000000004a1");
        expect(outcome.status).toBe("written");

        const report = await verifyRuns(database);
        const failed = report.checks.filter((entry) => !entry.passed);
        expect(failed.map((entry) => `${entry.name}: ${entry.detail}`)).toEqual([]);
        expect(report.passed).toBe(true);
    });

    describe("„Labelkurve aktualisieren“ je Region (WI-0018, Testvertrag Kap. 11.4)", () => {
        const publicId = "00000000-0000-4000-8000-0000000004a1";
        const stored = async (): Promise<{ min: number; count: number; instance: number; wkt: string }[]> =>
            database<{ min: number; count: number; instance: number; wkt: string }[]>`
                SELECT run_min_zoom AS min, instance_count AS count, instance, ST_AsText(geom) AS wkt
                FROM landscape_label_run WHERE region_id = ${regionId}
                ORDER BY run_min_zoom, instance_count, instance
            `;

        it("schreibt je Stufe einen Lauf, und ein zweiter Aufruf ersetzt ihn Koordinate für Koordinate", async () => {
            const first = await refreshLabelCurve(database, publicId);
            const before = await stored();
            const second = await refreshLabelCurve(database, publicId);
            const after = await stored();

            expect(first).toEqual(second);
            expect(first.status === "written" ? first.runs : 0).toBe(before.length);
            expect(after).toEqual(before);
            // Jede Stufe des Erscheinungsbands hat ihren eigenen Satz.
            const zooms = [...new Set(after.map((row) => row.min))];
            expect(zooms).toEqual(
                Array.from(
                    { length: renderZoomForBand(7) - renderZoomForBand(2) + 1 },
                    (_, i) => renderZoomForBand(2) + i,
                ),
            );
        });

        it("🔴 zwei gleichzeitige Aufrufe für dieselbe Region laufen nacheinander, nicht ineinander", async () => {
            const expected = (await refreshLabelCurve(database, publicId)).status;
            const reference = await stored();
            const outcomes = await Promise.all([
                refreshLabelCurve(database, publicId),
                refreshLabelCurve(database, publicId),
                refreshLabelCurve(database, publicId),
            ]);
            expect(outcomes.map((outcome) => outcome.status)).toEqual([expected, expected, expected]);
            expect(await stored()).toEqual(reference);
        });

        it("ausgeschaltete Kurvenbeschriftung räumt die Läufe weg, damit das Punktlabel steht", async () => {
            await refreshLabelCurve(database, publicId);
            await database`UPDATE region SET label_curve_enabled = false WHERE id = ${regionId}`;
            const outcome = await refreshLabelCurve(database, publicId);
            await database`UPDATE region SET label_curve_enabled = true WHERE id = ${regionId}`;

            expect(outcome).toEqual({ status: "skipped", name: "Teststreifen", reason: "Kurvenbeschriftung aus" });
            expect(await stored()).toEqual([]);
        });

        it("sagt bei einer unbekannten Region, dass es sie nicht gibt, statt still nichts zu tun", async () => {
            for (const unknown of ["00000000-0000-4000-8000-00000000ffff", "keine-uuid"]) {
                expect(await refreshLabelCurve(database, unknown)).toEqual({ status: "not-found", publicId: unknown });
            }
        });
    });

    describe("Sammelberechnung und Fingerabdruck (WI-0019)", () => {
        const publicId = "00000000-0000-4000-8000-0000000004a1";
        const widestName = async (): Promise<number> => {
            const [row] = await database<{ width: number }[]>`
                SELECT max(name_width_px)::float AS width FROM landscape_label_run WHERE region_id = ${regionId}
            `;
            return row?.width ?? 0;
        };

        it("🔴 Regression: ein länger gewordener Name wird bei der nächsten Sammelberechnung neu gerechnet", async () => {
            // 🪤 EINE Instanz, wie bei den meisten Regionen. Bei drei ändert der längere Name die
            // ZAHL der Läufe, und der Anzahlvergleich der Sammelberechnung fängt es zufällig ab - der
            // Test bliebe dann auch mit dem alten Fingerabdruck grün (so geschehen beim ersten Anlauf).
            await database`UPDATE region SET label_curve_max = 1 WHERE id = ${regionId}`;
            await refreshLabelCurve(database, publicId);
            const before = await widestName();
            await database`UPDATE map_label SET name = 'Teststreifen mit sehr viel längerem Namen' WHERE id = ${labelId}`;
            try {
                // Vorher kannte der Fingerabdruck nur die Flächen: die Region galt als unverändert,
                // der alte, kürzere Lauf blieb stehen, MapLibre ließ den längeren Namen still weg -
                // und das Punktlabel war wegen `has_curve_run` ausgeblendet. Der Name verschwand ganz.
                const report = await deriveAll(database, { all: false });
                expect(report.written).toContain("Teststreifen");
                expect(await widestName()).toBeGreaterThan(before);
            } finally {
                await database`UPDATE map_label SET name = 'Teststreifen' WHERE id = ${labelId}`;
                await database`UPDATE region SET label_curve_max = 3 WHERE id = ${regionId}`;
            }
        });

        const runCount = async (): Promise<number> => {
            const [row] = await database<{ count: number }[]>`
                SELECT count(*)::int AS count FROM landscape_label_run WHERE region_id = ${regionId}
            `;
            return row?.count ?? 0;
        };

        it("🔴 Regression (Legacy-Stand 2026-09-26): die Sammelberechnung räumt die Läufe einer stillgelegten Region weg", async () => {
            // Legacy hat Amboss, Finsterkamm und Koschberge als Gebirge gelöscht und unter neuer
            // Kennung neu angelegt. Die alten Regionen wurden stillgelegt, ihre Läufe blieben liegen:
            // unsichtbar, weil die Sicht nach is_active filtert, aber verify:runs fand je Name zwei
            // Fingerabdrücke, und der Stage-Import wäre im Zwischenstand stehen geblieben.
            await refreshLabelCurve(database, publicId);
            expect(await runCount()).toBeGreaterThan(0);
            await database`UPDATE region SET is_active = false WHERE id = ${regionId}`;
            try {
                const first = await deriveAll(database, { all: false });
                expect(first.removed).toContain("Teststreifen");
                expect(await runCount()).toBe(0);
                // Ein zweiter Lauf findet nichts mehr: die Idempotenzprobe des Imports bleibt grün.
                expect((await deriveAll(database, { all: false })).removed).toEqual([]);
            } finally {
                await database`UPDATE region SET is_active = true WHERE id = ${regionId}`;
            }
        });

        it("ausgeschaltete Kurvenbeschriftung: die Sammelberechnung räumt wie der Einzelaufruf", async () => {
            // Die Sicht fragt label_curve_enabled nicht ab. Ein liegengebliebener Lauf stünde also auf
            // der Karte und verdeckte über has_curve_run das Punktlabel (I7).
            await refreshLabelCurve(database, publicId);
            await database`UPDATE region SET label_curve_enabled = false WHERE id = ${regionId}`;
            try {
                const report = await deriveAll(database, { all: false });
                expect(report.removed).toContain("Teststreifen");
                expect(await runCount()).toBe(0);
            } finally {
                await database`UPDATE region SET label_curve_enabled = true WHERE id = ${regionId}`;
            }
        });

        it("verify:runs nennt Läufe, die keiner aktiven Kurvenregion mehr gehören", async () => {
            await refreshLabelCurve(database, publicId);
            await database`UPDATE region SET is_active = false WHERE id = ${regionId}`;
            try {
                const report = await verifyRuns(database);
                const orphans = report.checks.find((entry) => entry.name === "nur_aktive_kurvenregionen");
                expect(orphans?.passed).toBe(false);
                expect(orphans?.offenders).toContain("Teststreifen");
                // Betreiber 2026-10-03: Das ist keine Prüfung aus der Liste (ADR-0007 nennt sie nicht), also ein Befund.
                expect(orphans?.blocking).toBe(false);
                const befunde = checkFindings("verify:runs", report.checks, (entry) => entry.passed);
                expect(befunde.map((befund) => befund.code)).toContain("verify:runs/nur_aktive_kurvenregionen");
                expect(befunde.find((b) => b.code.endsWith("nur_aktive_kurvenregionen"))?.notes).toContain(
                    "Teststreifen",
                );
            } finally {
                await database`UPDATE region SET is_active = true WHERE id = ${regionId}`;
            }
            const report = await verifyRuns(database);
            expect(report.checks.find((entry) => entry.name === "nur_aktive_kurvenregionen")?.passed).toBe(true);
        });

        it("🔴 Regression (Legacy-Stand 2026-09-28): zwei aktive Regionen mit demselben Namen sind kein Fingerabdruck-Mix", async () => {
            // Legacys „Umbau der Gebirge" legt seither Regionen an, die den Namen ihrer Oberregion
            // teilen (Amboss, Koschberge je zweimal aktiv). I6 gruppierte nach Name statt nach Region
            // und hätte das als Mix gemeldet, obwohl jede Region für sich einen einzigen, stimmigen
            // Fingerabdruck trägt.
            await refreshLabelCurve(database, publicId);

            const zwillingPublicId = "00000000-0000-4000-8000-0000000004a2";
            const [zwilling] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active,
                                    label_curve_enabled, label_curve_max)
                VALUES (${zwillingPublicId}, 'aventuria', 'Teststreifen', 'topographie', true, true, 1)
                ON CONFLICT (public_id) DO UPDATE SET label_curve_max = 1
                RETURNING id::text
            `;
            const zwillingId = Number(zwilling?.id);
            const [zwillingLabel] = await database<{ id: string }[]>`
                INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active,
                                       label_size, label_min_zoom, label_max_zoom, label_priority, region_id)
                VALUES ('00000000-0000-4000-8000-0000000004b2', 'aventuria', 'Teststreifen',
                        ST_SetSRID(ST_MakePoint(700, 500), 0), true, 18, 2, 7, 3, ${zwillingId})
                ON CONFLICT (public_id) DO UPDATE SET region_id = ${zwillingId}
                RETURNING id::text
            `;
            const zwillingLabelId = Number(zwillingLabel?.id);
            await database`UPDATE region SET primary_label_id = ${zwillingLabelId} WHERE id = ${zwillingId}`;
            await database`DELETE FROM region_area WHERE region_id = ${zwillingId}`;
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active,
                                         geometry_revision)
                VALUES ('00000000-0000-4000-8000-0000000004c2', 'aventuria', ${zwillingId},
                        ST_SetSRID(ST_GeomFromText(${stripWkt(700, 500, 120, 14, -8)}), 0), true, 1)
            `;
            try {
                await refreshLabelCurve(database, zwillingPublicId);
                const report = await verifyRuns(database);
                expect(report.checks.find((entry) => entry.name === "I6_ein_fingerabdruck_je_region")?.passed).toBe(
                    true,
                );
            } finally {
                await database`DELETE FROM landscape_label_run WHERE region_id = ${zwillingId}`;
                await database`UPDATE region SET primary_label_id = NULL WHERE id = ${zwillingId}`;
                await database`DELETE FROM map_label WHERE id = ${zwillingLabelId}`;
                await database`DELETE FROM region_area WHERE region_id = ${zwillingId}`;
                await database`DELETE FROM region WHERE id = ${zwillingId}`;
            }
        });

        it("ein gespeicherter Grad überlebt die Sammelberechnung", async () => {
            await database`UPDATE region SET label_curve_degree = 5 WHERE id = ${regionId}`;
            try {
                await deriveAll(database, { all: true });
                const expected = await deriveRegion(database, input({ curveMax: 3, curveDegree: 5 }));
                const legacyDegree = await deriveRegion(database, input({ curveMax: 3, curveDegree: 3 }));
                const stored = await database<{ fingerprint: string }[]>`
                    SELECT DISTINCT source_fingerprint AS fingerprint FROM landscape_label_run WHERE region_id = ${regionId}
                `;
                expect(stored).toEqual([{ fingerprint: expected.fingerprint }]);
                expect(expected.fingerprint).not.toEqual(legacyDegree.fingerprint);
                // Und der Grad wirkt auf die Kurve, nicht nur auf den Fingerabdruck.
                expect(expected.curveLength).not.toBeCloseTo(legacyDegree.curveLength, 6);
            } finally {
                await database`UPDATE region SET label_curve_degree = NULL WHERE id = ${regionId}`;
            }
        });

        it("die Datenbank lässt nur die Grade 2 bis 5 zu", async () => {
            for (const degree of [1, 6]) {
                await expect(
                    database`UPDATE region SET label_curve_degree = ${degree} WHERE id = ${regionId}`,
                ).rejects.toThrow(/region_label_curve_degree_range/);
            }
        });
    });
});
