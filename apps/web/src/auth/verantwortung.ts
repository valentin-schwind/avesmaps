import type { AdminPerson } from "@avesmaps3d/shared";

/**
 * „Verantwortlich für:“ in der Personenansicht (WI-0133, Betreiber 2026-10-10: „das allepersonen mit account für sich (und den den
 * betreibern) editiere können (betreiben können es auch ändern)“): ändern darf es ein Betreiber (`set_responsibility`) an jeder
 * Person und jede Person an sich selbst, auch ohne das Recht; alle anderen, die die Person sehen, lesen es nur. Ein aufgelöstes
 * Konto ändert niemand mehr. Der Server prüft dasselbe je Route; diese Regel steuert nur, ob „Ändern“ dasteht.
 */
export function mayEditResponsibility(
    person: Pick<AdminPerson, "self" | "status">,
    capabilities: readonly string[],
): boolean {
    return person.status !== "departed" && (person.self || capabilities.includes("set_responsibility"));
}
