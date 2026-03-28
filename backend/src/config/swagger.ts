import swaggerJSDoc from "swagger-jsdoc";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { swaggerSchemas } from "./swaggerSchemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "RemitLend API",
    version: "1.0.0",
    description: "API documentation for RemitLend backend",
  },
  servers: [
    {
      url: "http://localhost:3001/api",
      description: "Development server",
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description:
          "Internal API key (`INTERNAL_API_KEY`) for score workers, webhooks, and admin operations",
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "JWT issued by POST /api/auth/login after POST /api/auth/challenge + signed message; use on GET /api/auth/verify and protected routes. Payload includes Stellar `publicKey`.",
      },
    },
    schemas: swaggerSchemas,
    schemas: {
      ErrorCode: {
        type: "string",
        enum: [
          "INVALID_AMOUNT",
          "INVALID_PUBLIC_KEY",
          "INVALID_SIGNATURE",
          "INVALID_CHALLENGE",
          "MISSING_FIELD",
          "VALIDATION_ERROR",
          "UNAUTHORIZED",
          "TOKEN_EXPIRED",
          "TOKEN_INVALID",
          "CHALLENGE_EXPIRED",
          "FORBIDDEN",
          "ACCESS_DENIED",
          "BORROWER_MISMATCH",
          "NOT_FOUND",
          "LOAN_NOT_FOUND",
          "USER_NOT_FOUND",
          "POOL_NOT_FOUND",
          "CONFLICT",
          "DUPLICATE_REQUEST",
          "RATE_LIMIT_EXCEEDED",
          "INTERNAL_ERROR",
          "DATABASE_ERROR",
          "EXTERNAL_SERVICE_ERROR",
          "BLOCKCHAIN_ERROR",
          "INSUFFICIENT_BALANCE",
          "LOAN_ALREADY_REPAID",
          "LOAN_NOT_ACTIVE",
          "INVALID_LOAN_ID",
          "INVALID_TX_XDR",
        ],
        description: "Machine-readable error code for programmatic handling",
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              code: { $ref: "#/components/schemas/ErrorCode" },
              message: { type: "string", example: "Amount must be a positive number" },
              field: { type: "string", example: "amount", description: "The field that caused the error (if applicable)" },
              details: {
                type: "object",
                description: "Additional error details (if applicable)",
              },
            },
            required: ["code", "message"],
          },
        },
        required: ["success", "error"],
      },
      ValidationErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "VALIDATION_ERROR" },
              message: { type: "string", example: "Validation failed" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string", example: "publicKey" },
                    message: { type: "string", example: "Public key is required" },
                    code: { type: "string", example: "invalid_type" },
                  },
                },
              },
            },
          },
        },
      },
      UserScore: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          userId: { type: "string" },
          score: { type: "integer", example: 700 },
          band: { type: "string", example: "Good" },
          factors: {
            type: "object",
            properties: {
              repaymentHistory: { type: "string" },
              creditMix: { type: "string" },
            },
          },
        },
      },
      RemittanceHistory: {
        type: "object",
        properties: {
          userId: { type: "string" },
          score: { type: "integer" },
          streak: { type: "integer" },
          history: {
            type: "array",
            items: {
              type: "object",
              properties: {
                paymentId: { type: "string" },
                amount: { type: "number" },
                status: { type: "string" },
                timestamp: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
  },
};

const options: swaggerJSDoc.Options = {
  swaggerDefinition,
  apis: [
    path.resolve(__dirname, "../routes/*.ts"),
    path.resolve(__dirname, "../routes/*.js"),
  ],
};

export const swaggerSpec = swaggerJSDoc(options);
