// ============================================================
// AVNIDEEP GOOGLE SHEETS INTEGRATION - Apps Script
// ============================================================
// HOW TO DEPLOY:
// ============================================================
// OPTION A (✅ BEST - Sheet-bound):
// 1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/16fZ3ptE1NQNYikz_7mLiFwtuCA37zRzdlWxaSeb-pIo/edit
// 2. Extensions → Apps Script
// 3. Delete existing code, paste this entire file
// 4. Name: "Avnideep Orders to Sheets"
// 5. Deploy → New Deployment → Web App
//    - Execute as: "Me"
//    - Who has access: "Anyone" ✅ IMPORTANT
// 6. Click Deploy → COPY the Web App URL
// 7. Add that URL as GOOGLE_SHEETS_URL in Cloudflare Pages env vars
//
// OPTION B (Standalone - script.google.com par banaya):
// Update SHEET_ID below with your sheet ID, then deploy as Web App
//
// Sheet columns (auto-created):
// Timestamp | Order ID | Name | Phone | Pincode | Address |
// Payment Method | Amount | Product | Status | Page URL |
// IP Address | UTM Source | UTM Medium | UTM Campaign | IST Time
// ============================================================

// ============================================================
// ⚙️ CONFIGURATION
// ============================================================
const SHEET_NAME = "Orders";

// Your Google Sheet ID (from the URL between /d/ and /edit)
// Example: https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
// If deploying from within the sheet (OPTION A), this is auto-detected.
// If deploying standalone (OPTION B), FILL THIS IN:
const SHEET_ID = "16fZ3ptE1NQNYikz_7mLiFwtuCA37zRzdlWxaSeb-pIo";

// ============================================================
// Helper: Get the spreadsheet (works both bound & standalone)
// ============================================================
function getSpreadsheet() {
  try {
    // First try: bound to sheet (deployed via Extensions → Apps Script)
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    // Fallback: standalone script — use openById
    if (SHEET_ID) {
      return SpreadsheetApp.openById(SHEET_ID);
    }
    throw new Error("SHEET_ID not configured! Deploy from within the sheet or set SHEET_ID.");
  }
}

// ============================================================
// Handle GET request — health check
// ============================================================
function doGet() {
  return HtmlService.createHtmlOutput(
    '<h2>✅ Avnideep Google Sheets Integration Active</h2>' +
    '<p>POST to this URL with order data to save to Google Sheets.</p>' +
    '<p>Status: <strong>Running</strong></p>'
  );
}

// ============================================================
// Handle POST request — save order to Google Sheet
// ============================================================
function doPost(e) {
  try {
    const data = e.parameter;

    if (!data.order_id || !data.name || !data.phone) {
      return sendJson(400, { ok: false, error: "Missing required fields" });
    }

    const sheet = getOrCreateSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // Build row matching what order.js's saveGoogleSheets() sends
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
    try {
      MailApp.sendEmail(
        Session.getActiveUser().getEmail() || "officialavnideepayurveda@gmail.com",
        "⚠️ Avnideep Sheets Error",
        error.toString()
      );
    } catch(e) {}
    return sendJson(500, { ok: false, error: error.toString() });
  }
}

// ============================================================
// Get or create the Orders sheet with proper headers
// ============================================================
function getOrCreateSheet() {
  const ss = getSpreadsheet();
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

// ============================================================
// Send JSON response
// ============================================================
function sendJson(status, data) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  output.setContent(JSON.stringify(data));
  return output;
}

// ============================================================
// CORS preflight
// ============================================================
function doOptions() {
  return sendJson(200, { ok: true });
}
