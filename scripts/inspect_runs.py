import pathlib
import unicodedata
from collections import Counter

p = pathlib.Path(r"apps\web\src\app\(app)\capital\_components\tabs.tsx")
t = p.read_text(encoding="utf-8")
if t.startswith("\ufeff"):
    t = t[1:]

# Every maximal run of non-ASCII characters, counted — shows exactly which
# sequences need mapping back to their real characters.
runs = Counter()
i = 0
n = len(t)
while i < n:
    ch = t[i]
    if ord(ch) < 128:
        i += 1
        continue
    j = i
    while j < n and ord(t[j]) >= 128:
        j += 1
    runs[t[i:j]] += 1
    i = j

for seq, count in runs.most_common(40):
    codes = " ".join(f"U+{ord(c):04X}" for c in seq)
    print(f"{count:4d}  {seq!r:14}  {codes}")
