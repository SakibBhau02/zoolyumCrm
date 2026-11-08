import pathlib

FILES = [
    r"apps\web\src\app\(app)\capital\_components\tabs.tsx",
    r"apps\web\src\app\(app)\people\attendance\page.tsx",
    r"apps\web\src\app\(app)\people\payroll\page.tsx",
    r"apps\web\src\app\(app)\people\leave\page.tsx",
]

# cp1252 decoding of UTF-8 bytes E2 80 94 ("—") yields "â€”":
# â = U+00E2, € = U+20AC (0x80), ” = U+201D (0x94).
MARKERS = ("\u00e2\u20ac", "\u00c3\u00a2", "\u00e2\u20ac\u2122")

for f in FILES:
    p = pathlib.Path(f)
    text = p.read_text(encoding="utf-8")
    had_bom = text.startswith("\ufeff")
    if had_bom:
        text = text[1:]
    hits = sum(text.count(m) for m in MARKERS)
    if hits:
        for enc in ("cp1252", "latin-1"):
            try:
                text = text.encode(enc, errors="strict").decode("utf-8")
                print(f"decoded via {enc}: {f}")
                break
            except Exception:
                continue
        else:
            print(f"SKIPPED (undecodable): {f} hits={hits}")
            continue
    p.write_text(text, encoding="utf-8", newline="")
    print(f"ok: {f}  mojibake_hits={hits}  bom_removed={had_bom}  em_dashes={text.count(chr(0x2014))}")
