import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { MediaFileUpload } from "./media-editor-operations.ts";
import { OperationId } from "./operation.ts";

/**
 * Der Betreiber-Kanal (WI-0124, KANAL-0001 §3, §4): Vorgänge mit OPS-ID, Verlauf, Nachweise je Runde, Fix-Bericht, Bilder. Lesen und
 * Schreiben mit `use_operator_channel` (nur die Rolle Betreiber, Stufe V, Entscheidung 2026-10-11 „B“). Die Regeln stehen in der Datenbank
 * (Migration 0106); dieser Vertrag beschreibt nur, was über die Leitung geht.
 */

export const KANAL_URL = "/api/kanal";

export const KANAL_KATEGORIEN = [
    "feinjustierung",
    "bug",
    "stoerung",
    "editor_optimierung",
    "performance",
    "idee",
    "umbau",
    "karteninhalt",
    "nutzerfrage",
] as const;
export type KanalKategorie = (typeof KANAL_KATEGORIEN)[number];
export const KANAL_PRIORITAETEN = ["niedrig", "normal", "hoch", "dringend"] as const;
export type KanalPrioritaet = (typeof KANAL_PRIORITAETEN)[number];
/**
 * `zu_sichten` (WI-0255 Paket 2, Migration 0231): Ein Vorgang aus Discord kommt so an. Die Kanal-Routine holt ihn nicht ab und liest seinen
 * Text nicht, bis ein Betreiber ihn freigibt (`POST /vorgaenge/:ops/sichten`); danach ist er `neu`.
 */
export const KANAL_STATUS = [
    "zu_sichten",
    "neu",
    "angenommen",
    "in_arbeit",
    "bei_claudia",
    "auf_stage",
    "beantwortet",
    "abgelehnt",
    "zur_abnahme",
    "abgenommen",
] as const;
export type KanalStatus = (typeof KANAL_STATUS)[number];
/**
 * Woran ein abgenommener Vorgang endete (Migration 0127). `abnahme` ist der Weg der Agenten über `zur_abnahme`; `erledigt` und
 * `abgebrochen` setzt der Betreiber selbst, aus jedem offenen Status (Betreiber 2026-10-14). Offen heißt `null`.
 * `an_community` (WI-0297, Migration 0332): bei der Sichtung an die Redaktion in Production weitergeleitet; die COM-Nummer steht in `community`.
 */
export const KANAL_ABSCHLUSS = ["abnahme", "erledigt", "abgebrochen", "an_community"] as const;
export type KanalAbschluss = (typeof KANAL_ABSCHLUSS)[number];
export const KANAL_REITER = ["offen", "abnahme", "archiv"] as const;
export type KanalReiter = (typeof KANAL_REITER)[number];
/**
 * Die Stationen eines Nachweises. Die zwei letzten gibt es nur für eine Production-Freigabe und nur für Claudio
 * (FREIGABE-0001 §8, Migrationen 0122 und 0123): Er ist der Einzige, der am Production-Korridor steht.
 */
export const KANAL_STATIONEN = [
    "fix_committed",
    "auf_stage",
    "claudia_nachgeprueft",
    "betreiber_abnahme",
    "production_live",
    "production_zurueck",
] as const;
export type KanalStation = (typeof KANAL_STATIONEN)[number];

/** Nur an einer Production-Freigabe; an jedem anderen Vorgang gibt es sie nicht (nicht „offen“, sondern gar nicht). */
export const KANAL_STATIONEN_FREIGABE = [
    "production_live",
    "production_zurueck",
] as const satisfies readonly KanalStation[];

/**
 * Die Stationen, die es für diesen Vorgang überhaupt gibt (Befund des Betreibers 2026-10-13: `production_live` und
 * `production_zurueck` standen als vierte und fünfte Station an einer Nutzerfrage und blieben dort für immer „offen“).
 * Eine Station, die ein Vorgang nie erreichen kann, ist keine offene Station — sie gehört nicht in seine Leiste.
 */
export function stationenFuer(art: KanalZeile["art"]): readonly KanalStation[] {
    return art === "freigabe"
        ? KANAL_STATIONEN
        : KANAL_STATIONEN.filter((station) => !(KANAL_STATIONEN_FREIGABE as readonly string[]).includes(station));
}

/**
 * Der Weg eines Vorgangs, der (noch) keinen Fix hat (Betreiber 2026-10-13: „Leiste bleibt, aber mit Status-Stationen“).
 *
 * 💣 Thomas fragte am 2026-10-13 „Wann kann ich Wege und Orte bearbeiten?“. Claudio antwortete und setzte den Vorgang auf „an
 * Claudia“ — und die Leiste zeigte weiter vier Fix-Stationen auf „offen“, weil es an einer Frage nichts zu committen gibt. Der
 * Betreiber las das als Stillstand: „gar kein fortschritt obwohl claudio was gemacht und geantwortet hat“.
 *
 * 🔴 **Das Kriterium ist nicht die Kategorie, sondern ob es einen Fix gibt** (`wegFuer`). Thomas' Vorgang steht unter
 * `editor_optimierung`, also hätte eine feste Tafel je Kategorie ihm weiterhin die Fix-Stationen gegeben. Ein Vorgang wird zum
 * Fix-Vorgang, wenn jemand einen Fix-Bericht oder einen Nachweis anlegt — vorher zeigt die Leiste das, was sich tatsächlich
 * bewegt: den Status.
 *
 * Diese Stationen stehen in keiner Tabelle; sie werden aus dem Statusverlauf gelesen (`erreichteStatusStationen`), der im
 * Vorgang ohnehin steht. Keine Migration, kein neues Recht.
 */
export const KANAL_STATUS_STATIONEN = ["gemeldet", "uebernommen", "beantwortet", "erledigt"] as const;
export type KanalStatusStation = (typeof KANAL_STATUS_STATIONEN)[number];

/** Welcher Status welche Station erreicht; ein Status, der hier fehlt, bewegt die Leiste nicht (`abgelehnt`, `neu`). */
const STATUS_STATION: Partial<Record<KanalStatus, KanalStatusStation>> = {
    angenommen: "uebernommen",
    in_arbeit: "uebernommen",
    bei_claudia: "uebernommen",
    auf_stage: "uebernommen",
    beantwortet: "beantwortet",
    zur_abnahme: "beantwortet",
    abgenommen: "erledigt",
};

/** Die Station, die dieser Status erreicht, sonst `undefined`. Die Oberfläche braucht sie, um den Zeitpunkt je Station zu finden. */
export const statusStation = (status: string | null | undefined): KanalStatusStation | undefined =>
    status === null || status === undefined ? undefined : STATUS_STATION[status as KanalStatus];

/**
 * Welchen Weg die Leiste eines Vorgangs zeigt. `fix`, sobald es einen Fix-Bericht oder einen Nachweis gibt — dann ist es ein
 * Vorgang mit Code dahinter und die Nachweis-Stationen sind die Wahrheit. Sonst `status`.
 */
export function wegFuer(vorgang: {
    art: KanalZeile["art"];
    alleNachweise: readonly { station?: string }[];
    aenderungen: readonly unknown[];
}): "fix" | "status" {
    if (vorgang.art === "freigabe") return "fix";
    // 💣 Die Abnahme zählt NICHT (2026-10-16): `kanal_abnehmen` schreibt `betreiber_abnahme` an jeden Vorgang, auch an eine
    // Frage ohne eine Zeile Code. Zählte sie mit, bekäme jeder abgenommene Vorgang die vier Fix-Stationen, drei davon leer —
    // genau der Befund, den der Betreiber am 2026-10-13 schon am offenen Vorgang hatte, nur am Ende statt am Anfang.
    const belegt = vorgang.alleNachweise.filter((n) => n.station !== "betreiber_abnahme");
    return belegt.length > 0 || vorgang.aenderungen.length > 0 ? "fix" : "status";
}

/** Der Stand einer Station in der Leiste: erreicht, offen (kommt noch) oder entfallen (übersprungen). */
export type StationStand = "erreicht" | "offen" | "entfallen";

/**
 * Die Stände einer Leiste in ihrer Reihenfolge.
 *
 * 💣 **Ein leerer Kreis VOR einem vollen liest sich wie „kommt noch“** (Betreiber 2026-10-16: „manche laufen plötzlich
 * parallel“). An OPS-000002 standen `fix_committed` und `betreiber_abnahme` auf erreicht, die zwei dazwischen leer — das
 * sah aus wie zwei Läufe nebeneinander. Was hinter einer erreichten Station liegt und selbst nicht erreicht wurde, ist
 * **entfallen**: Es wird nicht mehr kommen. Nur rechts der letzten erreichten Station steht noch etwas offen.
 */
export function staende(stationen: readonly string[], erreicht: ReadonlySet<string>): StationStand[] {
    const letzte = stationen.reduce((merk, station, i) => (erreicht.has(station) ? i : merk), -1);
    return stationen.map((station, i) => (erreicht.has(station) ? "erreicht" : i < letzte ? "entfallen" : "offen"));
}

/**
 * Die erreichten Status-Stationen aus dem Verlauf. „Gemeldet“ ist immer erreicht — der Vorgang existiert ja. Die übrigen zählen
 * jeden Status, den der Vorgang je hatte, auch wenn er inzwischen weiter ist: Ein beantworteter und dann abgenommener Vorgang hat
 * beide Stationen hinter sich.
 *
 * 🪤 Gelesen wird der Verlauf, nicht nur der aktuelle Status: Sonst stünde ein abgenommener Vorgang mit leerer Mitte da.
 */
export function erreichteStatusStationen(
    status: KanalStatus,
    eintraege: readonly { art: string; statusNach: string | null }[],
): ReadonlySet<KanalStatusStation> {
    const erreicht = new Set<KanalStatusStation>(["gemeldet"]);
    const nimm = (wert: string | null | undefined): void => {
        const station = STATUS_STATION[wert as KanalStatus];
        if (station !== undefined) erreicht.add(station);
    };
    for (const eintrag of eintraege) if (eintrag.art === "status") nimm(eintrag.statusNach);
    nimm(status);
    // Wer erledigt ist, hat geantwortet — auch wenn der Zwischenschritt nie als eigener Status geschrieben wurde.
    if (erreicht.has("erledigt")) erreicht.add("beantwortet");
    if (erreicht.has("beantwortet")) erreicht.add("uebernommen");
    return erreicht;
}

/**
 * Wie weit der Status-Weg gediehen ist, als ZAHL — was die Liste braucht (WI-0162).
 *
 * 💣 Betreiber 2026-10-15, Bild der Liste mit einem Pfeil auf die vier leeren Kreise: „kann man da den fortschritt anzeigen -
 * war das nicht dafür gedacht?“ Im Vorgang war die Leiste am 2026-10-13 repariert worden, die Liste blieb bei vier Punkten, die
 * sie mit der Zahl der NACHWEISE füllte. An einer Frage und an einer Datenänderung gibt es keine, also standen sie leer.
 *
 * 🪤 Die Liste kennt den Verlauf nicht, nur den jetzigen Status. Das genügt, weil die Stationen aufeinander aufbauen
 * (`erreichteStatusStationen` füllt nach unten auf): Die Zahl ist der Index der erreichten Station plus eins. `abgelehnt` zählt
 * als „übernommen“ — abgelehnt hat immer jemand, der den Vorgang vorher übernommen hat; im Vorgang steht das im Verlauf.
 */
export function statusFortschritt(status: KanalStatus): number {
    const station = status === "abgelehnt" ? "uebernommen" : STATUS_STATION[status];
    return station === undefined ? 1 : KANAL_STATUS_STATIONEN.indexOf(station) + 1;
}

/**
 * Der Fortschritt einer Listenzeile: derselbe Weg wie im Vorgang (`wegFuer`), nur aus den Zahlen der Zeile. `von` ist die Länge
 * des Wegs — eine Freigabe hat mehr Stationen als eine Meldung, und die Liste zeichnet so viele Punkte, wie es gibt.
 */
export function fortschrittDerZeile(
    zeile: Pick<KanalZeile, "art" | "status" | "nachweise" | "fixNachweise" | "aenderungen">,
): {
    weg: "fix" | "status";
    erreicht: number;
    von: number;
} {
    // 🪤 Die Zeile kennt nur Zahlen, keine Stationen — deshalb zählt der Server die Nachweise OHNE die Abnahme eigens
    // (`fixNachweise`). Mit einer blossen Gesamtzahl liesse sich „nur abgenommen“ nicht von „ein Fix liegt vor“ trennen.
    const weg = zeile.art === "freigabe" || zeile.fixNachweise > 0 || zeile.aenderungen > 0 ? "fix" : "status";
    if (weg === "fix") {
        const von = stationenFuer(zeile.art).length;
        return { weg, erreicht: Math.min(zeile.nachweise, von), von };
    }
    return { weg, erreicht: statusFortschritt(zeile.status), von: KANAL_STATUS_STATIONEN.length };
}

/** Die Frist der Aufbewahrung (Betreiber 2026-10-11: „versschwinden nach 90 tagen oder nach wunsch“). */
export const KANAL_AUFBEWAHRUNG_TAGE = 90;
/** Grenzen je Person und Stunde (KANAL-0001 §4.2). */
export const KANAL_GRENZE_VORGAENGE_JE_STUNDE = 20;
export const KANAL_GRENZE_EINTRAEGE_JE_STUNDE = 120;

/** Die Kontextfelder, die der Browser mitsendet; Umgebung und Release setzt der Server dazu. Nie ein Geheimnis. */
export const KANAL_KONTEXT_FELDER = ["ansicht", "objekt", "modus", "geraet", "anfrage"] as const;

const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const strict = { additionalProperties: false } as const;

export const KanalOpsParams = Type.Object({ ops: Type.String({ pattern: "^(?:OPS-)?\\d{1,12}$" }) }, strict);
export type KanalOpsParams = Static<typeof KanalOpsParams>;

export const KanalListeQuery = Type.Object(
    {
        reiter: Type.Optional(literals(KANAL_REITER)),
        /**
         * Freitext (Betreiber 2026-10-11, Entscheidungsprotokoll 3f7acfc8): OPS-Nummer, Titel, Kurztitel, Meldung, Schritte und die Texte im
         * Verlauf, ohne Groß und Klein. Der Text der Meldung steht nicht in der Liste; deshalb sucht der Server. Die Zähler der Reiter
         * bleiben die Summen ohne Suche.
         */
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    },
    strict,
);

export const KanalPerson = Type.Object({ id: Type.String(), name: Type.String() }, strict);
/**
 * Wer etwas tat: eine Person (mit Kennung und Anzeigename), einer der zwei Agenten oder, seit `/erledigt` (WI-0255, Migration 0260), der Melder
 * aus Discord mit seinem Anzeigenamen (keine Person der App).
 */
export const KanalWer = Type.Union([
    Type.Object({ art: Type.Literal("person"), id: Type.String(), name: Type.String() }, strict),
    Type.Object({ art: Type.Literal("claudio") }, strict),
    Type.Object({ art: Type.Literal("claudia") }, strict),
    Type.Object({ art: Type.Literal("discord"), name: Type.String() }, strict),
]);
export type KanalWer = Static<typeof KanalWer>;

export const KanalZeile = Type.Object(
    {
        ops: Type.String(),
        /**
         * 🔴 `freigabe` gehört dazu, seit die Production-Freigabe ein Vorgang ist (FREIGABE-0001 §8, Migration 0122). Fehlte sie hier,
         * wies das Antwortschema einen Freigabe-Vorgang ab, statt ihn zu zeigen — und die Oberfläche konnte nicht unterscheiden, welche
         * Stationen zu ihm gehören (Befund des Betreibers 2026-10-13: `production_live` stand an einer Nutzerfrage).
         */
        art: literals(["meldung", "wiederherstellung", "freigabe"] as const),
        kategorie: Type.String(),
        prioritaet: literals(KANAL_PRIORITAETEN),
        status: literals(KANAL_STATUS),
        zustaendig: literals(["claudio", "claudia", "betreiber"] as const),
        titel: Nullable(Type.String()),
        kurztitel: Nullable(Type.String()),
        gemeldetVon: Nullable(KanalPerson),
        /**
         * Nur an einem Vorgang aus Discord (WI-0255 Paket 2): der Anzeigename, den Discord für die meldende Person nennt. Die Discord-Kennung
         * bleibt in der Datenbank (Zuordnung, Missbrauch) und geht nie über die Leitung. Nach dem Ablauf fehlt das Feld.
         */
        discordMelder: Type.Optional(Type.String()),
        gemeldetAt: Moment,
        abgenommenAt: Nullable(Moment),
        /** Nur gesetzt, solange der Vorgang abgenommen ist: wie er endete (Abnahme, erledigt, abgebrochen). */
        abschluss: Nullable(literals(KANAL_ABSCHLUSS)),
        /** Nur an einem Vorgang, der an die Community weitergeleitet wurde (WI-0297): die COM-Nummer in Production. */
        community: Type.Optional(Type.String({ pattern: "^COM-\\d{6,12}$" })),
        abgelaufenAt: Nullable(Moment),
        /** Nachweise der laufenden Runde, 0 bis 4 (die vier Punkte der Liste). */
        nachweise: Type.Integer({ minimum: 0, maximum: 4 }),
        /**
         * Fix-Berichte der laufenden Runde (WI-0162). Die Liste braucht sie für denselben Weg wie der Vorgang: Ein Vorgang mit
         * Fix-Bericht, aber noch ohne Nachweis, geht schon den Fix-Weg — ohne diese Zahl zeigte die Liste ihm den Status-Weg.
         */
        aenderungen: Type.Integer({ minimum: 0 }),
        /**
         * Nachweise der laufenden Runde OHNE die Abnahme (2026-10-16). Die Abnahme bekommt jeder Vorgang, auch eine Frage ohne
         * Code; nur diese Zahl entscheidet deshalb über den Weg, während `nachweise` die Punkte füllt.
         */
        fixNachweise: Type.Integer({ minimum: 0, maximum: 4 }),
        letzteAktivitaet: Moment,
        /** Bis wann Meldung und Bilder bleiben (Abnahme plus 90 Tage); vorher `null`. */
        aufbewahrtBis: Nullable(Moment),
    },
    strict,
);
export type KanalZeile = Static<typeof KanalZeile>;

export const KanalListe = Type.Object(
    {
        now: Moment,
        reiter: literals(KANAL_REITER),
        zaehler: Type.Object(
            {
                offen: Type.Integer({ minimum: 0 }),
                abnahme: Type.Integer({ minimum: 0 }),
                archiv: Type.Integer({ minimum: 0 }),
            },
            strict,
        ),
        zuletztAbgeholt: Type.Object({ claudio: Nullable(Moment), claudia: Nullable(Moment) }, strict),
        zeilen: Type.Array(KanalZeile),
    },
    strict,
);
export type KanalListe = Static<typeof KanalListe>;

export const KanalZaehler = Type.Object(
    {
        abnahme: Type.Integer({ minimum: 0 }),
        /**
         * Wann die Routinen zuletzt abholten (`agent.zuletzt_abgeholt`): Liste, Vorgang und Bestätigung sagen danach ehrlich, ob gerade
         * jemand abholt (Arbeitsanweisung WI-0124 §6; Befund Claudio 2026-10-11). Hier auch, damit ein direkt geöffneter Vorgang es weiß.
         */
        zuletztAbgeholt: Type.Object({ claudio: Nullable(Moment), claudia: Nullable(Moment) }, strict),
    },
    strict,
);
export type KanalZaehler = Static<typeof KanalZaehler>;

export const KanalEintrag = Type.Object(
    {
        seq: Type.Integer({ minimum: 1 }),
        art: literals([
            "nachricht",
            "rueckfrage",
            "antwort",
            "befund",
            "status",
            "einstufung",
            "bild",
            "bild_entfernt",
        ] as const),
        von: KanalWer,
        text: Nullable(Type.String()),
        statusVon: Nullable(Type.String()),
        statusNach: Nullable(Type.String()),
        bild: Nullable(Type.String()),
        at: Moment,
    },
    strict,
);
export type KanalEintrag = Static<typeof KanalEintrag>;

export const KanalNachweis = Type.Object(
    {
        runde: Type.Integer({ minimum: 1 }),
        station: literals(KANAL_STATIONEN),
        commit: Nullable(Type.String()),
        release: Nullable(Type.String()),
        notiz: Nullable(Type.String()),
        von: Nullable(KanalWer),
        at: Moment,
    },
    strict,
);
export type KanalNachweis = Static<typeof KanalNachweis>;

export const KanalAenderung = Type.Object(
    {
        id: Type.Integer({ minimum: 1 }),
        runde: Nullable(Type.Integer({ minimum: 1 })),
        agent: literals(["claudio", "claudia"] as const),
        klasse: literals(["A", "B", "C"] as const),
        art: literals(["code", "betrieb", "diagnose"] as const),
        was: Type.String(),
        dateien: Type.Array(Type.String()),
        commit: Nullable(Type.String()),
        release: Nullable(Type.String()),
        tests: Nullable(Type.String()),
        ruecknahme: Nullable(Type.String()),
        at: Moment,
        nachpruefung: Nullable(literals(["ok", "nachbessern"] as const)),
        nachgeprueftAt: Nullable(Moment),
        nachpruefungNotiz: Nullable(Type.String()),
        beobachtungen: Type.Array(
            Type.Object(
                {
                    ergebnis: literals(["unauffaellig", "fehler", "fallback", "rollback", "offen"] as const),
                    text: Nullable(Type.String()),
                    at: Moment,
                },
                strict,
            ),
        ),
    },
    strict,
);
export type KanalAenderung = Static<typeof KanalAenderung>;

/** Seite der Gruppe „Fix-Berichte“ im Protokoll der Systemsteuerung. */
export const KANAL_BERICHTE_SEITE = 50;

/**
 * Ein Fix-Bericht in der Gruppe „Fix-Berichte“ des Protokolls (KANAL-0001 §3.1): eine Änderung samt Vorgang (OPS-ID) oder, ohne Vorgang,
 * ihrem Grund. Dauerhaft und nur lesend; er trägt keinen Text der meldenden Person.
 */
export const KanalBericht = Type.Object(
    { ...KanalAenderung.properties, ops: Nullable(Type.String()), grund: Nullable(Type.String()) },
    strict,
);
export type KanalBericht = Static<typeof KanalBericht>;

/** `vor` blättert: die Berichte mit kleinerer Kennung (älter). */
export const KanalBerichteQuery = Type.Object(
    {
        vor: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Freitext im Protokoll (Betreiber 2026-10-11): was, Commit, Release, Grund und OPS-Nummer; die Berichte blättern, also im Server. */
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    },
    strict,
);
export type KanalBerichteQuery = Static<typeof KanalBerichteQuery>;

export const KanalBerichte = Type.Object(
    { berichte: Type.Array(KanalBericht), weiter: Nullable(Type.Integer({ minimum: 1 })) },
    strict,
);
export type KanalBerichte = Static<typeof KanalBerichte>;

export const KanalBild = Type.Object(
    {
        id: Type.String(),
        zustand: literals(["wird_vorbereitet", "bereit", "abgewiesen"] as const),
        format: Type.String(),
        breite: Type.Integer({ minimum: 1 }),
        hoehe: Type.Integer({ minimum: 1 }),
        eintragSeq: Type.Integer({ minimum: 1 }),
        at: Moment,
        /** Warum der Worker das Bild nicht rendern konnte (Code der Rasterpipeline); sonst `null`. */
        abgewiesenGrund: Nullable(Type.String()),
    },
    strict,
);
export type KanalBild = Static<typeof KanalBild>;

/**
 * Bilder im Kanal (KANAL-0001 §6, K4): Der Browser verkleinert vor dem Hochladen auf die lange Kante `KANAL_BILD_KANTE` und kodiert neu
 * (ohne Metadaten); ist die Datei dann noch über `KANAL_BILD_MAX_BYTES`, versucht er es einmal mit `KANAL_BILD_KANTE_KLEIN`. Der Server
 * prüft dieselben Grenzen wie die Medienverwaltung und rendert im Worker `ansicht` und `vorschau`; ausgeliefert werden nur diese.
 */
export const KANAL_BILD_KANTE = 2560;
export const KANAL_BILD_KANTE_KLEIN = 1920;
export const KANAL_BILD_MAX_BYTES = 6 * 1024 * 1024;
export const KANAL_BILD_GROESSEN = ["ansicht", "vorschau"] as const;
export type KanalBildGroesse = (typeof KANAL_BILD_GROESSEN)[number];
export const KanalBildQuery = Type.Object({ groesse: Type.Optional(literals(KANAL_BILD_GROESSEN)) }, strict);
/** `POST /api/kanal/vorgaenge/:ops/bilder`: ein Bild, Base64 wie beim Hochladen der Medienverwaltung. */
export const KanalBildBody = Type.Object({ operationId: OperationId, file: MediaFileUpload }, strict);
export type KanalBildBody = Static<typeof KanalBildBody>;

export const KanalVorgang = Type.Object(
    {
        ...KanalZeile.properties,
        runde: Type.Integer({ minimum: 1 }),
        revision: Type.Integer({ minimum: 1 }),
        nachricht: Nullable(Type.String()),
        schritte: Nullable(Type.String()),
        kontext: Type.Record(Type.String(), Type.String()),
        abgenommenVon: Nullable(KanalPerson),
        vonHandGeloescht: Type.Boolean(),
        folgtAuf: Nullable(Type.String()),
        eintraege: Type.Array(KanalEintrag),
        alleNachweise: Type.Array(KanalNachweis),
        aenderungen: Type.Array(KanalAenderung),
        bilder: Type.Array(KanalBild),
    },
    strict,
);
export type KanalVorgang = Static<typeof KanalVorgang>;

const Text = (max: number) => Type.String({ minLength: 1, maxLength: max });

export const KanalMeldenBody = Type.Object(
    {
        operationId: OperationId,
        kategorie: literals(KANAL_KATEGORIEN),
        prioritaet: literals(KANAL_PRIORITAETEN),
        titel: Text(120),
        nachricht: Text(8000),
        schritte: Type.Optional(Type.String({ maxLength: 4000 })),
        kontext: Type.Optional(
            Type.Object(
                Object.fromEntries(
                    KANAL_KONTEXT_FELDER.map((feld) => [feld, Type.Optional(Type.String({ maxLength: 200 }))]),
                ),
                strict,
            ),
        ),
        folgtAuf: Type.Optional(Type.String({ pattern: "^(?:OPS-)?\\d{1,12}$" })),
    },
    strict,
);
export type KanalMeldenBody = Static<typeof KanalMeldenBody>;

export const KanalNachrichtBody = Type.Object({ operationId: OperationId, text: Text(8000) }, strict);
export type KanalNachrichtBody = Static<typeof KanalNachrichtBody>;

export const KanalAbnehmenBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type KanalAbnehmenBody = Static<typeof KanalAbnehmenBody>;

/**
 * Einen Vorgang aus Discord freigeben (WI-0255 Paket 2): aus `zu_sichten` nach `neu`, an Claudio oder Claudia. Ohne `an` gilt die Regel der
 * Kategorie wie beim Melden (Umbau und Karteninhalt Claudia, sonst Claudio).
 */
export const KanalSichtenBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        an: Type.Optional(literals(["claudio", "claudia"] as const)),
    },
    strict,
);
export type KanalSichtenBody = Static<typeof KanalSichtenBody>;

/**
 * Einen Vorgang aus Discord an die Community weiterleiten (WI-0297; Vali 2026-11-09): aus `zu_sichten` über die Brücke nach Production, wo eine Anfrage
 * entsteht. Erst mit deren COM-Nummer endet der Vorgang hier als `abgenommen`, Abschluss `an_community`; die Agenten sehen ihn nie.
 */
export const KanalAnCommunityBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type KanalAnCommunityBody = Static<typeof KanalAnCommunityBody>;

export const KanalWiederOeffnenBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }), kommentar: Text(8000) },
    strict,
);
export type KanalWiederOeffnenBody = Static<typeof KanalWiederOeffnenBody>;

/**
 * `POST /api/kanal/vorgaenge/:ops/abschliessen`: Der Betreiber schließt selbst ab (Migration 0127). `abgebrochen` braucht eine
 * Begründung — das prüft die Datenbank, denn der Melder sieht den Vorgang.
 */
export const KanalAbschliessenBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        art: literals(["erledigt", "abgebrochen"] as const),
        begruendung: Type.Optional(Text(8000)),
    },
    strict,
);
export type KanalAbschliessenBody = Static<typeof KanalAbschliessenBody>;

/** „Meldung jetzt löschen“ und „Bild entfernen“: nur die Kennung der Handlung. */
export const KanalHandlungBody = Type.Object({ operationId: OperationId }, strict);
export type KanalHandlungBody = Static<typeof KanalHandlungBody>;

export const KanalBildParams = Type.Object({ id: Type.String({ format: "uuid" }) }, strict);

/** `OPS-000134` aus der Kennung; `134`, `OPS-134` und `OPS-000134` zurück zur Kennung. */
export const opsId = (id: number | bigint | string): string => `OPS-${String(id).padStart(6, "0")}`;
export function leseOps(text: string): number | undefined {
    const treffer = /^(?:OPS-)?0*(\d{1,12})$/iu.exec(text.trim());
    if (treffer === null) return undefined;
    const id = Number(treffer[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/**
 * Ob der Kanal in dieser Umgebung lebt (`KANAL`, Betreiber 2026-10-13: „dann deaktiviert noch "Claudia und Claudio" für production“).
 * Ohne Wert `an`. Bei `aus` fällt `use_operator_channel` aus jeder Session — Eintrag und Glocke verschwinden damit von selbst —, und die
 * Routen antworten `kanal_unavailable` (410) statt 403, damit die Antwort den Grund nennt statt eines fehlenden Rechts.
 * 🔴 Der Schalter ist eine Eigenschaft der **Umgebung**, keine der Person: Er nimmt niemandem ein Recht, er sagt, dass es hier nichts gibt.
 */
export const KANAL_SCHALTER = ["an", "aus"] as const;
export type KanalSchalter = (typeof KANAL_SCHALTER)[number];

/** Der Fachcode der abgeschalteten Umgebung (ADR-0018). */
export const KANAL_ERROR_STATUS = {
    kanal_unavailable: 410,
    /** An die Community weiterleiten (WI-0297): Die Brücke nach Production ist in dieser Umgebung nicht eingerichtet. */
    kanal_community_aus: 503,
    /** An die Community weiterleiten: Production war nicht erreichbar oder antwortete nicht nach Vertrag; der Vorgang bleibt zu sichten. */
    kanal_community_ausfall: 503,
} as const;
export type KanalErrorCode = keyof typeof KANAL_ERROR_STATUS;
