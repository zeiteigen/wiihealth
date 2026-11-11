"""Package the design collection as a static GitHub Pages site."""
from pathlib import Path
import shutil


def build():
    root = Path(__file__).resolve().parent.parent
    source = root / "designs"
    output = root / "_site"
    if output.exists():
        shutil.rmtree(output)
    output.mkdir()
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        if path.suffix not in {".html", ".css", ".js"} or "tests" in relative.parts:
            continue
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    (output / ".nojekyll").touch()
    assert (output / "14-tv-tenfoot" / "app.js").is_file()
    assert len(list(output.glob("*/index.html"))) == 15
    print(f"Packaged 15 concepts in {output}")


if __name__ == "__main__":
    build()
