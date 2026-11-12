import { Type, type Static } from "@sinclair/typebox";
import { MEDIA_EDITOR_URL, MamAssetSummary } from "./media-editor.ts";
import { MutationEnvelope, UUID_PATTERN } from "./operation.ts";

/**
 * Zwei Werke mit DENSELBEN BYTES werden eines (WI-0068 D1).
 *
 * Betreiber 2026-10-11, wörtlich: „genau, nur bei byte-identischen bildern, aber das sind ja einige“; 2026-10-13: „bytegleiche
 * bilder die doppelt sind sollen zu einem werden - verlier die referenzen nicht“. Im Bestand teilen 1.025 Assets ihre Quelldatei
 * mit einem anderen, in 218 Gruppen — Legacy legte je Verwendung ein eigenes Werk an.
 *
 * 🔴 **Nie automatisch** (WI-0068 §21): EINE Gruppe je Klick, ausgelöst von einem Menschen; auf Stage drückt der Betreiber selbst.
 * 🔴 **Umkehrbar:** `media_merge` und `media_merge_move` halten fest, welche Verwendung vorher wem gehörte.
 * 🔴 **Das aufgegangene Werk bleibt bestehen** — es behält Original, Rechte und Herkunft und fällt nur aus Liste und Körben.
 */

const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });
const Revision = () => Type.Integer({ minimum: 1 });
const Count = () => Type.Integer({ minimum: 0 });

export const MEDIA_MERGE_URL = `${MEDIA_EDITOR_URL}/merge`;
export const MEDIA_MERGE_PREVIEW_URL = `${MEDIA_EDITOR_URL}/merge/preview`;
/** Eine Zusammenführung aufheben: am AUFGEGANGENEN Werk, denn es bekommt seine Verwendungen zurück. */
export const mediaMergeLiftUrl = (assetId: string): string => `${MEDIA_EDITOR_URL}/${assetId}/merge/lift`;

export const MEDIA_MERGE_REASON_MAX = 500;
/** Wie viele Werke eine Zusammenführung höchstens auf einmal aufnimmt; die größte Gruppe im Bestand hat 15. */
export const MEDIA_MERGE_MAX = 50;

/** Ein Beteiligter samt dem Stand, auf dem die Entscheidung beruht. */
export const MediaMergeMember = Type.Object({ assetId: Uuid(), baseRevision: Revision() }, strict);
export type MediaMergeMember = Static<typeof MediaMergeMember>;

/**
 * Zusammenführen: `keep` bleibt, jedes Werk aus `merge` geht darin auf.
 *
 * 🪤 Jeder Beteiligte nennt seinen gesehenen Stand. Hat sich einer geändert, antwortet der Server mit 409 — eine Zusammenführung
 * auf veraltetem Stand könnte eine Verwendung umhängen, die inzwischen jemand anders gesetzt hat.
 */
export const MediaMergeBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        keep: MediaMergeMember,
        merge: Type.Array(MediaMergeMember, { minItems: 1, maxItems: MEDIA_MERGE_MAX }),
        reason: Type.Optional(Type.String({ maxLength: MEDIA_MERGE_REASON_MAX })),
    },
    strict,
);
export type MediaMergeBody = Static<typeof MediaMergeBody>;

/**
 * Eine Zusammenführung aufheben.
 *
 * 🪤 Das AUFGEGANGENE Werk steht im PFAD (`mediaMergeLiftUrl`), nicht im Körper: Es ist der Gegenstand der Adresse, wie bei
 * jeder anderen Operation an einem Asset. Ein Körper, der es noch einmal nennte, könnte etwas anderes sagen als der Pfad.
 */
export const MediaMergeLiftBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        reason: Type.Optional(Type.String({ maxLength: MEDIA_MERGE_REASON_MAX })),
    },
    strict,
);
export type MediaMergeLiftBody = Static<typeof MediaMergeLiftBody>;

/**
 * Was eine Zusammenführung bewegen würde, bevor sie jemand auslöst (Betreiber 2026-10-11: „Vor dem Klick eine Vorschau mit
 * Zahlen“). Reines Lesen, ändert nichts.
 */
export const MediaMergeGroupPreview = Type.Object(
    {
        /** Die Gruppe als Kennung ihres ältesten Werks (wie `MamAssetSummary.fileGroup`). */
        fileGroup: Uuid(),
        /** Die Vorgabe für das bleibende Werk: die größte Auflösung (Betreiber 2026-10-11, Frage 2 Antwort A). */
        keepAssetId: Uuid(),
        members: Count(),
        /** Verwendungen, die auf das bleibende Werk zeigen würden. */
        moves: Count(),
        /** Verwendungen, die dabei zurückgezogen würden, weil das bleibende Werk am selben Platz schon hängt. */
        retires: Count(),
        /**
         * 🔴 Die Rechte der Mitglieder weichen voneinander ab (Grundlage, Prüfstand oder Urheber). Solche Gruppen bleiben beim
         * Klick „alle zusammenführen“ DRAUSSEN und gehören einzeln angesehen (Betreiber 2026-10-11).
         */
        rightsDiffer: Type.Boolean(),
    },
    strict,
);
export type MediaMergeGroupPreview = Static<typeof MediaMergeGroupPreview>;

export const MediaMergePreview = Type.Object(
    {
        groups: Type.Array(MediaMergeGroupPreview),
        /** Gruppen, Werke und Umzüge über alles, was der Klick anfassen würde (ohne die mit abweichenden Rechten). */
        totals: Type.Object(
            { groups: Count(), members: Count(), moves: Count(), retires: Count(), withDifferingRights: Count() },
            strict,
        ),
    },
    strict,
);
export type MediaMergePreview = Static<typeof MediaMergePreview>;

/**
 * Gibt es diese Datei schon als Werk? (Betreiber 2026-10-17, wörtlich: „Das gemeinsame Uploadformular der Medienverwaltung und des
 * Ortseditors soll unmittelbar nach der Dateiauswahl prüfen, ob das Original bereits als Asset existiert. Verglichen wird die
 * SHA-256 der vollständigen Originaldatei, nicht Dateiname, Bildabmessungen oder ein Wahrnehmungs-Hash.“)
 *
 * Der Browser rechnet die SHA-256 der gewählten Datei und fragt hier. 🔴 Der Server prüft beim Hochladen noch einmal, unter einer
 * Sperre je Hash (`media_already_exists`); die Frage hier ist Bequemlichkeit, nicht der Schutz.
 */
export const MEDIA_SHA256_PATTERN = "^[0-9a-f]{64}$";
export const mediaSameBytesUrl = (sha256: string): string => `${MEDIA_EDITOR_URL}/same-bytes/${sha256}`;

export const MediaSameBytes = Type.Object(
    {
        /**
         * Die Werke mit diesen Bytes, das älteste zuerst. 🔴 Ohne die aufgegangenen (D1): Sie sind kein eigenes Bild mehr, ihr Platz
         * gehört dem bleibenden Werk.
         */
        hits: Type.Array(MamAssetSummary),
        /**
         * Der Vorschlag: das kanonische Werk, also das, in dem eine Zusammenführung die anderen aufgehen ließe — das älteste (die
         * Maße sind bei denselben Bytes gleich, `merge-preview.ts`). `null` ohne Treffer.
         */
        suggested: Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()]),
    },
    strict,
);
export type MediaSameBytes = Static<typeof MediaSameBytes>;

/**
 * „Alle bytegleichen Duplikate zusammenführen“ (Betreiber 2026-10-17, wörtlich: „Danach soll ein einziger bewusst ausgelöster
 * Vorgang alle zulässigen Gruppen verarbeiten, mit nachvollziehbarem Fortschritt, Fehlerbericht und Audit.“).
 *
 * 🔴 **Der Bestands-Scope ist die Vorschau, die der Mensch gesehen hat:** Der Körper nennt jede Gruppe mit ihrem bleibenden Werk. Der
 * Server nimmt nur Gruppen an, die gerade sauber sind (keine abweichenden Rechte), und lehnt den Auftrag ab, wenn sich die Vorschau
 * seitdem geändert hat (409 `merge_preview_stale`). Gruppen mit abweichenden Rechten stehen nie darin; sie gehören einzeln geprüft.
 * 🔴 **Nur Betreiber** (`merge_media_all`, Stufe S): ein Lauf über den Bestand (§21; Betreiber 2026-10-11: „Auf Stage drückt den
 * Klick der Betreiber selbst“). Gerechnet wird als Auftrag der Warteschlange (`media_merge_all`), je Gruppe eine Transaktion mit der
 * Logik von `media.merge`; jede Gruppe ist einzeln umkehrbar.
 */
export const MEDIA_MERGE_ALL_URL = `${MEDIA_EDITOR_URL}/merge/all`;
export const MEDIA_MERGE_ALL_KIND = "media_merge_all";
/** Die größte Zahl Gruppen eines Laufs; im Bestand der Entwicklung sind es 218. */
export const MEDIA_MERGE_ALL_MAX_GROUPS = 2000;

export const MediaMergeAllGroup = Type.Object(
    { fileGroup: Type.String({ pattern: UUID_PATTERN }), keepAssetId: Type.String({ pattern: UUID_PATTERN }) },
    strict,
);
export type MediaMergeAllGroup = Static<typeof MediaMergeAllGroup>;

export const MediaMergeAllBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        groups: Type.Array(MediaMergeAllGroup, { minItems: 1, maxItems: MEDIA_MERGE_ALL_MAX_GROUPS }),
        /** Die Zahlen, die der Mensch gesehen hat (`MediaMergePreview.totals`); weichen sie ab, ist die Vorschau veraltet. */
        expected: Type.Object({ groups: Count(), members: Count(), moves: Count(), retires: Count() }, strict),
        reason: Type.Optional(Type.String({ maxLength: MEDIA_MERGE_REASON_MAX })),
    },
    strict,
);
export type MediaMergeAllBody = Static<typeof MediaMergeAllBody>;

/** Was ein Lauf über alle Gruppen meldet (Ergebnis des Auftrags, `job.result`). */
export interface MediaMergeAllResult {
    groups: number;
    merged: number;
    assets: number;
    moved: number;
    retired: number;
    /** Gruppen, die der Lauf nicht anfasste, mit Grund (etwa `rights_differ`, `already_merged`, `group_changed`). */
    skipped: { fileGroup: string; reason: string }[];
    /** Gruppen, an denen die Zusammenführung scheiterte, mit Fehlercode. */
    failed: { fileGroup: string; code: string }[];
    /** Wie viele Abgleiche am Ende eingereiht wurden (je Werk und Rolle einmal, mit niedriger Priorität). */
    settles: number;
}
