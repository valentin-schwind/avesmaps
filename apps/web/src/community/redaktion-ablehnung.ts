import { COMMUNITY_GRENZEN } from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { genauerGrund, textAus, type Abbildung, type FeldSatz, type GrundSatz } from "../system/ablehnung";
import { REDAKTION_FEHLER_SATZ, redaktionFehler, type RedaktionFehler } from "./redaktion-api";

/**
 * Die Sätze zu den Ablehnungen der Redaktionsfenster (WI-0291; Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“): Vorgang (Abschließen, Wiedereröffnen, Rückfrage,
 * Antworten, Zuständig, Archiv, Papierkorb, Korrektur und Kanal verknüpfen), Mails (Eingang, Archiv, Neue Mail) und die Bewertungen der Redaktion. Der Server schickt in `details.reason` einen
 * Fachcode (Sätze der Datenbank über `gruende-redaktion.ts` und `gruende-besucher.ts`, Sätze der Route über `routes/community.ts`); jeder Satz hier nennt den Grund UND was zu tun ist.
 *
 * - **Konflikt und Übergang** laden den Stand weiter neu (die Eingabe bleibt); der Satz sagt den genauen Grund und dass neu geladen ist (`redaktionSatz`).
 * - **Längen stehen hier als Zahl aus den Grenzen** (`COMMUNITY_GRENZEN`), nie fest im Satz der Sprachtafel, und gezählt wird in Codepunkten wie im Server (`codepunkte`), nicht in UTF-16.
 */

/** Wie der Server zählt (ajv und `char_length`): in Codepunkten. Ein Emoji ist EIN Zeichen, `text.length` zählte zwei. */
export const codepunkte = (text: string): number => [...text].length;

/** Wie viele Zeichen `text` über `max` liegt (nach dem Trimmen, wie der Rumpf es sendet); `0`, wenn es passt. */
export const zuViel = (text: string, max: number): number => Math.max(0, codepunkte(text.trim()) - max);

/** Die Felder, deren Länge ein Fenster vor dem Senden prüft. */
export type LaengeFeld = "begruendung" | "grund" | "nachricht" | "text" | "betreff" | "antwort" | "quelle";

const ZU_LANG: Readonly<Record<LaengeFeld, MessageKey>> = {
    begruendung: "community.redaktion.ablehnung.zuLangBegruendung",
    grund: "community.redaktion.ablehnung.zuLangGrund",
    nachricht: "community.redaktion.ablehnung.zuLangNachricht",
    text: "community.redaktion.ablehnung.zuLangText",
    betreff: "community.redaktion.ablehnung.zuLangBetreff",
    antwort: "community.redaktion.ablehnung.zuLangAntwort",
    quelle: "community.redaktion.ablehnung.zuLangQuelle",
};

/** „Die Begründung ist 12 Zeichen zu lang (höchstens 2000). …“ oder `undefined`, wenn der Text passt. */
export function zuLangSatz(feld: LaengeFeld, text: string, max: number): string | undefined {
    const n = zuViel(text, max);
    return n === 0 ? undefined : t(ZU_LANG[feld], { n, max });
}

// --- Die Sätze je Fachcode (`details.reason`) -----------------------------------------------------------------------------------------

const satz =
    (key: MessageKey): GrundSatz =>
    () =>
        t(key);

const RECHT: Readonly<Record<string, MessageKey>> = {
    moderate_community: "community.redaktion.ablehnung.rechtModerieren",
    moderate_submissions: "community.redaktion.ablehnung.rechtMeldungen",
    read_mailbox: "community.redaktion.ablehnung.rechtMails",
    answer_community: "community.redaktion.ablehnung.rechtAntworten",
    use_operator_channel: "community.redaktion.ablehnung.rechtKanal",
};

/** Die Gründe der Redaktion. Die Namen der Besucher (`vorgang_abgeschlossen`, `grund_fehlt`, `adresse_falsch`, `kategorie_unbekannt`, `beschreibung_laenge`, `bewertung_unbekannt`) sagen hier Entsprechendes. */
const GRUENDE: Readonly<Record<string, GrundSatz>> = {
    // Wer gleichzeitig arbeitet
    vorgang_geaendert: satz("community.redaktion.ablehnung.vorgangGeaendert"),
    bewertung_geaendert: satz("community.redaktion.ablehnung.bewertungGeaendert"),
    // Abschließen, Wiedereröffnen, Rückfrage, Übernehmen
    vorgang_abgeschlossen: satz("community.redaktion.ablehnung.schonAbgeschlossen"),
    erst_wieder_oeffnen: satz("community.redaktion.ablehnung.erstWiederOeffnen"),
    kein_rueckweg: satz("community.redaktion.ablehnung.keinRueckweg"),
    ergebnis_unzulaessig: satz("community.redaktion.ablehnung.ergebnisUnzulaessig"),
    begruendung_fehlt: satz("community.redaktion.ablehnung.begruendungFehlt"),
    dublette_angabe: () =>
        t("community.redaktion.ablehnung.dubletteAngabe", { ergebnis: t("community.ergebnis.dublette") }),
    dublette_nummer_ungueltig: satz("community.redaktion.ablehnung.dubletteNummer"),
    dublette_unbekannt: (details) =>
        t("community.redaktion.ablehnung.dubletteUnbekannt", { nummer: textAus(details, "nummer") ?? "?" }),
    dublette_selbst: satz("community.redaktion.ablehnung.dubletteSelbst"),
    nicht_abgeschlossen: satz("community.redaktion.ablehnung.nichtAbgeschlossen"),
    oeffnen_grund_fehlt: satz("community.redaktion.ablehnung.oeffnenGrundFehlt"),
    // Archiv, Papierkorb, Sichten
    archiv_nur_abgeschlossen: satz("community.redaktion.ablehnung.archivNurAbgeschlossen"),
    schon_im_papierkorb: satz("community.redaktion.ablehnung.schonImPapierkorb"),
    nicht_im_papierkorb: satz("community.redaktion.ablehnung.nichtImPapierkorb"),
    nur_neue_sichten: satz("community.redaktion.ablehnung.nurNeueSichten"),
    // Zuständig
    zustaendig_unmoeglich: (details) =>
        t(
            details["anfrage"] === true
                ? "community.redaktion.ablehnung.zustaendigAnfrage"
                : "community.redaktion.ablehnung.zustaendigMeldung",
        ),
    // Anfragen und Mails
    nur_anfragen: satz("community.redaktion.ablehnung.nurAnfragen"),
    schon_im_archiv: satz("community.redaktion.ablehnung.schonImArchiv"),
    nicht_im_archiv: satz("community.redaktion.ablehnung.nichtImArchiv"),
    erst_in_den_eingang: satz("community.redaktion.ablehnung.erstInDenEingang"),
    antwort_laenge: () => t("community.redaktion.ablehnung.antwortLaenge", { max: COMMUNITY_GRENZEN.nachrichtMax }),
    keine_adresse: satz("community.redaktion.ablehnung.keineAdresse"),
    anfrage_im_papierkorb: satz("community.redaktion.ablehnung.anfrageImPapierkorb"),
    weiter_antwort_zu_lang: () =>
        t("community.redaktion.ablehnung.zuLangAntwortHoechstens", { max: COMMUNITY_GRENZEN.nachrichtMax }),
    bezug_fehlt: satz("community.redaktion.ablehnung.bezugFehlt"),
    beschreibung_laenge: () =>
        t("community.redaktion.ablehnung.beschreibungLaenge", {
            min: COMMUNITY_GRENZEN.textMin,
            max: COMMUNITY_GRENZEN.textMax,
        }),
    kategorie_unbekannt: satz("community.redaktion.ablehnung.kategorieUnbekannt"),
    mail_unbekannt: satz("community.redaktion.ablehnung.mailUnbekannt"),
    mailweg_aus: satz("community.redaktion.ablehnung.mailwegAus"),
    // Neue Mail
    person_fehlt: satz("community.redaktion.ablehnung.personFehlt"),
    adresse_falsch: satz("community.redaktion.ablehnung.adresseFalsch"),
    betreff_ungueltig: () =>
        t("community.redaktion.ablehnung.betreffUngueltig", { max: COMMUNITY_GRENZEN.betreffNeuMax }),
    neue_mail_text_laenge: () =>
        t("community.redaktion.ablehnung.neueMailTextLaenge", { max: COMMUNITY_GRENZEN.nachrichtMax }),
    mail_tagesgrenze: () => t("community.redaktion.ablehnung.mailTagesgrenze", { n: COMMUNITY_GRENZEN.neueMailsJeTag }),
    // Korrektur und Kanal verknüpfen
    korrektur_kennung: satz("community.redaktion.ablehnung.korrekturKennung"),
    operation_unbekannt: satz("community.redaktion.ablehnung.operationUnbekannt"),
    kanal_nummer: satz("community.redaktion.ablehnung.kanalNummer"),
    verknuepfung_art: satz("community.redaktion.ablehnung.verknuepfungArt"),
    // Bewertungen der Redaktion
    bewertung_nur_neue: satz("community.redaktion.ablehnung.bewertungNurNeue"),
    bewertung_nicht_zurueckgehalten: satz("community.redaktion.ablehnung.bewertungNichtZurueckgehalten"),
    bewertung_schon_verborgen: satz("community.redaktion.ablehnung.bewertungSchonVerborgen"),
    bewertung_nicht_verborgen: satz("community.redaktion.ablehnung.bewertungNichtVerborgen"),
    bewertung_inhalt_nur_verborgen: satz("community.redaktion.ablehnung.bewertungInhaltNurVerborgen"),
    grund_fehlt: satz("community.redaktion.ablehnung.bewertungGrundFehlt"),
    bewertung_unbekannt: satz("community.redaktion.ablehnung.bewertungUnbekannt"),
    // Das Recht fehlt (403 `community_forbidden`): Welches, sagt der Server
    recht_fehlt: (details) => {
        const key = RECHT[textAus(details, "recht") ?? ""];
        return key === undefined ? undefined : t(key);
    },
};

// --- Felder eines Schemafehlers (`details.issues`) ------------------------------------------------------------------------------------

const nach =
    (regeln: Readonly<Record<string, () => string>>): FeldSatz =>
    (regel) =>
        regeln[regel]?.();

/** Die Grenzen, die je Fenster verschieden sind: `text` ist bei „Als Meldung weiterführen“ 10 bis 2000, sonst bis 4000. */
export interface FeldGrenzen {
    readonly textMax?: number;
    readonly nachrichtMax?: number;
}

/** Die Felder der Redaktion für die Rückfrage, wenn das Fenster seine Vorabprüfung nicht kannte oder eine Grenze sich ändert. */
function felder(grenzen: FeldGrenzen): Readonly<Record<string, FeldSatz>> {
    const textMax = grenzen.textMax ?? COMMUNITY_GRENZEN.nachrichtMax;
    const nachrichtMax = grenzen.nachrichtMax ?? COMMUNITY_GRENZEN.nachrichtMax;
    return {
        begruendung: nach({
            minLength: () => t("community.redaktion.ablehnung.begruendungFehlt"),
            maxLength: () =>
                t("community.redaktion.ablehnung.feldZuLang", {
                    feld: t("community.redaktion.ablehnung.feldBegruendung"),
                    max: COMMUNITY_GRENZEN.begruendungMax,
                }),
        }),
        grund: nach({
            minLength: () => t("community.redaktion.ablehnung.oeffnenGrundFehlt"),
            maxLength: () =>
                t("community.redaktion.ablehnung.feldZuLang", {
                    feld: t("community.redaktion.ablehnung.feldGrund"),
                    max: COMMUNITY_GRENZEN.begruendungMax,
                }),
        }),
        nachricht: nach({
            maxLength: () =>
                t("community.redaktion.ablehnung.feldZuLang", {
                    feld: t("community.redaktion.ablehnung.feldNachricht"),
                    max: nachrichtMax,
                }),
        }),
        text: nach({
            maxLength: () =>
                t("community.redaktion.ablehnung.feldZuLang", {
                    feld: t("community.redaktion.ablehnung.feldText"),
                    max: textMax,
                }),
        }),
        antwort: nach({
            maxLength: () =>
                t("community.redaktion.ablehnung.feldZuLang", {
                    feld: t("community.redaktion.ablehnung.feldAntwort"),
                    max: COMMUNITY_GRENZEN.nachrichtMax,
                }),
        }),
        betreff: nach({
            maxLength: () =>
                t("community.redaktion.ablehnung.betreffUngueltig", { max: COMMUNITY_GRENZEN.betreffNeuMax }),
        }),
        an: nach({ pattern: () => t("community.redaktion.ablehnung.adresseFalsch") }),
        dubletteVon: nach({ pattern: () => t("community.redaktion.ablehnung.dubletteNummer") }),
    };
}

/** Die Abbildung für `genauerGrund`; `grenzen` nur, wo ein Feld in einem Fenster eine andere Grenze hat. */
export const redaktionAbbildung = (grenzen: FeldGrenzen = {}): Abbildung => ({
    gruende: GRUENDE,
    felder: felder(grenzen),
});

/** Der genaue Grund eines Fehlers der Redaktion oder `undefined`. */
export const redaktionGrund = (fehler: unknown, grenzen: FeldGrenzen = {}): string | undefined =>
    genauerGrund(fehler, redaktionAbbildung(grenzen));

/** Der Fachcode `mailweg_aus`: Der Mailweg ist nicht (mehr) eingerichtet; das Fenster liest ihn dann neu. */
export const istMailwegAus = (fehler: unknown): boolean =>
    fehler instanceof ApiFailure && fehler.details?.["reason"] === "mailweg_aus";

/**
 * Der Satz zu einem Fehler der Redaktion, in dieser Reihenfolge: der genaue Grund; bei Konflikt und Übergang zusätzlich, dass der Stand neu geladen ist; sonst der allgemeine Satz zur Fehlerart
 * (`REDAKTION_FEHLER_SATZ`). `art` ist das Ergebnis von `redaktionFehler(fehler)`, wenn der Aufrufer es schon hat.
 */
export function redaktionSatz(
    fehler: unknown,
    grenzen: FeldGrenzen = {},
    art: RedaktionFehler = redaktionFehler(fehler),
): string {
    const grund = redaktionGrund(fehler, grenzen);
    if (grund === undefined) return t(REDAKTION_FEHLER_SATZ[art]);
    if (art === "konflikt") return t("community.redaktion.ablehnung.neuGeladenKonflikt", { grund });
    if (art === "uebergang") return t("community.redaktion.ablehnung.neuGeladen", { grund });
    return grund;
}
