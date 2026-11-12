import { describe, expect, it } from "vitest";
import type { AdminKarteneinstellungen, FreigabeSicht, UmgebungenStand } from "@avesmaps3d/shared";
import { stationen } from "../src/freigabe/freigabe.ts";
import { createLokalEinstellungen, lokalEingabe } from "../src/freigabe/lokal-einstellungen.ts";

/**
 * Reiter „Umgebungen“, Stufe 2 (WI-0204 §10): die Stationen aus dem Live-Stand (`GET /api/admin/system/umgebungen`, WI-0180) und die
 * Einstellungen von Lokal (private Karteneinstellungen, WI-0180 §8).
 *
 * 🔴 Die Sätze, auf die es ankommt:
 * 1. Den laufenden Stand liefert die Route; die Statusdatei sagt nur, seit wann er läuft, und nur, wenn sie denselben Stand nennt.
 * 2. Auf Production gibt es keine Statusdatei: Dort tragen die Stationen allein die Route.
 * 3. Ein Wert auf seiner Vorgabe wird nicht gespeichert, sondern die Abweichung gelöscht; ein falscher Name gar nicht.
 */

const DATEI_SICHT: FreigabeSicht = {
    now: "2026-10-16T21:00:00.000Z",
    datei: {
        schema: 1,
        standAt: "2026-10-16T20:59:00.000Z",
        production: { release: "4850978", commit: "4850978".padEnd(40, "0"), seit: "2026-10-16T18:41:00.000Z" },
        stage: { release: "7a1c2e9", commit: "7a1c2e9".padEnd(40, "0"), seit: "2026-10-16T19:00:00.000Z" },
        stageGruen: true,
        stagePruefung: null,
        technik: { migrationen: [], rechte: [], umgebungswerte: [] },
        themen: [],
    },
    sperre: null,
    laeuft: null,
    frueher: [],
};

const ROUTE: UmgebungenStand = {
    eigene: { releaseId: "20261016T190012Z-7a1c2e9" },
    gegenseite: { releaseId: "20261016T181003Z-4850978", erreichbar: true },
    lokal: null,
};

describe("Umgebungen: die Stationen aus dem Live-Stand", () => {
    it("🔴 auf der Stage: Stand aus der Route, „seit“ aus der Datei, weil beide denselben Stand nennen", () => {
        const { stage, production } = stationen(DATEI_SICHT, ROUTE, "staging");
        expect(stage).toMatchObject({
            stand: "7a1c2e9",
            release: "20261016T190012Z-7a1c2e9",
            seit: "2026-10-16T19:00:00.000Z",
        });
        expect(stage.erreichbar).toBe(true);
        expect(production).toMatchObject({ stand: "4850978", seit: "2026-10-16T18:41:00.000Z", erreichbar: true });
        expect(production.gebaut).toBe("2026-10-16T18:10:03.000Z");
    });

    it("🔴 läuft inzwischen ein anderer Stand, gilt die Route, und „seit“ aus der Datei fällt weg", () => {
        const neu = { ...ROUTE, eigene: { releaseId: "20261016T210000Z-abcdef1" } };
        const { stage } = stationen(DATEI_SICHT, neu, "staging");
        expect(stage.stand).toBe("abcdef1");
        expect(stage.seit).toBeNull();
        expect(stage.gebaut).toBe("2026-10-16T21:00:00.000Z");
    });

    it("🔴 auf Production ohne Statusdatei: die eigene Umgebung ist Production, die Gegenseite die Stage", () => {
        const route: UmgebungenStand = {
            eigene: { releaseId: "20261016T181003Z-4850978" },
            gegenseite: { releaseId: null, erreichbar: false },
            lokal: null,
        };
        const { stage, production } = stationen({ ...DATEI_SICHT, datei: null }, route, "production");
        expect(production).toMatchObject({ stand: "4850978", erreichbar: true, seit: null });
        expect(stage).toMatchObject({ stand: null, release: null, erreichbar: false });
    });

    it("ohne Route (kein `switch_environment`) bleibt es bei der Datei, und erreichbar ist unbekannt", () => {
        const { stage } = stationen(DATEI_SICHT, null, "staging");
        expect(stage).toMatchObject({
            stand: "7a1c2e9",
            seit: "2026-10-16T19:00:00.000Z",
            erreichbar: null,
            gebaut: null,
        });
    });
});

describe("Umgebungen: die Einstellungen von Lokal", () => {
    it("🔴 ein Tailscale-Name wird klein und ohne Leerraum genommen; alles andere ist ein Satz, kein Wert", () => {
        expect(lokalEingabe("lokalName", "  Rechner.Tail0000.TS.net ")).toBe("rechner.tail0000.ts.net");
        expect(lokalEingabe("lokalName", "")).toBe("");
        expect(lokalEingabe("lokalName", "http://rechner")).toEqual({ key: "admin.umgebungen.lokal.nameFalsch" });
        expect(lokalEingabe("lokalPort", "8443")).toBe(8443);
        expect(lokalEingabe("lokalPort", "0")).toEqual({ key: "admin.umgebungen.lokal.portFalsch" });
        expect(lokalEingabe("lokalPort", "4,5")).toEqual({ key: "admin.umgebungen.lokal.portFalsch" });
        expect(lokalEingabe("lokalImMenue", "immer")).toBe("immer");
    });

    it("eine eingefügte Adresse gilt als ihr Name; ein Port darin bekommt seinen eigenen Satz", () => {
        expect(lokalEingabe("lokalName", "https://KombiCompy.tail0000.ts.net")).toBe("kombicompy.tail0000.ts.net");
        expect(lokalEingabe("lokalName", " http://rechner.tail0000.ts.net/ ")).toBe("rechner.tail0000.ts.net");
        expect(lokalEingabe("lokalName", "https://rechner.tail0000.ts.net:5174/")).toEqual({
            key: "admin.umgebungen.lokal.nameMitPort",
        });
        expect(lokalEingabe("lokalName", "rechner.tail0000.ts.net:")).toEqual({
            key: "admin.umgebungen.lokal.nameMitPort",
        });
        expect(lokalEingabe("lokalName", "https://rechner.tail0000.ts.net/pfad")).toEqual({
            key: "admin.umgebungen.lokal.nameFalsch",
        });
        expect(lokalEingabe("lokalName", "ftp://rechner.tail0000.ts.net")).toEqual({
            key: "admin.umgebungen.lokal.nameFalsch",
        });
    });

    it("🔴 liest nur die privaten Zeilen; ein Wert auf der Vorgabe löscht die Abweichung (value null)", async () => {
        const gesendet: Record<string, unknown>[] = [];
        let privat = [{ id: "lokalName", value: "rechner.tail0000.ts.net", changedAt: null, changedBy: null }];
        const stand = (): AdminKarteneinstellungen => ({
            now: "2026-10-16T21:00:00.000Z",
            revision: 7,
            source: "database",
            rows: [{ id: "startZoom", value: 3, changedAt: null, changedBy: null }],
            unknownKeys: [],
            privat,
        });
        const einstellungen = createLokalEinstellungen({
            fetcher: async (_url, init) => {
                if (init?.method === "POST") {
                    gesendet.push(JSON.parse(String(init.body)) as Record<string, unknown>);
                    privat = [];
                    return new Response(JSON.stringify({ operationId: "x", status: "applied" }), { status: 200 });
                }
                return new Response(JSON.stringify(stand()), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });
        await einstellungen.laden();
        expect(einstellungen.werte.value).toEqual({
            lokalName: "rechner.tail0000.ts.net",
            lokalPort: 443,
            lokalImMenue: "erreichbar",
        });
        expect(einstellungen.abweichend.value).toEqual({ lokalName: true, lokalPort: false, lokalImMenue: false });

        // Unverändert: nichts geschrieben. Falsch: nichts geschrieben, der Satz steht am Feld.
        expect(await einstellungen.setze("lokalPort", "443")).toBe(false);
        expect(await einstellungen.setze("lokalName", "kein name")).toBe(false);
        expect(einstellungen.probleme.value.lokalName).toEqual({ key: "admin.umgebungen.lokal.nameFalsch" });
        expect(gesendet).toEqual([]);

        // Leer ist die Vorgabe des Namens: Die Abweichung wird gelöscht, nicht „“ gespeichert.
        expect(await einstellungen.setze("lokalName", "")).toBe(true);
        expect(gesendet[0]).toMatchObject({ baseRevision: 7, id: "lokalName", value: null });
        expect(einstellungen.werte.value?.lokalName).toBe("");
    });
});
