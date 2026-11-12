import {
    quellenWikiNormal,
    type InhalteTraegerQuelle,
    type InhalteTraegerQuellen,
    type InhalteTraegerQuellenAenderung,
    type InhalteTraegerQuellenBody,
    type InhalteTraegerQuellenGrund,
    type InhalteTraegerQuellenVorher,
    type SourceReferenceKind,
} from "@avesmaps3d/shared";
import { wikiKlartext } from "../inhalte/wiki-klartext";
import type { ApiFehler } from "./entwurf-senden";
import { wikiKreis, type KlappQuelle } from "./quellen-klappbox-modell";

/**
 * Die Rechnung der Quellen eines Kartenobjekts in den Editoren (Orte, Herrschaftsgebiete, Landschaften, Wege; WI-0254 §12) ohne Vue: aus der Antwort des Servers (`GET …/traeger/:kind/:id/quellen`) die Zeilen der
 * Klappbox (`quellen-klappbox.vue`) und aus einer Handlung der Oberfläche genau EINE Änderung für den Schreibweg (`POST …`, `traeger.sources`). Betreiber 2026-10-28: **sofort speichern**, kein
 * Speichern-Knopf und kein Entwurf; darum ist jede Handlung ein Schreiben mit einer Änderung, und `vorher` ist, was die Oberfläche zuletzt von dieser Verknüpfung las.
 *
 * - **Zeile:** Art, Seiten, Notiz und der Kreis kommen vom gespeicherten Stand; was gerade im Feld getippt wird (`Eingabe`), überlagert nur die Anzeige. Der Kreis springt also nicht beim Tippen,
 *   sondern mit dem Speichern (er vergleicht, was gespeichert ist, mit dem Wiki: `wikiKreis`).
 * - **Notiz:** Sie kommt roh aus dem Wiki (Vorlagen wie `{{R5}}`) und steht als Text im Feld (`wikiKlartext`). Wer nichts am Text ändert, ändert nichts: Der Rohwert bleibt gespeichert (`feldGeaendert`);
 *   wer ihn ändert, speichert, was er tippt.
 * - **Fehler:** 409 `edit_conflict` heißt: Jemand war schneller (der Stand wird neu gelesen, die Eingabe bleibt im Feld, wer und wann steht im Satz); alles andere (403, 423, 503, 400, kein Netz) hat den Satz
 *   des Servers, wie im Ortseditor.
 */

/** Was in den Feldern einer Zeile steht, aber noch nicht gespeichert ist (Fundstelle, Notiz; die Art speichert beim Wählen). */
export interface Eingabe {
    seiten?: string;
    notiz?: string;
}

/** Die Notiz, wie das Feld sie zeigt: der Text statt der Vorlagen des Wikis. */
export const notizAnzeige = (quelle: Pick<InhalteTraegerQuelle, "note">): string => wikiKlartext(quelle.note ?? "");

/** Was die Zeile braucht, das nicht in der Antwort des Servers steht. */
export interface ZeilenKontext {
    /** Gibt es einen Lauf des WikiSync mit Zitaten? (`wiki` oben in der Antwort ist nicht `null`.) */
    readonly lauf: boolean;
    readonly eingabe: Eingabe | undefined;
    readonly schreibt: boolean;
    readonly fehler: string | undefined;
}

/** Eine Quelle des Objekts in der Form der Klappbox. */
export function quelleAlsKlapp(quelle: InhalteTraegerQuelle, kontext: ZeilenKontext): KlappQuelle {
    return {
        id: quelle.sourceId,
        titel: quelle.title,
        art: quelle.referenceKind,
        seiten: kontext.eingabe?.seiten ?? quelle.pages ?? "",
        notiz: kontext.eingabe?.notiz ?? notizAnzeige(quelle),
        typ: quelle.sourceType,
        offiziell: quelle.offiziell,
        url: quelle.url,
        kreis: wikiKreis({
            state: quelle.state,
            lauf: kontext.lauf,
            art: quelle.referenceKind,
            seiten: quelle.pages,
            notiz: quelle.note,
            wiki: quelle.wiki,
            abschnitteGleich: quelle.abschnitte?.gleichDemWiki,
        }),
        state: quelle.state,
        neu: false,
        wiki:
            quelle.wiki === null
                ? null
                : { art: quelle.wiki.art, seiten: quelle.wiki.seiten ?? "", notiz: quelle.wiki.notiz ?? "" },
        schreibt: kontext.schreibt,
        fehler: kontext.fehler,
        korpus: quelle.korpus?.label ?? null,
    };
}

/** Die Zahl der aktiven Quellen (die im Reitertitel „Quellen (n)“). */
export const aktiveZahl = (daten: Pick<InhalteTraegerQuellen, "quellen">): number =>
    daten.quellen.filter((quelle) => quelle.state === "active").length;

// --- Handlungen und Änderungen ---

/** Was jemand an einer Quelle tut; jede Handlung ist ein Schreiben. */
export type Handlung =
    | { readonly art: "anhaengen" }
    | { readonly art: "art"; readonly referenceKind: SourceReferenceKind | null }
    | { readonly art: "seiten"; readonly wert: string }
    | { readonly art: "notiz"; readonly wert: string }
    | { readonly art: "loesen" }
    | { readonly art: "holen" }
    | { readonly art: "wikiWert" }
    /** Alle drei Angaben auf einmal (die Umkehrung im Verlauf, `quellen-verlauf-modell.ts`); `null` leert. */
    | {
          readonly art: "angaben";
          readonly referenceKind: SourceReferenceKind | null;
          readonly seiten: string | null;
          readonly notiz: string | null;
      };

/** Was die Oberfläche von der Verknüpfung sah (`null`: es gab keine). `pages` und `note` ohne Leerraum an den Rändern, leer ist `null`. */
export const vorherAus = (quelle: InhalteTraegerQuelle | undefined): InhalteTraegerQuellenVorher | null =>
    quelle === undefined
        ? null
        : {
              state: quelle.state,
              referenceKind: quelle.referenceKind,
              pages: quellenWikiNormal(quelle.pages),
              note: quellenWikiNormal(quelle.note),
          };

/**
 * Die eine Änderung zu einer Handlung, gegen den zuletzt gelesenen Stand der Verknüpfung (`aktuell`; `undefined`: die Oberfläche kennt sie nicht, sie wird neu angehängt). `undefined`, wo es nichts
 * zu schreiben gibt: „Wiki-Wert“ an einer Quelle, die das Wiki nicht zitiert, oder eine Änderung an einer Quelle, die nicht (mehr) da ist.
 */
export function baueAenderung(
    sourceId: string,
    handlung: Handlung,
    aktuell: InhalteTraegerQuelle | undefined,
): InhalteTraegerQuellenAenderung | undefined {
    const vorher = vorherAus(aktuell);
    switch (handlung.art) {
        case "anhaengen":
            return { op: "add", sourceId, vorher };
        case "loesen":
            return aktuell === undefined ? undefined : { op: "remove", sourceId, vorher };
        case "holen":
            return aktuell === undefined ? undefined : { op: "restore", sourceId, vorher };
        case "art":
            return aktuell === undefined
                ? undefined
                : { op: "update", sourceId, vorher, referenceKind: handlung.referenceKind };
        case "seiten":
            return aktuell === undefined
                ? undefined
                : { op: "update", sourceId, vorher, pages: quellenWikiNormal(handlung.wert) };
        case "notiz":
            return aktuell === undefined
                ? undefined
                : { op: "update", sourceId, vorher, note: quellenWikiNormal(handlung.wert) };
        case "angaben":
            return aktuell === undefined
                ? undefined
                : {
                      op: "update",
                      sourceId,
                      vorher,
                      referenceKind: handlung.referenceKind,
                      pages: quellenWikiNormal(handlung.seiten),
                      note: quellenWikiNormal(handlung.notiz),
                  };
        case "wikiWert":
            return aktuell === undefined || aktuell.wiki === null
                ? undefined
                : {
                      op: "update",
                      sourceId,
                      vorher,
                      referenceKind: aktuell.wiki.art,
                      pages: quellenWikiNormal(aktuell.wiki.seiten),
                      note: quellenWikiNormal(aktuell.wiki.notiz),
                  };
    }
}

/** Der Körper des Schreibwegs mit der einen Änderung. */
export const baueBody = (
    operationId: string,
    aenderung: InhalteTraegerQuellenAenderung,
): InhalteTraegerQuellenBody => ({
    operationId,
    aenderungen: [aenderung],
});

/**
 * Hat jemand das Feld gegenüber dem gespeicherten Stand geändert? Nur dann wird geschrieben. Die Fundstelle vergleicht nach dem Kürzen; die Notiz gegen den Text, den das Feld zeigte (nicht gegen den Rohwert
 * mit den Vorlagen des Wikis): Wer nur hineinklickt und herausgeht, überschreibt die Vorlage nie mit ihrem Klartext.
 */
export function feldGeaendert(quelle: InhalteTraegerQuelle, feld: "seiten" | "notiz", wert: string): boolean {
    return feld === "seiten"
        ? quellenWikiNormal(wert) !== quellenWikiNormal(quelle.pages)
        : quellenWikiNormal(wert) !== quellenWikiNormal(notizAnzeige(quelle));
}

// --- Fehler ---

/** Was an einer Zeile (oder beim Anhängen) schiefging. */
export type ZeilenFehler =
    | { readonly art: "konflikt"; readonly wer: string | undefined; readonly wann: string | undefined }
    | { readonly art: "satz"; readonly satz: string };

/** Der Fehler des Schreibwegs: 409 `edit_conflict` mit wer und wann (soweit der Server es weiß), alles andere mit dem Satz des Servers. */
export function fehlerAus(status: number, fehler: ApiFehler): ZeilenFehler {
    if (status === 409 && fehler.code === "edit_conflict") {
        const details = fehler.details as { changedBy?: { displayName?: string }; changedAt?: string } | undefined;
        return { art: "konflikt", wer: details?.changedBy?.displayName, wann: details?.changedAt };
    }
    return { art: "satz", satz: fehler.message };
}

// --- Darf man schreiben? ---

/** Warum die Quellen sich nicht ändern lassen: das Recht fehlt, der Editor schreibt gerade nicht, oder der Server sagt es (stilles Objekt, auch eine Straße, die nicht auf der Karte ist). `undefined`: es geht. */
export type LeseGrund = "recht" | "bearbeiten" | InhalteTraegerQuellenGrund | undefined;

/**
 * Bearbeitbar nur mit dem Recht `manage_sources` UND dem Schreibrecht des Editors (wie er heute entscheidet, ob er speichern darf: Recht, `MAP_EDITING`) UND wenn der Server das Objekt `aenderbar` nennt.
 * Solange nichts gelesen ist (`daten` fehlt), nennt es keinen Grund der Antwort.
 */
export function leseGrund(
    recht: boolean,
    schreibt: boolean,
    daten: Pick<InhalteTraegerQuellen, "aenderbar" | "grund"> | undefined,
): LeseGrund {
    if (!recht) return "recht";
    if (!schreibt) return "bearbeiten";
    if (daten === undefined || daten.aenderbar) return undefined;
    return daten.grund ?? "still";
}
