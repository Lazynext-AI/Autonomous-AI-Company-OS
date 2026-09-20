# Lazynext Design System (Penpot)

The product brand and UI language live in the self-hosted Penpot file at
`penpot.lazynext.com` → team `Lazynext` → file **"New File 1"** → Page 1.
Vector snapshots are committed to `design/` in this repo.

## Palette

| Token | Hex | Use |
|---|---|---|
| bg | `#0A0A0B` | page background |
| surface | `#141419` | cards, panels |
| border | `#26262E` | card strokes, dividers |
| accent | `#8B5CF6` | primary buttons, highlights |
| accent-soft | `#A78BFA` | links, secondary labels |
| text | `#FAFAFA` | headings, body |
| text-muted | `#9C9CAA` | captions, secondary text |
| success | `#34D399` | live status, positive deltas |

## Type scale

display 56 · h1 32 · h2 24 · h3 18 · body 14 · caption 12 · label 13

## Components

`Button/Primary` (purple pill), `Card/Default` (surface + border, radius 16),
`Badge/Status` (dark pill + green dot). Reusable in the Penpot library.

## Screens (design source for builds)

- `landing-page.svg` — marketing home
- `pricing.svg` — 3-tier pricing
- `onboarding-1..3.svg` — connect accounts → pick product → launch
- `login.svg` — sign-in
- `dashboard.svg` — founder control panel (sidebar + KPIs + live feed)
- `mobile.svg` — phone layout
- `api-keys.svg` — key management table
- `email-briefing.svg` — weekly briefing email template

## Usage

Frontend/build agents: match this palette and spacing when generating UI.
Penpot MCP can read/modify the file directly when the bridge is connected.
