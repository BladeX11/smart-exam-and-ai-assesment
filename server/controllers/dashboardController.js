import pool from '../config/db.js';

export const getFacultyDashboard = async (req, res) => {
  const facultyId = req.user.id;
  
  try {
    // Get basic stats
    const [totalExamsResult] = await pool.query(
      'SELECT COUNT(*) as count FROM exams WHERE created_by = ?',
      [facultyId]
    );
    
    const [activeExamsResult] = await pool.query(
      'SELECT COUNT(*) as count FROM exams WHERE created_by = ? AND status = ?',
      [facultyId, 'active']
    );
    
    const [totalStudentsResult] = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE role = ?',
      ['student']
    );
    
    const [avgAtiResult] = await pool.query(
      'SELECT AVG(ati_score) as avg_score FROM student_attempts WHERE exam_id IN (SELECT id FROM exams WHERE created_by = ?)',
      [facultyId]
    );
    
    const [suspiciousResult] = await pool.query(
      'SELECT COUNT(*) as count FROM student_attempts WHERE is_suspicious = 1 AND exam_id IN (SELECT id FROM exams WHERE created_by = ?)',
      [facultyId]
    );

    // Get exams list with student count and avg score
    const [examsList] = await pool.query(`
      SELECT e.*, 
        COUNT(DISTINCT sa.student_id) as student_count,
        AVG(sa.score) as avg_score
      FROM exams e
      LEFT JOIN student_attempts sa ON e.id = sa.exam_id
      WHERE e.created_by = ?
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `, [facultyId]);

    // Get recent results
    const [recentResults] = await pool.query(`
      SELECT 
        sa.*,
        u.name as student_name,
        e.title as exam_title
      FROM student_attempts sa
      JOIN users u ON sa.student_id = u.id
      JOIN exams e ON sa.exam_id = e.id
      WHERE e.created_by = ?
      ORDER BY sa.submit_time DESC
      LIMIT 10
    `, [facultyId]);

    // Get performance data for charts
    const [performanceData] = await pool.query(`
      SELECT 
        e.title,
        e.total_marks,
        AVG(sa.score) as avg_score,
        AVG(CASE WHEN e.total_marks > 0 THEN (sa.score / e.total_marks) * 100 ELSE 0 END) as avg_score_percent
      FROM exams e 
      JOIN student_attempts sa ON e.id = sa.exam_id
      WHERE e.created_by = ?
      GROUP BY e.id, e.title, e.total_marks
    `, [facultyId]);

    // Get risk distribution
    const [riskDistribution] = await pool.query(`
      SELECT risk_level, COUNT(*) as count
      FROM student_attempts
      WHERE exam_id IN (SELECT id FROM exams WHERE created_by = ?)
      GROUP BY risk_level
    `, [facultyId]);

    res.json({
      stats: {
        totalExams: totalExamsResult[0].count,
        activeExams: activeExamsResult[0].count,
        totalStudents: totalStudentsResult[0].count,
        avgAtiScore: Math.round(avgAtiResult[0].avg_score || 100),
        suspiciousCount: suspiciousResult[0].count
      },
      examsList,
      recentResults,
      performanceData,
      riskDistribution
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
};
