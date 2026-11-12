import { mkdir, mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sichereInstagramBild, type InstagramAblage } from "../src/community/social/instagram-ableitung.ts";
import { InstagramBildFehler } from "../src/community/social/instagram-bild.ts";
import { unreferencedPublished } from "../src/migration/verify-media.ts";
import {
    MediaStorageError,
    MediaStore,
    instagramKey,
    instagramWebpKey,
    publishedWebpHash,
    quarantineKey,
    sha256Of,
    storageKey,
} from "../src/media/storage.ts";

/**
 * Die Instagram-Fassung neben der veröffentlichten WebP (WI-0268 C12b): Schlüssel, Ablegen, Erzeugen (idempotent) und vor allem der Lebenszyklus. 🔴 Die Fassung ist nie länger öffentlich als ihre WebP: Quarantäne,
 * Entfernen und endgültiges Löschen der WebP nehmen sie mit; der Rückweg aus der Quarantäne holt sie NICHT zurück. Echte Dateien in einem Wegwerfordner.
 */

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const HASH = sha256Of(bytes("Wappen"));
const JPEG = bytes("ÿØÿ nur ein Platzhalter für die Fassung");

let root: string;
let store: MediaStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "avesmaps3d-media-ig-"));
    store = new MediaStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

/** Ein echtes WebP unter `published/`, damit die Ableitung etwas zu lesen hat. */
async function veroeffentliche(breite = 600, hoehe = 400): Promise<{ key: string; sha256: string }> {
    const webp = await sharp({ create: { width: breite, height: hoehe, channels: 3, background: "#3a6" } })
        .webp()
        .toBuffer();
    const stored = await store.store("published", webp, "webp");
    return { key: stored.key, sha256: stored.sha256 };
}

describe("Schlüssel der Instagram-Fassung", () => {
    it("liegt im Ordner der WebP, trägt deren Hash und endet auf .ig.jpg", () => {
        expect(instagramKey(HASH)).toBe(`published/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.ig.jpg`);
        expect(instagramKey(HASH).replace(".ig.jpg", ".webp")).toBe(storageKey("published", HASH, "webp"));
        expect(() => instagramKey("zu-kurz")).toThrow(MediaStorageError);
        expect(() => instagramKey(HASH.toUpperCase())).toThrow(MediaStorageError);
    });

    it("Hin und zurück: aus dem Schlüssel der Fassung die WebP, aus dem Schlüssel der WebP der Hash", () => {
        expect(instagramWebpKey(instagramKey(HASH))).toBe(storageKey("published", HASH, "webp"));
        expect(publishedWebpHash(storageKey("published", HASH, "webp"))).toBe(HASH);
        // Nur die kanonische Form: andere Ordner, falsche Fächer, andere Endungen sind weder das eine noch das andere.
        for (const key of [
            storageKey("master", HASH, "webp"),
            `published/sha256/zz/${HASH.slice(2, 4)}/${HASH}.webp`,
            `published/sha256/${HASH.slice(0, 2)}/xx/${HASH}.webp`,
            `published/sha256/ab/cd/${HASH}.webp`,
            `published/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.jpg`,
            `private/quarantine/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.webp`,
        ]) {
            expect(publishedWebpHash(key), key).toBeUndefined();
        }
        for (const key of [
            storageKey("published", HASH, "webp"),
            `published/sha256/ab/cd/${HASH}.ig.jpg`,
            `published/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.ig.jpeg`,
            `master/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.ig.jpg`,
        ]) {
            expect(instagramWebpKey(key), key).toBeUndefined();
        }
    });
});

describe("Ablegen", () => {
    it("legt die Fassung neben die WebP, atomar und ohne neu zu schreiben, wenn dieselben Bytes schon da liegen", async () => {
        const webp = await veroeffentliche();
        const erste = await store.storeInstagram(webp.sha256, JPEG);
        expect(erste).toMatchObject({ key: instagramKey(webp.sha256), written: true, byteSize: JPEG.byteLength });
        expect(dirname(store.pathFor(erste.key))).toBe(dirname(store.pathFor(webp.key)));
        expect(new Uint8Array(await readFile(store.pathFor(erste.key)))).toEqual(JPEG);
        const zweite = await store.storeInstagram(webp.sha256, JPEG);
        expect(zweite.written).toBe(false);
    });

    it("andere Bytes ersetzt der atomare rename; eine leere Datei wird nicht abgelegt", async () => {
        const webp = await veroeffentliche();
        await store.storeInstagram(webp.sha256, JPEG);
        const neu = bytes("ÿØÿ eine neue Fassung");
        expect((await store.storeInstagram(webp.sha256, neu)).written).toBe(true);
        expect(new Uint8Array(await readFile(store.pathFor(instagramKey(webp.sha256))))).toEqual(neu);
        await expect(store.storeInstagram(webp.sha256, new Uint8Array())).rejects.toThrow(MediaStorageError);
    });
});

describe("🔴 Lebenszyklus: nie länger öffentlich als die WebP", () => {
    it("die Quarantäne nimmt die Fassung mit; der Rückweg bringt sie NICHT zurück", async () => {
        const webp = await veroeffentliche();
        await store.storeInstagram(webp.sha256, JPEG);
        expect(await store.moveToQuarantine(webp.sha256)).toBe("moved");
        expect(await store.exists(webp.key)).toBe(false);
        expect(await store.exists(quarantineKey(webp.sha256))).toBe(true);
        expect(await store.exists(instagramKey(webp.sha256))).toBe(false);

        expect(await store.restoreFromQuarantine(webp.sha256)).toBe("moved");
        expect(await store.exists(webp.key)).toBe(true);
        expect(await store.exists(instagramKey(webp.sha256))).toBe(false);
    });

    it("gab es keine Fassung, ist das kein Fehler (Quarantäne und Rückweg wie bisher)", async () => {
        const webp = await veroeffentliche();
        expect(await store.moveToQuarantine(webp.sha256)).toBe("moved");
        expect(await store.moveToQuarantine(webp.sha256)).toBe("already");
        expect(await store.restoreFromQuarantine(webp.sha256)).toBe("moved");
        expect(await store.moveToQuarantine("f".repeat(64))).toBe("missing");
    });

    it("🔴 eine Fassung OHNE WebP (Waise) verschwindet beim nächsten Weg der WebP aus der Auslieferung", async () => {
        await store.storeInstagram(HASH, JPEG);
        expect(await store.moveToQuarantine(HASH)).toBe("missing");
        expect(await store.exists(instagramKey(HASH))).toBe(false);
    });

    it("Entfernen einer veröffentlichten WebP (Rechte weggefallen) nimmt die Fassung mit; andere Klassen lassen sie in Ruhe", async () => {
        const webp = await veroeffentliche();
        await store.storeInstagram(webp.sha256, JPEG);
        // Ein Derivat desselben Hashes ist keine veröffentlichte WebP: Die Fassung bleibt.
        const derivat = await store.store("derivative", await readFile(store.pathFor(webp.key)), "webp");
        expect(derivat.sha256).toBe(webp.sha256);
        expect(await store.remove(derivat.key)).toBe(true);
        expect(await store.exists(instagramKey(webp.sha256))).toBe(true);

        expect(await store.remove(webp.key)).toBe(true);
        expect(await store.exists(webp.key)).toBe(false);
        expect(await store.exists(instagramKey(webp.sha256))).toBe(false);
        // Noch einmal: nichts mehr da, kein Fehler.
        expect(await store.remove(webp.key)).toBe(false);
    });

    it("das endgültige Löschen eines Werks nimmt die Fassung mit, auch wenn die WebP schon fehlt", async () => {
        const webp = await veroeffentliche();
        await store.storeInstagram(webp.sha256, JPEG);
        expect(await store.removeAfterDelete(webp.key)).toBe(true);
        expect(await store.exists(instagramKey(webp.sha256))).toBe(false);
        await store.storeInstagram(webp.sha256, JPEG);
        expect(await store.removeAfterDelete(webp.key)).toBe(false);
        expect(await store.exists(instagramKey(webp.sha256))).toBe(false);
    });

    it("die Fassung allein lässt sich auch gezielt entfernen (und eine fehlende ist kein Fehler)", async () => {
        const webp = await veroeffentliche();
        expect(await store.removeInstagram(webp.sha256)).toBe(false);
        await store.storeInstagram(webp.sha256, JPEG);
        expect(await store.removeInstagram(webp.sha256)).toBe(true);
        expect(await store.exists(webp.key)).toBe(true);
    });

    it("🔴 scheitert das Entfernen der Fassung, geht die WebP trotzdem aus der Auslieferung - und der Fehler wird gemeldet", async () => {
        const webp = await veroeffentliche();
        // Unter dem Schlüssel der Fassung liegt ein Verzeichnis: Das Entfernen verweigert sich.
        await mkdir(store.pathFor(instagramKey(webp.sha256)), { recursive: true });
        const ergebnis = await store.moveToQuarantine(webp.sha256).catch((e: unknown) => e);
        expect(ergebnis).toBeInstanceOf(MediaStorageError);
        expect((ergebnis as Error).message).toBe("die Instagram-Fassung der Datei konnte nicht entfernt werden");
        expect(await store.exists(webp.key)).toBe(false);
        expect(await store.exists(quarantineKey(webp.sha256))).toBe(true);
    });
});

describe("Erzeugen (sichereInstagramBild)", () => {
    it("legt die Fassung an, aus der veröffentlichten WebP, als echtes JPEG", async () => {
        const webp = await veroeffentliche(3000, 2000);
        const fassung = await sichereInstagramBild(store, webp.key);
        expect(fassung).toEqual({ schluessel: instagramKey(webp.sha256), sha256: webp.sha256, erzeugt: true });
        const gelesen = await readFile(store.pathFor(fassung.schluessel));
        expect([...gelesen.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
        const meta = await sharp(gelesen).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1440, 960]);
    });

    it("🔴 idempotent: liegt sie schon da, wird sie genommen - nichts wird neu gerechnet oder geschrieben", async () => {
        const webp = await veroeffentliche();
        await sichereInstagramBild(store, webp.key);
        const pfad = store.pathFor(instagramKey(webp.sha256));
        const alt = new Date("2020-01-01T00:00:00Z");
        await utimes(pfad, alt, alt);
        const zweite = await sichereInstagramBild(store, webp.key);
        expect(zweite.erzeugt).toBe(false);
        expect((await stat(pfad)).mtime.getTime()).toBe(alt.getTime());
    });

    it("🔴 ohne WebP unter published/ gibt es keine Fassung - und eine alte, übrig gebliebene wird entfernt", async () => {
        const webp = await veroeffentliche();
        await sichereInstagramBild(store, webp.key);
        await store.moveToQuarantine(webp.sha256);
        // Die Fassung wurde mit der Quarantäne entfernt; sie kommt auch nicht wieder, solange die WebP draußen ist.
        await expect(sichereInstagramBild(store, webp.key)).rejects.toThrow(
            "Die veröffentlichte Fassung des Bildes liegt nicht (mehr) öffentlich vor",
        );
        expect(await store.exists(instagramKey(webp.sha256))).toBe(false);
        // Und eine Waise, die irgendwie dalag, geht beim Versuch weg.
        await store.storeInstagram(webp.sha256, JPEG);
        await expect(sichereInstagramBild(store, webp.key)).rejects.toThrow(InstagramBildFehler);
        expect(await store.exists(instagramKey(webp.sha256))).toBe(false);
    });

    it("🔴 geht die WebP zwischen Lesen und Schreiben aus der Auslieferung, bleibt die frisch geschriebene Fassung nicht öffentlich", async () => {
        const webp = await veroeffentliche();
        const dazwischen: InstagramAblage = {
            exists: (key) => store.exists(key),
            read: (key, max) => store.read(key, max),
            removeInstagram: (sha256) => store.removeInstagram(sha256),
            // Nach dem Schreiben verschwindet die WebP (eine Quarantäne, die die Fassung noch nicht sah).
            storeInstagram: async (sha256, jpeg) => {
                const stored = await store.storeInstagram(sha256, jpeg);
                await rm(store.pathFor(webp.key));
                return stored;
            },
        };
        await expect(sichereInstagramBild(dazwischen, webp.key)).rejects.toThrow(
            "Die veröffentlichte Fassung des Bildes liegt nicht (mehr) öffentlich vor",
        );
        expect(await store.exists(instagramKey(webp.sha256))).toBe(false);
    });

    it("Fehler sind kurze Sätze ohne Pfad: unlesbare Datei, kaputtes Bild, Ablegen scheitert, kein veröffentlichter Schlüssel", async () => {
        const webp = await veroeffentliche();
        const unlesbar: InstagramAblage = {
            exists: (key) => store.exists(key),
            read: () => Promise.reject(new Error(`ENOENT ${root}`)),
            removeInstagram: (sha256) => store.removeInstagram(sha256),
            storeInstagram: (sha256, jpeg) => store.storeInstagram(sha256, jpeg),
        };
        const a = await sichereInstagramBild(unlesbar, webp.key).catch((e: unknown) => e);
        expect((a as Error).message).toBe("Die Bilddatei ist nicht lesbar");
        expect((a as Error).message).not.toContain(root);

        const unschreibbar: InstagramAblage = {
            ...unlesbar,
            read: (key, max) => store.read(key, max),
            storeInstagram: () => Promise.reject(new Error(`EACCES ${root}`)),
        };
        const b = await sichereInstagramBild(unschreibbar, webp.key).catch((e: unknown) => e);
        expect((b as Error).message).toBe("Die Instagram-Fassung des Bildes konnte nicht abgelegt werden");
        expect((b as Error).message).not.toContain(root);

        // Eine "WebP", die keine ist.
        const kaputt = await store.store("published", bytes("RIFF----WEBPVP8 kein Bild"), "webp");
        const c = await sichereInstagramBild(store, kaputt.key).catch((e: unknown) => e);
        expect(c).toBeInstanceOf(InstagramBildFehler);
        expect((c as Error).message).toBe("Das Bild lässt sich nicht für Instagram aufbereiten");
        expect(await store.exists(instagramKey(kaputt.sha256))).toBe(false);

        await expect(sichereInstagramBild(store, storageKey("master", webp.sha256, "webp"))).rejects.toThrow(
            "Das Bild ist keine veröffentlichte Datei",
        );
    });

    it("liest die WebP nur bis zur Grenze (die Datei wird vor dem Lesen gemessen)", async () => {
        const webp = await veroeffentliche();
        const fehler = await sichereInstagramBild(store, webp.key, 10).catch((e: unknown) => e);
        expect(fehler).toBeInstanceOf(InstagramBildFehler);
        expect((fehler as Error).message).toBe("Die Bilddatei ist nicht lesbar");
    });
});

describe("verify:media: Waisen unter published/", () => {
    const webp = storageKey("published", HASH, "webp");
    const fassung = instagramKey(HASH);

    it("eine Instagram-Fassung neben ihrer WebP, die eine Zeile hält, ist erlaubt und kein Befund", () => {
        expect(unreferencedPublished([webp, fassung], new Set([webp]))).toEqual([]);
    });

    it("🔴 eine Fassung ohne WebP auf der Platte ist ein Waise und ein Befund", () => {
        expect(unreferencedPublished([fassung], new Set([webp]))).toEqual([fassung]);
    });

    it("🔴 eine Fassung, deren WebP keine Zeile hält, ist ein Befund (beide, die WebP selbst auch)", () => {
        expect(unreferencedPublished([webp, fassung], new Set())).toEqual([webp, fassung]);
    });

    it("eine fremde Datei bleibt ein Befund, eine Datei mit Zeile nicht; eine falsch benannte Fassung ist keine", () => {
        const fremd = `published/sha256/ab/cd/${"a".repeat(64)}.webp`;
        const falsch = `published/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.ig.jpeg`;
        expect(unreferencedPublished([webp, fremd, falsch], new Set([webp]))).toEqual([fremd, falsch]);
    });
});
