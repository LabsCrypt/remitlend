/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Add status column with check constraint
  pgm.addColumn("notifications", {
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "unread",
      comment: "unread | read | archived",
    },
  });

  pgm.addConstraint(
    "notifications",
    "notifications_status_check",
    "CHECK (status IN ('unread', 'read', 'archived'))",
  );

  // Backfill status from existing read boolean
  pgm.sql(
    `UPDATE notifications SET status = CASE WHEN read = true THEN 'read' ELSE 'unread' END`,
  );

  // Index on status for filtering
  pgm.createIndex("notifications", "status", { ifNotExists: true });

  // Composite index on (status, created_at) for efficient status-based cleanup queries
  pgm.createIndex("notifications", ["status", "created_at"], {
    name: "idx_notifications_status_created_at",
    ifNotExists: true,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex("notifications", ["status", "created_at"], {
    name: "idx_notifications_status_created_at",
    ifExists: true,
  });
  pgm.dropIndex("notifications", "status", { ifExists: true });
  pgm.dropConstraint("notifications", "notifications_status_check", {
    ifExists: true,
  });
  pgm.dropColumn("notifications", "status");
};
