import express from 'express';
import {
  startAttempt,
  updateAnswers,
  logActivity,
  submitAttempt,
  getAttemptStatus,
  updateAttemptStatus,
  updateTimer,
  getAttemptActivityHistory,
  startRecordingUpload,
  uploadRecordingChunk,
  stopRecordingUpload,
  getAttemptRecordings
} from '../controllers/attemptController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/start', authenticateToken, startAttempt);
router.put('/:id/answers', authenticateToken, updateAnswers);
router.put('/:id/timer', authenticateToken, updateTimer);
router.post('/:id/activity', authenticateToken, logActivity);
router.get('/:id/activity', authenticateToken, getAttemptActivityHistory);
router.post('/:id/recordings/start', authenticateToken, startRecordingUpload);
router.post('/:id/recordings/chunk', authenticateToken, uploadRecordingChunk);
router.post('/:id/recordings/stop', authenticateToken, stopRecordingUpload);
router.get('/:id/recordings', authenticateToken, getAttemptRecordings);
router.post('/:id/submit', authenticateToken, submitAttempt);
router.get('/:id/status', authenticateToken, getAttemptStatus);
router.put('/:id/status', authenticateToken, updateAttemptStatus);

export default router;
