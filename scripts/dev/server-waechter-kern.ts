// Entscheidungslogik des Wächters für den lokalen Fastify (`scripts/dev/server-waechter.ts`, gestartet von `npm run dev:server`).
//
// 💣 Warum nicht `node --watch`: Der Server startete unter `node --watch-path=…` mehrfach am Tag hart neu, ohne dass sich der Inhalt einer Datei
// änderte (2026-10-29: über 1.180 Neustarts, rund 12 je 15 s). Ursache: Auf dem Entwicklungsrechner gilt `DisableLastAccess = 2` (System
// verwaltet, Zugriffszeiten ENABLED), und libuv fragt unter Windows auch `FILE_NOTIFY_CHANGE_LAST_ACCESS` ab. Jedes LESEN einer Datei im Baum
// (Prettier, ESLint, `tsc`, Vitest, Git, der Virenscanner, der Suchindex) meldet darum ein `change`, und `node --watch` startet bei jedem
// `change` neu. localhost war praktisch aus, und Browsertests gegen den geteilten Server wurden zufällig rot.
//
// Dieser Teil entscheidet nur, OB ein Ereignis eine echte Änderung ist. Er kennt kein `fs.watch` und keinen Prozess: Der Baum kommt über
// `BaumZugriff` herein (im Test ein Speicherbaum), der Neustart geht über `beiNeustart` hinaus.
//
// Die Regel:
//   • Ein Ereignis ist zunächst nur ein Anstoß. Nach dem Entprellen wird der Zustand der Datei mit dem gemerkten Stand verglichen.
//   • Gleiche Änderungszeit UND Größe: nur ein Zugriff, kein Neustart (der Normalfall des Sturms, kostet ein `stat`).
//   • Zeit oder Größe anders: der Inhalt entscheidet (SHA-1). Gleicher Hash heißt „berührt“ (`touch`, Git schreibt dieselben Bytes neu):
//     kein Neustart, der Stand wird nachgeführt.
//   • Neue oder verschwundene Datei, anderer Inhalt: Neustart, genau einer je Welle von Ereignissen.
//   • Steht der Server nach einem Absturz oder einem Ende von selbst (`setzeLaeuft(false)`), genügt auch „berührt“. Sonst gäbe es nach einem
//     Fehlstart (etwa ein Pull, der ein Modul nachzieht, das noch fehlt) keinen Weg zurück, außer den Server mit der Hand zu starten:
//     `(Get-Item apps\server\src\server.ts).LastWriteTime = Get-Date` holt ihn wie bisher wieder hoch. Ein Zugriff allein reicht auch dann nicht.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface DateiMerkmal {
    readonly mtimeMs: number;
    readonly size: number;
}

export interface DateiStand extends DateiMerkmal {
    /** SHA-1 des Inhalts als Hex; leer, wenn die Datei beim Lesen nicht zu öffnen war (dann gilt sie beim nächsten Vergleich als geändert). */
    readonly hash: string;
}

export type AenderungsArt = "geaendert" | "neu" | "weg" | "beruehrt";

export interface Aenderung {
    readonly pfad: string;
    readonly art: AenderungsArt;
}

/** Der Baum, den der Wächter beobachtet. Pfade sind absolut. */
export interface BaumZugriff {
    /** Alle beobachteten Dateien (ein Durchlauf über die Verzeichnisse, ohne `stat`). */
    dateien(): readonly string[];
    /** Zeit und Größe; `undefined`, wenn der Pfad keine Datei ist (fehlt oder ist ein Verzeichnis). */
    merkmal(pfad: string): DateiMerkmal | undefined;
    /** SHA-1 des Inhalts; `undefined`, wenn die Datei nicht lesbar ist. */
    hash(pfad: string): string | undefined;
}

const UNBEOBACHTETE_ORDNER = new Set(["node_modules", ".git"]);
/** Spuren von Editoren, die eine Datei über eine Zwischendatei schreiben: kein Quelltext, nie ein Grund zum Neustart. */
const ZWISCHENDATEI = /(~|\.tmp|\.swp|\.swx)$/i;

/** Gehört der Pfad zu dem, was den Server neu startet? Geprüft werden die Pfadteile und der Dateiname, nicht der Inhalt. */
export function istBeobachtet(pfad: string): boolean {
    const teile = pfad.split(/[\\/]/);
    if (teile.some((teil) => UNBEOBACHTETE_ORDNER.has(teil))) return false;
    const name = teile[teile.length - 1] ?? "";
    return !(name.startsWith(".#") || ZWISCHENDATEI.test(name));
}

export interface AenderungswaechterOptionen {
    readonly zugriff: BaumZugriff;
    /** Stille nach dem letzten Ereignis, bevor geprüft wird (Millisekunden). */
    readonly entprellenMs: number;
    /** Genau einmal je Welle echter Änderungen, nach dem Entprellen. Der Stand ist dann schon nachgeführt. */
    readonly beiNeustart: (aenderungen: readonly Aenderung[]) => void;
    /** Ein unerwarteter Fehler beim Prüfen; der Wächter läuft weiter. */
    readonly beiFehler?: (fehler: unknown) => void;
}

export interface Aenderungswaechter {
    /** Merkt sich den Stand des ganzen Baums. Vor dem Start des Servers aufrufen, damit Stand und geladener Code übereinstimmen. */
    aufnehmen(): void;
    /** Ein Ereignis von `fs.watch`; `null`, wenn das Betriebssystem keinen Namen nennt (Überlauf des Puffers): dann wird alles verglichen. */
    ereignis(pfad: string | null): void;
    /** Läuft der Server (oder wird er gerade gestartet)? `false` nach einem Ende von selbst: Dann genügt auch ein bloßes Berühren. */
    setzeLaeuft(laeuft: boolean): void;
    schliessen(): void;
}

export function erzeugeAenderungswaechter(optionen: AenderungswaechterOptionen): Aenderungswaechter {
    const { zugriff, entprellenMs, beiNeustart } = optionen;
    const stand = new Map<string, DateiStand>();
    const wartend = new Set<string>();
    let alles = false;
    let laeuft = true;
    let geschlossen = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function aufnehmen(): void {
        stand.clear();
        for (const pfad of zugriff.dateien()) {
            const merkmal = zugriff.merkmal(pfad);
            if (merkmal === undefined) continue;
            stand.set(pfad, { ...merkmal, hash: zugriff.hash(pfad) ?? "" });
        }
    }

    /** Vergleicht, was sich gemeldet hat, mit dem Stand und führt den Stand nach. */
    function pruefe(): Aenderung[] {
        const kandidaten = new Set(wartend);
        wartend.clear();
        let struktur = alles;
        if (alles) for (const pfad of stand.keys()) kandidaten.add(pfad);
        alles = false;

        // Ein Pfad, den wir nicht kennen und der keine Datei ist, ist ein Verzeichnis (oder eine Zwischendatei, die schon wieder weg ist):
        // Dessen Inhalt meldet Windows beim Umbenennen oder Löschen nicht einzeln. Ein Durchlauf über die Namen holt Neues und Fehlendes.
        for (const pfad of kandidaten) {
            if (!stand.has(pfad) && zugriff.merkmal(pfad) === undefined) struktur = true;
        }
        if (struktur) {
            const aktuell = zugriff.dateien();
            const bekannt = new Set(aktuell);
            for (const pfad of aktuell) if (!stand.has(pfad)) kandidaten.add(pfad);
            for (const pfad of stand.keys()) if (!bekannt.has(pfad)) kandidaten.add(pfad);
        }

        const aenderungen: Aenderung[] = [];
        for (const pfad of kandidaten) {
            const alt = stand.get(pfad);
            const merkmal = zugriff.merkmal(pfad);
            if (merkmal === undefined) {
                if (alt !== undefined) {
                    stand.delete(pfad);
                    aenderungen.push({ pfad, art: "weg" });
                }
                continue;
            }
            if (alt === undefined) {
                stand.set(pfad, { ...merkmal, hash: zugriff.hash(pfad) ?? "" });
                aenderungen.push({ pfad, art: "neu" });
                continue;
            }
            // Der Normalfall des Sturms: Windows meldet den Zugriff, die Datei ist unverändert.
            if (alt.mtimeMs === merkmal.mtimeMs && alt.size === merkmal.size) continue;
            const hash = zugriff.hash(pfad);
            stand.set(pfad, { ...merkmal, hash: hash ?? "" });
            // Ein leerer Hash des alten Stands heißt „war nicht lesbar“: Das ist kein Beweis für „gleich“.
            const gleich = hash !== undefined && alt.hash !== "" && hash === alt.hash;
            aenderungen.push({ pfad, art: gleich ? "beruehrt" : "geaendert" });
        }
        return aenderungen;
    }

    function abgelaufen(): void {
        timer = undefined;
        if (geschlossen) return;
        try {
            const aenderungen = pruefe();
            const ausloeser = laeuft ? aenderungen.filter((aenderung) => aenderung.art !== "beruehrt") : aenderungen;
            if (ausloeser.length === 0) return;
            // Ab jetzt gilt der Server als (wieder) gestartet; ein Ereignis während des Neustarts löst nichts Zweites aus, solange es nichts ändert.
            laeuft = true;
            beiNeustart(ausloeser);
        } catch (fehler) {
            optionen.beiFehler?.(fehler);
        }
    }

    return {
        aufnehmen,
        ereignis(pfad) {
            if (geschlossen) return;
            if (pfad === null) alles = true;
            else if (istBeobachtet(pfad)) wartend.add(pfad);
            else return;
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(abgelaufen, entprellenMs);
        },
        setzeLaeuft(neu) {
            laeuft = neu;
        },
        schliessen() {
            geschlossen = true;
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
        },
    };
}

/** Der Baum auf der Platte: alle Dateien unter den Wurzeln, ohne `node_modules`, `.git` und Zwischendateien der Editoren. */
export function dateisystemZugriff(wurzeln: readonly string[]): BaumZugriff {
    function geh(ordner: string, aus: string[]): void {
        let eintraege;
        try {
            eintraege = readdirSync(ordner, { withFileTypes: true });
        } catch {
            return; // Verzeichnis gerade verschwunden
        }
        for (const eintrag of eintraege) {
            if (UNBEOBACHTETE_ORDNER.has(eintrag.name)) continue;
            const pfad = join(ordner, eintrag.name);
            if (eintrag.isDirectory()) geh(pfad, aus);
            else if (eintrag.isFile() && istBeobachtet(eintrag.name)) aus.push(pfad);
        }
    }
    return {
        dateien() {
            const aus: string[] = [];
            for (const wurzel of wurzeln) geh(wurzel, aus);
            return aus;
        },
        merkmal(pfad) {
            try {
                const daten = statSync(pfad, { throwIfNoEntry: false });
                return daten?.isFile() ? { mtimeMs: daten.mtimeMs, size: daten.size } : undefined;
            } catch {
                return undefined; // gesperrt oder gerade ersetzt: wie „nicht da“, der nächste Anstoß prüft erneut
            }
        },
        hash(pfad) {
            try {
                return createHash("sha1").update(readFileSync(pfad)).digest("hex");
            } catch {
                return undefined;
            }
        },
    };
}
