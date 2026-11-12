import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { createServer, type ViteDevServer } from "vite";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    BENACHRICHTIGUNG_ARTEN,
    BEWERTUNG_GLOCKEN_ARTEN,
    MEDIA_PHOTOBOX_STAPEL_URL,
    PHOTOBOX_GLOCKEN_ARTEN,
    PHOTOBOX_STAPEL_MAX,
    type Benachrichtigung,
    type PhotoboxStapel,
} from "@avesmaps3d/shared";
import { istCommunityArt, satzTeile } from "../src/auth/benachrichtigungen.ts";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { setLocale } from "../src/i18n/i18n.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { PLURAL_FORMS, type Locale } from "../src/i18n/plural.ts";
import { sv } from "../src/i18n/sv.ts";
import { MEDIEN_START, adresseMitZustand, zustandAusAdresse } from "../src/medien/medien-zustand.ts";
import {
    medienOffen,
    medienZustand,
    oeffneMedien,
    oeffneReisebilder,
    schliesseMedien,
} from "../src/medien/medien-oeffnen.ts";
import {
    STAPEL_RECHT,
    faecher,
    faecherWeite,
    ladeStapel,
    stapelEintrag,
    stapelSignatur,
    stapelZeigen,
} from "../src/photobox/photobox-stapel-modell.ts";

/**
 * Glocke und Stapel neuer Reisebilder (WI-0272 S3, Aufgabe 19): der Satz in der Glocke, der Verweis, der die Medienverwaltung im Korb „PhotoBox-Uploads“ mit der
 * Unterteilung „offen“ öffnet, und der Stapel oben in Community › Meldungen (nur mit `view_media_private`, nur bei `offen > 0`).
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tafeln = { de, en, da, es, fr, it: itTafel, nl, pl, sv } as const satisfies Record<
    Locale,
    Record<string, string>
>;

const basis: Benachrichtigung = {
    id: 41,
    art: "photobox_eingang",
    von: { art: "system", id: null, name: null },
    ops: null,
    text: null,
    frageGeloest: false,
    erstelltAt: "2026-11-01T09:00:00.000Z",
    gelesenAt: null,
    beantwortetAt: null,
    antwort: null,
    vorgang: null,
};
const mit = (patch: Partial<Benachrichtigung>): Benachrichtigung => ({ ...basis, ...patch });

afterEach(async () => {
    await setLocale("de");
});

describe("Glocke: neue Reisebilder", () => {
    it("die Art steht im Katalog, ist keine Art der Community und hat in jeder der neun Sprachen ihren Satz, die gebündelte in jeder Zählform", () => {
        for (const art of PHOTOBOX_GLOCKEN_ARTEN) {
            expect(BENACHRICHTIGUNG_ARTEN as readonly string[]).toContain(art);
            expect(istCommunityArt(art)).toBe(false);
        }
        for (const [sprache, tafel] of Object.entries(tafeln) as [Locale, Record<string, string>][]) {
            expect(tafel["notify.text.photobox_eingang"], sprache).toBeTruthy();
            expect(tafel["notify.text.photobox_eingang"], sprache).not.toContain("{");
            for (const form of PLURAL_FORMS[sprache])
                expect(tafel[`notify.text.photobox_eingangViele.${form}`], `${sprache} ${form}`).toContain("{n}");
        }
    });

    it("🔴 eine Einreichung: „Neues Reisebild zur Prüfung“ als Ganzes ein Verweis in die Medienverwaltung, ohne Nummer", () => {
        expect(satzTeile(basis)).toEqual({
            vor: "",
            ops: null,
            nach: ".",
            medien: { text: "Neues Reisebild zur Prüfung" },
        });
    });

    it("🔴 gebündelt: „3 neue Reisebilder zur Prüfung“ als Ganzes ein Verweis; ab zwei steht die Zahl im Satz", () => {
        expect(satzTeile(mit({ text: "3" }))).toEqual({
            vor: "",
            ops: null,
            nach: ".",
            medien: { text: "3 neue Reisebilder zur Prüfung" },
        });
        expect(satzTeile(mit({ text: "12" })).medien?.text).toBe("12 neue Reisebilder zur Prüfung");
    });

    it("🔴 nie ein Text der Einreichung: Was im text keine Zahl ist, wird nicht gezeigt", () => {
        const fremd = "Die Türme von Wehrheim im Abendlicht, aufgenommen von Alrike";
        const teile = satzTeile(mit({ text: fremd }));
        expect(JSON.stringify(teile)).not.toContain("Wehrheim");
        expect(JSON.stringify(teile)).not.toContain("Alrike");
        expect(teile.medien?.text).toBe("Neues Reisebild zur Prüfung");
    });

    it("die Zählform wählt die Sprache: Polnisch unterscheidet 2 und 5, Englisch kennt zwei Formen", async () => {
        await setLocale("pl");
        expect(satzTeile(mit({ text: "2" })).medien?.text).toBe("2 nowe obrazy z podróży do sprawdzenia");
        expect(satzTeile(mit({ text: "5" })).medien?.text).toBe("5 nowych obrazów z podróży do sprawdzenia");
        expect(satzTeile(mit({ text: "22" })).medien?.text).toBe("22 nowe obrazy z podróży do sprawdzenia");
        await setLocale("en");
        expect(satzTeile(mit({ text: "3" })).medien?.text).toBe("3 new travel pictures to review");
    });
});

describe("Glocke: neue Bewertungen", () => {
    const eintrag = (text: string | null): Benachrichtigung =>
        ({
            id: 30,
            art: "bewertung_neu",
            von: { art: "system", id: null, name: null },
            ops: null,
            text,
        }) as Benachrichtigung;

    it("die Art steht im Katalog und hat in jeder der neun Sprachen ihren Satz, die gebündelte in jeder Zählform", () => {
        for (const art of BEWERTUNG_GLOCKEN_ARTEN) expect(BENACHRICHTIGUNG_ARTEN as readonly string[]).toContain(art);
        for (const [sprache, tafel] of Object.entries(tafeln) as [Locale, Record<string, string>][]) {
            expect(tafel["notify.text.bewertung_neu"], sprache).toBeTruthy();
            expect(tafel["notify.text.bewertung_neu"], sprache).not.toContain("{");
            for (const form of PLURAL_FORMS[sprache])
                expect(tafel[`notify.text.bewertung_neuViele.${form}`], `${sprache} ${form}`).toContain("{n}");
        }
    });

    it("🔴 eine: der ganze Satz führt zu dieser Bewertung; gebündelt in die Liste; nie ein anderer Text", () => {
        const kennung = "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11";
        expect(satzTeile(eintrag(kennung))).toEqual({
            vor: "",
            ops: null,
            nach: ".",
            com: { text: "Neue Bewertung zum Sichten", nummer: kennung },
        });
        expect(satzTeile(eintrag("3")).com).toEqual({ text: "3 neue Bewertungen zum Sichten", nummer: null });
        expect(satzTeile(eintrag("Alrike schreibt")).com).toEqual({ text: "Neue Bewertung zum Sichten", nummer: null });
    });
});

describe("Der Verweis öffnet die Medienverwaltung im Korb „PhotoBox-Uploads“, Unterteilung „offen“", () => {
    beforeEach(() => {
        schliesseMedien();
        medienZustand.value = { ...MEDIEN_START };
    });

    it("🔴 `oeffneReisebilder` setzt Korb und Unterteilung, verwirft Suche und Auswahl von vorhin und öffnet das Fenster", () => {
        medienZustand.value = {
            ...MEDIEN_START,
            auswahl: { typ: "coat" },
            q: "Wappen",
            einreichung: "erledigt",
            asset: "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11",
        };
        oeffneReisebilder();
        expect(medienOffen.value).toBe(true);
        expect(medienZustand.value).toEqual({
            ...MEDIEN_START,
            auswahl: { korb: "photobox_uploads" },
            einreichung: "offen",
        });
    });

    it("🔴 mit Kennung steht genau dieses Bild im Inspector, im selben Korb (die Vorschau in der Glocke)", () => {
        const asset = "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11";
        oeffneReisebilder(asset);
        expect(medienOffen.value).toBe(true);
        expect(medienZustand.value).toEqual({
            ...MEDIEN_START,
            auswahl: { korb: "photobox_uploads" },
            einreichung: "offen",
            asset,
        });
    });

    it("das Ziel kann Korb und Unterteilung nennen; die Adresse trägt den Korb und gibt ihn beim Laden zurück", () => {
        oeffneMedien({ korb: "photobox_uploads", einreichung: "rueckfrage" });
        expect(medienZustand.value.auswahl).toEqual({ korb: "photobox_uploads" });
        expect(medienZustand.value.einreichung).toBe("rueckfrage");
        const adresse = adresseMitZustand("", medienZustand.value);
        expect(adresse).toContain("medien-korb=photobox_uploads");
        expect(adresse).toContain("medien-einreichung=rueckfrage");
        expect(zustandAusAdresse(adresse)).toMatchObject({
            auswahl: { korb: "photobox_uploads" },
            einreichung: "rueckfrage",
        });
        // „offen“ ist die Vorgabe und steht nicht in der Adresse.
        oeffneReisebilder();
        expect(adresseMitZustand("", medienZustand.value)).not.toContain("medien-einreichung");
        expect(zustandAusAdresse(adresseMitZustand("", medienZustand.value))?.einreichung).toBe("offen");
    });
});

describe("Stapel: Modell", () => {
    const eintrag = (n: number) => ({
        publicId: `0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b${String(10 + n)}`,
        url: `/api/editor/media/0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b${String(10 + n)}/preview/intern_photobox_2048`,
    });
    const stapel = (offen: number, n = Math.min(offen, 5)): PhotoboxStapel => ({
        offen,
        vorschau: Array.from({ length: n }, (_, i) => eintrag(i + 1)),
    });

    it("🔴 gezeigt wird er nur mit `view_media_private` und nur, wenn etwas offen ist", () => {
        expect(STAPEL_RECHT).toBe("view_media_private");
        expect(stapelZeigen(["view_media_private"], stapel(3))).toBe(true);
        expect(stapelZeigen([], stapel(3))).toBe(false);
        expect(stapelZeigen(["moderate_submissions", "upload_media"], stapel(3))).toBe(false);
        expect(stapelZeigen(["view_media_private"], stapel(0))).toBe(false);
        expect(stapelZeigen(["view_media_private"], null)).toBe(false);
        expect(stapelZeigen(["view_media_private"], undefined)).toBe(false);
        // Offen, aber noch ohne Vorschau (das Bild wird noch gerechnet): Der Stapel zeigt trotzdem die Zahl.
        expect(stapelZeigen(["view_media_private"], stapel(2, 0))).toBe(true);
    });

    it("der Fächer: höchstens fünf, leicht gedreht um die Mitte, überlappend, das neueste (erste) zuoberst", () => {
        const feder = faecher([1, 2, 3, 4, 5, 6, 7].map(eintrag));
        expect(feder).toHaveLength(PHOTOBOX_STAPEL_MAX);
        // Die ersten fünf in der Reihenfolge der Antwort.
        expect(feder.map((bild) => bild.publicId)).toEqual([1, 2, 3, 4, 5].map((n) => eintrag(n).publicId));
        // Zuoberst liegt das neueste: Je weiter vorn, desto höher die Ebene.
        const ebenen = feder.map((bild) => bild.ebene);
        expect([...ebenen].sort((a, b) => b - a)).toEqual(ebenen);
        expect(new Set(ebenen).size).toBe(feder.length);
        // Ruhig: leichte Drehung (unter zehn Grad), um die Mitte verteilt; überlappend (der Versatz ist kleiner als die Bildbreite, 1 = ganze Breite).
        for (const bild of feder) expect(Math.abs(bild.drehung)).toBeLessThan(10);
        const summe = feder.reduce((s, bild) => s + bild.drehung, 0);
        expect(Math.abs(summe)).toBeLessThan(0.0001);
        const versaetze = feder.map((bild) => bild.versatz);
        for (let i = 1; i < versaetze.length; i++) {
            const schritt = versaetze[i]! - versaetze[i - 1]!;
            expect(schritt).toBeGreaterThan(0);
            expect(schritt).toBeLessThan(1);
        }
        // Die Breite des Fächers: das erste Bild ganz und der Versatz des letzten, ohne Gleitkommarauschen.
        expect(faecherWeite(feder)).toBe(2.36);
        expect(faecherWeite([])).toBe(1);
        // Ein einzelnes Bild liegt gerade; keines ergibt nichts.
        expect(faecher([eintrag(1)])).toMatchObject([{ drehung: 0, versatz: 0 }]);
        expect(faecher([])).toEqual([]);
    });

    it("🔴 in der Glocke stehen die Bilder am jüngsten Eintrag der Reisebilder, ohne solchen an keinem", () => {
        const zeile = (id: number, art: string): Benachrichtigung =>
            ({ id, art, text: null, gelesenAt: null, erstelltAt: "2026-11-04T09:00:00.000Z" }) as Benachrichtigung;
        expect(
            stapelEintrag([zeile(9, "community_neu"), zeile(7, "photobox_eingang"), zeile(3, "photobox_eingang")]),
        ).toBe(7);
        expect(stapelEintrag([zeile(9, "community_neu")])).toBeUndefined();
        expect(stapelEintrag([])).toBeUndefined();
    });

    it("die Zahl wird mit dem Takt der Glocke aufgefrischt: die Signatur ändert sich nur, wenn sich ein Eintrag der Reisebilder ändert", () => {
        const andere = mit({ id: 90, art: "community_neu", text: "COM-000001" });
        const eins = mit({ id: 41, text: null });
        const leer = stapelSignatur([andere]);
        const a = stapelSignatur([eins, andere]);
        expect(a).not.toBe(leer);
        // Ein anderer Eintrag der Glocke ändert nichts.
        expect(stapelSignatur([eins, mit({ id: 95, art: "stage_neu", text: "x" }), andere])).toBe(a);
        // Gelesen werden ändert nichts (es kommt nichts Neues).
        expect(stapelSignatur([{ ...eins, gelesenAt: "2026-11-01T09:05:00.000Z" }, andere])).toBe(a);
        // Wächst die Bündelung (neue Zahl, neue Zeit) oder beginnt eine neue Zeile, ist es ein neuer Stand.
        const gewachsen = stapelSignatur([{ ...eins, text: "2", erstelltAt: "2026-11-01T09:10:00.000Z" }, andere]);
        expect(gewachsen).not.toBe(a);
        expect(stapelSignatur([mit({ id: 44, text: null }), { ...eins, gelesenAt: "x" }])).not.toBe(a);
        expect(stapelSignatur(undefined)).toBe(leer);
        expect(stapelSignatur([])).toBe(leer);
    });

    it("laden: die Adresse des Servers, mit der Sitzung; ein Fehler heißt „nichts zu zeigen“, nie ein Absturz", async () => {
        const gesehen: { url: string; init: RequestInit | undefined }[] = [];
        const antwort = stapel(4);
        const fetcher = ((url: string, init?: RequestInit) => {
            gesehen.push({ url, init });
            return Promise.resolve(
                new Response(JSON.stringify(antwort), { status: 200, headers: { "content-type": "application/json" } }),
            );
        }) as typeof fetch;
        const signal = new AbortController().signal;
        expect(await ladeStapel(fetcher, signal)).toEqual(antwort);
        expect(gesehen[0]?.url).toBe(MEDIA_PHOTOBOX_STAPEL_URL);
        expect(gesehen[0]?.init?.signal).toBe(signal);

        const kaputt = (() => Promise.resolve(new Response("{}", { status: 403 }))) as typeof fetch;
        expect(await ladeStapel(kaputt, signal)).toBeNull();
        const netz = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
        expect(await ladeStapel(netz, signal)).toBeNull();
    });
});

describe("Stapel: Bauteil", () => {
    let server: ViteDevServer;
    let Stapel: Component;
    let zustand: typeof import("../src/photobox/photobox-stapel-modell.ts");
    let sitzung: typeof import("../src/auth/session-state.ts");

    beforeAll(async () => {
        server = await createServer({
            root: repositoryRoot,
            configFile: false,
            logLevel: "silent",
            appType: "custom",
            cacheDir: join(repositoryRoot, "node_modules", ".vite-photobox-stapel-test"),
            server: { middlewareMode: true, hmr: false, watch: null },
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
        Stapel = ((await server.ssrLoadModule("/apps/web/src/photobox/photobox-stapel.vue")) as { default: Component })
            .default;
        zustand = (await server.ssrLoadModule("/apps/web/src/photobox/photobox-stapel-modell.ts")) as typeof zustand;
        sitzung = (await server.ssrLoadModule("/apps/web/src/auth/session-state.ts")) as typeof sitzung;
    }, 120_000);

    afterAll(async () => {
        await server.close();
    });

    const fuerRechte = (faehigkeiten: string[]): void => {
        sitzung.authState.value = {
            known: true,
            authEnabled: true,
            environment: null,
            person: null,
            capabilities: faehigkeiten,
        } as typeof sitzung.authState.value;
    };
    const vorschau = (n: number) => ({
        publicId: `0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b${String(10 + n)}`,
        url: `/api/editor/media/0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b${String(10 + n)}/preview/intern_photobox_2048`,
    });
    const rendere = async (stapel: PhotoboxStapel | null): Promise<string> => {
        zustand.stapelZustand.stapel.value = stapel;
        return renderToString(createSSRApp({ render: () => h(Stapel, { sichtbar: true }) }));
    };

    it("🔴 ohne `view_media_private` rendert er nichts, auch wenn Daten da wären", async () => {
        fuerRechte(["moderate_submissions"]);
        const html = await rendere({ offen: 4, vorschau: [vorschau(1)] });
        expect(html).not.toContain("photobox-stapel");
        expect(html.replace(/<!--.*?-->/gu, "").trim()).toBe("");
    });

    it("🔴 bei `offen = 0` und solange nichts geladen ist rendert er nichts", async () => {
        fuerRechte(["view_media_private"]);
        expect((await rendere({ offen: 0, vorschau: [] })).replace(/<!--.*?-->/gu, "").trim()).toBe("");
        expect((await rendere(null)).replace(/<!--.*?-->/gu, "").trim()).toBe("");
    });

    it("🔴 mit Recht und `offen > 0`: zwei Zeilen, der Fächer der Vorschauen (höchstens fünf), die Zahl und der Verweis „In der Medienverwaltung prüfen“", async () => {
        fuerRechte(["view_media_private"]);
        const html = await rendere({ offen: 7, vorschau: [1, 2, 3, 4, 5].map(vorschau) });
        expect(html).toContain('data-testid="photobox-stapel"');
        expect(html).toContain('data-testid="photobox-stapel-bilder"');
        expect(html.match(/<img /gu)).toHaveLength(5);
        for (const n of [1, 2, 3, 4, 5]) expect(html).toContain(`src="${vorschau(n).url}"`);
        expect(html).toContain("7 Reisebilder warten auf Prüfung");
        const knopf = html.slice(html.indexOf("<button"), html.indexOf("</button>"));
        expect(knopf).toContain('data-testid="photobox-stapel-pruefen"');
        expect(knopf).toContain("In der Medienverwaltung prüfen");
        // Die Vorschauen sind Zierde: kein Name, keine Beschreibung; der Satz daneben sagt, was sie sind.
        expect(html).not.toMatch(/<img [^>]*alt="[^"]+"/u);
    });

    it("eine Einzahl heißt „1 Reisebild wartet“, und ohne gerechnete Vorschau steht die Zahl allein", async () => {
        fuerRechte(["view_media_private"]);
        const eins = await rendere({ offen: 1, vorschau: [vorschau(1)] });
        expect(eins).toContain("1 Reisebild wartet auf Prüfung");
        const ohne = await rendere({ offen: 2, vorschau: [] });
        expect(ohne).toContain("2 Reisebilder warten auf Prüfung");
        expect(ohne).not.toContain("<img");
        expect(ohne).toContain('data-testid="photobox-stapel-pruefen"');
    });

    it("er hängt oberhalb der Liste in Community › Meldungen, mit einer Import- und einer Template-Zeile", () => {
        const quelle = readFileSync(join(repositoryRoot, "apps/web/src/community/meldungen-liste.vue"), "utf8");
        expect(quelle.match(/import PhotoboxStapel from "\.\.\/photobox\/photobox-stapel\.vue";/gu)).toHaveLength(1);
        expect(quelle.match(/<PhotoboxStapel\b/gu)).toHaveLength(1);
        expect(quelle.indexOf("<PhotoboxStapel")).toBeLessThan(quelle.indexOf('data-testid="community-liste"'));
    });
});
