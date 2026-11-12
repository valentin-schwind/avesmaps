// Regeln der öffentlichen Ausgabe (WI-0303 P1, P2): welche Pfade eines Stands von Avesmaps3D in den Zweig `avesmaps3d` des öffentlichen
// Legacy-Repositorys gehen, welche Namen und Geheimnisse die Ausgabe anhalten und wie ein bekannter Fund wiedererkannt wird.
//
// 🔴 Betreiber 2026-11-10: Die Arbeitsregeln bleiben privat („Ja, privat“), die Namen Dritter der Liste in WI-0303 gehen heraus, der
// Geheimnisscan läuft mehrfach („Geheimnisscan unbedingt mehrfach“: gitleaks, trufflehog und dieser Musterscan). Ein neuer Fund hält die
// Ausgabe an (Betreiber-Gate); korrigiert wird im Quelltext von Avesmaps3D, nie erst beim Export, sonst wiche der Zweig vom echten Stand ab.
//
// Nur Daten und reine Funktionen, ohne Git und ohne Dateisystem; beides macht `ausgabe.ts`.
import { createHash } from "node:crypto";

/** Der Zweig im öffentlichen Repository (WI-0303, IMPLEMENTATION DETAIL). */
export const ZWEIG = "avesmaps3d";
export const OEFFENTLICHES_REPOSITORY = "valentin-schwind/avesmaps";

/**
 * Was aus einem Stand hinausgeht (P1): diese Ordner mit allem darunter und die Wurzeldateien, die zum Bauen und Prüfen nötig sind. Alles
 * andere bleibt privat, darunter `AGENTS.md`, `CLAUDE.md`, `docs/` außer den Schnittstellen, `ops/`, `project-control/`, `review/`, `.claude/`,
 * `.agents/` und `.github/` (ein Workflow im Zweig liefe dort bei jedem Push).
 */
export const AUSGABE_ORDNER = [
    "apps",
    "packages",
    "config",
    "tools",
    "scripts",
    "docs/schnittstellen",
    "assets/fonts",
] as const;
export const AUSGABE_DATEIEN = [
    ".gitattributes",
    ".gitignore",
    ".prettierignore",
    ".prettierrc.json",
    "eslint.config.mjs",
    "package.json",
    "package-lock.json",
    "tsconfig.base.json",
    "tsconfig.tools.json",
    "vitest.config.ts",
    "vitest.global-setup.ts",
    "vitest.setup.ts",
] as const;

/** Die Texte für Außenstehende (P5, P6): Ihr Inhalt liegt im Zweig an der Wurzel, der Ordner selbst nicht. */
export const WURZEL_TEXTE = "oeffentlich";
/** Ohne diese Dateien an der Wurzel gibt es keine Ausgabe: Lizenz, Rechte und Einstieg (P5, P6). */
export const PFLICHT_TEXTE = [
    "README.md",
    "LICENSE",
    "LEGAL.md",
    "NOTICE.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
] as const;

/** Eine Zeile aus `git ls-tree -r`: Modus, Objekt, Pfad. */
export interface BaumEintrag {
    readonly modus: string;
    readonly objekt: string;
    readonly pfad: string;
}

export interface Auswahl {
    /** Die Einträge des öffentlichen Baums mit ihrem Pfad im Zweig, sortiert. */
    readonly eintraege: readonly BaumEintrag[];
    /** Was die Ausgabe anhält: Links, Submodule, doppelte Pfade, fehlende Pflichttexte. */
    readonly fehler: readonly string[];
}

function gehtHinaus(pfad: string): boolean {
    return (
        (AUSGABE_DATEIEN as readonly string[]).includes(pfad) || AUSGABE_ORDNER.some((o) => pfad.startsWith(`${o}/`))
    );
}

/** Wählt aus allen Einträgen eines Stands den öffentlichen Baum und legt `oeffentlich/` an die Wurzel. */
export function waehleAusgabe(alle: readonly BaumEintrag[]): Auswahl {
    const fehler: string[] = [];
    const nachPfad = new Map<string, BaumEintrag>();
    for (const eintrag of alle) {
        const ziel = eintrag.pfad.startsWith(`${WURZEL_TEXTE}/`)
            ? eintrag.pfad.slice(WURZEL_TEXTE.length + 1)
            : gehtHinaus(eintrag.pfad)
              ? eintrag.pfad
              : undefined;
        if (ziel === undefined) continue;
        // Ein Link könnte aus dem Baum hinaus zeigen, ein Submodul brächte fremden Inhalt mit; beides gibt es im Bestand nur unter `ops/`.
        if (eintrag.modus === "120000") fehler.push(`symbolischer Link: ${eintrag.pfad}`);
        else if (eintrag.modus === "160000") fehler.push(`Submodul: ${eintrag.pfad}`);
        else if (nachPfad.has(ziel)) fehler.push(`doppelt im Zweig: ${ziel} (aus ${WURZEL_TEXTE}/ und aus dem Stand)`);
        else nachPfad.set(ziel, { ...eintrag, pfad: ziel });
    }
    for (const pflicht of PFLICHT_TEXTE) {
        if (!nachPfad.has(pflicht)) fehler.push(`fehlt an der Wurzel: ${pflicht} (gehört nach ${WURZEL_TEXTE}/)`);
    }
    const eintraege = [...nachPfad.values()].sort((a, b) => (a.pfad < b.pfad ? -1 : a.pfad > b.pfad ? 1 : 0));
    return { eintraege, fehler };
}

const ENV_DATEI = /(^|\/)\.env(\.[^/]+)?$/;
const SCHLUESSEL_DATEI =
    /(^|\/)(id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pgpass|\.netrc|[^/]+\.(pem|key|p12|pfx|jks|keystore))$/;
export const GROESSTE_DATEI = 50 * 1024 * 1024;

/** Pfade im fertigen Baum, die nie hinausgehen: Workflows, Umgebungsdateien außer dem Beispiel, Schlüsseldateien, zu große Dateien. */
export function pfadFehler(datei: { readonly pfad: string; readonly groesse: number }): string | undefined {
    if (datei.pfad.startsWith(".github/workflows/"))
        return `Workflow im Zweig (liefe dort bei jedem Push): ${datei.pfad}`;
    if (ENV_DATEI.test(datei.pfad) && !datei.pfad.endsWith("/.env.example") && datei.pfad !== ".env.example") {
        return `Umgebungsdatei: ${datei.pfad}`;
    }
    if (SCHLUESSEL_DATEI.test(datei.pfad)) return `Schlüssel- oder Zugangsdatei: ${datei.pfad}`;
    if (datei.groesse > GROESSTE_DATEI) return `Datei über 50 MiB: ${datei.pfad}`;
    return undefined;
}

/** Ein Treffer eines Scanners, wiedererkennbar an Werkzeug, Regel, Datei und der Kennung des Werts (nicht an der Zeile). */
export interface Fund {
    readonly werkzeug: "eigen" | "gitleaks" | "trufflehog";
    readonly regel: string;
    readonly datei: string;
    readonly zeile: number;
    readonly kennung: string;
    /** trufflehog hat den Wert beim Anbieter bestätigt: hält immer an, auch wenn er als bekannt eingetragen ist. */
    readonly bestaetigt?: boolean;
}

/** Ein geprüfter, harmloser Fund (Attrappe im Test, Schlüssel im `localStorage`, ein Name in einer festgeschriebenen Migration). */
export interface BekannterFund {
    readonly werkzeug: string;
    readonly regel: string;
    readonly datei: string;
    readonly kennung: string;
    readonly grund: string;
}

/**
 * Die Kennung eines Werts: die ersten 16 Hexzeichen seines SHA-256. Die Liste der bekannten Funde trägt so keinen Wert selbst, und eine
 * verschobene Zeile ändert nichts.
 */
export function kennungVon(wert: string): string {
    return createHash("sha256").update(wert, "utf8").digest("hex").slice(0, 16);
}

/** Setzt ein Wort aus Teilen zusammen: Stünde es hier wörtlich, fände der Musterscan diese Datei selbst. */
const teile = (...stuecke: string[]): string => stuecke.join("");

interface Muster {
    readonly regel: string;
    readonly ausdruck: RegExp;
}

/**
 * Der eigene Musterscan. Namen: die Liste der Dritten aus WI-0303 nach den Betreiberentscheiden vom 2026-11-10 („ina kramer darf als
 * einzige bleiben“, danach „dann kann "Vali" und "Thomas" bleiben.“); die Nennungen in Rechtstexten und Quellenangaben bleiben („A“) und
 * stehen deshalb nicht hier. Geheimnisse: was dieses Projekt wirklich hat (Kartenschlüssel `avk_`, Discord, GitHub, Datenbank) und was in
 * keinem Projekt hinausgehört (private Schlüssel, AWS).
 */
export const MUSTER: readonly Muster[] = [
    { regel: "name-dritter", ausdruck: new RegExp(teile("\\bNot", "tel")) },
    { regel: "name-dritter", ausdruck: new RegExp(teile("M(?:ö|oe)ll", "mann")) },
    { regel: "name-dritter", ausdruck: new RegExp(teile("Hla", "watsch")) },
    { regel: "name-dritter", ausdruck: new RegExp(teile("\\bMi", "ra\\b")) },
    // Das Monatskürzel vor einer Jahreszahl in Datumsangaben (HTTP-Kopf `last_modified`) ist kein Name.
    { regel: "name-dritter", ausdruck: new RegExp(teile("\\bJa", "n\\b(?!\\s+\\d{4})")) },
    { regel: "name-dritter", ausdruck: new RegExp(teile("ina@masto", "don\\.social")) },
    { regel: "privater-schluessel", ausdruck: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
    { regel: "github-token", ausdruck: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
    { regel: "karten-schluessel", ausdruck: /\bavk_[A-Za-z0-9_-]{20,}/ },
    { regel: "discord-webhook", ausdruck: /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{30,}/ },
    { regel: "discord-bot-token", ausdruck: /\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/ },
    { regel: "datenbank-kennwort", ausdruck: /postgres(?:ql)?:\/\/[^\s:/@"'`]+:[^\s@"'`]+@[^\s/"'`]+/ },
    { regel: "aws-schluessel", ausdruck: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
];

/** Durchsucht den Text einer Datei zeilenweise nach allen Mustern. */
export function scanneText(datei: string, text: string): Fund[] {
    const funde: Fund[] = [];
    const zeilen = text.split("\n");
    for (let i = 0; i < zeilen.length; i++) {
        const zeile = zeilen[i] ?? "";
        for (const muster of MUSTER) {
            for (const treffer of zeile.matchAll(new RegExp(muster.ausdruck.source, "g"))) {
                funde.push({
                    werkzeug: "eigen",
                    regel: muster.regel,
                    datei,
                    zeile: i + 1,
                    kennung: kennungVon(treffer[0]),
                });
            }
        }
    }
    return funde;
}

/** Der Pfad eines Scanners relativ zum Baum, mit Schrägstrichen; ein Pfad außerhalb bleibt, wie er ist (und fällt als unbekannt auf). */
export function relativZumBaum(pfad: string, baum: string): string {
    const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");
    const p = norm(pfad);
    const b = norm(baum).replace(/\/+$/, "");
    return p.startsWith(`${b}/`) ? p.slice(b.length + 1) : p;
}

/** Der JSON-Bericht von `gitleaks dir … --report-format json` (ohne `--redact`: die Kennung braucht den Wert). */
export function leseGitleaks(bericht: string, baum: string): Fund[] {
    const eintraege = JSON.parse(bericht) as readonly {
        RuleID: string;
        File: string;
        StartLine: number;
        Secret: string;
    }[];
    return eintraege.map((e) => ({
        werkzeug: "gitleaks" as const,
        regel: e.RuleID,
        datei: relativZumBaum(e.File, baum),
        zeile: e.StartLine,
        kennung: kennungVon(e.Secret),
    }));
}

interface TrufflehogZeile {
    readonly DetectorName?: string;
    readonly Verified?: boolean;
    readonly Raw?: string;
    readonly SourceMetadata?: {
        readonly Data?: { readonly Filesystem?: { readonly file?: string; readonly line?: number } };
    };
}

/** Der Bericht von `trufflehog filesystem … --json`: eine JSON-Zeile je Fund; Protokollzeilen ohne `DetectorName` zählen nicht. */
export function leseTrufflehog(bericht: string, baum: string): Fund[] {
    const funde: Fund[] = [];
    for (const zeile of bericht.split(/\r?\n/)) {
        if (!zeile.trim().startsWith("{")) continue;
        const e = JSON.parse(zeile) as TrufflehogZeile;
        if (e.DetectorName === undefined) continue;
        const ort = e.SourceMetadata?.Data?.Filesystem;
        funde.push({
            werkzeug: "trufflehog",
            regel: e.DetectorName,
            datei: relativZumBaum(ort?.file ?? "?", baum),
            zeile: ort?.line ?? 0,
            kennung: kennungVon(e.Raw ?? ""),
            bestaetigt: e.Verified === true,
        });
    }
    return funde;
}

const schluesselVon = (f: { werkzeug: string; regel: string; datei: string; kennung: string }): string =>
    `${f.werkzeug}\u0000${f.regel}\u0000${f.datei}\u0000${f.kennung}`;

export interface Abgleich {
    /** Funde, die nicht als bekannt eingetragen sind, und jeder bestätigte: Sie halten die Ausgabe an. */
    readonly neu: readonly Fund[];
    /** Eingetragene Funde, die nicht mehr vorkommen: zum Aufräumen, halten nichts an. */
    readonly ungenutzt: readonly BekannterFund[];
}

export function gleicheAb(funde: readonly Fund[], bekannte: readonly BekannterFund[]): Abgleich {
    const bekannt = new Set(bekannte.map(schluesselVon));
    const gesehen = new Set<string>();
    const neu: Fund[] = [];
    for (const fund of funde) {
        const schluessel = schluesselVon(fund);
        gesehen.add(schluessel);
        if (fund.bestaetigt === true || !bekannt.has(schluessel)) neu.push(fund);
    }
    return { neu, ungenutzt: bekannte.filter((b) => !gesehen.has(schluesselVon(b))) };
}
