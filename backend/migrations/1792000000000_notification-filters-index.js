/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Add composite index for filtering by user, type, status, and created_at
  pgm.createIndex(
    "notifications",
    ["user_id", "type", "status", "created_at"],
    {
      name: "idx_notifications_user_type_status_created",
    },
  );

  // Add index for date range queries
  pgm.createIndex("notifications", ["user_id", "created_at"], {
    name: "idx_notifications_user_created",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex("notifications", ["user_id", "type", "status", "created_at"], {
    name: "idx_notifications_user_type_status_created",
  });
  pgm.dropIndex("notifications", ["user_id", "created_at"], {
    name: "idx_notifications_user_created",
  });
};
