import { describe, expect, it } from "vitest";
import {
    transformSources,
    type LegacyAreaPayload,
    type LegacyMapPayload,
    type LegacyRegionPayload,
} from "../src/migration/regions.ts";

/**
 * `transformSources` ist eine reine Funktion (keine Datenbank), deshalb hier als Unit-Test statt
 * nur ueber `verify:regions` gegen einen echten Bestand.
 */

const REGION_ID = "00000000-0000-4000-8000-0000000005a1";
const OTHER_REGION_ID = "00000000-0000-4000-8000-0000000005a2";
const LABEL_ID = "00000000-0000-4000-8000-0000000005b1";
const OTHER_LABEL_ID = "00000000-0000-4000-8000-0000000005b2";

function regionPayload(overrides: Partial<{ label_public_id: string | null }> = {}): LegacyRegionPayload {
    return {
        ok: true,
        regions: [
            {
                public_id: REGION_ID,
                name: "Amboss",
                kind: "topographie",
                area_count: 1,
                curve_label: true,
                curve_label_max: 1,
                label_public_id: overrides.label_public_id ?? null,
            },
        ],
    };
}

const areas: LegacyAreaPayload = { ok: true, revision: 1, truncated: false, areas: [] };

function labelFeature(publicId: string, ecosystemRegionPublicId: string | null, name = "Amboss") {
    return {
        geometry: { type: "Point", coordinates: [500, 500] },
        properties: {
            feature_type: "label",
            public_id: publicId,
            name,
            ...(ecosystemRegionPublicId === null ? {} : { ecosystem_region_public_id: ecosystemRegionPublicId }),
        },
    };
}

describe("transformSources: Primaerlabel ueber den Rueckwaertszeiger (Koordination 2026-09-28)", () => {
    it("fuellt die Luecke, wenn genau ein Label die Region ueber ecosystem_region_public_id beansprucht", () => {
        const labels: LegacyMapPayload = { ok: true, revision: 1, features: [labelFeature(LABEL_ID, REGION_ID)] };
        const result = transformSources(regionPayload(), areas, labels);

        const region = result.regions.find((r) => r.publicId === REGION_ID);
        expect(region?.primaryLabelPublicId).toBe(LABEL_ID);
        expect(result.primaryLabelFromReverse).toEqual([
            { publicId: REGION_ID, name: "Amboss", labelPublicId: LABEL_ID },
        ]);
        expect(result.danglingPrimaryLabels).toEqual([]);
    });

    it("greift nicht, wenn die Region schon ihren eigenen Vorwaertszeiger traegt", () => {
        const labels: LegacyMapPayload = { ok: true, revision: 1, features: [labelFeature(LABEL_ID, REGION_ID)] };
        const result = transformSources(regionPayload({ label_public_id: LABEL_ID }), areas, labels);

        expect(result.primaryLabelFromReverse).toEqual([]);
    });

    it("bleibt leer, wenn ZWEI Labels dieselbe Region beanspruchen (kein eindeutiger Kandidat)", () => {
        const labels: LegacyMapPayload = {
            ok: true,
            revision: 1,
            features: [
                labelFeature(LABEL_ID, REGION_ID),
                labelFeature(OTHER_LABEL_ID, REGION_ID, "Amboss (zweites Label)"),
            ],
        };
        const result = transformSources(regionPayload(), areas, labels);

        const region = result.regions.find((r) => r.publicId === REGION_ID);
        expect(region?.primaryLabelPublicId).toBeNull();
        expect(result.primaryLabelFromReverse).toEqual([]);
    });

    it("bleibt leer, wenn kein Label auf die Region zeigt", () => {
        const labels: LegacyMapPayload = { ok: true, revision: 1, features: [labelFeature(LABEL_ID, OTHER_REGION_ID)] };
        const result = transformSources(regionPayload(), areas, labels);

        const region = result.regions.find((r) => r.publicId === REGION_ID);
        expect(region?.primaryLabelPublicId).toBeNull();
        expect(result.primaryLabelFromReverse).toEqual([]);
        // Das Label selbst geht ins Leere, weil OTHER_REGION_ID nicht im Regionsbestand steckt.
        expect(result.freeLabels).toBe(1);
    });

    it("laesst den bestehenden Rueckwaertszeiger der Region (boundByRegionPointer) unberuehrt", () => {
        // Das Label traegt selbst KEINEN ecosystem_region_public_id, aber die Region zeigt per
        // label_public_id auf es (Legacys Regel, Schritt zwei). Das ist ein anderer Pfad als der
        // neue Fallback und darf nicht doppelt in primaryLabelFromReverse auftauchen.
        const labels: LegacyMapPayload = { ok: true, revision: 1, features: [labelFeature(LABEL_ID, null)] };
        const result = transformSources(regionPayload({ label_public_id: LABEL_ID }), areas, labels);

        const region = result.regions.find((r) => r.publicId === REGION_ID);
        expect(region?.primaryLabelPublicId).toBe(LABEL_ID);
        expect(result.primaryLabelFromReverse).toEqual([]);
    });
});

describe("transformSources: Legacys Obergrenze 7 wird Ziel 8 (WI-0129, Betreiber 2026-10-10 E2 A)", () => {
    function mitBand(publicId: string, minZoom: unknown, maxZoom: unknown) {
        const feature = labelFeature(publicId, REGION_ID);
        const properties: Record<string, unknown> = { ...feature.properties, min_zoom: minZoom };
        if (maxZoom !== undefined) properties["max_zoom"] = maxZoom;
        return { ...feature, properties };
    }
    const ids = Array.from(
        { length: 7 },
        (_, index) => `00000000-0000-4000-8000-0000000129${String(index).padStart(2, "0")}`,
    );
    function band(result: ReturnType<typeof transformSources>, publicId: string) {
        const label = result.labels.find((entry) => entry.publicId === publicId);
        return [label?.minZoom, label?.maxZoom];
    }

    it("🔴 schreibt 7 als 8, auch als Text „7“; kleinere Maxima, Untergrenzen und ein fehlendes Maximum bleiben", () => {
        const labels: LegacyMapPayload = {
            ok: true,
            revision: 1,
            features: [
                mitBand(ids[0] as string, 5, 7),
                mitBand(ids[1] as string, 2, "7"),
                mitBand(ids[2] as string, 0, 6),
                mitBand(ids[3] as string, 1, 3),
                mitBand(ids[4] as string, 7, 7),
                mitBand(ids[5] as string, 2, undefined),
            ],
        };
        const result = transformSources(regionPayload(), areas, labels);
        expect(band(result, ids[0] as string)).toEqual([5, 8]);
        expect(band(result, ids[1] as string)).toEqual([2, 8]);
        expect(band(result, ids[2] as string)).toEqual([0, 6]);
        expect(band(result, ids[3] as string)).toEqual([1, 3]);
        // Die Untergrenze 7 bleibt 7: das Label erscheint weiter erst auf Stufe 7 und steht jetzt bis 8.
        expect(band(result, ids[4] as string)).toEqual([7, 8]);
        expect(band(result, ids[5] as string)).toEqual([2, null]);
        expect(result.labelUpperBandsFromLegacy).toBe(3);
        expect(result.labelBandsAboveLegacyMax).toEqual([]);
    });

    it("🔴 meldet eine Quelle, die je über 7 hinausgeht: dann wäre Legacys 7 nicht mehr terminal (S11, nur Befund)", () => {
        const labels: LegacyMapPayload = { ok: true, revision: 1, features: [mitBand(ids[6] as string, 2, 8)] };
        const result = transformSources(regionPayload(), areas, labels);
        expect(band(result, ids[6] as string)).toEqual([2, 8]);
        expect(result.labelBandsAboveLegacyMax).toEqual([{ publicId: ids[6], name: "Amboss", maxZoom: 8 }]);
    });
});
