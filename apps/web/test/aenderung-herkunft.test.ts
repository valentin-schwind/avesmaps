import { describe, expect, it } from "vitest";
import type { MapHistoryEntry } from "@avesmaps3d/shared";
import { HERKUNFT_RECHT, herkunftVon, oeffneHerkunft } from "../src/aenderungen/aenderung-herkunft";
import { redaktion } from "../src/community/redaktion";
import { t } from "../src/i18n/i18n";

/**
 * Die Herkunft einer Operation aus einem Community-Vorgang in „Änderungen“ (WI-0265 B6g1): die Zeile „aus COM-000123“ und ob sie ein Link ist. Ohne Bauteil und ohne Browser; die Bauteile
 * selbst (Detail und Zeile der Liste) lesen nur dieses Modell.
 */

const mit = (communityVorgang?: string): Pick<MapHistoryEntry, "communityVorgang"> =>
    communityVorgang === undefined ? {} : { communityVorgang };

describe("Herkunft aus einem Community-Vorgang (WI-0265 B6g1)", () => {
    it("🔴 ohne Vorgang gibt es keine Zeile", () => {
        expect(herkunftVon(mit(), [HERKUNFT_RECHT])).toBeUndefined();
        expect(herkunftVon(mit(""), [HERKUNFT_RECHT])).toBeUndefined();
    });

    it("🔴 mit dem Recht moderate_submissions ist die Zeile ein Link mit Hinweis", () => {
        const herkunft = herkunftVon(mit("COM-000123"), ["use_editor_menu", "moderate_submissions"]);
        expect(herkunft).toEqual({
            nummer: "COM-000123",
            text: t("aenderungen.herkunft", { nummer: "COM-000123" }),
            link: true,
            titel: t("aenderungen.herkunft.oeffnen", { nummer: "COM-000123" }),
        });
        expect(herkunft?.text).toContain("COM-000123");
    });

    it("🔴 ohne das Recht bleibt die Zeile Text, ohne Hinweis auf einen Weg, den es nicht gibt", () => {
        const herkunft = herkunftVon(mit("COM-000123"), [
            "use_editor_menu",
            "edit_map_objects",
            "edit_territories",
            "edit_landscapes",
        ]);
        expect(herkunft?.link).toBe(false);
        expect(herkunft?.titel).toBeUndefined();
        expect(herkunft?.text).toContain("COM-000123");
        expect(herkunftVon(mit("COM-000123"), [])?.link).toBe(false);
    });

    it("🔴 ist die Seite nicht mit einer Redaktion verbunden, bleibt es auch mit Recht Text", () => {
        const herkunft = herkunftVon(mit("COM-000123"), [HERKUNFT_RECHT], false);
        expect(herkunft?.link).toBe(false);
        expect(herkunft?.titel).toBeUndefined();
    });

    it("🔴 der Klick öffnet den Vorgang mit seiner COM-Nummer und meldet, ob die Redaktion ihn nahm", () => {
        const gerufen: string[] = [];
        expect(
            oeffneHerkunft("COM-000123", (nummer) => {
                gerufen.push(nummer);
                return true;
            }),
        ).toBe(true);
        expect(oeffneHerkunft("COM-000124", () => false)).toBe(false);
        expect(gerufen).toEqual(["COM-000123"]);
    });

    it("ohne verbundene Seite öffnet die echte Steuerung nichts und meldet das (false)", () => {
        expect(redaktion.verbunden.value).toBe(false);
        expect(oeffneHerkunft("COM-000123")).toBe(false);
    });
});
