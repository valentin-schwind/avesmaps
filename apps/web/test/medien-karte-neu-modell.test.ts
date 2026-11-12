import { describe, expect, it } from "vitest";
import type { OperationReceipt } from "@avesmaps3d/shared";
import {
    bildDerRolle,
    gleicherName,
    karteHochladenUndBinden,
    leereKarteSatz,
    leererKartenStand,
    namensKonflikt,
    neuerEintragAnfrage,
    typDerRolle,
    versionenDerKarte,
    versionsBezeichnung,
    vorbelegterTitel,
} from "../src/medien/medien-karte-neu-modell";
import { kartenDateiRumpf, neuerAblauf } from "../src/medien/medien-operationen";

const quittung = (art: string, id: string): OperationReceipt =>
    ({
        status: "applied",
        operationId: "o",
        environment: "test",
        affected: [{ kind: art, id, revision: 1 }],
        derivedWork: [],
        warnings: [],
    }) as OperationReceipt;

describe("Neuer Eintrag der Kartensammlung: die Prüfung (WI-0287)", () => {
    it("nur was erfasst ist, geht mit; Unbekanntes bleibt weg, die Orte in der gewählten Folge", () => {
        const { anfrage, befunde } = neuerEintragAnfrage(
            "Aranien",
            {
                ...leererKartenStand(),
                art: "politisch",
                zeichner: " Elwe ",
                typen: ["region", "bezirk"],
                offiziell: "nein",
            },
            [
                { id: "ort-2", name: "Fasar", typ: "Metropole" },
                { id: "ort-1", name: "Gareth", typ: "Metropole" },
            ],
        );
        expect(befunde.size).toBe(0);
        expect(anfrage).toEqual({
            fields: { title: "Aranien", art: "politisch", author: "Elwe", isOfficial: false },
            types: ["bezirk", "region"],
            places: ["ort-2", "ort-1"],
        });
    });

    it("ohne Namen fehlt die Anfrage, und der Befund steht am Namen", () => {
        const { anfrage, befunde } = neuerEintragAnfrage("   ", leererKartenStand(), []);
        expect(anfrage).toBeUndefined();
        expect(befunde.has("titel")).toBe(true);
    });

    it("ein Jahr außerhalb der Grenzen und ein Zeitraum verkehrt herum sind Befunde", () => {
        expect(neuerEintragAnfrage("A", { ...leererKartenStand(), ab: "12000" }, []).befunde.has("ab")).toBe(true);
        expect(
            neuerEintragAnfrage("A", { ...leererKartenStand(), ab: "1020", bis: "1010" }, []).befunde.has("bis"),
        ).toBe(true);
        expect(
            neuerEintragAnfrage("A", { ...leererKartenStand(), ab: "1020", bis: "1030" }, []).anfrage?.fields,
        ).toEqual({
            title: "A",
            validFromBf: 1020,
            validToBf: 1030,
        });
    });
});

describe("Karte und Vorschau hochladen: Vorbelegung und Namenskonflikt (WI-0287)", () => {
    it("der Name ist vorbelegt: Karte von „Titel“ bzw. Vorschau von „Titel“", () => {
        expect(vorbelegterTitel("map_full", "Rhôndur")).toBe("Karte von „Rhôndur“");
        expect(vorbelegterTitel("map_preview", "Rhôndur")).toBe("Vorschau von „Rhôndur“");
    });

    it("gleiche Namen sind gleich ohne Groß- und Kleinschreibung und ohne Ränder; Umlaute zählen mit", () => {
        expect(gleicherName(" Karte von „Ärzte“ ", "karte von „ärzte“")).toBe(true);
        expect(gleicherName("Karte von „A“", "Karte von „B“")).toBe(false);
    });

    it("🔴 der Konflikt ist das erste Werk der Liste mit demselben Namen; ein leerer Name hat keinen, ein Werk ohne Titel nie", () => {
        const werke = [
            { id: "a", title: null },
            { id: "b", title: "Porto Paligan" },
            { id: "c", title: "porto paligan" },
        ];
        expect(namensKonflikt("PORTO PALIGAN ", werke)?.id).toBe("b");
        expect(namensKonflikt("Gareth", werke)).toBeUndefined();
        expect(namensKonflikt("  ", werke)).toBeUndefined();
    });

    it("die Liste zur Rolle und das aktive Bild der Rolle", () => {
        expect(typDerRolle("map_full")).toBe("map");
        expect(typDerRolle("map_preview")).toBe("map_preview");
        const karte = { images: [{ role: "map_preview" as const }, { role: "map_full" as const }] };
        expect(bildDerRolle(karte as never, "map_full")?.role).toBe("map_full");
        expect(bildDerRolle({ images: [] } as never, "map_preview")).toBeUndefined();
    });

    it("Stufe 2: die Versionen der Karte in der Folge des Servers, die erste ist das Bild der Rolle; leer heißt ohne Bezeichnung", () => {
        const karte = {
            images: [
                { role: "map_preview" as const, assetId: "v" },
                { role: "map_full" as const, assetId: "spieler", versionLabel: "Spielerversion", versionPosition: 0 },
                { role: "map_full" as const, assetId: "meister", versionLabel: null, versionPosition: 1 },
            ],
        };
        expect(versionenDerKarte(karte as never).map((bild) => bild.assetId)).toEqual(["spieler", "meister"]);
        expect(bildDerRolle(karte as never, "map_full")?.assetId).toBe("spieler");
        expect(versionenDerKarte({ images: [] } as never)).toEqual([]);
        expect(versionsBezeichnung("  SL-Version ")).toBe("SL-Version");
        expect(versionsBezeichnung("   ")).toBeNull();
        expect(versionsBezeichnung(null)).toBeNull();
    });

    it("der leere Platz „Die Karte“ nennt, was fehlt: Link und Vorschau ändern den Satz", () => {
        expect(leereKarteSatz(false, false)).toBe("keine");
        expect(leereKarteSatz(true, false)).toBe("nurLink");
        expect(leereKarteSatz(true, true)).toBe("vorschauLink");
        expect(leereKarteSatz(false, true)).toBe("vorschauOhneLink");
    });
});

describe("Hochladen, dann an den Eintrag binden (WI-0287)", () => {
    it("🔴 scheitert das Binden, bleibt das Werk; ein zweiter Versuch lädt nicht noch einmal hoch", async () => {
        const ablauf = neuerAblauf();
        let hochgeladen = 0;
        let versuche = 0;
        const hochladen = async (): Promise<OperationReceipt> => {
            hochgeladen += 1;
            return quittung("media_asset", "werk-1");
        };
        const binden = async (assetId: string): Promise<OperationReceipt> => {
            versuche += 1;
            if (versuche === 1) throw new Error("Konflikt");
            expect(assetId).toBe("werk-1");
            return quittung("citymap", "karte-1");
        };
        await expect(karteHochladenUndBinden(ablauf, hochladen, binden)).rejects.toThrow("Konflikt");
        expect(ablauf.assetId).toBe("werk-1");
        const danach = await karteHochladenUndBinden(ablauf, hochladen, binden);
        expect(danach.assetId).toBe("werk-1");
        expect(hochgeladen).toBe(1);
        expect(versuche).toBe(2);
    });

    it("🔴 der Rumpf der Kartendatei: vier Byte Länge, Kopf als JSON, dann die Bytes", async () => {
        const kopf = { operationId: "o", name: "ä.png", form: {} } as never;
        const rumpf = new Uint8Array(await kartenDateiRumpf(kopf, new Blob([new Uint8Array([9, 8, 7])])).arrayBuffer());
        const laenge = new DataView(rumpf.buffer).getUint32(0);
        expect(JSON.parse(new TextDecoder().decode(rumpf.subarray(4, 4 + laenge)))).toEqual(kopf);
        expect([...rumpf.subarray(4 + laenge)]).toEqual([9, 8, 7]);
    });
});
