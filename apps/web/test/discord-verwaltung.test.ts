import { describe, expect, it } from "vitest";
import { DISCORD_ADMIN_URL, DISCORD_PROMPT_VORGABE, type DiscordStand } from "@avesmaps3d/shared";
import {
    betriebsTon,
    createDiscordVerwaltung,
    einstellungenBody,
    felderAusStand,
    gleicheFelder,
    kanalGueltig,
    kreisVon,
    laufTeile,
    uhrzeitNormal,
} from "../src/news/discord.ts";
import { formProblems } from "../src/auth/formular.ts";
import { ApiFailure } from "../src/auth/api.ts";

/**
 * Der Reiter „Discord“ im Browser (WI-0255): der Kreis je Zustellung, der Ton des Betriebsstands, die Diagnose des letzten Laufs und die
 * Handlungen gegen einen gestellten Server. 🔴 Der Reiter sendet nichts selbst: Er ruft nur die Routen, und die Vorschau ist ein GET.
 */

const stand = (teil: Partial<DiscordStand> = {}): DiscordStand => ({
    umgebung: "staging",
    modus: "senden",
    modusVeraltet: false,
    sperre: null,
    schluessel: true,
    kanal: "1000000000000000001",
    formulierer: false,
    zeitplan: { uhrzeit: "10:00", zone: "Europe/Berlin", fensterVon: "10:00", fensterBis: "14:00" },
    einstellungen: {
        prompt: DISCORD_PROMPT_VORGABE,
        promptEigen: false,
        uhrzeit: "10:00",
        kanalBericht: { eigen: null, umgebung: "1000000000000000001", gilt: "1000000000000000001", quelle: "umgebung" },
        geaendertAt: null,
        geaendertVon: null,
    },
    routine: { aktiv: true, geaendertAt: null, geaendertVon: null },
    letzterLauf: null,
    letzterErfolg: null,
    heute: "2026-10-25",
    archiv: [],
    ...teil,
});

describe("Discord-Reiter: Zeichen und Sätze", () => {
    it("der Kreis: ● zugestellt, ◐ unklar oder läuft, ○ fehlgeschlagen", () => {
        expect(kreisVon({ status: "zugestellt" })).toBe("voll");
        expect(kreisVon({ status: "unklar" })).toBe("halb");
        expect(kreisVon({ status: "sendet" })).toBe("halb");
        expect(kreisVon({ status: "fehlgeschlagen" })).toBe("leer");
    });

    it("🔴 der Betriebsstand warnt nur, wenn etwas fehlt; Stage und Routine aus sind Ruhe, nicht Störung", () => {
        expect(betriebsTon(stand())).toBe("erfolg");
        expect(betriebsTon(stand({ sperre: "nicht_stage" }))).toBe("ruhe");
        expect(betriebsTon(stand({ routine: { aktiv: false, geaendertAt: null, geaendertVon: null } }))).toBe("ruhe");
        expect(betriebsTon(stand({ sperre: "ohne_schluessel" }))).toBe("warnung");
    });

    it("das Ergebnis des Laufs: Kennung vorn, Diagnose dahinter", () => {
        expect(laufTeile("zugestellt")).toEqual({ art: "zugestellt", detail: null });
        expect(laufTeile("fehlgeschlagen: Discord lehnt ab: HTTP 403")).toEqual({
            art: "fehlgeschlagen",
            detail: "Discord lehnt ab: HTTP 403",
        });
    });
});

describe("Discord-Reiter: Einstellungen", () => {
    it("die Uhrzeit wird zweistellig geschrieben, der Kanal ist leer oder 17 bis 20 Ziffern", () => {
        expect(uhrzeitNormal("9:30")).toBe("09:30");
        expect(uhrzeitNormal(" 10:05 ")).toBe("10:05");
        expect(uhrzeitNormal("zehn")).toBe("zehn");
        expect(kanalGueltig("")).toBe(true);
        expect(kanalGueltig("  ")).toBe(true);
        expect(kanalGueltig("1000000000000000001")).toBe(true);
        expect(kanalGueltig("12345")).toBe(false);
        expect(kanalGueltig("1000000000000000abc")).toBe(false);
    });

    it("🔴 aus den Feldern wird der Satz für den Server: leer, die Vorgabe selbst und ein leerer Kanal werden null", () => {
        const felder = felderAusStand(stand());
        expect(felder).toEqual({
            prompt: DISCORD_PROMPT_VORGABE,
            uhrzeit: "10:00",
            kanalBericht: "",
        });
        expect(einstellungenBody(felder)).toEqual({
            prompt: null,
            uhrzeit: "10:00",
            berichtsKanal: null,
        });
        expect(
            einstellungenBody({
                prompt: "  Knapp.\r\nTrocken.  ",
                uhrzeit: "9:30",
                kanalBericht: " 1000000000000000002 ",
            }),
        ).toEqual({
            prompt: "Knapp.\nTrocken.",
            uhrzeit: "09:30",
            berichtsKanal: "1000000000000000002",
        });
        expect(einstellungenBody({ ...felder, prompt: "   " }).prompt).toBeNull();
        expect(gleicheFelder(felder, { ...felder })).toBe(true);
        expect(gleicheFelder(felder, { ...felder, uhrzeit: "11:00" })).toBe(false);
    });

    it("gespeicherte Werte kommen als Felder zurück: der Kanal aus dem Reiter, der gespeicherte Prompt", () => {
        const gespeichert = stand({
            einstellungen: {
                ...stand().einstellungen,
                prompt: "Eigener Ton.",
                promptEigen: true,
                uhrzeit: "11:30",
                kanalBericht: {
                    eigen: "1000000000000000009",
                    umgebung: null,
                    gilt: "1000000000000000009",
                    quelle: "reiter",
                },
            },
        });
        expect(felderAusStand(gespeichert)).toEqual({
            prompt: "Eigener Ton.",
            uhrzeit: "11:30",
            kanalBericht: "1000000000000000009",
        });
    });

    it("🔴 Speichern ist ein POST mit Kennung und dem ganzen Satz; danach lädt der Stand neu; ein abgelehnter Kanal nennt Kanal und Grund", async () => {
        const anfragen: { url: string; method: string; body: unknown }[] = [];
        let antwort: "ok" | "kanal" = "ok";
        const fetcher = (async (url: string, init?: RequestInit) => {
            anfragen.push({
                url,
                method: init?.method ?? "GET",
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
            });
            if (url === DISCORD_ADMIN_URL) return new Response(JSON.stringify(stand()), { status: 200 });
            if (antwort === "kanal") {
                return new Response(
                    JSON.stringify({
                        error: {
                            code: "discord_kanal_unbrauchbar",
                            message: "x",
                            details: { kanal: "bericht", grund: "schreiben" },
                        },
                    }),
                    { status: 409 },
                );
            }
            return new Response(
                JSON.stringify({
                    operationId: "x",
                    status: "applied",
                    environment: "test",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                }),
                { status: 200 },
            );
        }) as typeof fetch;
        const discord = createDiscordVerwaltung({ fetcher, reads: { ask: async () => true } as never });
        const satz = { prompt: "Knapp.", uhrzeit: "11:30", berichtsKanal: "1000000000000000002" };
        expect(await discord.speichereEinstellungen(satz)).toBe(true);
        const post = anfragen.find((a) => a.url === `${DISCORD_ADMIN_URL}/einstellungen`);
        expect(post).toMatchObject({ method: "POST", body: satz });
        expect((post!.body as { operationId: string }).operationId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(anfragen.at(-1)?.url).toBe(DISCORD_ADMIN_URL);
        expect(discord.problemWer.value).toBe("einstellungen");
        expect(discord.problems.value).toEqual([]);

        antwort = "kanal";
        expect(await discord.speichereEinstellungen(satz)).toBe(false);
        expect(discord.problems.value).toEqual([
            { key: "admin.discord.error.kanal.schreiben", params: { kanal: expect.any(String) } },
        ]);
    });

    it("jeder Fehlercode der Einstellungen hat seinen Satz", () => {
        const fehler = (code: string, details?: Record<string, unknown>) =>
            formProblems(new ApiFailure(409, code, "x", details));
        // Den Fehler „Kanäle gleich“ gibt es nicht mehr: Der Testkanal ist abgeschafft, ein unbekannter Code bleibt allgemein.
        expect(fehler("discord_kanaele_gleich")).toEqual([{ key: "auth.form.failed" }]);
        expect(fehler("discord_prompt_ungueltig")).toEqual([{ key: "admin.discord.error.promptUngueltig" }]);
        expect(fehler("discord_kanal_unbrauchbar", { kanal: "bericht", grund: "unbekannt" })[0]!.key).toBe(
            "admin.discord.error.kanal.unbekannt",
        );
        expect(fehler("discord_kanal_unbrauchbar", { kanal: "bericht", grund: "sehen" })[0]!.key).toBe(
            "admin.discord.error.kanal.sehen",
        );
        expect(fehler("discord_kanal_unbrauchbar", { kanal: "bericht", grund: "kein_textkanal" })[0]!.key).toBe(
            "admin.discord.error.kanal.keinText",
        );
        expect(fehler("discord_kanal_nicht_pruefbar", { kanal: "bericht" })[0]!.key).toBe(
            "admin.discord.error.kanalNichtPruefbar",
        );
    });
});

describe("Discord-Reiter: Handlungen gegen einen gestellten Server", () => {
    it("🔴 Vorschau ist ein GET, Routine und Wiederholen sind POST mit Kennung; danach lädt der Stand neu", async () => {
        const anfragen: { url: string; method: string; body: unknown }[] = [];
        const fetcher = (async (url: string, init?: RequestInit) => {
            anfragen.push({
                url,
                method: init?.method ?? "GET",
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
            });
            const rumpf = url.endsWith("/vorschau")
                ? { tag: "2026-10-25", text: "x", zeichen: 1, pruefung: { ok: true, fehler: [] }, fakten: {} }
                : url === DISCORD_ADMIN_URL
                  ? stand()
                  : {
                        operationId: "x",
                        status: "applied",
                        environment: "test",
                        affected: [],
                        derivedWork: [],
                        warnings: [],
                    };
            return new Response(JSON.stringify(rumpf), { status: 200 });
        }) as typeof fetch;
        const discord = createDiscordVerwaltung({ fetcher, reads: { ask: async () => true } as never });
        await discord.laden();
        expect(discord.stand.value?.routine.aktiv).toBe(true);
        await discord.rechneVorschau();
        expect(anfragen.at(-1)).toMatchObject({ url: `${DISCORD_ADMIN_URL}/vorschau`, method: "GET" });
        expect(await discord.setzeRoutine(false)).toBe(true);
        const routine = anfragen.find((a) => a.url.endsWith("/routine"));
        expect(routine).toMatchObject({ method: "POST", body: { aktiv: false } });
        expect((routine!.body as { operationId: string }).operationId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(anfragen.at(-1)?.url).toBe(DISCORD_ADMIN_URL);
        expect(await discord.wiederhole(7)).toBe(true);
        expect(
            anfragen.some((a) => a.url === `${DISCORD_ADMIN_URL}/zustellungen/7/wiederholen` && a.method === "POST"),
        ).toBe(true);
    });
});
