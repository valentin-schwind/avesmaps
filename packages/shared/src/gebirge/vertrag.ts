import { Type, type Static, type TObject, type TSchema } from "@sinclair/typebox";
import { UUID_PATTERN } from "../operation.ts";
import {
    GEBIRGS_HOEHENSTUFEN,
    GEBIRGS_KAMMHOEHE,
    GEBIRGS_MUSTER,
    GEBIRGS_WERT_GRENZEN,
    GEBIRGS_WERTE,
    GEBIRGS_ZURUECK,
    GEBIRGSTYPEN,
    type GebirgsWert,
} from "./regler.ts";
import {
    GEBIRGS_MODELL_GRENZEN,
    GEBIRGS_MODELL_WERTE,
    GEBIRGS_NETZ_GRENZEN,
    type GebirgsModellWert,
} from "./modell-werte.ts";
import { KAMM_MIN_PUNKTE, KAMM_RAENGE, PUNKT_HOEHE_GRENZEN, type GebirgsNetz } from "./rueckennetz/netz-vertrag.ts";
import type { V12Input } from "./types.ts";

/**
 * Die Leitung des Gebirge-Editors (WI-0226): Schemas für Lesen und Schreiben. Die Oberfläche (Reiter „Gebirge“ im Derographie-Editor,
 * WI-0178) dockt an genau vier Stellen an:
 *
 * 1. **Lesen:** `GET /api/editor/gebirge/:area` (`EDITOR_GEBIRGE_URL`, `:area` = `public_id` der Teilfläche, Recht `use_editor_menu`,
 *    404 ohne aktives Gebirge; Route `apps/server/src/routes/editor-gebirge.ts`) liefert `EditorGebirge`: die V12-Eingabe der Vorschau ohne
 *    Regler, Typ und Abweichungen (`stand`), die Grundhöhe und die Presets (`quelle` „fassung“: der Typ wirkt; „vorgabe“: „wirkt ab Fassung 19“).
 * 2. **Werte und Grenzen:** `GEBIRGSTYPEN`, `GEBIRGS_MUSTER`, `GEBIRGS_WERTE`, `GEBIRGS_WERT_GRENZEN`, `GEBIRGS_KAMMHOEHE`,
 *    `GEBIRGS_HOEHENSTUFEN`, `GEBIRGS_ZURUECK`, `GEBIRGS_PRESETS_VORGABE` und die Auflösung `gebirgsRegler` (Preset und Abweichungen → Regler der V12) in
 *    `regler.ts`, ohne TypeBox, damit sie auch im Worker laufen.
 * 3. **Schreiben:** `gebirgSchreiben(tx, area, aenderung)` (`apps/server/src/terrain/gebirge-editor.ts`) im `landscape.update` der
 *    Derographie, in derselben Transaktion, damit Felder, Gebirge und Gipfel EINE Operation sind. `aenderung` ist eine `GebirgsAenderung`
 *    (nur Geändertes, ohne `null`; ↺ auf die Vorgabe nennt das Feld in `zurueck`); zurück kommen `affected` (`{ kind: "terrain_control", id }` für die Rechnung im Umkreis,
 *    WI-0223) und `aenderungen` je Feld für den Verlauf.
 * 4. **Vorschau:** `gebirgsVorschau()` (`apps/web/src/gebirge-vorschau/vorschau.ts`) gibt EINEN Worker mit der V12. `rechne(auftrag)` mit
 *    einem `VorschauAuftrag` (Eingabe, Preset des Typs, Stand, Grundhöhe, Kante `VORSCHAU_KANTE_GROB` beim Ziehen, `VORSCHAU_KANTE_FEIN`
 *    beim Loslassen) liefert ein `VorschauErgebnis` (Höhe in Schritt je Zelle, maßstäblich) oder `null`, wenn ein neuerer Auftrag ihn
 *    überholt hat; `beenden()` beim Schließen. Gezeichnet wird in der Oberfläche.
 *
 * Ein Gebirge ohne Typ und ohne Muster „zellen“ (alle bestehenden) rechnet bytegleich wie vor WI-0226 (Tor im Work Item).
 */

export const EDITOR_GEBIRGE_URL = "/api/editor/gebirge";

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
/** Ein Objekt mit genau den Schlüsseln einer Liste, der Wert je Schlüssel aus `f`. */
function je<K extends string, T extends TSchema>(schluessel: readonly K[], f: (k: K) => T): TObject<Record<K, T>> {
    return Type.Object(Object.fromEntries(schluessel.map((k) => [k, f(k)])) as Record<K, T>, strict);
}
/** Ein Wert in seinen Grenzen; Rinnennetz und Feinheit sind ganze Stufen (Spalten SMALLINT). */
const Zahl = (k: GebirgsWert) => {
    const { min, max, schritt } = GEBIRGS_WERT_GRENZEN[k];
    return schritt === 1 ? Type.Integer({ minimum: min, maximum: max }) : Type.Number({ minimum: min, maximum: max });
};

/** Typwerte des Rückennetzes je Typ (WI-0246, `rueckennetz/typen.ts`): Struktur, Form, HI-Band, Gratschwelle. */
const RueckennetzTypSchema = Type.Object(
    {
        struktur: je(
            ["abstand", "fuellung", "straengeMax", "wandern", "welle", "astAbstand", "astLaenge"] as const,
            () => Type.Number(),
        ),
        form: Type.Object(
            {
                ...je(
                    [
                        "breite",
                        "schaerfe",
                        "talboden",
                        "rauschen",
                        "koernung",
                        "randBreite",
                        "erosion",
                        "erhalt",
                        "grat",
                    ] as const,
                    () => Type.Number(),
                ).properties,
                gratBreite: Type.Optional(Type.Number()),
                kopf: Type.Optional(Type.Number()),
                kammMuster: Type.Optional(Type.Number()),
                kopfNeigung: Type.Optional(Type.Number()),
                durchhang: Type.Optional(Type.Number()),
                durchhangNeben: Type.Optional(Type.Number()),
                gelaendeErosion: Type.Optional(Type.Number()),
            },
            strict,
        ),
        band: Type.Object(
            { ziel: Type.Number(), min: Type.Number(), max: Type.Number(), quelle: Type.Optional(Type.String()) },
            strict,
        ),
        gratMin: Type.Number(),
    },
    strict,
);

/** Ein Wert des Rückennetzes in seinen Grenzen (`modell-werte.ts`). */
const ModellZahl = (k: GebirgsModellWert) => {
    const { min, max } = GEBIRGS_MODELL_GRENZEN[k];
    return Type.Number({ minimum: min, maximum: max });
};

/** Ein Punkt in Karteneinheiten (MCS `aventuria-v1`), wie `V12Input.kurve`. */
const Punkt = Type.Tuple([Type.Number(), Type.Number()]);

/** Eine Punkthöhe in Schritt, Grenzen wie `terrain_peak.height_schritt`. */
const PunktHoehe = () => Type.Integer({ minimum: PUNKT_HOEHE_GRENZEN.min, maximum: PUNKT_HOEHE_GRENZEN.max });

/**
 * Ein gezeichneter Kamm (WI-0245), wie er gelesen wird: Linienzug mit Rang; die Folge der Kämme ist ihre `ordinal` in `terrain_ridge_edge`.
 * `hoehen` (WI-0249 P9, Migration 0219) steht parallel zu `punkte`, `null` = Vorgabe; ohne eigene Höhe fehlt die Liste.
 */
export const GebirgsKammSchema = Type.Object(
    {
        punkte: Type.Array(Punkt, { minItems: KAMM_MIN_PUNKTE, maxItems: GEBIRGS_NETZ_GRENZEN.punkte }),
        rang: Union([...KAMM_RAENGE, "tal"] as const),
        hoehen: Type.Optional(
            Type.Array(Type.Union([PunktHoehe(), Type.Null()]), { maxItems: GEBIRGS_NETZ_GRENZEN.punkte }),
        ),
    },
    strict,
);

/**
 * Ein Kamm, wie er geschrieben wird: die eigenen Punkthöhen als Paare `[Stelle, Höhe]` (WI-0249 P9), nur für Punkte mit eigener Höhe.
 * 🪤 Keine Liste mit `null`: Fastifys ajv macht in einer Vereinigung Zahl|null aus `null` still eine 0 (Kopf von `GebirgsAenderung`).
 * `h` ist die Höhe der ganzen Linie aus Clients vor Migration 0219 (0216): Der Server füllt damit alle Stützpunkte, die keine Paare nennen;
 * neue Clients senden es nicht. Es fällt im Release nach 0219 weg (`AGENTS.md`, „Migrationen: erst erweitern, dann umstellen, dann entfernen“).
 */
export const GebirgsKammAenderung = Type.Object(
    {
        punkte: GebirgsKammSchema.properties.punkte,
        rang: GebirgsKammSchema.properties.rang,
        hoehen: Type.Optional(
            Type.Array(
                Type.Tuple([Type.Integer({ minimum: 0, maximum: GEBIRGS_NETZ_GRENZEN.punkte - 1 }), PunktHoehe()]),
                {
                    maxItems: GEBIRGS_NETZ_GRENZEN.punkte,
                },
            ),
        ),
        h: Type.Optional(PunktHoehe()),
    },
    strict,
);
export type GebirgsKammAenderung = Static<typeof GebirgsKammAenderung>;

/** Ein Nebengipfel, wie er gelesen wird: ein Formpunkt (N1) ohne Name und Wiki; `h` in Schritt, `null` = Vorgabe des Modells. */
const GebirgsNebengipfelSchema = Type.Object(
    { x: Type.Number(), y: Type.Number(), h: Type.Union([Type.Integer(), Type.Null()]) },
    strict,
);

/**
 * Ein Nebengipfel, wie er geschrieben wird: `h` fehlt für „Vorgabe des Modells“. 🪤 Kein `null` im Anfrageinhalt: Fastifys ajv macht in
 * einer Vereinigung Zahl|null aus `null` still eine 0 (Kopf von `GebirgsAenderung`).
 */
const GebirgsNebengipfelAenderung = Type.Object(
    { x: Type.Number(), y: Type.Number(), h: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535 })) },
    strict,
);

/**
 * Eine eigene Höhe an einem Fluss oder See (WI-0249; Vali wählte A, 2026-10-26), nach Lage: gelesen und geschrieben gleich, `h` immer gesetzt
 * (ohne eigene Höhe steht der Punkt nicht in der Liste).
 */
const WasserHoeheSchema = Type.Object({ x: Type.Number(), y: Type.Number(), h: PunktHoehe() }, strict);
const WasserHoehen = () => Type.Optional(Type.Array(WasserHoeheSchema, { maxItems: GEBIRGS_NETZ_GRENZEN.wasser }));

/** Das Netz eines Gebirges, wie es gelesen wird (Topographie: `GebirgsNetz` in `rueckennetz/netz-vertrag.ts`). Leer: das Gebirge rechnet die V12. */
export const GebirgsNetzSchema = Type.Object(
    {
        kaemme: Type.Array(GebirgsKammSchema),
        nebengipfel: Type.Array(GebirgsNebengipfelSchema),
        mulden: Type.Optional(Type.Array(GebirgsNebengipfelSchema)),
        flussHoehen: WasserHoehen(),
        seeHoehen: WasserHoehen(),
    },
    strict,
);
export type GebirgsNetzStand = Static<typeof GebirgsNetzSchema>;
/** Das gelesene Netz ist genau der `GebirgsNetz` des Modells (Topographie, WI-0246): Weicht eins ab, scheitert der Typcheck hier. */
const _gleicheForm: [GebirgsNetzStand, GebirgsNetz] extends [GebirgsNetz, GebirgsNetzStand] ? true : never = true;
void _gleicheForm;

/** Das Netz wird ersetzt. Neue Clients senden `mulden` immer, auch leer. Ohne das Feld bleiben Mulden erhalten; fehlen auch Tal-Linien, bleiben die bisherigen Täler für alte Clients stehen. */
export const GebirgsNetzAenderung = Type.Object(
    {
        kaemme: Type.Array(GebirgsKammAenderung, { maxItems: GEBIRGS_NETZ_GRENZEN.kaemme }),
        nebengipfel: Type.Array(GebirgsNebengipfelAenderung, { maxItems: GEBIRGS_NETZ_GRENZEN.nebengipfel }),
        mulden: Type.Optional(Type.Array(GebirgsNebengipfelAenderung, { maxItems: GEBIRGS_NETZ_GRENZEN.nebengipfel })),
        /** Fehlen sie, bleiben die gespeicherten Höhen an Flüssen und Seen (alte Clients); eine leere Liste nimmt sie weg. */
        flussHoehen: WasserHoehen(),
        seeHoehen: WasserHoehen(),
    },
    strict,
);
export type GebirgsNetzAenderung = Static<typeof GebirgsNetzAenderung>;

/** Was ↺ zurücksetzt: die Werte der V12 (`GEBIRGS_ZURUECK`), die des Rückennetzes und die gewürfelte Saat (Migration 0214). */
export const GEBIRGS_ZURUECK_ALLE = [...GEBIRGS_ZURUECK, ...GEBIRGS_MODELL_WERTE, "saat"] as const;
export type GebirgsZurueckAlle = (typeof GEBIRGS_ZURUECK_ALLE)[number];

export const GebirgsPresetSchema = Type.Object(
    {
        werte: je(GEBIRGS_WERTE, () => Type.Number()),
        muster: Union(GEBIRGS_MUSTER),
        rueckennetz: Type.Optional(RueckennetzTypSchema),
    },
    strict,
);

/** Die Gruppe `gebirgsPresets` einer Höhenmodell-Fassung (`terrain/domain/recipes.ts`), ab Fassung 19. */
export const GebirgsPresetGruppeSchema = Type.Object(
    {
        typen: je(GEBIRGSTYPEN, () => GebirgsPresetSchema),
        hoehenstufen: je(GEBIRGS_HOEHENSTUFEN, () =>
            Type.Number({ minimum: GEBIRGS_KAMMHOEHE.min, maximum: GEBIRGS_KAMMHOEHE.max }),
        ),
    },
    strict,
);

/**
 * `GET /api/editor/gebirge/:area` (Recht `use_editor_menu`): alles, was der Reiter und die Vorschau brauchen.
 * - `eingabe`: die V12-Eingabe der Fläche ohne Regler (Umriss, Gipfel, Flüsse, Seen, Kammlinie, Saat), Koordinaten MCS `aventuria-v1`.
 * - `stand`: Typ und Abweichungen, die Werte des Rückennetzes (`modell`), das gezeichnete Netz (WI-0245) und die Revision der Gebirgswerte
 *   (`revision`, 0 ohne Zeile); `grundhoehe`: die Kammhöhe ohne eigenen Wert.
 * - `presets.quelle`: `fassung` (die gültige Fassung hat die Gruppe; der Typ wirkt) oder `vorgabe` (noch nicht in der Fassung: der
 *   Editor zeigt „wirkt ab Fassung 19“, die Rechnung lässt den Typ ohne Wirkung).
 */
export const EditorGebirge = Type.Object(
    {
        area: Type.String({ pattern: UUID_PATTERN }),
        // Frei gelassen (Umriss, Gipfel, Flüsse, Seen sind lang); ohne `additionalProperties` leerte die Antwort-Serialisierung das Objekt.
        eingabe: Type.Unsafe<Omit<V12Input, "regler">>(Type.Object({}, { additionalProperties: true })),
        stand: Type.Object(
            {
                typ: Type.Union([Union(GEBIRGSTYPEN), Type.Null()]),
                werte: Type.Partial(je(GEBIRGS_WERTE, () => Type.Number())),
                muster: Type.Union([Union(GEBIRGS_MUSTER), Type.Null()]),
                kammhoehe: Type.Union([Type.Number(), Type.Null()]),
                modell: Type.Partial(je(GEBIRGS_MODELL_WERTE, () => Type.Number())),
                netz: GebirgsNetzSchema,
                revision: Type.Integer({ minimum: 0 }),
                /** Die gewürfelte Saat (Migration 0214); `null`: abgeleitet aus Kennung und Revision (`eingabe.saat`). */
                saat: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
            },
            strict,
        ),
        grundhoehe: Type.Union([Type.Number(), Type.Null()]),
        presets: Type.Object(
            {
                quelle: Union(["fassung", "vorgabe"] as const),
                fassung: Type.Integer(),
                gruppe: GebirgsPresetGruppeSchema,
            },
            strict,
        ),
    },
    strict,
);
export type EditorGebirge = Static<typeof EditorGebirge>;

/**
 * Die Höhenprofile der Flüsse und Pässe eines Gebirges (WI-0245, Reiter „Gebirge“, Entwurf V16/V17): `GET …/:area/profile`, Recht
 * `use_editor_menu`. Abgetastet im schon geladenen Höhenmodell der Wegfindung wie das Flussprofil im Routenplaner (`routing/water-profile.ts`),
 * je Linie Abstand in E ab dem ersten Punkt und Höhe in Schritt (`null` ohne Höhe). Die Folge ist die der Eingabe (`eingabe.fluesse`,
 * `eingabe.paesse`); `null` für eine Linie ohne Länge. `verfuegbar` ist falsch, solange die Wegfindung kein Höhenmodell hat.
 */
export const editorGebirgeProfilUrl = (area: string): string => `${EDITOR_GEBIRGE_URL}/${area}/profile`;
const GebirgsProfilSchema = Type.Union([
    Type.Object({ at: Type.Array(Type.Number()), h: Type.Array(Type.Union([Type.Number(), Type.Null()])) }, strict),
    Type.Null(),
]);
/**
 * Das Objekt hinter einem Fluss, See oder Pass (Entwurf V16/V17: „Je Zeile der Kreis ●, der Name als Link zum Objekt“): die öffentliche
 * Kennung (Fluss und Pass: der Weg, See: die Landschaft) und der Kreis der Listen. `null`, wenn es sich nicht sicher zuordnen lässt.
 */
export const GebirgsObjekt = Type.Object(
    {
        id: Type.String(),
        kreis: Type.Union([
            Type.Literal("leer"),
            Type.Literal("halb"),
            Type.Literal("halb-rechts"),
            Type.Literal("voll"),
        ]),
    },
    strict,
);
export type GebirgsObjekt = Static<typeof GebirgsObjekt>;
const GebirgsObjektOderNichts = Type.Union([GebirgsObjekt, Type.Null()]);
export const EditorGebirgeProfile = Type.Object(
    {
        verfuegbar: Type.Boolean(),
        fluesse: Type.Array(GebirgsProfilSchema),
        paesse: Type.Array(GebirgsProfilSchema),
        /** Die Objekte in der Folge der Eingabe (`terrain/gebirge-objekte.ts`); sie kommen ohne Höhenmodell. */
        objekte: Type.Object(
            {
                fluesse: Type.Array(GebirgsObjektOderNichts),
                seen: Type.Array(GebirgsObjektOderNichts),
                paesse: Type.Array(GebirgsObjektOderNichts),
            },
            strict,
        ),
    },
    strict,
);
export type EditorGebirgeProfile = Static<typeof EditorGebirgeProfile>;

/**
 * Eine Änderung am Gebirge: nur, was sich ändert, die Felder ohne `null`. ↺ („zurück auf die Vorgabe“) steht als Name in `zurueck`
 * (`GEBIRGS_ZURUECK`), nie als `null` im Feld: 🪤 Fastifys ajv macht in einer Vereinigung Zahl|null aus `null` still eine 0 (wie im
 * Kopf von `LandscapeUpdateBody`; Editor-Orchestrierung 2026-10-18, Muster `zoomReset`). Ein Feld zugleich setzen und zurücknehmen ist
 * 400. Ein Typwechsel lässt die Abweichungen stehen; wer sie zurücksetzen will, nennt sie in `zurueck`. Geschrieben wird über
 * `gebirgSchreiben` (Server) im selben Vorgang wie die übrigen Felder der Landschaft; `affected` meldet `{ kind: "terrain_control", id: area }`.
 *
 * Seit WI-0245 (Datenmodell C): `modell` setzt Gratlinie, Gratbreite und Talboden (↺ ebenfalls über `zurueck`); `netz` ersetzt das
 * gezeichnete Netz als Ganzes (EINE Operation `area.gebirge`, vorher und nachher im Protokoll); `baseRevision` ist die Revision der
 * Gebirgswerte aus `stand.revision`: Weicht sie ab, ist es 409 und nichts geschrieben. Fehlt sie, gewinnt die letzte Schreibung wie bisher.
 */
export const GebirgsAenderung = Type.Object(
    {
        typ: Type.Optional(Union(GEBIRGSTYPEN)),
        werte: Type.Optional(Type.Partial(je(GEBIRGS_WERTE, Zahl))),
        muster: Type.Optional(Union(GEBIRGS_MUSTER)),
        kammhoehe: Type.Optional(Type.Number({ minimum: GEBIRGS_KAMMHOEHE.min, maximum: GEBIRGS_KAMMHOEHE.max })),
        modell: Type.Optional(Type.Partial(je(GEBIRGS_MODELL_WERTE, ModellZahl))),
        netz: Type.Optional(GebirgsNetzAenderung),
        /** „⟳ neu würfeln“: die gespeicherte Saat (Migration 0214); zurück auf die abgeleitete über `zurueck: ["saat"]`. */
        saat: Type.Optional(Type.Integer({ minimum: -2147483648, maximum: 2147483647 })),
        baseRevision: Type.Optional(Type.Integer({ minimum: 0 })),
        zurueck: Type.Optional(
            Type.Array(Union(GEBIRGS_ZURUECK_ALLE), { uniqueItems: true, maxItems: GEBIRGS_ZURUECK_ALLE.length }),
        ),
    },
    strict,
);
export type GebirgsAenderung = Static<typeof GebirgsAenderung>;
