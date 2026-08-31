# Universal Saved Items + Google Sheets Sync V1

## Overview

This release introduces SaanTayo's Universal Saved Items system.

Users can save travel recommendations from a trip and have those items synchronized through Google Sheets.

Google Sheets is the authoritative source of truth for Saved Items.

```text
Google Sheets = authoritative
localStorage = offline/cache fallback
```

## Supported Saved Items

Current supported item types:

```text
stay
food
transport
```

Examples include:

* Hotels and accommodations
* Restaurants and food spots
* Buses, vans, ferries, Grab routes, and other transportation options

The architecture is designed to support additional item types later, including:

```text
activity
flight
note
```

## SavedItems Schema

The Google Sheets `SavedItems` table uses:

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

### ItemID

Unique identifier for the Saved Item.

### TripID

Connects the Saved Item to its parent trip.

All items belonging to one shared trip use the same canonical TripID.

### ItemType

Identifies the type of Saved Item.

Examples:

```text
stay
food
transport
```

### DetailsJSON

Stores item-specific information without requiring separate spreadsheet columns for every feature.

Examples may include:

* Food: must-try dish and description
* Transportation: payment method and local tip
* Stay: property description and stay type

## Authoritative Synchronization

When a shared trip is opened online:

```text
Open trip
→ identify TripID
→ fetch Google Sheets data
→ load Saved Items
→ replace stale local state
→ update localStorage cache
→ render
```

Google Sheets remote data wins over stale localStorage data.

If the Google Sheets backend cannot be reached, cached localStorage data is preserved rather than being incorrectly replaced with an empty list.

## Save Flow

When a user saves an item:

```text
User saves item
→ write to Google Sheets
→ confirm successful write
→ obtain authoritative Saved Items
→ replace in-memory state
→ update localStorage
→ render
```

## Delete Flow

When a user deletes an item:

```text
User deletes item
→ delete using ItemID + TripID
→ Google Sheets updates
→ authoritative Saved Items returned
→ local state reconciled
→ localStorage updated
```

## Cross-Browser / Device Behavior

Saved Items are not dependent on one browser's localStorage.

A clean browser with no local SaanTayo storage can open the same shared TripID and restore Saved Items from Google Sheets.

This behavior was tested successfully before production deployment.

## Offline Behavior

localStorage is used as an offline/cache fallback.

If the remote sync service is unavailable:

* Existing cached Saved Items remain available
* Failed remote requests do not erase the cache
* The app can synchronize again when the backend becomes available

## Production Verification

The V1 release passed the following verification:

```text
Build: PASS
Static check: PASS
Automated tests: 78/78 PASS
git diff --check: PASS
```

Authoritative synchronization tests:

```text
Stay save: PASS
Food save: PASS
Transport save: PASS
Same TripID across item types: PASS
get_items authoritative read: PASS
Refresh hydration: PASS
Clean-browser remote hydration: PASS
Delete synchronization: PASS
Clean-browser hydration after delete: PASS
Offline cache preservation: PASS
Duplicate-save reconciliation: PASS
```

## Source-of-Truth Verification

Final result:

```text
GOOGLE SHEETS IS AUTHORITATIVE — PASS
```

The critical test was completed successfully:

```text
Clean browser
+ zero localStorage
+ valid shared TripID
→ Saved Items restored from Google Sheets
```

## Production Status

Universal Saved Items + Google Sheets Authoritative Sync V1:

```text
PRODUCTION COMPLETE
```

Verified: August 31, 2026.
