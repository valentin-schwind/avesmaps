import { Type, type Static, type TSchema } from "@sinclair/typebox";

/**
 * „Versionen“ und die Kurzinfo „Was ist neu?“ (WI-0137, VERSION-0001). Die Daten reisen als Dateien im Release mit
 * (`config/releases/<stamm>.json` vom Werkzeug `npm run release:notizen`, `<stamm>.md` die Kurzinfo der Koordination); der Server fragt
 * nie GitHub und braucht kein Git. Hier stehen das Format, das Gruppieren nach Arbeitspaket und der Leser der Kurzinfo, damit Werkzeug,
 * Server und Oberfläche dieselben Regeln haben.
 */

export const VERSIONEN_URL = "/api/admin/system/versionen";
export const KURZINFO_URL = "/api/version/kurzinfo";
/** Das eigene Repository; Commit-Links werden aus der SHA gebaut, nie aus einem Text. */
export const GITHUB_REPOSITORY = "https://github.com/valentin-schwind/avesmaps3D";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA_KURZ = /^[0-9a-f]{7,40}$/u;

/** Der Link auf einen Commit; `null` für alles, was keine SHA ist. */
export function commitLink(sha: string): string | null {
    return SHA_KURZ.test(sha) ? `${GITHUB_REPOSITORY}/commit/${sha}` : null;
}

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String({ minLength: 10 });
const Sha = Type.String({ pattern: SHA40.source });
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

/** Der Stamm einer Release-Datei: Datum des Release-Commits und die ersten acht Zeichen seiner SHA. */
export const RELEASE_STAMM = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/u;
export const releaseStamm = (datum: string, bis: string): string => `${datum.slice(0, 10)}-${bis.slice(0, 8)}`;

export const ReleaseCommit = Type.Object(
    {
        sha: Sha,
        /** ISO 8601 mit Zone, wie Git es liefert. */
        datum: Moment,
        /** Der Name aus Git, auf Claudia, Claudio, Valentin abgebildet; nie eine E-Mail-Adresse. */
        wer: Type.String({ minLength: 1, maxLength: 80 }),
        /** Die erste Zeile der Nachricht. */
        betreff: Type.String({ maxLength: 500 }),
        /** Ändert nur Doku (`project-control/`, `docs/`, `review/`, `*.md`): erst hinter „Auch Doku zeigen“ (WI-0137 1 B). */
        doku: Type.Boolean(),
    },
    strict,
);
export type ReleaseCommit = Static<typeof ReleaseCommit>;

/** `config/releases/<stamm>.json`: geschrieben vom Werkzeug, nie von Hand. */
export const ReleaseNotizen = Type.Object(
    {
        schema: Type.Literal(1),
        titel: Type.String({ maxLength: 400 }),
        von: Sha,
        bis: Sha,
        /** Datum des Release-Commits (`bis`). */
        datum: Moment,
        /** Titel der Arbeitspakete aus den Präfixen (`WI-0128` → „Ortseditor, …“). */
        pakete: Type.Record(Type.String({ pattern: "^WI-\\d{4}$" }), Type.String({ maxLength: 300 })),
        commits: Type.Array(ReleaseCommit),
    },
    strict,
);
export type ReleaseNotizen = Static<typeof ReleaseNotizen>;

// --- Gruppieren (aus dem Mockup `versionen-mockup.ts`, WI-0137 §3) ---

/** Die Arten aus dem Präfix, die die Oberfläche benennt; andere stehen ohne Marke da. */
export const COMMIT_ARTEN = ["feat", "fix", "docs", "test", "refactor", "chore", "perf"] as const;
export type CommitArt = (typeof COMMIT_ARTEN)[number];

export interface VersionZeile {
    commit: ReleaseCommit;
    art: CommitArt | null;
    /** Der Rest des Bereichs neben der WI-Nummer (`E12`), dann der Satz; ohne Präfix der ganze Betreff. */
    text: string;
}

export interface VersionGruppe {
    /** `WI-0128` oder `sonstiges`. */
    id: string;
    /** Kurzname: Titel des Arbeitspakets ohne Nummer, bis zum ersten Doppelpunkt oder Komma. */
    name: string | null;
    zeilen: VersionZeile[];
}

/** `feat(WI-0128 E12): Ort verschieben` → WI-0128, Art `feat`, Text „E12 · Ort verschieben“. */
export function zeileAus(commit: ReleaseCommit): { wi: string | null; zeile: VersionZeile } {
    const praefix = /^([a-z]+)\(([^)]*)\)!?:\s*(.*)$/u.exec(commit.betreff);
    const wi = /WI-\d{4}/u.exec(commit.betreff.split(":")[0] ?? "")?.[0] ?? null;
    if (praefix === null) {
        const einfach = /^([a-z]+)!?:\s*(.*)$/u.exec(commit.betreff);
        const art =
            einfach === null
                ? null
                : (COMMIT_ARTEN as readonly string[]).includes(einfach[1]!)
                  ? (einfach[1] as CommitArt)
                  : null;
        return { wi, zeile: { commit, art, text: art === null ? commit.betreff : (einfach?.[2] ?? commit.betreff) } };
    }
    const [, roh = "", bereich = "", satz = ""] = praefix;
    const art = (COMMIT_ARTEN as readonly string[]).includes(roh) ? (roh as CommitArt) : null;
    const rest = bereich.replace(/WI-\d{4}\s*/u, "").trim();
    return { wi, zeile: { commit, art, text: rest !== "" && rest !== bereich ? `${rest} · ${satz}` : satz } };
}

/**
 * Der Name ohne Klammerzusatz bis zum ersten „: “ oder „, “: „Auth-Plattform (Identität, Anmeldung)“ wird „Auth-Plattform“; ein
 * Doppelpunkt im Zitat („Verantwortlich für:“) schneidet nicht.
 */
function kurzname(titel: string | undefined): string | null {
    if (titel === undefined) return null;
    const ohne = titel.replace(/^WI-\d{4}\s*[:—–·-]?\s*/u, "");
    const kurz = ohne
        .replace(/\s*\([^()]*\)/gu, "")
        .split(/[:,](?=\s)/u)[0]
        ?.trim();
    return kurz || ohne.trim() || null;
}

/** Die Gruppen: Arbeitspakete nach ihrem jüngsten Commit, „Sonstiges“ zuletzt; in jeder Gruppe neueste zuerst. Doku nur mit `mitDoku`. */
export function versionGruppen(
    commits: readonly ReleaseCommit[],
    pakete: Readonly<Record<string, string>>,
    mitDoku: boolean,
): VersionGruppe[] {
    const nach = new Map<string, VersionZeile[]>();
    for (const commit of commits) {
        if (commit.doku && !mitDoku) continue;
        const { wi, zeile } = zeileAus(commit);
        const id = wi ?? "sonstiges";
        nach.set(id, [...(nach.get(id) ?? []), zeile]);
    }
    const liste = [...nach.entries()].map(([id, zeilen]) => ({
        id,
        name: id === "sonstiges" ? null : kurzname(pakete[id]),
        zeilen: zeilen.sort((a, b) => b.commit.datum.localeCompare(a.commit.datum)),
    }));
    return liste.sort((a, b) =>
        a.id === "sonstiges"
            ? 1
            : b.id === "sonstiges"
              ? -1
              : (b.zeilen[0]?.commit.datum ?? "").localeCompare(a.zeilen[0]?.commit.datum ?? ""),
    );
}

// --- Kurzinfo (`<stamm>.md`) ---

/**
 * Die Abschnitte der Kurzinfo. „Neu“ und „Achtung“ kommen seit 2026-10-17 aus den Commits selbst (AGENTS.md: jeder feat/fix-Commit sagt
 * mit `Neu:` und `Achtung:`, was neu ist; `neuerungenAlsKurzinfo`); die drei übrigen aus einer geschriebenen `<stamm>.md`.
 */
export const KURZINFO_ABSCHNITTE = ["Neu", "Anschauen", "Prüfen", "Achtung", "Beachten"] as const;
export type KurzinfoAbschnittTitel = (typeof KURZINFO_ABSCHNITTE)[number];

export interface KurzinfoGelesen {
    abschnitte: { titel: KurzinfoAbschnittTitel; punkte: string[] }[];
    /** Überschriften `## …`, die nicht zu den drei gehören (das Werkzeug meldet sie bei `--pruefen`). */
    fremd: string[];
}

/**
 * Liest die Kurzinfo: nur `## Anschauen`, `## Prüfen`, `## Beachten`, Punkte als Zeilen mit `- `. Kommentare `<!-- … -->` (auch über
 * mehrere Zeilen), Leerzeilen und die erste Überschrift fallen weg. Text bleibt Text: kein Markdown, kein HTML.
 */
export function kurzinfoAus(md: string): KurzinfoGelesen {
    const ohneKommentare = md.replace(/<!--[\s\S]*?-->/gu, "");
    const abschnitte: KurzinfoGelesen["abschnitte"] = [];
    const fremd: string[] = [];
    let aktuell: KurzinfoGelesen["abschnitte"][number] | null = null;
    for (const roh of ohneKommentare.split(/\r?\n/u)) {
        const zeile = roh.trim();
        const ueber = /^##\s+(.+)$/u.exec(zeile);
        if (ueber !== null) {
            const titel = ueber[1]!.trim();
            if ((KURZINFO_ABSCHNITTE as readonly string[]).includes(titel)) {
                aktuell = abschnitte.find((a) => a.titel === titel) ?? null;
                if (aktuell === null) {
                    aktuell = { titel: titel as KurzinfoAbschnittTitel, punkte: [] };
                    abschnitte.push(aktuell);
                }
            } else {
                fremd.push(titel);
                aktuell = null;
            }
            continue;
        }
        const punkt = /^[-*]\s+(.+)$/u.exec(zeile);
        if (punkt !== null && aktuell !== null) aktuell.punkte.push(punkt[1]!.trim());
    }
    return {
        abschnitte: abschnitte
            .filter((a) => a.punkte.length > 0)
            .sort((a, b) => KURZINFO_ABSCHNITTE.indexOf(a.titel) - KURZINFO_ABSCHNITTE.indexOf(b.titel)),
        fremd,
    };
}

// --- Leitung ---

export const ReleaseKurz = Type.Object(
    {
        stamm: Type.String({ pattern: RELEASE_STAMM.source }),
        titel: Type.String(),
        datum: Moment,
        von: Sha,
        bis: Sha,
        /** Änderungen ohne Doku. */
        zahl: Type.Integer({ minimum: 0 }),
        doku: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type ReleaseKurz = Static<typeof ReleaseKurz>;

export const ReleaseVoll = Type.Object(
    {
        ...ReleaseKurz.properties,
        pakete: Type.Record(Type.String(), Type.String()),
        commits: Type.Array(ReleaseCommit),
    },
    strict,
);
export type ReleaseVoll = Static<typeof ReleaseVoll>;

/**
 * Wo ein Commit wirkt, grob aus seinen Dateien (WI-0255 §3e, für den Discord-Bericht wie `git show --stat` der Legacy-Routine): `karte` (was
 * Besucher der Karte sehen), `editor` (Editoren und ihre Fenster), `verwaltung` (Systemsteuerung, Neuigkeiten, Freigabe), `oberflaeche`
 * (gemeinsame Fenster, Sprachtafeln), `server`, `daten` (Migrationen, Tafeln in `config/`). Ein Anhaltspunkt, keine Entscheidung: Wer etwas
 * zu sehen bekommt, entscheidet der Bericht.
 */
export const VERLAUF_BEREICHE = ["karte", "editor", "verwaltung", "oberflaeche", "server", "daten"] as const;
export type VerlaufBereich = (typeof VERLAUF_BEREICHE)[number];
/** So lang darf die Beschreibung eines Commits im Verlauf höchstens sein. */
export const VERLAUF_BESCHREIBUNG_MAX = 800;

/** Ein Commit im Verlauf, mit dem, was die Meldung braucht. */
export const VerlaufCommit = Type.Object(
    {
        sha: Sha,
        /** Die Art aus dem Präfix (`feat`, `fix`, …), sonst `null`. */
        art: Nullable(Type.String({ maxLength: 20 })),
        /** Die erste Zeile der Nachricht. */
        titel: Type.String({ maxLength: 500 }),
        /** Die Zeilen `Neu: …` und `Achtung: …` der Beschreibung, ohne das Wort davor. */
        neu: Type.Array(Type.String({ maxLength: 600 }), { maxItems: 10 }),
        achtung: Type.Array(Type.String({ maxLength: 600 }), { maxItems: 10 }),
        /** Ändert etwas an der Anwendung, nicht nur Doku, Tests, Betrieb oder Werkzeuge. */
        anwendung: Type.Boolean(),
        /**
         * Der Rest der Beschreibung (ohne `Neu:`, `Achtung:`, Testzeilen und Trailer), gekürzt; nur bei feat und fix der Anwendung. Seit WI-0255
         * §3e, ältere Verläufe tragen es nicht.
         */
        beschreibung: Type.Optional(Type.String({ maxLength: VERLAUF_BESCHREIBUNG_MAX })),
        /** Wo der Commit wirkt (`VERLAUF_BEREICHE`), aus seinen Dateien; seit WI-0255 §3e. */
        bereich: Type.Optional(Type.Array(literals(VERLAUF_BEREICHE), { maxItems: VERLAUF_BEREICHE.length })),
    },
    strict,
);
export type VerlaufCommit = Static<typeof VerlaufCommit>;

/** Wie viele Commits der Verlauf in „Versionen“ zeigt; der Rest steht auf GitHub. */
export const VERLAUF_ANZEIGE = 100;

export const VersionenVerlauf = Type.Object(
    { bis: Sha, commits: Type.Array(VerlaufCommit, { maxItems: VERLAUF_ANZEIGE }) },
    strict,
);
export type VersionenVerlauf = Static<typeof VersionenVerlauf>;

/** `GET /api/admin/system/versionen`: das laufende Release mit Commits (die neueste Datei), die früheren nur kurz. */
export const VersionenListe = Type.Object(
    {
        /** `RELEASE_ID` des Servers (`20261011T093012Z-b7e2d41`, lokal `dev`). */
        releaseId: Type.String(),
        laufend: Nullable(ReleaseVoll),
        frueher: Type.Array(ReleaseKurz),
        /** Die jüngsten Commits des laufenden Stands aus `verlauf.json` (Bau, auch auf Stage); ohne Datei fehlt das Feld. */
        verlauf: Type.Optional(VersionenVerlauf),
    },
    strict,
);
export type VersionenListe = Static<typeof VersionenListe>;

export const VersionParams = Type.Object({ stamm: Type.String({ pattern: RELEASE_STAMM.source }) }, strict);

/**
 * `GET /api/version/kurzinfo[?seit=<sha>]`: Mit `seit` die Neuerungen zwischen dem Stand im offenen Tab und dem laufenden (Abschnitte „Neu“
 * und „Achtung“ aus dem Verlauf des Release), sonst die Kurzinfo des laufenden Release; ohne beides keine Abschnitte.
 */
export const Kurzinfo = Type.Object(
    {
        /** Datum des laufenden Release (sein Commit); ohne Release-Datei `null`. */
        stand: Nullable(Moment),
        abschnitte: Type.Array(
            Type.Object({ titel: literals(KURZINFO_ABSCHNITTE), punkte: Type.Array(Type.String()) }, strict),
        ),
        /** Das laufende Release (`RELEASE_ID`): Die Seite merkt es sich beim Start als ihren Stand. */
        release: Type.Optional(Type.String({ maxLength: 120 })),
        /** Punkte unter „Neu“, die nur die Titelzeile eines Commits sind (ohne `Neu:`): die Oberfläche kennzeichnet sie als unredigiert. */
        unredigiert: Type.Optional(Type.Array(Type.String())),
        /** Es gab mehr, als hier steht (der Tab ist älter als der Verlauf im Release oder die Liste ist gekappt). */
        mehr: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type Kurzinfo = Static<typeof Kurzinfo>;

// --- Verlauf des Release: was die Meldung „Neue Version“ zeigt (WI-0137, Betreiber 2026-10-17) ---

/** Die Datei mit dem Verlauf in `config/releases/`; `build-release.sh` schreibt sie beim Bau (`npm run release:notizen -- --verlauf`). */
export const VERLAUF_DATEI = "verlauf.json";
/** Höchstens so viele Punkte je Abschnitt; was darüber ist, sagt `mehr`. */
export const NEUERUNGEN_GRENZE = 40;

/** `config/releases/verlauf.json`: die letzten Commits bis zum Release, neueste zuerst. Geschrieben vom Werkzeug, nie von Hand. */
export const ReleaseVerlauf = Type.Object(
    { schema: Type.Literal(1), bis: Sha, commits: Type.Array(VerlaufCommit, { maxItems: 5000 }) },
    strict,
);
export type ReleaseVerlauf = Static<typeof ReleaseVerlauf>;

/** Die Zeilen `Neu: …` und `Achtung: …` aus der Beschreibung eines Commits (AGENTS.md „Geteilter Checkout und Git“, 2026-10-17). */
export function neuUndAchtung(beschreibung: string): { neu: string[]; achtung: string[] } {
    const neu: string[] = [];
    const achtung: string[] = [];
    for (const roh of beschreibung.split(/\r?\n/u)) {
        const zeile = roh.trim();
        const n = /^Neu:\s*(.+)$/u.exec(zeile);
        if (n !== null) neu.push(n[1]!.trim().slice(0, 600));
        const a = /^Achtung:\s*(.+)$/u.exec(zeile);
        if (a !== null) achtung.push(a[1]!.trim().slice(0, 600));
    }
    return { neu: neu.slice(0, 10), achtung: achtung.slice(0, 10) };
}

/** Die Art aus dem Betreff: `feat(WI-0141): …` → `feat`; ohne Präfix `null`. */
export function artAus(titel: string): string | null {
    return /^([a-z]+)(?:\([^)]*\))?!?:/u.exec(titel)?.[1] ?? null;
}

/** Der Betreff ohne Präfix: `feat(WI-0141): Legacy-Zug reiht ein` → `Legacy-Zug reiht ein`. */
export function titelOhnePraefix(titel: string): string {
    return titel.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/u, "").trim();
}

/** Der Stand im Namen eines Release: `20261017T170005Z-3ab71b9` → `3ab71b9`; ohne Stand (lokal `dev`) `null`. */
export function standAus(releaseId: string): string | null {
    return /-([0-9a-f]{7,40})$/u.exec(releaseId)?.[1] ?? null;
}

/**
 * Die Neuerungen zwischen dem Stand im offenen Tab (`seit`) und dem laufenden (`bis`), als Kurzinfo: unter „Neu“ je feat/fix-Commit der
 * Anwendung seine `Neu:`-Zeilen, ohne sie seine Titelzeile (unredigiert), unter „Achtung“ alle `Achtung:`-Zeilen; älteste zuerst, doppelte
 * nur einmal. Kennt der Verlauf `seit` nicht (der Tab ist älter), stehen alle bis `bis` da und `mehr` ist wahr. Kennt er `bis` nicht, nichts.
 */
export function neuerungenAlsKurzinfo(
    verlauf: ReleaseVerlauf,
    seit: string,
    bis: string,
): { abschnitte: Kurzinfo["abschnitte"]; unredigiert: string[]; mehr: boolean } {
    const leer = { abschnitte: [], unredigiert: [], mehr: false };
    const zwischen = commitsZwischen(verlauf, seit, bis);
    if (zwischen === null) return leer;
    const { spanne } = zwischen;
    const neu: string[] = [];
    const achtung: string[] = [];
    const unredigiert: string[] = [];
    for (const commit of spanne) {
        if (!commit.anwendung || (commit.art !== "feat" && commit.art !== "fix")) continue;
        if (commit.neu.length > 0) neu.push(...commit.neu);
        else {
            const titel = titelOhnePraefix(commit.titel);
            neu.push(titel);
            unredigiert.push(titel);
        }
        achtung.push(...commit.achtung);
    }
    const einmal = (punkte: string[]): string[] => [...new Set(punkte)];
    const n = einmal(neu);
    const a = einmal(achtung);
    const abschnitte: Kurzinfo["abschnitte"] = [];
    if (n.length > 0) abschnitte.push({ titel: "Neu", punkte: n.slice(0, NEUERUNGEN_GRENZE) });
    if (a.length > 0) abschnitte.push({ titel: "Achtung", punkte: a.slice(0, NEUERUNGEN_GRENZE) });
    return {
        abschnitte,
        unredigiert: einmal(unredigiert),
        mehr: zwischen.seitUnbekannt || n.length > NEUERUNGEN_GRENZE || a.length > NEUERUNGEN_GRENZE,
    };
}

/**
 * Die Commits zwischen zwei Ständen, älteste zuerst (`seit` selbst nicht, `bis` mit). `null`: der Verlauf kennt `bis` nicht, oder `seit` steht nicht
 * vor `bis`. Kennt er `seit` nicht (der Stand ist älter als der Verlauf), reicht die Spanne bis zum Ende des Verlaufs und `seitUnbekannt` ist wahr.
 */
function commitsZwischen(
    verlauf: ReleaseVerlauf,
    seit: string,
    bis: string,
): { spanne: VerlaufCommit[]; seitUnbekannt: boolean } | null {
    const iBis = verlauf.commits.findIndex((commit) => commit.sha.startsWith(bis));
    if (iBis < 0) return null;
    const iSeit = verlauf.commits.findIndex((commit) => commit.sha.startsWith(seit));
    if (iSeit >= 0 && iSeit <= iBis) return null;
    return { spanne: verlauf.commits.slice(iBis, iSeit < 0 ? undefined : iSeit).reverse(), seitUnbekannt: iSeit < 0 };
}

/** Ein öffentlicher Satz einer Neuerung und ob er ein neues Merkmal (`feat`) oder eine Behebung (`fix`) beschreibt. */
export interface NeuerungsSatz {
    satz: string;
    art: "feature" | "fix";
}

/**
 * Die redigierten Sätze (`Neu:`-Zeilen) zwischen zwei Ständen MIT ihrer Art (WI-0255, Discord-Bericht: Behebungen werden erzählt, nicht mit den
 * Merkmalen vermengt). Dieselbe Spanne und dieselben Commits wie `neuerungenAlsKurzinfo`: nur feat/fix der Anwendung, älteste zuerst, ein doppelter
 * Satz nur einmal (die Art des ersten gilt). Ein Commit ohne `Neu:`-Zeile liefert keinen Satz, sondern zählt in `ohneSatz` (Titel nur einmal).
 */
export function neuerungenNachArt(
    verlauf: ReleaseVerlauf,
    seit: string,
    bis: string,
): { saetze: NeuerungsSatz[]; ohneSatz: number } {
    const zwischen = commitsZwischen(verlauf, seit, bis);
    if (zwischen === null) return { saetze: [], ohneSatz: 0 };
    const saetze = new Map<string, NeuerungsSatz["art"]>();
    const ohne = new Set<string>();
    for (const commit of zwischen.spanne) {
        if (!commit.anwendung || (commit.art !== "feat" && commit.art !== "fix")) continue;
        const art = commit.art === "fix" ? "fix" : "feature";
        if (commit.neu.length === 0) ohne.add(titelOhnePraefix(commit.titel));
        for (const satz of commit.neu) if (!saetze.has(satz)) saetze.set(satz, art);
    }
    return { saetze: [...saetze].map(([satz, art]) => ({ satz, art })), ohneSatz: ohne.size };
}

/** Ein feat- oder fix-Commit der Anwendung mit allem, was der Discord-Bericht zum Auswählen und Einordnen braucht (WI-0255 §3e). */
export interface NeuerungMitKontext {
    art: NeuerungsSatz["art"];
    /** Die `Neu:`-Zeilen; leer, wenn der Commit keine trägt. */
    saetze: string[];
    /** Der Betreff ohne Präfix. */
    betreff: string;
    /** Der Scope des Präfixes (`feat(WI-0254): …` → `WI-0254`), sonst `null`: Commits mit demselben Scope gehören zu einer Sache. */
    scope: string | null;
    beschreibung: string;
    bereich: VerlaufBereich[];
}

/**
 * Wie `neuerungenNachArt`, aber je Commit und mit Betreff, Scope, Beschreibung und Bereich: dieselbe Spanne, nur feat/fix der Anwendung, älteste
 * zuerst. Commits ohne `Neu:`-Zeile stehen mit leeren `saetze` da; der Bericht entscheidet, ob er sie erzählt.
 */
export function neuerungenMitKontext(verlauf: ReleaseVerlauf, seit: string, bis: string): NeuerungMitKontext[] {
    const zwischen = commitsZwischen(verlauf, seit, bis);
    if (zwischen === null) return [];
    return zwischen.spanne
        .filter((commit) => commit.anwendung && (commit.art === "feat" || commit.art === "fix"))
        .map((commit) => ({
            art: commit.art === "fix" ? "fix" : "feature",
            saetze: commit.neu,
            betreff: titelOhnePraefix(commit.titel),
            scope: /^[a-z]+\(([^)]*)\)/u.exec(commit.titel)?.[1]?.trim() || null,
            beschreibung: commit.beschreibung ?? "",
            bereich: commit.bereich ?? [],
        }));
}
