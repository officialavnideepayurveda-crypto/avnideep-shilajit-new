const fs = require('fs');
let h = fs.readFileSync('index.html', 'utf8');
const s = h.length;

h = h.replace('content="https://shop.avnideepayurveda.in/images/mainimagee.webp"', 'content="https://shop.avnideepayurveda.in/images/og-image.webp"');
h = h.replace('og:image:width" content="600"', 'og:image:width" content="1200"');
h = h.replace('og:image:height" content="800"', 'og:image:height" content="630"');
h = h.replace('name="twitter:image" content="https://shop.avnideepayurveda.in/images/mainimagee.webp"', 'name="twitter:image" content="https://shop.avnideepayurveda.in/images/og-image.webp"');
h = h.replace('"image":"https://shop.avnideepayurveda.in/images/mainimagee.webp"', '"image":"https://shop.avnideepayurveda.in/images/og-image.webp"');
h = h.replace('alt="Avnideep 6Pro Shilajit Capsules Bottle"', 'alt="Avnideep 6Pro Stamina Shilajit Capsules - 50% OFF Offer"');
h = h.replace('alt="WhatsApp" width="20"', 'alt="WhatsApp logo" width="20"');
h = h.replace('alt="Doctor explains stamina solution"', 'alt="Ayurvedic Doctor explains Shilajit benefits for stamina"');
h = h.replace('alt="100% Money Back Guarantee" width="70" height="70">', 'alt="100% Money Back Guarantee - 10 Days Risk Free" width="70" height="70" loading="lazy">');

fs.writeFileSync('index.html', h, 'utf8');
console.log('Size: ' + s + ' -> ' + h.length + ' bytes');
console.log('OG refs: ' + (h.match(/og-image\.webp/g) || []).length);
console.log('DONE');
