import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    AbzugSicht,
    type AbzugLink,
    type AbzugSchluessel,
    type AbzugSichtEinspielen,
    type AbzugSichtErstellen,
} from "@avesmaps3d/shared";
import {
    NACHSEHEN_MS,
    abzugKreis,
    anlegenSperre,
    createAbzug,
    dateiWegErzwungen,
    einspielenSperre,
    einspielenUnterzeile,
    ergebnisMedien,
    erstellenSperre,
    erstellenUnterzeile,
    faktenMitMedien,
    fortschritt,
    groesseText,
    holenQuelleGerade,
    holenSperre,
    problemSatz,
    quellenName,
    schluesselTitel,
    schluesselUnterzeile,
} from "../src/auth/abzug.ts";

/**
 * Der Abzug für lokal im Datenabgleich (WI-0251) ohne Browser: die Unterzeile je Lage, der Grund eines gesperrten Knopfs, und der Ablauf gegen einen
 * nachgebauten Server (Erstellen mit Frage und Kennung, Herunterladen über einen Link, Datei hinlegen, Einspielen mit der Kennung der Datei, 409,
 * 404 heißt „diese Umgebung hat keine Rolle“, Nachsehen nur solange etwas läuft).
 */

const NOW = new Date("2026-10-24T14:30:00Z");
const JOB = "7e570000-0000-4000-8000-0000000000a1";

const AUSGELOEST = { art: "person" as const, name: "Rondrikan" };

function erstellen(patch: Partial<AbzugSichtErstellen> = {}): AbzugSichtErstellen {
    const sicht: AbzugSichtErstellen = {
        rolle: "erstellen",
        jetzt: NOW.toISOString(),
        umgebung: "staging",
        ablage: true,
        planerAktiv: true,
        laufend: null,
        letzter: null,
        abzuege: [],
        schluessel: [],
        ...patch,
    };
    // Jede Vorlage gegen den Vertrag: der Nachbau sagt nichts, was der Server nicht sagen kann.
    expect(Value.Check(AbzugSicht, sicht)).toBe(true);
    return sicht;
}

const EINGANG = {
    name: "avesmaps-abzug-production.tar",
    bytes: 312 * 1024 * 1024,
    kennung: "20261024T120000Z-abcdef12",
    quelle: "production" as const,
    erstellt: "2026-10-24T12:00:00Z",
    tafeln: 143,
    zeilen: 1_204_331,
    medien: 3372,
    medienBytes: 243 * 1024 * 1024,
    medienFehlend: 0,
    probleme: [],
};

function einspielen(patch: Partial<AbzugSichtEinspielen> = {}): AbzugSichtEinspielen {
    const sicht: AbzugSichtEinspielen = {
        rolle: "einspielen",
        jetzt: NOW.toISOString(),
        ablage: true,
        sicherung: true,
        eingang: null,
        lauf: null,
        schluessel: { staging: false, production: false },
        ...patch,
    };
    expect(Value.Check(AbzugSicht, sicht)).toBe(true);
    return sicht;
}

const LETZTER = {
    jobId: JOB,
    state: "SUCCEEDED" as const,
    startedAt: "2026-10-24T14:00:00Z",
    finishedAt: "2026-10-24T14:05:00Z",
    ausgeloest: AUSGELOEST,
    luecken: null,
    befunde: null,
    satz: null,
    fehler: null,
};

describe("Unterzeile und Fortschritt", () => {
    it("Stage und Production: nie, fertig mit Person, gescheitert mit Fehler, wartend mit Grund, laufend mit Stufe und Prozent", () => {
        expect(erstellenUnterzeile(erstellen(), NOW)).toEqual({ text: "Noch nie ein Abzug erstellt", ton: "leise" });
        const fertig = erstellenUnterzeile(erstellen({ letzter: LETZTER }), NOW);
        expect(fertig.ton).toBe("gut");
        expect(fertig.text).toMatch(/^Letzter Abzug: heute, \d\d:\d\d · ausgelöst von Rondrikan$/u);
        const gescheitert = erstellenUnterzeile(
            erstellen({ letzter: { ...LETZTER, state: "FAILED", fehler: "Zu wenig Platz in der Ablage" } }),
            NOW,
        );
        expect(gescheitert.ton).toBe("warnung");
        expect(gescheitert.text).toMatch(
            /^Letzter Abzug gescheitert: heute, \d\d:\d\d · Zu wenig Platz in der Ablage$/u,
        );
        const wartet = erstellenUnterzeile(
            erstellen({
                laufend: {
                    jobId: JOB,
                    state: "QUEUED",
                    queuedAt: NOW.toISOString(),
                    startedAt: null,
                    phase: null,
                    progress: null,
                    waitReason: "waits_pickup",
                    ausgeloest: AUSGELOEST,
                    platz: 2,
                },
            }),
            NOW,
        );
        expect(wartet.ton).toBe("warnung");
        expect(wartet.text).toMatch(/^Wartet · Platz 2 · /u);
        const laeuft = erstellen({
            laufend: {
                jobId: JOB,
                state: "RUNNING",
                queuedAt: NOW.toISOString(),
                startedAt: NOW.toISOString(),
                phase: "packen",
                progress: 0.8,
                waitReason: null,
                ausgeloest: AUSGELOEST,
            },
        });
        expect(erstellenUnterzeile(laeuft, NOW).text).toMatch(/^Läuft seit heute, \d\d:\d\d · Packen · 80 %$/u);
        expect(fortschritt(laeuft)).toBe(80);
        expect(fortschritt(erstellen())).toBeNull();
        expect(abzugKreis(erstellen({ letzter: LETZTER }))).toBe("voll");
        expect(abzugKreis(erstellen({ letzter: { ...LETZTER, state: "FAILED" } }))).toBe("leer");
        expect(abzugKreis(null)).toBe("leer");
    });

    it("lokal: noch nie, läuft mit Stufe und Tafel, eingespielt mit Zeilen, gescheitert mit dem Satz des Servers", () => {
        expect(einspielenUnterzeile(einspielen(), NOW)).toEqual({
            text: "Noch nie ein Abzug eingespielt",
            ton: "leise",
        });
        const lauf = {
            kennung: EINGANG.kennung,
            zustand: "laeuft" as const,
            phase: "laden" as const,
            tafel: "public.place",
            fortschritt: 0.4,
            seit: "2026-10-24T14:20:00Z",
            ende: null,
            zeilen: null,
            sicherung: "vorher-x.dump",
            meldung: null,
        };
        const laeuft = einspielen({ eingang: EINGANG, lauf });
        expect(einspielenUnterzeile(laeuft, NOW).text).toMatch(
            /^Läuft seit heute, \d\d:\d\d · Laden · public\.place · 40 %$/u,
        );
        expect(fortschritt(laeuft)).toBe(40);
        const fertig = einspielen({
            lauf: {
                ...lauf,
                zustand: "fertig",
                phase: "fertig",
                tafel: null,
                fortschritt: 1,
                ende: "2026-10-24T14:25:00Z",
                zeilen: 1_204_331,
            },
        });
        const text = einspielenUnterzeile(fertig, NOW);
        expect(text.ton).toBe("gut");
        expect(text.text).toMatch(/^Zuletzt eingespielt: heute, \d\d:\d\d$/u);
        expect(abzugKreis(fertig)).toBe("voll");
        const fehler = einspielen({
            lauf: {
                ...lauf,
                zustand: "fehler",
                ende: "2026-10-24T14:25:00Z",
                meldung: "Das Laden von public.place scheiterte. Nichts wurde verändert.",
            },
        });
        expect(einspielenUnterzeile(fehler, NOW).ton).toBe("warnung");
        // Der Satz des Fehlers steht in der Ergebniszeile darunter, nicht noch einmal in der Unterzeile.
        expect(einspielenUnterzeile(fehler, NOW).text).toMatch(/^Das Einspielen scheiterte: heute, \d\d:\d\d$/u);
        expect(abzugKreis(fehler)).toBe("leer");
    });

    it("🔴 Mediendateien: die Fakten tragen Anzahl und Größe, das Ergebnis nennt, was abgelegt ist, und bei Offenem „Medien unvollständig“ mit der Zahl", () => {
        // Ohne Mediendateien bleibt der Satz, wie er ist.
        expect(faktenMitMedien("318 MB · 143 Tafeln", 0, 0)).toBe("318 MB · 143 Tafeln");
        expect(faktenMitMedien("318 MB · 143 Tafeln", 3372, 243 * 1024 * 1024)).toBe(
            "318 MB · 143 Tafeln · 3.372 Mediendateien · 243 MB",
        );
        expect(faktenMitMedien("x", 3372, 243 * 1024 * 1024, 12)).toBe(
            "x · 3.372 Mediendateien · 243 MB · 12 fehlten schon an der Quelle",
        );
        const lauf = {
            kennung: EINGANG.kennung,
            zustand: "fertig" as const,
            phase: "fertig" as const,
            tafel: null,
            fortschritt: 1,
            seit: "2026-10-24T14:20:00Z",
            ende: "2026-10-24T14:25:00Z",
            zeilen: 1_204_331,
            sicherung: "vorher-x.dump",
            meldung: null,
        };
        // Ein Lauf ohne Angaben zu Medien (älterer Stand) oder ohne Mediendateien sagt dazu nichts.
        expect(ergebnisMedien(lauf)).toBeNull();
        expect(ergebnisMedien({ ...lauf, medien: null })).toBeNull();
        expect(ergebnisMedien({ ...lauf, medien: { dateien: 0, geschrieben: 0, offen: 0, bytes: 0 } })).toBeNull();
        expect(
            ergebnisMedien({
                ...lauf,
                medien: { dateien: 3372, geschrieben: 3372, offen: 0, bytes: 243 * 1024 * 1024 },
            }),
        ).toEqual({
            text: "3.372 Mediendateien · 243 MB neu abgelegt",
            ton: "leise",
        });
        const offen = { ...lauf, medien: { dateien: 3372, geschrieben: 3300, offen: 72, bytes: 200 * 1024 * 1024 } };
        expect(ergebnisMedien(offen)).toEqual({
            text: "Medien unvollständig: 72 von 3.372 Mediendateien liegen noch nicht. Dieselbe Datei noch einmal einspielen holt sie nach.",
            ton: "warnung",
        });
        // Ein Fehler hat keine Mediendateien abgelegt, der Satz des Fehlers steht allein.
        expect(ergebnisMedien({ ...offen, zustand: "fehler" })).toBeNull();
        // Die Datenbank ist ersetzt, aber der Lauf ist nicht grün: Unterzeile warnt, der Kreis bleibt leer; der Knopf bleibt für das erneute Einspielen.
        const sicht = einspielen({ eingang: EINGANG, lauf: offen });
        expect(einspielenUnterzeile(sicht, NOW).ton).toBe("warnung");
        expect(abzugKreis(sicht)).toBe("leer");
        expect(einspielenSperre(sicht, true)).toBeUndefined();
        const vollstaendig = einspielen({
            lauf: { ...offen, medien: { ...offen.medien, offen: 0, geschrieben: 3372 } },
        });
        expect(einspielenUnterzeile(vollstaendig, NOW).ton).toBe("gut");
        expect(abzugKreis(vollstaendig)).toBe("voll");
    });

    it("Größen in der Sprache der Seite", () => {
        expect(groesseText(512)).toBe("512 B");
        expect(groesseText(312 * 1024 * 1024)).toBe("312 MB");
        expect(groesseText(1.5 * 1024 * 1024 * 1024)).toBe("1,5 GB");
    });
});

describe("Knopf: warum er gesperrt ist", () => {
    it("Erstellen: ohne Recht, ohne Ablage und solange einer wartet oder läuft; sonst frei", () => {
        expect(erstellenSperre(erstellen(), false)).toBe("Starten darf nur, wer das Recht „Kartendaten-Export“ hat.");
        expect(erstellenSperre(erstellen({ ablage: false }), true)).toBe(
            "Hier ist keine Ablage für Abzüge eingerichtet.",
        );
        expect(
            erstellenSperre(
                erstellen({
                    laufend: {
                        jobId: JOB,
                        state: "QUEUED",
                        queuedAt: NOW.toISOString(),
                        startedAt: null,
                        phase: null,
                        progress: null,
                        waitReason: null,
                        ausgeloest: AUSGELOEST,
                    },
                }),
                true,
            ),
        ).toBe("Ein Abzug wartet oder läuft schon.");
        expect(erstellenSperre(erstellen(), true)).toBeUndefined();
    });

    it("🔴 Einspielen: nur mit dem Recht, mit Ablage und pg_dump, ohne laufendes Einspielen, mit Datei und ohne Befund", () => {
        expect(einspielenSperre(einspielen({ eingang: EINGANG }), false)).toBe(
            "Starten darf nur, wer das Recht „Abzug einspielen“ hat.",
        );
        expect(einspielenSperre(einspielen({ eingang: EINGANG, ablage: false }), true)).toContain("keine Ablage");
        expect(einspielenSperre(einspielen({ eingang: EINGANG, sicherung: false }), true)).toContain("pg_dump");
        expect(einspielenSperre(einspielen(), true)).toBe("Zuerst eine Datei wählen.");
        const laeuft = einspielen({
            eingang: EINGANG,
            lauf: {
                kennung: EINGANG.kennung,
                zustand: "laeuft",
                phase: "pruefen",
                tafel: null,
                fortschritt: 0,
                seit: NOW.toISOString(),
                ende: null,
                zeilen: null,
                sicherung: null,
                meldung: null,
            },
        });
        expect(einspielenSperre(laeuft, true)).toBe("Es läuft gerade ein Einspielen.");
        // Ein Befund der Prüfung sperrt den Knopf; die Gründe stehen unter der Datei (einzeln, mit der ersten Fundstelle), der Knopf sagt es nur.
        const befund = einspielen({
            eingang: { ...EINGANG, probleme: [{ code: "migrationen_lokal_alt", detail: "0218_abzug_lokal_auftrag" }] },
        });
        expect(einspielenSperre(befund, true)).toBe(
            "Der Abzug passt nicht zu dieser Datenbank; die Gründe stehen darunter.",
        );
        expect(problemSatz({ code: "migrationen_lokal_alt", detail: "0218_abzug_lokal_auftrag" })).toBe(
            "Lokal fehlt eine Migration der Quelle: erst die Migrationen einspielen. (0218_abzug_lokal_auftrag)",
        );
        expect(problemSatz({ code: "kartendomaene", detail: null })).toBe(
            "Die Kartendomäne des Abzugs ist nicht die dieser Datenbank.",
        );
        expect(einspielenSperre(einspielen({ eingang: EINGANG }), true)).toBeUndefined();
    });
});

// --- Ablauf gegen einen nachgebauten Server -----------------------------------------------------------------------------------------

type Answer = { status: number; body?: unknown };
const envelope = (code: string) => ({ error: { code, message: "vom Server" } });

function server(...answers: Answer[]) {
    const calls: { url: string; method: string; body: unknown; contentType: string | undefined }[] = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const headers = new Headers(init?.headers);
        calls.push({
            url: String(url),
            method: init?.method ?? "GET",
            body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
            contentType: headers.get("content-type") ?? undefined,
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
        operationId: "7e570000-0000-4000-8000-0000000000f0",
        status: "applied",
        environment: "test",
        affected: [],
        derivedWork: [{ kind: "abzug_lokal", jobId: JOB, state: "queued" }],
        warnings: [],
    },
};

describe("Ablauf Stage und Production", () => {
    it("🔴 erst die Frage, dann das Erstellen mit neuer Kennung; danach neu geladen; ein zweites Erstellen: der Satz des Servers", async () => {
        const { calls, fetcher } = server(
            { status: 200, body: erstellen() },
            RECEIPT,
            { status: 200, body: erstellen() },
            { status: 409, body: envelope("abzug_laeuft") },
            { status: 200, body: erstellen() },
        );
        const abzug = createAbzug({ fetcher, ask: async () => true });
        await abzug.load();
        abzug.ask("erstellen");
        expect(abzug.frage.value).toBe("erstellen");
        expect(calls.filter((call) => call.method === "POST")).toEqual([]);
        const ergebnis = await abzug.confirm();
        expect(ergebnis.ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/abzug/erstellen");
        expect((post?.body as { operationId: string }).operationId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(abzug.frage.value).toBeNull();
        expect(calls.filter((call) => call.url === "/api/admin/system/abzug")).toHaveLength(2);

        abzug.ask("erstellen");
        const zweites = await abzug.confirm();
        expect(zweites.ok).toBe(false);
        expect(zweites.problems).toEqual([{ key: "admin.abzug.error.laeuft" }]);
        expect(abzug.ergebnis.value).toEqual(zweites);
    });

    it("🔴 Herunterladen holt erst einen Link (mit Kennung) und löst dann den Download aus; ein Fehler löst nichts aus", async () => {
        const link: AbzugLink = {
            url: "/api/admin/system/abzug/datei/abc",
            gueltigBis: "2026-10-24T14:32:00Z",
            dateiname: "avesmaps-abzug-staging-x.tar",
        };
        const geladen: AbzugLink[] = [];
        const { calls, fetcher } = server(
            { status: 200, body: link },
            { status: 404, body: envelope("abzug_unbekannt") },
        );
        const abzug = createAbzug({ fetcher, ask: async () => true, starteDownload: (l) => geladen.push(l) });
        const gut = await abzug.herunterladen("20261024T100000Z-aktuell");
        expect(gut.ok).toBe(true);
        expect(geladen).toEqual([link]);
        expect(calls[0]).toMatchObject({ url: "/api/admin/system/abzug/link", method: "POST" });
        expect(calls[0]?.body).toMatchObject({ kennung: "20261024T100000Z-aktuell" });
        expect(abzug.ladeKennung.value).toBeNull();
        const weg = await abzug.herunterladen("20261023T000000Z-weg");
        expect(weg).toEqual({ ok: false, problems: [{ key: "admin.abzug.error.unbekannt" }] });
        expect(geladen).toHaveLength(1);
    });

    it("404 beim Laden heißt: diese Umgebung hat keine Rolle beim Abzug, der Eintrag zeigt nichts; ein anderer Fehler bleibt ein Ladefehler", async () => {
        const kein = createAbzug({
            fetcher: server({ status: 404, body: envelope("not_found") }).fetcher,
            ask: async () => true,
        });
        await kein.load();
        expect(kein.verfuegbar.value).toBe(false);
        expect(kein.sicht.value).toBeNull();
        expect(kein.loadProblems.value).toEqual([]);
        const kaputt = createAbzug({
            fetcher: server({ status: 503, body: envelope("database_unavailable") }).fetcher,
            ask: async () => true,
        });
        await kaputt.load();
        expect(kaputt.verfuegbar.value).toBe(true);
        expect(kaputt.loadProblems.value.length).toBeGreaterThan(0);
    });

    it("sieht nur nach, solange ein Auftrag wartet oder läuft und der Eintrag offen ist", async () => {
        const laufend = {
            jobId: JOB,
            state: "RUNNING" as const,
            queuedAt: NOW.toISOString(),
            startedAt: NOW.toISOString(),
            phase: "lesen",
            progress: 0.15,
            waitReason: null,
            ausgeloest: AUSGELOEST,
        };
        const { calls, fetcher } = server(
            { status: 200, body: erstellen({ laufend }) },
            { status: 200, body: erstellen({ letzter: LETZTER }) },
        );
        const uhr = timers();
        const abzug = createAbzug({
            fetcher,
            ask: async () => true,
            setTimer: uhr.setTimer,
            clearTimer: uhr.clearTimer,
        });
        abzug.follow(true);
        await abzug.load();
        expect(uhr.pending.map((eintrag) => eintrag.ms)).toEqual([NACHSEHEN_MS]);
        uhr.pending.shift()?.callback();
        await new Promise((fertig) => setTimeout(fertig, 0));
        // Fertig: kein weiteres Nachsehen.
        expect(uhr.pending).toEqual([]);
        expect(calls).toHaveLength(2);
        abzug.follow(false);
    });
});

describe("Ablauf lokal", () => {
    it("🔴 die Datei geht als Strom (application/x-tar) mit Namen und Kennung; danach neu geladen; ein Unsinn: der Satz zum Code", async () => {
        const datei = new File([new Uint8Array(2048)], "mein abzug.tar", { type: "" });
        const { calls, fetcher } = server(
            { status: 200, body: EINGANG },
            { status: 200, body: einspielen({ eingang: EINGANG }) },
            { status: 422, body: envelope("abzug_datei_ungueltig") },
            { status: 200, body: einspielen() },
        );
        const abzug = createAbzug({ fetcher, ask: async () => true });
        const gut = await abzug.waehleDatei(datei);
        expect(gut.ok).toBe(true);
        expect(calls[0]?.method).toBe("PUT");
        expect(calls[0]?.url).toMatch(
            /^\/api\/admin\/system\/abzug\/eingang\?name=mein%20abzug\.tar&operationId=[0-9a-f-]{36}$/u,
        );
        expect(calls[0]?.contentType).toBe("application/x-tar");
        expect(calls[0]?.body).toBe(datei);
        expect(abzug.sicht.value).toMatchObject({ rolle: "einspielen", eingang: { kennung: EINGANG.kennung } });
        expect(abzug.hochladen.value).toBe(false);
        const schlecht = await abzug.waehleDatei(datei);
        expect(schlecht).toEqual({ ok: false, problems: [{ key: "admin.abzug.error.datei" }] });
        expect(abzug.ergebnis.value).toEqual(schlecht);
    });

    it("🔴 Einspielen: erst die Frage, dann der Start mit der Kennung der Datei im Eingang", async () => {
        const { calls, fetcher } = server({ status: 200, body: einspielen({ eingang: EINGANG }) }, RECEIPT, {
            status: 200,
            body: einspielen({ eingang: EINGANG }),
        });
        const abzug = createAbzug({ fetcher, ask: async () => true });
        await abzug.load();
        abzug.ask("einspielen");
        expect(calls.filter((call) => call.method === "POST")).toEqual([]);
        const ergebnis = await abzug.confirm();
        expect(ergebnis.ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/abzug/einspielen");
        expect(post?.body).toMatchObject({ kennung: EINGANG.kennung });
        expect(abzug.frage.value).toBeNull();
    });

    it("eine nicht bestätigte Handlung sagt es mit dem eigenen Satz, nicht mit „ging nicht“", async () => {
        const { fetcher } = server(
            { status: 200, body: einspielen({ eingang: EINGANG }) },
            { status: 403, body: { error: { code: "reauth_required", message: "…", details: { need: "passkey" } } } },
            { status: 200, body: einspielen({ eingang: EINGANG }) },
        );
        const abzug = createAbzug({ fetcher, ask: async () => false });
        await abzug.load();
        abzug.ask("einspielen");
        const ergebnis = await abzug.confirm();
        expect(ergebnis).toEqual({ ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] });
    });
});

// --- Selbst abholen (Vali 2026-10-25) -----------------------------------------------------------------------------------------------

const SCHLUESSEL_WERT = `abz_${"A".repeat(43)}`;

function schluessel(patch: Partial<AbzugSchluessel> = {}): AbzugSchluessel {
    return {
        id: "7e570000-0000-4000-8000-0000000000b1",
        zustand: "gueltig",
        angelegt: "2026-10-24T10:00:00Z",
        laeuftAb: "2027-01-22T10:00:00Z",
        von: "Rondrikan",
        zuletzt: null,
        ...patch,
    };
}

const LAUF_HOLEN = {
    kennung: "20261025T100000Z-abcdef12",
    zustand: "laeuft" as const,
    phase: "holen" as const,
    tafel: null,
    fortschritt: 0.43,
    seit: "2026-10-24T14:29:00Z",
    ende: null,
    zeilen: null,
    sicherung: null,
    meldung: null,
    holen: { quelle: "staging" as const, geladen: 900 * 1024 * 1024, gesamt: 2100 * 1024 * 1024 },
};

describe("Selbst abholen: Sätze und Sperren", () => {
    it("die Liste der Schlüssel: Titel, gültig mit letzter Nutzung, abgelaufen und widerrufen im Ton der Warnung", () => {
        expect(schluesselTitel(schluessel())).toBe("Schlüssel von Rondrikan");
        expect(schluesselTitel(schluessel({ von: null }))).toBe("Schlüssel eines aufgelösten Kontos");
        const neu = schluesselUnterzeile(schluessel(), NOW);
        expect(neu.ton).toBe("leise");
        expect(neu.text).toMatch(/^Gültig bis .+ · noch nie benutzt$/u);
        expect(schluesselUnterzeile(schluessel({ zuletzt: "2026-10-24T14:00:00Z" }), NOW).text).toMatch(
            /· zuletzt benutzt heute, \d\d:\d\d$/u,
        );
        expect(schluesselUnterzeile(schluessel({ zustand: "abgelaufen" }), NOW)).toMatchObject({ ton: "warnung" });
        expect(schluesselUnterzeile(schluessel({ zustand: "widerrufen" }), NOW)).toEqual({
            text: "Widerrufen",
            ton: "warnung",
        });
    });

    it("Schlüssel anlegen: nur mit dem Recht, und höchstens fünf gültige zugleich", () => {
        const sicht = erstellen({ schluessel: [schluessel()] });
        expect(anlegenSperre(sicht, true)).toBeUndefined();
        expect(anlegenSperre(sicht, false)).toContain("Schlüssel anlegen und widerrufen");
        const voll = erstellen({
            schluessel: Array.from({ length: 5 }, (_, n) =>
                schluessel({ id: `7e570000-0000-4000-8000-00000000010${String(n)}` }),
            ),
        });
        expect(anlegenSperre(voll, true)).toBe("Es gelten schon 5 Schlüssel. Erst einen widerrufen.");
        // Abgelaufene und widerrufene zählen nicht.
        const alt = erstellen({
            schluessel: Array.from({ length: 5 }, (_, n) =>
                schluessel({
                    id: `7e570000-0000-4000-8000-00000000020${String(n)}`,
                    zustand: n % 2 === 0 ? "abgelaufen" : "widerrufen",
                }),
            ),
        });
        expect(anlegenSperre(alt, true)).toBeUndefined();
    });

    it("Abzug holen: gesperrt ohne Schlüssel (mit dem Namen der Quelle), ohne Ablage, ohne pg_dump und solange etwas läuft", () => {
        const mit = einspielen({ schluessel: { staging: true, production: false } });
        expect(quellenName("staging")).toBe("Stage");
        expect(quellenName("production")).toBe("Production");
        expect(holenSperre(mit, true, "staging")).toBeUndefined();
        expect(holenSperre(mit, true, "production")).toBe("Zuerst den Schlüssel von Production hinterlegen.");
        expect(holenSperre(mit, false, "staging")).toContain("Recht");
        expect(holenSperre({ ...mit, ablage: false }, true, "staging")).toContain("keine Ablage");
        expect(holenSperre({ ...mit, sicherung: false }, true, "staging")).toContain("pg_dump");
        const laeuft = einspielen({ schluessel: { staging: true, production: true }, lauf: LAUF_HOLEN });
        expect(holenSperre(laeuft, true, "staging")).toBe("Es läuft gerade ein Einspielen.");
        expect(holenQuelleGerade(laeuft, null)).toBe("staging");
        expect(holenQuelleGerade(erstellen(), "staging")).toBeNull();
    });

    it("beim Holen steht in der Unterzeile, wie viel der Datei da ist", () => {
        const stand = einspielen({ schluessel: { staging: true, production: false }, lauf: LAUF_HOLEN });
        expect(einspielenUnterzeile(stand, NOW).text).toMatch(
            /^Läuft seit .+ · Datei holen · 43 % · 900 MB von 2,1 GB$/u,
        );
        expect(fortschritt(stand)).toBe(43);
    });
});

describe("Selbst abholen: Ablauf", () => {
    const NEU = {
        id: "7e570000-0000-4000-8000-0000000000b2",
        schluessel: SCHLUESSEL_WERT,
        laeuftAb: "2027-01-22T10:00:00Z",
    };

    it("🔴 Schlüssel anlegen: erst die Frage, dann der Aufruf mit der gewählten Dauer; der Wert steht in der Seite, bis er als notiert gilt", async () => {
        const { calls, fetcher } = server(
            { status: 200, body: erstellen() },
            { status: 200, body: NEU },
            { status: 200, body: erstellen({ schluessel: [schluessel({ id: NEU.id })] }) },
        );
        const abzug = createAbzug({ fetcher, ask: async () => true });
        await abzug.load();
        abzug.ask("schluessel");
        expect(abzug.tage.value).toBe(90);
        abzug.waehleTage(365);
        expect(calls.filter((call) => call.method === "POST")).toEqual([]);
        const ergebnis = await abzug.confirm();
        expect(ergebnis.ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/abzug/schluessel");
        expect(post?.body).toMatchObject({ tage: 365 });
        expect(abzug.neuerSchluessel.value).toEqual(NEU);
        abzug.schluesselGesehen();
        expect(abzug.neuerSchluessel.value).toBeNull();
        expect(abzug.sicht.value).toMatchObject({ schluessel: [{ id: NEU.id }] });
        // Die Sicht selbst trägt nie einen Wert.
        expect(JSON.stringify(abzug.sicht.value)).not.toContain(SCHLUESSEL_WERT);
    });

    it("Schlüssel widerrufen: ein Aufruf mit der Kennung, danach neu geladen; ein Fehler nennt den Satz zum Code", async () => {
        const id = "7e570000-0000-4000-8000-0000000000b3";
        const { calls, fetcher } = server(
            RECEIPT,
            { status: 200, body: erstellen({ schluessel: [schluessel({ id, zustand: "widerrufen" })] }) },
            { status: 404, body: envelope("abzug_schluessel_unbekannt") },
            { status: 200, body: erstellen() },
        );
        const abzug = createAbzug({ fetcher, ask: async () => true });
        expect((await abzug.widerrufen(id)).ok).toBe(true);
        expect(calls[0]).toMatchObject({ url: "/api/admin/system/abzug/schluessel/widerrufen", method: "POST" });
        expect(calls[0]?.body).toMatchObject({ id });
        expect(abzug.widerrufId.value).toBeNull();
        const weg = await abzug.widerrufen(id);
        expect(weg).toEqual({ ok: false, problems: [{ key: "admin.abzug.error.schluesselUnbekannt" }] });
    });

    it("🔴 lokal: ein Schlüssel ohne die Form eines Schlüssels geht gar nicht erst zum Server; ein guter geht ohne Leerzeichen und kommt nie zurück", async () => {
        const { calls, fetcher } = server(RECEIPT, {
            status: 200,
            body: einspielen({ schluessel: { staging: true, production: false } }),
        });
        const abzug = createAbzug({ fetcher, ask: async () => true });
        const schlecht = await abzug.setzeSchluessel("staging", "kein-schluessel");
        expect(schlecht).toEqual({ ok: false, problems: [{ key: "admin.abzug.holen.schluesselForm" }] });
        expect(calls).toEqual([]);
        expect(abzug.letzteQuelle.value).toBe("staging");
        const gut = await abzug.setzeSchluessel("staging", `  ${SCHLUESSEL_WERT} \n`);
        expect(gut.ok).toBe(true);
        expect(calls[0]).toMatchObject({ url: "/api/admin/system/abzug/quelle", method: "POST" });
        expect(calls[0]?.body).toMatchObject({ quelle: "staging", schluessel: SCHLUESSEL_WERT });
        // Nach dem Speichern liest die Seite nur noch, FÜR WELCHE Quelle einer da ist.
        expect(abzug.sicht.value).toMatchObject({ schluessel: { staging: true, production: false } });
        expect(JSON.stringify(abzug.sicht.value)).not.toContain(SCHLUESSEL_WERT);
    });

    it("lokal: einen Schlüssel entfernen schickt `null`", async () => {
        const { calls, fetcher } = server(RECEIPT, { status: 200, body: einspielen() });
        const abzug = createAbzug({ fetcher, ask: async () => true });
        expect((await abzug.setzeSchluessel("production", null)).ok).toBe(true);
        expect(calls[0]?.body).toMatchObject({ quelle: "production", schluessel: null });
    });

    it("🔴 Abzug holen und einspielen: erst die Frage zur Quelle, dann der Aufruf mit der Quelle; ohne Schlüssel der Satz des Servers", async () => {
        const { calls, fetcher } = server(
            { status: 200, body: einspielen({ schluessel: { staging: true, production: false } }) },
            RECEIPT,
            { status: 200, body: einspielen({ schluessel: { staging: true, production: false }, lauf: LAUF_HOLEN }) },
            { status: 409, body: envelope("abzug_schluessel_fehlt") },
            { status: 200, body: einspielen() },
        );
        const abzug = createAbzug({ fetcher, ask: async () => true });
        await abzug.load();
        abzug.ask("holen:staging");
        expect(abzug.frage.value).toBe("holen:staging");
        expect(abzug.letzteQuelle.value).toBe("staging");
        expect(calls.filter((call) => call.method === "POST")).toEqual([]);
        expect((await abzug.confirm()).ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/abzug/holen");
        expect(post?.body).toMatchObject({ quelle: "staging" });
        expect(abzug.frage.value).toBeNull();
        expect(holenQuelleGerade(abzug.sicht.value, abzug.geholtVon.value)).toBe("staging");

        abzug.ask("holen:production");
        const ohne = await abzug.confirm();
        expect(ohne).toEqual({ ok: false, problems: [{ key: "admin.abzug.error.schluesselFehlt" }] });
        expect(abzug.letzteQuelle.value).toBe("production");
        // Eine andere Handlung nimmt das Ergebnis aus der Zeile der Quelle.
        abzug.ask("einspielen");
        expect(abzug.letzteQuelle.value).toBeNull();
    });

    it("beim Holen sieht die Seite nach, bis es fertig ist", async () => {
        const lauf = einspielen({ schluessel: { staging: true, production: false }, lauf: LAUF_HOLEN });
        const { calls, fetcher } = server(
            { status: 200, body: lauf },
            { status: 200, body: einspielen({ schluessel: { staging: true, production: false } }) },
        );
        const uhr = timers();
        const abzug = createAbzug({
            fetcher,
            ask: async () => true,
            setTimer: uhr.setTimer,
            clearTimer: uhr.clearTimer,
        });
        abzug.follow(true);
        await abzug.load();
        expect(uhr.pending.map((eintrag) => eintrag.ms)).toEqual([NACHSEHEN_MS]);
        uhr.pending.shift()?.callback();
        await new Promise((fertig) => setTimeout(fertig, 0));
        expect(uhr.pending).toEqual([]);
        expect(calls).toHaveLength(2);
        abzug.follow(false);
    });
});

describe("Notweg: Datei von Hand einspielen", () => {
    // Die Datei ist da, das Einspielen läuft: Von einem Einspielen der gewählten Datei ist das nicht zu unterscheiden.
    const LAUF_LADEN = { ...LAUF_HOLEN, phase: "laden" as const, tafel: "public.place", fortschritt: 0.4, holen: null };

    it("🔴 der Weg steht zu und öffnet sich nur, wenn die Datei übernommen wird oder ein Einspielen läuft, das nicht vom Holen kommt", () => {
        const laden = einspielen({ eingang: EINGANG, lauf: LAUF_LADEN });
        // Ohne Arbeit bleibt er zu: ohne Lauf, mit Eingang, mit altem Ergebnis, auf Stage und Production, ohne Stand.
        expect(dateiWegErzwungen(null, false, null)).toBe(false);
        expect(dateiWegErzwungen(erstellen(), false, null)).toBe(false);
        expect(dateiWegErzwungen(einspielen(), false, null)).toBe(false);
        expect(dateiWegErzwungen(einspielen({ eingang: EINGANG }), false, null)).toBe(false);
        const fertig = einspielen({ lauf: { ...LAUF_LADEN, zustand: "fertig", phase: "fertig" } });
        expect(dateiWegErzwungen(fertig, false, null)).toBe(false);
        // Die Datei wird übernommen und geprüft: offen, auch wenn noch kein Lauf da ist.
        expect(dateiWegErzwungen(einspielen(), true, null)).toBe(true);
        // Ein Einspielen läuft: offen, wenn es nicht vom Holen kommt (Datei, oder die Seite weiß es nicht, etwa nach dem Neuladen).
        expect(dateiWegErzwungen(laden, false, null)).toBe(true);
        // Kommt es vom Holen, zeigt die Zeile der Quelle die Lage; der Weg der Datei bleibt zu, während die Datei kommt und danach.
        expect(dateiWegErzwungen(laden, false, "staging")).toBe(false);
        expect(dateiWegErzwungen(einspielen({ lauf: LAUF_HOLEN }), false, null)).toBe(false);
    });

    it("beim Holen nennt der Lauf die Quelle selbst, danach zählt, was diese Seite gestartet hat", () => {
        const laden = einspielen({ lauf: LAUF_LADEN });
        expect(holenQuelleGerade(einspielen({ lauf: LAUF_HOLEN }), null)).toBe("staging");
        expect(holenQuelleGerade(einspielen({ lauf: LAUF_HOLEN }), "production")).toBe("staging");
        expect(holenQuelleGerade(laden, "production")).toBe("production");
        expect(holenQuelleGerade(laden, null)).toBeNull();
        // Ein Lauf, der nicht mehr läuft, gehört keiner Zeile.
        const fertig = einspielen({ lauf: { ...LAUF_LADEN, zustand: "fertig", phase: "fertig" } });
        expect(holenQuelleGerade(fertig, "staging")).toBeNull();
    });

    it("🔴 die Seite merkt sich, was sie gestartet hat: Holen setzt die Quelle, Datei und Einspielen nehmen sie zurück, ein abgelehntes Holen ändert nichts", async () => {
        const beide = { staging: true, production: true };
        const { fetcher } = server(
            { status: 200, body: einspielen({ schluessel: beide }) },
            // Holen von Stage: Quittung, dann läuft es.
            RECEIPT,
            { status: 200, body: einspielen({ schluessel: beide, lauf: LAUF_LADEN }) },
            // Eine Datei wählen: PUT, dann der Stand mit dem Eingang.
            { status: 200, body: EINGANG },
            { status: 200, body: einspielen({ schluessel: beide, eingang: EINGANG, lauf: LAUF_LADEN }) },
            // Holen von Production.
            RECEIPT,
            { status: 200, body: einspielen({ schluessel: beide, lauf: LAUF_LADEN }) },
            // Die gewählte Datei einspielen.
            RECEIPT,
            { status: 200, body: einspielen({ schluessel: beide, eingang: EINGANG, lauf: LAUF_LADEN }) },
            // Ein Holen, das der Server ablehnt.
            { status: 409, body: envelope("abzug_schluessel_fehlt") },
            { status: 200, body: einspielen({ schluessel: beide }) },
        );
        const abzug = createAbzug({ fetcher, ask: async () => true });
        await abzug.load();
        expect(abzug.geholtVon.value).toBeNull();

        abzug.ask("holen:staging");
        expect((await abzug.confirm()).ok).toBe(true);
        expect(abzug.geholtVon.value).toBe("staging");
        expect(dateiWegErzwungen(abzug.sicht.value, abzug.hochladen.value, abzug.geholtVon.value)).toBe(false);

        expect((await abzug.waehleDatei(new File([new Uint8Array(16)], "abzug.tar"))).ok).toBe(true);
        expect(abzug.geholtVon.value).toBeNull();
        expect(dateiWegErzwungen(abzug.sicht.value, abzug.hochladen.value, abzug.geholtVon.value)).toBe(true);

        abzug.ask("holen:production");
        expect((await abzug.confirm()).ok).toBe(true);
        expect(abzug.geholtVon.value).toBe("production");

        abzug.ask("einspielen");
        expect((await abzug.confirm()).ok).toBe(true);
        expect(abzug.geholtVon.value).toBeNull();

        abzug.ask("holen:staging");
        expect((await abzug.confirm()).ok).toBe(false);
        expect(abzug.geholtVon.value).toBeNull();
    });
});
