import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pathChainKey, SEARCH_LIMIT } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { CLIMATE_ZONES, importClimate, type LegacyBand } from "../src/migration/climate.ts";
import { likePattern, search } from "../src/search/search.ts";
import { sucheOrte } from "../src/search/vorkommen-suche.ts";

/**
 * Der Search Core (WI-0013).
 *
 * ⭐ Der ganze durchsuchbare Bestand sind 7.591 Namen. Das ist die Zahl, die diesen Kern klein
 * macht — und der Grund, warum hier keine Volltextmaschine steht.
 */

describe("Suchmuster maskieren", () => {
    /**
     * 💣 Ohne Maskierung ist `%` keine Eingabe, sondern ein Befehl: es fände jeden Namen im
     * Bestand. Die Abfrage ist parametrisiert, es ist also keine Einschleusung — es ist etwas
     * Unauffälligeres: ein falsches Ergebnis, das aussieht wie ein richtiges.
     */
    it("🔴 macht aus den Platzhaltern gewöhnliche Zeichen", () => {
        expect(likePattern("100%")).toBe("%100\\%%");
        expect(likePattern("a_b")).toBe("%a\\_b%");
    });

    it("🪤 maskiert den Backslash ZUERST", () => {
        // Andersherum verdoppelte man die Backslashes, die man gerade selbst eingefügt hat, und
        // aus dem maskierten Prozentzeichen würde wieder ein Platzhalter.
        expect(likePattern("a\\%b")).toBe("%a\\\\\\%b%");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Trennlinie zwischen Steppe (Norden) und Wüste (Süden): bei y = 400, mit einer ZUNGE der Wüste,
 * die an der Mittelsenkrechten x = 512 quer durch die Steppe läuft (y 440–470). So liegt die Khôm im
 * echten Bestand: dort teilt sie Steppen- und Wüstenzone an der Kartenmitte in je zwei Stücke.
 */
const WUESTENZUNGE: [number, number][] = [
    [0, 400],
    [540, 400],
    [540, 440],
    [480, 440],
    [480, 470],
    [560, 470],
    [560, 400],
    [1024, 400],
];

/**
 * Acht Bänder, deren Sprungziele man von Hand nachrechnen kann: sieben Trennlinien bei y = 900 … 300,
 * von Nord nach Süd, jede benannt nach ihrer südlichen Zone. Dieselbe Bauform wie in `climate.test.ts`,
 * nur mit der Zunge an der Stelle, auf die es der Suche ankommt.
 */
function klimaBaender(): LegacyBand[] {
    const linien = CLIMATE_ZONES.slice(1).map((zone, index): [number, number][] =>
        zone === "subtropisch"
            ? WUESTENZUNGE
            : [
                  [0, 900 - index * 100],
                  [1024, 900 - index * 100],
              ],
    );
    const rand = (y: number): [number, number][] => [
        [0, y],
        [1024, y],
    ];
    return CLIMATE_ZONES.map((zone, index) => {
        const oben = index === 0 ? rand(1024) : (linien[index - 1] as [number, number][]);
        const unten = index === CLIMATE_ZONES.length - 1 ? rand(0) : (linien[index] as [number, number][]);
        const ring = [...oben, ...[...unten].reverse(), oben[0] as [number, number]];
        return { typeKey: zone, geoJson: JSON.stringify({ type: "Polygon", coordinates: [ring] }) };
    });
}

/**
 * Landschaftslabels für die Fläche hinter einem Treffer (WI-0043): eines an einer aktiven Region, ein
 * freies und eines an einer stillgelegten Region. Eigene Kennungen (…0043…), damit kein fremder Bestand
 * berührt wird.
 */
const LANDSCHAFT = {
    region: "00000000-0000-4000-8000-0000000043a1",
    stillgelegt: "00000000-0000-4000-8000-0000000043a2",
    gebunden: "00000000-0000-4000-8000-0000000043b1",
    frei: "00000000-0000-4000-8000-0000000043b2",
    verwaist: "00000000-0000-4000-8000-0000000043b3",
    /** Stillgelegt (WI-0043 B5, S-14): Die Suche nennt sie nicht. */
    stillgelegtesLabel: "00000000-0000-4000-8000-0000000044b4",
};

async function entferneLandschaften(database: Database): Promise<void> {
    const ids = Object.values(LANDSCHAFT);
    await database`DELETE FROM map_label WHERE public_id = ANY(${ids}::uuid[])`;
    await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE public_id = ANY(${ids}::uuid[]))`;
    await database`DELETE FROM region WHERE public_id = ANY(${ids}::uuid[])`;
}

describeWithDatabase("Suche gegen PostgreSQL", () => {
    let database: Database;
    const QUELLE = "search-test";

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await database.unsafe(`DELETE FROM place WHERE source_system = '${QUELLE}'`);
        await database.unsafe(`DELETE FROM path WHERE source_system = '${QUELLE}'`);
        await entferneLandschaften(database);
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${LANDSCHAFT.region}, 'aventuria', 'Suchmark', 'derographisch', 'region', TRUE),
                   (${LANDSCHAFT.stillgelegt}, 'aventuria', 'Suchbrache', 'vegetation', 'wald', FALSE)
        `;
        await database`
            INSERT INTO map_label (public_id, map_domain_id, name, subtype, geom, is_active, region_id)
            VALUES
              (${LANDSCHAFT.gebunden}, 'aventuria', 'Suchmark', 'region', ST_SetSRID(ST_MakePoint(610, 610), 0), TRUE,
               (SELECT id FROM region WHERE public_id = ${LANDSCHAFT.region})),
              (${LANDSCHAFT.frei}, 'aventuria', 'Suchgipfel', NULL, ST_SetSRID(ST_MakePoint(620, 620), 0), TRUE, NULL),
              (${LANDSCHAFT.verwaist}, 'aventuria', 'Suchbrache', 'wald', ST_SetSRID(ST_MakePoint(630, 630), 0), TRUE,
               (SELECT id FROM region WHERE public_id = ${LANDSCHAFT.stillgelegt})),
              (${LANDSCHAFT.stillgelegtesLabel}, 'aventuria', 'Suchleiche', 'region', ST_SetSRID(ST_MakePoint(640, 640), 0),
               FALSE, (SELECT id FROM region WHERE public_id = ${LANDSCHAFT.region}))
        `;
        // Die Region hat zwei Flächen; der Ausschnitt umfasst beide (WI-0044).
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            SELECT gen_random_uuid(), 'aventuria', r.id, ST_GeomFromText(wkt, 0), TRUE
            FROM region r, unnest(ARRAY[
                'POLYGON((600 600,620 600,620 620,600 620,600 600))',
                'POLYGON((630 590,650 590,650 615,630 615,630 590))'
            ]) AS wkt
            WHERE r.public_id = ${LANDSCHAFT.region}
        `;
        // Ein Fluss aus zwei Stücken, die sich NICHT berühren — wie „Der Große Fluss" mit seinen
        // Armen. Das lange Stück liegt bei x 600..700, das kurze bei x 800..810.
        await database.unsafe(`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, geom, source_system)
            VALUES
              ('dddddddd-0000-4000-8000-000000000011','aventuria','Suchfluss','Flussweg',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(600,300),ST_MakePoint(700,300)),0),'${QUELLE}'),
              ('dddddddd-0000-4000-8000-000000000012','aventuria','Suchfluss','Flussweg',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(800,300),ST_MakePoint(810,300)),0),'${QUELLE}'),
              -- Ein Stück ohne Beschriftung gehört trotzdem zum Weg (WI-0044): Es liegt im Ausschnitt.
              ('dddddddd-0000-4000-8000-000000000013','aventuria','Suchfluss','Flussweg',FALSE,ST_SetSRID(ST_MakeLine(ST_MakePoint(900,280),ST_MakePoint(920,310)),0),'${QUELLE}'),
              -- Ein Seeweg, sogar beschriftet: Die Suche kennt ihn nur für einen Editor und nur beim genauen Namen.
              ('dddddddd-0000-4000-8000-000000000014','aventuria','Suchmeer-7','Seeweg',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(700,700),ST_MakePoint(740,720)),0),'${QUELLE}'),
              -- WI-0105: Griffe, alle drei beschriftet. 74 von 845 beschrifteten Ketten im Bestand tragen einen,
              -- und die Sortierung nach Namenslaenge sortierte sie nach vorn.
              ('dddddddd-0000-4000-8000-000000000015','aventuria','Suchpfad-3443','Pfad',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(610,320),ST_MakePoint(640,320)),0),'${QUELLE}'),
              -- Der Griff einer FREMDEN Art, wie 38 Wege im Bestand.
              ('dddddddd-0000-4000-8000-000000000016','aventuria','Suchstrasse-5097','Weg',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(610,330),ST_MakePoint(640,330)),0),'${QUELLE}'),
              -- Der blanke Artname, wie 26 Wege im Bestand (19 heissen Weg).
              ('dddddddd-0000-4000-8000-000000000017','aventuria','Weg','Weg',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(610,340),ST_MakePoint(640,340)),0),'${QUELLE}'),
              -- Die gefährliche Gegenprobe: ein echter Name, der WIE ein Griff aussieht. Im Bestand steht er
              -- mit Leerzeichen (Reichsstrasse 2, 105 Abschnitte), und genau den muss die Suche finden.
              ('dddddddd-0000-4000-8000-000000000018','aventuria','Suchstieg 2','Pfad',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(610,350),ST_MakePoint(640,350)),0),'${QUELLE}'),
              -- WI-0177 Schritt 2b: Ein Weg ist sein Name, über Wegtypen hinweg. Derselbe Name als Weg und noch einmal als Pfad.
              ('dddddddd-0000-4000-8000-000000000019','aventuria','Suchstieg 2','Weg',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(640,350),ST_MakePoint(660,360)),0),'${QUELLE}'),
              ('dddddddd-0000-4000-8000-00000000001a','aventuria','Suchstieg 2','Pfad',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(660,360),ST_MakePoint(670,370)),0),'${QUELLE}'),
              -- Und ein Seeweg desselben Namens: Der Editor findet ihn beim genauen Namen, aber nicht als zweiten Treffer.
              ('dddddddd-0000-4000-8000-00000000001b','aventuria','Suchstieg 2','Seeweg',TRUE,ST_SetSRID(ST_MakeLine(ST_MakePoint(900,900),ST_MakePoint(950,950)),0),'${QUELLE}')
        `);
        await database.unsafe(`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, legacy_public_id, is_active, is_hidden)
            VALUES
              ('dddddddd-0000-4000-8000-000000000001','aventuria','Suchstadt','metropole',ST_SetSRID(ST_MakePoint(500,500),0),'${QUELLE}','dddddddd-0000-4000-8000-000000000001',TRUE,FALSE),
              ('dddddddd-0000-4000-8000-000000000002','aventuria','Suchdorf','dorf',ST_SetSRID(ST_MakePoint(501,501),0),'${QUELLE}','dddddddd-0000-4000-8000-000000000002',TRUE,FALSE),
              ('dddddddd-0000-4000-8000-000000000003','aventuria','Suchversteck','dorf',ST_SetSRID(ST_MakePoint(502,502),0),'${QUELLE}','dddddddd-0000-4000-8000-000000000003',TRUE,TRUE),
              ('dddddddd-0000-4000-8000-000000000004','aventuria','Suchruine','dorf',ST_SetSRID(ST_MakePoint(503,503),0),'${QUELLE}','dddddddd-0000-4000-8000-000000000004',FALSE,FALSE),
              ('dddddddd-0000-4000-8000-000000000005','aventuria','100% Suchprozent','dorf',ST_SetSRID(ST_MakePoint(504,504),0),'${QUELLE}','dddddddd-0000-4000-8000-000000000005',TRUE,FALSE),
              -- OPS-000065: Namen mit Akzent und ß, ohne „Such“, damit die Deckel der Such-Fälle unberührt bleiben. Die Metropole mit
              -- längerem Namen steht in der Klassenordnung vor dem Dorf; nur der gefaltete genaue Name holt das Dorf nach vorn.
              ('dddddddd-0000-4000-8000-000000000006','aventuria','Ôkrimsfalt','dorf',ST_SetSRID(ST_MakePoint(505,505),0),'${QUELLE}','dddddddd-0000-4000-8000-000000000006',TRUE,FALSE),
              ('dddddddd-0000-4000-8000-000000000007','aventuria','Okrimsfaltheim','metropole',ST_SetSRID(ST_MakePoint(506,506),0),'${QUELLE}','dddddddd-0000-4000-8000-000000000007',TRUE,FALSE),
              ('dddddddd-0000-4000-8000-000000000008','aventuria','Okrimsmaß','dorf',ST_SetSRID(ST_MakePoint(507,507),0),'${QUELLE}','dddddddd-0000-4000-8000-000000000008',TRUE,FALSE)
        `);
        // Über den Weg der Migration, nicht per INSERT: die Bänder sind gegen direkte Mutation
        // verriegelt und entstehen nur aus den Trennlinien (WI-0005).
        await importClimate(database, klimaBaender());
    });

    afterAll(async () => {
        await database.unsafe(`DELETE FROM place WHERE source_system = '${QUELLE}'`);
        await database.unsafe(`DELETE FROM path WHERE source_system = '${QUELLE}'`);
        await entferneLandschaften(database);
        await database.end({ timeout: 5 });
    });

    /**
     * 🔴 Ein Landschaftstreffer nennt die Fläche hinter seinem Label (WI-0043): die `public_id` der
     * REGION, nicht die des Labels. Daran leuchtet die Auswahl auf der Karte.
     */
    it("gibt den Abfrageplan der Hauptabfrage und sucht danach wie sonst (Betreiberroute suche-plan)", async () => {
        let plan: string[] = [];
        const antwort = await search(database, "Suchmark", { abfrageplan: (zeilen) => (plan = zeilen) });
        expect(plan.some((zeile) => zeile.startsWith("Execution Time"))).toBe(true);
        expect(antwort).toEqual(await search(database, "Suchmark"));
    });

    it("🔴 nennt zu einem gebundenen Landschaftslabel seine Region", async () => {
        const treffer = (await search(database, "Suchmark")).hits.find((hit) => hit.kind === "landschaft");
        expect(treffer?.id, "die Kennung bleibt die des Labels").toBe(LANDSCHAFT.gebunden);
        expect(treffer?.region).toBe(LANDSCHAFT.region);
    });

    /**
     * 💣 Ein freies Label bleibt ein Sprungziel, aber ohne Fläche - und eine stillgelegte Region ist keine
     * Fläche mehr. In beiden Fällen fehlt das Feld ganz, statt dass aus dem Namen etwas geraten wird.
     */
    it("💣 gibt einem freien Label und einer stillgelegten Region keine Fläche", async () => {
        const hits = [...(await search(database, "Suchgipfel")).hits, ...(await search(database, "Suchbrache")).hits];
        const landschaften = hits.filter((hit) => hit.kind === "landschaft");
        expect(landschaften.map((hit) => hit.id).sort()).toEqual([LANDSCHAFT.frei, LANDSCHAFT.verwaist].sort());
        for (const hit of landschaften) {
            expect(hit, hit.name).not.toHaveProperty("region");
        }
    });

    /**
     * 🔴 Ein Weg zeigt sich GANZ (WI-0044, Betreiber 2026-09-26: „ja - und ihn auch markieren“): alle aktiven
     * Stücke mit Name und Art, auch das ohne Beschriftung. Das Sprungziel bleibt die Mitte des längsten.
     */
    it("🔴 gibt einem Weg den Ausschnitt aller seiner Stücke", async () => {
        const [weg] = (await search(database, "Suchfluss")).hits.filter((hit) => hit.kind === "weg");
        expect(weg?.bounds).toEqual([600, 280, 920, 310]);
    });

    it("🔴 gibt einer Landschaft den Ausschnitt aller Flächen ihrer Region", async () => {
        const treffer = (await search(database, "Suchmark")).hits.find((hit) => hit.kind === "landschaft");
        expect(treffer?.bounds).toEqual([600, 590, 650, 620]);
    });

    it("🪤 ein freies Label, ein Ort und eine Klimazone haben keinen Ausschnitt", async () => {
        const hits = [
            ...(await search(database, "Suchgipfel")).hits,
            ...(await search(database, "Suchstadt")).hits,
            ...(await search(database, "Zone")).hits,
        ];
        expect(hits.length).toBeGreaterThan(2);
        for (const hit of hits) expect(hit, hit.name).not.toHaveProperty("bounds");
    });

    it("💣 nennt keine stillgelegte Beschriftung (WI-0043 B5, Sicherheitsprüfung S-14)", async () => {
        expect((await search(database, "Suchleiche")).hits).toEqual([]);
    });

    it("🪤 hängt an Orte, Wege und Klimazonen keine Fläche", async () => {
        const hits = [...(await search(database, "Such")).hits, ...(await search(database, "Zone")).hits];
        expect(hits.filter((hit) => hit.kind !== "landschaft" && "region" in hit)).toEqual([]);
    });

    it("🔴 findet einen Ort und liefert ein SPRUNGZIEL, keinen Text", async () => {
        const treffer = (await search(database, "Suchstadt")).hits.find((hit) => hit.name === "Suchstadt");
        expect(treffer).toBeDefined();
        expect(treffer?.kind).toBe("ort");
        // Kartenkoordinate in aventuria-v1, nicht projiziert (ADR-0003).
        expect(treffer?.x).toBeCloseTo(500, 6);
        expect(treffer?.y).toBeCloseTo(500, 6);
        expect(treffer?.zoom, "ohne Zoom wäre der Treffer die halbe Antwort").toBeGreaterThan(0);
    });

    it("💣 zeigt NICHT, was die Karte verbirgt", async () => {
        // `is_hidden` und `is_active` gelten für die Suche genauso wie für das Bild. Eine Suche,
        // die verborgene Orte ausgibt, ist ein Leck — und zwar eines, das niemandem auffällt,
        // solange niemand danach sucht.
        const namen = (await search(database, "Such")).hits.map((hit) => hit.name);
        expect(namen).not.toContain("Suchversteck");
        expect(namen).not.toContain("Suchruine");
    });

    it("🔴 lässt den Platzhalter nicht durch", async () => {
        // Ohne Maskierung fände `%` den ganzen Bestand. Hier findet es genau den Ort, der ein
        // Prozentzeichen im Namen trägt.
        const treffer = await search(database, "100%");
        expect(treffer.hits.map((hit) => hit.name)).toEqual(["100% Suchprozent"]);
    });

    /**
     * 🔴 Ohne Akzente gefunden (OPS-000065, Meldung aus Discord: „Âthykril“ soll auch auf „Athykril“ erscheinen). Gefaltet wie `foldName`,
     * auf beiden Seiten: ohne Akzent findet den Namen mit, mit Akzent den ohne, „ss“ das „ß“ und umgekehrt, gleich in welcher Schreibweise.
     */
    it("🔴 findet einen Ort ohne Akzente und ß als ss (OPS-000065)", async () => {
        const namen = async (eingabe: string) => (await search(database, eingabe)).hits.map((hit) => hit.name);
        expect(await namen("Okrimsfalt")).toContain("Ôkrimsfalt");
        expect(await namen("OKRIMSFALT")).toContain("Ôkrimsfalt");
        expect(await namen("Ökrimsfältheim")).toContain("Okrimsfaltheim");
        expect(await namen("Okrimsmass")).toContain("Okrimsmaß");
        expect(await namen("Okrimsmaß")).toEqual(["Okrimsmaß"]);
    });

    it("🪤 der gefaltete genaue Name steht vor dem Teiltreffer, auch vor einer Metropole (OPS-000065)", async () => {
        expect((await search(database, "okrimsfalt")).hits.map((hit) => hit.name)).toEqual([
            "Ôkrimsfalt",
            "Okrimsfaltheim",
        ]);
        // Dieselbe Faltung in der Ortswahl der Vorkommen-Anfragen („… in Ôkrimsfalt“).
        expect((await sucheOrte(database, "okrimsfalt", 5)).map((ort) => ort.name)).toEqual([
            "Ôkrimsfalt",
            "Okrimsfaltheim",
        ]);
    });

    it("🪤 sortiert die Metropole vor das Dorf, aus der Klassentafel", async () => {
        // Die einfachste Antwort auf D3 — und die einzige, die keine zweite Skala aufmacht.
        const namen = (await search(database, "Such")).hits.map((hit) => hit.name);
        expect(namen.indexOf("Suchstadt")).toBeLessThan(namen.indexOf("Suchdorf"));
    });

    it("💣 fährt zur Hauptstadt genauso nah heran wie zum Dorf", async () => {
        // Gemessen war es umgekehrt: eine Metropole erscheint ab Band 0, also landete die Suche
        // nach „Gareth" bei z3 über dem halben Kontinent — je bedeutender der Ort, desto weiter
        // weg. Wer etwas sucht, will es ansehen.
        const hits = (await search(database, "Such")).hits;
        const stadt = hits.find((hit) => hit.name === "Suchstadt");
        const dorf = hits.find((hit) => hit.name === "Suchdorf");
        expect(stadt?.zoom).toBeGreaterThanOrEqual(5);
        expect(dorf?.zoom).toBeGreaterThanOrEqual(5);
    });

    it("🪤 nennt einen Weg EINMAL, nicht einmal je Abschnitt", async () => {
        // „Reichsstraße 2" besteht aus 74 Abschnitten. Wer sie einzeln listet, liefert 74 Treffer
        // für eine Straße — und der Sprung landete auf einem beliebigen Siebzigstel.
        const wege = (await search(database, "Reichsstraße 2")).hits.filter((hit) => hit.kind === "weg");
        const namen = wege.map((hit) => hit.name);
        expect(new Set(namen).size, "jeder Wegname höchstens einmal je Art").toBe(namen.length);
    });

    it("🔴 findet keinen Seeweg: Die Karte zeigt keine (Betreiber 2026-09-27)", async () => {
        expect((await search(database, "Suchmeer")).hits).toEqual([]);
        expect((await search(database, "Suchmeer-7")).hits).toEqual([]);
        // Auch ein Editor nicht über einen Teil des Namens.
        expect((await search(database, "Suchmeer", { editor: true })).hits).toEqual([]);
    });

    it("🔴 ein Editor fliegt zu einem Seeweg, wenn er dessen Namen genau eingibt", async () => {
        const wege = (await search(database, "suchmeer-7", { editor: true })).hits;
        expect(wege).toHaveLength(1);
        expect(wege[0]).toMatchObject({
            kind: "weg",
            name: "Suchmeer-7",
            subtype: "Seeweg",
            bounds: [700, 700, 740, 720],
        });
    });

    it("💣 findet auch einen Weg, der aus getrennten Stücken besteht", async () => {
        // Gemessen am Bestand: 189 von 719 beschrifteten Wegketten verschmelzen nicht zu EINER
        // Linie — darunter „Der Große Fluss" mit 44 Abschnitten. Die Suche verwarf sie still, und
        // ausgerechnet die längsten Wege Aventuriens waren nicht zu finden.
        const wege = (await search(database, "Suchfluss")).hits.filter((hit) => hit.kind === "weg");
        expect(wege).toHaveLength(1);
        // Der Sprung landet auf dem LÄNGSTEN Stück, nicht auf einem Seitenarm.
        expect(wege[0]?.x).toBeCloseTo(650, 6);
        expect(wege[0]?.y).toBeCloseTo(300, 6);
    });

    it("🔴 ein Weg ist sein Name (WI-0177 Schritt 2b): EIN Treffer über seine Wegtypen, die Kette name:Name, die häufigste Art, der ganze Ausschnitt", async () => {
        const wege = (await search(database, "Suchstieg 2")).hits.filter((hit) => hit.kind === "weg");
        expect(wege).toHaveLength(1);
        expect(wege[0]).toMatchObject({
            id: pathChainKey("Suchstieg 2"),
            name: "Suchstieg 2",
            subtype: "Pfad",
            bounds: [610, 350, 670, 370],
        });
        // Der Editor beim genauen Namen: derselbe EINE Treffer, der Seeweg zieht den Ausschnitt nicht ins Meer (Gegenlesen Kamera/Wiki-Feld).
        const editor = (await search(database, "Suchstieg 2", { editor: true })).hits.filter(
            (hit) => hit.kind === "weg",
        );
        expect(editor.map((hit) => [hit.id, hit.bounds])).toEqual([
            [pathChainKey("Suchstieg 2"), [610, 350, 670, 370]],
        ]);
    });

    it("🔴 verbirgt Weg-Griffe: den der eigenen Art, den einer fremden und den blanken Artnamen", async () => {
        const wege = async (query: string): Promise<string[]> =>
            (await search(database, query)).hits.filter((hit) => hit.kind === "weg").map((hit) => hit.name);
        expect(await wege("Suchpfad-3443")).toEqual([]);
        expect(await wege("Suchstrasse-5097")).toEqual([]);
        expect(await wege("Weg")).toEqual([]);
        // 🚩 Die Gegenprobe: ein Name mit Zahl am Ende, aber ohne Bindestrich davor, bleibt ein Name.
        expect(await wege("Suchstieg 2")).toEqual(["Suchstieg 2"]);
        // Und der Griff belegt auch keine Zeile einer breiteren Suche.
        expect(await wege("Such")).not.toContain("Suchpfad-3443");
    });

    it("🪤 der Editor findet einen Seeweg-Griff weiter über den genauen Namen - er sucht einen Befund", async () => {
        const treffer = (await search(database, "Suchmeer-7", { editor: true })).hits.filter(
            (hit) => hit.kind === "weg",
        );
        expect(treffer.map((hit) => hit.name)).toEqual(["Suchmeer-7"]);
    });

    /**
     * 🔴 JEDER Treffer trägt Kartenkoordinaten in `aventuria-v1` (0…1024), gleich welcher Art.
     *
     * 💣 Genau diese Zusicherung fehlte (Befund 2026-09-23). Der Vertrag sagt „Kartenkoordinate, nicht
     * Renderkoordinate" (ADR-0003); der Klimazweig las aus einer `*_render`-Relation und lieferte
     * x = ±20 037 508. Die Liste sah richtig aus, nur der Sprung landete in einer Ecke der Karte.
     */
    it("🔴 liefert jeden Treffer in Kartenkoordinaten, gleich welcher Art", async () => {
        const hits = [...(await search(database, "Such")).hits, ...(await search(database, "Zone")).hits];
        expect(hits.map((hit) => hit.kind)).toEqual(expect.arrayContaining(["ort", "weg", "klima"]));
        const ausserhalb = hits
            .filter((hit) => !(hit.x >= 0 && hit.x <= 1024 && hit.y >= 0 && hit.y <= 1024))
            .map((hit) => `${hit.kind} ${hit.name}: ${hit.x}, ${hit.y}`);
        expect(ausserhalb).toEqual([]);
    });

    /**
     * 🔴 EIN Treffer je Klimazone.
     *
     * 💣 Der Zweig las die Renderansicht der NAMEN, und die führt jede Zone zweimal — einmal an jedem
     * Kartenrand (WI-0012). Die Liste zeigte „Subtropische Steppenzone" doppelt.
     */
    it("🔴 nennt eine Klimazone EINMAL, nicht einmal je Kartenrand", async () => {
        const klima = (await search(database, "Steppenzone")).hits.filter((hit) => hit.kind === "klima");
        expect(klima.map((hit) => hit.id)).toEqual(["trockene_subtropen"]);
    });

    /**
     * 🔴 Das Sprungziel einer Klimazone ist die Mitte ihres Bandes auf der Mittelsenkrechten der Karte,
     * in Kartenkoordinaten (Betreiberentscheidung 2026-09-23).
     *
     * Von Hand nachgerechnet: ein Band reicht von seiner nördlichen bis zu seiner südlichen Linie, die
     * Mitte liegt auf halbem Weg. Steppe und Wüste siehe den nächsten Test.
     */
    it.each([
        ["polar", "Polare Zone", 962],
        ["subpolar", "Subpolare Zone", 850],
        ["boreal", "Boreale Zone", 750],
        ["gemaessigt", "Gemäßigte Zone", 650],
        ["subtropen_winterfeucht", "Winterfeuchte Subtropen", 550],
        ["trockene_subtropen", "Subtropische Steppenzone", 420],
        ["subtropisch", "Subtropische Wüstenzone", 350],
        ["tropisch", "Tropische Zone", 150],
    ])("🔴 %s: springt auf die Bandmitte an der Kartenmitte", async (zone, name, y) => {
        // „Polare Zone" findet auch „Subpolare Zone" — gezählt wird deshalb nur die gesuchte.
        const treffer = (await search(database, name)).hits.filter((hit) => hit.kind === "klima" && hit.id === zone);
        expect(treffer).toHaveLength(1);
        expect(treffer[0]?.name).toBe(name);
        expect(treffer[0]?.x).toBeCloseTo(512, 6);
        expect(treffer[0]?.y).toBeCloseTo(y, 6);
    });

    /**
     * 💣 Die Mitte des LÄNGSTEN Stücks, nicht der ganzen Spanne.
     *
     * An der Mittelsenkrechten liegt die Steppe hier in zwei Stücken, 400–440 und 470–500; dazwischen
     * die Wüstenzunge. Die Mitte der ganzen Spanne, 450, läge IN der Wüste — der Sprung landete in der
     * Nachbarzone. Genau so stehen im echten Bestand Steppen- und Wüstenzone an der Khôm. Der
     * Schwerpunkt taugt ebenso wenig: bei vier der acht echten Bänder liegt er außerhalb.
     */
    it("💣 springt bei einem geteilten Band in dessen Inneres, nicht in die Nachbarzone", async () => {
        const steppe = (await search(database, "Steppenzone")).hits.find((hit) => hit.kind === "klima");
        expect(steppe, "die Steppenzone wird gefunden").toBeDefined();
        const { x, y } = steppe ?? { x: Number.NaN, y: Number.NaN };
        const zonen = await database<{ type_key: string }[]>`
            SELECT type_key FROM climate_band
            WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0))
        `;
        expect(zonen.map((zeile) => zeile.type_key)).toEqual(["trockene_subtropen"]);
    });

    /**
     * 🔴 **Der Übersetzte Name findet seine Zone über den Schlüssel** (WI-0171, Betreiber 2026-10-15: „Der Browser
     * schickt die passenden Schlüssel mit, Deutsch bleibt zusätzlich serverseitig“).
     *
     * 💣 Seit die acht Zonennamen übersetzt werden, steht in einer niederländischen Oberfläche „Gematigde zone“ -
     * ein Wort, das in `climate_zone_type.label` nirgends vorkommt. Ohne diesen Weg fände die Suche genau das, was
     * auf dem Schirm steht, NICHT, und das, was sie fand, hieße nirgends mehr so.
     *
     * 🪤 Das Sprungziel ist dasselbe wie beim deutschen Namen: Der Zweig rechnet an der Geometrie, nicht am Wort.
     */
    it("🔴 findet eine Zone über den mitgeschickten Schlüssel, auch ohne deutschen Namen in der Anfrage", async () => {
        const treffer = (await search(database, "Gematigde zone", { climateKeys: ["gemaessigt"] })).hits;
        const klima = treffer.filter((hit) => hit.kind === "klima");
        expect(klima.map((hit) => hit.id)).toEqual(["gemaessigt"]);
        expect(klima[0]?.x).toBeCloseTo(512, 6);
        expect(klima[0]?.y).toBeCloseTo(650, 6);
        // Der Name der Antwort bleibt der deutsche Stamm; die Sprachtafel des Browsers setzt den angezeigten darüber.
        expect(klima[0]?.name).toBe("Gemäßigte Zone");
    });

    /**
     * 🔴 Die Liste ist eine ANGABE zu den Klimazonen, kein Freibrief: Sie macht aus einer Anfrage keinen Treffer
     * anderer Art, und sie hebt `is_active` nicht auf.
     */
    it("🔴 der Schlüssel gilt nur für Klimazonen und nur für aktive", async () => {
        const treffer = (await search(database, "Gematigde zone", { climateKeys: ["gemaessigt"] })).hits;
        expect(treffer.every((hit) => hit.kind === "klima")).toBe(true);
        const erfunden = (await search(database, "Gematigde zone", { climateKeys: ["gibt_es_nicht"] })).hits;
        expect(erfunden).toEqual([]);
    });

    /**
     * 🪤 Deutsch findet der Server weiter selbst - daran hängt, dass eine neue Sprachtafel ohne Serveränderung
     * auskommt und eine geteilte Adresse weiter trifft. Und passt BEIDES, bleibt es EIN Treffer (`DISTINCT ON`).
     */
    it("🪤 der deutsche Name findet weiter ohne Liste, und mit ihr nicht doppelt", async () => {
        const ohne = (await search(database, "Gemäßigte Zone")).hits.filter((hit) => hit.kind === "klima");
        const mit = (await search(database, "Gemäßigte Zone", { climateKeys: ["gemaessigt"] })).hits.filter(
            (hit) => hit.kind === "klima",
        );
        expect(ohne.map((hit) => hit.id)).toEqual(["gemaessigt"]);
        expect(mit.map((hit) => hit.id)).toEqual(["gemaessigt"]);
    });

    it("🔴 antwortet unter zwei Zeichen mit nichts, statt mit allem", async () => {
        const treffer = await search(database, "a");
        expect(treffer.hits).toEqual([]);
        expect(treffer.truncated).toBe(false);
    });

    it("🪤 sagt, dass es mehr gibt, ohne sie zu zählen", async () => {
        const treffer = await search(database, "e", { limit: 3 });
        // 'e' ist zu kurz; deshalb der echte Fall mit einem kleinen Deckel:
        const viele = await search(database, "er", { limit: 3 });
        expect(treffer.hits).toEqual([]);
        expect(viele.hits.length).toBeLessThanOrEqual(3);
        if (viele.truncated) {
            expect(viele.hits.length).toBe(3);
        }
    });

    it("💣 liefert nie mehr als den Deckel", async () => {
        const treffer = await search(database, "e r");
        expect(treffer.hits.length).toBeLessThanOrEqual(SEARCH_LIMIT);
    });
});

/**
 * Flächen in der Suche (WI-0047, Betreiber 2026-09-26: „sie soll natürlich auch flächen ohne beschriftung
 * finden“). Legacys Regeln, Owner 14.09.2026: jede echt benannte Landschaft; herausgenommen nur, was IHR
 * EIGENES Label schon nennt; Griffe gegen jede Art verborgen; gleicher Name, gleiche Art, gleiche Ebene ist
 * EIN Treffer (G1 A). Eigene Kennungen (…0047…) und Namen mit „Suchfläche“, damit nichts Fremdes mitzählt.
 */
const FLAECHE = {
    ohneLabel: "00000000-0000-4000-8000-0000000047a1",
    mitLabel: "00000000-0000-4000-8000-0000000047a2",
    griffWald: "00000000-0000-4000-8000-0000000047a3",
    griffAlteArt: "00000000-0000-4000-8000-0000000047a4",
    archipelEins: "00000000-0000-4000-8000-0000000047a5",
    archipelZwei: "00000000-0000-4000-8000-0000000047a6",
    archipelAndereArt: "00000000-0000-4000-8000-0000000047a7",
    ungueltig: "00000000-0000-4000-8000-0000000047a8",
    label: "00000000-0000-4000-8000-0000000047b1",
    griffLabel: "00000000-0000-4000-8000-0000000047b2",
};
const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

describeWithDatabase("Flächen in der Suche (WI-0047)", () => {
    let database: Database;

    async function region(publicId: string, name: string, layer: string, type: string | null): Promise<number> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${publicId}, 'aventuria', ${name}, ${layer}, ${type}, TRUE)
            RETURNING id::text
        `;
        return Number(row?.id);
    }
    async function flaeche(regionId: number, wkt: string): Promise<void> {
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (gen_random_uuid(), 'aventuria', ${regionId}, ST_GeomFromText(${wkt}), TRUE)
        `;
    }
    async function label(publicId: string, name: string, regionId: number, x: number, y: number): Promise<void> {
        await database`
            INSERT INTO map_label (public_id, map_domain_id, name, subtype, geom, is_active, region_id)
            VALUES (${publicId}, 'aventuria', ${name}, 'wald', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), TRUE, ${regionId})
        `;
    }
    async function aufraeumen(): Promise<void> {
        const ids = Object.values(FLAECHE);
        await database`DELETE FROM map_label WHERE public_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE public_id = ANY(${ids}::uuid[]))`;
        await database`DELETE FROM region WHERE public_id = ANY(${ids}::uuid[])`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        // Eine benannte Fläche ohne Label, wie „Mittelaventurien“.
        await flaeche(
            await region(FLAECHE.ohneLabel, "Suchflächenmark", "derographisch", "region"),
            quadrat(700, 700, 720, 710),
        );
        // Eine Region, deren eigenes Label ihren Namen trägt: Sie steht schon als Label da.
        const mitLabel = await region(FLAECHE.mitLabel, "Suchflächenforst", "vegetation", "wald");
        await flaeche(mitLabel, quadrat(730, 700, 740, 710));
        await label(FLAECHE.label, "Suchflächenforst", mitLabel, 735, 705);
        // Griffe: der der jetzigen Art und der einer früheren, heute ein Urwald. Dazu ein Griff-Label.
        const griffWald = await region(FLAECHE.griffWald, "Wald-4701", "vegetation", "wald");
        await flaeche(griffWald, quadrat(750, 700, 760, 710));
        await label(FLAECHE.griffLabel, "Flussland/Flusstal-4703", griffWald, 755, 705);
        await flaeche(
            await region(FLAECHE.griffAlteArt, "Wald-4702", "vegetation", "urwald"),
            quadrat(770, 700, 780, 710),
        );
        // Zwei gleichnamige Inseln gleicher Art und Ebene sind EIN Treffer, eine gleichnamige Tiefebene nicht.
        await flaeche(
            await region(FLAECHE.archipelEins, "Suchflächenarchipel", "topographie", "insel"),
            quadrat(700, 720, 705, 725),
        );
        await flaeche(
            await region(FLAECHE.archipelZwei, "Suchflächenarchipel", "topographie", "insel"),
            quadrat(720, 730, 730, 740),
        );
        await flaeche(
            await region(FLAECHE.archipelAndereArt, "Suchflächenarchipel", "topographie", "tiefebene"),
            quadrat(740, 720, 745, 725),
        );
        // Ungültig wie 20 Flächen aus Legacy: eine Schleife, die sich selbst schneidet.
        await flaeche(
            await region(FLAECHE.ungueltig, "Suchflächenschleife", "vegetation", "wald"),
            "POLYGON((800 700,810 710,810 700,800 710,800 700))",
        );
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    const landschaften = async (frage: string) =>
        (await search(database, frage)).hits.filter((hit) => hit.kind === "landschaft");

    it("🔴 findet eine benannte Fläche ohne Label: Die Region ist der Treffer, mit Ausschnitt und Punkt auf ihr", async () => {
        const [treffer, ...mehr] = await landschaften("Suchflächenmark");
        expect(mehr).toEqual([]);
        expect(treffer).toMatchObject({
            id: FLAECHE.ohneLabel,
            region: FLAECHE.ohneLabel,
            name: "Suchflächenmark",
            subtype: "region",
            bounds: [700, 700, 720, 710],
        });
        expect(treffer).not.toHaveProperty("regions");
        // Der Punkt liegt auf der Fläche: Dort steht der Name der Auswahl.
        expect(treffer!.x).toBeGreaterThanOrEqual(700);
        expect(treffer!.x).toBeLessThanOrEqual(720);
        expect(treffer!.y).toBeGreaterThanOrEqual(700);
        expect(treffer!.y).toBeLessThanOrEqual(710);
    });

    it("🔴 nennt eine Region mit eigenem Label nur einmal: als Label", async () => {
        const treffer = await landschaften("Suchflächenforst");
        expect(treffer.map((hit) => [hit.id, hit.region])).toEqual([[FLAECHE.label, FLAECHE.mitLabel]]);
    });

    it("💣 verbirgt Griffe: den der jetzigen Art, den einer früheren und Griff-Labels", async () => {
        expect(await landschaften("Wald-470")).toEqual([]);
        expect(await landschaften("Flusstal-4703")).toEqual([]);
    });

    it("🔴 G1 A: gleicher Name, gleiche Art, gleiche Ebene ist EIN Treffer, der alle Teile rahmt", async () => {
        const treffer = await landschaften("Suchflächenarchipel");
        const inseln = treffer.find((hit) => hit.subtype === "insel");
        expect(inseln?.regions).toEqual([FLAECHE.archipelEins, FLAECHE.archipelZwei].sort());
        expect(inseln?.region).toBe(inseln?.regions?.[0]);
        expect(inseln?.bounds).toEqual([700, 720, 730, 740]);
        // Eine andere Art ist eine andere Landschaft, auch mit gleichem Namen.
        const tiefebene = treffer.find((hit) => hit.subtype === "tiefebene");
        expect(tiefebene?.region).toBe(FLAECHE.archipelAndereArt);
        expect(tiefebene).not.toHaveProperty("regions");
        expect(treffer).toHaveLength(2);
    });

    it("💣 rechnet auch über eine ungültige Fläche, statt die ganze Suche abzubrechen", async () => {
        const [treffer] = await landschaften("Suchflächenschleife");
        expect(treffer?.region).toBe(FLAECHE.ungueltig);
        const [{ innen } = { innen: false }] = await database<{ innen: boolean }[]>`
            SELECT ST_Covers(ST_MakeValid(a.geom, 'method=structure'), ST_SetSRID(ST_MakePoint(${treffer!.x}, ${treffer!.y}), 0)) AS innen
            FROM region_area a JOIN region r ON r.id = a.region_id
            WHERE r.public_id = ${FLAECHE.ungueltig}
        `;
        expect(innen, "der Punkt liegt auf der reparierten Fläche").toBe(true);
    });
});

describeWithDatabase("Exakte Namen vor Teiltreffern (WI-0114)", () => {
    let database: Database;
    const source = "wi0114-search";
    const name = "Suchrangweiden";
    const landscapeIds = ["00000000-0000-4000-8000-0000000114b1", "00000000-0000-4000-8000-0000000114b2"];

    async function cleanFixtures(): Promise<void> {
        await database`DELETE FROM place WHERE source_system = ${source}`;
        await database`DELETE FROM map_label WHERE public_id = ANY(${landscapeIds}::uuid[])`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanFixtures();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            SELECT gen_random_uuid(), 'aventuria', ${name} || ' Vorstadt ' || n,
                   'metropole', ST_SetSRID(ST_MakePoint(500, 500), 0), ${source}, TRUE
            FROM generate_series(1, ${SEARCH_LIMIT + 2}) n
        `;
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (gen_random_uuid(), 'aventuria', ${name}, 'dorf',
                    ST_SetSRID(ST_MakePoint(500, 500), 0), ${source}, TRUE)
        `;
        // Rückwärts eingefügt: Ein Gleichstand wird über Kennungen statt Tabellenreihenfolge gelöst.
        for (const id of [...landscapeIds].reverse()) {
            await database`
                INSERT INTO map_label (public_id, map_domain_id, name, subtype, geom, is_active)
                VALUES (${id}, 'aventuria', ${name}, 'region', ST_SetSRID(ST_MakePoint(500, 500), 0), TRUE)
            `;
        }
    });

    afterAll(async () => {
        await cleanFixtures();
        await database.end({ timeout: 5 });
    });

    it("behält exakte Namen vor mehr als 20 Orts-Teiltreffern und wahrt die Klassenordnung", async () => {
        const result = await search(database, `  ${name.toUpperCase()}  `);
        expect(result.hits).toHaveLength(SEARCH_LIMIT);
        expect(result.truncated).toBe(true);
        expect(result.hits.slice(0, 3).map((hit) => [hit.kind, hit.name])).toEqual([
            ["ort", name],
            ["landschaft", name],
            ["landschaft", name],
        ]);
        expect(result.hits.slice(1, 3).map((hit) => hit.id)).toEqual(landscapeIds);
        expect(result.hits.slice(3).every((hit) => hit.kind === "ort" && hit.subtype === "metropole")).toBe(true);
        expect((await search(database, name, { limit: 1 })).hits[0]?.name).toBe(name);
    });

    it("meldet truncated nur, wenn mindestens ein weiterer Treffer existiert", async () => {
        const total = SEARCH_LIMIT + 5;
        const full = await search(database, name, { limit: total });
        expect(full.hits).toHaveLength(total);
        expect(full.truncated).toBe(false);
        const limited = await search(database, name, { limit: total - 1 });
        expect(limited.hits).toEqual(full.hits.slice(0, -1));
        expect(limited.truncated).toBe(true);
    });
});
