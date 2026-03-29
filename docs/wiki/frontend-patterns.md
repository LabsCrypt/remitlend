# Frontend Standard Library & Design Patterns

This guide documents the UI components and design patterns used in the Remitlend frontend.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **State Management**: Zustand (stores)
- **API Fetching**: Custom `useApi` hook

## Standard UI Components (The 'Standard Library')

Located in `frontend/src/app/components/ui`, these are atomic components used throughout the application.

### 1. Button
Our primary interaction element.
- **Props**: `variant` ("primary", "secondary", "outline", "ghost"), `size` ("sm", "md", "lg"), `isLoading`.
- **Usage**:
  ```tsx
  import { Button } from "@/components/ui/Button";
  
  <Button variant="primary" onClick={handleMint}>
    Mint NFT
  </Button>
  ```

### 2. Card
Used for grouping content, dashboard widgets, and loan details.
- **Props**: `title`, `description`, `footer`, `content`.

### 3. Modal
Standard dialog for user confirmations and forms.
- **Usage**: Controlled via a boolean state.

## Global UI Components

Located in `frontend/src/app/components/global_ui`.

- **Sidebar**: Main navigation for the application.
- **Header**: Contains the wallet connection button and user profile info.
- **DashboardShell**: A layout wrapper that includes the Sidebar and Header.

## Data Fetching Pattern (`useApi`)

We use a custom `useApi` hook to handle all interactions with the backend and contract data.

```tsx
const { data, loading, error, request } = useApi<{ score: number }>();

useEffect(() => {
  request({ url: "/api/score/123", method: "GET" });
}, []);
```

### Key Features of `useApi`:
- **Loading State**: Automatically managed.
- **Error Handling**: Standardized error reporting.
- **Caching**: Currently uses basic local state (consider React Query for larger apps).

## Design Principles

1. **Mobile First**: All layouts must be responsive and work on small screens first.
2. **Accessible (A11y)**: Use semantic HTML and appropriate ARIA labels.
3. **Consistent Spacing**: Use Tailwind's standard spacing units (e.g., `p-4`, `m-2`).
4. **Dark Mode Support**: Use Tailwind's `dark:` classes for all components.

## Directory Structure
- `src/app/components`: Reusable UI components.
- `src/app/hooks`: Custom React hooks.
- `src/app/stores`: Global state management with Zustand.
- `src/app/ui-demo`: Examples of using core UI components.
