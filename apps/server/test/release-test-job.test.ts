import { describe, expect, it } from "vitest";
import type { ReleaseTestLauf } from "@avesmaps3d/shared";
import { JobCancelled, JobFailure, JobStopped, type JobContext } from "../src/jobs/handlers.ts";
import { istUnserLauf, laufenderSchritt, runReleaseTestJob } from "../src/jobs/release-test-job.ts";
import type { StarterAbloeser, StarterAntwortWert, StarterZugang } from "../src/system/release-test.ts";

/**
 * Der Auftrag `release_test` (WI-0248; Vali 2026-10-26: Der Release-Test wird ein schwerer Auftrag der lokalen Warteschlange). Ohne Prozess und ohne
 * Datenbank: Starter, Uhr und Takt sind ersetzt. Die Sätze, auf die es ankommt:
 *
 * 1. **Er startet genau einmal** — mit dem Starter, der die Vorprüfung beantwortet hat, ohne `--trocken` — und folgt dann dem Runner: Schritt, Anteil und
 *    Restzeit werden Phase, Fortschritt und `restMs`. Grün ist erledigt, rot gescheitert (ohne Wiederholung).
 * 2. **Ein neuer Versuch hängt sich an den Lauf** (Neustart des Dirigenten): Läuft der Lauf dieses Standes seit dem Einreihen, startet nichts.
 * 3. **Hält ein anderer Lauf die Sperre**, wartet der Auftrag in der Phase `wartet` und startet danach.
 * 4. **Abbrechen** legt die Datei ABBRUCH an (über den Starter) und endet erst, wenn der Runner sich beendet hat. Ablösen lässt den Lauf laufen.
 */

const SHA = "a".repeat(40);
/** Die Freigabe des Auftrags (WI-0248): `RT-` und seine öffentliche Kennung (`context.job.publicId` unten). */
const KENNUNG = "RT-00000000-0000-4000-8000-000000000001";
const SEIT = "2026-10-26T08:00:00.000Z";
const NACH = "2026-10-26T08:05:00.000Z";

const lauf = (teil: Partial<ReleaseTestLauf> = {}): ReleaseTestLauf => ({
    zustand: "keiner",
    fertigeTeile: [],
    sperre: false,
    jetzt: NACH,
    schritte: [],
    erwartetMs: 0,
    erwartetSchaetzung: true,
    fortschritt: 0,
    ...teil,
});

const laufend = (teil: Partial<ReleaseTestLauf> = {}): ReleaseTestLauf =>
    lauf({
        zustand: "laeuft",
        sha: SHA,
        start: NACH,
        sperre: true,
        lebt: true,
        schritte: [
            { id: "vorbereitung", zustand: "fertig", erwartetMs: 1000, schaetzung: false },
            { id: "installation", zustand: "laeuft", erwartetMs: 1000, schaetzung: false },
        ],
        fortschritt: 0.3,
        verbleibendMs: 3_600_000,
        ...teil,
    });

interface Welt {
    zugang: StarterZugang;
    abloesen: StarterAbloeser;
    fragen: string[][];
    gestartet: string[][];
    phasen: { name: string; anteil: number | null; restMs: number | null | undefined }[];
    context: JobContext;
    /** Ab jetzt meldet die Grenze einen Abbruch (wie der Aufseher nach dem Heartbeat). */
    brichAb(): void;
    loese(): void;
}

/**
 * Eine Welt: `laeufe` sind die Antworten auf `--stand` der Reihe nach (die letzte bleibt), `trocken` die auf die Vorprüfung der Reihe nach,
 * `abbrechen` die auf `--abbrechen`.
 */
function welt(o: {
    laeufe: ReleaseTestLauf[];
    trocken?: Record<string, unknown>[];
    abbrechen?: Record<string, unknown>;
    input?: Record<string, unknown>;
}): Welt {
    const fragen: string[][] = [];
    const gestartet: string[][] = [];
    const phasen: Welt["phasen"] = [];
    let stand = 0;
    let vor = 0;
    let abbruch = false;
    let stopp = false;
    const antwort = (wert: Record<string, unknown>): StarterAntwortWert => ({ wert, starter: "C:/s/starter.ts" });
    const zugang: StarterZugang = {
        frage: (argumente) => {
            fragen.push([...argumente]);
            if (argumente.includes("--abbrechen"))
                return Promise.resolve(antwort(o.abbrechen ?? { status: "abbruch-angefordert", grund: "ok" }));
            if (argumente.includes("--freigabe-beenden"))
                return Promise.resolve(antwort({ status: "geschrieben", grund: "ok", freigabe: true }));
            const liste = o.trocken ?? [{ status: "trocken", grund: "x", startvermerk: true, freigabe: true }];
            const wert = liste[Math.min(vor, liste.length - 1)] ?? {};
            vor += 1;
            return Promise.resolve(antwort(wert));
        },
        lauf: () => {
            const l = o.laeufe[Math.min(stand, o.laeufe.length - 1)] ?? null;
            stand += 1;
            return Promise.resolve({ lauf: l, fehler: null });
        },
        frageBei: (_starter, argumente) => zugang.frage(argumente),
    };
    const abloesen: StarterAbloeser = (_starter, argumente) => {
        gestartet.push([...argumente]);
        return { pid: 1, ende: new Promise(() => undefined) };
    };
    const context: JobContext = {
        input: o.input ?? { commit: SHA, wiederholen: false, seit: SEIT },
        attempt: 1,
        job: { id: 1, publicId: "00000000-0000-4000-8000-000000000001", leaseNo: 1, mapDomainId: "aventuria" },
        checkpoint: () => {
            if (stopp) throw new JobStopped();
            if (abbruch) throw new JobCancelled();
        },
        beginPhase: async (name, anteil = null, optionen = {}) => {
            if (stopp) throw new JobStopped();
            if (abbruch) throw new JobCancelled();
            phasen.push({ name, anteil, restMs: optionen.restMs });
            await Promise.resolve();
        },
    };
    return {
        zugang,
        abloesen,
        fragen,
        gestartet,
        phasen,
        context,
        brichAb: () => {
            abbruch = true;
        },
        loese: () => {
            stopp = true;
        },
    };
}

const deps = (w: Welt, takte?: (n: number) => void) => {
    let n = 0;
    return {
        zugang: w.zugang,
        abloesen: w.abloesen,
        ausgabeOrdner: "C:/tmp/release-abholer",
        jetzt: () => Date.parse(NACH),
        warte: async () => {
            n += 1;
            takte?.(n);
            if (n > 50) throw new Error("zu viele Takte");
            await Promise.resolve();
        },
    };
};

const fehlerVon = async (arbeit: Promise<unknown>): Promise<unknown> => {
    try {
        await arbeit;
    } catch (e) {
        return e;
    }
    throw new Error("kein Fehler");
};

describe("Der Lauf, dem der Auftrag folgt", () => {
    it("ist ein Lauf dieses Standes, der nicht vor dem Einreihen begann", () => {
        const seit = Date.parse(SEIT);
        expect(istUnserLauf(laufend(), SHA, seit)).toBe(true);
        expect(istUnserLauf(laufend({ start: "2026-10-26T07:00:00.000Z" }), SHA, seit)).toBe(false);
        expect(istUnserLauf(laufend({ sha: "b".repeat(40) }), SHA, seit)).toBe(false);
        expect(istUnserLauf(lauf(), SHA, seit)).toBe(false);
        expect(istUnserLauf(null, SHA, seit)).toBe(false);
    });

    it("der laufende Schritt: der laufende laut Starter, sonst das zuletzt beschriebene Protokoll, sonst die Vorbereitung", () => {
        expect(laufenderSchritt(laufend())).toBe("installation");
        expect(laufenderSchritt(laufend({ schritte: [], schritt: "browser-2" }))).toBe("browser-2");
        expect(laufenderSchritt(laufend({ schritte: [], schritt: "irgendwas" }))).toBe("vorbereitung");
    });
});

describe("🔴 Release-Test als Auftrag: starten, folgen, enden", () => {
    it("startet einmal mit --commit ohne --trocken, folgt Schritt, Anteil und Restzeit und endet grün", async () => {
        const w = welt({
            laeufe: [
                lauf(),
                lauf({ startvorgang: { commit: SHA, seit: NACH, zustand: "baut", grund: null } }),
                laufend(),
                laufend({ zustand: "gruen", ende: "2026-10-26T09:30:00.000Z", sperre: false }),
            ],
        });
        const ergebnis = await runReleaseTestJob(w.context, deps(w));
        expect(ergebnis).toMatchObject({ zustand: "gruen", commit: SHA });
        expect(w.fragen.filter((f) => f.includes("--commit"))).toEqual([["--commit", SHA, "--trocken", "--json"]]);
        expect(w.gestartet).toEqual([["--commit", SHA, "--freigabe", KENNUNG, "--json"]]);
        expect(w.phasen).toContainEqual({ name: "installation", anteil: 0.3, restMs: 3_600_000 });
        expect(w.phasen[0]).toEqual({ name: "vorbereitung", anteil: 0, restMs: null });
    });

    it("„Rote Teile wiederholen“ startet mit --wiederholen", async () => {
        const w = welt({
            laeufe: [lauf(), laufend({ zustand: "gruen", sperre: false })],
            input: { commit: SHA, wiederholen: true, seit: SEIT },
        });
        await runReleaseTestJob(w.context, deps(w));
        expect(w.fragen[0]).toEqual(["--wiederholen", SHA, "--trocken", "--json"]);
        expect(w.gestartet).toEqual([["--wiederholen", SHA, "--freigabe", KENNUNG, "--json"]]);
    });

    it("🔴 rot ist gescheitert, ohne Wiederholung, mit dem Grund des Starters", async () => {
        const w = welt({ laeufe: [lauf(), laufend({ zustand: "rot", grund: "2 Fälle rot", sperre: false })] });
        const fehler = await fehlerVon(runReleaseTestJob(w.context, deps(w)));
        expect(fehler).toBeInstanceOf(JobFailure);
        expect(fehler).toMatchObject({ code: "release_test_rot", retryable: false });
        expect((fehler as JobFailure).message).toContain("2 Fälle rot");
    });

    it("🔴 ein neuer Versuch hängt sich an den laufenden Lauf: keine Vorprüfung, kein zweiter Start", async () => {
        const w = welt({ laeufe: [laufend(), laufend({ zustand: "gruen", sperre: false })] });
        await runReleaseTestJob(w.context, deps(w));
        expect(w.gestartet).toEqual([]);
        expect(w.fragen).toEqual([]);
    });

    it("ein Lauf dieses Standes von VOR dem Einreihen ist nicht der eigene: Der Auftrag wartet, bis er frei ist, und startet dann", async () => {
        const alt = laufend({ start: "2026-10-26T07:00:00.000Z", verbleibendMs: 600_000 });
        const w = welt({
            laeufe: [
                alt,
                alt,
                lauf({ zustand: "gruen", sha: SHA, start: "2026-10-26T07:00:00.000Z" }),
                laufend(),
                laufend(),
                laufend({ zustand: "abgebrochen", sperre: false }),
            ],
            trocken: [
                { status: "laeuft", grund: "ein Lauf ist aktiv", startvermerk: true, freigabe: true },
                { status: "laeuft", grund: "ein Lauf ist aktiv", startvermerk: true, freigabe: true },
                { status: "trocken", grund: "x", startvermerk: true, freigabe: true },
            ],
        });
        let taktZahl = 0;
        const d = deps(w, (n) => {
            taktZahl = n;
        });
        // Nach dem Start bricht der Lauf ab (damit der Test endet): ab dem fünften Takt meldet die Grenze den Abbruch.
        const fehler = await fehlerVon(
            runReleaseTestJob(w.context, {
                ...d,
                warte: async () => {
                    await d.warte();
                    if (taktZahl >= 4) w.brichAb();
                },
            }),
        );
        expect(fehler).toBeInstanceOf(JobCancelled);
        expect(w.phasen.filter((p) => p.name === "wartet")).toHaveLength(2);
        expect(w.phasen.find((p) => p.name === "wartet")?.restMs).toBe(600_000);
        expect(w.gestartet).toEqual([["--commit", SHA, "--freigabe", KENNUNG, "--json"]]);
    });

    it("schon grün bei der Vorprüfung: erledigt, ohne zu starten", async () => {
        const w = welt({
            laeufe: [lauf()],
            trocken: [{ status: "gruen", grund: "schon grün", startvermerk: true, freigabe: true }],
        });
        expect(await runReleaseTestJob(w.context, deps(w))).toMatchObject({ zustand: "gruen", schonGruen: true });
        expect(w.gestartet).toEqual([]);
    });

    it("ein gescheiterter Start (Vermerk des Starters) ist gescheitert, mit seinem Grund", async () => {
        const w = welt({
            laeufe: [
                lauf(),
                lauf({ startvorgang: { commit: SHA, seit: NACH, zustand: "fehler", grund: "Testpaket nicht gebaut" } }),
            ],
        });
        const fehler = await fehlerVon(runReleaseTestJob(w.context, deps(w)));
        expect(fehler).toMatchObject({ code: "release_test_start_gescheitert" });
        expect((fehler as JobFailure).message).toContain("Testpaket nicht gebaut");
    });

    it("eine Sperre ohne lebenden Prozess und ein fehlender früherer Lauf sind eigene Fehler, ohne Start", async () => {
        for (const [status, code] of [
            ["sperre-ohne-prozess", "release_test_sperre"],
            ["kein-roter-lauf", "release_test_kein_roter_lauf"],
            ["fehler", "release_test_fehler"],
        ] as const) {
            const w = welt({
                laeufe: [lauf()],
                trocken: [{ status, grund: "Grund des Starters", startvermerk: true, freigabe: true }],
            });
            expect(await fehlerVon(runReleaseTestJob(w.context, deps(w)))).toMatchObject({ code, retryable: false });
            expect(w.gestartet).toEqual([]);
        }
    });

    it("ein Auftrag ohne vollständigen Stand scheitert sofort", async () => {
        const w = welt({ laeufe: [lauf()], input: { commit: "kurz" } });
        expect(await fehlerVon(runReleaseTestJob(w.context, deps(w)))).toMatchObject({ code: "eingabe_unzulaessig" });
        expect(w.fragen).toEqual([]);
    });
});

describe("🔴 Abbrechen und Ablösen", () => {
    it("Abbrechen legt ABBRUCH an (über den Starter) und endet erst, wenn der Runner sich beendet hat", async () => {
        const w = welt({
            laeufe: [laufend(), laufend(), laufend(), laufend({ zustand: "abgebrochen", sperre: false })],
        });
        w.brichAb();
        const fehler = await fehlerVon(runReleaseTestJob(w.context, deps(w)));
        expect(fehler).toBeInstanceOf(JobCancelled);
        expect(w.fragen.filter((f) => f.includes("--abbrechen"))).toEqual([
            ["--abbrechen", SHA, "--trocken", "--json"],
        ]);
    });

    it("ein Lauf, der von außen abgebrochen wurde, beendet den Auftrag als abgebrochen", async () => {
        const w = welt({ laeufe: [laufend(), laufend({ zustand: "abgebrochen", sperre: false })] });
        expect(await fehlerVon(runReleaseTestJob(w.context, deps(w)))).toBeInstanceOf(JobCancelled);
    });

    it("Ablösen (Neustart des Dirigenten) lässt den Lauf laufen: kein ABBRUCH", async () => {
        const w = welt({ laeufe: [laufend()] });
        w.loese();
        expect(await fehlerVon(runReleaseTestJob(w.context, deps(w)))).toBeInstanceOf(JobStopped);
        expect(w.fragen.filter((f) => f.includes("--abbrechen"))).toEqual([]);
        // Die Freigabe bleibt: Der nächste Versuch hängt sich an denselben Lauf.
        expect(w.fragen.filter((f) => f.includes("--freigabe-beenden"))).toEqual([]);
    });
});

describe("🔴 Die Freigabe des Auftrags (WI-0248): grün geht raus, alles andere beendet sie", () => {
    const beendet = (w: Welt): string[][] => w.fragen.filter((f) => f.includes("--freigabe-beenden"));

    it("grün: die Freigabe bleibt stehen (Claudios Abholer liefert genau diese SHA aus)", async () => {
        const w = welt({ laeufe: [lauf(), laufend(), laufend({ zustand: "gruen", sperre: false })] });
        await runReleaseTestJob(w.context, deps(w));
        expect(beendet(w)).toEqual([]);
    });

    it("rot: die Freigabe dieses Auftrags endet mit dem Grund; nichts geht nach Production", async () => {
        const w = welt({ laeufe: [lauf(), laufend({ zustand: "rot", grund: "Vitest: 3 rot", sperre: false })] });
        expect(await fehlerVon(runReleaseTestJob(w.context, deps(w)))).toMatchObject({ code: "release_test_rot" });
        const [aufruf] = beendet(w);
        expect(aufruf?.slice(0, 4)).toEqual(["--freigabe-beenden", SHA, "--kennung", KENNUNG]);
        expect(aufruf?.[aufruf.indexOf("--grund") + 1]).toContain("Vitest: 3 rot");
    });

    it("abgebrochen und gescheitert beenden die Freigabe ebenso", async () => {
        const ab = welt({ laeufe: [laufend(), laufend({ zustand: "abgebrochen", sperre: false })] });
        await fehlerVon(runReleaseTestJob(ab.context, deps(ab)));
        expect(beendet(ab)).toHaveLength(1);
        const start = welt({
            laeufe: [
                lauf(),
                lauf({ startvorgang: { commit: SHA, seit: NACH, zustand: "fehler", grund: "kein Paket" } }),
            ],
        });
        await fehlerVon(runReleaseTestJob(start.context, deps(start)));
        expect(beendet(start)).toHaveLength(1);
    });

    it("🔴 ein Starter, der die Freigabe nicht kennt, startet nichts: Sein Lauf trüge die Kennung nicht", async () => {
        const w = welt({ laeufe: [lauf()], trocken: [{ status: "trocken", grund: "x", startvermerk: true }] });
        expect(await fehlerVon(runReleaseTestJob(w.context, deps(w)))).toMatchObject({
            code: "release_test_unavailable",
        });
        expect(w.gestartet).toEqual([]);
        expect(beendet(w)).toHaveLength(1);
    });
});

describe("🔴 Der Volltest (WI-0264): Schnelltest, dann der volle Lauf, nur Bericht", () => {
    const VOLL = { commit: SHA, wiederholen: false, volltest: true, seit: SEIT };
    /** Die Vorprüfung eines Starters, der den Volltest kennt. */
    const KENNT = { status: "trocken", grund: "x", startvermerk: true, freigabe: true, volltest: true };
    const teil1 = (teil: Partial<ReleaseTestLauf> = {}): ReleaseTestLauf =>
        laufend({ profil: "tor", volltest: true, ...teil });
    const teil2 = (teil: Partial<ReleaseTestLauf> = {}): ReleaseTestLauf =>
        laufend({ profil: "voll", volltest: true, start: "2026-10-26T08:30:00.000Z", ...teil });

    it("startet erst --volltest tor, nach dessen Ende --volltest voll; nie mit --freigabe; grün nur, wenn beide grün sind", async () => {
        const w = welt({
            laeufe: [
                lauf(),
                teil1(),
                teil1({ zustand: "gruen", sperre: false }),
                teil1({ zustand: "gruen", sperre: false }),
                teil2(),
                teil2({ zustand: "gruen", sperre: false, vorlauf: { zustand: "gruen" } }),
            ],
            trocken: [KENNT],
            input: VOLL,
        });
        const ergebnis = await runReleaseTestJob(w.context, deps(w));
        expect(ergebnis).toMatchObject({ zustand: "gruen", commit: SHA, volltest: true });
        expect(w.gestartet).toEqual([
            ["--commit", SHA, "--volltest", "tor", "--json"],
            ["--commit", SHA, "--volltest", "voll", "--json"],
        ]);
        expect(w.fragen.filter((f) => f.includes("--trocken") && f.includes("--commit"))).toEqual([
            ["--commit", SHA, "--volltest", "tor", "--trocken", "--json"],
            ["--commit", SHA, "--volltest", "voll", "--trocken", "--json"],
        ]);
        expect(w.fragen.flat()).not.toContain("--freigabe");
    });

    it("🔴 ein roter Schnelltest hält den vollen Lauf nicht an; rot ist der Auftrag mit beiden Ergebnissen, und keine Freigabe wird beendet", async () => {
        const w = welt({
            laeufe: [
                lauf(),
                teil1({ zustand: "rot", grund: "kern-echt: 1 Fall rot", sperre: false }),
                teil1({ zustand: "rot", grund: "kern-echt: 1 Fall rot", sperre: false }),
                teil2({ zustand: "gruen", sperre: false }),
            ],
            trocken: [KENNT],
            input: VOLL,
        });
        const fehler = await fehlerVon(runReleaseTestJob(w.context, deps(w)));
        expect(fehler).toBeInstanceOf(JobFailure);
        expect((fehler as JobFailure).message).toContain("Schnelltest rot, voller Lauf grün");
        expect((fehler as JobFailure).message).toContain("kern-echt: 1 Fall rot");
        expect(w.gestartet).toHaveLength(2);
        expect(w.fragen.filter((f) => f.includes("--freigabe-beenden"))).toEqual([]);
    });

    it("nach einem Ablösen in Teil 2 hängt er sich an den vollen Lauf; wie Teil 1 endete, sagt dessen Vorlauf", async () => {
        const w = welt({
            laeufe: [
                teil2(),
                teil2({
                    zustand: "rot",
                    grund: "browser-3: 4 Fälle rot",
                    sperre: false,
                    vorlauf: { zustand: "gruen" },
                }),
            ],
            trocken: [KENNT],
            input: VOLL,
        });
        const fehler = await fehlerVon(runReleaseTestJob(w.context, deps(w)));
        expect((fehler as JobFailure).message).toContain("Schnelltest grün, voller Lauf rot");
        expect((fehler as JobFailure).message).toContain("browser-3: 4 Fälle rot");
        expect(w.gestartet).toEqual([]);
    });

    it("🔴 ein Starter, der den Volltest nicht kennt, startet nichts: Er schriebe eine Notiz nach origin", async () => {
        const w = welt({
            laeufe: [lauf()],
            trocken: [{ status: "trocken", grund: "x", startvermerk: true, freigabe: true }],
            input: VOLL,
        });
        const fehler = await fehlerVon(runReleaseTestJob(w.context, deps(w)));
        expect(fehler).toMatchObject({ code: "release_test_unavailable" });
        expect(w.gestartet).toEqual([]);
    });

    it("abgebrochen: keine Freigabe wird beendet (eine Abbruchzeile überschriebe die eines Schnelltests derselben SHA)", async () => {
        const w = welt({
            laeufe: [teil1(), teil1({ zustand: "abgebrochen", sperre: false })],
            trocken: [KENNT],
            input: VOLL,
        });
        const fehler = await fehlerVon(runReleaseTestJob(w.context, deps(w)));
        expect(fehler).toBeInstanceOf(JobCancelled);
        expect(w.fragen.filter((f) => f.includes("--freigabe-beenden"))).toEqual([]);
    });
});
