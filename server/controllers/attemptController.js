import pool from '../config/db.js';
import { calculateATI, getRiskLevel } from '../utils/ati.js';
import { analyzeCheatPattern } from '../utils/cheatPattern.js';

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
    const [attempts] = await pool.query('SELECT * FROM student_attempts WHERE id = ?', [id]);
    if (attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = attempts[0];

    const isOwner = Number(attempt.student_id) === Number(req.user.id);
    const isFaculty = req.user.role === 'faculty';
    const isForceEndRequest = !!force_reason;

    // Students can submit their own attempt. Faculty can only force-end.
    if (!isOwner && !(isFaculty && isForceEndRequest)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Idempotent behavior: if already finalized, return success so client can redirect.
    if (attempt.status === 'submitted' || attempt.status === 'force_ended') {
      return res.json({
        success: true,
        score: attempt.score ?? 0,
        atiScore: attempt.ati_score ?? 100,
        status: attempt.status
      });
    }
    
    // Calculate score
    const [questions] = await pool.query(`
      SELECT eq.question_bank_id, eq.marks, qb.correct_answer 
      FROM exam_questions eq 
      JOIN question_bank qb ON eq.question_bank_id = qb.id 
      WHERE eq.exam_id = ?
    `, [attempt.exam_id]);

    let score = 0;
    let studentAnswers = {};
    try {
      studentAnswers = typeof attempt.answers === 'string' ? JSON.parse(attempt.answers || '{}') : (attempt.answers || {});
    } catch {
      studentAnswers = {};
    }

    questions.forEach(q => {
      if (studentAnswers[q.question_bank_id] === q.correct_answer) {
        score += q.marks;
      }
    });

    // Calculate ATI
    const atiScore = calculateATI(attempt);
    const riskLevel = getRiskLevel(atiScore);

    const isForceEnded = !!force_reason;
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

    const [examRows] = await pool.query('SELECT duration_minutes, total_marks FROM exams WHERE id = ?', [attempt.exam_id]);
    const exam = examRows[0];
    const totalDurationSeconds = (exam?.duration_minutes || 0) * 60;
    const timeRemainingSeconds = Number.isFinite(attempt.time_remaining_seconds) ? attempt.time_remaining_seconds : null;
    const timeSpentSeconds =
      timeRemainingSeconds === null || !totalDurationSeconds
        ? null
        : Math.max(0, totalDurationSeconds - timeRemainingSeconds);
    const timeRatio =
      totalDurationSeconds && timeSpentSeconds !== null
        ? Math.min(1, Math.max(0, timeSpentSeconds / totalDurationSeconds))
        : 1;
    const scorePercentage = exam?.total_marks ? (score / exam.total_marks) * 100 : 0;

    const cheatInput = {
      attempt_id: attempt.id,
      student_id: attempt.student_id,
      exam_id: attempt.exam_id,
      status: isForceEnded ? 'force_ended' : 'submitted',
      force_end_reason: force_reason || null,
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
      ati_risk_level: riskLevel,
      tab_switches: attempt.tab_switches || 0,
      face_violations: attempt.face_violations || 0
    };

    let cheatReport = {
      cheat_probability: 0,
      verdict: 'clean',
      patterns_detected: [],
      statistical_anomalies: [],
      faculty_recommendation: 'No immediate action',
      confidence_level: 'low'
    };

    try {
      cheatReport = await Promise.race([
        analyzeCheatPattern(cheatInput),
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                cheat_probability: 0,
                verdict: 'clean',
                patterns_detected: [],
                statistical_anomalies: ['AI timeout fallback'],
                faculty_recommendation: 'Manual review if needed',
                confidence_level: 'low'
              }),
            1500
          )
        )
      ]);
    } catch (analysisError) {
      console.error('Cheat analysis failed, using safe fallback:', analysisError);
    }

    const cheatProbability = Number.isFinite(cheatReport?.cheat_probability) ? cheatReport.cheat_probability : 0;
    const anomalyDetected = cheatReport?.verdict ? cheatReport.verdict !== 'clean' : cheatProbability >= 60;

    await pool.query(
      'UPDATE student_attempts SET status = ?, submit_time = CURRENT_TIMESTAMP, score = ?, ati_score = ?, risk_level = ?, is_suspicious = ?, force_end_reason = COALESCE(?, force_end_reason) WHERE id = ?',
      [
        isForceEnded ? 'force_ended' : 'submitted',
        score,
        atiScore,
        riskLevel,
        anomalyDetected ? 1 : 0,
        force_reason || null,
        id
      ]
    );

    // Non-critical analytics writes should never block exam submission success.
    try {
      // Ensure profile exists (older data may miss this row).
      await pool.query(
        'INSERT IGNORE INTO student_risk_profiles (student_id, overall_risk) VALUES (?, ?)',
        [attempt.student_id, 'clean']
      );

      // Update risk profile
      const isFlagged = (riskLevel === 'high') || isForceEnded || violationCount >= 15;
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

      // Keep legacy user stats in sync (used in some places/UI)
      await pool.query(
        `UPDATE users SET
          total_exams_taken = total_exams_taken + 1,
          total_violations = total_violations + ?,
          risk_level = (SELECT overall_risk FROM student_risk_profiles WHERE student_id = ?)
        WHERE id = ?`,
        [violationCount, attempt.student_id, attempt.student_id]
      );

      // Save/merge AI cheat-pattern report (study plan can still be added later by client)
      await pool.query(
        `INSERT INTO ai_assessments (attempt_id, risk_score, anomaly_detected, cheat_pattern_report, behavior_flags, statistical_analysis, performance_summary)
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
          JSON.stringify({ score, score_percentage: scorePercentage, ati_score: atiScore, risk_level: riskLevel, violation_count: violationCount })
        ]
      );
    } catch (postSubmitError) {
      console.error('Post-submit analytics update failed (non-blocking):', postSubmitError);
    }

    res.json({ success: true, score, atiScore });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getAttemptStatus = async (req, res) => {
  const { id } = req.params;
  try {
    const [attempts] = await pool.query('SELECT * FROM student_attempts WHERE id = ?', [id]);
    if (attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
    
    // Verify attempt belongs to current user or faculty
    if (attempts[0].student_id !== req.user.id && req.user.role !== 'faculty') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get exam status to check if exam is paused
    const [exam] = await pool.query('SELECT title, total_marks, status FROM exams WHERE id = ?', [attempts[0].exam_id]);
    if (exam.length === 0) return res.status(404).json({ error: 'Exam not found' });
    
    const attempt = attempts[0];
    let parsedAnswers = {};
    let parsedLongAnswers = {};
    try { parsedAnswers = typeof attempt.answers === 'string' ? JSON.parse(attempt.answers || '{}') : (attempt.answers || {}); } catch { parsedAnswers = {}; }
    try { parsedLongAnswers = typeof attempt.long_answers === 'string' ? JSON.parse(attempt.long_answers || '{}') : (attempt.long_answers || {}); } catch { parsedLongAnswers = {}; }

    const result = {
      ...attempt,
      answers: parsedAnswers,
      long_answers: parsedLongAnswers,
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

    // Verify attempt belongs to the current user or faculty who owns the exam
    const [attempts] = await pool.query('SELECT sa.student_id, sa.exam_id FROM student_attempts sa WHERE sa.id = ?', [id]);
    if (attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
    
    // Allow the student who owns the attempt or any faculty
    const isOwner = Number(attempts[0].student_id) === Number(req.user.id);
    const isFaculty = req.user.role === 'faculty';
    
    if (!isOwner && !isFaculty) {
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
