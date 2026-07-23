import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")
print(f"File size: {sum(len(l) for l in lines)} chars")

# Find key sections
for i, line in enumerate(lines):
    stripped = line.strip()
    if 'pay-grid' in stripped or 'pay-card' in stripped or 'pay-logos' in stripped:
        print(f"\nLine {i+1}: {stripped[:200]}")
    if 'cta-order' in stripped or 'submit' in stripped.lower() and 'type' in stripped.lower():
        print(f"\nLine {i+1}: {stripped[:200]}")
    if 'form-field' in stripped:
        print(f"\nLine {i+1}: {stripped[:200]}")
    if 'class="checkout"' in stripped or "class='checkout'" in stripped:
        print(f"\nLine {i+1}: {stripped[:200]}")
    if 'smodal' in stripped and ('check' in stripped or 'box' in stripped or 'order' in stripped):
        print(f"\nLine {i+1}: {stripped[:200]}")
