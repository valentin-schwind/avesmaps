import { Type, type Static, type TSchema } from "@sinclair/typebox";

/**
 * Der Systemzustand in der Systemsteuerung (WI-0127 SYS-8, SYS-0001 §3.6, §3.7, §6.3; Blatt WI-0119 A7, A9, Z7): Komponenten, Auslastung
 * mit Verlauf über 24 h, Datenbank, Platte. Lesen mit `view_operations` (Stufe V); es gibt nichts zu schalten.
 *
 * 🔴 **„Unbekannt“ ist nie 0.** Jeder Wert, den die Anwendung nicht messen kann (Last unter Windows, Auslagerung ohne `/proc`, Werte aus
 * Claudios `system.json`, solange die Datei fehlt oder älter als 15 min ist, Verbindungen ohne die Rolle `avesmaps3d_stats`), ist `null`, und
 * die Anzeige sagt „unbekannt“. Anzeigeschwellen (Platte unter 15 % frei) sind Anzeige, keine Prüfung: Nichts hält an.
 */
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const Bytes = Type.Integer({ minimum: 0 });
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

/** Älter als das ist `system.json` „veraltet“, und ihre Werte gelten als unbekannt (§3.6). */
export const SYSTEM_STATUS_MAX_AGE_MS = 15 * 60_000;
/** Ab diesem freien Anteil zeigt eine Platte „Warnung“ (§6.3, nur Anzeige). */
export const PLATTE_WARNUNG_FREI = 0.15;
/** Der Takt der Stichprobe für den Verlauf (§3.7) und wie lange sie bleibt. */
export const STICHPROBE_MS = 5 * 60_000;
export const STICHPROBE_HALTEN_MS = 25 * 3_600_000;
/** So oft fragt der offene Eintrag neu (§6.3, Fuß „Gemessen alle 30 s, Verlauf alle 5 min.“). */
export const SYSTEMZUSTAND_NACHSEHEN_MS = 30_000;

export const KOMPONENTEN_ZUSTAENDE = ["gesund", "warnung", "ausgefallen", "unbekannt"] as const;
export type KomponentenZustand = (typeof KOMPONENTEN_ZUSTAENDE)[number];

/** Die Zeilen wie im Blatt A7; „Nginx und Tür“ ist EINE Zeile (Dienst laut `system.json` und Claudios Probe von außen). */
export const KOMPONENTEN = ["fastify", "routing", "jobs", "postgresql", "martin", "nginx", "sicherung"] as const;
export type KomponentenId = (typeof KOMPONENTEN)[number];

/**
 * Eine Komponente: Zustand, seit wann (wo bekannt), Version (wo bekannt) und ein Hinweis als Kennung, die die Oberfläche übersetzt
 * (`ready`, `warming`, `cold`, `failed`, `lock_held`, `no_planner`, `active`, `inactive`, `door_ok`, `door_mismatch`, `not_set_up`,
 * `stale`, `unreadable`, `not_configured`, …; für den Dirigenten der gemeinsamen Warteschlange `dirigent_active`, `dirigent_stale`,
 * `dirigent_missing`, `dirigent_unreadable`, `dirigent_not_here`, WI-0163). Kein freier Text aus Dateien oder Fehlermeldungen.
 */
export const SystemKomponente = Type.Object(
    {
        id: literals(KOMPONENTEN),
        zustand: literals(KOMPONENTEN_ZUSTAENDE),
        seit: Nullable(Moment),
        version: Nullable(Type.String()),
        hinweis: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type SystemKomponente = Static<typeof SystemKomponente>;

/**
 * Der Schemastand dieser Instanz (Betreiber 2026-10-14): welche Migration zuletzt eingespielt wurde und welche das
 * laufende Release mitbringt.
 *
 * 🔴 **Warum das hier steht:** Ein ausgebliebenes `migrate` sah bisher aus wie ein kaputtes Feature. Die
 * Besucherstatistik blieb leer, der Freigabe-Knopf tat nichts — und nirgends stand, woran es lag. Niemand konnte
 * zwischen „nicht gebaut“, „nicht eingespielt“ und „kaputt“ unterscheiden, ohne auf den VPS zu sehen.
 *
 * 🪤 Optional, damit ein neuer Client auch gegen ein Release ohne dieses Feld liest (Überlappung beim Ausrollen).
 */
export const SystemMigrationen = Type.Object(
    {
        zustand: literals(["vollstaendig", "fehlend", "unlesbar"] as const),
        /** Die höchste eingespielte Migration, etwa `0121_media_merge`; `null`, wenn sich keine lesen ließ. */
        eingespielt: Nullable(Type.String()),
        /** Die höchste, die dieses Release mitbringt. */
        erwartet: Nullable(Type.String()),
        /** Wie viele Migrationen des Release in der Datenbank noch fehlen. */
        fehlend: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);
export type SystemMigrationen = Static<typeof SystemMigrationen>;

/**
 * Ein Prozess mit seinem Speicher (WI-0127 §22). `rss` ist der Arbeitssatz eines eigenen Prozesses. Der Routing-Worker ist ein Thread IM
 * Fastify-Prozess (`imProzess`): Er hat kein eigenes `rss`, sein Speicher steckt in dem von Fastify; gezeigt werden sein Heap und der Graph
 * (Speicher außerhalb des Heaps, vor allem die ArrayBuffers des Graphen). Der Jobs-Worker meldet sich mit einem Lebenszeichen: eigenes `rss`
 * und die rechnenden Kindprozesse, `stand` ist der Zeitpunkt der Messung. Neue Felder sind optional (der Client liest tolerant).
 */
export const SystemProzess = Type.Object(
    {
        id: literals(["fastify", "routing", "jobs"] as const),
        rss: Nullable(Bytes),
        imProzess: Type.Optional(Type.Literal("fastify")),
        heap: Type.Optional(Nullable(Bytes)),
        graph: Type.Optional(Nullable(Bytes)),
        kinder: Type.Optional(
            Type.Object({ anzahl: Type.Integer({ minimum: 0 }), rss: Bytes }, { additionalProperties: false }),
        ),
        stand: Type.Optional(Nullable(Moment)),
    },
    { additionalProperties: false },
);
export type SystemProzess = Static<typeof SystemProzess>;

/** Ein Datenträger: aus der Anwendung (`fs.statfs` auf Kacheln und Medien) oder aus `system.json` (alle Einhängepunkte). */
export const SystemPlatte = Type.Object(
    {
        id: Type.String(),
        quelle: literals(["anwendung", "datei"] as const),
        gesamt: Nullable(Bytes),
        frei: Nullable(Bytes),
    },
    { additionalProperties: false },
);
export type SystemPlatte = Static<typeof SystemPlatte>;

export const SystemVerlaufPunkt = Type.Object(
    { bucket: Moment, last1: Nullable(Type.Number()), belegt: Nullable(Bytes), auslagerung: Nullable(Bytes) },
    { additionalProperties: false },
);
export type SystemVerlaufPunkt = Static<typeof SystemVerlaufPunkt>;

export const SystemTuerProbe = Type.Object(
    {
        url: Type.String(),
        erwartet: Nullable(Type.String()),
        bekommen: Nullable(Type.String()),
        ms: Nullable(Type.Number()),
    },
    { additionalProperties: false },
);
export type SystemTuerProbe = Static<typeof SystemTuerProbe>;

/** `GET /api/admin/system/health`. */
export const AdminSystemzustand = Type.Object(
    {
        now: Moment,
        /** Claudios `system.json`: nicht eingerichtet (lokal der Normalfall), aktuell, veraltet (> 15 min) oder unlesbar. */
        datei: Type.Object(
            {
                zustand: literals(["nicht_eingerichtet", "aktuell", "veraltet", "unlesbar"] as const),
                stand: Nullable(Moment),
                host: Nullable(Type.String()),
                neueresFormat: Type.Boolean(),
            },
            { additionalProperties: false },
        ),
        komponenten: Type.Array(SystemKomponente),
        /** Der Schemastand (Betreiber 2026-10-14); fehlt bei einem Release vor diesem Feld. */
        migrationen: Type.Optional(SystemMigrationen),
        auslastung: Type.Object(
            {
                /** Last über 1, 5 und 15 min; `null` unter Windows (dort meldet Node 0). */
                last: Nullable(
                    Type.Object(
                        { eins: Type.Number(), fuenf: Type.Number(), fuenfzehn: Type.Number() },
                        { additionalProperties: false },
                    ),
                ),
                kerne: Nullable(Type.Integer({ minimum: 1 })),
                speicher: Type.Object(
                    {
                        gesamt: Nullable(Bytes),
                        belegt: Nullable(Bytes),
                        auslagerung: Nullable(Bytes),
                        auslagerungGesamt: Nullable(Bytes),
                    },
                    { additionalProperties: false },
                ),
                prozesse: Type.Array(SystemProzess),
                /** Laufzeit des Rechners und dieses Prozesses in Sekunden. */
                laufzeit: Type.Object(
                    { system: Nullable(Type.Integer({ minimum: 0 })), prozess: Type.Integer({ minimum: 0 }) },
                    { additionalProperties: false },
                ),
                platten: Type.Array(SystemPlatte),
            },
            { additionalProperties: false },
        ),
        /** Die Stichproben der letzten 24 h (je 5 min, älteste zuerst); leer, solange keine geschrieben ist. */
        verlauf: Type.Array(SystemVerlaufPunkt),
        datenbank: Type.Object(
            {
                groesse: Nullable(Bytes),
                /** Aus `connection_counts()`; `null` ohne die Rolle `avesmaps3d_stats` (dann „unbekannt“). */
                verbindungen: Nullable(
                    Type.Object(
                        {
                            belegt: Type.Integer({ minimum: 0 }),
                            erlaubt: Type.Integer({ minimum: 0 }),
                            reserviert: Type.Integer({ minimum: 0 }),
                            eigene: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
                        },
                        { additionalProperties: false },
                    ),
                ),
                tabellen: Type.Array(
                    Type.Object({ name: Type.String(), bytes: Bytes }, { additionalProperties: false }),
                ),
            },
            { additionalProperties: false },
        ),
        /** Auf der Platte, aus `system.json` (stündlich gemessen); `null` ohne aktuelle Datei. */
        groessen: Nullable(
            Type.Object(
                {
                    at: Nullable(Moment),
                    kacheln: Nullable(Bytes),
                    medienVeroeffentlicht: Nullable(Bytes),
                    medienPrivat: Nullable(Bytes),
                    sicherungenLokal: Nullable(Bytes),
                },
                { additionalProperties: false },
            ),
        ),
        /** Die Tür von außen (Claudios Probe von der öffentlichen Adresse); `null` ohne aktuelle Datei. */
        tuer: Nullable(
            Type.Object(
                { at: Nullable(Moment), von: Nullable(Type.String()), proben: Type.Array(SystemTuerProbe) },
                { additionalProperties: false },
            ),
        ),
        /** Die Dienste laut `system.json` (`active`, `inactive`, `failed`, …); leer ohne aktuelle Datei. */
        dienste: Type.Array(
            Type.Object({ name: Type.String(), zustand: Type.String() }, { additionalProperties: false }),
        ),
    },
    { additionalProperties: false },
);
export type AdminSystemzustand = Static<typeof AdminSystemzustand>;
