import express from 'express';
import { getFacultyDashboard } from '../controllers/dashboardController.js';
import { authenticateToken, authorizeFaculty } from '../middleware/auth.js';

const router = express.Router();

router.get('/faculty', authenticateToken, authorizeFaculty, getFacultyDashboard);

export default router;
