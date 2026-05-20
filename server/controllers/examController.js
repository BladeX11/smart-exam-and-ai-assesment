import pool from '../config/db.js';
import { finalizeAttempt } from './attemptController.js';

export const createExam = async (req, res) => {
  const { title, description, duration_minutes, total_marks, passing_marks, instructions, allow_calculator, shuffle_questions, shuffle_options, sections, show_results_after } = req.body;
  
  // Validate required fields
  if (!title || !duration_minutes || !total_marks) {
    return res.status(400).json({ error: 'Title, duration, and total marks are required' });
  }
  
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [examResult] = await connection.query(
      `INSERT INTO exams (title, description, created_by, status, duration_minutes, total_marks, passing_marks, instructions, allow_calculator, shuffle_questions, shuffle_options, show_results_after) 
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title && title.trim(),
        description && description.trim(),
        req.user.id,
        parseInt(duration_minutes),
        parseInt(total_marks),
        passing_marks ? parseInt(passing_marks) : null,
        instructions && instructions.trim(),
        allow_calculator ? 1 : 0,
        shuffle_questions ? 1 : 0,
        shuffle_options ? 1 : 0,
        show_results_after ? show_results_after.trim() : null
      ]
    );
    const examId = examResult.insertId;

    if (sections && sections.length > 0) {
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const [sectionResult] = await connection.query(
          `INSERT INTO exam_sections (exam_id, title, instructions, duration_minutes, section_order, marks_per_question) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [examId, s.title, s.instructions, s.duration_minutes, i + 1, s.marks_per_question]
        );
        const sectionId = sectionResult.insertId;

        if (s.questions && s.questions.length > 0) {
          for (let j = 0; j < s.questions.length; j++) {
            const q = s.questions[j];
            await connection.query(
              `INSERT INTO exam_questions (exam_id, section_id, question_bank_id, question_order, marks) 
               VALUES (?, ?, ?, ?, ?)`,
              [examId, sectionId, q.id, j + 1, q.marks || s.marks_per_question]
            );
          }
        }
      }
    }

    await connection.commit();
    res.status(201).json({ id: examId, message: 'Exam created successfully' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};

export const getExams = async (req, res) => {
  try {
    let query, params;
    
    if (req.user.role === 'faculty') {
      // Faculty sees all their exams
      query = 'SELECT * FROM exams WHERE created_by = ? ORDER BY created_at DESC';
      params = [req.user.id];
    } else {
      // Students see only active exams
      query = 'SELECT * FROM exams WHERE status = ? ORDER BY created_at DESC';
      params = ['active'];
    }
    
    const [exams] = await pool.query(query, params);
    res.json(exams);
  } catch (error) {
    console.error('Error getting exams:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getExamDetails = async (req, res) => {
  const { id } = req.params;
  try {
    const [exams] = await pool.query('SELECT * FROM exams WHERE id = ?', [id]);
    if (exams.length === 0) return res.status(404).json({ error: 'Exam not found' });

    const [sections] = await pool.query('SELECT * FROM exam_sections WHERE exam_id = ? ORDER BY section_order', [id]);

    const questionFields = req.user.role === 'faculty'
      ? 'eq.*, qb.question_text, qb.option_a, qb.option_b, qb.option_c, qb.option_d, qb.correct_answer, qb.question_type, qb.topic, qb.difficulty'
      : 'eq.*, qb.question_text, qb.option_a, qb.option_b, qb.option_c, qb.option_d, qb.question_type, qb.topic, qb.difficulty';
    const [questions] = await pool.query(
      `SELECT ${questionFields}
       FROM exam_questions eq
       JOIN question_bank qb ON eq.question_bank_id = qb.id
       WHERE eq.exam_id = ?
       ORDER BY eq.section_id, eq.question_order`,
      [id]
    );

    res.json({ ...exams[0], sections, questions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getExamAttempts = async (req, res) => {
  const { id } = req.params;
  try {
    const [ownedExam] = await pool.query('SELECT id FROM exams WHERE id = ? AND created_by = ?', [id, req.user.id]);
    if (ownedExam.length === 0) return res.status(404).json({ error: 'Exam not found' });

    const [attempts] = await pool.query(
      `SELECT a.*, u.name as student_name 
       FROM student_attempts a 
       JOIN users u ON a.student_id = u.id 
       WHERE a.exam_id = ? ORDER BY a.start_time DESC`,
      [id]
    );
    res.json(attempts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getExamActivityFeed = async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 500);

  try {
    const [ownedExam] = await pool.query('SELECT id FROM exams WHERE id = ? AND created_by = ?', [id, req.user.id]);
    if (ownedExam.length === 0) return res.status(404).json({ error: 'Exam not found' });

    const [activities] = await pool.query(
      `SELECT
        sa.id,
        sa.attempt_id,
        sa.student_id,
        sa.activity_type,
        sa.description,
        sa.question_index,
        sa.time_into_exam_seconds,
        sa.severity,
        sa.timestamp,
        u.name AS student_name
      FROM student_activity sa
      JOIN users u ON sa.student_id = u.id
      WHERE sa.exam_id = ?
      ORDER BY sa.timestamp DESC, sa.id DESC
      LIMIT ?`,
      [id, limit]
    );

    res.json(activities);
  } catch (error) {
    console.error('Error getting exam activity feed:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getExamHeatmap = async (req, res) => {
  const { id } = req.params;
  try {
    const [heatmap] = await pool.query(
      `SELECT violation_type, time_bucket_minutes, SUM(count) as total_count 
       FROM violation_heatmap 
       WHERE exam_id = ? 
       GROUP BY violation_type, time_bucket_minutes 
       ORDER BY time_bucket_minutes ASC`,
      [id]
    );
    res.json(heatmap);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateExamStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  try {
    // Verify faculty owns this exam
    const [exam] = await pool.query('SELECT created_by FROM exams WHERE id = ?', [id]);
    if (exam.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    
    if (exam[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. You can only modify your own exams.' });
    }

    // Validate status
    const validStatuses = ['draft', 'active', 'paused', 'ended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Update exam status
    await pool.query('UPDATE exams SET status = ? WHERE id = ? AND created_by = ?', [status, id, req.user.id]);

    // If pausing exam, pause all student attempts
    if (status === 'paused') {
      await pool.query(
        'UPDATE student_attempts SET status = ? WHERE exam_id = ? AND status = ?',
        ['paused', id, 'in_progress']
      );
    }

    // If resuming exam, resume paused attempts
    if (status === 'active') {
      await pool.query(
        'UPDATE student_attempts SET status = ? WHERE exam_id = ? AND status = ?',
        ['in_progress', id, 'paused']
      );
    }

    // If ending exam, auto-submit all in-progress attempts
    if (status === 'ended') {
      const [attempts] = await pool.query(
        'SELECT id FROM student_attempts WHERE exam_id = ? AND status IN (?, ?)',
        [id, 'in_progress', 'paused']
      );
      
      for (const attempt of attempts) {
        await finalizeAttempt(attempt.id, 'Exam ended by faculty');
      }
    }

    res.json({ 
      message: `Exam status updated to ${status}`,
      status: status
    });
  } catch (error) {
    console.error('Error updating exam status:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getExamQuestions = async (req, res) => {
  const { id } = req.params;
  try {
    const [questions] = await pool.query(`
      SELECT eq.*, qb.question_text, qb.option_a, qb.option_b, qb.option_c, qb.option_d, qb.correct_answer, qb.question_type, qb.topic, qb.difficulty
      FROM exam_questions eq
      JOIN question_bank qb ON eq.question_bank_id = qb.id
      WHERE eq.exam_id = ?
      ORDER BY eq.section_id, eq.question_order
    `, [id]);
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const addQuestionToExam = async (req, res) => {
  const { id } = req.params;
  const {
    question_bank_id,
    marks,
    question_text,
    option_a,
    option_b,
    option_c,
    option_d,
    correct_answer,
    topic,
    difficulty,
    question_type,
    sample_answer,
    grading_keywords
  } = req.body;
  
  try {
    if (question_bank_id) {
      const [[orderRow]] = await pool.query('SELECT COALESCE(MAX(question_order), 0) + 1 AS next_order FROM exam_questions WHERE exam_id = ?', [id]);
      const [result] = await pool.query(
        'INSERT INTO exam_questions (exam_id, question_bank_id, marks, question_order) VALUES (?, ?, ?, ?)',
        [id, question_bank_id, marks || 1, orderRow.next_order]
      );
      res.json({ id: result.insertId, message: 'Question added to exam' });
    } else {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const normalizedType = (question_type || 'mcq').toLowerCase();
        const normalizedMarks = Number.parseInt(marks, 10) || 1;
        const normalizedCorrectAnswer = normalizedType === 'mcq'
          ? correct_answer?.trim()?.toUpperCase()?.replace('OPTION_', '')
          : null;
        const normalizedKeywords = Array.isArray(grading_keywords)
          ? grading_keywords
          : typeof grading_keywords === 'string'
            ? grading_keywords.split(/[\n,]/)
            : [];

        if (!question_text?.trim() || !topic?.trim()) {
          return res.status(400).json({ error: 'Question text and topic are required' });
        }

        if (normalizedType === 'mcq') {
          const missingOptions = [option_a, option_b, option_c, option_d].some((value) => !value?.trim());
          if (missingOptions || !['A', 'B', 'C', 'D'].includes(normalizedCorrectAnswer)) {
            return res.status(400).json({ error: 'MCQ questions require options A-D and a valid correct answer' });
          }
        } else if (!sample_answer?.trim()) {
          return res.status(400).json({ error: 'Paragraph questions require a sample/model answer for grading' });
        }
        
        const [questionResult] = await connection.query(
          `INSERT INTO question_bank (created_by, question_text, option_a, option_b, option_c, option_d, correct_answer, topic, difficulty, marks, question_type, sample_answer, grading_keywords) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.user.id,
            question_text.trim(),
            normalizedType === 'mcq' ? option_a?.trim() : null,
            normalizedType === 'mcq' ? option_b?.trim() : null,
            normalizedType === 'mcq' ? option_c?.trim() : null,
            normalizedType === 'mcq' ? option_d?.trim() : null,
            normalizedCorrectAnswer,
            topic.trim(),
            (difficulty || 'medium').toLowerCase(),
            normalizedMarks,
            normalizedType,
            normalizedType === 'long_answer' ? sample_answer.trim() : null,
            normalizedType === 'long_answer'
              ? JSON.stringify(normalizedKeywords.map((keyword) => keyword.trim()).filter(Boolean))
              : JSON.stringify([])
          ]
        );
        
        const [[orderRow]] = await connection.query('SELECT COALESCE(MAX(question_order), 0) + 1 AS next_order FROM exam_questions WHERE exam_id = ?', [id]);
        const [examQuestionResult] = await connection.query(
          'INSERT INTO exam_questions (exam_id, question_bank_id, marks, question_order) VALUES (?, ?, ?, ?)',
          [id, questionResult.insertId, normalizedMarks, orderRow.next_order]
        );
        
        await connection.commit();
        res.json({ id: examQuestionResult.insertId, message: 'New question created and added to exam' });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
