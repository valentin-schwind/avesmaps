/**
 * Eine grobe Bezeichnung des Geräts für die Sitzungsliste („Firefox · Windows“), nie der ganze User-Agent: Er trüge mehr, als
 * jemand braucht, um eine eigene Sitzung wiederzuerkennen (Kap. 10.99).
 */
const BROWSERS: readonly [RegExp, string][] = [
    [/Edg\//u, "Edge"],
    [/OPR\//u, "Opera"],
    [/Firefox\//u, "Firefox"],
    [/Chrome\//u, "Chrome"],
    [/Safari\//u, "Safari"],
];

const SYSTEMS: readonly [RegExp, string][] = [
    [/Windows/u, "Windows"],
    [/iPhone|iPad|iOS/u, "iOS"],
    [/Android/u, "Android"],
    [/Mac OS X|Macintosh/u, "macOS"],
    [/Linux/u, "Linux"],
];

export function clientLabel(userAgent: string | undefined): string | undefined {
    if (userAgent === undefined || userAgent === "") return undefined;
    const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "Browser";
    const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
    return system === undefined ? browser : `${browser} · ${system}`;
}
