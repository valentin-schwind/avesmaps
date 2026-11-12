import {
    UNCLEAR_CLEARANCE,
    validateMediaCreation,
    validateMediaEvidence,
    validateMediaRights,
    type MediaAssetDetail,
    type MediaCreationBody,
    type MediaCreationFields,
    type MediaEvidenceInput,
    type MediaFileUpload,
    type MediaFormIssue,
    type MediaLicenseInfo,
    type MediaMetadataBody,
    type MediaReviewDecision,
    type MediaRightsBody,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import {
    belegEingabe,
    rechteFelder,
    type BelegStand,
    type EntstehungStand,
    type RechteStand,
} from "./medien-formular-modell";
import { pruefstandName } from "./medien-text";

/**
 * Was die Kästen des Inspectors beim Bearbeiten rechnen (WI-0068 P4b, Blatt 1, Betreiber 2026-10-10: „jeden Kasten einzeln (A)“). Je
 * Kasten ein Stand aus dem Detail und eine Anfrage an die P4a-Route, nur mit dem, was sich geändert hat. Reine Funktionen, damit Vitest
 * sie ohne Browser prüft; die Kennung der Handlung (`operationId`) setzt die Oberfläche (`Handlung`).
 *
 * - **Eigenschaften:** „Name in der Liste“ (`…/metadata`, `baseRevision` des Assets). Leer heißt „kein eigener Name“ (`null`): Die Liste
 *   zeigt dann den Namen aus dem Objekt.
 * - **Entstehung:** die Art (`…/metadata`) und Werkzeug, Modell, Prompt (`…/creation`, `baseRevision` der Entstehung). Ändert sich beides,
 *   sind es zwei Anfragen in der Reihenfolge, die der Server annimmt: Wird das Bild KI-erzeugt, erst die Art, dann der Prompt; hört es auf,
 *   KI-erzeugt zu sein, erst der Prompt (geleert), dann die Art.
 * - **Rechte:** alle Felder (`…/rights`, `baseRevision` der Rechte). Ändern sich Grundlage oder Lizenz, fällt eine Prüfung zurück; das sagt
 *   der Kasten vorher (`pruefungFaelltZurueck`).
 * - **Prüfung:** drei Entscheide (`…/rights/review`), nur mit `review_media_rights`, auch am eigenen Hochgeladenen (WI-0282).
 * - **Beleg:** anhängen (`…/evidence`), ohne Revision.
 */

const ohneLeer = (wert: string | null | undefined): string | null =>
    wert === null || wert === undefined || wert.trim() === "" ? null : wert.trim();

// --- Eigenschaften ---

export function nameAus(detail: MediaAssetDetail): string {
    return detail.asset.title ?? "";
}

/** Die Anfrage für den Namen; `undefined`, wenn er gleich blieb. */
export function nameAnfrage(
    detail: MediaAssetDetail,
    name: string,
): Omit<MediaMetadataBody, "operationId"> | undefined {
    const neu = ohneLeer(name);
    if (neu === ohneLeer(detail.asset.title)) return undefined;
    return { baseRevision: detail.asset.revision, title: neu };
}

// --- Entstehung ---

export function entstehungAus(detail: MediaAssetDetail): EntstehungStand {
    return {
        art: detail.asset.creationMethod,
        werkzeug: detail.creation?.tool ?? "",
        modell: detail.creation?.model ?? "",
        prompt: detail.creation?.prompt ?? "",
        negativPrompt: detail.creation?.negativePrompt ?? "",
    };
}

/** Werkzeug, Modell und Prompt als Vertrag, jedes Feld gesetzt (geleert ist `null`); Prompts nur bei KI-erzeugt. */
function entstehungsFelder(stand: EntstehungStand): Required<MediaCreationFields> {
    const ki = stand.art === "ai_generated";
    return {
        tool: ohneLeer(stand.werkzeug),
        model: ohneLeer(stand.modell),
        prompt: ki ? ohneLeer(stand.prompt) : null,
        negativePrompt: ki ? ohneLeer(stand.negativPrompt) : null,
    };
}

export type EntstehungsSchritt =
    | { route: "metadata"; body: Omit<MediaMetadataBody, "operationId"> }
    | { route: "creation"; body: Omit<MediaCreationBody, "operationId"> };

/**
 * Die Anfragen des Kastens „Entstehung“ in der Reihenfolge, in der sie gesendet werden; leer, wenn sich nichts geändert hat. Die zweite
 * trägt die Revision, die die erste hinterlässt: Die Art ändert die Revision des Assets, nicht die der Entstehung, und umgekehrt.
 */
export function entstehungsSchritte(detail: MediaAssetDetail, stand: EntstehungStand): EntstehungsSchritt[] {
    const vorher = entstehungsFelder(entstehungAus(detail));
    const nachher = entstehungsFelder(stand);
    const felderAnders = (Object.keys(nachher) as (keyof typeof nachher)[]).some(
        (feld) => vorher[feld] !== nachher[feld],
    );
    const artAnders = stand.art !== detail.asset.creationMethod;
    const art: EntstehungsSchritt = {
        route: "metadata",
        body: { baseRevision: detail.asset.revision, creationMethod: stand.art },
    };
    const felder: EntstehungsSchritt = {
        route: "creation",
        body: {
            ...(detail.creation === null ? {} : { baseRevision: detail.creation.revision }),
            creation: nachher,
        },
    };
    if (!artAnders) return felderAnders ? [felder] : [];
    if (!felderAnders) return [art];
    // Wird es KI-erzeugt, nimmt der Server den Prompt erst danach an; hört es auf, muss der Prompt vorher weg.
    return stand.art === "ai_generated" ? [art, felder] : [felder, art];
}

export function entstehungsBefunde(stand: EntstehungStand): MediaFormIssue[] {
    return validateMediaCreation(stand.art, entstehungsFelder(stand));
}

// --- Rechte ---

export function rechteAus(detail: MediaAssetDetail): RechteStand {
    const rechte = detail.rights;
    return {
        grundlage: rechte?.basis ?? "",
        lizenz: rechte?.licenseKey ?? "",
        urheber: rechte?.creator ?? "",
        rechteinhaber: rechte?.rightsHolder ?? "",
        namensnennung: rechte?.attribution ?? "",
        rechtenotiz: rechte?.rightsNote ?? "",
    };
}

export interface RechteAnfrage {
    body: Omit<MediaRightsBody, "operationId"> | undefined;
    befunde: MediaFormIssue[];
}

/** Die Anfrage für die Rechte samt Befunden vor dem Senden; `body` fehlt, wenn nichts geändert ist oder ein Befund im Weg steht. */
export function rechteAnfrage(
    detail: MediaAssetDetail,
    stand: RechteStand,
    lizenzen: readonly MediaLicenseInfo[],
): RechteAnfrage {
    const felder = rechteFelder(stand);
    if (felder === undefined) return { body: undefined, befunde: [{ path: "rights.basis", rule: "required" }] };
    const befunde = validateMediaRights(felder, lizenzen);
    const vorher = rechteFelder(rechteAus(detail));
    const gleich =
        vorher !== undefined &&
        (Object.keys(felder) as (keyof typeof felder)[]).every(
            (feld) => (vorher[feld] ?? null) === (felder[feld] ?? null),
        );
    if (gleich || befunde.length > 0) return { body: undefined, befunde };
    return {
        body: { ...(detail.rights === null ? {} : { baseRevision: detail.rights.revision }), rights: felder },
        befunde,
    };
}

/** Fällt mit dem Speichern eine Prüfung zurück? Ja, wenn Grundlage oder Lizenz anders sind und schon geprüft oder eingestuft war. */
export function pruefungFaelltZurueck(detail: MediaAssetDetail, stand: RechteStand): boolean {
    const rechte = detail.rights;
    if (rechte === null || rechte.clearance === "unreviewed") return false;
    const lizenz = stand.grundlage === "license" ? ohneLeer(stand.lizenz) : null;
    return stand.grundlage !== rechte.basis || lizenz !== rechte.licenseKey;
}

// --- Prüfung ---

export interface PruefungsLage {
    /** Warum die drei Entscheide gesperrt sind; `undefined`: Sie stehen offen. */
    gesperrt: string | undefined;
    /** Der Stand in Worten („offen · noch nie geprüft“, „geprüft am …“). */
    stand: string;
}

export function pruefungsLage(
    detail: MediaAssetDetail,
    kannPruefen: boolean,
    datum: (iso: string) => string,
): PruefungsLage {
    const rechte = detail.rights;
    const stand =
        rechte === null
            ? t("medien.bearbeiten.pruefungOhneRechte")
            : rechte.reviewedAt === null
              ? t("medien.bearbeiten.pruefungNie", { stand: pruefstandName(rechte.clearance) })
              : // „Erneut zur Prüfung“ ist kein „geprüft am“ (OPS-000101): Die Zeile sagt, wann es zurückging.
                t(
                    rechte.clearance === "needs_review"
                        ? "medien.bearbeiten.pruefungErneutAm"
                        : "medien.bearbeiten.pruefungAm",
                    {
                        stand: pruefstandName(rechte.clearance),
                        am: datum(rechte.reviewedAt),
                    },
                );
    if (rechte === null) return { gesperrt: t("medien.bearbeiten.pruefungOhneRechte"), stand };
    if (!kannPruefen) return { gesperrt: t("medien.bearbeiten.pruefungRecht"), stand };
    return { gesperrt: undefined, stand };
}

export const PRUEF_ENTSCHEIDE: readonly MediaReviewDecision[] = ["cleared", "rejected", "needs_review"];

/**
 * Steht der Entscheid im Kasten „Rechte“ (OPS-000101)? „Geprüft“ und „abgelehnt“ immer; „Erneut zur Prüfung“ nur, wo ein Entscheid gilt (`cleared`, `rejected`,
 * `legacy_asserted`): An einem Bild, das ohnehin als ungeklärt zählt (`UNCLEAR_CLEARANCE`), änderte er nichts Sichtbares.
 */
export function zeigeEntscheid(detail: Pick<MediaAssetDetail, "rights">, entscheid: MediaReviewDecision): boolean {
    if (entscheid !== "needs_review") return true;
    const stand = detail.rights?.clearance;
    return stand !== undefined && !(UNCLEAR_CLEARANCE as readonly string[]).includes(stand);
}

// --- Beleg ---

export function leererBeleg(): BelegStand {
    return { art: "", text: "", adresse: "", datei: undefined };
}

/** Der Beleg als Vertrag samt Befunden; die Datei kommt beim Senden als Base64 dazu. */
export function belegAnfrage(
    stand: BelegStand,
    datei?: MediaFileUpload,
): { evidence: MediaEvidenceInput | undefined; befunde: MediaFormIssue[] } {
    const evidence = belegEingabe(stand, datei);
    if (evidence === undefined) return { evidence: undefined, befunde: [{ path: "evidence.kind", rule: "required" }] };
    return { evidence, befunde: validateMediaEvidence(evidence) };
}
