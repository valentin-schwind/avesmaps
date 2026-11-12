import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AdminWegfindung, WEGFINDUNG_WERTE } from "@avesmaps3d/shared";
import { locale } from "../src/i18n/i18n.ts";
import {
    createWegfindung,
    leiste,
    leseZahl,
    offeneFolgen,
    offeneWerte,
    neben,
    panele,
    problemSatz,
    schienenWert,
    zahl,
} from "../src/auth/wegfindung.ts";

/**
 * Der Eintrag „Wegfindung“ (WI-0153) ohne Browser: die Zeilen der drei Panele aus der Tafel und den Abweichungen des Servers,
 * die getippte Zahl, die Grenzen am Feld, die Zahl in der Schiene, die Leiste über den Panelen und die Schreibwege gegen
 * einen nachgebauten Server.
 *
 * 🔴 Jede Zeile trägt ZWEI Zahlen (Schnitt 6): `value` ist gespeichert, `applied` freigegeben. Dass die beiden
 * auseinandergehen können, ist der ganze Punkt — die Leiste zählt genau das, und die Zeile sagt, womit gerechnet wird.
 */

const NOW = new Date("2026-10-15T20:00:00Z");

/**
 * Eine Zeile, wie der Server sie schickt. `applied` ohne Angabe heisst: freigegeben ist dasselbe, die Zeile ist also
 * gerechnet. `applied: null` heisst: freigegeben ist die Vorgabe — gespeichert und gerechnet gehen auseinander.
 */
function zeile(
    id: string,
    value: number | null,
    applied: number | null | undefined = undefined,
    changedBy: string | null = null,
): AdminWegfindung["rows"][number] {
    return {
        id,
        value,
        applied: applied === undefined ? value : applied,
        changedAt: changedBy === null ? null : "2026-10-15T19:14:00Z",
        changedBy,
    };
}

function stand(patch: Partial<AdminWegfindung> = {}): AdminWegfindung {
    const body: AdminWegfindung = {
        now: NOW.toISOString(),
        revision: 4,
        source: "database",
        rows: [zeile("endSnap", 0.03, 0.03, "Rondrikan")],
        unknownKeys: [],
        appliedAt: "2026-10-15T19:20:00Z",
        appliedBy: "Rondrikan",
        appliedJob: null,
        appliedJobState: null,
        seaGraph: { derivedAt: "2026-10-15T18:00:00Z", stale: false, job: null, jobState: null },
        ...patch,
    };
    expect(Value.Check(AdminWegfindung, body)).toBe(true);
    return body;
}

describe("Die Zeilen der drei Panele", () => {
    it("🔴 alle 51 Werte der Tafel, in ihren Panelen, mit Satz und Folge", () => {
        const sicht = panele(stand(), NOW);
        expect(sicht.map((panel) => panel.zeilen.length)).toEqual([12, 12, 27]);
        expect(sicht.flatMap((panel) => panel.zeilen).length).toBe(WEGFINDUNG_WERTE.length);
        const [erst] = sicht;
        expect(erst?.titel).toBe("Allgemeine Wegfindungseinstellungen");
        const kasten = erst?.zeilen[1];
        expect(kasten).toMatchObject({
            abweichend: false,
            text: "0,5",
            neben: "(1,5 Meilen)",
            folgeSatz: "Braucht ein Neuberechnen des Wegenetzes: der Knopf oben.",
            statt: null,
            stand: null,
        });
    });

    it("🔴 ein verstellter Wert: das Feld trägt ihn, darunter steht die Vorgabe, und die Meilen rechnen mit dem neuen Wert", () => {
        const fang = panele(stand(), NOW)[0]?.zeilen[0];
        expect(fang).toMatchObject({
            abweichend: true,
            eingestellt: 0.03,
            vorgabe: 0.02,
            text: "0,03",
            vorgabeText: "0,02",
            neben: "(0,09 Meilen)",
            statt: "statt 0,02",
        });
        expect(fang?.stand).toMatch(/^geändert .+ · Rondrikan$/u);
    });

    it("ein Wert mit Herkunft behält sie, auch verstellt; die Zwischenüberschriften bleiben an ihren Zeilen", () => {
        const sicht = panele(stand({ rows: [zeile("querfeldeinAufschlag", 30)] }), NOW);
        const aufschlag = sicht[1]?.zeilen[0];
        expect(aufschlag?.herkunft).toMatch(/^Herkunft: 25 · .+ · config\/travel-model\/aventuria\.json, Feld „/u);
        expect(aufschlag).toMatchObject({ text: "30", neben: "fach", abweichend: true, statt: "statt 25" });
        const abschnitte = sicht[2]?.zeilen
            .filter((zeile) => zeile.wert.abschnitt !== undefined)
            .map((z) => z.wert.abschnitt);
        expect(abschnitte).toEqual(["Querfeldein", "Seefahrt", "Flug", "Wasser"]);
    });

    it("🔴 offen ist nur, was am Knopf hängt: ein Wert ohne Knopf gilt schon und zählt nicht", () => {
        // So schickt der Server es (WI-0153 Schnitt 6): Am Knopf weicht `applied` ab, ohne Knopf ist es gleich `value`.
        const rows = [
            zeile("endSnap", 0.03, null), // netz: gespeichert, nicht freigegeben
            zeile("cellUnits", 0.3), // sofort: gilt schon
            zeile("nodeGap", 0.001), // zeichnung: gilt schon
            zeile("landingReach", 4, null), // seegraph: am Knopf seit 7c, gespeichert, nicht freigegeben
        ];
        expect(offeneFolgen(stand({ rows }))).toEqual({ netz: 1, seegraph: 1, sofort: 0, zeichnung: 0 });
        expect(offeneWerte(stand({ rows }))).toBe(2);
        // Freigegeben zählt nichts mehr, auch wenn der Wert weiter von seiner Vorgabe abweicht.
        expect(offeneWerte(stand())).toBe(0);
        expect(offeneWerte(stand({ rows: [] }))).toBe(0);
        expect(offeneWerte(null)).toBe(0);
        // 🪤 Zurückgesetzt und nicht freigegeben ist auch offen — in die andere Richtung.
        expect(offeneFolgen(stand({ rows: [zeile("endSnap", null, 0.03)] }))).toMatchObject({ netz: 1 });
    });

    it("die Schiene zählt die GESPEICHERTEN Abweichungen, nicht die offenen", () => {
        expect(schienenWert(stand())).toBe("1 abweichend");
        expect(schienenWert(stand({ rows: [] }))).toBeUndefined();
        expect(schienenWert(null)).toBeUndefined();
        // Zurückgesetzt, aber noch nicht freigegeben: Das Feld steht auf der Vorgabe, die Schiene schweigt.
        expect(schienenWert(stand({ rows: [zeile("endSnap", null, 0.03)] }))).toBeUndefined();
    });

    it("🔴 gespeichert ≠ gerechnet: die Zeile sagt, mit welcher Zahl weitergerechnet wird", () => {
        const gespeichert = panele(stand({ rows: [zeile("endSnap", 0.04, 0.03, "Rondrikan")] }), NOW)[0]?.zeilen[0];
        expect(gespeichert).toMatchObject({
            eingestellt: 0.04,
            gerechnet: 0.03,
            abweichend: true,
            offen: true,
            text: "0,04",
            statt: "statt 0,02",
            nochNicht: "noch nicht gerechnet, es gilt 0,03",
        });
        // Zurückgesetzt und nicht freigegeben: Das Feld zeigt die Vorgabe, das Rücksetzzeichen ruht, offen bleibt es.
        const zurueck = panele(stand({ rows: [zeile("endSnap", null, 0.03)] }), NOW)[0]?.zeilen[0];
        expect(zurueck).toMatchObject({
            eingestellt: 0.02,
            gerechnet: 0.03,
            abweichend: false,
            offen: true,
            text: "0,02",
            statt: null,
            nochNicht: "noch nicht gerechnet, es gilt 0,03",
        });
        // Freigegeben: dieselbe Zahl in beiden Tafeln, kein zweiter Satz.
        expect(panele(stand(), NOW)[0]?.zeilen[0]).toMatchObject({ offen: false, nochNicht: null });
        // 🔴 Ein Wert OHNE Knopf trägt nie den zweiten Satz: Er gilt schon (Schnitt 6, Teil `settingsLive`).
        const ohneKnopf = panele(stand({ rows: [zeile("cellUnits", 0.3)] }), NOW)[2]?.zeilen[0];
        expect(ohneKnopf).toMatchObject({ eingestellt: 0.3, gerechnet: 0.3, offen: false, nochNicht: null });
        expect(ohneKnopf?.statt).toBe("statt 0,25");
    });
});

describe("Die Leiste über den Panelen", () => {
    it("🔴 still, wenn gespeichert und gerechnet gleich sind — und sie unterscheidet das von „nichts verstellt“", () => {
        const leer = leiste(stand({ rows: [], appliedAt: null, appliedBy: null }), NOW);
        expect(leer).toMatchObject({
            offen: 0,
            satz: "Jeder Wert steht auf seiner Vorgabe.",
            kosten: null,
            bleibt: null,
        });
        expect(leer.freigabe).toBeNull();
        expect(leiste(stand(), NOW)).toMatchObject({ offen: 0, satz: "Gespeichert und gerechnet sind gleich." });
    });

    it("🔴 offen: die Zahl, was das Freigeben kostet, und womit bis dahin gerechnet wird", () => {
        const eine = leiste(stand({ rows: [zeile("endSnap", 0.03, null)] }), NOW);
        expect(eine.offen).toBe(1);
        expect(eine.satz).toBe("1 Wert ist geändert und noch nicht gerechnet.");
        expect(eine.bleibt).toBe("Bis zum Freigeben rechnet die Wegfindung für diese Werte unverändert weiter.");
        expect(eine.kosten).toMatch(/^Freigeben baut das Wegenetz neu/u);
        const zwei = leiste(stand({ rows: [zeile("endSnap", 0.03, null), zeile("cellUnits", 0.3, null)] }), NOW);
        expect(zwei).toMatchObject({ offen: 2, satz: "2 Werte sind geändert und noch nicht gerechnet." });
    });

    it("🔴 der Seegraph über den einen Knopf: veraltet weckt er ihn, eine wartende oder laufende Ableitung nicht", () => {
        // Betreiber 2026-10-18: „Seewege“ über „Wegenetz neu berechnen“, kein zweiter Knopf.
        const passt = leiste(stand(), NOW);
        expect(passt).toMatchObject({ offen: 0, wach: false, seeSatz: null, seeKosten: null, seeAuftrag: null });
        const veraltet = leiste(stand({ seaGraph: { derivedAt: null, stale: true, job: null, jobState: null } }), NOW);
        expect(veraltet).toMatchObject({ offen: 0, wach: true, satz: "Gespeichert und gerechnet sind gleich." });
        expect(veraltet.seeSatz).toBe(
            "Meere, Seen oder Häfen haben sich geändert: Der Seegraph braucht eine neue Ableitung.",
        );
        expect(veraltet.seeKosten).toMatch(/^Dazu wird der Seegraph neu abgeleitet, zwei bis fünf Minuten/u);
        for (const jobState of ["QUEUED", "RUNNING"]) {
            const unterwegs = leiste(
                stand({
                    seaGraph: { derivedAt: null, stale: true, job: "66666666-7777-4888-8999-000000000000", jobState },
                }),
                NOW,
            );
            expect(unterwegs).toMatchObject({ wach: false, seeSatz: null, seeKosten: null });
            expect(unterwegs.seeAuftrag).toMatchObject({ text: jobState === "QUEUED" ? "wartet" : "läuft" });
        }
        // Ein offener Wert der Folge `seegraph` bringt die Ableitung mit: wach über `offen`, und die Kosten stehen dabei.
        const wert = leiste(stand({ rows: [zeile("landingReach", 4, null)] }), NOW);
        expect(wert).toMatchObject({ offen: 1, wach: true, seeSatz: null });
        expect(wert.seeKosten).not.toBeNull();
        expect(leiste(stand({ rows: [zeile("endSnap", 0.03, null)] }), NOW).seeKosten).toBeNull();
    });

    it("🔴 ein verstellter Wert ohne Knopf lässt die Leiste still: er gilt schon", () => {
        const ohneKnopf = leiste(stand({ rows: [zeile("cellUnits", 0.3)] }), NOW);
        expect(ohneKnopf).toMatchObject({ offen: 0, kosten: null, bleibt: null });
        expect(ohneKnopf.satz).toBe("Gespeichert und gerechnet sind gleich.");
    });

    it("zuletzt gerechnet, und der Auftrag mit dem Wort der Warteschlange und dem Kreis des Hauses", () => {
        expect(leiste(stand(), NOW).freigabe).toMatch(/^zuletzt gerechnet .+ · Rondrikan$/u);
        expect(leiste(stand(), NOW).auftrag).toBeNull();
        const job = { appliedJob: "11111111-2222-3333-4444-555555555555", appliedJobState: "QUEUED" };
        expect(leiste(stand(job), NOW).auftrag).toMatchObject({ text: "wartet", fuellung: "leer", gescheitert: false });
        expect(leiste(stand({ ...job, appliedJobState: "RUNNING" }), NOW).auftrag).toMatchObject({
            text: "läuft",
            fuellung: "halb",
        });
        expect(leiste(stand({ ...job, appliedJobState: "SUCCEEDED" }), NOW).auftrag).toMatchObject({
            text: "fertig",
            fuellung: "voll",
        });
        expect(leiste(stand({ ...job, appliedJobState: "FAILED" }), NOW).auftrag).toMatchObject({ gescheitert: true });
        // Ein unbekannter Zustand wird nicht geraten: Der Rohwert steht da.
        expect(leiste(stand({ ...job, appliedJobState: "ERFUNDEN" }), NOW).auftrag).toMatchObject({ text: "ERFUNDEN" });
        expect(leiste(stand({ ...job, appliedJobState: null }), NOW).auftrag).toMatchObject({ text: "unbekannt" });
    });

    it("Zahl und Einheit in der Sprache der Seite", () => {
        expect(zahl(1500000)).toBe("1.500.000");
        expect(zahl(0.0005)).toBe("0,0005");
        const zelle = WEGFINDUNG_WERTE.find((wert) => wert.id === "cellUnits")!;
        expect(neben(zelle, 0.25)).toBe("(0,75 Meilen)");
        locale.value = "en";
        expect(zahl(1500000)).toBe("1,500,000");
        expect(neben(zelle, 0.25)).toBe("(0.75 miles)");
        locale.value = "de";
    });
});

describe("Die getippte Zahl", () => {
    it("🔴 Komma und Punkt: „0,03“ und „0.03“ sind beide 0,03, „1.500“ bleibt 1500", () => {
        expect(leseZahl("0,03")).toBe(0.03);
        expect(leseZahl("0.03")).toBe(0.03);
        expect(leseZahl("1.5")).toBe(1.5);
        expect(leseZahl("1.500")).toBe(1500);
        expect(leseZahl("1.500.000")).toBe(1500000);
        expect(leseZahl("1.500,5")).toBe(1500.5);
        expect(leseZahl(" 25 ")).toBe(25);
    });

    it("keine Zahl: leer, Text, Vorzeichen, Exponent", () => {
        for (const text of ["", "   ", "viel", "-3", "1e3", "0,0,3", "3,"]) {
            expect(leseZahl(text), text).toBeNull();
        }
    });

    it("in englischer Sprache liest das Feld englisch", () => {
        locale.value = "en";
        expect(leseZahl("1,500,000")).toBe(1500000);
        expect(leseZahl("0.03")).toBe(0.03);
        locale.value = "de";
    });

    it("🔴 die Grenzen am Feld sind die des Registers, Wert für Wert", () => {
        const fang = WEGFINDUNG_WERTE.find((wert) => wert.id === "endSnap")!;
        expect(problemSatz(fang, "0,03")).toBeNull();
        expect(problemSatz(fang, "2")).toEqual({
            key: "admin.wegfindung.invalid.range",
            params: { min: "0,001", max: "0,05" },
        });
        expect(problemSatz(fang, "viel")).toEqual({ key: "admin.wegfindung.invalid.number" });
    });
});

type Answer = { status: number; body?: unknown };
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
const RECEIPT: Answer = {
    status: 200,
    body: { operationId: "x", status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] },
};

describe("Verstellen und Zurücksetzen", () => {
    it("🔴 schickt Revision, Kennung und Zahl; danach neu geladen und das Feld wieder am Stand", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand({ rows: [] }) }, RECEIPT, {
            status: 200,
            body: stand({ revision: 5 }),
        });
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        h.tippe("endSnap", "0,03");
        await h.uebernimm("endSnap");
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/wegfindung");
        expect(post?.body).toMatchObject({ baseRevision: 4, id: "endSnap", value: 0.03 });
        expect(h.stand.value?.revision).toBe(5);
        expect(h.felder.value["endSnap"]).toBeUndefined();
        expect(h.busy.value).toBeNull();
    });

    it("🔴 die Vorgabe eingetippt heißt löschen, nicht speichern", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand() }, RECEIPT, {
            status: 200,
            body: stand({ rows: [], revision: 5 }),
        });
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        h.tippe("endSnap", "0,02");
        await h.uebernimm("endSnap");
        expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({ id: "endSnap", value: null });
    });

    it("🔴 eine Zahl außerhalb der Grenzen geht nicht hinaus, sondern steht am Feld", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand() });
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        h.tippe("endSnap", "2");
        await h.uebernimm("endSnap");
        expect(calls.filter((call) => call.method === "POST")).toEqual([]);
        expect(h.probleme.value["endSnap"]?.key).toBe("admin.wegfindung.invalid.range");
        // Weitertippen löscht das Problem, ein leeres Feld fällt auf den Stand zurück.
        h.tippe("endSnap", "");
        expect(h.probleme.value["endSnap"]).toBeUndefined();
        await h.uebernimm("endSnap");
        expect(h.felder.value["endSnap"]).toBeUndefined();
    });

    it("dieselbe Zahl noch einmal ist keine Änderung; das Rücksetzzeichen an einem Wert auf seiner Vorgabe schweigt", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand() });
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        h.tippe("endSnap", "0,03");
        await h.uebernimm("endSnap");
        await h.zuruecksetzen("endpointBox");
        expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    });

    it("🔴 das Rücksetzzeichen schickt null; ein abgebrochener Passkey ändert nichts", async () => {
        const { calls, fetcher } = server(
            { status: 200, body: stand() },
            RECEIPT,
            { status: 200, body: stand({ rows: [], revision: 5 }) },
            { status: 200, body: stand() },
            { status: 403, body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } } },
            { status: 200, body: stand() },
        );
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        await h.zuruecksetzen("endSnap");
        expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({ id: "endSnap", value: null });
        expect(h.stand.value?.rows).toEqual([]);

        const zweite = createWegfindung({ fetcher, ask: async () => false });
        await zweite.load();
        await zweite.zuruecksetzen("endSnap");
        expect(zweite.ergebnis.value).toEqual({
            id: "endSnap",
            result: { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] },
        });
    });

    it("ein Konflikt des Servers steht an seiner Kennung, mit Person und Zeit", async () => {
        const { fetcher } = server(
            { status: 200, body: stand() },
            {
                status: 409,
                body: {
                    error: {
                        code: "edit_conflict",
                        message: "x",
                        details: { changedBy: { displayName: "Admina" }, changedAt: NOW.toISOString() },
                    },
                },
            },
            { status: 200, body: stand({ revision: 9 }) },
        );
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        h.tippe("endpointBox", "0,6");
        await h.uebernimm("endpointBox");
        expect(h.ergebnis.value?.id).toBe("endpointBox");
        expect(h.ergebnis.value?.result.conflict).toEqual({ by: "Admina", at: NOW.toISOString() });
        expect(h.stand.value?.revision).toBe(9);
    });
});

describe("Freigeben", () => {
    it("🔴 schickt nur Vorgang und Revision — keine Werte — und lädt danach neu", async () => {
        const offen = stand({ rows: [zeile("endSnap", 0.03, null)] });
        const { calls, fetcher } = server({ status: 200, body: offen }, RECEIPT, {
            status: 200,
            body: stand({ revision: 5, appliedJob: "11111111-2222-3333-4444-555555555555", appliedJobState: "QUEUED" }),
        });
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        await h.freigeben();
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/wegfindung/freigeben");
        expect(Object.keys(post?.body ?? {}).sort()).toEqual(["baseRevision", "operationId"]);
        expect(post?.body).toMatchObject({ baseRevision: 4 });
        expect(h.freigabe.value).toEqual({ ok: true, problems: [] });
        expect(h.freigebend.value).toBe(false);
        // Nach dem Laden steht der Auftrag in der Leiste, und nichts ist mehr offen.
        expect(leiste(h.stand.value, NOW)).toMatchObject({ offen: 0 });
        expect(leiste(h.stand.value, NOW).auftrag).toMatchObject({ text: "wartet" });
    });

    it("nichts freizugeben: der Grund steht an der Leiste, nicht an einer Zeile", async () => {
        const { fetcher } = server(
            { status: 200, body: stand() },
            { status: 409, body: { error: { code: "nothing_to_apply", message: "Es ist nichts freizugeben." } } },
            { status: 200, body: stand() },
        );
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        await h.freigeben();
        expect(h.freigabe.value?.ok).toBe(false);
        expect(h.ergebnis.value).toBeNull();
    });

    it("ein abgebrochener Passkey gibt nichts frei", async () => {
        const { fetcher } = server(
            { status: 200, body: stand({ rows: [zeile("endSnap", 0.03, null)] }) },
            { status: 403, body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } } },
            { status: 200, body: stand({ rows: [zeile("endSnap", 0.03, null)] }) },
        );
        const h = createWegfindung({ fetcher, ask: async () => false });
        await h.load();
        await h.freigeben();
        expect(h.freigabe.value).toEqual({ ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] });
        expect(leiste(h.stand.value, NOW).offen).toBe(1);
    });
});

describe("Freigeben mit veraltetem Seegraphen (WI-0153 7b)", () => {
    it("🔴 ohne offenen Wert schickt der Knopf dieselbe Freigabe; danach steht die Ableitung mit Wort und Kreis da", async () => {
        const veraltet = stand({ seaGraph: { derivedAt: null, stale: true, job: null, jobState: null } });
        const { calls, fetcher } = server({ status: 200, body: veraltet }, RECEIPT, {
            status: 200,
            body: stand({
                revision: 5,
                appliedJob: "11111111-2222-3333-4444-555555555555",
                appliedJobState: "QUEUED",
                seaGraph: {
                    derivedAt: null,
                    stale: true,
                    job: "66666666-7777-4888-8999-000000000000",
                    jobState: "QUEUED",
                },
            }),
        });
        const h = createWegfindung({ fetcher, ask: async () => true });
        await h.load();
        expect(leiste(h.stand.value, NOW).wach).toBe(true);
        await h.freigeben();
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/wegfindung/freigeben");
        expect(Object.keys(post?.body ?? {}).sort()).toEqual(["baseRevision", "operationId"]);
        expect(h.freigabe.value).toEqual({ ok: true, problems: [] });
        expect(leiste(h.stand.value, NOW)).toMatchObject({ wach: false, seeAuftrag: { text: "wartet" } });
    });
});
