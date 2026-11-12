// Die Verflechtung der Bereiche im Produktcode (WI-0289; Vali 2026-11-08: „ich hab angst, dass du abhängigkeiten erzeugst“).
//
// Gelesen wird der Importgraph von `apps/server/src`, `apps/web/src` und `packages/shared/src` aus Git, ohne Checkout (`leseGraph`). Ein Bereich
// ist der erste Ordner unter `src` (`server/terrain`, `web/fenster`); Dateien direkt unter `src` bilden `server/(Wurzel)` und `web/(Wurzel)`;
// `shared` ist ein Bereich. Gemessen werden:
//   - Kreise zwischen Dateien: statische Importe ohne reine Typen, denn an ihnen hängt die Ladereihenfolge;
//   - gegenseitige Bereiche: A importiert zur Laufzeit aus B und B aus A (auch nachgeladen). Die kleinere Richtung ist meist die verkehrte;
//   - Grenzübertritte: web und server greifen nie ineinander, shared nie in eine App.
// Die Zusammensetzungen (`ZUSAMMENSETZUNG`) hängen alles ein; ihre Importe zählen bei den Bereichen nicht mit, sonst wäre jeder Bereich mit
// der Wurzel gegenseitig.
//
// 🔴 Nur meldend (Betreiber 2026-10-03: „ich will keine gates, die alles blockieren, es sei denn ich habe sie definiert“): `vor-dem-push` zeigt
// die neuen Verflechtungen eines Pushs gegenüber `origin/master` als Hinweis und hält nichts an. Den Bericht über einen ganzen Stand gibt
// `node scripts/dev/verflechtung-bericht.ts [<ref>]`.
//
// 🪤 Eine Heuristik aus den Quelltexten, kein Compiler: Importe werden per Muster gefunden, Kommentare grob entfernt. Ein Bildimport
// (`./x.webp`, `?url`) ist kein Code und fällt still weg.
import { execFileSync } from "node:child_process";
import { posix } from "node:path";

export type Art = "statisch" | "spaet" | "typ";

export interface Kante {
    readonly von: string;
    readonly nach: string;
    /** `statisch`: Import zur Ladezeit; `spaet`: `import(…)`, nachgeladen; `typ`: nur Typen, verschwindet beim Übersetzen. */
    readonly art: Art;
}

export interface Graph {
    readonly dateien: readonly string[];
    readonly kanten: readonly Kante[];
}

export interface Gegenseitig {
    readonly a: string;
    readonly b: string;
    readonly ab: readonly Kante[];
    readonly ba: readonly Kante[];
}

export interface Neues {
    /** Bereichspaare, die erst jetzt gegenseitig sind, mit den Importen der Richtung, die es dazu gemacht hat. */
    readonly paare: readonly { readonly paar: Gegenseitig; readonly neueKanten: readonly Kante[] }[];
    /** Dateikreise, die es vorher nicht gab (oder die gewachsen sind). */
    readonly kreise: readonly (readonly string[])[];
    readonly grenze: readonly Kante[];
}

const QUELLE = /^(apps\/(server|web)\/src|packages\/shared\/src)\/.+\.(ts|tsx|mts|vue)$/;

/** Die Dateien, die alles zusammensetzen: Servereinstieg, App, Webeinstieg und der Nachlader der Fenster. */
export const ZUSAMMENSETZUNG: ReadonlySet<string> = new Set([
    "apps/server/src/app.ts",
    "apps/server/src/server.ts",
    "apps/web/src/main.ts",
    "apps/web/src/app.vue",
    "apps/web/src/nachladen.ts",
]);

export function istQuelle(pfad: string): boolean {
    return QUELLE.test(pfad) && !pfad.endsWith(".d.ts");
}

export function bereichVon(pfad: string): string {
    const app = /^apps\/(server|web)\/src\/(.+)$/.exec(pfad);
    if (app !== null) {
        const rest = app[2] ?? "";
        const ende = rest.indexOf("/");
        return `${app[1] ?? ""}/${ende < 0 ? "(Wurzel)" : rest.slice(0, ende)}`;
    }
    return pfad.startsWith("packages/shared/") ? "shared" : "?";
}

const STATISCH = /(?:^|[\s;}])(?:import|export)\s+(type\s+)?([^;]*?)\bfrom\s*["']([^"']+)["']/gms;
const NACKT = /(?:^|[\s;])import\s+["']([^"']+)["']/gm;
const SPAET = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const NUR_TYPEN = /^\s*\{\s*(?:type\s+[^,}]+,?\s*)+\}\s*$/;

/** Die Importe einer Datei als Spezifizierer mit Art; bei `.vue` nur die Skriptblöcke. */
export function importeAus(pfad: string, text: string): { readonly spec: string; readonly art: Art }[] {
    let t = text;
    if (pfad.endsWith(".vue")) {
        t = [...t.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "").join("\n");
    }
    t = t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
    const erg: { spec: string; art: Art }[] = [];
    for (const m of t.matchAll(STATISCH)) {
        const nurTyp = m[1] !== undefined || NUR_TYPEN.test(m[2] ?? "");
        erg.push({ spec: m[3] ?? "", art: nurTyp ? "typ" : "statisch" });
    }
    for (const m of t.matchAll(NACKT)) erg.push({ spec: m[1] ?? "", art: "statisch" });
    for (const m of t.matchAll(SPAET)) erg.push({ spec: m[1] ?? "", art: "spaet" });
    return erg;
}

/** Ziel eines Spezifizierers unter den bekannten Dateien; `undefined` für fremde Pakete und Dateien, die kein Code sind. */
export function loeseAuf(von: string, spec: string, bekannt: ReadonlySet<string>): string | undefined {
    let basis: string;
    if (spec.startsWith(".")) basis = posix.normalize(posix.join(posix.dirname(von), spec));
    else if (spec === "@avesmaps3d/shared") return "packages/shared/src/index.ts";
    else if (spec.startsWith("@avesmaps3d/shared/"))
        basis = `packages/shared/src/${spec.slice("@avesmaps3d/shared/".length)}`;
    else return undefined;
    for (const k of [
        basis,
        basis.replace(/\.js$/, ".ts"),
        `${basis}.ts`,
        `${basis}.tsx`,
        `${basis}.vue`,
        `${basis}/index.ts`,
    ]) {
        if (bekannt.has(k)) return k;
    }
    return undefined;
}

export function baueGraph(texte: ReadonlyMap<string, string>): Graph {
    const dateien = [...texte.keys()].filter(istQuelle).sort();
    const bekannt = new Set(dateien);
    const kanten: Kante[] = [];
    for (const von of dateien) {
        for (const { spec, art } of importeAus(von, texte.get(von) ?? "")) {
            const nach = loeseAuf(von, spec, bekannt);
            if (nach !== undefined && nach !== von) kanten.push({ von, nach, art });
        }
    }
    return { dateien, kanten };
}

/** Liest den Graphen eines Stands aus Git (`git ls-tree` und `git cat-file --batch`), ohne Checkout. */
export function leseGraph(ref: string, wurzel: string = process.cwd()): Graph {
    const git = (args: readonly string[], eingabe?: string): Buffer =>
        execFileSync("git", ["-C", wurzel, ...args], {
            maxBuffer: 1 << 30,
            ...(eingabe === undefined ? {} : { input: eingabe }),
        });
    const pfade = git(["ls-tree", "-r", "-z", "--name-only", ref]).toString("utf8").split("\0").filter(istQuelle);
    const roh = git(["cat-file", "--batch"], `${pfade.map((p) => `${ref}:${p}`).join("\n")}\n`);
    const texte = new Map<string, string>();
    let pos = 0;
    for (const pfad of pfade) {
        const zeilenende = roh.indexOf(10, pos);
        const kopf = roh.subarray(pos, zeilenende).toString("utf8");
        if (kopf.endsWith(" missing")) {
            pos = zeilenende + 1;
            continue;
        }
        const groesse = Number(kopf.split(" ")[2]);
        texte.set(pfad, roh.subarray(zeilenende + 1, zeilenende + 1 + groesse).toString("utf8"));
        pos = zeilenende + 1 + groesse + 1;
    }
    return baueGraph(texte);
}

/** Starke Zusammenhangskomponenten (Tarjan, ohne Rekursion). */
function komponenten(knoten: readonly string[], nachbarn: ReadonlyMap<string, readonly string[]>): string[][] {
    let zaehler = 0;
    const index = new Map<string, number>();
    const tief = new Map<string, number>();
    const aufStapel = new Set<string>();
    const stapel: string[] = [];
    const erg: string[][] = [];
    const betrete = (v: string): void => {
        index.set(v, zaehler);
        tief.set(v, zaehler);
        zaehler += 1;
        stapel.push(v);
        aufStapel.add(v);
    };
    for (const start of knoten) {
        if (index.has(start)) continue;
        betrete(start);
        const arbeit: [string, number][] = [[start, 0]];
        while (arbeit.length > 0) {
            const rahmen = arbeit[arbeit.length - 1];
            if (rahmen === undefined) break;
            const [u, i] = rahmen;
            const liste = nachbarn.get(u) ?? [];
            const w = liste[i];
            if (w !== undefined) {
                rahmen[1] = i + 1;
                if (!index.has(w)) {
                    betrete(w);
                    arbeit.push([w, 0]);
                } else if (aufStapel.has(w)) tief.set(u, Math.min(tief.get(u) ?? 0, index.get(w) ?? 0));
                continue;
            }
            arbeit.pop();
            const eltern = arbeit[arbeit.length - 1];
            if (eltern !== undefined) tief.set(eltern[0], Math.min(tief.get(eltern[0]) ?? 0, tief.get(u) ?? 0));
            if (tief.get(u) === index.get(u)) {
                const k: string[] = [];
                let x: string | undefined;
                do {
                    x = stapel.pop();
                    if (x === undefined) break;
                    aufStapel.delete(x);
                    k.push(x);
                } while (x !== u);
                erg.push(k);
            }
        }
    }
    return erg;
}

export function dateiKreise(g: Graph): string[][] {
    const nachbarn = new Map<string, string[]>();
    for (const k of g.kanten) {
        if (k.art !== "statisch") continue;
        const liste = nachbarn.get(k.von) ?? [];
        liste.push(k.nach);
        nachbarn.set(k.von, liste);
    }
    return komponenten(g.dateien, nachbarn)
        .filter((k) => k.length > 1)
        .map((k) => k.sort())
        .sort((a, b) => b.length - a.length);
}

/** Laufzeitkanten zwischen verschiedenen Bereichen, ohne die der Zusammensetzungen, je Paar „A|B“. */
function bereichsKanten(g: Graph): Map<string, Kante[]> {
    const paar = new Map<string, Kante[]>();
    for (const k of g.kanten) {
        if (k.art === "typ" || ZUSAMMENSETZUNG.has(k.von)) continue;
        const a = bereichVon(k.von);
        const b = bereichVon(k.nach);
        if (a === b) continue;
        const liste = paar.get(`${a}|${b}`) ?? [];
        liste.push(k);
        paar.set(`${a}|${b}`, liste);
    }
    return paar;
}

export function gegenseitige(g: Graph): Gegenseitig[] {
    const paar = bereichsKanten(g);
    const erg: Gegenseitig[] = [];
    for (const [schluessel, ab] of paar) {
        const [a = "", b = ""] = schluessel.split("|");
        const ba = paar.get(`${b}|${a}`);
        if (a < b && ba !== undefined) erg.push({ a, b, ab, ba });
    }
    return erg.sort((x, y) => Math.min(y.ab.length, y.ba.length) - Math.min(x.ab.length, x.ba.length));
}

const programmteil = (pfad: string): string => pfad.split("/").slice(0, 2).join("/");

export function grenzuebertritte(g: Graph): Kante[] {
    return g.kanten.filter(
        (k) => programmteil(k.von) !== programmteil(k.nach) && !k.nach.startsWith("packages/shared/"),
    );
}

const kennung = (k: Kante): string => `${k.von}|${k.nach}`;

/** Was `neu` gegenüber `alt` neu verflicht. */
export function vergleiche(alt: Graph, neu: Graph): Neues {
    const alteRichtungen = bereichsKanten(alt);
    const altePaare = new Set(gegenseitige(alt).map((p) => `${p.a}|${p.b}`));
    const paare = gegenseitige(neu)
        .filter((p) => !altePaare.has(`${p.a}|${p.b}`))
        .map((paar) => {
            // Auslöser ist die Richtung, die es vorher nicht gab; gab es keine von beiden, die kleinere.
            const abAlt = alteRichtungen.has(`${paar.a}|${paar.b}`);
            const baAlt = alteRichtungen.has(`${paar.b}|${paar.a}`);
            const kleiner = paar.ab.length <= paar.ba.length ? paar.ab : paar.ba;
            const ausloeser = abAlt && !baAlt ? paar.ba : baAlt && !abAlt ? paar.ab : kleiner;
            return { paar, neueKanten: [...ausloeser] };
        });
    const alteKreise = dateiKreise(alt).map((k) => new Set(k));
    const kreise = dateiKreise(neu).filter((k) => !alteKreise.some((alter) => k.every((d) => alter.has(d))));
    const alteGrenze = new Set(grenzuebertritte(alt).map(kennung));
    const grenze = grenzuebertritte(neu).filter((k) => !alteGrenze.has(kennung(k)));
    return { paare, kreise, grenze };
}

export function anzahlNeu(n: Neues): number {
    return n.paare.length + n.kreise.length + n.grenze.length;
}

const kurz = (pfad: string): string => pfad.replace(/^apps\//, "");

/** Die Zeilen für `vor-dem-push`: je neue Verflechtung eine Zeile mit den Importen, die sie gemacht haben. */
export function hinweisZeilen(n: Neues): string[] {
    if (anzahlNeu(n) === 0)
        return ["nichts Neues: keine neue gegenseitige Abhängigkeit, kein neuer Dateikreis, kein Grenzübertritt."];
    const zeilen: string[] = [];
    for (const { paar, neueKanten } of n.paare) {
        const importe = neueKanten
            .slice(0, 3)
            .map((k) => `${kurz(k.von)} → ${kurz(k.nach)}`)
            .join(" · ");
        const mehr = neueKanten.length > 3 ? ` (und ${String(neueKanten.length - 3)} weitere)` : "";
        zeilen.push(
            `⚠ neu gegenseitig: ${paar.a} ⇄ ${paar.b} (${String(paar.ab.length)} / ${String(paar.ba.length)} Importe), durch ${importe}${mehr}`,
        );
    }
    for (const k of n.kreise)
        zeilen.push(`⚠ neuer Dateikreis aus ${String(k.length)} Dateien: ${k.slice(0, 4).map(kurz).join(", ")}`);
    for (const k of n.grenze) zeilen.push(`⚠ neuer Grenzübertritt: ${k.von} → ${k.nach}`);
    return zeilen;
}

/** Der Bericht über einen ganzen Stand, für `verflechtung-bericht.ts`. */
export function berichtZeilen(g: Graph, ref: string): string[] {
    const zaehle = (art: Art): number => g.kanten.filter((k) => k.art === art).length;
    const kreise = dateiKreise(g);
    const paare = gegenseitige(g);
    const schwach = paare.filter((p) => Math.min(p.ab.length, p.ba.length) <= 2).length;
    const grenze = grenzuebertritte(g);
    const zeilen = [
        `# Verflechtung auf ${ref}`,
        "",
        `Dateien: ${String(g.dateien.length)} · Importe: ${String(g.kanten.length)} (statisch ${String(zaehle("statisch"))}, nachgeladen ${String(zaehle("spaet"))}, nur Typen ${String(zaehle("typ"))})`,
        `Dateikreise: ${String(kreise.length)} · gegenseitige Bereichspaare: ${String(paare.length)}, davon ${String(schwach)} mit höchstens zwei Importen in der kleineren Richtung · Grenzübertritte: ${String(grenze.length)}`,
        "",
        "## Dateikreise",
        ...kreise.map((k) => `- ${String(k.length)} Dateien: ${k.map(kurz).join(", ")}`),
        "",
        "## Gegenseitige Bereiche (Importe je Richtung; die kleinere Richtung ist meist die verkehrte)",
    ];
    for (const p of paare) {
        const [kleiner, name] = p.ab.length <= p.ba.length ? [p.ab, `${p.a} → ${p.b}`] : [p.ba, `${p.b} → ${p.a}`];
        const beispiel = [...new Set(kleiner.map((k) => `${kurz(k.von)} → ${kurz(k.nach)}`))].slice(0, 2).join(" · ");
        zeilen.push(
            `- ${p.a} ⇄ ${p.b}: ${String(p.ab.length)} / ${String(p.ba.length)} · kleinere Richtung ${name}: ${beispiel}`,
        );
    }
    zeilen.push("", "## Grenzübertritte", ...grenze.map((k) => `- ${k.von} → ${k.nach}`));
    return zeilen;
}
