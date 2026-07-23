import re
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find checkout section - try different formats
patterns = [
    '<section class="checkout"',
    "<section class='checkout'",
    '<section class=checkout'
]

idx = -1
for p in patterns:
    idx = content.find(p)
    if idx != -1:
        break

if idx != -1:
    end = content.find('</section>', idx)
    section = content[idx:end+10]
    print(f"CHECKOUT SECTION ({len(section)} chars):")
    print(section)
else:
    print("CHECKOUT NOT FOUND")
    # Try another approach - find all sections
    count = 0
    pos = 0
    while True:
        start = content.find('<section', pos)
        if start == -1:
            break
        end = content.find('</section>', start)
        if end == -1:
            break
        sec = content[start:end+10]
        count += 1
        print(f"\n--- Section {count} ({len(sec)} chars) ---")
        print(sec[:200])
        pos = end + 10
        if count > 20:
            break
