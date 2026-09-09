"""Download the official small German model and package it for vosk-browser."""
import shutil
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

NAME = "vosk-model-small-de-0.15"
target = Path(__file__).resolve().parent.parent / "frontend/public/models/vosk-de.tar.gz"
if target.exists():
    print(f"Bereits vorhanden: {target}")
else:
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "model.zip"
        print("Lade deutsches Vosk-Modell (~45 MB) …", flush=True)
        with urllib.request.urlopen(f"https://alphacephei.com/vosk/models/{NAME}.zip", timeout=120) as response:
            with archive.open("wb") as output:
                shutil.copyfileobj(response, output)
        with zipfile.ZipFile(archive) as source:
            source.extractall(tmp)
        packed = Path(tmp) / "model.tar.gz"
        with tarfile.open(packed, "w:gz") as output:
            output.add(Path(tmp) / NAME, arcname="model")
        shutil.copyfile(packed, target)
    print(f"Bereit: {target}")
