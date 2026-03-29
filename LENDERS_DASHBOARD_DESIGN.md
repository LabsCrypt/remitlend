# RemitLend – Lenders Dashboard Design

## Project Overview

RemitLend's Lender Command Center is a high-performance dashboard built for liquidity providers managing complex yield strategies. The interface prioritizes real-time data accuracy, seamless asset deployment, and a consistent gamification loop — keeping lenders informed, in control, and engaged.

---

## Key Design Contributions

### Yield Data Visualization

Designed the **Total Yield Generated** interactive chart, giving lenders a clear view of their earnings over time. Users can toggle between timeframes (1D, 1W, 1M) to track percentage growth at a glance. The chart uses smooth curve rendering against the dark background to keep focus on the numbers.

### Asset Deployment Workflow

Developed the **Expand Position** component — a streamlined right-aligned sidebar that simplifies the deposit flow. Key details surfaced inline:

- Estimated APR based on current pool utilization
- Platform fee breakdown before confirmation
- Instant feedback on position size impact

### Active Position Tracking

Created a comprehensive **Position Monitoring** table that gives lenders a full picture of their deployed capital:

- Asset balances per pool
- Accrued yield with color-coded profit indicators (green for gains, amber for pending)
- Real-time transaction statuses — Active vs. Pending

### Risk & Health Metrics

Integrated **Pool Health bars** and risk-level indicators within the Prime Lending Pool cards. Each card surfaces:

- Current utilization rate
- Pool stability score driven by citadel governance data
- Risk tier label (Low / Medium / High) for quick scanning

### Gamified Retention

Integrated the **RemitLend Quests** sidebar to tie financial actions directly to XP rewards, maintaining the gamification loop established across the platform. Featured quests include:

- Whale Migration — reward for deploying above a threshold liquidity amount
- Iron Resolve — reward for maintaining an active position over a set duration

---

## Design Principles

- Data density without clutter — lenders need numbers fast, not buried
- Real-time feedback on every action
- Risk transparency — health and stability always visible, never hidden
- Consistent gamification loop across borrower and lender experiences

---

## Color Palette

| Role | Value |
|---|---|
| Background | `#0D0D12` (Obsidian) |
| Surface | `#16161F` |
| Primary Accent | `#7C3AED` (Neon Purple) |
| Secondary Accent | `#0ECFCF` (Teal) |
| Profit Indicator | `#22C55E` |
| Pending Indicator | `#F59E0B` |
| Danger / Loss | `#EF4444` |
| Text Primary | `#F1F5F9` |
| Text Muted | `#64748B` |

---

## Core UI Modules

### Total Yield Chart
- Line chart with timeframe toggle (1D / 1W / 1M)
- Percentage growth delta displayed above chart
- Smooth curve on dark canvas with teal stroke

### Expand Position Sidebar
- Right-aligned slide-in panel
- Input field for deposit amount
- Live Estimated APR and fee preview
- Confirm CTA with loading state

### Position Monitoring Table
- Columns: Asset, Pool, Balance, Accrued Yield, Status
- Color-coded yield values
- Status badges: Active (teal), Pending (amber)

### Prime Lending Pool Cards
- Pool name and asset pair
- Utilization bar with percentage label
- Risk tier badge
- Pool health score from governance data
- Deposit CTA

### RemitLend Quests Sidebar
- Active quest list with XP reward previews
- Progress bars tied to on-chain lender actions
- Completion animation on quest finish

---

## Design Goals for Future Iterations

- Historical yield export (CSV / PDF)
- Multi-pool rebalancing flow
- Notification alerts for pool health drops
- Mobile-optimized position monitoring view
