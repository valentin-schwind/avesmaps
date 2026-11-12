import { afterEach, describe, expect, it } from "vitest";
import type {
    AdminHoehenmodell,
    AdminSystemzustand,
    MamAssetSummary,
    RouteSegment,
    RouteSlope,
} from "@avesmaps3d/shared";
import { LOCALES, locale, t, type Locale, type MessageKey } from "../src/i18n/i18n.ts";
import { unterzeile } from "../src/auth/abgleiche.ts";
import { gueltigFelder } from "../src/auth/hoehenmodell.ts";
import { auslastung } from "../src/auth/systemzustand.ts";
import { hochgeladenSatz } from "../src/medien/medien-auswahl-modell.ts";
import { freigabeSatzVorher } from "../src/medien/medien-formular-modell.ts";
import { herkunftName } from "../src/medien/medien-text.ts";
import { profileHeadline } from "../src/route-planner/profile-costs.ts";

/**
 * **Ein Tafelwort wird nicht in der Tafel falsch, sondern an seinem Einsatzort** (WI-0172).
 *
 * 💣 Der Typ erzwingt, dass jede Tafel JEDEN Schlüssel trägt - nie, in welcher Sprache sein Text steht und schon gar nicht,
 * in welcher FORM. Ein Schlüssel mit einem einzigen Wort steht in der Tafel für sich allein und sieht dort richtig aus;
 * erst der Code setzt ihn in einen Satz. Deutsch schreibt Substantive groß, Niederländisch, Italienisch, Spanisch,
 * Französisch und Englisch nicht - eine aus dem Deutschen übersetzte Tafel nimmt die Großschreibung mit, und niemand sieht
 * es, weil keine Prüfung den FERTIGEN Satz ansieht. So stand „max. 7 % Discesa, 0 ↑, 90 ↓ passi“ in der Etappenzeile
 * (WI-0167 Nachtrag, `9cfc4771`), und so standen die Wörter dieser Datei da.
 *
 * 🔴 Geprüft wird darum der **zusammengesetzte Satz**, nicht der Tafelwert - und über `LOCALES`, damit eine siebte Tafel
 * vom ersten Tag an mitgeprüft ist. Die Inventur aller Kandidaten steht in `WI-0172`.
 */

afterEach(() => {
    locale.value = "de";
});

const kleingeschrieben = (wort: string, sprache: Locale): string =>
    wort.slice(0, 1).toLocaleLowerCase(sprache) + wort.slice(1);

/**
 * Die Wörter, die der Code MITTEN in einen anderen Satz setzt, mit der Stelle, an der das geschieht. Deutsch ist
 * ausgenommen: Es schreibt seine Substantive auch mitten im Satz groß.
 *
 * 🪤 Nicht hier stehen Wörter, deren erstes Wort ein NAME ist (`medien.auswahl.legacy`: „Legacy-Import“) - die bleiben
 * groß, auch mitten im Satz. Ihr Fall steht unten einzeln.
 */
const MITTEN_IM_SATZ: readonly { schluessel: MessageKey; ort: string }[] = [
    { schluessel: "planner.profile.summary.snow", ort: "route-planner/profile-costs.ts: „+2,3 h (bis 7 %, Schnee)“" },
    { schluessel: "medien.auswahl.datumUnbekannt", ort: "medien/medien-auswahl-modell.ts: „hochgeladen von … · …“" },
    { schluessel: "medien.formular.nomenWappen", ort: "medien/medien-formular-modell.ts: „… öffentlich als … von …“" },
    { schluessel: "medien.formular.nomenBild", ort: "medien/medien-formular-modell.ts: „… öffentlich als … von …“" },
    { schluessel: "admin.terrain.fromFile", ort: "auth/hoehenmodell.ts: „Fassung 18 · …“" },
    { schluessel: "admin.health.mem.swap", ort: "auth/systemzustand.ts: „7,7 GB frei, …“" },
    { schluessel: "admin.health.mem.swapUnknown", ort: "auth/systemzustand.ts: „7,7 GB frei, …“" },
    { schluessel: "admin.sync.phase", ort: "auth/abgleiche.ts: „Läuft seit 3 min · … · 40 %“" },
    { schluessel: "auth.account.password.as", ort: "auth/konto-fenster.vue: „Passwort   …“" },
    { schluessel: "messwerte.nutzer", ort: "system/mess-werte.vue: „23 …“" },
    { schluessel: "messwerte.editoren", ort: "system/mess-werte.vue: „2 …“" },
    { schluessel: "messwerte.fenster", ort: "system/mess-werte.vue: „… 2 … · …“" },
    // Die Lage zu einer Linie (WI-0254): Die Wörter stehen mitten im Satz der Regel („Wald UND alles südlich von Gareth“).
    { schluessel: "admin.wikisync.regeln.alles", ort: "wikisync/wikisync-bedingung.vue: „… UND alles südlich von …“" },
    {
        schluessel: "admin.wikisync.regeln.derTeil",
        ort: "wikisync/wikisync-bedingung.vue: „… ODER der Teil von … südlich von …“",
    },
    {
        schluessel: "admin.wikisync.regeln.richtung.nord",
        ort: "wikisync/wikisync-regeln-text.ts: „{richtung} von {a}“",
    },
    {
        schluessel: "admin.wikisync.regeln.richtung.sued",
        ort: "wikisync/wikisync-regeln-text.ts: „{richtung} von {a}“",
    },
    { schluessel: "admin.wikisync.regeln.richtung.ost", ort: "wikisync/wikisync-regeln-text.ts: „{richtung} von {a}“" },
    {
        schluessel: "admin.wikisync.regeln.richtung.west",
        ort: "wikisync/wikisync-regeln-text.ts: „{richtung} von {a}“",
    },
];

describe("Wörter, die mitten in einem anderen Satz landen", () => {
    it("🔴 stehen außer im Deutschen klein", () => {
        for (const sprache of LOCALES.filter((eine) => eine !== "de")) {
            locale.value = sprache;
            for (const { schluessel, ort } of MITTEN_IM_SATZ) {
                const wort = t(schluessel);
                expect(wort, `${sprache} ${schluessel} (${ort})`).toBe(kleingeschrieben(wort, sprache));
            }
        }
    });

    it("🪤 und das Deutsche schreibt sie weiter so, wie es seine Substantive schreibt", () => {
        expect(t("admin.health.mem.swapUnknown")).toBe("Auslagerung unbekannt");
        expect(t("medien.auswahl.datumUnbekannt")).toBe("Datum unbekannt");
    });
});

describe("Der fertige Satz an seinem Einsatzort", () => {
    const segment = (travelHours: number, snow?: number): RouteSegment =>
        ({
            travel_hours: travelHours,
            ...(snow === undefined ? {} : { snow: { condition: "tiefschnee", extra_hours: snow } }),
        }) as unknown as RouteSegment;
    const steigung = (extraHours: number): RouteSlope =>
        ({ steepest_grade: 0.07, extra_hours: extraHours }) as unknown as RouteSlope;

    it("🔴 der Deckel „Höhenprofil“ trägt den Schnee klein in seiner Klammer", () => {
        const schnee = { extra_hours: 2.5, conditions: ["tiefschnee"] };
        expect(profileHeadline(steigung(1), schnee, [segment(100, 2.5)])).toBe("+2,5 Std. (bis 7 %, Schnee)");
        locale.value = "nl";
        expect(profileHeadline(steigung(1), schnee, [segment(100, 2.5)])).toBe("+2,5 u (tot 7 %, sneeuw)");
        locale.value = "it";
        expect(profileHeadline(steigung(1), schnee, [segment(100, 2.5)])).toBe("+2,5 ore (fino a 7 %, neve)");
    });

    const asset = (ueber: Partial<MamAssetSummary> = {}): MamAssetSummary =>
        ({
            id: "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69",
            origin: "legacy_import",
            uploadedBy: null,
            uploadedByLabel: null,
            uploadedAt: "2025-03-14T10:00:00.000Z",
            ...ueber,
        }) as unknown as MamAssetSummary;
    const datum = (iso: string): string => iso.slice(0, 10);

    it("🔴 „hochgeladen von …“ trägt das fehlende Datum klein", () => {
        expect(hochgeladenSatz(asset({ uploadedAt: null }), datum)).toBe(
            "hochgeladen von Legacy-Import · Datum unbekannt",
        );
        locale.value = "nl";
        expect(hochgeladenSatz(asset({ uploadedAt: null }), datum)).toBe(
            "geüpload door Legacy-import · datum onbekend",
        );
    });

    /**
     * 🪤 **Die Gegenrichtung, und warum es zwei Schlüssel gibt:** Derselbe Wortlaut steht einmal MITTEN im Satz
     * (`medien.auswahl.legacy`, hinter „caricato da“) und einmal am ANFANG seines Glieds (`medien.herkunft.legacy_import`
     * in „{herkunft} · {am}“). Deshalb unterscheiden sie sich im Italienischen und Spanischen genau im ersten Buchstaben -
     * wer den einen „richtigstellt“, macht den anderen falsch.
     */
    it("🔴 dieselbe Herkunft, zwei Schlüssel: mitten im Satz klein, als eigener Wert groß", () => {
        for (const sprache of LOCALES) {
            locale.value = sprache;
            const satz = hochgeladenSatz(asset(), datum);
            const mitten = t("medien.auswahl.legacy");
            expect(satz, `${sprache}`).toContain(mitten);
            expect(satz.startsWith(mitten), `${sprache}: die Herkunft darf den Satz nicht beginnen`).toBe(false);
        }
        locale.value = "it";
        expect(hochgeladenSatz(asset(), datum)).toBe("caricato da importazione da Legacy · 2025-03-14");
        expect(herkunftName("legacy_import")).toBe("Importazione da Legacy");
        locale.value = "es";
        expect(hochgeladenSatz(asset({ uploadedByLabel: "Gwendolin" }), datum)).toBe(
            "subido por importación desde Legacy (Gwendolin) · 2025-03-14",
        );
        expect(herkunftName("legacy_import")).toBe("Importación desde Legacy");
    });

    it("🔴 „öffentlich als …“ trägt das Wort der Rolle klein", () => {
        const vorschau = { public: true } as never;
        locale.value = "nl";
        expect(freigabeSatzVorher("own_work", vorschau, t("medien.formular.nomenWappen"), "Gareth").text).toBe(
            "Na het uploaden openbaar als wapen van Gareth.",
        );
    });

    it("🔴 „Auslagerung …“ steht hinter dem freien Speicher und damit klein", () => {
        const stand = {
            komponenten: [],
            auslastung: {
                last: null,
                kerne: 4,
                speicher: { gesamt: 8 * 1024 ** 3, belegt: 4 * 1024 ** 3, auslagerung: null, auslagerungGesamt: null },
                prozesse: [],
                platten: [],
                laufzeit: { system: null },
            },
        } as unknown as AdminSystemzustand;
        expect(auslastung(stand, new Date("2026-10-15T12:00:00Z")).speicher.zusatz).toBe(
            "4 GB frei, Auslagerung unbekannt",
        );
        locale.value = "nl";
        expect(auslastung(stand, new Date("2026-10-15T12:00:00Z")).speicher.zusatz).toBe(
            "4 GB vrij, wisselbestand onbekend",
        );
    });

    it("🔴 „Schritt 2“ steht hinter „Läuft seit …“ und damit klein", () => {
        const zeile = {
            quelle: "legacy",
            kreis: "voll",
            letzter: null,
            ausfuehrung: "worker",
            laufend: {
                jobId: "7e570000-0000-4000-8000-000000000001",
                state: "RUNNING",
                queuedAt: "2026-10-15T11:55:00Z",
                startedAt: "2026-10-15T11:57:00Z",
                phase: "2",
                progress: null,
                platz: null,
                waitReason: null,
            },
        } as never;
        const now = new Date("2026-10-15T12:00:00Z");
        expect(unterzeile(zeile, now).text).toContain(`· ${t("admin.sync.phase", { phase: "2" })}`);
        expect(unterzeile(zeile, now).text).toContain("· Schritt 2");
        locale.value = "nl";
        expect(unterzeile(zeile, now).text).toContain("· stap 2");
    });

    it("🔴 „Vorgabe der Datei“ steht hinter der Fassung und damit klein", () => {
        const stand = {
            eingestellt: { version: 18, seit: null, wer: null, grund: null, quelle: "datei" },
            wirksam: { version: 18, gerechnetAm: null, vorlaeufig: false },
            kette: null,
            fassungen: [],
            entwuerfe: [],
        } as never;
        const now = new Date("2026-10-15T12:00:00Z");
        const wert = (sprache: Locale): string => {
            locale.value = sprache;
            return gueltigFelder(stand as AdminHoehenmodell, now).find((feld) => feld.id === "eingestellt")!.wert;
        };
        expect(wert("de")).toBe("Fassung 18 · Vorgabe der Datei");
        expect(wert("nl")).toBe("Versie 18 · vooringave van het bestand");
    });
});
