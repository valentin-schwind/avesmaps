// Die Production-Freigabe entsteht mit dem Start des Release-Tests (WI-0248; Vali 2026-10-26, wörtlich: „1. Wann getestet wird: WENN ICH DAS
// WILL“, „Eine Absegnung: … Nein das passiert automatisch, sobald der test grün war“).
//
//   node scripts/dev/release-freigabe.ts entscheide [--repo <pfad>] [--sha <sha40>]
//
// Liest die Notizen `refs/notes/release-auftrag` (die Freigabe) und `refs/notes/sammellauf` (das Urteil des Runners) aus den LOKALEN Verweisen
// von `--repo` (Vorgabe: das Repository dieser Datei; geholt hat sie der Aufrufer) und schreibt EINE JSON-Zeile: `zustand`, `ausliefern`, `sha`,
// `kennung`, `von`, `zeit`, `grund`. Exit 0: genau diese SHA ist jetzt auszuliefern; 2: nichts auszuliefern; 1: Fehler. Ohne `--sha` gilt die
// jüngste Freigabe (eine neue löst jede ältere ab).
//
// 🔴 Der Vertrag zwischen den beiden Seiten (Handover `2026-10-26-release-bei-gruen-automatisch-an-claudio.md`):
//   - **Die Freigabe schreibt nur der Entwicklungsrechner**, mit dem Start des Release-Tests durch einen Betreiber (Passkey, Recht
//     `release_to_production`): erste Zeile `<sha40> <ISO-Zeit UTC> auftrag RT-<Kennung des Auftrags>`, zweite `von <Anzeigename>`. Endet der
//     Auftrag ohne grünes Ergebnis (Abbruch, gescheiterter Start, rot), überschreibt er sie mit `<sha40> <ISO-Zeit UTC> abgebrochen RT-<…>` und dem
//     Grund in der zweiten Zeile. Die Zeilen mit `OPS-…` sind die früheren Nacht-Freigaben der Stage (Claudio); sie zählen hier nicht.
//   - **Ausgeliefert wird genau die SHA der Freigabe**, nie ein neuerer Stage-Stand, und nur mit gültigem grünem Nachweis Version 3 (`releaseAusNotiz`)
//     für genau diese SHA, der zu DIESEM Auftrag gehört (`auftrag` im Nachweis gleich der Kennung) oder schon vor dem Druck grün war.
//   - **Rot heißt: nichts.** Ein roter Nachweis nach dem Druck liefert nichts aus, und ein späteres Grün aus einem anderen Lauf (etwa von Hand
//     gestartet) auch nicht: Der nächste Start ist wieder die Wahl des Betreibers.
//   - **Die Freigabe ist unterschrieben** (Weg B, Vali 2026-10-31 „ok weiter gehts“; Claudio `2026-10-31-community-weg-b-antwort-an-claudia.md`):
//     dritte Zeile `sig <Base64>`, Ed25519 über die UTF-8-Bytes der ersten beiden Zeilen, mit `\n` verbunden, ohne Zeilenende danach
//     (`signaturNachricht`). Den privaten Schlüssel hat nur der Entwicklungsrechner (`release-schluessel.ts`); den öffentlichen prüft Claudios Probe
//     als root (`ops/corridor/release-freigabe.pub`). So kann keine Rolle auf dem VPS eine Freigabe erzeugen. Leser hier lesen nur die ersten
//     beiden Zeilen; eine Notiz ohne Unterschrift liefert der Korridor nicht aus.
//
// Nur Node-Bordmittel: Claudios Abholer ruft die Datei aus seinem Checkout ohne `npm install` (wie `release-notiz.ts`).
import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseAusNotiz } from "./release-nachweis.ts";

/** Der Verweis der Freigaben (derselbe wie die früheren Auftragsnotizen der Stage, WI-0248 C). */
export const FREIGABE_REF = "release-auftrag";
/** Der Verweis der Urteile des Runners. */
export const ERGEBNIS_REF = "sammellauf";
/** Die Kennung einer Freigabe: `RT-` und die öffentliche Kennung des Auftrags `release_test` der lokalen Warteschlange. */
export const KENNUNG_MUSTER = /^RT-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Der längste Anzeigename und der längste Grund in der zweiten Zeile. */
export const NAME_MAX = 80;
export const GRUND_MAX = 200;

const ZEILE =
    /^([0-9a-f]{40}) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z) (auftrag|abgebrochen) (RT-[0-9a-f-]{36})$/u;
const URTEIL = /^([0-9a-f]{40}) (\S+) (gruen|rot|offen)$/u;

export type FreigabeArt = "auftrag" | "abgebrochen";

/** Eine Freigabe, wie sie in `refs/notes/release-auftrag` steht. */
export interface Freigabe {
    readonly sha: string;
    readonly zeit: string;
    readonly art: FreigabeArt;
    readonly kennung: string;
    /** Wer freigegeben hat (Anzeigename); nur bei `auftrag`. */
    readonly von: string | null;
    /** Warum der Auftrag endete; nur bei `abgebrochen`. */
    readonly grund: string | null;
}

/** Eine Zeile für die Notiz: ohne Steuerzeichen und ohne `|` (Claudios Leser trennen Felder damit), Leerraum zusammengezogen, gekürzt. */
export function bereinigeZeile(text: string, max: number): string {
    const glatt = text
        .replace(/[\p{Cc}\p{Cf}|]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
    return glatt.length > max ? `${glatt.slice(0, max - 1)}…` : glatt;
}

/** Die Notiz einer Freigabe. Wirft bei einer unzulässigen SHA, Zeit, Kennung oder einem leeren Namen: lieber keine Notiz als eine falsche. */
export function freigabeNotiz(f: { sha: string; zeit: string; kennung: string; von: string }): string {
    const von = bereinigeZeile(f.von, NAME_MAX);
    if (von === "") throw new Error("Die Freigabe braucht den Namen der Person, die sie gab");
    const zeile = `${f.sha} ${f.zeit} auftrag ${f.kennung}`;
    if (!ZEILE.test(zeile) || !KENNUNG_MUSTER.test(f.kennung) || !Number.isFinite(Date.parse(f.zeit)))
        throw new Error(`Unzulässige Freigabe: ${zeile}`);
    return `${zeile}\nvon ${von}\n`;
}

/** Die Zeile der Unterschrift: `sig ` und die Ed25519-Signatur in Base64 (mit Auffüllung). */
export const SIGNATUR_PRAEFIX = "sig ";

/** Was unterschrieben ist: die ersten beiden Zeilen der Notiz, mit `\n` verbunden, ohne Zeilenende danach und ohne `\r`. */
export function signaturNachricht(notiz: string): string {
    const [erste = "", zweite = ""] = notiz.split("\n").map((z) => z.replace(/\r$/u, ""));
    return `${erste}\n${zweite}`;
}

/** Unterschreibt eine Freigabe (`freigabeNotiz`): dieselbe Notiz mit der dritten Zeile `sig <Base64>`. Wirft bei einem unbrauchbaren Schlüssel. */
export function unterschreibeNotiz(notiz: string, privaterSchluesselPem: string): string {
    const schluessel = createPrivateKey(privaterSchluesselPem);
    if (schluessel.asymmetricKeyType !== "ed25519") throw new Error("Der Schlüssel der Freigabe muss Ed25519 sein");
    const signatur = sign(null, Buffer.from(signaturNachricht(notiz), "utf8"), schluessel).toString("base64");
    return `${signaturNachricht(notiz)}\n${SIGNATUR_PRAEFIX}${signatur}\n`;
}

/** Stimmt die Unterschrift der Notiz zum öffentlichen Schlüssel? `false` auch ohne oder mit unlesbarer `sig`-Zeile. */
export function pruefeNotizUnterschrift(notiz: string, oeffentlicherSchluesselPem: string): boolean {
    const dritte = (notiz.split("\n")[2] ?? "").replace(/\r$/u, "");
    if (!dritte.startsWith(SIGNATUR_PRAEFIX)) return false;
    const roh = dritte.slice(SIGNATUR_PRAEFIX.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(roh)) return false;
    try {
        const schluessel = createPublicKey(oeffentlicherSchluesselPem);
        return verify(null, Buffer.from(signaturNachricht(notiz), "utf8"), schluessel, Buffer.from(roh, "base64"));
    } catch {
        return false;
    }
}

/** Die Notiz, mit der ein Auftrag ohne grünes Ergebnis endet. */
export function abbruchNotiz(f: { sha: string; zeit: string; kennung: string; grund: string }): string {
    const zeile = `${f.sha} ${f.zeit} abgebrochen ${f.kennung}`;
    if (!ZEILE.test(zeile) || !KENNUNG_MUSTER.test(f.kennung) || !Number.isFinite(Date.parse(f.zeit)))
        throw new Error(`Unzulässiger Abbruch: ${zeile}`);
    return `${zeile}\n${bereinigeZeile(f.grund, GRUND_MAX) || "abgebrochen"}\n`;
}

/**
 * Liest eine Freigabe streng: Die erste Zeile muss genau passen, und mit `objekt` (dem Commit, an dem die Notiz hängt) muss sie diesen Commit
 * nennen. Eine Freigabe ohne Namen (`von …`) ist unvollständig und zählt nicht. `undefined` für alles andere, auch für die `OPS-…`-Zeilen der Stage.
 */
export function parseFreigabe(text: string, objekt?: string): Freigabe | undefined {
    const zeilen = text.split("\n").map((z) => z.replace(/\r$/u, ""));
    const treffer = ZEILE.exec(zeilen[0] ?? "");
    if (treffer === null) return undefined;
    const [, sha, zeit, art, kennung] = treffer;
    if (sha === undefined || zeit === undefined || kennung === undefined || art === undefined) return undefined;
    if (!KENNUNG_MUSTER.test(kennung) || !Number.isFinite(Date.parse(zeit))) return undefined;
    if (objekt !== undefined && objekt !== sha) return undefined;
    const zweite = zeilen[1] ?? "";
    if (art === "auftrag") {
        const von = zweite.startsWith("von ") ? bereinigeZeile(zweite.slice(4), NAME_MAX) : "";
        if (von === "") return undefined;
        return { sha, zeit, art, kennung, von, grund: null };
    }
    return { sha, zeit, art: "abgebrochen", kennung, von: null, grund: bereinigeZeile(zweite, GRUND_MAX) || null };
}

/** Die jüngste gültige Freigabe (Auftrag oder Abbruch) unter allen Notizen; bei gleicher Zeit die größere SHA. Eine neue löst jede ältere ab. */
export function waehleFreigabe(
    notizen: readonly { readonly objekt: string; readonly text: string }[],
): Freigabe | undefined {
    let beste: Freigabe | undefined;
    for (const n of notizen) {
        const f = parseFreigabe(n.text, n.objekt);
        if (f === undefined) continue;
        const d = beste === undefined ? 1 : Date.parse(f.zeit) - Date.parse(beste.zeit);
        if (d > 0 || (d === 0 && beste !== undefined && f.sha > beste.sha)) beste = f;
    }
    return beste;
}

/**
 * Wie es um die Freigabe steht:
 * - `keine`: keine Freigabe (für diese SHA);
 * - `abgebrochen`: der Auftrag endete ohne Grün (Abbruch, gescheiterter Start, rot); `grund` sagt, warum;
 * - `wartet`: freigegeben, der Release-Test hat noch nicht begonnen;
 * - `laeuft`: der Release-Test dieser Freigabe läuft;
 * - `rot`: der Release-Test nach der Freigabe ist rot;
 * - `gruen`: grün geprüft, auszuliefern;
 * - `fremd`: grün, aber aus einem anderen Lauf als dem dieser Freigabe (nach dem Druck, ohne ihre Kennung): nichts, bis zum nächsten Start;
 * - `ungueltig`: eine grüne Zeile ohne gültigen Nachweis Version 3: nichts.
 */
export type FreigabeZustand = "keine" | "abgebrochen" | "wartet" | "laeuft" | "rot" | "gruen" | "fremd" | "ungueltig";

export interface FreigabeEntscheidung {
    readonly zustand: FreigabeZustand;
    /** Nur bei `gruen`: genau `sha` ist jetzt auszuliefern. */
    readonly ausliefern: boolean;
    readonly sha: string | null;
    readonly kennung: string | null;
    readonly von: string | null;
    /** Die Zeit der Freigabe (oder ihres Abbruchs). */
    readonly zeit: string | null;
    /** Ein Satz, ohne Pfade: warum (nicht) ausgeliefert wird. */
    readonly grund: string;
}

const ohne = (grund: string): FreigabeEntscheidung => ({
    zustand: "keine",
    ausliefern: false,
    sha: null,
    kennung: null,
    von: null,
    zeit: null,
    grund,
});

/**
 * Die Entscheidung für eine Freigabe und das Urteil des Runners zu IHRER SHA (die Notiz in `refs/notes/sammellauf` an diesem Commit, `undefined`
 * ohne Notiz). Rein: keine Uhr, kein Git. Die Regeln stehen oben im Kopf der Datei.
 */
export function entscheideFreigabe(
    freigabe: Freigabe | undefined,
    ergebnisText: string | undefined,
): FreigabeEntscheidung {
    if (freigabe === undefined) return ohne("Kein Freigabe-Auftrag.");
    const basis = { sha: freigabe.sha, kennung: freigabe.kennung, von: freigabe.von, zeit: freigabe.zeit };
    const nicht = (zustand: FreigabeZustand, grund: string): FreigabeEntscheidung => ({
        ...basis,
        zustand,
        ausliefern: false,
        grund,
    });
    if (freigabe.art === "abgebrochen")
        return nicht("abgebrochen", freigabe.grund ?? "Der Auftrag endete ohne grünes Ergebnis.");
    const zeilen = (ergebnisText ?? "").trim().split(/\r?\n/u);
    const urteil = URTEIL.exec(zeilen[0] ?? "");
    if (urteil === null || urteil[1] !== freigabe.sha)
        return nicht("wartet", "Der Release-Test hat noch nicht begonnen.");
    const urteilZeit = Date.parse(urteil[2] ?? "");
    const freigabeZeit = Date.parse(freigabe.zeit);
    const nachDemDruck = Number.isFinite(urteilZeit) && urteilZeit >= freigabeZeit;
    if (urteil[3] === "offen")
        return nachDemDruck
            ? nicht("laeuft", "Der Release-Test läuft.")
            : nicht("wartet", "Der Release-Test hat noch nicht begonnen.");
    if (urteil[3] === "rot")
        return nachDemDruck
            ? nicht("rot", `Release-Test rot: ${bereinigeZeile(zeilen[1] ?? "", GRUND_MAX) || "ohne Grund"}`)
            : nicht("wartet", "Der Release-Test hat noch nicht begonnen.");
    const nachweis = releaseAusNotiz(ergebnisText ?? "", freigabe.sha);
    if (nachweis === undefined)
        return nicht("ungueltig", "Die grüne Notiz ist kein gültiger Release-Nachweis Version 3.");
    const eigener = nachweis.auftrag === freigabe.kennung;
    const vorher = Date.parse(nachweis.ende) <= freigabeZeit;
    if (!eigener && !vorher)
        return nicht(
            "fremd",
            "Der grüne Nachweis gehört zu einem anderen Lauf als dieser Freigabe; ausgeliefert wird erst nach einem neuen Start.",
        );
    return {
        ...basis,
        zustand: "gruen",
        ausliefern: true,
        grund: eigener
            ? "Release-Test grün; genau dieser Stand wird ausgeliefert."
            : "Schon vor der Freigabe grün geprüft; genau dieser Stand wird ausgeliefert.",
    };
}

// ───────────────────────── Lesen aus einem Repository ─────────────────────────

const git = (repo: string, args: readonly string[]): string =>
    execFileSync("git", ["-C", repo, ...args], {
        encoding: "utf8",
        timeout: 60_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

/** Alle Notizen eines lokalen Verweises (`refs/notes/<ref>`): der Commit, an dem sie hängen, und ihr Text. Ohne den Verweis: keine. */
export function lokaleNotizen(repo: string, ref: string): { objekt: string; text: string }[] {
    let liste: string;
    try {
        liste = git(repo, ["notes", `--ref=${ref}`, "list"]);
    } catch {
        return [];
    }
    const aus: { objekt: string; text: string }[] = [];
    for (const zeile of liste.split("\n")) {
        const [blob, objekt] = zeile.trim().split(/\s+/u);
        if (blob === undefined || objekt === undefined || !/^[0-9a-f]{40}$/u.test(objekt)) continue;
        try {
            aus.push({ objekt, text: git(repo, ["cat-file", "-p", blob]).slice(0, 64 * 1024) });
        } catch {
            /* eine kaputte Notiz zählt nicht */
        }
    }
    return aus;
}

/** Die Notiz eines lokalen Verweises an einem Commit; `undefined` ohne Notiz. */
export function lokaleNotiz(repo: string, ref: string, sha: string): string | undefined {
    try {
        return git(repo, ["notes", `--ref=${ref}`, "show", sha]).slice(0, 64 * 1024);
    } catch {
        return undefined;
    }
}

/**
 * Die Entscheidung aus den lokalen Verweisen eines Repositorys: die jüngste Freigabe (oder die für `sha`) und das Urteil zu ihrer SHA. Holt nichts:
 * Der Aufrufer holt vorher `refs/notes/release-auftrag` und `refs/notes/sammellauf` von Origin.
 */
export function entscheideAusRepo(repo: string, sha?: string): FreigabeEntscheidung {
    const notizen = lokaleNotizen(repo, FREIGABE_REF);
    const freigabe = waehleFreigabe(sha === undefined ? notizen : notizen.filter((n) => n.objekt === sha));
    if (freigabe === undefined) return ohne("Kein Freigabe-Auftrag.");
    return entscheideFreigabe(freigabe, lokaleNotiz(repo, ERGEBNIS_REF, freigabe.sha));
}

// ───────────────────────── Aufruf ─────────────────────────

function istHauptprogramm(): boolean {
    const datei = process.argv[1];
    return datei !== undefined && pathToFileURL(resolve(datei)).href === import.meta.url;
}

if (istHauptprogramm()) {
    const argv = process.argv.slice(2);
    const wert = (name: string): string | undefined => {
        const i = argv.indexOf(name);
        const n = i >= 0 ? argv[i + 1] : undefined;
        return n !== undefined && !n.startsWith("--") ? n : undefined;
    };
    if (argv[0] !== "entscheide") {
        process.stderr.write(
            "Aufruf: node scripts/dev/release-freigabe.ts entscheide [--repo <pfad>] [--sha <sha40>]\n",
        );
        process.exitCode = 1;
    } else {
        const sha = wert("--sha");
        if (sha !== undefined && !/^[0-9a-f]{40}$/u.test(sha)) {
            process.stderr.write("--sha braucht eine vollständige SHA (40 Hexziffern)\n");
            process.exitCode = 1;
        } else {
            const repo = resolve(wert("--repo") ?? fileURLToPath(new URL("../../", import.meta.url)));
            const e = entscheideAusRepo(repo, sha);
            process.stdout.write(`${JSON.stringify(e)}\n`);
            process.exitCode = e.ausliefern ? 0 : 2;
        }
    }
}
