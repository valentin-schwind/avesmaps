import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AdminHoehenmodell, type HoehenmodellFassung } from "@avesmaps3d/shared";
import {
    NACHSEHEN_MS,
    aktivierenSperre,
    neuRechnenSperre,
    createHoehenmodell,
    entwurfUnter,
    fassungName,
    fassungUnter,
    formularAenderungen,
    formularSperre,
    gueltigFelder,
    gueltigZustand,
    ketteSatz,
    leeresFormular,
    leseZahl,
    messenSperre,
    messungSatz,
    nurLesenSatz,
} from "../src/auth/hoehenmodell.ts";

/**
 * Der Eintrag „Höhenmodell“ (WI-0127 SYS-13) ohne Browser: der Zustand „Gültig“ (aktuell, rechnet, weicht ab, unbekannt), die Zeilen
 * der Fassungen und Entwürfe, die Messung als Satz, gesperrte Knöpfe mit Grund, das Formular „Neuer Entwurf“ und der Ablauf gegen einen
 * nachgebauten Server (Wählen mit Revision, Konflikt, Messen, Nachsehen).
 */

const NOW = new Date("2026-10-10T18:00:00Z");
const REGLER_17 = {
    radius: null,
    saturation: null,
    iterations: 12,
    streamPowerK: 0.0008,
    diffusion: 0.02,
    continentalHeight: 300,
    detailAmplitude: 180,
    fineDetailAmplitude: 40,
    flankGrade: 0.1,
    maximumGrade: 0.7,
};
const LANDSCHAFTEN = [
    { art: "gebirge", upliftWeight: 20, erodibility: 0.08, diffusivity: 1, runoff: 1, channelBias: 0 },
];

function fassungVon(version: 17 | 18, patch: Partial<HoehenmodellFassung> = {}): HoehenmodellFassung {
    return {
        version,
        regional: version === 18,
        unterschied: version === 18 ? [{ pfad: "generator.uplift", alt: null, neu: { kind: "regional" } }] : [],
        regler: version === 18 ? { ...REGLER_17, radius: 16, saturation: 10 } : REGLER_17,
        landschaften: LANDSCHAFTEN,
        werte: version === 18 ? 239 : 237,
        abnahme: null,
        inDatei: true,
        kreis: "voll",
        gilt: version === 18,
        ...patch,
    };
}

function stand(patch: Partial<AdminHoehenmodell> = {}): AdminHoehenmodell {
    const body: AdminHoehenmodell = {
        now: NOW.toISOString(),
        profil: "voll",
        eingestellt: {
            version: 18,
            quelle: "auswahl",
            seit: "2026-10-10T16:02:00Z",
            wer: "Valentin",
            grund: "sieht gut aus",
            revision: 3,
            unbekannt: null,
        },
        wirksam: { version: 18, gerechnetAm: "2026-10-10T16:41:00Z", vorlaeufig: false },
        kette: null,
        rueckweg: 17,
        fassungen: [fassungVon(17), fassungVon(18)],
        entwuerfe: [],
        gipfel: null,
        ...patch,
    };
    // Jede Vorlage gegen den Vertrag: der Nachbau sagt nichts, was der Server nicht sagen kann.
    expect(Value.Check(AdminHoehenmodell, body)).toBe(true);
    return body;
}

const ENTWURF = {
    id: "1f0c5d3e-2b4a-4c6d-8e9f-0a1b2c3d4e5f",
    basis: 18,
    aenderungen: { saturation: 12 },
    grund: "weicher",
    angelegt: "2026-10-10T17:20:00Z",
    wer: "Valentin",
    messung: null,
    kreis: "leer" as const,
};

describe("Gültig (§9c.3)", () => {
    it("🔴 aktuell, wenn wirksam gleich eingestellt; rechnet mit Kette; weicht ab ohne Kette; unbekannt ohne Fassung am Master", () => {
        expect(gueltigZustand(stand())).toEqual({ text: "aktuell", ton: "erfolg" });
        const kette = {
            jobId: "j",
            art: "terrain_full",
            state: "RUNNING" as const,
            phase: "erosion",
            progress: 0.42,
            waitReason: null,
        };
        expect(gueltigZustand(stand({ kette }))).toEqual({ text: "rechnet neu", ton: "ruhe" });
        expect(
            gueltigZustand(stand({ wirksam: { version: 17, gerechnetAm: NOW.toISOString(), vorlaeufig: false } })),
        ).toEqual({
            text: "weicht ab",
            ton: "warnung",
        });
        expect(
            gueltigZustand(stand({ wirksam: { version: null, gerechnetAm: NOW.toISOString(), vorlaeufig: false } })),
        ).toEqual({
            text: "unbekannt",
            ton: "warnung",
        });
        expect(ketteSatz(stand({ kette }))).toBe("Läuft: Gelände voll rechnen · erosion · 42 %");
        expect(ketteSatz(stand({ kette: { ...kette, state: "QUEUED", waitReason: "waits_system_lock" } }))).toBe(
            "Wartet: Gelände voll rechnen. Wartet, bis die Kartensperre gelöst oder der eingeschränkte Betrieb beendet ist.",
        );
    });

    it("die Feldzeilen: Fassung, wer, Grund; die Vorgabe der Datei ohne Wer; Höhenlinien folgen der Kette", () => {
        const werte = Object.fromEntries(gueltigFelder(stand(), NOW).map((feld) => [feld.id, feld.wert]));
        expect(werte["eingestellt"]).toMatch(/^Fassung 18 · seit .+ · Valentin · „sieht gut aus“$/u);
        expect(werte["wirksam"]).toMatch(/^Fassung 18, gerechnet /u);
        expect(werte["hoehenlinien"]).toBe("passen zur Fassung 18");
        const datei = stand({
            eingestellt: {
                version: 18,
                quelle: "datei",
                seit: null,
                wer: null,
                grund: null,
                revision: 0,
                unbekannt: null,
            },
        });
        expect(gueltigFelder(datei, NOW)[0]?.wert).toBe("Fassung 18 · Vorgabe der Datei");
        const linien = stand({
            kette: {
                jobId: "j",
                art: "display_heights",
                state: "RUNNING",
                phase: null,
                progress: null,
                waitReason: null,
            },
        });
        expect(gueltigFelder(linien, NOW)[2]?.wert).toBe("werden neu gezeichnet");
    });
});

describe("Fassungen und Entwürfe", () => {
    it("der Name folgt aus der Art der Rückverteilung, nicht aus der Nummer", () => {
        expect(fassungName(fassungVon(18))).toBe("Fassung 18 · FastScape mit regionaler Isostasie");
        expect(fassungName(fassungVon(17))).toBe("Fassung 17 · FastScape mit globaler Massenbilanz");
        expect(fassungName(fassungVon(18, { version: 19 }))).toBe("Fassung 19 · FastScape mit regionaler Isostasie");
    });

    it("die Unterzeilen: regional mit Radius und Sättigung, sonst die ganze Karte; die Abnahme oder „auf Stage abgenommen“", () => {
        expect(fassungUnter(fassungVon(18), NOW)).toBe(
            "Rückverteilung regional · Radius 16 E · Sättigung 10 · auf Stage abgenommen",
        );
        expect(fassungUnter(fassungVon(17, { inDatei: false, kreis: "halb" }), NOW)).toBe(
            "Rückverteilung über die ganze Karte (das alte Höhenmodell) · nicht abgenommen",
        );
        expect(entwurfUnter(ENTWURF, fassungVon(18), NOW)).toMatch(
            /^Sättigung 12 statt 10 · angelegt .+ · Valentin · „weicher“$/u,
        );
    });

    it("🔴 Aktivieren ruht: ohne Recht und an der gültigen Fassung ohne eigenen Satz, auf Production nicht abgenommen mit Satz", () => {
        expect(aktivierenSperre(stand(), fassungVon(17), false)).toBe("");
        expect(nurLesenSatz()).toBe("Umschalten braucht das Recht „Höhenmodell umschalten“.");
        expect(aktivierenSperre(stand(), fassungVon(18), true)).toBe("");
        expect(aktivierenSperre(stand({ profil: "abgenommen" }), fassungVon(17, { inDatei: false }), true)).toMatch(
            /Noch nicht freigegeben\. Erst auf der Stage abnehmen/u,
        );
        expect(aktivierenSperre(stand(), fassungVon(17), true)).toBeUndefined();
    });

    it("🔴 „Gelände neu rechnen“ ruht ohne Recht still und mit Satz, solange eine Kette wartet; läuft eine, geht er (Betreiber 2026-10-17)", () => {
        const kette = (state: "QUEUED" | "RUNNING") => ({
            jobId: "j",
            art: "terrain_full",
            state,
            phase: null,
            progress: null,
            waitReason: null,
        });
        expect(neuRechnenSperre(stand(), false)).toBe("");
        expect(neuRechnenSperre(stand({ kette: kette("QUEUED") }), true)).toBe("Eine Geländerechnung wartet schon.");
        expect(neuRechnenSperre(stand({ kette: kette("RUNNING") }), true)).toBeUndefined();
        expect(neuRechnenSperre(stand(), true)).toBeUndefined();
    });

    it("🔴 Messen ruht unter Profil „abgenommen“ und während eine Messung wartet oder läuft", () => {
        expect(messenSperre(stand({ profil: "abgenommen" }), ENTWURF, true)).toBe(
            "Auf dieser Umgebung wird nicht gemessen.",
        );
        const laeuft = {
            ...ENTWURF,
            messung: {
                jobId: "m",
                state: "RUNNING" as const,
                phase: "rechnen",
                progress: 0.1,
                ergebnis: null,
                fehler: null,
            },
        };
        expect(messenSperre(stand(), laeuft, true)).toBe("");
        expect(messenSperre(stand(), ENTWURF, true)).toBeUndefined();
    });

    it("die Messung als Satz: nicht gemessen, wartet, läuft, Ergebnis in Schritt mit Vorzeichen, Fehler", () => {
        expect(messungSatz(null).text).toMatch(/^Noch nicht gemessen/u);
        const basis = { jobId: "m", phase: null, progress: null, ergebnis: null, fehler: null };
        expect(messungSatz({ ...basis, state: "QUEUED" }).text).toBe("Die Messung wartet auf einen freien Platz.");
        expect(messungSatz({ ...basis, state: "FAILED", fehler: "Speicher" })).toEqual({
            text: "Die Messung ist fehlgeschlagen: Speicher",
            ton: "warnung",
        });
        const fertig = messungSatz({
            ...basis,
            state: "SUCCEEDED",
            ergebnis: {
                land: { typisch: 4, mittel: -1.5 },
                tiefland: { typisch: 0 },
                gebirge: { typisch: 38 },
                hoechster: { vorher: 5632, nachher: 5700 },
                stufenWechsel: 0.0312,
            },
        });
        expect(fertig.ton).toBe("gut");
        expect(fertig.text).toContain("über Land typisch +4 Schritt (Mittel −1,5), Tiefland 0, Gebirge +38");
        expect(fertig.text).toContain("höchster Punkt 5.632 → 5.700; andere Höhenstufe 3,1 %");
    });
});

describe("Formular „Neuer Entwurf“ (Frage 2 „A plus“)", () => {
    it("🔴 leer heißt unverändert; Komma oder Punkt; Grenzen, ganze Zahlen, Rückverteilung nur regional; gleich der Basis zählt nicht", () => {
        expect(leseZahl("12,5")).toBe(12.5);
        expect(leseZahl("1e3")).toBeNull();
        const f = leeresFormular(18);
        f.werte.saturation = "12";
        f.werte.continentalHeight = "300";
        expect(formularAenderungen(f, fassungVon(18))).toEqual({ aenderungen: { saturation: 12 }, probleme: {} });
        f.werte.iterations = "2,5";
        f.werte.flankGrade = "2";
        expect(formularAenderungen(f, fassungVon(18)).probleme).toEqual({
            iterations: "nur ganze Zahlen",
            flankGrade: "zwischen 0 und 1",
        });
        const alt = leeresFormular(17);
        alt.werte.radius = "12";
        expect(formularAenderungen(alt, fassungVon(17)).probleme).toEqual({
            radius: "nur in einer Fassung mit regionaler Rückverteilung",
        });
    });

    it("Anlegen ruht: Fehler im Formular, keine Änderung, kein Grund", () => {
        const f = leeresFormular(18);
        expect(formularSperre(f, fassungVon(18))).toBe("admin.terrain.invalid.noChange");
        f.werte.saturation = "x";
        expect(formularSperre(f, fassungVon(18))).toBe("admin.terrain.invalid.fix");
        f.werte.saturation = "12";
        expect(formularSperre(f, fassungVon(18))).toBe("admin.system.reason.missing");
        f.grund = "weicher";
        expect(formularSperre(f, fassungVon(18))).toBeUndefined();
    });
});

type Answer = { status: number; body?: unknown };
const envelope = (code: string, details?: Record<string, unknown>) => ({
    error: { code, message: "vom Server", ...(details === undefined ? {} : { details }) },
});

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
    body: { operationId: "x", status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] },
};

describe("Ablauf", () => {
    it("🔴 Aktivieren schickt Revision, Fassung und Grund; danach sieht der Eintrag nach, solange die Kette rechnet", async () => {
        const clock = timers();
        const rechnet = stand({
            eingestellt: { ...stand().eingestellt, version: 17, revision: 4 },
            kette: { jobId: "j", art: "terrain_full", state: "QUEUED", phase: null, progress: null, waitReason: null },
            rueckweg: 18,
        });
        const { calls, fetcher } = server({ status: 200, body: stand() }, RECEIPT, { status: 200, body: rechnet });
        const h = createHoehenmodell({
            fetcher,
            ask: async () => true,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });
        h.follow(true);
        await h.load();
        expect(h.zeile.value).toEqual({ art: "fassung", version: 18 });
        expect(clock.pending).toEqual([]);
        h.ask({ art: "waehlen", version: 17 });
        expect(await h.confirm()).toEqual({ ok: false, problems: [{ key: "admin.system.reason.missing" }] });
        h.grund.value = "  Vergleich  ";
        expect((await h.confirm()).ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/hoehenmodell/waehlen");
        expect(post?.body).toMatchObject({ baseRevision: 3, version: 17, reason: "Vergleich" });
        expect(h.frage.value).toBeNull();
        expect(clock.pending.map((entry) => entry.ms)).toEqual([NACHSEHEN_MS]);
        h.follow(false);
        expect(clock.pending).toEqual([]);
    });

    it("🔴 Neu rechnen fragt ohne Grund und schickt nur die Kennung des Vorgangs", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand() }, RECEIPT, { status: 200, body: stand() });
        const h = createHoehenmodell({ fetcher, ask: async () => true });
        await h.load();
        h.ask({ art: "neuRechnen", version: 18 });
        expect((await h.confirm()).ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/hoehenmodell/neu-rechnen");
        expect(Object.keys(post?.body ?? {})).toEqual(["operationId"]);
        expect(h.frage.value).toBeNull();
    });

    it("🔴 ein Konflikt schließt die Frage und nennt, wer schneller war; ein abgebrochener Passkey lässt den Grund stehen", async () => {
        const { fetcher } = server(
            { status: 200, body: stand() },
            {
                status: 409,
                body: envelope("edit_conflict", { changedBy: { displayName: "Thomas" }, changedAt: NOW.toISOString() }),
            },
            { status: 200, body: stand() },
            { status: 401, body: envelope("reauth_required") },
            { status: 200, body: stand() },
        );
        const h = createHoehenmodell({ fetcher, ask: async () => false });
        await h.load();
        h.ask({ art: "waehlen", version: 17 });
        h.grund.value = "Vergleich";
        const konflikt = await h.confirm();
        expect(konflikt.conflict).toEqual({ by: "Thomas", at: NOW.toISOString() });
        expect(h.frage.value).toBeNull();
        h.ask({ art: "zurueck", version: 17 });
        h.grund.value = "zurück";
        expect(await h.confirm()).toEqual({ ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] });
        expect(h.frage.value).toEqual({ art: "zurueck", version: 17 });
        expect(h.grund.value).toBe("zurück");
        expect(h.ergebnis.value?.ort).toBe("zurueck");
    });

    it("Entwurf anlegen schickt nur die Änderungen; Messen läuft mit Stufe V und meldet den Satz des Servers an der Zeile", async () => {
        const mitEntwurf = stand({ entwuerfe: [ENTWURF] });
        const { calls, fetcher } = server(
            { status: 200, body: stand() },
            RECEIPT,
            { status: 200, body: mitEntwurf },
            { status: 409, body: envelope("terrain_measure_running") },
            { status: 200, body: mitEntwurf },
        );
        const h = createHoehenmodell({ fetcher, ask: async () => true });
        await h.load();
        h.neuerEntwurf(18);
        h.formular.value!.werte.saturation = "12";
        h.formular.value!.werte.radius = "16";
        h.formular.value!.grund = "weicher";
        expect((await h.anlegen()).ok).toBe(true);
        expect(calls[1]?.body).toMatchObject({ basis: 18, aenderungen: { saturation: 12 }, reason: "weicher" });
        expect(h.formular.value).toBeNull();
        expect(h.zeile.value).toEqual({ art: "entwurf", id: ENTWURF.id });
        expect(await h.messen(ENTWURF.id)).toEqual({
            ok: false,
            problems: [{ key: "admin.terrain.error.measureRunning" }],
        });
        expect(calls[3]?.url).toBe("/api/admin/system/hoehenmodell/entwurf/messen");
        expect(h.ergebnis.value?.ort).toBe(`entwurf:${ENTWURF.id}`);
    });
});
