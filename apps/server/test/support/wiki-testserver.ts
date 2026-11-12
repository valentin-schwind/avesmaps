import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Ein lokaler Testserver, der die MediaWiki-API des Wiki Aventurica gerade so weit nachspielt, wie der Transport sie braucht (WI-0253 B-1):
 * Login-Token, Anmeldung (Botpasswort), `action=query` mit Titeln, `assert=user`, die Grenze von 50 beziehungsweise 500 Titeln. Er lauscht nur
 * auf 127.0.0.1; die Tests richten den Client auf ihn. Das echte Wiki sieht nie einen Testlauf.
 *
 * Dazu die Kategorie-Abfragen des Wiki-Teils (WI-0253 C-2): `list=categorymembers` (Artikel und Unterkategorien, mit `cmcontinue`-Seiten) und `prop=categories` über Titel
 * (mit Normalisierung, Weiterleitung, fehlenden Seiten und `clcontinue`-Fortsetzung). Die Daten setzt der Test in `kategorien` und `seiten`; `grenzen` stellt ein, wie klein eine Seite
 * ist, damit schon eine kleine Fixture paginiert (an einer Fixture ohne Fortsetzung fällt ein falscher Cursor nie auf). Eine Anfragezeile über 8.190 Zeichen beantwortet er mit 414 wie Apache.
 *
 * Dazu der Text EINES Artikels (WI-0253 D-2, `prop=revisions`): Die Daten setzt der Test in `texte` (Titel → Wikitext, Revision, Zeit); eine Weiterleitung steht in `seiten` (`weiterleitung`), ein Titel
 * ohne Eintrag ist `missing`.
 *
 * `antworter` ersetzt die Standardantwort je Anfrage (Fehlerfälle: 429, 403, 200 mit `error`, kaputtes JSON …); liefert er `undefined`, gilt
 * die Standardantwort. Alle Anfragen werden mit ihrem Rumpf aufgezeichnet, damit die Tests prüfen können, was hinausging (und was nie).
 */

export const BOT_NAME = "Avesmaps@Test";
export const BOT_PASSWORT = "geheim-passwort-123";

export interface WikiAnfrage {
    methode: string;
    pfad: string;
    abfrage: URLSearchParams;
    kopf: IncomingHttpHeaders;
    /** Der Rumpf eines POST als Formular. */
    rumpf: URLSearchParams | null;
}

export interface WikiAntwort {
    status?: number;
    kopf?: Record<string, string | string[]>;
    json?: unknown;
    text?: string;
}

/** Eine Kategorie des Testwikis: ihre Artikel und ihre Unterkategorien (ohne Präfix `Kategorie:`). */
export interface TestKategorie {
    artikel: string[];
    unterkategorien?: string[];
}
/** Eine Seite des Testwikis für `prop=categories`: ihre Kategorien (ohne Präfix) und, wenn sie eine Weiterleitung ist, ihr Ziel. */
export interface TestSeite {
    kategorien: string[];
    weiterleitung?: string;
}

/** Der Text einer Seite des Testwikis für `prop=revisions`. */
export interface TestText {
    text: string;
    revid: number;
    zeit: string;
    ns?: number;
}

export interface Testwiki {
    url: string;
    kategorien: Map<string, TestKategorie>;
    seiten: Map<string, TestSeite>;
    /** Titel → Wikitext, Revision und Zeit für `prop=revisions` (Einzelartikel). */
    texte: Map<string, TestText>;
    /** Wie viele Mitglieder eine Seite von `categorymembers` trägt und wie viele Kategoriezeilen eine Antwort von `prop=categories`. */
    grenzen: { mitgliederJeSeite: number; kategorienJeAntwort: number };
    anfragen: WikiAnfrage[];
    zustand: { sitzungGueltig: boolean; apihighlimits: boolean; loginCode: string };
    antworter: ((anfrage: WikiAnfrage, nummer: number) => WikiAntwort | undefined) | null;
    schliesse(): Promise<void>;
}

function cookies(kopf: IncomingHttpHeaders): Map<string, string> {
    const karte = new Map<string, string>();
    for (const paar of (kopf.cookie ?? "").split(";")) {
        const gleich = paar.indexOf("=");
        if (gleich > 0) karte.set(paar.slice(0, gleich).trim(), paar.slice(gleich + 1).trim());
    }
    return karte;
}

export async function starteTestwiki(): Promise<Testwiki> {
    const wiki: Testwiki = {
        url: "",
        kategorien: new Map(),
        seiten: new Map(),
        texte: new Map(),
        grenzen: { mitgliederJeSeite: 500, kategorienJeAntwort: Number.POSITIVE_INFINITY },
        anfragen: [],
        zustand: { sitzungGueltig: true, apihighlimits: true, loginCode: "wrongpassword" },
        antworter: null,
        schliesse: () => Promise.resolve(),
    };

    /** `list=categorymembers`: Artikel oder Unterkategorien einer Kategorie, `grenzen.mitgliederJeSeite` je Seite; das `cmcontinue` ist `t|<Versatz>`, alles andere `badcontinue`. */
    function mitglieder(anfrage: WikiAnfrage): WikiAntwort {
        const name = (anfrage.abfrage.get("cmtitle") ?? "").replace(/^Kategorie:/u, "");
        const kategorie = wiki.kategorien.get(name);
        const unter = anfrage.abfrage.get("cmtype") === "subcat";
        const alle = unter
            ? (kategorie?.unterkategorien ?? []).map((eintrag) => `Kategorie:${eintrag}`)
            : (kategorie?.artikel ?? []);
        const token = anfrage.abfrage.get("cmcontinue");
        let ab = 0;
        if (token !== null) {
            const treffer = /^t\|(\d+)$/u.exec(token);
            if (treffer === null) {
                return { json: { error: { code: "badcontinue", info: "Ungültiger Fortsetzungsparameter" } } };
            }
            ab = Number(treffer[1]);
        }
        const bis = Math.min(alle.length, ab + wiki.grenzen.mitgliederJeSeite);
        return {
            json: {
                batchcomplete: bis >= alle.length,
                ...(bis < alle.length ? { continue: { cmcontinue: `t|${String(bis)}`, continue: "-||" } } : {}),
                query: {
                    categorymembers: alle.slice(ab, bis).map((titel, index) => ({
                        pageid: ab + index + 1,
                        ns: unter ? 14 : 0,
                        title: titel,
                    })),
                },
            },
        };
    }

    /** `prop=categories`: Normalisierung (Unterstrich, erster Buchstabe), Weiterleitung, fehlende Seiten; die Zeilen kommen in Antworten zu `grenzen.kategorienJeAntwort`. */
    function kategorienVon(anfrage: WikiAnfrage, titel: string[]): WikiAntwort {
        const normalisiert: { from: string; to: string }[] = [];
        const weiterleitungen: { from: string; to: string }[] = [];
        const seiten: { titel: string; kategorien: string[]; fehlt: boolean }[] = [];
        for (const angefragt of titel) {
            let name = angefragt.replaceAll("_", " ");
            name = name.charAt(0).toUpperCase() + name.slice(1);
            if (name !== angefragt) normalisiert.push({ from: angefragt, to: name });
            let seite = wiki.seiten.get(name);
            if (seite?.weiterleitung !== undefined && anfrage.abfrage.get("redirects") === "1") {
                weiterleitungen.push({ from: name, to: seite.weiterleitung });
                name = seite.weiterleitung;
                seite = wiki.seiten.get(name);
            }
            const ziel = name;
            if (!seiten.some((eintrag) => eintrag.titel === ziel)) {
                seiten.push({ titel: ziel, kategorien: seite?.kategorien ?? [], fehlt: seite === undefined });
            }
        }
        const token = anfrage.abfrage.get("clcontinue");
        let ab = 0;
        if (token !== null) {
            const treffer = /^c\|(\d+)$/u.exec(token);
            if (treffer === null) {
                return { json: { error: { code: "badcontinue", info: "Ungültiger Fortsetzungsparameter" } } };
            }
            ab = Number(treffer[1]);
        }
        // Alle Kategoriezeilen in einer Reihe (Seite für Seite); das Fenster [ab, bis) kommt in diese Antwort.
        const zeilen = seiten.flatMap((seite, index) => seite.kategorien.map((kategorie) => ({ index, kategorie })));
        const bis = Math.min(zeilen.length, ab + wiki.grenzen.kategorienJeAntwort);
        const fenster = zeilen.slice(ab, bis);
        const pages = seiten
            .map((seite, index) => {
                const kategorien = fenster
                    .filter((zeile) => zeile.index === index)
                    .map((zeile) => ({ ns: 14, title: `Kategorie:${zeile.kategorie}` }));
                return {
                    hat: kategorien.length > 0,
                    seite: {
                        pageid: index + 1,
                        ns: 0,
                        title: seite.titel,
                        ...(seite.fehlt ? { missing: true } : {}),
                        ...(kategorien.length > 0 ? { categories: kategorien } : {}),
                    },
                };
            })
            // Die erste Antwort nennt jede Seite (auch die ohne Kategorien oder fehlende), die späteren nur die mit Zeilen im Fenster.
            .filter((eintrag) => ab === 0 || eintrag.hat)
            .map((eintrag) => eintrag.seite);
        return {
            json: {
                batchcomplete: bis >= zeilen.length,
                ...(bis < zeilen.length ? { continue: { clcontinue: `c|${String(bis)}`, continue: "||" } } : {}),
                query: {
                    ...(ab === 0 && normalisiert.length > 0 ? { normalized: normalisiert } : {}),
                    ...(ab === 0 && weiterleitungen.length > 0 ? { redirects: weiterleitungen } : {}),
                    pages,
                },
            },
        };
    }

    /** `prop=revisions`: der Text EINER Seite (Normalisierung, Weiterleitung, fehlende Seite). */
    function revisionenVon(anfrage: WikiAnfrage, titel: string[]): WikiAntwort {
        const angefragt = titel[0] ?? "";
        let name = angefragt.replaceAll("_", " ");
        name = name.charAt(0).toUpperCase() + name.slice(1);
        const normalisiert = name !== angefragt ? [{ from: angefragt, to: name }] : [];
        const weiterleitungen: { from: string; to: string }[] = [];
        const seite = wiki.seiten.get(name);
        if (seite?.weiterleitung !== undefined && anfrage.abfrage.get("redirects") === "1") {
            weiterleitungen.push({ from: name, to: seite.weiterleitung });
            name = seite.weiterleitung;
        }
        const inhalt = wiki.texte.get(name);
        return {
            json: {
                batchcomplete: true,
                query: {
                    ...(normalisiert.length > 0 ? { normalized: normalisiert } : {}),
                    ...(weiterleitungen.length > 0 ? { redirects: weiterleitungen } : {}),
                    pages: [
                        inhalt === undefined
                            ? { ns: 0, title: name, missing: true }
                            : {
                                  pageid: 1,
                                  ns: inhalt.ns ?? 0,
                                  title: name,
                                  revisions: [
                                      {
                                          revid: inhalt.revid,
                                          parentid: inhalt.revid - 1,
                                          timestamp: inhalt.zeit,
                                          slots: {
                                              main: {
                                                  contentmodel: "wikitext",
                                                  contentformat: "text/x-wiki",
                                                  content: inhalt.text,
                                              },
                                          },
                                      },
                                  ],
                              },
                    ],
                },
            },
        };
    }

    function standard(anfrage: WikiAnfrage): WikiAntwort {
        const eingeloggt = wiki.zustand.sitzungGueltig && cookies(anfrage.kopf).get("botSession") === "bot1";
        if (anfrage.methode === "POST") {
            const rumpf = anfrage.rumpf ?? new URLSearchParams();
            if (rumpf.get("action") === "query" && rumpf.get("meta") === "tokens") {
                return {
                    json: { batchcomplete: true, query: { tokens: { logintoken: "login-token+\\" } } },
                    kopf: { "set-cookie": ["wikiSession=vorher1; path=/; HttpOnly"] },
                };
            }
            if (rumpf.get("action") === "login") {
                const tokenOk =
                    rumpf.get("lgtoken") === "login-token+\\" && cookies(anfrage.kopf).get("wikiSession") === "vorher1";
                if (tokenOk && rumpf.get("lgname") === BOT_NAME && rumpf.get("lgpassword") === BOT_PASSWORT) {
                    wiki.zustand.sitzungGueltig = true;
                    return {
                        json: { login: { result: "Success", lgusername: "Avesmaps" } },
                        kopf: { "set-cookie": ["botSession=bot1; path=/; HttpOnly", "wikiSession=nachher2; path=/"] },
                    };
                }
                return {
                    json: {
                        login: {
                            result: "Failed",
                            reason: { code: wiki.zustand.loginCode, text: "Falsche Zugangsdaten (Testserver)" },
                        },
                    },
                };
            }
            return { status: 400, json: { error: { code: "badaction", info: "unbekannt" } } };
        }
        if (anfrage.abfrage.get("assert") === "user" && !eingeloggt) {
            return { json: { error: { code: "assertuserfailed", info: "Du bist nicht angemeldet" } } };
        }
        if (anfrage.abfrage.get("list") === "categorymembers") return mitglieder(anfrage);
        const titel = (anfrage.abfrage.get("titles") ?? "").split("|").filter((eintrag) => eintrag !== "");
        const grenze = eingeloggt && wiki.zustand.apihighlimits ? 500 : 50;
        if (titel.length > grenze) {
            return {
                json: { error: { code: "toomanyvalues", info: `Es sind höchstens ${String(grenze)} Werte erlaubt` } },
            };
        }
        if (anfrage.abfrage.get("prop") === "categories") return kategorienVon(anfrage, titel);
        if (anfrage.abfrage.get("prop") === "revisions") return revisionenVon(anfrage, titel);
        return {
            json: {
                batchcomplete: true,
                query: { pages: titel.map((name, index) => ({ pageid: index + 1, title: name })) },
            },
        };
    }

    const server: Server = createServer((anfrage, antwort) => {
        const teile: Buffer[] = [];
        anfrage.on("data", (stueck: Buffer) => teile.push(stueck));
        anfrage.on("end", () => {
            const url = new URL(anfrage.url ?? "/", "http://127.0.0.1");
            const aufgezeichnet: WikiAnfrage = {
                methode: anfrage.method ?? "GET",
                pfad: url.pathname,
                abfrage: url.searchParams,
                kopf: anfrage.headers,
                rumpf: anfrage.method === "POST" ? new URLSearchParams(Buffer.concat(teile).toString("utf8")) : null,
            };
            wiki.anfragen.push(aufgezeichnet);
            // Apache: Die Anfragezeile ist auf 8.190 Zeichen begrenzt.
            if ((anfrage.url ?? "").length > 8190) {
                antwort.writeHead(414, { "content-type": "text/plain" });
                antwort.end("URI Too Long");
                return;
            }
            const eigene = wiki.antworter?.(aufgezeichnet, wiki.anfragen.length);
            const wahl = eigene ?? standard(aufgezeichnet);
            antwort.writeHead(wahl.status ?? 200, { "content-type": "application/json", ...(wahl.kopf ?? {}) });
            antwort.end(wahl.text ?? JSON.stringify(wahl.json ?? {}));
        });
    });
    await new Promise<void>((fertig) => server.listen(0, "127.0.0.1", fertig));
    wiki.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/de/api.php`;
    wiki.schliesse = () =>
        new Promise<void>((fertig) => {
            server.closeAllConnections();
            server.close(() => fertig());
        });
    return wiki;
}
