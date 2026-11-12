import type { MediaGalleryDetail, MediaHeaderRelationBody, MediaImageRelation, MediaUsage } from "@avesmaps3d/shared";

/**
 * Der Bildbezug EINER Verwendung im Inspector „Verwendungen“ (WI-0068, Betreiber 2026-10-11, „1A … 2 B … 3 A ja das gilt für alle“;
 * Operation `header.relation`, `apps/server/src/media-editor/header-relation.ts`).
 *
 * Reine Funktionen, damit Vitest sie ohne Browser prüft; das Bauteil liest und schreibt nur über sie.
 *
 * - **Nur am Titelbild eines Ortes.** Jede andere Verwendung (Wappen, Buchumschlag, Karte, Galerie ohne Ort) hat keinen Bildbezug;
 *   der Server setzt das Feld dort nie, und die Oberfläche bietet nichts an.
 * - **Drei Stellungen, nicht zwei:** „nach der Regel“ (keine Übersteuerung), „Ortsansicht“ und „Typbild“. Die Regel zurückzugeben ist
 *   eine eigene Handlung — sonst bliebe eine einmal gesetzte Übersteuerung für immer stehen, auch wenn die Datei später an einem
 *   anderen Ort auftaucht.
 * - 🔴 **Die `baseRevision` kommt je Weg aus einer ANDEREN Quelle** (Vertrag `MediaHeaderRelationBody`): bei einem Galerieeintrag die
 *   Revision der GALERIE, bei einer direkten Bindung die der Bindung. Die Verwendung selbst trägt nur die Revision des Eintrags; die
 *   der Galerie kommt aus den geladenen Galerien des Inspectors. Fehlt sie, ist der Schalter gesperrt statt mit einer falschen
 *   Revision zu senden — ein Konflikt, den niemand verursacht hat, ist schlimmer als ein gesperrter Knopf.
 */

/** Die Stellung des Schalters: die Regel oder eine der beiden Übersteuerungen. */
export const BILDBEZUG_STELLUNGEN = ["regel", "place_view", "type_image"] as const;
export type BildbezugStellung = (typeof BILDBEZUG_STELLUNGEN)[number];

export interface BildbezugZeile {
    /** Was gerade gilt (Regel oder Übersteuerung). */
    gilt: MediaImageRelation;
    /** Was die Regel allein sagt. */
    regel: MediaImageRelation;
    /** Die Stellung des Schalters. */
    stellung: BildbezugStellung;
    /** An wie vielen aktiven Orten dieselbe Datei als Titelbild hängt (die Begründung der Regel). */
    orte: number;
    /** Der Umschlag für die Operation; `undefined`, wenn er nicht sicher gebildet werden kann. */
    anfrage: BildbezugAnfrage | undefined;
}

/**
 * Was die Operation braucht, ohne Kennung und Wert. `via` ist hier PFLICHT, obwohl der Vertrag es optional führt: Der Vertrag
 * lässt es weg, wenn es nur eine Verwendung gibt — die Oberfläche kennt die Verwendung aber genau und soll sie benennen, statt
 * den Server raten zu lassen.
 */
export interface BildbezugAnfrage {
    placeId: string;
    assetId: string;
    via: NonNullable<MediaHeaderRelationBody["via"]>;
    baseRevision: number;
}

/** Trägt diese Verwendung überhaupt einen Bildbezug? Nur das Titelbild eines Ortes. */
export function hatBildbezug(usage: MediaUsage): boolean {
    return usage.relation !== undefined && usage.subject !== null && usage.subject.kind === "place";
}

/**
 * Die Zeile zu einer Verwendung, oder `undefined`, wo es keinen Bildbezug gibt. `galerien` sind die vom Inspector geladenen
 * Galerien des Assets; aus ihnen kommt die Revision der Galerie.
 */
export function bildbezugZeile(
    usage: MediaUsage,
    assetId: string,
    galerien: readonly MediaGalleryDetail[],
): BildbezugZeile | undefined {
    const relation = usage.relation;
    if (relation === undefined || usage.subject === null || usage.subject.kind !== "place") return undefined;
    // Ein Typbild (★) hat kein Fachobjekt und damit keinen Bildbezug; der Zweig steht nur für die Typen.
    if (usage.via === "type_image") return undefined;
    const basis =
        usage.via === "gallery"
            ? galerien.find((galerie) => galerie.id === usage.gallery?.id)?.revision
            : usage.revision;
    return {
        gilt: relation.value,
        regel: relation.rule,
        stellung: relation.override ?? "regel",
        orte: relation.places,
        anfrage:
            basis === undefined
                ? undefined
                : { placeId: usage.subject.id, assetId, via: usage.via, baseRevision: basis },
    };
}

/** Der Wert, den die Operation bekommt: `null` gibt die Regel zurück. */
export function bezugWert(stellung: BildbezugStellung): MediaImageRelation | null {
    return stellung === "regel" ? null : stellung;
}

/**
 * Der Satz unter dem Schalter: was gilt, warum, und ob ein Mensch es gesetzt hat. `text` liefert der Aufrufer aus den Sprachtafeln
 * (dieses Modell kennt keine Wörter), `schluessel` ist der Fall.
 */
export function bildbezugSatz(zeile: BildbezugZeile): {
    schluessel: "regelEinOrt" | "regelMehrereOrte" | "regelOhneDatei" | "ueberschrieben";
    orte: number;
} {
    if (zeile.stellung !== "regel") return { schluessel: "ueberschrieben", orte: zeile.orte };
    // Die Regel: dieselbe DATEI an genau einem aktiven Ort ist Ortsansicht, sonst Typbild. Ohne Quelldatei gibt es keine
    // Identität - dann ist es Typbild, und `places` ist 0 (ein Ort, der die Datei hält, wäre mindestens 1).
    if (zeile.orte === 0) return { schluessel: "regelOhneDatei", orte: 0 };
    return { schluessel: zeile.orte === 1 ? "regelEinOrt" : "regelMehrereOrte", orte: zeile.orte };
}
