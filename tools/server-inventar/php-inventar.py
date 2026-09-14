#!/usr/bin/env python3
# Server-PHP-Inventar -- NUR LESEND.
#
# Wozu: Der Deploy loescht nie (AGENTS.md §10). Auf dem Server liegen deshalb PHP-Dateien, die das Repo
# nicht kennt, und eine Funktion, die im Repo niemand ruft, kann dort noch einen Aufrufer haben
# (`api/wiki-sync.php` antwortet live und steht nicht im Repo). Dieses Skript listet die PHP-Dateien des
# Webroots samt Groesse und Datum, und fuer jede Datei, die NICHT im Repo steht, die Funktionen, die sie
# deklariert, ruft und einbindet.
#
# 🔴 NUR LESEND, und das ist gebaut, nicht versprochen: der SFTP-Client steckt in `NurLesen`, das genau
#    chdir, listdir_attr und ein Oeffnen im Modus "rb" durchreicht. Kein Loeschen, kein Schreiben, kein
#    Umbenennen, keine Shell. `tools/server-inventar/__tests__/nur-lesend.test.js` haelt das fest.
# 🔴 tiles/, uploads/ und admin/ werden nicht betreten.
# 💣 Datei-INHALTE verlassen den Runner nie. Geholt wird in ein Temp-Verzeichnis ausserhalb des Artefakts;
#    ins Artefakt kommen nur Bezeichner (php-bezeichner.php, per Tokenizer). `config.local.php` wird gar
#    nicht erst geholt.
# ⚠️ Dateien, die auch im Repo stehen, werden nicht geholt: sie sind nicht die Frage, und jedes Holen ist
#    ein Zugriff mehr auf das Shared Hosting.

import argparse
import datetime
import hashlib
import json
import os
import posixpath
import stat
import subprocess

AUSGESCHLOSSEN_OBEN = ("tiles", "uploads", "admin")
NIE_HOLEN = ("config.local.php",)
MAX_HOLEN_BYTES = 2 * 1024 * 1024
MAX_TIEFE = 20


class NurLesen:
    """Die einzigen Griffe auf den Server. Was hier nicht steht, kann das Skript nicht."""

    def __init__(self, sftp):
        self._sftp = sftp

    def wechsle(self, pfad):
        self._sftp.chdir(pfad)

    def liste(self, pfad):
        return self._sftp.listdir_attr(pfad)

    def lies(self, pfad):
        with self._sftp.open(pfad, "rb") as datei:
            return datei.read()


def durchlaufe(server, fehler, pfad=".", tiefe=0):
    """Liefert (relativer_pfad, attribute) fuer jede .php-Datei unterhalb von pfad."""
    if tiefe > MAX_TIEFE:
        fehler.append({"pfad": pfad, "grund": "zu tief"})
        return
    try:
        eintraege = server.liste(pfad)
    except (OSError, IOError) as fehlschlag:
        fehler.append({"pfad": pfad, "grund": type(fehlschlag).__name__})
        return
    for eintrag in sorted(eintraege, key=lambda e: e.filename):
        name = eintrag.filename
        if name in (".", ".."):
            continue
        relativ = name if pfad == "." else posixpath.join(pfad, name)
        modus = eintrag.st_mode or 0
        if stat.S_ISLNK(modus):
            continue
        if stat.S_ISDIR(modus):
            if tiefe == 0 and name in AUSGESCHLOSSEN_OBEN:
                continue
            yield from durchlaufe(server, fehler, relativ, tiefe + 1)
        elif stat.S_ISREG(modus) and name.lower().endswith(".php"):
            yield relativ, eintrag


def git_blob(inhalt):
    """Dieselbe Kennung, die git einer Datei gibt -- damit laesst sich lokal per
    `git log --all --find-object=<blob>` nachsehen, ob die Server-Datei eine alte Repo-Fassung ist."""
    return hashlib.sha1(b"blob %d\0" % len(inhalt) + inhalt).hexdigest()


def repo_dateien():
    ausgabe = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True).stdout
    return {teil.decode("utf-8", "surrogateescape") for teil in ausgabe.split(b"\0") if teil}


def utc(sekunden):
    if sekunden is None:
        return ""
    return datetime.datetime.fromtimestamp(sekunden, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def inventar(server, im_repo, holen_nach):
    fehler = []
    zeilen = []
    nur_server = []
    for relativ, attribute in durchlaufe(server, fehler):
        drin = relativ in im_repo
        zeilen.append((relativ, attribute.st_size, utc(attribute.st_mtime), "ja" if drin else "nein"))
        if drin:
            continue
        eintrag = {"pfad": relativ, "bytes": attribute.st_size, "geaendert_utc": utc(attribute.st_mtime)}
        if posixpath.basename(relativ) in NIE_HOLEN:
            eintrag["nicht_geholt"] = "Zugangsdaten"
        elif (attribute.st_size or 0) > MAX_HOLEN_BYTES:
            eintrag["nicht_geholt"] = "zu gross"
        else:
            try:
                inhalt = server.lies(relativ)
            except (OSError, IOError) as fehlschlag:
                eintrag["nicht_geholt"] = type(fehlschlag).__name__
            else:
                eintrag["git_blob"] = git_blob(inhalt)
                ziel = os.path.join(holen_nach, *relativ.split("/"))
                os.makedirs(os.path.dirname(ziel), exist_ok=True)
                with open(ziel, "wb") as datei:
                    datei.write(inhalt)
        nur_server.append(eintrag)
    return zeilen, nur_server, fehler


def bezeichner(holen_nach):
    if not os.path.isdir(holen_nach) or not os.listdir(holen_nach):
        return {}
    skript = os.path.join(os.path.dirname(os.path.abspath(__file__)), "php-bezeichner.php")
    ausgabe = subprocess.run(["php", skript, holen_nach], check=True, capture_output=True).stdout
    return json.loads(ausgabe)


def schreibe_ergebnis(ausgabe, zeilen, nur_server, fehler):
    os.makedirs(ausgabe, exist_ok=True)
    with open(os.path.join(ausgabe, "php-dateien.tsv"), "w", encoding="utf-8", newline="\n") as datei:
        datei.write("pfad\tbytes\tgeaendert_utc\tim_repo\n")
        for zeile in zeilen:
            datei.write("\t".join(str(wert) for wert in zeile) + "\n")
    with open(os.path.join(ausgabe, "nur-auf-dem-server.json"), "w", encoding="utf-8", newline="\n") as datei:
        json.dump({"dateien": nur_server, "fehler_beim_auflisten": fehler}, datei, ensure_ascii=False, indent=1)
    im_repo = sum(1 for zeile in zeilen if zeile[3] == "ja")
    zusammenfassung = (
        f"PHP-Dateien auf dem Server: {len(zeilen)} · davon im Repo: {im_repo} · "
        f"nur auf dem Server: {len(nur_server)} · Verzeichnisse nicht lesbar: {len(fehler)}"
    )
    with open(os.path.join(ausgabe, "zusammenfassung.txt"), "w", encoding="utf-8", newline="\n") as datei:
        datei.write(zusammenfassung + "\n")
    return zusammenfassung


def main():
    parser = argparse.ArgumentParser(description="Server-PHP-Inventar (nur lesend)")
    parser.add_argument("--ausgabe", required=True, help="Verzeichnis fuer das Artefakt")
    parser.add_argument("--holen", required=True, help="Temp-Verzeichnis fuer geholte Dateien (NICHT ins Artefakt)")
    argumente = parser.parse_args()
    if os.path.abspath(argumente.holen).startswith(os.path.abspath(argumente.ausgabe)):
        raise SystemExit("--holen darf nicht im Artefakt-Verzeichnis liegen")

    import paramiko  # erst hier: die reinen Teile oben laufen ohne die Bibliothek

    client = paramiko.SSHClient()
    # Wie der Deploy (`set sftp:auto-confirm yes`): der Host-Schluessel wird angenommen.
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        os.environ["AVESMAPS_HOST"],
        port=int(os.environ["AVESMAPS_PORT"]),
        username=os.environ["AVESMAPS_USER"],
        password=os.environ["AVESMAPS_PASSWORD"],
        look_for_keys=False,
        allow_agent=False,
        timeout=30,
        banner_timeout=30,
        auth_timeout=30,
    )
    try:
        sftp = client.open_sftp()
        server = NurLesen(sftp)
        server.wechsle(os.environ["AVESMAPS_REMOTE_PATH"])
        zeilen, nur_server, fehler = inventar(server, repo_dateien(), argumente.holen)
    finally:
        client.close()

    analyse = bezeichner(argumente.holen)
    for eintrag in nur_server:
        if eintrag["pfad"] in analyse:
            eintrag["analyse"] = analyse[eintrag["pfad"]]

    print(schreibe_ergebnis(argumente.ausgabe, zeilen, nur_server, fehler))


if __name__ == "__main__":
    main()
