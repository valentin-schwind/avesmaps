import { describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n/i18n.ts";
import { LORE_GROUP_LID_MIN, loreNamesOf, type LoreGroupModel } from "../src/info-panel/lore-model.ts";
import { lineSearchable, markedParts, searchGroups, searchNeedle, textMatches } from "../src/info-panel/lore-search.ts";
import { staettenGroupsOf } from "../src/info-panel/staetten-model.ts";
import { ELENVINA_ARTIG } from "./staetten-fixtures.ts";

/**
 * Die Suche einer langen Klappliste (WI-0122, Betreiber 2026-10-09: „ja, B (A + Suchfeld) bauen“ und „Matches in der Suche
 * sollen dann auch die Kategorien in "Weitere Gebäuden/Stätten" korrekt anzeigen“).
 *
 * Benannte Fälle:
 * 1. **Die Suche trifft die ART einer Zeile der Sammelgruppe** - die Zeile steht, auch wenn ihr Name nicht trifft, und die Art
 *    trägt ihr Kennzeichen weiter.
 * 2. **Die Suche trifft einen NAMEN** - die Zeile oder Gruppe steht, die Art daneben bleibt stehen.
 * 3. **Kein Treffer** - keine Gruppe, null Treffer.
 * 4. **Akzente, Groß/klein, ß** - „aquadukt“ findet „Aquädukt“, „strasse“ findet „Straße“, markiert wird im Original.
 * 5. **Die Schwelle** ist die der Klappgruppen (25 Namen in der Zeile), auch für EINE Gruppe.
 * 6. **Vorkommen**: gesucht werden die Namen, nie die Gliederung („Von hier“).
 */

setLocale("de");

const elenvina = (): LoreGroupModel[] => staettenGroupsOf(ELENVINA_ARTIG);
const headings = (groups: readonly LoreGroupModel[]): string[] => groups.map((group) => group.heading);
const names = (group: LoreGroupModel | undefined): string[] =>
    (group?.names.blocks ?? []).flatMap((block) => block.entries.map((entry) => entry.text));
const rowLabels = (group: LoreGroupModel | undefined): (string | undefined)[] =>
    (group?.names.blocks ?? []).map((block) =>
        block.label === undefined ? undefined : [block.label.text, block.label.mark].filter(Boolean).join(" · "),
    );

describe("1. Die Suche trifft die ART einer Zeile der Sammelgruppe", () => {
    const result = searchGroups(elenvina(), "garde");
    const collected = result.groups.find((group) => group.collected === true);

    it("die Zeile steht, auch wenn ihr Name nicht trifft - und die Art trägt ihr Kennzeichen", () => {
        // „Elenviner Gleventräger“ trifft „garde“ nicht, seine Art „Gräfliches Garderegiment“ schon.
        expect(rowLabels(collected)).toEqual([
            "Gräfliches Garderegiment · Hauptsitz",
            "Kaiserliches Garderegiment · Hauptsitz",
            "Militäreinheit · Hauptsitz",
        ]);
        expect(names(collected)).toEqual(["Elenviner Gleventräger", "Greifengarde", "Schatzgarde"]);
    });

    it("die Sammelgruppe zählt „3 von 6“ und steht offen", () => {
        expect(collected?.count).toBe(3);
        expect(collected?.total).toBe(6);
        expect(collected?.open).toBe(true);
    });

    it("eine Art-Gruppe, deren Art trifft, steht ganz; eine, deren Name trifft, nur mit diesem Namen", () => {
        expect(headings(result.groups)).toEqual([
            "Garnison",
            "Provinzherrliches Garderegiment",
            "Weitere Gebäude und Stätten",
        ]);
        const garnison = result.groups[0];
        expect(names(garnison)).toEqual(["Garnison der Stadtgarde von Elenvina"]);
        expect([garnison?.count, garnison?.total]).toEqual([1, 3]);
        const regiment = result.groups[1];
        expect(names(regiment)).toEqual(["Elenviner Flussgarde", "Elenviner Garde"]);
        expect([regiment?.count, regiment?.total]).toEqual([2, 2]);
        expect(result.groups.every((group) => group.open)).toBe(true);
    });

    it("„6 Treffer in 5 Arten“: je Art-Gruppe eine Art, je Zeile der Sammelgruppe eine", () => {
        expect(result.hits).toBe(6);
        expect(result.types).toBe(5);
    });

    it("das Kennzeichen selbst ist Text, der dasteht - „hauptsitz“ findet jede Art mit Kennzeichen", () => {
        const seats = searchGroups(elenvina(), "hauptsitz");
        expect(headings(seats.groups)).toEqual(["Provinzherrliches Garderegiment", "Weitere Gebäude und Stätten"]);
        expect(rowLabels(seats.groups[1])).toHaveLength(4);
    });
});

describe("2. Die Suche trifft einen NAMEN", () => {
    it("in einer Art-Gruppe: nur dieser Name, die Gruppe mit ihrer Art darüber", () => {
        const result = searchGroups(elenvina(), "hafen");
        expect(headings(result.groups)).toEqual(["Garnison"]);
        expect(names(result.groups[0])).toEqual(["Hafenwache"]);
        expect([result.hits, result.types]).toEqual([1, 1]);
    });

    it("in der Sammelgruppe: die Zeile samt ihrer Art, auch wenn die Art nicht trifft", () => {
        const result = searchGroups(elenvina(), "praios");
        expect(headings(result.groups)).toEqual(["Weitere Gebäude und Stätten"]);
        expect(rowLabels(result.groups[0])).toEqual(["Archiv · Hauptsitz"]);
        expect(names(result.groups[0])).toEqual(["Archiv der Praios-Kirche"]);
    });
});

describe("3. Kein Treffer", () => {
    it("keine Gruppe, null Treffer", () => {
        const result = searchGroups(elenvina(), "Brauerei");
        expect(result.groups).toEqual([]);
        expect(result.hits).toBe(0);
    });

    it("ohne Suchwort (oder nur Leerzeichen) kommen die Gruppen unverändert zurück", () => {
        const groups = elenvina();
        for (const query of ["", "   "]) {
            const result = searchGroups(groups, query);
            expect(result.groups).toEqual(groups);
            expect(result.hits).toBe(ELENVINA_ARTIG.count);
        }
    });
});

describe("4. Akzente, Groß/klein und ß", () => {
    it("„aquadukt“ findet „Aquädukt“, „BRUCKE“ findet „Brücke“", () => {
        expect(rowLabels(searchGroups(elenvina(), "aquadukt").groups[0])).toEqual(["Aquädukt"]);
        expect(rowLabels(searchGroups(elenvina(), "BRUCKE").groups[0])).toEqual(["Brücke"]);
    });

    it("markiert wird im ORIGINAL, mit seinen Akzenten", () => {
        expect(markedParts("Jast-Gorsam-Brücke", searchNeedle("brucke"))).toEqual([
            { text: "Jast-Gorsam-", hit: false },
            { text: "Brücke", hit: true },
        ]);
        expect(markedParts("Garnison der Stadtgarde von Elenvina", searchNeedle("GARDE"))).toEqual([
            { text: "Garnison der Stadt", hit: false },
            { text: "garde", hit: true },
            { text: " von Elenvina", hit: false },
        ]);
    });

    it("„strasse“ findet „Straße“ - ß zählt als zwei Zeichen, markiert wird das eine", () => {
        expect(textMatches("Herzogenstraße", searchNeedle("strasse"))).toBe(true);
        expect(markedParts("Herzogenstraße", searchNeedle("strasse"))).toEqual([
            { text: "Herzogen", hit: false },
            { text: "straße", hit: true },
        ]);
    });

    it("auch zerlegte Akzente (NFD) treffen und werden ganz markiert", () => {
        const decomposed = "Aquädukt";
        expect(markedParts(decomposed, searchNeedle("aquädukt"))).toEqual([{ text: decomposed, hit: true }]);
    });

    it("ohne Suchwort ein Stück ohne Treffer", () => {
        expect(markedParts("Tempel", "")).toEqual([{ text: "Tempel", hit: false }]);
        expect(textMatches("Tempel", "")).toBe(false);
    });
});

describe("5. Die Schwelle ist die der Klappgruppen", () => {
    const loreGroup = (count: number): LoreGroupModel => ({
        key: "flora:here",
        heading: "Direkt von hier",
        count,
        collapsible: false,
        open: true,
        names: loreNamesOf(
            Array.from({ length: count }, (_, at) => ({ name: `Pflanze ${String(at)}` })),
            "flora:here",
        ),
    });

    it("ab 25 Namen in der ZEILE - auch bei EINER Gruppe (445 Pflanzen der Landschaft „Aventurien“)", () => {
        expect(LORE_GROUP_LID_MIN).toBe(25);
        expect(lineSearchable([loreGroup(24)])).toBe(false);
        expect(lineSearchable([loreGroup(25)])).toBe(true);
        expect(lineSearchable([loreGroup(445)])).toBe(true);
        expect(lineSearchable(elenvina())).toBe(true);
    });
});

describe("6. Vorkommen: gesucht werden die Namen, nie die Gliederung", () => {
    it("„hier“ trifft „Direkt von hier“ nicht", () => {
        const group: LoreGroupModel = {
            key: "ware:here",
            heading: "Direkt von hier",
            count: 2,
            collapsible: false,
            open: true,
            names: loreNamesOf([{ name: "Rotwein" }, { name: "Hierbrot" }], "ware:here"),
        };
        const result = searchGroups([group], "hier");
        expect(names(result.groups[0])).toEqual(["Hierbrot"]);
        expect(result.types).toBe(0);
        expect(searchGroups([group], "direkt").groups).toEqual([]);
    });
});
