import { Router } from "express";
import { listMyTransactions } from "../controllers/transactionController.js";
import { requireJwtAuth } from "../middleware/jwtAuth.js";

const router = Router();

router.get("/me", requireJwtAuth, listMyTransactions);

export default router;
