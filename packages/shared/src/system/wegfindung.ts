import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "../operation.ts";

/**
 * Die Formen des Reiters „Wegfindung“ (WI-0153, SYS-0001 §9d): was der Leseweg antwortet und was der Schreibweg annimmt.
 * Die Werte selbst stehen in `packages/shared/src/wegfindung.ts` — DIE Tafel, für Server und Oberfläche dieselbe.
 *
 *     GET  /api/admin/system/wegfindung   die Abweichungen und ihre Revision          view_operations (V)
 *     POST /api/admin/system/wegfindung   { operationId, baseRevision, id, value }    manage_system_settings (S)
 *
 * 🔴 **Zwei Tafeln, eine Regel** (WI-0153 Schnitte 6 und 7c): Was am Knopf hängt (Folge `netz` und `seegraph`), rechnet
 * der Dienst aus dem FREIGEGEBENEN Stand (`routing_setting_applied`, Migration 0135) — allein der Knopf schreibt ihn fort.
 * Alles andere rechnet er aus dem GESPEICHERTEN Stand und holt es sich von selbst. Die Regel steht im Register
 * (`wegfindungAmKnopf`), damit Oberfläche und Dienst nicht zwei Wahrheiten haben.
 *
 * 🔴 **Gespeichert wird nur, was verstellt ist** (`routing_setting`, Migration 0132); der Rest ist die Vorgabe aus der
 * Tafel. Darum trägt die Antwort nur die abweichenden Zeilen, nicht alle 51: Die Oberfläche kennt die Tafel schon, und
 * eine zweite Liste derselben Zahlen über die Leitung wäre eine zweite Wahrheit.
 *
 * 🔴 `value: null` im Schreibweg heißt **zurück auf die Vorgabe** (die Zeile wird gelöscht, nicht auf die Vorgabe
 * gesetzt): Eine gespeicherte Zahl, die heute zufällig der Vorgabe gleicht, verdeckte sonst eine spätere Änderung im
 * Code. Das ist das Rücksetzzeichen ↺ der Zeile.
 */
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const WEGFINDUNG_URL = "/api/admin/system/wegfindung";

/**
 * Die wirksamen Werte, die der Browser selbst anwendet (`WEGFINDUNG_IM_BROWSER`, WI-0214), im öffentlichen Leseweg der
 * Karteneinstellungen. `landscapeMinShare` in Prozent wie im Register. Fehlt das Feld (ein älterer Server), gelten im
 * Browser die Vorgaben.
 */
export const WegfindungImBrowser = Type.Object(
    {
        routeWaypointLimit: Type.Number(),
        routeMapPointLimit: Type.Number(),
        landscapeMinShare: Type.Number(),
    },
    { additionalProperties: false },
);
export type WegfindungImBrowser = Static<typeof WegfindungImBrowser>;

/** Die Kennung einer Einstellung, wie die Tafel sie führt (aus dem Namen der Konstante): `endSnap`, `seaCellUnits`. */
export const WEGFINDUNG_ID_MUSTER = "^[a-z][A-Za-z0-9]{0,59}$";

export const AdminWegfindungRow = Type.Object(
    {
        id: Type.String(),
        /** Der GESPEICHERTE Wert; `null` heißt: zurückgesetzt, es gilt wieder die Vorgabe des Registers. */
        value: Nullable(Type.Number()),
        /**
         * Der Wert, mit dem der Dienst RECHNET; `null` heißt: es gilt die Vorgabe des Registers.
         *
         * - Für die Kennungen am Knopf (Folge `netz`) ist das der freigegebene Stand (`routing_setting_applied`,
         *   Migration 0135). Weicht er von `value` ab, ist die Zeile geändert und noch nicht gerechnet — genau das
         *   zählt die Leiste über den Panelen.
         * - Für alle anderen ist er GLEICH `value`: Sie gelten ohne Knopf, der Dienst holt sie sich mit der nächsten
         *   Prüfung (höchstens fünf Sekunden). Darum ist `value !== applied` die eine Regel für „wartet auf den Knopf“.
         */
        applied: Nullable(Type.Number()),
        changedAt: Nullable(Moment),
        changedBy: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type AdminWegfindungRow = Static<typeof AdminWegfindungRow>;

/**
 * Der Seegraph im Reiter (WI-0153 Schnitt 7b; Betreiber 2026-10-18: über den einen Knopf): `derivedAt` aus `sea_route_graph` (`null`:
 * es gibt keinen); `stale`: Meere, Seen, Häfen, Klimabänder oder die freigegebenen Werte des Seegraphen passen nicht mehr zu seinem
 * Fingerabdruck (oder es gibt keinen Graphen) — dann weckt das den Knopf; `job` und `jobState` vom jüngsten Auftrag `sea_derive`,
 * ein wartender oder laufender vor einem fertigen, `null` solange nie einer eingereiht wurde.
 */
export const SeegraphStand = Type.Object(
    {
        derivedAt: Nullable(Moment),
        stale: Type.Boolean(),
        job: Nullable(Type.String()),
        jobState: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type SeegraphStand = Static<typeof SeegraphStand>;

/** `GET /api/admin/system/wegfindung`. */
export const AdminWegfindung = Type.Object(
    {
        now: Moment,
        /** Die Revision der Einstellungen (`routing_setting_state.revision`), Grundlage für `baseRevision`. */
        revision: Nullable(Type.Integer({ minimum: 0 })),
        /** `unprovisioned`: Die Tafel fehlt (vor Migration 0132), es gelten die Vorgaben. */
        source: literals(["database", "unprovisioned"] as const),
        /** Jede Kennung, die gespeichert ODER freigegeben von ihrer Vorgabe abweicht, nach Kennung sortiert. */
        rows: Type.Array(AdminWegfindungRow),
        /** Kennungen in einer der beiden Tafeln, die das Register nicht kennt (übergangen). */
        unknownKeys: Type.Array(Type.String()),
        /** Wann zuletzt freigegeben wurde; `null`, solange nie. */
        appliedAt: Nullable(Moment),
        /** Wer freigegeben hat (Anzeigename oder Etikett der Kommandozeile). */
        appliedBy: Nullable(Type.String()),
        /** Der zuletzt eingereihte `routing_reload` und sein Zustand aus der Warteschlange. */
        appliedJob: Nullable(Type.String()),
        appliedJobState: Nullable(Type.String()),
        /** Der Seegraph (WI-0153 7b): wann er zuletzt abgeleitet wurde und der jüngste Auftrag `sea_derive` mit seinem Zustand. */
        seaGraph: SeegraphStand,
    },
    { additionalProperties: false },
);
export type AdminWegfindung = Static<typeof AdminWegfindung>;

/**
 * `POST /api/admin/system/wegfindung`; `value: null` setzt auf die Vorgabe zurück.
 *
 * 🪤 **Im Anfrageinhalt ist `value` EIN Schema mit zwei Typen, keine Vereinigung.** Fastifys ajv wandelt Typen um
 * (`coerceTypes`), und für ein Zahlenschema ist `null` → `0` eine erlaubte Umwandlung: Aus `Nullable(Type.Number())`
 * (`anyOf`, Zahl zuerst) kommt beim Handler eine 0 an, das Zurücksetzen fällt als „außerhalb der Grenzen“ heraus.
 * Nur der erste Zweig wandelt um, darum hilft keine Reihenfolge: Mit `Type.Null()` zuerst bliebe `null`, aber eine echte 0
 * würde `null` (gemessen 2026-10-19, Fastify 5.12.5, `project-control/discovery/ajv-umwandlung-2026-10-19.md`).
 * `type: ["number", "null"]` wandelt weder `null` noch eine Zahl um, weil beide erlaubte Typen sind — dasselbe Mittel
 * wie bei den Höhenwerten einer Route (`route.ts`). In der ANTWORT bleibt `Nullable`: Dort wird nichts umgewandelt.
 */
export const WegfindungBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        id: Type.String({ minLength: 1, maxLength: 60, pattern: WEGFINDUNG_ID_MUSTER }),
        value: Type.Unsafe<number | null>({ type: ["number", "null"] }),
    },
    { additionalProperties: false },
);
export type WegfindungBody = Static<typeof WegfindungBody>;

/**
 * `POST /api/admin/system/wegfindung/freigeben` — der eine Auslöser über den Panelen.
 *
 * 🔴 Er speichert nichts: Er schreibt den gespeicherten Stand als freigegeben fort, schreibt sein Protokollereignis und
 * reiht `routing_reload` ein — davor `sea_derive`, wenn der Seegraph danach nicht mehr zu seinen Quellen passt (WI-0153 7c).
 * Steht kein Wert an, ist aber der Seegraph veraltet, gibt er trotzdem frei. Erst damit ändert sich die Routing-Revision, und erst damit holen sich die Worker (einer
 * je Fastify-Instanz) den neuen Stand. `baseRevision` ist dieselbe wie beim Verstellen.
 */
export const WegfindungFreigabeBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false },
);
export type WegfindungFreigabeBody = Static<typeof WegfindungFreigabeBody>;

export const WEGFINDUNG_FREIGABE_URL = "/api/admin/system/wegfindung/freigeben";

export const WEGFINDUNG_ERROR_STATUS = {
    unknown_setting: 400,
    value_out_of_range: 400,
    no_change: 409,
    nothing_to_apply: 409,
} as const;
