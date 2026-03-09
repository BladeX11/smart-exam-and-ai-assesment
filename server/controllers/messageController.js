import pool from '../config/db.js';

export const getMessages = async (req, res) => {
  const { examId } = req.params;
  try {
    const { studentId } = req.query;

    let whereClause = 'WHERE m.exam_id = ?';
    const params = [examId];

    if (req.user.role === 'student') {
      whereClause += ' AND m.student_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'faculty' && studentId) {
      whereClause += ' AND m.student_id = ?';
      params.push(studentId);
    }

    const [messages] = await pool.query(
      `SELECT m.*,
       CASE WHEN m.sender_role = 'faculty' THEN f.name ELSE s.name END as sender_name 
       FROM exam_messages m 
       LEFT JOIN users s ON m.student_id = s.id 
       LEFT JOIN users f ON m.faculty_id = f.id
       ${whereClause}
       ORDER BY m.created_at ASC`,
      params
    );
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const sendMessage = async (req, res) => {
  const { examId, studentId, message, message_type } = req.body;
  try {
    const type = message_type || 'chat';

    // Students can only message within their own thread
    if (req.user.role === 'student') {
      await pool.query(
        'INSERT INTO exam_messages (exam_id, student_id, faculty_id, sender_role, message, message_type) VALUES (?, ?, ?, ?, ?, ?)',
        [examId, req.user.id, null, 'student', message, type]
      );
      return res.status(201).json({ success: true });
    }

    // Faculty reply to a specific student
    if (req.user.role === 'faculty' && type !== 'announcement') {
      if (!studentId) return res.status(400).json({ error: 'studentId is required for chat messages' });
      await pool.query(
        'INSERT INTO exam_messages (exam_id, student_id, faculty_id, sender_role, message, message_type) VALUES (?, ?, ?, ?, ?, ?)',
        [examId, studentId, req.user.id, 'faculty', message, type]
      );
      return res.status(201).json({ success: true });
    }

    // Faculty broadcast: create one announcement per student attempt (schema requires student_id)
    if (req.user.role === 'faculty' && type === 'announcement') {
      const [students] = await pool.query('SELECT DISTINCT student_id FROM student_attempts WHERE exam_id = ?', [examId]);
      for (const s of students) {
        await pool.query(
          'INSERT INTO exam_messages (exam_id, student_id, faculty_id, sender_role, message, message_type) VALUES (?, ?, ?, ?, ?, ?)',
          [examId, s.student_id, req.user.id, 'faculty', message, 'announcement']
        );
      }
      return res.status(201).json({ success: true, recipients: students.length });
    }

    return res.status(400).json({ error: 'Invalid message request' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
