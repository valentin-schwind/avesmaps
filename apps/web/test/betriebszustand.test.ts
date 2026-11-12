import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it, vi } from "vitest";
import { AdminSystemOverview } from "@avesmaps3d/shared";
import {
    NACHSEHEN_MS,
    NACHZIEHEN_MS,
    createOperations,
    grundPflicht,
    grundProblem,
    inhaberText,
    kurzstatus,
    naechstesNachsehen,
    rueckwegBefehle,
    schienenWert,
    schutzProblem,
    seitText,
    vorText,
    wirkung,
    wirkungTon,
} from "../src/auth/betriebszustand.ts";
import type { Need } from "../src/auth/bestaetigen.ts";
import { describeEvent } from "../src/auth/verwaltung-text.ts";

/**
 * Der Eintrag „Betriebszustand“ ohne Browser (WI-0127 SYS-5, SYS-0001 §6.2, §7.1): das Urteil „eingestellt gegen wirksam“ mit seinen
 * vier Fällen, der Kurzstatus, der Grund (1 bis 300 Zeichen), die Schutzregeln vor dem Server und der Bestätigungsfluss gegen einen
 * nachgebauten Server: Passkey verlangt und gegeben, abgebrochen, Konflikt, Selbstaussperrung, Zustand unbekannt.
 *
 * Problemfälle: der Server kennt seinen Zustand nicht (nie „Normal“), die Instanz zieht nach und hängt danach fest, gleiche Revision mit
 * anderem Wert, ein Grund aus Leerzeichen, 300 Zeichen mit Emoji, die eigene Person ohne Zugangsrecht, kein Inhaber mit Passkey.
 */

const NOW = "2026-10-10T14:05:30.000Z";
const ME = "0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51";
const HESINDIANE = "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e";
const ago = (ms: number): string => new Date(Date.parse(NOW) - ms).toISOString();

type Overview = AdminSystemOverview;
const open = { locked: false, since: null, by: null, byLabel: null, reason: null };

function overview(change: (base: Overview) => void = () => undefined): Overview {
    const base: Overview = {
        configured: {
            mode: {
                mode: "normal",
                since: "2026-10-09T19:18:00.000Z",
                by: { id: ME, displayName: "Rondrikan" },
                byLabel: null,
                reason: null,
            },
            mapLock: { ...open },
            systemLock: { ...open },
            queuePause: { paused: false, since: null, by: null, byLabel: null, reason: null },
            revision: 7,
            contentRevision: 1,
            updatedAt: "2026-10-09T19:18:00.000Z",
        },
        effective: {
            source: "database",
            mode: "normal",
            mapLock: false,
            systemLock: false,
            revision: 7,
            contentRevision: 1,
            readAt: ago(6_000),
            ready: true,
        },
        restrictedAccessHolders: [
            { person: { id: HESINDIANE, displayName: "Hesindiane" }, hasPasskey: true },
            { person: { id: ME, displayName: "Rondrikan" }, hasPasskey: true },
        ],
        brief: {
            now: NOW,
            releaseId: "028ec13",
            startedAt: "2026-10-09T19:18:00.000Z",
            map: "ready",
            login: "ready",
            routing: "ready",
            queue: { running: 1, queued: 0 },
        },
    };
    change(base);
    return base;
}

/** Eingeschränkt umgeschaltet, `ms` vor der Antwort; die Instanz kennt noch Revision 7. */
function umgeschaltet(ms: number, change: (base: Overview) => void = () => undefined): Overview {
    return overview((o) => {
        o.configured!.mode = {
            ...o.configured!.mode,
            mode: "restricted",
            since: ago(ms),
            reason: "Wiederherstellung prüfen",
        };
        o.configured!.revision = 8;
        o.configured!.updatedAt = ago(ms);
        change(o);
    });
}

describe("die Vorlage stimmt mit dem Vertrag", () => {
    it("jede Vorlage dieser Datei ist eine gültige Antwort von GET /api/admin/system", () => {
        for (const sample of [overview(), umgeschaltet(4_000), umgeschaltet(120_000)]) {
            expect([...Value.Errors(AdminSystemOverview, sample)]).toEqual([]);
        }
    });
});

describe("eingestellt gegen wirksam (Blatt Z2)", () => {
    it("🔴 gleich: dieselbe Revision und dieselben Werte; das Alter rechnet an der Uhr des Servers", () => {
        expect(wirkung(overview())).toEqual({
            art: "gleich",
            mode: "normal",
            alterMs: 6_000,
            seitMs: expect.any(Number),
            unprovisioned: false,
        });
        expect(wirkungTon(wirkung(overview()))).toBe("erfolg");
    });

    it("übernommen: Eingeschränkt ist gleich und steht gelb", () => {
        const o = umgeschaltet(2_000, (base) => {
            base.effective.mode = "restricted";
            base.effective.revision = 8;
        });
        expect(wirkung(o).art).toBe("gleich");
        expect(wirkungTon(wirkung(o))).toBe("warnung");
    });

    it("🔴 zieht nach: die Instanz kennt eine ältere Revision, höchstens zwei Takte nach dem Umschalten", () => {
        expect(wirkung(umgeschaltet(4_000))).toMatchObject({ art: "zieht_nach", mode: "normal", seitMs: 4_000 });
        expect(wirkung(umgeschaltet(NACHZIEHEN_MS)).art).toBe("zieht_nach");
        expect(wirkungTon(wirkung(umgeschaltet(4_000)))).toBe("warnung");
    });

    it("🔴 weicht ab: länger als zwei Takte, oder bei gleicher Revision ein anderer Wert", () => {
        expect(wirkung(umgeschaltet(NACHZIEHEN_MS + 1))).toMatchObject({ art: "weicht_ab", seitMs: NACHZIEHEN_MS + 1 });
        expect(wirkung(umgeschaltet(120_000)).art).toBe("weicht_ab");
        const sameRevision = overview((o) => {
            o.effective.mapLock = true;
        });
        expect(wirkung(sameRevision).art).toBe("weicht_ab");
        expect(wirkungTon(wirkung(umgeschaltet(120_000)))).toBe("gefahr");
    });

    it("🔴 unbekannt ist nie Normal: weder als Stellung noch in der Schiene", () => {
        const unknown = overview((o) => {
            o.effective = {
                source: "unknown",
                mode: null,
                mapLock: null,
                systemLock: null,
                revision: null,
                contentRevision: null,
                readAt: ago(40_000),
                ready: false,
            };
        });
        expect(wirkung(unknown)).toMatchObject({ art: "unbekannt", mode: null });
        expect(wirkungTon(wirkung(unknown))).toBe("ruhe");
        expect(schienenWert(unknown)).toBe("unbekannt");
        // Die Datenbank sagt Normal, die Instanz weiß es nicht: trotzdem unbekannt.
        expect(unknown.configured?.mode.mode).toBe("normal");
        // Eingestellt nicht lesbar, die Instanz aber angeblich gelesen: unbekannt statt geraten.
        expect(wirkung(overview((o) => (o.configured = null))).art).toBe("unbekannt");
        expect(schienenWert(overview((o) => (o.configured = null)))).toBe("unbekannt");
    });

    it("vor `migrate` (Tafel fehlt): es gilt Normal wie bisher, als solches gekennzeichnet", () => {
        const o = overview((base) => {
            base.configured = null;
            base.effective = { ...base.effective, source: "unprovisioned", revision: null, readAt: null };
        });
        expect(wirkung(o)).toMatchObject({ art: "gleich", mode: "normal", unprovisioned: true, alterMs: null });
        expect(schienenWert(o)).toBe("Normal");
    });

    it("die Schiene zeigt die eingestellte Stellung", () => {
        expect(schienenWert(null)).toBeUndefined();
        expect(schienenWert(overview())).toBe("Normal");
        expect(schienenWert(umgeschaltet(4_000))).toBe("Eingeschränkt");
    });

    it("nachgesehen wird nur, solange der Server nicht gleich steht", () => {
        expect(naechstesNachsehen(null)).toBeNull();
        expect(naechstesNachsehen(overview())).toBeNull();
        expect(naechstesNachsehen(umgeschaltet(4_000))).toBe(NACHSEHEN_MS.zieht_nach);
        expect(naechstesNachsehen(umgeschaltet(120_000))).toBe(NACHSEHEN_MS.weicht_ab);
    });
});

describe("Zeiten und Sätze", () => {
    it("„vor 6 s“ unter einer Minute, darüber wie die übrige Verwaltung", () => {
        expect(vorText(6_000)).toBe("vor 6 s");
        expect(vorText(0)).toBe("vor 0 s");
        expect(vorText(120_000)).toBe("vor 2 Min.");
    });

    it("seit wann, von wem, warum; die Kommandozeile und die Einrichtung haben eigene Namen", () => {
        const now = new Date(NOW);
        const setting = overview().configured!.mode;
        expect(seitText({ ...setting, since: null, reason: "Abnahme" }, now)).toBe("Rondrikan · „Abnahme“");
        expect(seitText({ since: null, by: null, byLabel: "cli:root", reason: null }, now)).toBe(
            "auf dem Server (root)",
        );
        expect(seitText({ since: null, by: null, byLabel: null, reason: null }, now)).toBe("bei der Einrichtung");
        expect(seitText({ since: NOW, by: null, byLabel: "cli:root", reason: null }, now)).toMatch(/^seit heute, /u);
    });

    it("der Rückweg nennt das Werkzeug der Umgebung (Runbook: staging, production), lokal npm", () => {
        expect(rueckwegBefehle("staging")).toEqual([
            "avesmaps3d-auth staging betrieb-normal",
            "avesmaps3d-auth staging sperre-loesen",
        ]);
        expect(rueckwegBefehle("production")[0]).toBe("avesmaps3d-auth production betrieb-normal");
        expect(rueckwegBefehle("development")).toEqual([
            "npm run auth -- betrieb-normal",
            "npm run auth -- sperre-loesen",
        ]);
        expect(rueckwegBefehle(null)[1]).toBe("npm run auth -- sperre-loesen");
    });

    it("das Protokoll spricht Umschaltungen aus", () => {
        const entry = (action: string, details: Record<string, unknown>) =>
            describeEvent({
                id: "1",
                at: NOW,
                action,
                actorKind: "person",
                actor: { id: ME, displayName: "Rondrikan" },
                actorLabel: null,
                target: null,
                targetRef: "system_state",
                details,
                recovery: false,
                operationId: null,
                clientLabel: null,
                ipPrefix: null,
            });
        expect(entry("system.mode_changed", { from: "normal", to: "restricted", reason: "Abnahme" })).toEqual({
            title: "Betrieb umgeschaltet",
            details: ["Normal → Eingeschränkt", "„Abnahme“"],
            danger: false,
        });
        expect(entry("system.lock_changed", { lock: "map", from: false, to: true, reason: null }).details).toEqual([
            "Kartensperre: Offen → Gesperrt",
        ]);
        // Die Warteschlange (WI-0160) spricht in denselben Worten wie ihr Schalter.
        expect(
            entry("system.queue_changed", { from: false, to: true, reason: "Datenbank wird gesichert" }).details,
        ).toEqual(["Läuft → Pausiert", "„Datenbank wird gesichert“"]);
        expect(entry("system.queue_changed", { from: true, to: false, reason: null }).details).toEqual([
            "Pausiert → Läuft",
        ]);
    });
});

describe("Kurzstatus „Betrieb im Moment“ (Blatt A1)", () => {
    it("vier Zeilen mit Ton und Wort", () => {
        expect(kurzstatus(overview().brief)).toEqual([
            { id: "karte", ton: "erfolg", text: "Karte erreichbar" },
            { id: "anmeldung", ton: "erfolg", text: "Anmeldung bereit" },
            { id: "routen", ton: "erfolg", text: "Routenrechner bereit" },
            { id: "warteschlange", ton: "warnung", text: "Warteschlange: 1 läuft, 0 warten" },
        ]);
    });

    it("Störungen rot, Laden gelb, aus grau; eine unlesbare Warteschlange ist unbekannt, nie leer", () => {
        const brief = {
            ...overview().brief,
            map: "failed" as const,
            login: "off" as const,
            routing: "warming" as const,
            queue: null,
        };
        expect(kurzstatus(brief).map((zeile) => [zeile.ton, zeile.text])).toEqual([
            ["gefahr", "Karte gestört"],
            ["ruhe", "Anmeldung aus"],
            ["warnung", "Routenrechner lädt"],
            ["ruhe", "Warteschlange unbekannt"],
        ]);
        expect(kurzstatus({ ...brief, routing: "failed", login: "failed" })[2]).toMatchObject({ ton: "gefahr" });
        expect(kurzstatus({ ...brief, queue: { running: 2, queued: 1 } })[3]?.text).toBe(
            "Warteschlange: 2 laufen, 1 wartet",
        );
        expect(kurzstatus({ ...brief, queue: { running: 0, queued: 0 } })[3]).toMatchObject({ ton: "erfolg" });
    });

    it("🔴 pausiert sagt die Zeile ZUERST das: „0 laufen, 3 warten“ sieht sonst aus wie ein klemmender Tag (WI-0160)", () => {
        const brief = { ...overview().brief, queue: { running: 0, queued: 3 } };
        expect(kurzstatus(brief, true)[3]).toEqual({
            id: "warteschlange",
            ton: "warnung",
            text: "Warteschlange pausiert: 3 warten",
        });
        expect(kurzstatus(brief, false)[3]?.text).toBe("Warteschlange: 0 laufen, 3 warten");
        // Eine unlesbare Warteschlange bleibt unbekannt, auch pausiert: Was man nicht weiß, wird nicht behauptet.
        expect(kurzstatus({ ...brief, queue: null }, true)[3]).toMatchObject({
            ton: "ruhe",
            text: "Warteschlange unbekannt",
        });
    });
});

describe("Die Warteschlange pausieren und fortsetzen (WI-0160)", () => {
    it("🔴 Pausieren braucht einen Grund, Fortsetzen nicht — wie Sperren und Lösen", () => {
        expect(grundPflicht({ art: "queue", ziel: true })).toBe(true);
        expect(grundPflicht({ art: "queue", ziel: false })).toBe(false);
    });

    it("🔴 die Antwort geht an die eigene Route; ohne Grund geht nichts hinaus", async () => {
        const { fetcher, posts } = server({ status: 200, body: overview() }, RECEIPT, {
            status: 200,
            body: overview(),
        });
        const betrieb = createOperations({ fetcher, ask: async () => true });
        await betrieb.load();
        betrieb.ask({ art: "queue", ziel: true });
        expect(await betrieb.confirm()).toEqual({ ok: false, problems: [{ key: "admin.system.reason.missing" }] });
        expect(posts()).toEqual([]);

        betrieb.setGrund(" Datenbank wird gesichert ");
        expect(await betrieb.confirm()).toEqual({ ok: true, problems: [] });
        const [erster] = posts();
        expect(erster?.url).toBe("/api/admin/system/queue");
        expect(erster?.body).toEqual({
            operationId: expect.any(String),
            baseRevision: 7,
            paused: true,
            reason: "Datenbank wird gesichert",
        });
    });

    it("Fortsetzen geht ohne Grund hinaus", async () => {
        const { fetcher, posts } = server(
            { status: 200, body: overview((o) => void (o.configured!.queuePause.paused = true)) },
            RECEIPT,
            { status: 200, body: overview() },
        );
        const betrieb = createOperations({ fetcher, ask: async () => true });
        await betrieb.load();
        betrieb.ask({ art: "queue", ziel: false });
        expect(await betrieb.confirm()).toEqual({ ok: true, problems: [] });
        expect(posts()[0]?.body).toEqual({ operationId: expect.any(String), baseRevision: 7, paused: false });
    });
});

describe("Grund und Schutzregeln", () => {
    it("🔴 Einschränken und Sperren verlangen einen Grund, zurückschalten und lösen nicht", () => {
        expect(grundPflicht({ art: "mode", ziel: "restricted" })).toBe(true);
        expect(grundPflicht({ art: "mode", ziel: "normal" })).toBe(false);
        expect(grundPflicht({ art: "lock", lock: "map", ziel: true })).toBe(true);
        expect(grundPflicht({ art: "lock", lock: "system", ziel: false })).toBe(false);
    });

    it("🔴 1 bis 300 Zeichen nach dem Kürzen, gezählt wie der Server (Zeichen, nicht UTF-16)", () => {
        expect(grundProblem("", true)).toBe("admin.system.reason.missing");
        expect(grundProblem("   ", true)).toBe("admin.system.reason.missing");
        expect(grundProblem("", false)).toBeUndefined();
        expect(grundProblem("x", true)).toBeUndefined();
        expect(grundProblem("x".repeat(300), true)).toBeUndefined();
        expect(grundProblem("x".repeat(301), true)).toBe("admin.system.reason.tooLong");
        expect(grundProblem(` ${"x".repeat(300)} `, true)).toBeUndefined();
        // 300 Emoji sind 600 UTF-16-Einheiten, aber 300 Zeichen.
        expect(grundProblem("🗺".repeat(300), true)).toBeUndefined();
        expect(grundProblem("x".repeat(301), false)).toBe("admin.system.reason.tooLong");
    });

    it("🔴 wer einschränkt, muss selbst hineinkommen; mindestens ein Inhaber braucht einen Passkey", () => {
        const frage = { art: "mode", ziel: "restricted" } as const;
        expect(schutzProblem(frage, overview(), ME)).toBeUndefined();
        expect(schutzProblem(frage, overview(), "jemand-anderes")).toBe("admin.system.error.wouldLockOutSelf");
        expect(schutzProblem(frage, overview(), undefined)).toBe("admin.system.error.wouldLockOutSelf");
        const ohnePasskey = overview((o) => {
            o.restrictedAccessHolders = o.restrictedAccessHolders.map((holder) => ({ ...holder, hasPasskey: false }));
        });
        expect(schutzProblem(frage, ohnePasskey, ME)).toBe("admin.system.error.noHolder");
        // Zurückschalten und Sperren kennen diese Regeln nicht.
        expect(schutzProblem({ art: "mode", ziel: "normal" }, ohnePasskey, "jemand-anderes")).toBeUndefined();
        expect(schutzProblem({ art: "lock", lock: "map", ziel: true }, ohnePasskey, undefined)).toBeUndefined();
    });

    it("die Folge nennt die Inhaber namentlich (Blatt A4), mit oder ohne Passkey, und kürzt lange Listen", () => {
        const holders = overview().restrictedAccessHolders;
        expect(inhaberText(holders)).toBe("Hesindiane und Rondrikan (beide mit Passkey)");
        expect(inhaberText(holders.slice(0, 1))).toBe("Hesindiane (mit Passkey)");
        expect(inhaberText([{ ...holders[0]!, hasPasskey: false }, holders[1]!])).toBe(
            "Rondrikan (mit Passkey) und Hesindiane (ohne Passkey)",
        );
        expect(inhaberText(holders.map((holder) => ({ ...holder, hasPasskey: false })))).toBe(
            "Hesindiane und Rondrikan (keiner mit Passkey)",
        );
        const viele = Array.from({ length: 8 }, (_, index) => ({
            person: { id: String(index), displayName: `Person ${String(index + 1)}` },
            hasPasskey: true,
        }));
        expect(inhaberText(viele)).toBe(
            "Person 1, Person 2, Person 3, Person 4, Person 5, Person 6 und 2 weitere (alle mit Passkey)",
        );
        expect(inhaberText([])).toBe("niemand");
    });
});

// --- Bestätigungsfluss gegen einen nachgebauten Server ------------------------------------------------------------------------------

type Answer = { status: number; body?: unknown };
const envelope = (code: string, details?: Record<string, unknown>) => ({
    error: { code, message: "vom Server", details },
});
const RECEIPT: Answer = { status: 200, body: { status: "applied" } };
const PASSKEY_NEEDED: Answer = { status: 403, body: envelope("reauth_required", { need: "passkey" }) };

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
    return { calls, fetcher: fetcher as typeof fetch, posts: () => calls.filter((call) => call.method === "POST") };
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

describe("Bestätigungsfluss", () => {
    it("🔴 Einschränken: Grund Pflicht, dann verlangt der Server den Passkey, die Wiederholung trägt dieselbe Kennung; danach neu geladen", async () => {
        const after = umgeschaltet(0, (o) => {
            o.effective.mode = "restricted";
            o.effective.revision = 8;
        });
        const { calls, fetcher, posts } = server({ status: 200, body: overview() }, PASSKEY_NEEDED, RECEIPT, {
            status: 200,
            body: after,
        });
        const asked: Need[] = [];
        const betrieb = createOperations({
            fetcher,
            ask: async (need) => {
                asked.push(need);
                return true;
            },
        });
        await betrieb.load();
        betrieb.ask({ art: "mode", ziel: "restricted" });
        // Ohne Grund geht nichts hinaus.
        expect(await betrieb.confirm()).toEqual({ ok: false, problems: [{ key: "admin.system.reason.missing" }] });
        expect(posts()).toEqual([]);

        betrieb.setGrund("  Wiederherstellung prüfen ");
        expect(await betrieb.confirm()).toEqual({ ok: true, problems: [] });
        expect(asked).toEqual(["passkey"]);
        const [first, second] = posts();
        expect(first?.url).toBe("/api/admin/system/mode");
        expect(first?.body).toEqual({
            operationId: expect.any(String),
            baseRevision: 7,
            mode: "restricted",
            reason: "Wiederherstellung prüfen",
        });
        expect(second?.body).toEqual(first?.body);
        expect(calls.at(-1)).toMatchObject({ url: "/api/admin/system", method: "GET" });
        expect(betrieb.frage.value).toBeNull();
        expect(betrieb.grund.value).toBe("");
        expect(betrieb.ergebnis.value).toBeNull();
        expect(betrieb.overview.value?.configured?.mode.mode).toBe("restricted");
        expect(betrieb.busy.value).toBe(false);
    });

    it("🔴 Passkey abgebrochen: nichts geschaltet, die Frage bleibt mit ihrem Grund offen", async () => {
        const { fetcher, posts } = server({ status: 200, body: overview() }, PASSKEY_NEEDED, {
            status: 200,
            body: overview(),
        });
        const betrieb = createOperations({ fetcher, ask: async () => false });
        await betrieb.load();
        betrieb.ask({ art: "mode", ziel: "restricted" });
        betrieb.setGrund("Abnahme");
        const result = await betrieb.confirm();
        expect(result).toEqual({ ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] });
        expect(posts()).toHaveLength(1);
        expect(betrieb.frage.value).toEqual({ art: "mode", ziel: "restricted" });
        expect(betrieb.grund.value).toBe("Abnahme");
        expect(betrieb.ergebnis.value).toEqual({ ort: "mode", result });
    });

    it("🔴 die Fachcodes werden zu Sätzen: Selbstaussperrung, kein Inhaber mit Passkey, Zustand unbekannt, Grund fehlt", async () => {
        const cases: [Answer, string][] = [
            [{ status: 409, body: envelope("would_lock_out_self") }, "admin.system.error.wouldLockOutSelf"],
            [{ status: 409, body: envelope("no_restricted_access_holder") }, "admin.system.error.noHolder"],
            [{ status: 503, body: envelope("system_state_unknown") }, "admin.system.error.unknown"],
            [{ status: 400, body: envelope("reason_required") }, "admin.error.reasonRequired"],
        ];
        for (const [answer, key] of cases) {
            const { fetcher } = server({ status: 200, body: overview() }, answer, { status: 200, body: overview() });
            const betrieb = createOperations({ fetcher, ask: async () => true });
            await betrieb.load();
            betrieb.ask({ art: "mode", ziel: "restricted" });
            betrieb.setGrund("Abnahme");
            expect(await betrieb.confirm(), key).toEqual({ ok: false, problems: [{ key }] });
            // Die Frage bleibt offen: der Grund geht nicht verloren.
            expect(betrieb.frage.value).not.toBeNull();
            expect(betrieb.ergebnis.value?.ort).toBe("mode");
        }
    });

    it("🔴 Konflikt: jemand war schneller; Wer und Wann stehen da, die Frage schließt, der neue Stand ist geladen", async () => {
        const { fetcher } = server(
            { status: 200, body: overview() },
            {
                status: 409,
                body: envelope("edit_conflict", {
                    changedBy: { id: HESINDIANE, displayName: "Hesindiane" },
                    changedAt: ago(3_000),
                }),
            },
            { status: 200, body: umgeschaltet(3_000) },
        );
        const betrieb = createOperations({ fetcher, ask: async () => true });
        await betrieb.load();
        betrieb.ask({ art: "lock", lock: "map", ziel: true });
        betrieb.setGrund("Datenübernahme prüfen");
        const result = await betrieb.confirm();
        expect(result).toMatchObject({ ok: false, conflict: { by: "Hesindiane", at: ago(3_000) } });
        expect(betrieb.frage.value).toBeNull();
        expect(betrieb.ergebnis.value?.ort).toBe("map");
        expect(betrieb.overview.value?.configured?.revision).toBe(8);
    });

    it("Sperren und Lösen schicken Sperre, Richtung und den Grund nur, wenn einer dasteht", async () => {
        const { fetcher, posts } = server(
            { status: 200, body: overview() },
            RECEIPT,
            { status: 200, body: overview() },
            RECEIPT,
            { status: 200, body: overview() },
        );
        const betrieb = createOperations({ fetcher, ask: async () => true });
        await betrieb.load();
        betrieb.ask({ art: "lock", lock: "system", ziel: true });
        betrieb.setGrund("Rechte prüfen");
        await betrieb.confirm();
        betrieb.ask({ art: "lock", lock: "system", ziel: false });
        await betrieb.confirm();
        expect(posts().map((call) => [call.url, call.body])).toEqual([
            [
                "/api/admin/system/lock",
                {
                    operationId: expect.any(String),
                    baseRevision: 7,
                    lock: "system",
                    locked: true,
                    reason: "Rechte prüfen",
                },
            ],
            [
                "/api/admin/system/lock",
                { operationId: expect.any(String), baseRevision: 7, lock: "system", locked: false },
            ],
        ]);
        expect(posts()[0]?.body?.["operationId"]).not.toBe(posts()[1]?.body?.["operationId"]);
    });

    it("🔴 fehlt beim Laden der zweite Faktor, wird gefragt; abgebrochen steht, was fehlt, der alte Stand bleibt, kein Nachsehen", async () => {
        const clock = timers();
        const { calls, fetcher } = server(
            { status: 200, body: umgeschaltet(4_000) },
            { status: 403, body: envelope("assurance_required") },
            { status: 403, body: envelope("assurance_required") },
            { status: 200, body: overview() },
        );
        const asked: Need[] = [];
        let answer = false;
        const betrieb = createOperations({
            fetcher,
            ...clock,
            ask: async (need) => {
                asked.push(need);
                return answer;
            },
        });
        betrieb.follow(true);
        await betrieb.load();
        expect(clock.pending).toHaveLength(1);
        await betrieb.load();
        expect(asked).toEqual(["second_factor"]);
        expect(betrieb.loadProblems.value).toEqual([{ key: "auth.form.assurance" }]);
        expect(betrieb.unconfirmed.value).toBe("second_factor");
        expect(betrieb.overview.value?.configured?.revision).toBe(8);
        // Unbestätigt sieht der Eintrag nicht von selbst nach (jedes Nachsehen endete wieder ohne Bestätigung).
        expect(clock.pending).toHaveLength(0);
        // Der Knopf „Bestätigen“ bietet es erneut an; bestätigt, lädt der Eintrag neu.
        answer = true;
        betrieb.confirmAgain();
        await vi.waitFor(() => expect(betrieb.unconfirmed.value).toBeNull());
        expect(asked).toEqual(["second_factor", "second_factor"]);
        expect(calls.filter((call) => call.url === "/api/admin/system")).toHaveLength(4);
        expect(betrieb.loadProblems.value).toEqual([]);
        expect(betrieb.overview.value?.configured?.revision).toBe(7);
    });

    it("🔴 Nachsehen: nur solange der Eintrag offen ist und der Server nicht gleich steht", async () => {
        const clock = timers();
        const { calls, fetcher } = server(
            { status: 200, body: umgeschaltet(4_000) },
            { status: 200, body: umgeschaltet(30_000) },
            {
                status: 200,
                body: umgeschaltet(32_000, (o) => {
                    o.effective.mode = "restricted";
                    o.effective.revision = 8;
                }),
            },
        );
        const betrieb = createOperations({ fetcher, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
        /** Der Zeitgeber läuft ab: er verschwindet aus der Liste, dann ruft er. */
        const tick = async (): Promise<void> => {
            clock.pending.shift()!.callback();
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        };
        await betrieb.load();
        // Nicht offen: kein Nachsehen.
        expect(clock.pending).toEqual([]);
        betrieb.follow(true);
        expect(clock.pending.map((entry) => entry.ms)).toEqual([NACHSEHEN_MS.zieht_nach]);
        // Der Server zieht nicht nach: nach zwei Takten heißt es „weicht ab“, und der Eintrag sieht seltener nach.
        await tick();
        expect(calls).toHaveLength(2);
        expect(wirkung(betrieb.overview.value!).art).toBe("weicht_ab");
        expect(clock.pending.map((entry) => entry.ms)).toEqual([NACHSEHEN_MS.weicht_ab]);
        // Jetzt steht er gleich (eingeschränkt, Revision 8): kein weiteres Nachsehen.
        await tick();
        expect(calls).toHaveLength(3);
        expect(wirkung(betrieb.overview.value!).art).toBe("gleich");
        expect(clock.pending).toEqual([]);
        // Geschlossen: auch bei einem Server, der nachzieht, kein Zeitgeber.
        betrieb.follow(false);
        expect(clock.pending).toEqual([]);
    });
});

describe("der Schalter in der Hülle des Hauses (Guide §30.2, §30.5)", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const segmente = readFileSync(join(root, "apps/web/src/controls/avm-segmente.vue"), "utf8");

    it("🔴 gesperrt ist eine eigene Farbfassung, nie Deckkraft, und antwortet nicht auf Zeigen oder Drücken", () => {
        expect(segmente).toMatch(
            /\.segmente__segment:disabled \{\s*background: var\(--color-disabled-bg\);\s*color: var\(--color-disabled-text\);/u,
        );
        expect(segmente).not.toMatch(/opacity/u);
        expect(segmente).toContain(".segmente__segment:not(.is-active):not(:disabled):hover");
        expect(segmente).toContain(".segmente__segment:not(.is-active):not(:disabled):active");
        // Gewähltes bleibt gefüllt, auch gesperrt: die Regel steht nach der Sperre.
        expect(segmente.indexOf(".segmente__segment.is-active {")).toBeGreaterThan(
            segmente.indexOf(".segmente__segment:disabled {"),
        );
    });

    it("gestapelt stehen die Segmente untereinander, die Mulde bleibt", () => {
        expect(segmente).toMatch(/\.segmente--gestapelt \{\s*grid-auto-flow: row;\s*\}/u);
    });
});
