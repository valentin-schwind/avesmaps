import { describe, expect, it } from "vitest";
import type { SubjectSourcesSection } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import type { WikiModel } from "../src/info-panel/panel-types.ts";
import {
    cachedSources,
    emptySources,
    fetchSources,
    hasBox,
    loadSources,
    safeHref,
    shortenPages,
    sourceBoxOf,
    sourcesModelOf,
} from "../src/info-panel/source-model.ts";
import { createRevisionCache } from "../src/info-panel/subject-cache.ts";
import { REVISION } from "./panel-fixtures.ts";

/**
 * Der Quellenkasten im Panel (WI-0063 P6, Design Guide §16.4; Legacy `buildSourceListMarkup`, Mirror `8fb75eff9`): EIN Kasten, zwei Zonen,
 * jede nur mit Inhalt, ein Trenner nur, wo oben etwas steht, Seiten gekürzt, nur sichere Adressen als Link - und die Liste kommt sofort,
 * aber in einer Frage, die abbrechbar ist und bei Last von selbst wiederholt. Die Publikationen stehen seit WI-0254 §12 als Liste in Gruppen
 * (Ausführlich, Ergänzend; Erwähnt ohne Kopf), in jeder nach Titel in der Sprache der Seite.
 */

const GARETH = { kind: "place" as const, id: "80558060-4299-54aa-b520-814b10819885" };

const section = (sources: SubjectSourcesSection["sources"]): SubjectSourcesSection => ({
    subject: GARETH,
    revision: REVISION,
    sources,
});

const WIKI: WikiModel = {
    label: "Wiki Aventurica",
    url: "https://de.wiki-aventurica.de/wiki/Gareth",
    canon: { state: "official" },
    rights: [{ key: "address", label: "Adresse", text: "https://de.wiki-aventurica.de/wiki/Gareth" }],
};

describe("Seitenangaben kürzen (Legacy `featureSourceShortenPages`, Betreiber Legacy 2026-08-24)", () => {
    it("drei Einzelseiten bleiben stehen, ab der vierten steht „erste ff.“ mit der vollen Angabe im Titel", () => {
        expect(shortenPages("91, 92")).toEqual({ short: "91, 92", full: "91, 92", shortened: false });
        expect(shortenPages("8, 15, 80")?.shortened).toBe(false);
        expect(shortenPages("9, 20, 31, 44, 51")).toEqual({
            short: "9 ff.",
            full: "9, 20, 31, 44, 51",
            shortened: true,
        });
    });

    it("🔴 ein Bereich wird nie gekürzt: „16-122“ ist ein bekanntes Ende, `ff.` machte ein offenes daraus", () => {
        expect(shortenPages("16-122")).toEqual({ short: "16-122", full: "16-122", shortened: false });
    });

    it("keine Angabe, keine Seiten", () => {
        expect(shortenPages(undefined)).toBeUndefined();
        expect(shortenPages("  ")).toBeUndefined();
    });
});

describe("🔴 nur http(s) wird ein Link: `javascript:` überlebt jedes Maskieren", () => {
    it("sichere Adressen bleiben, alles andere fällt weg", () => {
        expect(safeHref(" https://de.wiki-aventurica.de/wiki/Gareth ")).toBe(
            "https://de.wiki-aventurica.de/wiki/Gareth",
        );
        expect(safeHref("HTTP://example.org")).toBe("HTTP://example.org");
        expect(safeHref("javascript:alert(1)")).toBeUndefined();
        expect(safeHref("data:text/html,x")).toBeUndefined();
        expect(safeHref(undefined)).toBeUndefined();
    });
});

describe("die Antwort in Zeilen und Listen: Quellen von Hand, Beschriebenes, nur Erwähntes", () => {
    const model = sourcesModelOf(
        section([
            {
                title: "Gareth - Stadt des Lichts",
                url: "https://example.org/gareth",
                type: "regionalspielhilfe",
                official: true,
                pages: "91, 92",
            },
            { title: "Briefspielbeitrag", type: "briefspiel", official: false, note: "https://import.example/seite" },
            {
                title: "Geographia Aventurica",
                type: "quellenband",
                official: true,
                referenceKind: "ausfuehrlich",
                pages: "9, 20, 31, 44",
            },
            {
                title: "Aventurischer Bote 120",
                type: "aventurischer_bote",
                official: true,
                referenceKind: "ergaenzend",
            },
            { title: "Roman X", type: "roman", official: true, referenceKind: "erwaehnung", pages: "12" },
            { type: "sonstiges", official: false },
        ]),
    );

    it("🔴 Quellen ohne `referenceKind` sind Zeilen der ersten Zone, Publikationen kommen in die Listen", () => {
        expect(model.direct.map((line) => line.title)).toEqual(["Gareth - Stadt des Lichts", "Briefspielbeitrag"]);
        expect(model.described.map((row) => row.title)).toEqual(["Geographia Aventurica", "Aventurischer Bote 120"]);
        expect(model.mentioned.map((row) => row.title)).toEqual(["Roman X"]);
    });

    it("eine Zeile: Titel mit Link, Seiten und die Halbpille aus Kanon UND Art (Legacy: offiziell wie inoffiziell); die Notiz bleibt weg", () => {
        expect(model.direct[0]).toMatchObject({
            kind: "direct",
            href: "https://example.org/gareth",
            pages: { short: "91, 92", shortened: false },
            pill: { state: "official", by: "Regionalspielhilfe" },
        });
        expect(model.direct[1]).toMatchObject({
            href: undefined,
            pill: { state: "unofficial", by: "Briefspiel" },
            // Legacy zeigt die Notiz im Infopanel nicht (sie ist hier die Adresse der Importseite).
            rights: [expect.objectContaining({ key: "kanon" })],
        });
    });

    it("eine Publikation: Art als Wort, Seiten gekürzt (die volle Angabe bleibt)", () => {
        expect(model.described[0]).toMatchObject({ type: "Quellenband", pages: { short: "9 ff.", shortened: true } });
        expect(model.described[0]?.pages?.full).toBe("9, 20, 31, 44");
    });

    it("🔴 eine Quelle ohne Titel und ohne Adresse hat nichts zu zeigen", () => {
        expect(model.direct.length + model.described.length + model.mentioned.length).toBe(5);
        expect(sourcesModelOf(section([{ type: "sonstiges", official: false }]))).toEqual(emptySources());
    });

    it("Englisch: die Arten heißen wie bei Legacy", () => {
        setLocale("en");
        try {
            const en = sourcesModelOf(section([{ title: "x", type: "briefspiel", official: false }]));
            expect(en.direct[0]?.pill?.by).toBe("Play-by-mail");
        } finally {
            setLocale("de");
        }
    });
});

describe("die Tafel hinter dem ⓘ einer Quelle (Legacy `rechteMarkup`): Kanon, Lizenz, Titel, Nennung, Adresse", () => {
    const rights = (entry: SubjectSourcesSection["sources"][number]) =>
        sourcesModelOf(section([entry])).direct[0]?.rights ?? [];

    it("Kanon zuerst; „inoffiziell“ nennt die Art in Klammern, „sonstiges“ ist die Nicht-Aussage und entfällt", () => {
        const [official] = rights({ title: "A", type: "quellenband", official: true });
        expect(official).toMatchObject({ key: "kanon" });
        expect(official?.text).toContain("Offiziell");
        const [unofficial] = rights({ title: "B", type: "briefspiel", official: false });
        expect(unofficial?.text).toContain("Fanmaterial (Briefspiel)");
        const [other] = rights({ title: "C", type: "sonstiges", official: false });
        expect(other?.text).toContain("Fanmaterial.");
        expect(other?.text).not.toContain("(Sonstiges)");
    });

    it("Lizenz mit Link, Gemeinfrei und „keine freie Lizenz“ ohne; eine nicht erfasste Lizenz fehlt (leer heißt nie „keine Lizenz“)", () => {
        const license = (entry: Partial<SubjectSourcesSection["sources"][number]>) =>
            rights({ title: "L", type: "quellenband", official: true, ...entry }).find((row) => row.key === "license");
        expect(
            license({
                license: { statement: "license", name: "CC BY-NC-SA 3.0", uri: "https://creativecommons.org/x" },
            }),
        ).toMatchObject({ text: "CC BY-NC-SA 3.0", href: "https://creativecommons.org/x" });
        expect(license({ license: { statement: "public_domain" } })).toEqual({
            key: "license",
            label: "Lizenz",
            text: "Gemeinfrei",
        });
        expect(license({ license: { statement: "unfree" } })?.text).toBe("Keine freie Lizenz");
        expect(license({})).toBeUndefined();
    });

    it("🔴 steht der Wirt vorn (Belegstelle), wandert der Titel der Seite hinter das ⓘ; sonst steht der Titel vorn", () => {
        const [line] = sourcesModelOf(
            section([
                {
                    title: "Datei : Ponterra detailliert.jpg",
                    url: "https://westlande.de/index.php?title=Ponterra",
                    type: "briefspiel",
                    official: false,
                    attribution: "VolkoV",
                    corpus: { key: "westlande.de", label: "AlberniaWiki" },
                },
            ]),
        ).direct;
        expect(line?.title).toBe("AlberniaWiki");
        expect(line?.rights.map((row) => row.key)).toEqual(["kanon", "title", "attribution", "address"]);
        expect(line?.rights.find((row) => row.key === "title")?.text).toBe("Datei : Ponterra detailliert.jpg");
        const [plain] = sourcesModelOf(
            section([{ title: "Geographia Aventurica", type: "quellenband", official: true }]),
        ).direct;
        expect(plain?.title).toBe("Geographia Aventurica");
        expect(plain?.rights.map((row) => row.key)).toEqual(["kanon"]);
        // Heißt der Titel schon wie der Wirt, steht er nicht zweimal da.
        const [same] = sourcesModelOf(
            section([
                {
                    title: "AlberniaWiki",
                    type: "briefspiel",
                    official: false,
                    corpus: { key: "westlande.de", label: "AlberniaWiki" },
                },
            ]),
        ).direct;
        expect(same?.rights.some((row) => row.key === "title")).toBe(false);
    });
});

describe("der Kasten: Zonen, Singular und Plural, Trenner, Reiter nur mit n > 0", () => {
    const direct = sourcesModelOf(section([{ title: "Almanach", type: "quellenband", official: true }]));
    const publications = sourcesModelOf(
        section([
            { title: "Efferds Wogen", type: "regionalspielhilfe", official: true, referenceKind: "ausfuehrlich" },
            { title: "Historia Aventurica", type: "quellenband", official: true, referenceKind: "erwaehnung" },
            { title: "Aventurischer Bote 1", type: "aventurischer_bote", official: true, referenceKind: "ergaenzend" },
        ]),
    );

    it("🔴 ohne Wikizeile, ohne Quelle und ohne Beleg gibt es keinen Kasten", () => {
        expect(hasBox(sourceBoxOf(undefined, undefined))).toBe(false);
        expect(hasBox(sourceBoxOf(undefined, emptySources()))).toBe(false);
    });

    it("„Quelle:“ bei einer Zeile, „Quellen:“ bei mehreren; die Wikizeile steht zuerst, danach jede Quelle von Hand", () => {
        const wikiOnly = sourceBoxOf(WIKI, undefined);
        expect(wikiOnly.label).toBe("Quelle:");
        expect(wikiOnly.lines.map((line) => line.kind)).toEqual(["wiki"]);
        expect(sourceBoxOf(undefined, direct).label).toBe("Quelle:");
        const both = sourceBoxOf(WIKI, direct);
        expect(both.label).toBe("Quellen:");
        expect(both.lines.map((line) => [line.kind, line.title])).toEqual([
            ["wiki", "Wiki Aventurica"],
            ["direct", "Almanach"],
        ]);
    });

    it("die Wikizeile trägt ihre Tafel und ihren Link; ohne sichere Adresse steht nur Text", () => {
        expect(sourceBoxOf(WIKI, undefined).lines[0]).toMatchObject({
            href: "https://de.wiki-aventurica.de/wiki/Gareth",
            pill: { state: "official" },
            rights: WIKI.rights,
        });
        expect(sourceBoxOf({ ...WIKI, url: "javascript:alert(1)" }, undefined).lines[0]?.href).toBeUndefined();
    });

    it("🔴 „Publikationen:“ hat zwei Reiter, jeder nur mit n > 0: „Beschrieben“ (alles außer Erwähnung) und „Erwähnt“", () => {
        const box = sourceBoxOf(WIKI, publications);
        expect(box.tabs.map((tab) => [tab.key, tab.label, tab.count])).toEqual([
            ["described", "Beschrieben", 2],
            ["mentioned", "Erwähnt", 1],
        ]);
        expect(box.tabs[0]?.groups.flatMap((group) => group.rows.map((row) => row.title))).toEqual([
            "Efferds Wogen",
            "Aventurischer Bote 1",
        ]);
        expect(box.tabs[1]?.hint).toBe("nur Erwähnung");
        const onlyMentioned = sourcesModelOf(
            section([{ title: "X", type: "roman", official: true, referenceKind: "erwaehnung" }]),
        );
        expect(sourceBoxOf(WIKI, onlyMentioned).tabs.map((tab) => tab.key)).toEqual(["mentioned"]);
        expect(sourceBoxOf(WIKI, direct).tabs).toEqual([]);
    });

    it("🔴 der Trenner steht nur, wo Zone 1 etwas trägt und Zone 2 etwas hat", () => {
        expect(sourceBoxOf(WIKI, publications).divider, "Wiki und Publikationen").toBe(true);
        expect(
            sourceBoxOf(undefined, { ...publications, direct: direct.direct }).divider,
            "Quelle und Publikationen",
        ).toBe(true);
        expect(sourceBoxOf(undefined, publications).divider, "nur Publikationen: nichts darüber").toBe(false);
        expect(sourceBoxOf(WIKI, undefined).divider, "nur die Wikizeile: nichts darunter").toBe(false);
        expect(sourceBoxOf(WIKI, direct).divider, "nur Quellen: nichts darunter").toBe(false);
    });

    it("während die Liste lädt, hält Zone 2 ihren Platz - und der Trenner mit, aber nur über einer Zeile", () => {
        expect(sourceBoxOf(WIKI, emptySources(), true).divider).toBe(true);
        expect(sourceBoxOf(undefined, emptySources(), true).divider).toBe(false);
        expect(hasBox(sourceBoxOf(undefined, emptySources(), true), true)).toBe(true);
    });

    it("Englisch: „Source:“, „Sources:“, „Described“, „Mentioned“", () => {
        setLocale("en");
        try {
            expect(sourceBoxOf(WIKI, undefined).label).toBe("Source:");
            const box = sourceBoxOf(WIKI, { ...publications, direct: direct.direct });
            expect(box.label).toBe("Sources:");
            expect(box.tabs.map((tab) => tab.label)).toEqual(["Described", "Mentioned"]);
        } finally {
            setLocale("de");
        }
    });
});

describe("die Publikationen als Liste: Gruppen nach Art, Erwähnt ohne Kopf, innerhalb nach Titel", () => {
    const publications = sourcesModelOf(
        section([
            { title: "Zorn der Götter", type: "abenteuer", official: true, referenceKind: "ergaenzend", pages: "5" },
            { title: "Efferds Wogen", type: "regionalspielhilfe", official: true, referenceKind: "ausfuehrlich" },
            {
                title: "Ärger im Hafen",
                type: "abenteuer",
                official: true,
                referenceKind: "ausfuehrlich",
                pages: "1, 2",
            },
            { title: "Aventurischer Bote 10", type: "aventurischer_bote", official: true, referenceKind: "ergaenzend" },
            { title: "Aventurischer Bote 2", type: "aventurischer_bote", official: true, referenceKind: "ergaenzend" },
            { title: "Roman Y", type: "roman", official: true, referenceKind: "erwaehnung" },
            {
                title: "Almanach",
                type: "quellenband",
                official: true,
                referenceKind: "erwaehnung",
                pages: "9, 20, 31, 44",
            },
        ]),
    );
    const tabs = sourceBoxOf(WIKI, publications).tabs;
    const described = tabs.find((tab) => tab.key === "described");
    const mentioned = tabs.find((tab) => tab.key === "mentioned");

    it("🔴 unter „Beschrieben“ stehen Ausführlich und Ergänzend je mit Kopf, in dieser Folge; jede Zeile kennt ihre Art", () => {
        expect(described?.groups.map((group) => [group.key, group.label, group.rows.length])).toEqual([
            ["ausfuehrlich", "Ausführlich", 2],
            ["ergaenzend", "Ergänzend", 3],
        ]);
        expect(described?.count, "die Zahl des Reiters zählt beide Gruppen").toBe(5);
        for (const group of described?.groups ?? []) {
            expect(group.rows.every((row) => row.kind === group.key)).toBe(true);
        }
    });

    it("🔴 unter „Erwähnt“ steht eine Gruppe ohne Kopf", () => {
        expect(mentioned?.groups).toHaveLength(1);
        expect(mentioned?.groups[0]).toMatchObject({ key: "erwaehnung", label: undefined });
    });

    it("🔴 innerhalb einer Gruppe nach Titel in der Sprache der Seite: Umlaut an seinem Buchstaben, Zahlen der Größe nach", () => {
        const titles = (tab: typeof described, index: number): string[] | undefined =>
            tab?.groups[index]?.rows.map((row) => row.title);
        // „Ärger“ steht vor „Efferds“ (Ä wie A), nicht hinter „Z“.
        expect(titles(described, 0)).toEqual(["Ärger im Hafen", "Efferds Wogen"]);
        // „Bote 2“ vor „Bote 10“, und „Zorn“ nach beiden.
        expect(titles(described, 1)).toEqual(["Aventurischer Bote 2", "Aventurischer Bote 10", "Zorn der Götter"]);
        expect(titles(mentioned, 0)).toEqual(["Almanach", "Roman Y"]);
    });

    it("die Sprache bestimmt die Folge: die Gruppen heißen englisch „In detail“ und „Supplementary“", () => {
        setLocale("en");
        try {
            const en = sourceBoxOf(WIKI, publications).tabs.find((tab) => tab.key === "described");
            expect(en?.groups.map((group) => group.label)).toEqual(["In detail", "Supplementary"]);
        } finally {
            setLocale("de");
        }
    });

    it("eine Gruppe ohne Zeile entsteht nicht: nur Ergänzendes gibt nur den Kopf „Ergänzend“", () => {
        const only = sourcesModelOf(
            section([{ title: "Bote", type: "aventurischer_bote", official: true, referenceKind: "ergaenzend" }]),
        );
        const tab = sourceBoxOf(WIKI, only).tabs[0];
        expect(tab?.groups.map((group) => group.key)).toEqual(["ergaenzend"]);
    });

    it("Seiten und Adresse bleiben an der Zeile: gekürzt mit der vollen Angabe, nur sichere Adressen als Link", () => {
        const model = sourcesModelOf(
            section([
                {
                    title: "Mit Shop",
                    url: "https://shop.example/x",
                    type: "quellenband",
                    official: true,
                    referenceKind: "ausfuehrlich",
                    pages: "9, 20, 31, 44",
                },
            ]),
        );
        const row = sourceBoxOf(WIKI, model).tabs[0]?.groups[0]?.rows[0];
        expect(row).toMatchObject({
            href: "https://shop.example/x",
            type: "Quellenband",
            pages: { short: "9 ff.", full: "9, 20, 31, 44", shortened: true },
        });
    });
});

describe("die Liste kommt sofort, in EINER Frage, die scheitert für sich", () => {
    const answer = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
        new Response(JSON.stringify(body), { status, headers });
    const ok = (body: unknown, status = 200): typeof fetch => (async () => answer(body, status)) as typeof fetch;

    it("fragt `/api/subjects/{kind}/{id}/sources`", async () => {
        const urls: string[] = [];
        const fetcher = (async (url: string) => {
            urls.push(url);
            return answer(section([]));
        }) as unknown as typeof fetch;
        await fetchSources(GARETH, undefined, fetcher);
        expect(urls).toEqual(["/api/subjects/place/80558060-4299-54aa-b520-814b10819885/sources"]);
    });

    it("404 heißt: gibt es nicht mehr; jeder andere Fehler wirft - der Kasten zeigt dann seinen kleinen Fehlerzustand", async () => {
        await expect(fetchSources(GARETH, undefined, ok({ error: "not_found" }, 404))).resolves.toBeNull();
        await expect(fetchSources(GARETH, undefined, ok({}, 500))).rejects.toThrow("500");
    });

    it("🔴 eine Absage wegen Last (503) fragt der Dienst selbst noch einmal, wie beim Detail", async () => {
        let calls = 0;
        const fetcher = (async () => {
            calls += 1;
            return calls < 3 ? answer({ error: "busy" }, 503, { "retry-after": "0" }) : answer(section([]));
        }) as unknown as typeof fetch;
        await expect(fetchSources(GARETH, undefined, fetcher)).resolves.toMatchObject({ sources: [] });
        expect(calls).toBe(3);
        // Nach drei Absagen gibt er auf: der Kasten zeigt seine Zeile mit „Noch einmal versuchen“.
        let always = 0;
        const never = (async () => {
            always += 1;
            return answer({ error: "busy" }, 503, { "retry-after": "0" });
        }) as unknown as typeof fetch;
        await expect(fetchSources(GARETH, undefined, never)).rejects.toThrow("503");
        expect(always).toBe(3);
    });

    it("ein Fehler (500) wird nicht wiederholt", async () => {
        let calls = 0;
        const fetcher = (async () => {
            calls += 1;
            return answer({}, 500);
        }) as unknown as typeof fetch;
        await expect(fetchSources(GARETH, undefined, fetcher)).rejects.toThrow("500");
        expect(calls).toBe(1);
    });

    it("eine freie Kartenstelle hat keine Quellen-Sektion", async () => {
        await expect(fetchSources({ kind: "mapPoint", x: 1, y: 2 })).rejects.toThrow("keine Quellen-Sektion");
    });

    it("zwischen zwei Orten hin und her: die zweite Frage kommt aus dem Cache, ein Fehlen (404) wird nicht gemerkt", async () => {
        const store = createRevisionCache<SubjectSourcesSection>();
        let calls = 0;
        const fetcher = (async () => {
            calls += 1;
            return answer(section([{ title: "Almanach", type: "quellenband", official: true }]));
        }) as unknown as typeof fetch;
        expect(cachedSources(GARETH, store)).toBeUndefined();
        const first = await loadSources(GARETH, undefined, fetcher, store);
        expect(first?.sources).toHaveLength(1);
        expect(cachedSources(GARETH, store)).toBe(first);
        await loadSources(GARETH, undefined, fetcher, store);
        expect(calls).toBe(1);
        const other = { kind: "place" as const, id: "5acdf435-80fc-4a34-980f-41020b31a8d3" };
        await expect(loadSources(other, undefined, ok({}, 404), store)).resolves.toBeNull();
        expect(cachedSources(other, store)).toBeUndefined();
    });
});
