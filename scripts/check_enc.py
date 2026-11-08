import pathlib

files = [
    r"apps\web\src\app\(app)\capital\_components\tabs.tsx",
    r"apps\web\src\app\(app)\people\attendance\page.tsx",
    r"apps\web\src\app\(app)\people\payroll\page.tsx",
]

for f in files:
    t = pathlib.Path(f).read_text(encoding="utf-8")
    print(f)
    print("  em-dash U+2014:", t.count("\u2014"), " mojibake(â€):", t.count("\u00e2\u0080"), " BOM:", t.startswith("\ufeff"), " baht:", t.count("\u09f3"))
    for needle in ("\u2014", "\u00e2\u0080", "\u09f3"):
        i = t.find(needle)
        if i >= 0:
            print("   ", repr(needle), "->", repr(t[max(0, i - 30):i + 30]))
