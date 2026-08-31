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
* `save_item`
* `get_items`
* `delete_item`

Backward-compatible stay actions may also be supported during migration.

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

### Current Item Types

```text
stay
food
transport
```

The schema is designed to support additional types later, including:

```text
activity
flight
note
```

## Saved Item Synchronization

The normal online flow is:

```text
Open shared trip
→ identify TripID
→ fetch trip from Google Sheets
→ fetch Saved Items
→ replace in-memory saved state
→ update localStorage cache
→ render UI
```

After a Saved Item mutation:

```text
Save or delete item
→ write to Google Sheets
→ receive/fetch authoritative Saved Items
→ replace local state
→ update localStorage
→ render
```

This prevents localStorage from becoming the accidental source of truth.

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

## Current Production Baseline

Universal Saved Items + Google Sheets authoritative synchronization V1 supports:

* Saved accommodations
* Saved food spots
* Saved transportation options
* Cross-browser Saved Item hydration
* Shared TripID synchronization
* Remote delete reconciliation
* Offline cache fallback

Production verification baseline:

```text
Build: PASS
Static checks: PASS
Automated tests: 78/78 PASS
Clean-browser remote hydration: PASS
```

Last verified: August 31, 2026.
