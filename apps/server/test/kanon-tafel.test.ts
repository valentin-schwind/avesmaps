import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KANON_OBJEKTART_VORGABE, WIKI_NAMESPACE_VORGABE, capabilitiesFor } from "@avesmaps3d/shared";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { ApiError } from "../src/http/api-error.ts";
import {
    aendereKanonTafel,
    kanonTafelVorgabe,
    leseKanonTafel,
    leseObjektartZeile,
    type KanonTafelAenderung,
} from "../src/kanon/tafel.ts";

/**
 * Die zwei Kanon-Tafeln je Umgebung (WI-0253 B-2, Migration 0223): Vorgabe aus dem Paket, Abweichungen in der Datenbank, eine Revision für
 * `baseRevision`/409 (Vorbild `zoombaender.test.ts`). Noch ohne Route; die Rechte der App-Rolle belegt `public-rechte-app-rolle.test.ts`.
 */

const akteur = { personId: null, label: "test:kanon", capabilities: capabilitiesFor("admin") };

describe("Tafeln ohne Datenbank", () => {
    it("🔴 ohne Datenbank oder ohne Tafel gilt die Vorgabe (unprovisioned)", async () => {
        const stand = kanonTafelVorgabe();
        expect(stand.source).toBe("unprovisioned");
        expect(stand.revision).toBeNull();
        expect(stand.namensraeume).toEqual(WIKI_NAMESPACE_VORGABE);
        expect(stand.objektarten).toEqual(KANON_OBJEKTART_VORGABE);
        expect(await leseKanonTafel(undefined)).toEqual(stand);
        // Eine fehlende Tafel (42P01) ist dieselbe Antwort, kein Fehler.
        const fehlt = Object.assign(
            () => Promise.reject(Object.assign(new Error("fehlt"), { code: "42P01" })),
            {},
        ) as unknown as Queryable;
        expect(await leseKanonTafel(fehlt)).toEqual(stand);
        // Ein anderer Fehler bleibt einer.
        const kaputt = (() => Promise.reject(new Error("kaputt"))) as unknown as Queryable;
        await expect(leseKanonTafel(kaputt)).rejects.toThrow("kaputt");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

async function fehler(aufruf: Promise<unknown>): Promise<ApiError> {
    try {
        await aufruf;
    } catch (error) {
        if (error instanceof ApiError) return error;
        throw error;
    }
    throw new Error("kein Fehler");
}

describeWithDatabase("Tafeln gegen PostgreSQL (Migration 0223)", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    });
    afterAll(async () => {
        await database?.end({ timeout: 5 });
    });
    beforeEach(async () => {
        await database`DELETE FROM wiki_namespace_setting`;
        await database`DELETE FROM canon_object_label_setting`;
    });

    const aendere = (aenderungen: KanonTafelAenderung[], baseRevision: number) =>
        database.begin((tx) => aendereKanonTafel(tx, { aenderungen, baseRevision, actor: akteur }));

    const ns444 = {
        ns: 444,
        praefix: "Ilaris",
        kanon: "inoffiziell" as const,
        einsammeln: true,
        bezeichner: "Regelwerk",
    };

    it("🔴 das Tafelrecht (`manage_canon_tables`, ab Admin) prüft die Funktion selbst; ohne es wird nichts geschrieben", async () => {
        const r0 = (await leseKanonTafel(database)).revision!;
        for (const rolle of ["tester", "reviewer", "editor"] as const) {
            const verweigert = await fehler(
                database.begin((tx) =>
                    aendereKanonTafel(tx, {
                        aenderungen: [{ tafel: "namensraum", ns: 444, zeile: ns444 }],
                        baseRevision: r0,
                        actor: { ...akteur, capabilities: capabilitiesFor(rolle) },
                    }),
                ),
            );
            expect([verweigert.statusCode, verweigert.code], rolle).toEqual([403, "forbidden"]);
        }
        expect((await leseKanonTafel(database)).abweichungenNamensraeume).toEqual([]);
        // Der Betreiber hat es aus seiner Rolle, ein Admin ebenso.
        await database.begin((tx) =>
            aendereKanonTafel(tx, {
                aenderungen: [{ tafel: "namensraum", ns: 444, zeile: ns444 }],
                baseRevision: r0,
                actor: { ...akteur, capabilities: capabilitiesFor("operator") },
            }),
        );
    });

    it("🔴 leer: die Vorgabe, aus der Datenbank gelesen, mit einer Revision", async () => {
        const stand = await leseKanonTafel(database);
        expect(stand.source).toBe("database");
        expect(stand.revision).toBeTypeOf("number");
        expect(stand.namensraeume).toEqual(WIKI_NAMESPACE_VORGABE);
        expect(stand.objektarten).toEqual(KANON_OBJEKTART_VORGABE);
        expect(stand.abweichungenNamensraeume).toEqual([]);
    });

    it("🔴 eine Änderung speichert nur die Abweichung, hebt die Revision, und „zurücksetzen“ löscht die Zeile", async () => {
        const r0 = (await leseKanonTafel(database)).revision!;
        const erg = await aendere([{ tafel: "namensraum", ns: 444, zeile: ns444 }], r0);
        expect(erg.geaendert).toEqual(["namensraum:444"]);
        expect(erg.revision).toBeGreaterThan(r0);
        const stand = await leseKanonTafel(database);
        expect(stand.revision).toBe(erg.revision);
        expect(stand.abweichungenNamensraeume).toEqual([ns444]);
        expect(stand.namensraeume.find((zeile) => zeile.ns === 444)).toEqual(ns444);
        // Die anderen Räume bleiben die Vorgabe.
        expect(stand.namensraeume.find((zeile) => zeile.ns === 222)).toEqual(
            WIKI_NAMESPACE_VORGABE.find((zeile) => zeile.ns === 222),
        );
        const zurueck = await aendere([{ tafel: "namensraum", ns: 444, zeile: null }], erg.revision);
        expect(zurueck.revision).toBeGreaterThan(erg.revision);
        const danach = await leseKanonTafel(database);
        expect(danach.abweichungenNamensraeume).toEqual([]);
        expect(danach.namensraeume).toEqual(WIKI_NAMESPACE_VORGABE);
    });

    it("🔴 eine Zeile, die der Vorgabe gleicht, wird nie gespeichert (409 no_change), und eine Änderung ohne Wirkung zählt nicht", async () => {
        const r0 = (await leseKanonTafel(database)).revision!;
        const vorgabe = WIKI_NAMESPACE_VORGABE.find((zeile) => zeile.ns === 222)!;
        const e1 = await fehler(aendere([{ tafel: "namensraum", ns: 222, zeile: vorgabe }], r0));
        expect([e1.statusCode, e1.code]).toEqual([409, "no_change"]);
        const e2 = await fehler(aendere([{ tafel: "namensraum", ns: 222, zeile: null }], r0));
        expect(e2.code).toBe("no_change");
        const e3 = await fehler(
            aendere([{ tafel: "objektart", art: "place", zeile: KANON_OBJEKTART_VORGABE[0]! }], r0),
        );
        expect(e3.code).toBe("no_change");
        const [zeilen] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM wiki_namespace_setting`;
        expect(zeilen?.n).toBe(0);
    });

    it("🔴 409 edit_conflict bei veralteter Revision, und es wird nichts geschrieben", async () => {
        const r0 = (await leseKanonTafel(database)).revision!;
        await aendere([{ tafel: "namensraum", ns: 444, zeile: ns444 }], r0);
        const fremd = await fehler(
            aendere([{ tafel: "namensraum", ns: 220, zeile: { ...WIKI_NAMESPACE_VORGABE[2]!, einsammeln: true } }], r0),
        );
        expect([fremd.statusCode, fremd.code]).toEqual([409, "edit_conflict"]);
        const stand = await leseKanonTafel(database);
        expect(stand.abweichungenNamensraeume.map((zeile) => zeile.ns)).toEqual([444]);
    });

    it("🔴 ein Raum wird hinzugefügt und wieder entfernt; ein Präfix gehört einem Raum", async () => {
        let revision = (await leseKanonTafel(database)).revision!;
        const neu = {
            ns: 100,
            praefix: "Briefspiel",
            kanon: "inoffiziell" as const,
            einsammeln: false,
            bezeichner: "",
        };
        revision = (await aendere([{ tafel: "namensraum", ns: 100, zeile: neu }], revision)).revision;
        expect((await leseKanonTafel(database)).namensraeume.map((zeile) => zeile.ns)).toEqual([
            0, 100, 218, 220, 222, 444,
        ]);
        // Dasselbe Präfix (ohne Rücksicht auf Groß und Klein) an einem zweiten Raum: 400, nichts geschrieben.
        const doppelt = await fehler(
            aendere([{ tafel: "namensraum", ns: 101, zeile: { ...neu, ns: 101, praefix: "BRIEFSPIEL" } }], revision),
        );
        expect([doppelt.statusCode, doppelt.code, doppelt.details?.["reason"]]).toEqual([
            400,
            "validation_failed",
            "praefix_doppelt",
        ]);
        // Auch zwei Änderungen, die einander das Präfix wegnehmen, prüft die Tafel, wie sie danach aussähe.
        const gegenseitig = await fehler(
            aendere(
                [
                    { tafel: "namensraum", ns: 101, zeile: { ...neu, ns: 101, praefix: "Fan" } },
                    { tafel: "namensraum", ns: 102, zeile: { ...neu, ns: 102, praefix: "fan" } },
                ],
                revision,
            ),
        );
        expect(gegenseitig.details?.["reason"]).toBe("praefix_doppelt");
        const [anzahl] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM wiki_namespace_setting`;
        expect(anzahl?.n).toBe(1);
        await aendere([{ tafel: "namensraum", ns: 100, zeile: null }], revision);
        expect((await leseKanonTafel(database)).namensraeume).toEqual(WIKI_NAMESPACE_VORGABE);
    });

    it("🔴 ungültige Zeilen: Bezeichner über 40 Zeichen, Präfix eines Vorgaberaums, falscher Kanon, Zeile und Nummer gehören nicht zusammen", async () => {
        const revision = (await leseKanonTafel(database)).revision!;
        const grund = async (aenderung: KanonTafelAenderung): Promise<unknown> => {
            const error = await fehler(aendere([aenderung], revision));
            expect(error.statusCode).toBe(400);
            return [error.details?.["field"], error.details?.["reason"]];
        };
        expect(await grund({ tafel: "namensraum", ns: 444, zeile: { ...ns444, bezeichner: "x".repeat(41) } })).toEqual([
            "bezeichner",
            "bezeichner_zu_lang",
        ]);
        expect(await grund({ tafel: "namensraum", ns: 444, zeile: { ...ns444, praefix: "Regeln" } })).toEqual([
            "praefix",
            "praefix_fest",
        ]);
        expect(await grund({ tafel: "namensraum", ns: 444, zeile: { ...ns444, kanon: "egal" as never } })).toEqual([
            "kanon",
            "kanon_unbekannt",
        ]);
        expect(await grund({ tafel: "namensraum", ns: 445, zeile: ns444 })).toEqual(["ns", "ns_ungueltig"]);
        expect(
            await grund({
                tafel: "objektart",
                art: "place",
                zeile: { art: "place", anzeigen: true, bezeichner: "y".repeat(41) },
            }),
        ).toEqual(["bezeichner", "bezeichner_zu_lang"]);
        expect(
            await grund({ tafel: "objektart", art: "place", zeile: { art: "path", anzeigen: true, bezeichner: "" } }),
        ).toEqual(["art", "art_unbekannt"]);
        // Die Datenbank hält die Grenze zusätzlich (zweite Linie, falls ein künftiger Schreibweg sie vergisst).
        await expect(
            database`INSERT INTO wiki_namespace_setting (ns, prefix, canon, collect, designator) VALUES (9, 'X', 'official', true, ${"z".repeat(41)})`,
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
            database`INSERT INTO wiki_namespace_setting (ns, prefix, canon, collect, designator) VALUES (0, 'Haupt', 'official', true, '')`,
        ).rejects.toMatchObject({ code: "23514" });
    });

    it("🔴 Rang 4: eine Zeile je Objektart, gelesen für eine Art; ohne Zeile die Vorgabe", async () => {
        const r0 = (await leseKanonTafel(database)).revision!;
        expect(await leseObjektartZeile(database, "place")).toEqual({
            art: "place",
            anzeigen: false,
            bezeichner: "Avesmaps",
        });
        const erg = await aendere(
            [{ tafel: "objektart", art: "place", zeile: { art: "place", anzeigen: true, bezeichner: "Avesmaps" } }],
            r0,
        );
        expect(erg.geaendert).toEqual(["objektart:place"]);
        expect(await leseObjektartZeile(database, "place")).toEqual({
            art: "place",
            anzeigen: true,
            bezeichner: "Avesmaps",
        });
        expect(await leseObjektartZeile(database, "path")).toEqual({
            art: "path",
            anzeigen: false,
            bezeichner: "Avesmaps",
        });
        const stand = await leseKanonTafel(database);
        expect(stand.objektarten.find((zeile) => zeile.art === "place")?.anzeigen).toBe(true);
        expect(stand.abweichungenObjektarten).toHaveLength(1);
        // Beide Tafeln in einem Speichern: eine Revision für beide, ein Eintrag je Zeile.
        const zwei = await aendere(
            [
                { tafel: "namensraum", ns: 444, zeile: ns444 },
                { tafel: "objektart", art: "peak", zeile: { art: "peak", anzeigen: true, bezeichner: "" } },
            ],
            erg.revision,
        );
        expect(zwei.geaendert).toEqual(["namensraum:444", "objektart:peak"]);
        expect((await leseKanonTafel(database)).revision).toBe(zwei.revision);
    });
});
