// ============================================================
// AVNIDEEP GOOGLE SHEETS INTEGRATION - Apps Script
// ============================================================
// HOW TO DEPLOY:
// 1. Go to https://script.google.com/
// 2. Click "New Project"
// 3. Delete any existing code and paste this entire file
// 4. Name your project: "Avnideep Orders to Sheets"
// 5. Click "Deploy" → "New Deployment"
// 6. Choose type: "Web App"
// 7. Execute as: "Me"
// 8. Who has access: "Anyone" (needed to receive POST from Cloudflare)
// 9. Click "Deploy"
// 10. COPY THE WEB APP URL — this is your GOOGLE_SHEETS_URL
// 11. Add GOOGLE_SHEETS_URL to Cloudflare Workers env variables
//
// IMPORTANT: After deploying, enable Gmail service for error notifications:
//   In Apps Script editor → left sidebar "Services" → + → "Gmail" → Add
//   (Not required — error catch works without it, but admin emails won't send)
//
// Sheet columns (auto-created):
// Timestamp | Order ID | Name | Phone | Pincode | Address |
// Payment Method | Amount | Product | Status | Page URL |
// IP Address | UTM Source | UTM Medium | UTM Campaign | IST Time
// ============================================================

const SHEET_NAME = "Orders";

/**
 * Handle GET request — health check
 */
function doGet() {
  return HtmlService.createHtmlOutput(
    '<h2>✅ Avnideep Google Sheets Integration Active</h2>' +
    '<p>POST to this URL with order data to save to Google Sheets.</p>' +
    '<p>Status: <strong>Running</strong></p>'
  );
}

/**
 * Handle POST request — save order to Google Sheet
 */
function doPost(e) {
  try {
    const data = e.parameter;

    if (!data.order_id || !data.name || !data.phone) {
      return sendJson(400, { ok: false, error: "Missing required fields" });
    }

    const sheet = getOrCreateSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // Build row matching what order.js's saveGoogleSheets() sends
    // Use timestamps from API to stay consistent with Supabase & Telegram
    const rowMap = {
      "Timestamp": data.created_at || new Date().toISOString(),
      "Order ID": data.order_id || "",
      "Name": data.name || "",
      "Phone": data.phone || "",
      "Pincode": data.pincode || "",
      "Address": data.address || "",
      "Payment Method": (data.payment_method || "").toUpperCase(),
      "Amount": data.amount ? Number(data.amount) : 0,
      "Product": data.product || "Avnideep 6Pro Stamina Shilajit Capsules",
      "Status": data.status || "cod_order",
      "Page URL": data.page_url || "",
      "IP Address": data.ip_address || "",
      "UTM Source": data.utm_source || "",
      "UTM Medium": data.utm_medium || "",
      "UTM Campaign": data.utm_campaign || "",
      "IST Time": data.ist_time || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    };

    const newRow = headers.map(h => rowMap[h] !== undefined ? rowMap[h] : "");

    sheet.appendRow(newRow);

    Logger.log(`✅ Order saved: ${data.order_id} — ${data.name}`);
    return sendJson(200, { ok: true, message: "Saved", order_id: data.order_id });

  } catch (error) {
    Logger.log(`❌ Error: ${error.toString()}`);
    try { MailApp.sendEmail(Session.getActiveUser().getEmail(), "⚠️ Avnideep Sheets Error", error.toString()); } catch(e) {}
    return sendJson(500, { ok: false, error: error.toString() });
  }
}

/**
 * Get or create the Orders sheet with proper headers
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) return sheet;

  // Create new sheet with headers matching order.js API output
  sheet = ss.insertSheet(SHEET_NAME);
  const headers = [
    "Timestamp", "Order ID", "Name", "Phone", "Pincode", "Address",
    "Payment Method", "Amount", "Product", "Status", "Page URL",
    "IP Address", "UTM Source", "UTM Medium", "UTM Campaign", "IST Time"
  ];

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setFontWeight("bold")
    .setBackground("#7A0C0C")
    .setFontColor("#ffffff");

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  return sheet;
}

/**
 * Send JSON response
 */
function sendJson(status, data) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  output.setContent(JSON.stringify(data));
  return output;
}

/**
 * CORS preflight
 */
function doOptions() {
  return sendJson(200, { ok: true });
}
