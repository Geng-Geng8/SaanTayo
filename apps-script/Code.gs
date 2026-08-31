/**
 * SaanTayo Back-End
 * Universal Saved Items + Authoritative Two-Way Sync V1
 *
 * Google Sheets:
 *
 * Trips
 * A TripID
 * B CreatedAt
 * C Destination
 * D StartDate
 * E EndDate
 * F TripDataJSON
 *
 * SavedItems (preferred) OR Shortlist during transition
 * A ItemID
 * B TripID
 * C CreatedAt
 * D ItemType
 * E Name
 * F Location
 * G Category
 * H Price
 * I Link
 * J SavedBy
 * K Status
 * L DetailsJSON
 */

const TRIPS_SHEET = "Trips";
const SAVED_ITEMS_SHEET = "SavedItems";
const TRANSITION_SHEET = "Shortlist";

const TRIPS_HEADERS = [
  "TripID",
  "CreatedAt",
  "Destination",
  "StartDate",
  "EndDate",
  "TripDataJSON"
];

const SAVED_ITEMS_HEADERS = [
  "ItemID",
  "TripID",
  "CreatedAt",
  "ItemType",
  "Name",
  "Location",
  "Category",
  "Price",
  "Link",
  "SavedBy",
  "Status",
  "DetailsJSON"
];

const ALLOWED_ITEM_TYPES = [
  "stay",
  "food",
  "transport",
  "activity",
  "flight",
  "note"
];


/* =========================================================
   WEB APP ENTRY POINTS
   ========================================================= */

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const payload = parsePostPayload_(e);
    const action = String(payload.action || "").trim();

    switch (action) {
      case "save_trip":
        return handleSaveTrip_(payload);

      case "save_item":
      case "save_stay": // temporary backwards compatibility
        return handleSaveItem_(payload);

      case "delete_item":
      case "delete_stay": // temporary backwards compatibility
        return handleDeleteItem_(payload);

      default:
        return jsonResponse_({
          status: "error",
          message: "Unknown action"
        });
    }

  } catch (error) {
    return jsonResponse_({
      status: "error",
      message: safeErrorMessage_(error)
    });

  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      // Lock may not have been acquired.
    }
  }
}


function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = String(params.action || "").trim();
    const tripId = normalizeId_(params.tripId);

    if (!tripId) {
      return jsonResponse_({
        status: "error",
        message: "Missing tripId"
      });
    }

    switch (action) {
      case "get_trip":
        return handleGetTrip_(tripId);

      case "get_items":
      case "get_stays": // temporary backwards compatibility
        return handleGetItems_(tripId);

      default:
        return jsonResponse_({
          status: "error",
          message: "Unknown action"
        });
    }

  } catch (error) {
    return jsonResponse_({
      status: "error",
      message: safeErrorMessage_(error)
    });
  }
}


/* =========================================================
   TRIPS
   ========================================================= */

function handleSaveTrip_(payload) {
  const tripId = normalizeId_(payload.tripId);

  if (!tripId) {
    return jsonResponse_({
      status: "error",
      message: "Missing tripId"
    });
  }

  const sheet = getTripsSheet_();

  const destination = safeCellString_(payload.destination || "");
  const startDate = safeCellString_(payload.startDate || "");
  const endDate = safeCellString_(payload.endDate || "");

  const tripDataJSON = safeCellString_(
    normalizeJsonString_(payload.tripDataJSON, {})
  );

  const existingRow = findLastTripRow_(sheet, tripId);

  if (existingRow > 0) {
    // Preserve original CreatedAt.
    sheet.getRange(existingRow, 3, 1, 4).setValues([[
      destination,
      startDate,
      endDate,
      tripDataJSON
    ]]);

  } else {
    sheet.appendRow([
      tripId,
      new Date().toISOString(),
      destination,
      startDate,
      endDate,
      tripDataJSON
    ]);
  }

  return jsonResponse_({
    status: "success",
    type: "trip_saved",
    tripId: tripId
  });
}


function handleGetTrip_(tripId) {
  const sheet = getTripsSheet_();
  const rowNumber = findLastTripRow_(sheet, tripId);

  if (rowNumber <= 0) {
    return jsonResponse_({
      status: "error",
      message: "Trip not found",
      tripId: tripId
    });
  }

  const row = sheet
    .getRange(rowNumber, 1, 1, TRIPS_HEADERS.length)
    .getValues()[0];

  const tripDataJSON = String(row[5] || "");
  const items = fetchItemsForTrip_(tripId);

  return jsonResponse_({
    status: "success",
    tripId: tripId,

    // Current contract
    tripDataJSON: tripDataJSON,
    items: items,

    // Temporary backwards compatibility
    data: tripDataJSON,
    stays: items
  });
}


/* =========================================================
   SAVED ITEMS
   ========================================================= */

function handleSaveItem_(payload) {
  const sheet = getSavedItemsSheet_();

  const tripId = normalizeId_(payload.tripId);

  if (!tripId) {
    return jsonResponse_({
      status: "error",
      message: "Missing tripId"
    });
  }

  let itemId = normalizeId_(payload.itemId || payload.stayId);

  if (!itemId) {
    itemId = Utilities.getUuid();
  }

  let itemType = String(payload.itemType || "stay")
    .trim()
    .toLowerCase();

  if (!ALLOWED_ITEM_TYPES.includes(itemType)) {
    return jsonResponse_({
      status: "error",
      message: "Invalid itemType"
    });
  }

  const name = safeCellString_(
    payload.name ||
    payload.hotelName ||
    "Saved Item"
  );

  const location = safeCellString_(payload.location || "");

  const category = safeCellString_(
    payload.category ||
    defaultCategoryForType_(itemType)
  );

  const price = safeCellString_(payload.price || "");

  const link = safeExternalUrl_(payload.link || "");

  const savedBy = safeCellString_(
    payload.savedBy || "Glen"
  );

  const status = safeCellString_(
    payload.status || "saved"
  );

  const detailsJSON = safeCellString_(
    normalizeJsonString_(
      payload.detailsJSON !== undefined
        ? payload.detailsJSON
        : payload.details,
      {}
    )
  );

  const existing = findSavedItem_(sheet, itemId);

  // Prevent the same ItemID from being used across different trips.
  if (
    existing.rowNumber > 0 &&
    existing.tripId &&
    existing.tripId !== tripId
  ) {
    return jsonResponse_({
      status: "error",
      message: "ItemID already belongs to another trip"
    });
  }

  if (existing.rowNumber > 0) {
    // Keep original ItemID, TripID and CreatedAt.
    sheet.getRange(existing.rowNumber, 4, 1, 9).setValues([[
      itemType,
      name,
      location,
      category,
      price,
      link,
      savedBy,
      status,
      detailsJSON
    ]]);

  } else {
    sheet.appendRow([
      itemId,
      tripId,
      new Date().toISOString(),
      itemType,
      name,
      location,
      category,
      price,
      link,
      savedBy,
      status,
      detailsJSON
    ]);
  }

  // IMPORTANT:
  // Return authoritative state from Sheets after mutation.
  const items = fetchItemsForTrip_(tripId);

  return jsonResponse_({
    status: "success",
    type: "item_saved",
    itemId: itemId,
    tripId: tripId,
    items: items,

    // Temporary backwards compatibility
    stays: items
  });
}


function handleDeleteItem_(payload) {
  const sheet = getSavedItemsSheet_();

  const tripId = normalizeId_(payload.tripId);
  const itemId = normalizeId_(
    payload.itemId || payload.stayId
  );

  if (!tripId || !itemId) {
    return jsonResponse_({
      status: "error",
      message: "Missing tripId or itemId"
    });
  }

  const data = sheet.getDataRange().getValues();

  let deleted = false;

  // Search backwards so deletion cannot shift rows still being inspected.
  for (let i = data.length - 1; i >= 1; i--) {
    const rowItemId = String(data[i][0] || "").trim();
    const rowTripId = String(data[i][1] || "").trim();

    // BOTH identifiers must match.
    if (
      rowItemId === itemId &&
      rowTripId === tripId
    ) {
      sheet.deleteRow(i + 1);
      deleted = true;
      break;
    }
  }

  const items = fetchItemsForTrip_(tripId);

  if (!deleted) {
    return jsonResponse_({
      status: "error",
      message: "Saved item not found",
      tripId: tripId,
      items: items,
      stays: items
    });
  }

  return jsonResponse_({
    status: "success",
    type: "item_deleted",
    itemId: itemId,
    tripId: tripId,

    // Fresh authoritative state.
    items: items,

    // Temporary backwards compatibility
    stays: items
  });
}


function handleGetItems_(tripId) {
  const items = fetchItemsForTrip_(tripId);

  return jsonResponse_({
    status: "success",
    tripId: tripId,
    items: items,

    // Useful for older frontend code.
    data: items,
    stays: items
  });
}


function fetchItemsForTrip_(tripId) {
  const sheet = getSavedItemsSheet_();
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return [];
  }

  const items = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    if (String(row[1] || "").trim() !== tripId) {
      continue;
    }

    const itemId = String(row[0] || "");
    const itemType = String(row[3] || "stay")
      .trim()
      .toLowerCase();

    const detailsJSON = String(row[11] || "{}");

    items.push({
      itemId: itemId,

      // Temporary old-client alias
      stayId: itemId,

      tripId: String(row[1] || ""),

      createdAt: normalizeSheetDate_(row[2]),

      itemType: itemType,

      name: String(row[4] || "Saved Item"),

      // Temporary old-client alias
      hotelName: String(row[4] || "Saved Item"),

      location: String(row[5] || ""),

      category: String(row[6] || ""),

      price: String(row[7] || ""),

      link: String(row[8] || ""),

      savedBy: String(row[9] || ""),

      status: String(row[10] || "saved"),

      detailsJSON: detailsJSON,

      // Parsed convenience representation.
      details: parseDetailsJson_(detailsJSON)
    });
  }

  return items;
}


/* =========================================================
   SHEET SETUP / VALIDATION
   ========================================================= */

function getTripsSheet_() {
  const db = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = db.getSheetByName(TRIPS_SHEET);

  if (!sheet) {
    sheet = db.insertSheet(TRIPS_SHEET);
    sheet.appendRow(TRIPS_HEADERS);
    return sheet;
  }

  validateHeaders_(sheet, TRIPS_HEADERS);

  return sheet;
}


function getSavedItemsSheet_() {
  const db = SpreadsheetApp.getActiveSpreadsheet();

  // Preferred final name.
  let sheet = db.getSheetByName(SAVED_ITEMS_SHEET);

  // Temporary transition support:
  // your current sheet may still be named "Shortlist".
  if (!sheet) {
    sheet = db.getSheetByName(TRANSITION_SHEET);
  }

  if (!sheet) {
    sheet = db.insertSheet(SAVED_ITEMS_SHEET);
    sheet.appendRow(SAVED_ITEMS_HEADERS);
    return sheet;
  }

  validateHeaders_(sheet, SAVED_ITEMS_HEADERS);

  return sheet;
}


function validateHeaders_(sheet, expectedHeaders) {
  const actual = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getValues()[0]
    .map(value => String(value || "").trim());

  for (let i = 0; i < expectedHeaders.length; i++) {
    if (actual[i] !== expectedHeaders[i]) {
      throw new Error(
        'Invalid schema in sheet "' +
        sheet.getName() +
        '". Expected column ' +
        (i + 1) +
        ' to be "' +
        expectedHeaders[i] +
        '" but found "' +
        actual[i] +
        '".'
      );
    }
  }
}


/* =========================================================
   LOOKUPS
   ========================================================= */

function findLastTripRow_(sheet, tripId) {
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return -1;
  }

  const ids = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .getValues();

  // Search newest → oldest because the old backend appended
  // duplicate versions instead of upserting.
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0] || "").trim() === tripId) {
      return i + 2;
    }
  }

  return -1;
}


function findSavedItem_(sheet, itemId) {
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      rowNumber: -1,
      tripId: ""
    };
  }

  const rows = sheet
    .getRange(2, 1, lastRow - 1, 2)
    .getValues();

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === itemId) {
      return {
        rowNumber: i + 2,
        tripId: String(rows[i][1] || "").trim()
      };
    }
  }

  return {
    rowNumber: -1,
    tripId: ""
  };
}


/* =========================================================
   INPUT / SECURITY HELPERS
   ========================================================= */

function parsePostPayload_(e) {
  if (
    !e ||
    !e.postData ||
    typeof e.postData.contents !== "string"
  ) {
    throw new Error("Missing POST body");
  }

  const raw = e.postData.contents;

  // Basic abuse / accidental oversized-payload protection.
  if (raw.length > 100000) {
    throw new Error("Request body too large");
  }

  const payload = JSON.parse(raw);

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid request body");
  }

  return payload;
}


function normalizeId_(value) {
  const text = String(value || "").trim();

  // UUIDs and similar safe identifiers only.
  if (!text) {
    return "";
  }

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(text)) {
    throw new Error("Invalid identifier");
  }

  return text;
}


function safeCellString_(value) {
  let text = String(
    value === null || value === undefined
      ? ""
      : value
  );

  // Keep individual cells reasonably bounded.
  if (text.length > 50000) {
    text = text.slice(0, 50000);
  }

  // Spreadsheet formula injection protection.
  //
  // If the frontend already prepended "'", this does
  // not double-prefix it.
  if (/^[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return text;
}


function safeExternalUrl_(value) {
  const text = safeCellString_(value).trim();

  if (!text) {
    return "";
  }

  // Only permit normal web links.
  if (!/^https?:\/\//i.test(text)) {
    return "";
  }

  return text;
}


function normalizeJsonString_(value, fallbackObject) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return JSON.stringify(fallbackObject || {});
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed);
    } catch (_) {
      return JSON.stringify(fallbackObject || {});
    }
  }

  try {
    return JSON.stringify(value);
  } catch (_) {
    return JSON.stringify(fallbackObject || {});
  }
}


function parseDetailsJson_(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch (_) {
    // Ignore malformed stored metadata.
  }

  return {};
}


function defaultCategoryForType_(itemType) {
  switch (itemType) {
    case "stay":
      return "Hotel";

    case "food":
      return "Restaurant";

    case "transport":
      return "Transit";

    case "activity":
      return "Activity";

    case "flight":
      return "Flight";

    case "note":
      return "Note";

    default:
      return "";
  }
}


function normalizeSheetDate_(value) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const text = String(value);

  const parsed = new Date(text);

  if (isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toISOString();
}


function safeErrorMessage_(error) {
  if (!error) {
    return "Unknown server error";
  }

  const message = String(
    error.message || error.toString() || "Server error"
  );

  // Avoid returning huge internal messages.
  return message.slice(0, 500);
}


/* =========================================================
   RESPONSE
   ========================================================= */

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
