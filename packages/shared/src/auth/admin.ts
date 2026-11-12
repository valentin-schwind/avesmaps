import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId, OperationReceipt, UUID_PATTERN } from "../operation.ts";
import { ROLES } from "./capabilities.ts";
import { BezeichnungWert, LoginMethod, SonderrolleAnzeige } from "./session.ts";

/**
 * Die Verwaltungs-API (WI-0120 A7, AUTH-0001 §7, §9; ADR-0019, ADR-0020): Personen, Zugang und Rolle je Umgebung, Sonderrechte,
 * Sitzungen, Einladungen, Protokoll, Legacy-Namen. Server und Verwaltungsfenster (A10) lesen dieselben Verträge.
 *
 * Jede Handlung trägt eine `operationId`; wer einen bestehenden Datensatz ändert, schickt dazu `baseRevision` und bekommt bei
 * einem schnelleren Zugriff 409 `edit_conflict`. Ein Link (Einladung, Rücksetzen, Passkey) steht nur in der ersten Antwort.
 */
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const Revision = Type.Integer({ minimum: 1 });
const PersonId = Type.String({ pattern: UUID_PATTERN });

export const RoleName = Type.Union(ROLES.map((role) => Type.Literal(role)));

export const PersonRef = Type.Object(
    { id: Type.String(), displayName: Type.String() },
    { additionalProperties: false },
);
export type PersonRef = Static<typeof PersonRef>;

export const AdminPerson = Type.Object(
    {
        id: Type.String(),
        displayName: Type.String(),
        status: Type.Union([Type.Literal("active"), Type.Literal("locked"), Type.Literal("departed")]),
        /** Revision der Person (Sperren, Entsperren). */
        revision: Revision,
        role: RoleName,
        access: Type.Union([Type.Literal("active"), Type.Literal("revoked")]),
        /** Revision von Zugang und Rolle in dieser Umgebung (Rolle ändern, Zugang entziehen). */
        accessRevision: Revision,
        methods: Type.Array(LoginMethod),
        /** Ihre Wortform und ihre Sonderrollen in dieser Umgebung (WI-0279). Beide nur zum Anzeigen; optional für einen älteren Server. */
        bezeichnung: Type.Optional(Nullable(BezeichnungWert)),
        sonderrollen: Type.Optional(Type.Array(SonderrolleAnzeige)),
        passwordDisabled: Type.Boolean(),
        passkeyCount: Type.Integer({ minimum: 0 }),
        activeSessions: Type.Integer({ minimum: 0 }),
        /** Zugeteilte Sonderrechte (aus der Rolle Betreiber kommen sie zusätzlich, ohne Eintrag hier). */
        grants: Type.Array(Type.String()),
        createdAt: Moment,
        lastLoginAt: Nullable(Moment),
        lastSeenAt: Nullable(Moment),
        invitedBy: Nullable(PersonRef),
        lockReason: Nullable(Type.String()),
        lockedAt: Nullable(Moment),
        lockedBy: Nullable(PersonRef),
        /**
         * „Verantwortlich für:“ (WI-0133), `null` = nicht gesetzt. Der Server schickt es immer; ein Server der Vorversion nicht, dann
         * gilt `null`. Ändern: die Person selbst, ein Betreiber mit `set_responsibility`; wer die Person sieht, liest es.
         */
        responsibleFor: Type.Optional(Nullable(Type.String())),
        /** Das eigene Konto: hier nicht änderbar (§7.3), ausgenommen „Verantwortlich für:“. */
        self: Type.Boolean(),
        /** Ob die anfragende Person an dieser handeln darf (Stufenregel, nicht das eigene Konto). */
        manageable: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type AdminPerson = Static<typeof AdminPerson>;

export const AdminPersonDetail = Type.Object(
    {
        person: AdminPerson,
        loginName: Nullable(Type.String()),
        discord: Nullable(
            Type.Object(
                {
                    userId: Type.String(),
                    username: Nullable(Type.String()),
                    globalName: Nullable(Type.String()),
                    // Keine Zwei-Faktor-Angabe von Discord mehr: Sie wird nicht gespeichert (Betreiber 2026-10-10: „B: nicht mehr
                    // speichern“). Ein Tab der Vorversion liest das frühere Feld als fehlend und zeigt „ohne Zwei-Faktor“, bis er neu lädt.
                    linkedAt: Moment,
                    lastLoginAt: Nullable(Moment),
                },
                { additionalProperties: false },
            ),
        ),
        passkeys: Type.Array(
            Type.Object(
                {
                    id: Type.String(),
                    label: Nullable(Type.String()),
                    backedUp: Type.Boolean(),
                    createdVia: Type.String(),
                    createdAt: Moment,
                    lastUsedAt: Nullable(Moment),
                },
                { additionalProperties: false },
            ),
        ),
        sessions: Type.Array(
            Type.Object(
                {
                    id: Type.String(),
                    method: Type.String(),
                    assurance: Type.String(),
                    createdAt: Moment,
                    lastSeenAt: Moment,
                    clientLabel: Nullable(Type.String()),
                    current: Type.Boolean(),
                },
                { additionalProperties: false },
            ),
        ),
        specialCapabilities: Type.Array(
            Type.Object(
                {
                    capability: Type.String(),
                    grantedAt: Moment,
                    grantedBy: Nullable(PersonRef),
                    reason: Type.String(),
                },
                { additionalProperties: false },
            ),
        ),
        legacy: Type.Array(
            Type.Object(
                {
                    id: Type.String(),
                    legacyName: Type.String(),
                    legacyUserId: Nullable(Type.String()),
                    revision: Revision,
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type AdminPersonDetail = Static<typeof AdminPersonDetail>;

export const InvitationStatus = Type.Union([
    Type.Literal("open"),
    Type.Literal("accepted"),
    Type.Literal("revoked"),
    Type.Literal("replaced"),
    Type.Literal("expired"),
]);

/** Eine Region einer Sonderrolle (WI-0279): eine Fläche der Ebene `derographisch`. */
export const RegionRef = Type.Object({ id: Type.String(), name: Type.String() }, { additionalProperties: false });
export type RegionRef = Static<typeof RegionRef>;

export const AdminInvitation = Type.Object(
    {
        id: Type.String(),
        role: RoleName,
        note: Nullable(Type.String()),
        /** Die letzten vier Zeichen des Tokens; der Link selbst steht nur in der Antwort, die ihn erzeugt. */
        tokenHint: Type.String(),
        boundDiscordUserId: Nullable(Type.String()),
        status: InvitationStatus,
        createdAt: Moment,
        expiresAt: Moment,
        createdBy: Nullable(PersonRef),
        acceptedAt: Nullable(Moment),
        acceptedPerson: Nullable(PersonRef),
        revokedAt: Nullable(Moment),
        revision: Revision,
        manageable: Type.Boolean(),
        /** Die Sonderrollen, die beim Einlösen hinzukommen (WI-0279); ein Server davor schickt das Feld nicht. */
        sonderrollen: Type.Optional(
            Type.Array(
                Type.Object(
                    { sonderrolle: Type.String(), region: Nullable(RegionRef) },
                    { additionalProperties: false },
                ),
            ),
        ),
    },
    { additionalProperties: false },
);
export type AdminInvitation = Static<typeof AdminInvitation>;

export const AuditEntry = Type.Object(
    {
        id: Type.String(),
        at: Moment,
        action: Type.String(),
        actorKind: Type.Union([
            Type.Literal("person"),
            Type.Literal("cli"),
            Type.Literal("system"),
            Type.Literal("anonymous"),
        ]),
        actor: Nullable(PersonRef),
        actorLabel: Nullable(Type.String()),
        target: Nullable(PersonRef),
        targetRef: Nullable(Type.String()),
        details: Type.Record(Type.String(), Type.Unknown()),
        recovery: Type.Boolean(),
        operationId: Nullable(Type.String()),
        clientLabel: Nullable(Type.String()),
        ipPrefix: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type AuditEntry = Static<typeof AuditEntry>;

export const AuditPage = Type.Object(
    { events: Type.Array(AuditEntry), next: Nullable(Type.String()) },
    { additionalProperties: false },
);
export type AuditPage = Static<typeof AuditPage>;

/**
 * Die zwei Filter des einen Protokolls (WI-0127 SYS-15, SYS-0001 §9d.2): `konten` in der Kontenverwaltung, `system` in der
 * Systemsteuerung. Welche Ereignisart wohin gehört, steht an EINER Stelle auf dem Server (`AUDIT_BEREICH` in `auth/audit.ts`).
 */
export const AUDIT_BEREICHE = ["konten", "system"] as const;
export type AuditBereich = (typeof AUDIT_BEREICHE)[number];

/** Eine Liste von Handlungen für `qAktionen`: `login.failure,logout`, höchstens 80. */
export const AUDIT_AKTIONEN = /^[a-z_]+(\.[a-z_]+)?(,[a-z_]+(\.[a-z_]+)?){0,79}$/u;

export const AuditQuery = Type.Object(
    {
        /** Nur die Ereignisse eines Bereichs; ohne Angabe alle (die Systemsteuerung zeigt das dem Betreiber). */
        bereich: Type.Optional(Type.Union(AUDIT_BEREICHE.map((bereich) => Type.Literal(bereich)))),
        /** Eine Handlung (`person.locked`) oder eine Gruppe mit Punkt am Ende (`person.`). */
        action: Type.Optional(Type.String({ pattern: "^[a-z_]+(\\.[a-z_]*)?$", maxLength: 60 })),
        /** Handelnde oder betroffene Person. */
        personId: Type.Optional(PersonId),
        from: Type.Optional(Type.String({ minLength: 10, maxLength: 40 })),
        to: Type.Optional(Type.String({ minLength: 10, maxLength: 40 })),
        /** Weiterblättern: `next` der vorigen Seite. */
        before: Type.Optional(Type.String({ pattern: "^[0-9]{1,18}$" })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        /**
         * Freitext (Betreiber 2026-10-11, Entscheidungsprotokoll 3f7acfc8): Teil der Handlung, eines Namens (handelnd oder betroffen,
         * auch Werkzeug und Legacy-Name) oder eines Werts der Details, ohne Groß und Klein. `%` und `_` sind Zeichen, kein Muster.
         */
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        /**
         * Zur Suche gehörig: die Handlungen, deren angezeigter Titel den Freitext enthält („Anmeldung abgewiesen“ für `login.failure`),
         * mit Komma getrennt. Die Titel kennt nur die Oberfläche (i18n); sie rechnet die Liste aus. Gilt nur mit `q`, ODER mit dem Text.
         */
        qAktionen: Type.Optional(Type.String({ pattern: AUDIT_AKTIONEN.source, maxLength: 3000 })),
    },
    { additionalProperties: false },
);
export type AuditQuery = Static<typeof AuditQuery>;

/** Die Tafel „Rollen & Rechte“: die Matrix kommt aus dem Katalog, hier stehen die Inhaber der Sonderrechte. */
export const AdminRolesOverview = Type.Object(
    {
        operators: Type.Array(PersonRef),
        grants: Type.Array(
            Type.Object(
                {
                    person: PersonRef,
                    capability: Type.String(),
                    grantedAt: Moment,
                    grantedBy: Nullable(PersonRef),
                    reason: Type.String(),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type AdminRolesOverview = Static<typeof AdminRolesOverview>;

/**
 * Der Reiter „Sonderrollen“ (WI-0279): alle Zuteilungen dieser Umgebung samt den beendeten (sie sind der Verlauf), und die Regionen zur
 * Auswahl. Lesen ab Admin; den Grund liefert der Server nur, wer auch vergeben darf (E9b: Der Grund bleibt bei Betreibern und im
 * Protokoll).
 */
export const SonderrolleZuteilung = Type.Object(
    {
        id: Type.String(),
        sonderrolle: Type.String(),
        person: PersonRef,
        /** Die Grundrolle der Person in dieser Umgebung; `null`, wenn sie hier keinen Zugang mehr hat. */
        personRolle: Nullable(RoleName),
        hatPasskey: Type.Boolean(),
        region: Nullable(RegionRef),
        vergebenAm: Moment,
        vergebenVon: Nullable(PersonRef),
        grund: Nullable(Type.String()),
        entzogenAm: Nullable(Moment),
        entzogenVon: Nullable(PersonRef),
        entzugGrund: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type SonderrolleZuteilung = Static<typeof SonderrolleZuteilung>;

/**
 * Der Weg Production → Stage (WI-0279 E9; Claudio 2026-11-03): Die Stage fragt, Production antwortet, und Production schreibt nirgends. Konten
 * wandern nicht, nur diese drei Angaben, und nur in dieser Richtung (ADR-0013). Die Stage erkennt die Person an der Discord-ID.
 */
export const SONDERROLLEN_ABGLEICH_URL = "/api/intern/sonderrollen";
export const SonderrollenAbgleichEintrag = Type.Object(
    { discordId: Type.String(), sonderrolle: Type.String(), region: Nullable(Type.String()) },
    { additionalProperties: false },
);
export type SonderrollenAbgleichEintrag = Static<typeof SonderrollenAbgleichEintrag>;
export const SonderrollenAbgleich = Type.Object(
    { zuteilungen: Type.Array(SonderrollenAbgleichEintrag) },
    { additionalProperties: false },
);
export type SonderrollenAbgleich = Static<typeof SonderrollenAbgleich>;

/** Wie es um den Abgleich steht, nur auf der Stage. `ruht`: Alle Sonderrollen ruhen, bis Production wieder antwortet. */
export const SonderrollenAbgleichStand = Type.Object(
    {
        stand: Type.Union([Type.Literal("ausstehend"), Type.Literal("ok"), Type.Literal("gestoert")]),
        zuletzt: Nullable(Moment),
        gestoertSeit: Nullable(Moment),
        ruht: Type.Boolean(),
        ohneKontoZahl: Type.Integer({ minimum: 0 }),
        /** Was von Production kam und hier kein Konto findet, mit der Discord-ID; nur für Betreiber. */
        ohneKonto: Type.Array(SonderrollenAbgleichEintrag),
    },
    { additionalProperties: false },
);
export type SonderrollenAbgleichStand = Static<typeof SonderrollenAbgleichStand>;

export const SonderrollenUebersicht = Type.Object(
    {
        zuteilungen: Type.Array(SonderrolleZuteilung),
        regionen: Type.Array(RegionRef),
        /** Nur wo der Weg von Production eingerichtet ist: Der Reiter liest dort nur. */
        abgleich: Type.Optional(SonderrollenAbgleichStand),
    },
    { additionalProperties: false },
);
export type SonderrollenUebersicht = Static<typeof SonderrollenUebersicht>;

export const AdminLegacyIdentity = Type.Object(
    {
        id: Type.String(),
        legacyUserId: Nullable(Type.String()),
        legacyName: Type.String(),
        knownNames: Type.Array(Type.String()),
        kind: Type.Union([Type.Literal("person"), Type.Literal("machine"), Type.Literal("deleted")]),
        person: Nullable(PersonRef),
        mappedAt: Nullable(Moment),
        mappedBy: Nullable(PersonRef),
        evidence: Nullable(Type.String()),
        revision: Revision,
    },
    { additionalProperties: false },
);
export type AdminLegacyIdentity = Static<typeof AdminLegacyIdentity>;

export const LegacyQuery = Type.Object(
    {
        status: Type.Optional(Type.Union([Type.Literal("unmapped"), Type.Literal("mapped"), Type.Literal("all")])),
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    },
    { additionalProperties: false },
);

/** Antwort einer Handlung, die einen Link erzeugt: der Link nur beim ersten Mal, bei einer Wiederholung `null`. */
export const LinkReceipt = Type.Object(
    { receipt: OperationReceipt, link: Nullable(Type.String()), expiresAt: Nullable(Moment) },
    { additionalProperties: false },
);
export type LinkReceipt = Static<typeof LinkReceipt>;

// Anfragen

const strict = { additionalProperties: false } as const;

export const RoleChangeBody = Type.Object(
    { operationId: OperationId, personId: PersonId, role: RoleName, baseRevision: Revision },
    strict,
);
export type RoleChangeBody = Static<typeof RoleChangeBody>;

export const PersonRevisionBody = Type.Object(
    { operationId: OperationId, personId: PersonId, baseRevision: Revision },
    strict,
);
export type PersonRevisionBody = Static<typeof PersonRevisionBody>;

export const LockBody = Type.Object(
    {
        operationId: OperationId,
        personId: PersonId,
        reason: Type.String({ minLength: 1, maxLength: 200 }),
        baseRevision: Revision,
    },
    strict,
);
export type LockBody = Static<typeof LockBody>;

/** „Verantwortlich für:“ einer Person setzen oder leeren (`""`), nur `set_responsibility` (WI-0133). */
export const PersonResponsibilityBody = Type.Object(
    {
        operationId: OperationId,
        personId: PersonId,
        responsibleFor: Type.String({ maxLength: 1000 }),
        baseRevision: Revision,
    },
    strict,
);
export type PersonResponsibilityBody = Static<typeof PersonResponsibilityBody>;

export const PersonActionBody = Type.Object({ operationId: OperationId, personId: PersonId }, strict);
export type PersonActionBody = Static<typeof PersonActionBody>;

export const SessionsRevokeBody = Type.Object(
    { operationId: OperationId, personId: PersonId, sessionId: Type.Optional(Type.String({ pattern: UUID_PATTERN })) },
    strict,
);
export type SessionsRevokeBody = Static<typeof SessionsRevokeBody>;

export const GrantBody = Type.Object(
    {
        operationId: OperationId,
        personId: PersonId,
        capability: Type.String({ minLength: 1, maxLength: 60 }),
        reason: Type.String({ minLength: 1, maxLength: 300 }),
    },
    strict,
);
export type GrantBody = Static<typeof GrantBody>;

export const SonderrolleWahl = Type.Object(
    {
        sonderrolle: Type.String({ minLength: 1, maxLength: 40 }),
        /** Pflicht bei regionalen Sonderrollen, sonst leer; Kennungen von Flächen der Ebene `derographisch`. */
        regionen: Type.Optional(Type.Array(Type.String({ pattern: UUID_PATTERN }), { maxItems: 100 })),
    },
    strict,
);
export type SonderrolleWahl = Static<typeof SonderrolleWahl>;

export const SonderrolleVergebenBody = Type.Object(
    {
        operationId: OperationId,
        personId: PersonId,
        sonderrolle: Type.String({ minLength: 1, maxLength: 40 }),
        regionen: Type.Optional(Type.Array(Type.String({ pattern: UUID_PATTERN }), { maxItems: 100 })),
        grund: Type.String({ minLength: 1, maxLength: 300 }),
    },
    strict,
);
export type SonderrolleVergebenBody = Static<typeof SonderrolleVergebenBody>;

export const SonderrolleEntziehenBody = Type.Object(
    {
        operationId: OperationId,
        zuteilungId: Type.String({ pattern: "^[0-9]{1,19}$" }),
        grund: Type.String({ minLength: 1, maxLength: 300 }),
    },
    strict,
);
export type SonderrolleEntziehenBody = Static<typeof SonderrolleEntziehenBody>;

export const InvitationCreateBody = Type.Object(
    {
        operationId: OperationId,
        role: RoleName,
        validDays: Type.Union([Type.Literal(1), Type.Literal(3), Type.Literal(7), Type.Literal(14)]),
        note: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        /** Pflicht für Admin und Betreiber (D3) und bei Sonderrollen; die Discord-ID, nie der Name. */
        discordUserId: Type.Optional(Type.String({ pattern: "^[0-9]{15,21}$" })),
        /** Kommen beim Einlösen hinzu (WI-0279); nur der Betreiber, mit frischem Passkey und Grund. */
        sonderrollen: Type.Optional(Type.Array(SonderrolleWahl, { maxItems: 10 })),
        sonderrollenGrund: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    },
    strict,
);
export type InvitationCreateBody = Static<typeof InvitationCreateBody>;

export const InvitationActionBody = Type.Object(
    { operationId: OperationId, invitationId: Type.String({ pattern: UUID_PATTERN }), baseRevision: Revision },
    strict,
);
export type InvitationActionBody = Static<typeof InvitationActionBody>;

const LegacyIdentityId = Type.String({ pattern: "^[0-9]{1,18}$" });

export const LegacyMapBody = Type.Object(
    {
        operationId: OperationId,
        legacyIdentityId: LegacyIdentityId,
        personId: PersonId,
        evidence: Type.String({ minLength: 1, maxLength: 300 }),
        baseRevision: Revision,
    },
    strict,
);
export type LegacyMapBody = Static<typeof LegacyMapBody>;

export const LegacyUnmapBody = Type.Object(
    { operationId: OperationId, legacyIdentityId: LegacyIdentityId, baseRevision: Revision },
    strict,
);
export type LegacyUnmapBody = Static<typeof LegacyUnmapBody>;
