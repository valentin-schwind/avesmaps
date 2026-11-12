import { afterEach, describe, expect, it } from "vitest";
import { WARTESCHLANGE_STAND_ALT_S } from "@avesmaps3d/shared";
import type { Queryable } from "../src/database.ts";
import {
    dirigentPlant,
    gemeinsameWarteschlange,
    pauseAnsicht,
    reiheZaehlen,
    wirksam,
    type EigeneAnweisung,
} from "../src/jobs/gemeinsame-reihe.ts";
import { positionen } from "../src/jobs/overview.ts";
import { createWarteschlangeStandLeser, type StandLage } from "../src/jobs/stand-datei.ts";
import { KEIN_UMSTAND, umstandMitStand, wartegrund } from "../src/jobs/wartegrund.ts";
import { dirigentKomponente } from "../src/system/systemzustand.ts";
import { auftrag, stand, standOrdner } from "./support/warteschlange-stand.ts";

/**
 * Der Stand der gemeinsamen Warteschlange in der App (WI-0163 §5.1, §1.6, §1.7), ohne Datenbank.
 *
 * **Problemfall.** Stage und Production haben je eine Tafel `job`; der Dirigent auf dem Host ordnet beide und schreibt, was er weiß,
 * als Datei. Ohne diese Datei sähe jede Umgebung nur sich selbst, und der Betreiber wäre wieder „uninformiert“.
 *
 * **Soll**, je Fall mit Namen:
 *
 * 1. Der Leser kennt fünf Lagen: nicht eingerichtet, fehlt, unlesbar, veraltet, ok; unbekannte Felder werden toleriert.
 * 2. Mit frischem Stand gilt dessen Grund je Auftrag und die WIRKSAME Pause; ohne Stand die Ableitung aus WI-0160.
 * 3. Die wirksame Pause ist die jüngste Anweisung: die eigene, eben geschaltete, schlägt einen älteren Stand.
 * 4. Aufträge der anderen Umgebung stehen ohne Person und ohne Kennung da; die Person einer Pause nur, wo geschaltet wurde.
 */

const ordner: Awaited<ReturnType<typeof standOrdner>>[] = [];
afterEach(async () => {
    for (const eintrag of ordner.splice(0)) await eintrag.weg();
});
async function neuerOrdner() {
    const eintrag = await standOrdner();
    ordner.push(eintrag);
    return eintrag;
}

const ok = (inhalt = stand()) => ({ zustand: "ok" as const, stand: inhalt }) satisfies StandLage;
/** Eine Datenbank, die nie gefragt werden darf: Wer sie fragt, hat den falschen Weg genommen. */
const KEINE_DB = (() => {
    throw new Error("die Datenbank darf hier nicht gefragt werden");
}) as unknown as Queryable;
const eigene = (teile: Partial<EigeneAnweisung> = {}): EigeneAnweisung => ({
    paused: false,
    since: null,
    by: null,
    byLabel: null,
    reason: null,
    changedAt: null,
    ...teile,
});

describe("Der Leser der Stand-Datei (WI-0163 §5.1)", () => {
    it("🔴 ohne Variable: nicht eingerichtet, und alles gilt wie bis WI-0163", async () => {
        const leser = createWarteschlangeStandLeser(undefined, "test");
        expect(leser.eingerichtet).toBe(false);
        expect(await leser.lage()).toEqual({ zustand: "nicht_eingerichtet" });
        expect(await createWarteschlangeStandLeser("", "test").lage()).toEqual({ zustand: "nicht_eingerichtet" });
    });

    it("🔴 Variable gesetzt, Datei fehlt: `fehlt` (Zustand unbekannt, nie „läuft“)", async () => {
        const { datei } = await neuerOrdner();
        const leser = createWarteschlangeStandLeser(datei, "test", { ttlMs: 0 });
        expect(leser.eingerichtet).toBe(true);
        expect(await leser.lage()).toEqual({ zustand: "fehlt", stand: null });
    });

    it("🔴 kaputtes JSON und falsche Form: `unlesbar`, mit EINER Warnung je Inhalt", async () => {
        const { datei, schreibe } = await neuerOrdner();
        const warnungen: string[] = [];
        const leser = createWarteschlangeStandLeser(datei, "test", {
            ttlMs: 0,
            warn: (zeile) => void warnungen.push(zeile),
        });
        await schreibe("{ kein json");
        expect(await leser.lage()).toEqual({ zustand: "unlesbar", stand: null });
        expect(await leser.lage()).toEqual({ zustand: "unlesbar", stand: null });
        expect(warnungen).toHaveLength(1);
        await schreibe({ ...stand(), schema: 2 });
        expect((await leser.lage()).zustand).toBe("unlesbar");
        await schreibe({ ...stand(), auftraege: [{ umgebung: "mars" }] });
        expect((await leser.lage()).zustand).toBe("unlesbar");
    });

    it("🔴 älter als 30 s: `veraltet` (der Dirigent meldet sich nicht); frisch: `ok`", async () => {
        const { datei, schreibe } = await neuerOrdner();
        const leser = createWarteschlangeStandLeser(datei, "test", { ttlMs: 0 });
        const jetzt = new Date("2026-10-15T03:12:00.000Z");
        const alt = new Date(jetzt.getTime() - (WARTESCHLANGE_STAND_ALT_S + 1) * 1000);
        await schreibe(stand({}, alt));
        expect(await leser.lage(jetzt)).toMatchObject({ zustand: "veraltet", stand: { at: alt.toISOString() } });
        await schreibe(stand({}, new Date(jetzt.getTime() - 5_000)));
        expect((await leser.lage(jetzt)).zustand).toBe("ok");
    });

    it("🔴 unbekannte Felder werden toleriert: ein neuerer Dirigent bricht einen älteren Leser nicht", async () => {
        const { datei, schreibe } = await neuerOrdner();
        const neu = {
            ...stand(),
            kuenftig: { irgendwas: true },
            dirigent: { ...stand().dirigent, speicher: 512 },
            auftraege: [{ ...auftrag("staging", { publicId: "a1" }), neuesFeld: "x" }],
        };
        await schreibe(neu);
        const lage = await createWarteschlangeStandLeser(datei, "test", { ttlMs: 0 }).lage();
        expect(lage.zustand).toBe("ok");
        expect(lage.zustand === "ok" ? lage.stand.auftraege[0]?.publicId : null).toBe("a1");
    });

    it("🔴 ein Wartegrund, den dieses Release nicht kennt, macht den Stand nicht unlesbar (Dirigent aus dem Stage-Stand)", async () => {
        const { datei, schreibe } = await neuerOrdner();
        await schreibe({
            ...stand(),
            auftraege: [{ ...auftrag("production", { publicId: "a2" }), wartegrund: "waits_kuenftig" }],
        });
        const lage = await createWarteschlangeStandLeser(datei, "test", { ttlMs: 0 }).lage();
        expect(lage.zustand).toBe("ok");
        expect(lage.zustand === "ok" ? lage.stand.auftraege[0]?.wartegrund : null).toBe("waits_kuenftig");
    });

    it("liest nur kurz zwischengespeichert: ein neuer Inhalt zählt nach der Frist", async () => {
        const { datei, schreibe } = await neuerOrdner();
        let uhr = 1_000;
        const leser = createWarteschlangeStandLeser(datei, "test", { ttlMs: 2_000, clock: () => uhr });
        await schreibe(stand({ pause: { ...stand().pause, paused: false } }));
        const erst = await leser.lage();
        await schreibe("kaputt");
        uhr += 1_000;
        expect((await leser.lage()).zustand).toBe(erst.zustand);
        uhr += 1_500;
        expect((await leser.lage()).zustand).toBe("unlesbar");
    });
});

describe("Der Wartegrund mit dem Stand des Dirigenten (WI-0163)", () => {
    const zeile = (publicId: string, waitReason: string | null = null) => ({
        kind: "legacy_zug",
        state: "QUEUED",
        waitReason,
        publicId,
    });
    const lage = ok(
        stand({
            auftraege: [
                auftrag("staging", { publicId: "s1", state: "RUNNING", platz: null, schwer: true }),
                auftrag("test", { publicId: "t1", platz: 1, wartegrund: "waits_slot" }),
                auftrag("test", { publicId: "t2", platz: 2, wartegrund: null }),
            ],
        }),
    );

    it("🔴 mit frischem Stand gilt dessen Grund je Auftrag, auch gegen einen geschriebenen", () => {
        const umstand = umstandMitStand(KEIN_UMSTAND, lage, "test");
        expect(wartegrund(zeile("t1", "waits_memory"), umstand)).toBe("waits_slot");
        // `null` im Stand heißt: als Nächstes dran. Der alte Grund des Planers gilt dann nicht mehr.
        expect(wartegrund(zeile("t2", "waits_pickup"), umstand)).toBeNull();
    });

    it("🔴 ohne Stand bleibt die Ableitung: `waits_pickup` und `waits_no_worker` sind dann wahr", () => {
        for (const ohne of [
            { zustand: "nicht_eingerichtet" as const },
            { zustand: "veraltet" as const, stand: stand() },
        ]) {
            const umstand = umstandMitStand({ ...KEIN_UMSTAND, pickupKinds: new Set(["legacy_zug"]) }, ohne, "test");
            expect(wartegrund(zeile("t1"), umstand)).toBe("waits_pickup");
            expect(wartegrund({ ...zeile("t1"), kind: "media_settle" }, umstand)).toBe("waits_no_worker");
        }
    });

    it("ein Auftrag, der noch nicht im Stand steht (eben eingereiht), nennt seinen geschriebenen Grund, sonst keinen", () => {
        const umstand = umstandMitStand(KEIN_UMSTAND, lage, "test");
        expect(wartegrund(zeile("neu", "waits_dependency"), umstand)).toBe("waits_dependency");
        expect(wartegrund(zeile("neu"), umstand)).toBeNull();
    });

    it("🔴 die WIRKSAME Pause übersteuert, auch wenn hier niemand pausiert hat", () => {
        const pausiert = ok(
            stand({
                pause: {
                    paused: true,
                    umgebung: "staging",
                    changedAt: "2026-10-15T03:12:00.000Z",
                    since: "2026-10-15T03:12:00.000Z",
                    by: "7e570000-0000-4000-8000-000000000001",
                    byLabel: null,
                    reason: "Datenbank wird gesichert",
                },
                auftraege: [auftrag("test", { publicId: "t1", wartegrund: "waits_slot" })],
            }),
        );
        expect(wartegrund(zeile("t1"), umstandMitStand(KEIN_UMSTAND, pausiert, "test"))).toBe("waits_queue_paused");
    });

    it("🔴 eine eben hier gegebene Anweisung ist jünger als der Stand: Sie gilt sofort", () => {
        const pausiertAufStage = ok(
            stand({
                pause: {
                    paused: true,
                    umgebung: "staging",
                    changedAt: "2026-10-15T03:12:00.000Z",
                    since: "2026-10-15T03:12:00.000Z",
                    by: null,
                    byLabel: "cli:claudio",
                    reason: "Sicherung",
                },
            }),
        );
        const fortHier = eigene({ paused: false, changedAt: new Date("2026-10-15T03:13:00.000Z") });
        expect(wirksam(pausiertAufStage, "test", fortHier)).toMatchObject({ paused: false, umgebung: "test" });
        expect(
            wartegrund(zeile("x"), umstandMitStand({ ...KEIN_UMSTAND, eigene: fortHier }, pausiertAufStage, "test")),
        ).toBeNull();
        // Eine ältere eigene Anweisung zählt nicht gegen die jüngere der Stage.
        const altHier = eigene({ paused: false, changedAt: new Date("2026-10-15T03:00:00.000Z") });
        expect(wirksam(pausiertAufStage, "test", altHier)).toMatchObject({ paused: true, umgebung: "staging" });
        // Ohne frischen Stand gibt es keine wirksame Pause über alle: Es gilt die eigene Zeile.
        expect(wirksam({ zustand: "fehlt", stand: null }, "test", altHier)).toBeUndefined();
    });
});

describe("Die gemeinsame Reihe in den Antworten (WI-0163 §1.7)", () => {
    const pause = {
        paused: true,
        umgebung: "staging" as const,
        changedAt: "2026-10-15T03:12:00.000Z",
        since: "2026-10-15T03:12:00.000Z",
        by: "7e570000-0000-4000-8000-000000000001",
        byLabel: null,
        reason: "Datenbank wird gesichert",
    };

    it("🔴 die Aufträge der anderen Umgebung stehen ohne Kennung da; die eigenen mit; die Pause übersteuert den Grund", () => {
        const lage = ok(
            stand({
                pause,
                auftraege: [
                    auftrag("staging", {
                        publicId: "fremd-1",
                        label: "Legacy-Zug: Wege",
                        state: "RUNNING",
                        platz: null,
                        progress: 0.4,
                    }),
                    auftrag("test", { publicId: "eigen-1", platz: 1, wartegrund: "waits_slot" }),
                    auftrag("staging", { publicId: "fremd-2", platz: 2, wartegrund: "waits_slot" }),
                ],
            }),
        );
        const antwort = gemeinsameWarteschlange(lage, "test", null);
        expect(antwort?.zustand).toBe("ok");
        expect(antwort?.reihe.map((eintrag) => [eintrag.umgebung, eintrag.eigen, eintrag.jobId])).toEqual([
            ["staging", false, null],
            ["test", true, "eigen-1"],
            ["staging", false, null],
        ]);
        expect(antwort?.reihe[0]).toMatchObject({ state: "RUNNING", platz: null, progress: 0.4, waitReason: null });
        expect(antwort?.reihe[2]).toMatchObject({ platz: 2, waitReason: "waits_queue_paused" });
        // 🔴 Keine Person, nirgends: Die Zeile kennt kein Feld dafür.
        for (const eintrag of antwort?.reihe ?? []) expect(Object.keys(eintrag)).not.toContain("by");
        expect(JSON.stringify(antwort)).not.toContain("7e570000");
        // Die eigene Sicht eines Editors: nur seine Aufträge.
        expect(gemeinsameWarteschlange(lage, "test", null, { nurEigene: new Set(["eigen-1"]) })?.reihe).toHaveLength(1);
        expect(reiheZaehlen(lage)).toEqual({ running: 1, queued: 2 });
    });

    it("🔴 ohne frischen Stand: der Zustand, keine Pause, keine Reihe; ohne Datei: kein Feld", () => {
        expect(gemeinsameWarteschlange({ zustand: "nicht_eingerichtet" }, "test", null)).toBeUndefined();
        expect(gemeinsameWarteschlange({ zustand: "veraltet", stand: stand() }, "test", null)).toMatchObject({
            zustand: "veraltet",
            pause: null,
            reihe: [],
        });
        expect(gemeinsameWarteschlange({ zustand: "fehlt", stand: null }, "test", null)).toMatchObject({
            zustand: "fehlt",
            stand: null,
        });
        expect(reiheZaehlen({ zustand: "unlesbar", stand: null })).toBeNull();
    });

    it("🔴 eine Pause aus der anderen Umgebung nennt die Umgebung, nie die Person; der Grund nur in der vollen Sicht", async () => {
        const lage = ok(stand({ pause }));
        expect(await pauseAnsicht(KEINE_DB, lage, "test", eigene(), { full: true })).toEqual({
            paused: true,
            since: pause.since,
            by: null,
            reason: "Datenbank wird gesichert",
            anderswo: "staging",
        });
        expect((await pauseAnsicht(KEINE_DB, lage, "test", eigene(), { full: false })).reason).toBeNull();
        // Hier geschaltet, an der Kommandozeile: das Etikett wie bisher, ohne Ort.
        const hier = ok(stand({ pause: { ...pause, umgebung: "test", by: null, byLabel: "cli:root" } }));
        expect(await pauseAnsicht(KEINE_DB, hier, "test", eigene(), { full: true })).toMatchObject({
            paused: true,
            by: "cli:root",
            anderswo: null,
        });
    });

    it("die Plätze der eigenen Aufträge kommen aus der gemeinsamen Reihe; Neue stehen dahinter", () => {
        expect([...positionen(["a", "b"], undefined)]).toEqual([
            ["a", 1],
            ["b", 2],
        ]);
        const plaetze = new Map<string, number | null>([
            ["a", 3],
            ["b", 1],
        ]);
        expect([...positionen(["a", "b", "neu"], plaetze)]).toEqual([
            ["a", 3],
            ["b", 1],
            ["neu", 4],
        ]);
    });
});

describe("Der Dirigent im Systemzustand und als Planer (WI-0163)", () => {
    it("🔴 frisch und plant diese Umgebung: aktiv; frisch, aber nicht hier: Warnung; alt oder fehlend: ausgefallen", () => {
        expect(dirigentPlant({ zustand: "nicht_eingerichtet" }, "test")).toBeUndefined();
        expect(dirigentPlant(ok(), "test")).toBe(true);
        expect(dirigentPlant(ok(), "production")).toBe(false);
        expect(dirigentPlant({ zustand: "veraltet", stand: stand() }, "test")).toBe(false);

        expect(dirigentKomponente(ok(), "test")).toMatchObject({ zustand: "gesund", hinweis: "dirigent_active" });
        expect(dirigentKomponente(ok(), "production")).toMatchObject({
            zustand: "warnung",
            hinweis: "dirigent_not_here",
        });
        expect(dirigentKomponente({ zustand: "veraltet", stand: stand() }, "test")).toMatchObject({
            zustand: "ausgefallen",
            hinweis: "dirigent_stale",
        });
        expect(dirigentKomponente({ zustand: "fehlt", stand: null }, "test")).toMatchObject({
            zustand: "ausgefallen",
            hinweis: "dirigent_missing",
        });
        expect(dirigentKomponente({ zustand: "unlesbar", stand: null }, "test")).toMatchObject({
            zustand: "unbekannt",
            hinweis: "dirigent_unreadable",
        });
    });
});
