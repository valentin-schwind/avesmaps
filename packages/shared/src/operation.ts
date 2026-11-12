import { Type, type Static } from "@sinclair/typebox";

/**
 * Operation und Quittung (M10 b, ADR-0019; JOBS-0001 R7 A „eine Kennung je Speichervorgang, der Server erkennt die
 * Wiederholung“).
 *
 * Jede Schreibaktion trägt eine `operationId`, die der Client einmal je Benutzeraktion erzeugt (UUID) und bei einer
 * Wiederholung unverändert mitschickt. Der Server führt eine Operation höchstens einmal aus: Kommt dieselbe Kennung mit
 * demselben Inhalt wieder, antwortet er mit der gespeicherten Quittung (`status: "replayed"`); mit anderem Inhalt antwortet
 * er 409 `idempotency_key_reused`.
 */
export const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

export const OperationId = Type.String({ pattern: UUID_PATTERN });
export type OperationId = Static<typeof OperationId>;

/** Was jede Schreibanfrage mitbringt; `baseRevision` nur, wo ein bestehender Datensatz geändert wird (ADR-0020). */
export const MutationEnvelope = Type.Object({
    operationId: OperationId,
    baseRevision: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type MutationEnvelope = Static<typeof MutationEnvelope>;

export const AffectedEntity = Type.Object(
    {
        kind: Type.String(),
        id: Type.String(),
        revision: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
);
export type AffectedEntity = Static<typeof AffectedEntity>;

/** Folgearbeit, die die Operation angestoßen hat (Kap. 7.15: „Eingabe gespeichert“ ist nicht „Berechnung fertig“). */
export const DerivedWork = Type.Object(
    { kind: Type.String(), jobId: Type.Optional(Type.String()), state: Type.String() },
    { additionalProperties: false },
);
export type DerivedWork = Static<typeof DerivedWork>;

export const ReceiptWarning = Type.Object(
    { code: Type.String(), message: Type.String() },
    { additionalProperties: false },
);

/**
 * Die Quittung (Kap. 7.12). `environment` nennt die Umgebung (ADR-0013: „in Production nennt die Speicherquittung die
 * Umgebung“).
 */
export const OperationReceipt = Type.Object(
    {
        operationId: OperationId,
        status: Type.Union([Type.Literal("applied"), Type.Literal("replayed")]),
        environment: Type.String(),
        affected: Type.Array(AffectedEntity),
        derivedWork: Type.Array(DerivedWork),
        warnings: Type.Array(ReceiptWarning),
        /**
         * Nur an Kartenoperationen (WI-0128 E13): die Nummer des Ereignisses `map.changed`. Sie ist zugleich die Kachelrevision: Die
         * Karte lädt Orte, Wege und Wegnamen mit `?r=<mapRevision>` neu, wie jede andere Karte, die das Ereignis über `/ws` hört.
         */
        mapRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
);
export type OperationReceipt = Static<typeof OperationReceipt>;
