"""Der Aufruf des Generatoradapters (``scripts/dev/terrain-lab/rechne.ts``) aus Python (WI-0250 Phase B).

Der Adapter rechnet in einem eigenen Node-Prozess; jeder Aufruf ist ein frischer Prozess, also ein kalter Lauf. Alles, was Python vom
Adapter braucht, steht in seiner ``meta.json`` und in den Rastern im Austauschformat (``terrainlab.raster``).
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from terrainlab import daten_wurzel

from .umgebung import adapter_skript, grenzen_skript, node_pfad

# Ausgang des Adapters (siehe Kopf von rechne.ts).
AUSGANG_FEHLER, AUSGANG_EINGABE, AUSGANG_UNSAUBER, AUSGANG_STAND = 1, 2, 3, 4


class AdapterFehler(RuntimeError):
    """Der Adapter ist mit einem Fehler beendet; ``code`` ist sein Ausgang, ``stderr`` seine Fehlerausgabe."""

    def __init__(self, text: str, code: int, stderr: str = "") -> None:
        super().__init__(text)
        self.code = code
        self.stderr = stderr


class Unsauber(AdapterFehler):
    """Der Arbeitsbaum weicht in den Generator-Verzeichnissen von seinem Commit ab; der Adapter verweigert die Messung."""


@dataclass(frozen=True)
class AuftragsInfo:
    """Was ``--fingerprint`` verrät, ohne zu rechnen: Schlüssel des Auftrags und woher der Code käme."""

    auftrag_fingerprint: str
    commit: str
    baum_sauber: bool
    geaendert: tuple[str, ...]
    name: str
    stufe: str


def _letzte_json_zeile(text: str) -> dict[str, Any]:
    for zeile in reversed([z for z in text.splitlines() if z.strip()]):
        if zeile.lstrip().startswith("{"):
            return json.loads(zeile)
    raise AdapterFehler("Der Adapter hat keine Ergebniszeile geschrieben", AUSGANG_FEHLER, text[-500:])


class Adapter:
    def __init__(self, labor: Path | None = None, node: str | None = None, skript: Path | None = None) -> None:
        self.labor = Path(labor) if labor else daten_wurzel()
        self.node = node or node_pfad()
        self.skript = Path(skript) if skript else adapter_skript()

    def _lauf(self, flags: list[str], args: list[str], timeout: float | None) -> subprocess.CompletedProcess[str]:
        befehl = [self.node, *flags, str(self.skript), *args, "--labor", str(self.labor)]
        try:
            return subprocess.run(befehl, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
        except subprocess.TimeoutExpired as fehler:
            raise AdapterFehler(f"Zeitüberschreitung nach {timeout} s: {' '.join(args[:2])}", AUSGANG_FEHLER) from fehler

    @staticmethod
    def _pruefe(r: subprocess.CompletedProcess[str]) -> None:
        if r.returncode == 0:
            return
        klasse = Unsauber if r.returncode == AUSGANG_UNSAUBER else AdapterFehler
        raise klasse(f"Adapter endete mit {r.returncode}: {(r.stderr or r.stdout).strip()[-1200:]}", r.returncode, r.stderr)

    @staticmethod
    def _auftrag_datei(auftrag: dict[str, Any], ordner: Path | None = None) -> Path:
        if ordner is not None:
            ordner.mkdir(parents=True, exist_ok=True)
            pfad = ordner / "auftrag.json"
            pfad.write_text(json.dumps(auftrag, ensure_ascii=False, indent=2), encoding="utf-8")
            return pfad
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(auftrag, f, ensure_ascii=False)
            return Path(f.name)

    def fingerprint(self, auftrag: dict[str, Any], commit: str | None = None, timeout: float | None = 60) -> AuftragsInfo:
        """Schlüssel des Auftrags und Herkunft des Codes (Commit, Sauberkeit), ohne einen Stand anzulegen oder zu rechnen."""
        datei = self._auftrag_datei(auftrag)
        try:
            args = [str(datei), "-", "--fingerprint"] + (["--commit", commit] if commit else [])
            r = self._lauf([], args, timeout)
        finally:
            datei.unlink(missing_ok=True)
        self._pruefe(r)
        j = _letzte_json_zeile(r.stdout)
        return AuftragsInfo(j["auftrag_fingerprint"], j["commit"], bool(j["baum_sauber"]), tuple(j.get("geaendert", [])), j["name"], j["stufe"])

    def grenzen(self, commit: str | None = None, fassung: int | None = None, timeout: float | None = 300) -> dict[str, Any]:
        """Parametergrenzen, Typen und Ausgangswerte der Typen aus den Verträgen des Generators (``scripts/dev/terrain-lab/grenzen.ts``), am Stand eines Commits."""
        args = [self.node, str(grenzen_skript())] + (["--commit", commit] if commit else []) + (["--fassung", str(fassung)] if fassung is not None else [])
        try:
            r = subprocess.run([*args, "--labor", str(self.labor)], capture_output=True, text=True, encoding="utf-8", timeout=timeout)
        except subprocess.TimeoutExpired as fehler:
            raise AdapterFehler(f"Zeitüberschreitung nach {timeout} s: grenzen", AUSGANG_FEHLER) from fehler
        self._pruefe(r)
        return _letzte_json_zeile(r.stdout)

    def stand_vorbereiten(self, commit: str, timeout: float | None = 600) -> Path:
        """Legt die Arbeitskopie zu einem Commit an (einmal je Commit) und gibt ihre Wurzel zurück."""
        r = self._lauf([], ["-", "-", "--stand-vorbereiten", "--commit", commit], timeout)
        self._pruefe(r)
        return Path(_letzte_json_zeile(r.stdout)["stand"])

    def rechne(
        self,
        auftrag: dict[str, Any],
        ausgabe: Path,
        *,
        commit: str | None = None,
        warm: int = 0,
        phasen: bool = False,
        phasen_wiederholungen: int = 3,
        arbeiter: int | None = None,
        ohne_raster: bool = False,
        schmutzig_erlauben: bool = False,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Ein Lauf in einem frischen Prozess; gibt die ``meta.json`` des Adapters zurück."""
        ausgabe = Path(ausgabe)
        datei = self._auftrag_datei(auftrag, ausgabe)
        flags = ["--expose-gc"]
        if auftrag.get("stufe") == "endgelaende-lokal":
            flags.append("--max-old-space-size=8192")
        args = [str(datei), str(ausgabe), "--warm", str(warm)]
        if commit:
            args += ["--commit", commit]
        if phasen:
            args += ["--phasen", "--phasen-wiederholungen", str(phasen_wiederholungen)]
        if arbeiter is not None:
            args += ["--arbeiter", str(arbeiter)]
        if ohne_raster:
            args.append("--ohne-raster")
        if schmutzig_erlauben:
            args.append("--schmutzig-erlauben")
        r = self._lauf(flags, args, timeout)
        self._pruefe(r)
        ergebnis = _letzte_json_zeile(r.stdout)
        return json.loads(Path(ergebnis["meta"]).read_text(encoding="utf-8"))
