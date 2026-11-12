import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AdminSicherung } from "@avesmaps3d/shared";
import {
    NACHSEHEN_MS,
    anstossSatz,
    aufbewahrungText,
    createSicherung,
    felder,
    fehlerSatz,
    sperrSatz,
    teilName,
    zustandName,
    zustandTon,
} from "../src/auth/sicherung.ts";

/**
 * Der Eintrag „Backups“ (WI-0127 SYS-9) ohne Browser: Zustände, Felder, der Satz unter „Sicherung jetzt“ (angefordert, noch nicht
 * abgeholt, läuft, fertig, verworfen), der Grund eines gesperrten Knopfs und der Ablauf gegen einen nachgebauten Server.
 */

const NOW = new Date("2026-10-10T14:30:00Z");
const EIGENE = "8b0e2f4c-6a1d-4e3b-9c5f-7d8a9b0c1d2e";

function stand(patch: Partial<AdminSicherung> = {}): AdminSicherung {
    const body: AdminSicherung = {
        now: NOW.toISOString(),
        zustand: "aktuell",
        stand: "2026-10-10T03:33:12Z",
        letzterLauf: {
            startedAt: "2026-10-10T03:30:01Z",
            finishedAt: "2026-10-10T03:33:12Z",
            result: "ok",
            errorCode: null,
            trigger: "timer",
            operationId: null,
        },
        letzteErfolgreiche: "2026-10-10T03:33:12Z",
        ausserHaus: { eingerichtet: true, geprueftAm: "2026-10-10T03:33:11Z" },
        probelauf: { at: "2026-10-10T11:05:00Z", result: "ok" },
        naechsterLauf: "2026-10-11T01:30:00Z",
        aufbewahrung: { local: 3, daily: 7, weekly: 4, monthly: 6 },
        teile: [],
        neueresFormat: false,
        anstossen: { moeglich: true, wartend: null, letzteAntwort: null },
        ...patch,
    };
    // Jede Vorlage gegen den Vertrag: der Nachbau sagt nichts, was der Server nicht sagen kann.
    expect(Value.Check(AdminSicherung, body)).toBe(true);
    return body;
}

const LAEUFT = stand({
    zustand: "laeuft",
    letzterLauf: {
        startedAt: "2026-10-10T14:29:00Z",
        finishedAt: null,
        result: "running",
        errorCode: null,
        trigger: "manual",
        operationId: EIGENE,
    },
});

describe("Zustände und Felder (§6.5)", () => {
    it("sechs Zustände mit Namen und Ton", () => {
        expect(zustandName("nicht_eingerichtet")).toBe("nicht eingerichtet");
        expect(zustandName("ueberfaellig")).toBe("überfällig");
        expect(zustandTon("aktuell")).toBe("erfolg");
        expect(zustandTon("fehlgeschlagen")).toBe("gefahr");
        expect(zustandTon("ueberfaellig")).toBe("warnung");
        expect(zustandTon("nicht_eingerichtet")).toBe("ruhe");
    });

    it("🔴 die Felder: unbekannt heißt „unbekannt“, nie 0; der Anstoß steht an der letzten Sicherung", () => {
        const werte = Object.fromEntries(felder(stand(), NOW).map((feld) => [feld.id, feld.wert]));
        expect(werte["letzte"]).toMatch(/täglich$/u);
        expect(werte["ausser-haus"]).toMatch(/^Dropbox, geprüft /u);
        expect(werte["probelauf"]).toMatch(/^bestanden, /u);
        expect(werte["aufbewahrung"]).toBe("3 hier · 7 täglich · 4 wöchentlich · 6 monatlich");
        const leer = Object.fromEntries(
            felder(
                stand({
                    letzteErfolgreiche: null,
                    ausserHaus: { eingerichtet: null, geprueftAm: null },
                    probelauf: null,
                    naechsterLauf: null,
                    aufbewahrung: null,
                }),
                NOW,
            ).map((feld) => [feld.id, feld.wert]),
        );
        expect(leer).toEqual({
            letzte: "noch keine",
            "ausser-haus": "unbekannt",
            probelauf: "noch keiner",
            naechster: "unbekannt",
            aufbewahrung: "unbekannt",
        });
        expect(aufbewahrungText({ local: 3, daily: null, weekly: 4, monthly: 6 })).toBe(
            "3 hier · ? täglich · 4 wöchentlich · 6 monatlich",
        );
        expect(teilName("db")).toBe("Datenbanken");
        expect(teilName("neu")).toBe("neu");
    });

    it("ein gescheiterter Lauf mit dem Namen seines Fehlers", () => {
        const gescheitert = stand({
            zustand: "fehlgeschlagen",
            letzterLauf: { ...stand().letzterLauf!, result: "failed", errorCode: "offsite_failed" },
        });
        expect(fehlerSatz(gescheitert, NOW)).toMatch(/gescheitert: .* · Kopie außer Haus gescheitert$/u);
        expect(fehlerSatz(stand(), NOW)).toBeNull();
    });
});

describe("Der Satz unter „Sicherung jetzt“ (§9e Anzeige)", () => {
    it("🔴 angefordert; nach 60 s „noch nicht abgeholt“", () => {
        const wartend = (sekunden: number) =>
            stand({
                anstossen: {
                    moeglich: true,
                    wartend: {
                        operationId: EIGENE,
                        requestedAt: new Date(NOW.getTime() - sekunden * 1000).toISOString(),
                    },
                    letzteAntwort: null,
                },
            });
        expect(anstossSatz(wartend(59), EIGENE, NOW)).toEqual({
            text: "Angefordert, wartet auf die Abholung.",
            ton: "leise",
        });
        expect(anstossSatz(wartend(60), EIGENE, NOW)).toMatchObject({ ton: "warnung" });
        expect(anstossSatz(wartend(60), EIGENE, NOW)?.text).toContain("noch nicht abgeholt");
    });

    it("🔴 läuft, sobald result=running; mit der eigenen operation_id „Läuft seit …“, danach „Fertig“", () => {
        expect(anstossSatz(LAEUFT, EIGENE, NOW)?.text).toMatch(/^Läuft seit /u);
        expect(anstossSatz(LAEUFT, null, NOW)?.text).toMatch(/^Eine Sicherung läuft seit /u);
        const fertig = stand({
            letzterLauf: { ...LAEUFT.letzterLauf!, finishedAt: "2026-10-10T14:29:50Z", result: "ok" },
        });
        expect(anstossSatz(fertig, EIGENE, NOW)).toMatchObject({ ton: "gut" });
        expect(anstossSatz(fertig, EIGENE, NOW)?.text).toMatch(/^Fertig: /u);
        // Ohne eigenen Auftrag sagt die Zeile nichts über einen fertigen Lauf (das steht in den Feldern).
        expect(anstossSatz(fertig, null, NOW)).toBeNull();
    });

    it("verworfen: lief schon, zu früh; abgeholt ohne Antwort: „beginnt gleich“", () => {
        const antwort = (result: "laeuft_schon" | "zu_frueh" | "angenommen") =>
            stand({
                anstossen: {
                    moeglich: true,
                    wartend: null,
                    letzteAntwort: { operationId: EIGENE, at: NOW.toISOString(), result },
                },
            });
        expect(anstossSatz(antwort("zu_frueh"), EIGENE, NOW)?.text).toContain("jünger als 30 Minuten");
        expect(anstossSatz(antwort("laeuft_schon"), EIGENE, NOW)?.text).toContain("lief schon");
        expect(anstossSatz(antwort("angenommen"), EIGENE, NOW)?.text).toBe("Abgeholt, die Sicherung beginnt gleich.");
        // Die Antwort auf einen fremden Auftrag gehört nicht in diese Sitzung.
        expect(anstossSatz(antwort("zu_frueh"), "fremd", NOW)?.text).toBe("Abgeholt, die Sicherung beginnt gleich.");
    });

    it("🔴 gesperrt mit Satz: ohne Recht, ohne Sicherung auf der Umgebung, Auftrag liegt, Sicherung läuft", () => {
        expect(sperrSatz(stand(), false)).toBe("Anstoßen darf nur, wer das Recht „Sicherung anstoßen“ hat.");
        expect(sperrSatz(stand({ anstossen: { moeglich: false, wartend: null, letzteAntwort: null } }), true)).toBe(
            "Auf dieser Umgebung gibt es keine Sicherung.",
        );
        expect(
            sperrSatz(
                stand({
                    anstossen: {
                        moeglich: true,
                        wartend: { operationId: "x", requestedAt: NOW.toISOString() },
                        letzteAntwort: null,
                    },
                }),
                true,
            ),
        ).toBe("Ein Auftrag wartet auf die Abholung.");
        expect(sperrSatz(LAEUFT, true)).toBe("Eine Sicherung läuft gerade.");
        expect(sperrSatz(stand(), true)).toBeUndefined();
    });
});

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

const RECEIPT: Answer = {
    status: 200,
    body: {
        operationId: EIGENE,
        status: "applied",
        environment: "test",
        affected: [],
        derivedWork: [],
        warnings: [],
    },
};

describe("Ablauf", () => {
    it("🔴 „Sicherung jetzt“ schickt eine neue Kennung, merkt sie und sieht nach, bis die Antwort da ist", async () => {
        const clock = timers();
        const wartend = stand({
            anstossen: {
                moeglich: true,
                wartend: { operationId: "?", requestedAt: NOW.toISOString() },
                letzteAntwort: null,
            },
        });
        const { calls, fetcher } = server({ status: 200, body: stand() }, RECEIPT, { status: 200, body: wartend });
        const sicherung = createSicherung({
            fetcher,
            ask: async () => true,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });
        sicherung.follow(true);
        await sicherung.load();
        expect(clock.pending).toEqual([]);
        expect((await sicherung.start()).ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/backup/start");
        expect(post?.body?.["operationId"]).toMatch(/^[0-9a-f-]{36}$/u);
        expect(sicherung.eigene.value).toBe(post?.body?.["operationId"]);
        // Der Auftrag liegt: nachsehen.
        expect(clock.pending.map((entry) => entry.ms)).toEqual([NACHSEHEN_MS]);
        sicherung.follow(false);
        expect(clock.pending).toEqual([]);
    });

    it("liegt schon ein Auftrag: der Satz des Servers, keine eigene Kennung", async () => {
        const { fetcher } = server(
            { status: 200, body: stand() },
            { status: 409, body: envelope("backup_pending") },
            { status: 200, body: stand() },
        );
        const sicherung = createSicherung({ fetcher, ask: async () => true });
        await sicherung.load();
        expect(await sicherung.start()).toEqual({ ok: false, problems: [{ key: "admin.backup.error.pending" }] });
        expect(sicherung.eigene.value).toBeNull();
        expect(sicherung.ergebnis.value).toEqual({ ok: false, problems: [{ key: "admin.backup.error.pending" }] });
    });
});
