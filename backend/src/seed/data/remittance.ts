export interface SeedRemittance {
  user_id: string;
  amount: number;
  month: string;
  status: string;
}

export const seedRemittances: SeedRemittance[] = [
  { user_id: "user_001", amount: 500, month: "January", status: "Completed" },
  { user_id: "user_001", amount: 500, month: "February", status: "Completed" },
  { user_id: "user_001", amount: 500, month: "March", status: "Completed" },
  { user_id: "user_001", amount: 600, month: "April", status: "Completed" },
  { user_id: "user_001", amount: 550, month: "May", status: "Completed" },

  { user_id: "user_002", amount: 300, month: "January", status: "Completed" },
  { user_id: "user_002", amount: 300, month: "February", status: "Completed" },
  { user_id: "user_002", amount: 300, month: "March", status: "Late" },
  { user_id: "user_002", amount: 350, month: "April", status: "Completed" },
  { user_id: "user_002", amount: 300, month: "May", status: "Completed" },

  { user_id: "user_003", amount: 1000, month: "January", status: "Completed" },
  { user_id: "user_003", amount: 1000, month: "February", status: "Completed" },
  { user_id: "user_003", amount: 1000, month: "March", status: "Completed" },
  { user_id: "user_003", amount: 1200, month: "April", status: "Completed" },
  { user_id: "user_003", amount: 1100, month: "May", status: "Completed" },

  { user_id: "user_004", amount: 200, month: "January", status: "Missed" },
  { user_id: "user_004", amount: 200, month: "February", status: "Completed" },
  { user_id: "user_004", amount: 200, month: "March", status: "Late" },
  { user_id: "user_004", amount: 250, month: "April", status: "Missed" },
  { user_id: "user_004", amount: 200, month: "May", status: "Completed" },

  { user_id: "demo_user", amount: 450, month: "January", status: "Completed" },
  { user_id: "demo_user", amount: 450, month: "February", status: "Completed" },
  { user_id: "demo_user", amount: 500, month: "March", status: "Completed" },
  { user_id: "demo_user", amount: 450, month: "April", status: "Completed" },
  { user_id: "demo_user", amount: 475, month: "May", status: "Completed" },

  { user_id: "test_user", amount: 250, month: "January", status: "Completed" },
  { user_id: "test_user", amount: 250, month: "February", status: "Late" },
  { user_id: "test_user", amount: 300, month: "March", status: "Completed" },
  { user_id: "test_user", amount: 275, month: "April", status: "Completed" },
  { user_id: "test_user", amount: 250, month: "May", status: "Completed" },

  { user_id: "alice_stellar", amount: 800, month: "January", status: "Completed" },
  { user_id: "alice_stellar", amount: 850, month: "February", status: "Completed" },
  { user_id: "alice_stellar", amount: 900, month: "March", status: "Completed" },
  { user_id: "alice_stellar", amount: 875, month: "April", status: "Completed" },
  { user_id: "alice_stellar", amount: 950, month: "May", status: "Completed" },

  { user_id: "bob_remit", amount: 600, month: "January", status: "Completed" },
  { user_id: "bob_remit", amount: 550, month: "February", status: "Completed" },
  { user_id: "bob_remit", amount: 600, month: "March", status: "Completed" },
  { user_id: "bob_remit", amount: 650, month: "April", status: "Completed" },
  { user_id: "bob_remit", amount: 600, month: "May", status: "Completed" },

  { user_id: "charlie_test", amount: 400, month: "January", status: "Completed" },
  { user_id: "charlie_test", amount: 450, month: "February", status: "Completed" },
  { user_id: "charlie_test", amount: 400, month: "March", status: "Completed" },
  { user_id: "charlie_test", amount: 425, month: "April", status: "Completed" },
  { user_id: "charlie_test", amount: 400, month: "May", status: "Completed" },

  { user_id: "user_005", amount: 350, month: "January", status: "Completed" },
  { user_id: "user_005", amount: 350, month: "February", status: "Completed" },
  { user_id: "user_005", amount: 400, month: "March", status: "Completed" },
  { user_id: "user_005", amount: 375, month: "April", status: "Completed" },
  { user_id: "user_005", amount: 350, month: "May", status: "Completed" },
];
