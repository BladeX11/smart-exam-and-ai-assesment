import express from 'express';
import { submitDoubt, getDoubts, resolveDoubt } from '../controllers/doubtController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticateToken, submitDoubt);
router.get('/exam/:examId', authenticateToken, getDoubts);
router.put('/:id/resolve', authenticateToken, resolveDoubt);

export default router;
