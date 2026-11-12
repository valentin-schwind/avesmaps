import { describe, expect, it } from "vitest";
import {
    EDITORPANEL,
    ausTiefemLink,
    capabilitiesFor,
    kinder,
    wiederherstellen,
    type KartenvorschlagListe,
    type KartenvorschlagZeile,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import type { VorschlagsFrage } from "../src/community/kartenvorschlaege-api";
import {
    KARTEN_KATEGORIE,
    alsMeldung,
    istKarte,
    kartenHinweise,
    kartenRechts,
    kartenTitel,
    kartenUnterzeile,
    kartenZahl,
    ladeKartenTeil,
    wartendeZahl,
    zahlAmSegment,
    type MeldungenEintrag,
} from "../src/community/meldungen-karten";
import { filtere, legendeZahlen, sortiere, trefferZahl } from "../src/community/meldungen-modell";

/**
 * Kartenvorschläge in der Liste der Meldungen (WI-0305, Vali 2026-11-10: „Als Eintrag der Meldungen“): Die Zeile eines Vorschlags greift in Trichter, Sortierung und Legende wie ein Vorgang, die Liste holt
 * die richtigen Segmente, die Zahlen zählen beide Quellen, und der alte Unterreiter führt auf die Meldungen.
 */

const vorschlag = (ueberschreibe: Partial<KartenvorschlagZeile> = {}): KartenvorschlagZeile => ({
    id: "44444444-4444-4444-8444-444444444444",
    nummer: "K-1042",
    zustand: "pending",
    weg: "datei",
    titel: "Stadtplan von Gareth",
    link: null,
    dateiTyp: "image/jpeg",
    ort: { id: "55555555-5555-4555-8555-555555555555", name: "Gareth" },
    eingegangenAm: "2026-11-09T10:00:00.000Z",
    technik: "ok",
    ...ueberschreibe,
});

const vorgang = (ueberschreibe: Partial<VorgangZeile> = {}): VorgangZeile => ({
    nummer: "COM-000123",
    art: "meldung",
    kategorie: "lage",
    zustand: "neu",
    ergebnis: null,
    prioritaet: "normal",
    eingang: "website",
    bezugName: "Wehrheim",
    bezugArt: "objekt",
    zustaendig: null,
    ohneQuelle: false,
    moeglicheDublette: null,
    eingegangenAt: "2026-11-08T10:00:00.000Z",
    aktivAt: "2026-11-08T10:00:00.000Z",
    revision: 1,
    ...ueberschreibe,
});

const ZAEHLER: KartenvorschlagListe["zaehler"] = {
    incoming: 1,
    technical_failed: 2,
    pending: 3,
    approved: 4,
    rejected: 5,
    withdrawn: 6,
};

const liste = (eintraege: KartenvorschlagZeile[], weitere = false): KartenvorschlagListe => ({
    eintraege,
    zaehler: ZAEHLER,
    weitere,
    naechste: weitere ? 100 : null,
});

describe("ein Kartenvorschlag als Zeile der Meldungen", () => {
    it("offen ist er neu, entschieden abgeschlossen; niemand zuständig, normal, Kategorie Karte", () => {
        for (const zustand of ["pending", "incoming", "technical_failed"] as const) {
            expect(alsMeldung(vorschlag({ zustand })).zustand, zustand).toBe("neu");
        }
        for (const zustand of ["approved", "rejected", "withdrawn"] as const) {
            expect(alsMeldung(vorschlag({ zustand })).zustand, zustand).toBe("abgeschlossen");
        }
        const eintrag = alsMeldung(vorschlag());
        expect(eintrag).toMatchObject({
            nummer: "K-1042",
            zustaendig: null,
            prioritaet: "normal",
            kategorie: KARTEN_KATEGORIE,
            eingegangenAt: "2026-11-09T10:00:00.000Z",
        });
        expect(istKarte(eintrag)).toBe(true);
        expect(istKarte(vorgang())).toBe(false);
    });

    it("Titel, Unterzeile, Hinweis und rechts der Text in den Worten der Meldungen", () => {
        const jetzt = new Date("2026-11-10T10:00:00.000Z");
        expect(kartenTitel(alsMeldung(vorschlag()))).toBe("Karte: Stadtplan von Gareth");
        expect(kartenUnterzeile(alsMeldung(vorschlag()))).toBe("K-1042 · Gareth");
        expect(kartenUnterzeile(alsMeldung(vorschlag({ ort: null })))).toBe("K-1042 · ohne Ort");
        expect(kartenHinweise(alsMeldung(vorschlag()))).toEqual([]);
        expect(kartenHinweise(alsMeldung(vorschlag({ zustand: "incoming", technik: null })))).toHaveLength(1);
        // Entschiedenes trägt keinen Hinweis (wie ein abgeschlossener Vorgang), rechts steht die Entscheidung statt der Zeit.
        expect(kartenHinweise(alsMeldung(vorschlag({ zustand: "withdrawn" })))).toEqual([]);
        expect(kartenRechts(alsMeldung(vorschlag({ zustand: "approved" })), jetzt)).toBe("angenommen");
        expect(kartenRechts(alsMeldung(vorschlag({ zustand: "rejected" })), jetzt)).toBe("abgelehnt");
        expect(kartenRechts(alsMeldung(vorschlag()), jetzt)).not.toBe("wartet");
    });

    it("🔴 Trichter, Sortierung und Legende nehmen Vorgänge und Vorschläge zusammen", () => {
        const alle: MeldungenEintrag[] = [
            vorgang(),
            vorgang({ nummer: "COM-000124", kategorie: "name", zustaendig: { id: "x", name: "Vali" } }),
            alsMeldung(vorschlag()),
            alsMeldung(
                vorschlag({ id: "66666666-6666-4666-8666-666666666666", nummer: "K-1043", zustand: "approved" }),
            ),
        ];
        const karten = filtere(alle, { kategorie: [KARTEN_KATEGORIE] }, undefined);
        expect(karten.map((eintrag) => eintrag.nummer)).toEqual(["K-1042", "K-1043"]);
        expect(trefferZahl(alle, {}, undefined, "kategorie", KARTEN_KATEGORIE)).toBe(2);
        // Ein Vorschlag hat niemanden zuständig und gehört nie „mir“.
        expect(trefferZahl(alle, {}, "x", "zustaendig", "niemand")).toBe(3);
        expect(filtere(alle, { zustaendig: ["mir"] }, "x").map((eintrag) => eintrag.nummer)).toEqual(["COM-000124"]);
        // Neueste zuerst: der Vorschlag vom 9. vor dem Vorgang vom 8.; bei gleicher Zeit fest nach Nummer.
        expect(sortiere(alle, "neu").map((eintrag) => eintrag.nummer)).toEqual([
            "K-1043",
            "K-1042",
            "COM-000124",
            "COM-000123",
        ]);
        expect(legendeZahlen(alle)).toEqual({ leer: 3, halb: 0, "halb-rechts": 0, voll: 1 });
    });
});

describe("die Liste holt die Kartenvorschläge zum Segment", () => {
    const aufzeichnen = (antwort: (frage: VorschlagsFrage) => KartenvorschlagListe) => {
        const fragen: VorschlagsFrage[] = [];
        const laden = (frage: VorschlagsFrage): Promise<KartenvorschlagListe> => {
            fragen.push(frage);
            return Promise.resolve(antwort(frage));
        };
        return { fragen, laden };
    };

    it("Offen: die offenen, mit der Suche, bis 100", async () => {
        const { fragen, laden } = aufzeichnen(() => liste([vorschlag()]));
        const teil = await ladeKartenTeil("offen", "gareth", laden);
        expect(fragen).toEqual([{ segment: "offen", q: "gareth", limit: 100 }]);
        expect(teil?.eintraege.map((eintrag) => eintrag.nummer)).toEqual(["K-1042"]);
        expect(teil?.weitere).toBe(false);
    });

    it("Erledigt: angenommene und abgelehnte; gibt es mehr, sagt es weitere", async () => {
        const { fragen, laden } = aufzeichnen((frage) =>
            frage.segment === "angenommen"
                ? liste([vorschlag({ zustand: "approved" })])
                : liste([vorschlag({ nummer: "K-1", zustand: "rejected" })], true),
        );
        const teil = await ladeKartenTeil("erledigt", "", laden);
        expect(fragen.map((frage) => frage.segment)).toEqual(["angenommen", "abgelehnt"]);
        expect(teil?.eintraege).toHaveLength(2);
        expect(teil?.weitere).toBe(true);
    });

    it("Archiv und Papierkorb: keine Zeilen, aber die Zähler aus EINER Zeile", async () => {
        for (const segment of ["archiv", "papierkorb"] as const) {
            const { fragen, laden } = aufzeichnen(() => liste([vorschlag()]));
            const teil = await ladeKartenTeil(segment, "x", laden);
            expect(fragen, segment).toEqual([{ segment: "offen", limit: 1 }]);
            expect(teil?.eintraege, segment).toEqual([]);
            expect(teil?.zaehler, segment).toEqual(ZAEHLER);
        }
    });

    it("ohne Kartenvorschläge auf der Instanz (503) kein Teil, jeder andere Fehler bleibt einer", async () => {
        const fehlt = () => Promise.reject(new ApiFailure(503, "kartenvorschlag_unavailable", "aus"));
        await expect(ladeKartenTeil("offen", "", fehlt)).resolves.toBeUndefined();
        const kaputt = () => Promise.reject(new ApiFailure(500, "internal", "kaputt"));
        await expect(ladeKartenTeil("offen", "", kaputt)).rejects.toBeInstanceOf(ApiFailure);
    });
});

describe("die Zahlen", () => {
    const vorgaenge = {
        zaehler: { offen: 10, erledigt: 20, archiv: 30, papierkorb: 40, meine: 7, neu: 5, inArbeit: 3, rueckfrage: 2 },
    };

    it("am Segment: Vorgänge und Vorschläge in dessen Zuständen", () => {
        expect(kartenZahl(ZAEHLER, "offen")).toBe(1 + 2 + 3);
        expect(kartenZahl(ZAEHLER, "erledigt")).toBe(4 + 5 + 6);
        expect(kartenZahl(ZAEHLER, "archiv")).toBe(0);
        expect(zahlAmSegment(vorgaenge, { zaehler: ZAEHLER }, "offen")).toBe(16);
        expect(zahlAmSegment(vorgaenge, { zaehler: ZAEHLER }, "erledigt")).toBe(35);
        expect(zahlAmSegment(undefined, { zaehler: ZAEHLER }, "offen")).toBe(6);
        expect(zahlAmSegment(vorgaenge, undefined, "papierkorb")).toBe(40);
    });

    it("am Unterreiter: was auf mich wartet plus die wartenden Vorschläge (wie vorher am Reiter „Karten“)", () => {
        expect(wartendeZahl(vorgaenge, { zaehler: ZAEHLER })).toBe(7 + 3);
        expect(wartendeZahl(undefined, { zaehler: ZAEHLER })).toBe(3);
        expect(wartendeZahl(vorgaenge, undefined)).toBe(7);
        expect(wartendeZahl(undefined, undefined)).toBeUndefined();
    });
});

describe("🔴 der Unterreiter „Karten“ ist fort", () => {
    it("der alte Tiefe Link und das Gemerkte führen auf die Meldungen", () => {
        const reviewer = [...capabilitiesFor("reviewer")];
        expect(kinder(EDITORPANEL, "community", reviewer).map((eintrag) => eintrag.id)).not.toContain(
            "kartenvorschlaege",
        );
        expect(ausTiefemLink(EDITORPANEL, "kartenvorschlaege")).toEqual(["community", "meldungen"]);
        const gemerkt = new Map([["avesmaps3d.nav.editorpanel.community", "kartenvorschlaege"]]);
        const stand = wiederherstellen(EDITORPANEL, gemerkt, reviewer, "community");
        expect(stand.pfad).toEqual(["community", "meldungen"]);
        expect(stand.verwerfen).toContain("avesmaps3d.nav.editorpanel.community");
    });

    it("wer nur Kartenvorschläge prüft (Kurator, Kartograph), sieht die Meldungen", () => {
        const kartograph = ["use_editor_menu", "moderate_map_suggestions"];
        expect(kinder(EDITORPANEL, "community", kartograph).map((eintrag) => eintrag.id)).toEqual(["meldungen"]);
    });
});
