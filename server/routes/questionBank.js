import express from 'express';
import { getQuestions, createQuestion, updateQuestion, getHistory, deleteQuestion, bulkImportQuestions } from '../controllers/questionBankController.js';
import { authenticateToken, authorizeFaculty } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, authorizeFaculty, getQuestions);
router.post('/', authenticateToken, authorizeFaculty, createQuestion);
router.post('/bulk-import', authenticateToken, authorizeFaculty, bulkImportQuestions);
router.put('/:id', authenticateToken, authorizeFaculty, updateQuestion);
router.delete('/:id', authenticateToken, authorizeFaculty, deleteQuestion);
router.get('/:id/history', authenticateToken, authorizeFaculty, getHistory);

export default router;
