import { describe, expect, it } from "vitest";
import type { MamNavigation, MediaAssetDetail } from "@avesmaps3d/shared";
import { darfKartenvorschlaege } from "../src/community/kartenvorschlaege-modell";
import { medienArtenBereiche } from "../src/medien/medien-arten-modell";
import { vorschlagPruefen } from "../src/medien/medien-inspektor-modell";
import {
    MEDIEN_START,
    adresseMitZustand,
    auswahlAusKennung,
    auswahlKennung,
    startEbene,
    waehle,
    zustandAusAdresse,
    type MedienZustand,
} from "../src/medien/medien-zustand";

/**
 * Die Kartenvorschläge in der Medienverwaltung (WI-0068 OPS-000093): die Adresse, die Schiene mit und ohne Recht, der Weg aus dem Inspector eines Vorschlagsbilds. Das Zusammenspiel von Liste, Blatt und Schritten prüft
 * `e2e/medien.spec.ts`; Annehmen und Ablehnen selbst sind die der Redaktion (`kartenvorschlag-redaktion.spec.ts`).
 */

const VORSCHLAG = "5c2f6a0e-8f3b-4d0b-9a55-0d6f7a1c2b34";

describe("die Adresse eines Kartenvorschlags", () => {
    const gewaehlt: MedienZustand = {
        ...MEDIEN_START,
        auswahl: { objekt: "kartenvorschlaege" },
        vorschlag: VORSCHLAG,
    };

    it("übersteht den Weg über die Adresse", () => {
        const adresse = adresseMitZustand("", gewaehlt);
        expect(adresse).toContain("medien-objekt=kartenvorschlaege");
        expect(adresse).toContain(`medien-vorschlag=${VORSCHLAG}`);
        expect(zustandAusAdresse(adresse)).toMatchObject({
            auswahl: { objekt: "kartenvorschlaege" },
            vorschlag: VORSCHLAG,
        });
    });

    it("🔴 nur gültige Werte: eine fremde Kennung und eine andere Facette gelten nicht", () => {
        expect(
            zustandAusAdresse("?medien&medien-objekt=kartenvorschlaege&medien-vorschlag=x")?.vorschlag,
        ).toBeUndefined();
        expect(zustandAusAdresse("?medien&medien-objekt=kartenvorschlaege")?.vorschlag).toBeUndefined();
        expect(
            zustandAusAdresse(`?medien&medien-objekt=galerien&medien-vorschlag=${VORSCHLAG}`)?.vorschlag,
        ).toBeUndefined();
        expect(zustandAusAdresse(`?medien&medien-vorschlag=${VORSCHLAG}`)?.vorschlag).toBeUndefined();
    });

    it("der Vorschlag gehört zur Facette: eine andere Wahl nimmt ihn mit, die Liste bleibt kürzer als die Adresse", () => {
        expect(waehle(gewaehlt, { korb: "photobox_uploads" }).vorschlag).toBeUndefined();
        expect(adresseMitZustand("?route=Gareth", waehle(gewaehlt, { typ: null }))).toBe("?route=Gareth&medien");
    });

    it("die Schiene kennt den Eintrag, und am Telefon beginnt ein tiefer Link im Vorschlag", () => {
        expect(auswahlAusKennung(auswahlKennung({ objekt: "kartenvorschlaege" }))).toEqual({
            objekt: "kartenvorschlaege",
        });
        expect(startEbene(gewaehlt)).toBe(3);
        expect(startEbene({ ...gewaehlt, vorschlag: undefined })).toBe(2);
    });
});

describe("die Rechte der Redaktion", () => {
    it("eines der beiden genügt, sonst keines", () => {
        expect(darfKartenvorschlaege(["moderate_submissions"])).toBe(true);
        expect(darfKartenvorschlaege(["x", "moderate_map_suggestions"])).toBe(true);
        expect(darfKartenvorschlaege(["view_media_private", "upload_media"])).toBe(false);
        expect(darfKartenvorschlaege([])).toBe(false);
    });
});

describe("die Schiene „Eingänge“", () => {
    const nav = { total: 3, types: {}, baskets: {}, einreichungen: { offen: 2 } } as unknown as MamNavigation;
    const KENNUNG = auswahlKennung({ objekt: "kartenvorschlaege" });
    const eingaenge = (vorschlaege: { zahl: number | undefined } | undefined) =>
        medienArtenBereiche(nav, vorschlaege).find((bereich) => bereich.id === "eingaenge")?.eintraege ?? [];

    it("🔴 ohne Recht gibt es den Eintrag nicht, und der Platzhalter „Bildvorschläge“ ist fort", () => {
        const eintraege = eingaenge(undefined);
        expect(eintraege.map((eintrag) => eintrag.id)).toEqual([auswahlKennung({ korb: "photobox_uploads" })]);
        expect(eintraege.some((eintrag) => eintrag.art === "spaeter")).toBe(false);
    });

    it("mit Recht ein echter Eintrag mit der Zahl der offenen Vorschläge", () => {
        const eintrag = eingaenge({ zahl: 4 }).find((e) => e.id === KENNUNG);
        expect(eintrag).toMatchObject({ art: "ansicht", name: "Kartenvorschläge", wert: "4" });
    });

    it("solange die Zahl unbekannt ist, steht der Eintrag ohne Zahl da", () => {
        const eintrag = eingaenge({ zahl: undefined }).find((e) => e.id === KENNUNG);
        expect(eintrag).toMatchObject({ art: "ansicht", wert: undefined });
    });
});

describe("„Vorschlag prüfen …“ im Inspector eines Vorschlagsbilds", () => {
    const detail = (zustand: string | undefined): MediaAssetDetail =>
        ({
            ...(zustand === undefined ? {} : { kartenvorschlag: { id: VORSCHLAG, nummer: "K-7", zustand } }),
        }) as unknown as MediaAssetDetail;

    it.each(["pending", "incoming", "technical_failed"])(
        "ein offener Vorschlag (%s) führt in die Redaktion",
        (zustand) => {
            expect(vorschlagPruefen(detail(zustand), ["moderate_map_suggestions"])).toEqual({
                id: VORSCHLAG,
                nummer: "K-7",
            });
        },
    );

    it.each(["approved", "rejected", "withdrawn"])(
        "ein entschiedener Vorschlag (%s) hat nichts mehr zu prüfen",
        (zustand) => {
            expect(vorschlagPruefen(detail(zustand), ["moderate_submissions"])).toBeUndefined();
        },
    );

    it("🔴 ohne eines der beiden Rechte und ohne Vorschlag gibt es den Knopf nicht", () => {
        expect(vorschlagPruefen(detail("pending"), ["view_media_private"])).toBeUndefined();
        expect(vorschlagPruefen(detail(undefined), ["moderate_submissions"])).toBeUndefined();
        expect(vorschlagPruefen(undefined, ["moderate_submissions"])).toBeUndefined();
    });
});
