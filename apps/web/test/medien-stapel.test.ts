import { describe, expect, it } from "vitest";
import type { MamAssetSummary, OperationReceipt } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import {
    neueZeile,
    pruefeZeile,
    sendeStapel,
    type StapelSchritte,
    type StapelZeile,
} from "../src/medien/medien-stapel-modell";

/**
 * Mehrere Bilder auf einmal in eine Galerie (WI-0068 MAM-R3, Blatt P6 Abschnitt 2): eine Reihe mit einem Ergebnis je Datei.
 *
 * - Teilfehler halten die anderen nicht auf; „↺ Erneut“ ordnet nur ein, lädt nie ein zweites Mal hoch.
 * - Bytegleiche Dateien (Betreiber 2026-10-17) werden „bereits vorhanden“ gemeldet und auf Wunsch übernommen, ohne neues Werk.
 * - Jede Einordnung trägt die Revision, die die vorige hinterließ.
 */
const VORHANDEN = "a1a2a3a4-0000-4000-8000-0000000000aa";
const datei = (name: string): File => new File([new Uint8Array([1, 2, 3, name.length])], name, { type: "image/png" });
const quittung = (affected: OperationReceipt["affected"]): OperationReceipt =>
    ({
        operationId: "x",
        status: "applied",
        environment: "test",
        affected,
        derivedWork: [],
        warnings: [],
    }) as OperationReceipt;

function schritte(regeln: {
    hochladen?: (name: string, versuch: number) => OperationReceipt;
    einordnen?: (assetId: string, revision: number, versuch: number) => OperationReceipt;
}): StapelSchritte & { hochgeladen: string[]; eingeordnet: [string, number][] } {
    const hochgeladen: string[] = [];
    const eingeordnet: [string, number][] = [];
    const versuche = new Map<string, number>();
    const zaehle = (schluessel: string): number => {
        const n = (versuche.get(schluessel) ?? 0) + 1;
        versuche.set(schluessel, n);
        return n;
    };
    return {
        hochgeladen,
        eingeordnet,
        async hochladen(zeile) {
            hochgeladen.push(zeile.datei.name);
            return (
                regeln.hochladen?.(zeile.datei.name, zaehle(`h:${zeile.datei.name}`)) ??
                quittung([{ kind: "media_asset", id: `asset-${zeile.datei.name}`, revision: 1 }])
            );
        },
        async einordnen(assetId, revision) {
            eingeordnet.push([assetId, revision]);
            return (
                regeln.einordnen?.(assetId, revision, zaehle(`e:${assetId}`)) ??
                quittung([{ kind: "gallery", id: "g", revision: revision + 1 }])
            );
        },
        fehlerText: (error) => (error instanceof Error ? error.message : "Fehler"),
    };
}

const bereit = (name: string, stand: StapelZeile["stand"] = "neu"): StapelZeile => ({
    ...neueZeile(datei(name)),
    stand,
});

describe("Stapelupload in eine Galerie (WI-0068 MAM-R3)", () => {
    it("lädt nacheinander hoch und ordnet ein; jede Einordnung trägt die Revision der vorigen, die Nummer zählt weiter", async () => {
        const zeilen = [bereit("a.png"), bereit("b.png"), bereit("c.png")];
        const s = schritte({});
        const galerie = { revision: 7, anzahl: 10 };
        await sendeStapel(zeilen, galerie, s, () => undefined);
        expect(zeilen.map((zeile) => [zeile.stand, zeile.nummer])).toEqual([
            ["fertig", 11],
            ["fertig", 12],
            ["fertig", 13],
        ]);
        expect(s.eingeordnet.map(([, revision]) => revision)).toEqual([7, 8, 9]);
        expect(galerie).toEqual({ revision: 10, anzahl: 13 });
    });

    it("🔴 eine abgewiesene Datei hält die anderen nicht auf", async () => {
        const zeilen = [bereit("gut.png"), bereit("skizze.psd"), bereit("auch-gut.png")];
        const s = schritte({
            hochladen: (name) => {
                if (name === "skizze.psd")
                    throw new ApiFailure(415, "unsupported_media_type", "Format nicht unterstützt");
                return quittung([{ kind: "media_asset", id: `asset-${name}`, revision: 1 }]);
            },
        });
        await sendeStapel(zeilen, { revision: 1, anzahl: 0 }, s, () => undefined);
        expect(zeilen.map((zeile) => zeile.stand)).toEqual(["fertig", "abgewiesen", "fertig"]);
        expect(zeilen[1]!.meldung).toBe("Format nicht unterstützt");
    });

    it("🔴 scheitert das Einordnen, ordnet „Erneut“ nur ein: kein zweites Hochladen, kein Bild zweimal", async () => {
        const zeile = bereit("tor.png");
        const s = schritte({
            einordnen: (_asset, revision, versuch) => {
                if (versuch === 1) throw new ApiFailure(409, "edit_conflict", "Die Galerie wurde geändert");
                return quittung([{ kind: "gallery", id: "g", revision: revision + 1 }]);
            },
        });
        const galerie = { revision: 3, anzahl: 4 };
        await sendeStapel([zeile], galerie, s, () => undefined);
        expect(zeile.stand).toBe("offen");
        expect(zeile.assetId).toBe("asset-tor.png");
        await sendeStapel([zeile], { revision: 5, anzahl: 4 }, s, () => undefined);
        expect(zeile.stand).toBe("fertig");
        expect(s.hochgeladen).toEqual(["tor.png"]);
        expect(s.eingeordnet).toEqual([
            ["asset-tor.png", 3],
            ["asset-tor.png", 5],
        ]);
    });

    it("🔴 bytegleiche Datei: „bereits vorhanden“, übernommen ohne Hochladen; abgewählt bleibt sie draußen", async () => {
        const treffer = { id: VORHANDEN, title: "Basar von Fasar" } as MamAssetSummary;
        const uebernommen = neueZeile(datei("basar.png"));
        const abgewaehlt = neueZeile(datei("basar-kopie.png"));
        const client = { gleicheBytes: async () => ({ hits: [treffer], suggested: VORHANDEN }) };
        for (const zeile of [uebernommen, abgewaehlt]) {
            await pruefeZeile(zeile, client, async () => "f".repeat(64), new AbortController().signal);
        }
        expect(uebernommen).toMatchObject({ stand: "vorhanden", assetId: VORHANDEN, uebernehmen: true });
        abgewaehlt.uebernehmen = false;
        const s = schritte({});
        await sendeStapel([uebernommen, abgewaehlt], { revision: 1, anzahl: 0 }, s, () => undefined);
        expect(s.hochgeladen).toEqual([]);
        expect(s.eingeordnet).toEqual([[VORHANDEN, 1]]);
        expect([uebernommen.stand, abgewaehlt.stand]).toEqual(["fertig", "uebersprungen"]);
    });

    it("steht das Bild schon in der Galerie, sagt die Zeile es; ein Wettlauf beim Hochladen ordnet das vorhandene Werk ein", async () => {
        const schonDrin = bereit("da.png", "vorhanden");
        schonDrin.assetId = VORHANDEN;
        const wettlauf = bereit("gleichzeitig.png");
        const s = schritte({
            hochladen: () => {
                throw new ApiFailure(409, "media_already_exists", "Dieses Bild gibt es bereits.", {
                    assetId: "b-asset",
                });
            },
            einordnen: (assetId, revision) => {
                if (assetId === VORHANDEN) throw new ApiFailure(409, "media_duplicate_file", "schon in der Galerie");
                return quittung([{ kind: "gallery", id: "g", revision: revision + 1 }]);
            },
        });
        await sendeStapel([schonDrin, wettlauf], { revision: 1, anzahl: 0 }, s, () => undefined);
        expect(schonDrin.stand).toBe("schonDrin");
        expect(wettlauf).toMatchObject({ stand: "fertig", assetId: "b-asset", nummer: 1 });
    });

    it("ohne Antwort auf die Frage nach denselben Bytes bleibt die Datei neu", async () => {
        const zeile = neueZeile(datei("x.png"));
        const client = {
            gleicheBytes: async () => {
                throw new Error("weg");
            },
        };
        await pruefeZeile(zeile, client, async () => "0".repeat(64), new AbortController().signal);
        expect(zeile.stand).toBe("neu");
    });
});
