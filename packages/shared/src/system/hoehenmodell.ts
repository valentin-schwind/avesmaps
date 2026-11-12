import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { GebirgsPresetGruppeSchema } from "../gebirge/vertrag.ts";
import { GEBIRGS_MUSTER } from "../gebirge/regler.ts";
import { OperationId } from "../operation.ts";
import { SYSTEM_REASON_MAX } from "./system-state.ts";

/**
 * Das Höhenmodell in der Systemsteuerung (WI-0127 SYS-13, SYS-0001 §9c; Betreiber 2026-10-10 „nach Empfehlung“, §9c.12). Betreiber
 * 2026-10-10: „Höhenmodelleinstellungen sollten in der Systemsteuerung vorgenommen werden können“ und „alte und neue version … als option“.
 *
 * - **Fassungen** sind geprüfte Dateien (`config/terrain/aventuria/<n>.json`), überall gleich (Frage 1 C). Gewählt wird je Umgebung;
 *   ein Wechsel und der Rückweg rechnen die ganze Karte neu (§9c.11).
 * - **Entwürfe** ändern nur die freigegebenen Regler (Frage 2 „A plus“): Rückverteilung (Radius, Sättigung) und acht globale Werte. Die
 *   Tafeln je Landschaftsart, die Gebirgsregeln und die technischen Werte sind nur lesbar. Gemessen wird als Job, nie veröffentlicht.
 * - **Rechte** (Frage 3 B): sehen `view_operations`; Entwurf und Messen `manage_terrain_recipe` (Stufe V); Wählen, Zurück und Abnehmen
 *   dasselbe Recht mit frischem Passkey. **Production** (Frage 5 B, Profil `HOEHENMODELL=abgenommen`): nur abgenommene Fassungen, nie messen.
 */
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
/** Eine Auswahl fester Werte; der Typ bleibt die Vereinigung der Werte (nicht `string`). */
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

/**
 * Die Regler eines Entwurfs (§9c.12 Frage 2 „A plus“), je mit dem Pfad im Rezept und den Grenzen des Schemas (`recipes.ts`); der Server
 * prüft das ganze Rezept zusätzlich mit `parseTerrainRecipe`. `nurRegional`: nur in einer Fassung mit regionaler Rückverteilung.
 */
export const HOEHENMODELL_REGLER = [
    { id: "radius", pfad: ["generator", "uplift", "radius"], min: 0.25, max: 256, ganz: false, nurRegional: true },
    {
        id: "saturation",
        pfad: ["generator", "uplift", "saturation"],
        min: 0,
        max: null,
        ganz: false,
        nurRegional: true,
    },
    { id: "iterations", pfad: ["generator", "iterations"], min: 1, max: 100, ganz: true, nurRegional: false },
    { id: "streamPowerK", pfad: ["generator", "streamPowerK"], min: 0, max: null, ganz: false, nurRegional: false },
    { id: "diffusion", pfad: ["generator", "diffusion"], min: 0, max: null, ganz: false, nurRegional: false },
    {
        id: "continentalHeight",
        pfad: ["generator", "continentalHeight"],
        min: 0,
        max: null,
        ganz: false,
        nurRegional: false,
    },
    {
        id: "detailAmplitude",
        pfad: ["generator", "detail", "amplitude"],
        min: 0,
        max: null,
        ganz: false,
        nurRegional: false,
    },
    {
        id: "fineDetailAmplitude",
        pfad: ["generator", "fine", "detail", "amplitude"],
        min: 0,
        max: null,
        ganz: false,
        nurRegional: false,
    },
    { id: "flankGrade", pfad: ["riverValley", "flankGrade"], min: 0, max: 1, ganz: false, nurRegional: false },
    {
        id: "maximumGrade",
        pfad: ["mountainMorphology", "interior", "maximumGrade"],
        min: 0,
        max: null,
        ganz: false,
        nurRegional: false,
    },
] as const;
export type HoehenmodellReglerId = (typeof HOEHENMODELL_REGLER)[number]["id"];
export const HOEHENMODELL_REGLER_IDS = HOEHENMODELL_REGLER.map((regler) => regler.id) as HoehenmodellReglerId[];

/** Das Profil der Instanz (`HOEHENMODELL`, §9c.8): `voll` wählt jede ausgelieferte Fassung und misst; `abgenommen` (Production) nicht. */
export const HOEHENMODELL_PROFILE = ["voll", "abgenommen"] as const;
export type HoehenmodellProfil = (typeof HOEHENMODELL_PROFILE)[number];

const Werte = Type.Record(Type.String(), Nullable(Type.Number()));

export const HoehenmodellAbnahme = Type.Object(
    { am: Moment, wer: Nullable(Type.String()), grund: Nullable(Type.String()) },
    { additionalProperties: false },
);
export type HoehenmodellAbnahme = Static<typeof HoehenmodellAbnahme>;

export const HoehenmodellUnterschied = Type.Object(
    { pfad: Type.String(), alt: Type.Unknown(), neu: Type.Unknown() },
    { additionalProperties: false },
);
export type HoehenmodellUnterschied = Static<typeof HoehenmodellUnterschied>;

export const HoehenmodellLandschaft = Type.Object(
    {
        art: Type.String(),
        upliftWeight: Type.Number(),
        erodibility: Type.Number(),
        diffusivity: Type.Number(),
        runoff: Type.Number(),
        channelBias: Type.Number(),
    },
    { additionalProperties: false },
);
export type HoehenmodellLandschaft = Static<typeof HoehenmodellLandschaft>;

export const HoehenmodellFassung = Type.Object(
    {
        version: Type.Integer({ minimum: 1 }),
        /** Regionale Rückverteilung: Änderungen an Gipfeln und Gebirgen rechnen lokal; sonst die ganze Karte (§9c.11). */
        regional: Type.Boolean(),
        /** Die geänderten Werte gegenüber der vorigen Fassung (leer bei der ersten). */
        unterschied: Type.Array(HoehenmodellUnterschied),
        /** Die Werte der freigegebenen Regler; `null`: gibt es in dieser Fassung nicht (Radius in Fassung 17). */
        regler: Werte,
        /** Die Tafel je Landschaftsart (Topographie), nur lesbar. */
        landschaften: Type.Array(HoehenmodellLandschaft),
        /** Zahl aller Werte der Fassung (Zahlen im Rezept), davon nicht einstellbar: alle außer den Reglern. */
        werte: Type.Integer({ minimum: 0 }),
        abnahme: Nullable(HoehenmodellAbnahme),
        /** In der Liste `accepted` der Auswahldatei (auf Stage abgenommen; nur sie darf Production aktivieren). */
        inDatei: Type.Boolean(),
        kreis: literals(["halb", "voll"] as const),
        gilt: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type HoehenmodellFassung = Static<typeof HoehenmodellFassung>;

export const HoehenmodellMessung = Type.Object(
    {
        jobId: Type.String(),
        state: literals(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const),
        phase: Nullable(Type.String()),
        progress: Nullable(Type.Number({ minimum: 0, maximum: 1 })),
        /** Das Ergebnis aus der Jobzeile (Zahlen), wenn fertig. */
        ergebnis: Nullable(Type.Record(Type.String(), Type.Unknown())),
        fehler: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type HoehenmodellMessung = Static<typeof HoehenmodellMessung>;

export const HoehenmodellEntwurf = Type.Object(
    {
        id: Type.String(),
        basis: Type.Integer({ minimum: 1 }),
        aenderungen: Werte,
        grund: Type.String(),
        angelegt: Moment,
        wer: Nullable(Type.String()),
        messung: Nullable(HoehenmodellMessung),
        /** ○ Entwurf · ◐ gemessen (Frage 6 A). */
        kreis: literals(["leer", "halb"] as const),
    },
    { additionalProperties: false },
);
export type HoehenmodellEntwurf = Static<typeof HoehenmodellEntwurf>;

/** `GET /api/admin/system/hoehenmodell`. */
/**
 * Ein Gebirge mit Gipfeln unter seiner Grundhöhe (Betreiber 2026-10-17: kein Deckel, dafür eine Warnung), gemessen am veröffentlichten
 * Master: die Grundhöhe (Kammhöhe, sonst die Vorgabe nach Fläche), je Gipfel seine Höhe, das Gelände am Gipfel und das höchste Gelände
 * im Umkreis einer Karteneinheit.
 */
export const HoehenmodellGipfelGebirge = Type.Object(
    {
        gebirge: Type.String(),
        grundhoehe: Type.Number(),
        quelle: literals(["kammhoehe", "vorgabe"] as const),
        gipfel: Type.Array(
            Type.Object(
                {
                    id: Type.String(),
                    name: Type.String(),
                    hoehe: Type.Number(),
                    gelaende: Type.Number(),
                    ringsum: Type.Number(),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type HoehenmodellGipfelGebirge = Static<typeof HoehenmodellGipfelGebirge>;

/**
 * Die Werte, die auf der Stage über der Datei einer OFFENEN Fassung liegen (WI-0240, „19 (Test)“; Betreiber 2026-10-19: „wir ändern
 * eigenschaften von test 19 live auf der stage bis das modell brauchbare ergebnisse liefert“). Nur was abweicht steht hier: die
 * freigegebenen Regler (`HOEHENMODELL_REGLER`) und die Gebirgs-Presets je Typ, Wert und Höhenstufe. Ein leeres Objekt heißt „wie die Datei“.
 */
export const HoehenmodellTestWerte = Type.Object(
    {
        regler: Type.Optional(Type.Record(Type.String(), Type.Number())),
        // Alle übrigen stellbaren Werte je Pfad im Rezept (`HOEHENMODELL_KATALOG`, „generator.detail.wavelength“), WI-0246 Nachtrag.
        rezept: Type.Optional(Type.Record(Type.String(), Type.Number())),
        presets: Type.Optional(
            Type.Object(
                {
                    typen: Type.Optional(
                        Type.Record(
                            Type.String(),
                            Type.Object(
                                {
                                    werte: Type.Optional(Type.Record(Type.String(), Type.Number())),
                                    muster: Type.Optional(literals(GEBIRGS_MUSTER)),
                                    // Typwerte des Rückennetzes je Kennung (`RUECKENNETZ_TYPWERTE`, „form.grat“), WI-0246.
                                    rueckennetz: Type.Optional(Type.Record(Type.String(), Type.Number())),
                                },
                                { additionalProperties: false },
                            ),
                        ),
                    ),
                    hoehenstufen: Type.Optional(Type.Record(Type.String(), Type.Number())),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type HoehenmodellTestWerte = Static<typeof HoehenmodellTestWerte>;

/** Eine Änderung der Werte von „19 (Test)“ im Verlauf: die Werte über der Datei davor und danach. */
export const HoehenmodellTestEreignis = Type.Object(
    {
        revision: Type.Integer({ minimum: 1 }),
        am: Moment,
        wer: Nullable(Type.String()),
        grund: Nullable(Type.String()),
        vorher: HoehenmodellTestWerte,
        werte: HoehenmodellTestWerte,
    },
    { additionalProperties: false },
);
export type HoehenmodellTestEreignis = Static<typeof HoehenmodellTestEreignis>;

/** Die offene Fassung mit ihren Werten auf dieser Umgebung (nur Profil `voll`). */
export const HoehenmodellTest = Type.Object(
    {
        version: Type.Integer({ minimum: 1 }),
        /** „Fassung 19 (Test)“ (`fassungsName`). */
        name: Type.String(),
        werte: HoehenmodellTestWerte,
        /** 0: noch keine Werte gesetzt (es gilt die Datei). */
        revision: Type.Integer({ minimum: 0 }),
        /**
         * Die Revision, mit der der veröffentlichte Master gerechnet ist (0: die Datei); `null`: der Master stammt aus einer anderen
         * Fassung, aus einem Stand, der nicht mehr im Verlauf steht, oder trägt keinen Stand.
         */
        gerechnet: Nullable(Type.Integer({ minimum: 0 })),
        geaendertAm: Nullable(Moment),
        wer: Nullable(Type.String()),
        grund: Nullable(Type.String()),
        /** Nach der Abnahme in dieser Umgebung: nicht mehr einstellbar; der Stand geht als Datei ins Repository. */
        gesperrt: Type.Boolean(),
        /** Die wirksamen Werte der Regler (Datei mit Überlagerung) und die der Datei, für ↺ je Zeile. */
        regler: Werte,
        reglerDatei: Werte,
        /** Die übrigen stellbaren Werte je Pfad (`flacheRezeptWerte`), wirksam und die der Datei. */
        rezept: Type.Record(Type.String(), Type.Number()),
        rezeptDatei: Type.Record(Type.String(), Type.Number()),
        /** Was nur lesend bleibt (`HOEHENMODELL_TECHNIK`): Rastergröße, Saat, Technik des Feinrasters, Art der Rückverteilung. */
        technik: Type.Record(Type.String(), Type.Union([Type.Number(), Type.String()])),
        /** Die wirksamen Gebirgs-Presets und die der Datei; `null`, wenn die Fassung keine trägt. */
        presets: Nullable(GebirgsPresetGruppeSchema),
        presetsDatei: Nullable(GebirgsPresetGruppeSchema),
        /** Die jüngsten Änderungen, neueste zuerst. */
        verlauf: Type.Array(HoehenmodellTestEreignis),
    },
    { additionalProperties: false },
);
export type HoehenmodellTest = Static<typeof HoehenmodellTest>;

export const AdminHoehenmodell = Type.Object(
    {
        now: Moment,
        profil: literals(HOEHENMODELL_PROFILE),
        eingestellt: Type.Object(
            {
                version: Type.Integer({ minimum: 1 }),
                quelle: literals(["auswahl", "datei"] as const),
                seit: Nullable(Moment),
                wer: Nullable(Type.String()),
                grund: Nullable(Type.String()),
                revision: Type.Integer({ minimum: 0 }),
                /** Eine gewählte Fassung, die dieses Release nicht kennt (die Datei gilt dann). */
                unbekannt: Nullable(Type.Integer()),
            },
            { additionalProperties: false },
        ),
        wirksam: Type.Object(
            {
                /** Die Fassung, die den veröffentlichten Master rechnete; `null`: unbekannt (Master vor Migration 0100) oder keiner. */
                version: Nullable(Type.Integer()),
                gerechnetAm: Nullable(Moment),
                vorlaeufig: Type.Boolean(),
            },
            { additionalProperties: false },
        ),
        /** Die laufende oder wartende Geländekette (voller Lauf, Höhenlinien). */
        kette: Nullable(
            Type.Object(
                {
                    jobId: Type.String(),
                    art: Type.String(),
                    state: literals(["QUEUED", "RUNNING"] as const),
                    phase: Nullable(Type.String()),
                    progress: Nullable(Type.Number({ minimum: 0, maximum: 1 })),
                    waitReason: Nullable(Type.String()),
                },
                { additionalProperties: false },
            ),
        ),
        /** Das Ziel des Rückwegs: die vorige Fassung, wenn sie abgenommen ist. */
        rueckweg: Nullable(Type.Integer({ minimum: 1 })),
        fassungen: Type.Array(HoehenmodellFassung),
        entwuerfe: Type.Array(HoehenmodellEntwurf),
        /**
         * Gipfel unter der Grundhöhe ihres Gebirges am veröffentlichten Master; `null`: noch nicht gemessen (ein Master von vor dieser
         * Messung — die nächste Geländerechnung misst).
         */
        gipfel: Nullable(Type.Array(HoehenmodellGipfelGebirge)),
        /** Die offene Fassung „19 (Test)“ mit ihren Werten (WI-0240); fehlt auf Production und ohne offene Fassung. */
        test: Type.Optional(HoehenmodellTest),
    },
    { additionalProperties: false },
);
export type AdminHoehenmodell = Static<typeof AdminHoehenmodell>;

/** Der Grund wie im Betriebszustand (höchstens 300 Zeichen); er steht im Protokoll. */
const Grund = Type.String({ minLength: 1, maxLength: SYSTEM_REASON_MAX });

export const HoehenmodellWaehlenBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        version: Type.Integer({ minimum: 1 }),
        reason: Grund,
    },
    { additionalProperties: false },
);
export type HoehenmodellWaehlenBody = Static<typeof HoehenmodellWaehlenBody>;

export const HoehenmodellZurueckBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 0 }), reason: Grund },
    { additionalProperties: false },
);
export type HoehenmodellZurueckBody = Static<typeof HoehenmodellZurueckBody>;

/** „Gelände neu rechnen“ (Betreiber 2026-10-17, Topographie F8): dieselbe Fassung, die volle Kette noch einmal. Kein Grund (wie die Freigabe der Wegfindung). */
export const HoehenmodellNeuRechnenBody = Type.Object({ operationId: OperationId }, { additionalProperties: false });
export type HoehenmodellNeuRechnenBody = Static<typeof HoehenmodellNeuRechnenBody>;

export const HoehenmodellAbnehmenBody = Type.Object(
    { operationId: OperationId, version: Type.Integer({ minimum: 1 }), reason: Grund },
    { additionalProperties: false },
);
export type HoehenmodellAbnehmenBody = Static<typeof HoehenmodellAbnehmenBody>;

export const HoehenmodellEntwurfBody = Type.Object(
    {
        operationId: OperationId,
        basis: Type.Integer({ minimum: 1 }),
        aenderungen: Type.Record(Type.String(), Type.Number()),
        reason: Grund,
    },
    { additionalProperties: false },
);
export type HoehenmodellEntwurfBody = Static<typeof HoehenmodellEntwurfBody>;

/** Die Werte von „19 (Test)“ setzen (WI-0240): das ganze Objekt; `baseRevision` 0, solange keine Werte gesetzt sind. */
export const HoehenmodellTestBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        werte: HoehenmodellTestWerte,
        reason: Grund,
    },
    { additionalProperties: false },
);
export type HoehenmodellTestBody = Static<typeof HoehenmodellTestBody>;

export const HoehenmodellEntwurfZielBody = Type.Object(
    { operationId: OperationId, draft: Type.String({ format: "uuid" }) },
    { additionalProperties: false },
);
export type HoehenmodellEntwurfZielBody = Static<typeof HoehenmodellEntwurfZielBody>;

/**
 * Die Fachcodes (ADR-0018): `terrain_version_unknown` (400) die Fassung gibt es in diesem Release nicht; `terrain_not_accepted` (409) auf
 * Production nur abgenommene Fassungen; `terrain_no_rollback` (409) es gibt keine abgenommene vorige Fassung; `terrain_draft_invalid` (400)
 * ein Regler außerhalb der Freigabe oder der Grenzen; `terrain_already_active` (409) die Fassung ist schon gewählt; `terrain_draft_not_found` (404); `terrain_measure_running` (409) eine Messung wartet
 * oder läuft; `terrain_measure_unavailable` (503) auf dieser Umgebung wird nicht gemessen; `terrain_chain_waiting` (409) eine Geländerechnung
 * wartet schon („Gelände neu rechnen“: höchstens eine wartende Kette). WI-0240: `terrain_test_unavailable` (409) auf dieser Umgebung gibt es
 * keine Testwerte (Production); `terrain_test_closed` (409) die Fassung ist abgenommen oder nicht offen; `terrain_test_invalid` (400) ein
 * Wert außerhalb der Freigabe oder der Grenzen.
 */
export const HOEHENMODELL_ERROR_STATUS = {
    terrain_version_unknown: 400,
    terrain_not_accepted: 409,
    terrain_no_rollback: 409,
    terrain_draft_invalid: 400,
    terrain_already_active: 409,
    terrain_draft_not_found: 404,
    terrain_measure_running: 409,
    terrain_measure_unavailable: 503,
    terrain_chain_waiting: 409,
    terrain_test_unavailable: 409,
    terrain_test_closed: 409,
    terrain_test_invalid: 400,
} as const;
export type HoehenmodellErrorCode = keyof typeof HOEHENMODELL_ERROR_STATUS;
