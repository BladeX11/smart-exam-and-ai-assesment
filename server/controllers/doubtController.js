import pool from '../config/db.js';

export const submitDoubt = async (req, res) => {
  const { examId, attemptId, questionId, doubt_text } = req.body;
  try {
    await pool.query(
      'INSERT INTO doubt_submissions (exam_id, attempt_id, student_id, question_id, doubt_text) VALUES (?, ?, ?, ?, ?)',
      [examId, attemptId, req.user.id, questionId, doubt_text]
    );
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getDoubts = async (req, res) => {
  const { examId } = req.params;
  try {
    const [doubts] = await pool.query(
      `SELECT d.*, u.name as student_name, qb.question_text 
       FROM doubt_submissions d 
       JOIN users u ON d.student_id = u.id 
       JOIN exam_questions eq ON d.question_id = eq.id
       JOIN question_bank qb ON eq.question_bank_id = qb.id
       WHERE d.exam_id = ? ORDER BY d.submitted_at DESC`,
      [examId]
    );
    res.json(doubts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const resolveDoubt = async (req, res) => {
  const { id } = req.params;
  const { faculty_response, status } = req.body;
  try {
    await pool.query(
      'UPDATE doubt_submissions SET faculty_response = ?, status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?',
      [faculty_response, status || 'resolved', id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
