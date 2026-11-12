import { describe, expect, it } from "vitest";
import type { ReleaseVerlauf } from "@avesmaps3d/shared";
import { verlaufVon } from "../src/versionen/lesen.ts";

/** Der Verlauf in „Versionen“: die jüngsten Commits des laufenden Stands, ohne die lange Beschreibung; ohne Datei nichts. */
const sha = (ziffer: string) => ziffer.repeat(40);
const commit = (ziffer: string) => ({
    sha: sha(ziffer),
    art: "feat",
    titel: `feat: ${ziffer}`,
    neu: [],
    achtung: [],
    anwendung: true,
    beschreibung: "lang",
});

describe("verlaufVon", () => {
    it("kappt auf die jüngsten, behält die Reihenfolge und lässt die Beschreibung weg", () => {
        const verlauf: ReleaseVerlauf = { schema: 1, bis: sha("a"), commits: [commit("a"), commit("b"), commit("c")] };
        const aus = verlaufVon(verlauf, 2);
        expect(aus?.bis).toBe(sha("a"));
        expect(aus?.commits.map((eintrag) => eintrag.sha)).toEqual([sha("a"), sha("b")]);
        expect(aus?.commits.every((eintrag) => !("beschreibung" in eintrag))).toBe(true);
    });

    it("ohne Verlauf nichts", () => {
        expect(verlaufVon(null, 100)).toBeNull();
    });
});
