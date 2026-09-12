export const trip = {
  mode: "itinerary",
  destination: "Cebu City",
  destinationB: "",
  days: 3,
  people: 2,
  party: "Couple / Partner",
  vibes: ["Must-Try Food & Local Eats"],
  currency: "PHP_CAD",
  budgets: { total: 15000, hotel: 2500, transit: 2000, activities: 2000 },
  strict: true,
};
export const costs = {
  items: [
    {
      label: "Room",
      category: "accommodation",
      unitPHP: 1800,
      basis: "group_night",
      quantity: 1,
    },
    {
      label: "Meals",
      category: "food",
      unitPHP: 600,
      basis: "person_day",
      quantity: 1,
    },
    {
      label: "City transfers",
      category: "local_transport",
      unitPHP: 800,
      basis: "group_once",
      quantity: 1,
    },
    {
      label: "No intercity travel",
      category: "intercity_transport",
      unitPHP: 0,
      basis: "group_once",
      quantity: 1,
    },
    {
      label: "Admission",
      category: "activities",
      unitPHP: 200,
      basis: "person_once",
      quantity: 2,
    },
    {
      label: "Buffer",
      category: "miscellaneous",
      unitPHP: 500,
      basis: "group_once",
      quantity: 1,
    },
  ],
  missing: [],
  assumptions: [
    "Synthetic test estimate, not researched prices.",
    "One room for two adults; flights excluded.",
  ],
};
const transitFixture = `\n\n\`\`\`transit
[
  {
    "mode": "grab",
    "label": "Airport to Cebu IT Park",
    "origin": "Mactan-Cebu International Airport",
    "destination": "Cebu IT Park",
    "vehicle": "GrabCar",
    "duration": "35-60 min",
    "estimatedCostPHP": "₱350 - ₱550",
    "paymentCaveat": "Confirm the live fare and available cash or linked-payment option in the Grab app before booking.",
    "signboard": "",
    "steps": [
      {
        "title": "Open Grab at the airport",
        "instruction": "Set the pickup point to the designated ride-hailing pickup area shown in the app.",
        "landmark": "Mactan-Cebu International Airport arrivals",
        "transferTo": "GrabCar"
      },
      {
        "title": "Ride to Cebu IT Park",
        "instruction": "Confirm the plate and driver, then ride directly to Cebu IT Park.",
        "landmark": "Cebu IT Park",
        "transferTo": ""
      }
    ]
  },
  {
    "mode": "local",
    "label": "Jeepney connection to Cebu IT Park",
    "origin": "Ayala Center Cebu",
    "destination": "Cebu IT Park",
    "vehicle": "Jeepney",
    "duration": "15-30 min",
    "estimatedCostPHP": "₱15 - ₱30",
    "paymentCaveat": "Carry small PHP cash for the jeepney fare; do not assume a Beep card is accepted.",
    "signboard": "IT PARK / LAHUG",
    "steps": [
      {
        "title": "Find the local jeepney loading area",
        "instruction": "Go to the designated public-transport loading area near Ayala Center Cebu and confirm the current route with the dispatcher.",
        "landmark": "Ayala Center Cebu",
        "transferTo": "Jeepney marked IT PARK / LAHUG"
      },
      {
        "title": "Check the dashboard signboard",
        "instruction": "Board only after confirming the vehicle is serving Cebu IT Park and tell the driver your stop.",
        "landmark": "Jeepney dashboard / windshield sign",
        "transferTo": "Cebu IT Park"
      },
      {
        "title": "Get off at Cebu IT Park",
        "instruction": "Ask the driver to signal the correct drop-off, then continue on foot inside the district.",
        "landmark": "Cebu IT Park",
        "transferTo": ""
      }
    ]
  }
]
\`\`\``;
export function interaction(
  text = "## Day 1 — Cebu City\n\nMorning: Explore the heritage district.\n\nLunch: Local food in the same neighbourhood.\n\nAfternoon: Allow time for heat and traffic.\n\nEvening: Keep dinner close to your base.\n\nEstimated room: ₱1,800 per group per night. Meals: ₱600 per person per day.\n\n**Needs confirmation:** opening hours and transport prices.\n\n| Area | Transport | Notes |\n|---|---|---|\n| Heritage district | Walk / taxi | Keep activities clustered |" + transitFixture,
  maps = true,
) {
  return {
    id: "test-interaction-1",
    status: "completed",
    steps: [
      {
        type: "google_search_call",
        arguments: { queries: ["Synthetic travel test"] },
      },
      {
        type: "google_search_result",
        result: [
          {
            search_suggestions:
              '<style>.suggestion{padding:12px;color:#67e8f9}</style><div class="suggestion"><a href="https://www.google.com/search?q=Cebu">Google Search · synthetic fixture</a></div>',
          },
        ],
      },
      ...(maps
        ? [{ type: "google_maps_call", arguments: { queries: ["Cebu"] } }]
        : []),
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text,
            annotations: [
              {
                type: "url_citation",
                title:
                  "Synthetic source · Official operator — a deliberately long source name for mobile wrapping",
                url: "https://example.com/operator",
                start_index: 0,
                end_index: 10,
              },
              ...(maps
                ? [
                    {
                      type: "place_citation",
                      name: "Synthetic Cebu place",
                      url: "https://maps.google.com/?q=Cebu",
                      start_index: 0,
                      end_index: 10,
                      review_snippets: [
                        {
                          title: "Synthetic review",
                          url: "https://maps.google.com/?q=Cebu+reviews",
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
}
export const env = {
  GEMINI_API_KEY: "unit-test-only",
  CONVERSATION_SECRET: "unit-test-signing-secret-not-a-real-secret-12345",
  ALLOWED_ORIGINS: "https://geng-geng8.github.io",
  ENABLE_GROUNDING: "true",
  AI_LIMITER: { limit: async () => ({ success: true }) },
};
export function apiRequest(path = "travel", body = {}, options = {}) {
  return new Request(`https://api.example/api/${path}`, {
    method: "POST",
    headers: {
      Origin: "https://geng-geng8.github.io",
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(body),
    ...options,
  });
}
