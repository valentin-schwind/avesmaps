import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { composeView } from "@avesmaps3d/shared";
import { stapelUmschalten } from "../src/landschaftseditor/landschaften-liste.ts";
import { UNTERGRUND_VORGABE, untergrund, untergrundWert } from "../src/landschaftseditor/untergrund.ts";
import { beobachteUntergrund, untergrundImStil } from "../src/landschaftseditor/untergrund-karte.ts";
import { untergrundDeckkraft } from "../src/map/place-layers.ts";
import { HEIGHT_TINT_LAYER_ID } from "../src/map/topography-layers.ts";

/**
 * Der Regler „Untergrund“ und ☰ in der Leiste der Liste (WI-0178 T47; Betreiber 2026-10-18: „Untergrund-Regler in der Ebenenleiste: mit
 * dem symbol und regler -> schön, das machen“ und „auf jeden fall in der landschaftsliste platzieren“).
 */
describe("Untergrund (T47)", () => {
    it("🔴 Besucher sehen in der Derographie nie einen Untergrund; Editoren mit dem Wert, bei 0 % ist er weg", () => {
        expect(composeView("landscapes", "vegetation")).toMatchObject({ basemap: false });
        expect(composeView("landscapes", "vegetation").basemapOpacity).toBeUndefined();
        expect(composeView("landscapes", "vegetation", undefined, 50)).toMatchObject({
            basemap: true,
            basemapOpacity: 0.5,
        });
        expect(composeView("landscapes", "alle", undefined, 0)).toMatchObject({ basemap: false });
        // Die anderen Ansichten bleiben, wie sie sind: der Untergrund ganz da, der Regler wirkt dort nicht.
        expect(composeView("standard", "alle", undefined, 30)).toMatchObject({ basemap: true });
        expect(composeView("standard", "alle", undefined, 30).basemapOpacity).toBeUndefined();
        expect(composeView("political", "alle", undefined, 30).basemapOpacity).toBeUndefined();
    });

    it("im Stil nur für Editoren am Rechner, wo der Regler steht", () => {
        untergrund.value = 35;
        expect(untergrundImStil(true, false)).toBe(35);
        expect(untergrundImStil(true, true)).toBeUndefined();
        expect(untergrundImStil(false, false)).toBeUndefined();
    });

    it("🪤 leerer oder unlesbarer Speicher ist die Vorgabe 50 %, nicht 0 (Legacy #L351-354); Schritt 5, 0 bis 100", () => {
        expect(UNTERGRUND_VORGABE).toBe(50);
        expect(untergrundWert(undefined)).toBe(50);
        expect(untergrundWert(null)).toBe(50);
        expect(untergrundWert("")).toBe(50);
        expect(untergrundWert("abc")).toBe(50);
        expect(untergrundWert("0")).toBe(0);
        expect(untergrundWert("37")).toBe(35);
        expect(untergrundWert(38)).toBe(40);
        expect(untergrundWert(140)).toBe(100);
        expect(untergrundWert(-5)).toBe(0);
    });

    it("beim Ziehen nur die Deckkraft; kommt er dazu oder geht er (0 %), baut der Stil neu; außerhalb der Derographie nichts", async () => {
        const ansicht = ref("landscapes");
        const ebene = { da: true, stufen: false };
        const karte = {
            getLayer: vi.fn((id: string) => ((id === HEIGHT_TINT_LAYER_ID ? ebene.stufen : ebene.da) ? {} : undefined)),
            setPaintProperty: vi.fn(),
        };
        const neuBauen = vi.fn();
        untergrund.value = 50;
        beobachteUntergrund(
            () => karte,
            () => ansicht.value,
            neuBauen,
        );
        const warte = () => new Promise((fertig) => setTimeout(fertig, 0));
        untergrund.value = 60;
        await warte();
        expect(karte.setPaintProperty).toHaveBeenLastCalledWith("basemap", "raster-opacity", 0.6);
        expect(neuBauen).not.toHaveBeenCalled();
        // 🔴 Über den Höhenstufen dieselbe Mischung wie beim Bau des Stils (Fund 2026-11-10), nicht der rohe Wert.
        ebene.stufen = true;
        untergrund.value = 75;
        await warte();
        expect(karte.setPaintProperty).toHaveBeenLastCalledWith(
            "basemap",
            "raster-opacity",
            untergrundDeckkraft(0.75, true),
        );
        ebene.stufen = false;
        untergrund.value = 0;
        await warte();
        expect(neuBauen).toHaveBeenCalledTimes(1);
        ebene.da = false;
        untergrund.value = 20;
        await warte();
        expect(neuBauen).toHaveBeenCalledTimes(2);
        ansicht.value = "standard";
        untergrund.value = 25;
        await warte();
        expect(neuBauen).toHaveBeenCalledTimes(2);
        expect(karte.setPaintProperty).toHaveBeenCalledTimes(2);
    });
});

describe("☰ „Reihenfolge und Sperren“ in Ebenenleiste und Liste (T47)", () => {
    it("stellt die Liste nach Reihenfolge; ein zweiter Druck bei offenem Fenster nimmt es zurück, bei geschlossenem öffnet er", () => {
        const einstellung = { sortierung: ref("name") };
        expect(stapelUmschalten(einstellung, true)).toBe(true);
        expect(einstellung.sortierung.value).toBe("reihenfolge");
        expect(stapelUmschalten(einstellung, true)).toBe(false);
        expect(einstellung.sortierung.value).toBe("name");
        einstellung.sortierung.value = "reihenfolge";
        expect(stapelUmschalten(einstellung, false)).toBe(true);
        expect(einstellung.sortierung.value).toBe("reihenfolge");
    });
});
