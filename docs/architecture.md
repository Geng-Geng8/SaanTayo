# SaanTayo Architecture

## Overview

SaanTayo is a lightweight AI travel planning PWA focused on Philippines travel.

The application uses a static frontend, a serverless AI backend, and Google Sheets for collaborative trip storage.

## System Architecture

```text
User Browser
   │
   ├── GitHub Pages
   │      └── SaanTayo frontend
   │
   ├── Cloudflare Worker
   │      └── Gemini travel requests
   │
   └── Google Apps Script
          └── Google Sheets
                 ├── Trips
                 └── SavedItems
```

## Frontend — GitHub Pages

The SaanTayo frontend is hosted on GitHub Pages.

The frontend handles:

* Trip creation and itinerary display
* Accommodation recommendations
* Food recommendations
* Transportation recommendations
* Saved Items UI
* Shared-trip links
* Offline/cache behavior
* PWA functionality

The browser does not store Gemini API credentials.

## AI Backend — Cloudflare Worker

AI requests are sent through a Cloudflare Worker.

The Worker acts as the server-side boundary between the browser and Gemini.

Responsibilities include:

* Receiving travel-planning requests
* Keeping Gemini credentials server-side
* Calling Gemini
* Returning structured travel results
* Applying request validation and backend protections

## Gemini

SaanTayo uses Gemini for travel intelligence and itinerary generation.

Generated travel information can include:

* Daily itineraries
* Accommodations
* Food and dining recommendations
* Transportation options
* Travel logistics
* Budget guidance

Structured recommendation data is returned to the frontend for rendering.

## Google Apps Script

Google Apps Script provides the synchronization layer between SaanTayo and Google Sheets.

It supports operations including:

* `save_trip`
* `get_trip`
* `list_trips` (compact shared trip discovery without heavy blobs)
* `save_item`
* `get_items`
* `delete_item`

Backward-compatible stay actions may also be supported during migration.

## Partner Identity System

SaanTayo is tailored for two partners:

```text
Glen (Canada base)
Anne (Philippines base)
```

The application uses a lightweight, client-side identity key:

```text
localStorage: saantayo_partner_identity_v1 ("Glen" | "Anne")
```

New saved items (accommodations, dining spots, activities, transit) record the active partner identity in the `SavedBy` column on Google Sheets.

The Shortlist drawer includes a display-only partner filter (`All | Glen | Anne`).

## Google Sheets

Google Sheets stores shared trip information and Saved Items.

### Source-of-Truth Rule

```text
Google Sheets = authoritative source of truth
localStorage = offline/cache fallback
```

When a shared trip is opened online, remote Google Sheets data replaces stale local Saved Items.

If the remote service is unavailable, localStorage can preserve previously cached data until synchronization is available again.

## Trips Schema

The `Trips` sheet stores the main trip record.

```text
TripID
CreatedAt
Destination
StartDate
EndDate
TripDataJSON
```

### TripID

The canonical UUID used to associate a trip with all of its Saved Items.

The same TripID is used across:

* Shared trip URLs
* Trip records
* Saved Items
* Google Apps Script requests
* Local cache

## SavedItems Schema

The `SavedItems` sheet stores items users choose to keep for a trip.

```text
ItemID
TripID
CreatedAt
ItemType
Name
Location
Category
Price
Link
SavedBy
Status
DetailsJSON
```

### Supported Item Types

```text
stay
food
transport
activity
flight
note
```

## Saved Item & Trip Synchronization

The normal online flow is:

```text
Open Shared Trips modal
→ call list_trips
→ render remote shared trip workspaces (including orphan saved-item trips)

Open shared trip
→ identify TripID
→ fetch trip from Google Sheets (get_trip)
→ fetch Saved Items (get_items)
→ replace in-memory saved state
→ update localStorage cache
→ render UI
```

After a Saved Item mutation:

```text
Save or delete item
→ write to Google Sheets (with active Partner identity)
→ receive/fetch authoritative Saved Items
→ replace local state
→ update localStorage
→ render
```

### Auto-Refresh & Background Polling

To ensure Glen and Anne see each other's updates seamlessly:
* `window.focus` and `document.visibilitychange` trigger debounced auto-sync.
* Opening the Shortlist or Shared Trips modal refreshes remote state.
* A background polling loop (every 50 seconds when visible/online) keeps active workspaces fresh.
* Request guards prevent duplicate or overlapping network requests.

## Deployment

### Frontend

Hosted with GitHub Pages.

### AI Backend

Hosted with Cloudflare Workers.

### Collaborative Storage Backend

Hosted using:

```text
Google Apps Script
        ↓
Google Sheets
```

## Production Baseline

Shared Trip Workspace V1 + Universal Saved Items baseline:

```text
Build: PASS
Static checks: PASS
Automated tests: 90/90 PASS
Clean-browser remote hydration: PASS
Partner identity & cross-device attribution: PASS
```
