import { describe, expect, it } from "vitest";
import type { StaettenGroup } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { LEGACY_ROWS } from "../src/info-panel/legacy-rows.ts";
import { LORE_GROUP_LID_MIN, type LoreGroupModel } from "../src/info-panel/lore-model.ts";
import {
    STAETTEN_GROUP_LID_MIN,
    STAETTEN_LETTER_MIN,
    STAETTEN_OWN_GROUP_MIN,
    staettenGroupsOf,
    staettenOrderMatters,
    staettenLabel,
    staettenRowOf,
    staettenSentence,
} from "../src/info-panel/staetten-model.ts";
import { GARETH_ID } from "./panel-fixtures.ts";
import { searchGroups } from "../src/info-panel/lore-search.ts";
import { ELENVINA_ARTIG, staettenAnswerOf, staettenGroup } from "./staetten-fixtures.ts";

/**
 * Die Stättenzeile als Modell (WI-0109, `staetten.yaml` -> `panelbezug`): der Zählsatz, die Gliederung nach ART, die
 * Markenschwelle 2 und die Klappschwelle 25. Der Lesepfad steht in `apps/server/test/staetten.test.ts`.
 *
 * 🔴 Die zwei Zahlen sind Legacys und werden hier festgehalten, damit niemand eine eigene erfindet: Marken ab **2**
 * (`AVESMAPS_STAETTEN_BUCHSTABEN_AB`, Owner 2026-08-15), Klappen ab **25** (`AVESMAPS_STAETTEN_GRUPPEN_KLAPP_AB`, derselbe
 * Wert wie bei den Vorkommen).
 */

setLocale("de");

const GARETH = { kind: "place" as const, id: GARETH_ID };

const group = (type: string, ...names: string[]): StaettenGroup => ({
    type,
    entries: names.map((name) => ({ name })),
});

const answerOf = (...groups: StaettenGroup[]) => ({
    count: groups.reduce((sum, entry) => sum + entry.entries.length, 0),
    groups,
});

const namesOf = (model: LoreGroupModel | undefined): string[] =>
    (model?.names.blocks ?? []).flatMap((block) => block.entries.map((entry) => entry.text));

const lettersOf = (model: LoreGroupModel | undefined): string[] =>
    (model?.names.blocks ?? []).map((block) => block.letter);

describe("Der Zählsatz", () => {
    it("ist Legacys Wortlaut, in Einzahl und Mehrzahl", () => {
        expect(staettenSentence(1)).toBe("1 Gebäude oder Stätte verzeichnet");
        expect(staettenSentence(21)).toBe("21 Gebäude und Stätten verzeichnet");
        expect(staettenSentence(414)).toBe("414 Gebäude und Stätten verzeichnet");
        expect(staettenLabel()).toBe("Innerorts");
    });

    it("eine Zeile entsteht nur mit Zahl - und bei 0 nicht", () => {
        expect(staettenRowOf(GARETH, undefined)).toEqual([]);
        expect(staettenRowOf(GARETH, 0)).toEqual([]);
        expect(staettenRowOf(GARETH, 3)).toEqual([
            {
                kind: "staetten",
                ref: GARETH,
                count: 3,
                sentence: "3 Gebäude und Stätten verzeichnet",
                shortSentence: "3 Gebäude und Stätten",
            },
        ]);
    });
});

describe("Der Platz in der Tabelle", () => {
    it("die Stätten stehen ÜBER den Vorkommen und nur am Ort", () => {
        const rows = LEGACY_ROWS.place;
        expect(rows.indexOf("staetten")).toBeGreaterThan(-1);
        expect(rows.indexOf("staetten")).toBeLessThan(rows.indexOf("lore"));
        expect(rows.indexOf("staetten")).toBeGreaterThan(rows.indexOf("tempel"));
        for (const kind of ["area", "peak", "path", "powerline", "territory"] as const) {
            expect(LEGACY_ROWS[kind]).not.toContain("staetten");
        }
    });
});

describe("Die Gliederung nach Art", () => {
    it("führt gleiche Anzeigearten zusammen, ohne Einträge oder Sprungziele zu verlieren", () => {
        const target = { kind: "place" as const, id: GARETH_ID };
        const answer = answerOf(group("", "Zollhaus", "Alter Turm"), {
            type: "Bauwerk",
            entries: [{ name: "Alter Turm", jump: target }],
        });
        const before = structuredClone(answer);
        const models = staettenGroupsOf(answer);
        expect(models).toHaveLength(1);
        expect(models[0]?.heading).toBe("Bauwerk");
        expect(models[0]?.count).toBe(3);
        expect(namesOf(models[0])).toEqual(["Alter Turm", "Alter Turm", "Zollhaus"]);
        expect(models[0]?.names.blocks.flatMap((block) => block.entries).filter((entry) => entry.jump)).toHaveLength(1);
        expect(answer).toEqual(before);
    });

    it("zählt nach der Zusammenfassung eine einzige Art, auch oberhalb der Klappschwelle", () => {
        const models = staettenGroupsOf(
            answerOf(group("", ...Array.from({ length: 24 }, (_, at) => `Haus ${at}`)), group("Bauwerk", "Turm")),
        );
        expect(models).toHaveLength(1);
        expect(models[0]?.collapsible).toBe(false);
        expect(models[0]?.open).toBe(true);
    });

    it("sortiert die Arten deutsch - mit dem Wort, das DASTEHT", () => {
        // Die leere Art trägt in der Anzeige „Bauwerk“ und sortiert damit unter B, nicht vorn.
        const models = staettenGroupsOf(answerOf(group("Ärger"), group("Zunft"), group(""), group("Palast")));
        expect(models.map((model) => model.heading)).toEqual(["Ärger", "Bauwerk", "Palast", "Zunft"]);
    });

    it("die Überschrift steht IMMER, auch bei einer einzigen Art (Abweichung von Legacy, Betreiber 2026-10-07)", () => {
        const [only] = staettenGroupsOf(answerOf(group("Tempel", "Praiostempel")));
        expect(only?.heading).toBe("Tempel");
        expect(only?.count).toBe(1);
        expect(only?.collapsible).toBe(false);
        expect(only?.open).toBe(true);
    });

    it("die Zahl neben der Überschrift ist die der Art", () => {
        const models = staettenGroupsOf(answerOf(group("Tempel", "A", "B", "C"), group("Palast", "D")));
        expect(models.map((model) => [model.heading, model.count])).toEqual([
            ["Palast", 1],
            ["Tempel", 3],
        ]);
    });
});

describe("Das Buchstabenregister beginnt bei ZWEI Namen", () => {
    it("ein einziger Name steht blank da - keine Marke", () => {
        const [only] = staettenGroupsOf(answerOf(group("Aquädukt", "Herzog-Cusimo-Aquädukt")));
        expect(only?.names.form).toBe("run");
        expect(lettersOf(only)).toEqual([""]);
        expect(namesOf(only)).toEqual(["Herzog-Cusimo-Aquädukt"]);
    });

    it("zwei Namen bekommen Marken, und sie sind deutsch sortiert", () => {
        const [only] = staettenGroupsOf(answerOf(group("Tempel", "Zwölfgöttertempel", "Ährentempel")));
        expect(only?.names.form).toBe("register");
        expect(lettersOf(only)).toEqual(["A", "Z"]);
        expect(namesOf(only)).toEqual(["Ährentempel", "Zwölfgöttertempel"]);
    });

    it("die Schwelle ist 2 und sie ist dieselbe Stelle wie bei den Vorkommen (nur ein anderer Wert)", () => {
        expect(STAETTEN_LETTER_MIN).toBe(2);
        expect(STAETTEN_GROUP_LID_MIN).toBe(LORE_GROUP_LID_MIN);
        expect(STAETTEN_GROUP_LID_MIN).toBe(25);
    });
});

describe("Die Klappschwelle zählt die ZEILE, nicht die Art", () => {
    const manyTypes = (total: number): StaettenGroup[] =>
        Array.from({ length: total }, (_, at) => group(`Art ${String(at).padStart(2, "0")}`, `Name ${String(at)}`));

    it("unter 25 Stätten in der Zeile klappt nichts, alles steht offen", () => {
        const models = staettenGroupsOf(answerOf(...manyTypes(24)));
        expect(models).toHaveLength(24);
        expect(models.every((model) => !model.collapsible && model.open)).toBe(true);
    });

    it("🔴 ab 25 klappen die Arten, und ALLE starten zu (WI-0122 Nachtrag, Abweichung von Legacy)", () => {
        // Je Art ZWEI Namen: Arten mit einem einzigen stünden ab 25 in der Sammelgruppe (WI-0122, unten).
        const pairs = Array.from({ length: 13 }, (_, at) =>
            group(`Art ${String(at).padStart(2, "0")}`, `Name ${String(at)}`, `Zweiter ${String(at)}`),
        );
        const models = staettenGroupsOf(answerOf(...pairs));
        expect(models).toHaveLength(13);
        expect(models.every((model) => model.collapsible)).toBe(true);
        // Betreiber 2026-10-09: „nö kannst zumachen“ - Legacys „Die erste Art steht offen“ gilt bei den Stätten nicht mehr.
        expect(models.map((model) => model.open)).toEqual(Array.from({ length: 13 }, () => false));
    });

    it("eine EINZIGE Art klappt nie, auch mit 30 Namen - zum Klappen gibt es keinen zweiten Block", () => {
        const names = Array.from({ length: 30 }, (_, at) => `Name ${String(at)}`);
        const [only] = staettenGroupsOf(answerOf(group("Tempel", ...names)));
        expect(only?.collapsible).toBe(false);
        expect(only?.open).toBe(true);
        expect(only?.names.form).toBe("register");
    });
});

describe("Der Sprung ⊕ reist durch denselben Namensblock", () => {
    it("steht am Namen, zu dem er gehört - und nur dort", () => {
        const target = { kind: "place" as const, id: GARETH_ID };
        const [only] = staettenGroupsOf({
            count: 2,
            groups: [
                {
                    type: "Turm",
                    entries: [
                        { name: "Alter Turm", jump: target },
                        { name: "Beuger Turm", url: "https://de.wiki-aventurica.de/wiki/Beuger_Turm" },
                    ],
                },
            ],
        });
        const entries = (only?.names.blocks ?? []).flatMap((block) => block.entries);
        expect(entries.find((entry) => entry.text === "Alter Turm")?.jump).toEqual(target);
        expect(entries.find((entry) => entry.text === "Beuger Turm")?.jump).toBeUndefined();
        expect(entries.find((entry) => entry.text === "Beuger Turm")?.href).toBe(
            "https://de.wiki-aventurica.de/wiki/Beuger_Turm",
        );
    });
});

/**
 * 🔴 **Eine LANGE Zeile sammelt die Einzelnen** (WI-0122, Betreiber 2026-10-09: „ja, B (A + Suchfeld) bauen“), am nachgebauten
 * Elenvina (`staetten-fixtures.ts`): vier Arten mit mehreren Namen, sechs mit einem.
 */
describe("🔴 WI-0122: eine lange Zeile sammelt die Einzelnen in „Weitere Gebäude und Stätten“", () => {
    const models = staettenGroupsOf(ELENVINA_ARTIG);

    it("eine eigene Klappzeile erst ab ZWEI Einträgen - dieselbe Regel wie die Marke, keine neue Zahl", () => {
        expect(STAETTEN_OWN_GROUP_MIN).toBe(STAETTEN_LETTER_MIN);
        expect(ELENVINA_ARTIG.count).toBeGreaterThanOrEqual(STAETTEN_GROUP_LID_MIN);
        expect(models.map((model) => model.heading)).toEqual([
            "Garnison",
            "Gasthaus",
            "Provinzherrliches Garderegiment",
            "Tempel",
            "Weitere Gebäude und Stätten",
        ]);
        expect(models.map((model) => model.count)).toEqual([3, 7, 2, 9, 6]);
        // Klappbar wie bisher: mehrere Gruppen, lange Zeile - und seit dem Nachtrag startet keine offen.
        expect(models.every((model) => model.collapsible)).toBe(true);
        expect(models.map((model) => model.open)).toEqual([false, false, false, false, false]);
    });

    it("die Sammelgruppe steht am Ende, als Zeilen „Art · Stätte“, nach der Art sortiert", () => {
        const collected = models.at(-1);
        expect(collected?.collected).toBe(true);
        expect(collected?.art).toBeUndefined();
        expect(collected?.names.form).toBe("rows");
        expect(
            collected?.names.blocks.map((block) => [
                block.label?.text,
                namesOf({ ...collected, names: { form: "rows", blocks: [block] } }),
            ]),
        ).toEqual([
            ["Aquädukt", ["Herzog-Cusimo-Aquädukt"]],
            ["Archiv", ["Archiv der Praios-Kirche"]],
            ["Brücke", ["Jast-Gorsam-Brücke"]],
            ["Gräfliches Garderegiment", ["Elenviner Gleventräger"]],
            ["Kaiserliches Garderegiment", ["Greifengarde"]],
            ["Militäreinheit", ["Schatzgarde"]],
        ]);
        // Eine Zeile trägt keine Buchstabenmarke - die Art IST ihre Gliederung.
        expect(lettersOf(collected).every((letter) => letter === "")).toBe(true);
    });

    it("„(Hauptsitz)“ ist ein gedämpftes Kennzeichen, nicht Teil des Artnamens - am Kopf wie an der Zeile", () => {
        const regiment = models.find((model) => model.heading === "Provinzherrliches Garderegiment");
        expect(regiment?.mark).toBe("Hauptsitz");
        expect(models.find((model) => model.heading === "Tempel")?.mark).toBeUndefined();
        const labels = models.at(-1)?.names.blocks.map((block) => block.label);
        expect(labels?.find((label) => label?.text === "Archiv")?.mark).toBe("Hauptsitz");
        expect(labels?.find((label) => label?.text === "Brücke")?.mark).toBeUndefined();
    });

    it("die Art bleibt samt Kennzeichen ihr eigener Schlüssel: „Kanzlei“ und „Kanzlei (Hauptsitz)“ sind zwei Arten", () => {
        const [plain, seat] = staettenGroupsOf(
            answerOf(group("Kanzlei (Hauptsitz)", "Reichskanzlei"), group("Kanzlei", "Hofkanzlei")),
        );
        expect([plain?.heading, plain?.mark]).toEqual(["Kanzlei", undefined]);
        expect([seat?.heading, seat?.mark]).toEqual(["Kanzlei", "Hauptsitz"]);
    });

    it("🔴 unter 25 Stätten wird NICHTS gesammelt - jede Art steht mit ihrem Kopf da (WI-0103 bleibt)", () => {
        const short = staettenGroupsOf(
            answerOf(
                group("Tempel", "Praiostempel"),
                group("Palast", "Pfalz"),
                group("Turm", "Alter Turm", "Neuer Turm"),
            ),
        );
        expect(short.map((model) => model.heading)).toEqual(["Palast", "Tempel", "Turm"]);
        expect(short.some((model) => model.collected === true)).toBe(false);
    });

    it("eine lange Zeile nur aus Einzelnen: die Sammelgruppe allein, offen, nichts zu klappen", () => {
        const singles = Array.from({ length: 25 }, (_, at) =>
            group(`Art ${String(at).padStart(2, "0")}`, `Name ${String(at)}`),
        );
        const [only, ...rest] = staettenGroupsOf(answerOf(...singles));
        expect(rest).toEqual([]);
        expect(only?.collected).toBe(true);
        expect(only?.count).toBe(25);
        expect(only?.collapsible).toBe(false);
        expect(only?.open).toBe(true);
    });
});

/**
 * 🔴 **WI-0122 Nachtrag: die Ordnung** (Betreiber 2026-10-09: „kannst du neben dem suchfeld ein kleines dropdown bauen, wo man
 * alphabetisch (wie jetzt) und nach häufigkeit sortieren kann?“).
 */
describe("🔴 WI-0122 Nachtrag: alphabetisch oder nach Häufigkeit", () => {
    const names = (prefix: string, count: number): string[] =>
        Array.from({ length: count }, (_, at) => `${prefix} ${String(at + 1)}`);
    // Zwei Arten mit gleicher Zahl (Gleichstand), eine kleinere und drei Einzelne: 10 + 10 + 5 + 3 = 28 Stätten.
    const answer = staettenAnswerOf(
        staettenGroup("Zunft", ...names("Zunfthaus", 10)),
        staettenGroup("Amt", ...names("Amtsstube", 10)),
        staettenGroup("Brunnen", ...names("Brunnen", 5)),
        staettenGroup("Palast", "Kaiserpfalz"),
        staettenGroup("Archiv (Hauptsitz)", "Stadtarchiv"),
        staettenGroup("Turm", "Alter Turm"),
    );
    const headings = (order: "alpha" | "count"): string[] =>
        staettenGroupsOf(answer, order).map((model) => model.heading);

    it("alphabetisch ist die Vorgabe und bleibt, wie es war", () => {
        expect(headings("alpha")).toEqual(["Amt", "Brunnen", "Zunft", "Weitere Gebäude und Stätten"]);
        expect(staettenGroupsOf(answer).map((model) => model.heading)).toEqual(headings("alpha"));
    });

    it("nach Häufigkeit: die Zahl absteigend, bei Gleichstand alphabetisch", () => {
        expect(headings("count")).toEqual(["Amt", "Zunft", "Brunnen", "Weitere Gebäude und Stätten"]);
    });

    it("„Weitere Gebäude und Stätten“ steht in beiden Ordnungen am Ende, ihre Zeilen bleiben nach der Art geordnet", () => {
        for (const order of ["alpha", "count"] as const) {
            const models = staettenGroupsOf(answer, order);
            expect(models.at(-1)?.collected).toBe(true);
            expect(models.at(-1)?.names.blocks.map((block) => block.label?.text)).toEqual(["Archiv", "Palast", "Turm"]);
        }
    });

    it("die Wahl erscheint nur, wo sie etwas ändert", () => {
        expect(staettenOrderMatters(answer)).toBe(true);
        expect(staettenOrderMatters(ELENVINA_ARTIG)).toBe(true);
        // Alphabetisch steht schon nach der Zahl absteigend: Eine Wahl hätte keine Wirkung.
        const already = staettenAnswerOf(
            staettenGroup("Amt", ...names("Amtsstube", 12)),
            staettenGroup("Brunnen", ...names("Brunnen", 8)),
            staettenGroup("Zunft", ...names("Zunfthaus", 6)),
        );
        expect(staettenOrderMatters(already)).toBe(false);
    });

    it("die Suche wirkt auf die geordnete Liste", () => {
        const order = staettenGroupsOf(ELENVINA_ARTIG, "count").map((model) => model.heading);
        expect(order).toEqual([
            "Tempel",
            "Gasthaus",
            "Garnison",
            "Provinzherrliches Garderegiment",
            "Weitere Gebäude und Stätten",
        ]);
        const shown = searchGroups(staettenGroupsOf(ELENVINA_ARTIG, "count"), "e").groups.map((model) => model.heading);
        expect(shown.length).toBeGreaterThan(2);
        expect(shown).toEqual(order.filter((heading) => shown.includes(heading)));
        expect(shown.at(-1)).toBe("Weitere Gebäude und Stätten");
        // Gefundene Gruppen stehen offen, auch wenn sie ohne Suche alle zu starten.
        expect(searchGroups(staettenGroupsOf(ELENVINA_ARTIG, "count"), "e").groups.every((model) => model.open)).toBe(
            true,
        );
    });
});
