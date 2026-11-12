import { describe, expect, it } from "vitest";
import type { MamKarteDetail } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n";
import { kartenAnfrage, kartenStandAus, kartenStandNachladen } from "../src/medien/medien-karte-bearbeiten-modell";
import {
    alsKatalogEintrag,
    bildRolle,
    kartenUnterzeile,
    kartenZeilen,
    kreisDerKarte,
    naechsteKarte,
    sichtbaresBild,
} from "../src/medien/medien-karten-modell";
import { adresseMitZustand, MEDIEN_START, waehle, zustandAusAdresse } from "../src/medien/medien-zustand";

/**
 * Die Kartensammlung der Medienverwaltung (WI-0068 R5, nur lesend): Modell und Adresse. Die Angaben einer Karte kommen aus den
 * Faktenzeilen des Katalogs; Unbekanntes hat keine Zeile, ein ausdrückliches Nein schon.
 */
const KARTE: MamKarteDetail = {
    id: "7e570000-0000-4000-8000-000000000061",
    revision: 4,
    title: "Stadtplan von Gareth",
    art: "politisch",
    colorMode: null,
    isMultilevel: null,
    isLabeled: false,
    isOfficial: true,
    isSpoiler: null,
    hasScale: null,
    widthPx: 2000,
    heightPx: 1500,
    format: null,
    validFromBf: 1027,
    validToBf: 9999,
    author: "Zeichnerin Elwe",
    publisher: null,
    note: "  ",
    legacyWikiKey: "gareth-plan",
    legacyOrigin: "manual",
    state: "active",
    active: true,
    importedAt: null,
    editorHeld: false,
    parent: null,
    related: [],
    types: ["stadtplan"],
    places: [],
    links: [],
    sources: [],
    wiki: null,
    images: [],
};

describe("Kartensammlung: Modell (WI-0068 R5)", () => {
    setLocale("de");

    it("🔴 Unbekanntes hat keine Zeile, ein ausdrückliches Nein schon; 9999 ist das offene Ende", () => {
        const eintrag = alsKatalogEintrag(KARTE);
        expect(eintrag).not.toHaveProperty("colorMode");
        expect(eintrag).not.toHaveProperty("multilevel");
        expect(eintrag).not.toHaveProperty("note");
        expect(eintrag.labeled).toBe(false);
        const zeilen = kartenZeilen(KARTE);
        const ids = zeilen.map((zeile) => zeile.id);
        expect(ids).toContain("labeled");
        expect(ids).toContain("official");
        expect(ids).not.toContain("colour");
        expect(ids).not.toContain("note");
        expect(zeilen.find((zeile) => zeile.id === "validity")?.wert).toBe("seit 1027 BF");
    });

    it("die internen Angaben tragen die Marke, die des Katalogs nicht", () => {
        const zeilen = kartenZeilen(KARTE);
        expect(zeilen.filter((zeile) => zeile.intern).map((zeile) => zeile.id)).toEqual([
            "zustand",
            "herkunft",
            "wikischluessel",
        ]);
        expect(zeilen.find((zeile) => zeile.id === "herkunft")?.wert).toBe("von Hand");
    });

    it("die Unterzeile der Liste: Art, Typen, Zeitraum, soweit erfasst", () => {
        expect(kartenUnterzeile(KARTE)).toBe("Politisch · Stadtplan · seit 1027 BF");
        expect(kartenUnterzeile({ art: null, types: [], validFromBf: null, validToBf: null })).toBe("");
        // WI-0287 Stufe 2 (Entwurf `unterzeile`): ab zwei Versionen ihre Zahl, eine allein nennt sie nicht.
        expect(kartenUnterzeile({ ...KARTE, versions: 2 })).toBe("Politisch · Stadtplan · seit 1027 BF · 2 Versionen");
        expect(kartenUnterzeile({ ...KARTE, versions: 1 })).toBe("Politisch · Stadtplan · seit 1027 BF");
    });

    it("der Kreis: ohne Bild, mit Bild nicht öffentlich, mit öffentlichem Bild", () => {
        expect(kreisDerKarte({ images: 0, publicImages: 0 })).toBe("leer");
        expect(kreisDerKarte({ images: 2, publicImages: 0 })).toBe("halb");
        expect(kreisDerKarte({ images: 2, publicImages: 1 })).toBe("voll");
    });

    it("das sichtbare Bild ist die öffentliche Datei, sonst die private Vorschau", () => {
        const oeffentlich = { url: "/media/sha256/aa/bb/x.webp", width: 10, height: 10 };
        const privat = { url: "/api/editor/media/x/preview/intern_citymap_preview", width: 10, height: 10 };
        expect(sichtbaresBild({ preview: oeffentlich, privatePreview: privat })).toBe(oeffentlich);
        expect(sichtbaresBild({ preview: null, privatePreview: privat })).toBe(privat);
        expect(sichtbaresBild({ preview: null, privatePreview: null })).toBeUndefined();
        expect(bildRolle({ role: "map_full" })).toBe("Vollbild");
    });
});

describe("Kartensammlung: Adresse (WI-0068 R5)", () => {
    it("🔴 die gewählte Karte steht in der Adresse und kommt zurück, nur bei der Kartensammlung", () => {
        const zustand = { ...waehle(MEDIEN_START, { objekt: "kartensammlung" }), karte: KARTE.id };
        const adresse = adresseMitZustand("?route=Gareth~Perricum", zustand);
        expect(adresse).toBe(`?route=Gareth~Perricum&medien&medien-objekt=kartensammlung&medien-karte=${KARTE.id}`);
        expect(zustandAusAdresse(adresse)).toMatchObject({ auswahl: { objekt: "kartensammlung" }, karte: KARTE.id });
        // Eine andere Facette nimmt die Karte nicht mit.
        expect(waehle(zustand, { typ: null }).karte).toBeUndefined();
        expect(zustandAusAdresse(`?medien&medien-objekt=galerien&medien-karte=${KARTE.id}`)?.karte).toBeUndefined();
    });
});

describe("Kartensammlung: Bearbeiten (WI-0068 R5, Betreiber 2026-10-18 „B jetzt“)", () => {
    setLocale("de");

    it("ohne Änderung keine Anfrage; die Notiz aus Leerzeichen zählt als nicht erfasst", () => {
        const stand = kartenStandAus(KARTE);
        expect(kartenAnfrage(KARTE, stand)).toEqual({ anfrage: undefined, befunde: new Map() });
        expect(kartenAnfrage(KARTE, { ...stand, notiz: "" }).anfrage).toBeUndefined();
    });

    it("🔴 nur was sich ändert, gegen den gesehenen Stand; unbekannt ist null, nie nein; Typen als sortierte Menge", () => {
        const stand = {
            ...kartenStandAus(KARTE),
            titel: "  Stadtplan von Gareth (1027) ",
            art: "",
            beschriftet: "",
            spoiler: "nein",
            ab: " 1020 ",
            zeichner: " ",
            typen: ["viertel" as const, "stadtplan" as const],
        };
        expect(kartenAnfrage(KARTE, stand)).toEqual({
            anfrage: {
                baseRevision: 4,
                fields: {
                    title: "Stadtplan von Gareth (1027)",
                    art: null,
                    isLabeled: null,
                    isSpoiler: false,
                    validFromBf: 1020,
                    author: null,
                },
                types: ["stadtplan", "viertel"],
            },
            befunde: new Map(),
        });
        // Nur die Typen: keine Felder.
        expect(kartenAnfrage(KARTE, { ...kartenStandAus(KARTE), typen: [] }).anfrage).toEqual({
            baseRevision: 4,
            types: [],
        });
    });

    it("Befunde je Feld statt einer Anfrage: leerer Titel, keine ganze Zahl, „bis“ vor „ab“, zu langer Text", () => {
        const stand = {
            ...kartenStandAus(KARTE),
            titel: "   ",
            breite: "12a",
            bis: "1000",
            verlag: "V".repeat(161),
        };
        const { anfrage, befunde } = kartenAnfrage(KARTE, stand);
        expect(anfrage).toBeUndefined();
        expect([...befunde.keys()].sort()).toEqual(["bis", "breite", "titel", "verlag"]);
        expect(befunde.get("titel")).toBe("Eine Karte braucht einen Titel.");
        expect(befunde.get("verlag")).toBe("Höchstens 160 Zeichen.");
    });
});

describe("Kartensammlung: Neu laden nach einem Konflikt (Fund der R5-Bedienprobe 2026-10-19)", () => {
    it("🔴 Unberührtes folgt dem neuen Stand, die eigenen Eingaben bleiben; das nächste Speichern überschreibt die andere nicht", () => {
        const alt = kartenStandAus(KARTE);
        const eigen = { ...alt, notiz: "Zu spät", typen: [...alt.typen] };
        const neueKarte = {
            ...KARTE,
            revision: 5,
            publisher: "Probe Verlag",
            types: ["stadtplan" as const, "viertel" as const],
        };
        const nachgeladen = kartenStandNachladen(alt, eigen, kartenStandAus(neueKarte));
        expect(nachgeladen.verlag, "unberührt: folgt der anderen").toBe("Probe Verlag");
        expect(nachgeladen.notiz, "eigene Eingabe bleibt").toBe("Zu spät");
        expect(nachgeladen.typen, "unberührte Typen folgen").toEqual(["stadtplan", "viertel"]);
        expect(kartenAnfrage(neueKarte, nachgeladen).anfrage).toEqual({ baseRevision: 5, fields: { note: "Zu spät" } });
        // Eigene Typen bleiben, auch wenn die andere Person sie geändert hat.
        const eigeneTypen = kartenStandNachladen(alt, { ...alt, typen: ["dungeon"] }, kartenStandAus(neueKarte));
        expect(eigeneTypen.typen).toEqual(["dungeon"]);
    });

    it("🔴 nach dem Entfernen wird die nächste aktive Karte gewählt, sonst die erste, sonst keine (WI-0287)", () => {
        const zeilen = [
            { id: "a", active: true },
            { id: "b", active: true },
            { id: "c", active: false },
            { id: "d", active: true },
        ];
        expect(naechsteKarte(zeilen, "a")).toBe("b");
        expect(naechsteKarte(zeilen, "b"), "eine stillgelegte Zeile wird übersprungen").toBe("d");
        expect(naechsteKarte(zeilen, "d"), "am Ende der Liste die erste").toBe("a");
        expect(naechsteKarte([{ id: "x", active: true }], "x"), "die einzige: keine Wahl mehr").toBeUndefined();
        expect(naechsteKarte([], "x")).toBeUndefined();
    });
});
