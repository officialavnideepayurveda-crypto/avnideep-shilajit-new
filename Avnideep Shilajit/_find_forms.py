import re
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find form and payment related elements
keywords = ['form', 'payment', 'cod', 'order', 'pay', 'checkout', 'submit', 'address', 'phone', 'name']
for kw in keywords:
    indices = [m.start() for m in re.finditer(kw, content, re.IGNORECASE)]
    if indices:
        print(f"\n--- '{kw}' found at positions: {indices[:10]}...")
        for idx in indices[:3]:
            start = max(0, idx - 50)
            end = min(len(content), idx + 100)
            ctx = content[start:end]
            print(f"  ...{ctx}...")

# Also find all <form> tags
forms = list(re.finditer(r'<form[^>]*>', content))
print(f"\n\n=== FORMS FOUND: {len(forms)} ===")
for i, f in enumerate(forms):
    print(f"Form {i+1}: {f.group()[:200]} at pos {f.start()}")

# Find payment section
payments = list(re.finditer(r'pay-grid|pay-card|pay-logos', content))
print(f"\n\n=== PAYMENT ELEMENTS: ===")
for m in payments:
    start = max(0, m.start() - 100)
    end = min(len(content), m.end() + 200)
    print(f"...{content[start:end]}...")
