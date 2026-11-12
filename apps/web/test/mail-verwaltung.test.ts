import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { createServer, type ViteDevServer } from "vite";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    MAIL_ABRUF_ERGEBNISSE,
    MAIL_ADMIN_URL,
    MAIL_VERSAND_ERGEBNISSE,
    type MailAbrufStand,
    type MailStand,
    type MailVersandStand,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import { formProblems } from "../src/auth/formular.ts";
import type { authState as AuthState } from "../src/auth/session-state.ts";
import { de } from "../src/i18n/de.ts";
import {
    betriebsText,
    betriebsTon,
    createMailVerwaltung,
    erfolgZahlen,
    grundSatz,
    laufSchluessel,
    startpunktParams,
} from "../src/community/mail-verwaltung.ts";

/**
 * Das Panel „Mailpostfach“ im Browser (WI-0268 C6c): der Ton des Betriebs, der Satz zum Grund, die Namen der Läufe und die Handlungen gegen einen gestellten Server.
 * 🔴 Das Panel kennt keine Zugangsdaten: Es zeigt nur, was der Stand nennt, und legt den Schalter um.
 */

const routine = { aktiv: true, geaendertAt: null, geaendertVon: null };

const abruf = (teil: Partial<MailAbrufStand> = {}): MailAbrufStand => ({
    betrieb: "holt_ab",
    grund: null,
    wartenBis: null,
    zugang: "hinterlegt",
    server: "imap.example.invalid",
    ordner: "INBOX",
    routine,
    letzterLauf: null,
    letzterErfolg: null,
    startpunkt: { uidValidity: 1782729528, letzteUid: 275 },
    letzteMailAt: null,
    ...teil,
});
const versand = (teil: Partial<MailVersandStand> = {}): MailVersandStand => ({
    betrieb: "sendet",
    grund: null,
    zugang: "hinterlegt",
    server: "smtp.example.invalid",
    routine,
    letzterLauf: null,
    letzterErfolg: null,
    wartend: 0,
    fehler7Tage: 0,
    ...teil,
});
const stand = (teil: Partial<MailStand> = {}): MailStand => ({ abruf: abruf(), versand: versand(), ...teil });

describe("Panel Mailpostfach: Ton und Sätze", () => {
    it("🔴 der Betrieb warnt nur, wenn etwas fehlt oder Aufmerksamkeit braucht; bewusst aus ist Ruhe", () => {
        expect(betriebsTon(abruf())).toBe("erfolg");
        expect(betriebsTon(versand())).toBe("erfolg");
        expect(betriebsTon(abruf({ betrieb: "holt_nicht_ab", grund: "ausgeschaltet" }))).toBe("ruhe");
        expect(betriebsTon(versand({ betrieb: "sendet_nicht", grund: "ausgeschaltet" }))).toBe("ruhe");
        expect(betriebsTon(abruf({ betrieb: "holt_nicht_ab", grund: "zugang_fehlt" }))).toBe("warnung");
        expect(betriebsTon(versand({ betrieb: "sendet_nicht", grund: "zugang_fehlt" }))).toBe("warnung");
        expect(betriebsTon(abruf({ betrieb: "holt_nicht_ab", grund: "anmeldung_abgelehnt" }))).toBe("warnung");
        // Ohne Startpunkt holt der Abruf trotzdem ab: ein Vorbehalt, darum Warnung.
        expect(betriebsTon(abruf({ grund: "nicht_eingerichtet" }))).toBe("warnung");
    });

    it("der Betrieb steht in Worten: holt ab, holt nicht ab, sendet, sendet nicht", () => {
        expect(de[betriebsText("abruf", abruf())]).toBe("holt ab");
        expect(de[betriebsText("abruf", abruf({ betrieb: "holt_nicht_ab" }))]).toBe("holt nicht ab");
        expect(de[betriebsText("versand", versand())]).toBe("sendet");
        expect(de[betriebsText("versand", versand({ betrieb: "sendet_nicht" }))]).toBe("sendet nicht");
    });

    it("🔴 der Grund ist ein Satz; abgelehnte Anmeldung nennt die Zeit des nächsten Versuchs, ein fehlender Ordner sagt das", () => {
        expect(grundSatz("abruf", abruf())).toBeNull();
        expect(grundSatz("versand", versand())).toBeNull();
        expect(grundSatz("abruf", abruf({ grund: "zugang_fehlt" }))).toEqual({
            key: "admin.mail.grund.zugang_fehlt",
            zeit: null,
        });
        expect(grundSatz("abruf", abruf({ grund: "ausgeschaltet" }))?.key).toBe("admin.mail.grund.ausgeschaltet");
        // Der Versand sagt „gesendet“ statt „abgeholt“.
        expect(grundSatz("versand", versand({ grund: "ausgeschaltet" }))?.key).toBe(
            "admin.mail.grund.versandAusgeschaltet",
        );
        expect(grundSatz("abruf", abruf({ grund: "nicht_eingerichtet" }))?.key).toBe(
            "admin.mail.grund.nicht_eingerichtet",
        );
        const bis = "2026-11-01T18:00:00.000Z";
        const abgelehnt = abruf({
            betrieb: "holt_nicht_ab",
            grund: "anmeldung_abgelehnt",
            wartenBis: bis,
            letzterLauf: { at: "2026-11-01T12:00:00.000Z", ergebnis: "anmeldung_abgelehnt" },
        });
        expect(grundSatz("abruf", abgelehnt)).toEqual({ key: "admin.mail.grund.anmeldung_abgelehnt", zeit: bis });
        const ordner = abruf({
            betrieb: "holt_nicht_ab",
            grund: "anmeldung_abgelehnt",
            wartenBis: bis,
            letzterLauf: { at: "2026-11-01T12:00:00.000Z", ergebnis: "ordner_fehlt" },
        });
        expect(grundSatz("abruf", ordner)).toEqual({ key: "admin.mail.grund.ordner_fehlt", zeit: bis });
        // Beide Sätze nennen die Zeit, an der der nächste Versuch beginnt.
        expect(de["admin.mail.grund.anmeldung_abgelehnt"]).toContain("{zeit}");
        expect(de["admin.mail.grund.ordner_fehlt"]).toContain("{zeit}");
    });

    it("🔴 jedes Wort eines Laufs hat seinen Satz; die Zahlen und der Startpunkt werden unverändert gereicht", () => {
        for (const wort of new Set([...MAIL_ABRUF_ERGEBNISSE, ...MAIL_VERSAND_ERGEBNISSE])) {
            expect(de[laufSchluessel(wort)], wort).toBeTypeOf("string");
        }
        expect(erfolgZahlen({ at: "x", neu: 2, angehaengt: 1, unlesbar: 0, zuGross: 3 })).toEqual({
            neu: 2,
            angehaengt: 1,
            unlesbar: 0,
            zuGross: 3,
        });
        expect(startpunktParams({ uidValidity: 1782729528, letzteUid: 275 })).toEqual({
            uidValidity: 1782729528,
            letzteUid: 275,
        });
    });

    it("der Fehler „Mailpostfach nicht eingerichtet“ hat seinen Satz", () => {
        expect(formProblems(new ApiFailure(503, "mail_unavailable", "x"))).toEqual([
            { key: "admin.mail.error.unavailable" },
        ]);
    });
});

describe("Panel Mailpostfach: Handlungen gegen einen gestellten Server", () => {
    function server(zustand: { versandAktiv: boolean } = { versandAktiv: true }) {
        const anfragen: { url: string; method: string; body: unknown }[] = [];
        const fetcher = (async (url: string, init?: RequestInit) => {
            anfragen.push({
                url,
                method: init?.method ?? "GET",
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
            });
            if (url === MAIL_ADMIN_URL) {
                return new Response(
                    JSON.stringify(
                        stand({ versand: versand({ routine: { ...routine, aktiv: zustand.versandAktiv } }) }),
                    ),
                    { status: 200 },
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
        return { anfragen, fetcher };
    }

    it("🔴 Schalten ist ein POST mit Kennung, Art und Zielzustand; danach lädt der Stand neu; ein zweiter Klick währenddessen wird nicht gesendet", async () => {
        const { anfragen, fetcher } = server();
        const mail = createMailVerwaltung({ fetcher, reads: { ask: async () => true } as never });
        await mail.laden();
        expect(mail.stand.value?.abruf.betrieb).toBe("holt_ab");
        const erster = mail.setzeRoutine("versand", false);
        expect(mail.busy.value).toBe("versand");
        expect(await mail.setzeRoutine("abruf", false)).toBe(false);
        expect(await erster).toBe(true);
        const post = anfragen.find((a) => a.url === `${MAIL_ADMIN_URL}/routine`);
        expect(post).toMatchObject({ method: "POST", body: { art: "versand", aktiv: false } });
        expect((post!.body as { operationId: string }).operationId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(anfragen.filter((a) => a.url === `${MAIL_ADMIN_URL}/routine`)).toHaveLength(1);
        expect(anfragen.at(-1)?.url).toBe(MAIL_ADMIN_URL);
        expect(mail.busy.value).toBeNull();
        expect(mail.problemArt.value).toBe("versand");
        expect(mail.problems.value).toEqual([]);
    });

    it("ein abgelehnter Schalter bleibt als Satz der betroffenen Karte stehen, der Stand lädt trotzdem neu", async () => {
        const anfragen: string[] = [];
        const fetcher = (async (url: string) => {
            anfragen.push(url);
            if (url === MAIL_ADMIN_URL) return new Response(JSON.stringify(stand()), { status: 200 });
            return new Response(JSON.stringify({ error: { code: "mail_unavailable", message: "x" } }), { status: 503 });
        }) as typeof fetch;
        const mail = createMailVerwaltung({ fetcher, reads: { ask: async () => true } as never });
        expect(await mail.setzeRoutine("abruf", false)).toBe(false);
        expect(mail.problemArt.value).toBe("abruf");
        expect(mail.problems.value).toEqual([{ key: "admin.mail.error.unavailable" }]);
        expect(anfragen.at(-1)).toBe(MAIL_ADMIN_URL);
        expect(mail.stand.value?.abruf.betrieb).toBe("holt_ab");
    });

    it("kann der Stand nicht geladen werden, sagt das Panel es", async () => {
        const fetcher = (async () => new Response("{}", { status: 500 })) as typeof fetch;
        const mail = createMailVerwaltung({ fetcher, reads: { ask: async () => true } as never });
        await mail.laden();
        expect(mail.fehler.value).toBe(true);
        expect(mail.stand.value).toBeNull();
    });
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("Panel Mailpostfach: die Seite", () => {
    // Die Seite, das Modell und der Zustand der Anmeldung kommen aus DEMSELBEN Modulgraphen des Vite-Servers: Nur so sieht die Seite die Rechte, die der Test setzt.
    let server: ViteDevServer;
    let Seite: Component;
    let neuesModell: typeof createMailVerwaltung;
    let sitzung: typeof AuthState;
    let vorher: (typeof AuthState)["value"];

    beforeAll(async () => {
        server = await createServer({
            root: repositoryRoot,
            configFile: false,
            logLevel: "silent",
            appType: "custom",
            cacheDir: join(tmpdir(), "avesmaps-test-mail-vite"),
            server: { middlewareMode: true, hmr: false, watch: null },
            optimizeDeps: { noDiscovery: true, include: [] },
            plugins: [vue()],
            resolve: {
                alias: [
                    {
                        find: /^@avesmaps3d\/shared$/,
                        replacement: join(repositoryRoot, "packages/shared/src/index.ts"),
                    },
                ],
            },
        });
        Seite = ((await server.ssrLoadModule("/apps/web/src/community/mail-verwaltung.vue")) as { default: Component })
            .default;
        neuesModell = (
            (await server.ssrLoadModule("/apps/web/src/community/mail-verwaltung.ts")) as {
                createMailVerwaltung: typeof createMailVerwaltung;
            }
        ).createMailVerwaltung;
        sitzung = (
            (await server.ssrLoadModule("/apps/web/src/auth/session-state.ts")) as { authState: typeof AuthState }
        ).authState;
        vorher = sitzung.value;
    }, 60_000);

    afterEach(() => {
        sitzung.value = vorher;
    });

    afterAll(async () => {
        await server.close();
    });

    async function rendere(s: MailStand, capabilities: string[]): Promise<string> {
        sitzung.value = { ...vorher, known: true, authEnabled: true, capabilities };
        const mail = neuesModell({ fetcher: (async () => new Response("{}")) as typeof fetch });
        mail.stand.value = s;
        return await renderToString(createSSRApp({ render: () => h(Seite, { mail }) }));
    }
    it("🔴 zwei Karten mit Betrieb, Routine, Zugang (nur ob), Server, Ordner und Startpunkt; der Knopf nur mit `manage_system_settings`", async () => {
        const html = await rendere(stand(), ["view_operations", "manage_system_settings"]);
        for (const kennung of ["mail-abruf", "mail-versand", "mail-abruf-schalten", "mail-versand-schalten"]) {
            expect(html, kennung).toContain(`data-testid="${kennung}"`);
        }
        expect(html).toContain("holt ab");
        expect(html).toContain("sendet");
        expect(html).toContain("imap.example.invalid");
        expect(html).toContain("smtp.example.invalid");
        expect(html).toContain("INBOX");
        expect(html).toContain("UIDVALIDITY 1782729528 · letzte UID 275");
        expect(html).toContain("hinterlegt");
        expect(html).toContain("Ausschalten");
        // Nur sehen darf, wer den Betrieb liest: Kein Knopf.
        const nurLesen = await rendere(stand(), ["view_operations"]);
        expect(nurLesen).not.toContain("mail-abruf-schalten");
        expect(nurLesen).not.toContain("Ausschalten");
        expect(nurLesen).toContain("holt ab");
    });

    it("🔴 ohne Zugang, abgelehnte Anmeldung und ausgeschalteter Versand: Grund als Satz, Hinweis auf wartende Mails, Knopf „Einschalten“", async () => {
        const html = await rendere(
            stand({
                abruf: abruf({
                    betrieb: "holt_nicht_ab",
                    grund: "anmeldung_abgelehnt",
                    wartenBis: "2026-11-01T18:00:00.000Z",
                    letzterLauf: { at: "2026-11-01T12:00:00.000Z", ergebnis: "anmeldung_abgelehnt" },
                }),
                versand: versand({
                    betrieb: "sendet_nicht",
                    grund: "ausgeschaltet",
                    routine: { aktiv: false, geaendertAt: "2026-11-01T10:00:00.000Z", geaendertVon: "Rondrikan" },
                    wartend: 3,
                    zugang: "fehlt",
                    server: null,
                }),
            }),
            ["view_operations", "manage_system_settings"],
        );
        expect(html).toContain("holt nicht ab");
        expect(html).toContain("Anmeldung abgelehnt, nächster Versuch ab");
        expect(html).toContain("sendet nicht");
        expect(html).toContain("Die Routine ist ausgeschaltet, es wird nichts gesendet.");
        expect(html).toContain("Rondrikan");
        expect(html).toContain("Einschalten");
        expect(html).toContain("Diese Mails werden gesendet, sobald der Versand wieder an ist.");
        expect(html).toContain("nicht eingetragen");
        expect(html).toContain("fehlt");
    });

    it("ohne Startpunkt steht der Vorbehalt als Warnung über den Zeilen, der Abruf holt trotzdem ab", async () => {
        const html = await rendere(stand({ abruf: abruf({ grund: "nicht_eingerichtet", startpunkt: null }) }), [
            "view_operations",
        ]);
        expect(html).toContain('data-testid="mail-abruf-vorbehalt"');
        expect(html).toContain("holt ab");
        expect(html).toContain("noch keiner gesetzt");
    });
});
