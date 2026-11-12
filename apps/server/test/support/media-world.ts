import type { Database } from "../../src/database.ts";
import { importMedia } from "../../src/migration/media-import.ts";
import { animatedGif, patternImage } from "./media-fixtures.ts";
import {
    coatPng,
    coatSvg,
    coverJpeg,
    createWorkspace,
    mapPng,
    settlementImage,
    svgWithText,
    type Workspace,
} from "./media-files-fixture.ts";
import { cleanLegacyMedia, insertSubjects, manifestOf, subjectId, type ItemSpec } from "./media-import-fixture.ts";

/**
 * Eine kleine Welt für die Tests des Binärimports und des Prüfers (WI-0063 MEDIA-M9 und M10): Fachobjekte mit Legacy-Kennung, ein
 * Manifest in der Form von Export B und je Eintrag eine selbst erzeugte Datei (oder keine, oder eine, die abgewiesen wird). Jeder
 * Fall nennt, was nach dem Binärimport gelten muss.
 */

export const place = (n: number): string => subjectId("place", n);
export const territory = (n: number): string => subjectId("territory", n);
export const adventure = (n: number): string => subjectId("adventure", n);
export const citymap = (n: number): string => subjectId("citymap", n);

export interface WorldCase {
    name: string;
    spec: ItemSpec;
    /** Die Datei im Download-Fach; `null`: keine (fehlt). */
    file: (() => Promise<{ bytes: Uint8Array; extension: string }>) | null;
    /** Nach dem Binärimport. */
    state: "ok" | "missing_file" | "decode_failed" | "unsupported_format";
    published: boolean;
}

const asWebp = async (bytes: Promise<Buffer>) => ({ bytes: await bytes, extension: "webp" });
const asPng = async (bytes: Promise<Buffer>) => ({ bytes: await bytes, extension: "png" });

export const CASES: readonly WorldCase[] = [
    // Ortsbilder: die Galerie von Ort 1 (Einstufung, Vorgabe, cc_by), ein Bild an Ort 2, eines ohne Datei.
    {
        name: "ortsbild-asserted",
        spec: {
            cls: "settlement_image",
            subject: place(1),
            url: "/uploads/siedlungen/p1/a.webp",
            sort: 0,
            code: "ai_generated",
            priv: {
                uploaded_by: "thomas",
                note: "Prompt: Hafen bei Nacht, geheim",
                uploaded_at: "2026-09-02T10:00:00Z",
            },
        },
        file: () => asWebp(settlementImage(1)),
        state: "ok",
        published: true,
    },
    {
        name: "ortsbild-vorgabe",
        spec: { cls: "settlement_image", subject: place(1), url: "/uploads/siedlungen/p1/b.webp", sort: 1, code: null },
        file: () => asWebp(settlementImage(2)),
        state: "ok",
        published: true,
    },
    {
        name: "ortsbild-ccby",
        spec: {
            cls: "settlement_image",
            subject: place(1),
            url: "/uploads/siedlungen/p1/c.webp",
            sort: 2,
            code: "cc_by",
            public: false,
        },
        file: () => asWebp(settlementImage(3)),
        state: "ok",
        published: false,
    },
    {
        name: "ortsbild-fehlt",
        spec: {
            cls: "settlement_image",
            subject: place(2),
            url: "/uploads/siedlungen/p2/gone.webp",
            sort: 0,
            code: null,
        },
        file: null,
        state: "missing_file",
        published: false,
    },
    // Wappen.
    {
        name: "ortswappen-png",
        spec: {
            cls: "settlement_coat",
            subject: place(2),
            url: "/uploads/wappen/wiki/p2.png",
            code: "public_domain",
            origin: "wiki_localized",
        },
        file: () => asPng(coatPng(4)),
        state: "ok",
        published: true,
    },
    {
        name: "ortswappen-svg",
        spec: {
            cls: "settlement_coat",
            subject: place(3),
            url: "/uploads/wappen/cache/p3.svg",
            code: "public_domain",
            origin: "wiki_localized",
        },
        file: async () => ({ bytes: coatSvg(5), extension: "svg" }),
        state: "ok",
        published: true,
    },
    {
        name: "gebietswappen-png",
        spec: {
            cls: "territory_coat",
            subject: territory(1),
            url: "/uploads/wappen/t1-custom.png",
            code: "ai_generated",
            origin: "custom",
        },
        file: () => asPng(coatPng(6, 200)),
        state: "ok",
        published: true,
    },
    {
        name: "gebietswappen-gif",
        spec: {
            cls: "territory_coat",
            subject: territory(2),
            url: "/uploads/wappen/t2.gif",
            code: "public_domain",
            origin: "wiki_localized",
        },
        file: async () => ({ bytes: await animatedGif(3, patternImage(32, 32)), extension: "gif" }),
        state: "unsupported_format",
        published: false,
    },
    {
        name: "gebietswappen-svgtext",
        spec: {
            cls: "territory_coat",
            subject: territory(3),
            url: "/uploads/wappen/t3.svg",
            code: "public_domain",
            origin: "wiki_localized",
        },
        file: async () => ({ bytes: svgWithText(), extension: "svg" }),
        state: "unsupported_format",
        published: false,
    },
    // Karten und Cover.
    {
        name: "karte-voll",
        spec: {
            cls: "citymap_full",
            subject: citymap(1),
            url: "/uploads/kartensammlungen/m1/full.png",
            // Gemeinfrei, damit der Weg der Vollkarte (Pixel erhalten) veröffentlicht und geprüft wird: Ein „eigenes Werk“ aus Legacy trägt
            // seit dem Betreiber 2026-10-11 („13: B!“) nicht mehr von selbst (media-policy.test.ts).
            code: "public_domain",
        },
        file: () => asPng(mapPng(7)),
        state: "ok",
        published: true,
    },
    {
        name: "karte-vorschau",
        spec: {
            cls: "citymap_preview",
            subject: citymap(1),
            url: "/uploads/kartensammlungen/m1/thumb.webp",
            code: "permission_granted",
            origin: "autoget",
        },
        file: () => asWebp(settlementImage(8)),
        state: "ok",
        published: true,
    },
    {
        name: "cover-fan",
        spec: {
            cls: "literature_cover",
            subject: adventure(1),
            url: "/uploads/questcovers/w1.jpg",
            code: "permission_granted",
            origin: "wiki_sync",
        },
        file: async () => ({ bytes: await coverJpeg(9), extension: "jpg" }),
        state: "ok",
        published: true,
    },
    {
        name: "cover-unbekannt",
        spec: {
            cls: "literature_cover",
            subject: adventure(2),
            url: "/uploads/questcovers/w2.jpg",
            code: null,
            public: false,
        },
        file: async () => ({ bytes: await coverJpeg(10), extension: "jpg" }),
        state: "ok",
        published: false,
    },
];

export const worldSpecs = (): ItemSpec[] => CASES.map((entry) => entry.spec);

/** Fachobjekte, Download-Fach und Metadatenimport: der Stand vor dem Binärimport. */
export async function buildWorld(database: Database): Promise<Workspace> {
    await cleanLegacyMedia(database);
    await insertSubjects(database, { places: [1, 2, 3], territories: [1, 2, 3], adventures: [1, 2], citymaps: [1] });
    const workspace = await createWorkspace();
    for (const entry of CASES) {
        if (entry.file === null) continue;
        const { bytes, extension } = await entry.file();
        await workspace.put(entry.spec.url as string, bytes, extension, {
            etag: `"${entry.name}"`,
            lastModified: "Thu, 16 Jul 2026 23:38:54 GMT",
        });
    }
    await workspace.reopen();
    await importMedia(database, manifestOf(worldSpecs(), "private"));
    return workspace;
}
