import {
    MEDIA_COAT_BIND_URL,
    MEDIA_COAT_NONE_URL,
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_BIND_URL,
    MEDIA_GALLERY_CAPTION_URL,
    MEDIA_GALLERY_COVER_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_GALLERY_ORDER_URL,
    MEDIA_GALLERY_REMOVE_URL,
    MEDIA_GALLERY_TITLE_URL,
    MEDIA_GALLERY_UNBIND_URL,
    MEDIA_GALLERY_DELETE_URL,
    MEDIA_HEADER_NONE_URL,
    MEDIA_HEADER_RELATION_URL,
    MEDIA_HEADER_SET_URL,
    MEDIA_LICENSES_URL,
    MEDIA_MERGE_URL,
    MEDIA_PUBLICATION_PREVIEW_URL,
    MEDIA_TYPE_IMAGES_ADOPT_URL,
    MEDIA_TYPE_IMAGE_RELEASE_URL,
    MEDIA_TYPE_IMAGE_SET_URL,
    MEDIA_UPLOAD_LIMITS,
    MEDIA_UPLOAD_URL,
    mediaCreationUrl,
    mediaEvidenceUrl,
    mediaPhotoboxUrl,
    mediaMetadataUrl,
    mediaRightsReviewUrl,
    mediaRightsUrl,
    mediaSubjectSlotsUrl,
    mediaMergeLiftUrl,
    MEDIA_MERGE_ALL_URL,
    type MediaMergeAllBody,
    mediaSuspendLiftUrl,
    mediaDeleteUrl,
    mediaKarteAendernUrl,
    mediaKarteBildLoesenUrl,
    mediaKarteLinksUrl,
    mediaKarteQuellenUrl,
    mediaKarteOrteUrl,
    mediaKarteVorschauUrl,
    mediaKarteVersionUrl,
    mediaKarteBildUrl,
    MEDIA_KARTE_DATEI_URL,
    MEDIA_KARTEN_URL,
    mediaKarteStilllegenUrl,
    mediaKarteZurueckholenUrl,
    mediaKarteZusammenlegenUrl,
    mediaSuspendUrl,
    type EditConflictDetails,
    type MediaCoatBindBody,
    type MediaCoatNoneBody,
    type MediaHeaderNoneBody,
    type MediaHeaderSetBody,
    type MediaCreationBody,
    type MediaEvidenceBody,
    type MediaFileUpload,
    type MediaFormIssue,
    type MediaGalleryAddBody,
    type MediaGalleryBindBody,
    type MediaGalleryDeleteBody,
    type MediaGalleryCaptionBody,
    type MediaGalleryCoverBody,
    type MediaGalleryCreateBody,
    type MediaGalleryOrderBody,
    type MediaGalleryRemoveBody,
    type MediaGalleryTitleBody,
    type MediaHeaderRelationBody,
    type MediaLicenseCatalog,
    type MediaMergeBody,
    type MediaMergeLiftBody,
    type MediaMetadataBody,
    type MediaPublicationPreview,
    type MediaPublicationPreviewQuery,
    type MediaRightsBody,
    type MediaRightsReviewBody,
    type MediaSlotSubjectKind,
    type MediaSlotSubjectRef,
    type MediaSubjectSlots,
    type MediaSuspendBody,
    type MediaSuspendLiftBody,
    type MediaDeleteBody,
    type MamKarteAendernBody,
    type MamKarteAnlegenBody,
    type MamKarteBildBody,
    type MamKarteBildLoesenBody,
    type MamKarteLinksBody,
    type MamKarteQuellenBody,
    type MamKarteOrteBody,
    type MamKarteVorschauBody,
    type MamKarteVersionBody,
    type MediaKarteDateiKopf,
    type MamKarteStilllegenBody,
    type MamKarteZusammenlegenBody,
    type MediaTypeImageReleaseBody,
    type MediaTypeImageSetBody,
    type MediaTypeImagesAdoptBody,
    type MediaUploadForm,
    type OperationReceipt,
    type PhotoboxRedaktionAblehnen,
    type PhotoboxRedaktionFreigeben,
    type PhotoboxRedaktionKorrigieren,
    type PhotoboxRedaktionOffline,
    type PhotoboxRedaktionErneutPruefen,
    type PhotoboxRedaktionRueckfrage,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, newOperationId, postJson, putDatei, type Fetcher } from "../auth/api";
import { withConfirmation, type Need } from "../auth/bestaetigen";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { redaktionGrund } from "../photobox/ablehnung";
import { istLoeschHindernis, loeschHindernisSatz } from "./medien-loeschen-modell";
import { alsApiFailure, medienFehler, type MedienFehler } from "./medien-client";
import { meldeReisebilderGeaendert } from "./medien-oeffnen";

/**
 * Der Schreibpfad der Medienverwaltung im Browser (WI-0068 P4b): die Operationen aus P4a, je eine Funktion. Formular, Auswahl, Inspector
 * und der Reiter „Bilder“ des Ortseditors (EDIT-0001 E19) rufen sie über diese EINE Stelle; keine zweite Fassung je Bauteil.
 *
 * - **Eine Kennung je Handlung** (ADR-0019): `Handlung` hält die `operationId`, solange unklar ist, ob der Server die Anfrage ausgeführt
 *   hat (keine Antwort, 5xx). Dann schickt die Wiederholung dieselbe Kennung, und der Server antwortet mit der gespeicherten Quittung
 *   statt doppelt zu wirken. Nach einer Antwort (Erfolg oder klare Ablehnung) ist die Kennung verbraucht: Der nächste Versuch trägt eine
 *   neue, sonst wiese der Server den geänderten Inhalt mit 409 `idempotency_key_reused` ab.
 * - **Kurz bestätigen:** Verlangt der Server eine Bestätigung, fragt `withConfirmation` nach und wiederholt einmal mit derselben Kennung.
 * - **Rechte prüft der Server** (`protect`); ein gesperrter Knopf ist Auskunft, nie Schutz.
 * - 🔴 Öffentlich wird nichts durch eine dieser Operationen, sondern allein über die Policy (`decidePublication`).
 */

export interface MedienOperationen {
    hochladen(operationId: string, file: MediaFileUpload, form: MediaUploadForm): Promise<OperationReceipt>;
    metadaten(assetId: string, body: MediaMetadataBody): Promise<OperationReceipt>;
    entstehung(assetId: string, body: MediaCreationBody): Promise<OperationReceipt>;
    rechte(assetId: string, body: MediaRightsBody): Promise<OperationReceipt>;
    rechtePruefen(assetId: string, body: MediaRightsReviewBody): Promise<OperationReceipt>;
    beleg(assetId: string, body: MediaEvidenceBody): Promise<OperationReceipt>;
    wappenSetzen(body: MediaCoatBindBody): Promise<OperationReceipt>;
    /** „Wappen entfernen“ ist immer „bewusst ohne“: Der Platz bekommt einen Entscheid, das Asset bleibt. */
    wappenBewusstOhne(body: MediaCoatNoneBody): Promise<OperationReceipt>;
    /**
     * Das Titelbild eines Orts setzen (WI-0219): EIN Bild; was bisher hängt, ein Bild oder eine Galerie, wird gelöst und bleibt in der
     * Medienverwaltung. Eine Galerie als Titelbild bindet `galerieBinden` (mit `replaceRevision`, wenn schon eine hängt).
     */
    titelbildSetzen(body: MediaHeaderSetBody): Promise<OperationReceipt>;
    /** Kein Titelbild: lösen, was hängt, der Platz wird „bewusst ohne“. */
    keinTitelbild(body: MediaHeaderNoneBody): Promise<OperationReceipt>;
    /**
     * Den Bildbezug EINER Verwendung eines Titelbildes übersteuern oder auf die Regel zurückgeben (Betreiber 2026-10-11).
     * Rührt weder Provenienz noch Rechte noch Freigabe des Assets an.
     */
    bildbezugSetzen(body: MediaHeaderRelationBody): Promise<OperationReceipt>;
    /**
     * Einzelbild-Notaus: die Bytes dieses Werks offline nehmen beziehungsweise wieder freigeben (Betreiber 2026-10-10).
     * Beide verlangen einen frischen Passkey; `withConfirmation` holt ihn und wiederholt mit derselben Kennung.
     */
    notausSetzen(assetId: string, body: MediaSuspendBody): Promise<OperationReceipt>;
    notausAufheben(assetId: string, body: MediaSuspendLiftBody): Promise<OperationReceipt>;
    /**
     * Endgültig löschen (WI-0068 R4, Betreiber 2026-10-17): nur ein eigener Upload ohne jede Verwendung; frischer Passkey wie beim
     * Notaus (`withConfirmation`).
     */
    loeschen(assetId: string, body: MediaDeleteBody): Promise<OperationReceipt>;
    /**
     * Die Galerie als eigenes Medienobjekt (WI-0068 P6).
     *
     * 🔴 **Alle gegen die Revision der GALERIE**, nicht die eines Eintrags oder einer Bindung: Sie steigt auch, wenn sich ein
     * Eintrag ändert, und schützt damit mit EINER Zahl die ganze Folge. Nach jeder Antwort die Galerie neu lesen - die Quittung
     * nennt die frische Revision, aber nicht die neue Folge.
     *
     * 🔴 **Binden und Lösen rühren die Bilder nicht an.** `galerieLoesen` nimmt NUR diesem Ort die Galerie; wer ein Bild
     * herausnehmen will, nimmt `galerieBildEntfernen`. Die Quittung warnt mit `gallery_is_draft`, wenn die Galerie danach an
     * keinem Ort mehr hängt und ihre Bilder deshalb unsichtbar werden.
     */
    galerieAnlegen(body: MediaGalleryCreateBody): Promise<OperationReceipt>;
    galerieTitel(body: MediaGalleryTitleBody): Promise<OperationReceipt>;
    galerieBildHinzu(body: MediaGalleryAddBody): Promise<OperationReceipt>;
    galerieOrdnen(body: MediaGalleryOrderBody): Promise<OperationReceipt>;
    galerieTitelbild(body: MediaGalleryCoverBody): Promise<OperationReceipt>;
    galerieBildunterschrift(body: MediaGalleryCaptionBody): Promise<OperationReceipt>;
    galerieBildEntfernen(body: MediaGalleryRemoveBody): Promise<OperationReceipt>;
    galerieBinden(body: MediaGalleryBindBody): Promise<OperationReceipt>;
    galerieLoesen(body: MediaGalleryBindBody): Promise<OperationReceipt>;
    /** Eine eigene Galerie ohne Ort entfernen (WI-0068 R3); die Bilder bleiben. Sonst 409 `media_not_deletable` mit Grund. */
    galerieEntfernen(body: MediaGalleryDeleteBody): Promise<OperationReceipt>;
    /**
     * Mehrere Werke mit DENSELBEN BYTES zu einem machen (WI-0068 D1, Betreiber 2026-10-13).
     *
     * 🔴 Nur bytegleich, nie automatisch, umkehrbar: `zusammenfuehrungAufheben` gibt jede Verwendung genau dorthin
     * zurueck, wo sie herkam. Das aufgegangene Werk wird nicht geloescht - es behaelt Original, Rechte und Herkunft.
     */
    zusammenfuehren(body: MediaMergeBody): Promise<OperationReceipt>;
    zusammenfuehrungAufheben(assetId: string, body: MediaMergeLiftBody): Promise<OperationReceipt>;
    /** „Alle bytegleichen Duplikate zusammenführen“: reiht EINEN Auftrag ein (nur Betreiber, frischer Passkey). */
    alleZusammenfuehren(body: MediaMergeAllBody): Promise<OperationReceipt>;
    /** Den ★ einer Typbildkategorie setzen: Der ★ wandert, das alte Asset bleibt im Verlauf (Betreiber 2026-10-11). */
    typbildSetzen(body: MediaTypeImageSetBody): Promise<OperationReceipt>;
    /** Den ★ einer Variante lösen, ohne ein anderes Bild (WI-0281): Die Zeile wird Verlauf, das Asset bleibt. */
    typbildLoesen(body: MediaTypeImageReleaseBody): Promise<OperationReceipt>;
    /** „Eingebaute Typbilder übernehmen“: ein Klick, idempotent; legt nur an, wo eine Kategorie noch keinen ★ hat. */
    typbilderUebernehmen(body: MediaTypeImagesAdoptBody): Promise<OperationReceipt>;
    /**
     * Eine Karte der Kartensammlung ändern (WI-0068 R5): Eigenschaften und Typen gegen den gesehenen Stand der Karte. Danach lässt der
     * Legacy-Zug sie stehen; 503 `map_import_running`, solange er gerade schreibt.
     */
    karteAendern(citymapId: string, body: MamKarteAendernBody): Promise<OperationReceipt>;
    /**
     * Einen Eintrag der Kartensammlung entfernen und zurückholen (WI-0287): stillgelegt, nie gelöscht, gegen den gesehenen Stand. 409
     * `citymap_already_retired` bzw. `citymap_not_retired` bei einem doppelten Aufruf.
     */
    karteEntfernen(citymapId: string, body: MamKarteStilllegenBody): Promise<OperationReceipt>;
    karteZurueckholen(citymapId: string, body: MamKarteStilllegenBody): Promise<OperationReceipt>;
    /**
     * Die Bilder eines Eintrags an einen anderen geben und ihn entfernen, in einer Operation (WI-0287 Stufe 2), gegen den gesehenen Stand beider. 409
     * `citymap_target_retired` (Ziel stillgelegt) und `citymap_merge_self`.
     */
    karteZusammenlegen(citymapId: string, body: MamKarteZusammenlegenBody): Promise<OperationReceipt>;
    /** Einen neuen Eintrag der Kartensammlung anlegen (WI-0287): Name, Orte, Angaben; die Bilder danach. */
    karteAnlegen(body: MamKarteAnlegenBody): Promise<OperationReceipt>;
    /**
     * Ein Werk an den Eintrag binden (WI-0287): eine Karte kommt als weitere Version dazu (mit `versionLabel`), eine Vorschau ersetzt die bisherige. 409 `media_type_mismatch`
     * bei falscher Art.
     */
    karteBildZuweisen(citymapId: string, body: MamKarteBildBody): Promise<OperationReceipt>;
    /** Ein Bild vom Eintrag lösen, bei mehreren Versionen der Karte das genannte (`assetId`); das Werk bleibt in der Liste (WI-0287). */
    karteBildLoesen(citymapId: string, body: MamKarteBildLoesenBody): Promise<OperationReceipt>;
    /** Bezeichnung oder Reihenfolge einer Version der Karte (WI-0287 Stufe 2); ohne Änderung bleibt die Revision. */
    karteVersion(citymapId: string, body: MamKarteVersionBody): Promise<OperationReceipt>;
    /** Die Fundstellen eines Eintrags ersetzen, in der gegebenen Folge (die erste ist der Karten-Link; WI-0287). 400 bei einer Adresse ohne http oder https und bei doppelten. */
    karteLinks(citymapId: string, body: MamKarteLinksBody): Promise<OperationReceipt>;
    /** Eine Handlung an einer Publikation des Eintrags (WI-0287 Punkt 4): anhängen, Fundstelle, lösen, wiederherstellen, zuerst zeigen; je Handlung eine Operation. */
    karteQuellen(citymapId: string, body: MamKarteQuellenBody): Promise<OperationReceipt>;
    /** Eine Handlung an den Orten und Regionen des Eintrags (WI-0287 Stufe 3): anhängen, lösen, einer nicht aufgelösten Zeile ein Ziel geben; je Handlung eine Operation. 409 `citymap_target_present`, `citymap_place_resolved`. */
    karteOrte(citymapId: string, body: MamKarteOrteBody): Promise<OperationReceipt>;
    /**
     * Aus der Karte des Eintrags eine Vorschau erzeugen (WI-0287 Punkt 5): ein neues Werk, sofort als Vorschau gebunden, die Datei rechnet der Hintergrunddienst. 409 bei
     * gesperrter Karte, belegtem Platz oder einer Karte, die nicht (mehr) hier hängt.
     */
    karteVorschauErzeugen(citymapId: string, body: MamKarteVorschauBody): Promise<OperationReceipt>;
    /** Eine Kartendatei bis 50 MB (Vorschau bis 6 MB), als Rohkörper statt Base64 (WI-0287). */
    karteDatei(operationId: string, datei: File, form: MediaUploadForm): Promise<OperationReceipt>;
    /**
     * Die Operationen der Redaktion an einer Reisebild-Einreichung (WI-0272 S3): `id` ist die öffentliche Kennung der EINREICHUNG
     * (`PhotoboxSubmissionView.publicId`), `baseRevision` ihre Revision. Freigeben, Rückfrage, Ablehnen und Korrigieren brauchen `moderate_submissions`,
     * Offline nehmen `publish_media`. 409 `photobox_transition`: der Zustand erlaubt es nicht (mehr); 409 `edit_conflict`: jemand war schneller.
     */
    reisebildFreigeben(id: string, body: PhotoboxRedaktionFreigeben): Promise<OperationReceipt>;
    reisebildRueckfrage(id: string, body: PhotoboxRedaktionRueckfrage): Promise<OperationReceipt>;
    reisebildAblehnen(id: string, body: PhotoboxRedaktionAblehnen): Promise<OperationReceipt>;
    reisebildKorrigieren(id: string, body: PhotoboxRedaktionKorrigieren): Promise<OperationReceipt>;
    reisebildOffline(id: string, body: PhotoboxRedaktionOffline): Promise<OperationReceipt>;
    /** Erneut zur Prüfung (`moderate_submissions`): eine freigegebene Einreichung wieder offen; 409 `photobox_transition`, wenn sie es nicht (mehr) ist. */
    reisebildErneutPruefen(id: string, body: PhotoboxRedaktionErneutPruefen): Promise<OperationReceipt>;
    plaetze(kind: MediaSlotSubjectKind, id: string, signal: AbortSignal): Promise<MediaSubjectSlots>;
    lizenzen(signal: AbortSignal): Promise<MediaLicenseCatalog>;
    freigabeVorschau(anfrage: MediaPublicationPreviewQuery, signal: AbortSignal): Promise<MediaPublicationPreview>;
}

export interface MedienOperationenDeps {
    fetcher?: Fetcher;
    /** Das Fenster „Kurz bestätigen“; in Tests ersetzbar. */
    ask?: (need: Need) => Promise<boolean>;
}

export function createMedienOperationen(deps: MedienOperationenDeps = {}): MedienOperationen {
    const fetcher: Fetcher = deps.fetcher ?? ((url, init) => fetch(url, init));
    const senden = (url: string, body: unknown): Promise<OperationReceipt> =>
        withConfirmation(() => postJson<OperationReceipt>(url, body, fetcher), deps.ask);
    /** Eine Operation der Redaktion an einer Reisebild-Einreichung: Ist sie durch, erfährt der Stapel in Community › Meldungen es (`reisebilderStand`, Review S3 I3). */
    const reisebild = async (url: string, body: unknown): Promise<OperationReceipt> => {
        const quittung = await senden(url, body);
        meldeReisebilderGeaendert();
        return quittung;
    };
    const holen = <T>(url: string, signal: AbortSignal): Promise<T> =>
        withConfirmation(() => getJson<T>(url, (ziel, init) => fetcher(ziel, { ...init, signal })), deps.ask);
    return {
        hochladen: (operationId, file, form) => senden(MEDIA_UPLOAD_URL, { operationId, file, form }),
        metadaten: (id, body) => senden(mediaMetadataUrl(id), body),
        entstehung: (id, body) => senden(mediaCreationUrl(id), body),
        rechte: (id, body) => senden(mediaRightsUrl(id), body),
        rechtePruefen: (id, body) => senden(mediaRightsReviewUrl(id), body),
        beleg: (id, body) => senden(mediaEvidenceUrl(id), body),
        wappenSetzen: (body) => senden(MEDIA_COAT_BIND_URL, body),
        wappenBewusstOhne: (body) => senden(MEDIA_COAT_NONE_URL, body),
        titelbildSetzen: (body) => senden(MEDIA_HEADER_SET_URL, body),
        keinTitelbild: (body) => senden(MEDIA_HEADER_NONE_URL, body),
        bildbezugSetzen: (body) => senden(MEDIA_HEADER_RELATION_URL, body),
        notausSetzen: (assetId, body) => senden(mediaSuspendUrl(assetId), body),
        notausAufheben: (assetId, body) => senden(mediaSuspendLiftUrl(assetId), body),
        // Auch ein Reisebild kann endgültig fallen (WI-0272): Der Stapel in Community › Meldungen lädt dann neu, wie nach jeder Operation der Redaktion.
        loeschen: (assetId, body) => reisebild(mediaDeleteUrl(assetId), body),
        galerieAnlegen: (body) => senden(MEDIA_GALLERY_CREATE_URL, body),
        galerieTitel: (body) => senden(MEDIA_GALLERY_TITLE_URL, body),
        galerieBildHinzu: (body) => senden(MEDIA_GALLERY_ADD_URL, body),
        galerieOrdnen: (body) => senden(MEDIA_GALLERY_ORDER_URL, body),
        galerieTitelbild: (body) => senden(MEDIA_GALLERY_COVER_URL, body),
        galerieBildunterschrift: (body) => senden(MEDIA_GALLERY_CAPTION_URL, body),
        galerieBildEntfernen: (body) => senden(MEDIA_GALLERY_REMOVE_URL, body),
        galerieBinden: (body) => senden(MEDIA_GALLERY_BIND_URL, body),
        galerieLoesen: (body) => senden(MEDIA_GALLERY_UNBIND_URL, body),
        galerieEntfernen: (body) => senden(MEDIA_GALLERY_DELETE_URL, body),
        zusammenfuehren: (body) => senden(MEDIA_MERGE_URL, body),
        zusammenfuehrungAufheben: (assetId, body) => senden(mediaMergeLiftUrl(assetId), body),
        alleZusammenfuehren: (body) => senden(MEDIA_MERGE_ALL_URL, body),
        typbildSetzen: (body) => senden(MEDIA_TYPE_IMAGE_SET_URL, body),
        typbildLoesen: (body) => senden(MEDIA_TYPE_IMAGE_RELEASE_URL, body),
        typbilderUebernehmen: (body) => senden(MEDIA_TYPE_IMAGES_ADOPT_URL, body),
        karteAendern: (id, body) => senden(mediaKarteAendernUrl(id), body),
        karteAnlegen: (body) => senden(MEDIA_KARTEN_URL, body),
        karteBildZuweisen: (id, body) => senden(mediaKarteBildUrl(id), body),
        karteBildLoesen: (id, body) => senden(mediaKarteBildLoesenUrl(id), body),
        karteVersion: (id, body) => senden(mediaKarteVersionUrl(id), body),
        karteLinks: (id, body) => senden(mediaKarteLinksUrl(id), body),
        karteQuellen: (id, body) => senden(mediaKarteQuellenUrl(id), body),
        karteOrte: (id, body) => senden(mediaKarteOrteUrl(id), body),
        karteVorschauErzeugen: (id, body) => senden(mediaKarteVorschauUrl(id), body),
        karteDatei: (operationId, datei, form) =>
            withConfirmation(
                () =>
                    putDatei<OperationReceipt>(
                        MEDIA_KARTE_DATEI_URL,
                        kartenDateiRumpf({ operationId, name: anzeigeDateiname(datei.name), form }, datei),
                        "application/octet-stream",
                        fetcher,
                    ),
                deps.ask,
            ),
        karteEntfernen: (id, body) => senden(mediaKarteStilllegenUrl(id), body),
        karteZurueckholen: (id, body) => senden(mediaKarteZurueckholenUrl(id), body),
        karteZusammenlegen: (id, body) => senden(mediaKarteZusammenlegenUrl(id), body),
        reisebildFreigeben: (id, body) => reisebild(mediaPhotoboxUrl(id, "approve"), body),
        reisebildRueckfrage: (id, body) => reisebild(mediaPhotoboxUrl(id, "ask"), body),
        reisebildAblehnen: (id, body) => reisebild(mediaPhotoboxUrl(id, "reject"), body),
        reisebildKorrigieren: (id, body) => reisebild(mediaPhotoboxUrl(id, "correct"), body),
        reisebildOffline: (id, body) => reisebild(mediaPhotoboxUrl(id, "offline"), body),
        reisebildErneutPruefen: (id, body) => reisebild(mediaPhotoboxUrl(id, "reopen"), body),
        plaetze: (kind, id, signal) => holen(mediaSubjectSlotsUrl(kind, id), signal),
        lizenzen: (signal) => holen(MEDIA_LICENSES_URL, signal),
        freigabeVorschau: (anfrage, signal) => holen(vorschauAdresse(anfrage), signal),
    };
}

/** `GET …/publication-preview` mit den Feldern als Abfrage; leere Felder fallen weg. */
export function vorschauAdresse(anfrage: MediaPublicationPreviewQuery): string {
    const parameter = new URLSearchParams();
    parameter.set("role", anfrage.role);
    parameter.set("basis", anfrage.basis);
    if (anfrage.licenseKey !== undefined && anfrage.licenseKey !== "") parameter.set("licenseKey", anfrage.licenseKey);
    if (anfrage.clearance !== undefined) parameter.set("clearance", anfrage.clearance);
    // Die Entstehung entscheidet mit (Betreiber 2026-10-10: KI-generierte eigene Werke sind öffentlich, andere warten auf die Prüfung).
    if (anfrage.creation !== undefined) parameter.set("creation", anfrage.creation);
    return `${MEDIA_PUBLICATION_PREVIEW_URL}?${parameter.toString()}`;
}

/**
 * Hat der Server die Anfrage vielleicht schon ausgeführt? Ohne Antwort (Netz) oder bei 5xx ist es unklar: Dann bleibt die Kennung.
 * Jede andere Antwort ist eindeutig.
 */
export function ausgangUnklar(error: unknown): boolean {
    return !(error instanceof ApiFailure) || error.status === 0 || error.status >= 500;
}

/**
 * Eine Benutzerhandlung mit ihrer Kennung. `fuehreAus` behält die Kennung nur, solange der Ausgang unklar ist (siehe oben); nach einer
 * Antwort ist sie verbraucht.
 */
export class Handlung {
    #id: string = newOperationId();

    get id(): string {
        return this.#id;
    }

    async fuehreAus<T>(lauf: (operationId: string) => Promise<T>): Promise<T> {
        try {
            const ergebnis = await lauf(this.#id);
            this.#id = newOperationId();
            return ergebnis;
        } catch (error) {
            if (!ausgangUnklar(error)) this.#id = newOperationId();
            throw error;
        }
    }
}

/** Die Kennung des Assets, das eine Quittung anlegt oder ändert. */
export function assetDerQuittung(quittung: OperationReceipt): string | undefined {
    return quittung.affected.find((eintrag) => eintrag.kind === "media_asset")?.id;
}

// --- Datei in die Anfrage ---

/** Bytes als Base64, in Stücken, damit große Dateien den Stapel nicht sprengen. */
export async function alsBase64(datei: Blob): Promise<string> {
    const bytes = new Uint8Array(await datei.arrayBuffer());
    let binaer = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
        binaer += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return btoa(binaer);
}

/** Der Dateiname nur zur Anzeige: ohne Pfad, höchstens 255 Zeichen, nie leer. */
export function anzeigeDateiname(name: string): string {
    const ohnePfad = name.split(/[/\\]/u).pop()?.trim() ?? "";
    const kurz = ohnePfad.slice(0, 255);
    return kurz === "" ? "datei" : kurz;
}

export async function dateiFuerAnfrage(datei: File): Promise<MediaFileUpload> {
    return { name: anzeigeDateiname(datei.name), dataBase64: await alsBase64(datei) };
}

/** Der Rumpf einer Kartendatei (`MediaKarteDateiKopf`): vier Byte Länge, der Kopf als JSON, dann die Bytes der Datei, ohne sie in den Speicher zu lesen. */
export function kartenDateiRumpf(kopf: MediaKarteDateiKopf, datei: Blob): Blob {
    const text = new TextEncoder().encode(JSON.stringify(kopf));
    const laenge = new Uint8Array(4);
    new DataView(laenge.buffer).setUint32(0, text.byteLength);
    return new Blob([laenge, text, datei]);
}

// --- Hochladen, dann binden: zwei Operationen auf einen Klick (WI-0126 §11j) ---

/** Wohin das neue Bild gebunden wird; der gesehene Stand kommt aus den Plätzen (`MediaSubjectSlots`). */
export type Bindung =
    | {
          rolle: "coat";
          subject: MediaSlotSubjectRef;
          /** Revision der aktiven Bindung, wenn ein Wappen gesetzt ist (ersetzen). */
          baseRevision?: number;
          /** Sonst der gesehene Zustand des Platzes. */
          baseState?: "undecided" | "none";
      }
    | {
          rolle: "header";
          placeId: string;
          /** Revision des Einzelbilds, wenn eins das Titelbild ist (ersetzen). */
          baseRevision?: number;
          /** Revision der Galerie, wenn eine das Titelbild ist (sie wird gelöst). */
          galleryRevision?: number;
          /** Sonst der gesehene Zustand des Platzes. */
          baseState?: "undecided" | "none";
      };

/**
 * Die Bindung aus dem gesehenen Stand der Plätze: Ist ein Wappen gesetzt, geht die Revision der Bindung mit (ersetzen), sonst der
 * Zustand des Platzes. Am Titelbild genauso (WI-0219, EIN Bild ODER EINE Galerie): die Revision des Einzelbilds, die der Galerie oder
 * der Zustand. Die EINE Stelle, an der der gesehene Stand aus den Plätzen kommt (Auswahl und Formular rufen sie).
 */
export function bindungAusPlaetzen(plaetze: MediaSubjectSlots, rolle: "coat" | "header"): Bindung {
    const subject: MediaSlotSubjectRef = { kind: plaetze.subject.kind, id: plaetze.subject.id };
    if (rolle === "coat") {
        const platz = plaetze.coat;
        return platz.state === "set" && platz.revision !== null
            ? { rolle, subject, baseRevision: platz.revision }
            : { rolle, subject, baseState: platz.state === "none" ? "none" : "undecided" };
    }
    const platz = plaetze.header;
    const bild = platz?.image ?? null;
    const galerie = platz?.gallery ?? null;
    if (bild !== null) return { rolle, placeId: subject.id, baseRevision: bild.revision };
    if (galerie !== null) return { rolle, placeId: subject.id, galleryRevision: galerie.revision };
    return { rolle, placeId: subject.id, baseState: platz?.suppressed === true ? "none" : "undecided" };
}

/**
 * Bindet ein Asset an den Platz, den die Bindung nennt: ein Wappen bzw. das Titelbild setzen oder ersetzen. Die EINE Stelle für
 * Formular („Hochladen und binden“) und Auswahl.
 */
export function bindeAsset(
    operationen: MedienOperationen,
    bindung: Bindung,
    assetId: string,
    operationId: string,
): Promise<OperationReceipt> {
    return bindung.rolle === "coat"
        ? operationen.wappenSetzen({
              operationId,
              subject: bindung.subject,
              assetId,
              ...(bindung.baseRevision === undefined ? {} : { baseRevision: bindung.baseRevision }),
              ...(bindung.baseState === undefined ? {} : { baseState: bindung.baseState }),
          })
        : operationen.titelbildSetzen({
              operationId,
              placeId: bindung.placeId,
              assetId,
              ...(bindung.baseRevision === undefined ? {} : { baseRevision: bindung.baseRevision }),
              ...(bindung.galleryRevision === undefined ? {} : { galleryRevision: bindung.galleryRevision }),
              ...(bindung.baseState === undefined ? {} : { baseState: bindung.baseState }),
          });
}

/**
 * Ein Ablauf „Hochladen und binden“. Er überlebt einen Fehlschlag: Ist das Asset schon angelegt (`assetId`), lädt ein zweiter Versuch
 * nicht noch einmal hoch, sondern bindet nur. Jede der beiden Operationen hat ihre eigene `Handlung`.
 */
export interface HochladeAblauf {
    readonly hochladen: Handlung;
    readonly binden: Handlung;
    assetId: string | undefined;
    hochgeladen: OperationReceipt | undefined;
}

export function neuerAblauf(): HochladeAblauf {
    return { hochladen: new Handlung(), binden: new Handlung(), assetId: undefined, hochgeladen: undefined };
}

export interface AblaufErgebnis {
    assetId: string;
    hochgeladen: OperationReceipt;
    gebunden: OperationReceipt | undefined;
}

/**
 * Lädt hoch (falls noch nicht geschehen) und bindet danach, wenn eine Bindung gewünscht ist. Scheitert das Binden, bleibt das Asset;
 * der Fehler geht an den Aufrufer, und ein neuer Aufruf mit demselben Ablauf bindet nur noch.
 */
export async function hochladenUndBinden(
    operationen: MedienOperationen,
    ablauf: HochladeAblauf,
    datei: () => Promise<MediaFileUpload>,
    form: MediaUploadForm,
    bindung: Bindung | undefined,
): Promise<AblaufErgebnis> {
    if (ablauf.assetId === undefined || ablauf.hochgeladen === undefined) {
        const file = await datei();
        const quittung = await ablauf.hochladen.fuehreAus((id) => operationen.hochladen(id, file, form));
        const assetId = assetDerQuittung(quittung);
        if (assetId === undefined) throw new ApiFailure(500, "unavailable", "Die Quittung nennt kein Asset.");
        ablauf.assetId = assetId;
        ablauf.hochgeladen = quittung;
    }
    const assetId = ablauf.assetId;
    const hochgeladen = ablauf.hochgeladen;
    if (bindung === undefined) return { assetId, hochgeladen, gebunden: undefined };
    const gebunden = await ablauf.binden.fuehreAus((operationId) =>
        bindeAsset(operationen, bindung, assetId, operationId),
    );
    return { assetId, hochgeladen, gebunden };
}

// --- Was die Oberfläche zu einem Fehler einer Operation sagt ---

export interface OperationsFehler extends MedienFehler {
    /** Bei 409 `edit_conflict`: wer wann geändert hat (aus dem Fachprotokoll). */
    konflikt: EditConflictDetails | undefined;
    /** Bei 400 `validation_failed`: die Befunde je Feld (Pfad und Regel). */
    befunde: MediaFormIssue[];
}

const GRUND_DER_DATEI: Readonly<Record<string, MessageKey>> = {
    too_many_pixels: "medien.op.datei.pixel",
    too_large_dimensions: "medien.op.datei.kante",
    animated_or_multiframe: "medien.op.datei.mehrbild",
    svg_has_text: "medien.op.datei.svgText",
    svg_forbidden_content: "medien.op.datei.svgInhalt",
    coat_too_small: "medien.op.datei.wappenKlein",
    coat_not_transparent: "medien.op.datei.wappenDeckend",
};

const FACHCODE: Readonly<Record<string, MessageKey>> = {
    idempotency_key_reused: "medien.op.kennung",
    map_locked: "medien.op.kartensperre",
    system_locked: "medien.op.systemsperre",
    community_license_locked: "medien.bearbeiten.communityLizenz",
    unsupported_media_type: "medien.op.typ",
    gallery_full: "medien.op.galerieVoll",
    media_already_bound: "medien.op.schonGebunden",
    media_not_bound: "medien.op.nichtGebunden",
    media_kind_not_bindable: "medien.op.nichtBindbar",
    media_type_mismatch: "medien.op.typFalsch",
    media_storage_unavailable: "medien.op.speicher",
    // Der Einzelbild-Notaus (WI-0068): die Bytes halten schon einen, oder sie halten gerade keinen.
    media_already_suspended: "medien.op.schonAusgeblendet",
    media_not_suspended: "medien.op.nichtAusgeblendet",
    media_without_source: "medien.op.ohneOriginal",
    // Endgültig löschen (WI-0068 R4): der Sammelsatz nur, wenn der Server keinen bekannten Grund nennt (sonst `loeschHindernisSatz`, unten).
    media_not_deletable: "medien.op.nichtLoeschbar",
    media_already_exists: "medien.op.vorhanden",
    merge_preview_stale: "medien.op.vorschauVeraltet",
    // Die eingebauten Grafiken liegen auf dieser Instanz nicht vor (503): kein Fehler der Bedienung, ein Umstand der Instanz.
    type_images_unavailable: "medien.op.typbilderFehlen",
    // Der Legacy-Zug schreibt gerade die Kartensammlung (503, WI-0068 R5): ein Umstand, kein Fehler; gleich noch einmal.
    map_import_running: "medien.op.zugLaeuft",
    // Einen Eintrag der Kartensammlung entfernen oder zurückholen (WI-0287): doppelt ausgeführt.
    citymap_already_retired: "medien.op.karteSchonEntfernt",
    citymap_not_retired: "medien.op.karteNichtEntfernt",
    // Ein stillgelegter Eintrag nimmt kein Bild mehr an (WI-0287).
    citymap_retired: "medien.op.karteEntfernt",
    // Bilder an einen anderen Eintrag geben (WI-0287 Stufe 2): Das Ziel ist inzwischen stillgelegt, oder es ist der Eintrag selbst.
    citymap_target_retired: "medien.op.zielStillgelegt",
    citymap_merge_self: "medien.op.zielSelbst",
    // Orte und Regionen eines Eintrags (WI-0287 Stufe 3): das Ziel hängt schon, oder die Zeile ist schon zugeordnet.
    citymap_target_present: "medien.op.zielSchonDa",
    citymap_place_resolved: "medien.op.zeileSchonZugeordnet",
    // „Vorschau erzeugen“ (WI-0287 Punkt 5): dieselben Sätze wie unter dem Knopf, dazu der belegte Platz und eine Karte, die nicht mehr hier hängt.
    preview_source_suspended: "medien.karten.vorschau.sperre.suspended",
    preview_rights_unknown: "medien.karten.vorschau.sperre.rights_unknown",
    preview_source_missing: "medien.karten.vorschau.sperre.file_missing",
    preview_taken: "medien.op.vorschauBelegt",
    preview_source_not_bound: "medien.op.vorschauOhneKarte",
    // Rechte und Entstehung einer erzeugten Vorschau ändern sich nur an ihrer Karte.
    media_rights_follow_source: "medien.op.rechteFolgenKarte",
    // Reisebilder prüfen (WI-0272 S3): Der Zustand der Einreichung erlaubt die Handlung nicht (mehr), oder eine Angabe stimmt nicht.
    // Reisebilder bleiben in ihren Rollen (Fixrunde zu S3): nicht binden, nicht zusammenführen.
    media_photobox_not_bindable: "medien.op.reisebildNichtBindbar",
    media_photobox_not_mergeable: "medien.op.reisebildNichtZusammen",
    // Eines der Werke ist inzwischen schon in einem anderen aufgegangen (OPS-000096), etwa aus einem zweiten Fenster.
    media_already_merged: "medien.op.schonAufgegangen",
    photobox_transition: "medien.op.photoboxUebergang",
    photobox_invalid: "medien.op.photoboxUngueltig",
};

function befundeAus(details: Record<string, unknown> | undefined): MediaFormIssue[] {
    const issues = details?.["issues"];
    if (!Array.isArray(issues)) return [];
    return issues.filter(
        (eintrag): eintrag is MediaFormIssue =>
            typeof eintrag === "object" &&
            eintrag !== null &&
            typeof (eintrag as { path?: unknown }).path === "string" &&
            typeof (eintrag as { rule?: unknown }).rule === "string",
    );
}

function konfliktAus(details: Record<string, unknown> | undefined): EditConflictDetails | undefined {
    const revision = details?.["currentRevision"];
    if (typeof revision !== "number") return undefined;
    const wer = details?.["changedBy"] as { id?: unknown; displayName?: unknown } | undefined;
    const am = details?.["changedAt"];
    return {
        currentRevision: revision,
        ...(typeof am === "string" ? { changedAt: am } : {}),
        ...(typeof wer?.id === "string" && typeof wer.displayName === "string"
            ? { changedBy: { id: wer.id, displayName: wer.displayName } }
            : {}),
    };
}

const MB = (bytes: number): string => formatNumber(bytes / 1024 / 1024, 0);
const KB = (bytes: number): string => formatNumber(bytes / 1024, 0);

/**
 * Text, Ton und „lohnt ein zweiter Versuch“ zu einem Fehler einer Operation (ADR-0018: nach dem stabilen Code). Was keine Operation
 * betrifft (Anmeldung, Netz, Server), sagt `medienFehler`; nur „fehlt das Recht“ heißt hier allgemein, weil es nicht ums Öffnen geht.
 */
export function operationsFehler(error: unknown): OperationsFehler {
    const failure = alsApiFailure(error);
    const basis = medienFehler(failure);
    const mit = (text: string, ton: MedienFehler["ton"], erneut: boolean): OperationsFehler => ({
        code: failure.code,
        status: failure.status,
        text,
        ton,
        erneut,
        konflikt: undefined,
        befunde: [],
    });
    switch (failure.code) {
        case "edit_conflict": {
            const konflikt = konfliktAus(failure.details);
            const text =
                konflikt?.changedBy === undefined
                    ? t("medien.op.konflikt")
                    : t("medien.op.konfliktVon", { wer: konflikt.changedBy.displayName });
            return { ...mit(text, "warnung", false), konflikt };
        }
        case "validation_failed":
            return { ...mit(t("medien.op.formular"), "warnung", false), befunde: befundeAus(failure.details) };
        case "payload_too_large":
            return mit(
                t("medien.op.datei.gross", {
                    raster: MB(MEDIA_UPLOAD_LIMITS.maxRasterBytes),
                    svg: KB(MEDIA_UPLOAD_LIMITS.maxSvgBytes),
                }),
                "gefahr",
                false,
            );
        case "failed":
            // Der Proxy vor dem Server weist eine zu große Datei ab (413 ohne unseren Umschlag): Karten sind bis 50 MB erlaubt, Nginx lässt heute weniger durch.
            if (failure.status === 413) return mit(t("medien.op.datei.grossProxy"), "gefahr", false);
            break;
        case "media_file_rejected": {
            const grund = failure.details?.["reason"];
            const schluessel = typeof grund === "string" ? GRUND_DER_DATEI[grund] : undefined;
            return mit(t(schluessel ?? "medien.op.datei.unlesbar"), "gefahr", false);
        }
    }
    // WI-0291: Die Reisebild-Redaktion nennt den genauen Grund (Stelle, Ort, leeres Feld, Zustand), nicht den Sammelsatz „Stelle, Ort oder Text passen nicht“.
    if (failure.code === "photobox_invalid" || failure.code === "photobox_transition") {
        const genau = redaktionGrund(failure);
        if (genau !== undefined) return mit(genau, failure.status === 409 ? "warnung" : "gefahr", false);
    }
    // WI-0291, WI-0272: Endgültig löschen nennt den genauen Grund (`details.reason`: importiert, erzeugt, verwendet, offene Einsendung …), derselbe Satz wie am gesperrten Knopf.
    if (failure.code === "media_not_deletable") {
        const grund = failure.details?.["reason"];
        if (istLoeschHindernis(grund)) return mit(loeschHindernisSatz(grund), "gefahr", false);
    }
    const fach = FACHCODE[failure.code];
    if (fach !== undefined) {
        const erneut = failure.code === "media_storage_unavailable";
        const ton = failure.status === 423 || erneut || failure.code === "map_import_running" ? "warnung" : "gefahr";
        return mit(t(fach), ton, false);
    }
    if (failure.status === 403 && failure.code !== "assurance_required" && failure.code !== "reauth_required") {
        return mit(t("medien.op.recht"), "gefahr", false);
    }
    // Ein anderer klarer Fachfehler: nicht wiederholen, den Code nennen.
    if ([400, 409, 413, 415, 422, 423].includes(failure.status)) {
        return mit(t("medien.op.sonst", { code: failure.code }), "warnung", false);
    }
    // Anmeldung, Bestätigung, „gibt es nicht“, Netz und Server wie beim Lesen.
    return { ...basis, konflikt: undefined, befunde: [] };
}
