exports.up = (pgm) => {
  pgm.addColumns("loan_events", {
    interest_rate_bps: { type: "integer", default: null },
    term_ledgers: { type: "integer", default: null },
  });

  // Also add a score penalty for defaulted loans in the metadata if needed,
  // but for now we'll just track the rate per-loan event.
};

exports.down = (pgm) => {
  pgm.dropColumns("loan_events", ["interest_rate_bps", "term_ledgers"]);
};
