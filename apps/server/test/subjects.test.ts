import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    MapPointDetail,
    ResolveLinkResponse,
    SUBJECT_LIMITS,
    SubjectDetail,
    SubjectSourcesSection,
    PANEL_LEGACY_ONLY,
    displayDescription,
    layersOfSelection,
    pathChainKey,
    subjectKey,
    visibleFacts,
    type MapPointDetail as MapPointDetailType,
    type ObjectLinkParam,
    type ObjectLinkRequest,
    type ResolveLinkResponse as ResolveLinkResponseType,
    type SubjectDetail as SubjectDetailType,
    type SubjectTextFact,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { PUBLISHED_VARIANT } from "../src/media/roles.ts";
import { storageKey } from "../src/media/storage.ts";
import { readSubjectRevision } from "../src/subjects/revision.ts";
import { createSubjectService, type SubjectService } from "../src/subjects/service.ts";
import { MAP_DOMAIN, P4, STAMP, cleanSubjectFixtures, insertSubjectFixtures } from "./support/subject-fixture.ts";

/**
 * Der Subject-Vertrag und der Detail-Lesevertrag (WI-0063 P4) gegen echtes PostgreSQL und PostGIS: die Referenzfälle des
 * Entwurfs (Abschnitt 7), Kontext nach Geometrie, Legacys Anzeige mit verborgenen Zusatzfakten und Provenienz, Quellen ohne Vererbung, keine private Medienspalte,
 * Objektlinks mit ihren Kollisionen und Aliasen, und die Fehlerformen der Routen.
 *
 * Die Gebiete der Fixture laufen über den echten Import und die echte Ableitung (`deriveTerritories`), die Welt liegt in einer eigenen
 * Ecke der Karte (siehe `support/subject-fixture.ts`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Die Quelle des Klimabands, das dieser Test an der Ecke der Welt anlegt. */
const KLIMA_QUELLE = "p4-subjects-test";
/** Die Ecke der Karte, in der die Welt dieses Tests liegt (siehe `support/subject-fixture.ts`). */
const KLIMA_ECKE = "SRID=0;POLYGON((50 50,250 50,250 250,50 250,50 50))";

const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };
const SILENT = { write: (): void => undefined };

/** Kein leeres Bauteil in der Antwort (WI-0063 5.3): kein leerer Text, keine leere Liste, kein leeres Objekt, kein null. */
function expectNoEmptyParts(value: unknown, path = "$"): void {
    if (value === null || value === undefined) throw new Error(`${path} ist leer (null oder undefined)`);
    if (typeof value === "string") {
        expect(value.trim(), `${path} ist ein leerer Text`).not.toBe("");
    } else if (Array.isArray(value)) {
        expect(value.length, `${path} ist eine leere Liste`).toBeGreaterThan(0);
        value.forEach((item, at) => expectNoEmptyParts(item, `${path}[${String(at)}]`));
    } else if (typeof value === "object") {
        const entries = Object.entries(value);
        expect(entries.length, `${path} ist ein leeres Objekt`).toBeGreaterThan(0);
        for (const [key, item] of entries) expectNoEmptyParts(item, `${path}.${key}`);
    }
}

function field(
    detail: SubjectDetailType | null,
    name: string,
    direction?: string,
): Record<string, unknown> | undefined {
    return (detail?.facts ?? []).find(
        (fact) =>
            fact.field === name && (direction === undefined || ("direction" in fact && fact.direction === direction)),
    ) as Record<string, unknown> | undefined;
}

/** Der Inhalts-Hash des Wappens aus dem Fall zur Gebietskette (WI-0094); eine feste Zahl, damit der Fall wiederholbar bleibt. */
const COAT_SHA = "c".repeat(64);

/** Die Felder der Fakten, die Legacys Infobox nicht zeigt (`legacyHidden`), in der Reihenfolge der Antwort. */
function hiddenFields(detail: SubjectDetailType | null): string[] {
    return (detail?.facts ?? []).filter((fact) => fact.legacyHidden === true).map((fact) => fact.field);
}

describeWithDatabase("Subject-Lesevertrag gegen PostgreSQL (WI-0063 P4)", () => {
    let database: Database;
    let service: SubjectService;
    let app: FastifyInstance | undefined;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await insertSubjectFixtures(database);
        // Das Klimaband der Welt: Die Fälle zum Klima erwarten an dieser Ecke GENAU das tropische Band. Im Bestand einer eingerichteten Datenbank
        // liegt dort das echte (Legacy-Import) oder ein Rest von `climate.test.ts`, in einer frischen keins. Darum setzt der Test es selbst: erst
        // räumen, was an der Ecke liegt, dann das eigene Band. 🪤 `climate_band` ist abgeleitet; der Riegel lässt nur eine Transaktion durch,
        // die `climate.deriving` setzt (WI-0005), und `set_config(..., true)` gilt nur für sie.
        await database.begin(async (transaction) => {
            await transaction`SELECT set_config('climate.deriving', 'on', true)`;
            await transaction`DELETE FROM climate_band WHERE source_fingerprint = ${KLIMA_QUELLE} OR ST_Intersects(geom, ST_GeomFromEWKT(${KLIMA_ECKE}))`;
            await transaction`
                INSERT INTO climate_band (type_key, geom, source_fingerprint)
                VALUES ('tropisch', ST_GeomFromText('POLYGON((50 50,250 50,250 250,50 250,50 50))', 0), ${KLIMA_QUELLE})
            `;
        });
        service = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        await database.begin(async (transaction) => {
            await transaction`SELECT set_config('climate.deriving', 'on', true)`;
            await transaction`DELETE FROM climate_band WHERE source_fingerprint = ${KLIMA_QUELLE}`;
        });
        await cleanSubjectFixtures(database);
        await database.unsafe(`DELETE FROM migration_run WHERE source_ref = 'p4-revision-test'`);
        await database.end({ timeout: 5 });
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    async function detail(request: Parameters<SubjectService["detail"]>[0]): Promise<SubjectDetailType> {
        const result = await service.detail(request);
        if (result === null) throw new Error(`kein Subject: ${JSON.stringify(request)}`);
        expect(
            Value.Check(SubjectDetail, result),
            JSON.stringify([...Value.Errors(SubjectDetail, result)].slice(0, 2)),
        ).toBe(true);
        expectNoEmptyParts(result);
        return result;
    }

    const link = async (
        param: ObjectLinkParam,
        value: string,
        name?: ObjectLinkRequest["name"],
    ): Promise<ResolveLinkResponseType> => {
        const result = await service.resolveLink({ param, name: name ?? (param as ObjectLinkRequest["name"]), value });
        expect(Value.Check(ResolveLinkResponse, result)).toBe(true);
        return result;
    };

    describe("Revision", () => {
        it("🔴 die Revision ist ein Kurzschlüssel, stabil ohne Datenstand-Wechsel und neu mit jedem abgeschlossenen Lauf", async () => {
            const before = await readSubjectRevision(database);
            expect(before).toMatch(/^[0-9a-f]{12}$/);
            expect(await readSubjectRevision(database)).toBe(before);
            await database`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version, status, completed_at)
                VALUES (${randomUUID()}, 'p4-test', 'test', 'p4-revision-test', '1', 'completed', now())
            `;
            const after = await readSubjectRevision(database);
            expect(after).not.toBe(before);
            // Der Dienst baut seinen Index bei einer neuen Revision neu: die Antwort trägt sie.
            expect((await service.index()).revision).toBe(after);
            expect((await detail({ kind: "place", id: P4.gareth })).revision).toBe(after);
            await database`DELETE FROM migration_run WHERE source_ref = 'p4-revision-test'`;
            expect(await readSubjectRevision(database)).toBe(before);
        });
    });

    describe("Ort", () => {
        it("🔴 Gareth als reicher Fall: Kopf, Medien, Felder mit Provenienz, Wikizeile, Kontext, Kanon, Zähler", async () => {
            const gareth = await detail({ kind: "place", id: P4.gareth });
            expect(gareth.subject).toEqual({ kind: "place", id: P4.gareth });
            expect(gareth.title).toBe("P4 Gareth");
            // Untertitel in strukturierten Teilen: Art, Ortsart als Text, Hauptstadt und Sitz im Anzeigejahr.
            expect(gareth.subtitle).toEqual([
                { part: "type", key: "metropole" },
                { part: "kind", text: "Festung" },
                { part: "capitalOf", territory: { ref: { kind: "territory", id: P4.reich }, name: "P4 Reich" } },
                {
                    part: "seatOf",
                    territory: { ref: { kind: "territory", id: P4.provinzWest }, name: "P4 Provinz West" },
                },
            ]);
            // Wappen zuerst, dann die Kopfbilder in der Reihenfolge der Galerie.
            expect(gareth.media?.coat?.role).toBe("coat");
            expect(gareth.media?.header?.map((view) => [view.role, view.width, view.height])).toEqual([
                ["header", 1600, 900],
                ["header", 1600, 900],
            ]);
            expect(gareth.wiki).toEqual({
                url: "https://de.wiki-aventurica.de/wiki/P4_Gareth",
                title: "P4 Gareth",
                corpus: { key: "wiki-aventurica.de" },
                license: { name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" },
                attribution: "Wiki Aventurica",
            });
            expect(gareth.canon).toEqual({ canon: "official" });
            expect(gareth.counts).toEqual({ sources: 3 });
            expect(gareth.target).toEqual({ x: 110, y: 110, zoom: expect.any(Number) });
        });

        it("🔴 wie Legacy: Nestwerte sichtbar, eigene Werte als verborgene Zusatzfakten mit Herkunft (WI-0063 27.8)", async () => {
            const gareth = await detail({ kind: "place", id: P4.gareth });
            const wikiUrl = "https://de.wiki-aventurica.de/wiki/P4_Gareth";
            const stamp = "2026-06-06T21:01:40.000Z";
            const facts = (gareth.facts ?? []) as Record<string, unknown>[];
            // Erst alle Nestfakten (so zeigt Legacy den Ort mit Artikel), dahinter die eigenen Werte, nie mit dem Nest verschmolzen.
            expect(
                facts.map((fact) => [fact["field"], fact["layer"] ?? "nest", fact["legacyHidden"] ?? false]),
            ).toEqual([
                ["description", "nest", false],
                ["oberhaupt", "nest", false],
                ["einwohner", "nest", false],
                ["lage", "nest", false],
                ["verkehrswege", "nest", false],
                ["handelszone", "nest", false],
                ["bevoelkerung", "nest", false],
                ["tempel", "nest", false],
                ["buildingType", "nest", false],
                ["description", "direct", true],
                ["einwohner", "direct", true],
                ["lage", "direct", true],
            ]);
            const nest = (name: string): Record<string, unknown> | undefined =>
                facts.find((fact) => fact["field"] === name && fact["layer"] === undefined);
            const direct = (name: string): Record<string, unknown> | undefined =>
                facts.find((fact) => fact["field"] === name && fact["layer"] === "direct");
            // Die Nestwerte tragen Adresse und Stempel des Abgleichs; die `lage` des Nests wird gebildet, nie gespeichert.
            // Die Beschreibung bleibt im Server vollständig: den ersten Satz bildet die Anzeigeregel.
            expect(nest("description")).toEqual({
                field: "description",
                value: "Wiki-Beschreibung Gareth. Zweiter Satz des Wikis.",
                provenance: { kind: "wiki", wikiUrl, syncedAt: stamp },
            });
            expect(nest("oberhaupt")).toMatchObject({
                value: "Wiki-Oberhaupt",
                provenance: { kind: "wiki", wikiUrl, syncedAt: stamp },
            });
            expect(nest("einwohner")).toMatchObject({
                value: "50000",
                provenance: { kind: "wiki", wikiUrl, syncedAt: stamp },
            });
            expect(nest("lage")).toMatchObject({
                value: "Garetien · Mittelreich",
                provenance: { kind: "wiki", wikiUrl, syncedAt: stamp },
            });
            for (const name of ["handelszone", "bevoelkerung", "tempel", "buildingType", "verkehrswege"]) {
                expect(nest(name)?.["provenance"], name).toMatchObject({ kind: "wiki", wikiUrl, syncedAt: stamp });
            }
            // Die eigenen Werte tragen die Herkunft, die Legacy je Feld stempelt: keine Herkunft und `manual` sind redaktionell,
            // `wiki` ist eine übernommene Wiki-Angabe, ohne Stempel.
            expect(direct("description")).toEqual({
                field: "description",
                value: "Direkte Beschreibung (schlägt das Wiki)",
                provenance: { kind: "editorial" },
                layer: "direct",
                legacyHidden: true,
            });
            expect(direct("einwohner")).toEqual({
                field: "einwohner",
                value: "60000",
                provenance: { kind: "editorial" },
                layer: "direct",
                legacyHidden: true,
            });
            expect(direct("lage")).toEqual({
                field: "lage",
                value: "Direkte Lage",
                provenance: { kind: "wiki", wikiUrl },
                layer: "direct",
                legacyHidden: true,
            });
            // Ein leerer eigener Wert (Oberhaupt) ist keine Zeile.
            expect(direct("oberhaupt")).toBeUndefined();
            // Die Anzeigeregel zeigt genau Legacys Felder; die Beschreibung des Nests als erster Satz.
            const shown = visibleFacts("place", gareth.facts, PANEL_LEGACY_ONLY);
            expect(shown).toHaveLength(9);
            expect(shown.every((fact) => !("layer" in fact) && fact.legacyHidden === undefined)).toBe(true);
            const shownDescription = shown.find(
                (fact): fact is SubjectTextFact => fact.field === "description" && "value" in fact,
            );
            expect(shownDescription).toBeDefined();
            expect(displayDescription("place", shownDescription as SubjectTextFact, PANEL_LEGACY_ONLY).text).toBe(
                "Wiki-Beschreibung Gareth.",
            );
        });

        it("🔴 die Verkehrswege tragen Verweise nur über den Wiki-Key des Linkziels, nie über den Namen eines Wegs", async () => {
            const gareth = await detail({ kind: "place", id: P4.gareth });
            const links = (field(gareth, "verkehrswege")?.["links"] ?? []) as {
                text: string;
                ref: unknown;
                at: number;
            }[];
            // Die Linkziele stehen im Artikel (Export X1), ihr Key trifft über die Zuordnung (X2) die Hauptzuweisung der Straße: „P4 Reichsstraße 1“ an
            // seiner Stelle im Text. „P4 Waldweg“ ist der NAME eines echten Wegs ohne Wiki-Zuweisung (kein Objekt trägt den Key): kein Verweis. „P4 Pilgerweg“
            // ist eine Seite, die nur als weitere Zuweisung vorkommt (X2 kennt nur Hauptzuweisungen): kein Objekt, kein Verweis. „Unbekannter Weg“ steht
            // nicht im angezeigten Text: es gibt keinen Link ohne Stelle.
            expect(links).toEqual([
                {
                    text: "P4 Reichsstraße 1",
                    ref: { kind: "path", anchor: P4.strasseEins, wiki: "p4t-strasse-eins" },
                    at: 0,
                },
            ]);
        });

        it("🔴 ein Dorf ohne Wiki bleibt knapp: nur, was bekannt ist, ohne leere Zeile und ohne leere Sektion", async () => {
            const dorf = await detail({ kind: "place", id: P4.dorf });
            // Das Kanon-Etikett steht seit WI-0253 B-2 (49a243583, Rang 4 beim Lesen) auch am Dorf ohne Wiki: Die Tafel je Objektart sagt „inoffiziell, Avesmaps“.
            expect(Object.keys(dorf).sort()).toEqual([
                "canon",
                "context",
                "revision",
                "subject",
                "subtitle",
                "target",
                "title",
            ]);
            expect(dorf.canon).toEqual({ canon: "unofficial", designatorLabel: "Avesmaps" });
            expect(dorf.subtitle).toEqual([{ part: "type", key: "dorf" }]);
            // Der Kontext macht es nicht leer: Gebiet, Landschaft, Klima.
            expect(dorf.context?.territories?.chains[0]?.map((entry) => entry.name)).toEqual([
                "P4 Reich",
                "P4 Provinz Ost",
            ]);
            expect(dorf.context?.landscapes?.items.map((item) => item.name)).toEqual(["P4 Waldwildnis"]);
            // Eine stillgelegte Quellenverknüpfung zählt nie: weder Zähler noch Sektion.
            expect(dorf.counts).toBeUndefined();
            expect((await service.sources({ kind: "place", id: P4.dorf }))?.sources).toEqual([]);
        });

        /**
         * Die Wappen der Treppe am echten Lesepfad (WI-0094, Betreiber 2026-10-06: „in legacy sind die wappen als kleine
         * thumbs immer vor den territorien oder siedlungen, die ein wappen haben“): Legacy setzt den Daumen in den Link
         * jeder Stufe (`settlementTerritoryCoatThumbMarkup`, `js/ui/popups.js`) und lässt ihn weg, wo es keinen gibt.
         *
         * 🪤 Das Asset trägt ein EIGENES Quellsystem, nicht `media-test`: Die Medientests räumen ihr Quellsystem ganz ab
         * (`cleanMediaFixtures`), und eine parallele Sitzung an derselben Testdatenbank zöge diesem Fall sonst mitten im
         * Lauf die Zeile weg.
         */
        it("🔴 die Gebietskette trägt die Wappen: nur das Gebiet MIT Wappen hat eines, das ohne hat KEIN Feld", async () => {
            const [reich] = await database<{ id: string }[]>`
                SELECT id FROM territory WHERE public_id = ${P4.reich}::uuid
            `;
            if (!reich) throw new Error("P4 Reich nicht gefunden");
            // Ein Rest aus einem abgebrochenen Lauf hinge sonst am Gebiet und verfälschte den Fall.
            await database`DELETE FROM media_asset WHERE source_system = ${STAMP} AND source_ref = 'wi0094-reich-coat'`;
            const [coat] = await database<{ id: string; public_id: string }[]>`
                INSERT INTO media_asset (media_kind, origin, technical_state, moderation_state, source_system, source_ref)
                VALUES ('image', 'legacy_import', 'ok', 'not_applicable', ${STAMP}, 'wi0094-reich-coat')
                RETURNING id, public_id
            `;
            if (!coat) throw new Error("Wappen-Asset nicht angelegt");
            try {
                await database`
                    INSERT INTO media_rights (media_asset_id, rights_basis, clearance_state)
                    VALUES (${coat.id}, 'public_domain', 'legacy_asserted')
                `;
                await database`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height,
                                            byte_size, sha256, derivative_recipe, recipe_version)
                    VALUES (${coat.id}, ${PUBLISHED_VARIANT.coat}, 'published', ${storageKey("published", COAT_SHA, "webp")},
                            'image/webp', 512, 640, 1234, ${COAT_SHA}, 'coat-recipe', '1')
                `;
                await database`
                    INSERT INTO territory_media (territory_id, media_asset_id, role, origin)
                    VALUES (${reich.id}, ${coat.id}, 'coat', 'wiki_localized')
                `;
                const dorf = await detail({ kind: "place", id: P4.dorf });
                const chain = dorf.context?.territories?.chains[0];
                expect(chain?.map((entry) => entry.name)).toEqual(["P4 Reich", "P4 Provinz Ost"]);
                expect(chain?.[0]?.coat).toMatchObject({
                    id: coat.public_id,
                    role: "coat",
                    width: 512,
                    height: 640,
                    mimeType: "image/webp",
                });
                // Das Gebiet ohne Wappen trägt den Schlüssel nicht - es gibt kein leeres Feld, aus dem ein Loch entstünde.
                expect(chain?.[1] && "coat" in chain[1]).toBe(false);
            } finally {
                await database`DELETE FROM territory_media WHERE media_asset_id = ${coat.id}`;
                await database`DELETE FROM media_file WHERE media_asset_id = ${coat.id}`;
                await database`DELETE FROM media_rights WHERE media_asset_id = ${coat.id}`;
                await database`DELETE FROM media_asset WHERE id = ${coat.id}`;
            }
        });

        it("eine Landschaft ohne Art steht im Kontext ohne Art, nie mit leerem Text", async () => {
            const osten = await detail({ kind: "place", id: P4.dorfOsten });
            const landstrich = osten.context?.landscapes?.items.find((item) => item.name === "P4 Landstrich");
            expect(landstrich).toEqual({
                ref: { kind: "area", id: P4.landstrich },
                name: "P4 Landstrich",
                layer: "derographisch",
            });
            expect(osten.context?.territories?.chains[0]?.map((entry) => entry.name)).toEqual(["P4 Nachbarreich"]);
        });

        it("🔴 ein Dorf mit Handtext: die eigene Beschreibung ist sichtbar (Legacy zeigt sie ohne Artikel ganz), Einwohner verborgen, ohne Wikizeile", async () => {
            const dorf = await detail({ kind: "place", id: P4.dorfHandtext });
            expect(dorf.facts).toEqual([
                {
                    field: "description",
                    value: "Ein Dorf mit Handtext.",
                    provenance: { kind: "editorial" },
                    layer: "direct",
                },
                {
                    field: "einwohner",
                    value: "120",
                    provenance: { kind: "editorial" },
                    layer: "direct",
                    legacyHidden: true,
                },
            ]);
            expect(dorf.wiki).toBeUndefined();
            // Das Panel zeigt nur die Beschreibung, und zwar vollständig (eigener Text, kein Wiki-Satz).
            const shown = visibleFacts("place", dorf.facts, PANEL_LEGACY_ONLY);
            expect(shown.map((fact) => fact.field)).toEqual(["description"]);
            expect(displayDescription("place", shown[0] as SubjectTextFact, PANEL_LEGACY_ONLY).text).toBe(
                "Ein Dorf mit Handtext.",
            );
        });

        it("ein Ort mit bloßer Adresse hat eine Wikizeile, aber keine Wikifelder", async () => {
            const dorf = await detail({ kind: "place", id: P4.dorfAdresse });
            expect(dorf.wiki?.url).toBe("https://de.wiki-aventurica.de/wiki/P4_Dorf_Adresse");
            expect(dorf.wiki?.title).toBeUndefined();
            expect(dorf.facts).toBeUndefined();
        });

        it("🔴 ein verborgener Ort ist ein volles Subject, ein unbekannter keines (WI-0080)", async () => {
            // Betreiber 2026-10-05: „können aber ganz normal angeklickt und bereist werden, wenn sie entdeckt
            // werden“. Entdeckt wird er auf der Karte; danach gilt für sein Panel nichts Besonderes mehr —
            // einschließlich der Quellenbox, die über `sources` geht. Verborgen bleibt er in der Suche und in
            // den Listen anderer Objekte (eigene Fälle weiter unten und in `search.test.ts`).
            const verborgen = await detail({ kind: "place", id: P4.dorfVerborgen });
            expect(verborgen.title).toBe("P4 Dorf Verborgen");
            expect(await service.sources({ kind: "place", id: P4.dorfVerborgen })).not.toBeNull();
            expect(await service.detail({ kind: "place", id: randomUUID() })).toBeNull();
            expect(await service.sources({ kind: "place", id: randomUUID() })).toBeNull();
        });
    });

    describe("Landschaft und Fläche", () => {
        it("🔴 Waldwildnis als reicher Fall: Felder aus dem Wiki mit Provenienz, Nachbarn je Richtung, Synonyme, Gruppe, Kanon", async () => {
            const wald = await detail({ kind: "area", id: P4.wald });
            expect(wald.subject).toEqual({ kind: "area", id: P4.wald });
            expect(wald.title).toBe("P4 Waldwildnis");
            expect(wald.subtitle).toEqual([
                { part: "type", key: "wald" },
                { part: "layer", key: "vegetation" },
            ]);
            expect(wald.facts?.map((fact) => fact.field)).toEqual([
                "description",
                "continent",
                "regionParent",
                "affiliationStaat",
                "einwohner",
                "sprache",
                "vegetation",
                "verkehrswege",
                "neighbors",
                "neighbors",
                "synonyms",
            ]);
            expect(field(wald, "neighbors", "O")).toMatchObject({ values: ["Ostland", "Ostmark"] });
            expect(field(wald, "neighbors", "N")).toMatchObject({ values: ["Nordland"] });
            expect(field(wald, "synonyms")).toMatchObject({ values: ["Alter Wald"], provenance: { kind: "wiki" } });
            // 🔴 Wie Legacy (27.8): Kontinent, Verkehrswege, Nachbarn und Synonyme sind verborgen, der Rest ist sichtbar.
            expect(hiddenFields(wald)).toEqual(["continent", "verkehrswege", "neighbors", "neighbors", "synonyms"]);
            expect(visibleFacts("area", wald.facts, PANEL_LEGACY_ONLY).map((fact) => fact.field)).toEqual([
                "description",
                "regionParent",
                "affiliationStaat",
                "einwohner",
                "sprache",
                "vegetation",
            ]);
            expect(wald.canon).toEqual({
                canon: "unofficial",
                designatorType: "briefspiel",
                designatorCount: 2,
                designatorLabel: "Wiki Aventurica",
            });
            // Die Fläche selbst ist der Gegenstand: ihr Ausschnitt ist das Sprungziel.
            expect(wald.target?.bounds).toEqual([106, 106, 145, 135]);
        });

        it("🔴 Kontext einer Fläche mit Anteilen: überlappt zwei Provinzen, liegt ganz im Reich", async () => {
            const wald = await detail({ kind: "area", id: P4.wald });
            const territories = wald.context?.territories;
            expect(territories?.relation).toBe("overlaps");
            // Zwei Ketten bis zum innersten Gebiet, die Reichsebene deckt die Fläche ganz.
            const leaves = territories?.chains.map((chain) => chain[chain.length - 1]?.name);
            expect(leaves).toContain("P4 Provinz Ost");
            expect(leaves).toContain("P4 Grafschaft");
            for (const chain of territories?.chains ?? []) {
                expect(chain[0]).toMatchObject({ name: "P4 Reich", share: 1 });
                const leaf = chain[chain.length - 1];
                expect(leaf?.share).toBeGreaterThan(0.01);
                expect(leaf?.share).toBeLessThan(0.99);
            }
            // Der See liegt im Wald: überlappende Landschaft mit ihrem Anteil an der Waldfläche.
            expect(wald.context?.landscapes?.items.find((item) => item.name === "P4 Testsee")).toMatchObject({
                type: "see",
                share: expect.any(Number),
            });
        });

        it("🔴 der Hügel ohne eigene Detaildaten ist keine leere Box: Art, Ebene und Kontext der ganzen Fläche", async () => {
            const huegel = await detail({ kind: "area", id: P4.huegel });
            expect(huegel.title).toBe("P4 Hügel der Brinaskquelle");
            expect(huegel.facts).toBeUndefined();
            expect(huegel.wiki).toBeUndefined();
            expect(huegel.counts).toBeUndefined();
            // Ganz in der Grafschaft: „liegt in“ mit der Kette Reich, Provinz, Grafschaft.
            expect(huegel.context?.territories).toMatchObject({ relation: "lies_in" });
            expect(huegel.context?.territories?.chains[0]?.map((entry) => entry.name)).toEqual([
                "P4 Reich",
                "P4 Provinz West",
                "P4 Grafschaft",
            ]);
            // Zur Hälfte im Wald: übergeordnete oder überlappende Landschaft einer anderen Ebene, mit Anteil.
            expect(huegel.context?.landscapes).toMatchObject({
                relation: "overlaps",
                items: [{ name: "P4 Waldwildnis", layer: "vegetation", share: expect.closeTo(0.5625, 2) }],
            });
            expect(huegel.context?.climate?.items[0]).toMatchObject({ share: 1 });
        });

        it("🔴 ein See ist keine leere Box: Kontext aus Gebiet und Landschaft", async () => {
            const see = await detail({ kind: "area", id: P4.see });
            expect(see.subtitle).toEqual([
                { part: "type", key: "see" },
                { part: "layer", key: "topographie" },
            ]);
            expect(see.context?.territories?.chains[0]?.map((entry) => entry.name)).toEqual([
                "P4 Reich",
                "P4 Provinz Ost",
            ]);
            expect(see.context?.landscapes?.items[0]).toMatchObject({ name: "P4 Waldwildnis", share: 1 });
            expect(see.target?.bounds).toEqual([135, 125, 145, 135]);
        });

        it("🔴 gleichnamige Regionen gleicher Art und Ebene sind EIN Subject, gleich von welcher Kennung man kommt", async () => {
            const vonA = await detail({ kind: "area", id: P4.archipelA });
            const vonB = await detail({ kind: "area", id: P4.archipelB });
            expect(vonA.subject).toEqual({ kind: "area", id: P4.archipelA, group: [P4.archipelB] });
            expect(vonB.subject).toEqual(vonA.subject);
            expect(subjectKey(vonA.subject)).toBe(subjectKey(vonB.subject));
            // Der Ausschnitt umfasst alle Flächen der Gruppe.
            expect(vonA.target?.bounds).toEqual([100, 170, 114, 174]);
        });

        it("eine Fläche, die nur einen Griff trägt, hat keinen Titel: die Oberfläche zeigt die Art", async () => {
            const griff = await detail({ kind: "area", id: P4.griff });
            expect(griff.title).toBeUndefined();
            expect(griff.subtitle?.[0]).toEqual({ part: "type", key: "wald" });
        });

        it("💣 eine ungültige Fläche aus Legacy wirft keine Ausnahme, auch nicht im Kontext eines Wegs", async () => {
            const schleife = await detail({ kind: "area", id: P4.schleife });
            expect(schleife.title).toBe("P4 Schleife");
            expect(schleife.context?.territories).toBeDefined();
        });

        it("die Auswahl der Landschaft kommt über die Region, nie über eine Beschriftung", async () => {
            // Die Kennung der Beschriftung ist keine Region: kein Subject.
            expect(await service.detail({ kind: "area", id: P4.labelWald })).toBeNull();
        });
    });

    describe("Weg als Gruppe", () => {
        it("🔴 ein Fluss ist die Gruppe seiner Abschnitte: kanonischer Anker, Wiki-Schlüssel, ganzer Verlauf als Kontext", async () => {
            const fluss = await detail({ kind: "path", anchor: P4.flussZwei });
            // Der kanonische Anker ist der kleinste Abschnitt, gleich von welchem Abschnitt man kommt.
            expect(fluss.subject).toEqual({ kind: "path", anchor: P4.flussEins, wiki: "p4t-grossfluss" });
            expect((await detail({ kind: "path", anchor: P4.flussDrei })).subject).toEqual(fluss.subject);
            expect(fluss.title).toBe("P4 Großfluss");
            expect(fluss.subtitle).toEqual([{ part: "type", key: "Flussweg" }]);
            expect(fluss.facts?.map((fact) => fact.field)).toEqual(["description", "art", "lage", "laenge", "verlauf"]);
            expect(fluss.wiki?.title).toBe("P4 Großfluss");
            expect(fluss.target).toMatchObject({ bounds: [105, 108, 175, 108], x: 140, y: 108 });
            // Der ganze Fluss, nicht der angeklickte Abschnitt: Gebiete in der Reihenfolge des ersten Eintritts, je innerstem Gebiet eine Kette.
            expect(fluss.context?.territories?.relation).toBe("runs_through");
            expect(fluss.context?.territories?.chains.map((chain) => chain.map((entry) => entry.name))).toEqual([
                ["P4 Reich", "P4 Provinz West", "P4 Grafschaft"],
                ["P4 Reich", "P4 Provinz Ost"],
                ["P4 Nachbarreich"],
            ]);
            expect(fluss.context?.landscapes?.relation).toBe("runs_through");
            expect(fluss.context?.landscapes?.items.map((item) => item.name)).toContain("P4 Waldwildnis");
            expect(fluss.canon).toEqual({ canon: "unlabelled" });
        });

        it("🔴 Tunnel (WI-0177, Migration 0172): hinter dem Wegtyp; „mit Tunnel“, wenn nur ein Teil der Abschnitte", async () => {
            const alle = [P4.flussEins, P4.flussZwei, P4.flussDrei];
            try {
                await database`UPDATE path SET is_tunnel = TRUE WHERE public_id = ${P4.flussZwei}::uuid`;
                const teil = await createSubjectService(database).detail({ kind: "path", anchor: P4.flussEins });
                expect(teil?.subtitle).toEqual([
                    { part: "type", key: "Flussweg" },
                    { part: "tunnel", partial: true },
                ]);
                await database`UPDATE path SET is_tunnel = TRUE WHERE public_id = ANY(${alle}::uuid[])`;
                const ganz = await createSubjectService(database).detail({ kind: "path", anchor: P4.flussEins });
                expect(ganz?.subtitle).toEqual([{ part: "type", key: "Flussweg" }, { part: "tunnel" }]);
                expect(Value.Check(SubjectDetail, ganz)).toBe(true);
            } finally {
                await database`UPDATE path SET is_tunnel = FALSE WHERE public_id = ANY(${alle}::uuid[])`;
            }
        });

        it("🔴 Karawanenroute (WI-0177 §30, Migration 0174): das Kennzeichen vor dem Wegtyp; „teils“, wenn nur ein Teil der Abschnitte", async () => {
            // Der Leser fragt nur das Kennzeichen; dass es nur Landwege tragen, hält der Schreibweg (`path.update`).
            const alle = [P4.flussEins, P4.flussZwei, P4.flussDrei];
            try {
                await database`UPDATE path SET mark = 'karawanenroute' WHERE public_id = ${P4.flussZwei}::uuid`;
                const teil = await createSubjectService(database).detail({ kind: "path", anchor: P4.flussEins });
                expect(teil?.subtitle).toEqual([
                    { part: "mark", key: "karawanenroute", partial: true },
                    { part: "type", key: "Flussweg" },
                ]);
                await database`UPDATE path SET mark = 'karawanenroute' WHERE public_id = ANY(${alle}::uuid[])`;
                const ganz = await createSubjectService(database).detail({ kind: "path", anchor: P4.flussEins });
                expect(ganz?.subtitle).toEqual([
                    { part: "mark", key: "karawanenroute" },
                    { part: "type", key: "Flussweg" },
                ]);
                expect(Value.Check(SubjectDetail, ganz)).toBe(true);
            } finally {
                await database`UPDATE path SET mark = NULL WHERE public_id = ANY(${alle}::uuid[])`;
            }
        });

        it("🔴 die Kette der Suche (`name:<Name>`, WI-0177 Schritt 2b) führt auf dieselbe Gruppe wie ein Abschnitt; eine alte Kette `Name:Wegtyp` gilt dem Namen", async () => {
            const byChain = await detail({ kind: "path", chain: pathChainKey("P4 Großfluss") });
            const byAnchor = await detail({ kind: "path", anchor: P4.flussDrei });
            expect(byChain.subject).toEqual(byAnchor.subject);
            // Alte Links: der Name zählt, der Wegtyp trennt nicht mehr.
            expect((await detail({ kind: "path", chain: "P4 Großfluss:Flussweg" })).subject).toEqual(byAnchor.subject);
            expect((await detail({ kind: "path", chain: "P4 Großfluss:Strasse" })).subject).toEqual(byAnchor.subject);
            expect(await service.detail({ kind: "path", chain: "keine Kette" })).toBeNull();
            expect(await service.detail({ kind: "path", chain: pathChainKey("Gibt es nicht") })).toBeNull();
        });

        it("🔴 ein Segment mit weiterer Zuweisung gehört zu zwei Wegen: die Hauptzuweisung ist der Vorgabewert, der Hinweis wählt den anderen", async () => {
            const haupt = await detail({ kind: "path", anchor: P4.strasseEins });
            expect(haupt.subject).toEqual({ kind: "path", anchor: P4.strasseEins, wiki: "p4t-strasse-eins" });
            expect(haupt.title).toBe("P4 Strasse Eins");
            const weiter = await detail({ kind: "path", anchor: P4.strasseEins, wiki: "p4t-nur-weiter" });
            expect(weiter.subject).toEqual({ kind: "path", anchor: P4.strasseEins, wiki: "p4t-nur-weiter" });
            // Ein schlanker Schnappschuss kennt nur Name und Art; der Weg heißt nach seinem echten Namen, nicht nach dem Artikel.
            expect(weiter.facts?.map((fact) => fact.field)).toEqual(["art"]);
            expect(subjectKey(weiter.subject)).not.toBe(subjectKey(haupt.subject));
            // Ein unbekannter Hinweis fällt auf die Hauptzuweisung zurück.
            expect((await detail({ kind: "path", anchor: P4.strasseEins, wiki: "gibt-es-nicht" })).subject).toEqual(
                haupt.subject,
            );
        });

        it("🔴 ohne Zuordnung bildet der echte Name die Gruppe, über Wegarten hinweg (WI-0177 Schritt 2b, Legacys Regel (c))", async () => {
            const waldweg = await detail({ kind: "path", anchor: P4.waldwegZwei });
            expect(waldweg.subject).toEqual({ kind: "path", anchor: P4.waldwegEins });
            expect(waldweg.title).toBe("P4 Waldweg");
            expect(waldweg.facts).toBeUndefined();
            expect(waldweg.wiki).toBeUndefined();
            const pfad = await detail({ kind: "path", anchor: P4.waldwegPfad });
            expect(pfad.subject).toEqual(waldweg.subject);
            expect(pfad.title).toBe("P4 Waldweg");
        });

        it("🔴 ein Seeweg gleichen Namens gehört nicht zum Weg (Besucher sehen keine Seewege; Gegenlesen Kamera/Wiki-Feld zu Schritt 2b)", async () => {
            try {
                await database`UPDATE path SET subtype = 'Seeweg' WHERE public_id = ${P4.waldwegPfad}::uuid`;
                const fresh = createSubjectService(database);
                const waldweg = await fresh.detail({ kind: "path", anchor: P4.waldwegZwei });
                expect(waldweg?.subject).toEqual({ kind: "path", anchor: P4.waldwegEins });
                expect(JSON.stringify(waldweg?.subtitle)).not.toContain("Seeweg");
                // Die Kette des Namens meint den Landweg; der Seeweg ist sein eigener Gegenstand.
                expect((await fresh.detail({ kind: "path", chain: pathChainKey("P4 Waldweg") }))?.subject).toEqual(
                    waldweg?.subject,
                );
                expect((await fresh.detail({ kind: "path", anchor: P4.waldwegPfad }))?.subject).toEqual({
                    kind: "path",
                    anchor: P4.waldwegPfad,
                });
            } finally {
                await database`UPDATE path SET subtype = 'Pfad' WHERE public_id = ${P4.waldwegPfad}::uuid`;
            }
        });

        it("ein Abschnitt ohne echten Namen und ohne Zuordnung ist das Einzelsegment, ohne Titel", async () => {
            const einzel = await detail({ kind: "path", anchor: P4.einzel });
            expect(einzel.subject).toEqual({ kind: "path", anchor: P4.einzel });
            expect(einzel.title).toBeUndefined();
        });

        it("ein Weg mit bloßer Adresse trägt eine Wikizeile ohne Schnappschuss", async () => {
            const jennbach = await detail({ kind: "path", anchor: P4.jennbach });
            expect(jennbach.wiki?.url).toBe("https://de.wiki-aventurica.de/wiki/P4_Jennbach");
            expect(jennbach.facts).toBeUndefined();
        });

        it("🔴 ein Fluss, der nur zum Teil einem Artikel zugeordnet ist: die Kette meint den ganzen Fluss, der Abschnitt seine Gruppe", async () => {
            // Der kleinste Abschnitt trägt keine Zuordnung und bildet allein eine Namensgruppe; zwei tragen den Artikel.
            const abschnitt = await detail({ kind: "path", anchor: P4.mischEins });
            expect(abschnitt.subject).toEqual({ kind: "path", anchor: P4.mischEins });
            expect(abschnitt.facts).toBeUndefined();
            // Die Kette der Suche nimmt die Gruppe mit den meisten Abschnitten: den Wiki-Weg samt Artikel.
            const kette = await detail({ kind: "path", chain: "P4 Mischfluss:Flussweg" });
            expect(kette.subject).toEqual({ kind: "path", anchor: P4.mischZwei, wiki: "p4t-mischfluss" });
            expect(field(kette, "description")?.["value"]).toBe("Ein Fluss mit Lücke.");
        });

        it("ein unbekannter Abschnitt ist kein Subject", async () => {
            expect(await service.detail({ kind: "path", anchor: randomUUID() })).toBeNull();
        });
    });

    describe("Gebiet, Gipfel, Kraftlinie", () => {
        it("🔴 ein Gebiet mit Kette: Obergebiete über den Baum, Hauptstadt als Verweis, Kanon", async () => {
            const grafschaft = await detail({ kind: "territory", id: P4.grafschaft });
            expect(grafschaft.title).toBe("P4 Grafschaft");
            expect(grafschaft.subtitle).toEqual([{ part: "kind", text: "Grafschaft" }]);
            expect(grafschaft.context?.territories?.chains).toEqual([
                [
                    { ref: { kind: "territory", id: P4.reich }, name: "P4 Reich", type: "Kaiserreich" },
                    { ref: { kind: "territory", id: P4.provinzWest }, name: "P4 Provinz West", type: "Provinz" },
                ],
            ]);
            expect(grafschaft.target?.bounds).toEqual([100, 100, 120, 120]);

            const reich = await detail({ kind: "territory", id: P4.reich });
            // Ein Reich hat keine Obergebiete; sein Kontext ist das Klima seiner Form (WI-0063 P7, Legacy `climate_zones`).
            expect(reich.context?.territories).toBeUndefined();
            expect(reich.context?.climate?.items[0]).toMatchObject({ band: "tropisch", share: 1 });
            expect(field(reich, "capital")).toEqual({
                field: "capital",
                value: "P4 Gareth",
                ref: { kind: "place", id: P4.gareth },
                provenance: { kind: "editorial" },
            });
            expect(field(reich, "status")?.["value"]).toBe("Kaiserreich");
            expect(field(reich, "validity")?.["value"]).toBe("seit 100 BF");
            expect(reich.canon).toEqual({ canon: "official" });
            expect(await service.detail({ kind: "territory", id: randomUUID() })).toBeNull();
        });

        it("🔴 ein Gipfel: Wiki-Text, Kontext am Punkt, Quellen und Kanon des Gipfels selbst", async () => {
            const gipfel = await detail({ kind: "peak", id: P4.gipfel });
            expect(gipfel.title).toBe("P4 Gipfel");
            expect(gipfel.subtitle).toEqual([{ part: "type", key: "berggipfel" }]);
            expect(field(gipfel, "description")?.["value"]).toBe("Ein hoher Gipfel.");
            expect(gipfel.wiki?.title).toBe("P4 Gipfel");
            expect(gipfel.counts).toEqual({ sources: 1 });
            expect(gipfel.context?.territories?.chains[0]?.map((entry) => entry.name)).toEqual([
                "P4 Reich",
                "P4 Provinz West",
                "P4 Grafschaft",
            ]);
            // Ein Vulkan ohne Wiki bleibt knapp.
            const vulkan = await detail({ kind: "peak", id: P4.gipfelFrei });
            expect(vulkan.subtitle).toEqual([{ part: "type", key: "vulkan" }]);
            expect(vulkan.facts).toBeUndefined();
        });

        it("🔴 eine Kraftlinie ist die Gruppe ihrer Segmente: mit Nest alle Segmente des Artikels, sonst alle gleichen Namens", async () => {
            const mitNest = await detail({ kind: "powerline", id: P4.linieZwei });
            expect(mitNest.subject).toEqual({ kind: "powerline", anchor: P4.linieEins });
            expect(mitNest.title).toBe("P4 Kraftlinie");
            expect(mitNest.facts?.map((fact) => fact.field)).toEqual([
                "description",
                "staerke",
                "affinitaet",
                "laenge",
                "regionen",
                "verlauf",
            ]);
            // 🔴 Wie Legacy (27.8): der Verlauf ist verborgen, die Beschreibung steht voll da (ohne ersten Satz).
            expect(hiddenFields(mitNest)).toEqual(["verlauf"]);
            expect(visibleFacts("powerline", mitNest.facts, PANEL_LEGACY_ONLY).map((fact) => fact.field)).toEqual([
                "description",
                "staerke",
                "affinitaet",
                "laenge",
                "regionen",
            ]);
            expect(field(mitNest, "description")?.["value"]).toBe("Eine Kraftlinie.");
            // Das Nest der Kraftlinie trägt keinen Stempel.
            expect(field(mitNest, "staerke")?.["provenance"]).toEqual({
                kind: "wiki",
                wikiUrl: "https://de.wiki-aventurica.de/wiki/P4_Kraftlinie",
            });
            expect(mitNest.target?.bounds).toEqual([101, 101, 121, 121]);
            expect(mitNest.context?.territories?.relation).toBe("runs_through");
            expect(mitNest.canon).toEqual({ canon: "official" });
            // Ohne Nest bilden die Segmente gleichen Namens die Gruppe.
            const nachName = await detail({ kind: "powerline", id: P4.linieVier });
            expect(nachName.subject).toEqual({ kind: "powerline", anchor: P4.linieDrei });
            expect(nachName.target?.bounds).toEqual([131, 131, 151, 151]);
            expect(nachName.facts).toBeUndefined();
            // Ein einzelnes Segment bleibt allein.
            expect((await detail({ kind: "powerline", id: P4.linieEinzel })).subject).toEqual({
                kind: "powerline",
                anchor: P4.linieEinzel,
            });
            expect(await service.detail({ kind: "powerline", id: randomUUID() })).toBeNull();
        });
    });

    describe("Freie Kartenstelle (mapPoint)", () => {
        it("🔴 an Land: Gebietskette, Landschaften aller Ebenen, Klima und Flüsse im Umkreis; auf 0,01 gerundet", async () => {
            const punkt = await service.mapPoint(110.004, 110);
            expect(Value.Check(MapPointDetail, punkt)).toBe(true);
            expectNoEmptyParts(punkt);
            expect(punkt.subject).toEqual({ kind: "mapPoint", x: 110, y: 110 });
            expect(punkt.context?.territories?.relation).toBe("at_point");
            expect(punkt.context?.territories?.chains[0]?.map((entry) => entry.name)).toEqual([
                "P4 Reich",
                "P4 Provinz West",
                "P4 Grafschaft",
            ]);
            // Die kleinste Fläche zuerst, alle Ebenen: der Hügel (Topographie) vor dem Wald (Vegetation).
            expect(punkt.context?.landscapes?.items.map((item) => [item.name, item.layer])).toEqual([
                ["P4 Hügel der Brinaskquelle", "topographie"],
                ["P4 Waldwildnis", "vegetation"],
            ]);
            expect(punkt.context?.climate?.items).toHaveLength(1);
            expect(punkt.context?.rivers).toEqual([
                {
                    ref: { kind: "path", chain: "name:P4 Großfluss" },
                    name: "P4 Großfluss",
                    subtype: "Flussweg",
                    isBach: false,
                    // Der Abstand zum Fluss bei y = 108: die Oberfläche entscheidet je Zoom, ob er noch „hier“ ist.
                    distance: 2,
                },
            ]);
            // Dieselbe Hundertstel ist derselbe Subject, dieselbe Antwort.
            expect(await service.mapPoint(110.0049, 109.996)).toEqual(punkt);
        });

        it("🔴 im Meer: die Meeresfläche und das Klima, kein Gebiet, kein Fluss", async () => {
            const meer = await service.mapPoint(140, 180);
            expectNoEmptyParts(meer);
            expect(meer.context?.territories).toBeUndefined();
            expect(meer.context?.rivers).toBeUndefined();
            expect(meer.context?.landscapes?.items.map((item) => [item.name, item.type])).toEqual([
                ["P4 Meer", "meer"],
            ]);
            expect(meer.context?.climate?.items.length).toBeGreaterThan(0);
        });

        /**
         * 🔴 Nur die aktive Ansicht (Nachtrag zu WI-0083, Betreiber 2026-10-05 „ja“): Was der lange Druck nennt, passt zu
         * dem, was ein Klick in derselben Ansicht trifft. Die Liste kommt vom Client aus derselben Tafel wie die
         * Karteninteraktion (`areaLayersInView`); hier wird nur gefiltert, nie entschieden.
         */
        describe("nur die aktive Ansicht", () => {
            it("🔴 Vegetation: der Wald bleibt, der Hügel der Topographie fällt weg - und der Fluss mit dem Wasser", async () => {
                const punkt = await service.mapPoint(110, 110, ["vegetation"]);
                expect(Value.Check(MapPointDetail, punkt)).toBe(true);
                expectNoEmptyParts(punkt);
                expect(punkt.subject).toEqual({ kind: "mapPoint", x: 110, y: 110, layers: ["vegetation"] });
                expect(punkt.context?.landscapes?.items.map((item) => item.name)).toEqual(["P4 Waldwildnis"]);
                // Ein Fluss ist Wasser und hängt an der Ebene des Wassers: in der Vegetation nennt ihn niemand.
                expect(punkt.context?.rivers).toBeUndefined();
                // Gebietskette und Klima sind keine Landschaftsebenen und bleiben.
                expect(punkt.context?.territories?.chains).toHaveLength(1);
                expect(punkt.context?.climate?.items).toHaveLength(1);
            });

            it("🔴 Topographie: der Hügel bleibt, der Wald fällt weg, der Fluss bleibt (das Wasser ist hier zu Hause)", async () => {
                const punkt = await service.mapPoint(110, 110, ["topographie"]);
                expect(punkt.context?.landscapes?.items.map((item) => item.name)).toEqual([
                    "P4 Hügel der Brinaskquelle",
                ]);
                expect(punkt.context?.rivers?.map((river) => river.name)).toEqual(["P4 Großfluss"]);
            });

            it("🔴 „Alle“: alle drei Ebenen, wie ohne Angabe", async () => {
                const alle = await service.mapPoint(110, 110, [...layersOfSelection("alle")]);
                const ohne = await service.mapPoint(110, 110);
                expect(alle.context?.landscapes).toEqual(ohne.context?.landscapes);
                expect(alle.context?.rivers).toEqual(ohne.context?.rivers);
            });

            it("🔴 Klimazonen: keine Landschaft und kein Fluss - dort ist nur das Band wählbar", async () => {
                const punkt = await service.mapPoint(110, 110, [...layersOfSelection("klima")]);
                expectNoEmptyParts(punkt);
                expect(punkt.context?.landscapes).toBeUndefined();
                expect(punkt.context?.rivers).toBeUndefined();
                expect(punkt.context?.climate?.items).toHaveLength(1);
            });

            it("🔴 das Meer nennt in der Vegetation niemand mehr, in der Topographie schon", async () => {
                // Der Befund des Betreibers: „auch mit dem Meer, während die Vegetation gewählt ist“.
                expect((await service.mapPoint(140, 180, ["vegetation"])).context?.landscapes).toBeUndefined();
                expect(
                    (await service.mapPoint(140, 180, ["topographie"])).context?.landscapes?.items.map(
                        (item) => item.type,
                    ),
                ).toEqual(["meer"]);
            });

            it("🪤 ohne Angabe bleibt alles, wie es war: alle Ebenen und die Flüsse", async () => {
                const punkt = await service.mapPoint(110, 110);
                expect(punkt.subject).toEqual({ kind: "mapPoint", x: 110, y: 110 });
                expect(punkt.context?.landscapes?.items.map((item) => item.layer)).toEqual([
                    "topographie",
                    "vegetation",
                ]);
                expect(punkt.context?.rivers).toHaveLength(1);
            });
        });

        it("an einer Stelle ohne alles bleibt es bei dem Punkt, ohne leeren Kontext", async () => {
            const nichts = await service.mapPoint(1000, 1000);
            expect(nichts.context?.landscapes).toBeUndefined();
            expect(nichts.context?.territories).toBeUndefined();
            expect(nichts.subject).toEqual({ kind: "mapPoint", x: 1000, y: 1000 });
        });
    });

    describe("Gebiete ohne gültige Ableitung", () => {
        it("🔴 ohne Ableitung keine Gebiete im Kontext und kein Sprungziel aus alten Formen, statt alter", async () => {
            const [state] = await database<{ derived_revision: string }[]>`
                SELECT derived_revision FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN} AND source_stamp = ${STAMP}
            `;
            expect(state?.derived_revision).toMatch(/^[0-9a-f]{12}$/);
            try {
                // Ein Import entwertet die Ableitung (WI-0062): die Formen bleiben stehen, gelten aber nicht mehr.
                await database`UPDATE territory_state SET derived_revision = NULL WHERE map_domain_id = ${MAP_DOMAIN} AND source_stamp = ${STAMP}`;
                const fresh = createSubjectService(database);
                const gareth = await fresh.detail({ kind: "place", id: P4.gareth });
                expect(gareth?.context?.territories).toBeUndefined();
                expect(gareth?.context?.landscapes).toBeDefined();
                const wald = await fresh.detail({ kind: "area", id: P4.wald });
                expect(wald?.context?.territories).toBeUndefined();
                const fluss = await fresh.detail({ kind: "path", anchor: P4.flussEins });
                expect(fluss?.context?.territories).toBeUndefined();
                expect((await fresh.mapPoint(110, 110)).context?.territories).toBeUndefined();
                const reich = await fresh.detail({ kind: "territory", id: P4.reich });
                expect(reich?.title).toBe("P4 Reich");
                expect(reich?.target).toBeUndefined();
            } finally {
                await database`
                    UPDATE territory_state SET derived_revision = ${state?.derived_revision ?? null}
                    WHERE map_domain_id = ${MAP_DOMAIN} AND source_stamp = ${STAMP}
                `;
            }
        });
    });

    describe("Quellen: nie vererbt", () => {
        it("🔴 jedes Subject zählt nur seine eigenen Quellen, nie die der Umgebung", async () => {
            // Gareth liegt in der Provinz West (eine Quelle), im Wald (eine Quelle) und trägt drei eigene.
            expect((await detail({ kind: "place", id: P4.gareth })).counts).toEqual({ sources: 3 });
            expect((await detail({ kind: "territory", id: P4.provinzWest })).counts).toEqual({ sources: 1 });
            expect((await detail({ kind: "territory", id: P4.grafschaft })).counts).toBeUndefined();
            expect((await detail({ kind: "territory", id: P4.reich })).counts).toBeUndefined();
            expect((await detail({ kind: "area", id: P4.wald })).counts).toEqual({ sources: 1 });
            expect((await detail({ kind: "area", id: P4.huegel })).counts).toBeUndefined();
            expect((await detail({ kind: "place", id: P4.dorf })).counts).toBeUndefined();
            expect((await detail({ kind: "powerline", id: P4.linieEins })).counts).toBeUndefined();
        });

        it("🔴 ein Weg liest die Vereinigung der Quellen seiner Abschnitte, jede Quelle einmal", async () => {
            const fluss = await detail({ kind: "path", anchor: P4.flussEins });
            expect(fluss.counts).toEqual({ sources: 3 });
            const section = await service.sources({ kind: "path", anchor: P4.flussDrei });
            expect(Value.Check(SubjectSourcesSection, section)).toBe(true);
            expect(section?.subject).toEqual(fluss.subject);
            expect(section?.sources.map((source) => source.title)).toEqual([
                "P4T Quelle Eins",
                "P4T Quelle Zwei",
                "P4T Quelle Drei",
            ]);
        });

        it("🔴 die Sektion nennt Titel, Art, Seiten, Notiz, Lizenz und Namensnennung getrennt, in Legacys Reihenfolge, ohne interne Felder", async () => {
            const section = await service.sources({ kind: "place", id: P4.gareth });
            expect(Value.Check(SubjectSourcesSection, section)).toBe(true);
            expectNoEmptyParts(section);
            expect(section?.sources).toEqual([
                {
                    title: "P4T Quelle Eins",
                    url: "https://p4test.example/eins",
                    type: "regionalspielhilfe",
                    official: true,
                    pages: "S. 12",
                    note: "Hauptstadt",
                    license: {
                        statement: "license",
                        name: "CC BY-NC-SA 3.0",
                        uri: "https://creativecommons.org/licenses/by-nc-sa/3.0/",
                    },
                    attribution: "Autor Eins",
                    corpus: { key: "p4test.example", label: "P4 Testkorpus" },
                },
                // Eine Quelle ohne Adresse und ohne erfasste Lizenz: diese Felder fehlen, statt leer zu erscheinen.
                { title: "P4T Quelle Zwei", type: "briefspiel", official: false, referenceKind: "ausfuehrlich" },
                {
                    title: "P4T Quelle Drei",
                    url: "https://p4test.example/drei",
                    type: "abenteuer",
                    official: false,
                    referenceKind: "erwaehnung",
                    pages: "S. 3",
                },
            ]);
            const text = JSON.stringify(section);
            for (const internal of [
                "source_key",
                "sourceKey",
                "legacy-id",
                "url:",
                "provisional",
                "legacyOrigin",
                "unrecorded",
            ]) {
                expect(text, internal).not.toContain(internal);
            }
        });

        it("eine Kraftlinie hat keine Quellen: die Sektion ist leer, nie ein Fehler", async () => {
            expect((await service.sources({ kind: "powerline", id: P4.linieEins }))?.sources).toEqual([]);
            expect(await service.sources({ kind: "territory", id: randomUUID() })).toBeNull();
        });
    });

    describe("Medien", () => {
        it("🔴 keine private Medienspalte in der Antwort: Prompt, Notiz, Beleg, Login, Speicherschlüssel, Prüfzustand", async () => {
            await database`
                UPDATE media_rights SET rights_note = 'RECHTENOTIZ-GEHEIM-P4', legacy_rights_code = 'CODE-GEHEIM-P4',
                                        reviewed_by = 'PRUEFER-GEHEIM-P4'
                WHERE media_asset_id IN (SELECT id FROM media_asset WHERE source_system = 'media-test')
            `;
            await database`UPDATE media_asset SET ingest_actor_legacy = 'LOGIN-GEHEIM-P4' WHERE source_system = 'media-test'`;
            await database`
                INSERT INTO media_creation (media_asset_id, tool, model, prompt, negative_prompt, parameters, legacy_note_raw)
                SELECT id, 'WERKZEUG-GEHEIM-P4', 'MODELL-GEHEIM-P4', 'PROMPT-GEHEIM-P4', 'NEGATIV-GEHEIM-P4', '{"seed": "SEED-GEHEIM-P4"}'::jsonb,
                       'NOTIZ-GEHEIM-P4'
                FROM media_asset WHERE source_system = 'media-test'
            `;
            const text = JSON.stringify(await detail({ kind: "place", id: P4.gareth }));
            expect(text).toContain("/media/sha256/");
            for (const secret of ["GEHEIM", "storage", "published/", "clearance", "ingest", "prompt", 'sha256":']) {
                expect(text, secret).not.toContain(secret);
            }
        });
    });

    describe("Objektlinks", () => {
        it("🔴 Ort und Gebiet gleichen Schlüssels (Fasar): `siedlung` öffnet den Ort, `staat` das Gebiet, `region` das Gebiet", async () => {
            expect(await link("siedlung", "P4_Fasar")).toEqual({
                ref: { kind: "place", id: P4.fasarOrt },
                param: "siedlung",
                via: "wiki",
            });
            expect(await link("staat", "P4_Fasar")).toEqual({
                ref: { kind: "territory", id: P4.fasarGebiet },
                param: "staat",
                via: "wiki",
            });
            expect(await link("region", "P4_Fasar")).toMatchObject({ ref: { kind: "territory", id: P4.fasarGebiet } });
        });

        it("der Schlüssel ist Legacys: Prozentkodierung, Unterstrich, Groß- und Kleinschreibung und Umlaute spielen keine Rolle", async () => {
            for (const value of ["p4_fasar", "P4%5FFasar", "P4+Fasar", " P4 Fasar ", "P4-Fasar"]) {
                expect(await link("siedlung", value), value).toMatchObject({ ref: { kind: "place", id: P4.fasarOrt } });
            }
            expect(await link("siedlung", "P4_Fasar_(Stadt)")).not.toMatchObject({
                ref: { kind: "place", id: P4.fasarOrt },
                via: "wiki",
            });
        });

        it("🔴 zwei Orte mit derselben Adresse sind eine Auswahl, nie ein stiller Griff (Rathila)", async () => {
            const result = await link("siedlung", "P4_Rathila");
            expect(result).toMatchObject({ param: "siedlung", via: "wiki" });
            expect("candidates" in result && result.candidates.map((entry) => entry.ref)).toEqual([
                { kind: "place", id: P4.zwillingA },
                { kind: "place", id: P4.zwillingB },
            ]);
            expect("candidates" in result && result.candidates.map((entry) => entry.title)).toEqual([
                "P4 Zwilling A",
                "P4 Zwilling B",
            ]);
        });

        it("🔴 Landschaften: eine Gruppe gleichen Namens ist ein Treffer, verschiedene Landschaften mit derselben Adresse sind eine Auswahl", async () => {
            expect(await link("region", "P4_Archipel")).toEqual({
                ref: { kind: "area", id: P4.archipelA, group: [P4.archipelB] },
                param: "region",
                via: "wiki",
            });
            const wald = await link("region", "P4_Waldwildnis");
            expect("candidates" in wald && wald.candidates.map((entry) => entry.title)).toEqual([
                "P4 Nordwald",
                "P4 Waldwildnis",
            ]);
            // `siedlung` sucht die Landschaft nach Ort und Gebiet, wenn kein Ort diese Adresse trägt.
            expect(await link("siedlung", "P4_Archipel")).toMatchObject({ ref: { kind: "area" } });
        });

        it("Gipfel: die Adresse des Gipfels öffnet den Gipfel", async () => {
            expect(await link("siedlung", "P4_Gipfel")).toEqual({
                ref: { kind: "peak", id: P4.gipfel },
                param: "siedlung",
                via: "wiki",
            });
        });

        it("🔴 Wege: ein Artikel öffnet den GANZEN Weg (die Gruppe), `strasse` und `fluss` suchen dieselben Wege", async () => {
            const expected = { kind: "path", anchor: P4.flussEins, wiki: "p4t-grossfluss" };
            expect(await link("strasse", "p4t-grossfluss")).toEqual({ ref: expected, param: "strasse", via: "wiki" });
            expect(await link("fluss", "p4t-grossfluss")).toEqual({ ref: expected, param: "fluss", via: "wiki" });
            // Ein Artikel nur als weitere Zuweisung (Legacy `deeplinkWeitererTreffer`): der Weg ist der Artikel selbst.
            expect(await link("strasse", "p4t-nur-weiter")).toMatchObject({
                ref: { kind: "path", anchor: P4.strasseEins, wiki: "p4t-nur-weiter" },
            });
            // Eine bloße Adresse ohne Schlüssel (Jennbach).
            expect(await link("fluss", "P4_Jennbach")).toMatchObject({ ref: { kind: "path", anchor: P4.jennbach } });
        });

        it("🔴 Wege über den Namen: genau ein Weg ist ein Treffer, auch über zwei Wegarten (WI-0177 Schritt 2b)", async () => {
            const einer = await link("strasse", "P4_Strasse_Eins");
            expect(einer).toMatchObject({ ref: { kind: "path", anchor: P4.strasseEins } });
            const waldweg = await link("strasse", "P4 Waldweg");
            expect(waldweg).toMatchObject({ ref: (await detail({ kind: "path", anchor: P4.waldwegPfad })).subject });
        });

        it("`place` öffnet Ort, Landschaft über ihre Beschriftung und Gipfel über ihre öffentliche ID", async () => {
            expect(await link("place", P4.gareth)).toEqual({
                ref: { kind: "place", id: P4.gareth },
                param: "place",
                via: "id",
            });
            expect(await link("place", P4.gareth.toUpperCase())).toMatchObject({
                ref: { kind: "place", id: P4.gareth },
            });
            expect(await link("place", P4.labelWald)).toMatchObject({ ref: { kind: "area", id: P4.wald }, via: "id" });
            expect(await link("place", P4.gipfel)).toMatchObject({ ref: { kind: "peak", id: P4.gipfel }, via: "id" });
            // Eine Kennung, die niemand kennt, und ein verborgener Ort: nichts gefunden.
            expect(await link("place", randomUUID())).toEqual({
                notFound: { param: "place", value: expect.any(String) },
            });
            expect(await link("place", P4.dorfVerborgen)).toMatchObject({ notFound: { param: "place" } });
            expect(await link("place", "kein-uuid")).toEqual({ notFound: { param: "place", value: "kein-uuid" } });
        });

        it("ein verborgener Ort ist über seine Adresse nicht zu finden", async () => {
            await database`
                INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT id, 'https://de.wiki-aventurica.de/wiki/P4_Verborgen', NULL, 'address_only', 'unknown' FROM place WHERE public_id = ${P4.dorfVerborgen}
            `;
            // Der Index kennt den neuen Stand erst mit einer neuen Revision: ein frischer Dienst liest ihn.
            const fresh = createSubjectService(database);
            expect(
                await fresh.resolveLink({ param: "siedlung", name: "siedlung", value: "P4_Verborgen" }),
            ).toMatchObject({
                notFound: { param: "siedlung" },
            });
            await database`DELETE FROM place_wiki_assignment WHERE wiki_url = 'https://de.wiki-aventurica.de/wiki/P4_Verborgen'`;
        });

        it("🔴 findet der Index nichts, fragt die Auflösung EINMAL die Namenssuche: ein Klammerzusatz entfällt", async () => {
            // Kein Wiki-Schlüssel, aber der Name: Orte über die Suche.
            expect(await link("siedlung", "P4_Dorf_Eins")).toEqual({
                ref: { kind: "place", id: P4.dorf },
                param: "siedlung",
                via: "name",
            });
            // „P4 Provinz Ost (Kaiserreich)“ sucht „P4 Provinz Ost“ und findet das Gebiet.
            expect(await link("staat", "P4_Provinz_Ost_(Kaiserreich)")).toEqual({
                ref: { kind: "territory", id: P4.provinzOst },
                param: "staat",
                via: "name",
            });
            // Eine Landschaft ohne Zuordnung, über ihren Namen.
            expect(await link("region", "P4_Hügel_der_Brinaskquelle")).toMatchObject({
                ref: { kind: "area", id: P4.huegel },
                via: "name",
            });
        });

        it("🔴 nichts gefunden heißt `notFound`, nie Gareth oder die Startansicht", async () => {
            expect(await link("siedlung", "P4_Gibt_Es_Nicht_Wirklich")).toEqual({
                notFound: { param: "siedlung", value: "P4_Gibt_Es_Nicht_Wirklich" },
            });
            expect(await link("fluss", "Nirgendwo_Fluss_P4")).toMatchObject({ notFound: { param: "fluss" } });
            expect(await link("staat", "!!!")).toMatchObject({ notFound: { param: "staat" } });
        });
    });

    describe("Routen", () => {
        const build = (): FastifyInstance => {
            const own = createDatabase(testDatabaseUrl as string, { max: 6 });
            app = buildApp({ config, database: own, logStream: SILENT });
            return app;
        };

        it("🔴 GET /api/subjects/{kind}/{id} antwortet mit dem Detail, kurz im Cache, und erkennt die Kennung der Fachdomäne", async () => {
            const server = build();
            const response = await server.inject({ url: `/api/subjects/place/${P4.gareth}` });
            expect(response.statusCode).toBe(200);
            expect(response.headers["cache-control"]).toBe(`public, max-age=${String(SUBJECT_LIMITS.cacheSeconds)}`);
            const body = response.json<SubjectDetailType>();
            expect(Value.Check(SubjectDetail, body)).toBe(true);
            expect(body.title).toBe("P4 Gareth");
            // Die Markierungen `layer` und `legacyHidden` überstehen die Antwortschemas (sonst würden sie still verworfen).
            expect(body.facts?.filter((fact) => fact.legacyHidden === true).map((fact) => fact.field)).toEqual([
                "description",
                "einwohner",
                "lage",
            ]);
            expect(body.facts?.filter((fact) => "layer" in fact && fact.layer === "direct")).toHaveLength(3);
            const wald = await server.inject({ url: `/api/subjects/area/${P4.wald}` });
            expect(
                wald
                    .json<SubjectDetailType>()
                    .facts?.filter((fact) => fact.legacyHidden === true)
                    .map((fact) => fact.field),
            ).toEqual(["continent", "verkehrswege", "neighbors", "neighbors", "synonyms"]);
            // Jede Art hat ihren Endpunkt.
            for (const [kind, id] of [
                ["territory", P4.reich],
                ["area", P4.wald],
                ["peak", P4.gipfel],
                ["powerline", P4.linieEins],
                ["path", P4.flussEins],
            ] as const) {
                const result = await server.inject({ url: `/api/subjects/${kind}/${id}` });
                expect(result.statusCode, kind).toBe(200);
                expect(result.json<SubjectDetailType>().subject.kind, kind).toBe(kind);
            }
            // Großbuchstaben in der Kennung sind dieselbe Kennung.
            expect((await server.inject({ url: `/api/subjects/place/${P4.gareth.toUpperCase()}` })).statusCode).toBe(
                200,
            );
        });

        it("ein Weg nennt den Anker, den Wiki-Hinweis oder den Kettenschlüssel der Suche", async () => {
            const server = build();
            const chain = encodeURIComponent(pathChainKey("P4 Großfluss"));
            const byChain = await server.inject({ url: `/api/subjects/path/${chain}` });
            // Eine alte Kette (Links von vor Schritt 2b) führt auf denselben Weg.
            const alt = await server.inject({
                url: `/api/subjects/path/${encodeURIComponent("P4 Großfluss:Flussweg")}`,
            });
            expect(alt.json<SubjectDetailType>().subject).toEqual(byChain.json<SubjectDetailType>().subject);
            expect(byChain.statusCode).toBe(200);
            expect(byChain.json<SubjectDetailType>().subject).toEqual({
                kind: "path",
                anchor: P4.flussEins,
                wiki: "p4t-grossfluss",
            });
            const hinted = await server.inject({ url: `/api/subjects/path/${P4.strasseEins}?wiki=p4t-nur-weiter` });
            expect(hinted.json<SubjectDetailType>().subject).toMatchObject({ wiki: "p4t-nur-weiter" });
            const sources = await server.inject({ url: `/api/subjects/path/${P4.flussDrei}/sources` });
            expect(sources.statusCode).toBe(200);
            expect(Value.Check(SubjectSourcesSection, sources.json())).toBe(true);
        });

        it("🔴 die Quellen-Sektion und der Kartenpunkt haben ihre Endpunkte, Kartenpunkte werden gerundet", async () => {
            const server = build();
            const sources = await server.inject({ url: `/api/subjects/place/${P4.gareth}/sources` });
            expect(sources.statusCode).toBe(200);
            expect(sources.json<{ sources: unknown[] }>().sources).toHaveLength(3);
            const point = await server.inject({ url: "/api/subjects/map-point?x=110.004&y=110" });
            expect(point.statusCode).toBe(200);
            expect(Value.Check(MapPointDetail, point.json())).toBe(true);
            expect(point.json<{ subject: unknown }>().subject).toEqual({ kind: "mapPoint", x: 110, y: 110 });
            // 🔴 `layers` ist optional und reist durch (Nachtrag zu WI-0083): dieselbe Adresse, nur die aktive Ansicht.
            const inView = await server.inject({ url: "/api/subjects/map-point?x=110&y=110&layers=vegetation" });
            expect(inView.statusCode).toBe(200);
            expect(Value.Check(MapPointDetail, inView.json())).toBe(true);
            const detail = inView.json<MapPointDetailType>();
            expect(detail.subject).toEqual({ kind: "mapPoint", x: 110, y: 110, layers: ["vegetation"] });
            expect(detail.context?.landscapes?.items.map((item) => item.layer)).toEqual(["vegetation"]);
        });

        it("🔴 resolve-link: Aliase führen auf dieselbe Auflösung, bei deutsch und englisch gleichzeitig gewinnt der deutsche Schlüssel", async () => {
            const server = build();
            const resolve = async (query: string): Promise<ResolveLinkResponseType> => {
                const response = await server.inject({ url: `/api/subjects/resolve-link?${query}` });
                expect(response.statusCode, query).toBe(200);
                return response.json<ResolveLinkResponseType>();
            };
            const place = { ref: { kind: "place", id: P4.fasarOrt }, via: "wiki" };
            expect(await resolve("siedlung=P4_Fasar")).toEqual({ ...place, param: "siedlung" });
            expect(await resolve("settlement=P4_Fasar")).toEqual({ ...place, param: "siedlung" });
            const state = { ref: { kind: "territory", id: P4.fasarGebiet }, via: "wiki", param: "staat" };
            expect(await resolve("staat=P4_Fasar")).toEqual(state);
            expect(await resolve("state=P4_Fasar")).toEqual(state);
            expect(await resolve("road=p4t-grossfluss")).toMatchObject({ param: "strasse" });
            expect(await resolve("river=p4t-grossfluss")).toMatchObject({ param: "fluss" });
            // 🔴 Gleichzeitig: der deutsche Schlüssel gewinnt, auch vor einem Treffer des englischen.
            expect(await resolve("settlement=P4_Rathila&siedlung=P4_Fasar")).toMatchObject({
                ref: { id: P4.fasarOrt },
            });
            // Die Priorität ist Legacys: place vor siedlung vor staat.
            expect(await resolve(`staat=P4_Fasar&siedlung=P4_Fasar&place=${P4.gareth}`)).toMatchObject({
                param: "place",
            });
            expect(await resolve("staat=P4_Fasar&siedlung=P4_Fasar")).toMatchObject({ param: "siedlung" });
            // Ein Link ohne Treffer ist ein 200 mit `notFound`, damit der Leser den Hinweis zeigen kann.
            expect(await resolve("siedlung=P4_Nirgends_Zu_Finden")).toEqual({
                notFound: { param: "siedlung", value: "P4_Nirgends_Zu_Finden" },
            });
        });

        it("🔴 Fehlerformen: 400 in Fastifys Form, 404 `not_found`, nie ein 500 - auch weit über den Grenzen", async () => {
            const server = build();
            const fastify400 = { statusCode: 400, code: "FST_ERR_VALIDATION" };
            const bad = [
                "/api/subjects/place/kein-uuid",
                "/api/subjects/area/1234",
                "/api/subjects/place/" + "9".repeat(5000),
                "/api/subjects/path/" + "x".repeat(5000),
                "/api/subjects/path/keine-kette-und-kein-anker",
                "/api/subjects/path/" + encodeURIComponent("Reichsstrasse:Autobahn"),
                `/api/subjects/path/${P4.flussEins}?wiki=` + "w".repeat(5000),
                `/api/subjects/place/${P4.gareth}/sourcesx`,
                "/api/subjects/map-point",
                "/api/subjects/map-point?x=5000&y=1",
                "/api/subjects/map-point?x=1&y=-3",
                "/api/subjects/map-point?x=abc&y=1",
                "/api/subjects/map-point?x=1&y=1&layers=",
                "/api/subjects/map-point?x=1&y=1&layers=politisch",
                "/api/subjects/map-point?x=1&y=1&layers=vegetation,",
                "/api/subjects/resolve-link",
                "/api/subjects/resolve-link?pin=1,2",
                "/api/subjects/resolve-link?siedlung=" + "g".repeat(5000),
                "/api/subjects/resolve-link?siedlung=%20%20",
            ];
            for (const url of bad) {
                const response = await server.inject({ url });
                expect(response.statusCode, url.slice(0, 90)).toBeGreaterThanOrEqual(400);
                expect(response.statusCode, url.slice(0, 90)).toBeLessThan(500);
                if (response.statusCode === 400) expect(response.json(), url.slice(0, 90)).toMatchObject(fastify400);
            }
            // Das Unbekannte ist 404 in unserer Form und liegt nicht im Cache.
            for (const url of [
                `/api/subjects/place/${randomUUID()}`,
                `/api/subjects/area/${randomUUID()}/sources`,
                `/api/subjects/path/${randomUUID()}`,
                // 🪤 Ein verborgener Ort steht hier NICHT mehr: Er antwortet seit WI-0080 mit seinem Detail,
                // nicht mit 404. Der Fall dazu steht oben bei „Ort“.
                `/api/subjects/path/${encodeURIComponent("Gibt es nicht:Weg")}`,
            ]) {
                const response = await server.inject({ url });
                expect(response.statusCode, url).toBe(404);
                expect(response.json(), url).toEqual({ error: "not_found" });
                expect(response.headers["cache-control"], url).toBe("no-store");
            }
        });

        it("🔴 ist die Datenbank nicht erreichbar, antworten die Routen 503 `database_unavailable` mit Retry-After, nicht 500", async () => {
            // Ein Port, auf dem niemand lauscht: der Verbindungsfehler geht durch den Fehlerhandler der Anwendung.
            const dead = createDatabase("postgres://nobody@127.0.0.1:1/none", { max: 1 });
            app = buildApp({ config, database: dead, logStream: SILENT });
            // Der Start wartet höchstens SYSTEM_START_WAIT_MS auf den Betriebszustand (app.ts); gemessen wird danach.
            await app.ready();
            for (const url of [
                `/api/subjects/place/${P4.gareth}`,
                `/api/subjects/path/${P4.flussEins}/sources`,
                "/api/subjects/map-point?x=1&y=1",
                "/api/subjects/resolve-link?siedlung=Gareth",
            ]) {
                const started = Date.now();
                const response = await app.inject({ url });
                expect(response.statusCode, url).toBe(503);
                expect(response.json(), url).toEqual({ error: "database_unavailable" });
                expect(response.headers["retry-after"], url).toBe("5");
                // 🪤 Abweisen statt Warten: Der Betriebszustand treibt den Fehlerzähler des Pools hoch; ungedeckelt wartete hier
                // jede Anfrage Sekunden auf ihren Versuch (2026-10-10: 17,7 s für vier, `reconnectBackoff` in database.ts).
                expect(Date.now() - started, url).toBeLessThan(2_000);
            }
        });

        it("🔴 ohne Datenbank antworten alle Routen 503 `database_unavailable`, nicht 500", async () => {
            app = buildApp({ config, logStream: SILENT });
            for (const url of [
                `/api/subjects/place/${P4.gareth}`,
                `/api/subjects/place/${P4.gareth}/sources`,
                "/api/subjects/map-point?x=1&y=1",
                "/api/subjects/resolve-link?siedlung=Gareth",
            ]) {
                const response = await app.inject({ url });
                expect(response.statusCode, url).toBe(503);
                expect(response.json(), url).toEqual({ error: "database_unavailable" });
            }
        });

        it("🔴 die Drossel weist die überzähligen Abfragen mit 503 `busy` und Retry-After ab", async () => {
            const server = build();
            const total = SUBJECT_LIMITS.concurrent * 3;
            const responses = await Promise.all(
                Array.from({ length: total }, () => server.inject({ url: `/api/subjects/place/${P4.gareth}` })),
            );
            const busy = responses.filter((response) => response.statusCode === 503);
            expect(responses.filter((response) => response.statusCode === 200).length).toBeGreaterThanOrEqual(1);
            expect(busy.length).toBeGreaterThanOrEqual(1);
            for (const response of busy) {
                expect(response.json()).toEqual({ error: "busy" });
                expect(response.headers["retry-after"]).toBe("1");
            }
            // Danach ist die Drossel wieder frei.
            expect((await server.inject({ url: `/api/subjects/place/${P4.gareth}` })).statusCode).toBe(200);
        });
    });
});
