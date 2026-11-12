import {
    MEDIA_BINDABLE_ROLES,
    MEDIA_EVIDENCE_TYPES,
    MEDIA_KARTE_DATEI,
    MEDIA_UPLOAD_LIMITS,
    validateMediaForm,
    type MediaCreationFields,
    type MediaCreationMethod,
    type MediaEvidenceInput,
    type MediaFileUpload,
    type MediaFormIssue,
    type MediaLicenseInfo,
    type MediaRightsBasis,
    type MediaRightsFields,
    type MediaUploadForm,
    type MediaUsagePublication,
} from "@avesmaps3d/shared";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { grundName } from "./medien-text";

/**
 * Was das gemeinsame Formular der Medienverwaltung rechnet (WI-0068 P4b, WI-0126 §11j): vom Stand der Felder zum Vertrag
 * `MediaUploadForm`, die Prüfung vor dem Senden (dieselbe Funktion wie auf dem Server, `validateMediaForm`), die Sätze an den Feldern
 * und der Satz der Policy unter dem Formular. Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * - **Was nicht zu sehen ist, wird nicht gesendet:** Prompt und Negativ-Prompt nur bei „KI-erzeugt“, Lizenz nur bei der Grundlage
 *   „Lizenz“, beim Beleg nur die Felder seiner Art. Sonst schlüge die Prüfung an einem Feld an, das niemand sieht.
 * - **Freigeben beim Hochladen** (WI-0282): Wer `review_media_rights` hat, gibt das Bild mit dem Kästchen gleich frei, auch das eigene; ohne das Recht
 *   steht dort ein Satz.
 * - Der Hochlader steht nie im Formular: Ihn setzt der Server aus der Sitzung (Provenienz, getrennt vom Urheber).
 */

export type BelegArt = MediaEvidenceInput["kind"];

/** Die Rollen, für die P4b hochlädt und bindet: Wappen und Titelbild. */
export type BindbareRolle = (typeof MEDIA_BINDABLE_ROLES)[number];
/**
 * Wofür das Formular hochlädt: die bindbaren Rollen, das Bild eines Beitrags im Social Hub (WI-0278), das an keinem Fachobjekt hängt, und Karte oder Vorschau eines Eintrags der
 * Kartensammlung (WI-0287).
 */
export type HochladeRolle = BindbareRolle | "social_post" | "map_full" | "map_preview";

/** Woher ein Upload kommt, im Formular unter „Weg“: aus der Medienverwaltung oder aus dem Editor, an dessen Objekt gebunden wird. */
export type HochladenWeg = "ortseditor" | "gebietseditor" | "medien" | "social" | "kartensammlung";
export const WEG_TEXT: Readonly<Record<HochladenWeg, MessageKey>> = {
    ortseditor: "medien.formular.wegOrtseditor",
    gebietseditor: "medien.formular.wegGebietseditor",
    medien: "medien.formular.wegMedien",
    social: "medien.formular.wegSocial",
    kartensammlung: "medien.formular.wegKartensammlung",
};

export interface EntstehungStand {
    art: MediaCreationMethod;
    werkzeug: string;
    modell: string;
    prompt: string;
    negativPrompt: string;
}

export interface RechteStand {
    grundlage: MediaRightsBasis | "";
    lizenz: string;
    urheber: string;
    rechteinhaber: string;
    namensnennung: string;
    rechtenotiz: string;
}

export interface BelegStand {
    art: BelegArt | "";
    text: string;
    adresse: string;
    datei: File | undefined;
}

export interface HochladeStand {
    titel: string;
    entstehung: EntstehungStand;
    rechte: RechteStand;
    herkunft: string;
    beleg: BelegStand;
    /** „Rechte geprüft“ gleich beim Hochladen (WI-0282); nur, wer `review_media_rights` hat, sieht den Haken. */
    freigeben: boolean;
}

/** Der Anfang: Entstehung „unbekannt“ (nichts wird behauptet), Grundlage noch nicht gewählt. */
export function leererStand(titel = "", freigeben = false): HochladeStand {
    return {
        titel,
        entstehung: { art: "unknown", werkzeug: "", modell: "", prompt: "", negativPrompt: "" },
        rechte: { grundlage: "", lizenz: "", urheber: "", rechteinhaber: "", namensnennung: "", rechtenotiz: "" },
        herkunft: "",
        beleg: { art: "", text: "", adresse: "", datei: undefined },
        freigeben,
    };
}

const gefuellt = (wert: string): string | null => (wert.trim() === "" ? null : wert.trim());

/** Welche Felder ein Beleg dieser Art zeigt (Migration 0064, `validateMediaEvidence`). */
export function belegFelder(art: BelegArt | ""): { adresse: boolean; datei: boolean; text: boolean } {
    switch (art) {
        case "license_page":
        case "source_page":
            return { adresse: true, datei: false, text: true };
        case "email":
        case "pdf":
        case "document":
            return { adresse: false, datei: true, text: true };
        case "operator_note":
            return { adresse: false, datei: false, text: true };
        default:
            return { adresse: false, datei: false, text: false };
    }
}

export function entstehungFelder(stand: EntstehungStand): MediaCreationFields | undefined {
    const ki = stand.art === "ai_generated";
    const felder: MediaCreationFields = {
        ...(gefuellt(stand.werkzeug) === null ? {} : { tool: gefuellt(stand.werkzeug) }),
        ...(gefuellt(stand.modell) === null ? {} : { model: gefuellt(stand.modell) }),
        ...(ki && gefuellt(stand.prompt) !== null ? { prompt: gefuellt(stand.prompt) } : {}),
        ...(ki && gefuellt(stand.negativPrompt) !== null ? { negativePrompt: gefuellt(stand.negativPrompt) } : {}),
    };
    return Object.keys(felder).length === 0 ? undefined : felder;
}

/** Die Rechte als Vertrag; ohne gewählte Grundlage gibt es keine. */
export function rechteFelder(stand: RechteStand): MediaRightsFields | undefined {
    if (stand.grundlage === "") return undefined;
    return {
        basis: stand.grundlage,
        licenseKey: stand.grundlage === "license" ? gefuellt(stand.lizenz) : null,
        creator: gefuellt(stand.urheber),
        rightsHolder: gefuellt(stand.rechteinhaber),
        attribution: gefuellt(stand.namensnennung),
        rightsNote: gefuellt(stand.rechtenotiz),
    };
}

/**
 * Der Beleg als Vertrag. Die Datei kommt erst beim Senden als Base64 dazu (`datei`); zum Prüfen reicht ein Platzhalter, denn
 * `validateMediaEvidence` fragt nur, ob es eine gibt.
 */
export function belegEingabe(stand: BelegStand, datei?: MediaFileUpload): MediaEvidenceInput | undefined {
    if (stand.art === "") return undefined;
    const felder = belegFelder(stand.art);
    const text = felder.text ? gefuellt(stand.text) : null;
    const adresse = felder.adresse ? gefuellt(stand.adresse) : null;
    const anhang =
        felder.datei && stand.datei !== undefined ? (datei ?? { name: "beleg", dataBase64: "AAAA" }) : undefined;
    return {
        kind: stand.art,
        ...(text === null ? {} : { text }),
        ...(adresse === null ? {} : { url: adresse }),
        ...(anhang === undefined ? {} : { file: anhang }),
    };
}

/**
 * Das Formular für den Server. `vorschlag`: der Name nach der Namensregel, mit dem das Feld vorbelegt war (7b); ist der Name unverändert,
 * geht er als „aus der Bindung“ hinaus (`titleFromBinding`, Titel leer), damit er ein abgeleiteter Titel bleibt und kein Titel eines
 * Menschen wird. Nur sinnvoll, wenn eine Bindung folgt.
 */
export function zuFormular(
    stand: HochladeStand,
    rolle: MediaUploadForm["role"],
    belegDatei?: MediaFileUpload,
    vorschlag?: string,
): MediaUploadForm | undefined {
    const rechte = rechteFelder(stand.rechte);
    if (rechte === undefined) return undefined;
    const creation = entstehungFelder(stand.entstehung);
    const evidence = belegEingabe(stand.beleg, belegDatei);
    const ausBindung = vorschlag !== undefined && vorschlag !== "" && stand.titel.trim() === vorschlag;
    return {
        title: ausBindung ? "" : stand.titel.trim(),
        ...(ausBindung ? { titleFromBinding: true } : {}),
        role: rolle,
        creationMethod: stand.entstehung.art,
        ...(creation === undefined ? {} : { creation }),
        rights: rechte,
        provenance: gefuellt(stand.herkunft),
        ...(evidence === undefined ? {} : { evidence }),
        // Eine unbekannte Grundlage lässt sich nicht freigeben; der Haken ruht dann.
        ...(stand.freigeben && rechte.basis !== "unknown" ? { rightsReviewed: true } : {}),
    };
}

export interface DateiAngabe {
    sizeBytes: number;
    type: string;
}

/**
 * Die Prüfung vor dem Senden: Datei und Grundlage Pflicht, dann dieselbe Prüfung wie der Server, dazu Typ und Größe der Belegdatei.
 * Leer heißt absendbar. Pfade wie im Umschlag (`rights.licenseKey`), damit Befunde des Servers an dieselben Felder fallen.
 */
export function pruefeFormular(
    stand: HochladeStand,
    rolle: MediaUploadForm["role"],
    kontext: {
        lizenzen: readonly MediaLicenseInfo[];
        datei: DateiAngabe | undefined;
        /**
         * Nur diese Entstehungen (WI-0281): ein Typbild ohne KI nimmt nur Foto, Zeichnung oder Scan (`OHNE_KI_CREATION_METHODS`). Die Vorgabe „unbekannt“
         * ist dann ein Befund, kein stiller Wert: Die Nicht-KI-Herkunft trägt ein Mensch ein, sie wird nicht angenommen.
         */
        entstehungen?: readonly MediaCreationMethod[] | undefined;
    },
): MediaFormIssue[] {
    const befunde: MediaFormIssue[] = [];
    if (kontext.datei === undefined) befunde.push({ path: "file", rule: "required" });
    if (kontext.entstehungen !== undefined && !kontext.entstehungen.includes(stand.entstehung.art)) {
        befunde.push({ path: "creationMethod", rule: "not_allowed" });
    }
    const form = zuFormular(stand, rolle);
    if (form === undefined) {
        befunde.push({ path: "rights.basis", rule: "required" });
        if (stand.titel.trim() === "") befunde.push({ path: "title", rule: "required" });
    } else {
        befunde.push(
            ...validateMediaForm(form, {
                mode: "upload",
                licenses: kontext.lizenzen,
                // Den Haken sieht nur, wer prüfen darf; der Server prüft das Recht selbst.
                mayReview: true,
                ...(kontext.datei === undefined ? {} : { file: kontext.datei }),
            }),
        );
    }
    const belegDatei = belegFelder(stand.beleg.art).datei ? stand.beleg.datei : undefined;
    if (belegDatei !== undefined) {
        if (!(MEDIA_EVIDENCE_TYPES as readonly string[]).includes(belegDatei.type))
            befunde.push({ path: "evidence.file", rule: "unsupported_type" });
        if (belegDatei.size > MEDIA_UPLOAD_LIMITS.maxRasterBytes)
            befunde.push({ path: "evidence.file", rule: "too_large" });
    }
    return befunde;
}

const REGEL: Readonly<Record<MediaFormIssue["rule"], MessageKey>> = {
    required: "medien.formular.regel.required",
    unknown_license: "medien.formular.regel.unknown_license",
    only_with_license: "medien.formular.regel.only_with_license",
    required_by_license: "medien.formular.regel.required_by_license",
    needs_ai_generated: "medien.formular.regel.needs_ai_generated",
    not_allowed: "medien.formular.regel.not_allowed",
    not_http: "medien.formular.regel.not_http",
    unsupported_type: "medien.formular.regel.unsupported_type",
    too_large: "medien.formular.regel.too_large",
};

/** Der Satz zu einem Befund. Bei der Bilddatei nennt „zu groß“ die Grenzen; bei der Belegdatei gilt die des Rasters. */
export function befundText(befund: MediaFormIssue, rolle?: MediaUploadForm["role"]): string {
    if (befund.rule === "too_large") {
        if (befund.path === "file" && (rolle === "map_full" || rolle === "map_preview")) {
            return t("medien.formular.regel.too_large_karte", {
                mb: formatNumber(
                    (rolle === "map_full" ? MEDIA_KARTE_DATEI.maxBytes : MEDIA_KARTE_DATEI.maxBytesVorschau) /
                        1024 /
                        1024,
                    0,
                ),
            });
        }
        return befund.path === "file"
            ? t("medien.formular.regel.too_large_bild", {
                  raster: formatNumber(MEDIA_UPLOAD_LIMITS.maxRasterBytes / 1024 / 1024, 0),
                  svg: formatNumber(MEDIA_UPLOAD_LIMITS.maxSvgBytes / 1024, 0),
              })
            : t(REGEL.too_large, { mb: formatNumber(MEDIA_UPLOAD_LIMITS.maxRasterBytes / 1024 / 1024, 0) });
    }
    return t(REGEL[befund.rule]);
}

/** Je Feld der erste Befund (ein Feld sagt einen Satz, nicht drei). */
export function befundeJeFeld(
    befunde: readonly MediaFormIssue[],
    rolle?: MediaUploadForm["role"],
): ReadonlyMap<string, string> {
    const je = new Map<string, string>();
    for (const befund of befunde) if (!je.has(befund.path)) je.set(befund.path, befundText(befund, rolle));
    return je;
}

export type SatzTon = "neutral" | "erfolg" | "warnung";

/**
 * Der Satz unter dem Formular (WI-0126 §11j): vorher sagen, ob das Bild danach öffentlich ist. Er kommt aus der Policy des Servers
 * (`GET …/publication-preview`), nie aus einer eigenen Regel im Browser. `ort` ist der Name des Fachobjekts, an das gebunden wird;
 * ohne ihn (Hochladen im MAM-Fenster) hängt das Bild noch nirgends.
 */
export function freigabeSatzVorher(
    grundlage: MediaRightsBasis | "",
    vorschau: MediaUsagePublication | undefined,
    rolle: string,
    ort: string | undefined,
): { text: string; ton: SatzTon } {
    if (grundlage === "") return { text: t("medien.formular.satz.ohneGrundlage"), ton: "neutral" };
    if (vorschau === undefined) return { text: t("medien.formular.satz.rechnet"), ton: "neutral" };
    if (vorschau.public) {
        return ort === undefined
            ? { text: t("medien.formular.satz.oeffentlichSpaeter", { rolle }), ton: "erfolg" }
            : { text: t("medien.formular.satz.oeffentlich", { rolle, ort }), ton: "erfolg" };
    }
    const grund = grundName(vorschau.reason);
    return ort === undefined
        ? { text: t("medien.formular.satz.privatSpaeter", { grund }), ton: "warnung" }
        : { text: t("medien.formular.satz.privat", { grund }), ton: "warnung" };
}
