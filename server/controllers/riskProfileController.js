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
