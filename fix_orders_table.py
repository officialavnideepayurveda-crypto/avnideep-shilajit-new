import os

os.chdir(r"E:/Avnideep Ayurveda landinge page 2026/Avnideep shilajit complete with certificate june 26/Avnideep shilajit/Avnideep-Shilajit")

with open('functions/api/order.js', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Find the saveToD1 function and add table creation before the INSERT
old = '''async function saveToD1(order, env) {
  if (!env.DB) {
    return { skipped: true, reason: "d1_not_configured" };
  }

  try {
    const query = await env.DB.prepare(
      `INSERT INTO orders ('''

new = '''async function saveToD1(order, env) {
  if (!env.DB) {
    return { skipped: true, reason: "d1_not_configured" };
  }

  try {
    // Auto-create orders table if not exists (handles first run after deploy)
    await env.DB.exec(
      `CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        pincode TEXT DEFAULT '',
        address TEXT DEFAULT '',
        payment_method TEXT DEFAULT 'cod',
        amount REAL DEFAULT 0,
        product TEXT DEFAULT 'Avnideep 6Pro Vitality Shilajit Capsules',
        status TEXT DEFAULT 'cod_order',
        page_url TEXT DEFAULT '',
        utr TEXT DEFAULT '',
        payment_note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        ip_address TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        utm_source TEXT DEFAULT '',
        utm_medium TEXT DEFAULT '',
        utm_campaign TEXT DEFAULT '',
        fbp TEXT DEFAULT '',
        fbc TEXT DEFAULT ''
      )`
    );

    const query = await env.DB.prepare(
      `INSERT INTO orders ('''

if old in content:
    content = content.replace(old, new, 1)
    with open('functions/api/order.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS: Added table auto-creation to saveToD1')
else:
    print('ERROR: Could not find target text')
    idx = content.find('async function saveToD1')
    if idx >= 0:
        print(f'Found at {idx}')
        print(content[idx:idx+200])
