import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA, countBorderCrossings, prepareBorderTerritory, type BorderSegment } from "@avesmaps3d/shared";
import {
    LEGACY_MIRROR,
    compareCode,
    loadLegacyBorders,
    readPinnedLegacySource,
} from "../../../scripts/dev/legacy-route-costs.ts";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { openGateService, type GateService } from "../src/routing/corpus-gate-run.ts";
import { FULL_INVARIANTS, scaled } from "./support/invariants.ts";
import {
    BORDER_RULE,
    DEFAULT_SEED,
    ExactBorders,
    MILES_PER_UNIT,
    RULE_MUTANTS,
    STEP_MILES,
    checkRootSet,
    crossingProblems,
    crossingsOf,
    describeDeviation,
    drawnTrips,
    explainedBy,
    findMutantWitnesses,
    gateTrips,
    legacyTerritories,
    loadOracleRoots,
    maxDeviations,
    measureTrip,
    mutantShows,
    pairsOf,
    routeTrips,
    smallSubset,
    summarizeRows,
    type MutantWitnesses,
    type OracleContext,
    type OracleRow,
    type OracleTrip,
    type RootSetFinding,
} from "./support/toll-oracle.ts";

/**
 * Die Zollzählung gegen zwei Implementierungen (WI-0065 U6): unsere Zählung (A) gegen Legacys Code, unverändert
 * ausgeführt (B1), und gegen eine exakte Rechnung in PostGIS mit eigener Zusammenfassung (B2). Rechenwege und
 * Toleranz stehen in `support/toll-oracle.ts`; dieselbe Rechnung zeigt `npm run compare:tolls` als Tabelle je Reise.
 *
 * Wie `route-corpus-gate.test.ts` gegen `DATABASE_URL`, nicht gegen die Testdatenbank; ohne Datenbank, ohne abgeleitete
 * Gebiete oder ohne Discovery-Mirror überspringt der betroffene Test SICHTBAR. Nur lesend. Umfang: eine kleine Teilmenge
 * in `npm test`, der volle Korpus (die Fälle des Routing-Gates und 196 gezogene Reisen, fester Seed 65) mit
 * `npm run gate:routing-invariants`; dazu je Regelmutant eine gesuchte Reise, an der er sich zeigt
 * (`findMutantWitnesses`).
 */

describe("Drift-Wächter: der Textvergleich der Zählung (ohne Datenbank, ohne Mirror)", () => {
    const file = (body: string, elsewhere = ""): string =>
        `// Kopf\n${elsewhere}\n// Schrittweite der Grenz-Abtastung\nconst STEP = 0.4;\nfunction avesmapsCountRouteStateBorders(a) {\n${body}\n}\n// danach\n`;

    it("dieselbe Datei ist unverändert, eine Änderung daneben ändert die Regel nicht", () => {
        expect(compareCode(file("return 1;"), file("return 1;")).state).toBe("same-file");
        expect(compareCode(file("return 1;"), file("return 1;", "// Kostenzeilen neu")).state).toBe("same-code");
    });

    it("🔴 eine geänderte Zählung ist Drift, ebenso eine, die nicht mehr auffindbar ist", () => {
        expect(compareCode(file("return 1;"), file("return 2;")).state).toBe("drifted");
        expect(compareCode(file("return 1;"), "function andere() {}\n").state).toBe("drifted");
    });

    it("die Zählung ist der festgehaltene Stand, wenn der Mirror lesbar ist (sonst sichtbarer Skip)", (context) => {
        const source = readPinnedLegacySource();
        if (source === null) return context.skip(`Discovery-Mirror ${LEGACY_MIRROR} nicht lesbar`);
        expect(compareCode(source, source).state).toBe("same-file");
    });
});

describe("Zeugen der Regelmutanten: der Suchmaßstab (ohne Datenbank)", () => {
    // Eine gerade Linie von x = 0 bis 30 (eine Strecke, 90 Meilen) durch „West“, darin ein Streifen „Ost“. Die
    // Abtastung trifft die Punkte k · 0,4 (fein) beziehungsweise k · 1,2 (Mutant) Einheiten, je Punkt 1,2
    // beziehungsweise 3,6 Meilen.
    const square = (name: string, from: number, to: number, height = 1) => {
        const territory = prepareBorderTerritory({
            id: name,
            name,
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [from, -height],
                        [to, -height],
                        [to, height],
                        [from, height],
                        [from, -height],
                    ],
                ],
            },
        });
        if (territory === null) throw new Error(name);
        return territory;
    };
    const line: BorderSegment[] = [
        {
            geometry: {
                coordinates: [
                    [0, 0],
                    [30, 0],
                ],
            },
        },
    ];
    const shows = (eastFrom: number, eastTo: number): string[] => {
        // Das erste Gebiet der Liste gewinnt: „Ost“ liegt vor „West“.
        const territories = [square("Ost", eastFrom, eastTo), square("West", -100, 100, 2)];
        return RULE_MUTANTS.filter((mutant) => mutantShows(line, territories, mutant.rule)).map(
            (mutant) => mutant.name,
        );
    };

    it("ein Lauf von 6 Meilen (fein 5 Punkte, grob 1 Punkt) zeigt Schwelle 8 und das grobe Raster", () => {
        expect(shows(9.9, 11.9)).toEqual(["Schwelle 8 statt 5 Meilen", "Abtastschritt 1,2 statt 0,4 Einheiten"]);
    });

    it("ein Lauf von 3,6 Meilen zeigt Schwelle 3", () => {
        expect(shows(9.9, 11.1)).toEqual(["Schwelle 3 statt 5 Meilen"]);
    });

    it("ein langer Lauf zeigt keinen Mutanten: dort hilft er nicht als Zeuge", () => {
        expect(shows(9.9, 19.9)).toEqual([]);
    });
});

describe("Zusammenfassung der Läufe (B2, ohne Datenbank)", () => {
    it("bricht bei einem zu kleinen Ortsbestand ab, statt unbegrenzt dasselbe Ziel zu ziehen", async () => {
        const database = (async () => [{ id: "one", name: "Gareth", port: true }]) as unknown as Queryable;
        await expect(drawnTrips(database, DEFAULT_SEED)).rejects.toThrow("mindestens zwei Orte und zwei Häfen");
    });

    const runs = (...entries: [string, number][]): { name: string; miles: number }[] =>
        entries.map(([name, miles]) => ({ name, miles }));

    it("ein Lauf unter der Schwelle ist kein Übertritt, gleiche Nachbarn verschmelzen", () => {
        expect(crossingsOf(runs(["West", 50], ["Ost", 3], ["West", 50]), 5).count).toBe(0);
        expect(crossingsOf(runs(["West", 50], ["Ost", 50]), 5).pairs).toEqual(["West > Ost"]);
        expect(crossingsOf(runs(["West", 50], ["Ost", 50], ["West", 50]), 5).count).toBe(2);
    });

    it("„kein Gebiet“ trägt keinen Zoll: ein Wechsel von oder zu einem Lauf ohne Namen zählt nicht", () => {
        expect(crossingsOf(runs(["West", 50], ["", 50], ["Ost", 50]), 5).count).toBe(0);
        expect(crossingsOf(runs(["West", 50], ["", 3], ["Ost", 50]), 5).count).toBe(1);
    });

    it("⚠️ Legacy-Eigenheit: ein kurzer erster Lauf bleibt stehen, ein kurzer letzter wird geschluckt", () => {
        const there = runs(["West", 1.5], ["Ost", 50]);
        expect(crossingsOf(there, 5).count).toBe(1);
        expect(crossingsOf([...there].reverse(), 5).count).toBe(0);
    });
});

describe("Toleranz von A gegen B2: je Lauf, den die Abtastung anders sehen kann, nicht als Zahl (ohne Datenbank)", () => {
    const runs = (...entries: [string, number][]): { name: string; miles: number }[] =>
        entries.map(([name, miles]) => ({ name, miles }));
    const explained = (exact: { name: string; miles: number }[], pairs: string[]): boolean =>
        explainedBy(exact, 5, STEP_MILES, pairs);

    it("ohne Lauf nahe der Schwelle gilt streng: dieselben Übertritte in derselben Reihenfolge", () => {
        const exact = runs(["West", 50], ["Ost", 50], ["West", 50]);
        expect(explained(exact, ["West > Ost", "Ost > West"])).toBe(true);
        expect(explained(exact, ["West > Ost"])).toBe(false);
        expect(explained(exact, ["Ost > West", "West > Ost"])).toBe(false);
        expect(explained(exact, ["West > Süd", "Süd > West"])).toBe(false);
    });

    it("🔴 zwei Läufe nahe der Schwelle heben sich in der Zahl auf: andere Übertritte, aber erklärt (Simiador > Nhiran)", () => {
        // Ein Weg entlang zweier Grenzen: B2 sieht „Mitte“ unter, „West“ über der Schwelle, die Abtastung umgekehrt.
        const exact = runs(["West", 20], ["Mitte", 4.84], ["West", 20], ["Süd", 20], ["West", 5.11], ["Süd", 20]);
        const b2 = crossingsOf(exact, 5).pairs;
        const sampled = ["West > Mitte", "Mitte > West", "West > Süd"];
        expect(b2).toEqual(["West > Süd", "Süd > West", "West > Süd"]);
        expect(sampled.length).toBe(b2.length);
        expect(explained(exact, sampled)).toBe(true);
        expect(explained(exact, b2)).toBe(true);
        // Gleiche Zahl, aber ein Übertritt, den keine Wahl erklärt: ein Befund.
        expect(explained(exact, ["West > Mitte", "Mitte > Süd", "Süd > West"])).toBe(false);
    });

    it("ein Lauf nahe der Schwelle zwischen gleichen Nachbarn verschiebt die Zahl um zwei (Salzmarken > Fairnhain)", () => {
        const exact = runs(["Reich", 50], ["Nord", 13.8], ["Reich", 5.05], ["Nord", 11.7], ["Reich", 50]);
        expect(explained(exact, ["Reich > Nord", "Nord > Reich", "Reich > Nord", "Nord > Reich"])).toBe(true);
        expect(explained(exact, ["Reich > Nord", "Nord > Reich"])).toBe(true);
        expect(explained(exact, ["Reich > Nord", "Nord > Reich", "Reich > Nord"])).toBe(false);
    });

    it("ein Lauf unter einem Schritt kann der Abtastung entgehen: seine Nachbarn werden EIN Lauf (Gareth > Havena)", () => {
        // Zwei kurze Läufe, getrennt von einem Streifen von 1,04 Meilen: exakt fällt alles weg, abgetastet ist es ein Lauf
        // von rund 6 Meilen, der bleibt.
        const exact = runs(["Reich", 50], ["Berg", 2.09], ["Reich", 1.04], ["Berg", 2.92], ["Reich", 50]);
        expect(crossingsOf(exact, 5).pairs).toEqual([]);
        expect(explained(exact, [])).toBe(true);
        expect(explained(exact, ["Reich > Berg", "Berg > Reich"])).toBe(true);
        // Ein Streifen über einem Schritt entgeht ihr nicht, ebenso wenig ein Lauf, der nicht abweichen darf (`free`).
        const wide = runs(["Reich", 50], ["Berg", 2.09], ["Reich", 1.5], ["Berg", 2.92], ["Reich", 50]);
        expect(explained(wide, ["Reich > Berg", "Berg > Reich"])).toBe(false);
        expect(explainedBy(exact, 5, STEP_MILES, ["Reich > Berg", "Berg > Reich"], (index) => index !== 2)).toBe(false);
    });

    it("der erste Lauf bleibt immer; ein Lauf ohne Gebiet nahe der Schwelle trennt oder verbindet", () => {
        expect(explained(runs(["West", 1.5], ["Ost", 50]), ["West > Ost"])).toBe(true);
        expect(explained(runs(["West", 1.5], ["Ost", 50]), [])).toBe(false);
        const gap = runs(["West", 50], ["", 4.5], ["Ost", 50]);
        expect(explained(gap, [])).toBe(true);
        expect(explained(gap, ["West > Ost"])).toBe(true);
        expect(explained(runs(["West", 50], ["", 2], ["Ost", 50]), [])).toBe(false);
        expect(explained([], [])).toBe(true);
        expect(explained([], ["West > Ost"])).toBe(false);
    });

    it("Kontrolle (b): hin und zurück um 2 verschieden ist erklärt, wenn ein Lauf nahe der Schwelle beide Richtungen erklärt", () => {
        const exact = runs(["Reich", 50], ["Nord", 13.8], ["Reich", 5.05], ["Nord", 11.7], ["Reich", 50]);
        const hin = ["Reich > Nord", "Nord > Reich"];
        const zurück = ["Reich > Nord", "Nord > Reich", "Reich > Nord", "Nord > Reich"];
        expect(crossingProblems(exact, hin, zurück)).toEqual([]);
        // Ohne Lauf nahe der Schwelle bleibt es ein Befund, auch wenn beide Enden lang sind.
        const far = runs(["Reich", 50], ["Nord", 13.8], ["Reich", 20], ["Nord", 11.7], ["Reich", 50]);
        const far4 = crossingsOf(far, 5).pairs;
        expect(far4).toHaveLength(4);
        expect(crossingProblems(far, far4, far4.slice(0, 2))).toEqual([
            expect.stringMatching(/^Rückweg: A 2 ≠ B2 4/),
            "(b) Hin 4, zurück 2: mehr als 1 Unterschied",
        ]);
        // Die Legacy-Eigenheit bleibt erklärt: ein kurzer erster Lauf zählt nur hin.
        const short = runs(["West", 1.5], ["Ost", 50]);
        expect(crossingProblems(short, ["West > Ost"], [])).toEqual([]);
        expect(crossingProblems(runs(["West", 50], ["Ost", 50]), ["West > Ost"], [])).toEqual([
            expect.stringMatching(/^Rückweg: A 0 ≠ B2 1/),
            "(b) Hin 1, zurück 0, obwohl Start- und Ziellauf lang sind (50.00 und 50.00 Meilen)",
        ]);
    });
});

const databaseUrl = process.env["DATABASE_URL"];
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const TIMEOUT = scaled(120_000, 1_800_000);

describeWithDatabase("Zollzählung gegen Legacys Code und die exakte Rechnung (Entwicklungsdaten)", () => {
    let database: Database | undefined;
    let gate: GateService | undefined;
    let context: OracleContext | undefined;
    let unavailable: string | undefined;
    const rows: OracleRow[] = [];
    let skipped: string[] = [];
    let finding: RootSetFinding | undefined;
    let trips: OracleTrip[] = [];
    // Je Regelmutant eine Reise, an der er sich zeigt; ausgesucht, deshalb nur in den Prüfungen je Reise, nie in der
    // Statistik.
    let witnessSearch: MutantWitnesses | undefined;
    const witnesses: OracleRow[] = [];

    beforeAll(async () => {
        if (!databaseUrl) return;
        try {
            database = createDatabase(databaseUrl, { max: 2 });
            gate = await openGateService(database);
            if (gate.data.network.nodes.size < 100) unavailable = "die Datenbank enthält keine Routingdaten";
            else if (gate.data.territories?.territories.length === 0 || !gate.data.territories) {
                unavailable = "keine abgeleiteten Gebiete (npm run derive:territories)";
            }
        } catch (error) {
            unavailable = `die Datenbank ist nicht lesbar (${error instanceof Error ? error.name : "unbekannt"})`;
        }
        if (unavailable || !database || !gate?.data.territories) return;

        const roots = await loadOracleRoots(database, AVENTURIA.mapDomain);
        finding = await checkRootSet(database, AVENTURIA.mapDomain, roots);
        const source = readPinnedLegacySource();
        const code = source === null ? null : loadLegacyBorders(source, MILES_PER_UNIT);
        context = {
            territories: gate.data.territories.territories,
            yearBf: gate.data.territories.yearBf,
            roots,
            legacy: code === null ? null : { code, territories: legacyTerritories(code, roots) },
            exact: new ExactBorders(database, AVENTURIA.mapDomain, roots),
        };

        const drawn = await drawnTrips(database, DEFAULT_SEED);
        const fromGate = FULL_INVARIANTS ? gateTrips(gate) : { trips: [], skipped: [] };
        trips = FULL_INVARIANTS ? [...fromGate.trips, ...drawn] : smallSubset(drawn);
        const routed = await routeTrips(gate, trips);
        skipped = [
            ...fromGate.skipped,
            ...routed.filter((one) => one.response === null).map((one) => `${one.trip.label}: ${one.skipped ?? "?"}`),
        ];
        for (const one of routed) {
            if (one.response !== null) rows.push(await measureTrip(context, one));
        }
        if (context.legacy !== null) {
            witnessSearch = await findMutantWitnesses(database, gate, context.territories, rows);
            for (const one of witnessSearch.routed) witnesses.push(await measureTrip(context, one));
        }
    }, TIMEOUT);

    afterAll(async () => {
        await database?.end({ timeout: 5 });
    });

    const problemsMatching = (pattern: RegExp): string[] =>
        [...rows, ...witnesses].flatMap((row) =>
            row.problems.filter((problem) => pattern.test(problem)).map((problem) => `${row.trip.label}: ${problem}`),
        );

    it("der Korpus zählt etwas: Reisen ohne und mit Grenzen, viele Grenzen, Schiff und Land", (test) => {
        if (unavailable || !context) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
        const summary = summarizeRows(rows);
        if (FULL_INVARIANTS) {
            const line = (label: string, value: string): string => `  ${label}: ${value}`;
            const timing = (one: { median: number; p95: number; max: number; total: number } | null): string =>
                one === null
                    ? "-"
                    : `Median ${one.median.toFixed(1)} ms, p95 ${one.p95.toFixed(1)} ms, größte ${one.max.toFixed(1)} ms, gesamt ${(one.total / 1000).toFixed(1)} s`;
            console.warn(
                [
                    `Zollzählung: ${String(summary.trips)} Reisen (übersprungen ${String(skipped.length)}), ${String(summary.crossings)} Grenzen, meiste ${String(summary.most?.a?.count)} (${summary.most?.trip.label ?? "-"})`,
                    line("A = B1 (Legacys Code)", `${String(summary.aEqualsB1)} von ${String(summary.b1Compared)}`),
                    line(
                        "A = B2 (exakt)",
                        `${String(summary.aEqualsB2)} von ${String(summary.trips)}; Grenzfälle ${String(summary.counted.length)} (erlaubt ${String(maxDeviations(summary.trips))}), dazu auf Wegen entlang einer Grenze ${String(summary.borderRoads.length)} (Befund); Reisen mit Lauf nahe der Schwelle ${String(summary.nearRoutes)}`,
                    ),
                    ...summary.deviations.map((row) => `    Grenzfall: ${describeDeviation(row)}`),
                    line("Zählzeit A", timing(summary.timesMs.a)),
                    line("Zählzeit B1", timing(summary.timesMs.b1)),
                    line("Rechenzeit B2 (PostGIS)", timing(summary.timesMs.b2)),
                    ...skipped.map((entry) => `    übersprungen: ${entry}`),
                ].join("\n"),
            );
        }
        expect(rows.length).toBeGreaterThanOrEqual(scaled(8, 200));
        const counts = rows.map((row) => row.a?.count ?? 0);
        expect(counts.filter((count) => count === 0).length).toBeGreaterThan(0);
        expect(counts.filter((count) => count >= 1).length).toBeGreaterThan(2);
        expect(Math.max(...counts)).toBeGreaterThanOrEqual(scaled(6, 10));
        expect(rows.some((row) => row.served.by_lodging.frei.rows.some((line) => line.key === "sea"))).toBe(true);
    });

    it("🔴 A und B1 (Legacys Code, unverändert im vm-Kontext) zählen bei JEDER Reise dasselbe", (test) => {
        if (unavailable || !context) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
        if (context.legacy === null) return test.skip(`Discovery-Mirror ${LEGACY_MIRROR} nicht lesbar`);
        const summary = summarizeRows(rows);
        expect(problemsMatching(/≠ B1/)).toEqual([]);
        expect(summary.aEqualsB1).toBe(summary.b1Compared);
        expect(summary.b1Compared).toBe(rows.length);
    });

    it("🔴 A gegen B2 (exakt in PostGIS): gleich, außer wo die Abtastung einen Lauf anders sehen kann; höchstens 3 % des Korpus, Wege auf der Grenze als Befund", (test) => {
        if (unavailable || !context) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
        const summary = summarizeRows(rows);
        // Jede Abweichung, hin wie zurück, entsteht aus einer Wahl der Läufe nahe der Schwelle oder unter einem Schritt
        // (`explainedBy`); sonst steht sie als „≠ B2“ in den Befunden der Reise.
        expect(problemsMatching(/≠ B2/)).toEqual([]);
        // Jede Ausnahme mit Reise und Länge im Protokoll (nur der volle Satz, sonst rauscht `npm test`).
        if (FULL_INVARIANTS) {
            for (const row of summary.counted) console.warn(`Grenzfall: ${describeDeviation(row)}`);
            for (const row of summary.borderRoads) console.warn(`Grenzfall, Befund: ${describeDeviation(row)}`);
        }
        // Die 3 % gelten für die Grenzfälle, die NICHT auf einem Weg entlang einer Grenze liegen: Dort zählen Abtastung und
        // exakte Rechnung zu Recht verschieden, das ist ein Befund an den Gebietsgrenzen (`borderRoad`), keine Aussage über A.
        expect(
            summary.counted.length,
            summary.counted.map((row) => describeDeviation(row)).join("; "),
        ).toBeLessThanOrEqual(maxDeviations(summary.trips));
    });

    it("B2s Zusammenfassung ist Legacys Regel: auf der Abtastung von A gleicht sie A und B1 (B3)", (test) => {
        if (unavailable || !context) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
        expect(problemsMatching(/≠ B3/)).toEqual([]);
    });

    it("Kontrolle (a): die Summe der Lauflängen gleicht der Länge der Linie, abgetastet und exakt", (test) => {
        if (unavailable || !context) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
        expect(problemsMatching(/\(a\)/)).toEqual([]);
    });

    it("Kontrolle (b): der Rückweg derselben Linie weicht höchstens um 1 ab, und nur bei kurzem Start- oder Ziellauf (mehr nur, wo die Abtastung beide Richtungen erklärt)", (test) => {
        if (unavailable || !context) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
        expect(problemsMatching(/\(b\)/)).toEqual([]);
        // Die Eigenheit ist beobachtet UND erklärt: Wo hin und zurück verschieden zählen, ist ein Ende kurz.
        const asymmetric = rows.filter((row) => row.a?.count !== row.back.a);
        if (FULL_INVARIANTS) {
            console.warn(`Hin und zurück verschieden: ${String(asymmetric.length)} von ${String(rows.length)} Reisen`);
        }
    });

    it("Kontrolle (c): die Zahl der Übertritte hängt nicht an der Unterbringung, der Zoll je Stufe ist Grenzen mal Tafel und wächst", (test) => {
        if (unavailable || !context) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
        expect(problemsMatching(/\(c\)/)).toEqual([]);
        // Jede Reise trägt dieselben Grenzen in allen vier Stufen: `by_lodging.<stufe>` hat keine eigene Zahl.
        for (const row of rows) {
            const tolls = Object.values(row.served.by_lodging).map(
                (costs) => costs.rows.find((line) => line.key === "tolls")?.count,
            );
            expect(new Set(tolls).size, row.trip.label).toBe(1);
        }
    });

    it(
        "🔴 der Oracle ist nicht blind: ein Port mit falscher Regel oder falschen Gebieten wird gefunden",
        (test) => {
            if (unavailable || !context) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
            const territories = context.territories;
            // Ein Vergleich, der bei einem falschen Port nichts findet, prüft nichts. Regelmutanten (andere Schwelle,
            // gröberes Raster) findet Legacys Code, denn er ist der Beweis der Parität; ein Gebietsmutant (das Reich
            // mit den meisten Läufen fehlt) auch die exakte Rechnung, die die Gebiete selbst liest. B2 sieht
            // Schwellenfehler NICHT sicher: Ihre Toleranz (Läufe nahe der Schwelle) deckt sie auf zickzackenden
            // Straßen ab, dafür gibt es B1.
            // 🪤 Ob eine GEZOGENE Reise einen Mutanten zeigt, hängt am Datenstand (Befund 2026-10-11: nach dem Zug
            // `map179380` zeigte keine der acht Reisen der Teilmenge das grobe Raster). Deshalb je Mutant ein
            // gesuchter Zeuge.
            if (context.legacy !== null) {
                const search = witnessSearch;
                if (!search) throw new Error("die Suche nach Zeugen lief nicht");
                if (FULL_INVARIANTS) {
                    console.warn(
                        `Zeugen der Regelmutanten (${String(search.searched)} Reisen gesucht): ${search.found.map((one) => `${one.mutant}: ${one.trip}`).join("; ")}`,
                    );
                }
                expect(search.missing, `kein Zeuge unter ${String(search.searched)} gesuchten Reisen`).toEqual([]);
                for (const mutant of RULE_MUTANTS) {
                    const wrong = [...rows, ...witnesses].filter(
                        (row) =>
                            countBorderCrossings(row.segments, territories, MILES_PER_UNIT, mutant.rule)?.count !==
                            row.b1,
                    );
                    const witness = search.found.find((one) => one.mutant === mutant.name)?.trip ?? "-";
                    expect(wrong.length, `B1 findet: ${mutant.name} (Zeuge ${witness})`).toBeGreaterThan(0);
                }
            }
            const miles = new Map<string, number>();
            for (const row of rows)
                for (const run of row.exact.runs) miles.set(run.name, (miles.get(run.name) ?? 0) + run.miles);
            const [biggest] = [...miles.entries()].filter(([name]) => name !== "").sort((a, b) => b[1] - a[1])[0] ?? [];
            const without = territories.filter((territory) => territory.name !== biggest);
            expect(without.length).toBe(territories.length - 1);
            // Derselbe Maßstab wie „A gegen B2“: Die Übertritte des Mutanten erklärt keine Abtastung der exakten Läufe.
            const wrong = rows.filter(
                (row) =>
                    !explainedBy(
                        row.exact.runs,
                        BORDER_RULE.mindestLaufMeilen,
                        STEP_MILES,
                        pairsOf(countBorderCrossings(row.segments, without, MILES_PER_UNIT, BORDER_RULE)),
                    ),
            );
            expect(wrong.length, `B2 findet: ${biggest ?? "?"} fehlt`).toBeGreaterThan(0);
        },
        // Vier Mutanten mal jede Reise: im vollen Satz rund 1.000 Zählungen, unter Last mehr als die 5 s der Vorgabe.
        TIMEOUT,
    );

    it("Kontrolle (d): die Zollgebiete sind die Herrschaftsgebiete ohne Elternteil mit einer Fläche im Teilbaum; Wehrheim ist ein benannter Befund", (test) => {
        if (unavailable || !context || !finding) return test.skip(`übersprungen: ${unavailable ?? "kein Kontext"}`);
        // Der Lader hält dieselben Gebiete in derselben Reihenfolge wie die eigene Abfrage.
        expect(context.territories.map((territory) => territory.id)).toEqual(context.roots.map((root) => root.id));
        expect({ onlyBand0: finding.onlyBand0, onlyNominal: finding.onlyNominal }).toEqual({
            onlyBand0: [],
            onlyNominal: [],
        });
        expect(finding.band0).toBe(finding.nominal);
        if (FULL_INVARIANTS) {
            console.warn(
                `Zollgebiete: ${String(finding.band0)} Wurzeln im Band 0; wirksam souverän, aber nicht im Band 0 (zählen nicht, Legacy): ${finding.effectiveOutsideBand0.join(", ") || "keine"}`,
            );
        }
        expect(trips.length).toBeGreaterThan(0);
    });
});
