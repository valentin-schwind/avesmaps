import {
    AVENTURIA_SERIES,
    KARTENSERIE_PAPIERKORB_TAGE,
    KARTENSERIEN_PRODUCTION_URL,
    KARTENSERIEN_UPLOADS_URL,
    KARTENSERIEN_URL,
    type KartenserieAuftrag,
    type KartenserieUpload,
    type AdminKartenserie,
    type AdminKartenserien,
    type KartenserieStufe,
} from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Kartenserien ohne Server (WI-0220 Schnitt 2): ein kleiner Nachbau von `GET`/`POST /api/admin/system/kartenserien` mit
 * Revision und den Regeln, die der Reiter sichtbar machen muss. Die echten Routen samt Rechten und Protokoll prüft
 * `apps/server/test/map-series.test.ts` auf einem Wegwerf-Cluster.
 */
export function kartenserienStand(): AdminKartenserien {
    const reihe = ["modern", "original", "old"];
    const serien: AdminKartenserie[] = reihe.map((id) => {
        const serie = AVENTURIA_SERIES.series.find((s) => s.id === id)!;
        return {
            serie,
            quelle: "vorgabe",
            stufe: serie.visibility === "EDITOR_ONLY" ? "editoren" : "alle",
            istVorgabe: id === "modern",
            fassung: { revision: "1d40b5257c2f", maxNativeZoom: 6 },
            // Modern hat eine vorige Fassung (Rückweg), die anderen nur die aktuelle.
            fassungen: [
                { revision: "1d40b5257c2f", aktuell: true, seit: "2026-10-18T10:00:00.000Z" },
                ...(id === "modern"
                    ? [{ revision: "0a0b0c0d0e0f", aktuell: false, seit: "2026-10-01T10:00:00.000Z" }]
                    : []),
            ],
            auftrag: null,
            uebernahme: null,
            geaendert: null,
        };
    });
    return {
        now: new Date().toISOString(),
        revision: 7,
        source: "database",
        license: AVENTURIA_SERIES.license,
        serien,
        papierkorb: [],
        platz: { freiBytes: 136 * 1024 ** 3, grenzeBytes: 20 * 1024 ** 3 },
        uploads: [],
        inArbeit: [],
        unknownKeys: [],
    };
}

export interface KartenserienServer {
    state: AdminKartenserien;
    posts: Record<string, unknown>[];
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

const fehler = (status: number, code: string) => ({ status, body: { error: { code, message: "vom Nachbau" } } });
const quittung = (operationId: unknown) => ({
    status: 200,
    body: { operationId, status: "applied", environment: "staging", affected: [], derivedWork: [], warnings: [] },
});

export function kartenserienServer(initial: AdminKartenserien = kartenserienStand()): KartenserienServer {
    const server: KartenserienServer = {
        state: structuredClone(initial),
        posts: [],
        handle(call) {
            if (call.path.startsWith(KARTENSERIEN_UPLOADS_URL)) return hochladen(call);
            if (call.path === KARTENSERIEN_PRODUCTION_URL) return uebernehmen(call);
            if (call.path !== KARTENSERIEN_URL) return undefined;
            if (call.method === "GET") return { status: 200, body: { ...server.state, now: new Date().toISOString() } };
            const body = call.body ?? {};
            server.posts.push(body);
            if (body["baseRevision"] !== server.state.revision) return fehler(409, "edit_conflict");
            const id = String(body["id"]);
            const aktion = body["aktion"] as { art: string; [k: string]: unknown };
            const eintrag = server.state.serien.find((e) => e.serie.id === id);
            if (aktion.art === "wiederherstellen") {
                const korb = server.state.papierkorb.find((p) => p.id === id);
                if (korb === undefined) return fehler(409, "no_change");
                server.state.papierkorb = server.state.papierkorb.filter((p) => p.id !== id);
                const serie = AVENTURIA_SERIES.series.find((s) => s.id === id)!;
                server.state.serien.push({
                    serie,
                    quelle: "vorgabe",
                    stufe: "alle",
                    istVorgabe: false,
                    fassung: null,
                    fassungen: [],
                    auftrag: null,
                    uebernahme: null,
                    geaendert: null,
                });
            } else if (eintrag === undefined) {
                return fehler(404, "unknown_series");
            } else if (aktion.art === "stufe") {
                const stufe = aktion["stufe"] as KartenserieStufe;
                if (stufe === "alle" && eintrag.serie.labelsInImage) return fehler(409, "labels_in_image");
                if (stufe !== "alle" && eintrag.istVorgabe) return fehler(409, "default_visible");
                eintrag.stufe = stufe;
            } else if (aktion.art === "vorgabe") {
                for (const e of server.state.serien) e.istVorgabe = e.serie.id === id;
            } else if (aktion.art === "thumb") {
                const thumb = aktion["thumb"] as { x: number; y: number } | null;
                const ohne = { ...eintrag.serie };
                delete ohne.thumb;
                eintrag.serie = thumb === null ? ohne : { ...ohne, thumb };
            } else if (aktion.art === "texte") {
                const texte = aktion["texte"] as { label?: string; description?: string };
                eintrag.serie = { ...eintrag.serie, ...texte };
            } else if (aktion.art === "papierkorb") {
                if (eintrag.istVorgabe) return fehler(409, "default_visible");
                server.state.serien = server.state.serien.filter((e) => e !== eintrag);
                const seit = new Date();
                const endgueltig = new Date(seit.getTime() + KARTENSERIE_PAPIERKORB_TAGE * 24 * 3_600_000);
                server.state.papierkorb.push({
                    id,
                    label: eintrag.serie.label,
                    seit: seit.toISOString(),
                    endgueltig: endgueltig.toISOString(),
                });
            } else if (aktion.art === "fassung") {
                const revision = String(aktion["revision"]);
                if (!eintrag.fassungen.some((x) => x.revision === revision))
                    return fehler(404, "kartenserien_fassung_fehlt");
                eintrag.fassungen = eintrag.fassungen.map((x) => ({ ...x, aktuell: x.revision === revision }));
            } else if (aktion.art === "reihe") {
                const i = server.state.serien.indexOf(eintrag);
                const j = i + (aktion["richtung"] === "hoch" ? -1 : 1);
                [server.state.serien[i], server.state.serien[j]] = [server.state.serien[j]!, server.state.serien[i]!];
            }
            server.state.revision = (server.state.revision ?? 0) + 1;
            return quittung(body["operationId"]);
        },
    };
    /** „Nach Production übernehmen“ (Schnitt 4): reiht im Nachbau nur ein; die Serie zeigt danach „wartet“. */
    function uebernehmen(call: AdminCall): { status: number; body: unknown } {
        const body = call.body ?? {};
        server.posts.push({ ...body, production: true });
        const eintrag = server.state.serien.find((e) => e.serie.id === body["id"]);
        if (eintrag === undefined) return fehler(404, "unknown_series");
        eintrag.uebernahme = {
            jobId: crypto.randomUUID(),
            state: "QUEUED",
            phase: null,
            fehler: null,
            revision: eintrag.fassung?.revision ?? "",
            seit: new Date().toISOString(),
            bis: null,
        };
        return quittung(body["operationId"]);
    }
    /** Die Upload-Routen (Schnitt 3). Ein Stück kommt im Nachbau ohne Körper an: Es zählt als „alles da“. */
    function hochladen(call: AdminCall): { status: number; body: unknown } | undefined {
        const body = call.body ?? {};
        if (call.method === "POST" && call.path === KARTENSERIEN_UPLOADS_URL) {
            server.posts.push(body);
            const upload: KartenserieUpload = {
                uploadId: crypto.randomUUID(),
                ziel: body["ziel"] as KartenserieUpload["ziel"],
                bytes: Number(body["bytes"]),
                empfangen: 0,
                kante: Number(body["kante"]),
                stueckBytes: 8 * 1024 * 1024,
                angelegt: new Date().toISOString(),
            };
            server.state.uploads.push(upload);
            return {
                status: 200,
                body: {
                    ...quittung(body["operationId"]).body,
                    affected: [{ kind: "map_series_upload", id: upload.uploadId }],
                },
            };
        }
        const id = call.path.slice(KARTENSERIEN_UPLOADS_URL.length + 1).split("/")[0];
        const upload = server.state.uploads.find((u) => u.uploadId === id);
        if (upload === undefined) return fehler(404, "kartenserien_upload_fehlt");
        if (call.method === "PUT") {
            upload.empfangen = upload.bytes;
            return { status: 200, body: { empfangen: upload.empfangen } };
        }
        if (call.method === "POST" && call.path.endsWith("/abschluss")) {
            server.posts.push({ ...body, abschluss: id });
            server.state.uploads = server.state.uploads.filter((u) => u !== upload);
            const auftrag: KartenserieAuftrag = {
                jobId: crypto.randomUUID(),
                state: "QUEUED",
                phase: null,
                progress: null,
                waitReason: null,
                fehler: null,
                art: upload.ziel.art === "neu" ? "neu" : "ersetzen",
                kante: upload.kante,
                seit: new Date().toISOString(),
            };
            if (upload.ziel.art === "neu") {
                server.state.inArbeit.push({ id: upload.ziel.id, label: upload.ziel.anlage.label, auftrag });
            } else {
                const eintrag = server.state.serien.find((e) => e.serie.id === upload.ziel.id);
                if (eintrag !== undefined) eintrag.auftrag = auftrag;
            }
            return {
                status: 200,
                body: {
                    ...quittung(body["operationId"]).body,
                    derivedWork: [{ kind: "map_series_tile", jobId: auftrag.jobId, state: "queued" }],
                },
            };
        }
        return undefined;
    }
    return server;
}
