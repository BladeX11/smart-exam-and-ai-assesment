import express from 'express';
import { startAttempt, updateAnswers, logActivity, submitAttempt, getAttemptStatus, updateAttemptStatus, updateTimer } from '../controllers/attemptController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/start', authenticateToken, startAttempt);
router.put('/:id/answers', authenticateToken, updateAnswers);
router.put('/:id/timer', authenticateToken, updateTimer);
router.post('/:id/activity', authenticateToken, logActivity);
router.post('/:id/submit', authenticateToken, submitAttempt);
router.get('/:id/status', authenticateToken, getAttemptStatus);
router.put('/:id/status', authenticateToken, updateAttemptStatus);

export default router;
