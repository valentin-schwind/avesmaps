import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MapPointDetail, SubjectDetail, type SubjectDetail as SubjectDetailType } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { createSubjectService, type DetailRequest, type SubjectService } from "../src/subjects/service.ts";
import { P7, cleanP7Fixtures, insertP7Fixtures } from "./support/p7-fixture.ts";

/**
 * WI-0063 P7 gegen echtes PostgreSQL und PostGIS: „Weg als Route“ (die Orte der Straße in Reihenfolge, nur mit Wiki-Artikel, ohne Seeweg
 * und ab zwei Orten), „Ganze Straße“, die Gestalt der Kraftlinien und die Anspruchsteller samt Klima der Gebiete. Die reine Rechnung
 * prüfen `path-route.test.ts` und `powerline-shape.test.ts`; hier geht es um die Daten: Welche Orte liegen an den Enden, was verbirgt
 * sich, was zählt als Anspruch.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Das tropische Band um die Welt dieses Tests (x 860 bis 920, y 200 bis 220), wenn der Bestand dort keins hat (frische Datenbank). */
const KLIMA_QUELLE = "p7-subjects-test";
const KLIMA_FLAECHE = "POLYGON((840 180,940 180,940 240,840 240,840 180))";

describeWithDatabase("Subjects P7 gegen PostgreSQL", () => {
    let database: Database;
    let service: SubjectService;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await insertP7Fixtures(database);
        // Das Klima der Gebiete: Im Bestand einer eingerichteten Datenbank liegt hier das tropische Band (Legacy-Import), in einer frischen
        // keins. Nur anlegen, was fehlt. 🪤 `climate_band` ist abgeleitet; der Riegel lässt nur eine Transaktion mit `climate.deriving`
        // durch (WI-0005), wie in `subjects.test.ts`.
        await database.begin(async (transaction) => {
            await transaction`SELECT set_config('climate.deriving', 'on', true)`;
            await transaction`
                INSERT INTO climate_band (type_key, geom, source_fingerprint)
                SELECT 'tropisch', ST_GeomFromText(${KLIMA_FLAECHE}, 0), ${KLIMA_QUELLE}
                WHERE NOT EXISTS (SELECT 1 FROM climate_band WHERE ST_Intersects(geom, ST_GeomFromText(${KLIMA_FLAECHE}, 0)))
            `;
        });
        service = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        await database.begin(async (transaction) => {
            await transaction`SELECT set_config('climate.deriving', 'on', true)`;
            await transaction`DELETE FROM climate_band WHERE source_fingerprint = ${KLIMA_QUELLE}`;
        });
        await cleanP7Fixtures(database);
        await database.end({ timeout: 5 });
    });

    async function detail(request: DetailRequest): Promise<SubjectDetailType> {
        const result = await service.detail(request);
        if (result === null) throw new Error(`kein Subject: ${JSON.stringify(request)}`);
        expect(
            Value.Check(SubjectDetail, result),
            JSON.stringify([...Value.Errors(SubjectDetail, result)].slice(0, 2)),
        ).toBe(true);
        return result;
    }

    describe("Weg als Route", () => {
        it("🔴 die Orte der ganzen Straße in der Reihenfolge der Reise: ein verborgener Ort und ein Wegende ohne Ort fahren nicht mit", async () => {
            const road = await detail({ kind: "path", chain: "P7 Straße:Strasse" });
            // Kette Anfang - Mitte - (Versteck, verborgen) - Ost, der dritte Abschnitt rückwärts; dann über die Lücke zum Ort Ferne.
            expect(road.routePlaces?.map((entry) => entry.name)).toEqual([
                "P7 Anfang",
                "P7 Mitte",
                "P7 Ost",
                "P7 Ferne",
            ]);
            expect(road.routePlaces?.[0]).toEqual({
                id: P7.anfang,
                name: "P7 Anfang",
                subtype: "dorf",
                x: 800,
                y: 200,
            });
            // Kein verborgener Ort steht irgendwo in der Antwort.
            expect(JSON.stringify(road)).not.toContain("Versteck");
        });

        it("„Ganze Straße: Von – Bis“: die zwei am weitesten auseinanderliegenden Orte unter den offenen Enden", async () => {
            const road = await detail({ kind: "path", chain: "P7 Straße:Strasse" });
            expect(road.stretch).toEqual({ from: "P7 Anfang", to: "P7 Ferne" });
        });

        it("ohne Wiki-Artikel keine Kachel, aber die Strecke bleibt", async () => {
            const road = await detail({ kind: "path", chain: "P7 Ohne Wiki:Strasse" });
            expect(road.routePlaces).toBeUndefined();
            expect(road.stretch).toEqual({ from: "P7 Anfang", to: "P7 Mitte" });
        });

        it("nie bei Seewegen", async () => {
            const sea = await detail({ kind: "path", chain: "P7 Seeweg:Seeweg" });
            expect(sea.routePlaces).toBeUndefined();
        });

        it("🔴 eine Straße, die keine zwei Orte verbindet, trägt keine Kachel (Betreiber Legacy 14.09.2026) und keine Strecke", async () => {
            const short = await detail({ kind: "path", chain: "P7 Kurz:Strasse" });
            expect(short.routePlaces).toBeUndefined();
            expect(short.stretch).toBeUndefined();
        });
    });

    describe("Kraftlinie: Gestalt", () => {
        it("ein Strang: die Enden von West nach Ost, die Station dazwischen, die Zahl der Segmente; Nodix und verborgener Ort tragen keinen Namen", async () => {
            const line = await detail({ kind: "powerline", id: P7.linie1 });
            expect(line.lineShape?.ends?.map((link) => link.name)).toEqual(["P7 Kraft A", "P7 Kraft C"]);
            expect(line.lineShape?.via?.map((link) => link.name)).toEqual(["P7 Kraft B"]);
            expect(line.lineShape?.segments).toBe(4);
            expect(line.lineShape?.ring).toBeUndefined();
            expect(JSON.stringify(line)).not.toContain("Versteck");
            expect(line.lineShape?.ends?.[0]?.ref).toEqual({ kind: "place", id: P7.kraftA });
        });

        it("ein Ring sagt es und hat keine Enden", async () => {
            const ring = await detail({ kind: "powerline", id: P7.ring1Seg });
            expect(ring.lineShape?.ends).toBeUndefined();
            expect(ring.lineShape?.via?.map((link) => link.name).sort()).toEqual([
                "P7 Ring 1",
                "P7 Ring 2",
                "P7 Ring 3",
            ]);
            expect(ring.lineShape).toMatchObject({ ring: true, segments: 3 });
        });
    });

    describe("Kartenstelle: In der Nähe", () => {
        it("🔴 die drei nächsten Orte und der nächste Weg je Art, nach Entfernung - ohne verborgene Orte und ohne Seewege", async () => {
            const point = await service.mapPoint(822, 203);
            expect(
                Value.Check(MapPointDetail, point),
                JSON.stringify([...Value.Errors(MapPointDetail, point)].slice(0, 2)),
            ).toBe(true);
            // Die Straße liegt 3 E entfernt; danach Ost (8,5 E), Mitte (12,4 E), Anfang (22,2 E). Der Seeweg liegt näher als Anfang,
            // steht aber nie darin, und das Versteck bei (820, 200) auch nicht.
            expect(point.nearby?.map((item) => item.name ?? item.type)).toEqual([
                "P7 Straße",
                "P7 Ost",
                "P7 Mitte",
                "P7 Anfang",
            ]);
            expect(point.nearby?.map((item) => item.ref.kind)).toEqual(["path", "place", "place", "place"]);
            expect(JSON.stringify(point)).not.toContain("Versteck");
            expect(point.nearby?.some((item) => item.type === "Seeweg")).toBe(false);
            const miles = (point.nearby ?? []).map((item) => item.miles);
            expect([...miles].sort((left, right) => left - right)).toEqual(miles);
            // Meilen: eine Karteneinheit sind drei (der Maßstab steht nur im Kartenraum).
            expect(point.nearby?.[1]?.miles).toBeCloseTo(8.54 * 3, 1);
        });

        it("die Peilung ist rechtweisend: 0 Grad Norden, im Uhrzeigersinn, y wächst nach Norden", async () => {
            const point = await service.mapPoint(822, 203);
            // Der Fußpunkt der Straße liegt bei (822, 200): drei E genau südlich des Punkts.
            expect(point.nearby?.[0]?.bearing).toBe(180);
            expect(point.nearby?.[0]?.miles).toBe(9);
            // Ost bei (830, 200): acht E östlich, drei südlich.
            expect(point.nearby?.[1]?.bearing).toBeCloseTo(110.6, 0);
        });

        it("weit draußen gibt es trotzdem die drei nächsten Orte (keine Schranke); ein Name ist nie leer", async () => {
            const far = await service.mapPoint(1000, 1000);
            expect(far.nearby?.filter((item) => item.ref.kind === "place")).toHaveLength(3);
            for (const item of far.nearby ?? []) expect(item.name === undefined || item.name.trim() !== "").toBe(true);
        });
    });

    describe("Gebiet: Umstritten mit, Art des Wikis, Klima", () => {
        it("🔴 die Anspruchsteller in der Reihenfolge des Anspruchs, mit der Farbe ihres Gebiets", async () => {
            const baronie = await detail({ kind: "territory", id: P7.baronieEins });
            expect(baronie.claimants).toEqual([
                { ref: { kind: "territory", id: P7.anspruchZwei }, name: "P7 Anspruch Zwei", color: "#aaaa00" },
                { ref: { kind: "territory", id: P7.anspruchEins }, name: "P7 Anspruch Eins", color: "#0000aa" },
            ]);
        });

        it("ein Reich nennt die Anspruchsteller der Teile darunter, nie sich selbst", async () => {
            const reich = await detail({ kind: "territory", id: P7.reich });
            expect(reich.claimants?.map((claimant) => claimant.name)).toEqual(["P7 Anspruch Zwei", "P7 Anspruch Eins"]);
            // Die Baronie, die das Reich selbst beansprucht, nennt es als Anspruchsteller; auf der Seite des Reiches fehlt es.
            const zwei = await detail({ kind: "territory", id: P7.baronieZwei });
            expect(zwei.claimants?.map((claimant) => claimant.name)).toEqual(["P7 Reich"]);
        });

        it("wer nichts beansprucht und nichts Umstrittenes trägt, hat keine Anspruchsteller", async () => {
            const anspruch = await detail({ kind: "territory", id: P7.anspruchEins });
            expect(anspruch.claimants).toBeUndefined();
        });

        it("die Art nennt Legacy aus dem Wiki (mit Klammerzusatz), sonst die eigene", async () => {
            const reich = await detail({ kind: "territory", id: P7.reich });
            expect(reich.subtitle).toEqual([{ part: "kind", text: "Reich (Testprovinz)" }]);
            const baronie = await detail({ kind: "territory", id: P7.baronieZwei });
            expect(baronie.subtitle).toEqual([{ part: "kind", text: "Baronie" }]);
        });

        it("das Klima der Form mit Anteil (Legacy `climate_zones`)", async () => {
            const reich = await detail({ kind: "territory", id: P7.reich });
            expect(reich.context?.climate?.items[0]).toMatchObject({ band: "tropisch", share: 1 });
            expect(reich.context?.climate?.relation).toBe("lies_in");
            const baronie = await detail({ kind: "territory", id: P7.baronieEins });
            expect(baronie.context?.climate?.items).toHaveLength(1);
            // Der Kontext der Obergebiete steht daneben: die Baronie liegt im Reich.
            expect(baronie.context?.territories?.chains[0]?.map((member) => member.name)).toEqual(["P7 Reich"]);
        });
    });
});
