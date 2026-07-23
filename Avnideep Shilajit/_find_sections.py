import re, sys
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find all sections
pattern = r'<section[^>]*class="([^"]*)"[^>]*>'
matches = list(re.finditer(pattern, content))
print(f"Found {len(matches)} sections with class attribute")

for i, m in enumerate(matches[:30]):
    cls = m.group(1)
    start = m.start()
    end_tag = content.find('</section>', m.end())
    if end_tag == -1:
        continue
    length = end_tag - start
    print(f"Section {i+1}: class='{cls}' - {length} chars starting at pos {start}")
