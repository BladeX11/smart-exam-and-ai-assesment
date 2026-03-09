import express from 'express';
import { getAIReport, saveAIReport, generateStudyPlan } from '../controllers/aiController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/report/:attemptId', authenticateToken, getAIReport);
router.post('/report/:attemptId', authenticateToken, saveAIReport);
router.get('/study-plan/:attemptId', authenticateToken, generateStudyPlan);

export default router;
