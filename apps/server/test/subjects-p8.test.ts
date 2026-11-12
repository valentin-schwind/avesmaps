import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_PUBLIC_URL_PATTERN,
    SubjectCitymapsSection,
    SubjectDetail,
    SubjectLiteratureSection,
    SubjectReviewsSection,
    openLiteratureCount,
} from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { editionSortKey } from "../src/subjects/sections/literature.ts";
import { createSubjectService, type DetailRequest, type SubjectService } from "../src/subjects/service.ts";
import { P8, cleanP8Fixtures, insertP8Fixtures } from "./support/p8-fixture.ts";

/**
 * Die Katalogabschnitte des Infopanels (WI-0063 P8) gegen echtes PostgreSQL: Zähler in der Detailantwort, Literatur in Legacys
 * Reihenfolge mit dem Spoiler an seinem Sortierplatz, Kartensammlung nach Titel, Bewertungen neueste zuerst samt Durchschnitt.
 *
 * 🔴 Geprüft wird vor allem, was NICHT da ist: keine „(0)“, kein geerbter Zähler, keine Personenspalte in einer Bewertung, kein
 * doppeltes Werk an einer Weggruppe und keine Zahl, die verrät, wie viel an einem Ort gespielt wird.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Eine Kennung, die es in der Testwelt nicht gibt. */
const p8Unbekannt = "80000000-0000-4000-8000-0000000000ff";

/** Die EINE Form einer öffentlichen Medienadresse (`MEDIA_PUBLIC_URL_PATTERN`). */
const MEDIA_URL = new RegExp(MEDIA_PUBLIC_URL_PATTERN);

const STADT: DetailRequest = { kind: "place", id: P8.stadt };
const WEILER: DetailRequest = { kind: "place", id: P8.weiler };
const SPOILER_ORT: DetailRequest = { kind: "place", id: P8.spoilerOrt };
const FLUSS: DetailRequest = { kind: "path", anchor: P8.flussEins };

describeWithDatabase("Katalogabschnitte des Infopanels (WI-0063 P8) gegen PostgreSQL", () => {
    let database: Database;
    let service: SubjectService;

    beforeAll(async () => {
        // 🪤 Ein kleiner Pool: Die Suite läuft ohnehin seriell (`fileParallelism: false`), und der gemeinsame
        // Entwicklungscluster lässt nur 50 Verbindungen zu - Martin allein hält 20 je Instanz.
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        // Idempotent, und damit läuft die Suite auch gegen einen frisch angelegten Cluster.
        await seedMapDomains(database);
        await insertP8Fixtures(database);
        service = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        await cleanP8Fixtures(database);
        await database.end({ timeout: 5 });
    });

    describe("Die Zähler der Detailantwort", () => {
        it("🔴 ein reicher Ort zählt jede Sektion, und die Antwort ist gültig", async () => {
            const detail = await service.detail(STADT);
            expect(Value.Check(SubjectDetail, detail)).toBe(true);
            // Vier Werke am Ort: zwei offen (start, covers), zwei verdeckt - gezählt werden NUR die offenen.
            expect(detail?.counts).toEqual({ literature: 2, literatureHidden: true, citymaps: 4, reviews: 3 });
        });

        it("🔴 ein Ort ohne Katalog hat keinen Zähler - nie eine Null (WI-0063 5.3)", async () => {
            const detail = await service.detail(WEILER);
            expect(detail?.counts).toBeUndefined();
        });

        it("🔴 nur verdeckte Werke: kein `literature`, aber `literatureHidden` - die Zahl verrät nichts", async () => {
            const detail = await service.detail(SPOILER_ORT);
            expect(detail?.counts).toEqual({ literatureHidden: true });
        });

        it("eine Weggruppe zählt ihr Werk EINMAL, obwohl es an beiden Abschnitten hängt", async () => {
            for (const anchor of [P8.flussEins, P8.flussZwei]) {
                const detail = await service.detail({ kind: "path", anchor });
                expect(detail?.counts, anchor).toEqual({ literature: 1 });
            }
        });

        it("🔴 nichts wird geerbt: die Karten und Bewertungen der Stadt zählen am Nachbarort nicht mit", async () => {
            expect((await service.detail(WEILER))?.counts).toBeUndefined();
            expect((await service.reviews(WEILER))?.count).toBe(0);
            expect((await service.citymaps(WEILER))?.maps).toEqual([]);
            expect((await service.literature(WEILER))?.works).toEqual([]);
        });
    });

    describe("Die Sektion Literatur", () => {
        it("🔴 Legacys Reihenfolge: Edition absteigend, dann Jahr absteigend, dann Titel - die Rolle geht NICHT ein", async () => {
            const section = await service.literature(STADT);
            expect(Value.Check(SubjectLiteratureSection, section)).toBe(true);
            // DSA5 -> DSA4.1 -> DSA4 -> ohne Edition; das verdeckte DSA4.1-Werk steht MITTEN darin, nicht am Ende.
            expect(section?.works.map((work) => work.title)).toEqual([
                "P8 Neues Werk",
                "P8 Verdecktes Werk",
                "P8 Altes Werk",
                "P8 Werk ohne Edition",
            ]);
        });

        it("je Werk Titel, Artikel, Art, Edition, Jahr, Sammelwerk und Laden - nichts Leeres", async () => {
            const works = (await service.literature(STADT))?.works ?? [];
            expect(works.find((work) => work.title === "P8 Altes Werk")).toEqual({
                id: P8.werkAlt,
                title: "P8 Altes Werk",
                url: "https://de.wiki-aventurica.de/wiki/P8_Altes_Werk",
                productType: "regionalspielhilfe",
                edition: "DSA4",
                year: "1021 BF",
                bfYear: 1021,
                containedIn: "P8 Sammelband",
                role: "covers",
                shop: { kind: "fshop", url: "https://www.f-shop.de/p8-alt" },
                genres: ["Dungeon", "Reise"],
                complexity: "niedrig",
                official: false,
                links: [
                    { label: "F-Shop", url: "https://www.f-shop.de/p8-alt", paid: true },
                    { label: "Wiki Aventurica", url: "https://de.wiki-aventurica.de/wiki/P8_Altes_Werk", paid: false },
                    {
                        label: "Dt. Nationalbibliothek",
                        url: "https://portal.dnb.de/opac/simpleSearch?query=P8%20Altes%20Werk",
                        paid: false,
                    },
                ],
            });
            // Ein Werk ohne Angaben trägt NUR, was es hat (kein `edition: null`, kein leerer Text) - und die Titelsuche der
            // Nationalbibliothek, die es für jedes Werk gibt.
            expect(works.find((work) => work.title === "P8 Werk ohne Edition")).toEqual({
                id: P8.werkOhneEdition,
                title: "P8 Werk ohne Edition",
                productType: "gruppenabenteuer",
                role: "play",
                official: true,
                links: [
                    {
                        label: "Dt. Nationalbibliothek",
                        url: "https://portal.dnb.de/opac/simpleSearch?query=P8%20Werk%20ohne%20Edition",
                        paid: false,
                    },
                ],
            });
        });

        it("🔴 Ulisses eBook gewinnt vor F-Shop (Legacy `advBestLink`)", async () => {
            const works = (await service.literature(STADT))?.works ?? [];
            expect(works.find((work) => work.title === "P8 Neues Werk")?.shop).toEqual({
                kind: "ulisses",
                url: "https://ulisses-ebooks.de/p8-neu",
            });
        });

        it("🔴 ALLE Links in Legacys Klickreihenfolge: Ulisses eBook, F-Shop, Wiki Aventurica, Nationalbibliothek - Läden kostenpflichtig", async () => {
            const neu = ((await service.literature(STADT))?.works ?? []).find((work) => work.title === "P8 Neues Werk");
            expect(neu?.links).toEqual([
                { label: "Ulisses eBook", url: "https://ulisses-ebooks.de/p8-neu", paid: true },
                { label: "F-Shop", url: "https://www.f-shop.de/p8-neu", paid: true },
                { label: "Wiki Aventurica", url: "https://de.wiki-aventurica.de/wiki/P8_Neues_Werk", paid: false },
                {
                    label: "Dt. Nationalbibliothek",
                    url: "https://portal.dnb.de/opac/simpleSearch?query=P8%20Neues%20Werk",
                    paid: false,
                },
            ]);
        });

        it("🔴 Schlagworte am Komma getrennt (getrimmt, ohne Leere und Dopplung), Schwierigkeit wie Legacy: Spielleitung, sonst Spielende", async () => {
            const works = (await service.literature(STADT))?.works ?? [];
            const neu = works.find((work) => work.title === "P8 Neues Werk");
            expect(neu?.genres).toEqual(["Stadtabenteuer", "Kriegsszenario"]);
            // `complexity_gm || complexity_pl`: Hier stehen beide, die Spielleitung gewinnt.
            expect(neu?.complexity).toBe("hoch");
            const alt = works.find((work) => work.title === "P8 Altes Werk");
            expect(alt?.genres).toEqual(["Dungeon", "Reise"]);
            expect(alt?.complexity).toBe("niedrig");
            // Ohne Angabe fehlt das Feld ganz.
            const ohne = works.find((work) => work.title === "P8 Werk ohne Edition");
            expect(ohne).not.toHaveProperty("genres");
            expect(ohne).not.toHaveProperty("complexity");
        });

        it("🔴 kein Prüfzustand der Links (online, offline) in keinem Eintrag und keinem Link", async () => {
            for (const work of (await service.literature(STADT))?.works ?? []) {
                expect(Object.keys(work), work.title).not.toContain("state");
                for (const link of work.links ?? []) {
                    expect(
                        Object.keys(link)
                            .sort()
                            .filter((key) => key !== "paid"),
                    ).toEqual(["label", "url"]);
                }
            }
        });

        it("🔴 zwei Rollen am selben Ort: EIN Eintrag, und die OFFENE Rolle gewinnt - offen Stehendes wird nicht verdeckt", async () => {
            const works = (await service.literature(STADT))?.works ?? [];
            expect(works.filter((work) => work.title === "P8 Neues Werk")).toHaveLength(1);
            expect(works.find((work) => work.title === "P8 Neues Werk")?.role).toBe("start");
        });

        it("die Zahl der Überschrift ist die Zahl der OFFENEN Werke, und sie stimmt mit dem Zähler überein", async () => {
            const section = await service.literature(STADT);
            expect(openLiteratureCount(section?.works ?? [])).toBe((await service.detail(STADT))?.counts?.literature);
        });

        it("eine Weggruppe liefert ihr Werk einmal, mit der offenen Rolle beider Abschnitte", async () => {
            const section = await service.literature(FLUSS);
            expect(section?.works).toEqual([
                {
                    id: P8.werkFluss,
                    title: "P8 Flusswerk",
                    edition: "DSA5",
                    productType: "gruppenabenteuer",
                    role: "start",
                    official: true,
                    links: [
                        {
                            label: "Dt. Nationalbibliothek",
                            url: "https://portal.dnb.de/opac/simpleSearch?query=P8%20Flusswerk",
                            paid: false,
                        },
                    ],
                },
            ]);
        });

        it("🔴 der Umschlag kommt über den Media Core, und nur, wenn die Policy ihn freigibt (MEDIA-M14)", async () => {
            const works = (await service.literature(STADT))?.works ?? [];
            const neu = works.find((work) => work.title === "P8 Neues Werk");
            expect(neu?.cover).toMatchObject({
                role: "literature_cover",
                mimeType: "image/webp",
                width: 424,
                height: 600,
            });
            expect(neu?.cover?.url).toMatch(MEDIA_URL);
            // Eine Bindung OHNE veröffentlichte Datei liefert kein Bild - kein Fehler, nur kein Umschlag.
            expect(works.find((work) => work.title === "P8 Altes Werk")?.cover).toBeUndefined();
            // Eine Datei, die die Policy nicht freigibt (`permission` ohne Regel), ebenso wenig.
            expect(works.find((work) => work.title === "P8 Werk ohne Edition")?.cover).toBeUndefined();
        });

        it("🔴 ein verdecktes Werk trägt seinen Umschlag: der Deckel liegt darüber, er ersetzt ihn nicht", async () => {
            const works = (await service.literature(STADT))?.works ?? [];
            const verdeckt = works.find((work) => work.title === "P8 Verdecktes Werk");
            expect(verdeckt?.role).toBe("play");
            expect(verdeckt?.cover?.url).toMatch(MEDIA_URL);
        });

        it("🔴 die Antwort nennt nie einen Speicherschlüssel, einen Prompt oder eine Notiz - nur die öffentliche Sicht", async () => {
            const works = (await service.literature(STADT))?.works ?? [];
            const cover = works.find((work) => work.title === "P8 Neues Werk")?.cover;
            expect(Object.keys(cover ?? {}).sort()).toEqual(["height", "id", "mimeType", "role", "url", "width"]);
        });

        it("ein Subject, das es nicht gibt, ist `null` (404 in der Route), keine leere Sektion", async () => {
            expect(await service.literature({ kind: "place", id: p8Unbekannt })).toBeNull();
            expect(await service.citymaps({ kind: "place", id: p8Unbekannt })).toBeNull();
            expect(await service.reviews({ kind: "place", id: p8Unbekannt })).toBeNull();
        });
    });

    describe("Die Sektion Kartensammlung", () => {
        it("🔴 nach Titel sortiert (Legacys Katalogreihenfolge), nicht nach Anlage", async () => {
            const section = await service.citymaps(STADT);
            expect(Value.Check(SubjectCitymapsSection, section)).toBe(true);
            expect(section?.maps.map((entry) => entry.title)).toEqual([
                "P8 Karte Eins",
                "P8 Karte Spoiler",
                "P8 Karte Voll",
                "P8 Karte Zwei",
            ]);
        });

        it("die Fundstelle mit Name, Adresse und dreiwertigem `paid`; ohne Fundstelle fehlt sie ganz", async () => {
            const maps = (await service.citymaps(STADT))?.maps ?? [];
            expect(maps.find((entry) => entry.title === "P8 Karte Zwei")?.find).toEqual({
                label: "Wiki Aventurica",
                url: "https://example.org/p8-zwei",
                paid: false,
            });
            // Eine Karte ohne jede Angabe trägt NUR ihre Kennung und ihren Titel: nichts Unbekanntes wird erfunden.
            expect(maps.find((entry) => entry.title === "P8 Karte Eins")).toEqual({
                id: P8.karteB,
                title: "P8 Karte Eins",
            });
        });

        it("🔴 ALLE Eigenschaften einer Karte: Band, Typen, Art, Farbmodus, offiziell, Maßstab, Zeitraum, Format, Zeichner, Verlag, Auflösung, Notiz", async () => {
            const zwei = ((await service.citymaps(STADT))?.maps ?? []).find((entry) => entry.title === "P8 Karte Zwei");
            expect(zwei).toMatchObject({
                id: P8.karteA,
                // Die ERSTE Quelle ist der Band (Legacy `cityMapBandLabel`), gleich in welcher Reihenfolge sie angelegt wurde.
                band: "P8 Band Eins",
                types: ["ortsplan", "stadtplan"],
                art: "derographisch",
                colorMode: "farbig",
                official: true,
                labeled: false,
                hasScale: true,
                validFrom: 1027,
                // 9999 ist Legacys offenes Ende und bleibt wörtlich stehen; der Leser macht „seit 1027 BF“ daraus.
                validTo: 9999,
                format: "A2",
                author: "P8 Zeichner",
                publisher: "P8 Verlag",
                widthPx: 1240,
                heightPx: 896,
                note: "Format: A2 . Maßstab: Ja",
            });
            // 🔴 Unbekannt FEHLT: `multilevel` hat niemand erfasst - es steht nicht als `false` da.
            expect(zwei).not.toHaveProperty("multilevel");
        });

        it("🔴 ALLE Fundstellen, Karten-Link zuerst und dann Legacys Klickreihenfolge; der Host benennt sie, nicht das Wort „Karte“", async () => {
            const zwei = ((await service.citymaps(STADT))?.maps ?? []).find((entry) => entry.title === "P8 Karte Zwei");
            expect(zwei?.links).toEqual([
                // Der F-Shop kam als zweite weitere Fundstelle und rückt vor alles andere: Läden zuerst, und sie kosten.
                { label: "F-Shop", url: "https://www.f-shop.de/p8-zwei", paid: true },
                // Der Karten-Link trägt den Titel des Bestands, und er ist bekannt frei.
                { label: "Wiki Aventurica", url: "https://example.org/p8-zwei", paid: false },
                { label: "deviantArt", url: "https://www.deviantart.com/p8/art/zwei" },
            ]);
            // `find` bleibt, was es war: die Fundstelle des Streifens.
            expect(zwei?.find).toEqual({ label: "Wiki Aventurica", url: "https://example.org/p8-zwei", paid: false });
        });

        it("🔴 das Vollbild kommt über denselben Media Core wie die Vorschau - und nur, wo die Policy es freigibt", async () => {
            const maps = (await service.citymaps(STADT))?.maps ?? [];
            const voll = maps.find((entry) => entry.title === "P8 Karte Voll");
            expect(voll?.full).toMatchObject({ role: "map_full", mimeType: "image/webp", width: 1240, height: 896 });
            expect(voll?.full?.url).toMatch(MEDIA_URL);
            expect(voll?.preview).toMatchObject({ role: "map_preview", width: 400, height: 289 });
            // Die übrigen Karten haben keins - kein Fehler, nur kein Bild.
            for (const entry of maps.filter((other) => other.title !== "P8 Karte Voll")) {
                expect(entry, entry.title).not.toHaveProperty("full");
            }
        });

        it("🔴 jeder Eintrag ist ein gültiger Vertragsteil, und keiner trägt einen Prüfzustand der Links", async () => {
            const section = await service.citymaps(STADT);
            expect(Value.Check(SubjectCitymapsSection, section)).toBe(true);
            for (const entry of section?.maps ?? []) {
                expect(Object.keys(entry), entry.title).not.toContain("state");
                expect(Object.keys(entry), entry.title).not.toContain("linkStatus");
            }
        });

        it("🪤 nur ein ausdrückliches `is_spoiler` verdeckt; ein unbekanntes (NULL) ist KEIN Spoiler", async () => {
            const maps = (await service.citymaps(STADT))?.maps ?? [];
            expect(maps.find((entry) => entry.title === "P8 Karte Spoiler")?.spoiler).toBe(true);
            expect(maps.find((entry) => entry.title === "P8 Karte Eins")?.spoiler).toBeUndefined();
        });

        it("🔴 die Vorschau kommt über den Media Core; eine Karte ohne Bindung hat KEINE (MEDIA-M14)", async () => {
            const maps = (await service.citymaps(STADT))?.maps ?? [];
            const zwei = maps.find((entry) => entry.title === "P8 Karte Zwei");
            expect(zwei?.preview).toMatchObject({
                role: "map_preview",
                mimeType: "image/webp",
                width: 296,
                height: 400,
            });
            expect(zwei?.preview?.url).toMatch(MEDIA_URL);
            // Keine Bindung, kein Bild - und das ist kein Fehler.
            expect(maps.find((entry) => entry.title === "P8 Karte Eins")?.preview).toBeUndefined();
        });

        it("🔴 auch eine verdeckte Karte trägt ihre Vorschau: der Deckel liegt darüber, er ersetzt sie nicht", async () => {
            const maps = (await service.citymaps(STADT))?.maps ?? [];
            const spoiler = maps.find((entry) => entry.title === "P8 Karte Spoiler");
            expect(spoiler?.spoiler).toBe(true);
            expect(spoiler?.preview?.url).toMatch(MEDIA_URL);
        });
    });

    describe("Die Sektion Bewertungen", () => {
        it("🔴 neueste zuerst, Anzahl und Durchschnitt über ALLE sichtbaren", async () => {
            const section = await service.reviews(STADT);
            expect(Value.Check(SubjectReviewsSection, section)).toBe(true);
            expect(section?.count).toBe(3);
            expect(section?.average).toBe(4);
            expect(section?.reviews.map((entry) => entry.stars)).toEqual([3, 4, 5]);
        });

        it("je Bewertung Sterne, Autor, Text und aventurisches Datum; was fehlt, fehlt (nie als leerer Text)", async () => {
            const reviews = (await service.reviews(STADT))?.reviews ?? [];
            // Die öffentliche Kennung (WI-0269) steht an jeder Bewertung; ohne „Gefällt mir“ fehlt `likes`.
            const kennung = expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
            ) as unknown as string;
            expect(reviews.find((entry) => entry.author === "P8 Erste")).toEqual({
                id: kennung,
                stars: 5,
                author: "P8 Erste",
                text: "Ein Gewimmel.",
                date: "3. Praios 1047 BF",
            });
            expect(reviews.find((entry) => entry.stars === 3)).toEqual({ id: kennung, stars: 3 });
        });

        it("🔴 DATENSCHUTZ: die Antwort trägt keine laufende Nummer, keine Anlagezeit und keine Personenspalte", async () => {
            const reviews = (await service.reviews(STADT))?.reviews ?? [];
            for (const entry of reviews) {
                // Erlaubt: Sterne, Autor, Text, Datum, die öffentliche Kennung (Teilen, Gefällt mir, Melden) und die Zahl „Gefällt mir“.
                expect(Object.keys(entry).sort()).toEqual(
                    Object.keys(entry)
                        .filter((key) => ["id", "likes", "stars", "author", "text", "date"].includes(key))
                        .sort(),
                );
            }
            // Auch die Tabelle selbst hat keine (Migration 0075); ein neuer Lesepfad könnte sie sonst versehentlich nennen.
            const columns = await database<{ column_name: string }[]>`
                SELECT column_name FROM information_schema.columns WHERE table_name = 'place_review'
            `;
            const names = columns.map((row) => row.column_name);
            for (const forbidden of [
                "ip_hash",
                "ip",
                "user_agent",
                "request_origin",
                "user_id",
                "account_id",
                "email",
            ]) {
                expect(names, forbidden).not.toContain(forbidden);
            }
        });

        it("🔴 nur Orte haben Bewertungen: eine Weggruppe bekommt eine leere Sektion, keinen Fehler", async () => {
            const section = await service.reviews(FLUSS);
            expect(section).toMatchObject({ count: 0, reviews: [] });
            expect(section?.average).toBeUndefined();
        });
    });

    describe("Die Routen", () => {
        it("jede Sektion steht unter `{detail}/{sektion}` und trägt die Revision des Datenstands", async () => {
            const detail = await service.detail(STADT);
            for (const section of [
                await service.literature(STADT),
                await service.citymaps(STADT),
                await service.reviews(STADT),
            ]) {
                expect(section?.revision).toBe(detail?.revision);
                expect(section?.subject).toEqual({ kind: "place", id: P8.stadt });
            }
        });
    });
});

describe("Legacys Sortierschlüssel der Edition (`avesmapsGameLiteratureEditionSortKey`)", () => {
    it("DSA5 vor DSA4.1 vor DSA4 vor DSA1, ein Nicht-DSA-Regelwerk danach, ohne Edition zuletzt", () => {
        const keys = ["DSA5", "DSA4.1", "DSA4", "DSA1", "Aventuria 2.0", null].map(editionSortKey);
        expect(keys).toEqual([-5, -4.1, -4, -1, 1000, 1001]);
        expect([...keys].sort((left, right) => left - right)).toEqual(keys);
    });

    it("gerechnet wird mit der ERSTEN Zahl im Text", () => {
        expect(editionSortKey("DSA4.1 Basis")).toBe(-4.1);
        expect(editionSortKey("DSA1-Ausbau")).toBe(-1);
        expect(editionSortKey("DSA4/DSA5")).toBe(-4);
        expect(editionSortKey("   ")).toBe(1001);
        expect(editionSortKey("regelfrei")).toBe(1000);
    });
});
