import { describe, expect, it } from "vitest";
import { KARTE_VORSCHAU_SPERREN } from "@avesmaps3d/shared";
import {
    andererName,
    bildFreigabeSatz,
    bildZustandSatz,
    erzeugenSatz,
    umSprung,
    vorschauSperrSatz,
} from "../src/medien/medien-karte-vorschau-modell";

describe("„Vorschau erzeugen“: Sperrgrund und Satz (WI-0287 Punkt 5, Entwurf Fassung 5)", () => {
    it("🔴 gesperrt nur mit Grund, in den Worten des Entwurfs; offene Prüfung ist kein Grund", () => {
        expect(KARTE_VORSCHAU_SPERREN).toEqual(["suspended", "rights_unknown", "file_missing"]);
        expect(vorschauSperrSatz("suspended")).toBe("Gesperrt, solange die Karte offline ist.");
        expect(vorschauSperrSatz("rights_unknown")).toBe("Gesperrt, bis die Rechtsgrundlage der Karte feststeht.");
        expect(vorschauSperrSatz("file_missing")).toBe("Gesperrt: Die Datei der Karte fehlt.");
        expect(vorschauSperrSatz(null)).toBeUndefined();
        expect(vorschauSperrSatz(undefined), "ein älterer Server liefert keine Sperre: nicht gesperrt").toBeUndefined();
    });

    it("der Satz unter dem Knopf: ohne Sperre woraus die Vorschau entsteht, mit Sperre ihr Grund", () => {
        expect(erzeugenSatz(null)).toBe("Entsteht aus der Karte. Rechte, Nennung und Notaus folgen der Karte.");
        expect(erzeugenSatz("rights_unknown")).toBe("Gesperrt, bis die Rechtsgrundlage der Karte feststeht.");
    });

    it("Stufe 2: trägt die erste Version eine Bezeichnung, nennt der Satz sie (Entwurf `erzeugenSatz`); die Sperre geht vor", () => {
        expect(erzeugenSatz(null, "Spielerversion")).toBe(
            "Entsteht aus der Version „Spielerversion“. Rechte, Nennung und Notaus folgen der Karte.",
        );
        expect(erzeugenSatz(null, "  ")).toBe("Entsteht aus der Karte. Rechte, Nennung und Notaus folgen der Karte.");
        expect(erzeugenSatz(null, null)).toBe("Entsteht aus der Karte. Rechte, Nennung und Notaus folgen der Karte.");
        expect(erzeugenSatz("suspended", "Spielerversion")).toBe("Gesperrt, solange die Karte offline ist.");
    });

    it("der Satz der Freigabe einer Version: Zustand vor stillgelegtem Eintrag vor der Entscheidung", () => {
        const offen = { public: true, reason: "rule" } as const;
        const zurueck = { public: false, reason: "retired" } as const;
        expect(bildFreigabeSatz({ technicalState: "pending", publication: offen }, true)).toBe(
            "Wird gerechnet. Das Bild erscheint von selbst.",
        );
        expect(bildFreigabeSatz({ technicalState: "ok", publication: zurueck }, false)).toBe(
            "Nicht öffentlich: der Eintrag ist stillgelegt.",
        );
        expect(bildFreigabeSatz({ technicalState: "ok", publication: offen }, true)).toMatch(/^Öffentlich: /u);
    });

    it("am Bild: erst „wird gerechnet“, dann der Notaus der Karte, sonst nichts (dann zählt die Freigabe)", () => {
        expect(bildZustandSatz({ technicalState: "pending" })).toBe("Wird gerechnet. Das Bild erscheint von selbst.");
        expect(
            bildZustandSatz({ technicalState: "ok", erzeugtAus: { assetId: "k", title: "Karte", offline: true } }),
        ).toBe("Offline: der Notaus der Karte gilt auch hier.");
        expect(
            bildZustandSatz({ technicalState: "ok", erzeugtAus: { assetId: "k", title: "Karte", offline: false } }),
        ).toBeUndefined();
        expect(bildZustandSatz({})).toBeUndefined();
    });

    it("der Konflikt schlägt denselben Namen mit (2) vor; ein Sprung steht mitten im Satz", () => {
        expect(andererName("Vorschau von „Re'Cha“")).toBe("Vorschau von „Re'Cha“ (2)");
        expect(umSprung("medien.karten.vorschau.erzeugtAus", "karte")).toEqual({
            davor: "Erzeugt aus ",
            danach: ". Rechte und Notaus folgen der Karte.",
        });
        expect(umSprung("medien.karten.vorschau.verwendung", "titel")).toEqual({ davor: "Vorschau: ", danach: "" });
    });
});
