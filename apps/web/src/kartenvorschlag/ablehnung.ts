import { KARTENVORSCHLAG_GRENZEN, KARTENVORSCHLAG_LIMITS } from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import { formatNumber, t } from "../i18n/i18n";
import type { MessageKey } from "../i18n/de";
import { genauerGrund, textAus, zahlAus, type Abbildung, type FeldSatz, type GrundSatz } from "../system/ablehnung";
import { DATEI_GRUENDE } from "../system/datei-ablehnung";

/**
 * Die Sätze zu den Ablehnungen von „Karte vorschlagen“ (WI-0291, Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“). Server: `kartenvorschlag/einreichen.ts` und
 * `kartenvorschlag/db.ts` (`details.reason`), Dateigründe aus der Bildprüfung (`media_file_rejected`) über `DATEI_GRUENDE`. Jeder Satz nennt den Grund UND was zu tun ist.
 *
 * - **Gründe** je Fachcode, **Felder** je Schemafeld (400 `validation_failed`: Link-Muster, Längen, Jahre, Größe der Datei).
 * - **413 und 415 ohne Fachcode** (Fastify lehnt den Rumpf selbst ab, bevor die Route läuft) bekommen ihren Satz über Status und Code in `kartenvorschlagGrund`.
 */

/** Der Name einer Dateiart für den Satz (JPEG, PNG, WebP, PDF); eine unbekannte Art bleibt, wie der Server sie nennt. */
const ART_NAME: Readonly<Record<string, string>> = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WebP",
    "application/pdf": "PDF",
};
const artName = (mime: string): string => ART_NAME[mime] ?? mime;

/** Das Feld eines Freitextes in den Worten des Formulars. */
const FELD_NAME: Readonly<Record<string, MessageKey>> = {
    titel: "kartenvorschlag.titelfeld.label",
    beschreibung: "kartenvorschlag.beschreibung.label",
    quelle: "kartenvorschlag.quelle.label",
    urheber: "kartenvorschlag.urheber.label",
    notiz: "kartenvorschlag.notiz.label",
    name: "photobox.name.label",
};

/** Die Höchstzahl der Zeichen je Freitext (`KARTENVORSCHLAG_LIMITS`). */
const FELD_MAX: Readonly<Record<string, number>> = {
    titel: KARTENVORSCHLAG_LIMITS.titelMax,
    beschreibung: KARTENVORSCHLAG_LIMITS.beschreibungMax,
    quelle: KARTENVORSCHLAG_LIMITS.quelleMax,
    urheber: KARTENVORSCHLAG_LIMITS.urheberMax,
    notiz: KARTENVORSCHLAG_LIMITS.notizMax,
    name: KARTENVORSCHLAG_LIMITS.nameMax,
};

/** Die Größengrenze einer Datei in MB für den Satz. */
const dateiMb = (): string => formatNumber(KARTENVORSCHLAG_GRENZEN.dateiBytes / (1024 * 1024), 0);

const zuGross = (): string => t("kartenvorschlag.ablehnung.zuGross", { mb: dateiMb() });
const format = (): string => t("kartenvorschlag.ablehnung.format");

/** Der Satz zu einem leeren Freitext (nur Leerraum): mit dem Namen des Feldes, sonst ohne Satz (dann gilt der Rückfall). */
const feldLeer = (feld: string | undefined): string | undefined => {
    const name = feld === undefined ? undefined : FELD_NAME[feld];
    return name === undefined ? undefined : t("kartenvorschlag.ablehnung.feldLeer", { feld: t(name) });
};

const gruende: Readonly<Record<string, GrundSatz>> = {
    ...DATEI_GRUENDE,
    datei_und_link: () => t("kartenvorschlag.ablehnung.dateiUndLink"),
    datei_angaben_fehlen: (details) => {
        switch (textAus(details, "fehlt")) {
            case "datei":
                return t("kartenvorschlag.ablehnung.dateiFehlt");
            case "nutzung":
                return t("kartenvorschlag.ablehnung.nutzungFehlt");
            case "bedingungen":
                return t("kartenvorschlag.ablehnung.bedingungenFehlen");
            default:
                return undefined;
        }
    },
    link_fehlt: () => t("kartenvorschlag.ablehnung.linkFehlt"),
    link_mit_datei: () => t("kartenvorschlag.ablehnung.linkMitDatei"),
    zeitraum_verkehrt: (details) => {
        const ab = zahlAus(details, "gueltigAb");
        const bis = zahlAus(details, "gueltigBis");
        return ab === undefined || bis === undefined
            ? undefined
            : t("kartenvorschlag.ablehnung.zeitraum", { ab: String(ab), bis: String(bis) });
    },
    feld_leer: (details) => feldLeer(textAus(details, "feld")),
    ort_unbekannt: () => t("kartenvorschlag.ablehnung.ortUnbekannt"),
    angaben_passen_nicht: () => t("kartenvorschlag.ablehnung.angabenPassenNicht"),
    datei_art_falsch: (details) => {
        const angekuendigt = textAus(details, "angekuendigt");
        const tatsaechlich = textAus(details, "tatsaechlich");
        return angekuendigt === undefined || tatsaechlich === undefined
            ? undefined
            : t("kartenvorschlag.ablehnung.dateiArtFalsch", {
                  angekuendigt: artName(angekuendigt),
                  tatsaechlich: artName(tatsaechlich),
              });
    },
    datei_leer: () => t("datei.ablehnung.leer"),
    datei_zu_gross: zuGross,
    // Die Bildprüfung nennt die Größe als `too_large_bytes` (413 `payload_too_large`): derselbe Satz.
    too_large_bytes: zuGross,
    unsupported_format: format,
    kein_dateiweg: () => t("kartenvorschlag.ablehnung.keinDateiweg"),
    datei_nicht_mehr_gefragt: () => t("kartenvorschlag.ablehnung.dateiNichtMehrGefragt"),
    nicht_zurueckziehbar: () => t("kartenvorschlag.ablehnung.nichtZurueckziehbar"),
};

/** Ein Link: egal welche Regel (Muster, zu kurz, zu lang), der Satz nennt alle drei. */
const linkSatz =
    (key: MessageKey): FeldSatz =>
    () =>
        t(key, { max: String(KARTENVORSCHLAG_LIMITS.linkMax) });

/** Ein Freitext: zu lang → Höchstzahl; leer oder nur Leerraum (Länge 0, Muster `\S`) → „darf nicht leer sein“. */
const textSatz =
    (feld: string): FeldSatz =>
    (regel) => {
        const name = FELD_NAME[feld];
        if (name === undefined) return undefined;
        if (regel === "maxLength") {
            return t("kartenvorschlag.ablehnung.textLang", {
                feld: t(name),
                max: String(FELD_MAX[feld] ?? 0),
            });
        }
        return regel === "minLength" || regel === "pattern" ? feldLeer(feld) : undefined;
    };

const jahrSatz =
    (label: MessageKey): FeldSatz =>
    () =>
        t("kartenvorschlag.ablehnung.jahr", {
            feld: t(label),
            min: String(KARTENVORSCHLAG_LIMITS.jahrMin),
            max: String(KARTENVORSCHLAG_LIMITS.jahrMax),
        });

const felder: Readonly<Record<string, FeldSatz>> = {
    link: linkSatz("kartenvorschlag.ablehnung.linkFalsch"),
    vorschauLink: linkSatz("kartenvorschlag.ablehnung.vorschauFalsch"),
    ...Object.fromEntries(Object.keys(FELD_NAME).map((feld) => [feld, textSatz(feld)])),
    gueltigAb: jahrSatz("kartenvorschlag.ab.label"),
    gueltigBis: jahrSatz("kartenvorschlag.bis.label"),
    groesse: (regel) => (regel === "maximum" ? zuGross() : t("datei.ablehnung.leer")),
    typ: format,
};

export const KARTENVORSCHLAG_ABLEHNUNG: Abbildung = { gruende, felder };

/**
 * Der genaue Satz zu einem Fehler von „Karte vorschlagen“ (Formular und Datei), oder `undefined`, wenn der Server keinen gab (dann zeigt das Fenster seinen allgemeinen Satz). 413 und 415 ohne
 * Fachcode kommen von Fastify, bevor die Route läuft; sie sagen, was angenommen wird.
 */
export function kartenvorschlagGrund(fehler: unknown): string | undefined {
    const satz = genauerGrund(fehler, KARTENVORSCHLAG_ABLEHNUNG);
    if (satz !== undefined) return satz;
    if (!(fehler instanceof ApiFailure)) return undefined;
    if (fehler.status === 413) return zuGross();
    if (fehler.status === 415) return format();
    return undefined;
}
