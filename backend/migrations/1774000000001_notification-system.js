/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // Create notification_preferences table
  pgm.createTable("notification_preferences", {
    id: {
      type: "serial",
      primaryKey: true,
    },
    user_id: {
      type: "varchar(255)",
      notNull: true,
      unique: true,
      references: '"user_profiles"(public_key)',
      onDelete: "CASCADE",
    },
    // Email preferences
    email_enabled: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    email_loan_status_updates: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    email_payment_reminders: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    email_payment_overdue: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    email_loan_disbursement: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    email_marketing: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    email_account_alerts: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    // SMS preferences
    sms_enabled: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    sms_loan_status_updates: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    sms_payment_reminders: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    sms_payment_overdue: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    sms_loan_disbursement: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    sms_marketing: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    sms_account_alerts: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    sms_use_whatsapp: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    // General preferences
    timezone: {
      type: "varchar(50)",
      notNull: true,
      default: "UTC",
    },
    language: {
      type: "varchar(10)",
      notNull: true,
      default: "en",
    },
    // Timestamps
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  // Add indexes
  pgm.createIndex("notification_preferences", ["user_id"]);
  pgm.createIndex("notification_preferences", ["email_enabled"]);
  pgm.createIndex("notification_preferences", ["sms_enabled"]);

  // Add phone column to user_profiles if it doesn't exist
  pgm.addColumns("user_profiles", {
    phone: {
      type: "varchar(20)",
      unique: true,
    },
    phone_verified: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    email_verified: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });

  // Create notification_logs table for tracking sent notifications
  pgm.createTable("notification_logs", {
    id: {
      type: "serial",
      primaryKey: true,
    },
    user_id: {
      type: "varchar(255)",
      notNull: true,
      references: '"user_profiles"(public_key)',
      onDelete: "CASCADE",
    },
    notification_type: {
      type: "varchar(50)",
      notNull: true,
    },
    channel: {
      type: "varchar(10)",
      notNull: true, // 'email', 'sms', 'whatsapp'
    },
    status: {
      type: "varchar(20)",
      notNull: true, // 'sent', 'failed', 'pending'
    },
    recipient: {
      type: "varchar(255)",
      notNull: true, // email address or phone number
    },
    subject: {
      type: "varchar(255)",
    },
    content: {
      type: "text",
    },
    error_message: {
      type: "text",
    },
    external_id: {
      type: "varchar(100)", // External service ID (SendGrid, Twilio, etc.)
    },
    loan_id: {
      type: "varchar(255)",
    },
    metadata: {
      type: "jsonb",
    },
    sent_at: {
      type: "timestamp",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  // Add indexes for notification_logs
  pgm.createIndex("notification_logs", ["user_id"]);
  pgm.createIndex("notification_logs", ["notification_type"]);
  pgm.createIndex("notification_logs", ["channel"]);
  pgm.createIndex("notification_logs", ["status"]);
  pgm.createIndex("notification_logs", ["created_at"]);
  pgm.createIndex("notification_logs", ["sent_at"]);

  // Create notification_templates table for reusable templates
  pgm.createTable("notification_templates", {
    id: {
      type: "serial",
      primaryKey: true,
    },
    name: {
      type: "varchar(100)",
      notNull: true,
      unique: true,
    },
    type: {
      type: "varchar(50)",
      notNull: true,
    },
    channel: {
      type: "varchar(10)",
      notNull: true,
    },
    language: {
      type: "varchar(10)",
      notNull: true,
      default: "en",
    },
    subject_template: {
      type: "varchar(255)",
    },
    body_template: {
      type: "text",
      notNull: true,
    },
    variables: {
      type: "jsonb", // Define what variables this template expects
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  // Add indexes for notification_templates
  pgm.createIndex("notification_templates", ["name"]);
  pgm.createIndex("notification_templates", ["type"]);
  pgm.createIndex("notification_templates", ["channel"]);
  pgm.createIndex("notification_templates", ["language"]);

  // Insert default notification templates
  pgm.sql(`
    INSERT INTO notification_templates (name, type, channel, subject_template, body_template, variables) VALUES
    ('loan_approved_email', 'loan_status_update', 'email', '🎉 Your Loan Application Has Been Approved!', 
     '<h2>Hello {{borrowerName}},</h2><p>Congratulations! Your loan application {{loanId}} has been approved for {{amount}} {{currency}}.</p><p>Funds will be disbursed shortly.</p>',
     '["borrowerName", "loanId", "amount", "currency"]'),
    
    ('loan_approved_sms', 'loan_status_update', 'sms', null,
     '🎉 Congratulations {{borrowerName}}! Your loan {{loanId}} has been approved for {{amount}} {{currency}}.',
     '["borrowerName", "loanId", "amount", "currency"]'),
    
    ('payment_reminder_email', 'payment_reminder', 'email', '📅 Payment Reminder Due Soon',
     '<h2>Hello {{borrowerName}},</h2><p>This is a reminder that your payment of {{amount}} {{currency}} for loan {{loanId}} is due on {{dueDate}}.</p>',
     '["borrowerName", "amount", "currency", "loanId", "dueDate"]'),
    
    ('payment_reminder_sms', 'payment_reminder', 'sms', null,
     '📅 Hi {{borrowerName}}, reminder: payment of {{amount}} {{currency}} for loan {{loanId}} is due on {{dueDate}}.',
     '["borrowerName", "amount", "currency", "loanId", "dueDate"]'),
    
    ('payment_overdue_email', 'payment_overdue', 'email', '⚠️ Payment Overdue - {{daysOverdue}} days',
     '<h2>Hello {{borrowerName}},</h2><p>Your payment of {{amount}} {{currency}} for loan {{loanId}} is {{daysOverdue}} days overdue. Please pay immediately.</p>',
     '["borrowerName", "amount", "currency", "loanId", "daysOverdue"]'),
    
    ('payment_overdue_sms', 'payment_overdue', 'sms', null,
     '⚠️ {{borrowerName}}, your payment of {{amount}} {{currency}} for loan {{loanId}} is {{daysOverdue}} days overdue. Please pay immediately.',
     '["borrowerName", "amount", "currency", "loanId", "daysOverdue"]')
  `);

  // Create function to update updated_at timestamp
  pgm.createTrigger(
    "notification_preferences",
    "update_notification_preferences_updated_at",
    {
      when: "BEFORE",
      operation: "UPDATE",
      function: { name: "update_updated_at_column" },
    },
  );

  pgm.createTrigger(
    "notification_templates",
    "update_notification_templates_updated_at",
    {
      when: "BEFORE",
      operation: "UPDATE",
      function: { name: "update_updated_at_column" },
    },
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // Drop triggers
  pgm.dropTrigger(
    "notification_preferences",
    "update_notification_preferences_updated_at",
  );
  pgm.dropTrigger(
    "notification_templates",
    "update_notification_templates_updated_at",
  );

  // Drop tables
  pgm.dropTable("notification_templates");
  pgm.dropTable("notification_logs");
  pgm.dropTable("notification_preferences");

  // Remove columns from user_profiles
  pgm.dropColumns("user_profiles", [
    "phone",
    "phone_verified",
    "email_verified",
  ]);
};
