import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    WETTERMODELL_URL,
    WETTER_PRESETS_URL,
    WETTER_PRESET_VORGABEN,
    WETTER_SYMBOLE_URL,
    WETTER_SYMBOL_VORGABEN,
    WETTER_URL,
    WETTER_WIKI_URL,
    wetterNeuePresetWerte,
    wetterPresetEntfernenUrl,
    wetterPresetUrl,
    wetterPresetZeitpunktUrl,
    wetterSymbolEntfernenUrl,
    wetterSymbolUrl,
    type OperationReceipt,
    type Role,
    type WetterDatenAntwort,
    type WetterWikiArtikelAntwort,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Das Wetter (WI-0288 Stufe 2, Migration 0326): der öffentliche Leseweg mit Vorgaben, das Materialisieren beim ersten Ändern, der Tausch der
 * Zeitpunkte samt „unbestimmt“, die Grenzen am Server, die Rechte und das Wettermodell. Fastify läuft als App-Rolle auf einem Wegwerf-Cluster
 * mit den Rollen und Vorlagen des VPS: Jeder Schreibweg hier ist zugleich der Beleg, dass die App ihn darf.
 */

const ENV = "wetter";
const grants = [fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url))];
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0288-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    auth: TEST_AUTH,
    mapEditing: "testwelt",
};

const code = (response: { statusCode: number; json(): unknown }): string =>
    response.statusCode < 300
        ? String(response.statusCode)
        : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

describe("GET /api/wetter ohne Datenbank", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
        app = buildApp({ config });
        await app.ready();
    });
    afterAll(async () => app?.close());

    it("🔴 die Vorgaben aus dem Code, mit ETag und 304 beim zweiten Blick", async () => {
        const erste = await app.inject({ method: "GET", url: WETTER_URL });
        expect(erste.statusCode).toBe(200);
        expect(erste.headers["cache-control"]).toBe("no-cache");
        const daten = erste.json<WetterDatenAntwort>();
        expect(daten.quelle).toEqual({ presets: "fehlt", symbole: "fehlt", modell: "fehlt" });
        expect(daten.presets.map((preset) => preset.id)).toEqual(WETTER_PRESET_VORGABEN.map((preset) => preset.id));
        expect(daten.symbole).toHaveLength(WETTER_SYMBOL_VORGABEN.length);
        expect(daten.modell.werte["takt"]).toBe(30);
        const zweite = await app.inject({
            method: "GET",
            url: WETTER_URL,
            headers: { "if-none-match": String(erste.headers["etag"]) },
        });
        expect(zweite.statusCode).toBe(304);
    });
});

describeWithCluster("Wetter: Presets, Icons und Wettermodell als App-Rolle (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    const leute: Partial<Record<Role | "meteorologe", { cookie: string }>> = {};

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        fixture = authFixture(cluster.admin);
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
        for (const rolle of ["reviewer", "editor", "admin", "operator"] as const) {
            const person = await fixture.person(rolle, { name: `Wetter ${rolle}` });
            leute[rolle] = await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 1 });
        }
        const tester = await fixture.person("tester", { name: "Wetter Meteorologin" });
        await cluster.admin`
            INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, granted_by, reason)
            VALUES (${tester.id}, 'test', 'meteorologe', ${tester.id}, 'Probe WI-0288')
        `;
        leute.meteorologe = await fixture.session(tester.id, { assurance: "strong", passkeyMinutesAgo: 1 });
    }, 180_000);

    beforeEach(async () => {
        await cluster!.migrator`DELETE FROM weather_preset`;
        await cluster!.migrator`DELETE FROM weather_symbol`;
        await cluster!.migrator`DELETE FROM weather_model_setting`;
    });

    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    const lies = async (): Promise<WetterDatenAntwort> => {
        const response = await app.inject({ method: "GET", url: WETTER_URL });
        expect(response.statusCode).toBe(200);
        return response.json<WetterDatenAntwort>();
    };
    const schreibe = (
        method: "POST" | "PATCH",
        url: string,
        payload: object,
        wer: keyof typeof leute | null = "editor",
    ) =>
        app.inject({
            method,
            url,
            payload: { operationId: randomUUID(), ...payload },
            headers: { origin: TEST_ORIGIN, ...(wer === null ? {} : { cookie: leute[wer]!.cookie }) },
        });
    const preset = (daten: WetterDatenAntwort, id: string) => daten.presets.find((p) => p.id === id)!;
    const ereignisse = async (action: string) =>
        cluster!.admin<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;

    it("🔴 leere Tafeln: der Leseweg zeigt die Vorgaben mit Revision 0, die Revision des Modells steht", async () => {
        const daten = await lies();
        expect(daten.quelle).toEqual({ presets: "vorgabe", symbole: "vorgabe", modell: "vorgabe" });
        expect(daten.presets.every((p) => p.revision === 0)).toBe(true);
        expect(daten.presets.filter((p) => p.tag === null).map((p) => p.id)).toEqual(["p-u"]);
        expect(daten.symbole.map((s) => s.id)).toEqual(WETTER_SYMBOL_VORGABEN.map((s) => s.id));
        expect(daten.modell.revision).toBeGreaterThanOrEqual(1);
        expect(daten.modell.verstellt).toEqual([]);
    });

    it("🔴 die erste Änderung schreibt alle 14 Presets in einer Transaktion; nur das geänderte hebt seine Revision", async () => {
        const erste = await schreibe("PATCH", wetterPresetUrl("p-praios"), {
            baseRevision: 0,
            werte: { tn: 5, cov: 2 },
        });
        expect(code(erste)).toBe("200");
        expect(erste.json<OperationReceipt>().affected).toEqual([
            { kind: "wetter_preset", id: "p-praios", revision: 1 },
        ]);
        const [zahl] = await cluster!.admin<{ n: number; null_tage: number }[]>`
            SELECT count(*)::int AS n, count(*) FILTER (WHERE tag = 0)::int AS null_tage FROM weather_preset
        `;
        expect(zahl).toEqual({ n: 14, null_tage: 1 });
        const daten = await lies();
        expect(daten.quelle.presets).toBe("gespeichert");
        expect(preset(daten, "p-praios")).toMatchObject({ tag: 15, revision: 1 });
        expect(preset(daten, "p-praios").werte).toMatchObject({ tn: 5, cov: 2 });
        expect(preset(daten, "p-rondra").revision).toBe(0);
        // Ein zweiter Editor, der die Vorgaben noch vor sich hat, ändert ein anderes Preset: Dessen Revision ist weiter 0, kein Konflikt.
        expect(code(await schreibe("PATCH", wetterPresetUrl("p-rondra"), { baseRevision: 0, werte: { ts: 31 } }))).toBe(
            "200",
        );
        // Wer das geänderte Preset mit der alten Revision ändert, bekommt den Konflikt.
        expect(code(await schreibe("PATCH", wetterPresetUrl("p-praios"), { baseRevision: 0, werte: { tn: 6 } }))).toBe(
            "409 edit_conflict",
        );
        expect(code(await schreibe("PATCH", wetterPresetUrl("p-praios"), { baseRevision: 1, werte: { tn: 5 } }))).toBe(
            "409 no_change",
        );
        const protokoll = await ereignisse("system.wetter_preset_geaendert");
        expect(protokoll.map((e) => e.details)).toEqual([
            { preset: "p-praios", aktion: "werte", werte: ["cov", "tn"], materialisiert: true },
            { preset: "p-rondra", aktion: "werte", werte: ["ts"], materialisiert: false },
        ]);
    });

    it("🔴 Zeitpunkte: auf einen besetzten Tag tauschen beide, auf „unbestimmt“ tauscht das bisherige, das unbestimmte bleibt", async () => {
        const tausch = await schreibe("POST", wetterPresetZeitpunktUrl("p-praios"), { baseRevision: 0, tag: 45 });
        expect(code(tausch)).toBe("200");
        expect(tausch.json<OperationReceipt>().affected).toEqual([
            { kind: "wetter_preset", id: "p-praios", revision: 1 },
            { kind: "wetter_preset", id: "p-rondra", revision: 1 },
        ]);
        let daten = await lies();
        expect([preset(daten, "p-praios").tag, preset(daten, "p-rondra").tag]).toEqual([45, 15]);

        // Ein Preset auf „unbestimmt“: Das bisher unbestimmte bekommt seinen Tag.
        expect(code(await schreibe("POST", wetterPresetZeitpunktUrl("p-boron"), { baseRevision: 0, tag: null }))).toBe(
            "200",
        );
        daten = await lies();
        expect(preset(daten, "p-boron").tag).toBeNull();
        expect(preset(daten, "p-u").tag).toBe(135);
        expect(daten.presets.filter((p) => p.tag === null)).toHaveLength(1);

        // Das unbestimmte auf einen freien Tag: Genau eines muss unbestimmt bleiben.
        expect(code(await schreibe("POST", wetterPresetZeitpunktUrl("p-boron"), { baseRevision: 1, tag: 100 }))).toBe(
            "409 unbestimmt_bleibt",
        );
        // Ein datiertes auf einen freien Tag geht.
        expect(code(await schreibe("POST", wetterPresetZeitpunktUrl("p-u"), { baseRevision: 1, tag: 100 }))).toBe(
            "200",
        );
        expect(code(await schreibe("POST", wetterPresetZeitpunktUrl("p-u"), { baseRevision: 2, tag: 100 }))).toBe(
            "409 no_change",
        );
        daten = await lies();
        expect(new Set(daten.presets.map((p) => p.tag)).size).toBe(14);
        const protokoll = await ereignisse("system.wetter_preset_geaendert");
        expect(protokoll.at(-1)!.details).toEqual({
            preset: "p-u",
            aktion: "zeitpunkt",
            tag: 100,
            getauscht: null,
            materialisiert: false,
        });
    });

    /** Legt ein Preset an einem Tag an und gibt Kennung und Revision der Quittung. */
    const lege = async (tag: number, wer: keyof typeof leute = "editor") => {
        const antwort = await schreibe("POST", WETTER_PRESETS_URL, { tag }, wer);
        expect(code(antwort), antwort.body).toBe("200");
        return antwort.json<OperationReceipt>().affected[0]!;
    };

    it("🔴 Presets anlegen: Werte der Überblendung am Tag, Lesen nach den 14, Ändern, Verschieben und Tausch gehen, ein belegter Tag nicht", async () => {
        const neu = await lege(100);
        expect(neu.id).toMatch(/^p-[a-z]{8}$/);
        expect(neu).toMatchObject({ kind: "wetter_preset", revision: 1 });
        const [zahl] = await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM weather_preset`;
        expect(zahl!.n).toBe(15);
        let daten = await lies();
        expect(daten.quelle.presets).toBe("gespeichert");
        expect(daten.presets).toHaveLength(15);
        expect(daten.presets.slice(0, 14).map((p) => p.id)).toEqual(WETTER_PRESET_VORGABEN.map((p) => p.id));
        expect(daten.presets[14]).toMatchObject({ id: neu.id, tag: 100, revision: 1 });
        expect(daten.presets[14]!.werte).toEqual(wetterNeuePresetWerte(WETTER_PRESET_VORGABEN, 100));

        // Ein zweites an einem früheren Tag steht nach Tag sortiert VOR dem ersten, beide nach den 14.
        const frueh = await lege(20);
        daten = await lies();
        expect(daten.presets.slice(14).map((p) => [p.id, p.tag])).toEqual([
            [frueh.id, 20],
            [neu.id, 100],
        ]);

        // Belegte Tage: ein fester, ein angelegter. Kein Tag im Jahr: 400.
        expect(code(await schreibe("POST", WETTER_PRESETS_URL, { tag: 15 }))).toBe("409 tag_belegt");
        expect(code(await schreibe("POST", WETTER_PRESETS_URL, { tag: 100 }))).toBe("409 tag_belegt");
        for (const tag of [0, 366, 1.5])
            expect(code(await schreibe("POST", WETTER_PRESETS_URL, { tag }))).toBe("400 validation_failed");

        // Werte ändern, verschieben und mit einem festen Preset tauschen.
        expect(code(await schreibe("PATCH", wetterPresetUrl(neu.id), { baseRevision: 1, werte: { tn: 5 } }))).toBe(
            "200",
        );
        expect(code(await schreibe("PATCH", wetterPresetUrl(neu.id), { baseRevision: 1, werte: { tn: 6 } }))).toBe(
            "409 edit_conflict",
        );
        expect(code(await schreibe("POST", wetterPresetZeitpunktUrl(neu.id), { baseRevision: 2, tag: 200 }))).toBe(
            "200",
        );
        const tausch = await schreibe("POST", wetterPresetZeitpunktUrl(neu.id), { baseRevision: 3, tag: 15 });
        expect(code(tausch)).toBe("200");
        expect(tausch.json<OperationReceipt>().affected.map((a) => a.id)).toEqual([neu.id, "p-praios"]);
        daten = await lies();
        expect(preset(daten, neu.id)).toMatchObject({ tag: 15, revision: 4 });
        expect(preset(daten, neu.id).werte["tn"]).toBe(5);
        expect(preset(daten, "p-praios").tag).toBe(200);

        const protokoll = (await ereignisse("system.wetter_preset_geaendert")).map((e) => e.details);
        expect(protokoll.find((d) => d["preset"] === neu.id && d["aktion"] === "angelegt")).toEqual({
            preset: neu.id,
            aktion: "angelegt",
            tag: 100,
            materialisiert: true,
        });
        expect(protokoll.find((d) => d["preset"] === frueh.id)).toEqual({
            preset: frueh.id,
            aktion: "angelegt",
            tag: 20,
            materialisiert: false,
        });
    });

    it("🔴 Presets entfernen: ein angelegtes geht (hart, Werte im Protokoll), ein festes und das unbestimmte nicht", async () => {
        const neu = await lege(100);
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl("p-praios"), { baseRevision: 0 }))).toBe(
            "409 vorgabe_bleibt",
        );
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl("p-u"), { baseRevision: 0 }))).toBe(
            "409 vorgabe_bleibt",
        );
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl("p-erfunden"), { baseRevision: 0 }))).toBe(
            "404 not_found",
        );

        // Das angelegte Preset wird zum unbestimmten (das bisherige p-u zieht an seinen Tag): Dann bleibt es.
        expect(code(await schreibe("POST", wetterPresetZeitpunktUrl(neu.id), { baseRevision: 1, tag: null }))).toBe(
            "200",
        );
        let daten = await lies();
        expect(preset(daten, neu.id).tag).toBeNull();
        expect(preset(daten, "p-u").tag).toBe(100);
        expect(daten.presets.slice(0, 14).map((p) => p.id)).toEqual(WETTER_PRESET_VORGABEN.map((p) => p.id));
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl(neu.id), { baseRevision: 2 }))).toBe(
            "409 unbestimmt_bleibt",
        );
        // Zurück auf einen Tag (p-u wird wieder unbestimmt), dann geht es.
        expect(code(await schreibe("POST", wetterPresetZeitpunktUrl(neu.id), { baseRevision: 2, tag: 100 }))).toBe(
            "200",
        );
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl(neu.id), { baseRevision: 2 }))).toBe(
            "409 edit_conflict",
        );
        const weg = await schreibe("POST", wetterPresetEntfernenUrl(neu.id), { baseRevision: 3 });
        expect(code(weg)).toBe("200");
        expect(weg.json<OperationReceipt>().affected).toEqual([{ kind: "wetter_preset", id: neu.id, revision: 4 }]);
        daten = await lies();
        expect(daten.presets).toHaveLength(14);
        const [zahl] = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM weather_preset WHERE preset_id = ${neu.id}
        `;
        expect(zahl!.n).toBe(0);
        const protokoll = (await ereignisse("system.wetter_preset_geaendert")).map((e) => e.details);
        expect(protokoll.find((d) => d["preset"] === neu.id && d["aktion"] === "entfernt")).toMatchObject({
            preset: neu.id,
            aktion: "entfernt",
            tag: 100,
            materialisiert: false,
            werte: wetterNeuePresetWerte(WETTER_PRESET_VORGABEN, 100),
        });
        // Dasselbe Preset noch einmal: weg.
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl(neu.id), { baseRevision: 3 }))).toBe(
            "404 not_found",
        );
    });

    it("🔴 Rechte: Anlegen und Entfernen von Presets ab Editor und für den Meteorologen, nicht ohne Sitzung oder als Prüfer", async () => {
        expect(code(await schreibe("POST", WETTER_PRESETS_URL, { tag: 100 }, null))).toBe("401 unauthenticated");
        expect(code(await schreibe("POST", WETTER_PRESETS_URL, { tag: 100 }, "reviewer"))).toBe("403 forbidden");
        const neu = await lege(100, "meteorologe");
        const entfernen = { baseRevision: neu.revision };
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl(neu.id), entfernen, null))).toBe(
            "401 unauthenticated",
        );
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl(neu.id), entfernen, "reviewer"))).toBe(
            "403 forbidden",
        );
        expect(code(await schreibe("POST", wetterPresetEntfernenUrl(neu.id), entfernen, "meteorologe"))).toBe("200");
    });

    it("🔴 Grenzen prüft der Server: 400 mit dem Feld, ohne dass etwas gespeichert wird", async () => {
        const faelle: [string, "POST" | "PATCH", string, object][] = [
            ["400 value_out_of_range", "PATCH", wetterPresetUrl("p-praios"), { baseRevision: 0, werte: { tn: 99 } }],
            ["400 value_out_of_range", "PATCH", wetterPresetUrl("p-praios"), { baseRevision: 0, werte: { tn: null } }],
            ["400 unknown_setting", "PATCH", wetterPresetUrl("p-praios"), { baseRevision: 0, werte: { erfunden: 1 } }],
            ["404 not_found", "PATCH", wetterPresetUrl("p-erfunden"), { baseRevision: 0, werte: { tn: 1 } }],
            ["400 validation_failed", "POST", wetterPresetZeitpunktUrl("p-praios"), { baseRevision: 0, tag: 366 }],
            [
                "400 value_out_of_range",
                "POST",
                WETTER_SYMBOLE_URL,
                { art: "wind", x: 2000, z: 1, reichweite: 50, staerke: 5, richtung: 0 },
            ],
            [
                "400 symbol_ungueltig",
                "POST",
                WETTER_SYMBOLE_URL,
                { art: "wind", x: 1, z: 1, reichweite: 50, staerke: 5 },
            ],
            [
                "400 symbol_ungueltig",
                "POST",
                WETTER_SYMBOLE_URL,
                { art: "wirbel", x: 1, z: 1, reichweite: 50, staerke: 5, richtung: 10, drehsinn: 1 },
            ],
            [
                "400 value_out_of_range",
                "POST",
                WETTER_SYMBOLE_URL,
                { art: "stroemung", x: 1, z: 1, reichweite: 50, staerke: 5, richtung: 360 },
            ],
        ];
        for (const [erwartet, method, url, payload] of faelle) {
            const antwort = await schreibe(method, url, payload);
            expect(code(antwort), `${url} ${JSON.stringify(payload)}: ${antwort.body}`).toBe(erwartet);
        }
        const [zahl] = await cluster!.admin<{ p: number; s: number }[]>`
            SELECT (SELECT count(*)::int FROM weather_preset) AS p, (SELECT count(*)::int FROM weather_symbol) AS s
        `;
        expect(zahl).toEqual({ p: 0, s: 0 });
    });

    it("🔴 Rechte: Presets und Icons ab Editor und für den Meteorologen, das Wettermodell nur Betreiber und Meteorologe", async () => {
        const werte = { baseRevision: 0, werte: { tn: 1 } };
        expect(code(await schreibe("PATCH", wetterPresetUrl("p-praios"), werte, null))).toBe("401 unauthenticated");
        expect(code(await schreibe("PATCH", wetterPresetUrl("p-praios"), werte, "reviewer"))).toBe("403 forbidden");
        expect(code(await schreibe("PATCH", wetterPresetUrl("p-praios"), werte, "meteorologe"))).toBe("200");
        const modell = async (wer: keyof typeof leute) =>
            code(
                await schreibe(
                    "POST",
                    WETTERMODELL_URL,
                    {
                        baseRevision: (await lies()).modell.revision!,
                        id: "tempo",
                        value: wer === "operator" ? 0.2 : 0.3,
                    },
                    wer,
                ),
            );
        expect(await modell("editor")).toBe("403 forbidden");
        expect(await modell("admin")).toBe("403 forbidden");
        expect(await modell("operator")).toBe("200");
        expect(await modell("meteorologe")).toBe("200");
    });

    it("🔴 Icons: das erste Anlegen schreibt die Vorgaben mit; ändern, ausblenden und weich entfernen", async () => {
        const neu = await schreibe("POST", WETTER_SYMBOLE_URL, {
            art: "wirbel",
            name: "  Probewirbel  ",
            x: 300,
            z: 400,
            reichweite: 60,
            staerke: 9,
            drehsinn: 1,
        });
        expect(code(neu)).toBe("200");
        const { id, revision } = neu.json<OperationReceipt>().affected[0]!;
        expect(revision).toBe(1);
        let daten = await lies();
        expect(daten.quelle.symbole).toBe("gespeichert");
        expect(daten.symbole).toHaveLength(WETTER_SYMBOL_VORGABEN.length + 1);
        expect(daten.symbole.at(-1)).toMatchObject({
            id,
            name: "Probewirbel",
            richtung: null,
            drehsinn: 1,
            sichtbar: true,
        });

        const vorgabe = WETTER_SYMBOL_VORGABEN[0]!;
        const aendern = await schreibe("PATCH", wetterSymbolUrl(vorgabe.id), {
            baseRevision: 0,
            aenderungen: { sichtbar: false, richtung: 90, name: "" },
        });
        expect(code(aendern)).toBe("200");
        daten = await lies();
        expect(daten.symbole[0]).toMatchObject({
            id: vorgabe.id,
            sichtbar: false,
            richtung: 90,
            name: null,
            revision: 1,
        });

        expect(code(await schreibe("POST", wetterSymbolEntfernenUrl(id), { baseRevision: 0 }))).toBe(
            "409 edit_conflict",
        );
        expect(code(await schreibe("POST", wetterSymbolEntfernenUrl(id), { baseRevision: 1 }))).toBe("200");
        expect(code(await schreibe("POST", wetterSymbolEntfernenUrl(id), { baseRevision: 2 }))).toBe("404 not_found");
        daten = await lies();
        expect(daten.symbole.map((s) => s.id)).toEqual(WETTER_SYMBOL_VORGABEN.map((s) => s.id));
        const protokoll = await ereignisse("system.wetter_symbol_geaendert");
        expect(protokoll.map((e) => e.details)).toEqual([
            { symbol: id, aktion: "angelegt", art: "wirbel", materialisiert: true },
            {
                symbol: vorgabe.id,
                aktion: "geaendert",
                felder: ["name", "richtung", "sichtbar"],
                materialisiert: false,
            },
            { symbol: id, aktion: "entfernt", materialisiert: false },
        ]);
    });

    it("🔴 Mahlstrom (0327): mit Drehsinn ja, mit Richtung 400; lesen und ändern", async () => {
        const neu = await schreibe("POST", WETTER_SYMBOLE_URL, {
            art: "mahlstrom",
            name: "Probestrudel",
            x: 300,
            z: 400,
            reichweite: 60,
            staerke: 4,
            drehsinn: 1,
        });
        expect(code(neu), neu.body).toBe("200");
        const { id } = neu.json<OperationReceipt>().affected[0]!;
        const ohneDrehsinn = await schreibe("POST", WETTER_SYMBOLE_URL, {
            art: "mahlstrom",
            x: 1,
            z: 1,
            reichweite: 50,
            staerke: 5,
            richtung: 10,
        });
        expect(code(ohneDrehsinn)).toBe("400 symbol_ungueltig");
        const mitBeidem = await schreibe("POST", WETTER_SYMBOLE_URL, {
            art: "mahlstrom",
            x: 1,
            z: 1,
            reichweite: 50,
            staerke: 5,
            richtung: 10,
            drehsinn: 1,
        });
        expect(code(mitBeidem)).toBe("400 symbol_ungueltig");
        let daten = await lies();
        expect(daten.symbole.at(-1)).toMatchObject({
            id,
            art: "mahlstrom",
            name: "Probestrudel",
            richtung: null,
            drehsinn: 1,
        });
        expect(daten.symbole.filter((s) => s.art === "mahlstrom")).toHaveLength(1);
        const aendern = await schreibe("PATCH", wetterSymbolUrl(id), {
            baseRevision: 1,
            aenderungen: { drehsinn: -1 },
        });
        expect(code(aendern), aendern.body).toBe("200");
        daten = await lies();
        expect(daten.symbole.at(-1)).toMatchObject({ id, richtung: null, drehsinn: -1, revision: 2 });
    });

    it("🔴 alle Icons entfernt heißt keine Icons, nicht wieder die Vorgaben", async () => {
        for (const symbol of WETTER_SYMBOL_VORGABEN)
            expect(code(await schreibe("POST", wetterSymbolEntfernenUrl(symbol.id), { baseRevision: 0 }))).toBe("200");
        const daten = await lies();
        expect(daten.quelle.symbole).toBe("gespeichert");
        expect(daten.symbole).toEqual([]);
    });

    it("🔴 Wettermodell: verstellen, Reihenfolge der Paare, Auswahl, zurücksetzen; ein Ereignis je Handlung", async () => {
        const revision = async () => (await lies()).modell.revision!;
        const setze = async (id: string, value: number | null, baseRevision?: number) =>
            code(
                await schreibe(
                    "POST",
                    WETTERMODELL_URL,
                    { baseRevision: baseRevision ?? (await revision()), id, value },
                    "operator",
                ),
            );
        const vorher = await revision();
        expect(await setze("conf", 2)).toBe("200");
        let daten = await lies();
        expect(daten.modell).toMatchObject({ revision: vorher + 1, verstellt: ["conf"] });
        expect(daten.modell.werte["conf"]).toBe(2);
        expect(await setze("conf", 3, vorher)).toBe("409 edit_conflict");
        expect(await setze("conf", 99)).toBe("400 value_out_of_range");
        expect(await setze("nahVoll", 90)).toBe("400 value_out_of_range");
        expect(await setze("res", 0.6)).toBe("400 value_out_of_range");
        expect(await setze("res", 0.5)).toBe("200");
        expect(await setze("erfunden", 1)).toBe("400 unknown_setting");
        // Die Vorgabe selbst wird nie gespeichert: Wer sie schickt, setzt zurück.
        expect(await setze("conf", 1.35)).toBe("200");
        expect(await setze("res", null)).toBe("200");
        expect(await setze("res", null)).toBe("409 no_change");
        daten = await lies();
        expect(daten.modell.verstellt).toEqual([]);
        const protokoll = await ereignisse("system.wettermodell_geaendert");
        expect(protokoll.slice(-4).map((e) => e.details)).toEqual([
            { key: "conf", from: null, to: 2 },
            { key: "res", from: null, to: 0.5 },
            { key: "conf", from: 2, to: null },
            { key: "res", from: 0.5, to: null },
        ]);
    });

    it("🔴 Wiki-Artikel am Icon (Stufe 6): die Liste liest Winde, Strömungen und Mahlströme; setzen, lösen, Unbekanntes 400; im Protokoll nur das Feld", async () => {
        // Erfundene Artikel, wie der Derographie-Zug sie führt: zwei Wiki-Einträge der passenden Arten, einer einer anderen Art, ein Mahlstrom als Landmarken-Artikel.
        const adresse = (titel: string): string => `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel)}`;
        await cluster!.migrator`
            INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, art, region_parent)
            VALUES ('probewind', ${adresse("Probewind (Wind)")}, 'Probewind', 'Wind', 'Probeküste'),
                   ('probestrom', ${adresse("Probestrom")}, 'Probestrom', 'Meeresströmung|Strom', NULL),
                   ('probewald', ${adresse("Probewald")}, 'Probewald', 'Wald', NULL)
            ON CONFLICT (wiki_key) DO NOTHING
        `;
        await cluster!.migrator`
            INSERT INTO wiki_landmarke_artikel (schluessel, titel, name, art, wiki_art, unbekannt)
            VALUES ('probestrudel', 'Probestrudel', 'Probestrudel', 'strudel', 'Mahlstrom', '{}'::text[])
            ON CONFLICT (schluessel) DO NOTHING
        `;
        const liste = async (wer: keyof typeof leute) =>
            app.inject({ method: "GET", url: WETTER_WIKI_URL, headers: { cookie: leute[wer]!.cookie } });
        expect(code(await liste("reviewer"))).toBe("403 forbidden");
        const antwort = await liste("editor");
        expect(code(antwort)).toBe("200");
        expect(
            antwort
                .json<WetterWikiArtikelAntwort>()
                .artikel.filter((a) => a.titel.startsWith("Probe"))
                .map((a) => [a.titel, a.art, a.region ?? null]),
        ).toEqual([
            ["Probestrom", "Meeresströmung", null],
            ["Probestrudel", "Mahlstrom", null],
            ["Probewind (Wind)", "Wind", "Probeküste"],
        ]);

        const vorher = (await ereignisse("system.wetter_symbol_geaendert")).length;
        const vorgabe = WETTER_SYMBOL_VORGABEN[0]!;
        // Der Titel in anderer Schreibung wird in der Schreibung des Artikels gespeichert.
        expect(
            code(
                await schreibe("PATCH", wetterSymbolUrl(vorgabe.id), {
                    baseRevision: 0,
                    aenderungen: { wikiTitel: "  probewind (Wind) " },
                }),
            ),
        ).toBe("200");
        let daten = await lies();
        expect(daten.symbole[0]).toMatchObject({ id: vorgabe.id, wikiTitel: "Probewind (Wind)", revision: 1 });
        expect(daten.symbole[1]).toMatchObject({ wikiTitel: null });
        for (const falsch of ["Probewald", "Erfunden", "Probe|wind", "x".repeat(201)]) {
            const antwort = await schreibe("PATCH", wetterSymbolUrl(vorgabe.id), {
                baseRevision: 1,
                aenderungen: { wikiTitel: falsch },
            });
            expect(code(antwort), falsch).toBe("400 wiki_artikel_unbekannt");
        }
        expect(
            code(
                await schreibe("PATCH", wetterSymbolUrl(vorgabe.id), {
                    baseRevision: 1,
                    aenderungen: { wikiTitel: "Probewind (Wind)" },
                }),
            ),
        ).toBe("409 no_change");
        const neu = await schreibe("POST", WETTER_SYMBOLE_URL, {
            art: "wirbel",
            x: 100,
            z: 100,
            reichweite: 40,
            staerke: 3,
            drehsinn: -1,
            wikiTitel: "Probestrudel",
        });
        expect(code(neu)).toBe("200");
        const { id } = neu.json<OperationReceipt>().affected[0]!;
        expect(
            code(
                await schreibe("PATCH", wetterSymbolUrl(vorgabe.id), {
                    baseRevision: 1,
                    aenderungen: { wikiTitel: null },
                }),
            ),
        ).toBe("200");
        daten = await lies();
        expect(daten.symbole.find((s) => s.id === id)).toMatchObject({ wikiTitel: "Probestrudel" });
        expect(daten.symbole[0]).toMatchObject({ wikiTitel: null, revision: 2 });
        // Das Protokoll nennt das Feld, nie den Titel (wie jedes Feld des Icons).
        const protokoll = (await ereignisse("system.wetter_symbol_geaendert")).slice(vorher);
        expect(protokoll.map((e) => e.details)).toEqual([
            { symbol: vorgabe.id, aktion: "geaendert", felder: ["wikiTitel"], materialisiert: true },
            { symbol: id, aktion: "angelegt", art: "wirbel", materialisiert: false },
            { symbol: vorgabe.id, aktion: "geaendert", felder: ["wikiTitel"], materialisiert: false },
        ]);
        expect(JSON.stringify(protokoll)).not.toMatch(/Probe/u);
    });

    it("🔴 die App darf an den Tafeln genau das, was die Wege brauchen; die Revision des Modells nur lesen", async () => {
        const app = cluster!.roles.app;
        // Angelegte Presets werden hart gelöscht (Betreiber 2026-11-08), Icons weich: DELETE nur an den Presets.
        expect(await cluster!.granted(app, "weather_preset")).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
        expect(await cluster!.granted(app, "weather_symbol")).toEqual(["SELECT", "INSERT", "UPDATE"]);
        expect(await cluster!.granted(app, "weather_model_setting")).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
        expect(await cluster!.granted(app, "weather_model_state")).toEqual(["SELECT"]);
        for (const tafel of ["weather_preset", "weather_symbol", "weather_model_setting", "weather_model_state"])
            expect(await cluster!.granted("public", tafel), tafel).toEqual([]);
        expect(
            await cluster!.codesAs(cluster!.app, [
                "TRUNCATE weather_preset",
                "DELETE FROM weather_symbol",
                "UPDATE weather_model_state SET revision = revision + 1",
                "TRUNCATE weather_model_setting",
            ]),
        ).toEqual(["42501", "42501", "42501", "42501"]);
    });
});
