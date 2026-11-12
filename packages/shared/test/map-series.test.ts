import { describe, expect, it } from "vitest";
import {
    ANSICHT_FUER_BILDNAMEN,
    AVENTURIA_SERIES,
    editorViewer,
    LEGAL_NOTICES,
    PROVENANCE_FIELDS,
    permissionIsEvidenced,
    getDefaultMapSeries,
    getMapSeries,
    getVisibleMapSeries,
    nurUnterNurKarte,
    publicationBlockers,
    visitorViewer,
    type MapSeries,
} from "../src/index.ts";

/**
 * The catalog is the single source for what a series is and where it legally comes from
 * (chapter 5.3 to 5.5). These tests nail down the part that must not silently change: that the
 * pyramid geometry matches the sources, and that nothing gets published without its provenance.
 */
describe("map series catalog", () => {
    it("offers the three Aventurien series with the labelled one marked", () => {
        expect(AVENTURIA_SERIES.series.map((series) => series.id)).toEqual(["original", "old", "modern"]);
        // Betreiber 2026-09-24: „die modern im standard modus zum default machen“.
        expect(getDefaultMapSeries().id).toBe("modern");
        expect(getMapSeries("old").labelsInImage).toBe(true);
        expect(getMapSeries("original").labelsInImage).toBe(false);
        expect(getMapSeries("modern").labelsInImage).toBe(false);
    });

    it("keeps the native zoom consistent with the source resolution", () => {
        for (const series of AVENTURIA_SERIES.series) {
            expect(series.sourcePixels / series.tileSize, series.id).toBe(2 ** series.maxNativeZoom);
        }
    });

    it("carries the licence of the map package with its URI", () => {
        // The licence demands its full URI with every distribution; an empty field would make the
        // attribution on the map incomplete.
        expect(AVENTURIA_SERIES.license.uri).toMatch(/^https:\/\//);
        expect(AVENTURIA_SERIES.license.name.trim()).not.toBe("");
        expect(AVENTURIA_SERIES.license.terms.trim()).not.toBe("");
    });

    it("names author, origin and attribution for every series", () => {
        for (const series of AVENTURIA_SERIES.series) {
            expect(series.author.trim(), series.id).not.toBe("");
            expect(series.origin.trim(), series.id).not.toBe("");
            expect(series.attribution.trim(), series.id).not.toBe("");
            expect(series.permission.statement.trim(), series.id).not.toBe("");
        }
    });

    it("keeps an established gap apart from an unfilled field", () => {
        // UNDOCUMENTED is a finding: the derivation could not be established, so the text stays
        // empty on purpose and nothing may be invented for it later. The rule is the pairing, not
        // which series happens to be on which side of it.
        for (const series of AVENTURIA_SERIES.series) {
            const documented = series.derivationStatus === "DOCUMENTED";
            expect(series.derivation.trim() !== "", `${series.id} derivation matches its status`).toBe(documented);
        }
        // `old` carried that finding until 2026-10-12. The operator then stated how the file came
        // about ("old ist einfach die ina-kramer-karte"), which closed the gap - a statement is
        // evidence, an empty field is not. The assertion is kept the other way round so the text
        // cannot quietly disappear again.
        expect(getMapSeries("old").derivationStatus).toBe("DOCUMENTED");
        expect(getMapSeries("old").derivation).toContain("Ina Kramer");
    });

    it("keeps the permission apart from its evidence", () => {
        // The operator stated the permission exists; who granted it and in what form is not
        // documented. Neither fact may be read as the other.
        for (const series of AVENTURIA_SERIES.series) {
            expect(permissionIsEvidenced(series), `${series.id} has no evidence trail yet`).toBe(false);
            expect(publicationBlockers(series), `${series.id} is not blocked by the missing evidence`).not.toContain(
                "permission",
            );
        }
    });

    it("never marks a series published while its provenance is incomplete", () => {
        for (const series of AVENTURIA_SERIES.series) {
            if (publicationBlockers(series).length > 0) {
                expect(series.status, series.id).toBe("IMPORTED");
            }
        }
    });

    it("reports every missing provenance field by name", () => {
        const complete = getMapSeries("modern");
        expect(publicationBlockers(complete)).toEqual([]);

        const withoutDerivation: MapSeries = { ...complete, derivation: "   " };
        expect(publicationBlockers(withoutDerivation)).toEqual(["derivation"]);

        const empty: MapSeries = {
            ...complete,
            author: "",
            origin: "",
            derivation: "",
            permission: { ...complete.permission, statement: "" },
            attribution: "",
        };
        expect(publicationBlockers(empty)).toEqual(PROVENANCE_FIELDS);
    });
});

describe("Sichtbarkeit einer Serie", () => {
    it("🔴 zeigt `old` Besuchern nur unter „Nur Karte“ (Betreiber 2026-11-10)", () => {
        // `old` ist dieselbe Karte wie `original`, aber seine Ortsnamen stecken IM RASTER. Unter
        // unseren Vektorlabels stuende jeder Name doppelt. „Nur Karte“ zeichnet keine Namen von uns.
        const besucher = visitorViewer("test");
        const oeffentlich = getVisibleMapSeries(besucher).map((series) => series.id);
        expect(oeffentlich).toEqual(expect.arrayContaining(["original", "modern", "old"]));
        expect(nurUnterNurKarte(besucher, getMapSeries("old"))).toBe(true);
        expect(nurUnterNurKarte(besucher, getMapSeries("original"))).toBe(false);
        expect(nurUnterNurKarte(besucher, getMapSeries("modern"))).toBe(false);
        expect(ANSICHT_FUER_BILDNAMEN).toBe("none");
    });

    it("zeigt sie Editoren sehr wohl", () => {
        // Editoren sind Nutzerkonten; solange es die nicht gibt, ist jeder Editor, der eine
        // passwortgeschuetzte Instanz erreicht hat. Zu strikt zu filtern nimmt ihnen die
        // Vergleichskarte.
        expect(getVisibleMapSeries(editorViewer("test")).map((series) => series.id)).toContain("old");
        expect(nurUnterNurKarte(editorViewer("test"), getMapSeries("old"))).toBe(false);
    });

    it("💣 haelt jede Serie mit Namen im Raster fuer Besucher in „Nur Karte“", () => {
        // Der fachliche Grund, nicht die einzelne Serie: doppelte Namen entstehen bei JEDER Serie
        // mit `labelsInImage`, in jeder Ansicht mit unseren Namen.
        for (const series of AVENTURIA_SERIES.series) {
            expect(nurUnterNurKarte(visitorViewer("test"), series), series.id).toBe(series.labelsInImage);
        }
        expect(getMapSeries(AVENTURIA_SERIES.defaultSeries).labelsInImage).toBe(false);
    });

    it("laesst die Standardserie in beiden Faellen sichtbar", () => {
        // Eine unsichtbare Standardserie waere eine Karte, die ohne Auswahl nichts anzeigen kann.
        for (const viewer of [editorViewer("test"), visitorViewer("test")]) {
            const sichtbar = getVisibleMapSeries(viewer).map((series) => series.id);
            expect(sichtbar, viewer.source).toContain(AVENTURIA_SERIES.defaultSeries);
        }
    });

    it("🪤 liefert eine ausgeblendete Serie weiterhin ueber getMapSeries aus", () => {
        // Ausblenden ist kein Sperren: der Server muss `old` weiter kennen und ausliefern, sonst
        // koennten Editoren es nicht sehen. Wer den Kachelpfad kennt, erreicht ihn.
        expect(getMapSeries("old").labelsInImage).toBe(true);
    });
});

describe("legal notices", () => {
    it("carries the disclaimer and the fan guideline link the map has to show", () => {
        expect(JSON.stringify(LEGAL_NOTICES.hinweise)).toContain("Ulisses Medien und Spiel Distribution GmbH");
        expect(LEGAL_NOTICES.project.fanGuidelinesUri).toMatch(/^https:\/\//);
    });
});
