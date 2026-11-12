import {
    KANAL_KATEGORIEN,
    KANAL_PRIORITAETEN,
    type AnKanalBody,
    type CommunityArt,
    type KanalKategorie,
    type KanalPrioritaet,
    type KorrekturKandidaten,
    type VorgangKorrektur,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import { vorgangName } from "../aenderungen/aenderung-vorgang";
import type { MessageKey } from "../i18n/de";
import { isMessageKey, t } from "../i18n/i18n";
import { bezugText, kategorieName, zeitAbstand } from "./meldungen-modell";
import { codepunkte } from "./redaktion-ablehnung";

/**
 * Das Modell der Verknüpfungen im Vorgangsfenster ohne Vue und ohne Browser (WI-0268 C7; Fachkonzept WI-0263 §6 und §7): die Zeilen des Kastens „Korrektur“, die Wahl im Blatt „Korrektur verknüpfen“
 * und der Entwurf des Blatts „An den Betreiber-Kanal weiterreichen“. Die Bauteile zeichnen nur, was hier steht (`test/community-verknuepfen.test.ts`).
 *
 * - 🔴 **Nichts vom Melder im Kanal:** Der Entwurf besteht aus der COM-Nummer, der Kategorie des Vorgangs und dem Namen seines Bezugs (ein Kartenobjekt oder „Stelle bei ‹Ort›“). Name, Adresse, Text,
 *   Quelle und Betreff des Melders kommen darin nicht vor; was die Person sonst schreibt, schreibt sie selbst.
 * - **Gesperrt heißt: ein Satz** (Guide §7, §13.19): Jede Sperre trägt ihren Grund.
 */

// --- Kasten „Korrektur“ ---------------------------------------------------------------------------------------------------------

/** Eine Zeile des Kastens „Korrektur“ oder eine Wahl im Blatt: Was geschah, wann, durch wen, und woher der Vorgang es weiß. */
export interface KorrekturZeile {
    readonly operationId: string;
    /** „Verschoben“, „Kurve geändert“ (der Name der Operation wie in „Änderungen“). */
    readonly titel: string;
    /** Der Satz der Operation („Gratenfels verschoben“), wenn er etwas anderes sagt als der Titel. */
    readonly satz: string | undefined;
    /** „vor 2 Std. · Olaf“; der Name fehlt bei Agent, Import und System. */
    readonly wann: string;
    /** `aus dem Editor` oder `von Hand verknüpft`; nur im Kasten, nicht in der Wahl. */
    readonly weg: string | undefined;
}

type KorrekturQuelle = Pick<VorgangKorrektur, "operationId" | "aktion" | "zusammenfassung" | "at" | "von"> & {
    readonly weg?: VorgangKorrektur["weg"] | undefined;
};

const WEG_SATZ: Readonly<Record<VorgangKorrektur["weg"], MessageKey>> = {
    editor: "community.korrektur.weg.editor",
    hand: "community.korrektur.weg.hand",
};

export function korrekturZeile(korrektur: KorrekturQuelle, jetzt: Date = new Date()): KorrekturZeile {
    const titel = vorgangName(korrektur.aktion);
    const satz = korrektur.zusammenfassung?.trim();
    const name = korrektur.von?.name.trim();
    return {
        operationId: korrektur.operationId,
        titel,
        satz: satz === undefined || satz === "" || satz === titel ? undefined : satz,
        wann: [zeitAbstand(korrektur.at, jetzt), ...(name === undefined || name === "" ? [] : [name])].join(" · "),
        weg: korrektur.weg === undefined ? undefined : t(WEG_SATZ[korrektur.weg]),
    };
}

/** Darf der Verweis in „Änderungen“ führen? Dafür braucht es das Editorpanel (`use_editor_menu`) und eine Seite, die es hat. */
export const darfInAenderungen = (rechte: readonly string[], verbunden: boolean): boolean =>
    verbunden && rechte.includes("use_editor_menu");

/** Darf der Verweis den Betreiber-Kanal öffnen? Nur wer den Kanal benutzen darf. */
export const darfInKanal = (rechte: readonly string[]): boolean => rechte.includes("use_operator_channel");

// --- Blatt „Korrektur verknüpfen“ -------------------------------------------------------------------------------------------------

/** Der Satz über der Liste: woher die Wahl kommt (Bezugsobjekt oder eigene Sitzung). */
export const kandidatenKopf = (quelle: KorrekturKandidaten["quelle"]): MessageKey =>
    quelle === "objekt" ? "community.verknuepfen.korrektur.kopfObjekt" : "community.verknuepfen.korrektur.kopfSitzung";

/** Der Satz, wenn es nichts zu wählen gibt. */
export const kandidatenLeer = (quelle: KorrekturKandidaten["quelle"]): MessageKey =>
    quelle === "objekt" ? "community.verknuepfen.korrektur.leerObjekt" : "community.verknuepfen.korrektur.leerSitzung";

/** Warum „Verknüpfen“ gesperrt ist (oder `undefined`). */
export const korrekturSperre = (gewaehlt: string | undefined): MessageKey | undefined =>
    gewaehlt === undefined ? "community.verknuepfen.korrektur.sperre.waehlen" : undefined;

/** Der Fehlersatz im Blatt: Ein 404 sagt hier, dass es die Änderung nicht gibt (der Vorgang steht ja vor einem). */
export const korrekturFehlerSatz = (fehler: MessageKey): MessageKey =>
    fehler === "community.redaktion.fehler.nichtGefunden" ? "community.verknuepfen.fehler.operation" : fehler;

// --- Blatt „An den Betreiber-Kanal weiterreichen“ ---------------------------------------------------------------------------------

/** Die Länge des Titels im Kanal (`AnKanalBody`). */
export const KANAL_TITEL_MAX = 120;
export const KANAL_NACHRICHT_MAX = 8000;

export interface KanalEntwurf {
    kategorie: KanalKategorie;
    prioritaet: KanalPrioritaet;
    titel: string;
    nachricht: string;
}

/**
 * Welche Kategorie des Kanals zu einem Vorgang passt: Eine Meldung betrifft Karteninhalt, eine Anfrage ist eine Nutzerfrage. Die Person kann sie ändern.
 * (Der Kanal gibt Karteninhalt zuerst an Claudia, die übrigen Kategorien an Claudio.)
 */
export const kanalKategorieFuer = (art: CommunityArt): KanalKategorie =>
    art === "anfrage" ? "nutzerfrage" : "karteninhalt";

/** „COM-000123 · Lage falsch · Wehrheim“; höchstens 120 Zeichen. */
export function kanalTitel(
    zeile: Pick<VorgangZeile, "nummer" | "kategorie" | "bezugArt" | "bezugName" | "art">,
): string {
    // Eine Anfrage hat keinen Bezug (ihr Betreff stammt vom Absender und gehört nicht in den Kanal).
    const bezug = zeile.art === "anfrage" ? undefined : bezugText(zeile);
    const titel = [zeile.nummer, kategorieName(zeile.kategorie), ...(bezug === undefined ? [] : [bezug])].join(" · ");
    return titel.length <= KANAL_TITEL_MAX ? titel : `${titel.slice(0, KANAL_TITEL_MAX - 1)}…`;
}

/** „Aus Community-Vorgang COM-000123.“, bei einem Bezug eine zweite Zeile „Bezug: Wehrheim.“ */
export function kanalVorlage(zeile: Pick<VorgangZeile, "nummer" | "bezugArt" | "bezugName" | "art">): string {
    const bezug = zeile.art === "anfrage" ? undefined : bezugText(zeile);
    const erste = t("community.kanal.vorlage", { nummer: zeile.nummer });
    return bezug === undefined ? erste : `${erste}\n${t("community.kanal.vorlageBezug", { bezug })}`;
}

export function neuerKanalEntwurf(
    zeile: Pick<VorgangZeile, "nummer" | "kategorie" | "bezugArt" | "bezugName" | "art" | "prioritaet">,
): KanalEntwurf {
    return {
        kategorie: kanalKategorieFuer(zeile.art),
        prioritaet: zeile.prioritaet,
        titel: kanalTitel(zeile),
        nachricht: kanalVorlage(zeile),
    };
}

/** Hat jemand am Entwurf etwas geändert, das beim Schließen verloren ginge? */
export const kanalHatEntwurf = (entwurf: KanalEntwurf, anfang: KanalEntwurf): boolean =>
    entwurf.kategorie !== anfang.kategorie ||
    entwurf.prioritaet !== anfang.prioritaet ||
    entwurf.titel !== anfang.titel ||
    entwurf.nachricht !== anfang.nachricht;

/** Warum „Weiterreichen“ gesperrt ist (oder `undefined`). */
export function kanalSperre(entwurf: KanalEntwurf): MessageKey | undefined {
    if (entwurf.titel.trim() === "") return "community.kanal.sperre.titel";
    // WI-0291: Codepunkte wie im Server (ajv), nicht UTF-16.
    if (codepunkte(entwurf.titel.trim()) > KANAL_TITEL_MAX) return "community.kanal.sperre.titelLang";
    if (entwurf.nachricht.trim() === "") return "community.kanal.sperre.nachricht";
    if (codepunkte(entwurf.nachricht.trim()) > KANAL_NACHRICHT_MAX) return "community.kanal.sperre.nachrichtLang";
    return undefined;
}

/** Was an den Server geht (ohne `operationId`, die trägt die Handlung). */
export const kanalBody = (entwurf: KanalEntwurf): Omit<AnKanalBody, "operationId"> => ({
    kategorie: entwurf.kategorie,
    prioritaet: entwurf.prioritaet,
    titel: entwurf.titel.trim(),
    nachricht: entwurf.nachricht.trim(),
});

/** Die Wahl der Kategorien und Prioritäten, mit den Wörtern des Kanals (`kanal.kategorie.*`, `kanal.prioritaet.*`). */
const wort = (schluessel: string, rueckfall: string): string => (isMessageKey(schluessel) ? t(schluessel) : rueckfall);
export const kanalKategorien = (): { wert: KanalKategorie; text: string }[] =>
    KANAL_KATEGORIEN.map((wert) => ({ wert, text: wort(`kanal.kategorie.${wert}`, wert) }));
export const kanalPrioritaeten = (): { wert: KanalPrioritaet; text: string }[] =>
    KANAL_PRIORITAETEN.map((wert) => ({ wert, text: wort(`kanal.prioritaet.${wert}`, wert) }));

/** Der Fehlersatz im Blatt: Die Drossel des Kanals ist keine der Meldungen („Gerade sind zu viele Meldungen eingegangen“ hätte hier keinen Sinn). */
export const kanalFehlerSatz = (fehler: MessageKey): MessageKey =>
    fehler === "community.fehler.zuViele" ? "community.kanal.fehler.zuViele" : fehler;
