import type { StaettenGroup } from "@avesmaps3d/shared";

/** Eine Art mit ihren Namen, wie die Sektion sie liefert. */
export const staettenGroup = (type: string, ...names: string[]): StaettenGroup => ({
    type,
    entries: names.map((name) => ({ name })),
});

/** Die Antwort der Sektion: die Zahl ist die Summe der Namen, wie beim Server. */
export const staettenAnswerOf = (...groups: StaettenGroup[]): { count: number; groups: StaettenGroup[] } => ({
    count: groups.reduce((sum, entry) => sum + entry.entries.length, 0),
    groups,
});

/**
 * 🔴 **Elenvina nachgebaut** (WI-0122; gemessen 2026-10-09: 90 Stätten in 46 Arten, 30 davon mit einem Eintrag): vier Arten
 * mit mehreren Namen, sechs mit einem, 27 Stätten - also eine LANGE Zeile. Die Arten tragen die Form NACH dem Import, der das
 * Wiki-Markup abschneidet („Provinzherrliches Garderegiment (Hauptsitz)“); das Markup selbst ist Sache des Servers.
 */
export const ELENVINA_ARTIG = staettenAnswerOf(
    staettenGroup(
        "Tempel",
        "Forellentempel",
        "Goldener Falkentempel",
        "Halle des Heiligen Cereborn",
        "Phexens Hort",
        "Tempel der nächtlichen Schatten",
        "Tempel des K'Levthan",
    ),
    staettenGroup("Tempel", "Travia-Tempel", "Rondra-Tempel", "Efferd-Tempel"),
    staettenGroup(
        "Gasthaus",
        "Gasthaus Flussritter",
        "Pension Wellenblick",
        "Absteige Zum Enterhaken",
        "Gaststube Nachtklause",
        "Hotel Zum Güldenen Greifen",
        "Hotel am Triumphbogen",
        "Herberge Zur Fähre",
    ),
    staettenGroup("Garnison", "Garnison der Stadtgarde von Elenvina", "Hafenwache", "Kaserne der Pikeniere"),
    staettenGroup("Provinzherrliches Garderegiment (Hauptsitz)", "Elenviner Flussgarde", "Elenviner Garde"),
    staettenGroup("Archiv (Hauptsitz)", "Archiv der Praios-Kirche"),
    staettenGroup("Brücke", "Jast-Gorsam-Brücke"),
    staettenGroup("Gräfliches Garderegiment (Hauptsitz)", "Elenviner Gleventräger"),
    staettenGroup("Kaiserliches Garderegiment (Hauptsitz)", "Greifengarde"),
    staettenGroup("Militäreinheit (Hauptsitz)", "Schatzgarde"),
    staettenGroup("Aquädukt", "Herzog-Cusimo-Aquädukt"),
);
