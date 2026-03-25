exports.up = async (pgm) => {
  // Add notification preferences to user_profiles table if they don't exist
  pgm.addColumns('user_profiles', {
    email: {
      type: 'VARCHAR(255)',
      nullable: true,
    },
    phone_number: {
      type: 'VARCHAR(20)',
      nullable: true,
    },
    email_notifications_enabled: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
    },
    sms_notifications_enabled: {
      type: 'BOOLEAN',
      notNull: true,
      default: false,
    },
    whatsapp_notifications_enabled: {
      type: 'BOOLEAN',
      notNull: true,
      default: false,
    },
  });

  // Create notification_logs table
  pgm.createTable('notification_logs', {
    id: {
      type: 'SERIAL',
      primaryKey: true,
    },
    borrower: {
      type: 'VARCHAR(56)',
      notNull: true,
      references: 'user_profiles(stellar_public_key)',
      onDelete: 'CASCADE',
    },
    loan_id: {
      type: 'INTEGER',
      notNull: true,
      references: 'loan_events(loan_id)',
      onDelete: 'CASCADE',
    },
    notification_type: {
      type: 'VARCHAR(50)',
      notNull: true,
    }, // 'upcoming', 'overdue', 'urgent', 'status_change'
    channel: {
      type: 'VARCHAR(20)',
      notNull: true,
    }, // 'email', 'sms', 'whatsapp'
    sent_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    success: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
    },
    error_message: {
      type: 'TEXT',
      nullable: true,
    },
    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // Create indexes for better performance
  pgm.createIndex('notification_logs', ['borrower']);
  pgm.createIndex('notification_logs', ['loan_id']);
  pgm.createIndex('notification_logs', ['notification_type']);
  pgm.createIndex('notification_logs', ['sent_at']);
  pgm.createIndex('notification_logs', ['borrower', 'loan_id']);

  // Add index to user_profiles for email lookups
  pgm.createIndex('user_profiles', ['email']);
  
  // Add index to user_profiles for phone number lookups
  pgm.createIndex('user_profiles', ['phone_number']);
};

exports.down = async (pgm) => {
  // Drop notification_logs table
  pgm.dropTable('notification_logs');

  // Remove notification preference columns from user_profiles
  pgm.dropColumns('user_profiles', [
    'email',
    'phone_number',
    'email_notifications_enabled',
    'sms_notifications_enabled',
    'whatsapp_notifications_enabled',
  ]);
};
