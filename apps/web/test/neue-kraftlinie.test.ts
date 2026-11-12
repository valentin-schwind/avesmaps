import { describe, expect, it, vi } from "vitest";
import type {
    EditorPowerlineTargets,
    NodixCreateReceipt,
    OperationReceipt,
    PowerlineCreateBody,
    PowerlineCreateReceipt,
} from "@avesmaps3d/shared";
import { anlegenStart, setze, type AnlegenEingabe, type AnlegenModus } from "../src/map/geometrie/anlegen";
import type { Ziel } from "../src/map/geometrie/geometrie";
import { KRAFTLINIE_ANLEGEN } from "../src/map/geometrie/kraftlinie-anlegen";
import type { Antwort } from "../src/kraftlinieneditor/kraftlinien-daten";
import { createKraftlinienpunktEntfernen } from "../src/kraftlinieneditor/kraftlinienpunkt-entfernen";
import { createKraftlinienpunktSetzen } from "../src/kraftlinieneditor/kraftlinienpunkt-setzen";
import { createNeueKraftlinie } from "../src/kraftlinieneditor/neue-kraftlinie";

/**
 * „Neue Kraftlinie“ (WI-0205 K9; Blatt Kraftlinien R4; Abnahme in WI-0205 §5): Problemfälle: ein Klick ins Leere setzt einen Punkt; der
 * Klick auf den Anfangs-Nodix schließt ab; ein Ort ohne Merkmal Nodix ist ein Ziel; es wird mehr als EINE Operation geschrieben, oder
 * mit vertauschten Enden; ein abgelehnter Entwurf beendet den Modus; „Nodix anfügen“ verliert den Namen der Linie.
 */

const GARETH = "0c0c0c0c-0000-4000-8000-000000000001";
const PUNIN = "0c0c0c0c-0000-4000-8000-000000000002";
const PUNKT = "0c0c0c0c-0000-4000-8000-000000000003";
const NODICES: EditorPowerlineTargets = {
    targets: [
        { id: GARETH, kind: "place", name: "Gareth", x: 500, y: 500 },
        { id: PUNIN, kind: "place", name: "Punin", x: 600, y: 520 },
        { id: PUNKT, kind: "nodix", x: 550, y: 480 },
    ],
};
const zielVon = (id: string): Ziel => {
    const z = NODICES.targets.find((t) => t.id === id)!;
    return { art: z.kind === "place" ? "ort" : "ecke", at: { x: z.x, y: z.y }, objekt: z.id, name: z.name ?? "" };
};

describe("Die Art Kraftlinie im Modus Anlegen", () => {
    const start = anlegenStart({ at: zielVon(GARETH).at, ziel: zielVon(GARETH) });

    it("🔴 ein Klick ins Leere setzt nichts; am Anfangs-Nodix auch nicht", () => {
        expect(setze(KRAFTLINIE_ANLEGEN, start, { x: 520, y: 510 }, undefined)).toBeUndefined();
        const amAnfang = { ziel: zielVon(GARETH), at: zielVon(GARETH).at, abstand: 0 };
        expect(setze(KRAFTLINIE_ANLEGEN, start, amAnfang.at, amAnfang)).toBeUndefined();
    });

    it("🔴 der Klick auf einen zweiten Nodix schließt ab, auch an einem Kraftlinienpunkt", () => {
        for (const id of [PUNIN, PUNKT]) {
            const treffer = { ziel: zielVon(id), at: zielVon(id).at, abstand: 2 };
            const aus = setze(KRAFTLINIE_ANLEGEN, start, treffer.at, treffer);
            expect(aus?.beenden).toBe(true);
            expect(KRAFTLINIE_ANLEGEN.pruefe(aus!.entwurf.punkte.map((p) => p.at))).toBeUndefined();
        }
        expect(KRAFTLINIE_ANLEGEN.ziele("weiter")).toEqual(["ort", "label", "ecke"]);
        expect(KRAFTLINIE_ANLEGEN.loesen).toBe(false);
    });
});

describe("Die Steuerung „Neue Kraftlinie“", () => {
    function aufbau(antwort: Antwort<PowerlineCreateReceipt>) {
        let eingabe: AnlegenEingabe | undefined;
        const modus = {
            sperre: vi.fn(),
            aus: vi.fn(),
            zurueck: vi.fn(),
            wieder: vi.fn(),
            verwerfen: vi.fn(),
            fertig: vi.fn(),
            aktualisiere: vi.fn(),
            entwurf: vi.fn(),
        } satisfies AnlegenModus;
        const gesendet: PowerlineCreateBody[] = [];
        const karte = {
            ein: vi.fn((e: AnlegenEingabe) => {
                eingabe = e;
                return modus;
            }),
            geaendert: vi.fn(),
        };
        const geoeffnet = vi.fn();
        const neu = createNeueKraftlinie({
            daten: {
                nodices: vi.fn(async () => NODICES),
                legeAn: vi.fn(async (body: PowerlineCreateBody) => {
                    gesendet.push(body);
                    return antwort;
                }),
            },
            karte,
            fangradius: () => 12,
            geoeffnet,
            neueKennung: () => "0c0c0c0c-0000-4000-8000-0000000000ff",
        });
        const ende = (id: string) => ({ at: zielVon(id).at, ziel: zielVon(id) });
        return { neu, karte, modus, gesendet, geoeffnet, eingabe: () => eingabe!, ende };
    }
    const QUITTUNG = {
        ok: true as const,
        quittung: { publicId: "0c0c0c0c-0000-4000-8000-0000000000e1", name: "Gareth - Punin", mapRevision: 77 },
    } as unknown as Antwort<PowerlineCreateReceipt>;

    it("🔴 beginnt fest am Nodix und schreibt beim zweiten EINE Operation von dort nach dort; danach öffnet das Fenster", async () => {
        const { neu, karte, gesendet, geoeffnet, eingabe, ende } = aufbau(QUITTUNG);
        await neu.starte({ knoten: GARETH });
        expect(karte.ein).toHaveBeenCalledOnce();
        expect(eingabe().art).toBe(KRAFTLINIE_ANLEGEN);
        expect(eingabe().anfang?.ziel?.objekt).toBe(GARETH);
        expect(
            eingabe()
                .ziele()
                .map((z) => z.objekt),
        ).toEqual([GARETH, PUNIN, PUNKT]);
        expect(neu.laufend.value).toMatchObject({ phase: "bereit", von: "Gareth" });

        eingabe().fertig([ende(GARETH), ende(PUNIN)]);
        await vi.waitFor(() => expect(neu.laufend.value).toBeUndefined());
        expect(gesendet).toEqual([{ operationId: "0c0c0c0c-0000-4000-8000-0000000000ff", from: GARETH, to: PUNIN }]);
        expect(karte.geaendert).toHaveBeenCalledWith(77);
        expect(geoeffnet).toHaveBeenCalledWith("0c0c0c0c-0000-4000-8000-0000000000e1");
        expect(neu.meldung.value).toEqual({
            art: "gespeichert",
            publicId: "0c0c0c0c-0000-4000-8000-0000000000e1",
            name: "Gareth - Punin",
        });
    });

    it("🔴 „Nodix anfügen“: der Name der Linie reist mit", async () => {
        const { neu, gesendet, eingabe, ende } = aufbau(QUITTUNG);
        await neu.starte({ knoten: PUNIN, name: "Ley von Gareth" });
        eingabe().fertig([ende(PUNIN), ende(PUNKT)]);
        await vi.waitFor(() => expect(gesendet).toHaveLength(1));
        expect(gesendet[0]).toMatchObject({ from: PUNIN, to: PUNKT, name: "Ley von Gareth" });
    });

    it("🔴 abgelehnt: der Modus bleibt, die Meldung trägt den Satz des Servers", async () => {
        const { neu, modus, eingabe, ende } = aufbau({
            ok: false,
            status: 400,
            fehler: { code: "validation_failed", message: "Eine Kraftlinie verbindet nur Nodices." },
        });
        await neu.starte({ knoten: GARETH });
        eingabe().fertig([ende(GARETH), ende(PUNIN)]);
        await vi.waitFor(() =>
            expect(neu.meldung.value).toEqual({ art: "abgelehnt", satz: "Eine Kraftlinie verbindet nur Nodices." }),
        );
        expect(neu.laufend.value?.phase).toBe("bereit");
        expect(modus.sperre).toHaveBeenLastCalledWith(false);
        expect(modus.aus).not.toHaveBeenCalled();
    });

    it("ein Anfang, der kein Nodix (mehr) ist, startet nicht und sagt es; Esc beendet", async () => {
        const { neu, karte } = aufbau(QUITTUNG);
        await neu.starte({ knoten: "0c0c0c0c-0000-4000-8000-000000000099" });
        expect(karte.ein).not.toHaveBeenCalled();
        expect(neu.meldung.value).toEqual({ art: "ladefehler" });
        await neu.starte({ knoten: GARETH });
        expect(neu.abbrechen()).toBe(true);
        expect(neu.laufend.value).toBeUndefined();
        expect(neu.abbrechen()).toBe(false);
    });

    it("🔴 ohne Nodix an der Stelle: kein Anfang, der erste Klick auf einen Nodix setzt ihn, ↶ nimmt ihn zurück; die Leiste folgt", async () => {
        const { neu, modus, eingabe } = aufbau(QUITTUNG);
        await neu.starte({ bei: { x: 0, y: 0 } });
        expect(eingabe().anfang).toBeUndefined();
        expect(neu.laufend.value).toMatchObject({ phase: "bereit", offen: true });
        modus.entwurf.mockReturnValue({ punkte: [{ at: zielVon(PUNIN).at, ziel: zielVon(PUNIN) }] } as never);
        eingabe().stand({ punkte: 1, abschnitte: 0, zurueck: true, wieder: false, fertig: "zuWenig" });
        expect(neu.laufend.value).toMatchObject({ von: "Punin" });
        expect(neu.laufend.value?.offen).toBeUndefined();
        eingabe().stand({ punkte: 0, abschnitte: 0, zurueck: false, wieder: true, fertig: "zuWenig" });
        expect(neu.laufend.value).toMatchObject({ von: "", offen: true });
    });

    it("🔴 an der Stelle des Menüs: der Nodix im Fangradius dort wird der Anfang", async () => {
        const { neu, karte, eingabe } = aufbau(QUITTUNG);
        const naechster = vi.fn(() => zielVon(PUNIN));
        Object.assign(karte, { naechster });
        await neu.starte({ bei: { x: 600, y: 520 } });
        expect(naechster).toHaveBeenCalledWith({ x: 600, y: 520 }, expect.any(Array), 12);
        expect(eingabe().anfang?.ziel?.objekt).toBe(PUNIN);
        expect(neu.laufend.value).toMatchObject({ phase: "bereit", von: "Punin" });
    });

    it("🔴 aus der Ansicht Standard: stellt auf die Kraftlinien; Esc stellt die vorige zurück, nach dem Speichern bleibt sie", async () => {
        const { neu, karte, eingabe, ende } = aufbau(QUITTUNG);
        const ansicht = { zurueck: vi.fn(), bleib: vi.fn() };
        const zuKraftlinien = vi.fn(() => ansicht);
        Object.assign(karte, { zuKraftlinien });
        await neu.starte({ wechsel: true });
        expect(zuKraftlinien).toHaveBeenCalledOnce();
        expect(neu.abbrechen()).toBe(true);
        expect(ansicht.zurueck).toHaveBeenCalledOnce();
        expect(ansicht.bleib).not.toHaveBeenCalled();

        await neu.starte({ knoten: GARETH, wechsel: true });
        eingabe().fertig([ende(GARETH), ende(PUNIN)]);
        await vi.waitFor(() => expect(neu.laufend.value).toBeUndefined());
        expect(ansicht.bleib).toHaveBeenCalledOnce();
        expect(ansicht.zurueck).toHaveBeenCalledOnce();
    });
});

describe("Neuer Kraftlinienpunkt (nodix.create)", () => {
    it("🔴 setzt EINE Operation an der Stelle, zeichnet danach neu und meldet; ein zweiter Auftrag währenddessen tut nichts", async () => {
        let antworte: (a: Antwort<NodixCreateReceipt>) => void = () => undefined;
        const setzePunkt = vi.fn(
            () =>
                new Promise<Antwort<NodixCreateReceipt>>((fertig) => {
                    antworte = fertig;
                }),
        );
        const geaendert = vi.fn();
        const melde = vi.fn();
        const punkt = createKraftlinienpunktSetzen({
            daten: { setzePunkt },
            geaendert,
            melde,
            neueKennung: () => "0c0c0c0c-0000-4000-8000-0000000000fe",
        });
        const erster = punkt.setze({ x: 512, y: 640 });
        expect(await punkt.setze({ x: 1, y: 1 })).toBe(false);
        antworte({ ok: true, quittung: { mapRevision: 88 } as NodixCreateReceipt });
        expect(await erster).toBe(true);
        expect(setzePunkt).toHaveBeenCalledExactlyOnceWith({
            operationId: "0c0c0c0c-0000-4000-8000-0000000000fe",
            x: 512,
            y: 640,
        });
        expect(geaendert).toHaveBeenCalledWith(88);
        expect(melde).toHaveBeenCalledWith(expect.any(String), "success");
    });

    it("abgelehnt: der Satz des Servers als Warnung, die Karte bleibt", async () => {
        const geaendert = vi.fn();
        const melde = vi.fn();
        const punkt = createKraftlinienpunktSetzen({
            daten: {
                setzePunkt: async () => ({
                    ok: false,
                    status: 400,
                    fehler: { code: "validation_failed", message: "Der Punkt liegt außerhalb der Karte." },
                }),
            },
            geaendert,
            melde,
        });
        expect(await punkt.setze({ x: -1, y: -1 })).toBe(false);
        expect(melde).toHaveBeenCalledWith("Der Punkt liegt außerhalb der Karte.", "warning");
        expect(geaendert).not.toHaveBeenCalled();
    });
});

describe("Kraftlinienpunkt entfernen (K10, EDIT-0003 T52)", () => {
    it("🔴 schreibt EINE Operation gegen die Revision, die die Nodices nennen; ein fehlender Punkt schreibt nichts", async () => {
        const nodices = vi.fn(async () => ({
            targets: [
                ...NODICES.targets.filter((z) => z.id !== PUNKT),
                { id: PUNKT, kind: "nodix" as const, x: 1, y: 2, revision: 7 },
            ],
        }));
        const entfernePunkt = vi.fn(async () => ({
            ok: true as const,
            quittung: { mapRevision: 91 } as OperationReceipt,
        }));
        const geaendert = vi.fn();
        const melde = vi.fn();
        const weg = createKraftlinienpunktEntfernen({
            daten: { nodices, entfernePunkt },
            geaendert,
            melde,
            neueKennung: () => "0c0c0c0c-0000-4000-8000-0000000000fd",
        });
        expect(await weg.entferne(PUNKT)).toBe(true);
        expect(entfernePunkt).toHaveBeenCalledExactlyOnceWith(PUNKT, {
            operationId: "0c0c0c0c-0000-4000-8000-0000000000fd",
            baseRevision: 7,
        });
        expect(geaendert).toHaveBeenCalledWith(91);
        expect(melde).toHaveBeenCalledWith("✓ Kraftlinienpunkt entfernt.", "success");
        // Ein Ort ist kein Kraftlinienpunkt, und einen verschwundenen gibt es nicht mehr.
        expect(await weg.entferne(GARETH)).toBe(false);
        expect(entfernePunkt).toHaveBeenCalledTimes(1);
        expect(melde).toHaveBeenLastCalledWith("Diesen Kraftlinienpunkt gibt es nicht mehr.", "warning");
    });
});
