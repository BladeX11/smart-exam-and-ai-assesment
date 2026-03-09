import pool from '../config/db.js';

export const getQuestions = async (req, res) => {
  try {
    const [questions] = await pool.query('SELECT * FROM question_bank WHERE is_active = TRUE ORDER BY created_at DESC');
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createQuestion = async (req, res) => {
  const { topic, subtopic, question_text, option_a, option_b, option_c, option_d, correct_answer, question_type, difficulty, marks, tags } = req.body;
  try {
    const [result] = await pool.query(
      `INSERT INTO question_bank (created_by, topic, subtopic, question_text, option_a, option_b, option_c, option_d, correct_answer, question_type, difficulty, marks, tags) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, topic, subtopic, question_text, option_a, option_b, option_c, option_d, correct_answer, question_type, difficulty, marks, JSON.stringify(tags || [])]
    );
    res.status(201).json({ id: result.insertId, message: 'Question added to bank' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateQuestion = async (req, res) => {
  const { id } = req.params;
  const { topic, subtopic, question_text, option_a, option_b, option_c, option_d, correct_answer, question_type, difficulty, marks, tags, change_note } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Get current version
    const [current] = await connection.query('SELECT * FROM question_bank WHERE id = ?', [id]);
    if (current.length === 0) return res.status(404).json({ error: 'Question not found' });

    // Save to history
    await connection.query(
      `INSERT INTO question_bank_history (question_id, version, question_text, option_a, option_b, option_c, option_d, correct_answer, changed_by, change_note) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, current[0].version, current[0].question_text, current[0].option_a, current[0].option_b, current[0].option_c, current[0].option_d, current[0].correct_answer, req.user.id, change_note || 'Updated']
    );

    // Update main table
    await connection.query(
      `UPDATE question_bank SET 
       topic = ?, subtopic = ?, question_text = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?, correct_answer = ?, 
       question_type = ?, difficulty = ?, marks = ?, tags = ?, version = version + 1 
       WHERE id = ?`,
      [topic, subtopic, question_text, option_a, option_b, option_c, option_d, correct_answer, question_type, difficulty, marks, JSON.stringify(tags || []), id]
    );

    await connection.commit();
    res.json({ message: 'Question updated and version saved' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};

export const getHistory = async (req, res) => {
  const { id } = req.params;
  try {
    const [history] = await pool.query('SELECT * FROM question_bank_history WHERE question_id = ? ORDER BY version DESC', [id]);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const bulkImportQuestions = async (req, res) => {
  const { questions } = req.body;
  
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'No questions provided' });
  }

  const connection = await pool.getConnection();
  const results = {
    imported: 0,
    errors: [],
    errorDetails: []
  };

  try {
    await connection.beginTransaction();

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      
      // Validate required fields
      const requiredFields = ['question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'topic', 'difficulty', 'marks'];
      const missingFields = requiredFields.filter(field => !q[field]);
      
      if (missingFields.length > 0) {
        results.errors.push(`Question ${i + 1}: Missing required fields: ${missingFields.join(', ')}`);
        results.errorDetails.push({ row: i + 1, question: q.question_text?.substring(0, 50) + '...', error: 'Missing fields' });
        continue;
      }

      // Validate correct_answer is one of the options
      const validOptions = ['a', 'b', 'c', 'd', 'A', 'B', 'C', 'D', 'option_a', 'option_b', 'option_c', 'option_d'];
      if (!q.correct_answer || !validOptions.includes(q.correct_answer.trim())) {
        results.errors.push(`Question ${i + 1}: Invalid correct answer: ${q.correct_answer}`);
        results.errorDetails.push({ row: i + 1, question: q.question_text?.substring(0, 50) + '...', error: 'Invalid correct answer' });
        continue;
      }

      try {
        await connection.query(
          `INSERT INTO question_bank (
            created_by, topic, subtopic, question_text, option_a, option_b, option_c, option_d, 
            correct_answer, question_type, difficulty, marks, tags, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.user.id,
            q.topic,
            q.subtopic || null,
            q.question_text,
            q.option_a,
            q.option_b,
            q.option_c,
            q.option_d,
            q.correct_answer ? q.correct_answer.toUpperCase().replace('OPTION_', '') : '',
            q.question_type || 'mcq',
            q.difficulty,
            q.marks,
            JSON.stringify(q.tags || []),
            true
          ]
        );
        results.imported++;
      } catch (error) {
        results.errors.push(`Question ${i + 1}: Database error - ${error.message}`);
        results.errorDetails.push({ row: i + 1, question: q.question_text?.substring(0, 50) + '...', error: error.message });
      }
    }

    await connection.commit();
    res.status(201).json(results);
  } catch (error) {
    await connection.rollback();
    console.error('Bulk import error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};

export const deleteQuestion = async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await pool.query('SELECT id FROM question_bank WHERE id = ? AND is_active = TRUE', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Question not found' });
    await pool.query('UPDATE question_bank SET is_active = FALSE WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
