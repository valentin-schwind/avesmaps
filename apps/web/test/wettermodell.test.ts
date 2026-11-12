import { afterEach, describe, expect, it, vi } from "vitest";
import {
    WETTERMODELL_PANELE,
    WETTERMODELL_URL,
    WETTERMODELL_WERTE,
    WETTER_URL,
    wettermodellWert,
    wettermodellWirksam,
    type WetterDatenAntwort,
} from "@avesmaps3d/shared";
import { de } from "../src/i18n/de.ts";
import { locale } from "../src/i18n/i18n.ts";
import {
    abstandAusZoomstufe,
    anzeigeGrenzen,
    anzeigeText,
    ausAnzeige,
    createWettermodell,
    fehlerSatz,
    leistenSatz,
    panele,
    pruefe,
    reiterListe,
    schienenWert,
    standAus,
    zeileVon,
    zoomstufeAusAbstand,
    type WettermodellStand,
} from "../src/wettermodell/wettermodell.ts";
import { ApiFailure } from "../src/auth/api.ts";

/**
 * Der Reiter „Wettermodell“ der Systemsteuerung (WI-0288 Stufe 4) ohne Browser. Problemfälle: Ein Wert der Tafel fehlt in der Ansicht oder
 * in der Sprachtafel; Regen und Schnee „nah“ stehen als Abstand im Feld oder kommen nach dem Umrechnen nicht zurück; ein Prozentwert wird
 * als Anteil gespeichert; eine Zahl außerhalb der Grenzen oder gegen ein Paar geht hinaus; das Zurücktippen auf die Vorgabe speichert die
 * Vorgabe statt die Abweichung zu löschen; ein 400 des Servers bleibt still; „Alle zurücksetzen“ schickt eine veraltete Revision; das
 * Wetter auf der Karte erfährt nichts vom Speichern.
 */

const wert = (id: string) => wettermodellWert(id)!;
const stand = (abweichungen: Record<string, number> = {}, revision: number | null = 3): WettermodellStand => ({
    revision,
    abweichungen,
    quelle: Object.keys(abweichungen).length > 0 ? "gespeichert" : "vorgabe",
});

/** Ein Nachbau von `GET /api/wetter` und `POST /api/admin/system/wettermodell` mit Revision, Grenzen und Paaren wie auf dem Server. */
function server(start: Record<string, number> = {}, optionen: { antwort?: () => Response | undefined } = {}) {
    let revision = 3;
    const abweichungen: Record<string, number> = { ...start };
    const posts: Record<string, unknown>[] = [];
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (String(url) === WETTER_URL && (init?.method ?? "GET") === "GET") {
            const body: WetterDatenAntwort = {
                presets: [],
                symbole: [],
                modell: {
                    revision,
                    werte: { ...wettermodellWirksam(abweichungen) },
                    verstellt: Object.keys(abweichungen).sort(),
                },
                quelle: { presets: "vorgabe", symbole: "vorgabe", modell: "gespeichert" },
            };
            return json(200, body);
        }
        expect(String(url)).toBe(WETTERMODELL_URL);
        const body = JSON.parse(String(init?.body)) as { id: string; value: number | null; baseRevision: number };
        posts.push(body);
        const vorab = optionen.antwort?.();
        if (vorab !== undefined) return vorab;
        if (body.baseRevision !== revision) return json(409, { error: { code: "edit_conflict", message: "x" } });
        if (body.value === null) delete abweichungen[body.id];
        else abweichungen[body.id] = body.value;
        revision += 1;
        return json(200, {
            operationId: "x",
            status: "applied",
            environment: "local",
            affected: [{ kind: "wettermodell", id: body.id, revision }],
            derivedWork: [],
            warnings: [],
        });
    };
    return { fetcher: fetcher as typeof fetch, posts, abweichungen };
}

afterEach(() => {
    locale.value = "de";
});

describe("Die Tafel in der Ansicht", () => {
    it("🔴 alle 44 Werte in elf Panelen und vier Reitern, jeder mit Name und Satz in der Sprachtafel", () => {
        const sicht = panele(null);
        // Das Panel „Wasser“ (Glanz) zog 2026-11-08 in die Standardwerte, Panel „OceanShader an/aus“.
        expect(sicht).toHaveLength(11);
        expect(sicht.flatMap((panel) => panel.zeilen)).toHaveLength(WETTERMODELL_WERTE.length);
        expect(WETTERMODELL_WERTE).toHaveLength(44);
        expect(new Set(sicht.map((panel) => panel.reiter))).toEqual(new Set(["wind", "partikel", "licht", "leistung"]));
        const fehlend = [
            ...WETTERMODELL_PANELE.flatMap((panel) => [
                `admin.wettermodell.panel.${panel.id}`,
                `admin.wettermodell.wirkung.${panel.id}`,
            ]),
            ...WETTERMODELL_WERTE.flatMap((w) => [
                `admin.wettermodell.wert.${w.id}`,
                `admin.wettermodell.satz.${w.id}`,
            ]),
            ...["wind", "partikel", "licht", "leistung"].map((r) => `admin.wettermodell.reiter.${r}`),
        ].filter((key) => !Object.hasOwn(de, key));
        expect(fehlend).toEqual([]);
        // An JEDER Zeile steht, was eine Änderung nach sich zieht (Design Guide §8).
        for (const zeile of sicht.flatMap((panel) => panel.zeilen))
            expect(zeile.folgeSatz, zeile.wert.id).toBe(
                zeile.folge === "neustart" ? "Greift nach dem Neuladen der Karte." : "Wirkt sofort.",
            );
        expect(sicht[0]).toMatchObject({
            titel: "Wind",
            wirkung: "Wirkt in der Rechnung des Wetters, zu jeder Jahreszeit.",
        });
    });

    it("eine Zeile auf der Vorgabe: Zahl mit den Stellen der Tafel, Einheit, Spanne; ↺ ruht", () => {
        expect(zeileVon(wert("conf"), null)).toMatchObject({
            name: "Verwirbelung",
            text: "1,35",
            einheit: "×",
            abweichend: false,
            vorgabeSatz: null,
            spanne: "Spanne 0,00 bis 8,00",
            abstand: null,
        });
        expect(zeileVon(wert("schicht"), null)).toMatchObject({ text: "1.800", einheit: "m" });
        expect(zeileVon(wert("takt"), null)).toMatchObject({ einheit: "je s", folge: "neustart" });
        expect(zeileVon(wert("rFern"), null)).toMatchObject({ text: "1.536", einheit: "Zellen" });
        expect(zeileVon(wert("mittelAb"), null)).toMatchObject({ einheit: "Einh." });
        expect(zeileVon(wert("fpsGrob"), null)).toMatchObject({ einheit: "FPS" });
        expect(zeileVon(wert("steps"), null)).toMatchObject({ einheit: "" });
    });

    it("🔴 Prozent zeigen den Anteil mal hundert, gespeichert bleibt der Anteil", () => {
        expect(zeileVon(wert("schatten"), null)).toMatchObject({
            text: "50",
            einheit: "%",
            spanne: "Spanne 0 bis 100",
        });
        expect(ausAnzeige(wert("schatten"), 12)).toBe(0.12);
        expect(ausAnzeige(wert("resMin"), 33)).toBe(0.33);
        expect(zeileVon(wert("resMin"), stand({ resMin: 0.4 }))).toMatchObject({
            text: "40",
            abweichend: true,
            vorgabeSatz: "Vorgabe 25 %",
        });
    });

    it("die Wolkenauflösung ist eine Wahl, 0 heißt „Automatisch“", () => {
        const zeile = zeileVon(wert("res"), null);
        expect(zeile.art).toBe("auswahl");
        expect(zeile.spanne).toBeNull();
        expect(zeile.optionen.map((o) => o.text)).toEqual(["Automatisch", "100 %", "75 %", "50 %", "33 %"]);
        expect(anzeigeText(wert("res"), 0.5)).toBe("50 %");
    });

    it("die Reiter zählen ihre Abweichungen im Namen, die Leiste und die Schiene alle", () => {
        const s = stand({ conf: 2, schatten: 0.2, takt: 20 });
        expect(reiterListe(s).map((r) => r.name)).toEqual([
            "Wind und Wolken (2)",
            "Partikel",
            "Licht und Schnee",
            "Leistung (1)",
        ]);
        expect(leistenSatz(s)).toBe("3 Werte weichen von der Vorgabe ab.");
        expect(leistenSatz(stand({ conf: 2 }))).toBe("1 Wert weicht von der Vorgabe ab.");
        expect(leistenSatz(stand())).toBe("Alle Werte stehen auf der Vorgabe.");
        expect(schienenWert(s)).toBe("3 abweichend");
        expect(schienenWert(stand())).toBeUndefined();
        expect(schienenWert(null)).toBeUndefined();
    });

    it("der Leseweg: nur verstellte, bekannte Werte in ihren Grenzen zählen als Abweichung", () => {
        const s = standAus({
            presets: [],
            symbole: [],
            modell: {
                revision: 7,
                werte: { ...wettermodellWirksam({ conf: 2 }), quatsch: 1 },
                verstellt: ["conf", "quatsch"],
            },
            quelle: { presets: "vorgabe", symbole: "vorgabe", modell: "gespeichert" },
        });
        expect(s).toEqual({ revision: 7, abweichungen: { conf: 2 }, quelle: "gespeichert" });
    });
});

describe("Regen und Schnee „nah“ in Zoomstufen (gespeichert bleibt der Abstand)", () => {
    it("🔴 die Vorgaben 85 und 45 sind bei 900 px Kartenhöhe Zoomstufe 4,0 und 4,9", () => {
        expect(zoomstufeAusAbstand(85)).toBeCloseTo(3.99, 2);
        expect(zoomstufeAusAbstand(45)).toBeCloseTo(4.907, 2);
        expect(zeileVon(wert("nahAb"), null)).toMatchObject({
            art: "zoom",
            text: "4,0",
            einheit: "",
            abstand: "Abstand der Kamera 85 Einh., gerechnet für 900 px Kartenhöhe",
        });
        expect(zeileVon(wert("nahVoll"), null).text).toBe("4,9");
    });

    it("🔴 Hin und zurück: Jede Zoomstufe mit einer Stelle kommt nach dem Speichern als dieselbe Zahl zurück", () => {
        for (const id of ["nahAb", "nahVoll"]) {
            const { min, max } = anzeigeGrenzen(wert(id));
            for (let stufe = min; stufe <= max + 1e-9; stufe = Math.round((stufe + 0.1) * 10) / 10) {
                const abstand = ausAnzeige(wert(id), stufe);
                expect(Math.round(zoomstufeAusAbstand(abstand) * 10) / 10, `${id} ${stufe}`).toBe(stufe);
                expect(abstand).toBeGreaterThanOrEqual(wert(id).min);
                expect(abstand).toBeLessThanOrEqual(wert(id).max);
            }
        }
        expect(abstandAusZoomstufe(5)).toBeCloseTo(42.19, 2);
    });

    it("die Grenzen drehen sich um und runden nach innen", () => {
        // nahAb: Abstand 10 bis 400 → Stufe 1,8 bis 7,0; nahVoll: 5 bis 400 → 1,8 bis 8,0.
        expect(anzeigeGrenzen(wert("nahAb"))).toEqual({ min: 1.8, max: 7 });
        expect(anzeigeGrenzen(wert("nahVoll"))).toEqual({ min: 1.8, max: 8 });
        expect(zeileVon(wert("nahAb"), null).spanne).toBe("Spanne 1,8 bis 7,0");
    });
});

describe("Prüfen am Feld", () => {
    it("liest die Zahl in der Sprache der Seite und rundet auf die angezeigten Stellen", () => {
        expect(pruefe(wert("conf"), "1,375", null)).toEqual({ ok: true, wert: 1.38, angezeigt: 1.38 });
        expect(pruefe(wert("schicht"), "2.500", null)).toEqual({ ok: true, wert: 2500, angezeigt: 2500 });
        expect(pruefe(wert("conf"), "viel", null)).toEqual({
            ok: false,
            problem: { key: "admin.wegfindung.invalid.number" },
        });
    });

    it("🔴 eine Zahl außerhalb der Grenzen steht am Feld, in den Zahlen des Felds", () => {
        expect(pruefe(wert("conf"), "9", null)).toEqual({
            ok: false,
            problem: { key: "admin.wegfindung.invalid.range", params: { min: "0,00", max: "8,00" } },
        });
        expect(pruefe(wert("schatten"), "120", null)).toMatchObject({
            ok: false,
            problem: { params: { min: "0", max: "100" } },
        });
        expect(pruefe(wert("nahAb"), "7,5", null)).toMatchObject({
            ok: false,
            problem: { params: { min: "1,8", max: "7,0" } },
        });
    });

    it("🔴 Paare: der Übergang braucht seinen Anfang weiter draußen; in Zoomstufen dreht sich die Richtung", () => {
        // Mittelstufe voll bei 950 Einh., blendet ein ab 900: muss kleiner bleiben.
        expect(pruefe(wert("mittelVoll"), "950", null)).toEqual({
            ok: false,
            problem: {
                key: "admin.wettermodell.invalid.kleiner",
                params: { name: "Mittelstufe blendet ein ab", wert: "900 Einh." },
            },
        });
        // „Voll ab Zoomstufe“ 3,5 liegt weiter draußen als „Sichtbar ab Zoomstufe“ 4,0: muss größer bleiben.
        expect(pruefe(wert("nahVoll"), "3,5", null)).toEqual({
            ok: false,
            problem: {
                key: "admin.wettermodell.invalid.groesser",
                params: { name: "Sichtbar ab Zoomstufe", wert: "4,0" },
            },
        });
        expect(pruefe(wert("fpsFein"), "30", null)).toMatchObject({
            ok: false,
            problem: { key: "admin.wettermodell.invalid.groesser" },
        });
        // Mit einem verstellten Partner gilt dessen Zahl.
        expect(pruefe(wert("mittelVoll"), "950", stand({ mittelAb: 1200 }))).toMatchObject({ ok: true, wert: 950 });
    });

    it("🔴 ein 400 des Servers steht am Feld: Grenzen, Paar, Wahl; sonst die Sätze des Hauses", () => {
        const fehler = (details: Record<string, unknown>) => new ApiFailure(400, "value_out_of_range", "x", details);
        expect(fehlerSatz(fehler({ min: 0, max: 8, vorgabe: 1.35 }), "conf", null)).toEqual({
            key: "admin.wegfindung.invalid.range",
            params: { min: "0,00", max: "8,00" },
        });
        expect(fehlerSatz(fehler({ kleiner: "nahVoll", groesser: "nahAb" }), "nahAb", null)).toEqual({
            key: "admin.wettermodell.invalid.kleiner",
            params: { name: "Voll ab Zoomstufe", wert: "4,9" },
        });
        expect(fehlerSatz(fehler({ auswahl: [0, 1], vorgabe: 0 }), "res", null)).toEqual({
            key: "admin.wettermodell.invalid.auswahl",
        });
        expect(fehlerSatz(new ApiFailure(403, "reauth_required", "x", { need: "passkey" }), "conf", null)).toEqual({
            key: "admin.system.error.notConfirmed",
        });
        expect(fehlerSatz(new ApiFailure(409, "edit_conflict", "x"), "conf", null).key).toBe("auth.form.conflict");
    });

    it("englisch: dieselben Sätze in der Sprache der Seite", () => {
        locale.value = "en";
        expect(zeileVon(wert("nahAb"), null)).toMatchObject({ name: "Visible from zoom level", text: "4.0" });
        expect(leistenSatz(stand({ conf: 2, tempo: 1 }))).toBe("2 values differ from their default.");
    });
});

describe("Speichern über die Admin-Route", () => {
    it("🔴 ein Wert geht mit baseRevision hinaus, das Feld bindet sich danach an den neuen Stand, und das Wetter erfährt es", async () => {
        const { fetcher, posts } = server();
        const gespeichert = vi.fn();
        const h = createWettermodell({ fetcher, ask: async () => true, gespeichert });
        await h.load();
        expect(h.stand.value).toMatchObject({ revision: 3, abweichungen: {} });
        h.tippe("conf", "2");
        await h.uebernimm("conf");
        expect(posts).toEqual([expect.objectContaining({ id: "conf", value: 2, baseRevision: 3 })]);
        expect(h.stand.value).toMatchObject({ revision: 4, abweichungen: { conf: 2 } });
        expect(h.felder.value).toEqual({});
        expect(gespeichert).toHaveBeenCalledTimes(1);
    });

    it("🔴 Zoomstufe getippt, Abstand gespeichert; die Vorgabe getippt setzt zurück statt sie zu speichern", async () => {
        const { fetcher, posts } = server({ nahAb: 100 });
        const h = createWettermodell({ fetcher, ask: async () => true, gespeichert: () => undefined });
        await h.load();
        h.tippe("nahVoll", "5,5");
        await h.uebernimm("nahVoll");
        expect(posts.at(-1)).toMatchObject({ id: "nahVoll", value: ausAnzeige(wert("nahVoll"), 5.5) });
        h.tippe("nahAb", "4,0");
        await h.uebernimm("nahAb");
        expect(posts.at(-1)).toMatchObject({ id: "nahAb", value: null });
        // Was schon so steht, geht nicht hinaus.
        h.tippe("conf", "1,35");
        await h.uebernimm("conf");
        expect(posts).toHaveLength(2);
    });

    it("🔴 eine Zahl außerhalb der Grenzen geht nicht hinaus, die getippte Zahl bleibt stehen", async () => {
        const { fetcher, posts } = server();
        const h = createWettermodell({ fetcher, ask: async () => true, gespeichert: () => undefined });
        await h.load();
        h.tippe("conf", "99");
        await h.uebernimm("conf");
        expect(posts).toEqual([]);
        expect(h.felder.value["conf"]).toBe("99");
        expect(h.probleme.value["conf"]?.key).toBe("admin.wegfindung.invalid.range");
        // Neu tippen nimmt den Satz weg.
        h.tippe("conf", "2");
        expect(h.probleme.value["conf"]).toBeUndefined();
    });

    it("🔴 antwortet der Server 400, steht der Satz am Feld und nichts gilt als gespeichert", async () => {
        const { fetcher } = server(
            {},
            {
                antwort: () =>
                    new Response(
                        JSON.stringify({
                            error: {
                                code: "value_out_of_range",
                                message: "x",
                                details: { kleiner: "feinVoll", groesser: "feinAb" },
                            },
                        }),
                        { status: 400 },
                    ),
            },
        );
        const gespeichert = vi.fn();
        const h = createWettermodell({ fetcher, ask: async () => true, gespeichert });
        await h.load();
        h.tippe("feinAb", "300");
        await h.uebernimm("feinAb");
        expect(h.probleme.value["feinAb"]).toEqual({
            key: "admin.wettermodell.invalid.groesser",
            params: { name: "Feinstufe voll bei", wert: "140 Einh." },
        });
        expect(h.felder.value["feinAb"]).toBe("300");
        expect(gespeichert).not.toHaveBeenCalled();
    });

    it("die Wahl gilt mit dem Wählen; ↺ schickt null", async () => {
        const { fetcher, posts } = server({ steps: 64 });
        const h = createWettermodell({ fetcher, ask: async () => true, gespeichert: () => undefined });
        await h.load();
        await h.waehle("res", 0.5);
        expect(posts.at(-1)).toMatchObject({ id: "res", value: 0.5 });
        await h.waehle("res", 0);
        expect(posts.at(-1)).toMatchObject({ id: "res", value: null });
        await h.zuruecksetzen("steps");
        expect(posts.at(-1)).toMatchObject({ id: "steps", value: null });
        // Auf der Vorgabe tut ↺ nichts.
        await h.zuruecksetzen("steps");
        expect(posts).toHaveLength(3);
    });

    it("🔴 „Alle zurücksetzen“: je Wert eine Anfrage, jede mit der Revision der vorigen Quittung, danach alles auf der Vorgabe", async () => {
        const { fetcher, posts, abweichungen } = server({ conf: 2, takt: 20, schatten: 0.3 });
        const gespeichert = vi.fn();
        const h = createWettermodell({ fetcher, ask: async () => true, gespeichert });
        await h.load();
        await h.alleZuruecksetzen();
        expect(posts.map((p) => [p["id"], p["value"], p["baseRevision"]])).toEqual([
            ["conf", null, 3],
            ["schatten", null, 4],
            ["takt", null, 5],
        ]);
        expect(abweichungen).toEqual({});
        expect(h.stand.value?.abweichungen).toEqual({});
        expect(h.alle.value).toEqual({ ok: true, problems: [] });
        expect(gespeichert).toHaveBeenCalledTimes(1);
    });

    it("„Alle zurücksetzen“ hält beim ersten Fehler an und sagt es in der Leiste", async () => {
        let n = 0;
        const { fetcher, posts } = server(
            { conf: 2, takt: 20 },
            {
                antwort: () =>
                    ++n === 2
                        ? new Response(JSON.stringify({ error: { code: "system_locked", message: "x" } }), {
                              status: 423,
                          })
                        : undefined,
            },
        );
        const h = createWettermodell({ fetcher, ask: async () => true, gespeichert: () => undefined });
        await h.load();
        await h.alleZuruecksetzen();
        expect(posts).toHaveLength(2);
        expect(h.alle.value?.ok).toBe(false);
        expect(h.stand.value?.abweichungen).toEqual({ takt: 20 });
    });

    it("ohne Tafel (Revision null) geht nichts hinaus", async () => {
        const h = createWettermodell({ ask: async () => true, gespeichert: () => undefined });
        h.stand.value = stand({}, null);
        h.tippe("conf", "2");
        await h.uebernimm("conf");
        await h.alleZuruecksetzen();
        expect(h.busy.value).toBeNull();
    });
});
