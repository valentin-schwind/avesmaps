/**
 * Der Commit-Wächter (WI-0185).
 *
 * Der Betreiber wählte am 2026-10-16 auf die Frage „Soll ein Werkzeug solche Commits künftig für alle Sitzungen verweigern?“
 * die Antwort „Ja, ab jetzt immer“: Ein Werkzeug verweigert jeden Commit, der eine Datei mit einem Stand ändert, den andere auf
 * `origin/master` schon geändert haben. Anlass: Dreimal in zwei Tagen hat eine Sitzung im gemeinsamen Checkout eine Datei aus
 * einem alten Stand committet und damit fremde Zeilen gelöscht, zuletzt `e232c9eb` (fünf Schemata aus
 * `packages/shared/src/index.ts`, master fast fünf Stunden rot).
 *
 * Die Regel in einem Satz: Hat `origin/master` eine der Dateien, die dieser Commit berührt, geändert, seit HEAD und
 * `origin/master` auseinanderliefen (ihre gemeinsame Basis), dann ist der Stand der Datei hier älter als auf origin, und der
 * Commit wird verweigert.
 *
 * - Geprüft wird gegen `origin/master`, wie es zuletzt geholt wurde. Der Wächter holt nicht selbst; alle Arbeitskopien teilen
 *   dieselbe Referenz, sie ist meist frisch.
 * - Er lässt durch: keinen Vorgänger (erster Commit), kein `origin/master`, keine gemeinsame Basis, einen abschließenden Merge
 *   (`MERGE_HEAD`), und jeden Commit, dessen Basis `origin/master` schon enthält.
 * - Er hält keinen Import, keine Ableitung und keine Prüfung an, nur diesen einen Commit (AGENTS.md, „Blockierende Prüfungen im
 *   Betrieb“, gilt nicht für Werkzeuge der Entwicklung).
 *
 * Aufgerufen von `scripts/git-hooks/pre-commit` über `commit-waechter-cli.ts`; eingerichtet mit `git config core.hooksPath …` (AGENTS.md, „Geteilter Checkout
 * und Git“).
 */
import { spawnSync } from "node:child_process";

export const UPSTREAM = "origin/master";

interface GitResult {
    status: number;
    stdout: string;
}

function git(args: readonly string[]): GitResult {
    const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function nulListe(text: string): string[] {
    return text.split("\0").filter((teil) => teil.length > 0);
}

export interface Pruefung {
    /** Dateien dieses Commits, die origin seit der gemeinsamen Basis geändert hat. Leer heißt: durchlassen. */
    veraltet: string[];
    basis?: string;
    grund?: string;
}

export function pruefe(): Pruefung {
    if (git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status === 0) return { veraltet: [], grund: "merge" };
    const head = git(["rev-parse", "-q", "--verify", "HEAD"]);
    if (head.status !== 0) return { veraltet: [], grund: "kein_head" };
    const upstream = git(["rev-parse", "-q", "--verify", UPSTREAM]);
    if (upstream.status !== 0) return { veraltet: [], grund: "kein_upstream" };
    const basis = git(["merge-base", "HEAD", UPSTREAM]);
    if (basis.status !== 0) return { veraltet: [], grund: "keine_basis" };
    const basisSha = basis.stdout.trim();
    if (basisSha === upstream.stdout.trim()) return { veraltet: [], basis: basisSha, grund: "aktuell" };

    const pfade = nulListe(git(["diff", "--cached", "--name-only", "--no-renames", "-z"]).stdout);
    if (pfade.length === 0) return { veraltet: [], basis: basisSha, grund: "nichts_gestaget" };

    const veraltet: string[] = [];
    for (let i = 0; i < pfade.length; i += 200) {
        const stueck = pfade.slice(i, i + 200);
        const geaendert = git(["diff", "--name-only", "--no-renames", "-z", basisSha, UPSTREAM, "--", ...stueck]);
        veraltet.push(...nulListe(geaendert.stdout));
    }
    return { veraltet: [...new Set(veraltet)].sort(), basis: basisSha };
}

export function meldung(pruefung: Pruefung): string {
    const kurz = (pruefung.basis ?? "").slice(0, 8);
    return [
        "Commit-Wächter (WI-0185): Commit verweigert.",
        "",
        `Diese Dateien hat jemand auf ${UPSTREAM} geändert, seit dein Stand (Basis ${kurz}) geholt wurde.`,
        "Dein Commit würde sie mit einem älteren Stand überschreiben:",
        ...pruefung.veraltet.map((pfad) => `  - ${pfad}`),
        "",
        "So geht es weiter (AGENTS.md, „Geteilter Checkout und Git“):",
        "  - In einer eigenen Arbeitskopie: `git fetch`, `git rebase --autostash origin/master`, dann neu committen.",
        "  - Im gemeinsamen Checkout: nicht zurückschreiben. Eigene Arbeitskopie auf origin/master anlegen",
        "    (`git worktree add --detach .claude/worktrees/<name> origin/master`), die eigene Änderung dort einspielen",
        "    und dort committen.",
        "Den Wächter mit `--no-verify` zu umgehen ist verboten.",
    ].join("\n");
}
