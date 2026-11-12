"""Dauerhafte Speicherung der Optimierung (WI-0250 Phase A4): eine SQLite-Datei im Laufordner, ``<lauf>/lauf.sqlite``.

Das Protokoll ist die Datenbank: Jeder Kandidat mit seinen Abweichungen, jede Messung mit Commit, Auftrag (voller JSON-Text), Parameter, Saat,
Maßstab, Rolle, Messwerten der drei Dimensionen und Herkunft (gerechnet oder aus dem Zwischenspeicher), dazu die Ergebnisse der Phasen. Ein
Abbruch verliert nichts: ``fortsetzen`` plant dieselben Messungen noch einmal und überspringt, was hier steht.

Tabellen: ``meta`` (Schlüssel/Wert), ``kandidat``, ``messung``, ``phase``, ``ereignis``.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kandidat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    typ TEXT NOT NULL,
    variante TEXT NOT NULL,
    hash TEXT NOT NULL,
    werte TEXT NOT NULL,
    herkunft TEXT NOT NULL,
    erzeugt TEXT NOT NULL,
    UNIQUE (typ, variante, hash)
);
CREATE TABLE IF NOT EXISTS messung (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kandidat_id INTEGER NOT NULL REFERENCES kandidat(id),
    aufloesung INTEGER NOT NULL,
    saat TEXT NOT NULL,
    rolle TEXT NOT NULL,
    status TEXT NOT NULL,
    commit_sha TEXT,
    auftrag_fingerprint TEXT,
    auftrag TEXT,
    werte TEXT,
    fehler TEXT,
    aus_cache INTEGER NOT NULL DEFAULT 0,
    dauer_s REAL,
    erzeugt TEXT NOT NULL,
    UNIQUE (kandidat_id, aufloesung, saat, rolle)
);
CREATE TABLE IF NOT EXISTS phase (
    typ TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    daten TEXT,
    aktualisiert TEXT NOT NULL,
    PRIMARY KEY (typ, name)
);
CREATE TABLE IF NOT EXISTS ereignis (id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT NOT NULL, art TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messung_kandidat ON messung(kandidat_id);
"""


def jetzt() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _json(x: Any) -> str:
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class Speicher:
    def __init__(self, pfad: Path | str) -> None:
        self.pfad = Path(pfad)
        self.pfad.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.pfad)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(_SCHEMA)
        if self.meta("schema") is None:
            self.setze_meta("schema", SCHEMA_VERSION)
        elif int(self.meta("schema")) != SCHEMA_VERSION:
            raise RuntimeError(f"{self.pfad}: Schema {self.meta('schema')} statt {SCHEMA_VERSION}")

    def schliesse(self) -> None:
        self.db.commit()
        self.db.close()

    # --- meta -------------------------------------------------------------------------------------------------------------
    def meta(self, schluessel: str, standard: Any = None) -> Any:
        z = self.db.execute("SELECT wert FROM meta WHERE schluessel=?", (schluessel,)).fetchone()
        return standard if z is None else json.loads(z["wert"])

    def setze_meta(self, schluessel: str, wert: Any) -> None:
        self.db.execute("INSERT INTO meta(schluessel, wert) VALUES(?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert=excluded.wert", (schluessel, _json(wert)))
        self.db.commit()

    # --- Kandidaten -------------------------------------------------------------------------------------------------------
    def kandidat(self, typ: str, variante: str, hash_: str, werte: dict[str, Any], herkunft: str) -> int:
        """Id des Kandidaten; legt ihn an, wenn er fehlt (die erste Herkunft bleibt)."""
        z = self.db.execute("SELECT id FROM kandidat WHERE typ=? AND variante=? AND hash=?", (typ, variante, hash_)).fetchone()
        if z is not None:
            return int(z["id"])
        c = self.db.execute("INSERT INTO kandidat(typ, variante, hash, werte, herkunft, erzeugt) VALUES(?,?,?,?,?,?)", (typ, variante, hash_, _json(werte), herkunft, jetzt()))
        self.db.commit()
        return int(c.lastrowid or 0)

    def kandidaten(self, typ: str | None = None, variante: str | None = None) -> list[dict[str, Any]]:
        sql, arg = "SELECT * FROM kandidat", []
        bed = []
        if typ is not None:
            bed.append("typ=?")
            arg.append(typ)
        if variante is not None:
            bed.append("variante=?")
            arg.append(variante)
        if bed:
            sql += " WHERE " + " AND ".join(bed)
        return [{**dict(z), "werte": json.loads(z["werte"])} for z in self.db.execute(sql + " ORDER BY id", arg)]

    def kandidat_id(self, kid: int) -> dict[str, Any]:
        z = self.db.execute("SELECT * FROM kandidat WHERE id=?", (kid,)).fetchone()
        if z is None:
            raise KeyError(kid)
        return {**dict(z), "werte": json.loads(z["werte"])}

    # --- Messungen --------------------------------------------------------------------------------------------------------
    def messung(self, kid: int, aufloesung: int, saat: str, rolle: str) -> dict[str, Any] | None:
        z = self.db.execute("SELECT * FROM messung WHERE kandidat_id=? AND aufloesung=? AND saat=? AND rolle=?", (kid, aufloesung, saat, rolle)).fetchone()
        return None if z is None else _messung(z)

    def speichere_messung(
        self, kid: int, aufloesung: int, saat: str, rolle: str, status: str, *, commit: str | None = None, fingerprint: str | None = None,
        auftrag: dict[str, Any] | None = None, werte: dict[str, Any] | None = None, fehler: str | None = None, aus_cache: bool = False, dauer_s: float | None = None,
    ) -> None:
        self.db.execute(
            "INSERT INTO messung(kandidat_id, aufloesung, saat, rolle, status, commit_sha, auftrag_fingerprint, auftrag, werte, fehler, aus_cache, dauer_s, erzeugt) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kandidat_id, aufloesung, saat, rolle) DO UPDATE SET status=excluded.status, commit_sha=excluded.commit_sha, "
            "auftrag_fingerprint=excluded.auftrag_fingerprint, auftrag=excluded.auftrag, werte=excluded.werte, fehler=excluded.fehler, aus_cache=excluded.aus_cache, "
            "dauer_s=excluded.dauer_s, erzeugt=excluded.erzeugt",
            (kid, aufloesung, saat, rolle, status, commit, fingerprint, None if auftrag is None else _json(auftrag), None if werte is None else _json(werte), fehler,
             int(aus_cache), dauer_s, jetzt()),
        )
        self.db.commit()

    def messungen(self, kid: int | None = None, rolle: str | None = None, aufloesung: int | None = None) -> list[dict[str, Any]]:
        bed, arg = [], []
        for spalte, wert in (("kandidat_id", kid), ("rolle", rolle), ("aufloesung", aufloesung)):
            if wert is not None:
                bed.append(f"{spalte}=?")
                arg.append(wert)
        sql = "SELECT * FROM messung" + (" WHERE " + " AND ".join(bed) if bed else "") + " ORDER BY id"
        return [_messung(z) for z in self.db.execute(sql, arg)]

    def zaehle_messungen(self, status: str | None = None) -> int:
        if status is None:
            return int(self.db.execute("SELECT COUNT(*) FROM messung").fetchone()[0])
        return int(self.db.execute("SELECT COUNT(*) FROM messung WHERE status=?", (status,)).fetchone()[0])

    # --- Phasen und Ereignisse ----------------------------------------------------------------------------------------------
    def setze_phase(self, typ: str, name: str, status: str, daten: Any = None) -> None:
        self.db.execute(
            "INSERT INTO phase(typ, name, status, daten, aktualisiert) VALUES(?,?,?,?,?) ON CONFLICT(typ, name) DO UPDATE SET status=excluded.status, daten=excluded.daten, "
            "aktualisiert=excluded.aktualisiert",
            (typ, name, status, None if daten is None else _json(daten), jetzt()),
        )
        self.db.commit()

    def phase(self, typ: str, name: str) -> dict[str, Any] | None:
        z = self.db.execute("SELECT * FROM phase WHERE typ=? AND name=?", (typ, name)).fetchone()
        return None if z is None else {"typ": z["typ"], "name": z["name"], "status": z["status"], "daten": None if z["daten"] is None else json.loads(z["daten"]),
                                       "aktualisiert": z["aktualisiert"]}

    def phasen(self) -> list[dict[str, Any]]:
        return [{"typ": z["typ"], "name": z["name"], "status": z["status"], "daten": None if z["daten"] is None else json.loads(z["daten"]),
                 "aktualisiert": z["aktualisiert"]} for z in self.db.execute("SELECT * FROM phase ORDER BY rowid")]

    def ereignis(self, art: str, text: str) -> None:
        self.db.execute("INSERT INTO ereignis(zeit, art, text) VALUES(?,?,?)", (jetzt(), art, text))
        self.db.commit()

    def ereignisse(self, art: str | None = None) -> list[dict[str, Any]]:
        if art is None:
            zeilen: Iterable[sqlite3.Row] = self.db.execute("SELECT * FROM ereignis ORDER BY id")
        else:
            zeilen = self.db.execute("SELECT * FROM ereignis WHERE art=? ORDER BY id", (art,))
        return [dict(z) for z in zeilen]


def _messung(z: sqlite3.Row) -> dict[str, Any]:
    d = dict(z)
    d["auftrag"] = None if d["auftrag"] is None else json.loads(d["auftrag"])
    d["werte"] = None if d["werte"] is None else json.loads(d["werte"])
    d["aus_cache"] = bool(d["aus_cache"])
    return d
