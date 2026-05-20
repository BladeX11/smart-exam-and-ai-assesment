import pool from '../config/db.js';

export const getAllRiskProfiles = async (req, res) => {
  try {
    const [profiles] = await pool.query(`
      SELECT
        p.*,
        u.name,
        u.email,
        p.overall_risk AS risk_level,
        p.total_exams AS total_exams_taken,
        (
          p.total_tab_switches +
          p.total_face_violations +
          p.total_voice_violations +
          p.total_object_violations +
          p.total_copy_attempts
        ) AS total_violations,
        (
          SELECT COALESCE(ROUND(AVG(ati_score)), 100)
          FROM student_attempts a
          WHERE a.student_id = p.student_id AND a.status IN ('submitted','force_ended')
        ) AS ati_score
      FROM student_risk_profiles p 
      JOIN users u ON p.student_id = u.id
    `);
    res.json(profiles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateProfileNotes = async (req, res) => {
  const { id } = req.params;
  const { faculty_notes } = req.body;
  try {
    await pool.query('UPDATE student_risk_profiles SET faculty_notes = ? WHERE id = ?', [faculty_notes, id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getStudentHistory = async (req, res) => {
  const { studentId } = req.params;

  try {
    const [studentRows] = await pool.query(
      `SELECT id, name, email
       FROM users
       WHERE id = ? AND role = 'student'`,
      [studentId]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const [attempts] = await pool.query(
      `SELECT
        sa.*,
        e.title AS exam_title
      FROM student_attempts sa
      JOIN exams e ON sa.exam_id = e.id
      WHERE sa.student_id = ? AND e.created_by = ?
      ORDER BY COALESCE(sa.submit_time, sa.start_time) DESC, sa.id DESC`,
      [studentId, req.user.id]
    );

    const [activities] = await pool.query(
      `SELECT
        act.id,
        act.attempt_id,
        act.activity_type,
        act.description,
        act.question_index,
        act.time_into_exam_seconds,
        act.severity,
        act.timestamp,
        e.title AS exam_title
      FROM student_activity act
      JOIN exams e ON act.exam_id = e.id
      WHERE act.student_id = ? AND e.created_by = ?
      ORDER BY act.timestamp DESC, act.id DESC`,
      [studentId, req.user.id]
    );

    res.json({
      student: studentRows[0],
      attempts,
      activities
    });
  } catch (error) {
    console.error('Error getting student history:', error);
    res.status(500).json({ error: error.message });
  }
};
