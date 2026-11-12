import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    PHOTOBOX_AKTIONEN,
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_SUBMISSION_STATES,
    photoboxAktionErlaubt,
    type PhotoboxStatus,
    type PhotoboxSubmissionState,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import { de } from "../src/i18n/de.ts";
import {
    FEHLER_SATZ,
    aktionFehlerSatz,
    fehlerArt,
    ladeFehlerSatz,
    type PhotoboxFehlerArt,
} from "../src/photobox/api.ts";
import {
    erzeugeStatusAbfrage,
    type StatusAbfrage,
    type StatusAbfrageUmfeld,
    type VorschauZustand,
} from "../src/photobox/status-abfrage.ts";
import {
    VORSCHAU_TAKT,
    ZUSTAND_SATZ,
    ZUSTAND_TEXT,
    erreichteSchritte,
    knoepfeFuer,
    naechsterSchritt,
    standWorte,
    zustandTon,
} from "../src/photobox/status-modell.ts";

/**
 * Die Statusseite `/reisebild#…` ohne Browser (WI-0272 S2b, Aufgabe 14; WI §5.2): die Knöpfe je Zustand nach der Tafel `photoboxAktionErlaubt`, der Stand in Worten, der Takt der Vorschau und der Satz für ein
 * 404. Die Seite im Browser prüft `e2e/reisebild-einreichen.spec.ts`; der Einstieg über die Adresse steht in `auth-einstieg.test.ts`.
 */

const stand = (zustand: PhotoboxSubmissionState, teil: Partial<PhotoboxStatus> = {}): PhotoboxStatus => ({
    zustand,
    eingereichtAm: "2026-10-31T10:00:00.000Z",
    beschreibung: "Der Markt am Morgen.",
    entstehung: "photo",
    nutzung: "avesmaps_only",
    lage: { x: 560, y: 540 },
    vorschauBereit: true,
    angepasst: false,
    ...teil,
});

describe("🔴 die Knöpfe je Zustand entsprechen der Tafel", () => {
    it("für JEDEN Zustand steht jeder Knopf genau dann da, wenn `photoboxAktionErlaubt` es sagt", () => {
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            const knoepfe = knoepfeFuer(stand(zustand));
            expect(knoepfe.beschreibung, zustand).toBe(photoboxAktionErlaubt(zustand, "beschreibung"));
            expect(knoepfe.bild, zustand).toBe(photoboxAktionErlaubt(zustand, "bild"));
            expect(knoepfe.zurueckziehen, zustand).toBe(photoboxAktionErlaubt(zustand, "zurueckziehen"));
            expect(knoepfe.offline, zustand).toBe(photoboxAktionErlaubt(zustand, "offline"));
        }
    });

    it("vor der Freigabe: Beschreibung, Bild und Zurückziehen, aber nicht offline", () => {
        for (const zustand of ["incoming", "pending", "changes_requested"] as const) {
            expect(knoepfeFuer(stand(zustand)), zustand).toMatchObject({
                beschreibung: true,
                bild: true,
                zurueckziehen: true,
                offline: false,
                neuesBild: false,
            });
        }
    });

    it("nach der Freigabe: Beschreibung (sie wartet auf Prüfung) und Sofort offline nehmen, nicht ersetzen und nicht zurückziehen", () => {
        expect(knoepfeFuer(stand("approved"))).toMatchObject({
            beschreibung: true,
            bild: false,
            zurueckziehen: false,
            offline: true,
            neuesBild: false,
        });
    });

    it("technisch gescheitert: ein anderes Bild schicken oder zurückziehen, sonst nichts (WI-0272 S3)", () => {
        expect(knoepfeFuer(stand("technical_failed"))).toMatchObject({
            beschreibung: false,
            bild: true,
            zurueckziehen: true,
            offline: false,
            nutzungCcBy: false,
            nutzungNurAvesmaps: false,
            neuesBild: false,
        });
    });

    it("wo der Weg zu Ende ist, gibt es keinen Übergang mehr, nur „Neues Bild von dieser Stelle“", () => {
        for (const zustand of ["rejected", "withdrawn", "offline", "expired", "purged"] as const) {
            const knoepfe = knoepfeFuer(stand(zustand));
            expect(knoepfe, zustand).toMatchObject({
                beschreibung: false,
                bild: false,
                zurueckziehen: false,
                offline: false,
                nutzungCcBy: false,
                nutzungNurAvesmaps: false,
                neuesBild: true,
            });
        }
    });

    it("„Auf der Karte zeigen“ steht in jedem Zustand", () => {
        for (const zustand of PHOTOBOX_SUBMISSION_STATES)
            expect(knoepfeFuer(stand(zustand)).zeigen, zustand).toBe(true);
    });

    it("🔴 die Lizenzwahl: vor der Freigabe in beide Richtungen, danach nur zu CC BY, nie bei einer Avesmaps-Aufnahme", () => {
        expect(knoepfeFuer(stand("pending", { nutzung: "avesmaps_only" }))).toMatchObject({
            nutzungCcBy: true,
            nutzungNurAvesmaps: false,
        });
        expect(knoepfeFuer(stand("pending", { nutzung: "cc-by-4.0" }))).toMatchObject({
            nutzungCcBy: false,
            nutzungNurAvesmaps: true,
        });
        // Nach der Freigabe nur noch hin zu CC BY; zurück geht nicht (wer das will, nimmt das Bild offline).
        expect(knoepfeFuer(stand("approved", { nutzung: "avesmaps_only" }))).toMatchObject({
            nutzungCcBy: true,
            nutzungNurAvesmaps: false,
        });
        expect(knoepfeFuer(stand("approved", { nutzung: "cc-by-4.0" }))).toMatchObject({
            nutzungCcBy: false,
            nutzungNurAvesmaps: false,
        });
        // Eine Avesmaps-Aufnahme bleibt „nur für Avesmaps“.
        for (const zustand of ["pending", "approved"] as const) {
            expect(knoepfeFuer(stand(zustand, { entstehung: "avesmaps_capture" })).nutzungCcBy, zustand).toBe(false);
        }
        for (const art of PHOTOBOX_CREATION_KINDS) {
            if (art === "avesmaps_capture") continue;
            expect(knoepfeFuer(stand("pending", { entstehung: art })).nutzungCcBy, art).toBe(true);
        }
    });

    it("die Aktionen der Tafel sind die fünf der Seite", () => {
        expect(PHOTOBOX_AKTIONEN).toEqual(["beschreibung", "bild", "zurueckziehen", "offline", "nutzung"]);
    });
});

describe("der Stand in Worten", () => {
    it("jeder Zustand hat seine Pille und seinen Satz in der deutschen Tafel", () => {
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            expect(de[ZUSTAND_TEXT[zustand]], zustand).toMatch(/\S/u);
            expect(de[ZUSTAND_SATZ[zustand]], zustand).toMatch(/\S/u);
        }
    });

    it("die Töne: veröffentlicht grün, Rückfrage und Prüffehler gelb, das Ende des Weges rot, der Rest neutral", () => {
        expect(zustandTon("approved")).toBe("erfolg");
        expect(zustandTon("changes_requested")).toBe("warnung");
        expect(zustandTon("incoming")).toBe("neutral");
        expect(zustandTon("pending")).toBe("neutral");
        for (const zustand of ["rejected", "withdrawn", "offline", "expired"] as const)
            expect(zustandTon(zustand)).toBe("gefahr");
    });

    it("die Leiste „Eingereicht · In Prüfung · Veröffentlicht“ zeigt zwei Schritte vor der Freigabe, drei danach, am Ende des Weges nichts", () => {
        expect(erreichteSchritte("incoming")).toBe(2);
        expect(erreichteSchritte("pending")).toBe(2);
        expect(erreichteSchritte("changes_requested")).toBe(2);
        expect(erreichteSchritte("approved")).toBe(3);
        for (const zustand of ["rejected", "withdrawn", "offline", "expired", "technical_failed"] as const) {
            expect(erreichteSchritte(zustand)).toBeUndefined();
        }
    });

    it("🔴 die Sätze nennen die Fristen des freigegebenen Textes (30 Tage nach Ablehnung, Zurückziehen und Offline-Nehmen)", () => {
        expect(de["photobox.status.text.rejected"]).toContain("30 Tagen");
        expect(de["photobox.status.text.withdrawn"]).toContain("30 Tagen");
        expect(de["photobox.status.text.offline"]).toMatch(/Rückgängig machen lässt sich das nicht/u);
    });
});

describe("die Vorschau: wann sie geholt und wann nachgefragt wird (die reine Entscheidung)", () => {
    it("der Takt steht an einer Stelle: alle 15 Sekunden, höchstens achtmal", () => {
        expect(VORSCHAU_TAKT).toEqual({ abstandMs: 15_000, hoechstens: 8 });
    });

    it("ist die Vorschau bereit, wird sie geholt; sonst wird gewartet, bis die Wiederholungen aufgebraucht sind", () => {
        expect(naechsterSchritt(true, 0)).toBe("holen");
        expect(naechsterSchritt(true, 8)).toBe("holen");
        expect(naechsterSchritt(false, 0)).toBe("warten");
        expect(naechsterSchritt(false, 7)).toBe("warten");
        expect(naechsterSchritt(false, 8)).toBe("aufgeben");
        expect(naechsterSchritt(false, 20)).toBe("aufgeben");
    });
});

/**
 * 🔴 Die echte Abfrageschleife der Statusseite (`status-abfrage.ts`), mit falscher Uhr (Review S2b I5). Die Zusage hängt an der Lesegrenze von 120 Aufrufen je Stunde und Adresse: Fehlt die Vorschau, fragt die Seite
 * `/status` einmal beim Öffnen und danach alle 15 Sekunden, höchstens achtmal, dann bietet sie „Neu laden“ an und fragt nicht mehr.
 */
describe("🔴 die Abfrageschleife: alle 15 Sekunden, höchstens achtmal, dann „Neu laden“", () => {
    const SCHLUESSEL = "A".repeat(43);

    type LeseStatus = (schluessel: string) => Promise<PhotoboxStatus>;
    type LadeVorschau = (schluessel: string) => Promise<Blob | "fehlt">;

    interface Versuchsaufbau {
        readonly abfrage: StatusAbfrage;
        readonly leseStatus: ReturnType<typeof vi.fn<LeseStatus>>;
        readonly ladeVorschau: ReturnType<typeof vi.fn<LadeVorschau>>;
        readonly ereignisse: {
            stand: PhotoboxStatus[];
            vorschau: Blob[];
            vorschauWeg: number;
            zustand: VorschauZustand[];
            nichtGefunden: number;
            ladefehler: { art: PhotoboxFehlerArt; hatStand: boolean }[];
        };
        letzterZustand(): VorschauZustand | undefined;
    }

    function aufbau(
        teil: { leseStatus?: LeseStatus; ladeVorschau?: LadeVorschau } = {},
        schluessel: string | null = SCHLUESSEL,
    ): Versuchsaufbau {
        const leseStatus = vi.fn<LeseStatus>(
            teil.leseStatus ?? (() => Promise.resolve(stand("pending", { vorschauBereit: false }))),
        );
        const ladeVorschau = vi.fn<LadeVorschau>(teil.ladeVorschau ?? (() => Promise.resolve(new Blob(["x"]))));
        const ereignisse: Versuchsaufbau["ereignisse"] = {
            stand: [],
            vorschau: [],
            vorschauWeg: 0,
            zustand: [],
            nichtGefunden: 0,
            ladefehler: [],
        };
        const umfeld: StatusAbfrageUmfeld = { schluessel: () => schluessel, leseStatus, ladeVorschau, fehlerArt };
        const abfrage = erzeugeStatusAbfrage(umfeld, {
            stand: (neu) => ereignisse.stand.push(neu),
            vorschau: (bild) => ereignisse.vorschau.push(bild),
            vorschauWeg: () => {
                ereignisse.vorschauWeg += 1;
            },
            vorschauZustand: (neu) => ereignisse.zustand.push(neu),
            nichtGefunden: () => {
                ereignisse.nichtGefunden += 1;
            },
            ladefehler: (_fehler, art, hatStand) => ereignisse.ladefehler.push({ art, hatStand }),
        });
        return { abfrage, leseStatus, ladeVorschau, ereignisse, letzterZustand: () => ereignisse.zustand.at(-1) };
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const TAKT = VORSCHAU_TAKT.abstandMs;

    it("fehlt die Vorschau: einmal beim Öffnen, danach alle 15 s, höchstens 8-mal (9 Aufrufe), dann „Neu laden“ und Ruhe", async () => {
        const v = aufbau();
        await v.abfrage.ladeStatus(true);
        expect(v.leseStatus).toHaveBeenCalledTimes(1);
        expect(v.leseStatus).toHaveBeenCalledWith(SCHLUESSEL);
        expect(v.letzterZustand()).toBe("rechnet");

        for (let runde = 1; runde <= VORSCHAU_TAKT.hoechstens; runde += 1) {
            // Vor Ablauf des Takts fragt niemand, mit dem Takt genau einmal.
            await vi.advanceTimersByTimeAsync(TAKT - 1);
            expect(v.leseStatus, `vor Runde ${runde}`).toHaveBeenCalledTimes(runde);
            await vi.advanceTimersByTimeAsync(1);
            expect(v.leseStatus, `Runde ${runde}`).toHaveBeenCalledTimes(runde + 1);
        }
        expect(v.leseStatus).toHaveBeenCalledTimes(1 + VORSCHAU_TAKT.hoechstens);
        expect(v.letzterZustand()).toBe("aufgegeben");

        // Danach fragt die Seite von allein nicht mehr, auch nach Stunden nicht.
        await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(1 + VORSCHAU_TAKT.hoechstens);
        // Eine Vorschau wurde nie verlangt: Der Stand sagte „nicht bereit“.
        expect(v.ladeVorschau).not.toHaveBeenCalled();
    });

    it("🔴 in Quarantäne (vorschauGesperrt): sofort „gesperrt“, keine Nachfrage, keine Vorschau, auch nach Stunden nicht; „Neu laden“ fragt einmal", async () => {
        const v = aufbau({
            leseStatus: () => Promise.resolve(stand("approved", { vorschauBereit: false, vorschauGesperrt: true })),
        });
        await v.abfrage.ladeStatus(true);
        expect(v.letzterZustand()).toBe("gesperrt");
        expect(v.ereignisse.zustand).not.toContain("rechnet");
        await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(1);
        expect(v.ladeVorschau).not.toHaveBeenCalled();
        await v.abfrage.ladeStatus(true);
        expect(v.leseStatus).toHaveBeenCalledTimes(2);
        expect(v.letzterZustand()).toBe("gesperrt");
    });

    it("🔴 endgültig gelöscht (bildEntfernt, WI-0272): sofort „entfernt“, keine Nachfrage, keine Vorschau", async () => {
        const v = aufbau({
            leseStatus: () => Promise.resolve(stand("approved", { vorschauBereit: false, bildEntfernt: true })),
        });
        await v.abfrage.ladeStatus(true);
        expect(v.letzterZustand()).toBe("entfernt");
        expect(v.ereignisse.zustand).not.toContain("rechnet");
        await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(1);
        expect(v.ladeVorschau).not.toHaveBeenCalled();
    });

    it("🔴 über die Lesegrenze: ein Öffnen kostet höchstens 9 Aufrufe von /status, mit „Neu laden“ von Hand 9 weitere, nie mehr in einer Runde", async () => {
        const v = aufbau();
        await v.abfrage.ladeStatus(true);
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(9);
        // „Neu laden“ beginnt die Wiederholungen von vorn und ist selbst der erste Aufruf der neuen Runde.
        await v.abfrage.ladeStatus(true);
        expect(v.leseStatus).toHaveBeenCalledTimes(10);
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(18);
        expect(v.letzterZustand()).toBe("aufgegeben");
        // 18 Aufrufe von /status in zwei Runden: weit unter 120 je Stunde.
        expect(v.leseStatus.mock.calls.length).toBeLessThan(120);
    });

    it("🔴 „Neu laden“ mitten in der Kette ersetzt sie: nie zwei Ketten, nie zwei Aufrufe im selben Takt", async () => {
        const v = aufbau();
        await v.abfrage.ladeStatus(true);
        await vi.advanceTimersByTimeAsync(7_000);
        await v.abfrage.ladeStatus(true);
        expect(v.leseStatus).toHaveBeenCalledTimes(2);
        // Der alte Zeitgeber ist gelöscht: Nach 15 s ab dem Neu-Laden kommt genau ein Aufruf, nicht zwei.
        await vi.advanceTimersByTimeAsync(TAKT);
        expect(v.leseStatus).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(TAKT);
        expect(v.leseStatus).toHaveBeenCalledTimes(4);
    });

    it("ist die Vorschau bereit, wird sie einmal geholt und es wird nicht weiter gefragt", async () => {
        const v = aufbau({ leseStatus: () => Promise.resolve(stand("pending")) });
        await v.abfrage.ladeStatus(true);
        expect(v.ladeVorschau).toHaveBeenCalledTimes(1);
        expect(v.ereignisse.vorschau).toHaveLength(1);
        expect(v.letzterZustand()).toBe("da");
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(1);
        expect(v.ladeVorschau).toHaveBeenCalledTimes(1);
    });

    it("sagt der Stand „bereit“, die Datei fehlt aber noch, wird wie bei „nicht bereit“ in 15 s nachgefragt, und dann geholt", async () => {
        const v = aufbau({
            leseStatus: () => Promise.resolve(stand("pending")),
            ladeVorschau: vi
                .fn<LadeVorschau>()
                .mockResolvedValueOnce("fehlt")
                .mockResolvedValue(new Blob(["x"])),
        });
        await v.abfrage.ladeStatus(true);
        expect(v.letzterZustand()).toBe("rechnet");
        expect(v.ereignisse.vorschau).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(TAKT);
        expect(v.leseStatus).toHaveBeenCalledTimes(2);
        expect(v.ereignisse.vorschau).toHaveLength(1);
        expect(v.letzterZustand()).toBe("da");
    });

    it("🔴 Schließen (stoppe) beendet die Anfragen, auch eine, die gerade unterwegs ist", async () => {
        const v = aufbau();
        await v.abfrage.ladeStatus(true);
        v.abfrage.stoppe();
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(1);

        // Eine späte Antwort nach dem Schließen wird verworfen: kein Stand, kein neuer Zeitgeber.
        let antworte: (status: PhotoboxStatus) => void = () => undefined;
        const spaet = aufbau({
            leseStatus: () =>
                new Promise<PhotoboxStatus>((fertig) => {
                    antworte = fertig;
                }),
        });
        const laeuft = spaet.abfrage.ladeStatus(true);
        spaet.abfrage.stoppe();
        antworte(stand("pending", { vorschauBereit: false }));
        await laeuft;
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(spaet.ereignisse.stand).toHaveLength(0);
        expect(spaet.leseStatus).toHaveBeenCalledTimes(1);
    });

    it("🔴 scheitert eine Nachfrage an der Lesegrenze (429), endet die Kette; die Seite erfährt, dass ein Stand da war", async () => {
        const v = aufbau({
            leseStatus: vi
                .fn<LeseStatus>()
                .mockResolvedValueOnce(stand("pending", { vorschauBereit: false }))
                .mockRejectedValue(new ApiFailure(429, "photobox_rate", "x")),
        });
        await v.abfrage.ladeStatus(true);
        await vi.advanceTimersByTimeAsync(TAKT);
        expect(v.leseStatus).toHaveBeenCalledTimes(2);
        expect(v.ereignisse.ladefehler).toEqual([{ art: "zu_viele", hatStand: true }]);
        // Die Nachfrage endet und „Neu laden“ steht bereit, statt bei „wird gerechnet“ ohne Zeitgeber stehen zu bleiben.
        expect(v.letzterZustand()).toBe("aufgegeben");
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(2);
    });

    it("🔴 „Neu laden“ meldet einen Fehler auch dann, wenn schon ein Stand da ist; ohne Stand meldet es, dass keiner da ist", async () => {
        const v = aufbau({
            leseStatus: vi
                .fn<LeseStatus>()
                .mockRejectedValueOnce(new ApiFailure(0, "network", "x"))
                .mockResolvedValueOnce(stand("pending"))
                .mockRejectedValue(new ApiFailure(500, "internal_error", "x")),
        });
        await v.abfrage.ladeStatus(true);
        expect(v.ereignisse.ladefehler).toEqual([{ art: "netz", hatStand: false }]);
        await v.abfrage.ladeStatus(true);
        expect(v.ereignisse.stand).toHaveLength(1);
        await v.abfrage.ladeStatus(true);
        expect(v.ereignisse.ladefehler.at(-1)).toEqual({ art: "sonst", hatStand: true });
        expect(v.ereignisse.stand).toHaveLength(1);
    });

    it("ein 404 beim Lesen heißt „gibt es nicht (mehr)“ und beendet alles; ohne Schlüssel wird gar nicht erst gefragt", async () => {
        const v = aufbau({ leseStatus: () => Promise.reject(new ApiFailure(404, "photobox_not_found", "x")) });
        await v.abfrage.ladeStatus(true);
        expect(v.ereignisse.nichtGefunden).toBe(1);
        expect(v.ereignisse.ladefehler).toEqual([]);
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(v.leseStatus).toHaveBeenCalledTimes(1);

        const ohne = aufbau({}, null);
        await ohne.abfrage.ladeStatus(true);
        expect(ohne.leseStatus).not.toHaveBeenCalled();
        expect(ohne.ereignisse.nichtGefunden).toBe(1);
    });

    it("ein Stand aus einer Aktion ohne bereite Vorschau (Bild ersetzt) gibt die alte frei und beginnt die Nachfrage von vorn", async () => {
        const v = aufbau({ leseStatus: () => Promise.resolve(stand("pending", { vorschauBereit: false })) });
        await v.abfrage.ladeStatus(true);
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(v.letzterZustand()).toBe("aufgegeben");
        const aufrufe = v.leseStatus.mock.calls.length;

        v.abfrage.uebernimm(stand("incoming", { vorschauBereit: false }));
        expect(v.ereignisse.vorschauWeg).toBe(1);
        expect(v.letzterZustand()).toBe("rechnet");
        await vi.advanceTimersByTimeAsync(TAKT);
        expect(v.leseStatus.mock.calls.length).toBe(aufrufe + 1);
    });
});

describe("🔴 die Sätze der Statusseite zu einem Fehler: eigene, passende Texte, nie ein roher Platzhalter (Review S2b I2)", () => {
    const ARTEN: readonly PhotoboxFehlerArt[] = [
        "netz",
        "zu_viele",
        "pausiert",
        "nicht_gefunden",
        "uebergang",
        "zu_oft_ersetzt",
        "schluessel_belegt",
        "format",
        "ungueltig",
        "sonst",
    ];
    const platzhalter = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/gu)].map((treffer) => treffer[1]!);
    const jetzt = new Date("2026-11-01T10:00:00.000Z");

    it("🔴 beim Lesen: die Lesegrenze hat ihren eigenen Satz („Abrufe“, nicht „Einreichungen“), alles Übrige den des Ladefehlers, keiner mit Platzhalter", () => {
        expect(de[ladeFehlerSatz("zu_viele")]).toBe("Gerade zu viele Abrufe. In etwa einer Stunde geht es wieder.");
        expect(de[ladeFehlerSatz("zu_viele")]).not.toMatch(/Einreichung/u);
        for (const art of ARTEN.filter((a) => a !== "zu_viele")) {
            expect(ladeFehlerSatz(art), art).toBe("photobox.status.ladefehler");
        }
        for (const art of ARTEN) expect(platzhalter(de[ladeFehlerSatz(art)]), art).toEqual([]);
    });

    it("🔴 bei einer Aktion: die Drossel nennt die Uhrzeit des Servers, fehlt sie, gilt eine Stunde; in keinem Fall bleibt {uhr} stehen", () => {
        const uhrzeit = (bis: Date): string => bis.toISOString();
        const mit = aktionFehlerSatz("zu_viele", new Date("2026-11-01T10:30:00.000Z"), uhrzeit, jetzt);
        expect(mit).toEqual({ key: FEHLER_SATZ.zu_viele, params: { uhr: "2026-11-01T10:30:00.000Z" } });
        const ohne = aktionFehlerSatz("zu_viele", undefined, uhrzeit, jetzt);
        expect(ohne.params).toEqual({ uhr: "2026-11-01T11:00:00.000Z" });
        for (const art of ARTEN) {
            const satz = aktionFehlerSatz(art, undefined, uhrzeit, jetzt);
            for (const name of platzhalter(de[satz.key])) {
                expect(satz.params?.[name], `${art}: {${name}}`).toBeDefined();
            }
        }
    });

    it("die Seite nutzt diese Sätze und zeigt einen Fehler beim Neu-Laden auch mit gezeigtem Stand", () => {
        const fenster = readFileSync(
            join(
                resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "photobox"),
                "reisebild-status-fenster.vue",
            ),
            "utf8",
        );
        expect(fenster).toContain("ladeFehlerSatz(art)");
        // WI-0291: `fehlerSatzFuer` ruft `aktionFehlerSatz` auf und setzt den genauen Grund des Servers davor.
        expect(fenster).toContain("fehlerSatzFuer(");
        expect(fenster).toContain("reisebild-status-neu-fehler");
        expect(fenster).not.toContain("FEHLER_SATZ[art]");
    });
});

describe("🔴 ein 404 zeigt den Satz des Servers aus Aufgabe 10", () => {
    it("`photobox_not_found` ist „nicht gefunden“ und der Satz heißt wie beim Server", () => {
        const art = fehlerArt(new ApiFailure(404, "photobox_not_found", "x"));
        expect(art).toBe("nicht_gefunden");
        expect(de[FEHLER_SATZ[art]]).toBe("Zu diesem Link gibt es kein Reisebild (mehr).");
    });

    it("die Seite wählt diesen Satz für „gibt es nicht“ (derselbe für nie gewesen, gelöscht und geleert) und trägt ihn auch ohne Schlüssel", () => {
        const fenster = readFileSync(
            join(
                resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "photobox"),
                "reisebild-status-fenster.vue",
            ),
            "utf8",
        );
        expect(fenster).toContain('art === "nicht_gefunden"');
        expect(fenster).toContain("photobox.status.fehlt");
        expect(fenster).toContain('props.schluessel === null ? { art: "fehlt" }');
    });
});

describe("die Seite hält die Zusagen, die der Browser nicht allein beweist", () => {
    const fenster = readFileSync(
        join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "photobox"), "reisebild-status-fenster.vue"),
        "utf8",
    );

    it("🔴 „Sofort offline nehmen“ und „Zurückziehen“ fragen einmal nach, im Fenster, nie in einem Browserdialog", () => {
        expect(fenster).toContain("AvmBestaetigung");
        expect(fenster).not.toMatch(/\b(confirm|alert|prompt)\(/u);
    });

    it("die Vorschau ist ein Blob und wird beim Schließen freigegeben", () => {
        expect(fenster).toContain("URL.createObjectURL");
        expect(fenster).toContain("URL.revokeObjectURL");
        expect(fenster).toContain("onBeforeUnmount");
    });

    it("der Schlüssel bleibt im Speicher dieser Seite: nie in einer Adresse, nie im Speicher des Browsers", () => {
        expect(fenster).not.toMatch(/localStorage|sessionStorage|document\.cookie/u);
        expect(fenster).not.toMatch(/location\.(href|search|hash)\s*=/u);
    });

    it("jede Aktion trägt eine Kennung, die ein erneutes Senden überlebt (ADR-0019)", () => {
        expect(fenster).toContain("newOperationId");
    });

    it("das Fenster ist ein Besucherfenster der Hülle: ohne Ablage, nur so hoch wie der Inhalt, am Telefon das Blatt", () => {
        expect(fenster).toContain("ohne-ablage");
        expect(fenster).toContain('hoehe="inhalt"');
        expect(fenster).toContain("telefon-blatt");
        expect(fenster).toContain(":vorgabe-ecke=");
    });
});

describe("🔴 das Bild ist endgültig gelöscht (bildEntfernt, WI-0272, Migration 0328)", () => {
    it("keine Aktion mehr, in keinem Zustand; „Auf der Karte zeigen“ und „Neues Bild von dieser Stelle“ bleiben", () => {
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            const knoepfe = knoepfeFuer(stand(zustand, { bildEntfernt: true, nutzung: "avesmaps_only" }));
            expect(knoepfe, zustand).toEqual({
                beschreibung: false,
                bild: false,
                zurueckziehen: false,
                offline: false,
                nutzungCcBy: false,
                nutzungNurAvesmaps: false,
                zeigen: true,
                neuesBild: true,
            });
        }
    });

    it("Pille „Entfernt“ und der Satz „Das Bild wurde entfernt.“ statt „Veröffentlicht“; ohne die Marke der Zustand wie bisher", () => {
        expect(standWorte(stand("approved", { bildEntfernt: true }))).toEqual({
            pille: "photobox.status.zustand.entfernt",
            satz: "photobox.status.text.entfernt",
            ton: "gefahr",
        });
        expect(de["photobox.status.zustand.entfernt"]).toBe("Entfernt");
        expect(de["photobox.status.text.entfernt"]).toBe("Das Bild wurde entfernt.");
        expect(standWorte(stand("approved"))).toEqual({
            pille: ZUSTAND_TEXT.approved,
            satz: ZUSTAND_SATZ.approved,
            ton: zustandTon("approved"),
        });
    });
});
