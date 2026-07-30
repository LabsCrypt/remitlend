import { Router } from 'express';
import { listMyTransactions, getTransactions } from '../controllers/transactionController.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';

const router = Router();

router.get('/', getTransactions);
router.get('/me', requireJwtAuth, listMyTransactions);

export default router;
