const express = require("express");
const { google } = require("googleapis");
const app = express();

// ── CONFIG ───────────────────────────────────────────────────
const SHEET_ID       = process.env.SHEET_ID;
const SHEET_NAME     = "b2b";
const DATA_START_ROW = 4;
const MAX_TRIPS      = 5;
// ────────────────────────────────────────────────────────────

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getMadridDate(now) {
  const madrid = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  return {
    date: madrid,
    day: madrid.getDate(),
    month: madrid.getMonth() + 1, // 1-based
    year: madrid.getFullYear(),
    timeStr: pad(madrid.getHours()) + ":" + pad(madrid.getMinutes()),
    dateStr: madrid.getDate() + "/" + pad(madrid.getMonth() + 1) + "/" + madrid.getFullYear(),
    // Key for comparison: "10/04/2026" style
    key: madrid.getDate() + "/" + pad(madrid.getMonth() + 1) + "/" + madrid.getFullYear()
  };
}

// ── Main route ───────────────────────────────────────────────
app.get("/", async (req, res) => {
  const location    = req.query.location;
  const confirmed   = req.query.confirmed;
  const loggedEvent = req.query.event;
  const loggedTime  = req.query.time;
  const loggedTrip  = req.query.trip;

  if (confirmed === "1") {
    return res.send(htmlPage(loggedEvent, loggedTrip + "º Viaje  ·  " + loggedTime, getColor(loggedEvent), location));
  }

  if (!location) {
    return res.send(htmlPage("Error", "No location specified.", "#c0392b", ""));
  }

  try {
    const auth   = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const totalCols = 1 + MAX_TRIPS * 4;
    const endCol    = colLetter(totalCols);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${DATA_START_ROW}:${endCol}1000`,
    });

    const rows = response.data.values || [];
    const m    = getMadridDate(new Date());

    // Find today's row by comparing the date string in column A
    // Handles both text "10/04/2026" and date serial numbers
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const cell = rows[i][0];
      if (!cell) continue;

      // Try matching as text first (e.g. "10/04/2026" or "10/4/2026")
      const cellStr = String(cell).trim();
      
      // Parse d/M/yyyy or d/MM/yyyy
      const parts = cellStr.split("/");
      if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const mo = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (d === m.day && mo === m.month && y === m.year) {
          rowIndex = i;
          break;
        }
      }

      // Try as a Date object (in case Google returns a serial)
      const asDate = new Date(cell);
      if (!isNaN(asDate)) {
        const madridCell = new Date(asDate.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
        if (
          madridCell.getDate() === m.day &&
          madridCell.getMonth() + 1 === m.month &&
          madridCell.getFullYear() === m.year
        ) {
          rowIndex = i;
          break;
        }
      }
    }

    let sheetRow;
    if (rowIndex === -1) {
      // No row for today — create one
      sheetRow = DATA_START_ROW + rows.length;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A${sheetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[m.dateStr]] },
      });
      rows.push([m.dateStr]);
      rowIndex = rows.length - 1;
    } else {
      sheetRow = DATA_START_ROW + rowIndex;
    }

    const rowData = rows[rowIndex] || [];
    const result  = findNextColumn(rowData, location);

    if (!result) {
      return res.send(htmlPage("Maximo alcanzado", "Todos los viajes del dia ya estan registrados.", "#e67e22", location));
    }

    const cellRef = `${SHEET_NAME}!${colLetter(result.col)}${sheetRow}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: cellRef,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[m.timeStr]] },
    });

    const redirectUrl = `/?location=${location}&confirmed=1&event=${encodeURIComponent(result.event)}&time=${encodeURIComponent(m.dateStr + "  ·  " + m.timeStr)}&trip=${result.trip}`;
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
      if (rowData[li] && !rowData[si]) return { col: sc, event: "SALIDA LLS", trip: n };
    } else {
      const li = 4*n-1, si = 4*n, lc = 4*n, sc = 4*n+1;
      if (!rowData[li]) return { col: lc, event: "LLEGADA USERA", trip: n };
      if (rowData[li] && !rowData[si]) return { col: sc, event: "SALIDA USERA", trip: n };
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
