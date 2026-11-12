import { describe, expect, it } from "vitest";
import type { InhalteTraegerQuelle, InhalteTraegerQuellen } from "@avesmaps3d/shared";
import {
    aktiveZahl,
    baueAenderung,
    baueBody,
    feldGeaendert,
    fehlerAus,
    leseGrund,
    notizAnzeige,
    quelleAlsKlapp,
    vorherAus,
    type ZeilenKontext,
} from "../src/fenster/traeger-quellen-modell.ts";

/**
 * Die Quellen eines Kartenobjekts in den Editoren (WI-0254 §12), ohne Vue: aus der Antwort des Servers die Zeilen der Klappbox und aus EINER Handlung die eine Änderung für den Schreibweg
 * (sofort speichern, `vorher` = zuletzt gelesener Stand).
 *
 * Problemfälle: ein Kreis, der beim Tippen springt oder einen gelösten Eintrag als aktiv malt; eine Notiz mit Vorlage, die beim bloßen Verlassen des Felds durch ihren Klartext überschrieben wird;
 * `vorher` ohne Kürzen oder mit dem Stand der Oberfläche statt dem gelesenen; „Wiki-Wert“ an einer Quelle, die das Wiki nicht zitiert; ein Konflikt, der als gewöhnlicher Fehler endet.
 */

const quelle = (nr: number, teil: Partial<InhalteTraegerQuelle> = {}): InhalteTraegerQuelle => ({
    sourceId: `00000000-0000-4000-8000-00000000060${String(nr)}`,
    title: `Quelle ${String(nr)}`,
    sourceType: "regionalspielhilfe",
    offiziell: true,
    url: null,
    referenceKind: "ausfuehrlich",
    pages: "130",
    note: "Beschreibt den Hof.",
    state: "active",
    updatedAt: "2026-10-28T10:00:00.000Z",
    wiki: { art: "ausfuehrlich", seiten: "130", notiz: "Beschreibt den Hof." },
    ...teil,
});

const kontext = (teil: Partial<ZeilenKontext> = {}): ZeilenKontext => ({
    lauf: true,
    eingabe: undefined,
    schreibt: false,
    fehler: undefined,
    ...teil,
});

describe("Eine Quelle des Objekts in der Form der Klappbox", () => {
    it("übernimmt Titel, Typ, Adresse, Art, Seiten und Zustand; die Zeile ist nie ‚neu‘, denn alles ist gespeichert", () => {
        const q = quelle(1, { url: "https://shop.example/x" });
        expect(quelleAlsKlapp(q, kontext())).toEqual({
            id: q.sourceId,
            titel: "Quelle 1",
            art: "ausfuehrlich",
            seiten: "130",
            notiz: "Beschreibt den Hof.",
            typ: "regionalspielhilfe",
            offiziell: true,
            url: "https://shop.example/x",
            kreis: "voll",
            state: "active",
            neu: false,
            wiki: { art: "ausfuehrlich", seiten: "130", notiz: "Beschreibt den Hof." },
            schreibt: false,
            fehler: undefined,
            korpus: null,
        });
    });

    it("trägt den Namen des Korpus, wo die Quelle einen hat (statt „Im Shop“ am Link)", () => {
        expect(quelleAlsKlapp(quelle(1, { korpus: { label: "LieblichesFeld-Wiki" } }), kontext()).korpus).toBe(
            "LieblichesFeld-Wiki",
        );
        expect(quelleAlsKlapp(quelle(1, { korpus: null }), kontext()).korpus).toBeNull();
        expect(quelleAlsKlapp(quelle(1), kontext()).korpus).toBeNull();
    });

    it("🔴 der Kreis folgt dem GESPEICHERTEN Stand, nicht dem Feld: Tippen lässt ihn nicht springen", () => {
        const q = quelle(1);
        const getippt = quelleAlsKlapp(q, kontext({ eingabe: { seiten: "999", notiz: "etwas anderes" } }));
        expect(getippt.seiten).toBe("999");
        expect(getippt.notiz).toBe("etwas anderes");
        expect(getippt.kreis).toBe("voll");
    });

    it("🔴 ○ gelöst und unterdrückt, ◐ wo das Wiki abweicht oder schweigt, ● wo es gleicht, kein Kreis ohne Lauf", () => {
        const kreise = [
            quelle(1),
            quelle(2, { pages: "131" }),
            quelle(3, { wiki: null }),
            quelle(4, { state: "retired" }),
            quelle(5, { state: "suppressed" }),
        ].map((q) => quelleAlsKlapp(q, kontext()).kreis);
        expect(kreise).toEqual(["voll", "halb", "halb", "leer", "leer"]);
        expect(quelleAlsKlapp(quelle(1), kontext({ lauf: false })).kreis).toBeNull();
    });

    it("🔴 die Notiz steht als Text statt der Vorlagen des Wikis, der Rohwert bleibt in der Antwort", () => {
        const q = quelle(1, { note: "{{R5}} Seite 12" });
        expect(notizAnzeige(q)).toBe("DSA5-Regeln Seite 12");
        expect(quelleAlsKlapp(q, kontext()).notiz).toBe("DSA5-Regeln Seite 12");
    });

    it("das Zitat des Wikis kommt roh mit (die Box zeigt es als Text); fehlende Teile sind leer", () => {
        const q = quelle(1, { wiki: { art: null, seiten: null, notiz: "{{R5}}" } });
        expect(quelleAlsKlapp(q, kontext()).wiki).toEqual({ art: null, seiten: "", notiz: "{{R5}}" });
        expect(quelleAlsKlapp(quelle(1, { wiki: null }), kontext()).wiki).toBeNull();
    });

    it("trägt die Sperre der Zeile und den Satz der letzten Abweisung", () => {
        const z = quelleAlsKlapp(quelle(1), kontext({ schreibt: true, fehler: "Gesperrt." }));
        expect(z.schreibt).toBe(true);
        expect(z.fehler).toBe("Gesperrt.");
    });

    it("🔴 Abschnitte sind ein technisches Detail: die Zeile eines Wegs trägt weder ihre Zahl noch ein Wort über uneinheitliche Abschnitte", () => {
        const abschnitte = { mit: 2, von: 3, einheitlich: false, gleichDemWiki: false };
        const zeile = quelleAlsKlapp(quelle(1, { abschnitte }), kontext());
        expect("abschnitte" in zeile).toBe(false);
    });

    it("beim Weg zählt für den Kreis die Auskunft des Servers über die Straße (voll nur, wenn jeder Abschnitt dem Zitat gleicht)", () => {
        const einheitlich = { mit: 3, von: 3, einheitlich: true, gleichDemWiki: false };
        expect(quelleAlsKlapp(quelle(1, { abschnitte: einheitlich }), kontext()).kreis).toBe("halb");
        expect(
            quelleAlsKlapp(quelle(1, { abschnitte: { ...einheitlich, gleichDemWiki: true } }), kontext()).kreis,
        ).toBe("voll");
    });
});

describe("Die Zahl der Quellen", () => {
    it("zählt nur die aktiven", () => {
        const daten: Pick<InhalteTraegerQuellen, "quellen"> = {
            quellen: [quelle(1), quelle(2, { state: "retired" }), quelle(3), quelle(4, { state: "suppressed" })],
        };
        expect(aktiveZahl(daten)).toBe(2);
        expect(aktiveZahl({ quellen: [] })).toBe(0);
    });
});

describe("Was die Oberfläche von der Verknüpfung sah (vorher)", () => {
    it("🔴 Seiten und Notiz ohne Leerraum an den Rändern, leer ist null; eine unbekannte Verknüpfung ist null", () => {
        expect(vorherAus(quelle(1, { pages: "  130 ", note: "  " }))).toEqual({
            state: "active",
            referenceKind: "ausfuehrlich",
            pages: "130",
            note: null,
        });
        expect(vorherAus(quelle(1, { referenceKind: null, pages: null, note: null, state: "retired" }))).toEqual({
            state: "retired",
            referenceKind: null,
            pages: null,
            note: null,
        });
        expect(vorherAus(undefined)).toBeNull();
    });
});

describe("Aus einer Handlung die eine Änderung", () => {
    const q = quelle(1);
    const id = q.sourceId;
    const vorher = { state: "active", referenceKind: "ausfuehrlich", pages: "130", note: "Beschreibt den Hof." };

    it("Anhängen: add, gegen den Stand, den die Oberfläche kennt (null bei einer neuen, der gelöste bei einer zurückgeholten)", () => {
        expect(baueAenderung(id, { art: "anhaengen" }, undefined)).toEqual({ op: "add", sourceId: id, vorher: null });
        const gelost = quelle(1, { state: "retired" });
        expect(baueAenderung(id, { art: "anhaengen" }, gelost)).toEqual({
            op: "add",
            sourceId: id,
            vorher: { ...vorher, state: "retired" },
        });
    });

    it("Lösen und Holen: remove und restore mit vorher", () => {
        expect(baueAenderung(id, { art: "loesen" }, q)).toEqual({ op: "remove", sourceId: id, vorher });
        expect(baueAenderung(id, { art: "holen" }, q)).toEqual({ op: "restore", sourceId: id, vorher });
    });

    it("🔴 die Art speichert für sich: update mit nur referenceKind (null leert), Seiten und Notiz bleiben", () => {
        expect(baueAenderung(id, { art: "art", referenceKind: "ergaenzend" }, q)).toEqual({
            op: "update",
            sourceId: id,
            vorher,
            referenceKind: "ergaenzend",
        });
        const ohne = baueAenderung(id, { art: "art", referenceKind: null }, q);
        expect(ohne).toEqual({ op: "update", sourceId: id, vorher, referenceKind: null });
        expect(ohne).not.toHaveProperty("pages");
        expect(ohne).not.toHaveProperty("note");
    });

    it("🔴 Fundstelle und Notiz: update mit nur diesem Feld, gekürzt; leer leert (null)", () => {
        expect(baueAenderung(id, { art: "seiten", wert: "  12 f. " }, q)).toEqual({
            op: "update",
            sourceId: id,
            vorher,
            pages: "12 f.",
        });
        expect(baueAenderung(id, { art: "seiten", wert: "   " }, q)).toEqual({
            op: "update",
            sourceId: id,
            vorher,
            pages: null,
        });
        expect(baueAenderung(id, { art: "notiz", wert: "Neu." }, q)).toEqual({
            op: "update",
            sourceId: id,
            vorher,
            note: "Neu.",
        });
    });

    it("🔴 „Wiki-Wert“: update mit Art, Seiten und Notiz des Zitats; ohne Zitat gibt es nichts zu schreiben", () => {
        const abweichend = quelle(1, {
            referenceKind: "erwaehnung",
            pages: "9",
            note: null,
            wiki: { art: "ausfuehrlich", seiten: "130", notiz: "{{R5}} Hof" },
        });
        expect(baueAenderung(id, { art: "wikiWert" }, abweichend)).toEqual({
            op: "update",
            sourceId: id,
            vorher: { state: "active", referenceKind: "erwaehnung", pages: "9", note: null },
            referenceKind: "ausfuehrlich",
            pages: "130",
            note: "{{R5}} Hof",
        });
        expect(baueAenderung(id, { art: "wikiWert" }, quelle(1, { wiki: null }))).toBeUndefined();
        expect(baueAenderung(id, { art: "wikiWert" }, undefined)).toBeUndefined();
    });

    it("eine Änderung an einer Quelle, die die Oberfläche nicht kennt, gibt es nicht (nur Anhängen)", () => {
        for (const handlung of [
            { art: "loesen" },
            { art: "holen" },
            { art: "art", referenceKind: null },
            { art: "seiten", wert: "1" },
            { art: "notiz", wert: "x" },
        ] as const) {
            expect(baueAenderung(id, handlung, undefined)).toBeUndefined();
        }
    });

    it("der Körper trägt die Kennung der Operation und genau EINE Änderung", () => {
        const aenderung = baueAenderung(id, { art: "loesen" }, q);
        expect(aenderung).toBeDefined();
        expect(baueBody("op-1", aenderung!)).toEqual({ operationId: "op-1", aenderungen: [aenderung] });
    });
});

describe("Hat sich das Feld geändert?", () => {
    it("🔴 die Fundstelle vergleicht nach dem Kürzen: Leerzeichen ändern nichts, ein anderer Wert schon", () => {
        const q = quelle(1);
        expect(feldGeaendert(q, "seiten", " 130 ")).toBe(false);
        expect(feldGeaendert(q, "seiten", "131")).toBe(true);
        expect(feldGeaendert(q, "seiten", "")).toBe(true);
        expect(feldGeaendert(quelle(1, { pages: null }), "seiten", "  ")).toBe(false);
    });

    it("💣 die Notiz vergleicht gegen den Text, den das Feld zeigte: wer die Vorlage nur anschaut, überschreibt sie nie mit ihrem Klartext", () => {
        const q = quelle(1, { note: "{{R5}} Seite 12" });
        expect(feldGeaendert(q, "notiz", "DSA5-Regeln Seite 12")).toBe(false);
        expect(feldGeaendert(q, "notiz", "DSA5-Regeln Seite 13")).toBe(true);
        expect(feldGeaendert(q, "notiz", "")).toBe(true);
    });
});

describe("Fehler des Schreibwegs", () => {
    it("🔴 409 edit_conflict ist ein Konflikt mit wer und wann, soweit der Server es weiß", () => {
        const mit = fehlerAus(409, {
            code: "edit_conflict",
            message: "Jemand hat das gerade geändert.",
            details: { changedBy: { displayName: "Hesindiane" }, changedAt: "2026-10-28T10:00:00.000Z" },
        });
        expect(mit).toEqual({ art: "konflikt", wer: "Hesindiane", wann: "2026-10-28T10:00:00.000Z" });
        const ohne = fehlerAus(409, { code: "edit_conflict", message: "Jemand hat das gerade geändert." });
        expect(ohne).toEqual({ art: "konflikt", wer: undefined, wann: undefined });
    });

    it("alles andere (403, 423, 503, 400, kein Netz) trägt den Satz des Servers", () => {
        for (const [status, code] of [
            [403, "forbidden"],
            [423, "map_editing_off"],
            [503, "map_import_running"],
            [400, "validation_failed"],
            [0, "network_error"],
        ] as const) {
            expect(fehlerAus(status, { code, message: `Satz ${code}` })).toEqual({ art: "satz", satz: `Satz ${code}` });
        }
        // Ein 409 mit anderem Code ist kein Konflikt dieser Art.
        expect(fehlerAus(409, { code: "duplicate", message: "Gibt es schon." })).toEqual({
            art: "satz",
            satz: "Gibt es schon.",
        });
    });
});

describe("Darf man schreiben?", () => {
    const daten = { aenderbar: true } as const;

    it("🔴 nur mit dem Recht, dem Schreibrecht des Editors UND wenn der Server das Objekt änderbar nennt", () => {
        expect(leseGrund(true, true, daten)).toBeUndefined();
        expect(leseGrund(false, true, daten)).toBe("recht");
        expect(leseGrund(true, false, daten)).toBe("bearbeiten");
        expect(leseGrund(true, true, { aenderbar: false, grund: "still" })).toBe("still");
        // Ohne Grund in der Antwort gilt das stille Objekt.
        expect(leseGrund(true, true, { aenderbar: false })).toBe("still");
    });

    it("🔴 ein Weg ist änderbar wie jedes Objekt (kein Grund `weg` mehr); das fehlende Recht geht dem stillen Objekt vor", () => {
        // Eine Straße auf der Karte: dieselbe Antwort wie bei einem Ort.
        expect(leseGrund(true, true, { aenderbar: true })).toBeUndefined();
        expect(leseGrund(false, true, { aenderbar: false, grund: "still" })).toBe("recht");
    });

    it("solange nichts gelesen ist, gibt es keinen Grund der Antwort", () => {
        expect(leseGrund(true, true, undefined)).toBeUndefined();
        expect(leseGrund(false, true, undefined)).toBe("recht");
    });
});
