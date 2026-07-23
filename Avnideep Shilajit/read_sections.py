import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Key sections to read
ranges = [
    (645, 740, "Checkout section 1"),
    (1035, 1065, "Success modal"),
    (1240, 1330, "JS - payment handlers"),
    (1600, 1650, "JS - form validation"),
    (2050, 2145, "Footer checkout section 2"),
]

for start, end, label in ranges:
    print(f"\n{'='*60}")
    print(f"{label} (lines {start}-{end}):")
    print('='*60)
    for i in range(start-1, min(end, len(lines))):
        if i < len(lines):
            print(f"L{i+1}: {lines[i].rstrip()}")
