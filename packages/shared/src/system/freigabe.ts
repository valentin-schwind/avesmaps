import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { OperationId } from "../operation.ts";
import { zeileAus } from "../versionen.ts";
import { RELEASE_FREIGABE_KENNUNG_MUSTER, RELEASE_FREIGABE_ZUSTAENDE } from "./release-test.ts";

/**
 * Die Production-Freigabe (FREIGABE-0001; Betreiber 2026-10-13: „können wir (die betreiber) manuell freigaben von features nach
 * production machen (squashes von commits)?“, dann „alles wie empfohlen, ja“ auf die drei Fragen der Abnahmefassung).
 *
 * **Stufe 1** — das hier: Die Betreiber sehen auf der Stage, was noch nicht draußen ist, und schieben den geprüften Stage-Stand mit
 * einem Knopf nach Production. Dazu der Weg zurück. **Stufe 2** (Haken je Thema und ein Kandidat, der erst auf der Stage läuft) kommt,
 * wenn sie sie vermissen; die Verträge hier lassen Platz dafür, bauen sie aber nicht.
 *
 * - 🔴 **Der Server kennt kein Git** und weiß nicht, was auf Production läuft. Claudios Werkzeug rechnet den Stand und legt ihn als
 *   Datei ab (`FREIGABE_STATUS_FILE`), der Server liest sie nur — dasselbe Muster wie bei den Sicherungen und beim Systemzustand.
 * - 🔴 **Die Regel, was ein Thema ist, steht hier** (`themaVon`), damit Werkzeug, Server und Tests dieselbe benutzen. Sie setzt auf
 *   `zeileAus` der Versionen auf; eine zweite Wahrheit über Commits gibt es nicht.
 * - **Die Freigabe ist ein Vorgang im Kanal** (FREIGABE-0001 §8): Akte, Stationen, Nachweise, Abnahme und der Weg zurück sind dort
 *   schon gebaut. Diese Verträge tragen deshalb nur die OPS-Kennung, keine eigene Protokollstruktur.
 */

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const FREIGABE_URL = "/api/admin/system/production";

/** Wie weit der vollständige Release-Nachweis (Version 3) für den Stage-Commit ist (WI-0248). */
export const FREIGABE_NACHWEISE = ["fehlt", "laeuft", "gruen", "rot"] as const;
export type FreigabeNachweis = (typeof FREIGABE_NACHWEISE)[number];

/**
 * „Für Production freigeben, nachts ausliefern“ (WI-0234; Betreiber 2026-10-19 in Claudios Sitzung: „dann machen wir das "Für Production
 * freigeben, nachts ausliefern" ja“). Der Knopf benennt den Stand als Kandidaten (WI-0248): Danach wird genau dieser Stand vollständig
 * geprüft (Release-Nachweis Version 3), und Claudios Abholer liefert ihn nur mit grünem Nachweis im Nachtfenster (04:30–07:00) aus.
 * Der Titel trägt die Art: Claudios Probe liest sie dort.
 */
export const NACHT_TITEL = "Für Production freigegeben: ";

// --- Die Regel: was ist ein Thema? ------------------------------------------------------------------------------

/**
 * Pfade, die ein Commit zur **Grundlage** machen, egal welches Paket er nennt: Migrationen, gemeinsame Verträge, Sprachtafeln, der Bau
 * und die Konfiguration. 🔴 Die Grundlage geht immer mit und ist nicht abwählbar (Betreiber 2026-10-13, E1 = A) — ohne sie wäre jeder
 * Teilstand unvollständig, und niemand müsste Abhängigkeiten pflegen.
 */
export const GRUNDLAGE_PFADE = [
    "apps/server/migrations/",
    "packages/shared/",
    "apps/web/src/i18n/",
    "ops/",
    "config/",
    "package.json",
    "package-lock.json",
] as const;

/** Pfade, die gar nicht zählen: Doku, Planung, Tests, Blätter. Sie reisen stillschweigend mit. */
export const STILLE_PFADE = ["project-control/", "docs/", "review/", ".claude/"] as const;

export function istGrundlagenPfad(pfad: string): boolean {
    return GRUNDLAGE_PFADE.some((anfang) => pfad.startsWith(anfang));
}

export function istStillerPfad(pfad: string): boolean {
    if (STILLE_PFADE.some((anfang) => pfad.startsWith(anfang))) return true;
    return /(?:^|\/)(?:test|e2e)\//u.test(pfad) || /\.(?:test|spec)\.ts$/u.test(pfad);
}

/** Die Kennung des Blocks „Grundlage“. Kein Arbeitspaket trägt sie, also kollidiert sie mit keiner Nummer. */
export const GRUNDLAGE = "grundlage";

/**
 * Welchem Thema gehört dieser Commit? `null` heißt: Er zählt nicht (nur Doku, Planung oder Tests).
 *
 * 1. Fasst er eine gemeinsame Grundlage an, gehört er zur **Grundlage** — auch mit Paketnummer.
 * 2. Sonst entscheidet die Paketnummer aus der Commit-Zeile (`feat(WI-0068 R1): …`).
 * 3. Ohne Paketnummer ist er ebenfalls **Grundlage**: Was kein Thema nennt, ist keins.
 */
export function themaVon(betreff: string, dateien: readonly string[]): string | null {
    const zaehlende = dateien.filter((pfad) => !istStillerPfad(pfad));
    if (zaehlende.length === 0) return null;
    if (zaehlende.some((pfad) => istGrundlagenPfad(pfad))) return GRUNDLAGE;
    return zeileAus({ sha: "0".repeat(40), datum: "", wer: "", betreff, doku: false }).wi ?? GRUNDLAGE;
}

// --- Die Statusdatei, die Claudios Werkzeug schreibt -------------------------------------------------------------

/** Ein Kennzeichen an einem Thema; die Oberfläche macht daraus eine Pille. */
export const FREIGABE_MARKEN = ["migration", "rechte", "umgebungswert", "schalter"] as const;
export type FreigabeMarke = (typeof FREIGABE_MARKEN)[number];

export const FreigabeThema = Type.Object(
    {
        /** `WI-0068` oder `grundlage`. */
        id: Type.String(),
        /** Kurzname des Arbeitspakets; die Grundlage trägt ihren eigenen Namen aus der Oberfläche. */
        name: Nullable(Type.String()),
        /** Der eine verständliche Satz — derselbe, den Besucher später unter „Neuigkeiten“ lesen (FREIGABE-0001 §2a.1). */
        satz: Nullable(Type.String()),
        /** `true`: der Satz ist nur der Commit-Betreff, von niemandem redigiert. */
        unredigiert: Type.Boolean(),
        marken: Type.Array(literals(FREIGABE_MARKEN)),
        /** Wie viele Änderungen, und bis zu welcher Kennung. */
        anzahl: Type.Integer({ minimum: 1 }),
        bis: Type.String(),
    },
    strict,
);
export type FreigabeThema = Static<typeof FreigabeThema>;

/**
 * Ein Stand einer Umgebung, wie Claudios Werkzeug ihn liest.
 *
 * 🔴 `release` und `commit` sind **Kennungen, kein Freitext**, und das steht hier im Vertrag, nicht nur in der Absicht des Werkzeugs:
 * Beide wandern in den Titel eines Kanal-Vorgangs, und den liest Claudios Abholer auf dem VPS **zeilenweise**
 * (`avesmaps3d-corridor-probe freigabe-auftraege`, Felder mit `|` getrennt). Ein Zeilenumbruch oder ein `|` darin wäre dort eine
 * zweite, erfundene Auftragszeile. Die Datei kommt von einer anderen Maschine — also wird sie geprüft, nicht geglaubt.
 */
export const FreigabeStand = Type.Object(
    {
        release: Type.String({ pattern: "^[0-9a-zA-Z._-]{1,40}$" }),
        commit: Type.String({ pattern: "^[0-9a-f]{7,40}$" }),
        seit: Nullable(Type.String()),
    },
    strict,
);
export type FreigabeStand = Static<typeof FreigabeStand>;

/**
 * Der letzte Rückweg von Production, wie Claudios Werkzeug ihn nach jedem „Production zurück auf den vorigen Stand“ in die
 * Statusdatei schreibt (WI-0144 §3; Betreiber 2026-10-14, wörtlich: „in dem fall muss die stage wissen, dass das feature wieder
 * zurückgefahren wurde. sprich ich muss auf der stage im reiter "Production" sehen, dass ein Feature-Release zurückgefahren
 * wurde“).
 *
 * 🔴 Die Themen, die damit **nicht mehr** in Production sind, erscheinen von selbst wieder unter „Das geht mit nach Production“:
 * `freigabe-stand.sh` rechnet gegen den dann LAUFENDEN Production-Commit. Dieser Block erklärt nur, **warum** sie wieder dastehen.
 *
 * `von` ist das Release, das weg ist, `auf` das, das jetzt läuft — dieselbe Form wie `FreigabeStand.release` und aus demselben
 * Grund als Kennung geprüft, nicht als Freitext: Die Datei kommt von einer anderen Maschine.
 */
export const FreigabeRueckweg = Type.Object(
    {
        am: Type.String(),
        von: Type.String({ pattern: "^[0-9a-zA-Z._-]{1,40}$" }),
        auf: Type.String({ pattern: "^[0-9a-zA-Z._-]{1,40}$" }),
        /** Wer zurückgefahren hat (Anzeigename), oder `null`: aus dem Vorgang nicht ableitbar. */
        durch: Nullable(Type.String({ pattern: "^[^\\u0000-\\u001f]{0,80}$" })),
        /** Der Vorgang im Kanal, schon als `OPS-000142`; `null`: keiner bekannt (ein Rückweg von der Kommandozeile). */
        vorgang: Nullable(Type.String({ pattern: "^OPS-[0-9]{6,12}$" })),
    },
    strict,
);
export type FreigabeRueckweg = Static<typeof FreigabeRueckweg>;

/**
 * `FREIGABE_STATUS_FILE`: was Claudios `freigabe:stand` im Takt schreibt. Der Server liest nur und reicht es weiter; er rechnet nichts
 * nach, weil er weder Git noch Production kennt.
 *
 * 🔴 `letzterRueckweg` ist **optional**, nicht `null`-pflichtig: Ein neuer Server muss die Datei lesen können, die das vorige
 * Werkzeug geschrieben hat („erst erweitern, dann umstellen“, `AGENTS.md`). Ein Pflichtfeld hieße „nicht eingerichtet“, bis
 * Claudios Takt einmal gelaufen ist — und damit wäre der Knopf nach jedem Release für eine Stunde tot.
 */
export const FreigabeDatei = Type.Object(
    {
        schema: Type.Literal(1),
        /** Wann die Datei geschrieben wurde; die Oberfläche sagt „Stand vor … min“. */
        standAt: Type.String(),
        production: FreigabeStand,
        stage: FreigabeStand,
        /** Ist der Stage-Stand grün geprüft? `null`: nicht feststellbar (dann kein Weg nach Production). */
        stageGruen: Nullable(Type.Boolean()),
        /** Woran die Prüfung hing (Proben, Journal), für die Zeile darunter. Text, aber ohne Steuerzeichen (siehe `FreigabeStand`). */
        stagePruefung: Nullable(Type.String({ pattern: "^[^\\u0000-\\u001f]{0,200}$" })),
        technik: Type.Object(
            {
                migrationen: Type.Array(Type.String()),
                rechte: Type.Array(Type.String()),
                umgebungswerte: Type.Array(Type.String()),
            },
            strict,
        ),
        themen: Type.Array(FreigabeThema),
        letzterRueckweg: Type.Optional(Nullable(FreigabeRueckweg)),
        /**
         * Liefert Claudios Seite nachts aus (WI-0234)? Erst dann gibt der Knopf „Für Production freigeben“ frei (Art `nacht`); vorher
         * schiebt er sofort wie bisher. Claudios `freigabe:stand --nachts` setzt es, sobald Probe, Nachtlauf und Abholer `nacht` kennen,
         * damit nie eine Nacht-Freigabe entsteht, die sein Abholer als sofortiges Release läse. Fehlt es, heißt das „nein“.
         */
        nachts: Type.Optional(Type.Boolean()),
        /**
         * Sind die Stage-Proben für diesen Stand grün (WI-0248)? Im Nachtmodus reicht das für den Knopf: Das Freigeben benennt den Kandidaten,
         * der vollständige Release-Nachweis folgt danach. Claudios `freigabe:stand --proben-gruen` setzt es. Fehlt es, heißt das „nein“.
         */
        probenGruen: Type.Optional(Type.Boolean()),
        /**
         * Der Release-Nachweis (Version 3) für den Stage-Commit (WI-0248): `fehlt` (noch keiner beauftragt), `laeuft`, `gruen`, `rot`. Optional,
         * damit ältere Dateien lesbar bleiben („erst erweitern“). Ein roter Nachweis hält den Knopf zu; `gruen` ändert nur den Satz, denn die
         * Auslieferung prüft Claudios Abholer selbst.
         */
        nachweis: Type.Optional(literals(FREIGABE_NACHWEISE)),
        /**
         * Der Prüfstand der offenen Nacht-Freigabe (WI-0234), wie Claudios `freigabe:stand` ihn aus Nachtlauf und Abholer liest (Freitext, etwa
         * „Vollständige Prüfung läuft“; die Oberfläche übersetzt ihn nicht). Optional: Ältere Dateien bleiben lesbar. Wer freigegeben hat und seit wann, weiß
         * der Server aus dem Kanal; hier steht nur, was die Prüfung sagt.
         */
        freigabe: Type.Optional(
            Nullable(
                Type.Object(
                    {
                        ops: Type.String({ pattern: "^OPS-[0-9]{6,12}$" }),
                        commit: Type.String({ pattern: "^[0-9a-f]{7,40}$" }),
                        release: Type.String({ pattern: "^[0-9a-zA-Z._-]{1,40}$" }),
                        pruefung: Nullable(Type.String({ pattern: "^[^\\u0000-\\u001f]{0,200}$" })),
                    },
                    strict,
                ),
            ),
        ),
        /**
         * Die Freigabe aus dem Start des Release-Tests (WI-0248; Vali 2026-10-26: der Start in der lokalen Systemsteuerung ist die Freigabe, die
         * Auslieferung folgt automatisch bei Grün). `freigabe:stand --release-freigabe` liest sie aus den Notizen (`refs/notes/release-auftrag`,
         * `refs/notes/sammellauf`) mit derselben Regel wie Claudios Abholer (`scripts/dev/release-freigabe.ts`); `ausgeliefert`, wenn Production
         * genau diesen Stand trägt. `satz` ist Claudios Zusatz zur Auslieferung (etwa „Auslieferung wartet: …“). Optional: Ältere Dateien bleiben lesbar.
         */
        releaseFreigabe: Type.Optional(
            Nullable(
                Type.Object(
                    {
                        commit: Type.String({ pattern: "^[0-9a-f]{40}$" }),
                        kennung: Type.String({ pattern: RELEASE_FREIGABE_KENNUNG_MUSTER }),
                        von: Nullable(Type.String({ pattern: "^[^\\u0000-\\u001f|]{1,80}$" })),
                        seit: Type.String(),
                        zustand: literals([...RELEASE_FREIGABE_ZUSTAENDE, "ausgeliefert"] as const),
                        grund: Type.String({ pattern: "^[^\\u0000-\\u001f]{0,400}$" }),
                        satz: Nullable(Type.String({ pattern: "^[^\\u0000-\\u001f]{0,200}$" })),
                    },
                    strict,
                ),
            ),
        ),
    },
    strict,
);
export type FreigabeDatei = Static<typeof FreigabeDatei>;
export type ReleaseFreigabeStand = NonNullable<FreigabeDatei["releaseFreigabe"]>;

/** Was eine Statusdatei am Vertrag verletzt (höchstens drei Stellen); leer: lesbar. Für Claudios Werkzeug, bevor es schreibt. */
export function freigabeDateiFehler(datei: unknown): string[] {
    if (Value.Check(FreigabeDatei, datei)) return [];
    return [...Value.Errors(FreigabeDatei, datei)].slice(0, 3).map((fehler) => `${fehler.path}: ${fehler.message}`);
}

// --- Der Fortschritt eines Laufs (WI-0204) -----------------------------------------------------------------------

/**
 * Der Fortschritt einer Freigabe oder eines Rückwegs (WI-0204; Betreiber 2026-10-16: „das der Button "Alles nach Production" … etwas
 * responsiver umgeht. also fortschritt und live aktualisiert“, für die Anzeige wählte er „Nur Stationen“).
 *
 * 🔴 **Kein zweiter Meldeweg.** Claudios Abholer meldet den Lauf als aufgezeichneten Job der Warteschlange (Herkunft `recorded`, wie
 * die Stage-Auslieferung `stage_rollout`), in der Datenbank der Stage, mit dem Ref `freigabe-<OPS>`. Die Route liest diesen Job zum
 * Vorgang; die Phasen sind hier festgelegt, damit Abholer, Jobart, Route und Oberfläche dieselben Namen benutzen (Handover
 * `2026-10-16-umgebungen-fortschritt-an-claudio.md`).
 *
 * Die Phase heißt nach dem Schritt, der gerade LÄUFT: `vorbereiten` beginnt, wenn `abgeholt` fertig ist.
 */
export const FREIGABE_JOB_KIND = "production_freigabe";

/** Die Phasen einer Freigabe in ihrer Reihenfolge; `zurueck` kommt nur, wenn die Proben nach dem Umschalten rot sind. */
export const FREIGABE_PHASEN_RELEASE = [
    "abgeholt",
    "vorbereiten",
    "migrieren",
    "rechte",
    "umschalten",
    "proben",
    "zurueck",
] as const;
/** Die Phasen eines Rückwegs in ihrer Reihenfolge. */
export const FREIGABE_PHASEN_RUECKWEG = ["abgeholt", "zurueck", "proben"] as const;
/** Alle Phasen, die die Jobart kennt. */
export const FREIGABE_PHASEN = [
    "abgeholt",
    "vorbereiten",
    "migrieren",
    "rechte",
    "umschalten",
    "zurueck",
    "proben",
] as const;
export type FreigabePhase = (typeof FREIGABE_PHASEN)[number];

/** Der Ref des aufgezeichneten Jobs zu einem Vorgang: genau die OPS-Kennung, etwa `freigabe-OPS-000030`. */
export function freigabeJobRef(ops: string): string {
    return `freigabe-${ops}`;
}

/** Eine abgeschlossene Phase; `ms`: wie lange sie lief, `null`: nicht gemeldet. */
export const FreigabePhaseFertig = Type.Object(
    { phase: literals(FREIGABE_PHASEN), ms: Nullable(Type.Integer({ minimum: 0 })) },
    strict,
);
export type FreigabePhaseFertig = Static<typeof FreigabePhaseFertig>;

export const FreigabeFortschritt = Type.Object(
    {
        /** `laeuft`; `gruen`: fertig und gut; `rot`: abgebrochen oder fehlgeschlagen. */
        zustand: literals(["laeuft", "gruen", "rot"] as const),
        /** Die Phase, in der der Lauf steht oder zuletzt stand; `null`: noch keine gemeldet. */
        phase: Nullable(literals(FREIGABE_PHASEN)),
        /** Die abgeschlossenen Phasen in der Reihenfolge des Ablaufs. */
        fertig: Type.Array(FreigabePhaseFertig),
        beginn: Type.String(),
        /** Seit wann die laufende Phase läuft; `null`: nicht ableitbar (eine Dauer davor fehlt). */
        phaseSeit: Nullable(Type.String()),
        ende: Nullable(Type.String()),
        /** Kennung des Fehlers aus dem Abholer, etwa `migrieren_rot`; Kennung, kein Freitext. */
        fehlerCode: Nullable(Type.String({ pattern: "^[a-z_]{1,40}$" })),
        /** Der Satz dazu, wie ihn der Abholer schreibt. */
        fehler: Nullable(Type.String({ maxLength: 400 })),
    },
    strict,
);
export type FreigabeFortschritt = Static<typeof FreigabeFortschritt>;

/** Die Phasen eines Laufs in der Reihenfolge, in der die Oberfläche sie zeigt. */
export function phasenFuer(art: "release" | "rollback"): readonly FreigabePhase[] {
    return art === "rollback" ? FREIGABE_PHASEN_RUECKWEG : FREIGABE_PHASEN_RELEASE;
}

// --- Was die Oberfläche sieht ------------------------------------------------------------------------------------

/** Warum gerade nichts nach Production kann. `null`: Der Weg ist offen. */
export const FREIGABE_SPERREN = ["nicht_eingerichtet", "gleich", "stage_ungeprueft", "stage_rot", "laeuft"] as const;
export type FreigabeSperre = (typeof FREIGABE_SPERREN)[number];

/** Eine frühere Freigabe, wie die Liste sie zeigt. */
export const FreigabeLauf = Type.Object(
    {
        ops: Nullable(Type.String()),
        release: Type.String({ pattern: "^[0-9a-zA-Z._?-]{1,40}$" }),
        at: Type.String(),
        wer: Nullable(Type.String()),
        art: literals(["release", "rollback"] as const),
        themen: Type.Integer({ minimum: 0 }),
        /** Der aufgezeichnete Lauf (WI-0204); nur am jüngsten Eintrag, und nur, wenn der Abholer ihn gemeldet hat. */
        fortschritt: Type.Optional(Nullable(FreigabeFortschritt)),
    },
    strict,
);
export type FreigabeLauf = Static<typeof FreigabeLauf>;

/** `GET /api/admin/system/production`. */
export const FreigabeSicht = Type.Object(
    {
        now: Type.String(),
        /** `null`: diese Umgebung führt keine Freigaben (lokal, Production selbst). */
        datei: Nullable(FreigabeDatei),
        /** Warum der Knopf gesperrt ist, oder `null`. */
        sperre: Nullable(literals(FREIGABE_SPERREN)),
        /** Die laufende Freigabe als Vorgang im Kanal; `null`: keine. */
        laeuft: Nullable(
            Type.Object(
                {
                    ops: Type.String(),
                    art: literals(["release", "rollback"] as const),
                    status: Type.String(),
                    seit: Type.String(),
                    /** Der aufgezeichnete Lauf (WI-0204); fehlt, solange der Abholer ihn nicht abgeholt hat. */
                    fortschritt: Type.Optional(Nullable(FreigabeFortschritt)),
                },
                strict,
            ),
        ),
        frueher: Type.Array(FreigabeLauf),
        /**
         * Die offene Nacht-Freigabe (WI-0234) aus dem Kanal, mit dem Prüfstand aus Claudios Datei, wenn er zu ihr gehört; `null`: keine.
         * Optional, damit ein älterer Server dieselbe Sicht liefern darf.
         */
        freigabe: Type.Optional(
            Nullable(
                Type.Object(
                    {
                        ops: Type.String(),
                        release: Type.String(),
                        commit: Nullable(Type.String()),
                        seit: Type.String(),
                        wer: Nullable(Type.String()),
                        pruefung: Nullable(Type.String()),
                    },
                    strict,
                ),
            ),
        ),
    },
    strict,
);
export type FreigabeSicht = Static<typeof FreigabeSicht>;

/** Gibt der Knopf nachts frei statt sofort zu schieben? Erst, wenn Claudios Seite nachts ausliefert (`nachts` in der Statusdatei, WI-0234). */
export function nachtsFreigeben(datei: FreigabeDatei | null): boolean {
    return datei?.nachts === true;
}

/** `POST /api/admin/system/production/abbrechen`: die offene Nacht-Freigabe; jeder aktive Betreiber, ohne Passkey (die sichere Richtung). */
export const FreigabeAbbrechenBody = Type.Object(
    { operationId: OperationId, ops: Type.String({ pattern: "^OPS-[0-9]{6,12}$" }) },
    strict,
);
export type FreigabeAbbrechenBody = Static<typeof FreigabeAbbrechenBody>;

/**
 * `POST /api/admin/system/production/release` — der geprüfte Stage-Stand geht nach Production.
 * 🔴 `commit` ist der Stand, den die Oberfläche gesehen hat: Hat sich die Stage seitdem bewegt, wird abgelehnt (409), statt etwas
 * anderes zu schieben, als dastand.
 */
export const FreigabeReleaseBody = Type.Object(
    { operationId: OperationId, commit: Type.String({ minLength: 7, maxLength: 40 }) },
    strict,
);
export type FreigabeReleaseBody = Static<typeof FreigabeReleaseBody>;

/** `POST /api/admin/system/production/rollback` — zurück auf das vorige Release. */
export const FreigabeRollbackBody = Type.Object({ operationId: OperationId }, strict);
export type FreigabeRollbackBody = Static<typeof FreigabeRollbackBody>;

/**
 * Die Fachcodes (ADR-0018): `freigabe_unavailable` (503) diese Umgebung führt keine Freigaben; `freigabe_stale` (409) die Stage hat
 * sich seit dem Blick bewegt; `freigabe_blocked` (409) die Stage ist nicht grün, oder es läuft schon eine.
 */
export const FREIGABE_ERROR_STATUS = {
    freigabe_unavailable: 503,
    freigabe_stale: 409,
    /** Die Nacht-Freigabe, die abgebrochen werden sollte, ist schon erloschen (WI-0234). */
    freigabe_vorbei: 409,
    freigabe_blocked: 409,
} as const;
export type FreigabeErrorCode = keyof typeof FREIGABE_ERROR_STATUS;

/** Steht der Weg nach Production offen? Eine Regel für Server, Oberfläche und Tests. */
export function sperreVon(datei: FreigabeDatei | null, laeuft: boolean): FreigabeSperre | null {
    if (datei === null) return "nicht_eingerichtet";
    if (laeuft) return "laeuft";
    if (datei.production.commit === datei.stage.commit) return "gleich";
    if (datei.stageGruen === true) return null;
    // 🔴 WI-0248: Im Nachtmodus IST das Freigeben die Kandidatenbenennung. Vorher gab es nie einen Release-Nachweis (den schreibt nur der
    // Lauf, den erst dieser Druck beauftragt), also nie einen offenen Knopf. Darum reichen grüne Proben; offen bleibt er nur ohne roten
    // Nachweis und ohne ein „geprüft und rot“. Ausgeliefert wird weiter nur mit grünem Nachweis (Claudios Abholer), im Nachtfenster. Ohne
    // `nachts` schiebt der Knopf sofort und braucht nach wie vor `stageGruen === true`.
    if (datei.nachts === true && datei.probenGruen === true && datei.stageGruen !== false && datei.nachweis !== "rot")
        return null;
    // 🔴 Zwei Lagen, zwei Saetze (Betreiber 2026-10-14): `false` heisst GEPRUEFT UND ROT - da ist etwas kaputt. `null`
    // heisst, es gab noch gar keine Pruefung; dann wartet man nur auf Claudios Lauf, und nichts ist falsch. Ein roter Release-Nachweis
    // (WI-0248) ist ebenfalls „geprüft und rot“.
    return datei.stageGruen === false || datei.nachweis === "rot" ? "stage_rot" : "stage_ungeprueft";
}
