import express from 'express';
import { getAllRiskProfiles, updateProfileNotes } from '../controllers/riskProfileController.js';
import { authenticateToken, authorizeFaculty } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, authorizeFaculty, getAllRiskProfiles);
router.put('/:id/notes', authenticateToken, authorizeFaculty, updateProfileNotes);

export default router;
