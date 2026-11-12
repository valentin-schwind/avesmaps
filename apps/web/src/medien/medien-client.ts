import {
    MEDIA_EDITOR_GALLERY_URL,
    MEDIA_MERGE_PREVIEW_URL,
    MEDIA_EDITOR_NAVIGATION_URL,
    MEDIA_KARTEN_URL,
    MEDIA_PHOTOBOX_GALERIEN_URL,
    MEDIA_TYPE_IMAGES_URL,
    mediaKarteUrl,
    mediaPhotoboxGalerieUrl,
    mediaEditorAssetUrl,
    mediaEditorGalleryUrl,
    mediaEditorUsageUrl,
    mediaSameBytesUrl,
    type MamNavigation,
    type MamSearchQuery,
    type MamSearchResult,
    type MediaAssetDetail,
    type MamGalleryList,
    type MamKarteDetail,
    type MamKartenListe,
    type MamTypeImageList,
    type JobSummary,
    type MediaGalleryDetail,
    type MediaMergePreview,
    type MediaSameBytes,
    type MediaUsageResult,
    type PhotoboxGalerien,
    type PhotoboxOrtReisebilder,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, type Fetcher } from "../auth/api";
import { t, type MessageKey } from "../i18n/i18n";
import { suchAdresse } from "./medien-zustand";

/**
 * Der Lesepfad der Medienverwaltung im Browser (WI-0068 P3): die fünf Routen aus P2, alle hinter `view_media_private` und `no-store`,
 * Fehler im Umschlag (ADR-0018). Kein Schreibpfad; die Operationen kommen mit P4.
 *
 * 🔴 Jede Anfrage trägt ein `AbortSignal`: Ein jüngerer Wunsch (andere Suche, anderes Asset) bricht den älteren ab, statt dass eine späte
 * Antwort ihn überschreibt (AGENTS „Abbrechen ist Pflicht, nicht Kür“).
 */
export interface MedienClient {
    navigation(signal: AbortSignal): Promise<MamNavigation>;
    suche(anfrage: MamSearchQuery, signal: AbortSignal): Promise<MamSearchResult>;
    asset(id: string, signal: AbortSignal): Promise<MediaAssetDetail>;
    verwendung(id: string, signal: AbortSignal): Promise<MediaUsageResult>;
    /** Die Werke mit genau diesen Original-Bytes (SHA-256 als Hex), das älteste zuerst (Betreiber 2026-10-17). */
    gleicheBytes(sha256: string, signal: AbortSignal): Promise<MediaSameBytes>;
    /** Was „Alle bytegleichen zusammenführen“ bewegen würde (`GET …/merge/preview`); reines Lesen. */
    zusammenfuehrenVorschau(signal: AbortSignal): Promise<MediaMergePreview>;
    /**
     * Der Stand EINES Auftrags der Warteschlange über die Statusseite (`view_own_jobs`): erst unter den aktiven, dann unter den
     * zuletzt beendeten; `undefined`, wenn er in keiner Liste steht.
     */
    auftrag(id: string, signal: AbortSignal): Promise<JobSummary | undefined>;
    galerie(id: string, signal: AbortSignal): Promise<MediaGalleryDetail>;
    /** Die 37 Typbildkategorien mit ihrem ★ (`GET /api/editor/media/type-images`, Migration 0113). */
    typbilder(signal: AbortSignal): Promise<MamTypeImageList>;
    /** Die Galerien als Liste; `q` sucht über Titel UND Ortsnamen (im Bestand hat keine Galerie einen Titel). */
    galerien(q: string, signal: AbortSignal): Promise<MamGalleryList>;
    /** Die Kartensammlung als Liste (WI-0068 R5); `q` sucht über Titel, Zeichner, Verlag und die Namen der Orte. */
    karten(q: string, signal: AbortSignal, stillgelegte?: boolean): Promise<MamKartenListe>;
    /** Die PhotoBox-Galerien; die Suche filtert über den Ortsnamen. */
    photoboxGalerien(q: string, signal: AbortSignal): Promise<PhotoboxGalerien>;
    /** Die Reisebilder einer PhotoBox-Galerie. */
    photoboxGalerie(kennung: string, signal: AbortSignal): Promise<PhotoboxOrtReisebilder>;
    /** Eine Karte mit allem, was der Bestand führt, und ihren Bildern. */
    karte(id: string, signal: AbortSignal): Promise<MamKarteDetail>;
}

export function createMedienClient(fetcher: Fetcher = (url, init) => fetch(url, init)): MedienClient {
    const holen = <T>(url: string, signal: AbortSignal): Promise<T> =>
        getJson<T>(url, (ziel, init) => fetcher(ziel, { ...init, signal }));
    return {
        navigation: (signal) => holen(MEDIA_EDITOR_NAVIGATION_URL, signal),
        suche: (anfrage, signal) => holen(suchAdresse(anfrage), signal),
        asset: (id, signal) => holen(mediaEditorAssetUrl(id), signal),
        verwendung: (id, signal) => holen(mediaEditorUsageUrl(id), signal),
        gleicheBytes: (sha256, signal) => holen(mediaSameBytesUrl(sha256), signal),
        zusammenfuehrenVorschau: (signal) => holen(MEDIA_MERGE_PREVIEW_URL, signal),
        auftrag: async (id, signal) => {
            for (const liste of [
                "",
                "?state=SUCCEEDED&limit=20",
                "?state=FAILED&limit=20",
                "?state=CANCELLED&limit=20",
            ]) {
                const { jobs } = await holen<{ jobs: JobSummary[] }>(`/api/jobs${liste}`, signal);
                const treffer = jobs.find((job) => job.id === id);
                if (treffer !== undefined) return treffer;
            }
            return undefined;
        },
        galerie: (id, signal) => holen(mediaEditorGalleryUrl(id), signal),
        typbilder: (signal) => holen(MEDIA_TYPE_IMAGES_URL, signal),
        galerien: (q, signal) =>
            holen(
                q.trim() === ""
                    ? MEDIA_EDITOR_GALLERY_URL
                    : `${MEDIA_EDITOR_GALLERY_URL}?q=${encodeURIComponent(q.trim())}`,
                signal,
            ),
        photoboxGalerien: (q, signal) =>
            holen(
                q.trim() === ""
                    ? MEDIA_PHOTOBOX_GALERIEN_URL
                    : `${MEDIA_PHOTOBOX_GALERIEN_URL}?q=${encodeURIComponent(q.trim())}`,
                signal,
            ),
        photoboxGalerie: (kennung, signal) => holen(mediaPhotoboxGalerieUrl(kennung), signal),
        karten: (q, signal, stillgelegte = false) => {
            // WI-0287: Standard ohne die entfernten Einträge; `retired=true` nimmt sie in die Liste.
            const teile = [
                ...(q.trim() === "" ? [] : [`q=${encodeURIComponent(q.trim())}`]),
                ...(stillgelegte ? ["retired=true"] : []),
            ];
            return holen(teile.length === 0 ? MEDIA_KARTEN_URL : `${MEDIA_KARTEN_URL}?${teile.join("&")}`, signal);
        },
        karte: (id, signal) => holen(mediaKarteUrl(id), signal),
    };
}

/** Ein abgebrochener Wunsch ist kein Fehler: Er wird still verworfen. */
export function istAbbruch(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

/**
 * Ein gefangener Fehler als `ApiFailure`. Was schon eines ist, kam vom Server oder vom Netz (`send` in `auth/api.ts` fängt
 * fetch und das Lesen des Rumpfs). Alles andere ist ein Fehler in der Seite selbst, etwa ein TypeError beim Lesen einer
 * Antwort: Er heißt `client`, nicht `network`, und geht mit `console.error` hinaus (WI-0202, Review W5-05). Bis dahin wurde
 * jeder solche Fehler zu „Keine Verbindung zum Server.“, und weil er im try des Bauteils hing, sah ihn nicht einmal die Konsole.
 */
export function alsApiFailure(error: unknown): ApiFailure {
    if (error instanceof ApiFailure) return error;
    console.error("Medien: unerwarteter Fehler", error);
    return new ApiFailure(0, "client", "");
}

export interface MedienFehler {
    /** Der stabile Code des Umschlags (oder `network`, `unavailable`, `client` für einen Fehler in der Seite). */
    code: string;
    status: number;
    text: string;
    /** `gefahr` für „darf nicht“ und „gibt es nicht“, `warnung` für „geht gerade nicht“. */
    ton: "warnung" | "gefahr";
    /** Lohnt ein zweiter Versuch? Ein fehlendes Recht wird durch Wiederholen nicht anders. */
    erneut: boolean;
}

/**
 * Was die Oberfläche zu einem Fehler sagt (ADR-0018: nach dem stabilen Code, nie nach dem Text des Servers). 🔴 401 und 403 sind
 * keine Störung, sondern eine Auskunft: Sie stehen ruhig in der Spalte, ohne „Erneut versuchen“.
 */
export function medienFehler(error: unknown): MedienFehler {
    const failure = alsApiFailure(error);
    const mit = (key: MessageKey, ton: MedienFehler["ton"], erneut: boolean): MedienFehler => ({
        code: failure.code,
        status: failure.status,
        text: t(key, { code: failure.code }),
        ton,
        erneut,
    });
    if (failure.status === 401) return mit("medien.fehler.anmeldung", "warnung", false);
    if (failure.status === 403) {
        if (failure.code === "assurance_required" || failure.code === "reauth_required")
            return mit("medien.fehler.bestaetigung", "warnung", false);
        return mit("medien.fehler.recht", "gefahr", false);
    }
    if (failure.status === 404) return mit("medien.fehler.fehlt", "gefahr", false);
    if (failure.code === "auth_unavailable") return mit("medien.fehler.anmeldungAus", "warnung", true);
    if (failure.code === "client") return mit("medien.fehler.client", "warnung", false);
    if (failure.status === 0) return mit("medien.fehler.netz", "warnung", true);
    if (failure.status >= 500) return mit("medien.fehler.server", "warnung", true);
    return mit("medien.fehler.sonst", "warnung", true);
}
