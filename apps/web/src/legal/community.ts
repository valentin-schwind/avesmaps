/**
 * Die Kanäle der Avesmaps-Community in „Hinweise“ (WI-0045 Stufe B; Legacy `index.html` `.legal-action`).
 *
 * - Discord trägt den beschrifteten Knopf, die übrigen stehen als Zeichen daneben (Legacy: „die
 *   Einladung, in der geredet wird, wiegt mehr als die zum Zuschauen“). Ein weiterer Kanal ist ein
 *   Eintrag hier, keine neue Kachel.
 * - 🔴 Die Namen sind Eigennamen und werden nicht übersetzt; sie benennen die Zeichen für Vorleser.
 * - ⚠️ Mastodon trägt `rel="me"`: die Hälfte der Verknüpfung, die auf UNSERER Seite steht (Legacy).
 */

export type KanalId = "instagram" | "facebook" | "mastodon";

export interface Kanal {
    id: KanalId;
    name: string;
    ziel: string;
    rel: string;
}

export const DISCORD_EINLADUNG = "https://discord.gg/BSHEEpn6UX";

export const KANAELE: readonly Kanal[] = [
    { id: "instagram", name: "Instagram", ziel: "https://www.instagram.com/avesmaps/", rel: "noopener noreferrer" },
    { id: "facebook", name: "Facebook", ziel: "https://www.facebook.com/avesmaps", rel: "noopener noreferrer" },
    { id: "mastodon", name: "Mastodon", ziel: "https://rollenspiel.social/@Avesmaps", rel: "me noopener noreferrer" },
];
