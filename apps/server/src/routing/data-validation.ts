import type { RouteNetwork } from "./network.ts";

/**
 * Die Prüfung vor der Aktivierung eines neuen Datenstands (Hardening Review M6; Kap. 6.15: „Validation“ vor der
 * „atomic activation“). Sie ist bewusst klein: Sie fängt den Stand, mit dem der Worker keine einzige Route
 * beantworten könnte, etwa ein halb importiertes Netz. Wie viele Orte oder Wege „richtig“ sind, ist keine
 * Frage dieser Prüfung - ein Vergleich mit dem alten Stand würde eine echte Massenlöschung des Editors abweisen
 * und den Worker auf alten Daten festhalten.
 *
 * Schlägt sie fehl, bleibt der alte Stand aktiv, und der Dienst meldet den Fehler (`onReloadError`).
 */
export class RoutingDataInvalid extends Error {
    override readonly name = "RoutingDataInvalid";
}

/**
 * Die Mängel eines Netzes, leer wenn es brauchbar ist:
 *
 * - **Knoten und Kanten größer null** (der Kern des Auftrags): ohne sie gibt es keine Route.
 * - **Mindestens ein Ort.** Wegpunkte einer Anfrage sind Orte (`kind === "place"`); ein Netz nur aus technischen Knoten
 *   beantwortet jede Anfrage mit „unbekannter Wegpunkt“. So sieht ein Stand aus, dessen Orte noch nicht importiert sind.
 * - **Jede Kante verbindet zwei bekannte Knoten.** Der Graphbau und die Suche schlagen die Enden nach; ein Ende
 *   ohne Knoten wäre ein Fehler mitten in einer Anfrage statt beim Laden. Das kostet einen Durchlauf über die Kanten.
 */
export function networkProblems(network: RouteNetwork): string[] {
    const problems: string[] = [];
    if (network.nodes.size === 0) problems.push("keine Knoten");
    if (network.links.length === 0) problems.push("keine Kanten");
    if (network.nodes.size > 0 && !hasPlace(network)) problems.push("keine Orte");
    const dangling = network.links.filter((link) => !network.nodes.has(link.from) || !network.nodes.has(link.to));
    if (dangling.length > 0) problems.push(`${String(dangling.length)} Kanten mit unbekanntem Ende`);
    return problems;
}

function hasPlace(network: RouteNetwork): boolean {
    for (const node of network.nodes.values()) {
        if (node.kind === "place") return true;
    }
    return false;
}

/** Wirft `RoutingDataInvalid`, wenn das Netz unbrauchbar ist; die Meldung nennt Mängel und Größe. */
export function assertUsableNetwork(network: RouteNetwork): void {
    const problems = networkProblems(network);
    if (problems.length === 0) return;
    throw new RoutingDataInvalid(
        `Routingdaten unbrauchbar (${problems.join(", ")}; ${String(network.nodes.size)} Knoten, ${String(network.links.length)} Kanten)`,
    );
}
