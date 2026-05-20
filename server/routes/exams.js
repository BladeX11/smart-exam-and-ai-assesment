import express from 'express';
import { createExam, getExams, getExamDetails, updateExamStatus, getExamAttempts, getExamHeatmap, addQuestionToExam, getExamQuestions, getExamActivityFeed } from '../controllers/examController.js';
import { authenticateToken, authorizeFaculty } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticateToken, authorizeFaculty, createExam);
router.get('/', authenticateToken, getExams);
router.get('/:id', authenticateToken, getExamDetails);
router.get('/:id/attempts', authenticateToken, authorizeFaculty, getExamAttempts);
router.get('/:id/activity', authenticateToken, authorizeFaculty, getExamActivityFeed);
router.get('/:id/heatmap', authenticateToken, authorizeFaculty, getExamHeatmap);
router.get('/:id/questions', authenticateToken, authorizeFaculty, getExamQuestions);
router.post('/:id/questions', authenticateToken, authorizeFaculty, addQuestionToExam);
router.put('/:id/status', authenticateToken, authorizeFaculty, updateExamStatus);

export default router;
