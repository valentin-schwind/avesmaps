import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "./operation.ts";

/**
 * Der tägliche Discord-Bericht (WI-0255; Betreiberauftrag 2026-10-25, `project-control/work-items/discord-community-bericht-auftrag-2026-10-25.md`):
 * jeden Tag um 10:00 Europe/Berlin EIN gemeinsamer Bericht von Claudia und Claudio im bisherigen Berichtskanal, ohne Freigabe der einzelnen
 * Nachricht, ohne Ping und ohne Namen.
 *
 * - 🔴 **Nur die Stage sendet** (Vali 2026-10-26: „am besten ist, wenn der bot von production nichts weiß, sonst nur mit der stage und discord
 *   kommuniziert“). Production und lokal rechnen höchstens Vorschauen, senden aber nie; der Server prüft das selbst
 *   (`apps/server/src/discord/konfig.ts`), nicht nur die Oberfläche. Der Kanal der Meldungen lebt dort, die Befehle kommen dort an.
 * - 🔴 **Evidenz statt Behauptung.** Drei Zustände, die nie verwechselt werden: `live` (in Production; die Stage weiß es aus ihrer Statusdatei der
 *   Freigabe und aus dem Verlauf ihres eigenen Release), `getestet` (im laufenden Stage-Release, noch nicht in Production), `laufend` (auf der Stage,
 *   aber ihre Prüfung ist rot). Was keine Quelle belegt, steht nicht im Bericht.
 * - 🔴 **Einmal je Berichtstag und Kanal** (`discord_zustellung`, eindeutiger Schlüssel). Kein Nachholen vergangener Tage: Ein Ausfall erzeugt
 *   keinen Rückstau.
 * - Die Website-Neuigkeiten (WI-0139) bleiben Entwürfe mit Freigabe; beide Wege lesen denselben Faktenbestand (den Verlauf der Releases), senden
 *   aber getrennt.
 * - 🔴 **Das Modell schreibt den ganzen Bericht** (Vali 2026-10-26, WI-0255 §3b): Gruß nach Tageszeit, „Was ist neu?“ (Production) und „Was ist in
 *   Entwicklung?“ (Stage), erzählte Behebungen, Icons, höchstens `DISCORD_BERICHT_MAX` Zeichen. Bindend ist trotzdem allein die Prüfung danach (`pruefeModellBericht`):
 *   Fällt der Text durch, gilt die feste Vorlage im selben Aufbau, und der Bericht kommt immer.
 */

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const DISCORD_ADMIN_URL = "/api/admin/system/discord";

/**
 * Der Zeitplan (WI-0255; Vali 2026-10-25: „auch die uhrzeit für die routine“). Claudios systemd-Timer fragt alle 15 Minuten
 * (`OnCalendar=*:00/15`); ob jetzt gesendet wird, entscheidet die App aus der Uhrzeit, die die Betreiber im Reiter speichern. Gesendet wird in dem
 * Fenster von dieser Uhrzeit bis `fensterStunden` Stunden danach, höchstens bis Mitternacht des Berichtstags (`sendefenster`): Ein Lauf außerhalb
 * sendet nicht, ein Ausfall erzeugt keinen verspäteten Bericht. `uhrzeit` ist die Vorgabe, wenn im Reiter nichts anderes steht.
 */
export const DISCORD_ZEITPLAN = {
    uhrzeit: "10:00",
    zone: "Europe/Berlin",
    fensterStunden: 4,
} as const;

/** Eine Uhrzeit des Berichts: `HH:MM`, 24 Stunden, Berliner Zeit. */
export const DISCORD_UHRZEIT_MUSTER = "^([01][0-9]|2[0-3]):[0-5][0-9]$";
export const istDiscordUhrzeit = (wert: string): boolean => new RegExp(DISCORD_UHRZEIT_MUSTER, "u").test(wert);

const minutenVon = (uhrzeit: string): number => {
    const [stunde = "0", minute = "0"] = uhrzeit.split(":");
    return Number.parseInt(stunde, 10) * 60 + Number.parseInt(minute, 10);
};
const alsUhrzeit = (minuten: number): string =>
    `${String(Math.floor(minuten / 60)).padStart(2, "0")}:${String(minuten % 60).padStart(2, "0")}`;

/**
 * Das Sendefenster zu einer Uhrzeit: von ihr (einschließlich) bis `fensterStunden` danach (ausschließlich), höchstens bis zum Ende des Tages
 * (`24:00`). 🔴 Nie über Mitternacht: Dort wechselt der Berichtstag, und ein Lauf am Folgetag gehört zu dessen eigenem Fenster. Die Minuten sind
 * Wanduhrminuten des Berliner Tages; die Zeitumstellung verschiebt sie nicht.
 */
export function sendefenster(uhrzeit: string): { von: string; bis: string; vonMinuten: number; bisMinuten: number } {
    const vonMinuten = minutenVon(uhrzeit);
    const bisMinuten = Math.min(vonMinuten + DISCORD_ZEITPLAN.fensterStunden * 60, 24 * 60);
    return { von: alsUhrzeit(vonMinuten), bis: alsUhrzeit(bisMinuten), vonMinuten, bisMinuten };
}

/**
 * Der Prompt des Berichts (WI-0255; Vali 2026-10-25: „die betreiber sollen den prompt ... ändern können“). Er bestimmt Ton, Stil und Aufbau des Textes,
 * den ein Formulierer schreibt (seit 2026-10-26 der ganze Bericht, vorher nur der Satz unter dem Kopf). Die Fakten stehen fest in der Eingabe, und die
 * harten Regeln (`regeln` in der Eingabe des Formulierers, die Prüfung `pruefeModellBericht`) gehen jedem Prompt vor. Ohne gespeicherten Prompt gilt
 * die Vorgabe.
 *
 * Die Vorgabe ist der mit Sonnet erprobte Prompt von Claudio (Handover `2026-10-26-discord-vorgabe-prompt-an-claudia.md`), angepasst an den Aufbau
 * der früheren Tagesberichte: Icons und „—“ gehören dazu, „keine Emojis“ entfällt. 🪤 Ohne „Duze“ siezt das Modell. Seit WI-0255 §3e wählt das
 * Modell selbst aus und bündelt; die Vorgabe trägt dafür die Regeln der Legacy-Routine „Feature-Update“ (Publikum schlägt Dateipfad, Internes weg,
 * je Punkt, was man jetzt besser kann).
 */
export const DISCORD_PROMPT_MAX = 1500;
export const DISCORD_PROMPT_VORGABE =
    "Zwei Kartenzeichner melden sich aus ihrer Werkstatt in Aventurien: die eine baut an der Karte, der andere hält Wege, Boten und Archiv in Gang. " +
    "Sie schreiben als Paar (wir) und beginnen mit einem kurzen Gruß zur Tageszeit, etwa „Wir waren wieder fleißig für euch“. " +
    "Keine Namen. Freundlich, trocken humorvoll, ruhig; " +
    "höchstens eine Anspielung auf die Zwölfgötter. Duze die Leser (ihr, euch).\n" +
    "Auswahl: Zähle alle erledigten Punkte auf, die Leser bemerken, das Wichtigste zuerst. Frag bei jeder Neuerung: Wer merkt das? " +
    "Was Kartenbesucher sehen, steht unter 🗺️ Karte; was nur im Editor auffällt, unter 🛠️ Editor und Werkzeuge; was Discord betrifft, unter " +
    "🤝 Discord und Community. Lass weg, was niemand auf avesmaps.de oder in Discord bemerkt: Verträge, Schnittstellen, Server, Tests, Werkzeuge der " +
    "Entwickler. Ein Thema steht nur einmal. Behobene Fehler nur, wenn man sie gespürt hätte, unter 🐞 Fehler behoben; eine bloße Umbenennung oder " +
    "neue Möglichkeit ist kein behobener Fehler.\n" +
    "Form: Icons an Titel und Abschnitten, nur Abschnitte mit Punkten. Jeder Punkt steht in einer eigenen Zeile und besteht aus ganzen Sätzen, " +
    "ein bis zwei, was man jetzt (besser) kann; kein Satz bricht ab. Ein Fettkopf „**Kurztitel** — “ davor ist nur erlaubt, wenn er ein echter Titel ist " +
    "(zwei bis fünf Wörter, die Sache selbst, nie die ersten Wörter des Satzes); sonst schreib den Punkt ohne Fettkopf. " +
    "Schreibe echte Umlaute (ä, ö, ü), nie ae, oe oder ue. Keine Ausrufezeichen, kein Werbeton, kein Fachjargon.";

/**
 * So viele Zeichen hat jede einzelne Nachricht des Berichts höchstens (Vali 2026-11-02: den Platz nutzen, den Discord lässt); der Rand bis
 * `DISCORD_INHALT_MAX` ist Reserve. Passen die Punkte nicht in eine Nachricht, schickt der Bericht mehrere hintereinander (Vali 2026-11-02: „wenn A geht“).
 */
export const DISCORD_BERICHT_MAX = 1950;
/** Mehr Nachrichten schickt ein Bericht nie (Schutz vor einem Überlauf, etwa durch eine riesige Community-Liste); darüber ist die Prüfung rot. */
export const DISCORD_BERICHT_TEILE_MAX = 12;
/** Zeilenumbruch ja, sonst keine Steuerzeichen. */
export const DISCORD_PROMPT_MUSTER = "^[^\\u0000-\\u0009\\u000B-\\u001F\\u007F]*$";

export const istDiscordPrompt = (text: string): boolean =>
    text.length <= DISCORD_PROMPT_MAX && new RegExp(DISCORD_PROMPT_MUSTER, "u").test(text);

/** Eine Kanalkennung (Snowflake): 17 bis 20 Ziffern. */
export const DISCORD_KANAL_MUSTER = "^[0-9]{17,20}$";

/** Der Schluss jeder Nachricht (Betreiberauftrag 2026-10-25). */
export const DISCORD_SCHLUSS = "Eure Claudia und Claudio";

/** Discord nimmt höchstens 2000 Zeichen Inhalt je Nachricht. */
export const DISCORD_INHALT_MAX = 2000;

/**
 * Wie der Bericht dieser Umgebung sendet: `aus` (Vorgabe) oder `senden` (in den Berichtskanal). 🔴 Es gibt nur diesen einen Kanal (Vali 2026-10-26:
 * „du sollst den testkanal nicht mehr benutzen. der einzige kanal, den du benutzen darfst ist: 1523690349816447157“). Ein noch gesetztes
 * `testkanal` ist unbekannt und wirkt wie `aus` (`DiscordStand.modusVeraltet`).
 */
export const DISCORD_MODI = ["aus", "senden"] as const;
export type DiscordModus = (typeof DISCORD_MODI)[number];

/**
 * Warum hier nicht gesendet wird (oder `null`: es wird gesendet). `nicht_stage`: Production und lokal senden nie. `ohne_schluessel` und
 * `ohne_kanal`: die geschützte Konfiguration auf dem VPS fehlt (Claudio).
 */
export const DISCORD_SPERREN = ["aus", "nicht_stage", "ohne_schluessel", "ohne_kanal"] as const;
export type DiscordSperre = (typeof DISCORD_SPERREN)[number];

/**
 * Der Stand einer Zustellung. `sendet`: ein Lauf hat sie beansprucht. `unklar`: Die Anfrage ging hinaus, die Antwort nicht zurück; vor jedem
 * neuen Versuch wird im Kanal nachgesehen, nie blind wiederholt. `fehlgeschlagen`: Discord hat abgelehnt oder war nicht erreichbar.
 */
export const DISCORD_ZUSTELL_STATUS = ["sendet", "zugestellt", "fehlgeschlagen", "unklar"] as const;
export type DiscordZustellStatus = (typeof DISCORD_ZUSTELL_STATUS)[number];

/** Die drei Zustände eines Fakts (Betreiberauftrag: `live` ≠ `getestet` ≠ `laufend`). */
export const DISCORD_FAKT_STATUS = ["live", "getestet", "laufend"] as const;
export type DiscordFaktStatus = (typeof DISCORD_FAKT_STATUS)[number];

/**
 * Was ein Lauf zuletzt ergab (`discord_routine.letzter_lauf`), als Kennung für die Oberfläche. `zugestellt`, `schon_zugestellt`, `laeuft_schon`,
 * `unklar`, `fehlgeschlagen`; ohne Senden: `routine_aus`, `ausserhalb_fenster`, `pruefung_rot` und die Sperren.
 */
export const DISCORD_LAUF_ERGEBNISSE = [
    "zugestellt",
    "schon_zugestellt",
    "laeuft_schon",
    "unklar",
    "fehlgeschlagen",
    "routine_aus",
    "ausserhalb_fenster",
    "pruefung_rot",
    ...DISCORD_SPERREN,
] as const;
export type DiscordLaufErgebnis = (typeof DISCORD_LAUF_ERGEBNISSE)[number];

/**
 * Eine Zeile des Sendearchivs. `text` ist genau der Inhalt, der hinausging (oder hinausgehen sollte); besteht der Bericht aus mehreren Nachrichten, stehen alle da,
 * getrennt durch eine Zeile „— nächste Nachricht —“. `messageId` ist die der ersten Nachricht.
 */
export const DiscordZustellung = Type.Object(
    {
        id: Type.Integer({ minimum: 1 }),
        tag: Type.String(),
        kanal: Type.String(),
        status: literals(DISCORD_ZUSTELL_STATUS),
        messageId: Nullable(Type.String()),
        text: Type.String(),
        formulierung: literals(["vorlage", "modell"] as const),
        versuche: Type.Integer({ minimum: 0 }),
        /** Die Diagnose ohne Geheimnis: HTTP-Status, Discords Fehlercode und Satz, oder die Art der Netzstörung. */
        fehler: Nullable(Type.String()),
        ausgeloest: literals(["zeitplan", "hand"] as const),
        erstelltAt: Type.String(),
        zugestelltAt: Nullable(Type.String()),
        /** Darf ein Mensch sie jetzt wiederholen? Nur heute, nur fehlgeschlagen oder unklar, nur wo gesendet wird. */
        wiederholbar: Type.Boolean(),
    },
    strict,
);
export type DiscordZustellung = Static<typeof DiscordZustellung>;

/**
 * Ein Kanal der Einstellungen: was im Reiter steht (`eigen`), was die Umgebung als Vorgabe trägt (`umgebung`, `DISCORD_BERICHT_KANAL`) und was gilt (`gilt`, der Reiter vor der Umgebung). Kanalkennungen sind kein Geheimnis.
 */
export const DiscordKanalWert = Type.Object(
    {
        eigen: Nullable(Type.String()),
        umgebung: Nullable(Type.String()),
        gilt: Nullable(Type.String()),
        quelle: literals(["reiter", "umgebung", "keine"] as const),
    },
    strict,
);
export type DiscordKanalWert = Static<typeof DiscordKanalWert>;

/** `GET /api/admin/system/discord` — der Betriebsstand des Reiters. Kein Schlüssel, nur ob einer hinterlegt ist. */
export const DiscordStand = Type.Object(
    {
        umgebung: Type.String(),
        modus: literals(DISCORD_MODI),
        /** `null`: Diese Umgebung sendet. */
        sperre: Nullable(literals(DISCORD_SPERREN)),
        schluessel: Type.Boolean(),
        /** Der Berichtskanal, in den diese Umgebung sendet, oder `null`; Kanalkennungen sind kein Geheimnis. */
        kanal: Nullable(Type.String()),
        /** `DISCORD_BERICHT` steht noch auf dem abgeschafften Modus `testkanal`: Er wirkt wie `aus`, der Reiter sagt es. */
        modusVeraltet: Type.Boolean(),
        formulierer: Type.Boolean(),
        /** Die Uhrzeit, die gilt, und das Sendefenster daraus (`sendefenster`). */
        zeitplan: Type.Object(
            { uhrzeit: Type.String(), zone: Type.String(), fensterVon: Type.String(), fensterBis: Type.String() },
            strict,
        ),
        /** Was die Betreiber im Reiter einstellen: Prompt, Uhrzeit und Berichtskanal (WI-0255). */
        einstellungen: Type.Object(
            {
                /** Der Prompt, der gilt: der gespeicherte oder die Vorgabe. */
                prompt: Type.String(),
                promptEigen: Type.Boolean(),
                uhrzeit: Type.String(),
                kanalBericht: DiscordKanalWert,
                geaendertAt: Nullable(Type.String()),
                geaendertVon: Nullable(Type.String()),
            },
            strict,
        ),
        routine: Type.Object(
            {
                aktiv: Type.Boolean(),
                geaendertAt: Nullable(Type.String()),
                geaendertVon: Nullable(Type.String()),
            },
            strict,
        ),
        letzterLauf: Nullable(Type.Object({ at: Type.String(), ergebnis: Type.String() }, strict)),
        letzterErfolg: Nullable(
            Type.Object({ tag: Type.String(), at: Type.String(), messageId: Type.String() }, strict),
        ),
        heute: Type.String(),
        archiv: Type.Array(DiscordZustellung),
    },
    strict,
);
export type DiscordStand = Static<typeof DiscordStand>;

/** Was ein Fakt ist: ein neues Merkmal (`feat`) oder eine Behebung (`fix`); der Bericht erzählt beides, getrennt. */
export const DISCORD_FAKT_ARTEN = ["feature", "fix"] as const;
export type DiscordFaktArt = (typeof DISCORD_FAKT_ARTEN)[number];

/**
 * Ein Fakt mit Zustand und Art, wie der Bericht ihn nennt. 🪤 `art` steht erst seit 2026-10-26 im Bestand; ältere gespeicherte Bestände (Spalte
 * `discord_zustellung.fakten`) tragen es nicht. Gelesen werden von ihnen nur `erhobenAt`, `production.commit` und `werkstatt.alle`.
 */
export const DiscordFakt = Type.Object(
    { status: literals(DISCORD_FAKT_STATUS), satz: Type.String(), art: literals(DISCORD_FAKT_ARTEN) },
    strict,
);
export type DiscordFakt = Static<typeof DiscordFakt>;

/**
 * Ein feat- oder fix-Commit, wie ihn das Modell zum Auswählen und Bündeln bekommt (WI-0255 §3e): die `Neu:`-Zeilen (leer, wenn der Commit keine
 * trägt), Betreff, Beschreibung und Bereiche aus dem Verlauf, roh wie im Verlauf; geglättet für die Öffentlichkeit wird erst die Eingabe des
 * Formulierers. `scope` ist der Scope des Präfixes und gruppiert Commits einer Sache; er geht nie selbst an das Modell. `schluessel` ist das, was
 * sich die Werkstatt merkt (die Sätze, sonst der Betreff).
 */
export const DiscordEintrag = Type.Object(
    {
        status: literals(DISCORD_FAKT_STATUS),
        art: literals(DISCORD_FAKT_ARTEN),
        saetze: Type.Array(Type.String()),
        betreff: Type.String(),
        scope: Nullable(Type.String()),
        beschreibung: Type.String(),
        bereich: Type.Array(Type.String()),
    },
    strict,
);
export type DiscordEintrag = Static<typeof DiscordEintrag>;

/**
 * Der Faktenbestand eines Berichts, wie er beim Lauf erhoben wurde, und in der Zustellung gespeichert als Nachweis. Er ist deterministisch:
 * dieselben Quellen ergeben dieselben Fakten. Der nächste Bericht vergleicht mit ihm, damit nichts zweimal als neu erscheint.
 */
export const DiscordFakten = Type.Object(
    {
        schema: Type.Literal(1),
        tag: Type.String(),
        erhobenAt: Type.String(),
        umgebung: Type.String(),
        production: Type.Object(
            {
                release: Type.String(),
                commit: Nullable(Type.String()),
                /** Der Production-Stand des letzten zugestellten Berichts; `null`: erster Bericht oder unbekannt. */
                seit: Nullable(Type.String()),
                /**
                 * `erster`: kein früherer Bericht; `gleich`: derselbe Stand wie damals; `neu`: der Verlauf kennt beide Stände; `unbekannt`: Der
                 * Verlauf kennt den früheren Stand nicht (etwa nach einem Rückweg) oder der laufende ist nicht belegt — dann wird nichts behauptet.
                 */
                vergleich: literals(["erster", "gleich", "neu", "unbekannt"] as const),
                neu: Type.Array(DiscordFakt),
                /** Dieselbe Spanne je Commit, für das Modell (WI-0255 §3e); ältere Bestände tragen sie nicht. */
                eintraege: Type.Optional(Type.Array(DiscordEintrag)),
                /** Änderungen ohne redigierten Satz (`Neu:`-Zeile fehlt): gezählt, nie als Commit-Zeile gezeigt. */
                ohneSatz: Type.Integer({ minimum: 0 }),
            },
            strict,
        ),
        werkstatt: Type.Object(
            {
                commit: Nullable(Type.String()),
                /** `ohne_quelle`: kein Stage-Verlauf lesbar; `gleich`: Stage und Production stehen gleich; `unbekannt`: nicht vergleichbar. */
                vergleich: literals(["ohne_quelle", "gleich", "neu", "unbekannt"] as const),
                pruefung: literals(["gruen", "rot", "unbekannt"] as const),
                /** Alle Sätze, die auf der Stage stehen und noch nicht in Production (für den Vergleich am nächsten Tag). */
                alle: Type.Array(Type.String()),
                neu: Type.Array(DiscordFakt),
                /** Die neuen Commits der Werkstatt je Commit, für das Modell (WI-0255 §3e); ältere Bestände tragen sie nicht. */
                eintraege: Type.Optional(Type.Array(DiscordEintrag)),
                /** Schon berichtet und weiter in der Werkstatt. */
                weiterhin: Type.Integer({ minimum: 0 }),
            },
            strict,
        ),
        community: Type.Object(
            {
                von: Type.String(),
                bis: Type.String(),
                bearbeitungen: Type.Integer({ minimum: 0 }),
                medien: Type.Integer({ minimum: 0 }),
                /** Wie viele Personen mitgearbeitet haben, erst ab drei (sonst `null`): Eine Zahl darf niemanden erkennbar machen. */
                personen: Nullable(Type.Integer({ minimum: 3 })),
                bewertungen: Type.Integer({ minimum: 0 }),
            },
            strict,
        ),
    },
    strict,
);
export type DiscordFakten = Static<typeof DiscordFakten>;

/**
 * `GET /api/admin/system/discord/vorschau` — der Bericht, wie er jetzt hinausginge; gesendet wird nichts, gespeichert auch nicht. Besteht er aus mehreren
 * Nachrichten, trennt eine Zeile „— nächste Nachricht —“ sie im `text`, und `zeichen` ist die Länge der längsten (jede darf `DISCORD_INHALT_MAX` haben).
 */
export const DiscordVorschau = Type.Object(
    {
        tag: Type.String(),
        text: Type.String(),
        zeichen: Type.Integer({ minimum: 0 }),
        pruefung: Type.Object({ ok: Type.Boolean(), fehler: Type.Array(Type.String()) }, strict),
        fakten: DiscordFakten,
    },
    strict,
);
export type DiscordVorschau = Static<typeof DiscordVorschau>;

/** `POST /api/admin/system/discord/routine` — die tägliche Routine an- oder ausschalten (Passkey). */
export const DiscordRoutineBody = Type.Object({ operationId: OperationId, aktiv: Type.Boolean() }, strict);
export type DiscordRoutineBody = Static<typeof DiscordRoutineBody>;

/**
 * `POST /api/admin/system/discord/einstellungen` — Prompt, Uhrzeit und Berichtskanal in einem Schritt (Passkey). Es zählt immer der ganze Satz: `null`
 * heißt „zurück auf die Vorgabe“ (beim Prompt der Text der Vorgabe, beim Kanal die Umgebungsvariable). Ein mitgeschicktes `testKanal` (alter Stand der
 * Seite) streift ajv still ab. 🪤 Typlisten statt `Union([…, Null])`:
 * Fastifys ajv wandelte sonst ein `null` in einen leeren Text.
 */
export const DiscordEinstellungenBody = Type.Object(
    {
        operationId: OperationId,
        prompt: Type.Unsafe<string | null>({
            type: ["string", "null"],
            maxLength: DISCORD_PROMPT_MAX,
            pattern: DISCORD_PROMPT_MUSTER,
        }),
        uhrzeit: Type.String({ pattern: DISCORD_UHRZEIT_MUSTER }),
        berichtsKanal: Type.Unsafe<string | null>({ type: ["string", "null"], pattern: DISCORD_KANAL_MUSTER }),
    },
    strict,
);
export type DiscordEinstellungenBody = Static<typeof DiscordEinstellungenBody>;

/** `POST /api/admin/system/discord/zustellungen/:id/wiederholen` — eine fehlgeschlagene oder unklare Zustellung von heute (Passkey). */
export const DiscordWiederholenBody = Type.Object({ operationId: OperationId }, strict);
export type DiscordWiederholenBody = Static<typeof DiscordWiederholenBody>;
export const DiscordZustellungParams = Type.Object({ id: Type.Integer({ minimum: 1 }) }, strict);

/**
 * Die Fachcodes (ADR-0018): `discord_bericht_fehlt` (503) die Tafeln fehlen (Migration 0221 noch nicht angewandt); `discord_zustellung_fehlt`
 * (404) diese Zustellung gibt es nicht; `discord_sendet_nicht` (409) diese Umgebung sendet nicht (Sperre in `details.sperre`);
 * `discord_nicht_wiederholbar` (409) nur heutige, fehlgeschlagene oder unklare Zustellungen lassen sich wiederholen. Die Einstellungen (WI-0255):
 * `discord_kanal_unbrauchbar` (409, `details.kanal` immer `bericht`, `details.grund` `unbekannt`/`sehen`/`schreiben`/`kein_textkanal`) der Bot kann den Kanal nicht
 * sehen oder dort nicht schreiben; `discord_kanal_nicht_pruefbar` (503) Discord war nicht erreichbar oder lehnte den Schlüssel ab, der Kanal bleibt
 * ungeprüft und wird nicht gespeichert; `discord_prompt_ungueltig` (400). 🪤 Nicht
 * `discord_unavailable`: Den Code trägt schon die Anmeldung mit Discord (`routes/auth-discord.ts`).
 */
export const DISCORD_ERROR_STATUS = {
    discord_bericht_fehlt: 503,
    discord_zustellung_fehlt: 404,
    discord_sendet_nicht: 409,
    discord_nicht_wiederholbar: 409,
    discord_kanal_unbrauchbar: 409,
    discord_kanal_nicht_pruefbar: 503,
    discord_prompt_ungueltig: 400,
} as const;
export type DiscordErrorCode = keyof typeof DISCORD_ERROR_STATUS;
