import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find key JS functions
search_terms = ['openOrderPopup', 'closeOrderPopup', 'oForm', 'submit', 'form', 'function build(', 'function submitOrder']
for term in search_terms:
    for i, line in enumerate(lines):
        if term in line:
            print(f"L{i+1}: {line.rstrip()[:250]}")

print("\n\n=== Finding openOrderPopup ===")
for i, line in enumerate(lines):
    if 'openOrderPopup' in line:
        print(f"L{i+1}: {line.rstrip()[:300]}")

print("\n\n=== Form submit handlers ===")
for i, line in enumerate(lines):
    if 'oForm' in line or 'submit' in line.lower() and ('function' in line or 'addEventListener' in line):
        print(f"L{i+1}: {line.rstrip()[:300]}")
