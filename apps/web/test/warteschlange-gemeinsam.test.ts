import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
    AdminSystemOverview,
    GemeinsameWarteschlange,
    GemeinsamerAuftrag,
    JobsOverview,
    QueueEntry,
} from "@avesmaps3d/shared";
import { unterzeile } from "../src/auth/abgleiche.ts";
import { reiheZeilen, warteschlangePausiert, wirksamSeitText } from "../src/auth/warteschlange-reihe.ts";
import { locale } from "../src/i18n/i18n.ts";
import { gemeinsameAbschnitte, unbekanntSatz, umgebungName, umgebungOrt } from "../src/status/gemeinsam-view.ts";
import { pauseSatz } from "../src/status/job-view.ts";

/**
 * Die gemeinsame Warteschlange in der Oberfläche (WI-0163 §1.7; Betreiber 2026-10-15: „ich seh ob ein job von stage oder production
 * is, die ordnen sich da der reihe nach ein, jeder weiß, dass da was am arbeiten ist und keiner ist uninformiert“), ohne Browser.
 *
 * **Problemfälle:** die Stage hat pausiert, hier ist nichts geschaltet (die Karte muss „pausiert · auf der Stage“ sagen und keine
 * Person nennen); der Dirigent schweigt (nie „läuft“, sondern „Zustand unbekannt“); ein Auftrag der anderen Umgebung steht zwischen
 * zwei eigenen (die Statusseite ordnet nach dem gemeinsamen Platz).
 */

afterEach(() => {
    locale.value = "de";
});

const NOW = "2026-10-15T03:20:00.000Z";
const NOW_MS = Date.parse(NOW);
const ago = (seconds: number): string => new Date(NOW_MS - seconds * 1000).toISOString();

function auftrag(extra: Partial<GemeinsamerAuftrag> = {}): GemeinsamerAuftrag {
    return {
        umgebung: "staging",
        eigen: false,
        jobId: null,
        kind: "legacy_zug",
        label: null,
        state: "QUEUED",
        platz: 1,
        phase: null,
        progress: null,
        waitReason: "waits_slot",
        queuedAt: ago(600),
        startedAt: null,
        ...extra,
    };
}

function gemeinsam(extra: Partial<GemeinsameWarteschlange> = {}): GemeinsameWarteschlange {
    return {
        zustand: "ok",
        umgebung: "production",
        stand: ago(2),
        pause: { paused: false, since: null, by: null, reason: null, anderswo: null },
        reihe: [],
        ...extra,
    };
}

describe("Die Karte „Warteschlange“ mit der gemeinsamen Pause (WI-0163 §1.6)", () => {
    const pausiertAufStage = {
        paused: true,
        since: "2026-10-15T03:12:00.000Z",
        by: null,
        reason: "Sicherung",
        anderswo: "staging",
    };

    it("🔴 auf der Stage pausiert: der Ort statt der Person", () => {
        const satz = wirksamSeitText(pausiertAufStage, "production", new Date(NOW));
        expect(satz).toMatch(/^seit heute, .+ · auf der Stage · „Sicherung“$/u);
    });

    it("hier pausiert: die Person und der Ort, an der Kommandozeile der Benutzer", () => {
        const hier = { ...pausiertAufStage, by: "Valentin", anderswo: null };
        expect(wirksamSeitText(hier, "staging", new Date(NOW))).toMatch(
            /^seit heute, .+ · Valentin · auf der Stage · „Sicherung“$/u,
        );
        const cli = { ...hier, by: "cli:root", reason: null };
        expect(wirksamSeitText(cli, "production", new Date(NOW))).toMatch(
            /^seit heute, .+ · auf dem Server \(root\) · auf Production$/u,
        );
    });

    it("🔴 gezeigt ist die WIRKSAME Pause; ohne frischen Stand die eigene Zeile; unbekannt ist nie „läuft“", () => {
        const basis = {
            configured: { queuePause: { paused: false } },
        } as unknown as AdminSystemOverview;
        expect(warteschlangePausiert({ ...basis, warteschlange: gemeinsam({ pause: pausiertAufStage }) }, true)).toBe(
            true,
        );
        expect(
            warteschlangePausiert({ ...basis, warteschlange: gemeinsam({ zustand: "veraltet", pause: null }) }, true),
        ).toBe(false);
        expect(warteschlangePausiert(basis, true)).toBe(false);
        expect(warteschlangePausiert(basis, false)).toBeNull();
        // Ohne Systemzustand, aber mit frischem Stand: Die Pause ist trotzdem bekannt.
        expect(warteschlangePausiert({ ...basis, warteschlange: gemeinsam({ pause: pausiertAufStage }) }, false)).toBe(
            true,
        );
    });

    it("🔴 die Reihe in Legacys Listenform: Kreis, Umgebung rechts, Platz und Grund oder Schritt und Fortschritt, keine Person", () => {
        const zeilen = reiheZeilen([
            auftrag({
                state: "RUNNING",
                platz: null,
                waitReason: null,
                kind: "terrain_full",
                phase: "ableiten",
                progress: 0.42,
            }),
            auftrag({ umgebung: "production", eigen: true, jobId: "j-1", platz: 2, label: "Legacy-Zug: Wege" }),
        ]);
        expect(zeilen[0]).toMatchObject({
            eigen: false,
            umgebung: "Stage",
            ton: "warnung",
            kreis: "halb",
            kreisName: "läuft",
            prozent: 42,
        });
        expect(zeilen[0]?.unter).toMatch(/^läuft · .+ · 42 %$/u);
        expect(zeilen[1]).toMatchObject({
            key: "j-1",
            eigen: true,
            name: "Legacy-Zug: Wege",
            umgebung: "Production",
            ton: "erfolg",
            kreis: "leer",
            kreisName: "wartet",
            prozent: null,
        });
        expect(zeilen[1]?.unter).toBe("Legacy-Zug einer Kategorie · Platz 2 · Wartet auf einen freien Platz.");
    });

    it("die Namen und Orte der Umgebungen in drei Sprachen; ein unbekannter Name bleibt stehen", () => {
        expect([umgebungName("staging"), umgebungOrt("production"), umgebungOrt("development")]).toEqual([
            "Stage",
            "auf Production",
            "lokal",
        ]);
        locale.value = "en";
        expect(umgebungOrt("staging")).toBe("on the stage");
        locale.value = "fr";
        expect(umgebungOrt("staging")).toBe("sur la Stage");
        expect(umgebungName("mars")).toBe("mars");
    });
});

describe("Die Statusseite mit der gemeinsamen Reihe (WI-0163 §1.7)", () => {
    function entry(id: string, position: number): QueueEntry {
        return { id, position, state: "QUEUED", stalled: false } as unknown as QueueEntry;
    }
    function overview(extra: Partial<JobsOverview> = {}): JobsOverview {
        return {
            running: [{ id: "r-eigen", state: "RUNNING", stalled: false }],
            queued: [entry("q-1", 1), entry("q-3", 3)],
            queuePause: { paused: false, since: null, by: null, reason: null },
            ...extra,
        } as unknown as JobsOverview;
    }

    it("🔴 die Aufträge der anderen Umgebung stehen zwischen den eigenen, nach dem gemeinsamen Platz", () => {
        const abschnitte = gemeinsameAbschnitte(
            overview({
                gemeinsam: gemeinsam({
                    reihe: [
                        auftrag({ state: "RUNNING", platz: null, waitReason: null }),
                        auftrag({ eigen: true, jobId: "q-1", umgebung: "production", platz: 1 }),
                        auftrag({ platz: 2 }),
                        auftrag({ eigen: true, jobId: "q-3", umgebung: "production", platz: 3 }),
                    ],
                }),
            }),
        );
        expect(abschnitte.running.map((eintrag) => eintrag.art)).toEqual(["eigen", "fremd"]);
        expect(
            abschnitte.queued.map((eintrag) =>
                eintrag.art === "eigen" ? eintrag.job.id : `fremd:${String(eintrag.auftrag.platz)}`,
            ),
        ).toEqual(["q-1", "fremd:2", "q-3"]);
    });

    it("🔴 ohne frischen Stand nur die eigenen, wie bis WI-0163", () => {
        for (const ohne of [undefined, gemeinsam({ zustand: "veraltet", pause: null, reihe: [auftrag()] })]) {
            const abschnitte = gemeinsameAbschnitte(overview(ohne === undefined ? {} : { gemeinsam: ohne }));
            expect(abschnitte.queued.map((eintrag) => eintrag.art)).toEqual(["eigen", "eigen"]);
            expect(abschnitte.running).toHaveLength(1);
        }
    });

    it("🔴 „Zustand der Warteschlange unbekannt“ mit dem Grund; frisch oder ohne Datei kein Satz", () => {
        expect(unbekanntSatz(undefined, NOW_MS)).toBeNull();
        expect(unbekanntSatz(gemeinsam(), NOW_MS)).toBeNull();
        expect(unbekanntSatz(gemeinsam({ zustand: "veraltet", stand: ago(95) }), NOW_MS)).toEqual({
            lead: "Zustand der Warteschlange unbekannt.",
            satz: "Der Dirigent meldet sich seit 1 min 35 s nicht.",
        });
        expect(unbekanntSatz(gemeinsam({ zustand: "fehlt", stand: null }), NOW_MS)?.satz).toBe(
            "Der Dirigent hat noch keinen Stand geschrieben.",
        );
        expect(unbekanntSatz(gemeinsam({ zustand: "unlesbar", stand: null }), NOW_MS)?.satz).toBe(
            "Der Stand des Dirigenten lässt sich nicht lesen.",
        );
    });

    it("🔴 der Hinweis oben: auf der Stage pausiert, ohne Person", () => {
        expect(
            pauseSatz({ paused: true, since: ago(240), by: null, reason: "Sicherung", anderswo: "staging" }, NOW_MS)
                ?.satz,
        ).toBe("Pausiert seit 4 min · auf der Stage · „Sicherung“");
    });

    it("die Seite kennt beide Zeilen und den Hinweis (Vorlage gelesen, nicht geraten)", () => {
        const tab = readFileSync(resolve(import.meta.dirname, "../src/status/queue-tab.vue"), "utf8");
        expect(tab).toContain("<FremdRow");
        expect(tab).toContain('data-testid="queue-unknown"');
        const karte = readFileSync(
            resolve(import.meta.dirname, "../src/auth/verwaltung-betrieb-warteschlange.vue"),
            "utf8",
        );
        expect(karte).toContain("<VerwaltungBetriebReihe");
        expect(karte).toContain("wirksamSeitText");
    });
});

describe("Die Abgleiche nennen den Platz in der gemeinsamen Reihe (WI-0163)", () => {
    it("wartend: Platz und Grund aus dem Stand", () => {
        const zeile = {
            quelle: "legacy",
            kreis: "leer",
            letzter: null,
            ausfuehrung: "worker",
            laufend: {
                jobId: "j",
                state: "QUEUED",
                queuedAt: ago(60),
                startedAt: null,
                phase: null,
                progress: null,
                waitReason: "waits_slot",
                ausgeloest: { art: "person", name: "Valentin" },
                platz: 3,
            },
        } as const;
        expect(unterzeile(zeile, new Date(NOW)).text).toBe("Wartet · Platz 3 · Wartet auf einen freien Platz.");
        expect(unterzeile({ ...zeile, laufend: { ...zeile.laufend, platz: null } }, new Date(NOW)).text).toBe(
            "Wartet · Wartet auf einen freien Platz.",
        );
    });
});

describe("Ein hängender Auftrag steht rot, mit eigenem Satz (WI-0179)", () => {
    // Problemfall 2026-10-15: Der Landschaften-Zug stand acht Stunden auf „Wartet“, gelb wie jedes Warten, und niemand merkte es.
    const vorlage = (name: string) => readFileSync(resolve(import.meta.dirname, "../src/auth", name), "utf8");

    it("🔴 in der Reihe der Warteschlange: der Satz aus der Tafel und die Unterzeile rot; ein gewöhnliches Warten nicht", () => {
        const [haengt, wartet] = reiheZeilen([
            auftrag({ umgebung: "production", label: "Legacy-Zug: Landschaften", waitReason: "waits_executor_stuck" }),
            auftrag({ waitReason: "waits_executor" }),
        ]);
        expect(haengt).toMatchObject({ haengt: true });
        expect(haengt?.unter).toBe(
            "Legacy-Zug einer Kategorie · Platz 1 · Hängt: Der Auftrag wird immer wieder abgewiesen und kommt so nicht von selbst weiter.",
        );
        expect(wartet).toMatchObject({ haengt: false });
        expect(vorlage("verwaltung-betrieb-reihe.vue")).toMatch(/'reihe__unter--haengt': zeile\.haengt/u);
        expect(vorlage("verwaltung-betrieb-reihe.vue")).toMatch(
            /\.reihe__unter--haengt \{\s*color: var\(--color-danger-soft-text\);/u,
        );
    });

    it("🔴 in den Abgleichen: Ton „fehler“ statt „warnung“, rot gezeichnet", () => {
        const laufend = {
            jobId: "j",
            state: "QUEUED",
            queuedAt: ago(3600),
            startedAt: null,
            phase: null,
            progress: null,
            waitReason: "waits_executor_stuck",
            ausgeloest: { art: "person", name: "Thomas" },
            platz: 1,
        } as const;
        const zeile = {
            quelle: "legacy_landschaften",
            kreis: "leer",
            letzter: null,
            ausfuehrung: "korridor",
            laufend,
        } as const;
        expect(unterzeile(zeile, new Date(NOW))).toEqual({
            text: "Wartet · Platz 1 · Hängt: Der Auftrag wird immer wieder abgewiesen und kommt so nicht von selbst weiter.",
            ton: "fehler",
        });
        expect(unterzeile({ ...zeile, laufend: { ...laufend, waitReason: "waits_executor" } }, new Date(NOW)).ton).toBe(
            "warnung",
        );
        expect(vorlage("verwaltung-abgleiche.vue")).toMatch(
            /\.abgleiche__unter--fehler \{\s*color: var\(--color-danger-soft-text\);/u,
        );
    });
});
