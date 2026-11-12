import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "../operation.ts";
import { LEGACY_ZUG_KATEGORIEN, type LegacyZugKategorie } from "./legacy-zug.ts";

/**
 * Die Abgleiche der Verwaltung (WI-0127 SYS-14, SYS-0001 §9b). Betreiber 2026-10-10, wörtlich: „du kannst "Zieh mal" auch in die
 * verwaltung tun, dann brauch ichs dir nicht sagen“; 2026-10-10: „editoren dürfen nicht den legacy zug starten, das dürfen nur
 * betreiber“.
 *
 * - **Je Quelle eine Zeile** mit Kreis und „⇄ Jetzt abgleichen“. Heute sechs: der ganze Legacy-Zug, die drei Kategorien des Zugs
 *   (WI-0141, Betreiber 2026-10-13: „knopf legacy zug, aber jede kategorie einzeln … Landschaften, Wege, Orte“), die Medien aus
 *   Legacy und der Production-Zug (WI-0144, Betreiber 2026-10-14: „ich will auf der stage den button "Production-Zug holen"“).
 *   Wiki-Abgleich und Wiki-Linkziele kommen mit ihrem Modul (dann mit eigenem Recht, das auch Editoren tragen).
 * - **Nicht jede Quelle steht überall.** Eine Zeile mit der Ausführung `verborgen` gibt es in dieser Umgebung nicht und sie steht
 *   auch nicht gesperrt da (WI-0144): Auf der Stage ist Production die einzige Wahrheit, dort sind die Legacy- und Medienzeilen
 *   verborgen; in Production gibt es umgekehrt keinen Production-Zug.
 * - **Kein Sammelknopf für die Kategorien** (Betreiber: „ohne dass man alles ziehen darf“): In Production steht die Gesamtzeile auf
 *   `aus` (`ABGLEICHE=legacy:kategorien`), nur die drei Kategoriezeilen gehen. Herrschaftsgebiete gibt es als Kategorie nicht.
 * - **Ein Auftrag ist ein Job der Warteschlange** (JOBS-0001) mit der Person als Auslöser; der Fortschritt steht auf der Statusseite.
 *   Er ist ein Import: Die Kartensperre hält ihn nicht an (Betreiber 2026-10-10, SYS-0001 §9a Frage 3).
 * - **Produktprozess, kein Agenten-Zug:** Die Werkzeuge nehmen dafür `--auftrag <Job>` statt des Betreiberzitats (`--operator-said`).
 */
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();

export const ABGLEICH_QUELLEN = [
    "legacy",
    "legacy_landschaften",
    "legacy_wege",
    "legacy_orte",
    "medien",
    "production",
] as const;
export type AbgleichQuelle = (typeof ABGLEICH_QUELLEN)[number];
export const AbgleichQuelleName = Type.Union(ABGLEICH_QUELLEN.map((quelle) => Type.Literal(quelle)));

/**
 * Die Jobart je Quelle. Eine Zeile hier und eine im Katalog der Jobarten (`apps/server/src/jobs/kinds.ts`).
 *
 * 🪤 Die Abbildung ist NICHT eineindeutig: Die drei Kategorien teilen die Art `legacy_zug` und unterscheiden sich nur in der
 * Eingabe (`input_ref.kategorie`). Das ist gewollt — ein Zug einer Kategorie schreibt dieselben Tafeln wie der nächste, also darf
 * immer nur einer laufen. Wer eine Zeile liest, filtert zusätzlich nach ihrer Kategorie (`abgleiche/lesen.ts`).
 *
 * 🔴 `production_pull` hat bewusst KEINEN Handler im Worker (`jobs/handlers.ts`): Diesen Zug kann nur Claudios Abholer ausführen,
 * weil er Production über den Korridor liest. Darum lässt `ABGLEICHE` für diese Quelle auch kein `worker` zu.
 */
export const ABGLEICH_JOBARTEN = {
    legacy: "legacy_pull",
    legacy_landschaften: "legacy_zug",
    legacy_wege: "legacy_zug",
    legacy_orte: "legacy_zug",
    medien: "legacy_media",
    production: "production_pull",
} as const satisfies Record<AbgleichQuelle, string>;
export type AbgleichJobart = (typeof ABGLEICH_JOBARTEN)[AbgleichQuelle];

/** Die Kategorie einer Zeile, oder `null`: die Zeile zieht die ganze Karte beziehungsweise die Medien. */
export const ABGLEICH_KATEGORIE = {
    legacy: null,
    legacy_landschaften: "landschaften",
    legacy_wege: "wege",
    legacy_orte: "orte",
    medien: null,
    production: null,
} as const satisfies Record<AbgleichQuelle, LegacyZugKategorie | null>;

/** Die Quelle (Zeile) einer Kategorie: die Gegenrichtung zu `ABGLEICH_KATEGORIE`. */
export const ABGLEICH_KATEGORIE_QUELLE = {
    landschaften: "legacy_landschaften",
    wege: "legacy_wege",
    orte: "legacy_orte",
} as const satisfies Record<LegacyZugKategorie, AbgleichQuelle>;

/** Die Zeilen des Legacy-Zugs je Kategorie, in der Reihenfolge der Oberfläche. */
export const ABGLEICH_KATEGORIE_QUELLEN: readonly AbgleichQuelle[] = LEGACY_ZUG_KATEGORIEN.map(
    (kategorie) => ABGLEICH_KATEGORIE_QUELLE[kategorie],
);

/** Ist diese Jobart ein Auftrag aus den Abgleichen? */
export function istAbgleichJobart(kind: string): kind is AbgleichJobart {
    return (Object.values(ABGLEICH_JOBARTEN) as string[]).includes(kind);
}

/**
 * Steht diese Zeile in der Liste (WI-0144)? Eine Stelle für Server, Oberfläche und Tests: `verborgen` heißt „diese Quelle gibt es
 * hier nicht“, jeder andere Wert zeigt die Zeile — `aus` und `noch_nicht` mit gesperrtem Knopf und eigenem Satz.
 */
export function abgleichSichtbar(ausfuehrung: AbgleichAusfuehrung, quelle?: AbgleichQuelle): boolean {
    if (ausfuehrung === "verborgen") return false;
    // Seit dem Cutoff 02.11. gibt es keinen Zug aus Legacy mehr: Eine Legacy-Zeile (alles außer dem Production-Zug), die nichts
    // annimmt, steht auch nicht gesperrt da, damit kein Betreiber glaubt, er sei noch möglich.
    if (quelle !== undefined && quelle !== "production" && (ausfuehrung === "aus" || ausfuehrung === "noch_nicht")) {
        return false;
    }
    return true;
}

/**
 * Nimmt diese Zeile überhaupt Aufträge an (WI-0144)? Nur `worker` und `korridor` tun das. 🔴 Wer das wissen will, fragt diese
 * Regel und nicht `!== "aus"`: Es gibt inzwischen drei Werte, die nichts annehmen (`aus`, `noch_nicht`, `verborgen`).
 */
export function abgleichNimmtAuftraege(ausfuehrung: AbgleichAusfuehrung): boolean {
    return ausfuehrung === "worker" || ausfuehrung === "korridor";
}

/**
 * Wie eine Instanz Aufträge ausführt (Umgebungswert `ABGLEICHE`, je Quelle): `worker` rechnet der Worker der Warteschlange (Vorgabe
 * auf dem Entwicklungsrechner), `korridor` übernimmt Claudios Abholer und spielt über den Korridor ein (Stage, SYS-14b, Migration
 * 0098), `aus` nimmt keine an (Vorgabe überall sonst).
 *
 * `kategorien` ist ein Wert allein für die Quelle `legacy` (Production, WI-0141): Die Gesamtzeile steht `aus`, die drei
 * Kategoriezeilen laufen über den Korridor. Als Gesamtwert (`ABGLEICHE=kategorien`) oder für `medien` ist er unzulässig und hält
 * den Start an wie ein ungültiger `PORT`.
 *
 * Er darf die Kategorien **einzeln** öffnen: `kategorien=wege+orte` lässt genau diese zwei gehen, die ungenannte Zeile steht
 * `noch_nicht`. Betreiberregel 2026-10-13: „knöpfe dürfen nichts versprechen, was sie nicht halten können“ — eine Kategorie,
 * deren Weg noch nicht ganz steht, trägt darum einen gesperrten Knopf mit eigenem Satz und nicht `aus`. `aus` heißt „diese
 * Umgebung gleicht nichts ab“ und wäre dort eine Unwahrheit, solange die anderen Kategorien gehen.
 *
 * `verborgen` nimmt wie `aus` keine Aufträge an, **und die Zeile steht gar nicht in der Liste** (WI-0144, Betreiber 2026-10-14:
 * „unter "Abgleiche" darf auf der Stage nur "Production-Zug" stehen“). Der Unterschied zu `aus` ist eine Aussage über die
 * Oberfläche, nicht über die Ausführung: `aus` sagt „diese Quelle gibt es hier, aber sie geht nicht“, `verborgen` sagt „diese
 * Quelle gibt es hier nicht“. Darum bleibt `aus` dort, wo eine gesperrte Zeile etwas erklärt (Production: die Gesamtzeile des
 * Zugs, die Medien), und `verborgen` steht, wo sie nur im Weg wäre.
 */
export const ABGLEICH_AUSFUEHRUNGEN = ["worker", "korridor", "kategorien", "noch_nicht", "verborgen", "aus"] as const;
export type AbgleichAusfuehrung = (typeof ABGLEICH_AUSFUEHRUNGEN)[number];
/** Die Ausführung je Quelle (`ABGLEICHE=legacy:korridor,medien:aus`). */
export type AbgleichAusfuehrungen = Readonly<Record<AbgleichQuelle, AbgleichAusfuehrung>>;
export const AbgleichAusfuehrungName = Type.Union(ABGLEICH_AUSFUEHRUNGEN.map((mode) => Type.Literal(mode)));

/**
 * Der Statuskreis einer Zeile (Design Guide §13.17; SYS-14 Frage F2, Vorschlag): `voll` zuletzt vollständig abgeglichen, `halb`
 * zuletzt durchgelaufen, aber ein Teil entfiel, `leer` noch nie abgeglichen oder zuletzt gescheitert oder abgebrochen.
 */
export const ABGLEICH_KREISE = ["voll", "halb", "leer"] as const;
export type AbgleichKreis = (typeof ABGLEICH_KREISE)[number];
export const AbgleichKreisName = Type.Union(ABGLEICH_KREISE.map((kreis) => Type.Literal(kreis)));

/**
 * Wer einen Lauf ausgelöst hat: eine Person über den Knopf (`person`, mit Anzeigename) oder ein Ablauf ohne Person (`ablauf`: der
 * Zuruf an einen Agenten, der tägliche Zug, der Korridor), dann mit seinem namenlosen Etikett aus der Warteschlange.
 */
export const AbgleichAusloeser = Type.Object(
    {
        art: Type.Union([Type.Literal("person"), Type.Literal("ablauf")]),
        name: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type AbgleichAusloeser = Static<typeof AbgleichAusloeser>;

/** Der letzte fertige Lauf einer Quelle. */
export const AbgleichLauf = Type.Object(
    {
        jobId: Type.String(),
        state: Type.Union([Type.Literal("SUCCEEDED"), Type.Literal("FAILED"), Type.Literal("CANCELLED")]),
        startedAt: Nullable(Moment),
        finishedAt: Moment,
        ausgeloest: AbgleichAusloeser,
        /** Was entfiel (Schritte wie `I24`, Teile wie `dateien`); `null`: nicht bekannt (ein aufgezeichneter Lauf meldet es nicht). */
        luecken: Nullable(Type.Array(Type.String())),
        /** Zahl der Befunde, `null`: nicht bekannt. */
        befunde: Nullable(Type.Integer({ minimum: 0 })),
        /** Der Satzname des Zugs (`map…-eco…-…`), sonst `null`. */
        satz: Nullable(Type.String()),
        /** Klartext des Fehlers aus der Warteschlange (nie ein Pfad, nie ein Geheimnis). */
        fehler: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type AbgleichLauf = Static<typeof AbgleichLauf>;

/** Ein wartender oder laufender Auftrag. */
export const AbgleichAuftrag = Type.Object(
    {
        jobId: Type.String(),
        state: Type.Union([Type.Literal("QUEUED"), Type.Literal("RUNNING")]),
        queuedAt: Moment,
        startedAt: Nullable(Moment),
        phase: Nullable(Type.String()),
        progress: Nullable(Type.Number({ minimum: 0, maximum: 1 })),
        waitReason: Nullable(Type.String()),
        ausgeloest: AbgleichAusloeser,
        /** Platz in der gemeinsamen Reihe aller Umgebungen (WI-0163); `null` ohne frischen Stand des Dirigenten oder wenn er läuft. */
        platz: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
        /**
         * Wartet er hinter einem laufenden Abgleich dieser Umgebung: dessen Zeile (Betreiber 2026-10-17, „wartet hinter …“). Der
         * Server rechnet es (`abgleiche/lesen.ts`), die Oberfläche nennt nur den Namen.
         */
        hinter: Type.Optional(Nullable(AbgleichQuelleName)),
    },
    { additionalProperties: false },
);
export type AbgleichAuftrag = Static<typeof AbgleichAuftrag>;

export const AbgleichZeile = Type.Object(
    {
        quelle: AbgleichQuelleName,
        kreis: AbgleichKreisName,
        letzter: Nullable(AbgleichLauf),
        laufend: Nullable(AbgleichAuftrag),
        /**
         * Läuft diese Zeile, und wartet hinter ihr schon ein weiterer Auftrag derselben Zeile? Dann sperrt ihr Knopf (je Zeile
         * höchstens ein wartender, Betreiber 2026-10-17).
         */
        wartetDanach: Type.Optional(Type.Boolean()),
        /** Wie diese Quelle hier ausgeführt wird (SYS-14b); `aus` sperrt ihren Knopf. */
        ausfuehrung: AbgleichAusfuehrungName,
    },
    { additionalProperties: false },
);
export type AbgleichZeile = Static<typeof AbgleichZeile>;

/** `GET /api/admin/system/abgleiche`. */
export const AdminAbgleiche = Type.Object(
    {
        /** Die Uhr des Servers, für „vor … min“. */
        now: Moment,
        /** Die Ausführung des Legacy-Zugs (seit SYS-14b steht sie je Zeile in `zeilen[].ausfuehrung`; dieses Feld bleibt für ältere Leser). */
        ausfuehrung: AbgleichAusfuehrungName,
        /**
         * Lebt ein Planer der Warteschlange (mit `QUEUE_STAND_FILE`: plant der Dirigent diese Umgebung, WI-0163)? `null`: nicht
         * feststellbar. Ohne ihn wartet ein Auftrag (nur bei `worker`).
         */
        planerAktiv: Nullable(Type.Boolean()),
        zeilen: Type.Array(AbgleichZeile),
    },
    { additionalProperties: false },
);
export type AdminAbgleiche = Static<typeof AdminAbgleiche>;

/** `POST /api/admin/system/abgleiche/start`. */
export const AbgleichStartBody = Type.Object(
    { operationId: OperationId, quelle: AbgleichQuelleName },
    { additionalProperties: false },
);
export type AbgleichStartBody = Static<typeof AbgleichStartBody>;

/**
 * Die Fachcodes der Abgleiche (ADR-0018): `sync_running` (409) ein Auftrag dieser Zeile wartet oder läuft schon, oder der
 * Production-Zug schließt den Start aus; `sync_unavailable`
 * (503) diese Umgebung führt keine Aufträge aus (`ABGLEICHE=aus`).
 */
export const ABGLEICH_ERROR_STATUS = {
    sync_running: 409,
    sync_unavailable: 503,
} as const;
export type AbgleichErrorCode = keyof typeof ABGLEICH_ERROR_STATUS;

/** Der Kreis aus dem letzten fertigen Lauf (F2): die eine Regel für Server, Oberfläche und Tests. */
export function abgleichKreis(letzter: Pick<AbgleichLauf, "state" | "luecken"> | null): AbgleichKreis {
    if (letzter === null || letzter.state !== "SUCCEEDED") return "leer";
    return (letzter.luecken?.length ?? 0) > 0 ? "halb" : "voll";
}
