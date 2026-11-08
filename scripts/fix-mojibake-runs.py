import pathlib

TARGET = r"apps\web\src\app\(app)\capital\_components\tabs.tsx"


def repair(text: str) -> tuple[str, int, list[str]]:
    out = []
    fixed = 0
    unmapped: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if ord(text[i]) < 128:
            out.append(text[i])
            i += 1
            continue
        j = i
        while j < n and ord(text[j]) >= 128:
            j += 1
        run = text[i:j]
        # A run of cp1252-encodable characters that decodes as UTF-8 is a
        # double-encoded sequence: put the real characters back.
        try:
            decoded = run.encode("cp1252").decode("utf-8")
        except Exception:
            if "\u00e0" in run or "\u00e2" in run or "\u00c2" in run or "\u00c3" in run:
                unmapped.append(run)
            decoded = run
        else:
            if decoded != run:
                fixed += 1
        out.append(decoded)
        i = j
    return "".join(out), fixed, unmapped


p = pathlib.Path(TARGET)
text = p.read_text(encoding="utf-8")
bom = text.startswith("\ufeff")
if bom:
    text = text[1:]

repaired, fixed, unmapped = repair(text)
p.write_text(repaired, encoding="utf-8", newline="")
print(f"runs repaired: {fixed}   bom removed: {bom}   unmapped runs: {len(unmapped)}")
for u in unmapped[:10]:
    print("  unmapped:", repr(u), " ".join(f"U+{ord(c):04X}" for c in u))
print("em-dashes now:", repaired.count("\u2014"), " baht:", repaired.count("\u09f3"))
