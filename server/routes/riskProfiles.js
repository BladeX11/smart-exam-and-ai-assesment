import express from 'express';
import { getAllRiskProfiles, updateProfileNotes, getStudentHistory } from '../controllers/riskProfileController.js';
import { authenticateToken, authorizeFaculty } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, authorizeFaculty, getAllRiskProfiles);
router.get('/:studentId/history', authenticateToken, authorizeFaculty, getStudentHistory);
router.put('/:id/notes', authenticateToken, authorizeFaculty, updateProfileNotes);

export default router;
