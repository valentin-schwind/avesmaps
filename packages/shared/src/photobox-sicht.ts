import { Type, type Static } from "@sinclair/typebox";
import { AVENTURIA } from "./map-domain-registry.ts";
import { SearchHitKind } from "./search.ts";

/**
 * Die Grundlagen der Reisebild-Einreichung und die Sicht der Redaktion darauf (WI-0272 S1 und S3): die Zustände, Entstehung, Lizenzwahl und Grenzen
 * (zuerst in `photobox.ts`, dort weiter unter denselben Namen erreichbar) und `PhotoboxSubmissionView`, was die Medienverwaltung zu einer Einreichung
 * zeigt.
 *
 * 🪤 Eigene Datei wegen eines Importkreises: `MediaAssetDetail` (`media-editor.ts`) trägt die Sicht, `photobox.ts` aber liest `media-editor.ts`
 * (`MEDIA_EDITOR_URL`) und `media-editor-operations.ts` schon beim Laden. Läge die Sicht in `photobox.ts`, griffe das eine Modul beim Laden auf ein
 * Ding des anderen zu, das noch nicht da ist. Diese Datei liest nur Blattmodule.
 */

/**
 * Der Weg einer Einreichung. `incoming` heißt: angenommen, Bytes noch ungeprüft; `technical_failed`: die technische Prüfung
 * ist gescheitert. `offline` ist eine freigegebene Einreichung, die die Redaktion zurückgenommen hat; `expired` verfällt nach
 * 60 Tagen offen, `purged` ist geleert (30 Tage danach, der Datensatz bleibt, der Fremdschlüssel bleibt gültig).
 */
export const PHOTOBOX_SUBMISSION_STATES = [
    "incoming",
    "technical_failed",
    "pending",
    "changes_requested",
    "approved",
    "rejected",
    "withdrawn",
    "offline",
    "expired",
    "purged",
] as const;
export type PhotoboxSubmissionState = (typeof PHOTOBOX_SUBMISSION_STATES)[number];

/**
 * Noch nicht entschieden: Die Redaktion hat das Bild noch zu prüfen. 🔴 Ein solches Bild lässt sich nicht endgültig löschen (WI-0272, Vali 2026-11-08, Entwurf „Eingänge“
 * Fassung 2): Server (`media-editor/photobox-loeschen.ts`) und Oberfläche (`medien-loeschen-modell.ts`) fragen dieselbe Liste.
 */
export const PHOTOBOX_UNENTSCHIEDEN: readonly PhotoboxSubmissionState[] = [
    "incoming",
    "technical_failed",
    "pending",
    "changes_requested",
];

/** Was für ein Bild das ist. Die Wahl des Einreichers; die Redaktion sieht sie im Eingang. */
export const PHOTOBOX_CREATION_KINDS = ["drawing", "photo", "ai_generated", "avesmaps_capture"] as const;
export type PhotoboxCreationKind = (typeof PHOTOBOX_CREATION_KINDS)[number];

/** Die Lizenzwahl des Einreichers: `avesmaps_only` ist die Vorgabe. */
export const PHOTOBOX_USAGE_GRANTS = ["avesmaps_only", "cc-by-4.0"] as const;
export type PhotoboxUsageGrant = (typeof PHOTOBOX_USAGE_GRANTS)[number];

/** Die Grenzen der Eingabe: Bildbeschreibung und Nennung in Zeichen, Blickrichtungen als Himmelsrichtungen. */
export const PHOTOBOX_LIMITS = { descriptionMax: 300, attributionMax: 80, viewDirections: 8 } as const;

/**
 * Worauf sich ein Reisebild beziehen kann: dieselben Arten wie ein Suchtreffer. Aus der Union von `SearchHitKind` abgeleitet,
 * damit eine neue Art der Suche hier nicht in einer zweiten Liste nachgetragen werden muss.
 */
export const PHOTOBOX_REFERENCE_KINDS: readonly SearchHitKind[] = SearchHitKind.anyOf.map((member) => member.const);

const strict = { additionalProperties: false } as const;
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));
const Moment = Type.String();
const Uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" });
const { bounds: WORLD } = AVENTURIA.coordinateSpace;

/** Eine Stelle auf der Karte, im Koordinatenraum der Welt. */
export const PhotoboxLage = Type.Object(
    {
        x: Type.Number({ minimum: WORLD.minX, maximum: WORLD.maxX }),
        y: Type.Number({ minimum: WORLD.minY, maximum: WORLD.maxY }),
    },
    strict,
);

// --- Die Unterteilung des Korbs „PhotoBox-Uploads“ ------------------------------------------------------------------------------------------

/**
 * Die drei Teile des Korbs „PhotoBox-Uploads“ in der Medienverwaltung (WI-0272 S3): was noch zu prüfen ist, was auf die Antwort des Einreichers
 * wartet, und was entschieden ist.
 */
export const MAM_EINREICHUNGEN = ["offen", "rueckfrage", "erledigt"] as const;
export type MamEinreichung = (typeof MAM_EINREICHUNGEN)[number];

/**
 * 🔴 Wohin eine Einreichung gehört: `offen` ist alles, was die Redaktion noch ansehen und entscheiden kann (eingegangen, geprüft, und eine freigegebene,
 * deren Einreicher eine neue Beschreibung zur Prüfung geschickt hat), `rueckfrage` die Rückfrage an den Einreicher, `erledigt` der Rest. Auch ein technisch
 * gescheitertes Bild (`technical_failed`) ist `erledigt`: Die Redaktion kann dort nichts entscheiden (alle Aktionen sind gesperrt), nur der Einreicher kann das
 * Bild ersetzen oder zurückziehen; es zählt nicht in Korb, Zahl und Stapel (WI-0272 S3, Fixrunde G, Review M11). Der Server rechnet dieselbe Regel in SQL (`media-editor/search.ts`, Spalte `submission_group`); `media-editor-routes.test.ts` hält beide
 * gegeneinander.
 */
export function photoboxUnterteilung(zustand: PhotoboxSubmissionState, wartendeBeschreibung: boolean): MamEinreichung {
    switch (zustand) {
        case "incoming":
        case "pending":
            return "offen";
        case "changes_requested":
            return "rueckfrage";
        case "approved":
            return wartendeBeschreibung ? "offen" : "erledigt";
        default:
            return "erledigt";
    }
}

// --- Die Sicht der Redaktion ----------------------------------------------------------------------------------------------------------------

/**
 * Was die Medienverwaltung zu einer Einreichung zeigt (`MediaAssetDetail.submission`, nur mit `view_media_private`): der Zustand mit der Revision, auf die
 * jede Operation der Redaktion baut (`baseRevision`), und die Angaben des Einsenders. Nie der Statusschlüssel, nie sein Hash.
 *
 * - `publicId` ist die öffentliche Kennung der Einreichung (`media_submission.public_id`): Sie steht in der Adresse der Operationen.
 * - `beschreibung` ist die geltende Fassung, `wartendeBeschreibung` die nach der Freigabe geänderte, die auf die Prüfung wartet; `nachricht` die
 *   letzte Rückfrage oder Ablehnung der Redaktion.
 * - `ort` ist der Ort, auf den sich das Bild bezieht; `typ` der Schlüssel seines Typbilds (`HeaderGraphic`, etwa `stadt`; Name und Bild liest die
 *   Oberfläche aus `HEADER_GRAPHIC_LABELS` und der Grafik der Art). `ortHatOrtsansicht` sagt, ob der Ort schon eine öffentliche Ortsansicht trägt (dann
 *   reiht sich ein Reisebild dahinter ein, sonst ersetzt es das Typbild).
 * - `bedingungen` ist die Fassung der Nutzungsbedingungen, der der Einreicher zustimmte; `angepasst` heißt „von der Redaktion angepasst“.
 */
export const PhotoboxSubmissionView = Type.Object(
    {
        publicId: Uuid,
        revision: Type.Integer({ minimum: 1 }),
        zustand: literals(PHOTOBOX_SUBMISSION_STATES),
        eingereichtAm: Moment,
        beschreibung: Type.String(),
        wartendeBeschreibung: Type.Optional(Type.String()),
        nachricht: Type.Optional(Type.String()),
        entstehung: literals(PHOTOBOX_CREATION_KINDS),
        nutzung: literals(PHOTOBOX_USAGE_GRANTS),
        blickrichtung: Type.Optional(Type.Integer({ minimum: 0, maximum: PHOTOBOX_LIMITS.viewDirections - 1 })),
        name: Type.Optional(Type.String()),
        lage: PhotoboxLage,
        ort: Type.Optional(
            Type.Object({ publicId: Uuid, name: Type.String(), typ: Type.Optional(Type.String()) }, strict),
        ),
        bezug: Type.Optional(Type.Object({ art: literals(PHOTOBOX_REFERENCE_KINDS), id: Type.String() }, strict)),
        bedingungen: Type.String(),
        angepasst: Type.Boolean(),
        ortHatOrtsansicht: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type PhotoboxSubmissionView = Static<typeof PhotoboxSubmissionView>;
