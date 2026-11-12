import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { STATUS_SCHLUESSEL_MUSTER } from "./community.ts";
import { MEDIA_EDITOR_URL, type MediaCreationMethod } from "./media-editor.ts";
import { MediaFileUpload } from "./media-editor-operations.ts";
import { OperationId } from "./operation.ts";
import {
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_LIMITS,
    PHOTOBOX_REFERENCE_KINDS,
    PHOTOBOX_SUBMISSION_STATES,
    PHOTOBOX_USAGE_GRANTS,
    PhotoboxLage as Lage,
    type PhotoboxCreationKind,
    type PhotoboxSubmissionState,
    type PhotoboxUsageGrant,
} from "./photobox-sicht.ts";

// Die Grundlagen stehen in `photobox-sicht.ts` (Importkreis mit `media-editor.ts`); von hier aus bleiben sie unter denselben Namen erreichbar.
export {
    MAM_EINREICHUNGEN,
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_LIMITS,
    PHOTOBOX_REFERENCE_KINDS,
    PHOTOBOX_SUBMISSION_STATES,
    PHOTOBOX_UNENTSCHIEDEN,
    PHOTOBOX_USAGE_GRANTS,
    PhotoboxSubmissionView,
    photoboxUnterteilung,
    type MamEinreichung,
    type PhotoboxCreationKind,
    type PhotoboxSubmissionState,
    type PhotoboxUsageGrant,
} from "./photobox-sicht.ts";
import { ReisebildKarte } from "./photobox-karte.ts";

/**
 * Die gemeinsamen Verträge der Reisebild-Einreichung (WI-0272 §12, Scheibe S1 „Datenkern“): Zustände, Entstehung,
 * Lizenzwahl und Grenzen. Server (Tafel `media_submission`, Routen, Aufbewahrung) und Web (Formular, Leiste, Eingang) lesen
 * alle hier; keine zweite Liste, kein zweiter Wortlaut.
 *
 * 🔴 Die Datenbank wiederholt die harten Zusagen (Migration 0274): eine Avesmaps-Aufnahme unter CC BY weist sie ab, nicht
 * nur das Formular.
 */

/** Die Entstehung im Medienkern (`media_asset.creation_method`) je Wahl des Einreichers. */
export const PHOTOBOX_CREATION_METHOD: Readonly<Record<PhotoboxCreationKind, MediaCreationMethod>> = {
    drawing: "drawing",
    photo: "photo",
    ai_generated: "ai_generated",
    avesmaps_capture: "derived",
};

/**
 * Was die Lizenzwahl im Medienkern bedeutet: die Rechtsgrundlage (`media_rights.basis`) und der Schlüssel im Lizenzkatalog
 * (`cc-by-4.0`, Migration 0064). `permission` und CC BY machen ein Bild NIE von selbst öffentlich; es braucht Freigabe.
 */
export const PHOTOBOX_RIGHTS: Readonly<
    Record<PhotoboxUsageGrant, { basis: "permission" | "license"; licenseKey: string | null }>
> = {
    avesmaps_only: { basis: "permission", licenseKey: null },
    "cc-by-4.0": { basis: "license", licenseKey: "cc-by-4.0" },
};

/** 🔴 Eine Avesmaps-Aufnahme (Bild aus der Karte selbst) gibt es nur für Avesmaps, nie unter CC BY. */
export function photoboxGrantAllowed(kind: PhotoboxCreationKind, grant: PhotoboxUsageGrant): boolean {
    return kind !== "avesmaps_capture" || grant === "avesmaps_only";
}

// --- Scheibe S2 „Einreichen und Status“: die öffentlichen Routen (WI-0272 §12/§13) -------------------------------------------------------

/** Die Adresse der öffentlichen Routen (`/api/photobox/…`): ohne Konto, der Statusschlüssel steht im Rumpf, nie in der Adresse. */
export const PHOTOBOX_URL = "/api/photobox";

/** Die Statusseite des Einreichers: `/reisebild#<Schlüssel>`; das Fragment verlässt den Browser nie (wie `/meldung` der Community). */
export const REISEBILD_STATUS_PFAD = "/reisebild";

/**
 * Die Fassung der Nutzungsbedingungen und des Datenschutztextes, der der Einreicher beim Absenden zustimmt (WI-0272 §13). Das Schema nimmt
 * nur diese Fassung an; ein veraltetes Formular wird abgewiesen, statt eine Zustimmung zu einem anderen Text zu speichern. Eine neue Fassung
 * ist eine neue Zeichenkette (Datum der Freigabe durch Vali).
 */
export const PHOTOBOX_TERMS_VERSION = "reisebilder-2026-11-04";

/**
 * Die Grenzen der öffentlichen Routen (Regler melden, WI §9): Einreichungen je Adresse und Stunde sowie gesamt je Tag, Statusaktionen je Adresse
 * und Stunde, die Mindestdauer zwischen dem Öffnen und dem Absenden des Formulars (Zeitfalle, wie `COMMUNITY_GRENZEN.mindestDauerMs`) und die
 * Größe der Anfrage: ein Bild bis 6 MiB als Base64 (rund 8 MiB) plus die Felder. Gezählt wird nur im Speicher, nie gespeichert.
 * `ersetzungenJeEinreichung` ist die Zahl der Bildersetzungen, die eine Einreichung erlebt (die sechste ist 409 `photobox_replace_limit`); gezählt wird
 * in der Datenbank über die Zeilen des Eingangs, nicht im Speicher.
 */
export const PHOTOBOX_GRENZEN = {
    mindestDauerMs: 3000,
    jeAdresseJeStunde: 6,
    jeTag: 200,
    statusJeStunde: 20,
    // Lesen der Statusseite (`/status`, `/status/vorschau`) getrennt von den Aktionen: ein Aufruf kostet zwei, die Vorschau wird nachgefragt.
    statusLesenJeStunde: 120,
    rumpfBytes: 9 * 1024 * 1024,
    ersetzungenJeEinreichung: 5,
    /** „Gefällt mir“ an einem Reisebild, wie bei den Bewertungen: leichter als Einreichen, aber nicht frei; je Adresse, nur im Speicher. */
    gefaelltJeAdresseJeStunde: 120,
} as const;

const strict = { additionalProperties: false } as const;
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));
const Moment = Type.String();
const Uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" });
/** Der Statusschlüssel: 32 Zufallsbytes base64url, im Browser erzeugt (wie die Community). Gespeichert wird nur sein SHA-256-Wert. */
const Schluessel = Type.String({ pattern: STATUS_SCHLUESSEL_MUSTER });
/** Nicht leer und nicht nur Leerraum (die Datenbank zählt nach `btrim`); die Länge ist die der Tafel (`media_submission_description_len`). */
const Beschreibung = Type.String({ minLength: 1, maxLength: PHOTOBOX_LIMITS.descriptionMax, pattern: "\\S" });
const Nennung = Type.String({ minLength: 1, maxLength: PHOTOBOX_LIMITS.attributionMax, pattern: "\\S" });
/** Honigtopf (`feld` bleibt leer) und Zeitfalle (`dauerMs` zwischen Öffnen und Absenden), Form wie bei der Community. */
const Falle = Type.Object({ feld: Type.String({ maxLength: 200 }), dauerMs: Type.Integer({ minimum: 0 }) }, strict);

/**
 * `POST /api/photobox/einreichungen` (öffentlich): ein Reisebild mit seiner Stelle. `operationId` und `schluessel` erzeugt das Formular beim Öffnen
 * (Idempotenz, M10); der Schlüssel öffnet die Statusseite. Das Bild ist ein JPEG, PNG, WebP oder GIF bis 6 MiB, die Bytes entscheiden über das
 * Format, der Name wird nie gespeichert. `placeId` ist die öffentliche Kennung des gewählten Ortes, `bezug` ein anderes Ziel der Suche (Landschaft,
 * Weg, Klima oder ein Ort ohne `placeId`); die Stelle in `lage` ist immer da. `bedingungen` nennt die Fassung der Nutzungsbedingungen (nur die heutige).
 */
export const PhotoboxEinreichung = Type.Object(
    {
        operationId: OperationId,
        schluessel: Schluessel,
        bild: MediaFileUpload,
        lage: Lage,
        placeId: Type.Optional(Uuid),
        bezug: Type.Optional(
            Type.Object(
                { art: literals(PHOTOBOX_REFERENCE_KINDS), id: Type.String({ minLength: 1, maxLength: 200 }) },
                strict,
            ),
        ),
        blickrichtung: Type.Optional(Type.Integer({ minimum: 0, maximum: PHOTOBOX_LIMITS.viewDirections - 1 })),
        entstehung: literals(PHOTOBOX_CREATION_KINDS),
        nutzung: literals(PHOTOBOX_USAGE_GRANTS),
        beschreibung: Beschreibung,
        name: Type.Optional(Nennung),
        bedingungen: Type.Literal(PHOTOBOX_TERMS_VERSION),
        falle: Falle,
    },
    strict,
);
export type PhotoboxEinreichung = Static<typeof PhotoboxEinreichung>;

/** `GET /api/photobox/stand`: nimmt dieser Server gerade neue Reisebilder an? Falsch bei ausgeschaltetem Schalter `photobox.submissions` und ohne die Tafel. */
export const PhotoboxStand = Type.Object({ einreichen: Type.Boolean() }, strict);
export type PhotoboxStand = Static<typeof PhotoboxStand>;

/**
 * `POST /api/photobox/reisebilder/:id/gefaellt` (WI-0304, wie die Bewertungen WI-0269 C10): `1` setzt „Gefällt mir“, `-1` nimmt es zurück. `:id` ist die Kennung, unter der die Karte das
 * Reisebild kennt (`ReisebildKarte.id`). Die Datenbank zählt nur eine Zahl; wer es war, wird nie gespeichert, „einmal je Browser“ hält der Browser.
 */
export const PhotoboxGefaelltParams = Type.Object({ id: Uuid }, strict);
export type PhotoboxGefaelltParams = Static<typeof PhotoboxGefaelltParams>;
export const PhotoboxGefaelltBody = Type.Object({ delta: Type.Union([Type.Literal(1), Type.Literal(-1)]) }, strict);
export type PhotoboxGefaelltBody = Static<typeof PhotoboxGefaelltBody>;
export const PhotoboxGefaelltAntwort = Type.Object({ gefaellt: Type.Integer({ minimum: 0 }) }, strict);
export type PhotoboxGefaelltAntwort = Static<typeof PhotoboxGefaelltAntwort>;

/** Die Antwort auf `POST /api/photobox/einreichungen` (201): eingegangen. Die Falle (Honigtopf, Zeitfalle) antwortet mit demselben Satz und legt nichts an. */
export const PhotoboxEingegangen = Type.Object({ ok: Type.Literal(true) }, strict);
export type PhotoboxEingegangen = Static<typeof PhotoboxEingegangen>;

/** `POST /api/photobox/status` (und `…/status/vorschau`): der Schlüssel geht im Rumpf, damit er in keinem Log steht. */
export const PhotoboxStatusBody = Type.Object({ schluessel: Schluessel }, strict);
export type PhotoboxStatusBody = Static<typeof PhotoboxStatusBody>;

/** Die Grundlage jeder Statusaktion: der Schlüssel und die Operation (M10, jede Aktion höchstens einmal). */
const AktionBasis = { schluessel: Schluessel, operationId: OperationId } as const;
const aktion = <T extends Record<string, TSchema>>(felder: T) => Type.Object({ ...AktionBasis, ...felder }, strict);

/** `…/status/beschreibung`: vor der Freigabe gilt sie sofort, danach wartet sie auf die Prüfung der Redaktion (`pending_description`). */
export const PhotoboxBeschreibung = aktion({ beschreibung: Beschreibung });
export type PhotoboxBeschreibung = Static<typeof PhotoboxBeschreibung>;
/** `…/status/bild`: ein neues Bild vor der Freigabe; die Einreichung geht zurück auf „eingegangen“. */
export const PhotoboxBildErsetzen = aktion({ bild: MediaFileUpload });
export type PhotoboxBildErsetzen = Static<typeof PhotoboxBildErsetzen>;
/** `…/status/nutzung`: die Lizenzwahl; nach der Freigabe nur noch zu `cc-by-4.0` (`photoboxAktionErlaubt`). */
export const PhotoboxNutzung = aktion({ nutzung: literals(PHOTOBOX_USAGE_GRANTS) });
export type PhotoboxNutzung = Static<typeof PhotoboxNutzung>;
/** `…/status/zurueckziehen`: nur vor der Freigabe. */
export const PhotoboxZurueckziehen = aktion({});
export type PhotoboxZurueckziehen = Static<typeof PhotoboxZurueckziehen>;
/** `…/status/offline`: nur nach der Freigabe; nimmt das Bild sofort aus Avesmaps und ist nicht rückgängig zu machen. */
export const PhotoboxOffline = aktion({});
export type PhotoboxOffline = Static<typeof PhotoboxOffline>;

/**
 * Was die Statusseite sieht (WI-0272 §12): der Zustand der Einreichung, die eigenen Angaben und was die Redaktion dazu sagte. Nie der Schlüssel,
 * nie ein Name der Redaktion, nie eine interne Kennung. `beschreibung` ist die geltende Fassung, `wartendeBeschreibung` die nach der Freigabe
 * geänderte, die auf Prüfung wartet; `nachricht` die Antwort der Redaktion bei Rückfrage oder Ablehnung; `angepasst` heißt „von der Redaktion
 * angepasst“. `vorschauBereit`: die Vorschau (`…/status/vorschau`) ist berechnet; die interne, solange das Bild privat ist, danach die veröffentlichte Datei.
 * `vorschauGesperrt`: die Datei liegt in Quarantäne (Inhaltsschalter, Notaus) und kommt nicht von selbst wieder; die Seite fragt nicht weiter nach (nur wenn wahr gesendet).
 * `bildEntfernt`: Der Betreiber hat das Bild endgültig gelöscht (WI-0272, `media_submission.media_deleted_at`, Migration 0328); die Einreichung bleibt ohne Datei, es gibt
 * keine Vorschau und keine Aktion mehr (nur wenn wahr gesendet). `ortName` ist der Ort, auf den sich das Bild bezieht.
 */
export const PhotoboxStatus = Type.Object(
    {
        zustand: literals(PHOTOBOX_SUBMISSION_STATES),
        eingereichtAm: Moment,
        beschreibung: Type.String(),
        wartendeBeschreibung: Type.Optional(Type.String()),
        nachricht: Type.Optional(Type.String()),
        entstehung: literals(PHOTOBOX_CREATION_KINDS),
        nutzung: literals(PHOTOBOX_USAGE_GRANTS),
        blickrichtung: Type.Optional(Type.Integer({ minimum: 0, maximum: PHOTOBOX_LIMITS.viewDirections - 1 })),
        name: Type.Optional(Type.String()),
        lage: Lage,
        ortName: Type.Optional(Type.String()),
        vorschauBereit: Type.Boolean(),
        vorschauGesperrt: Type.Optional(Type.Literal(true)),
        bildEntfernt: Type.Optional(Type.Literal(true)),
        angepasst: Type.Boolean(),
        /** Das veröffentlichte Bild, wie die Karte es kennt: nur, solange Besucher es sehen dürfen. „Meine Reisebilder“ in der Leiste zeigt damit auch eigene Bilder außerhalb des Ausschnitts. */
        karte: Type.Optional(ReisebildKarte),
    },
    strict,
);
export type PhotoboxStatus = Static<typeof PhotoboxStatus>;

/** Was der Einreicher auf der Statusseite tun kann. */
export const PHOTOBOX_AKTIONEN = ["beschreibung", "bild", "zurueckziehen", "offline", "nutzung"] as const;
export type PhotoboxAktion = (typeof PHOTOBOX_AKTIONEN)[number];

/**
 * 🔴 Welche Aktion der Zustand erlaubt (Server und Oberfläche fragen dieselbe Stelle):
 * - vor der Freigabe (`incoming`, `pending`, `changes_requested`): Beschreibung, Bild, Zurückziehen und Lizenzwahl beliebig, aber nicht „offline“;
 * - nach der Freigabe (`approved`): Beschreibung (sie wartet auf Prüfung), Offline-Nehmen und die Lizenzwahl nur noch zu `cc-by-4.0` (mehr zu erlauben
 *   ändert nichts an der Freigabe; zurück zu `avesmaps_only` geht nicht, wer das will, nimmt das Bild offline). Ohne `nutzungZiel` fragt der Aufrufer
 *   nur, ob die Wahl noch offen ist; die Route übergibt immer das gewählte Ziel;
 * - technisch gescheitert (`technical_failed`): ein anderes Bild schicken oder zurückziehen; sonst hinge die kaputte Einreichung 60 Tage bis zum Verfall;
 * - sonst nichts (abgelehnt, zurückgezogen, offline, verfallen und geleert).
 */
export function photoboxAktionErlaubt(
    zustand: PhotoboxSubmissionState,
    aktion: PhotoboxAktion,
    nutzungZiel?: PhotoboxUsageGrant,
): boolean {
    switch (zustand) {
        case "incoming":
        case "pending":
        case "changes_requested":
            return aktion !== "offline";
        case "approved":
            if (aktion === "beschreibung" || aktion === "offline") return true;
            return aktion === "nutzung" && (nutzungZiel === undefined || nutzungZiel === "cc-by-4.0");
        case "technical_failed":
            return aktion === "bild" || aktion === "zurueckziehen";
        default:
            return false;
    }
}

// --- Scheibe S3 „Prüfen und Freigeben“: die Operationen der Redaktion (WI-0272 §12, Medienverwaltung) ----------------------------------------

/**
 * Die Operationen der Redaktion an einer Einreichung, als Adressteil: `approve` (freigeben), `ask` (Rückfrage an den Einreicher), `reject`
 * (ablehnen), `correct` (Angaben berichtigen), `offline` (eine freigegebene Einreichung zurücknehmen) und `reopen` (eine freigegebene Einreichung erneut
 * zur Prüfung stellen). Dieselben Namen stehen im Protokoll der Medien als `photobox.<aktion>`-Operationen.
 */
export const PHOTOBOX_REDAKTION_AKTIONEN = ["approve", "ask", "reject", "correct", "offline", "reopen"] as const;
export type PhotoboxRedaktionAktion = (typeof PHOTOBOX_REDAKTION_AKTIONEN)[number];

/**
 * `POST /api/editor/media/photobox/:id/<aktion>`: die Medienverwaltung, nie öffentlich. `:id` ist die öffentliche Kennung der Einreichung
 * (`media_submission.public_id`), nie der Statusschlüssel des Einreichers.
 */
export const MEDIA_PHOTOBOX_URL = `${MEDIA_EDITOR_URL}/photobox`;
export const mediaPhotoboxUrl = (id: string, aktion: PhotoboxRedaktionAktion): string =>
    `${MEDIA_PHOTOBOX_URL}/${encodeURIComponent(id)}/${aktion}`;

/** Die Länge von Rückfrage und Ablehnungsgrund, so lang wie die Spalte `media_submission.editor_message` (1 bis 1000 Zeichen nach `btrim`). */
export const PHOTOBOX_NACHRICHT_MAX = 1000;
const Nachricht = Type.String({ minLength: 1, maxLength: PHOTOBOX_NACHRICHT_MAX, pattern: "\\S" });

/**
 * Jede Operation der Redaktion trägt die Kennung der Operation (M10, höchstens einmal) und die Revision der Einreichung, die die Oberfläche sah
 * (`baseRevision`, ADR-0020): Hat sich die Einreichung inzwischen geändert, ist es 409 `edit_conflict`.
 */
const RedaktionBasis = { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) } as const;
const redaktion = <T extends Record<string, TSchema>>(felder: T) =>
    Type.Object({ ...RedaktionBasis, ...felder }, strict);

/** `…/approve` (Recht `moderate_submissions`): freigeben. Aus `pending` und `changes_requested`; nach der Freigabe übernimmt es eine wartende Beschreibung. */
export const PhotoboxRedaktionFreigeben = redaktion({});
export type PhotoboxRedaktionFreigeben = Static<typeof PhotoboxRedaktionFreigeben>;
/** `…/ask` (`moderate_submissions`): Rückfrage; die Nachricht steht auf der Statusseite des Einreichers. */
export const PhotoboxRedaktionRueckfrage = redaktion({ nachricht: Nachricht });
export type PhotoboxRedaktionRueckfrage = Static<typeof PhotoboxRedaktionRueckfrage>;
/** `…/reject` (`moderate_submissions`): ablehnen; der Grund steht auf der Statusseite des Einreichers. */
export const PhotoboxRedaktionAblehnen = redaktion({ grund: Nachricht });
export type PhotoboxRedaktionAblehnen = Static<typeof PhotoboxRedaktionAblehnen>;
/**
 * `…/correct` (`moderate_submissions`): Angaben berichtigen; die Statusseite zeigt dann „von der Redaktion angepasst“. Alle Felder sind freiwillig,
 * mindestens eines muss da sein. Stelle, Ort und Bezug nur vor der Freigabe; die Beschreibung auch danach. `null` entfernt Ort oder Bezug.
 */
export const PhotoboxRedaktionKorrigieren = redaktion({
    lage: Type.Optional(Lage),
    placeId: Type.Optional(Type.Union([Uuid, Type.Null()])),
    bezug: Type.Optional(
        Type.Union([
            Type.Object(
                { art: literals(PHOTOBOX_REFERENCE_KINDS), id: Type.String({ minLength: 1, maxLength: 200 }) },
                strict,
            ),
            Type.Null(),
        ]),
    ),
    beschreibung: Type.Optional(Beschreibung),
});
export type PhotoboxRedaktionKorrigieren = Static<typeof PhotoboxRedaktionKorrigieren>;
/** `…/offline` (`publish_media`, ab Editor): eine freigegebene Einreichung zurücknehmen; wirkt sofort und lässt sich nicht rückgängig machen. */
export const PhotoboxRedaktionOffline = redaktion({});
export type PhotoboxRedaktionOffline = Static<typeof PhotoboxRedaktionOffline>;
/**
 * `…/reopen` (`moderate_submissions`): eine freigegebene Einreichung erneut zur Prüfung stellen. Sie wird wieder offen (`pending`), verschwindet aus Kopf,
 * Karte und Leiste und steht wieder im Eingang; anders als `offline` endet nichts, die nächste Entscheidung ist wieder frei.
 */
export const PhotoboxRedaktionErneutPruefen = redaktion({});
export type PhotoboxRedaktionErneutPruefen = Static<typeof PhotoboxRedaktionErneutPruefen>;

// --- Der Stapel neuer Reisebilder in Community › Meldungen (Aufgabe 19) ---------------------------------------------------------------

/** `GET /api/editor/media/photobox/stapel` (`view_media_private`): die Zahl der offenen Einreichungen und die Vorschauen der neuesten. */
export const MEDIA_PHOTOBOX_STAPEL_URL = `${MEDIA_PHOTOBOX_URL}/stapel`;
/** So viele Vorschauen trägt der Stapel höchstens (ein ruhiger Fächer, kein Bildband). */
export const PHOTOBOX_STAPEL_MAX = 5;

/**
 * Der Stapel: `offen` zählt wie die Unterteilung „offen“ des Korbs „PhotoBox-Uploads“ (`photoboxUnterteilung`: eingegangen, geprüft, und freigegeben mit
 * wartender Beschreibung), `vorschau` sind die internen Vorschauen der neuesten, höchstens fünf, neueste zuerst. Eine Vorschau nennt die Kennung des Mediums und die
 * Adresse des vorhandenen privaten Weges der Medienverwaltung (`…/:id/preview/intern_…`). 🔴 Sonst nichts: keine Beschreibung, kein Name, kein Ort, kein Schlüssel.
 */
export const PhotoboxStapel = Type.Object(
    {
        offen: Type.Integer({ minimum: 0 }),
        vorschau: Type.Array(Type.Object({ publicId: Uuid, url: Type.String() }, strict), {
            maxItems: PHOTOBOX_STAPEL_MAX,
        }),
    },
    strict,
);
export type PhotoboxStapel = Static<typeof PhotoboxStapel>;

// --- Die freigegebenen Reisebilder eines Ortes im Ortseditor (WI-0272, Panel „Reisebilder der Community“) ---------------------------------

/** So viele Reisebilder listet das Panel höchstens (der Rest steht im Korb „PhotoBox-Uploads“). */
export const PHOTOBOX_ORT_REISEBILDER_MAX = 100;
/** `GET /api/editor/media/photobox/ort/:id/reisebilder` (`view_media_private`, `no-store`): die freigegebenen Reisebilder dieses Ortes (`place.public_id`). */
export const MEDIA_PHOTOBOX_ORT_REISEBILDER_ROUTE = `${MEDIA_PHOTOBOX_URL}/ort/:id/reisebilder`;
export const mediaPhotoboxOrtReisebilderUrl = (ortId: string): string =>
    `${MEDIA_PHOTOBOX_URL}/ort/${encodeURIComponent(ortId)}/reisebilder`;

/**
 * Die freigegebenen Reisebilder eines Ortes für den Reiter „Bilder“ des Ortseditors (Vali 2026-11-02: „ein Panel "Reisebilder der Community" … wo die alle gelistet sind“): in der Reihenfolge der Freigabe, mit
 * Vorschau, Name und Entstehung, und die Stelle für „Zur Stelle“. `url` ist die öffentliche Datei oder, solange das Bild privat ist, die Vorschau der Medienverwaltung; `null`, solange keine gerechnet ist.
 */
export const PhotoboxOrtReisebilder = Type.Object(
    {
        reisebilder: Type.Array(
            Type.Object(
                {
                    publicId: Uuid,
                    url: Type.Union([Type.String(), Type.Null()]),
                    beschreibung: Type.Union([Type.String(), Type.Null()]),
                    name: Type.Union([Type.String(), Type.Null()]),
                    entstehung: literals(PHOTOBOX_CREATION_KINDS),
                    lage: Type.Object({ x: Type.Number(), y: Type.Number() }, strict),
                },
                strict,
            ),
            { maxItems: PHOTOBOX_ORT_REISEBILDER_MAX },
        ),
    },
    strict,
);
export type PhotoboxOrtReisebilder = Static<typeof PhotoboxOrtReisebilder>;

// --- Das Medienobjekt „PhotoBox-Galerien“ der Medienverwaltung ---------------------------------------------------------------------------

/** `GET /api/editor/media/photobox/galerien` (`view_media_private`, `no-store`): die Reisebilder je Ort, die Suche filtert über den Ortsnamen (`?q=`). */
export const MEDIA_PHOTOBOX_GALERIEN_URL = `${MEDIA_PHOTOBOX_URL}/galerien`;
/** `GET /api/editor/media/photobox/ohne-ort/reisebilder`: wie die Route des Ortes, für die Bilder an freien Stellen der Karte. */
export const MEDIA_PHOTOBOX_OHNE_ORT_REISEBILDER_URL = `${MEDIA_PHOTOBOX_URL}/ohne-ort/reisebilder`;
/** Die Kennung der Sammlung ohne Ort in Zustand und Adresse; jede andere Galerie heißt wie ihr Ort (`place.public_id`). */
export const PHOTOBOX_GALERIE_OHNE_ORT = "ohne-ort";
export const mediaPhotoboxGalerieUrl = (kennung: string): string =>
    kennung === PHOTOBOX_GALERIE_OHNE_ORT
        ? MEDIA_PHOTOBOX_OHNE_ORT_REISEBILDER_URL
        : mediaPhotoboxOrtReisebilderUrl(kennung);

/**
 * Die Liste der PhotoBox-Galerien. 🔴 Eine solche Galerie ist keine Zeile in `media_gallery`: Der Kopf eines Ortes liest seine Reisebilder aus `media_submission.place_id` und `photobox_media`
 * (WI-0272 S5, „Kein Nachzug, keine Migration“), und diese Liste liest dasselbe. Sie ändert nichts; Reihenfolge und Inhalt folgen der Freigabe und dem Offline-Nehmen von selbst.
 * `ort: null` ist die Sammlung der Bilder an freien Stellen. `previews` sind die ersten Bilder für den Stapel der Zeile, öffentlich oder die Vorschau der Medienverwaltung.
 */
export const PhotoboxGalerien = Type.Object(
    {
        items: Type.Array(
            Type.Object(
                {
                    ort: Type.Union([Type.Object({ id: Uuid, name: Type.String() }, strict), Type.Null()]),
                    bilder: Type.Integer({ minimum: 1 }),
                    previews: Type.Array(Type.Object({ url: Type.String() }, strict)),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type PhotoboxGalerien = Static<typeof PhotoboxGalerien>;

// --- Offene Eingänge eines Ortes im Kopf seiner Infobox (WI-0272 S5) -------------------------------------------------------------------

/** So viele Eingänge zeigt der Kopf eines Ortes höchstens (eine Folge, kein Bildband; mehr stehen im Korb „PhotoBox-Uploads“). */
export const PHOTOBOX_ORT_EINGAENGE_MAX = 8;
/** `GET /api/editor/media/photobox/ort/:id/eingaenge` (`view_media_private`, `no-store`): die offenen Eingänge dieses Ortes (`place.public_id`). Die Route trägt `:id`, der Aufrufer die Adresse. */
export const MEDIA_PHOTOBOX_ORT_EINGAENGE_ROUTE = `${MEDIA_PHOTOBOX_URL}/ort/:id/eingaenge`;
export const mediaPhotoboxOrtEingaengeUrl = (ortId: string): string =>
    `${MEDIA_PHOTOBOX_URL}/ort/${encodeURIComponent(ortId)}/eingaenge`;

/**
 * Die offenen Eingänge eines Ortes: eingereichte und geprüfte Reisebilder, über die die Redaktion noch nicht entschieden hat und die der Einreicher diesem Ort zugeordnet hat. Nur Editoren mit
 * `view_media_private` lesen sie (der Kopf der Infobox zeigt sie gestrichelt als „Eingang · wartet auf Prüfung“); die öffentliche Antwort des Ortes (`SubjectDetail`) kennt sie nicht.
 * Ein Eingang nennt die Kennung des Mediums, die Adresse des privaten Weges der Medienverwaltung (`…/:id/preview/intern_…`) und die Maße der Vorschau. 🔴 Sonst nichts: keine Beschreibung, kein Name,
 * keine Stelle, kein Schlüssel.
 */
export const PhotoboxOrtEingaenge = Type.Object(
    {
        eingaenge: Type.Array(
            Type.Object(
                {
                    publicId: Uuid,
                    url: Type.String(),
                    breite: Type.Integer({ minimum: 1 }),
                    hoehe: Type.Integer({ minimum: 1 }),
                },
                strict,
            ),
            { maxItems: PHOTOBOX_ORT_EINGAENGE_MAX },
        ),
    },
    strict,
);
export type PhotoboxOrtEingaenge = Static<typeof PhotoboxOrtEingaenge>;
