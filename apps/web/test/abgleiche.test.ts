import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AdminAbgleiche, type AbgleichZeile } from "@avesmaps3d/shared";
import {
    KREIS_LEGENDE,
    NACHSEHEN_MS,
    bestaetigenName,
    createAbgleiche,
    fortschritt,
    kreisName,
    quelleName,
    sperrSatz,
    startName,
    unterzeile,
} from "../src/auth/abgleiche.ts";

/**
 * Der Eintrag „Abgleiche“ (WI-0127 SYS-14) ohne Browser: die Unterzeile je Lage, der Grund eines gesperrten Knopfs, die Legende, und der
 * Ablauf gegen einen nachgebauten Server (Start mit Kennung und Quelle, Hinweis ohne Planer, 409, Nachsehen nur solange etwas läuft).
 */

const NOW = new Date("2026-10-11T14:30:00Z");

function zeile(patch: Partial<AbgleichZeile> = {}): AbgleichZeile {
    return { quelle: "legacy", kreis: "leer", letzter: null, laufend: null, ausfuehrung: "worker", ...patch };
}

function stand(zeilen: AbgleichZeile[] = [zeile(), zeile({ quelle: "medien" })], patch: Partial<AdminAbgleiche> = {}) {
    const body: AdminAbgleiche = { now: NOW.toISOString(), ausfuehrung: "worker", planerAktiv: true, zeilen, ...patch };
    // Jede Vorlage gegen den Vertrag: der Nachbau sagt nichts, was der Server nicht sagen kann.
    expect(Value.Check(AdminAbgleiche, body)).toBe(true);
    return body;
}

const LAUF = {
    jobId: "7e570000-0000-4000-8000-000000000001",
    startedAt: "2026-10-11T14:00:00Z",
    finishedAt: "2026-10-11T14:05:00Z",
    ausgeloest: { art: "person" as const, name: "Rondrikan" },
    luecken: [] as string[] | null,
    befunde: 3,
    satz: null,
    fehler: null,
};

describe("Unterzeile", () => {
    it("noch nie, vollständig mit Person, mit Lücke, gescheitert mit Fehler, abgebrochen", () => {
        expect(unterzeile(zeile(), NOW)).toEqual({ text: "Noch nie abgeglichen", ton: "leise" });
        const voll = unterzeile(zeile({ kreis: "voll", letzter: { ...LAUF, state: "SUCCEEDED" } }), NOW);
        expect(voll.ton).toBe("gut");
        expect(voll.text).toMatch(/^Letzter Datenabgleich: heute, \d\d:\d\d · ausgelöst von Rondrikan$/u);
        const halb = unterzeile(zeile({ letzter: { ...LAUF, state: "SUCCEEDED", luecken: ["I24", "I28"] } }), NOW);
        expect(halb).toMatchObject({ ton: "warnung" });
        expect(halb.text).toContain("entfallen: I24 und I28");
        const ablauf = unterzeile(
            zeile({
                letzter: { ...LAUF, state: "SUCCEEDED", luecken: null, ausgeloest: { art: "ablauf", name: "Import" } },
            }),
            NOW,
        );
        expect(ablauf.text).toContain("ohne Knopf (Zuruf oder täglicher Zug)");
        const gescheitert = unterzeile(
            zeile({ letzter: { ...LAUF, state: "FAILED", fehler: "Der Legacy-Zug hat angehalten: HTTP 503" } }),
            NOW,
        );
        expect(gescheitert.ton).toBe("warnung");
        expect(gescheitert.text).toMatch(
            /^Zuletzt gescheitert: heute, \d\d:\d\d · Der Legacy-Zug hat angehalten: HTTP 503$/u,
        );
        // 🔴 Der Satz des Abholers steht in der Zeile (Claudio 2026-10-13): Bei „Knopf, dann alles automatisch“ sagt
        // „Zuletzt abgebrochen: heute, 20:27“ allein niemandem, warum Production unverändert blieb.
        const abgebrochen = unterzeile(
            {
                ...zeile(),
                letzter: {
                    ...LAUF,
                    state: "CANCELLED",
                    fehler: "Landschaften ist noch nicht freigeschaltet",
                },
            },
            NOW,
        );
        expect(abgebrochen.ton).toBe("warnung");
        expect(abgebrochen.text).toMatch(
            /^Zuletzt abgebrochen: heute, \d\d:\d\d · Landschaften ist noch nicht freigeschaltet$/u,
        );
        // Ohne Satz bleibt es bei der Zeit allein.
        expect(unterzeile(zeile({ letzter: { ...LAUF, state: "CANCELLED" } }), NOW).text).toMatch(
            /^Zuletzt abgebrochen: heute, \d\d:\d\d$/u,
        );
    });

    it("wartend mit dem Satz der Statusseite, auch bei den drei abgeleiteten Gründen; laufend mit Schritt und Anteil", () => {
        const wartend = {
            jobId: LAUF.jobId,
            state: "QUEUED" as const,
            queuedAt: "2026-10-11T14:29:00Z",
            startedAt: null,
            phase: null,
            progress: null,
            waitReason: "waits_slot",
            ausgeloest: LAUF.ausgeloest,
        };
        expect(unterzeile(zeile({ laufend: wartend }), NOW).text).toBe("Wartet · Wartet auf einen freien Platz.");
        // 🔴 Die Oberfläche leitet nichts mehr ab (WI-0160): Sie übersetzt den Grund, den der Server geschickt hat — auch die
        //    drei, die dort beim Lesen entstehen (`apps/server/src/jobs/wartegrund.ts`, geprüft in `wartegrund.test.ts`).
        expect(
            unterzeile(zeile({ ausfuehrung: "korridor", laufend: { ...wartend, waitReason: "waits_pickup" } }), NOW)
                .text,
        ).toBe("Wartet · Wartet auf die Abholung durch den Server (jede Minute).");
        expect(unterzeile(zeile({ laufend: { ...wartend, waitReason: "waits_queue_paused" } }), NOW).text).toBe(
            "Wartet · Die Warteschlange ist pausiert.",
        );
        expect(unterzeile(zeile({ laufend: { ...wartend, waitReason: "waits_no_worker" } }), NOW).text).toBe(
            "Wartet · Hier nimmt niemand diesen Auftrag an: Es läuft kein Worker der Warteschlange.",
        );
        expect(unterzeile(zeile({ laufend: { ...wartend, waitReason: "waits_running_kind" } }), NOW).text).toBe(
            "Wartet · Wartet auf einen laufenden Auftrag derselben Art.",
        );
        // 🔴 Hinter einem laufenden Abgleich dieser Umgebung nennt die Zeile ihn (Betreiber 2026-10-17); den Namen schickt der Server.
        expect(
            unterzeile(
                zeile({ laufend: { ...wartend, waitReason: "waits_running_kind", hinter: "legacy_landschaften" } }),
                NOW,
            ).text,
        ).toBe("Wartet · hinter Legacy-Zug: Derographie");
        const laufend = unterzeile(
            zeile({
                laufend: {
                    ...wartend,
                    state: "RUNNING",
                    startedAt: "2026-10-11T14:20:00Z",
                    phase: "I11",
                    progress: 0.42,
                },
            }),
            NOW,
        );
        expect(laufend).toMatchObject({ ton: "leise" });
        // Wartet hinter dem laufenden schon ein weiterer derselben Zeile, sagt es die Zeile.
        const mitDanach = unterzeile(
            {
                ...zeile({
                    laufend: {
                        ...wartend,
                        state: "RUNNING",
                        startedAt: "2026-10-11T14:20:00Z",
                        phase: null,
                        progress: null,
                    },
                }),
                wartetDanach: true,
            },
            NOW,
        );
        expect(mitDanach.text).toMatch(/ · danach noch einmal$/u);
        // Der Balken (Betreiber 2026-10-10: „grob reicht“): nur beim laufenden Auftrag mit Angabe, in ganzen Prozent.
        const mitAnteil = { ...wartend, state: "RUNNING" as const, startedAt: "2026-10-11T14:20:00Z", progress: 0.424 };
        expect(fortschritt(zeile({ laufend: mitAnteil }))).toBe(42);
        expect(fortschritt(zeile({ laufend: { ...mitAnteil, progress: null } }))).toBeNull();
        expect(fortschritt(zeile({ laufend: wartend }))).toBeNull();
        expect(fortschritt(zeile())).toBeNull();
        expect(laufend.text).toMatch(/^Läuft seit heute, \d\d:\d\d · Schritt I11 · 42 %$/u);
    });
});

describe("Knopf und Legende", () => {
    it("gesperrt ohne Recht, ohne Ausführung und während ein Auftrag läuft, sonst frei", () => {
        const s = stand();
        expect(sperrSatz(s, zeile(), false)).toContain("„Legacy-Zug starten“");
        expect(sperrSatz(s, zeile({ ausfuehrung: "aus" }), true)).toBe(
            "Auf dieser Umgebung startet die Verwaltung keinen Datenabgleich.",
        );
        // Stage (SYS-14b): über Claudios Korridor geht der Knopf, die ausgeschaltete Quelle nicht.
        expect(sperrSatz(s, zeile({ ausfuehrung: "korridor" }), true)).toBeUndefined();
        // 🔴 Eine Kategorie, deren Weg noch nicht ganz steht, nennt ihren eigenen Satz - nicht den von `aus`, der hiesse
        // ‚diese Umgebung gleicht nichts ab‘ und waere eine Unwahrheit, solange die anderen Kategorien gehen.
        expect(sperrSatz(s, zeile({ quelle: "legacy_landschaften", ausfuehrung: "noch_nicht" }), true)).toBe(
            "Diese Kategorie ist hier noch nicht freigeschaltet; ihr Weg steht noch nicht ganz.",
        );
        // 🔴 Eine Kategoriezeile (WI-0141) nennt ihr eigenes Recht und geht nur damit: sie ersetzt Tafeln der Lesekarte.
        const kategorie = zeile({ quelle: "legacy_orte", ausfuehrung: "korridor" });
        expect(sperrSatz(s, kategorie, { sync: true, zug: false, production: true })).toContain(
            "„Legacy-Zug je Kategorie starten“",
        );
        expect(sperrSatz(s, kategorie, { sync: false, zug: true, production: false })).toBeUndefined();
        // Die Gesamtzeile bleibt am alten Recht hängen, auch wenn jemand nur das neue hat.
        expect(
            sperrSatz(s, zeile({ ausfuehrung: "korridor" }), { sync: false, zug: true, production: true }),
        ).toContain("„Legacy-Zug starten“");
        // 🔴 Der Production-Zug (WI-0144) nennt sein eigenes Recht: Er ersetzt die Daten der ganzen Umgebung, also trägt
        // ihn weder `run_legacy_sync` noch `run_legacy_zug`.
        const prod = zeile({ quelle: "production", ausfuehrung: "korridor" });
        expect(sperrSatz(s, prod, { sync: true, zug: true, production: false })).toContain("„Production-Zug holen“");
        expect(sperrSatz(s, prod, { sync: false, zug: false, production: true })).toBeUndefined();
        // `verborgen` schickt der Server nicht mit; kommt die Zeile doch, geht ihr Knopf nicht.
        expect(sperrSatz(s, zeile({ quelle: "production", ausfuehrung: "verborgen" }), true)).toBe(
            "Auf dieser Umgebung startet die Verwaltung keinen Datenabgleich.",
        );
        expect(sperrSatz(s, zeile({ quelle: "medien", ausfuehrung: "aus" }), true)).toBe(
            "Auf dieser Umgebung startet die Verwaltung keinen Datenabgleich.",
        );
        const laufend = zeile({
            laufend: {
                jobId: LAUF.jobId,
                state: "RUNNING",
                queuedAt: NOW.toISOString(),
                startedAt: NOW.toISOString(),
                phase: "I1",
                progress: 0.1,
                waitReason: null,
                ausgeloest: LAUF.ausgeloest,
            },
        });
        // 🔴 Hinter einem laufenden Auftrag darf einer derselben Zeile einreihen (Betreiber 2026-10-17: „dafür ist die doch da? dass
        //    man wartet?“); ein wartender sperrt, und einer, der schon hinter dem laufenden wartet, auch.
        expect(sperrSatz(s, laufend, true)).toBeUndefined();
        expect(sperrSatz(s, { ...laufend, wartetDanach: true }, true)).toBe("Dieser Datenabgleich wartet schon.");
        const wartet = zeile({ laufend: { ...laufend.laufend!, state: "QUEUED", startedAt: null, progress: null } });
        expect(sperrSatz(s, wartet, true)).toBe("Dieser Datenabgleich wartet schon.");
        // Der Production-Zug bleibt allein: Er sperrt sich auch, solange er läuft (WI-0144).
        const prodLaeuft = { ...laufend, quelle: "production" as const, ausfuehrung: "korridor" as const };
        expect(sperrSatz(s, prodLaeuft, true)).toBe("Dieser Datenabgleich wartet oder läuft schon.");
        expect(sperrSatz(s, zeile(), true)).toBeUndefined();
    });

    it("der Knopf trägt den gemeinsamen Satz, der Production-Zug seinen eigenen (Betreiberwort 2026-10-14)", () => {
        expect(startName("legacy")).toBe("Jetzt abgleichen");
        expect(startName("medien")).toBe("Jetzt abgleichen");
        expect(startName("legacy_orte")).toBe("Jetzt abgleichen");
        expect(startName("production")).toBe("Production-Zug holen");
        // Derselbe Weg für den Knopf in der Rückfrage: „Jetzt abgleichen“ passt nicht zu einem Zug, der nur holt.
        expect(bestaetigenName("legacy")).toBe("Jetzt abgleichen");
        expect(bestaetigenName("production")).toBe("Jetzt holen");
        // Der Zeilenname bleibt in der Form der übrigen Quellen; der Knopf trägt das Verb.
        expect(quelleName("production")).toBe("Production-Zug");
    });

    it("die Legende nennt jeden Kreis mit Wort, von leer nach voll", () => {
        expect(KREIS_LEGENDE.map(kreisName)).toEqual([
            "noch nie oder zuletzt gescheitert",
            "zuletzt mit Lücke",
            "zuletzt vollständig",
        ]);
    });
});

// --- Ablauf gegen einen nachgebauten Server -----------------------------------------------------------------------------------------

type Answer = { status: number; body?: unknown };
const envelope = (code: string) => ({ error: { code, message: "vom Server" } });

function server(...answers: Answer[]) {
    const calls: { url: string; method: string; body: Record<string, unknown> | undefined }[] = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({
            url: String(url),
            method: init?.method ?? "GET",
            body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        });
        const answer = answers.shift() ?? { status: 500 };
        return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), { status: answer.status });
    };
    return { calls, fetcher: fetcher as typeof fetch };
}

function timers() {
    const pending: { callback: () => void; ms: number }[] = [];
    return {
        pending,
        setTimer: (callback: () => void, ms: number) => {
            const entry = { callback, ms };
            pending.push(entry);
            return entry;
        },
        clearTimer: (handle: unknown) => {
            const index = pending.indexOf(handle as (typeof pending)[number]);
            if (index >= 0) pending.splice(index, 1);
        },
    };
}

const RECEIPT = (warnings: { code: string; message: string }[] = []): Answer => ({
    status: 200,
    body: {
        operationId: "7e570000-0000-4000-8000-0000000000f0",
        status: "applied",
        environment: "test",
        affected: [],
        derivedWork: [{ kind: "legacy_pull", jobId: LAUF.jobId, state: "queued" }],
        warnings,
    },
});

describe("Ablauf", () => {
    it("🔴 erst die Frage, dann der Start mit neuer Kennung und Quelle; ohne Planer bleibt ein Hinweis an der Zeile", async () => {
        const { calls, fetcher } = server(
            { status: 200, body: stand() },
            RECEIPT([{ code: "planner_inactive", message: "…" }]),
            { status: 200, body: stand() },
        );
        const abgleiche = createAbgleiche({ fetcher, ask: async () => true });
        await abgleiche.load();
        abgleiche.ask("legacy");
        expect(abgleiche.frage.value).toBe("legacy");
        expect(calls.filter((call) => call.method === "POST")).toEqual([]);
        const result = await abgleiche.confirm();
        expect(result.ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/abgleiche/start");
        expect(post?.body?.["quelle"]).toBe("legacy");
        expect(post?.body?.["operationId"]).toMatch(/^[0-9a-f-]{36}$/u);
        expect(abgleiche.frage.value).toBeNull();
        expect(abgleiche.ergebnis.value).toEqual({
            quelle: "legacy",
            result: { ok: true, problems: [{ key: "admin.sync.waitNoPlanner" }] },
        });
        // Danach neu geladen.
        expect(calls.filter((call) => call.url === "/api/admin/system/abgleiche")).toHaveLength(2);
    });

    it("ein zweiter Start derselben Quelle: der Satz des Servers an der Zeile", async () => {
        const { fetcher } = server(
            { status: 200, body: stand() },
            { status: 409, body: envelope("sync_running") },
            {
                status: 200,
                body: stand(),
            },
        );
        const abgleiche = createAbgleiche({ fetcher, ask: async () => true });
        await abgleiche.load();
        abgleiche.ask("medien");
        const result = await abgleiche.confirm();
        expect(result).toEqual({ ok: false, problems: [{ key: "admin.sync.error.running" }] });
        expect(abgleiche.ergebnis.value?.quelle).toBe("medien");
    });

    it("🔴 Nachsehen nur, solange der Eintrag offen ist und ein Auftrag wartet oder läuft", async () => {
        const clock = timers();
        const laufend = zeile({
            laufend: {
                jobId: LAUF.jobId,
                state: "RUNNING",
                queuedAt: NOW.toISOString(),
                startedAt: NOW.toISOString(),
                phase: "I3",
                progress: 0.2,
                waitReason: null,
                ausgeloest: LAUF.ausgeloest,
            },
        });
        const { calls, fetcher } = server(
            { status: 200, body: stand([laufend, zeile({ quelle: "medien" })]) },
            { status: 200, body: stand() },
        );
        const abgleiche = createAbgleiche({ fetcher, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
        await abgleiche.load();
        expect(clock.pending).toEqual([]);
        abgleiche.follow(true);
        expect(clock.pending.map((entry) => entry.ms)).toEqual([NACHSEHEN_MS]);
        clock.pending.shift()!.callback();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Jetzt läuft nichts mehr: kein weiteres Nachsehen.
        expect(calls).toHaveLength(2);
        expect(clock.pending).toEqual([]);
        abgleiche.follow(false);
    });
});
