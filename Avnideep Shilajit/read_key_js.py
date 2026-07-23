import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Read specific function areas
ranges = [
    (1430, 1590, "Form submit handler"),
    (1720, 1760, "openOrderPopup / closeOrderPopup"),
    (1273, 1300, "build function"),
    (1319, 1360, "showSuccess function"),
]

for start, end, label in ranges:
    print(f"\n{'='*60}")
    print(f"{label} (lines {start}-{end}):")
    print('='*60)
    for i in range(start-1, min(end, len(lines))):
        if i < len(lines):
            print(f"L{i+1}: {lines[i].rstrip()}")
