import { afterEach, describe, expect, it } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import type { SubjectDetail } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import { presentationFromDetail } from "../src/info-panel/presentation.ts";
import type { RowModel } from "../src/info-panel/panel-types.ts";
import { pathFilter } from "../src/map/area-selection.ts";
import { env, reichsstrasse, shown } from "./panel-fixtures.ts";

/**
 * Geteilte Abschnitte im Infopanel und auf der Karte (WI-0302; Vali 2026-11-10, Option „Ja, mitzählen“; Entwurf „Weitere Straßennamen“, Ansicht
 * Infopanel am Goldfelser Stieg). Problemfälle: „Gemeinsam mit“ fehlt oder steht ohne Link; „Von → Bis“ steht bei mehreren Abschnitten; die
 * goldene Markierung filtert weiter nach dem Namen und lässt den geteilten Abschnitt der anderen Straße dunkel; ohne die Liste leuchtet nichts mehr.
 */

const SIKRAM = { kind: "path" as const, anchor: "0c0c0c0c-0000-4000-8000-0000000000b1", wiki: "sikramstieg" };
const EIGENER = "00051122-928a-44de-a4cf-b2de4f1b0999";
const GETEILTER = "0c0c0c0c-0000-4000-8000-0000000000b2";
const GRUPPE = [EIGENER, GETEILTER];
const gemeinsam = (eintraege: NonNullable<SubjectDetail["gemeinsam"]>): SubjectDetail => ({
    ...reichsstrasse,
    gemeinsam: eintraege,
    abschnitte: GRUPPE,
});

const zeile = (detail: SubjectDetail): RowModel | undefined =>
    panelModelOf(shown(detail), null, env())?.rows.find((row) => row.key === "gemeinsam");
const text = (row: RowModel | undefined): string =>
    row?.value.kind === "parts" ? row.value.parts.map((part) => part.text).join("") : "";

afterEach(() => setLocale("de"));

describe("Infopanel: „Gemeinsam mit“ (WI-0302)", () => {
    it("🔴 je Straße ein Link, bei genau einem geteilten Abschnitt „Von → Bis“, nach „Verlauf“ und vor der Beschreibung", () => {
        const detail = gemeinsam([{ name: "Sikramstieg", ref: SIKRAM, abschnitte: 1, von: "Sibur", bis: "Radoleth" }]);
        const row = zeile(detail);
        expect(row?.label).toBe("Gemeinsam mit");
        expect(text(row)).toBe("Sikramstieg (Sibur → Radoleth)");
        expect(row?.value.kind === "parts" ? row.value.parts[0] : undefined).toEqual({
            text: "Sikramstieg",
            ref: SIKRAM,
        });
        const reihe = panelModelOf(shown(detail), null, env())?.rows.map((r) => r.key) ?? [];
        expect(reihe.indexOf("gemeinsam")).toBeGreaterThan(reihe.findIndex((key) => key.startsWith("verlauf")));
        expect(reihe.indexOf("gemeinsam")).toBeLessThan(reihe.findIndex((key) => key.startsWith("description")));
    });

    it("mehrere Abschnitte oder ein Ende ohne Ort: die Zahl statt der Strecke; mehrere Straßen mit Komma", () => {
        const detail = gemeinsam([
            { name: "Sikramstieg", ref: SIKRAM, abschnitte: 3 },
            { name: "Pilgerweg", ref: { kind: "path", chain: "name:Pilgerweg" }, abschnitte: 1, von: "Gareth" },
        ]);
        expect(text(zeile(detail))).toBe("Sikramstieg (3 Abschnitte), Pilgerweg (1 Abschnitt)");
        setLocale("en");
        expect(zeile(detail)?.label).toBe("Shared with");
        expect(text(zeile(detail))).toBe("Sikramstieg (3 segments), Pilgerweg (1 segment)");
    });

    it("ohne `gemeinsam` keine Zeile", () => {
        expect(zeile(reichsstrasse)).toBeUndefined();
    });
});

describe("Karte: die Abschnitte der Gruppe leuchten, auch die geteilten (WI-0302)", () => {
    const passt = (filter: unknown, properties: Record<string, unknown>): boolean =>
        featureFilter(filter as never, "filter").filter(
            { zoom: 4 },
            { type: 2, properties } as never,
            undefined as never,
        );

    it("🔴 mit `abschnitte` filtert das Gold nach `public_id` der Kacheln, nicht nach dem Namen", () => {
        const filter = pathFilter({ id: "name:Goldfelser Stieg", name: "Goldfelser Stieg", abschnitte: GRUPPE });
        expect(passt(filter, { public_id: GETEILTER, name: "Sikramstieg", subtype: "Strasse" })).toBe(true);
        expect(passt(filter, { public_id: "ffffffff-0000-4000-8000-000000000000", name: "Goldfelser Stieg" })).toBe(
            false,
        );
    });

    it("ein markierter Abschnitt (Editor) geht vor; ohne Liste gilt der Name wie bisher", () => {
        const einer = pathFilter({
            id: "name:Goldfelser Stieg",
            name: "Goldfelser Stieg",
            segment: EIGENER,
            abschnitte: GRUPPE,
        });
        expect(passt(einer, { public_id: GETEILTER })).toBe(false);
        expect(passt(einer, { public_id: EIGENER })).toBe(true);
        const name = pathFilter({ id: "name:Goldfelser Stieg", name: "Goldfelser Stieg" });
        expect(passt(name, { public_id: "x", name: "Goldfelser Stieg", subtype: "Strasse" })).toBe(true);
        expect(pathFilter({ id: "name:X", name: "X", abschnitte: [] })).toEqual(
            pathFilter({ id: "name:X", name: "X" }),
        );
    });

    it("🔴 die Darstellung aus der Antwort trägt die Abschnitte der Gruppe; ohne sie bleibt sie wie bisher", () => {
        expect(
            presentationFromDetail(gemeinsam([{ name: "Sikramstieg", ref: SIKRAM, abschnitte: 1 }])).area,
        ).toMatchObject({
            kind: "path",
            abschnitte: GRUPPE,
        });
        expect(presentationFromDetail(reichsstrasse).area).not.toHaveProperty("abschnitte");
    });
});
