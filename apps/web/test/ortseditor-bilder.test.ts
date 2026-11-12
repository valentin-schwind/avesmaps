import { describe, expect, it } from "vitest";
import type { MediaSlotAsset, MediaSubjectSlots } from "@avesmaps3d/shared";
import { bildName, freigabe, herkunft, ohneWappen } from "../src/medien/medien-platz-text";

/**
 * Der Reiter „Bilder“ (WI-0128 E19; WI-0126 §11j; Gesamtmockup Version 7). Problemfälle: Legacy kennt den Hochlader fast nie (dann
 * „unbekannt“, nie leer); ein Bild mit offener Rechteprüfung heißt „wartet auf Rechteprüfung“, ein anders gesperrtes nicht; ◀ am ersten
 * und ▶ am letzten Bild senden nichts.
 */
function bild(ueber: Partial<MediaSlotAsset> = {}): MediaSlotAsset {
    return {
        id: "e19e19e1-0000-4000-8000-000000000001",
        revision: 2,
        title: "Wappen Gratenfels",
        technicalState: "ok",
        clearance: "cleared",
        preview: null,
        uploadedBy: { id: "e19e19e1-0000-4000-8000-0000000000aa", displayName: "Rondrikan" },
        uploadedAt: "2026-08-21T10:00:00.000Z",
        publication: { public: true, reason: "automatic" },
        ...ueber,
    };
}

describe("Bilder: Herkunft und Freigabe", () => {
    it("hochgeladen von Person und Tag; was Legacy nicht kennt, heißt „unbekannt“", () => {
        expect(herkunft(bild())).toBe("hochgeladen von Rondrikan · 21.08.2026");
        expect(herkunft(bild({ uploadedBy: null, uploadedAt: null }))).toBe(
            "hochgeladen von unbekannt · Datum unbekannt",
        );
    });

    it("🔴 öffentlich entscheidet die Medienverwaltung: offene Rechte warten, ein anderer Grund ist „nicht öffentlich“", () => {
        expect(freigabe(bild())).toMatchObject({ ton: "neutral", text: "öffentlich" });
        expect(freigabe(bild({ publication: { public: false, reason: "clearance_pending" } }))).toMatchObject({
            ton: "warnung",
            text: "wartet auf Rechteprüfung",
        });
        expect(freigabe(bild({ publication: { public: false, reason: "technical_state_not_ok" } }))).toMatchObject({
            text: "nicht öffentlich",
            grund: "Nur Editoren sehen es: technischer Befund.",
        });
    });

    it("ein Bild ohne Titel bekommt einen Namen; ein Platz ohne Wappen sagt, ob bewusst", () => {
        expect(bildName(bild({ title: "  " }))).toBe("Bild ohne Namen");
        const platz = (state: MediaSubjectSlots["coat"]["state"]) =>
            ({ coat: { state, origin: null, revision: null, asset: null } }) as MediaSubjectSlots;
        expect(ohneWappen(platz("none"))).toBe("bewusst ohne Wappen");
        expect(ohneWappen(platz("undecided"))).toBe("kein Wappen gebunden");
    });
});
