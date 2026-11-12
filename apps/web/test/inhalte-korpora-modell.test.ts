import { describe, expect, it } from "vitest";
import type { InhalteKorpusEintrag } from "@avesmaps3d/shared";
import {
    anzeigeformVon,
    bereinigeSchluessel,
    entwurfAlsKoerper,
    formAusWert,
    geaenderteVorgaben,
    kreisDesKorpus,
    lizenzWert,
    schluesselSiehtGutAus,
    schreibtDurch,
    setzeFeld,
    setzeForm,
    setzeLizenz,
    standAusKorpus,
    vorgegebeneFelder,
    zaehleAenderungen,
} from "../src/inhalte/inhalte-korpora-modell.ts";

/**
 * Die Entwurfsrechnung des Reiters „Korpora“ im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 4): was „Speichern“ aus dem Unterschied zwischen dem Stand
 * des Servers und dem Entwurf macht, und die Regel „überall heißt überall“ (Vali): Art, Offiziell, Lizenz und Namensnennung gehen nur bei einer Belegstelle
 * in den Körper. Dass der Server das Durchschreiben rechnet, belegt `apps/server/test/inhalte-korpora.test.ts`; hier steht nur die reine Rechnung.
 */
function korpus(teil: Partial<InhalteKorpusEintrag> = {}): InhalteKorpusEintrag {
    return {
        id: "00000000-0000-4000-8000-00000000c001",
        revision: 1,
        key: "beispiel.de",
        label: "Beispiel-Wiki",
        form: "belegstelle",
        sourceType: null,
        isOfficial: null,
        lizenzAussage: "unrecorded",
        lizenzKey: null,
        attribution: null,
        editorNote: null,
        herkunft: "legacy",
        schreibtDurch: true,
        quellen: [],
        quellenGesamt: 0,
        traegerGesamt: 0,
        abweichendGesamt: 0,
        lizenzen: [{ key: "cc-by-sa-3.0", name: "CC BY-SA 3.0" }],
        ...teil,
    };
}

describe("Körper von „Speichern“", () => {
    it("ohne Änderung gibt es keinen Körper", () => {
        const start = standAusKorpus(korpus());
        expect(entwurfAlsKoerper(start, start)).toBeUndefined();
        expect(zaehleAenderungen(start, start)).toBe(0);
    });

    it("🔴 bei einer Belegstelle geht die Vorgabe (Art, Offiziell, Lizenz, Nennung) in den Körper, und nur was sich ändert", () => {
        const start = standAusKorpus(korpus());
        let jetzt = setzeFeld(start, "sourceType", "briefspiel");
        jetzt = setzeFeld(jetzt, "isOfficial", false);
        jetzt = setzeLizenz(jetzt, "license:cc-by-sa-3.0");
        jetzt = setzeFeld(jetzt, "attribution", "  AlberniaWiki  ");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            fields: {
                sourceType: "briefspiel",
                isOfficial: false,
                lizenzAussage: "license",
                lizenzKey: "cc-by-sa-3.0",
                attribution: "AlberniaWiki",
            },
        });
        // Lizenz und Schlüssel zählen als EINE Änderung.
        expect(zaehleAenderungen(start, jetzt)).toBe(4);
        expect(geaenderteVorgaben(start, jetzt)).toEqual(["sourceType", "isOfficial", "lizenz", "attribution"]);
    });

    it("🔴 bei einem Werk oder unentschiedener Form geht die Vorgabe nie in den Körper: Die Felder sind am Korpus gesperrt", () => {
        for (const form of ["werk", ""] as const) {
            const start = standAusKorpus(korpus({ form, schreibtDurch: false }));
            expect(schreibtDurch(start.felder)).toBe(false);
            const jetzt = setzeFeld(setzeFeld(start, "sourceType", "roman"), "attribution", "X");
            expect(entwurfAlsKoerper(start, jetzt)).toBeUndefined();
        }
    });

    it("🔴 weg von der Belegstelle nimmt der Entwurf die vier Felder auf den gespeicherten Stand zurück; zurück zur Belegstelle bleiben sie, wie sie sind", () => {
        const start = standAusKorpus(korpus({ sourceType: "briefspiel", attribution: "Alt" }));
        let jetzt = setzeFeld(start, "sourceType", "roman");
        jetzt = setzeFeld(jetzt, "attribution", "Neu");
        jetzt = setzeForm(jetzt, "werk", start);
        expect(jetzt.felder.sourceType).toBe("briefspiel");
        expect(jetzt.felder.attribution).toBe("Alt");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({ fields: { form: "werk" } });
        // Zurück zur Belegstelle: nichts ändert sich mehr.
        expect(entwurfAlsKoerper(start, setzeForm(jetzt, "belegstelle", start))).toBeUndefined();
    });

    it("eine Änderung der Form zur Belegstelle trägt die frisch gesetzte Vorgabe mit", () => {
        const start = standAusKorpus(korpus({ form: "werk", schreibtDurch: false }));
        let jetzt = setzeForm(start, "belegstelle", start);
        jetzt = setzeFeld(jetzt, "sourceType", "regionalspielhilfe");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            fields: { form: "belegstelle", sourceType: "regionalspielhilfe" },
        });
    });

    it("Name und Kommentar: getrimmt, leer heißt null (Kommentar) oder leer (Name); der Name darf leer sein", () => {
        const start = standAusKorpus(korpus({ editorNote: "alt" }));
        let jetzt = setzeFeld(start, "label", "  Neu  ");
        jetzt = setzeFeld(jetzt, "editorNote", "   ");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({ fields: { label: "Neu", editorNote: null } });
        expect(entwurfAlsKoerper(start, setzeFeld(start, "label", ""))).toEqual({ fields: { label: "" } });
    });

    it("eine Lizenzaussage ohne „Lizenz“ trägt keinen Schlüssel", () => {
        const start = standAusKorpus(korpus({ lizenzAussage: "license", lizenzKey: "cc-by-sa-3.0" }));
        expect(lizenzWert(start.felder)).toBe("license:cc-by-sa-3.0");
        const frei = setzeLizenz(start, "public_domain");
        expect(frei.felder).toMatchObject({ lizenzAussage: "public_domain", lizenzKey: null });
        expect(entwurfAlsKoerper(start, frei)).toEqual({
            fields: { lizenzAussage: "public_domain", lizenzKey: null },
        });
        expect(setzeLizenz(start, "unbekannt")).toBe(start);
    });
});

describe("Was ein gespeicherter Korpus vorgibt", () => {
    it("nur bei einer Belegstelle und nur, was gesetzt ist; „nicht erfasst“ und eine leere Nennung geben nichts vor", () => {
        expect(vorgegebeneFelder(korpus())).toEqual([]);
        expect(
            vorgegebeneFelder(
                korpus({ sourceType: "briefspiel", isOfficial: false, lizenzAussage: "unfree", attribution: " X " }),
            ),
        ).toEqual(["sourceType", "isOfficial", "lizenz", "attribution"]);
        expect(vorgegebeneFelder(korpus({ attribution: "   " }))).toEqual([]);
        // Ein Werk gibt nie vor, auch wenn Werte stehen.
        expect(vorgegebeneFelder(korpus({ form: "werk", schreibtDurch: false, sourceType: "roman" }))).toEqual([]);
    });
});

describe("Liste und Anlegen", () => {
    it("● aus Legacy, ◐ von der Redaktion; die leere Form heißt unentschieden", () => {
        expect(kreisDesKorpus({ herkunft: "legacy" })).toBe("voll");
        expect(kreisDesKorpus({ herkunft: "editor" })).toBe("halb");
        expect(anzeigeformVon("")).toBe("unentschieden");
        expect(anzeigeformVon("werk")).toBe("werk");
        expect(formAusWert("belegstelle")).toBe("belegstelle");
        expect(formAusWert("blödsinn")).toBe("");
    });

    it("der Schlüssel: klein, ohne Schlusspunkt; sieht wie eine Domain aus oder nicht (die endgültige Prüfung macht der Server)", () => {
        expect(bereinigeSchluessel("  Beispiel.DE. ")).toBe("beispiel.de");
        expect(schluesselSiehtGutAus("beispiel.de")).toBe(true);
        expect(schluesselSiehtGutAus("wiki.punin.de")).toBe(true);
        expect(schluesselSiehtGutAus("beispiel")).toBe(false);
        expect(schluesselSiehtGutAus("www.beispiel.de")).toBe(false);
        expect(schluesselSiehtGutAus("https://beispiel.de")).toBe(false);
        expect(schluesselSiehtGutAus("beispiel.de/pfad")).toBe(false);
        expect(schluesselSiehtGutAus("")).toBe(false);
    });
});
