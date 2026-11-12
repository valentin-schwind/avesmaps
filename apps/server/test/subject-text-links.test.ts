import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    SubjectDetail,
    renderZoomForBand,
    type SubjectDetail as SubjectDetailType,
    type SubjectFact,
    type SubjectListFact,
    type SubjectTextFact,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { createSubjectService, type SubjectService } from "../src/subjects/service.ts";
import { lookupWikiKey, pageKeysOf, type WikiKeyLookup, type WikiKeyMatch } from "../src/subjects/wiki-key-lookup.ts";
import {
    MAP_DOMAIN,
    P4,
    SYNCED,
    WIKI,
    cleanSubjectFixtures,
    importP4WikiLinks,
    insertSubjectFixtures,
    p4Id,
} from "./support/subject-fixture.ts";
import { p4Key, type X1Spec, type X2Spec } from "./support/wiki-link-fixture.ts";

/**
 * Verweise in Wiki-Texten und das Klimaband gegen echtes PostgreSQL (WI-0063 27.12, Betreiber 2026-10-05): Ein Teilstück eines Wiki-Wertes wird nur
 * ein Link, wenn das Linkziel, das der Artikel dafür nennt (Legacys Export X1), über seinen kanonischen Wiki-Key genau ein Objekt der Karte trägt (die
 * Zuordnung X2). Ein Name ist nie Schlüssel - auch ein eindeutiger nicht. Die reinen Fälle prüfen `wiki-key-lookup.test.ts` und `link-pieces.test.ts`; hier
 * geht es darum, dass die Daten richtig ankommen: der Lookup aus der Zuordnungstafel der Datenbank (Orte, Gebiete, Landschaften, Gipfel, Wege, Kraftlinien),
 * die Felder der Orte, Landschaften, Wege und Kraftlinien mit ihren Linkzielen und dass jedes Feld OHNE Linkziel - dessen Namen ALLE Objekte der Karte tragen
 * - Text bleibt. Alles geht durch den echten Importer (`importP4WikiLinks`). Dazu das Klimaband mit seinem Kopf.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };
const SILENT = { write: (): void => undefined };

/** Neue Zeilen dieser Datei: im Namensraum der P4-Fixture, damit `cleanSubjectFixtures` sie wegräumt. */
const NEU = {
    lageprobe: p4Id(0xb1),
    hochland: p4Id(0xb2),
    /** Ein Gebiet ohne abgeleitete Form: Es steht nicht auf der Karte und ist kein Linkziel. */
    ohneForm: p4Id(0xb3),
    /** Ein Ort mit Linkzielen für seine Verkehrswege (wie Gareth im Bestand mit dem Export X1). */
    wegeprobe: p4Id(0xb4),
    /** Derselbe Text und eine Zuordnung, aber kein Artikel in X1: so stehen Orte da, deren Seite der Dump-Lauf nicht hat. */
    wegeLeer: p4Id(0xb5),
    /** Offizieller und inoffizieller Artikel desselben Titels: zwei Keys. */
    djuimen: p4Id(0xb6),
    djuimenInoffiziell: p4Id(0xb7),
} as const;

const textFact = (detail: SubjectDetailType, field: string, layer?: "direct"): SubjectTextFact | undefined =>
    (detail.facts ?? []).find(
        (fact): fact is SubjectTextFact =>
            "value" in fact &&
            fact.field === field &&
            (layer === undefined ? fact.layer === undefined : fact.layer === layer),
    );
const listFacts = (detail: SubjectDetailType, field: string): SubjectListFact[] =>
    (detail.facts ?? []).filter(
        (fact: SubjectFact): fact is SubjectListFact => "values" in fact && fact.field === field,
    );

/** Alle Fakten einer Antwort, die Links tragen: jede Zeile mit `links` (Text- und Listenfakten). */
const linkedFacts = (detail: SubjectDetailType): string[] =>
    (detail.facts ?? []).filter((fact) => fact.links !== undefined).map((fact) => fact.field);

const VERKEHRSWEGE = "Reichsstraßen Eins und Zwei, Großfluss und P4 Waldweg";

/** Die Zuordnung (X2) der Objekte dieser Datei und einiger Objekte der P4-Welt, die der Proben wegen einen Key brauchen. */
const EXTRA_ASSIGNMENTS: X2Spec[] = [
    { art: "siedlung", id: NEU.lageprobe, key: p4Key("p4t-lageprobe") },
    { art: "siedlung", id: NEU.wegeprobe, key: p4Key("p4t-wegeprobe") },
    { art: "siedlung", id: NEU.wegeLeer, key: p4Key("p4t-wegeleer") },
    { art: "siedlung", id: NEU.djuimen, key: p4Key("p4-dju-imen") },
    {
        art: "siedlung",
        id: NEU.djuimenInoffiziell,
        key: p4Key("inoffiziell-p4-dju-imen"),
        ns: 222,
        nsName: "Inoffiziell",
    },
    { art: "landschaft", id: NEU.hochland, key: p4Key("p4t-hochland") },
    // Ein Gebiet ohne Form hat eine Zuweisung und ist trotzdem kein Ziel.
    { art: "gebiet", id: NEU.ohneForm, key: p4Key("p4-ohne-form") },
    { art: "gebiet", id: P4.provinzWest, key: p4Key("p4-provinz-west") },
    // Landschaften, auf die Linkziele zeigen.
    { art: "landschaft", id: P4.landstrich, key: p4Key("p4-landstrich") },
    { art: "landschaft", id: P4.meer, key: p4Key("p4-meer-x") },
    { art: "landschaft", id: P4.huegel, key: p4Key("p4-garetien") },
];

/** Die Linkziele (X1) dieser Datei. Jeder Anzeigetext steht im angezeigten Feld; welcher Key ein Objekt trifft, entscheidet allein die Zuordnung. */
const EXTRA_PAGES: X1Spec[] = [
    {
        key: p4Key("p4t-lageprobe"),
        kind: "settlement",
        title: "P4 Lageprobe",
        felder: {
            // „P4 Meer“ ist der NAME einer Landschaft, die keine Zuweisung hat: ihr Linkziel trägt keinen Key mit Objekt.
            region: [
                { anzeige: "P4 Landstrich", key: p4Key("p4-landstrich") },
                { anzeige: "P4 Meer", key: p4Key("p4-meer-zuweisungslos") },
            ],
            staat: [
                // {{Pol|P4 Reich}}: Ziel P4 Reich, kein Objekt trägt den Key; {{Pol|P4 Provinz West}} trifft das Gebiet; das Gebiet ohne Form ist kein Ziel.
                { anzeige: "P4 Reich", key: p4Key("p4-reich-zuweisungslos"), art: "vorlage", vorlage: "Pol" },
                { anzeige: "P4 Provinz West", key: p4Key("p4-provinz-west"), art: "vorlage", vorlage: "Pol" },
                { anzeige: "P4 Ohne Form", key: p4Key("p4-ohne-form") },
                { anzeige: "Reichsstadt", key: p4Key("p4-reichsstadt") },
                { anzeige: "P4 Gareth", key: p4Key("p4t-gareth") },
            ],
        },
    },
    {
        key: p4Key("p4t-wegeprobe"),
        kind: "settlement",
        title: "P4 Wegeprobe",
        felder: {
            verkehrswege: [
                { anzeige: "Eins", key: p4Key("p4t-strasse-eins") },
                // „Zwei“ nennt eine Seite ohne Objekt; „P4 Waldweg“ ist der NAME eines echten Wegs ohne Wiki-Zuweisung.
                { anzeige: "Zwei", key: p4Key("p4-seite-ohne-objekt") },
                { anzeige: "Großfluss", key: p4Key("p4t-grossfluss") },
                { anzeige: "P4 Waldweg", key: p4Key("p4-waldweg") },
            ],
        },
    },
    {
        key: p4Key("p4t-hochland"),
        kind: "region",
        title: "P4 Hochland",
        felder: {
            region: [{ anzeige: "P4 Meer", key: p4Key("p4-meer-x") }],
            staat: [
                { anzeige: "P4 Reich", key: p4Key("p4-reich-zuweisungslos"), art: "vorlage", vorlage: "Pol" },
                { anzeige: "P4 Archipel", key: p4Key("p4-archipel") },
            ],
            verkehrswege: [
                { anzeige: "P4 Großfluss", key: p4Key("p4t-grossfluss") },
                { anzeige: "Unbekannter Weg", key: p4Key("p4-gibt-es-nicht") },
                { anzeige: "P4 Meer", key: p4Key("p4-meer-x") },
            ],
            // Die Waldwildnis teilt ihren Artikel mit dem Nordwald: mehrdeutig, also Text.
            nachbar_n: [{ anzeige: "P4 Waldwildnis", key: p4Key("p4t-waldwildnis") }],
            nachbar_o: [
                { anzeige: "P4 Landstrich", key: p4Key("p4-landstrich") },
                { anzeige: "P4 Fasar", key: p4Key("p4t-fasar") },
                { anzeige: "P4 Meer", key: p4Key("p4-meer-x") },
            ],
        },
    },
    {
        key: p4Key("p4t-grossfluss"),
        kind: "path",
        title: "P4 Großfluss",
        felder: {
            lage: [{ anzeige: "P4 Landstrich", key: p4Key("p4-landstrich") }],
            // Der Verlauf nennt ALLE Links des Rohtexts, auch fremde Wege; „P4 Dorf Eins“ ist der Name eines Orts ohne Zuweisung.
            verlauf: [
                { anzeige: "Seeweg", key: p4Key("p4-seeweg") },
                { anzeige: "P4 Gareth", key: p4Key("p4t-gareth") },
                { anzeige: "Niemandsland", key: p4Key("p4-niemandsland") },
                { anzeige: "P4 Dorf Eins", key: p4Key("p4-dorf-eins") },
            ],
        },
    },
    {
        key: p4Key("p4t-kraftlinie"),
        kind: "powerline",
        title: "P4 Kraftlinie",
        felder: { regionen: [{ anzeige: "Garetien", key: p4Key("p4-garetien") }] },
    },
];

describeWithDatabase("Verweise über den Wiki-Key und das Klimaband gegen PostgreSQL (WI-0063 27.12)", () => {
    let database: Database;
    let service: SubjectService;
    let lookup: WikiKeyLookup;
    let app: FastifyInstance | undefined;
    let ownBand = false;

    const target = (key: string): WikiKeyMatch => lookupWikiKey(lookup, key);

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await insertSubjectFixtures(database);

        // Ein Gebiet, das es gibt, aber nicht auf der Karte (wie die 688 von 1.676 im Bestand): ohne Fläche keine Form.
        await database`
            INSERT INTO territory (public_id, map_domain_id, name, color, opacity, wiki_url, is_active, source_system)
            VALUES (${NEU.ohneForm}, ${MAP_DOMAIN}, 'P4 Ohne Form', '#35b145', 0.7, ${`${WIKI}P4_Ohne_Form`}, TRUE, 'test')
        `;

        const place = async (publicId: string, name: string, x: number, y: number): Promise<string> =>
            (
                await database<{ id: string }[]>`
                    INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
                    VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, 'dorf', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'test', TRUE, FALSE)
                    RETURNING id::text
                `
            )[0]?.id as string;
        const assign = (placeId: string, url: string, snapshotId: string | null): Promise<unknown> =>
            database`
                INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                VALUES (${placeId}, ${url}, ${snapshotId}, ${snapshotId === null ? "address_only" : "assigned"}, 'unknown')
            `;
        const snapshot = async (
            key: string,
            title: string,
            fields: { region?: string; staat?: string; verkehrswege?: string },
        ): Promise<string> =>
            (
                await database<{ id: string }[]>`
                    INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, description, region_text, staat_text, verkehrswege, synced_at)
                    VALUES (${key}, ${`${WIKI}${title.replaceAll(" ", "_")}`}, ${title}, ${title}, 'Ein Ort.',
                            ${fields.region ?? null}, ${fields.staat ?? null}, ${fields.verkehrswege ?? null}, ${SYNCED})
                    RETURNING id::text
                `
            )[0]?.id as string;

        // Ein Ort mit Lage aus Region und Staat (wie Gareth: „Herz des Kontinents · Baronie Raulsmark; Reichsstadt (nur Alt-Gareth)“): Die
        // Namen sind die EXAKTEN Namen von Objekten der Karte - verlinkt wird nur, wofür der Artikel ein Linkziel mit passendem Key nennt.
        const lageprobe = await place(NEU.lageprobe, "P4 Lageprobe", 148, 148);
        await assign(
            lageprobe,
            `${WIKI}P4_Lageprobe`,
            await snapshot("p4t-lageprobe", "P4 Lageprobe", {
                region: "P4 Landstrich: P4 Meer",
                staat: "P4 Reich; P4 Provinz West (Teilgebiet); P4 Ohne Form; Reichsstadt (nur P4 Gareth)",
            }),
        );
        await database`
            INSERT INTO place_detail (place_id, lage, lage_origin)
            VALUES (${lageprobe}, 'P4 Nachbarreich, Unbekannt', 'manual')
        `;

        // Verkehrswege mit Linkzielen aus dem Artikel; derselbe Text ohne Artikel in X1.
        const wegeprobe = await place(NEU.wegeprobe, "P4 Wegeprobe", 149, 149);
        await assign(
            wegeprobe,
            `${WIKI}P4_Wegeprobe`,
            await snapshot("p4t-wegeprobe", "P4 Wegeprobe", { verkehrswege: VERKEHRSWEGE }),
        );
        const wegeLeer = await place(NEU.wegeLeer, "P4 Wegeleer", 150, 149);
        await assign(
            wegeLeer,
            `${WIKI}P4_Wegeleer`,
            await snapshot("p4t-wegeleer", "P4 Wegeleer", { verkehrswege: VERKEHRSWEGE }),
        );

        // Der Namensraum gehört zum Key: zwei Orte, deren Seiten sich nur im Präfix „Inoffiziell:“ unterscheiden.
        await assign(await place(NEU.djuimen, "P4 Dju'imen", 151, 149), `${WIKI}P4_Dju'imen`, null);
        await assign(
            await place(NEU.djuimenInoffiziell, "P4 Dju'imen (inoffiziell)", 152, 149),
            `${WIKI}Inoffiziell:P4_Dju'imen`,
            null,
        );
        // Ein verborgener Ort mit Zuweisung steht nicht auf der Karte: kein Ziel.
        await assign(
            (
                await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${P4.dorfVerborgen}::uuid`
            )[0]?.id as string,
            `${WIKI}P4_Dorf_Verborgen`,
            null,
        );

        // Eine Landschaft, deren Wiki-Text Kontinent, Region, Staat, Verkehrswege und Nachbarn nennt - alles Namen von Objekten der Karte.
        const region = async (
            publicId: string,
            name: string,
            wikiUrl: string | null,
            wikiKey: string | null,
        ): Promise<string> => {
            const [row] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, wiki_url, wiki_region_key, is_active, source_system)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, 'topographie', 'gebirge', ${wikiUrl}, ${wikiKey}, TRUE, 'test')
                RETURNING id::text
            `;
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (gen_random_uuid(), ${MAP_DOMAIN}, ${row?.id as string},
                        ST_GeomFromText('POLYGON((100 175,104 175,104 179,100 179,100 175))', 0), TRUE)
            `;
            return row?.id as string;
        };
        await region(NEU.hochland, "P4 Hochland", `${WIKI}P4_Hochland`, "p4t-hochland");
        const [hochland] = await database<{ id: string }[]>`
            INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, continent, region_parent, affiliation_staat, verkehrswege, description, synced_at)
            VALUES ('p4t-hochland', ${`${WIKI}P4_Hochland`}, 'P4 Hochland', 'P4 Landstrich', 'P4 Meer: Unbekanntes Land',
                    'nominell P4 Reich, P4 Archipel', 'P4 Großfluss, Unbekannter Weg, P4 Meer', 'Ein Hochland.', ${SYNCED})
            RETURNING id::text
        `;
        await database`
            INSERT INTO wiki_region_snapshot_neighbor (snapshot_id, direction, position, name)
            VALUES (${hochland?.id as string}, 'N', 0, 'P4 Waldwildnis'), (${hochland?.id as string}, 'N', 1, 'Unbekannt'),
                   (${hochland?.id as string}, 'O', 0, 'P4 Landstrich (Region)'), (${hochland?.id as string}, 'O', 1, 'P4 Fasar / P4 Meer')
        `;

        // Die Zuordnung (X2) und die Linkziele (X1) mit dem echten Importer: erst DANN kennt der Index sie.
        await importP4WikiLinks(database, { assignments: EXTRA_ASSIGNMENTS, pages: EXTRA_PAGES });

        // Das Klimaband: im Bestand der Testdatenbank liegt keins oder es stammt aus einem anderen Test; nur anlegen, was fehlt.
        const [band] = await database<
            { n: string }[]
        >`SELECT count(*)::text AS n FROM climate_band WHERE type_key = 'gemaessigt'`;
        if (band?.n === "0") {
            ownBand = true;
            // 🪤 `climate_band` ist abgeleitet: Der Riegel lässt nur eine Transaktion durch, die `climate.deriving` setzt (WI-0005).
            await database.begin(async (transaction) => {
                await transaction`SELECT set_config('climate.deriving', 'on', true)`;
                await transaction`
                    INSERT INTO climate_band (type_key, geom, source_fingerprint)
                    VALUES ('gemaessigt', ST_GeomFromText('POLYGON((0 400,1024 400,1024 700,0 700,0 400))', 0), 'p4-test')
                `;
            });
        }
        service = createSubjectService(database);
        lookup = (await service.index()).wikiKeys;
    }, 180_000);

    afterAll(async () => {
        if (ownBand)
            await database.begin(async (transaction) => {
                await transaction`SELECT set_config('climate.deriving', 'on', true)`;
                await transaction`DELETE FROM climate_band WHERE type_key = 'gemaessigt' AND source_fingerprint = 'p4-test'`;
            });
        await cleanSubjectFixtures(database);
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
        return result;
    }

    describe("Der Lookup aus der Zuordnungstafel der Datenbank", () => {
        it("jede Art von Objekt ist über den Wiki-Key ihrer Zuordnung zu finden", () => {
            // Ort (nur Adresse, ohne Schnappschuss), Gipfel (Art `region`: eine Beschriftung), Gebiet, Landschaft (mehrere Regionen EINER Gruppe sind EIN Subject)
            expect(target("wiki:p4-dorf-adresse")).toEqual({ kind: "one", ref: { kind: "place", id: P4.dorfAdresse } });
            expect(target("wiki:p4t-gipfel")).toEqual({ kind: "one", ref: { kind: "peak", id: P4.gipfel } });
            expect(target("wiki:p4t-hochland")).toEqual({ kind: "one", ref: { kind: "area", id: NEU.hochland } });
            expect(target("wiki:p4-provinz-west")).toEqual({
                kind: "one",
                ref: { kind: "territory", id: P4.provinzWest },
            });
            const archipel = target("wiki:p4-archipel");
            expect(archipel.kind).toBe("one");
            expect(archipel.kind === "one" ? archipel.ref : null).toMatchObject({
                kind: "area",
                id: P4.archipelA,
                group: [P4.archipelB],
            });
            // Wege: alle Abschnitte EINES Artikels sind die Gruppe seiner Hauptzuweisung, mit dem Schlüssel des Artikels.
            expect(target("wiki:p4t-strasse-eins")).toEqual({
                kind: "one",
                ref: { kind: "path", anchor: P4.strasseEins, wiki: "p4t-strasse-eins" },
            });
            expect(target("wiki:p4t-grossfluss")).toEqual({
                kind: "one",
                ref: { kind: "path", anchor: P4.flussEins, wiki: "p4t-grossfluss" },
            });
            // Kraftlinien: alle Segmente EINES Keys sind dieselbe Kraftlinie, der Anker ist das kleinste.
            expect(target("wiki:p4t-kraftlinie")).toEqual({
                kind: "one",
                ref: { kind: "powerline", anchor: P4.linieEins },
            });
        });

        it("🔴 die Beschriftung einer Landschaft wiederholt ihren Artikel und zählt nicht doppelt: dieselbe Region ist EIN Objekt", () => {
            // `P4.labelWald` (Art `region`) und die Fläche `P4.wald` tragen denselben Key; der Nordwald ist ein anderes Objekt: also mehrdeutig, nicht doppelt.
            expect(target("wiki:p4t-waldwildnis")).toEqual({ kind: "many" });
            expect(target("wiki:p4-garetien")).toEqual({ kind: "one", ref: { kind: "area", id: P4.huegel } });
        });

        it("🔴 nur der Key trifft: ein Name, ein Titel oder ein anderer Schlüssel desselben Wortlauts trifft NIE, auch wenn er genau ein Objekt der Karte heißt", () => {
            // Alles eindeutige Namen echter Objekte (Ort, Gebiet, Landschaft, Weg), keines trägt einen Key in der Zuordnung.
            for (const name of [
                "P4 Dorf Eins",
                "P4 Reich",
                "P4 Provinz West",
                "P4 Testsee",
                "P4 Waldweg",
                "wiki:p4-dorf-eins",
                "wiki:p4-testsee",
                "wiki:p4-waldweg",
                "p4t-gareth",
            ]) {
                expect(target(name), name).toEqual({ kind: "none" });
            }
            // Wer eine Zuordnung hat, hat einen Key - und der Key ist der der Wiki-SEITE, nicht der des Namens: Gareths Seite heißt zufällig wie er.
            expect(target("wiki:p4t-gareth")).toEqual({ kind: "one", ref: { kind: "place", id: P4.gareth } });
        });

        it("🔴 die weitere Zuweisung eines Wegs ist kein Ziel: X2 kennt nur die Hauptzuweisung", () => {
            expect(target("wiki:p4t-nur-weiter")).toEqual({ kind: "none" });
        });

        it("🔴 zwei Objekte mit demselben Key sind mehrdeutig, auch verschiedener Arten: kein Link, nichts wird gewählt", () => {
            // Zwei Orte teilen eine Seite; ein Ort und ein Gebiet teilen sie; zwei Landschaften verschiedener Gruppen teilen sie.
            expect(target("wiki:p4-rathila")).toEqual({ kind: "many" });
            expect(target("wiki:p4t-fasar")).toEqual({ kind: "many" });
            expect(target("wiki:p4t-waldwildnis")).toEqual({ kind: "many" });
        });

        it("ein Gebiet ohne abgeleitete Form und ein verborgener Ort stehen nicht auf der Karte: kein Ziel", () => {
            expect(target("wiki:p4-ohne-form")).toEqual({ kind: "none" });
            expect(target("wiki:p4-dorf-verborgen")).toEqual({ kind: "none" });
        });

        it("🔴 der Namensraum gehört zum Key: der inoffizielle Artikel gleichen Titels ist ein eigenes Objekt", () => {
            expect(target("wiki:p4-dju-imen")).toEqual({ kind: "one", ref: { kind: "place", id: NEU.djuimen } });
            expect(target("wiki:inoffiziell-p4-dju-imen")).toEqual({
                kind: "one",
                ref: { kind: "place", id: NEU.djuimenInoffiziell },
            });
        });

        it("jeder Träger kennt den Key seines Artikels, die Abschnitte eines Wegs teilen EINEN", () => {
            expect(pageKeysOf(lookup, "place", [P4.gareth])).toEqual(["wiki:p4t-gareth"]);
            expect(pageKeysOf(lookup, "peak", [P4.gipfel])).toEqual(["wiki:p4t-gipfel"]);
            expect(pageKeysOf(lookup, "powerline", [P4.linieEins, P4.linieZwei])).toEqual(["wiki:p4t-kraftlinie"]);
            expect(pageKeysOf(lookup, "path", [P4.flussEins, P4.flussZwei, P4.flussDrei])).toEqual([
                "wiki:p4t-grossfluss",
            ]);
            expect(pageKeysOf(lookup, "area", [P4.archipelA, P4.archipelB])).toEqual(["wiki:p4-archipel"]);
            // Das Gebiet, der Ort ohne Zuordnung und ein Dorf ohne Seite haben keinen Artikel.
            expect(pageKeysOf(lookup, "place", [P4.dorf])).toEqual([]);
            expect(pageKeysOf(lookup, "place", [P4.dorfVerborgen])).toEqual([]);
        });
    });

    describe("Ort: Verkehrswege und Lage", () => {
        it("🔴 Verkehrswege: nur das Teilstück, für das der Artikel ein Linkziel nennt, dessen Wiki-Key ein Objekt trägt, ist ein Link - an seiner Stelle", async () => {
            const result = await detail({ kind: "place", id: NEU.wegeprobe });
            const roads = textFact(result, "verkehrswege");
            expect(roads?.value).toBe(VERKEHRSWEGE);
            // „Eins“ und „Großfluss“ nennen eine Seite mit Objekt. „Zwei“ nennt eine Seite ohne Objekt (Text); „P4 Waldweg“ ist der Name eines
            // echten Wegs ohne Zuweisung (Text, nie über den Namen).
            expect(roads?.links).toEqual([
                {
                    text: "Eins",
                    ref: { kind: "path", anchor: P4.strasseEins, wiki: "p4t-strasse-eins" },
                    at: VERKEHRSWEGE.indexOf("Eins"),
                },
                {
                    text: "Großfluss",
                    ref: { kind: "path", anchor: P4.flussEins, wiki: "p4t-grossfluss" },
                    at: VERKEHRSWEGE.indexOf("Großfluss"),
                },
            ]);
        });

        it("🔴 derselbe Text ohne Artikel in X1 bleibt Text, auch wenn jeder Name ein Objekt der Karte ist (Orte, deren Seite der Dump-Lauf nicht hat)", async () => {
            const result = await detail({ kind: "place", id: NEU.wegeLeer });
            expect(textFact(result, "verkehrswege")?.value).toBe(VERKEHRSWEGE);
            expect(textFact(result, "verkehrswege")?.links).toBeUndefined();
        });

        it("🔴 ein Ort ohne Zuordnung in X2 hat keinen Artikel und keine Links", async () => {
            const result = await detail({ kind: "place", id: P4.dorfAdresse });
            expect(linkedFacts(result)).toEqual([]);
        });

        it("🔴 die Lage aus Region und Staat: nur die Teilstücke mit Linkziel und Key-Treffer werden Links - auch {{Pol|X}} als Vorlage -, der Rest bleibt Text, der eigene Wert auch", async () => {
            const result = await detail({ kind: "place", id: NEU.lageprobe });
            const lage = textFact(result, "lage")?.value ?? "";
            expect(lage).toBe(
                "P4 Landstrich: P4 Meer · P4 Reich; P4 Provinz West (Teilgebiet); P4 Ohne Form; Reichsstadt (nur P4 Gareth)",
            );
            // „P4 Landstrich“ (Region), „P4 Provinz West“ ({{Pol|…}}) und „P4 Gareth“ treffen über ihren Key genau ein Objekt. „P4 Meer“ ist der NAME einer
            // Landschaft ohne Zuordnung, „P4 Reich“ der eines Gebiets (die Vorlage nennt einen Key ohne Objekt), „P4 Ohne Form“ ein Gebiet ohne Form.
            expect(textFact(result, "lage")?.links).toEqual([
                { text: "P4 Landstrich", ref: { kind: "area", id: P4.landstrich }, at: 0 },
                {
                    text: "P4 Provinz West",
                    ref: { kind: "territory", id: P4.provinzWest },
                    at: lage.indexOf("P4 Provinz West"),
                },
                { text: "P4 Gareth", ref: { kind: "place", id: P4.gareth }, at: lage.indexOf("P4 Gareth") },
            ]);
            expect(textFact(result, "lage", "direct")?.value).toBe("P4 Nachbarreich, Unbekannt");
            expect(textFact(result, "lage", "direct")?.links).toBeUndefined();
            expect(linkedFacts(result)).toEqual(["lage"]);
        });

        it("die Kontextwerte mit Kennung bleiben Links (Gebiete und Landschaften aus der Geometrie, nicht aus Namen)", async () => {
            const result = await detail({ kind: "place", id: P4.gareth });
            expect(result.context?.territories?.chains.length).toBeGreaterThan(0);
            for (const entry of result.context?.territories?.chains.flat() ?? []) {
                expect(entry.ref.kind).toBe("territory");
            }
            expect(result.context?.landscapes?.items.length).toBeGreaterThan(0);
            for (const item of result.context?.landscapes?.items ?? []) expect(item.ref.kind).toBe("area");
        });
    });

    describe("Landschaft: Region, Staat, Verkehrswege und die Nachbarn mit Linkzielen, der Kontinent bleibt Text", () => {
        it("🔴 Region, Staat und Verkehrswege: nur Linkziele mit Key-Treffer, an ihrer Stelle; jeder Name ohne Treffer bleibt Text", async () => {
            const area = await detail({ kind: "area", id: NEU.hochland });
            // Kein X1-Feld für den Kontinent: er bleibt Text, auch wenn „P4 Landstrich“ ein Objekt der Karte ist.
            expect(textFact(area, "continent")?.value).toBe("P4 Landstrich");
            expect(textFact(area, "continent")?.links).toBeUndefined();
            expect(textFact(area, "regionParent")?.links).toEqual([
                { text: "P4 Meer", ref: { kind: "area", id: P4.meer }, at: 0 },
            ]);
            // „P4 Reich“ ist {{Pol|P4 Reich}} ohne Objekt (Text); „P4 Archipel“ trifft die Gruppe seiner zwei Flächen.
            const staat = textFact(area, "affiliationStaat");
            expect(staat?.value).toBe("nominell P4 Reich, P4 Archipel");
            expect(staat?.links).toEqual([
                {
                    text: "P4 Archipel",
                    ref: { kind: "area", id: P4.archipelA, group: [P4.archipelB] },
                    at: "nominell P4 Reich, ".length,
                },
            ]);
            const roads = textFact(area, "verkehrswege");
            expect(roads?.value).toBe("P4 Großfluss, Unbekannter Weg, P4 Meer");
            expect(roads?.links).toEqual([
                { text: "P4 Großfluss", ref: { kind: "path", anchor: P4.flussEins, wiki: "p4t-grossfluss" }, at: 0 },
                { text: "P4 Meer", ref: { kind: "area", id: P4.meer }, at: "P4 Großfluss, Unbekannter Weg, ".length },
            ]);
        });

        it("🔴 Nachbarn: je Richtung nur die Namen mit Linkziel und Key-Treffer, mit dem Wert und der Stelle IM Wert; ein mehrdeutiger Key bleibt Text", async () => {
            const area = await detail({ kind: "area", id: NEU.hochland });
            const north = listFacts(area, "neighbors").find((fact) => fact.direction === "N");
            const east = listFacts(area, "neighbors").find((fact) => fact.direction === "O");
            expect(north?.values).toEqual(["P4 Waldwildnis", "Unbekannt"]);
            expect(east?.values).toEqual(["P4 Landstrich (Region)", "P4 Fasar / P4 Meer"]);
            // Die Waldwildnis teilt ihren Artikel mit dem Nordwald: mehrdeutig, kein Link.
            expect(north?.links).toBeUndefined();
            // „P4 Fasar“ teilt seinen Artikel mit dem Gebiet (mehrdeutig, Text), „P4 Landstrich“ und „P4 Meer“ treffen genau ein Objekt.
            expect(east?.links).toEqual([
                { value: 0, text: "P4 Landstrich", ref: { kind: "area", id: P4.landstrich }, at: 0 },
                { value: 1, text: "P4 Meer", ref: { kind: "area", id: P4.meer }, at: "P4 Fasar / ".length },
            ]);
            expect(linkedFacts(area)).toEqual(["regionParent", "affiliationStaat", "verkehrswege", "neighbors"]);
        });

        it("der Gipfel hat keinen Artikel in X1: seine Textfelder tragen keine Links", async () => {
            const peak = await detail({ kind: "peak", id: P4.gipfel });
            expect(linkedFacts(peak)).toEqual([]);
        });

        it("die Antwort hält ihr Schema und kein leeres Bauteil (keine leere `links`-Liste)", async () => {
            for (const request of [
                { kind: "area", id: NEU.hochland },
                { kind: "place", id: NEU.wegeprobe },
                { kind: "place", id: NEU.lageprobe },
                { kind: "place", id: P4.gareth },
            ] as const) {
                const result = await detail(request);
                for (const fact of result.facts ?? []) {
                    if ("links" in fact && fact.links !== undefined) expect(fact.links.length).toBeGreaterThan(0);
                }
            }
        });
    });

    describe("Weg und Kraftlinie: Lage, Verlauf und Regionen mit Linkzielen", () => {
        it("die Lage und der Verlauf eines Wegs sind Text, solange der angezeigte Text keinen Anzeigetext der Links nennt", async () => {
            const path = await detail({ kind: "path", chain: "P4 Großfluss:Flussweg" });
            expect(textFact(path, "lage")?.value).toBe("Lage des Wegs");
            expect(textFact(path, "lage")?.links).toBeUndefined();
            expect(textFact(path, "verlauf")?.links).toBeUndefined();
        });

        it("🔴 der Verlauf nennt ALLE Links des Rohtexts: nur, wessen Anzeigetext im angezeigten Verlauf steht UND dessen Key ein Objekt trägt, wird ein Link - auch ein Ort mit genau diesem Namen ist ohne Key kein Link", async () => {
            await database`UPDATE wiki_path_snapshot SET verlauf = 'P4 Gareth → Niemandsland → P4 Dorf Eins', lage = 'P4 Landstrich' WHERE wiki_key = 'p4t-grossfluss'`;
            try {
                const fresh = createSubjectService(database);
                const path = await fresh.detail({ kind: "path", chain: "P4 Großfluss:Flussweg" });
                const verlauf = path?.facts?.find(
                    (fact): fact is SubjectTextFact => fact.field === "verlauf" && "value" in fact,
                );
                expect(verlauf?.value).toBe("P4 Gareth → Niemandsland → P4 Dorf Eins");
                // „Seeweg“ steht nicht im angezeigten Verlauf (der Weg eines Abzweigs), „Niemandsland“ und „P4 Dorf Eins“ tragen keinen Key mit Objekt.
                expect(verlauf?.links).toEqual([{ text: "P4 Gareth", ref: { kind: "place", id: P4.gareth }, at: 0 }]);
                const lage = path?.facts?.find(
                    (fact): fact is SubjectTextFact => fact.field === "lage" && "value" in fact,
                );
                expect(lage?.links).toEqual([
                    { text: "P4 Landstrich", ref: { kind: "area", id: P4.landstrich }, at: 0 },
                ]);
            } finally {
                await database`UPDATE wiki_path_snapshot SET verlauf = 'Von West nach Ost', lage = 'Lage des Wegs' WHERE wiki_key = 'p4t-grossfluss'`;
            }
        });

        it("die Kraftlinie trägt die Regionen mit Linkziel als Link und den Verlauf ohne Linkziel als Text", async () => {
            const line = await detail({ kind: "powerline", id: P4.linieEins });
            expect(textFact(line, "regionen")?.value).toBe("Garetien");
            expect(textFact(line, "regionen")?.links).toEqual([
                { text: "Garetien", ref: { kind: "area", id: P4.huegel }, at: 0 },
            ]);
            expect(textFact(line, "verlauf")?.links).toBeUndefined();
        });
    });

    describe("Klimaband als Gegenstand mit Kopf", () => {
        it("🔴 Name, Art und Ziel: nur der Kopf, keine Felder, keine Quellen, kein Kanon", async () => {
            const result = await service.climate("gemaessigt");
            expect(result).not.toBeNull();
            expect(Value.Check(SubjectDetail, result)).toBe(true);
            expect(result?.subject).toEqual({ kind: "climate", band: "gemaessigt" });
            expect(result?.title).toBe("Gemäßigte Zone");
            expect(result?.subtitle).toEqual([{ part: "layer", key: "klima" }]);
            expect(result?.target?.zoom).toBe(renderZoomForBand(1));
            expect(Number.isFinite(result?.target?.x)).toBe(true);
            expect(Number.isFinite(result?.target?.y)).toBe(true);
            // Mehr kennt die Karte von einem Band nicht.
            expect(Object.keys(result ?? {}).sort()).toEqual(["revision", "subject", "subtitle", "target", "title"]);
        });

        it("ein Schlüssel, der keine aktive Zone mit Form nennt, gibt es nicht", async () => {
            expect(await service.climate("gibt_es_nicht")).toBeNull();
        });

        it("GET /api/subjects/climate/{band}: 200, kurz im Cache; unbekannt 404; ein ungültiger Schlüssel 400", async () => {
            app = buildApp({
                config,
                database: createDatabase(testDatabaseUrl as string, { max: 4 }),
                logStream: SILENT,
            });
            const ok = await app.inject({ url: "/api/subjects/climate/gemaessigt" });
            expect(ok.statusCode).toBe(200);
            expect(ok.headers["cache-control"]).toContain("max-age=");
            expect(ok.json<SubjectDetailType>().title).toBe("Gemäßigte Zone");
            expect((await app.inject({ url: "/api/subjects/climate/gibt_es_nicht" })).statusCode).toBe(404);
            expect((await app.inject({ url: "/api/subjects/climate/GROSS" })).statusCode).toBe(400);
        });
    });
});
