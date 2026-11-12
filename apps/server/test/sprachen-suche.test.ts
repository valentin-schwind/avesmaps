import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SEARCH_VORKOMMEN_SICHTBAR, type SearchResponse } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase } from "../src/database.ts";
import { search } from "../src/search/search.ts";
import { leereSuchSpeicher } from "../src/search/speicher.ts";
import { sucheSprachen, type SprachIndex, type SprachIndexEintrag } from "../src/search/sprachen-index.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Sprachen in der Spotlight-Suche (WI-0261 S5c; Betreiber 2026-10-30: „sprachen sollen in der suche auftauchen und leuchten“, O1: „Die Suche findet eine Gruppe auch über die Namen ihrer
 * Wiki-Artikel“) gegen echtes PostGIS: Wegwerf-Cluster mit allen Rollen. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Eine Gruppe wird über den Titel ihres ZWEITEN Wiki-Artikels nicht gefunden; ein Dialekt (Artikel derselben Familie ohne Sprache) findet nichts oder die falsche Sprache; eine
 * Vorstufe oder ein Artikel einer fremden Familie gilt als Dialekt; eine stillgelegte Sprache, ihre Fläche oder ein stillgelegter Artikel taucht auf; dieselbe Sprache steht mehrfach da (je Name
 * eine Zeile); Akzent und ß verhindern den Treffer; der Index merkt eine Änderung nicht; die Antwort verletzt das Schema der Route oder trägt die Sektion ohne Treffer.
 *
 * Die kleine Welt: „S5c Thorwisch“ (Gruppe: Artikel Thorwisch und Gjalskisch, Legende „… / Fjarningsch“, zwei Flächen), „S5c Garisch“ (ein Artikel, Dialekte Horathisch und Albernisch, eine
 * Fläche), „S5c Redaktionssprache“ (ohne Artikel, ohne Fläche), „S5c Altsprache“ (stillgelegt, mit Artikel und Fläche) und sieben Sprachen „S5c Reihe n“ für den Deckel.
 */

const ENV = "sprsuche";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

/** Ein Eintrag des Index von Hand, für die reinen Fälle. */
function eintrag(teil: Partial<SprachIndexEintrag> & { name: string }): SprachIndexEintrag {
    const gefaltet = (text: string): string =>
        text.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/ß/gu, "ss").toLowerCase();
    const { name, ...rest } = teil;
    return {
        publicId: `00000000-0000-4000-8000-${String(name.length).padStart(12, "0")}`,
        schluessel: gefaltet(name).replace(/\W+/gu, "-"),
        name,
        gefaltet: gefaltet(name),
        farbe: "#336699",
        reihenfolge: 0,
        gruppe: false,
        gegenden: 1,
        legende: undefined,
        artikel: [],
        dialekte: [],
        ...rest,
    };
}
const nameVon = (text: string) => ({
    text,
    gefaltet: text.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/ß/gu, "ss").toLowerCase(),
});
const index = (...sprachen: SprachIndexEintrag[]): SprachIndex => ({ stempel: "test", sprachen });

describe("Die Ordnung der Sprachen in der Suche (rein)", () => {
    it("Name vor Wiki-Artikel vor Legende vor Dialekt bei gleicher Güte; eine Sprache ist ein Treffer", () => {
        const alle = index(
            eintrag({ name: "Zwei", dialekte: [nameVon("Alpha")] }),
            eintrag({ name: "Drei", artikel: [nameVon("Alpha")] }),
            eintrag({ name: "Vier", legende: nameVon("Alpha") }),
            eintrag({ name: "Alpha", artikel: [nameVon("Alpha Titel")], dialekte: [nameVon("Alpha Mundart")] }),
        );
        const treffer = sucheSprachen(alle, "alpha");
        expect(treffer.map((t) => [t.sprache.name, t.gefundenIn])).toEqual([
            ["Alpha", "name"],
            ["Drei", "wiki"],
            ["Vier", "legende"],
            ["Zwei", "dialekt"],
        ]);
        // „Alpha“ trifft vier Namen, steht aber einmal da, mit dem besten.
        expect(treffer.filter((t) => t.sprache.name === "Alpha")).toHaveLength(1);
    });

    it("die bessere Güte gewinnt vor dem Rang der Quelle: ein Anfang im Dialekt schlägt ein Stück mitten im Namen", () => {
        const treffer = sucheSprachen(index(eintrag({ name: "Xhorathi", dialekte: [nameVon("Horathi")] })), "hora");
        expect(treffer[0]).toMatchObject({ gefundenIn: "dialekt", ueber: "Horathi", guete: 1 });
    });

    it("Akzente und ß verhindern den Treffer nicht, in beide Richtungen", () => {
        const alle = index(
            eintrag({ name: "Güldenländisch" }),
            eintrag({ name: "Straßensprache", artikel: [nameVon("Âthykrisch")] }),
        );
        expect(sucheSprachen(alle, "guldenlandisch").map((t) => t.sprache.name)).toEqual(["Güldenländisch"]);
        expect(sucheSprachen(alle, "STRASSEN").map((t) => t.sprache.name)).toEqual(["Straßensprache"]);
        expect(sucheSprachen(alle, "athykrisch")[0]).toMatchObject({ gefundenIn: "wiki", ueber: "Âthykrisch" });
        expect(sucheSprachen(alle, "Âthykrisch")).toHaveLength(1);
    });

    it("bei gleicher Güte steht eine Sprache mit Fläche vor einer ohne, dann gilt die Reihenfolge der Legende", () => {
        const treffer = sucheSprachen(
            index(
                eintrag({ name: "Kaa", gegenden: 0, reihenfolge: 1 }),
                eintrag({ name: "Kab", gegenden: 2, reihenfolge: 9 }),
                eintrag({ name: "Kac", gegenden: 1, reihenfolge: 2 }),
            ),
            "ka",
        );
        expect(treffer.map((t) => t.sprache.name)).toEqual(["Kac", "Kab", "Kaa"]);
    });

    it("eine leere Anfrage findet nichts", () => {
        expect(sucheSprachen(index(eintrag({ name: "Alpha" })), "  ")).toEqual([]);
    });
});

describeWithCluster("Sprachen in der Spotlight-Suche (WI-0261 S5c, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    let app: FastifyInstance | undefined;
    const id: Record<string, string> = {};

    const db = (): VpsCluster => cluster!;
    const suche = (q: string): Promise<SearchResponse> => search(db().app, q);
    const namen = (antwort: SearchResponse): string[] => antwort.sprachen?.hits.map((hit) => hit.name) ?? [];

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;

        const sprache = async (
            schluessel: string,
            name: string,
            farbe: string,
            optionen: { legende?: string; herkunft?: string; reihenfolge?: number; stillgelegt?: boolean } = {},
        ): Promise<string> => {
            const stillgelegt = optionen.stillgelegt === true;
            const [zeile] = await m<{ id: string }[]>`
                INSERT INTO sprache (schluessel, name, legende, farbe, reihenfolge, herkunft, state, is_active, retired_at, retired_origin)
                VALUES (${schluessel}, ${name}, ${optionen.legende ?? null}, ${farbe}, ${optionen.reihenfolge ?? 1}, ${optionen.herkunft ?? "sprachenkarte"},
                        ${stillgelegt ? "retired" : "active"}, ${!stillgelegt}, ${stillgelegt ? m`now()` : null}, ${stillgelegt ? "editor" : null})
                RETURNING public_id::text AS id
            `;
            return zeile!.id;
        };
        const flaeche = async (schluessel: string, wkt: string): Promise<void> => {
            await m`
                INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft, quelle_revision)
                VALUES (gen_random_uuid(), (SELECT id FROM sprache WHERE schluessel = ${schluessel}), 'aventuria', ST_GeomFromText(${wkt}, 0),
                        'sprachenkarte', ${"e0619e909dcc".padEnd(64, "0")})
            `;
        };
        const artikel = async (
            titel: string,
            felder: { vorstufen?: string; navigation?: string[]; aktiv?: boolean } = {},
        ): Promise<string> => {
            const aktiv = felder.aktiv !== false;
            const [zeile] = await m<{ id: string }[]>`
                INSERT INTO wiki_sprache_artikel (schluessel, titel, name, vorstufen, navigation, unbekannt, is_active, retired_at, retired_origin)
                VALUES (${titel.toLowerCase()}, ${titel}, ${titel}, ${felder.vorstufen ?? null}, ${felder.navigation ?? []}::text[], '{}'::text[],
                        ${aktiv}, ${aktiv ? null : m`now()`}, ${aktiv ? null : "wikisync"})
                RETURNING id::text
            `;
            return zeile!.id;
        };
        const zuordnen = async (schluessel: string, artikelId: string, position: number): Promise<void> => {
            await m`
                INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
                VALUES ((SELECT id FROM sprache WHERE schluessel = ${schluessel}), ${artikelId}::bigint, ${position}, 'import')
            `;
        };

        id["thor"] = await sprache("s5c-thor", "S5c Thorwisch", "#1baad4", {
            legende: "S5c Thorwisch / Gjalskisch / Fjarningsch",
            reihenfolge: 1,
        });
        id["gar"] = await sprache("s5c-gar", "S5c Garisch", "#ffb901", { reihenfolge: 2 });
        id["redaktion"] = await sprache("s5c-red", "S5c Redaktionssprache", "#336699", {
            herkunft: "redaktion",
            reihenfolge: 3,
        });
        id["alt"] = await sprache("s5c-alt", "S5c Altsprache", "#996633", { stillgelegt: true, reihenfolge: 4 });
        for (let n = 1; n <= 7; n += 1)
            await sprache(`s5c-reihe-${String(n)}`, `S5c Reihe ${String(n)}`, "#808080", { reihenfolge: 10 + n });

        await flaeche("s5c-thor", quadrat(100, 100, 200, 200));
        await flaeche("s5c-thor", quadrat(300, 300, 320, 320));
        await flaeche("s5c-gar", quadrat(400, 400, 500, 500));
        await flaeche("s5c-alt", quadrat(600, 600, 650, 650));

        const familieThor = ["Nav Sprachfamilie Thor"];
        const familieGar = ["Nav Sprachfamilie Gar"];
        await zuordnen("s5c-thor", await artikel("S5c Thorwisch", { navigation: familieThor }), 0);
        await zuordnen("s5c-thor", await artikel("S5c Gjalskisch", { navigation: familieThor }), 1);
        // Garisch: ein Artikel, der Vorstufen nennt. Die Mundarten stehen in derselben Familie ohne Sprache; Uralt ist die Vorstufe, Fremd gehört einer anderen Familie.
        await zuordnen("s5c-gar", await artikel("S5c Garisch", { navigation: familieGar, vorstufen: "S5c Uralt" }), 0);
        await artikel("S5c Horathisch", { navigation: familieGar });
        await artikel("S5c Albernisch", { navigation: familieGar });
        await artikel("S5c Uralt", { navigation: familieGar });
        await artikel("S5c Fremdisch", { navigation: ["Nav Sprachfamilie Fremd"] });
        // Einer stillgelegten Sprache zugeordnet und selbst stillgelegt: beide finden nichts.
        await zuordnen("s5c-alt", await artikel("S5c Altartikel", { navigation: ["Nav Sprachfamilie Alt"] }), 0);
        // Ein stillgelegter Artikel an einer aktiven Sprache: Der Titel findet die Sprache nicht mehr.
        await zuordnen("s5c-red", await artikel("S5c Verschwunden", { aktiv: false }), 0);

        const o = cluster.app.options as unknown as { host: string[]; port: number[]; user: string; database: string };
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database: createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 2,
            }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 300_000);

    afterEach(() => {
        vi.useRealTimers();
        leereSuchSpeicher();
    });

    afterAll(async () => {
        vi.useRealTimers();
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    it("über den Namen: Name, Farbe, Schlüssel, Zahl der Gegenden und Sprachgruppe", async () => {
        const antwort = await suche("Thorwisch");
        expect(antwort.sprachen).toEqual({
            hits: [
                {
                    id: id["thor"],
                    schluessel: "s5c-thor",
                    name: "S5c Thorwisch",
                    farbe: "#1baad4",
                    gefundenIn: "name",
                    gruppe: true,
                    gegenden: 2,
                },
            ],
            total: 1,
        });
        // Eine einzelne Sprache ist keine Gruppe; ihre Fläche zählt eine Gegend.
        expect((await suche("Garisch")).sprachen?.hits[0]).toMatchObject({
            name: "S5c Garisch",
            gruppe: false,
            gegenden: 1,
        });
    });

    it("über die Legende: der Name der Legende trifft, wo der Name nicht passt", async () => {
        const antwort = await suche("Fjarningsch");
        expect(antwort.sprachen?.hits).toEqual([
            expect.objectContaining({
                id: id["thor"],
                name: "S5c Thorwisch",
                gefundenIn: "legende",
                ueber: "S5c Thorwisch / Gjalskisch / Fjarningsch",
            }),
        ]);
    });

    it("über den Titel des ZWEITEN Wiki-Artikels einer Gruppe (O1)", async () => {
        const antwort = await suche("Gjalskisch");
        // Die Legende nennt „Gjalskisch“ ebenso, und der Artikel trifft gleich gut; es bleibt EIN Treffer, und der Artikel geht vor (er nennt das Wort allein).
        expect(antwort.sprachen?.total).toBe(1);
        expect(antwort.sprachen?.hits[0]).toMatchObject({
            id: id["thor"],
            name: "S5c Thorwisch",
            gruppe: true,
            gefundenIn: "wiki",
            ueber: "S5c Gjalskisch",
        });
        // Der Titel mit Präfix steht nur als Artikel da, nicht in der Legende.
        const nurArtikel = await suche("S5c Gjalskisch");
        expect(nurArtikel.sprachen?.hits[0]).toMatchObject({ gefundenIn: "wiki", ueber: "S5c Gjalskisch" });
    });

    it("über einen Dialekt: der Treffer heißt wie der Dialekt, die Sprache steht in dialektVon", async () => {
        const antwort = await suche("Horathisch");
        expect(antwort.sprachen?.hits).toEqual([
            {
                id: id["gar"],
                schluessel: "s5c-gar",
                name: "S5c Horathisch",
                farbe: "#ffb901",
                gefundenIn: "dialekt",
                dialektVon: "S5c Garisch",
                gruppe: false,
                gegenden: 1,
            },
        ]);
        expect(namen(await suche("Albernisch"))).toEqual(["S5c Albernisch"]);
    });

    it("keine Dialekte sind die Vorstufe und der Artikel einer fremden Familie", async () => {
        expect((await suche("S5c Uralt")).sprachen).toBeUndefined();
        expect((await suche("S5c Fremdisch")).sprachen).toBeUndefined();
    });

    it("eine Sprache ohne Artikel und ohne Fläche ist ein Treffer mit null Gegenden", async () => {
        expect((await suche("Redaktionssprache")).sprachen?.hits[0]).toMatchObject({
            id: id["redaktion"],
            gruppe: false,
            gegenden: 0,
        });
    });

    it("Stilllegungen fehlen: die Sprache, ihr Artikel und ein stillgelegter Artikel an einer aktiven Sprache", async () => {
        expect((await suche("Altsprache")).sprachen).toBeUndefined();
        expect((await suche("Altartikel")).sprachen).toBeUndefined();
        expect((await suche("Verschwunden")).sprachen).toBeUndefined();
    });

    it("ohne Treffer fehlt die Sektion ganz (die Antwort bleibt für andere Oberflächen unverändert)", async () => {
        const antwort = await suche("Nichtsdergleichen");
        expect(antwort).not.toHaveProperty("sprachen");
    });

    it("der Deckel: höchstens fünf Zeilen und die Gesamtzahl", async () => {
        const antwort = await suche("S5c Reihe");
        expect(antwort.sprachen?.hits).toHaveLength(SEARCH_VORKOMMEN_SICHTBAR);
        expect(antwort.sprachen?.total).toBe(7);
        // Gleiche Güte, keine Fläche: die Reihenfolge der Legende entscheidet.
        expect(namen(antwort)).toEqual(["S5c Reihe 1", "S5c Reihe 2", "S5c Reihe 3", "S5c Reihe 4", "S5c Reihe 5"]);
    });

    it("der Index merkt eine Änderung: neu gelesen, sobald der Stempel sich geändert hat", async () => {
        expect(namen(await suche("S5c Neuling"))).toEqual([]);
        const [neu] = await db().migrator<{ id: string }[]>`
            INSERT INTO sprache (schluessel, name, farbe, reihenfolge, herkunft)
            VALUES ('s5c-neu', 'S5c Neuling', '#112233', 99, 'redaktion') RETURNING public_id::text AS id
        `;
        // Innerhalb des Prüfabstands gilt der alte Stand, danach der Stempel.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 5_000);
        expect(namen(await suche("S5c Neuling"))).toEqual(["S5c Neuling"]);
        // Eine Änderung am Namen zählt ebenso (Revision statt Zahl): umbenannt, gefunden unter dem neuen.
        await db().migrator`UPDATE sprache SET name = 'S5c Neuling Zwei' WHERE schluessel = 's5c-neu'`;
        vi.setSystemTime(Date.now() + 5_000);
        expect((await suche("Neuling Zwei")).sprachen?.hits[0]).toMatchObject({
            id: neu!.id,
            name: "S5c Neuling Zwei",
        });
        // Eine neue Fläche ändert die Zahl der Gegenden.
        await db().migrator`
            INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft)
            VALUES (gen_random_uuid(), (SELECT id FROM sprache WHERE schluessel = 's5c-neu'), 'aventuria', ST_GeomFromText(${quadrat(700, 700, 710, 710)}, 0), 'redaktion')
        `;
        vi.setSystemTime(Date.now() + 5_000);
        expect((await suche("Neuling Zwei")).sprachen?.hits[0]).toMatchObject({ gegenden: 1 });
        // Stillgelegt: weg.
        await db().migrator`
            UPDATE sprache SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor' WHERE schluessel = 's5c-neu'
        `;
        vi.setSystemTime(Date.now() + 5_000);
        expect((await suche("Neuling Zwei")).sprachen).toBeUndefined();
    });

    it("die Route antwortet nach dem Schema, auch mit der Sektion neben den gewöhnlichen Treffern", async () => {
        const antwort = await app!.inject({ url: `/api/search?q=${encodeURIComponent("Thorwisch")}` });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const body = antwort.json<SearchResponse>();
        expect(body.sprachen?.hits[0]).toMatchObject({ id: id["thor"], gefundenIn: "name", gegenden: 2 });
        expect(body.hits).toEqual([]);
        const leer = await app!.inject({ url: `/api/search?q=${encodeURIComponent("Nichtsdergleichen")}` });
        expect(leer.statusCode).toBe(200);
        expect(leer.json<SearchResponse>()).not.toHaveProperty("sprachen");
    });
});
