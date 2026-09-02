export interface SeedUser {
  borrower: string;
  score: number;
  user_id?: string;
  current_score?: number;
}

export const seedUsers: SeedUser[] = [
  { borrower: 'user_001', score: 750, user_id: 'user_001', current_score: 750 },
  { borrower: 'user_002', score: 680, user_id: 'user_002', current_score: 680 },
  { borrower: 'user_003', score: 820, user_id: 'user_003', current_score: 820 },
  { borrower: 'user_004', score: 590, user_id: 'user_004', current_score: 590 },
  { borrower: 'user_005', score: 710, user_id: 'user_005', current_score: 710 },
  { borrower: 'demo_user', score: 700, user_id: 'demo_user', current_score: 700 },
  { borrower: 'test_user', score: 650, user_id: 'test_user', current_score: 650 },
  { borrower: 'alice_stellar', score: 800, user_id: 'alice_stellar', current_score: 800 },
  { borrower: 'bob_remit', score: 720, user_id: 'bob_remit', current_score: 720 },
  { borrower: 'charlie_test', score: 680, user_id: 'charlie_test', current_score: 680 },
];
