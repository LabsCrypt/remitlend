export const swaggerSchemas = {
  ValidationError: {
    type: "object",
    properties: {
      path: { type: "string", example: "body.publicKey" },
      message: { type: "string", example: "Public key is required" },
    },
    required: ["path", "message"],
  },
  ErrorResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: false },
      message: { type: "string", example: "Validation failed" },
      errors: {
        type: "array",
        items: { $ref: "#/components/schemas/ValidationError" },
      },
      stack: { type: "string" },
    },
    required: ["success", "message"],
  },
  SimpleSuccessResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
    },
    required: ["success"],
  },
  SuccessMessageResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string", example: "Webhook subscription deleted" },
    },
    required: ["success", "message"],
  },
  ServerSentEventStream: {
    type: "string",
    example: 'data: {"type":"init"}\n\n',
  },
  ChallengeMessage: {
    type: "object",
    properties: {
      message: {
        type: "string",
        example:
          "Sign this message to authenticate with RemitLend.\n\nNonce: abc123\nTimestamp: 1700000000000\n\nThis request will expire in 5 minutes.",
      },
      nonce: { type: "string", example: "abc123def456" },
      timestamp: { type: "integer", example: 1700000000000 },
      expiresIn: { type: "integer", example: 300000 },
    },
    required: ["message", "nonce", "timestamp", "expiresIn"],
  },
  AuthChallengeResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/ChallengeMessage" },
    },
    required: ["success", "data"],
  },
  AuthLoginData: {
    type: "object",
    properties: {
      token: { type: "string" },
      publicKey: { type: "string" },
    },
    required: ["token", "publicKey"],
  },
  AuthLoginResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/AuthLoginData" },
    },
    required: ["success", "data"],
  },
  AuthVerifyData: {
    type: "object",
    properties: {
      publicKey: { type: "string", nullable: true },
      role: {
        type: "string",
        enum: ["admin", "borrower", "lender"],
        nullable: true,
      },
      scopes: {
        type: "array",
        items: { type: "string" },
      },
      valid: { type: "boolean", example: true },
    },
    required: ["valid"],
  },
  AuthVerifyResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/AuthVerifyData" },
    },
    required: ["success", "data"],
  },
  BorrowerLoan: {
    type: "object",
    properties: {
      loanId: { type: "integer" },
      principal: { type: "number" },
      accruedInterest: { type: "number" },
      totalRepaid: { type: "number" },
      totalOwed: { type: "number" },
      nextPaymentDeadline: { type: "string", format: "date-time" },
      status: {
        type: "string",
        enum: ["active", "repaid", "defaulted"],
      },
      borrower: { type: "string" },
      approvedAt: { type: "string", format: "date-time", nullable: true },
    },
    required: [
      "loanId",
      "principal",
      "accruedInterest",
      "totalRepaid",
      "totalOwed",
      "nextPaymentDeadline",
      "status",
      "borrower",
    ],
  },
  BorrowerLoansResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      borrower: { type: "string" },
      loans: {
        type: "array",
        items: { $ref: "#/components/schemas/BorrowerLoan" },
      },
    },
    required: ["success", "borrower", "loans"],
  },
  LoanSummaryEvent: {
    type: "object",
    properties: {
      type: { type: "string" },
      amount: { type: "string", nullable: true },
      timestamp: { type: "string", format: "date-time", nullable: true },
      tx: { type: "string", nullable: true },
    },
    required: ["type"],
  },
  LoanDetailsSummary: {
    type: "object",
    properties: {
      principal: { type: "number" },
      accruedInterest: { type: "number" },
      totalRepaid: { type: "number" },
      totalOwed: { type: "number" },
      interestRate: { type: "number" },
      termLedgers: { type: "integer" },
      elapsedLedgers: { type: "integer" },
      status: {
        type: "string",
        enum: ["active", "repaid", "defaulted"],
      },
      requestedAt: { type: "string", format: "date-time", nullable: true },
      approvedAt: { type: "string", format: "date-time", nullable: true },
      events: {
        type: "array",
        items: { $ref: "#/components/schemas/LoanSummaryEvent" },
      },
    },
    required: [
      "principal",
      "accruedInterest",
      "totalRepaid",
      "totalOwed",
      "interestRate",
      "termLedgers",
      "elapsedLedgers",
      "status",
      "events",
    ],
  },
  LoanDetailsResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      loanId: { type: "string" },
      summary: { $ref: "#/components/schemas/LoanDetailsSummary" },
    },
    required: ["success", "loanId", "summary"],
  },
  UnsignedTransactionResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      unsignedTxXdr: { type: "string" },
      networkPassphrase: { type: "string" },
    },
    required: ["success", "unsignedTxXdr", "networkPassphrase"],
  },
  RepayTransactionResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      loanId: { type: "integer" },
      unsignedTxXdr: { type: "string" },
      networkPassphrase: { type: "string" },
    },
    required: ["success", "loanId", "unsignedTxXdr", "networkPassphrase"],
  },
  SubmittedTransactionResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      txHash: { type: "string" },
      status: { type: "string" },
      resultXdr: { type: "string" },
    },
    required: ["success", "txHash", "status"],
  },
  PoolStats: {
    type: "object",
    properties: {
      totalDeposits: { type: "number" },
      totalOutstanding: { type: "number" },
      utilizationRate: { type: "number" },
      apy: { type: "number" },
      activeLoansCount: { type: "integer" },
    },
    required: [
      "totalDeposits",
      "totalOutstanding",
      "utilizationRate",
      "apy",
      "activeLoansCount",
    ],
  },
  PoolStatsResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/PoolStats" },
    },
    required: ["success", "data"],
  },
  DepositorPortfolio: {
    type: "object",
    properties: {
      address: { type: "string" },
      depositAmount: { type: "number" },
      sharePercent: { type: "number" },
      estimatedYield: { type: "number" },
      apy: { type: "number" },
      firstDepositAt: { type: "string", format: "date-time", nullable: true },
    },
    required: [
      "address",
      "depositAmount",
      "sharePercent",
      "estimatedYield",
      "apy",
    ],
  },
  DepositorPortfolioResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/DepositorPortfolio" },
    },
    required: ["success", "data"],
  },
  UserScoreFactors: {
    type: "object",
    properties: {
      repaymentHistory: { type: "string" },
      latePaymentPenalty: { type: "string" },
      range: { type: "string" },
    },
    required: ["repaymentHistory", "latePaymentPenalty", "range"],
  },
  UserScore: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      userId: { type: "string" },
      score: { type: "integer", example: 700 },
      band: {
        type: "string",
        enum: ["Excellent", "Good", "Fair", "Poor"],
      },
      factors: { $ref: "#/components/schemas/UserScoreFactors" },
    },
    required: ["success", "userId", "score", "band", "factors"],
  },
  ScoreUpdateResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      userId: { type: "string" },
      repaymentAmount: { type: "number" },
      onTime: { type: "boolean" },
      oldScore: { type: "integer" },
      delta: { type: "integer" },
      newScore: { type: "integer" },
      band: {
        type: "string",
        enum: ["Excellent", "Good", "Fair", "Poor"],
      },
    },
    required: [
      "success",
      "userId",
      "repaymentAmount",
      "onTime",
      "oldScore",
      "delta",
      "newScore",
      "band",
    ],
  },
  ScoreBreakdownMetrics: {
    type: "object",
    properties: {
      totalLoans: { type: "integer" },
      repaidOnTime: { type: "integer" },
      repaidLate: { type: "integer" },
      defaulted: { type: "integer" },
      totalRepaid: { type: "number" },
      averageRepaymentTime: { type: "string" },
      longestStreak: { type: "integer" },
      currentStreak: { type: "integer" },
    },
    required: [
      "totalLoans",
      "repaidOnTime",
      "repaidLate",
      "defaulted",
      "totalRepaid",
      "averageRepaymentTime",
      "longestStreak",
      "currentStreak",
    ],
  },
  ScoreHistoryEntry: {
    type: "object",
    properties: {
      date: { type: "string", nullable: true },
      score: { type: "integer" },
      event: { type: "string" },
    },
    required: ["date", "score", "event"],
  },
  ScoreBreakdownResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      userId: { type: "string" },
      score: { type: "integer" },
      band: {
        type: "string",
        enum: ["Excellent", "Good", "Fair", "Poor"],
      },
      breakdown: { $ref: "#/components/schemas/ScoreBreakdownMetrics" },
      history: {
        type: "array",
        items: { $ref: "#/components/schemas/ScoreHistoryEntry" },
      },
    },
    required: ["success", "userId", "score", "band", "breakdown", "history"],
  },
  RemittanceHistoryEntry: {
    type: "object",
    properties: {
      month: { type: "string" },
      amount: { type: "number" },
      status: { type: "string", enum: ["Completed", "Defaulted"] },
    },
    required: ["month", "amount", "status"],
  },
  RemittanceHistory: {
    type: "object",
    properties: {
      userId: { type: "string" },
      score: { type: "integer" },
      streak: { type: "integer" },
      history: {
        type: "array",
        items: { $ref: "#/components/schemas/RemittanceHistoryEntry" },
      },
    },
    required: ["userId", "score", "streak", "history"],
  },
  SimulatePaymentResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string" },
      newScore: { type: "integer" },
    },
    required: ["success", "message", "newScore"],
  },
  Notification: {
    type: "object",
    properties: {
      id: { type: "integer" },
      userId: { type: "string" },
      type: {
        type: "string",
        enum: [
          "loan_approved",
          "repayment_due",
          "repayment_confirmed",
          "loan_defaulted",
          "score_changed",
        ],
      },
      title: { type: "string" },
      message: { type: "string" },
      loanId: { type: "integer" },
      read: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "userId", "type", "title", "message", "read", "createdAt"],
  },
  NotificationsData: {
    type: "object",
    properties: {
      notifications: {
        type: "array",
        items: { $ref: "#/components/schemas/Notification" },
      },
      unreadCount: { type: "integer" },
    },
    required: ["notifications", "unreadCount"],
  },
  NotificationsResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/NotificationsData" },
    },
    required: ["success", "data"],
  },
  EventConnectionCounts: {
    type: "object",
    properties: {
      borrower: { type: "integer" },
      admin: { type: "integer" },
      total: { type: "integer" },
    },
    required: ["borrower", "admin", "total"],
  },
  EventStreamStatusResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/EventConnectionCounts" },
    },
    required: ["success", "data"],
  },
  LoanEventRecord: {
    type: "object",
    properties: {
      eventId: { type: "string" },
      eventType: {
        type: "string",
        enum: [
          "LoanRequested",
          "LoanApproved",
          "LoanRepaid",
          "LoanDefaulted",
          "Seized",
          "Paused",
          "Unpaused",
          "MinScoreUpdated",
        ],
      },
      loanId: { type: "integer" },
      borrower: { type: "string" },
      amount: { type: "string" },
      ledger: { type: "integer" },
      ledgerClosedAt: { type: "string", format: "date-time" },
      txHash: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      interestRateBps: { type: "integer" },
      termLedgers: { type: "integer" },
      contractId: { type: "string" },
      topics: {
        type: "array",
        items: { type: "string" },
      },
      value: { type: "string" },
    },
    required: [
      "eventId",
      "eventType",
      "borrower",
      "ledger",
      "ledgerClosedAt",
      "txHash",
    ],
  },
  Pagination: {
    type: "object",
    properties: {
      total: { type: "integer" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    },
    required: ["total", "limit", "offset"],
  },
  BorrowerEventsData: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: { $ref: "#/components/schemas/LoanEventRecord" },
      },
      pagination: { $ref: "#/components/schemas/Pagination" },
    },
    required: ["events", "pagination"],
  },
  BorrowerEventsResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/BorrowerEventsData" },
    },
    required: ["success", "data"],
  },
  LoanEventsData: {
    type: "object",
    properties: {
      loanId: { type: "integer" },
      events: {
        type: "array",
        items: { $ref: "#/components/schemas/LoanEventRecord" },
      },
    },
    required: ["loanId", "events"],
  },
  LoanEventsResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/LoanEventsData" },
    },
    required: ["success", "data"],
  },
  RecentEventsData: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: { $ref: "#/components/schemas/LoanEventRecord" },
      },
    },
    required: ["events"],
  },
  RecentEventsResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/RecentEventsData" },
    },
    required: ["success", "data"],
  },
  IndexerStatusData: {
    type: "object",
    properties: {
      lastIndexedLedger: { type: "integer" },
      lastIndexedCursor: { type: "string", nullable: true },
      lastUpdated: { type: "string", format: "date-time" },
      totalEvents: { type: "integer" },
      eventsByType: {
        type: "object",
        additionalProperties: { type: "integer" },
      },
    },
    required: [
      "lastIndexedLedger",
      "lastIndexedCursor",
      "lastUpdated",
      "totalEvents",
      "eventsByType",
    ],
  },
  IndexerStatusResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/IndexerStatusData" },
    },
    required: ["success", "data"],
  },
  WebhookSubscription: {
    type: "object",
    properties: {
      id: { type: "integer" },
      callbackUrl: { type: "string", format: "uri" },
      eventTypes: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "LoanRequested",
            "LoanApproved",
            "LoanRepaid",
            "LoanDefaulted",
            "Seized",
            "Paused",
            "Unpaused",
            "MinScoreUpdated",
          ],
        },
      },
      secret: { type: "string" },
      isActive: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
    required: [
      "id",
      "callbackUrl",
      "eventTypes",
      "isActive",
      "createdAt",
      "updatedAt",
    ],
  },
  WebhookSubscriptionListData: {
    type: "object",
    properties: {
      subscriptions: {
        type: "array",
        items: { $ref: "#/components/schemas/WebhookSubscription" },
      },
    },
    required: ["subscriptions"],
  },
  WebhookSubscriptionListResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/WebhookSubscriptionListData" },
    },
    required: ["success", "data"],
  },
  WebhookSubscriptionData: {
    type: "object",
    properties: {
      subscription: { $ref: "#/components/schemas/WebhookSubscription" },
    },
    required: ["subscription"],
  },
  WebhookSubscriptionResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/WebhookSubscriptionData" },
    },
    required: ["success", "data"],
  },
  WebhookDelivery: {
    type: "object",
    properties: {
      id: { type: "integer" },
      subscriptionId: { type: "integer" },
      eventId: { type: "string" },
      eventType: {
        type: "string",
        enum: [
          "LoanRequested",
          "LoanApproved",
          "LoanRepaid",
          "LoanDefaulted",
          "Seized",
          "Paused",
          "Unpaused",
          "MinScoreUpdated",
        ],
      },
      attemptCount: { type: "integer" },
      lastStatusCode: { type: "integer" },
      lastError: { type: "string" },
      deliveredAt: { type: "string", format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
    required: [
      "id",
      "subscriptionId",
      "eventId",
      "eventType",
      "attemptCount",
      "createdAt",
      "updatedAt",
    ],
  },
  WebhookDeliveriesData: {
    type: "object",
    properties: {
      subscriptionId: { type: "integer" },
      deliveries: {
        type: "array",
        items: { $ref: "#/components/schemas/WebhookDelivery" },
      },
    },
    required: ["subscriptionId", "deliveries"],
  },
  WebhookDeliveriesResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/WebhookDeliveriesData" },
    },
    required: ["success", "data"],
  },
  ReindexResult: {
    type: "object",
    properties: {
      fromLedger: { type: "integer" },
      toLedger: { type: "integer" },
      fetchedEvents: { type: "integer" },
      insertedEvents: { type: "integer" },
      lastProcessedLedger: { type: "integer" },
    },
    required: [
      "fromLedger",
      "toLedger",
      "fetchedEvents",
      "insertedEvents",
      "lastProcessedLedger",
    ],
  },
  ReindexResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/ReindexResult" },
    },
    required: ["success", "data"],
  },
  DefaultCheckBatchResult: {
    type: "object",
    properties: {
      loanIds: {
        type: "array",
        items: { type: "integer" },
      },
      txHash: { type: "string" },
      submitStatus: { type: "string" },
      txStatus: { type: "string" },
      error: { type: "string" },
    },
    required: ["loanIds"],
  },
  DefaultCheckRunResult: {
    type: "object",
    properties: {
      runId: { type: "string" },
      currentLedger: { type: "integer" },
      termLedgers: { type: "integer" },
      overdueCount: { type: "integer" },
      oldestDueLedger: { type: "integer" },
      ledgersPastOldestDue: { type: "integer" },
      batches: {
        type: "array",
        items: { $ref: "#/components/schemas/DefaultCheckBatchResult" },
      },
    },
    required: [
      "runId",
      "currentLedger",
      "termLedgers",
      "overdueCount",
      "batches",
    ],
  },
  DefaultCheckResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: "#/components/schemas/DefaultCheckRunResult" },
    },
    required: ["success", "data"],
  },
  // Error handling schemas for structured error codes (Issue #371)
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
  ErrorField: {
    type: "object",
    properties: {
      code: { $ref: "#/components/schemas/ErrorCode" },
      message: { type: "string", example: "Amount must be a positive number" },
      field: {
        type: "string",
        example: "amount",
        description: "The field that caused the error (if applicable)",
      },
      details: {
        type: "object",
        description: "Additional error details (if applicable)",
      },
    },
    required: ["code", "message"],
  },
  StructuredErrorResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: false },
      message: { type: "string", example: "Validation failed" },
      errors: {
        type: "array",
        items: { $ref: "#/components/schemas/ValidationError" },
      },
      error: { $ref: "#/components/schemas/ErrorField" },
      field: { type: "string" },
    },
    required: ["success", "error"],
  },
} as const;
