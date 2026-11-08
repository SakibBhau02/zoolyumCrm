import pathlib

FILES = [
    r"apps\api\src\capital\approval-policy.service.ts",
    r"apps\web\src\app\(app)\capital\_components\approval-policy.tsx",
    r"apps\web\src\app\(app)\capital\_components\tabs.tsx",
    r"apps\api\src\capital\expense.service.ts",
]

BAD = ("\u00e2\u0080", "\u00c3\u00a2", "\u00c2\u00b7", "\u00e2\u0082")

for f in FILES:
    p = pathlib.Path(f)
    t = p.read_text(encoding="utf-8")
    hits = sum(t.count(b) for b in BAD)
    print(f, "| mojibake:", hits, "| baht:", t.count("\u09f3"), "| em-dash:", t.count("\u2014"))
