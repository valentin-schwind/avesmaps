import type { MessageKey } from "../i18n/i18n";

/**
 * Warum Form, Hierarchie, Gebirge und das Sprachmodul grau stehen (WI-0279, Paket 6; E1, E2, E2a, E17a): Der Grund nennt die zuständige Sonderrolle. Menüs, Reiter und Felder lesen ihn von hier;
 * die Rechte selbst prüft der Server. Admins und Betreiber haben alle vier aus ihrer Rolle und sehen ihn nie.
 */
export const GRUND_GEBIET = "sonderrollen.grund.gebiet" satisfies MessageKey;
export const GRUND_FLAECHE = "sonderrollen.grund.flaeche" satisfies MessageKey;
export const GRUND_GEBIRGE = "sonderrollen.grund.gebirge" satisfies MessageKey;
export const GRUND_SPRACHE = "sonderrollen.grund.sprache" satisfies MessageKey;
