import pool from '../config/db.js';

const normalizeQuestionPayload = (payload = {}) => {
  const questionType = (payload.question_type || 'mcq').toLowerCase();
  const normalizedMarks = Number.parseInt(payload.marks, 10);
  const normalizedKeywords = Array.isArray(payload.grading_keywords)
    ? payload.grading_keywords
    : typeof payload.grading_keywords === 'string'
      ? payload.grading_keywords.split(/[\n,]/)
      : [];

  return {
    topic: payload.topic?.trim(),
    subtopic: payload.subtopic?.trim() || null,
    question_text: payload.question_text?.trim(),
    option_a: questionType === 'mcq' ? payload.option_a?.trim() : null,
    option_b: questionType === 'mcq' ? payload.option_b?.trim() : null,
    option_c: questionType === 'mcq' ? payload.option_c?.trim() : null,
    option_d: questionType === 'mcq' ? payload.option_d?.trim() : null,
    correct_answer: questionType === 'mcq' ? payload.correct_answer?.trim()?.toUpperCase()?.replace('OPTION_', '') : null,
    question_type: questionType,
    sample_answer: questionType === 'long_answer' ? payload.sample_answer?.trim() || null : null,
    grading_keywords: questionType === 'long_answer'
      ? normalizedKeywords.map((keyword) => keyword.trim()).filter(Boolean)
      : [],
    difficulty: (payload.difficulty || 'medium').toLowerCase(),
    marks: Number.isFinite(normalizedMarks) && normalizedMarks > 0 ? normalizedMarks : 1,
    tags: Array.isArray(payload.tags) ? payload.tags : []
  };
};

const serializeQuestionRow = (row) => {
  if (!row) return row;
  let parsedKeywords = [];
  try {
    if (typeof row.grading_keywords === 'string' && row.grading_keywords.trim()) {
      parsedKeywords = JSON.parse(row.grading_keywords);
    } else if (Array.isArray(row.grading_keywords)) {
      parsedKeywords = row.grading_keywords;
    }
  } catch {
    parsedKeywords = typeof row.grading_keywords === 'string'
      ? row.grading_keywords.split(/[\n,]/).map((keyword) => keyword.trim()).filter(Boolean)
      : [];
  }

  return {
    ...row,
    grading_keywords: parsedKeywords
  };
};

const validateQuestionPayload = (question) => {
  if (!question.question_text) return 'Question text is required';
  if (!question.topic) return 'Topic is required';
  if (!question.difficulty) return 'Difficulty is required';
  if (!Number.isFinite(question.marks) || question.marks <= 0) return 'Marks must be greater than 0';
  if (!['mcq', 'long_answer'].includes(question.question_type)) {
    return 'Question type must be mcq or long_answer';
  }

  if (question.question_type === 'mcq') {
    const missingFields = ['option_a', 'option_b', 'option_c', 'option_d', 'correct_answer']
      .filter((field) => !question[field]);
    if (missingFields.length > 0) {
      return `Missing required fields for MCQ: ${missingFields.join(', ')}`;
    }

    const validOptions = ['A', 'B', 'C', 'D'];
    if (!validOptions.includes(question.correct_answer)) {
      return `Invalid correct answer: ${question.correct_answer}`;
    }
  }

  if (question.question_type === 'long_answer' && !question.sample_answer) {
    return 'Paragraph questions need a sample/model answer for automatic grading';
  }

  return null;
};

export const getQuestions = async (req, res) => {
  try {
    const [questions] = await pool.query('SELECT * FROM question_bank WHERE is_active = TRUE ORDER BY created_at DESC');
    res.json(questions.map(serializeQuestionRow));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createQuestion = async (req, res) => {
  const question = normalizeQuestionPayload(req.body);
  const validationError = validateQuestionPayload(question);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO question_bank (created_by, topic, subtopic, question_text, option_a, option_b, option_c, option_d, correct_answer, question_type, sample_answer, grading_keywords, difficulty, marks, tags) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        question.topic,
        question.subtopic,
        question.question_text,
        question.option_a,
        question.option_b,
        question.option_c,
        question.option_d,
        question.correct_answer,
        question.question_type,
        question.sample_answer,
        JSON.stringify(question.grading_keywords),
        question.difficulty,
        question.marks,
        JSON.stringify(question.tags)
      ]
    );
    res.status(201).json({ id: result.insertId, message: 'Question added to bank' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateQuestion = async (req, res) => {
  const { id } = req.params;
  const { change_note } = req.body;
  const question = normalizeQuestionPayload(req.body);
  const validationError = validateQuestionPayload(question);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

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
       question_type = ?, sample_answer = ?, grading_keywords = ?, difficulty = ?, marks = ?, tags = ?, version = version + 1 
       WHERE id = ?`,
      [
        question.topic,
        question.subtopic,
        question.question_text,
        question.option_a,
        question.option_b,
        question.option_c,
        question.option_d,
        question.correct_answer,
        question.question_type,
        question.sample_answer,
        JSON.stringify(question.grading_keywords),
        question.difficulty,
        question.marks,
        JSON.stringify(question.tags),
        id
      ]
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
      const q = normalizeQuestionPayload(questions[i]);
      const validationError = validateQuestionPayload(q);

      if (validationError) {
        results.errors.push(`Question ${i + 1}: ${validationError}`);
        results.errorDetails.push({ row: i + 1, question: q.question_text?.substring(0, 50) + '...', error: validationError });
        continue;
      }

      try {
        await connection.query(
          `INSERT INTO question_bank (
            created_by, topic, subtopic, question_text, option_a, option_b, option_c, option_d, 
            correct_answer, question_type, sample_answer, grading_keywords, difficulty, marks, tags, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.user.id,
            q.topic,
            q.subtopic || null,
            q.question_text,
            q.option_a,
            q.option_b,
            q.option_c,
            q.option_d,
            q.correct_answer || '',
            q.question_type,
            q.sample_answer,
            JSON.stringify(q.grading_keywords),
            q.difficulty,
            q.marks,
            JSON.stringify(q.tags),
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
