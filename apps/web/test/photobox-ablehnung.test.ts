import { describe, expect, it } from "vitest";
import { PHOTOBOX_LIMITS } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import { formatNumber, t } from "../src/i18n/i18n";
import { fehlerSatzFuer, fehlerText } from "../src/photobox/api";
import { BESUCHER_ABBILDUNG, REDAKTION_ABBILDUNG, redaktionGrund } from "../src/photobox/ablehnung";
import { fehlendes, kuerze, leererEntwurf, zeichen } from "../src/photobox/formular-modell";
import { operationsFehler } from "../src/medien/medien-operationen";
import { genauerGrund } from "../src/system/ablehnung";

/**
 * WI-0291 (Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“), Reisebilder: Der Fachcode des Servers (`details.reason`) wird im Formular, auf der
 * Statusseite und in der Redaktion der Medienverwaltung zu einem eigenen Satz. Erwartet wird über `t(key, params)`, nicht über den Wortlaut.
 */

const abgelehnt = (status: number, code: string, details?: Record<string, unknown>): ApiFailure =>
    new ApiFailure(status, code, "Satz des Servers", details);
const uhr = (): string => "14:30";
const besucher = (fehler: ApiFailure): string => fehlerText(fehlerSatzFuer(fehler, uhr, new Date(2026, 10, 8, 13, 30)));

describe("Besucher: Formular und Statusseite", () => {
    it.each([
        ["cc_by_avesmaps", {}, t("photobox.ablehnung.ccByAvesmaps")],
        ["stelle_ausserhalb", {}, t("photobox.ablehnung.stelleAusserhalb")],
        ["ort_unbekannt", {}, t("photobox.ablehnung.ortUnbekannt")],
        ["feld_leer", { feld: "beschreibung" }, t("photobox.ablehnung.beschreibungLeer")],
        ["feld_leer", { feld: "name" }, t("photobox.ablehnung.nameLeer")],
        ["angaben_passen_nicht", {}, t("photobox.ablehnung.angabenPassenNicht")],
    ])("422 photobox_invalid %s %j nennt den Grund", (reason, weiter, erwartet) => {
        expect(besucher(abgelehnt(422, "photobox_invalid", { reason, ...weiter }))).toBe(erwartet);
    });

    it("409 photobox_transition nennt den Zustand des Reisebilds in den Worten der Statusseite", () => {
        const satz = besucher(abgelehnt(409, "photobox_transition", { reason: "uebergang", zustand: "withdrawn" }));
        expect(satz).toBe(t("photobox.ablehnung.uebergang", { zustand: t("photobox.status.zustand.withdrawn") }));
        // Ohne bekannten Zustand: der Satz ohne Zustand, nie ein roher Platzhalter.
        const ohne = besucher(abgelehnt(409, "photobox_transition", { reason: "uebergang", zustand: "unbekannt" }));
        expect(ohne).toBe(t("photobox.ablehnung.uebergangOhne"));
    });

    it("409 zu oft ersetzt und Link belegt", () => {
        expect(
            besucher(abgelehnt(409, "photobox_replace_limit", { reason: "ersetzungen_erschoepft", hoechstens: 5 })),
        ).toBe(t("photobox.ablehnung.ersetzungenErschoepft", { n: "5" }));
        expect(besucher(abgelehnt(409, "photobox_key_used", { reason: "schluessel_belegt" }))).toBe(
            t("photobox.ablehnung.schluesselBelegt"),
        );
    });

    it("Dateigründe: Pixel, Kante, mehrbildig, unlesbar, leer, zu groß, Format", () => {
        const datei = (reason: string): string => besucher(abgelehnt(422, "media_file_rejected", { reason }));
        expect(datei("animated_or_multiframe")).toBe(t("datei.ablehnung.mehrbild"));
        expect(datei("bad_header")).toBe(t("datei.ablehnung.unlesbar"));
        expect(datei("decode_failed")).toBe(t("datei.ablehnung.unlesbar"));
        expect(datei("empty_file")).toBe(t("datei.ablehnung.leer"));
        expect(datei("too_many_pixels")).toBe(t("datei.ablehnung.pixel", { mp: "16" }));
        expect(datei("too_large_dimensions")).toBe(t("datei.ablehnung.kante", { kante: formatNumber(8192, 0) }));
        expect(
            besucher(abgelehnt(413, "payload_too_large", { reason: "too_large_bytes", limitBytes: 6 * 1024 * 1024 })),
        ).toBe(t("photobox.ablehnung.zuGross", { mb: "6" }));
        expect(besucher(abgelehnt(415, "unsupported_media_type", { reason: "unsupported_format" }))).toBe(
            t("photobox.ablehnung.format"),
        );
    });

    it("eine leere Datei meldet der Server als fehlendes Feld `bild` (400)", () => {
        const leer = abgelehnt(400, "validation_failed", { issues: [{ path: "bild", rule: "required" }] });
        expect(besucher(leer)).toBe(t("datei.ablehnung.leer"));
    });

    it("Schemafehler nennen das Feld: Beschreibung und Name zu lang, Stelle, Entstehung, Nutzung", () => {
        const schema = (pfad: string, regel: string): string =>
            besucher(abgelehnt(400, "validation_failed", { issues: [{ path: `body/${pfad}`, rule: regel }] }));
        expect(schema("beschreibung", "maxLength")).toBe(
            t("photobox.ablehnung.beschreibungLang", { max: PHOTOBOX_LIMITS.descriptionMax }),
        );
        expect(schema("name", "maxLength")).toBe(
            t("photobox.ablehnung.nameLang", { max: PHOTOBOX_LIMITS.attributionMax }),
        );
        expect(schema("lage/x", "type")).toBe(t("photobox.ablehnung.stelleFalsch"));
        expect(schema("entstehung", "enum")).toBe(t("photobox.ablehnung.entstehungFehlt"));
        expect(schema("nutzung", "enum")).toBe(t("photobox.ablehnung.nutzungFehlt"));
    });

    it("kein Fachcode: der allgemeine Satz der Fehlerart; bei der Drossel steht die Uhrzeit, nie {uhr}", () => {
        const drossel = abgelehnt(429, "photobox_rate", { reason: "drossel", retryAfterSeconds: 3600 });
        expect(genauerGrund(drossel, BESUCHER_ABBILDUNG)).toBeUndefined();
        expect(besucher(drossel)).toBe(t("photobox.fehler.zuViele", { uhr: "14:30" }));
        // Eine Drossel ohne Umschlag (Proxy) bekommt dieselbe Uhrzeit-Regel.
        expect(besucher(abgelehnt(429, "failed"))).not.toContain("{uhr}");
        expect(besucher(abgelehnt(500, "failed"))).toBe(t("photobox.fehler.sonst"));
    });
});

describe("Redaktion in der Medienverwaltung", () => {
    it.each([
        ["stelle_ausserhalb", {}, t("medien.ablehnung.stelleAusserhalb")],
        ["ort_unbekannt", {}, t("medien.ablehnung.ortUnbekannt")],
        ["feld_leer", { feld: "beschreibung" }, t("medien.ablehnung.leerBeschreibung")],
        ["feld_leer", { feld: "nachricht" }, t("medien.ablehnung.leerNachricht")],
        ["feld_leer", { feld: "grund" }, t("medien.ablehnung.leerGrund")],
        ["nichts_zu_korrigieren", {}, t("medien.ablehnung.nichtsZuKorrigieren")],
    ])("422 photobox_invalid %s %j", (reason, weiter, erwartet) => {
        const fehler = operationsFehler(abgelehnt(422, "photobox_invalid", { reason, ...weiter }));
        expect(fehler.text).toBe(erwartet);
        expect(fehler.text).not.toBe(t("medien.op.photoboxUngueltig"));
    });

    it("409: Zustand genannt, nichts wartet, Technik nicht fertig; ohne Fachcode der alte Satz mit Neu laden", () => {
        const uebergang = operationsFehler(
            abgelehnt(409, "photobox_transition", { reason: "uebergang", zustand: "rejected" }),
        );
        expect(uebergang.text).toBe(
            t("medien.ablehnung.uebergang", { zustand: t("photobox.status.zustand.rejected") }),
        );
        expect(uebergang.ton).toBe("warnung");
        expect(
            operationsFehler(abgelehnt(409, "photobox_transition", { reason: "nichts_wartet", zustand: "approved" }))
                .text,
        ).toBe(t("medien.ablehnung.nichtsWartet"));
        expect(
            operationsFehler(
                abgelehnt(409, "photobox_transition", { reason: "technik_nicht_fertig", zustand: "pending" }),
            ).text,
        ).toBe(t("medien.ablehnung.technikNichtFertig"));
        // Ein alter Server ohne `details`: der bisherige Satz bleibt der Rückfall.
        expect(operationsFehler(abgelehnt(409, "photobox_transition")).text).toBe(t("medien.op.photoboxUebergang"));
        expect(operationsFehler(abgelehnt(422, "photobox_invalid")).text).toBe(t("medien.op.photoboxUngueltig"));
    });

    it("redaktionGrund kennt nur Fachcodes der Tafel", () => {
        expect(redaktionGrund(abgelehnt(422, "photobox_invalid", { reason: "gibt_es_nicht" }))).toBeUndefined();
        expect(Object.keys(REDAKTION_ABBILDUNG.gruende ?? {})).toContain("nichts_zu_korrigieren");
    });
});

describe("Vorabprüfung: Längen in Codepunkten wie der Server", () => {
    it("zeichen zählt ein Emoji als eins, kuerze schneidet es nicht durch", () => {
        expect(zeichen("a😀b")).toBe(3);
        expect("a😀b".length).toBe(4);
        expect(kuerze("😀😀😀", 2)).toBe("😀😀");
    });

    it("300 Emoji sind erlaubt (UTF-16 zählte 600), 301 sind zu lang", () => {
        const entwurf = leererEntwurf();
        entwurf.bild = { datei: { name: "a.png", dataBase64: "AAAA" } } as never;
        entwurf.entstehung = "photo";
        entwurf.haken = true;
        entwurf.text = "😀".repeat(PHOTOBOX_LIMITS.descriptionMax);
        expect(fehlendes(entwurf)).toBeUndefined();
        entwurf.text += "😀";
        expect(fehlendes(entwurf)?.grund).toBe("photobox.sperre.textLang");
    });
});
