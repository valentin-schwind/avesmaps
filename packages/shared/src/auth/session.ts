import { Type, type Static } from "@sinclair/typebox";

/**
 * `GET /api/auth/session` (WI-0120 A3, AUTH-0001 §8): wer angemeldet ist, was diese Anfrage darf und in welcher Umgebung sie
 * läuft. Der Client baut daraus seinen `ViewerContext`; die Wahrheit bleibt beim Server, der jede Route selbst prüft.
 */
export const LoginMethod = Type.Union([Type.Literal("discord"), Type.Literal("password"), Type.Literal("passkey")]);
export type LoginMethod = Static<typeof LoginMethod>;

/**
 * Die Bezeichnung (WI-0279 E10): die Wortform, in der die Rollen einer Person stehen. Keine Anrede und kein Geschlecht, nur eine von drei
 * Formen. Freiwillig, nur die Person selbst wählt; ohne Wahl (`null`) steht die neutrale Form.
 */
export const BEZEICHNUNGEN = ["maskulin", "feminin", "neutral"] as const;
export const BezeichnungWert = Type.Union([Type.Literal("maskulin"), Type.Literal("feminin"), Type.Literal("neutral")]);
export type Bezeichnung = Static<typeof BezeichnungWert>;

/** Eine Sonderrolle zum Anzeigen (WI-0279): bei regionalen Rollen eine Zeile je Region, mit deren Namen. */
export const SonderrolleAnzeige = Type.Object(
    { sonderrolle: Type.String(), region: Type.Union([Type.String(), Type.Null()]) },
    { additionalProperties: false },
);
export type SonderrolleAnzeige = Static<typeof SonderrolleAnzeige>;

export const SessionPerson = Type.Object(
    {
        id: Type.String(),
        displayName: Type.String(),
        role: Type.String(),
        /** Welche Anmeldewege die Person eingerichtet hat. */
        methods: Type.Array(LoginMethod),
        /** Wie diese Sitzung entstand: `basic` (Stufe R), `strong` (zweiter Faktor), `recovery` (Notzugang). */
        assurance: Type.Union([Type.Literal("basic"), Type.Literal("strong"), Type.Literal("recovery")]),
        sessionMethod: Type.Union([LoginMethod, Type.Literal("recovery")]),
        confirmedAt: Type.String(),
        passkeyConfirmedAt: Type.Union([Type.String(), Type.Null()]),
        expiresAt: Type.String(),
        passkeyCount: Type.Integer({ minimum: 0 }),
        /** WI-0279 E10; optional, damit ein Client einen älteren Server liest wie ohne Wahl. */
        bezeichnung: Type.Optional(Type.Union([BezeichnungWert, Type.Null()])),
        /** Die eigenen Sonderrollen, für Konto und Bezeichnung; was sie dürfen, sagt `capabilities`. */
        sonderrollen: Type.Optional(Type.Array(SonderrolleAnzeige)),
        /**
         * „Verantwortlich für:“ (WI-0133), `null` = nicht gesetzt; für die späteren Statusanzeigen („Vali – Verantwortlich für: …“),
         * heute noch nirgends gezeigt. Der Server schickt es immer; fehlt es (Server der Vorversion), gilt `null`.
         */
        responsibleFor: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    },
    { additionalProperties: false },
);
export type SessionPerson = Static<typeof SessionPerson>;

export const AuthSessionResponse = Type.Object(
    {
        /** `development`, `staging`, `production`, `test`; `null`, wenn die Anmeldung hier nicht eingerichtet ist. */
        environment: Type.Union([Type.String(), Type.Null()]),
        authEnabled: Type.Boolean(),
        person: Type.Union([SessionPerson, Type.Null()]),
        capabilities: Type.Array(Type.String()),
        /**
         * Darf diese Sitzung den Kanal `/ws` betreten (WI-0197)? Dieselbe Regel wie der Handschlag (`routes/live-hint.ts`,
         * `liveChannelFor`). Die Karte versucht `/ws` nur damit: Ein abgewiesener Handschlag steht sonst bei jedem Besucher als
         * Fehler in der Konsole. Optional, damit ein Client einen älteren Server ohne das Feld liest wie bisher.
         */
        liveChannel: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);
export type AuthSessionResponse = Static<typeof AuthSessionResponse>;
