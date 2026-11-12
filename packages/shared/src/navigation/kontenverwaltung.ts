import type { NavTafel } from "./navigation.ts";

/**
 * Die Tafel der Kontenverwaltung (WI-0127 SYS-15, SYS-0001 §9d.1). Betreiber 2026-10-10, wörtlich: „Das Fenster „Verwaltung …“ wird
 * geteilt. Kontenverwaltung: Personen, Einladungen, Rollen & Rechte, Sitzungen, Konto auflösen.“ Dazu: „Am besten als Änderung der
 * Zuordnung, ohne Umbau. Rechte bleiben je Funktion am Server.“
 *
 * - Die Einträge, ihre Kennungen und ihre Rechte sind die von vorher (bis SYS-15 in `SYSTEMSTEUERUNG`); Sitzungen beenden und Konto
 *   auflösen stehen in „Personen“.
 * - Das Protokoll ist eines (`avesmaps_auth.security_event`); hier zeigt es die Konten-Ereignisse (`protokoll`, Filter Konten), die
 *   Systemsteuerung die System-Ereignisse (`protokoll-system`). Die Kennungen sind über beide Tafeln eindeutig.
 */
export const KONTENVERWALTUNG = {
    id: "kontenverwaltung",
    wurzel: "schiene",
    eintraege: [
        { id: "bereich-personen", unter: null, art: "bereich", rechte: [], kinder: "schiene" },
        { id: "personen", unter: "bereich-personen", art: "ansicht", rechte: ["manage_people"] },
        { id: "einladungen", unter: "bereich-personen", art: "ansicht", rechte: ["manage_invitations"] },
        { id: "rollen", unter: "bereich-personen", art: "ansicht", rechte: ["assign_roles"] },
        { id: "sonderrollen", unter: "bereich-personen", art: "ansicht", rechte: ["assign_roles"] },
        { id: "protokoll", unter: "bereich-personen", art: "ansicht", rechte: ["read_audit"] },
    ],
} as const satisfies NavTafel;
