const express = require("express");
const { google } = require("googleapis");
const app = express();

// ── CONFIG ───────────────────────────────────────────────────
const SHEET_ID       = process.env.SHEET_ID;
const SHEET_NAME     = "b2b";
const DATA_START_ROW = 4;
const MAX_TRIPS      = 5;
// ────────────────────────────────────────────────────────────

// Auth via service account
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// ── Main route ───────────────────────────────────────────────
app.get("/", async (req, res) => {
  const location  = req.query.location;
  const confirmed = req.query.confirmed;
  const loggedEvent = req.query.event;
  const loggedTime  = req.query.time;
  const loggedTrip  = req.query.trip;

  // Already logged — just show confirmation (refresh-safe)
  if (confirmed === "1") {
    return res.send(htmlPage(loggedEvent, loggedTrip + "º Viaje  ·  " + loggedTime, getColor(loggedEvent), location));
  }

  if (!location) {
    return res.send(htmlPage("Error", "No location specified.", "#c0392b", ""));
  }

  try {
    const auth    = getAuth();
    const sheets  = google.sheets({ version: "v4", auth });

    // Get current sheet data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${DATA_START_ROW}:${colLetter(1 + MAX_TRIPS * 4)}1000`,
    });

    const rows   = response.data.values || [];
    const now    = new Date();
    const madrid = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
    const timeStr = pad(madrid.getHours()) + ":" + pad(madrid.getMinutes());
    const dateStr = madrid.getDate() + "/" + pad(madrid.getMonth() + 1) + "/" + madrid.getFullYear();
    const todayKey = madrid.getFullYear() + "-" + madrid.getMonth() + "-" + madrid.getDate();

    // Find today's row
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const cell = rows[i][0];
      if (!cell) continue;
      const d = new Date(cell);
      const dMadrid = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
      const key = dMadrid.getFullYear() + "-" + dMadrid.getMonth() + "-" + dMadrid.getDate();
      if (key === todayKey) { rowIndex = i; break; }
    }

    let sheetRow; // 1-based sheet row number
    if (rowIndex === -1) {
      // Create new row for today
      sheetRow = DATA_START_ROW + rows.length;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A${sheetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[dateStr]] },
      });
      rows.push([dateStr]);
      rowIndex = rows.length - 1;
    } else {
      sheetRow = DATA_START_ROW + rowIndex;
    }

    // Find next empty column
    const rowData = rows[rowIndex] || [];
    const result  = findNextColumn(rowData, location);

    if (!result) {
      return res.send(htmlPage("Maximo alcanzado", "Todos los viajes del dia ya estan registrados.", "#e67e22", location));
    }

    // Write time to the correct cell
    const cellRef = `${SHEET_NAME}!${colLetter(result.col)}${sheetRow}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: cellRef,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[timeStr]] },
    });

    // Redirect to refresh-safe confirmation URL
    const redirectUrl = `/?location=${location}&confirmed=1&event=${encodeURIComponent(result.event)}&time=${encodeURIComponent(dateStr + "  ·  " + timeStr)}&trip=${result.trip}`;
    return res.redirect(redirectUrl);

  } catch (err) {
    console.error(err);
    return res.send(htmlPage("Error", "Something went wrong: " + err.message, "#c0392b", location));
  }
});

// ── Helpers ──────────────────────────────────────────────────
function findNextColumn(rowData, location) {
  for (let n = 1; n <= MAX_TRIPS; n++) {
    if (location === "lls") {
      const li = 4*n-3, si = 4*n-2, lc = 4*n-2, sc = 4*n-1;
      if (!rowData[li]) return { col: lc, event: "LLEGADA LLS",  trip: n };
      if (rowData[li] && !rowData[si]) return { col: sc, event: "SALIDA LLS",   trip: n };
    } else {
      const li = 4*n-1, si = 4*n, lc = 4*n, sc = 4*n+1;
      if (!rowData[li]) return { col: lc, event: "LLEGADA USERA", trip: n };
      if (rowData[li] && !rowData[si]) return { col: sc, event: "SALIDA USERA",  trip: n };
    }
  }
  return null;
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function pad(n) { return String(n).padStart(2, "0"); }

function getColor(event) {
  return (event && event.includes("LLEGADA")) ? "#27ae60" : "#e67e22";
}

function htmlPage(title, subtitle, color, location) {
  const bg  = location === "lls" ? "#1a2535" : "#1a3525";
  const loc = location === "lls" ? "LLS" : "USERA";
  return `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta charset="UTF-8">
    <style>
      * {margin:0;padding:0;box-sizing:border-box}
      body {font-family:"Segoe UI",system-ui,sans-serif;background:${bg};
        min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
      .card {background:#fff;border-radius:24px;padding:52px 36px;text-align:center;
        max-width:340px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.45)}
      .badge {display:inline-block;background:${color};color:#fff;
        font-size:10px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;
        padding:5px 14px;border-radius:20px;margin-bottom:28px}
      .title {font-size:28px;font-weight:800;color:#111;line-height:1.2;margin-bottom:16px}
      .bar {width:36px;height:4px;background:${color};border-radius:2px;margin:0 auto 16px}
      .sub {font-size:13px;color:#999;letter-spacing:.3px}
    </style></head><body>
    <div class="card">
      <div class="badge">${loc}</div>
      <div class="title">${title}</div>
      <div class="bar"></div>
      <div class="sub">${subtitle}</div>
    </div></body></html>`;
}

app.listen(3000, () => console.log("Running on port 3000"));
