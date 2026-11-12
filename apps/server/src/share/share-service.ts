import { canonicalSharePayload, SHARE_LIMITS, type SharePayload } from "@avesmaps3d/shared";
import { createRateLimiter, type RateLimiter } from "./rate-limiter.ts";
import { newShareCode, sharePayloadHash, type ShareStore, type StoredShare } from "./share-store.ts";

/**
 * Einen Kurzlink anlegen oder den vorhandenen finden (WI-0034).
 *
 * Die Reihenfolge ist Absicht:
 * 1. **Derselbe Zustand, derselbe Code** - auch für wen die Drossel schon gilt: Er legt nichts an.
 * 2. **Drossel je Client-IP**, wie in Legacy 40 neue Codes je Stunde.
 * 3. **Tagesbudget** über alle: Gegen viele IPs hilft die Drossel je IP nicht (Claudio).
 * 4. **Anlegen.** Zwei gleiche Anfragen zugleich ergeben eine Zeile; die zweite findet den Code der
 *    ersten. Eine Kollision des Codes selbst wird mit einem neuen Code wiederholt.
 */

export type CreateOutcome = { kind: "created" | "existing"; code: string } | { kind: "rate_limited" | "daily_budget" };

export interface ShareService {
    create(payload: SharePayload, clientKey: string): Promise<CreateOutcome>;
    read(code: string): Promise<StoredShare | undefined>;
}

export interface ShareServiceOptions {
    newCode?: () => string;
    limiter?: RateLimiter;
    dailyBudget?: number;
}

/** Bei 33^8 möglichen Codes kollidiert selten einer; fünfmal hintereinander wäre ein Fehler, kein Zufall. */
const CODE_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;

export function createShareService(store: ShareStore, options: ShareServiceOptions = {}): ShareService {
    const newCode = options.newCode ?? newShareCode;
    const limiter = options.limiter ?? createRateLimiter(SHARE_LIMITS.perIpPerHour, HOUR_MS);
    const dailyBudget = options.dailyBudget ?? SHARE_LIMITS.perDay;

    return {
        async create(payload, clientKey) {
            const canonical = canonicalSharePayload(payload);
            const hash = sharePayloadHash(canonical);
            const existing = await store.codeFor(hash);
            if (existing) return { kind: "existing", code: existing };
            if (!limiter.allows(clientKey)) return { kind: "rate_limited" };
            if ((await store.createdWithin(24)) >= dailyBudget) return { kind: "daily_budget" };

            for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
                const code = newCode();
                if (await store.insert(code, canonical, hash)) {
                    limiter.record(clientKey);
                    return { kind: "created", code };
                }
                const raced = await store.codeFor(hash);
                if (raced) return { kind: "existing", code: raced };
            }
            throw new Error(`kein freier Kurzlink-Code nach ${String(CODE_ATTEMPTS)} Versuchen`);
        },
        read: (code) => store.read(code),
    };
}
