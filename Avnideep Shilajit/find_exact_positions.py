import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find exact lines I need to modify
targets = [
    "return; // Checkout handled by app.js",
    "</form>",
    '<div class="trust-foot">',
    'form.addEventListener(\'submit\'',
    'form.addEventListener("submit"',
    'function initForm()',
    'updatePay();',
    'app.v3.js',
]

for target in targets:
    for i, line in enumerate(lines):
        if target in line:
            print(f"L{i+1}: {line.rstrip()[:200]}")

print("\n\n=== Context around form submit handler ===")
for i, line in enumerate(lines):
    if 'form.addEventListener' in line and 'submit' in line:
        start = max(0, i-2)
        end = min(len(lines), i+3)
        for j in range(start, end):
            print(f"L{j+1}: {lines[j].rstrip()[:200]}")
        break
