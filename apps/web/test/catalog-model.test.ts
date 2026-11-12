import { describe, expect, it } from "vitest";
import type {
    CitymapEntry,
    LiteratureEntry,
    SubjectCitymapsSection,
    SubjectCounts,
    SubjectLiteratureSection,
    SubjectReviewsSection,
} from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import {
    catalogCredit,
    catalogHeading,
    catalogsOf,
    citymapsModelOf,
    fetchCatalog,
    literatureModelOf,
    literatureTypeLabel,
    loadCatalog,
    reviewsModelOf,
    starsOf,
    type CatalogAnswer,
} from "../src/info-panel/catalog-model.ts";
import { createRevisionCache } from "../src/info-panel/subject-cache.ts";
import { GARETH_ID, REVISION } from "./panel-fixtures.ts";

/**
 * Die Katalogabschnitte des Infopanels (WI-0063 P8, Design Guide §16.4 und §16.6; Legacy `map-features-place-extras.js` und
 * `location-reviews.js`, Mirror `04a85a54f`): Überschrift im Satzmuster, keine „(0)“, Spoiler zählt nicht mit, Sterne mit halber
 * Füllung, und eine Frage, die abbrechbar ist und bei Last von selbst wiederholt.
 */

const GARETH = { kind: "place" as const, id: GARETH_ID };

/** Ein freigegebener Umschlag, so wie der Media Core ihn liefert (MEDIA-M14). */
const COVER = {
    id: "11111111-2222-4333-8444-555555555555",
    role: "literature_cover" as const,
    url: `/media/sha256/44/f4/${"44f434f75137007884e4a6b8bdfe797c58e1c6e405d02b5e5a184a8172f5f2c7"}.webp`,
    width: 424,
    height: 600,
    mimeType: "image/webp",
};

/** Jeder Eintrag trägt seine Kennung (WI-0118): Sie ist der Schlüssel der Karte und das, was das Fenster aufschlägt. */
let nextId = 0;
const newId = (): string => `80000000-0000-4000-8000-${(nextId++).toString(16).padStart(12, "0")}`;

const work = (entry: Partial<LiteratureEntry> = {}): LiteratureEntry => ({
    id: newId(),
    title: "Die Verschwörung von Gareth",
    productType: "gruppenabenteuer",
    role: "start",
    ...entry,
});

/** Eine Karte im alten Umfang - mit der Kennung, die der Vertrag seit WI-0118 verlangt. */
const map = (entry: Partial<CitymapEntry> & { title: string }): CitymapEntry => ({ id: newId(), ...entry });

const literatureSection = (works: LiteratureEntry[]): SubjectLiteratureSection => ({
    subject: GARETH,
    revision: REVISION,
    works,
});

describe("🔴 die Überschrift folgt dem Satzmuster „⟨Was⟩ zu ⟨Wem⟩“ (Guide §16.4, Legacy wörtlich)", () => {
    it("mit Namen nennt sie wovon, ohne Namen nur das Wort", () => {
        setLocale("de");
        expect(catalogHeading("citymaps", "Gareth")).toBe("Kartensammlung von Gareth");
        expect(catalogHeading("literature", "Gareth")).toBe("Literatur zu Gareth");
        expect(catalogHeading("reviews", "Gareth")).toBe("Bewertung zu Gareth");
        expect(catalogHeading("reviews", undefined)).toBe("Bewertung");
        expect(catalogHeading("literature", "   ")).toBe("Literatur");
    });

    it("🪤 „Bewertung“ bleibt Einzahl, auch bei mehreren: die Zahl steht in der Klammer", () => {
        setLocale("de");
        expect(catalogHeading("reviews", "Gareth")).not.toContain("Bewertungen");
    });

    it("Englisch: „Map collection of“, „Literature on“, „Reviews of“", () => {
        setLocale("en");
        expect(catalogHeading("citymaps", "Gareth")).toBe("Map collection of Gareth");
        expect(catalogHeading("literature", "Gareth")).toBe("Literature on Gareth");
        expect(catalogHeading("reviews", "Gareth")).toBe("Reviews of Gareth");
        setLocale("de");
    });
});

describe("🔴 welche Abschnitte entstehen: nur die, die die Antwort zählt - nie als „(0)“", () => {
    const sections = (counts: SubjectCounts | undefined): { section: string; count?: number }[] =>
        catalogsOf(GARETH, "Gareth", counts).map((model) => ({
            section: model.section,
            ...(model.count === undefined ? {} : { count: model.count }),
            ...(model.leer === true ? { leer: true } : {}),
        }));

    it("ohne Zähler entsteht kein Abschnitt - außer der Einladung eines Ortes ohne Karte (WI-0275)", () => {
        expect(sections(undefined)).toEqual([]);
        expect(sections({ sources: 3 })).toEqual([{ section: "citymaps", leer: true }]);
        // Nur ein Ort lädt ein: Ein Gebiet ohne Karten bekommt keinen Abschnitt.
        expect(catalogsOf({ kind: "territory", id: GARETH_ID }, "Garetien", { sources: 3 })).toEqual([]);
    });

    it("🔴 die Einladung heißt nur „Kartensammlung“ und trägt keine Zahl: nie „(0)“, nie „von Gareth“", () => {
        const [einladung] = catalogsOf(GARETH, "Gareth", { sources: 3 });
        expect(einladung).toMatchObject({ section: "citymaps", heading: "Kartensammlung", leer: true });
        expect(einladung?.count).toBeUndefined();
    });

    it("die Reihenfolge ist Legacys: Kartensammlung, Literatur, Bewertungen", () => {
        expect(sections({ reviews: 9, literature: 85, citymaps: 12 })).toEqual([
            { section: "citymaps", count: 12 },
            { section: "literature", count: 85 },
            { section: "reviews", count: 9 },
        ]);
    });

    it("🔴 nur verdeckte Werke: der Abschnitt steht da, aber OHNE Zahl (eine „(0)“ gibt es nicht)", () => {
        expect(sections({ literatureHidden: true })).toEqual([
            { section: "citymaps", leer: true },
            { section: "literature" },
        ]);
        expect(sections({ citymaps: 1, literature: 2, literatureHidden: true })).toEqual([
            { section: "citymaps", count: 1 },
            { section: "literature", count: 2 },
        ]);
    });
});

describe("die Karte eines Werks (Legacy `buildGameLiteratureCardMarkup`)", () => {
    it("Titel, Metazeile „Edition · Jahr“, Art als Wort, „enthalten in“", () => {
        setLocale("de");
        const entry = work({
            url: "https://de.wiki-aventurica.de/wiki/Die_Verschw%C3%B6rung_von_Gareth",
            edition: "DSA4",
            year: "1021 BF",
            containedIn: "Aventurische Anthologie",
            productType: "regionalspielhilfe",
        });
        const [card] = literatureModelOf(literatureSection([entry])).cards;
        expect(card).toMatchObject({
            key: entry.id,
            title: "Die Verschwörung von Gareth",
            meta: "DSA4 · 1021 BF",
            type: "Regionalspielhilfe",
            containedIn: "enthalten in: Aventurische Anthologie",
            spoiler: false,
        });
    });

    it("🔴 die Karte führt nicht mehr nach draußen: Sie hat weder Artikel noch Ladenlink, sondern öffnet das Verzeichnis (WI-0118)", () => {
        setLocale("de");
        const [card] = literatureModelOf(
            literatureSection([
                work({
                    url: "https://de.wiki-aventurica.de/wiki/X",
                    cover: COVER,
                    shop: { kind: "ulisses", url: "https://ulisses-ebooks.de/x" },
                }),
            ]),
        ).cards;
        expect(card).not.toHaveProperty("href");
        expect(card).not.toHaveProperty("coverLink");
        // Der Hinweis sagt, was ein Klick tut.
        expect(card?.hint).toBe("„Die Verschwörung von Gareth“ im Verzeichnis ansehen");
    });

    it("🔴 ohne freigegebenen Umschlag gibt es kein Bild - die Karte zeigt dort gar nichts (MEDIA-M14)", () => {
        const [card] = literatureModelOf(
            literatureSection([work({ shop: { kind: "ulisses", url: "https://ulisses-ebooks.de/x" } })]),
        ).cards;
        expect(card?.cover).toBeUndefined();
    });

    it("🔴 der Umschlag wird mit seinen Maßen durchgereicht (MEDIA-M14)", () => {
        const [card] = literatureModelOf(literatureSection([work({ cover: COVER })])).cards;
        expect(card?.cover).toEqual({ url: COVER.url, width: 424, height: 600 });
    });

    it("eine fehlende Edition und ein fehlendes Jahr lassen die Metazeile weg (kein „ · “ allein)", () => {
        expect(literatureModelOf(literatureSection([work()])).cards[0]?.meta).toBe("");
        expect(literatureModelOf(literatureSection([work({ edition: "DSA5" })])).cards[0]?.meta).toBe("DSA5");
        expect(literatureModelOf(literatureSection([work({ year: "1047 BF" })])).cards[0]?.meta).toBe("1047 BF");
    });

    it("eine unbekannte Werkart wird durchgereicht (das Vokabular ist offen)", () => {
        setLocale("de");
        expect(literatureTypeLabel("gruppenabenteuer")).toBe("Gruppenabenteuer");
        expect(literatureTypeLabel("etwas-ganz-neues")).toBe("etwas-ganz-neues");
    });

    it("🔴 die Rolle `play` ist der Spoiler, `start` und `covers` stehen offen", () => {
        const cards = literatureModelOf(
            literatureSection([work({ role: "start" }), work({ role: "play" }), work({ role: "covers" })]),
        ).cards;
        expect(cards.map((card) => card.spoiler)).toEqual([false, true, false]);
    });

    it("🔴 steht NUR Verdecktes da, sagt der Abschnitt das in einem Satz (Legacy `.avesmaps-adv__empty`)", () => {
        setLocale("de");
        expect(literatureModelOf(literatureSection([work({ role: "play" })])).note).toBe(
            "Hier beginnt kein Abenteuer.",
        );
        expect(literatureModelOf(literatureSection([work({ role: "play" }), work({ role: "start" })])).note).toBe("");
        expect(literatureModelOf(literatureSection([])).note).toBe("");
    });
});

describe("die Kachel einer Karte (Legacy `cityMapCardMarkup`)", () => {
    const maps = (entries: SubjectCitymapsSection["maps"]): SubjectCitymapsSection => ({
        subject: GARETH,
        revision: REVISION,
        maps: entries,
    });

    it("Titel und Kennung; der Hinweis sagt, was ein Klick tut", () => {
        setLocale("de");
        const entry = map({
            title: "Gareth - Oberstadt",
            find: { label: "Wiki Aventurica", url: "https://example.org/g" },
        });
        const [card] = citymapsModelOf(maps([entry]));
        expect(card).toMatchObject({
            key: entry.id,
            title: "Gareth - Oberstadt",
            hint: "„Gareth - Oberstadt“ im Verzeichnis ansehen",
            spoiler: false,
        });
    });

    it("🔴 die Kachel führt nicht mehr nach draußen, mit oder ohne Fundstelle: Sie öffnet das Verzeichnis (WI-0118)", () => {
        const [mit, ohne] = citymapsModelOf(
            maps([
                map({ title: "Mit", find: { label: "Wiki", url: "https://example.org/g" } }),
                map({ title: "Ohne" }),
            ]),
        );
        for (const card of [mit, ohne]) {
            expect(card).not.toHaveProperty("href");
            expect(card?.hint).toContain("im Verzeichnis ansehen");
        }
    });

    it("🔴 die Vorschau kommt mit ihren Maßen; ohne freigegebene Vorschau zeigt die Kachel gar nichts (MEDIA-M14)", () => {
        const preview = { ...COVER, role: "map_preview" as const, width: 296, height: 400 };
        const [mit, ohne] = citymapsModelOf(maps([map({ title: "Mit Bild", preview }), map({ title: "Ohne Bild" })]));
        expect(mit?.preview).toEqual({ url: preview.url, width: 296, height: 400 });
        expect(ohne?.preview).toBeUndefined();
    });

    it("🪤 nur ein ausdrückliches Ja verdeckt: ein fehlendes `spoiler` ist KEIN Spoiler", () => {
        expect(citymapsModelOf(maps([map({ title: "A" })]))[0]?.spoiler).toBe(false);
        expect(citymapsModelOf(maps([map({ title: "B", spoiler: true })]))[0]?.spoiler).toBe(true);
    });
});

describe("🔴 die Urheberzeile: keine Bilder, keine Zeile (Legacy `cityMapsHaveVisibleCover`, „no covers, no credit“)", () => {
    const preview = { ...COVER, role: "map_preview" as const, width: 296, height: 400 };
    const maps = (entries: SubjectCitymapsSection["maps"]): SubjectCitymapsSection => ({
        subject: GARETH,
        revision: REVISION,
        maps: entries,
    });
    /** So fragt `info-catalog.vue`: die Bilder, die der Streifen trägt - beim Werk der Umschlag, bei der Karte die Vorschau. */
    const coversOf = (section: SubjectLiteratureSection) => literatureModelOf(section).cards.map((card) => card.cover);
    const previewsOf = (section: SubjectCitymapsSection) => citymapsModelOf(section).map((card) => card.preview);

    it("ein Ort MIT Umschlägen zeigt die Zeile - nur den Satz, ohne Weg in den Laden (Betreiber 2026-10-09)", () => {
        setLocale("de");
        expect(catalogCredit(coversOf(literatureSection([work({ cover: COVER })])))).toBe(
            "Bilder © Ulisses Spiele bzw. der jeweiligen Rechteinhaber",
        );
    });

    it("🔴 ein Ort OHNE Umschläge zeigt sie NICHT - eine Urheberzeile ohne Bilder wäre eine Aussage über nichts", () => {
        setLocale("de");
        expect(catalogCredit(coversOf(literatureSection([work(), work({ title: "Zweites Werk" })])))).toBeUndefined();
        expect(catalogCredit(coversOf(literatureSection([])))).toBeUndefined();
    });

    it("🪤 sobald EIN Umschlag dabei ist, steht sie - der gemischte Streifen ist der Normalfall", () => {
        setLocale("de");
        expect(
            catalogCredit(coversOf(literatureSection([work(), work({ title: "Mit Bild", cover: COVER }), work()]))),
        ).not.toBeUndefined();
    });

    it("🔴 die Kartensammlung OHNE Vorschauen zeigt sie nicht - und mit einer Vorschau von selbst doch", () => {
        setLocale("de");
        expect(
            catalogCredit(previewsOf(maps([map({ title: "Ohne Bild" }), map({ title: "Auch ohne" })]))),
        ).toBeUndefined();
        expect(catalogCredit(previewsOf(maps([map({ title: "Mit Bild", preview })])))).not.toBeUndefined();
    });

    it("Englisch: Legacys englische Fassung ohne den Weg in den Laden", () => {
        setLocale("en");
        expect(catalogCredit([COVER])).toBe("Images © Ulisses Spiele or their respective rights holders");
        expect(catalogCredit([undefined])).toBeUndefined();
        setLocale("de");
    });
});

describe("🔴 die Sterne: fünf Zeichen, Teilfüllung am selben Zeichen (Guide §16.6)", () => {
    it("voll ab der Stufe, halb ab einer halben Stufe darunter, sonst leer", () => {
        expect(starsOf(5)).toEqual(["full", "full", "full", "full", "full"]);
        expect(starsOf(3.8)).toEqual(["full", "full", "full", "half", "empty"]);
        expect(starsOf(3.5)).toEqual(["full", "full", "full", "half", "empty"]);
        expect(starsOf(3.4)).toEqual(["full", "full", "full", "empty", "empty"]);
        expect(starsOf(0)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
    });

    it("ein Wert außerhalb von 0 bis 5 wird geklemmt, ein unmöglicher wird 0", () => {
        expect(starsOf(9)).toEqual(["full", "full", "full", "full", "full"]);
        expect(starsOf(-2)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
        expect(starsOf(Number.NaN)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
    });
});

describe("die Bewertungen (Legacy `location-reviews.js`)", () => {
    const section = (over: Partial<SubjectReviewsSection> = {}): SubjectReviewsSection => ({
        subject: GARETH,
        revision: REVISION,
        count: 2,
        average: 3.5,
        reviews: [{ stars: 4, author: "Rakorium", text: "Ein Gewimmel.", date: "3. Praios 1047 BF" }, { stars: 3 }],
        ...over,
    });

    it("die Zusammenfassung: Zahl mit einer Nachkommastelle und Komma, Sterne, Zählung über ALLE sichtbaren", () => {
        setLocale("de");
        const model = reviewsModelOf(section({ count: 9, average: 3.8 }));
        expect(model.average).toBe("3,8");
        expect(model.averageStars).toEqual(["full", "full", "full", "half", "empty"]);
        expect(model.count).toBe("9 Bewertungen");
        expect(reviewsModelOf(section({ count: 1 })).count).toBe("1 Bewertung");
    });

    it("je Eintrag die Kopfzeile, die Sterne und der Text in Anführungszeichen", () => {
        setLocale("de");
        const [erste, zweite] = reviewsModelOf(section()).rows;
        expect(erste).toMatchObject({
            head: "Rakorium schreibt (3. Praios 1047 BF):",
            stars: ["full", "full", "full", "full", "empty"],
            text: "„Ein Gewimmel.“",
            starsLabel: "4 von 5 Sternen",
        });
        // Ein leerer Autor heißt „Anonym“, ein fehlendes Datum lässt die Klammer weg, ein fehlender Text die Zeile.
        expect(zweite).toMatchObject({ head: "Anonym schreibt:", text: "" });
    });

    it("Englisch: „writes“, „reviews“, englische Anführungszeichen", () => {
        setLocale("en");
        const model = reviewsModelOf(section({ count: 3 }));
        expect(model.count).toBe("3 reviews");
        expect(model.rows[0]?.head).toBe("Rakorium writes (3. Praios 1047 BF):");
        expect(model.rows[0]?.text).toBe("“Ein Gewimmel.”");
        setLocale("de");
    });

    it("ohne Durchschnitt (keine Bewertung) bleibt die Zusammenfassung leer", () => {
        const model = reviewsModelOf({ subject: GARETH, revision: REVISION, count: 0, reviews: [] });
        expect(model.average).toBe("");
        expect(model.rows).toEqual([]);
    });
});

describe("die Liste kommt in EINER Frage, die scheitert für sich", () => {
    const answer = (): CatalogAnswer => literatureSection([work()]);
    const ok = (): Response => new Response(JSON.stringify(answer()), { status: 200 });

    it("fragt `/api/subjects/{kind}/{id}/{sektion}`", async () => {
        const urls: string[] = [];
        await fetchCatalog("literature", GARETH, undefined, (url) => {
            urls.push(String(url));
            return Promise.resolve(ok());
        });
        await fetchCatalog("citymaps", GARETH, undefined, (url) => {
            urls.push(String(url));
            return Promise.resolve(ok());
        });
        expect(urls).toEqual([
            `/api/subjects/place/${GARETH_ID}/literature`,
            `/api/subjects/place/${GARETH_ID}/citymaps`,
        ]);
    });

    it("404 heißt: gibt es nicht mehr; jeder andere Fehler wirft - der Abschnitt zeigt dann seinen Fehlerzustand", async () => {
        const missing = await fetchCatalog("reviews", GARETH, undefined, () =>
            Promise.resolve(new Response("", { status: 404 })),
        );
        expect(missing).toBeNull();
        await expect(
            fetchCatalog("reviews", GARETH, undefined, () => Promise.resolve(new Response("", { status: 500 }))),
        ).rejects.toThrow("500");
    });

    it("🔴 eine Absage wegen Last (503) fragt der Dienst selbst noch einmal, wie bei den Quellen", async () => {
        let calls = 0;
        const result = await fetchCatalog("literature", GARETH, undefined, () => {
            calls += 1;
            return Promise.resolve(
                calls === 1 ? new Response(JSON.stringify({ error: "busy" }), { status: 503 }) : ok(),
            );
        });
        expect(calls).toBe(2);
        expect(result).not.toBeNull();
    });

    it("eine freie Kartenstelle hat keine Katalogabschnitte", async () => {
        await expect(fetchCatalog("literature", { kind: "mapPoint", x: 1, y: 2 })).rejects.toThrow("mapPoint");
    });

    it("zwischen zwei Orten hin und her: die zweite Frage kommt aus dem Cache", async () => {
        const store = createRevisionCache<CatalogAnswer>();
        let calls = 0;
        const fetcher = (): Promise<Response> => {
            calls += 1;
            return Promise.resolve(ok());
        };
        await loadCatalog("literature", GARETH, undefined, fetcher, store);
        await loadCatalog("literature", GARETH, undefined, fetcher, store);
        expect(calls).toBe(1);
    });
});
