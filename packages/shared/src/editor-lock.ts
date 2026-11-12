import { Type, type Static } from "@sinclair/typebox";
import { UUID_PATTERN } from "./operation.ts";

/**
 * Die Sperre während der Bearbeitung (EDIT-0003 §4, T27 (3), (14); Migration 0138). EINE Stelle für alle Editoren: Orte, Wege,
 * Landschaften, Herrschaftsgebiete und Kraftlinien. Betreiber 2026-10-16, wörtlich: „objekte sollen gesperrt werden / sein, wenn sie
 * jemand bearbeitet“.
 *
 * - **Nehmen:** Wer ein Objekt bearbeitet (einen Modus auf der Karte startet, die Felder eines Fensters ändert), nimmt seine Sperre
 *   (`POST EDITOR_LOCKS_URL`). Hält sie jemand anders und schlug sein Herz in den letzten 15 Minuten, antwortet der Server 409
 *   `object_locked` mit der Sperre in `details`; sonst gehört sie dem, der fragt.
 * - **Herzschlag:** alle 60 s ein kleines POST für alle Sperren eines Laufs (`/heartbeat`); die Antwort nennt, welche nicht mehr
 *   gehalten werden. Nach 15 Minuten ohne Herzschlag ist ein Objekt frei; der Entwurf bleibt im Browser (T27 (14)).
 * - **Freigeben:** `/release` beim Ende des Bearbeitens. Ein abgestürzter Browser gibt nie frei; dafür sind die 15 Minuten da.
 * - **Aufheben** (`/lift`): Ein Admin hebt die Sperre eines anderen auf. Auf die Frage „Soll ein Admin die Sperre eines anderen aufheben
 *   können?“ antwortete der Betreiber „ja“ (2026-10-16). Wer gesperrt hatte, erfährt es beim nächsten Herzschlag als verloren; sein
 *   Entwurf bleibt.
 * - **Lesen:** `GET EDITOR_LOCKS_URL?kind=…` nennt die geltenden Sperren einer Art für Schraffur, Schild und Kasten (T27 (3)).
 * - **Ein Lauf** ist ein Bearbeiten in einem Fenster des Browsers (`run`): Dieselbe Person in einem zweiten Fenster ist ein anderer
 *   Lauf und übernimmt die Sperre; der erste erfährt es beim nächsten Herzschlag als verloren, sein Entwurf bleibt (Vali 2026-11-02: „eine
 *   fläche wird durch mich selber am verändern gehindert“).
 * - Ein Zug hält weiter seine Domänensperre (T17), Speichern antwortet dann 423; diese Sperre bleibt dabei bestehen, und ein Zug
 *   wartet nie auf sie.
 * - **Freigabe erbitten** (WI-0262, OPS-000059; Vali 2026-10-30): Wer ein fremd gesperrtes Objekt sieht, bittet den Inhaber um Freigabe
 *   (`POST /request`). Die Anfrage läuft nach 5 Minuten ab; je Person und Sperre gibt es höchstens eine offene. Der Inhaber antwortet
 *   „freigegeben“ oder „später“ (`POST /request/answer`, nur er, am Lauf und an der Person geprüft); „freigegeben“ gibt die Sperre
 *   frei, nachdem sein Browser den Entwurf über den Weg „Fertig“ gespeichert hat. Geliefert wird im vorhandenen Takt: dem Inhaber mit
 *   der Antwort des Herzschlags (`requests`), dem Bittenden mit der Liste der Sperren (`requests`, seine eigenen Anfragen).
 */

export const EDITOR_LOCKS_URL = "/api/editor/locks";

/** Wie lange eine Sperre ohne Herzschlag hält (T27 (14): „15 Minuten“). */
export const EDITOR_LOCK_TIMEOUT_MINUTES = 15;
/** Wie oft der Client schlägt (EDIT-0003 §4, Orchestrierung): reichlich Puffer zu den 15 Minuten. */
export const EDITOR_LOCK_HEARTBEAT_SECONDS = 60;

/** Die Arten der Objekte, wie das Register der Handgriffe sie nennt. */
/** Die Sprache (WI-0261 S5d, Migration 0258) wird als Ganzes gesperrt; ihre Teilflächen haben keine eigene Sperre. */
export const EDITOR_LOCK_KINDS = ["place", "path", "landscape", "territory", "powerline", "peak", "sprache"] as const;
export type EditorLockKind = (typeof EDITOR_LOCK_KINDS)[number];

/** Woran gearbeitet wird, für das Schild „🔒 Thomas · Form · seit …“. */
export const EDITOR_LOCK_PARTS = ["form", "felder"] as const;
export type EditorLockPart = (typeof EDITOR_LOCK_PARTS)[number];

/** Der Fehler, wenn ein anderer das Objekt hält; `details` ist die Sperre (`EditorLock`). */
export const EDITOR_LOCK_ERROR_STATUS = {
    object_locked: 409,
    /**
     * Ein Schreibweg, der die eigene Sperre verlangt (Spracheditor, WI-0261 S5d): Die fragende Person hält die Sperre des Objekts nicht. Erst nehmen
     * (`POST EDITOR_LOCKS_URL`), dann schreiben.
     */
    lock_required: 409,
    /** Die Bitte um Freigabe: das Objekt ist gar nicht gesperrt, die Sperre gehört dem Bittenden selbst, oder eine Bitte ist schon offen. */
    not_locked: 409,
    own_lock: 409,
    request_open: 409,
    /** Die Antwort: die Anfrage ist schon anders beantwortet oder abgelaufen; die Anfrage gibt es nicht; der Antwortende hält die Sperre nicht. */
    request_closed: 409,
    request_not_found: 404,
    not_lock_holder: 403,
} as const;

/** Wie lange eine Bitte um Freigabe offen bleibt (WI-0262: „läuft nach wenigen Minuten ab“). */
export const EDITOR_LOCK_REQUEST_MINUTES = 5;
/** Wie lange der Bittende die Antwort noch lesen kann, nachdem sie kam oder die Bitte ablief. */
export const EDITOR_LOCK_REQUEST_KEEP_MINUTES = 10;
/** Wie oft der Bittende fragt, solange seine Bitte offen ist (sonst nur im Takt der Liste). */
export const EDITOR_LOCK_REQUEST_POLL_SECONDS = 10;

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
const Id = () => Type.String({ pattern: UUID_PATTERN });

export const EditorLockTarget = Type.Object({ kind: Union(EDITOR_LOCK_KINDS), id: Id() }, strict);
export type EditorLockTarget = Static<typeof EditorLockTarget>;

/**
 * Eine geltende Sperre. `own`: Sie gehört dem Lauf, der fragt; in der Liste auch derselben Person in einem anderen Fenster. Zeiten als ISO-Zeichenkette. Nur in der Liste: `at`, wo das Schild
 * „🔒 Thomas · Form · seit …“ auf der Karte steht (MCS): bei Landschaften ein Punkt in der größten Teilfläche, beim Ort sein Punkt, beim
 * Weg die Mitte des Abschnitts, bei der Kraftlinie die Mitte ihres längsten Abschnitts. `layer`, die Ebene der Landschaft: Schraffur und
 * Schild stehen nur, wo die Karte diese Ebene zeigt. `sections`, an Linien (WI-0205 K11, Anzeige): die Abschnitte, die zur gesperrten Linie
 * gehören, für die Spur auf der Karte und den Kasten (ein Klick trifft einen Abschnitt, gesperrt ist bei der Kraftlinie der Anker).
 */
export const EditorLock = Type.Object(
    {
        kind: Union(EDITOR_LOCK_KINDS),
        id: Id(),
        part: Union(EDITOR_LOCK_PARTS),
        person: Type.Object({ id: Id(), name: Type.String() }, strict),
        since: Type.String(),
        heartbeatAt: Type.String(),
        own: Type.Boolean(),
        at: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() }, strict)),
        layer: Type.Optional(Type.String()),
        sections: Type.Optional(Type.Array(Id())),
    },
    strict,
);
export type EditorLock = Static<typeof EditorLock>;

export const EditorLockTake = Type.Object(
    { kind: Union(EDITOR_LOCK_KINDS), id: Id(), part: Union(EDITOR_LOCK_PARTS), run: Id() },
    strict,
);
export type EditorLockTake = Static<typeof EditorLockTake>;

export const EditorLockTaken = Type.Object({ lock: EditorLock }, strict);
export type EditorLockTaken = Static<typeof EditorLockTaken>;

/** Die Antworten des Inhabers: Er gibt frei (nach dem Speichern) oder vertagt. */
export const EDITOR_LOCK_REQUEST_ANSWERS = ["released", "later"] as const;
export type EditorLockRequestAnswer = (typeof EDITOR_LOCK_REQUEST_ANSWERS)[number];
/** Der Stand einer Bitte, wie der Bittende ihn sieht: offen, freigegeben, später oder abgelaufen. */
export const EDITOR_LOCK_REQUEST_STATES = ["open", "released", "later", "expired"] as const;
export type EditorLockRequestState = (typeof EDITOR_LOCK_REQUEST_STATES)[number];

/**
 * Die Bitte um Freigabe, wie der **Bittende** sie sieht (in der Liste der Sperren). `released` auch dann, wenn die Sperre inzwischen
 * ohne Antwort gefallen ist (der Inhaber ist fertig, ihr Herzschlag ist abgelaufen, ein Admin hat sie aufgehoben): Das Objekt ist frei.
 * Nach dem Ablauf bleibt die Bitte noch `EDITOR_LOCK_REQUEST_KEEP_MINUTES` lesbar, damit „Abgelaufen“ und die Antwort nicht verschwinden,
 * bevor sie jemand sieht.
 */
export const EditorLockRequest = Type.Object(
    {
        requestId: Id(),
        kind: Union(EDITOR_LOCK_KINDS),
        id: Id(),
        state: Union(EDITOR_LOCK_REQUEST_STATES),
        createdAt: Type.String(),
        expiresAt: Type.String(),
    },
    strict,
);
export type EditorLockRequest = Static<typeof EditorLockRequest>;

/** Die Bitte, wie der **Inhaber** sie sieht (mit dem Herzschlag): von wem, an welcher seiner Sperren, bis wann. */
export const EditorLockIncoming = Type.Object(
    {
        requestId: Id(),
        kind: Union(EDITOR_LOCK_KINDS),
        id: Id(),
        from: Type.Object({ id: Id(), name: Type.String() }, strict),
        createdAt: Type.String(),
        expiresAt: Type.String(),
    },
    strict,
);
export type EditorLockIncoming = Static<typeof EditorLockIncoming>;

/** Bitten: `run` ist der Lauf des Bittenden (eine Bitte an die Sperre des eigenen Laufs gibt es nicht). */
export const EditorLockAsk = Type.Object({ kind: Union(EDITOR_LOCK_KINDS), id: Id(), run: Id() }, strict);
export type EditorLockAsk = Static<typeof EditorLockAsk>;

export const EditorLockAsked = Type.Object({ request: EditorLockRequest }, strict);
export type EditorLockAsked = Static<typeof EditorLockAsked>;

/** Antworten: `run` ist der Lauf des Inhabers. */
export const EditorLockRequestReply = Type.Object(
    { requestId: Id(), run: Id(), answer: Union(EDITOR_LOCK_REQUEST_ANSWERS) },
    strict,
);
export type EditorLockRequestReply = Static<typeof EditorLockRequestReply>;

export const EditorLockBeat = Type.Object({ run: Id(), locks: Type.Array(EditorLockTarget, { maxItems: 50 }) }, strict);
export type EditorLockBeat = Static<typeof EditorLockBeat>;

/**
 * Was der Lauf nicht mehr hält: abgelaufen und von einem anderen genommen, oder nie gehalten. `requests`: die offenen Bitten um Freigabe
 * an die Sperren dieses Laufs (WI-0262); sie fehlen, wenn es keine gibt.
 */
export const EditorLockBeatAnswer = Type.Object(
    { lost: Type.Array(EditorLockTarget), requests: Type.Optional(Type.Array(EditorLockIncoming)) },
    strict,
);
export type EditorLockBeatAnswer = Static<typeof EditorLockBeatAnswer>;

export const EditorLockRelease = Type.Object({ run: Id(), kind: Union(EDITOR_LOCK_KINDS), id: Id() }, strict);
export type EditorLockRelease = Static<typeof EditorLockRelease>;

/** Die Sperren einer Art; `requests`: die Bitten um Freigabe, die die fragende Person selbst gestellt hat (WI-0262); sie fehlen, wenn es keine gibt. */
export const EditorLockList = Type.Object(
    { locks: Type.Array(EditorLock), requests: Type.Optional(Type.Array(EditorLockRequest)) },
    strict,
);
export type EditorLockList = Static<typeof EditorLockList>;
