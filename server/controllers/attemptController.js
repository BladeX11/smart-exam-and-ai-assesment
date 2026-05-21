import pool from '../config/db.js';
import { calculateATI, getRiskLevel } from '../utils/ati.js';
import { analyzeCheatPattern } from '../utils/cheatPattern.js';
import { gradeLongAnswer } from '../utils/longAnswerGrader.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const recordingsRoot = path.join(__dirname, '../../storage/recordings');

const getAttemptWithExamOwner = async (attemptId) => {
  const [attempts] = await pool.query(
    `SELECT sa.*, e.created_by AS exam_owner_id
     FROM student_attempts sa
     JOIN exams e ON sa.exam_id = e.id
     WHERE sa.id = ?`,
    [attemptId]
  );

  return attempts[0] || null;
};

const canAccessAttempt = (attempt, user) => {
  if (!attempt || !user) return false;
  if (Number(attempt.student_id) === Number(user.id)) return true;
  return user.role === 'faculty' && Number(attempt.exam_owner_id) === Number(user.id);
};

const ensureAttemptOwner = async (attemptId, userId) => {
  const [attempts] = await pool.query('SELECT * FROM student_attempts WHERE id = ?', [attemptId]);
  if (attempts.length === 0) return null;
  if (Number(attempts[0].student_id) !== Number(userId)) return false;
  return attempts[0];
};

const getAttemptRecordingDir = (attemptId) => path.join(recordingsRoot, `attempt-${attemptId}`);
const getRecordingMetadataPath = (attemptId) => path.join(getAttemptRecordingDir(attemptId), 'recordings.json');

const readRecordingMetadata = async (attemptId) => {
  try {
    const raw = await fs.readFile(getRecordingMetadataPath(attemptId), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeRecordingMetadata = async (attemptId, metadata) => {
  await fs.mkdir(getAttemptRecordingDir(attemptId), { recursive: true });
  await fs.writeFile(getRecordingMetadataPath(attemptId), JSON.stringify(metadata, null, 2), 'utf-8');
};

const getRecordingPublicUrl = (attemptId, fileName) => `/recordings/attempt-${attemptId}/${fileName}`;

const hasMissingLongAnswerColumnsError = (error) => {
  const message = `${error?.message || ''}`.toLowerCase();
  return message.includes('sample_answer') || message.includes('grading_keywords');
};

const getExamQuestionsForScoring = async (examId) => {
  const scoringQuery = `SELECT eq.question_bank_id, eq.marks, qb.correct_answer, qb.question_type, qb.question_text, qb.sample_answer, qb.grading_keywords
     FROM exam_questions eq
     JOIN question_bank qb ON eq.question_bank_id = qb.id
     WHERE eq.exam_id = ?`;

  try {
    const [questions] = await pool.query(scoringQuery, [examId]);
    return questions;
  } catch (error) {
    if (!hasMissingLongAnswerColumnsError(error)) {
      throw error;
    }

    const [fallbackQuestions] = await pool.query(
      `SELECT eq.question_bank_id, eq.marks, qb.correct_answer, qb.question_type, qb.question_text,
              NULL AS sample_answer, NULL AS grading_keywords
         FROM exam_questions eq
         JOIN question_bank qb ON eq.question_bank_id = qb.id
         WHERE eq.exam_id = ?`,
      [examId]
    );
    return fallbackQuestions;
  }
};

export const finalizeAttempt = async (attemptId, forceReason = null) => {
  const attempt = await getAttemptWithExamOwner(attemptId);
  if (!attempt) {
    const error = new Error('Attempt not found');
    error.status = 404;
    throw error;
  }

  if (attempt.status === 'submitted' || attempt.status === 'force_ended') {
    return {
      success: true,
      score: attempt.score,
      atiScore: attempt.ati_score,
      alreadyFinalized: true
    };
  }

  // Calculate score
  const questions = await getExamQuestionsForScoring(attempt.exam_id);

  let score = 0;
  let studentAnswers = {};
  try {
    studentAnswers = typeof attempt.answers === 'string' ? JSON.parse(attempt.answers || '{}') : (attempt.answers || {});
  } catch {
    studentAnswers = {};
  }
  let studentLongAnswers = {};
  try {
    studentLongAnswers = typeof attempt.long_answers === 'string' ? JSON.parse(attempt.long_answers || '{}') : (attempt.long_answers || {});
  } catch {
    studentLongAnswers = {};
  }

  const longAnswerEvaluations = [];

  for (const q of questions) {
    if (q.question_type === 'long_answer') {
      const evaluation = await gradeLongAnswer({
        questionText: q.question_text,
        sampleAnswer: q.sample_answer,
        gradingKeywords: q.grading_keywords,
        studentAnswer: studentLongAnswers[q.question_bank_id] || '',
        marks: q.marks
      });
      score += evaluation.awarded_marks;
      longAnswerEvaluations.push({
        question_id: q.question_bank_id,
        question_text: q.question_text,
        student_answer: studentLongAnswers[q.question_bank_id] || '',
        ...evaluation
      });
      continue;
    }
    if (studentAnswers[q.question_bank_id] === q.correct_answer) {
      score += q.marks;
    }
  }

  const atiScore = calculateATI(attempt);
  const riskLevel = getRiskLevel(atiScore);
  const isForceEnded = !!forceReason;
  const violationCount =
    (attempt.tab_switches || 0) +
    (attempt.window_blurs || 0) +
    (attempt.copy_paste_attempts || 0) +
    (attempt.face_violations || 0) +
    (attempt.voice_violations || 0) +
    (attempt.object_violations || 0) +
    (attempt.fullscreen_exits || 0) +
    (attempt.gaze_violations || 0) +
    (attempt.internet_disconnects || 0);

  const [examRows] = await pool.query(
    'SELECT duration_minutes, total_marks FROM exams WHERE id = ?',
    [attempt.exam_id]
  );
  const exam = examRows[0];
  const totalDurationSeconds = (exam?.duration_minutes || 0) * 60;
  const timeRemainingSeconds =
    typeof attempt.time_remaining_seconds === 'number' ? attempt.time_remaining_seconds : null;
  const timeSpentSeconds =
    timeRemainingSeconds === null || !totalDurationSeconds
      ? null
      : Math.max(0, totalDurationSeconds - timeRemainingSeconds);
  const timeRatio =
    totalDurationSeconds && timeSpentSeconds !== null
      ? Math.min(1, Math.max(0, timeSpentSeconds / totalDurationSeconds))
      : 1;
  const scorePercentage = exam?.total_marks ? (score / exam.total_marks) * 100 : 0;

  const cheatReport = await analyzeCheatPattern({
    attempt_id: attempt.id,
    student_id: attempt.student_id,
    exam_id: attempt.exam_id,
    status: isForceEnded ? 'force_ended' : 'submitted',
    force_end_reason: forceReason || null,
    score,
    total_marks: exam?.total_marks ?? null,
    score_percentage: scorePercentage,
    time_ratio: timeRatio,
    time_spent_seconds: timeSpentSeconds,
    total_duration_seconds: totalDurationSeconds || null,
    violations: {
      tab_switches: attempt.tab_switches || 0,
      window_blurs: attempt.window_blurs || 0,
      copy_paste_attempts: attempt.copy_paste_attempts || 0,
      face_violations: attempt.face_violations || 0,
      voice_violations: attempt.voice_violations || 0,
      object_violations: attempt.object_violations || 0,
      fullscreen_exits: attempt.fullscreen_exits || 0,
      gaze_violations: attempt.gaze_violations || 0,
      internet_disconnects: attempt.internet_disconnects || 0
    },
    ati_score: atiScore,
    ati_risk_level: riskLevel
  });

  const cheatProbability = Number.isFinite(cheatReport?.cheat_probability) ? cheatReport.cheat_probability : 0;
  const anomalyDetected = cheatReport?.verdict ? cheatReport.verdict !== 'clean' : cheatProbability >= 60;

  await pool.query(
    `UPDATE student_attempts
     SET status = ?, submit_time = CURRENT_TIMESTAMP, score = ?, ati_score = ?, risk_level = ?, is_suspicious = ?,
         force_end_reason = COALESCE(?, force_end_reason)
     WHERE id = ?`,
    [
      isForceEnded ? 'force_ended' : 'submitted',
      score,
      atiScore,
      riskLevel,
      anomalyDetected ? 1 : 0,
      forceReason || null,
      attemptId
    ]
  );

  const isFlagged = riskLevel === 'high' || isForceEnded || violationCount >= 15;
  const forceEndedInc = isForceEnded ? 1 : 0;
  const flaggedInc = isFlagged ? 1 : 0;

  await pool.query(
    `UPDATE student_risk_profiles SET
      total_exams = total_exams + 1,
      total_flagged_exams = total_flagged_exams + ?,
      total_force_ended = total_force_ended + ?,
      total_tab_switches = total_tab_switches + ?,
      total_face_violations = total_face_violations + ?,
      total_voice_violations = total_voice_violations + ?,
      total_object_violations = total_object_violations + ?,
      total_copy_attempts = total_copy_attempts + ?,
      overall_risk = CASE
        WHEN (total_force_ended + ?) >= 2 OR (total_flagged_exams + ?) >= 3 THEN 'repeat_offender'
        WHEN (total_force_ended + ?) >= 1 OR (total_flagged_exams + ?) >= 1 THEN 'watchlist'
        ELSE 'clean'
      END,
      last_updated = CURRENT_TIMESTAMP
    WHERE student_id = ?`,
    [
      flaggedInc,
      forceEndedInc,
      attempt.tab_switches || 0,
      attempt.face_violations || 0,
      attempt.voice_violations || 0,
      attempt.object_violations || 0,
      attempt.copy_paste_attempts || 0,
      forceEndedInc, flaggedInc,
      forceEndedInc, flaggedInc,
      attempt.student_id
    ]
  );

  await pool.query(
    `UPDATE users SET
      total_exams_taken = total_exams_taken + 1,
      total_violations = total_violations + ?,
      risk_level = (SELECT overall_risk FROM student_risk_profiles WHERE student_id = ?)
    WHERE id = ?`,
    [violationCount, attempt.student_id, attempt.student_id]
  );

  await pool.query(
    `INSERT INTO ai_assessments (
      attempt_id, risk_score, anomaly_detected, cheat_pattern_report, behavior_flags, statistical_analysis, performance_summary
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      risk_score = COALESCE(VALUES(risk_score), risk_score),
      anomaly_detected = COALESCE(VALUES(anomaly_detected), anomaly_detected),
      cheat_pattern_report = COALESCE(VALUES(cheat_pattern_report), cheat_pattern_report),
      behavior_flags = COALESCE(VALUES(behavior_flags), behavior_flags),
      statistical_analysis = COALESCE(VALUES(statistical_analysis), statistical_analysis),
      performance_summary = COALESCE(VALUES(performance_summary), performance_summary)`,
    [
      attempt.id,
      cheatProbability,
      anomalyDetected ? 1 : 0,
      JSON.stringify(cheatReport),
      JSON.stringify(cheatReport?.patterns_detected ?? []),
      JSON.stringify(cheatReport?.statistical_anomalies ?? []),
      JSON.stringify({
        score,
        score_percentage: scorePercentage,
        ati_score: atiScore,
        risk_level: riskLevel,
        violation_count: violationCount,
        long_answer_evaluation: longAnswerEvaluations
      })
    ]
  );

  return { success: true, score, atiScore, longAnswerEvaluations };
};

export const startAttempt = async (req, res) => {
  const { examId } = req.body;
  try {
    // Check if attempt already exists
    const [existing] = await pool.query('SELECT * FROM student_attempts WHERE student_id = ? AND exam_id = ?', [req.user.id, examId]);
    if (existing.length > 0) {
      return res.json(existing[0]);
    }

    const [exam] = await pool.query('SELECT duration_minutes FROM exams WHERE id = ?', [examId]);
    const [sections] = await pool.query('SELECT id FROM exam_sections WHERE exam_id = ? ORDER BY section_order LIMIT 1', [examId]);
    
    const firstSectionId = sections.length > 0 ? sections[0].id : null;

    const [result] = await pool.query(
      `INSERT INTO student_attempts (student_id, exam_id, current_section_id, status, start_time, time_remaining_seconds, last_active_at) 
       VALUES (?, ?, ?, 'in_progress', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`,
      [req.user.id, examId, firstSectionId, exam[0].duration_minutes * 60]
    );

    res.status(201).json({ id: result.insertId, status: 'in_progress' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateAnswers = async (req, res) => {
  const { id } = req.params;
  const { answers, long_answers, time_remaining_seconds, current_question_index, current_section_id } = req.body;
  try {
    // Verify attempt belongs to the current user
    const [attempts] = await pool.query('SELECT student_id FROM student_attempts WHERE id = ?', [id]);
    if (attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
    if (attempts[0].student_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    await pool.query(
      `UPDATE student_attempts SET
        answers = ?,
        long_answers = ?,
        time_remaining_seconds = ?,
        current_question_index = COALESCE(?, current_question_index),
        current_section_id = COALESCE(?, current_section_id),
        last_active_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        JSON.stringify(answers || {}),
        JSON.stringify(long_answers || {}),
        time_remaining_seconds,
        current_question_index ?? null,
        current_section_id ?? null,
        id
      ]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const logActivity = async (req, res) => {
  const { id } = req.params;
  const { activity_type, description, question_index, time_into_exam_seconds, severity } = req.body;
  try {
    // Verify attempt belongs to the current user
    const [attempts] = await pool.query('SELECT student_id FROM student_attempts WHERE id = ?', [id]);
    if (attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
    if (attempts[0].student_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    await pool.query(
      `INSERT INTO student_activity (attempt_id, student_id, exam_id, activity_type, description, question_index, time_into_exam_seconds, severity) 
       SELECT ?, student_id, exam_id, ?, ?, ?, ?, ? FROM student_attempts WHERE id = ?`,
      [id, activity_type, description, question_index, time_into_exam_seconds, severity, id]
    );

    // Update violation counters in attempt
    const counterMap = {
      'tab_switch': 'tab_switches',
      'window_blur': 'window_blurs',
      'copy_paste_attempt': 'copy_paste_attempts',
      'face_not_detected': 'face_violations',
      'multiple_faces': 'face_violations',
      'voice_detected': 'voice_violations',
      'object_detected': 'object_violations',
      'fullscreen_exit': 'fullscreen_exits',
      'face_turned': 'gaze_violations',
      'gaze_violation': 'gaze_violations',
      'internet_disconnect': 'internet_disconnects'
    };

    if (counterMap[activity_type]) {
      await pool.query(`UPDATE student_attempts SET ${counterMap[activity_type]} = ${counterMap[activity_type]} + 1 WHERE id = ?`, [id]);
      
      // Update heatmap
      const [attempt] = await pool.query('SELECT exam_id FROM student_attempts WHERE id = ?', [id]);
      const timeBucket = Math.floor(time_into_exam_seconds / 60);
      await pool.query(
        `INSERT INTO violation_heatmap (exam_id, attempt_id, violation_type, time_bucket_minutes, count) 
         VALUES (?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE count = count + 1`,
        [attempt[0].exam_id, id, activity_type, timeBucket]
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTimer = async (req, res) => {
  const { id } = req.params;
  const { time_remaining } = req.body;
  
  try {
    // Verify attempt belongs to the current user
    const [attempts] = await pool.query(
      'SELECT student_id, status FROM student_attempts WHERE id = ?',
      [id]
    );
    
    if (attempts.length === 0) {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    
    if (attempts[0].student_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (attempts[0].status !== 'in_progress') {
      return res.status(400).json({ error: 'Attempt is not in progress' });
    }

    await pool.query(
      'UPDATE student_attempts SET time_remaining_seconds = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?',
      [time_remaining, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating timer:', error);
    res.status(500).json({ error: error.message });
  }
};

export const submitAttempt = async (req, res) => {
  const { id } = req.params;
  const { force_reason } = req.body || {};
  try {
    const attempt = await getAttemptWithExamOwner(id);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
    if (!canAccessAttempt(attempt, req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await finalizeAttempt(id, force_reason || null);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};

export const startRecordingUpload = async (req, res) => {
  const { id } = req.params;
  const { recording_type, mime_type } = req.body || {};

  try {
    const attempt = await ensureAttemptOwner(id, req.user.id);
    if (attempt === null) return res.status(404).json({ error: 'Attempt not found' });
    if (attempt === false) return res.status(403).json({ error: 'Access denied' });

    if (!['webcam', 'screen'].includes(recording_type)) {
      return res.status(400).json({ error: 'Invalid recording type' });
    }

    const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = `${mime_type || 'video/webm'}`.includes('mp4') ? 'mp4' : 'webm';
    const fileName = `${recording_type}-${startedAt}.${extension}`;
    const recordingDir = getAttemptRecordingDir(id);
    await fs.mkdir(recordingDir, { recursive: true });
    await fs.writeFile(path.join(recordingDir, fileName), Buffer.alloc(0));

    const metadata = await readRecordingMetadata(id);
    metadata.push({
      recording_type,
      file_name: fileName,
      mime_type: mime_type || 'video/webm',
      status: 'recording',
      started_at: new Date().toISOString(),
      stopped_at: null,
      size_bytes: 0,
      url: getRecordingPublicUrl(id, fileName)
    });
    await writeRecordingMetadata(id, metadata);

    res.json({ success: true, file_name: fileName, url: getRecordingPublicUrl(id, fileName) });
  } catch (error) {
    console.error('Error starting recording upload:', error);
    res.status(500).json({ error: error.message });
  }
};

export const uploadRecordingChunk = async (req, res) => {
  const { id } = req.params;
  const { file_name, chunk_base64 } = req.body || {};

  try {
    const attempt = await ensureAttemptOwner(id, req.user.id);
    if (attempt === null) return res.status(404).json({ error: 'Attempt not found' });
    if (attempt === false) return res.status(403).json({ error: 'Access denied' });

    if (!file_name || !chunk_base64) {
      return res.status(400).json({ error: 'file_name and chunk_base64 are required' });
    }

    const safeFileName = path.basename(file_name);
    const filePath = path.join(getAttemptRecordingDir(id), safeFileName);
    const chunkBuffer = Buffer.from(chunk_base64, 'base64');
    await fs.appendFile(filePath, chunkBuffer);

    const metadata = await readRecordingMetadata(id);
    const record = metadata.find((item) => item.file_name === safeFileName);
    if (record) {
      record.size_bytes = (record.size_bytes || 0) + chunkBuffer.length;
      await writeRecordingMetadata(id, metadata);
    }

    res.json({ success: true, bytes_written: chunkBuffer.length });
  } catch (error) {
    console.error('Error uploading recording chunk:', error);
    res.status(500).json({ error: error.message });
  }
};

export const stopRecordingUpload = async (req, res) => {
  const { id } = req.params;
  const { file_name } = req.body || {};

  try {
    const attempt = await ensureAttemptOwner(id, req.user.id);
    if (attempt === null) return res.status(404).json({ error: 'Attempt not found' });
    if (attempt === false) return res.status(403).json({ error: 'Access denied' });

    if (!file_name) {
      return res.status(400).json({ error: 'file_name is required' });
    }

    const safeFileName = path.basename(file_name);
    const filePath = path.join(getAttemptRecordingDir(id), safeFileName);
    const stat = await fs.stat(filePath);

    const metadata = await readRecordingMetadata(id);
    const record = metadata.find((item) => item.file_name === safeFileName);
    if (record) {
      record.status = 'completed';
      record.stopped_at = new Date().toISOString();
      record.size_bytes = stat.size;
      await writeRecordingMetadata(id, metadata);
    }

    res.json({ success: true, size_bytes: stat.size });
  } catch (error) {
    console.error('Error stopping recording upload:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getAttemptRecordings = async (req, res) => {
  const { id } = req.params;
  try {
    const attempt = await getAttemptWithExamOwner(id);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
    if (!canAccessAttempt(attempt, req.user)) return res.status(403).json({ error: 'Access denied' });

    const metadata = await readRecordingMetadata(id);
    res.json(metadata);
  } catch (error) {
    console.error('Error getting attempt recordings:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getAttemptActivityHistory = async (req, res) => {
  const { id } = req.params;

  try {
    const attempt = await getAttemptWithExamOwner(id);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    if (!canAccessAttempt(attempt, req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [activities] = await pool.query(
      `SELECT
        sa.id,
        sa.activity_type,
        sa.description,
        sa.question_index,
        sa.time_into_exam_seconds,
        sa.severity,
        sa.timestamp,
        u.name AS student_name
      FROM student_activity sa
      JOIN users u ON sa.student_id = u.id
      WHERE sa.attempt_id = ?
      ORDER BY sa.timestamp DESC, sa.id DESC`,
      [id]
    );

    res.json(activities);
  } catch (error) {
    console.error('Error getting attempt activity history:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getAttemptStatus = async (req, res) => {
  const { id } = req.params;
  try {
    const attempt = await getAttemptWithExamOwner(id);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    if (!canAccessAttempt(attempt, req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get exam status to check if exam is paused
    const [exam] = await pool.query('SELECT title, total_marks, status FROM exams WHERE id = ?', [attempt.exam_id]);
    if (exam.length === 0) return res.status(404).json({ error: 'Exam not found' });
    
    let parsedAnswers = {};
    let parsedLongAnswers = {};
    try { parsedAnswers = typeof attempt.answers === 'string' ? JSON.parse(attempt.answers || '{}') : (attempt.answers || {}); } catch { parsedAnswers = {}; }
    try { parsedLongAnswers = typeof attempt.long_answers === 'string' ? JSON.parse(attempt.long_answers || '{}') : (attempt.long_answers || {}); } catch { parsedLongAnswers = {}; }
    const liveAtiScore = calculateATI(attempt);
    const finalizedAttempt = attempt.status === 'submitted' || attempt.status === 'force_ended';
    const resolvedAtiScore = finalizedAttempt ? (attempt.ati_score ?? liveAtiScore) : liveAtiScore;
    const resolvedRiskLevel = finalizedAttempt
      ? (attempt.risk_level || getRiskLevel(resolvedAtiScore))
      : getRiskLevel(resolvedAtiScore);

    const result = {
      ...attempt,
      answers: parsedAnswers,
      long_answers: parsedLongAnswers,
      ati_score: resolvedAtiScore,
      risk_level: resolvedRiskLevel,
      exam_title: exam[0]?.title,
      total_marks: exam[0]?.total_marks,
      exam_status: exam[0]?.status
    };
    
    res.json(result);
  } catch (error) {
    console.error('Error getting attempt status:', error);
    res.status(500).json({ error: error.message });
  }
};

export const updateAttemptStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  try {
    // Validate status
    const validStatuses = ['in_progress', 'paused'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const attempt = await getAttemptWithExamOwner(id);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    if (!canAccessAttempt(attempt, req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update attempt status
    await pool.query(
      'UPDATE student_attempts SET status = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, id]
    );

    res.json({ 
      message: `Attempt status updated to ${status}`,
      status: status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
