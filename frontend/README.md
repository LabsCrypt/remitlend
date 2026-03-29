# RemitLend Frontend

Next.js web application for the RemitLend platform, providing user interfaces for borrowers and lenders to interact with the decentralized lending protocol.

## Overview

The frontend is a modern React application built with Next.js that enables:

- Wallet connection (Freighter, Albedo, etc.)
- Credit score visualization
- Remittance NFT minting
- Loan request and management
- Lending pool participation
- Real-time transaction tracking

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **React**: 19.2.3
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Wallet Integration**: Stellar Wallet Kit (planned)
- **State Management**: React hooks + Context API (planned)

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Stellar wallet (Freighter recommended)

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Access the Application

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

```bash
# Development
npm run dev          # Start dev server with hot reload

# Production
npm run build        # Build for production
npm start            # Run production build

# Code Quality
npm run lint         # Check code quality with ESLint
```

## Project Structure

```
frontend/
├── src/
│   └── app/                    # Next.js App Router
│       ├── components/         # React components
│       │   └── global_ui/     # Reusable UI components
│       │       └── Spinner.tsx
│       ├── layout.tsx         # Root layout
│       ├── page.tsx           # Home page
│       ├── not-found.tsx      # 404 page
│       ├── globals.css        # Global styles
│       └── favicon.ico
├── public/                     # Static assets
│   ├── og-image.png
│   └── *.svg
├── next.config.ts             # Next.js configuration
├── tailwind.config.ts         # Tailwind CSS configuration
├── tsconfig.json              # TypeScript configuration
├── package.json
└── README.md
```

## Features

### Current Features

- Landing page with project overview
- Responsive design for mobile and desktop
- Loading states with spinner component
- SEO optimization with metadata
- Custom 404 page

### Planned Features

#### Borrower Dashboard

- [ ] Wallet connection interface
- [ ] Credit score display
- [ ] Remittance NFT minting
- [ ] Loan request form
- [ ] Active loans management
- [ ] Repayment interface
- [ ] Transaction history

#### Lender Dashboard

- [ ] Pool liquidity overview
- [ ] Deposit/withdraw interface
- [ ] Loan approval queue
- [ ] Yield tracking
- [ ] Portfolio analytics

#### Shared Features

- [ ] Real-time transaction status
- [ ] Notification system
- [ ] Multi-language support
- [ ] Dark mode toggle
- [ ] Wallet balance display

## Component Library

### Global UI Components

#### Spinner

Loading indicator component.

```tsx
import { Spinner } from "@/app/components/global_ui/Spinner";

<Spinner size="md" />;
```

**Props:**

- `size`: 'sm' | 'md' | 'lg' (default: 'md')

### Planned Components

- `Button` - Reusable button with variants
- `Card` - Container component
- `Modal` - Dialog component
- `Input` - Form input with validation
- `WalletConnect` - Wallet connection button
- `TransactionStatus` - Transaction feedback
- `LoanCard` - Loan information display
- `PoolStats` - Pool statistics display

## Styling

### Tailwind CSS

The project uses Tailwind CSS 4 for styling with a custom configuration.

**Key Features:**

- Utility-first CSS
- Responsive design utilities
- Custom color palette (planned)
- Dark mode support (planned)

**Example:**

```tsx
<div className="flex items-center justify-center min-h-screen bg-gray-50">
  <h1 className="text-4xl font-bold text-gray-900">Welcome to RemitLend</h1>
</div>
```

### Global Styles

Global styles are defined in `src/app/globals.css`:

- CSS reset
- Tailwind directives
- Custom CSS variables
- Typography defaults

## Wallet Integration

### Stellar Wallet Kit (Planned)

Integration with Stellar wallets for transaction signing.

**Supported Wallets:**

- Freighter
- Albedo
- Rabet
- xBull

**Example Usage:**

```tsx
import { StellarWalletKit } from "@stellar/wallet-kit";

const kit = new StellarWalletKit({
  network: "testnet",
  selectedWallet: "freighter",
});

// Connect wallet
await kit.connect();

// Sign transaction
const signedTx = await kit.sign(transaction);
```

## State Management

### React Context (Planned)

Global state management using React Context API.

**Contexts:**

- `WalletContext` - Wallet connection state
- `UserContext` - User profile and credit score
- `LoanContext` - Active loans data
- `PoolContext` - Lending pool information

**Example:**

```tsx
import { useWallet } from "@/contexts/WalletContext";

function MyComponent() {
  const { address, connected, connect, disconnect } = useWallet();

  return (
    <button onClick={connected ? disconnect : connect}>
      {connected ? `Connected: ${address}` : "Connect Wallet"}
    </button>
  );
}
```

## API Integration

### Backend API

The frontend communicates with the Express backend for off-chain data.

**Base URL:** `http://localhost:3001/api`

**Example:**

```tsx
async function fetchCreditScore(userId: string) {
  const response = await fetch(`http://localhost:3001/api/score/${userId}`);
  const data = await response.json();
  return data.score;
}
```

### Blockchain Integration

Direct interaction with Soroban smart contracts via Stellar SDK.

**Example:**

```tsx
import { Contract, SorobanRpc } from "@stellar/stellar-sdk";

const contract = new Contract(contractId);
const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// Call contract method
const result = await contract.call("get_score", [nftId]);
```

## Routing

### App Router Structure

Next.js 13+ App Router with file-based routing.

**Current Routes:**

- `/` - Landing page
- `/404` - Not found page

**Planned Routes:**

- `/borrower` - Borrower dashboard
- `/lender` - Lender dashboard
- `/loans` - Loan management
- `/loans/[id]` - Loan details
- `/pool` - Pool overview
- `/profile` - User profile

## SEO & Metadata

### Metadata Configuration

```tsx
export const metadata = {
  title: "RemitLend - Credit from Remittances",
  description: "Turn your remittance history into credit history",
  openGraph: {
    title: "RemitLend",
    description: "Decentralized lending for migrant workers",
    images: ["/og-image.png"],
  },
};
```

## Performance Optimization

### Next.js Features

- **Static Generation**: Pre-render pages at build time
- **Image Optimization**: Automatic image optimization
- **Code Splitting**: Automatic code splitting per route
- **Font Optimization**: Automatic font optimization

### Best Practices

- Use `next/image` for images
- Implement lazy loading for heavy components
- Minimize client-side JavaScript
- Use server components when possible
- Implement proper caching strategies

## Testing (Planned)

### Testing Stack

- **Unit Tests**: Jest + React Testing Library
- **E2E Tests**: Playwright or Cypress
- **Component Tests**: Storybook

### Example Test

```tsx
import { render, screen } from "@testing-library/react";
import { Spinner } from "@/app/components/global_ui/Spinner";

describe("Spinner", () => {
  it("renders spinner", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

## Deployment

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Docker

```bash
# Build image
docker build -t remitlend-frontend .

# Run container
docker run -p 3000:3000 remitlend-frontend
```

### Environment Variables

Create `.env.local` for local development:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

## Accessibility

### WCAG Compliance

The application aims for WCAG 2.1 Level AA compliance:

- Semantic HTML elements
- ARIA labels where needed
- Keyboard navigation support
- Color contrast ratios
- Screen reader compatibility

**Note:** Full WCAG compliance requires manual testing with assistive technologies.

## Browser Support

- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

### Code Style

- Use functional components with hooks
- Prefer TypeScript interfaces over types
- Use descriptive component names
- Keep components small and focused
- Extract reusable logic into custom hooks
- Follow Next.js best practices

### Before Submitting PR

```bash
npm run lint
npm run build
```

## Troubleshooting

### Port Already in Use

```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Build Errors

```bash
# Clean Next.js cache
rm -rf .next/
npm run build
```

### Module Not Found

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Stellar Documentation](https://developers.stellar.org)
- [Soroban Documentation](https://soroban.stellar.org/docs)

## License

ISC License - See LICENSE file for details.

## Support

- Open an issue for bug reports
- Check existing issues before creating new ones
- Provide browser and OS information
- Include screenshots for UI issues
