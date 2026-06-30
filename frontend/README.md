# RemitLend Frontend

Next.js web application for the RemitLend platform, providing user interfaces for borrowers and lenders to interact with the decentralized lending protocol.

## Overview

The frontend is a modern React application built with Next.js that enables:

- Wallet connection via Freighter
- Credit score visualisation
- Remittance NFT minting
- Loan request and management
- Lending pool participation
- Real-time transaction tracking
- Notifications and activity streams

## Tech Stack

| Layer                  | Technology                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| Framework              | Next.js 16 (App Router)                                                 |
| React                  | 19.2.3                                                                  |
| Language               | TypeScript                                                              |
| Styling                | Tailwind CSS 4 (`@import "tailwindcss"` in globals.css, no config file) |
| State management       | Zustand 5                                                               |
| Server state / caching | TanStack React Query 5                                                  |
| Wallet integration     | `@stellar/freighter-api`                                                |
| Blockchain SDK         | `@stellar/stellar-sdk`                                                  |
| Internationalisation   | next-intl 4 (locales: `en`, `es`, `tl`)                                 |
| Charts                 | Recharts                                                                |
| Animation              | Framer Motion                                                           |
| Notifications          | Sonner                                                                  |
| Monitoring             | Sentry                                                                  |
| PWA                    | Serwist                                                                 |

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm
- Freighter browser extension (for wallet features)

### Installation

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Production build
npm start            # Serve production build
npm run lint         # Check formatting with Prettier (not ESLint)
npm run format       # Auto-format with Prettier
npm run typecheck    # TypeScript type check (tsc --noEmit)
npm test             # Jest unit tests
npm run test:watch   # Jest in watch mode
npm run test:e2e     # Playwright end-to-end tests
npm run audit:a11y   # Build then run axe-playwright accessibility audit
```

> **Note:** `npm run lint` runs `prettier --check` — it checks formatting, not ESLint rules.
> ESLint runs automatically via `lint-staged` on pre-commit.

## Project Structure

```
frontend/
├── e2e/                        # Playwright end-to-end tests
│   ├── borrower-loan-flow.spec.ts
│   ├── criticalFlows.spec.ts
│   └── ...
├── messages/                   # next-intl translation files
│   ├── en.json
│   ├── es.json
│   └── tl.json
├── src/
│   └── app/
│       ├── [locale]/           # Localised routes (en / es / tl)
│       │   ├── layout.tsx
│       │   ├── page.tsx        # Landing page
│       │   ├── globals.css     # Tailwind 4 entry + CSS custom properties
│       │   ├── loans/          # Borrower loan list + [loanId] detail
│       │   ├── lend/           # Lender dashboard
│       │   ├── wallet/         # Wallet connection & balance
│       │   ├── remittances/    # Remittance NFT viewer
│       │   ├── send-remittance/
│       │   ├── request-loan/
│       │   ├── repay/
│       │   ├── notifications/
│       │   ├── analytics/
│       │   ├── activity/
│       │   ├── settings/
│       │   ├── liquidations/
│       │   ├── kingdom/
│       │   ├── admin/          # Admin governance
│       │   └── ui-demo/        # Dev-only component gallery (404 in production)
│       ├── components/
│       │   ├── ui/             # Design-system primitives (22 components)
│       │   ├── global_ui/      # App-shell components (Spinner, ErrorBoundary …)
│       │   ├── borrower/
│       │   ├── lender/
│       │   └── remittance/
│       ├── stores/             # Zustand stores
│       │   ├── useWalletStore.ts
│       │   ├── useUserStore.ts
│       │   ├── useThemeStore.ts
│       │   ├── useUIStore.ts
│       │   ├── useToastStore.ts
│       │   └── useGamificationStore.ts
│       ├── hooks/              # Custom React hooks
│       ├── lib/                # API clients and utilities
│       └── utils/              # Pure helpers (cn, stellar, amount, csv …)
├── i18n.config.ts
├── next.config.ts
├── postcss.config.mjs
├── playwright.config.ts
├── jest.config.js
├── tsconfig.json
└── package.json
```

## Routing

All pages are nested under the `[locale]` segment, so every URL is prefixed with the active locale:

| Route                       | Description                 |
| --------------------------- | --------------------------- |
| `/[locale]`                 | Landing page                |
| `/[locale]/wallet`          | Wallet connection           |
| `/[locale]/loans`           | Loan list                   |
| `/[locale]/loans/[loanId]`  | Loan detail                 |
| `/[locale]/lend`            | Lender dashboard            |
| `/[locale]/request-loan`    | New loan request            |
| `/[locale]/repay`           | Repayment flow              |
| `/[locale]/remittances`     | Remittance NFT gallery      |
| `/[locale]/send-remittance` | Send remittance             |
| `/[locale]/notifications`   | Notification inbox          |
| `/[locale]/activity`        | Activity log                |
| `/[locale]/analytics`       | Analytics dashboard         |
| `/[locale]/settings`        | User settings               |
| `/[locale]/liquidations`    | Liquidation queue           |
| `/[locale]/kingdom`         | Gamification / Kingdom view |
| `/[locale]/admin`           | Governance admin            |
| `/[locale]/ui-demo`         | Dev-only component gallery  |
| `/[locale]/not-found`       | 404 page                    |

## State Management

Global state is managed with **Zustand 5** stores:

| Store                  | Responsibility                                              |
| ---------------------- | ----------------------------------------------------------- |
| `useWalletStore`       | Freighter wallet connection, public key, signing            |
| `useUserStore`         | User profile and credit score                               |
| `useThemeStore`        | Light / dark / system theme with `localStorage` persistence |
| `useUIStore`           | Modal and sidebar open/close state                          |
| `useToastStore`        | Toast queue used by `useToast` hook                         |
| `useGamificationStore` | Kingdom / XP state                                          |

TanStack React Query handles server-state caching and background refetching for all API calls.

## Wallet Integration

Wallet integration uses **`@stellar/freighter-api`**:

```tsx
import { isConnected, getPublicKey, signTransaction } from "@stellar/freighter-api";

const connected = await isConnected();
const publicKey = await getPublicKey();
const signedXdr = await signTransaction(xdr, { networkPassphrase });
```

Wallet state (public key, connection status) is managed by `useWalletStore`.

## Component Library

Design-system primitives live in [`src/app/components/ui/`](src/app/components/ui/). There are 22 components:

### Core primitives

| Component                                                                              | Props                                                                                                                                     | Description                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `Button`                                                                               | `variant` (`primary`\|`secondary`\|`outline`\|`ghost`\|`danger`), `size` (`sm`\|`md`\|`lg`\|`icon`), `isLoading`, `leftIcon`, `rightIcon` | Polymorphic button with loading spinner               |
| `Input`                                                                                | `label`, `error`, `helperText`, `leftIcon`, `rightIcon`                                                                                   | Labelled text input with accessible error/helper text |
| `Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter` | `className`                                                                                                                               | Compound card layout                                  |
| `Modal`                                                                                | `isOpen`, `onClose`, `title`, `size` (`sm`\|`md`\|`lg`\|`xl`), `ariaLabel`                                                                | Focus-trapped animated dialog                         |

### Feedback & status

| Component                                                                                         | Props                                                                                   | Description                                             |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `Skeleton` / `SkeletonText` / `SkeletonCard` / `SkeletonRow` / `SkeletonChart` / `SkeletonAvatar` | `className`, `lines` (SkeletonText)                                                     | Loading placeholders                                    |
| `EmptyState`                                                                                      | `icon`, `title`, `description`, `actionLabel`, `actionHref` \| `onAction`, `actionIcon` | Zero-state placeholder with optional CTA                |
| `StatusIndicator`                                                                                 | `label`, `tone` (`success`\|`danger`\|`warning`\|`info`\|`neutral`), `icon`, `iconOnly` | Coloured badge pill                                     |
| `LoanStatusBadge`                                                                                 | `status` (`active`\|`pending`\|`repaid`\|`defaulted`\|`liquidated`)                     | Domain-specific status badge                            |
| `Toast` / `Toaster`                                                                               | —                                                                                       | Toast notification components backed by `useToastStore` |

### Controls & utilities

| Component                  | Props                                                                                                    | Description                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `Tooltip`                  | `content`, `label`, `iconClassName`                                                                      | Hover/focus tooltip with info icon               |
| `PaginationControls`       | `currentPage`, `totalPages`, `hasPrevious`, `hasNext`, `onPageChange`, `onPrevious`, `onNext`, `summary` | Page navigation with ellipsis windowing          |
| `CopyButton`               | `value`                                                                                                  | Clipboard copy with check feedback               |
| `TxHashLink`               | `txHash`, `chars`                                                                                        | Truncated hash with copy + Stellar Explorer link |
| `ThemeToggle`              | —                                                                                                        | Light / dark / system switcher                   |
| `ConfirmTransactionDialog` | —                                                                                                        | Pre-submit transaction confirmation modal        |
| `OperationProgress`        | —                                                                                                        | Multi-step operation stepper                     |
| `RepaymentProgress`        | —                                                                                                        | Loan repayment progress bar                      |
| `LoanTimeline`             | —                                                                                                        | Chronological loan event list                    |
| `TransactionStatusTracker` | —                                                                                                        | Live transaction polling status                  |
| `CreditScoreGauge`         | —                                                                                                        | Circular credit score visualisation              |
| `CreditScoreBreakdown`     | —                                                                                                        | Score factor breakdown chart                     |

> A live, interactive gallery is available in development at `/[locale]/ui-demo` (returns 404 in production).

## Styling

Tailwind CSS 4 is configured via CSS-first `@import "tailwindcss"` in
[`src/app/[locale]/globals.css`](src/app/%5Blocale%5D/globals.css) — there is no
`tailwind.config.ts` file. Design tokens are declared as CSS custom properties in `:root`:

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
  --focus-ring: #2563eb;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

Dark mode is driven by the `.dark` class (set by `useThemeStore`) and also respects
`prefers-color-scheme`.

## Testing

### Unit tests — Jest + React Testing Library

```bash
npm test            # run once
npm run test:watch  # interactive watch mode
```

Test files sit alongside source files (`*.test.ts` / `*.test.tsx`). Key test suites:

- `src/app/stores/stores.test.ts` — Zustand store logic
- `src/app/utils/*.test.ts` — pure utility functions
- `src/app/components/**/*.test.tsx` — component rendering

### End-to-end tests — Playwright

```bash
npm run test:e2e
```

Specs live in `e2e/` and cover critical user flows:

- `borrower-loan-flow.spec.ts`
- `borrower-repay-flow.spec.ts`
- `lender-withdraw-flow.spec.ts`
- `notifications-inbox.spec.ts`
- `remittance-nft-viewer.spec.ts`
- `admin-governance.spec.ts`
- `criticalFlows.spec.ts`

### Accessibility audit

```bash
npm run audit:a11y   # builds then runs axe-playwright
```

## API Integration

The frontend talks to the Express backend for off-chain data and uses `@stellar/stellar-sdk`
directly for on-chain calls.

**Backend base URL:** `NEXT_PUBLIC_API_URL` (default: `http://localhost:3001`)

## Deployment

### Vercel (recommended)

```bash
npm i -g vercel
vercel
```

### Docker

```bash
docker build -t remitlend-frontend .
docker run -p 3000:3000 remitlend-frontend
```

### Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

## Troubleshooting

```bash
# Port in use
lsof -ti:3000 | xargs kill -9

# Stale Next.js cache
rm -rf .next/ && npm run build

# Reinstall dependencies
rm -rf node_modules package-lock.json && npm install
```

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [Zustand Documentation](https://zustand.docs.pmnd.rs)
- [TanStack React Query](https://tanstack.com/query/latest)
- [Stellar Documentation](https://developers.stellar.org)
- [next-intl Documentation](https://next-intl-docs.vercel.app)

## License

ISC License — see LICENSE file for details.
