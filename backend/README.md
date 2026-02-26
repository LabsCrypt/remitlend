# RemitLend Backend API

Express.js backend service for the RemitLend platform, providing API endpoints for credit scoring, remittance simulation, and NFT metadata management.

## Overview

The backend serves as a bridge between the frontend application and the Stellar blockchain, handling:

- Credit score generation and verification
- Remittance history simulation (for MVP)
- NFT metadata provision
- API documentation via Swagger
- Request validation and rate limiting

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js 5
- **Language**: TypeScript
- **Validation**: Zod
- **Testing**: Jest + Supertest
- **Documentation**: Swagger/OpenAPI
- **Code Quality**: ESLint + Prettier

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm run dev
```

### Environment Variables

Create a `.env` file in the backend directory:

```env
# Server Configuration
PORT=3001

# CORS Configuration
CORS_ALLOWED_ORIGINS=http://localhost:3000

# Future: Add API keys for remittance services
# WISE_API_KEY=your_key_here
# WESTERN_UNION_API_KEY=your_key_here
```

## Available Scripts

```bash
# Development
npm run dev          # Start dev server with hot reload

# Production
npm run build        # Compile TypeScript to JavaScript
npm start            # Run production build

# Testing
npm test             # Run test suite
npm test -- --watch  # Run tests in watch mode
npm test -- --coverage  # Run tests with coverage

# Code Quality
npm run lint         # Check code quality
npm run lint:fix     # Fix linting issues
npm run format       # Format code with Prettier
npm run format:check # Check code formatting
```

## API Endpoints

### Health Check

**GET** `/api/health`

Check if the API is running.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Credit Score

**GET** `/api/score/:userId`

Get the credit score for a specific user based on their remittance history.

**Parameters:**

- `userId` (string) - User identifier

**Response:**

```json
{
  "userId": "user123",
  "score": 750,
  "history": {
    "totalTransactions": 24,
    "averageAmount": 500,
    "consistency": 0.95
  },
  "calculatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**

- `400` - Invalid user ID
- `404` - User not found
- `500` - Server error

### Simulate Remittance

**POST** `/api/score/simulate`

Simulate remittance history for testing purposes.

**Request Body:**

```json
{
  "userId": "user123",
  "transactions": [
    {
      "amount": 500,
      "date": "2024-01-01",
      "recipient": "family_member"
    }
  ]
}
```

**Response:**

```json
{
  "userId": "user123",
  "score": 750,
  "simulationId": "sim_abc123"
}
```

## API Documentation

Interactive API documentation is available via Swagger UI when the server is running:

**URL**: [http://localhost:3001/api-docs](http://localhost:3001/api-docs)

The Swagger documentation provides:

- Complete endpoint specifications
- Request/response schemas
- Interactive API testing
- Authentication details (when implemented)

## Project Structure

```
backend/
├── src/
│   ├── __tests__/           # Test files
│   │   ├── health.test.ts
│   │   ├── score.test.ts
│   │   ├── validation.test.ts
│   │   └── errorHandling.test.ts
│   ├── config/              # Configuration files
│   │   └── swagger.ts       # Swagger/OpenAPI config
│   ├── controllers/         # Request handlers
│   │   ├── scoreController.ts
│   │   └── simulationController.ts
│   ├── middleware/          # Express middleware
│   │   ├── asyncHandler.ts  # Async error wrapper
│   │   ├── auth.ts          # Authentication (planned)
│   │   ├── errorHandler.ts  # Error handling
│   │   ├── rateLimiter.ts   # Rate limiting
│   │   └── validation.ts    # Request validation
│   ├── routes/              # API routes
│   │   └── index.ts
│   ├── schemas/             # Zod validation schemas
│   │   ├── scoreSchemas.ts
│   │   └── simulationSchemas.ts
│   ├── errors/              # Custom error classes
│   │   └── AppError.ts
│   ├── app.ts               # Express app setup
│   └── index.ts             # Server entry point
├── .env.example             # Environment template
├── .eslintrc.cjs            # ESLint configuration
├── .prettierrc              # Prettier configuration
├── jest.config.js           # Jest configuration
├── tsconfig.json            # TypeScript configuration
├── package.json
└── README.md
```

## Middleware

### Error Handler

Centralized error handling middleware that catches and formats errors.

```typescript
import { errorHandler } from "./middleware/errorHandler";
app.use(errorHandler);
```

### Validation

Request validation using Zod schemas.

```typescript
import { validate } from "./middleware/validation";
import { mySchema } from "./schemas/mySchemas";

router.post("/endpoint", validate(mySchema), controller);
```

### Rate Limiter

Protects endpoints from abuse with configurable rate limits.

```typescript
import { rateLimiter } from "./middleware/rateLimiter";
app.use("/api/", rateLimiter);
```

### Async Handler

Wraps async route handlers to catch errors automatically.

```typescript
import { asyncHandler } from "./middleware/asyncHandler";

router.get(
  "/endpoint",
  asyncHandler(async (req, res) => {
    // Async code here
  }),
);
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- health.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Test Structure

```typescript
import request from "supertest";
import app from "../app";

describe("GET /api/health", () => {
  it("should return 200 OK", async () => {
    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toHaveProperty("status", "ok");
  });
});
```

### Test Coverage

Aim for >80% code coverage on new code. Current coverage:

- Statements: Check with `npm test -- --coverage`
- Branches: Check with `npm test -- --coverage`
- Functions: Check with `npm test -- --coverage`
- Lines: Check with `npm test -- --coverage`

## Error Handling

### Custom Error Class

```typescript
import { AppError } from "./errors/AppError";

throw new AppError("User not found", 404);
```

### Error Response Format

```json
{
  "success": false,
  "message": "Error message",
  "statusCode": 400,
  "errors": []
}
```

## Validation Schemas

Validation schemas are defined using Zod in the `schemas/` directory.

### Example Schema

```typescript
import { z } from "zod";

export const getUserScoreSchema = z.object({
  params: z.object({
    userId: z.string().min(1, "User ID is required"),
  }),
});

export const simulateRemittanceSchema = z.object({
  body: z.object({
    userId: z.string().min(1),
    transactions: z.array(
      z.object({
        amount: z.number().positive(),
        date: z.string(),
        recipient: z.string(),
      }),
    ),
  }),
});
```

## Future Enhancements

### Phase 1: Real Remittance Integration

- [ ] Wise API integration
- [ ] Western Union API integration
- [ ] Remittance data verification
- [ ] Historical data import

### Phase 2: Enhanced Features

- [ ] User authentication (JWT)
- [ ] Database integration (PostgreSQL)
- [ ] IPFS integration for NFT metadata
- [ ] Webhook support for blockchain events

### Phase 3: Production Ready

- [ ] Caching layer (Redis)
- [ ] Logging and monitoring
- [ ] CI/CD pipeline
- [ ] Load balancing support
- [ ] API versioning

## Deployment

### Docker

```bash
# Build image
docker build -t remitlend-backend .

# Run container
docker run -p 3001:3001 --env-file .env remitlend-backend
```

### Docker Compose

From the project root:

```bash
docker compose up backend
```

### Production Considerations

- Set `NODE_ENV=production`
- Use process manager (PM2, systemd)
- Enable HTTPS
- Configure proper CORS origins
- Set up monitoring and logging
- Implement health checks
- Use environment-specific configs

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to the backend.

### Code Style

- Follow TypeScript best practices
- Use async/await over callbacks
- Maintain strict typing
- Write descriptive variable names
- Add JSDoc comments for public functions
- Keep functions small and focused

### Before Submitting PR

```bash
# Run all checks
npm run lint
npm run format:check
npm test
npm run build
```

## Troubleshooting

### Port Already in Use

```bash
# Find and kill process on port 3001
lsof -ti:3001 | xargs kill -9
```

### TypeScript Errors

```bash
# Clean build
rm -rf dist/
npm run build
```

### Module Not Found

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## License

ISC License - See LICENSE file for details.

## Support

- Open an issue for bug reports
- Check existing issues before creating new ones
- Provide detailed reproduction steps
- Include error messages and logs
