import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LORE_READING, type LoreRowView, type SubjectLoreSection } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { LEGACY_ROWS } from "../src/info-panel/legacy-rows.ts";
import {
    LORE_GROUP_LID_MIN,
    LORE_LETTER_MIN,
    loreEverywhereOf,
    loreGroupsOf,
    loreLabel,
    loreLetterOf,
    loreNamesOf,
    loreRowsOf,
    loreSentence,
    type LoreEntryModel,
    type LoreGroupModel,
} from "../src/info-panel/lore-model.ts";
import { loadSection } from "../src/info-panel/panel-section-load.ts";
import { createRevisionCache } from "../src/info-panel/subject-cache.ts";
import { GARETH_ID, REVISION } from "./panel-fixtures.ts";

/**
 * Die Vorkommen im Panel als Modell (WI-0091, WI-0099, `lore.yaml` -> `panelbezug.zeilen`): die vier Zeilen, der Zählsatz, die
 * Gliederung nach Nähe, das Buchstabenregister und der Zwischenspeicher. A1 bis A8 prüft der Server
 * (`apps/server/test/lore-panel.test.ts`), A9 das Abnahmeblatt; hier steht, was die Oberfläche daraus macht - und A10.
 */

const GARETH = { kind: "place" as const, id: GARETH_ID };

/** Die Namen einer Gruppe in ANZEIGEreihenfolge, also so, wie das Register sie setzt. */
const namesOf = (group: LoreGroupModel | undefined): string[] =>
    (group?.names.blocks ?? []).flatMap((block) => block.entries.map((entry) => entry.text));

/** Die Einträge einer Gruppe, flach - für die Fälle, die an einem einzelnen Namen hängen. */
const entriesOf = (group: LoreGroupModel | undefined): LoreEntryModel[] =>
    (group?.names.blocks ?? []).flatMap((block) => block.entries);

/** Die Marken einer Gruppe in ihrer Reihenfolge („A“, „B“, „#“ …). */
const lettersOf = (group: LoreGroupModel | undefined): string[] =>
    (group?.names.blocks ?? []).map((block) => block.letter);

/** Eine Gruppe mit `n` Namen, die alle unter dieselbe Marke fallen - für die Schwellenfälle. */
const manyEntries = (count: number, prefix = "Kraut"): { name: string }[] =>
    Array.from({ length: count }, (_, at) => ({ name: `${prefix} ${String(at).padStart(3, "0")}` }));

/** Das Ziel des Links „Überall in Aventurien“: die Landschaft Aventurien (in den echten Daten genau ein Kartenobjekt). */
const AVENTURIEN = { kind: "area" as const, id: "af1a1e78-a55c-4aa7-b958-0c65d4dda4a9" };

const row = (over: Partial<LoreRowView> = {}): LoreRowView => ({
    kind: "flora",
    count: 2,
    groups: [
        { group: "here", entries: [{ name: "Alraune", url: "https://de.wiki-aventurica.de/wiki/Alraune" }] },
        { group: "region", entries: [{ name: "Wirselkraut" }] },
    ],
    everywhere: { ref: AVENTURIEN, count: 445 },
    ...over,
});

const section = (rows: LoreRowView[]): SubjectLoreSection => ({ subject: GARETH, revision: REVISION, rows });

describe("Die Vorkommen im Panel (WI-0091)", () => {
    it("🔴 vier Zeilen in Legacys Reihenfolge: Waren, Fauna, Flora, Spezies", () => {
        setLocale("de");
        expect(loreRowsOf(GARETH, { ware: 3, fauna: 2, flora: 1, spezies: 4 }).map((value) => value.loreKind)).toEqual([
            "ware",
            "fauna",
            "flora",
            "spezies",
        ]);
    });

    it("A2 · eine Art ohne ZÄHLER hat keine Zeile - der Server entscheidet das, nicht die Zahl", () => {
        const rows = loreRowsOf(GARETH, { ware: 3, flora: 1 });
        expect(rows.map((value) => value.loreKind)).toEqual(["ware", "flora"]);
    });

    it("A8 · ohne Zähler entsteht keine einzige Zeile", () => {
        expect(loreRowsOf(GARETH, undefined)).toEqual([]);
        expect(loreRowsOf(GARETH, {})).toEqual([]);
    });

    describe("Der Zählsatz", () => {
        it("🔴 sagt, was ERFASST ist - in Legacys Wortlaut, mit Einzahl und Mehrzahl", () => {
            setLocale("de");
            expect(loreSentence("ware", 35)).toBe("35 Handelswaren gelistet");
            expect(loreSentence("ware", 1)).toBe("1 Handelsware gelistet");
            expect(loreSentence("fauna", 5)).toBe("5 Tierarten beobachtet");
            expect(loreSentence("flora", 2)).toBe("2 Pflanzenarten gesehen");
        });

        it("🪤 „Spezies verzeichnet“ bleibt in beiden Zahlformen gleich", () => {
            setLocale("de");
            expect(loreSentence("spezies", 1)).toBe("1 Spezies verzeichnet");
            expect(loreSentence("spezies", 7)).toBe("7 Spezies verzeichnet");
        });

        it("eine große Zahl steht mit Tausendertrenner, wie jede Zahl im Panel", () => {
            setLocale("de");
            expect(loreSentence("flora", 1191)).toBe("1.191 Pflanzenarten gesehen");
        });

        it("auf Englisch gilt Legacys englische Fassung", () => {
            setLocale("en");
            expect(loreSentence("ware", 2)).toBe("2 trade goods listed");
            expect(loreLabel("spezies")).toBe("Species");
            setLocale("de");
        });

        it("🔴 jeder Name trägt die Art seiner Zeile - er öffnet damit die Infobox seines Vorkommens (Titel und Zeichen sofort)", () => {
            const eintrag = { kind: "loreEntry" as const, id: "3f0c2b6e-5a41-4d7e-9a43-0d1f6b9a7c10" };
            const groups = loreGroupsOf(
                row({
                    kind: "fauna",
                    groups: [{ group: "here", entries: [{ name: "Baumdrache", ref: eintrag }, { name: "Alligator" }] }],
                }),
            );
            const namen = entriesOf(groups[0]);
            expect(namen.map((entry) => entry.loreKind)).toEqual(["fauna", "fauna"]);
            expect(namen.find((entry) => entry.text === "Baumdrache")?.ref).toEqual(eintrag);
        });

        it("🔴 die Zahl kommt vom Server, nicht aus der Länge der Liste", () => {
            setLocale("de");
            // Die Zahl ist die des Servers; die Zeile rechnet nichts nach, sonst liefen Satz und Liste auseinander.
            const value = loreRowsOf(GARETH, { flora: 2 })[0];
            expect(value?.sentence).toBe("2 Pflanzenarten gesehen");
            expect(loreGroupsOf(row({ count: 2 })).flatMap((group) => namesOf(group)).length).toBe(2);
        });
    });

    describe("A6 · Die Gliederung nach Nähe", () => {
        it("jede Gruppe trägt ihre Überschrift, in der Reihenfolge der Antwort", () => {
            setLocale("de");
            const groups = loreGroupsOf(
                row({
                    groups: [
                        { group: "origin", entries: [{ name: "Leinöl" }] },
                        { group: "here", entries: [{ name: "Alraune" }] },
                        { group: "region", entries: [{ name: "Wirsel" }, { name: "Gras" }] },
                    ],
                }),
            );
            expect(groups.map((group) => group.heading)).toEqual(["Von hier", "Direkt von hier", "Aus der Region"]);
        });

        it("🔴 EINE einzige Gruppe trägt ihre Überschrift AUCH (Betreiber 2026-10-07, Abweichung von Legacy)", () => {
            setLocale("de");
            // 🔴 Legacy lässt den Kopf hier weg („eine einzige Gruppe gliedert nichts“). Der Betreiber hat das am Hexenwald
            // umgedreht: „abgeleitet bedeutet für mich (‚Aus der Region‘). das steht da nicht.“ Die Gruppe GLIEDERT nichts,
            // aber sie SAGT etwas - abgeleitet gegen direkt.
            const groups = loreGroupsOf(
                row({ groups: [{ group: "region", entries: [{ name: "Alraune" }, { name: "Wirsel" }] }] }),
            );
            expect(groups).toHaveLength(1);
            expect(groups[0]).toMatchObject({ heading: "Aus der Region", count: 2, collapsible: false, open: true });
        });

        it("🔴 Gegenprobe zum Hexenwald: nur eine Gruppe `region` - und „Aus der Region“ steht trotzdem da", () => {
            setLocale("de");
            // Der gemessene Fall (2026-10-07): Der Hexenwald trägt NICHTS Eigenes; alle vier Zeilen bestehen aus der
            // einen Gruppe `region` (Herz des Kontinents 20 Einträge, Königreich Garetien 4). Vorher stand dort keine
            // Überschrift - und damit nicht, DASS die Namen geerbt sind.
            const groups = loreGroupsOf(row({ groups: [{ group: "region", entries: manyEntries(10) }] }));
            expect(groups.map((group) => group.heading)).toEqual(["Aus der Region"]);
        });
    });

    describe("🔴 „Aus der Region“ steht OFFEN (Betreiber 2026-10-07: „brauch keine eigene klappbox“)", () => {
        it("🔴 keine zweite Klappstufe: jede Gruppe liefert ihre Namen unmittelbar", () => {
            setLocale("de");
            const groups = loreGroupsOf(row());
            expect(groups.map((group) => [group.key.split(":")[1], group.heading])).toEqual([
                ["here", "Direkt von hier"],
                ["region", "Aus der Region"],
            ]);
            expect(groups.map((group) => namesOf(group))).toEqual([["Alraune"], ["Wirselkraut"]]);
        });

        it("🪤 auch 256 Namen werden weder gekürzt noch hinter etwas gelegt - das ist bekannt und gewollt", () => {
            setLocale("de");
            // 256 ist der gemessene Extremfall (2026-10-06, Drunidet). Der Betreiber hat die Zahl mit dem Blatt gesehen.
            const groups = loreGroupsOf(row({ groups: [{ group: "region", entries: manyEntries(256) }] }));
            expect(groups).toHaveLength(1);
            expect(entriesOf(groups[0])).toHaveLength(256);
            // Es gibt keine Ersatzform: kein „(…)“, kein „mehr anzeigen“ - nur der Kopf, der sagt, woher die Namen kommen.
            expect(groups[0]?.heading).toBe("Aus der Region");
        });

        it("🪤 im Markup steht kein zweiter Deckel mehr - und nie der Spoiler-Schleier über einem Bild", () => {
            // `info-spoiler.vue` ist ein absolut positionierter Schleier über einem BILD (Design Guide §16.4) und trägt weder
            // Zähler noch Klappmechanik; er war hier nie die richtige Form. Der zweite `InfoLid` ist am 2026-10-07 entfallen.
            const markup = readFileSync(resolve(import.meta.dirname, "../src/info-panel/info-lore-row.vue"), "utf8");
            expect(markup).not.toContain("InfoSpoiler");
            expect(markup).not.toContain("info-lore-region-lid");
            // Genau EIN Deckel bleibt: die Zeile selbst.
            expect(markup.match(/<InfoLid/g)).toHaveLength(1);
        });
    });

    describe("WI-0099 · Das Buchstabenregister", () => {
        describe("Die Einsortierung (Legacys `avesmapsLoreLetterOf`)", () => {
            it("🔴 ein Umlaut fällt auf seinen Grundbuchstaben - sonst hätte „Älbler“ eine eigene Marke hinter Z", () => {
                expect(loreLetterOf("Älbler")).toBe("A");
                expect(loreLetterOf("Öl")).toBe("O");
                expect(loreLetterOf("Übel")).toBe("U");
                expect(loreLetterOf("Éclair")).toBe("E");
            });

            it("🔴 eine Ziffer und alles Übrige landen unter „#“ - es gibt kein „Unbekannt“", () => {
                expect(loreLetterOf("7. Kraut")).toBe("#");
                expect(loreLetterOf("’Alter Name")).toBe("#");
                expect(loreLetterOf("")).toBe("#");
                expect(loreLetterOf("   ")).toBe("#");
            });

            it("nur das ERSTE Zeichen zählt: „Al'Anfaner“ steht unter A", () => {
                expect(loreLetterOf("Al'Anfaner")).toBe("A");
                expect(loreLetterOf("zwerg")).toBe("Z");
            });

            it("🪤 „ß“ ergibt die EINE Marke „S“ - benannte Abweichung von Legacy, das „SS“ liefert", () => {
                // `"ß".toUpperCase()` ist zwei Zeichen. Legacy gibt die gefaltete Kette zurück und hätte damit eine
                // zweibuchstabige Marke; hier steht `.charAt(0)`. Im Bestand beginnt kein Name mit ß.
                expect(loreLetterOf("ßonderfall")).toBe("S");
            });
        });

        describe("Die Blöcke", () => {
            it("🔴 sortiert mit `localeCompare(…, „de“)`, nicht mit `<`: „Älbler“ steht VOR „Zwerg“, in Block A", () => {
                const names = loreNamesOf([{ name: "Zwerg" }, { name: "Älbler" }, { name: "Baum" }], "k");
                expect(names.form).toBe("register");
                expect(names.blocks.map((block) => block.letter)).toEqual(["A", "B", "Z"]);
                expect(names.blocks.flatMap((block) => block.entries.map((entry) => entry.text))).toEqual([
                    "Älbler",
                    "Baum",
                    "Zwerg",
                ]);
            });

            it("gleiche Marke heißt EIN Block, nicht einer je Name", () => {
                const names = loreNamesOf([{ name: "Alraune" }, { name: "Ast" }, { name: "Birke" }], "k");
                expect(names.blocks).toHaveLength(2);
                expect(names.blocks[0]?.entries.map((entry) => entry.text)).toEqual(["Alraune", "Ast"]);
            });

            it("jeder Block hat einen eigenen Schlüssel, auch wenn dieselbe Marke zweimal vorkommt", () => {
                const names = loreNamesOf([{ name: "1 Erstes" }, { name: "Mitte" }, { name: "9 Letztes" }], "k");
                expect(new Set(names.blocks.map((block) => block.key)).size).toBe(names.blocks.length);
            });

            it("🔴 Marken IMMER: schon drei Namen bekommen ihr Register (`LORE_LETTER_MIN` = 0)", () => {
                expect(LORE_LETTER_MIN).toBe(0);
                expect(loreNamesOf([{ name: "Alraune" }, { name: "Birke" }, { name: "Clan" }], "k").form).toBe(
                    "register",
                );
                expect(loreNamesOf([{ name: "Alraune" }], "k").form).toBe("register");
            });

            it("🪤 der Komma-Zweig bleibt für einen Aufrufer mit eigener Schwelle (Legacys „Stätten“ geben 2)", () => {
                const run = loreNamesOf([{ name: "Herzog-Cusimo-Aquädukt" }], "k", 2);
                expect(run.form).toBe("run");
                expect(run.blocks).toHaveLength(1);
                expect(run.blocks[0]?.letter).toBe("");
                expect(run.blocks[0]?.entries.map((entry) => entry.text)).toEqual(["Herzog-Cusimo-Aquädukt"]);
            });

            it("⚠️ eine leere Liste liefert gar keinen Block - kein leerer Spaltenkasten", () => {
                expect(loreNamesOf([], "k")).toEqual({ form: "run", blocks: [] });
            });
        });

        describe("🔴 Die 25er-Schwelle: „ist die ZEILE zu lang?“", () => {
            /** Zwei Gruppen mit zusammen `total` Namen - die Zahl, auf die es ankommt. */
            const twoGroups = (total: number): LoreRowView =>
                row({
                    groups: [
                        { group: "here", entries: manyEntries(1, "Hier") },
                        { group: "region", entries: manyEntries(total - 1, "Region") },
                    ],
                });

            it("DARUNTER klappt nichts: 24 Namen in der Zeile, beide Gruppen offen und ohne Pfeil", () => {
                setLocale("de");
                const groups = loreGroupsOf(twoGroups(LORE_GROUP_LID_MIN - 1));
                expect(groups.map((group) => group.collapsible)).toEqual([false, false]);
                expect(groups.map((group) => group.open)).toEqual([true, true]);
                // Zustand 2: Kopf mit Zahl, aber nicht klappbar.
                expect(groups.map((group) => group.heading)).toEqual(["Direkt von hier", "Aus der Region"]);
                expect(groups.map((group) => group.count)).toEqual([1, 23]);
            });

            it("🔴 DARÜBER klappen sie, und nur die ERSTE startet offen: 25 Namen in der Zeile", () => {
                setLocale("de");
                const groups = loreGroupsOf(twoGroups(LORE_GROUP_LID_MIN));
                expect(groups.map((group) => group.collapsible)).toEqual([true, true]);
                expect(groups.map((group) => group.open)).toEqual([true, false]);
            });

            it("🔴 es entscheidet die ZEILE, nicht die Gruppe: eine Gruppe mit EINEM Namen klappt mit", () => {
                setLocale("de");
                const groups = loreGroupsOf(
                    row({
                        groups: [
                            { group: "origin", entries: manyEntries(1, "Von") },
                            { group: "here", entries: manyEntries(60, "Hier") },
                        ],
                    }),
                );
                // Die erste Gruppe hat genau einen Namen - und ist trotzdem klappbar, weil die Zeile lang ist. Sie
                // startet offen, weil sie die erste ist („Von hier“ ist die stärkste Aussage über den Ort).
                expect(groups[0]).toMatchObject({ count: 1, collapsible: true, open: true });
                expect(groups[1]).toMatchObject({ count: 60, collapsible: true, open: false });
            });

            it("🔴 EINE belegte Gruppe klappt NIE - auch bei 300 Namen: zum Klappen fehlt der zweite Block", () => {
                setLocale("de");
                const groups = loreGroupsOf(row({ groups: [{ group: "region", entries: manyEntries(300) }] }));
                expect(groups).toHaveLength(1);
                // 🔴 Die Überschrift steht (Betreiber 2026-10-07) - geklappt wird trotzdem nicht: Klappen IST Gliederung.
                expect(groups[0]).toMatchObject({ heading: "Aus der Region", collapsible: false, open: true });
                // Das Register steht trotzdem - die zweite Schwelle ist eine andere Frage.
                expect(groups[0]?.names.form).toBe("register");
            });

            it("🪤 der Link „Überall in Aventurien“ verlängert die Zeile nicht - er bringt keinen Namen mit", () => {
                setLocale("de");
                const groups = loreGroupsOf(
                    row({
                        groups: [
                            { group: "here", entries: manyEntries(2, "Hier") },
                            { group: "region", entries: manyEntries(2, "Region") },
                        ],
                        everywhere: { ref: AVENTURIEN, count: 445 },
                    }),
                );
                // Vier Namen stehen da, 445 stehen hinter einem Link: geklappt wird nicht.
                expect(groups.every((group) => !group.collapsible)).toBe(true);
            });
        });

        describe("Die drei Zustände einer Gruppenzeile", () => {
            it("🔴 eine einzige Gruppe: Kopf mit Zahl, kein Pfeil", () => {
                setLocale("de");
                const groups = loreGroupsOf(row({ groups: [{ group: "here", entries: manyEntries(3) }] }));
                expect(groups[0]?.heading).toBe("Direkt von hier");
                expect(groups[0]?.count).toBe(3);
                expect(groups[0]?.collapsible).toBe(false);
            });

            it("mehrere Gruppen unter der Schwelle: Kopf mit Zahl, kein Pfeil", () => {
                setLocale("de");
                const groups = loreGroupsOf(row());
                expect(groups.map((group) => [group.heading, group.count, group.collapsible])).toEqual([
                    ["Direkt von hier", 1, false],
                    ["Aus der Region", 1, false],
                ]);
            });

            it("🪤 die Marken stehen in beiden Zuständen - eine Gruppe von drei Namen hat sie auch", () => {
                setLocale("de");
                const groups = loreGroupsOf(row());
                expect(lettersOf(groups[0])).toEqual(["A"]);
                expect(lettersOf(groups[1])).toEqual(["W"]);
            });
        });

        it("💣 die Namen nehmen sich aus `html { hyphens: auto }` heraus - kein Wörterbuch auf Eigennamen", () => {
            // Der Kanon trennt seit WI-0088 P3 global („auch bei links“, Betreiber 2026-10-06) und nennt `hyphens: manual`
            // ausdrücklich als Ausnahmeweg. An aventurischen Eigennamen rät die deutsche Trennhilfe („Totenko-pfäffchen“),
            // darum steht die Ausnahme hier - und ohne sie wäre der Fehler lautlos.
            const markup = readFileSync(resolve(import.meta.dirname, "../src/info-panel/info-lore-names.vue"), "utf8");
            expect(markup).toMatch(/\.info-lore__names\s*\{[^}]*hyphens:\s*manual/);
            expect(markup).not.toMatch(/hyphens:\s*auto/);
            // Und `overflow-wrap: anywhere` bleibt: es fängt die Namen, die auch ungetrennt breiter sind als die Spalte.
            expect(markup).toMatch(/\.info-lore__names\s*\{[^}]*overflow-wrap:\s*anywhere/);
        });

        it("💣 der Pfeil der Gruppe steht im Stylesheet und ist ein ANDERES Zeichen als der des Deckels", () => {
            // Er beschreibt einen Zustand, den das `<details>` selbst führt; im Markup wäre er eine zweite Stelle, die ihn
            // kennt. Der Deckel kippt senkrecht (▾/▴), die Gruppe zwischen waagerecht und senkrecht (▸/▾).
            const markup = readFileSync(resolve(import.meta.dirname, "../src/info-panel/info-lore-row.vue"), "utf8");
            expect(markup).toMatch(/content:\s*"\\25b8"/);
            expect(markup).toMatch(/content:\s*"\\25be"/);
            expect(markup).not.toContain("▸");
            expect(markup).not.toContain("▾");
        });
    });

    describe("🔴 „Überall in Aventurien“ ist ein LINK, keine Liste", () => {
        it("🔴 führt auf die Landschaft Aventurien und nennt die Zahl, die dort steht", () => {
            setLocale("de");
            const link = loreEverywhereOf(row());
            expect(link?.ref).toEqual(AVENTURIEN);
            expect(link?.label).toBe("Überall in Aventurien (445)");
        });

        it("🔴 kein einziger kontinentweiter Name steckt in der Zeile - darum ist er ein Link", () => {
            const names = loreGroupsOf(row()).flatMap((group) => namesOf(group));
            expect(names).toEqual(["Alraune", "Wirselkraut"]);
        });

        it("🔴 „nur Kontinentweites“: die Zeile STEHT, und sie sagt „Keine besonderen Vorkommen“ (WI-0104)", () => {
            setLocale("de");
            // 🔴 DER GRENZFALL. Der Server trägt die Art mit der Zahl 0 in `counts`, weil ihre Zeile steht
            // (`loreRowStands`): ihr ganzer Inhalt ist der Link. Die Zeile darf hier NICHT wegfallen - sonst nähme „leer
            // ist unsichtbar“ (WI-0063 5.3) die Betreiberentscheidung vom 2026-10-07 still zurück.
            const rows = loreRowsOf(GARETH, { ware: 0, fauna: 0, flora: 0, spezies: 0 });
            expect(rows.map((value) => value.loreKind)).toEqual(["ware", "fauna", "flora", "spezies"]);
            // Betreiber 2026-10-09: „Keine besonderen Vorkommen“ statt „0 … verzeichnet“, auch am Telefon.
            expect(rows.map((value) => value.sentence)).toEqual(Array(4).fill("Keine besonderen Vorkommen"));
            expect(rows.map((value) => value.shortSentence)).toEqual(Array(4).fill("Keine besonderen Vorkommen"));
        });

        it("🔴 am Telefon ohne Verb (WI-0098, Betreiber 2026-10-09: „ok“): „445 Pflanzenarten“", () => {
            setLocale("de");
            const rows = loreRowsOf(GARETH, { ware: 1, fauna: 2, flora: 445, spezies: 1 });
            expect(rows.map((value) => value.shortSentence)).toEqual([
                "1 Handelsware",
                "2 Tierarten",
                "445 Pflanzenarten",
                "1 Spezies",
            ]);
            expect(rows.map((value) => value.sentence)).toEqual([
                "1 Handelsware gelistet",
                "2 Tierarten beobachtet",
                "445 Pflanzenarten gesehen",
                "1 Spezies verzeichnet",
            ]);
        });

        it("🔴 eine 0 verschwindet auch EINZELN nicht - die Nachbarzeilen bleiben unberührt", () => {
            setLocale("de");
            const rows = loreRowsOf(GARETH, { ware: 4, spezies: 0 });
            expect(rows.map((value) => [value.loreKind, value.count])).toEqual([
                ["ware", 4],
                ["spezies", 0],
            ]);
        });

        it("🔴 ohne Zähler entsteht die Zeile gar nicht - und eine Art ohne Zähler bleibt weg", () => {
            // Das Dasein der Zeile entscheidet der Server, einmal: Was nicht in `counts` steht, hat keine Zeile.
            expect(loreRowsOf(GARETH, undefined)).toEqual([]);
            expect(loreRowsOf(GARETH, {})).toEqual([]);
            expect(loreRowsOf(GARETH, { ware: 0 }).map((value) => value.loreKind)).toEqual(["ware"]);
        });

        it("🪤 eine Zeile mit 0 hat keine Gruppe, aber ihren Link", () => {
            setLocale("de");
            const only = row({ count: 0, groups: [], everywhere: { ref: AVENTURIEN, count: 44 } });
            expect(loreGroupsOf(only)).toEqual([]);
            expect(loreEverywhereOf(only)?.label).toBe("Überall in Aventurien (44)");
        });

        it("ohne Ziel gibt es keine Linkzeile - nie ein toter Link", () => {
            const bare = row();
            delete bare.everywhere;
            expect(loreEverywhereOf(bare)).toBeUndefined();
        });
    });

    describe("A4 und A5 · Die Namen", () => {
        it("🔴 ein Treffer wird ein Objektlink, ein Name ohne Treffer bleibt Text - nie ein toter Link", () => {
            const target = { kind: "place" as const, id: GARETH_ID };
            const entries = entriesOf(
                loreGroupsOf(
                    row({
                        groups: [
                            {
                                group: "here",
                                entries: [
                                    { name: "Schattenstein", ref: target },
                                    { name: "Nur Text" },
                                    { name: "Mit Artikel", url: "https://de.wiki-aventurica.de/wiki/Alraune" },
                                ],
                            },
                        ],
                    }),
                )[0],
            );
            const byName = (name: string): LoreEntryModel | undefined => entries.find((entry) => entry.text === name);
            expect(byName("Schattenstein")).toMatchObject({ text: "Schattenstein", ref: target });
            expect(byName("Nur Text")?.ref).toBeUndefined();
            expect(byName("Nur Text")?.href).toBeUndefined();
            expect(byName("Mit Artikel")).toMatchObject({ href: "https://de.wiki-aventurica.de/wiki/Alraune" });
            expect(byName("Mit Artikel")?.ref).toBeUndefined();
            // 🪤 Die Reihenfolge ist nicht mehr die der Antwort, sondern die des Registers: M, N, S.
            expect(entries.map((entry) => entry.text)).toEqual(["Mit Artikel", "Nur Text", "Schattenstein"]);
        });
    });

    describe("A10 · Derselbe Ort zum zweiten Mal", () => {
        it("🔴 löst keinen zweiten Serverlauf aus - der Zwischenspeicher wie bei den übrigen Sektionen", async () => {
            const store = createRevisionCache<SubjectLoreSection>();
            let calls = 0;
            const fetcher = (): Promise<Response> => {
                calls += 1;
                return Promise.resolve(new Response(JSON.stringify(section([row()])), { status: 200 }));
            };
            await loadSection<SubjectLoreSection>("lore", GARETH, undefined, fetcher, store);
            await loadSection<SubjectLoreSection>("lore", GARETH, undefined, fetcher, store);
            expect(calls).toBe(1);
        });

        it("eine Absage wegen Last (503) fragt der Dienst selbst noch einmal, wie bei den Quellen", async () => {
            let calls = 0;
            const answer = await loadSection<SubjectLoreSection>(
                "lore",
                GARETH,
                undefined,
                () => {
                    calls += 1;
                    return Promise.resolve(
                        calls === 1
                            ? new Response(JSON.stringify({ error: "busy" }), { status: 503 })
                            : new Response(JSON.stringify(section([row()])), { status: 200 }),
                    );
                },
                createRevisionCache<SubjectLoreSection>(),
            );
            expect(calls).toBe(2);
            expect(answer?.rows).toHaveLength(1);
        });
    });

    describe("Der Platz in der Tabelle", () => {
        it("🔴 die Vorkommen stehen VOR der Klimazone, in Legacys Tabelle (WI-0063 27.7)", () => {
            for (const kind of ["place", "area", "peak", "territory"] as const) {
                const slots = LEGACY_ROWS[kind];
                expect(slots.indexOf("lore"), kind).toBeGreaterThan(-1);
                expect(slots.indexOf("lore"), kind).toBe(slots.indexOf("ctx:climate") - 1);
            }
        });

        it("🔴 der WEG hat seit dem 2026-10-07 die vier Zeilen, und sie stehen am ENDE seiner Tabelle", () => {
            // Betreiber 2026-10-07: „Wege sollen abgeleitete Vorkommen haben (‚Aus der Region‘)“. Legacy zeigt am Weg keine,
            // es gibt dort also keinen Legacy-Platz: Vor „Lage“ und „Verlauf“ zu gehen hieße, Legacys Wikifelder
            // auseinanderzureißen. Ein Weg hat keine Klimazone, hinter der die Zeilen am Ort enden.
            expect(LEGACY_ROWS.path.at(-1)).toBe("lore");
        });

        it("🪤 die KRAFTLINIE bekommt keine - der Betreiber hat sie nicht genannt", () => {
            expect(LEGACY_ROWS.powerline).not.toContain("lore");
        });
    });

    it("🔴 jede Lesart der Vorkommen steht an genau EINER Stelle", () => {
        // Zählweise, Richtung des Enthaltenseins und Lesart der Kontinentzeilen: je eine Zeile in `packages/shared/src/lore.ts`.
        // 🔴 `countScope: "own"` seit WI-0104 (Betreiber 2026-10-07: „kannst du ‚überall in aventurien‘ von der zahl im header
        // von vorkommen abziehen?“): Der Satz zählt nur, was als Liste dasteht. Die Linkzeile steht weiter überall - dass sie
        // steht, hängt seither an `loreRowStands`, nicht an der Zahl.
        // 🔴 `ortszeileHinterRegel: true` seit WI-0257 S2 (Vali 2026-10-29, F2): Wo eine Regel derselben Beziehung denselben Ort genauer
        // fasst, gilt nur die Regel; alle anderen Ortszeilen gelten weiter. Beide Richtungen prüft `apps/server/test/vorkommen-panel.test.ts`.
        expect(LORE_READING).toEqual({
            countScope: "own",
            regionReading: "contains",
            continentReading: "additive",
            ortszeileHinterRegel: true,
        });
    });
});
