import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import {
    importSprachen,
    SPRACHEN_IMPORT_AKTEUR,
    type SprachenImportBericht,
} from "../src/migration/sprachen-import.ts";
import { farbeHex, liesSprachenKarte, SPRACHEN_TAFEL } from "../src/migration/sprachen-karte.ts";
import { MigrationAborted } from "../src/migration/places.ts";
import { sprachSchluessel } from "../src/wiki/infobox/sprache.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Das Einspielen der Sprachenkarte (WI-0261 S6, `migrate:sprachen`) gegen echtes PostGIS: Wegwerf-Cluster mit den Rollen des VPS, die
 * Migrationsrolle als Importer (so läuft das Werkzeug auf der Stage). 🔴 Kein Test berührt `avesmaps3d_dev` oder die geteilte
 * Testdatenbank, auch der Aufruf der Kommandozeile bekommt `DATABASE_URL` des Wegwerf-Clusters.
 *
 * Problemfälle: der Probelauf schreibt doch (Sprache, Fläche, Journal oder Auftrag bleiben stehen); der zweite Lauf mit derselben Datei ändert
 * etwas (neue Zeilen, neue Revision, ein zweiter Auftrag, eine von der Redaktion stillgelegte Fläche kehrt zurück); eine neue Datei lässt
 * die alte Fläche aktiv oder fasst eine Fläche der Redaktion an; ein vorhandener Eintrag mit geänderter Farbe oder geändertem Namen wird
 * überschrieben; eine Wiki-Zuordnung nimmt einen Artikel, der schon zu einer anderen Sprache gehört, oder setzt eine Zuordnung wieder, die die
 * Redaktion gelöst hat; ein Teil außerhalb der Domäne bricht erst im Schreiben ab; eine ungültige Geometrie bleibt ungemeldet.
 *
 * Die kleine Welt: zwei Dateien mit erfundenen Quadraten in Karteneinheiten. A: Thorwalsch aus zwei Quadraten (100-200 und 300-400 in x,
 * 100-200 in y), Garethi 150-250 (überlappt Thorwalsch, ein Mischgebiet), Nujuka 500-600 × 500-600; vier Teile, 20 Stützpunkte. B: Thorwalsch
 * 100-210, Garethi wie in A, Tulamidya 700-800 × 300-400, kein Nujuka; drei Teile.
 */

const describeWithCluster = postgresBin ? describe : describe.skip;
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const DATEI_A = fileURLToPath(new URL("./fixtures/sprachen-import-a.geojson", import.meta.url));
const DATEI_B = fileURLToPath(new URL("./fixtures/sprachen-import-b.geojson", import.meta.url));
const CLI = fileURLToPath(new URL("../src/migration/sprachen-cli.ts", import.meta.url));

const lies = (pfad: string): Buffer => readFileSync(pfad);
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const SHA_A = sha(lies(DATEI_A));
const SHA_B = sha(lies(DATEI_B));

const json = (wert: unknown): Buffer => Buffer.from(JSON.stringify(wert), "utf8");
const quadrat = (x0: number, y0: number, x1: number, y1: number): number[][][] => [
    [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
    ],
];
const merkmal = (sprache: string, geometrie: unknown, eigenschaften: Record<string, unknown> = {}): unknown => ({
    type: "Feature",
    properties: { sprache, ...eigenschaften },
    geometry: geometrie,
});
const sammlung = (...features: unknown[]): Buffer => json({ type: "FeatureCollection", features });
const multi = (...teile: number[][][][]): unknown => ({ type: "MultiPolygon", coordinates: teile });

describe("Sprachenkarte lesen (WI-0261 S6)", () => {
    it("die Farbtafel führt die elf Schlüssel des WI mit Legendenfarbe als #rrggbb in Kleinbuchstaben", () => {
        expect(SPRACHEN_TAFEL.map((eintrag) => eintrag.schluessel)).toEqual([
            "thorwalsch",
            "nujuka",
            "isdira",
            "orkisch",
            "goblinisch",
            "rogolan",
            "garethi",
            "tulamidya",
            "ferkina",
            "rssahh",
            "tahaya",
        ]);
        expect(SPRACHEN_TAFEL.map((eintrag) => farbeHex(eintrag.rgb))).toEqual([
            "#1baad4",
            "#268170",
            "#789f2a",
            "#604c34",
            "#c2771c",
            "#7f7774",
            "#ffb901",
            "#da5a13",
            "#a03813",
            "#c40304",
            "#78373d",
        ]);
        expect(SPRACHEN_TAFEL[0]).toMatchObject({
            name: "Thorwalsch",
            legende: "Thorwalsch / Gjalskisch / Fjarningsch",
        });
        expect(SPRACHEN_TAFEL[10]).toMatchObject({ name: "Tahaya", legende: "Tahaya (Waldmenschen und Utulus)" });
    });

    it("der SHA-256 gehört zu den Bytes der Datei; die Merkmale stehen in der Reihenfolge der Tafel, fehlende Sprachen sind ein Befund", () => {
        const karte = liesSprachenKarte(lies(DATEI_A));
        expect(karte.sha256).toBe(SHA_A);
        expect(karte.merkmale.map((eintrag) => eintrag.schluessel)).toEqual(["thorwalsch", "nujuka", "garethi"]);
        const fehlend = karte.findings.find((befund) => befund.code === "sprache_ohne_flaeche_in_datei");
        expect(fehlend?.numbers).toEqual({ sprachen: 8 });
        expect(fehlend?.notes[0]).toContain("tulamidya");
        expect(karte.findings.some((befund) => befund.code === "datei_weicht_von_farbtafel_ab")).toBe(false);
    });

    it("Namen und Farben der Datei weichen ab: ein Befund, die Tafel gilt", () => {
        const karte = liesSprachenKarte(
            sammlung(merkmal("garethi", multi(quadrat(1, 1, 2, 2)), { name: "Garethisch", farbe: "#FFB901" })),
        );
        const abweichung = karte.findings.find((befund) => befund.code === "datei_weicht_von_farbtafel_ab");
        expect(abweichung?.notes).toHaveLength(1);
        expect(abweichung?.notes[0]).toContain("name");
    });

    it("🔴 eine unbrauchbare Datei bricht ab, bevor irgendetwas gelesen oder geschrieben wird", () => {
        const faelle: [string, Buffer][] = [
            ["kein JSON", Buffer.from("{ nein", "utf8")],
            ["keine FeatureCollection", json({ type: "Feature" })],
            ["leer", sammlung()],
            ["ohne Schlüssel", sammlung(merkmal("", multi(quadrat(1, 1, 2, 2))))],
            ["Schlüssel außerhalb der Tafel", sammlung(merkmal("klingonisch", multi(quadrat(1, 1, 2, 2))))],
            [
                "Schlüssel doppelt",
                sammlung(
                    merkmal("garethi", multi(quadrat(1, 1, 2, 2))),
                    merkmal("garethi", multi(quadrat(5, 5, 6, 6))),
                ),
            ],
            ["Punkt statt Fläche", sammlung(merkmal("garethi", { type: "Point", coordinates: [1, 1] }))],
        ];
        for (const [name, bytes] of faelle) {
            expect(() => liesSprachenKarte(bytes), name).toThrow(MigrationAborted);
        }
    });
});

describeWithCluster("Sprachenkarte einspielen (WI-0261 S6, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const db = (): VpsCluster => cluster!;
    const imp = (): Database => importer!;

    const url = (): string => {
        const o = db().migrator.options as unknown as {
            host: string[];
            port: number[];
            user: string;
            database: string;
        };
        return `postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`;
    };

    const leeren = async (): Promise<void> => {
        const a = db().admin;
        await a`DELETE FROM sprache_treffer`;
        await a`DELETE FROM sprache_wiki`;
        await a`DELETE FROM sprache_flaeche`;
        await a`DELETE FROM sprache`;
        await a`DELETE FROM wiki_sprache_artikel`;
        await a`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        await a`DELETE FROM migration_run WHERE data_domain = 'sprachen'`;
    };

    const zahl = async (tabelle: "sprache" | "sprache_flaeche" | "sprache_wiki"): Promise<number> => {
        const [zeile] = await db().admin<{ n: number }[]>`SELECT count(*)::int AS n FROM ${db().admin(tabelle)}`;
        return zeile!.n;
    };
    const durchlaeufe = async (): Promise<number> => {
        const [zeile] = await db().admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'sprachen'
        `;
        return zeile!.n;
    };
    const auftraege = async (): Promise<
        { state: string; input_ref: Record<string, unknown>; actor_ref: string | null; coalesced_count: number }[]
    > =>
        db().admin`
            SELECT state, input_ref, actor_ref, coalesced_count FROM job WHERE kind = 'sprache_treffer' ORDER BY id
        `;
    /** Alles, was ein zweiter Lauf nicht anfassen darf: Zeilen, Revisionen, Änderungszeiten. */
    const zustand = async (): Promise<unknown> => {
        const a = db().admin;
        return {
            sprache: await a`SELECT id, revision, updated_at::text, is_active FROM sprache ORDER BY id`,
            flaeche:
                await a`SELECT id, revision, updated_at::text, is_active, quelle_revision FROM sprache_flaeche ORDER BY id`,
            wiki: await a`SELECT id, revision, updated_at::text, is_active FROM sprache_wiki ORDER BY id`,
        };
    };
    const flaechenJe = async (
        herkunft: string,
        aktiv: boolean,
    ): Promise<{ sprache: string; quelle_revision: string | null }[]> =>
        db().admin`
            SELECT s.schluessel AS sprache, f.quelle_revision FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
             WHERE f.herkunft = ${herkunft} AND f.is_active = ${aktiv} ORDER BY s.schluessel, f.id
        `;

    const fuehreAus = (datei: Buffer, optionen: { dryRun?: boolean } = {}): Promise<SprachenImportBericht> =>
        importSprachen(imp(), datei, optionen);

    /** Wiki-Artikel im Stand des WikiSync (`wiki_sprache_artikel`), wie der Bereich `sprachen` sie anlegt. */
    const artikel = async (...titel: string[]): Promise<void> => {
        for (const eintrag of titel) {
            await db().admin`
                INSERT INTO wiki_sprache_artikel (schluessel, titel) VALUES (${sprachSchluessel(eintrag)}, ${eintrag})
            `;
        }
    };
    const pille = async (
        sprache: string,
        titel: string,
        stelle: number,
        extra: { still?: boolean } = {},
    ): Promise<void> => {
        await db().admin`
            INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft, is_active, retired_at, retired_origin)
            VALUES ((SELECT id FROM sprache WHERE schluessel = ${sprache}),
                    (SELECT id FROM wiki_sprache_artikel WHERE schluessel = ${sprachSchluessel(titel)}),
                    ${stelle}, ${extra.still === true ? "import" : "redaktion"}, ${extra.still !== true},
                    ${extra.still === true ? db().admin`now()` : null}, ${extra.still === true ? "editor" : null})
        `;
    };
    const pillenJe = async (sprache: string): Promise<{ titel: string; position: number; herkunft: string }[]> =>
        db().admin`
            SELECT a.titel, w.position, w.herkunft
              FROM sprache_wiki w JOIN sprache s ON s.id = w.sprache_id JOIN wiki_sprache_artikel a ON a.id = w.wiki_sprache_artikel_id
             WHERE s.schluessel = ${sprache} AND w.is_active ORDER BY w.position
        `;

    beforeAll(async () => {
        cluster = await startVpsCluster("sprimport", vorlagen, { mapDomains: true });
        // Zwei Verbindungen für den Zug: die Sperre der Domäne hält eine, die Transaktion die andere (Muster `gebietsableitung-auftrag.test.ts`).
        importer = createDatabase(url(), { max: 3 });
    }, 300_000);

    beforeEach(async () => {
        await leeren();
    });

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 der Probelauf rechnet den Bericht des Schreiblaufs und lässt nichts stehen: keine Sprache, Fläche, Zuordnung, kein Journal, kein Auftrag", async () => {
        const bericht = await fuehreAus(lies(DATEI_A), { dryRun: true });
        expect(bericht.dryRun).toBe(true);
        expect(bericht.quelleRevision).toBe(SHA_A);
        expect(bericht.eintraege).toMatchObject({ angelegt: 11, vorhanden: 0, abweichend: [] });
        expect(bericht.flaechen).toMatchObject({
            angelegt: 4,
            stillgelegt: 0,
            stuetzpunkte: 20,
            dateiSchonEingespielt: false,
        });
        expect(bericht.auftrag.eingereiht).toBe(true);
        expect(bericht.changed).toBe(true);
        expect(await zahl("sprache")).toBe(0);
        expect(await zahl("sprache_flaeche")).toBe(0);
        expect(await zahl("sprache_wiki")).toBe(0);
        expect(await durchlaeufe()).toBe(0);
        expect(await auftraege()).toEqual([]);
    });

    it("der Schreiblauf legt die elf Einträge der Tafel, die Teile der Datei, das Journal und EINEN Auftrag an", async () => {
        const bericht = await fuehreAus(lies(DATEI_A));
        expect(bericht.dryRun).toBe(false);
        expect(bericht.eintraege.angelegt).toBe(11);
        expect(bericht.flaechen.angelegt).toBe(4);
        expect(bericht.flaechen.jeSprache["thorwalsch"]).toEqual({
            teile: 2,
            flaecheE2: 20_000,
            stuetzpunkte: 10,
            loecher: 0,
        });
        expect(bericht.flaechen.jeSprache["garethi"]).toEqual({
            teile: 1,
            flaecheE2: 10_000,
            stuetzpunkte: 5,
            loecher: 0,
        });
        expect(bericht.flaechen.jeSprache["tulamidya"]).toBeUndefined();
        expect(bericht.changed).toBe(true);

        const eintraege = await db().admin<
            {
                schluessel: string;
                name: string;
                legende: string;
                farbe: string;
                reihenfolge: number;
                herkunft: string;
                is_active: boolean;
            }[]
        >`SELECT schluessel, name, legende, farbe, reihenfolge, herkunft, is_active FROM sprache ORDER BY reihenfolge`;
        expect(eintraege).toHaveLength(11);
        expect(eintraege[0]).toEqual({
            schluessel: "thorwalsch",
            name: "Thorwalsch",
            legende: "Thorwalsch / Gjalskisch / Fjarningsch",
            farbe: "#1baad4",
            reihenfolge: 0,
            herkunft: "sprachenkarte",
            is_active: true,
        });
        expect(eintraege[10]).toMatchObject({ schluessel: "tahaya", farbe: "#78373d", reihenfolge: 10 });
        expect(eintraege.map((eintrag) => eintrag.reihenfolge)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

        const flaechen = await db().admin<
            {
                sprache: string;
                herkunft: string;
                quelle_revision: string;
                is_active: boolean;
                srid: number;
                typ: string;
            }[]
        >`
            SELECT s.schluessel AS sprache, f.herkunft, f.quelle_revision, f.is_active, ST_SRID(f.geom) AS srid, GeometryType(f.geom) AS typ
              FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id ORDER BY s.schluessel, f.id
        `;
        expect(flaechen.map((zeile) => zeile.sprache)).toEqual(["garethi", "nujuka", "thorwalsch", "thorwalsch"]);
        expect(
            flaechen.every(
                (zeile) =>
                    zeile.herkunft === "sprachenkarte" &&
                    zeile.quelle_revision === SHA_A &&
                    zeile.is_active &&
                    zeile.srid === 0 &&
                    zeile.typ === "POLYGON",
            ),
        ).toBe(true);
        // Mischgebiet: Garethi und Thorwalsch überlappen, ohne dass die Datenbank etwas dagegen hat (E2).
        const [misch] = await db().admin<{ e2: number }[]>`
            SELECT ST_Area(ST_Intersection(g.geom, t.geom))::float8 AS e2
              FROM sprache_flaeche g JOIN sprache sg ON sg.id = g.sprache_id AND sg.schluessel = 'garethi',
                   sprache_flaeche t JOIN sprache st ON st.id = t.sprache_id AND st.schluessel = 'thorwalsch'
             WHERE ST_Intersects(g.geom, t.geom) AND ST_Area(ST_Intersection(g.geom, t.geom)) > 0
        `;
        expect(misch?.e2).toBe(5_000);

        const [lauf] = await db().admin<{ status: string; source_ref: string; journal: Record<string, unknown> }[]>`
            SELECT status, source_ref, journal FROM migration_run WHERE data_domain = 'sprachen'
        `;
        expect(lauf?.status).toBe("completed");
        expect(lauf?.source_ref).toContain(SHA_A);
        expect(lauf?.journal["dry_run"]).toBe(false);

        const jobs = await auftraege();
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({
            state: "QUEUED",
            input_ref: { alle: true },
            actor_ref: SPRACHEN_IMPORT_AKTEUR,
        });
        expect(bericht.auftrag).toMatchObject({ eingereiht: true });
        expect(bericht.auftrag.jobId).toEqual(expect.any(String));
    });

    it("ohne Wiki-Stand ordnet der Import nichts zu und sagt es", async () => {
        const bericht = await fuehreAus(lies(DATEI_A));
        expect(bericht.wiki).toMatchObject({ stand: false, aktiveArtikel: 0, angelegt: 0 });
        expect(bericht.findings.map((befund) => befund.code)).toContain("wiki_ohne_stand");
        expect(await zahl("sprache_wiki")).toBe(0);
    });

    it("🔴 derselbe SHA ein zweites Mal ändert nichts: keine Zeile, keine Revision, kein zweiter Auftrag; eine von der Redaktion stillgelegte Fläche bleibt still", async () => {
        await fuehreAus(lies(DATEI_A));
        const vorher = await zustand();
        const zweiter = await fuehreAus(lies(DATEI_A));
        expect(zweiter.changed).toBe(false);
        expect(zweiter.flaechen).toMatchObject({
            dateiSchonEingespielt: true,
            angelegt: 0,
            stillgelegt: 0,
            unveraendert: 4,
        });
        expect(zweiter.eintraege).toMatchObject({ angelegt: 0, vorhanden: 11, abweichend: [] });
        expect(zweiter.auftrag.eingereiht).toBe(false);
        expect(await zustand()).toEqual(vorher);
        const jobs = await auftraege();
        expect(jobs).toHaveLength(1);
        expect(jobs[0]?.coalesced_count).toBe(0);
        expect(await durchlaeufe()).toBe(2);

        // Die Redaktion legt eine Teilfläche still; derselbe Lauf holt sie nicht zurück.
        await db().admin`
            UPDATE sprache_flaeche SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE id = (SELECT min(id) FROM sprache_flaeche)
        `;
        const dritter = await fuehreAus(lies(DATEI_A));
        expect(dritter.changed).toBe(false);
        expect(dritter.flaechen).toMatchObject({ angelegt: 0, stillgelegt: 0, unveraendert: 3 });
        expect(await zahl("sprache_flaeche")).toBe(4);
        expect((await flaechenJe("sprachenkarte", true)).length).toBe(3);
    });

    it("🔴 eine neue Datei legt die Teile neu an und die bisherigen aktiven der Herkunft still; Flächen der Redaktion bleiben; vorhandene Einträge bleiben", async () => {
        await fuehreAus(lies(DATEI_A));
        // Die Redaktion zeichnet eine Fläche und färbt Garethi um.
        await db().migrator`
            INSERT INTO sprache_flaeche (sprache_id, map_domain_id, geom, herkunft)
            VALUES ((SELECT id FROM sprache WHERE schluessel = 'thorwalsch'), 'aventuria',
                    ST_GeomFromText('POLYGON((400 400,450 400,450 450,400 450,400 400))', 0), 'redaktion')
        `;
        await db().admin`UPDATE sprache SET farbe = '#112233', name = 'Garethisch' WHERE schluessel = 'garethi'`;
        const [redaktion] = await db().admin<{ id: string; revision: number }[]>`
            SELECT id::text, revision FROM sprache_flaeche WHERE herkunft = 'redaktion'
        `;

        const bericht = await fuehreAus(lies(DATEI_B));
        expect(bericht.quelleRevision).toBe(SHA_B);
        expect(bericht.flaechen).toMatchObject({
            bisherAktiv: 4,
            redaktionUnberuehrt: 1,
            angelegt: 3,
            stillgelegt: 4,
            dateiSchonEingespielt: false,
        });
        expect(bericht.changed).toBe(true);

        expect(
            (await flaechenJe("sprachenkarte", true)).map((zeile) => [zeile.sprache, zeile.quelle_revision]),
        ).toEqual([
            ["garethi", SHA_B],
            ["thorwalsch", SHA_B],
            ["tulamidya", SHA_B],
        ]);
        const still = await db().admin<{ retired_origin: string; retired_at: Date | null; quelle_revision: string }[]>`
            SELECT retired_origin, retired_at, quelle_revision FROM sprache_flaeche WHERE herkunft = 'sprachenkarte' AND NOT is_active
        `;
        expect(still).toHaveLength(4);
        expect(
            still.every(
                (zeile) =>
                    zeile.retired_origin === "import" && zeile.retired_at !== null && zeile.quelle_revision === SHA_A,
            ),
        ).toBe(true);
        // Die Fläche der Redaktion: aktiv, unverändert, ohne Revision der Quelle.
        const [danach] = await db().admin<{ is_active: boolean; revision: number; quelle_revision: string | null }[]>`
            SELECT is_active, revision, quelle_revision FROM sprache_flaeche WHERE id = ${redaktion!.id}
        `;
        expect(danach).toEqual({ is_active: true, revision: redaktion!.revision, quelle_revision: null });

        // Der vorhandene Eintrag bleibt, wie die Redaktion ihn geändert hat; der Bericht nennt die Abweichung.
        const [garethi] = await db().admin<
            { name: string; farbe: string }[]
        >`SELECT name, farbe FROM sprache WHERE schluessel = 'garethi'`;
        expect(garethi).toEqual({ name: "Garethisch", farbe: "#112233" });
        expect(bericht.eintraege).toMatchObject({ angelegt: 0, vorhanden: 10 });
        expect(bericht.eintraege.abweichend).toEqual([
            {
                schluessel: "garethi",
                felder: [
                    { feld: "name", vorhanden: "Garethisch", tafel: "Garethi" },
                    { feld: "farbe", vorhanden: "#112233", tafel: "#ffb901" },
                ],
            },
        ]);
        expect(bericht.findings.map((befund) => befund.code)).toContain("eintrag_weicht_von_tafel_ab");

        // Der zweite Anlass fährt mit dem wartenden Auftrag (sammeln), er reiht keinen zweiten ein.
        const jobs = await auftraege();
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({ input_ref: { alle: true }, coalesced_count: 1 });

        // Zurück zur ersten Datei: B ist jetzt die aktuelle, A wird wieder eingespielt (neue Zeilen, B still).
        const zurueck = await fuehreAus(lies(DATEI_A));
        expect(zurueck.flaechen).toMatchObject({ angelegt: 4, stillgelegt: 3, dateiSchonEingespielt: false });
        expect((await flaechenJe("sprachenkarte", true)).map((zeile) => zeile.quelle_revision)).toEqual([
            SHA_A,
            SHA_A,
            SHA_A,
            SHA_A,
        ]);
        expect(await zahl("sprache_flaeche")).toBe(4 + 3 + 4 + 1);
    });

    it("🔴 Wiki-Artikel werden nur zugeordnet, wenn sie frei sind; sie stehen in der Reihenfolge der Tafel auf der nächsten freien Stelle", async () => {
        await fuehreAus(lies(DATEI_A));
        await artikel(
            "Thorwalsch",
            "Gjalskisch",
            "Fjarningsch",
            "Garethi",
            "Ta-Haya",
            "Zhulchammaqra",
            "Ferkina (Sprache)",
        );
        // Fjarningsch hat die Redaktion schon an Thorwalsch gehängt, Garethi an Tulamidya, Zhulchammaqra später gelöst.
        await pille("thorwalsch", "Fjarningsch", 0);
        await pille("tulamidya", "Garethi", 0);
        await pille("ferkina", "Zhulchammaqra", 0, { still: true });
        const vorher = await auftraege();

        const bericht = await fuehreAus(lies(DATEI_A));
        expect(bericht.wiki).toMatchObject({
            stand: true,
            aktiveArtikel: 7,
            angelegt: 4,
            vorhanden: 1,
            anderswo: ["Garethi -> tulamidya"],
            vonRedaktionGeloest: 1,
        });
        expect(bericht.wiki.fehlend).toEqual([
            "Nujuka",
            "Isdira",
            "Ologhaijan",
            "Oloarkh",
            "Goblinisch",
            "Rogolan",
            "Tulamidya",
            "Rssahh",
        ]);
        expect(bericht.changed).toBe(true);
        expect(bericht.flaechen.angelegt).toBe(0);
        expect(bericht.auftrag.eingereiht).toBe(false);
        expect(await auftraege()).toEqual(vorher);
        expect(bericht.findings.map((befund) => befund.code)).toEqual(
            expect.arrayContaining([
                "wiki_artikel_fehlt",
                "wiki_zuordnung_anderswo",
                "wiki_zuordnung_von_redaktion_geloest",
            ]),
        );

        expect(await pillenJe("thorwalsch")).toEqual([
            { titel: "Fjarningsch", position: 0, herkunft: "redaktion" },
            { titel: "Thorwalsch", position: 1, herkunft: "import" },
            { titel: "Gjalskisch", position: 2, herkunft: "import" },
        ]);
        expect(await pillenJe("tahaya")).toEqual([{ titel: "Ta-Haya", position: 0, herkunft: "import" }]);
        expect(await pillenJe("ferkina")).toEqual([{ titel: "Ferkina (Sprache)", position: 0, herkunft: "import" }]);
        expect(await pillenJe("tulamidya")).toEqual([{ titel: "Garethi", position: 0, herkunft: "redaktion" }]);
        expect(await pillenJe("garethi")).toEqual([]);

        // Wieder ein Lauf: Es ist alles zugeordnet, was frei war.
        const vorherZustand = await zustand();
        const nochmal = await fuehreAus(lies(DATEI_A));
        expect(nochmal.wiki).toMatchObject({ angelegt: 0, vorhanden: 5 });
        expect(nochmal.changed).toBe(false);
        expect(await zustand()).toEqual(vorherZustand);
    });

    it("🔴 ein Teil außerhalb der Kartendomäne ist nicht speicherbar: technischer Abbruch, nichts geschrieben", async () => {
        const draussen = sammlung(
            merkmal("garethi", multi(quadrat(100, 100, 200, 200))),
            merkmal("thorwalsch", multi(quadrat(900, 900, 1100, 1100))),
        );
        await expect(fuehreAus(draussen)).rejects.toThrow(MigrationAborted);
        await expect(fuehreAus(draussen)).rejects.toThrow(/außerhalb der Kartendomäne/u);
        expect(await zahl("sprache")).toBe(0);
        expect(await zahl("sprache_flaeche")).toBe(0);
        expect(await durchlaeufe()).toBe(0);
        expect(await auftraege()).toEqual([]);
    });

    it("eine unbekannte Kartendomäne bricht ab, ohne etwas zu schreiben", async () => {
        await expect(importSprachen(imp(), lies(DATEI_A), { mapDomainId: "gibt-es-nicht" })).rejects.toThrow(
            MigrationAborted,
        );
        expect(await zahl("sprache")).toBe(0);
    });

    it("🔴 eine ungültige Geometrie wird repariert und als Befund gemeldet (eine Schleife wird zu zwei Teilen)", async () => {
        const schleife = [
            [
                [100, 100],
                [200, 200],
                [200, 100],
                [100, 200],
                [100, 100],
            ],
        ];
        const bericht = await fuehreAus(sammlung(merkmal("nujuka", multi(schleife))));
        const befund = bericht.findings.find((eintrag) => eintrag.code === "geometrie_repariert");
        expect(befund?.numbers).toEqual({ sprachen: 1 });
        expect(befund?.notes[0]).toContain("nujuka");
        expect(bericht.flaechen.jeSprache["nujuka"]?.teile).toBe(2);
        expect(bericht.flaechen.angelegt).toBe(2);
        const [ungueltig] = await db().admin<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM sprache_flaeche WHERE NOT ST_IsValid(geom)`;
        expect(ungueltig?.n).toBe(0);
    });

    describe("Kommandozeile `migrate:sprachen` (gegen den Wegwerf-Cluster)", () => {
        const cli = (
            args: string[],
            env: Record<string, string> = {},
        ): { code: number | null; out: string; err: string } => {
            const lauf = spawnSync(process.execPath, [CLI, ...args], {
                env: { ...process.env, DATABASE_URL: url(), ...env },
                encoding: "utf8",
                timeout: 120_000,
            });
            return { code: lauf.status, out: lauf.stdout, err: lauf.stderr };
        };

        it("ohne --source: Aufruf erklärt, Exit 1", () => {
            const lauf = cli([]);
            expect(lauf.code).toBe(1);
            expect(lauf.err).toContain("usage:");
        });

        it("🔴 ohne Zuruf des Betreibers ist es ein Probelauf: Bericht, nichts geschrieben; --json liefert nur den Bericht", () => {
            const lauf = cli(["--source", DATEI_A]);
            expect(lauf.code).toBe(0);
            expect(lauf.err).toContain("PROBELAUF");
            expect(lauf.out).toContain("angelegt 11");
            expect(lauf.out).toContain("thorwalsch");
            const maschine = cli(["--source", DATEI_A, "--json"]);
            expect(maschine.code).toBe(0);
            const bericht = JSON.parse(maschine.out) as SprachenImportBericht;
            expect(bericht).toMatchObject({ dryRun: true, quelleRevision: SHA_A, mapDomainId: "aventuria" });
            expect(bericht.flaechen.angelegt).toBe(4);
        });

        it("🔴 auch mit Zuruf rechnet --dry-run nur", async () => {
            const lauf = cli(["--source", DATEI_A, "--operator-said", "Test", "--dry-run", "--json"]);
            expect(lauf.code).toBe(0);
            expect(lauf.err).toContain("Freigabe (Betreiberzitat)");
            expect(JSON.parse(lauf.out)).toMatchObject({ dryRun: true });
            expect(await zahl("sprache")).toBe(0);
            expect(await zahl("sprache_flaeche")).toBe(0);
        });

        it("mit dem Zuruf des Betreibers wird geschrieben; eine Freigabe aus der Verwaltung (--auftrag) gibt es nicht", async () => {
            const abgelehnt = cli([
                "--source",
                DATEI_A,
                "--operator-said",
                "Test",
                "--auftrag",
                "00000000-0000-4000-8000-000000000001",
            ]);
            expect(abgelehnt.code).not.toBe(0);
            expect(await zahl("sprache")).toBe(0);

            const lauf = cli(["--source", DATEI_A, "--operator-said", "Test"]);
            expect(lauf.code).toBe(0);
            expect(lauf.err).toContain("Freigabe (Betreiberzitat): „Test“");
            expect(lauf.err).not.toContain("PROBELAUF");
            expect(lauf.out).toContain("geändert   ja");
            expect(await zahl("sprache")).toBe(11);
            expect(await zahl("sprache_flaeche")).toBe(4);
            expect(await auftraege()).toHaveLength(1);

            const nochmal = cli(["--source", DATEI_A, "--operator-said", "Test", "--json"]);
            expect(JSON.parse(nochmal.out)).toMatchObject({
                changed: false,
                flaechen: { dateiSchonEingespielt: true },
            });
        });

        it("eine unbrauchbare Datei endet mit Exit 2 und dem Grund", () => {
            const lauf = cli([
                "--source",
                fileURLToPath(new URL("./fixtures/sprachen-import-a.geojson.fehlt", import.meta.url)),
            ]);
            expect(lauf.code).not.toBe(0);
            const unbrauchbar = cli(["--source", CLI]);
            expect(unbrauchbar.code).toBe(2);
            expect(unbrauchbar.err).toContain("abgebrochen:");
        });
    });
});
