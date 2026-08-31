# SaanTayo — Shared Trip Workspace V1 Specification

## 1. Overview

SaanTayo is a personal travel-planning application designed specifically for two partners:
* **Glen** (Canada base)
* **Anne** (Philippines base)

Shared Trip Workspace V1 turns SaanTayo into a synchronized, collaborative travel workspace between Glen and Anne without introducing heavy authentication, external SaaS databases (Supabase/Firebase), or complex permissions.

Google Sheets and Google Apps Script serve as the authoritative backend, while browser localStorage acts as an instant-boot cache and offline fallback.

---

## 2. Core Architecture Principles

1. **Google Sheets is Authoritative**:
   * Remote Sheets state is the single source of truth for shared trips and saved items.
   * Remote success always overwrites local memory and updates local cache.
   * If remote returns an empty list (`[]`), it authoritatively clears stale local items.
   * If remote is unreachable / network offline, local cache is preserved.

2. **Zero SaaS Overhead / No Complex Auth**:
   * Glen and Anne identify themselves via a simple, client-side partner identity toggle stored in `localStorage` under `saantayo_partner_identity_v1`.
   * Partner values: `"Glen"` | `"Anne"`.

3. **Universal Saved Items Attribution**:
   * All saved items (accommodations, dining spots, activities, transit legs) record `SavedBy: "Glen"` or `SavedBy: "Anne"` on Google Sheets.
   * The shortlist drawer supports a display-only partner filter (`All | Glen | Anne`).

4. **Trip Discovery via `list_trips`**:
   * Google Apps Script exposes a lightweight `list_trips` action that aggregates all trips across the `Trips` sheet and `SavedItems` sheet.
   * Returns a compact array of trip descriptors without large `TripDataJSON` blobs:
     `{ tripId, destination, startDate, endDate, createdAt, itemCount, hasTripData }`
   * Gracefully surfaces orphan saved-item trips (`hasTripData: false`) where items were saved without a structured AI itinerary.

5. **Automated Seamless Synchronization**:
   * Window `focus` and document `visibilitychange` trigger debounced auto-sync.
   * Opening the Shortlist or Shared Trips modal triggers immediate refresh.
   * Background polling loop every ~50 seconds when online and active.
   * Request guards prevent duplicate or overlapping network requests.

---

## 3. Google Apps Script Contract (`Code.gs`)

### `doGet(e)` Actions

#### `list_trips`
* **Method**: `GET ?action=list_trips`
* **Response**:
```json
{
  "status": "success",
  "trips": [
    {
      "tripId": "palawan-2026",
      "destination": "El Nido, Palawan",
      "startDate": "2026-09-10",
      "endDate": "2026-09-15",
      "createdAt": "2026-08-20T10:00:00.000Z",
      "itemCount": 4,
      "hasTripData": true
    },
    {
      "tripId": "orphan-trip-id",
      "destination": "Shared Trip",
      "startDate": "",
      "endDate": "",
      "createdAt": "2026-08-22T12:00:00.000Z",
      "itemCount": 2,
      "hasTripData": false
    }
  ]
}
```

#### `get_trip`
* **Method**: `GET ?action=get_trip&tripId=<tripId>`
* **Response**:
```json
{
  "status": "success",
  "tripId": "palawan-2026",
  "tripDataJSON": "{...}",
  "items": [...]
}
```

#### `get_items`
* **Method**: `GET ?action=get_items&tripId=<tripId>`
* **Response**:
```json
{
  "status": "success",
  "tripId": "palawan-2026",
  "items": [
    {
      "itemId": "stay-123",
      "tripId": "palawan-2026",
      "createdAt": "2026-08-31T12:00:00.000Z",
      "itemType": "stay",
      "name": "Spin Designer Hostel",
      "location": "El Nido Town",
      "category": "Hostel",
      "price": "₱1,800",
      "link": "https://...",
      "savedBy": "Anne",
      "status": "Shortlisted",
      "detailsJSON": "{...}",
      "details": { ... }
    }
  ]
}
```

### `doPost(e)` Actions

#### `save_item`
* **Payload**: `{ action: "save_item", itemId, tripId, itemType, name, location, category, price, link, savedBy, status, detailsJSON }`
* **Response**: `{ status: "success", type: "item_saved", itemId, tripId, items: [...] }`

#### `delete_item`
* **Payload**: `{ action: "delete_item", itemId, tripId }`
* **Response**: `{ status: "success", type: "item_deleted", itemId, tripId, items: [...] }`

---

## 4. Frontend Components & User Flows

1. **Partner Switcher**:
   * Header badge button: `👤 Partner: Glen / Anne`
   * Clicking toggles between Glen and Anne or opens the Partner Identity modal.
   * Saves preference in `localStorage["saantayo_partner_identity_v1"]`.

2. **Shared Trips Modal**:
   * Replaces local-only Saved Trips view.
   * Auto-refreshes from Google Sheets via `list_trips`.
   * Displays destination, dates/created timestamp, saved items count pill (`📌 4 items`), and workspace status.
   * Clicking **Open** hydrates the trip itinerary and all saved items from Google Sheets.

3. **Shortlist Filter**:
   * Display-only filter bar with options: `All | Glen | Anne`.
   * Items visually display color-coded partner tags (`shortlist-user-glen` in cyan, `shortlist-user-anne` in pink).

---

## 5. Deployment Note

> [!WARNING]
> Whenever `apps-script/Code.gs` is updated in the repository, the Google Apps Script project backing `SaanTayo-BackEnd` must be deployed / updated to a new version in the Google Apps Script editor.
