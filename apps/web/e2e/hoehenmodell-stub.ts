import { readFileSync } from "node:fs";
import {
    flacheRezeptWerte,
    GEBIRGS_PRESETS_VORGABE,
    technikWerte,
    type AdminHoehenmodell,
    type GebirgsPresetGruppe,
    type HoehenmodellEntwurf,
    type HoehenmodellFassung,
    type HoehenmodellTest,
    type HoehenmodellTestWerte,
} from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Das Höhenmodell ohne Datenbank (WI-0127 SYS-13): Stände von `GET /api/admin/system/hoehenmodell` mit den echten Werten der Fassungen 17
 * und 18 und ein Nachbau von Wählen, Zurück, Abnehmen, Entwurf, Messen und Verwerfen. Die echten Routen prüft
 * `apps/server/test/hoehenmodell-routes.test.ts`, die Rechte `hoehenmodell-grants.test.ts`.
 */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
/** Die echte Fassung 19, für die übrigen stellbaren Werte von „19 (Test)“ (`flacheRezeptWerte`) und die Technik. */
const F19: unknown = JSON.parse(
    readFileSync(new URL("../../../config/terrain/aventuria/19.json", import.meta.url), "utf8"),
);
const REZEPT_19 = flacheRezeptWerte(F19);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

/** Die Tafel je Landschaftsart wie im Rezept (Fassung 17 und 18 gleich). */
export const LANDSCHAFTEN: HoehenmodellFassung["landschaften"] = [
    ["gebirge", 20, 0.08, 1, 1, 0],
    ["hochebene", 1, 0.4, 2, 0.8, 0],
    ["huegelland", 4, 1, 1.5, 1, 0],
    ["tiefebene", 0.3, 1, 3, 0.8, 0],
    ["tal", 0.5, 1.5, 1.5, 1.2, 2],
    ["schlucht", 0.5, 2, 0.3, 1.2, 4],
    ["wadi", 0.5, 1.5, 0.8, 0.3, 4],
    ["flussdelta", 0.2, 1.2, 4, 0.8, 2],
    ["kueste", 1, 1, 1, 1, 0],
    ["insel", 1, 1, 1, 1, 0],
].map(([art, upliftWeight, erodibility, diffusivity, runoff, channelBias]) => ({
    art: String(art),
    upliftWeight: Number(upliftWeight),
    erodibility: Number(erodibility),
    diffusivity: Number(diffusivity),
    runoff: Number(runoff),
    channelBias: Number(channelBias),
}));

export function fassungVon(version: 17 | 18, patch: Partial<HoehenmodellFassung> = {}): HoehenmodellFassung {
    return {
        version,
        regional: version === 18,
        unterschied:
            version === 18
                ? [{ pfad: "generator.uplift", alt: null, neu: { kind: "regional", radius: 16, saturation: 10 } }]
                : [],
        regler: version === 18 ? { ...REGLER_17, radius: 16, saturation: 10 } : REGLER_17,
        landschaften: LANDSCHAFTEN,
        werte: version === 18 ? 239 : 237,
        abnahme:
            version === 18
                ? { am: ago(2 * HOUR), wer: "Valentin", grund: "Stufe 8 passt" }
                : { am: ago(7 * DAY), wer: "Valentin", grund: null },
        inDatei: true,
        kreis: "voll",
        gilt: version === 18,
        ...patch,
    };
}

/** Die Regler der Datei 19.json. */
const REGLER_19 = {
    ...REGLER_17,
    radius: 16,
    saturation: 10,
    iterations: 20,
    streamPowerK: 0.08,
    diffusion: 0.015,
    detailAmplitude: 220,
    fineDetailAmplitude: 80,
};

/** Die offene Fassung 19 (WI-0240): gemessen, nicht abgenommen, nicht in der Datei. */
export function fassung19(patch: Partial<HoehenmodellFassung> = {}): HoehenmodellFassung {
    return {
        ...fassungVon(18),
        version: 19,
        regler: REGLER_19,
        werte: 306,
        abnahme: null,
        inDatei: false,
        kreis: "halb",
        gilt: true,
        ...patch,
    };
}

/** Die Datei mit Werten darüber, wie `mitTest` des Servers (ohne Prüfung). */
function wirksam(werte: HoehenmodellTestWerte): {
    regler: HoehenmodellTest["regler"];
    rezept: HoehenmodellTest["rezept"];
    presets: GebirgsPresetGruppe;
} {
    const presets = structuredClone(GEBIRGS_PRESETS_VORGABE) as {
        typen: Record<string, { werte: Record<string, number>; muster: string }>;
        hoehenstufen: Record<string, number>;
    };
    for (const [typ, preset] of Object.entries(werte.presets?.typen ?? {})) {
        const ziel = presets.typen[typ]!;
        Object.assign(ziel.werte, preset.werte ?? {});
        if (preset.muster !== undefined) ziel.muster = preset.muster;
    }
    Object.assign(presets.hoehenstufen, werte.presets?.hoehenstufen ?? {});
    return {
        regler: { ...REGLER_19, ...werte.regler },
        rezept: { ...REZEPT_19, ...werte.rezept },
        presets: presets as unknown as GebirgsPresetGruppe,
    };
}

/** Die Werte von „19 (Test)“: zwei Revisionen wie im abgenommenen Entwurf (Ausgleich und Bergland). */
export function testWerteStand(patch: Partial<HoehenmodellTest> = {}): HoehenmodellTest {
    const eins: HoehenmodellTestWerte = { regler: { diffusion: 0.02 } };
    const zwei: HoehenmodellTestWerte = { ...eins, presets: { typen: { bergland: { werte: { koernung: 24 } } } } };
    return {
        version: 19,
        name: "Fassung 19 (Test)",
        werte: zwei,
        revision: 2,
        gerechnet: 2,
        geaendertAm: ago(48 * MINUTE),
        wer: "Valentin",
        grund: "Bergland mit mehr Zellen",
        gesperrt: false,
        ...wirksam(zwei),
        reglerDatei: REGLER_19,
        rezeptDatei: REZEPT_19,
        technik: technikWerte(F19),
        presetsDatei: GEBIRGS_PRESETS_VORGABE,
        verlauf: [
            {
                revision: 2,
                am: ago(48 * MINUTE),
                wer: "Valentin",
                grund: "Bergland mit mehr Zellen",
                vorher: eins,
                werte: zwei,
            },
            { revision: 1, am: ago(81 * MINUTE), wer: "Valentin", grund: "Täler weicher", vorher: {}, werte: eins },
        ],
        ...patch,
    };
}

/** „19 (Test)“ gewählt und mit Revision 2 gerechnet, 18 als Rückweg. */
export function hoehenmodellTestStand(patch: Partial<AdminHoehenmodell> = {}): AdminHoehenmodell {
    const basis = hoehenmodellStand();
    return {
        ...basis,
        eingestellt: { ...basis.eingestellt, version: 19, grund: "Gebirgs-Presets erproben", revision: 3 },
        wirksam: { version: 19, gerechnetAm: ago(21 * MINUTE), vorlaeufig: false },
        rueckweg: 18,
        fassungen: [fassungVon(17), fassungVon(18, { gilt: false }), fassung19()],
        gipfel: [],
        test: testWerteStand(),
        ...patch,
    };
}

export const ENTWURF: HoehenmodellEntwurf = {
    id: "1f0c5d3e-2b4a-4c6d-8e9f-0a1b2c3d4e5f",
    basis: 18,
    aenderungen: { saturation: 12 },
    grund: "weichere Gebirgsränder",
    angelegt: ago(40 * MINUTE),
    wer: "Valentin",
    messung: null,
    kreis: "leer",
};

/** Ohne Angabe: Fassung 18 gewählt und wirksam, 17 als Rückweg, kein Entwurf. */
export function hoehenmodellStand(patch: Partial<AdminHoehenmodell> = {}): AdminHoehenmodell {
    return {
        now: new Date().toISOString(),
        profil: "voll",
        eingestellt: {
            version: 18,
            quelle: "auswahl",
            seit: ago(2 * HOUR),
            wer: "Valentin",
            grund: "sieht gut aus, das wollen wir",
            revision: 2,
            unbekannt: null,
        },
        wirksam: { version: 18, gerechnetAm: ago(80 * MINUTE), vorlaeufig: false },
        kette: null,
        rueckweg: 17,
        fassungen: [fassungVon(17), fassungVon(18)],
        entwuerfe: [],
        // Zwei der zehn Gebirge aus der Messung auf Fassung 18 (2026-10-18), Werte wie dort.
        gipfel: [
            {
                gebirge: "Rote Sichel",
                grundhoehe: 4000,
                quelle: "kammhoehe",
                gipfel: [
                    {
                        id: "00000000-0000-4000-8000-0000000019a1",
                        name: "Avtanentige",
                        hoehe: 1111,
                        gelaende: 1111,
                        ringsum: 2284,
                    },
                    {
                        id: "00000000-0000-4000-8000-0000000019a2",
                        name: "Driskaman",
                        hoehe: 1350,
                        gelaende: 1350,
                        ringsum: 1718,
                    },
                ],
            },
            {
                gebirge: "Schwarze Sichel",
                grundhoehe: 2700,
                quelle: "kammhoehe",
                gipfel: [
                    {
                        id: "00000000-0000-4000-8000-0000000019a3",
                        name: "Hraigar",
                        hoehe: 1000,
                        gelaende: 1000,
                        ringsum: 1087,
                    },
                ],
            },
        ],
        ...patch,
    };
}

export interface HoehenmodellServer {
    state: AdminHoehenmodell;
    posts: { path: string; body: Record<string, unknown> }[];
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

const receipt = (body: Record<string, unknown>, derivedWork: unknown[] = []) => ({
    status: 200,
    body: {
        operationId: body["operationId"],
        status: "applied",
        environment: "staging",
        affected: [],
        derivedWork,
        warnings: [],
    },
});
const failure = (status: number, code: string) => ({ status, body: { error: { code, message: "vom Nachbau" } } });

/** Ein Nachbau mit derselben Wirkung wie die Routen: Wählen setzt die Auswahl und reiht die Kette ein, Messen reiht eine Messung ein. */
export function hoehenmodellServer(initial: AdminHoehenmodell = hoehenmodellStand()): HoehenmodellServer {
    const server: HoehenmodellServer = {
        state: structuredClone(initial),
        posts: [],
        handle(call) {
            const base = "/api/admin/system/hoehenmodell";
            if (!call.path.startsWith(base)) return undefined;
            if (call.method === "GET" && call.path === base) {
                return { status: 200, body: { ...server.state, now: new Date().toISOString() } };
            }
            if (call.method !== "POST") return undefined;
            const body = call.body ?? {};
            const path = call.path.slice(base.length);
            server.posts.push({ path, body });
            const s = server.state;
            const waehle = (version: number) => {
                if (body["baseRevision"] !== s.eingestellt.revision) return failure(409, "edit_conflict");
                const vorher = s.eingestellt.version;
                s.eingestellt = {
                    version,
                    quelle: "auswahl",
                    seit: new Date().toISOString(),
                    wer: "Rondrikan",
                    grund: String(body["reason"]),
                    revision: s.eingestellt.revision + 1,
                    unbekannt: null,
                };
                s.rueckweg = vorher;
                s.fassungen = s.fassungen.map((entry) => ({ ...entry, gilt: entry.version === version }));
                s.kette = {
                    jobId: "kette-1",
                    art: "terrain_full",
                    state: "QUEUED",
                    phase: null,
                    progress: null,
                    waitReason: null,
                };
                return receipt(body, [{ kind: "terrain_full", jobId: "kette-1", state: "queued" }]);
            };
            switch (path) {
                case "/waehlen":
                    return waehle(Number(body["version"]));
                case "/zurueck":
                    return s.rueckweg === null ? failure(409, "terrain_no_rollback") : waehle(s.rueckweg);
                case "/abnehmen":
                    s.fassungen = s.fassungen.map((entry) =>
                        entry.version === body["version"]
                            ? {
                                  ...entry,
                                  kreis: "voll",
                                  abnahme: {
                                      am: new Date().toISOString(),
                                      wer: "Rondrikan",
                                      grund: String(body["reason"]),
                                  },
                              }
                            : entry,
                    );
                    return receipt(body);
                case "/entwurf": {
                    const id = `entwurf-${String(server.posts.length)}`;
                    s.entwuerfe = [
                        {
                            id,
                            basis: Number(body["basis"]),
                            aenderungen: body["aenderungen"] as Record<string, number>,
                            grund: String(body["reason"]),
                            angelegt: new Date().toISOString(),
                            wer: "Rondrikan",
                            messung: null,
                            kreis: "leer",
                        },
                        ...s.entwuerfe,
                    ];
                    return receipt(body);
                }
                case "/entwurf/messen": {
                    if (s.profil !== "voll") return failure(503, "terrain_measure_unavailable");
                    const entwurf = s.entwuerfe.find((entry) => entry.id === body["draft"]);
                    if (entwurf === undefined) return failure(404, "terrain_draft_not_found");
                    if (entwurf.messung?.state === "QUEUED" || entwurf.messung?.state === "RUNNING")
                        return failure(409, "terrain_measure_running");
                    entwurf.messung = {
                        jobId: "messung-1",
                        state: "QUEUED",
                        phase: null,
                        progress: null,
                        ergebnis: null,
                        fehler: null,
                    };
                    return receipt(body, [{ kind: "terrain_preview", jobId: "messung-1", state: "queued" }]);
                }
                case "/entwurf/verwerfen":
                    s.entwuerfe = s.entwuerfe.filter((entry) => entry.id !== body["draft"]);
                    return receipt(body);
                case "/test": {
                    // Wie `setzeTestWerte`: gegen die gesehene Revision, mit Verlauf; ist die offene Fassung gewählt, wartet die Kette.
                    const test = s.test;
                    if (test === undefined) return failure(409, "terrain_test_unavailable");
                    if (test.gesperrt) return failure(409, "terrain_test_closed");
                    if (body["baseRevision"] !== test.revision) return failure(409, "edit_conflict");
                    const werte = body["werte"] as HoehenmodellTestWerte;
                    const revision = test.revision + 1;
                    s.test = {
                        ...test,
                        ...wirksam(werte),
                        werte,
                        revision,
                        geaendertAm: new Date().toISOString(),
                        wer: "Rondrikan",
                        grund: String(body["reason"]),
                        verlauf: [
                            {
                                revision,
                                am: new Date().toISOString(),
                                wer: "Rondrikan",
                                grund: String(body["reason"]),
                                vorher: test.werte,
                                werte,
                            },
                            ...test.verlauf,
                        ],
                    };
                    if (s.eingestellt.version !== test.version) return receipt(body);
                    s.kette = {
                        jobId: "kette-test",
                        art: "terrain_full",
                        state: "QUEUED",
                        phase: null,
                        progress: null,
                        waitReason: null,
                    };
                    return receipt(body, [{ kind: "terrain_full", jobId: "kette-test", state: "queued" }]);
                }
            }
            return undefined;
        },
    };
    return server;
}
