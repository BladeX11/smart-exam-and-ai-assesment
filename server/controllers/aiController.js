import pool from '../config/db.js';
import { callClaude } from '../utils/claudeClient.js';
import { gradeLongAnswer } from '../utils/longAnswerGrader.js';

const getAttemptAccessRow = async (attemptId) => {
  const [rows] = await pool.query(
    `SELECT sa.id, sa.student_id, sa.exam_id, e.created_by AS exam_owner_id
     FROM student_attempts sa
     JOIN exams e ON sa.exam_id = e.id
     WHERE sa.id = ?`,
    [attemptId]
  );

  return rows[0] || null;
};

const ensureAttemptAccess = async (attemptId, user) => {
  const attempt = await getAttemptAccessRow(attemptId);
  if (!attempt) {
    const error = new Error('Attempt not found');
    error.status = 404;
    throw error;
  }

  const allowed =
    Number(attempt.student_id) === Number(user.id) ||
    (user.role === 'faculty' && Number(attempt.exam_owner_id) === Number(user.id));

  if (!allowed) {
    const error = new Error('Access denied');
    error.status = 403;
    throw error;
  }

  return attempt;
};

export const generateStudyPlan = async (req, res) => {
  const { attemptId } = req.params;
  try {
    await ensureAttemptAccess(attemptId, req.user);

    // Get attempt data with questions and answers
    const [attempts] = await pool.query(`
      SELECT sa.*, e.title as exam_title, e.total_marks, eq.question_bank_id, eq.marks as question_marks, qb.question_text, qb.correct_answer, qb.question_type, qb.sample_answer, qb.grading_keywords, qb.topic, qb.difficulty
      FROM student_attempts sa
      JOIN exams e ON sa.exam_id = e.id
      LEFT JOIN exam_questions eq ON e.id = eq.exam_id
      LEFT JOIN question_bank qb ON eq.question_bank_id = qb.id
      WHERE sa.id = ?
    `, [attemptId]);
    
    if (attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
    
    const attempt = attempts[0];
    const answers = typeof attempt.answers === 'string' ? JSON.parse(attempt.answers || '{}') : (attempt.answers || {});
    const longAnswers = typeof attempt.long_answers === 'string' ? JSON.parse(attempt.long_answers || '{}') : (attempt.long_answers || {});
    
    // Analyze performance by topic
    const topicPerformance = {};
    const questionReview = [];
    for (const row of attempts) {
      const topic = row.topic || 'General';
      if (!row.question_bank_id) continue;

      if (!topicPerformance[topic]) {
        topicPerformance[topic] = {
          total: 0,
          correct: 0,
          totalMarks: 0,
          earnedMarks: 0,
          difficulties: { easy: { total: 0, correct: 0 }, medium: { total: 0, correct: 0 }, hard: { total: 0, correct: 0 } },
          questions: []
        };
      }

      const questionType = row.question_type || 'mcq';
      const userAnswer = questionType === 'long_answer'
        ? (longAnswers[row.question_bank_id] || 'Not answered')
        : (answers[row.question_bank_id] || 'Not answered');
      let isCorrect = false;
      let earnedMarks = 0;
      let longAnswerFeedback = null;

      if (questionType === 'long_answer') {
        const evaluation = await gradeLongAnswer({
          questionText: row.question_text,
          sampleAnswer: row.sample_answer,
          gradingKeywords: row.grading_keywords,
          studentAnswer: longAnswers[row.question_bank_id] || '',
          marks: row.question_marks || 1
        });
        earnedMarks = evaluation.awarded_marks;
        isCorrect = evaluation.score_ratio >= 0.6;
        longAnswerFeedback = evaluation.feedback;
      } else {
        isCorrect = answers[row.question_bank_id] === row.correct_answer;
        earnedMarks = isCorrect ? (row.question_marks || 1) : 0;
      }
      const difficulty = row.difficulty || 'medium';
      const perf = topicPerformance[topic];

      perf.total++;
      perf.totalMarks += row.question_marks || 1;
      perf.questions.push({
        question: row.question_text,
        correct: isCorrect,
        difficulty,
        question_type: questionType,
        your_answer: userAnswer,
        correct_answer: questionType === 'long_answer' ? row.sample_answer : row.correct_answer,
        earned_marks: earnedMarks,
        feedback: longAnswerFeedback
      });

      if (perf.difficulties[difficulty]) {
        perf.difficulties[difficulty].total++;
        if (isCorrect) perf.difficulties[difficulty].correct++;
      }

      if (earnedMarks > 0) {
        perf.earnedMarks += earnedMarks;
      }

      if (isCorrect && questionType !== 'long_answer') {
        perf.correct++;
      } else if (questionType === 'long_answer' && earnedMarks >= ((row.question_marks || 1) * 0.6)) {
        perf.correct++;
      }

      questionReview.push({
        question_id: row.question_bank_id,
        topic,
        question: row.question_text,
        question_type: questionType,
        your_answer: userAnswer,
        correct_answer: questionType === 'long_answer' ? row.sample_answer : row.correct_answer,
        is_correct: isCorrect,
        difficulty,
        marks: row.question_marks || 1,
        earned_marks: earnedMarks,
        learning_note: questionType === 'long_answer'
          ? (longAnswerFeedback || `Strengthen structure and key concepts in this ${topic} paragraph answer.`)
          : isCorrect
            ? `Keep practicing ${topic} at ${difficulty} level to maintain consistency.`
            : `Review the core concept behind this ${difficulty} ${topic} question and solve two similar problems.`
      });
    }

    const topicBreakdown = Object.entries(topicPerformance).map(([topic, perf]) => {
      const accuracy = perf.total ? Math.round((perf.correct / perf.total) * 100) : 0;
      const priority = accuracy < 50 ? 'high' : accuracy < 75 ? 'medium' : 'low';
      return {
        topic,
        correct: perf.correct,
        total: perf.total,
        accuracy,
        earned_marks: perf.earnedMarks,
        total_marks: perf.totalMarks,
        priority,
        focus_reason:
          accuracy < 50
            ? 'Core concepts need rebuilding before moving to harder questions.'
            : accuracy < 75
              ? 'Foundation is present, but accuracy needs better repetition and error correction.'
              : 'Strong area. Preserve speed and consistency with maintenance practice.',
        action_items:
          accuracy < 50
            ? ['Relearn definitions and core formulas', 'Solve 5 easy-to-medium questions', 'Write a short summary of common mistakes']
            : accuracy < 75
              ? ['Practice mixed questions', 'Review mistakes from this topic', 'Time yourself on 3 questions']
              : ['Do 2 challenge questions', 'Revise key shortcuts once', 'Keep this topic in weekly revision'],
        difficulty_breakdown: perf.difficulties
      };
    }).sort((a, b) => a.accuracy - b.accuracy);

    const weakTopics = topicBreakdown.filter(topic => topic.accuracy < 60).map(topic => topic.topic);
    const strongTopics = topicBreakdown.filter(topic => topic.accuracy >= 80).map(topic => topic.topic);
    const scorePercent = attempt.total_marks ? Math.round((attempt.score / attempt.total_marks) * 100) : 0;

    // Generate study plan using Claude
    const prompt = `Generate a personalized study plan based on this exam performance data:

Exam: ${attempt.exam_title}
Score: ${attempt.score}/${attempt.total_marks} (${scorePercent}%)
ATI Score: ${attempt.ati_score}

Topic Performance:
${topicBreakdown.map(topic =>
  `${topic.topic}: ${topic.correct}/${topic.total} (${topic.accuracy}%), priority=${topic.priority}`
).join('\n')}

Generate a JSON study plan with:
{
  "study_plan": {
    "overall_assessment": "Brief assessment of performance",
    "weak_areas": ["list of topics needing improvement"],
    "strong_areas": ["list of well-performed topics"],
    "recommendations": [
      {
        "topic": "topic name",
        "priority": "high|medium|low",
        "current_accuracy": 45,
        "target_accuracy": 75,
        "study_time_hours": 5,
        "resources": ["specific study resources"],
        "practice_exercises": ["types of practice needed"],
        "mistakes_to_fix": ["what to correct next"]
      }
    ],
    "timeline": "2-4 week study timeline",
    "next_steps": ["immediate next steps"],
    "daily_plan": [
      {
        "day": "Day 1",
        "focus": "topic or objective",
        "tasks": ["task 1", "task 2", "task 3"]
      }
    ]
  }
}

Return only valid JSON.`;

    let studyPlan = null;
    try {
      const aiResponse = await callClaude(prompt, 2000);
      if (aiResponse) {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        studyPlan = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      }
    } catch (error) {
      console.error('Failed to generate AI study plan:', error);
    }

    // Fallback study plan if AI fails
    if (!studyPlan) {
      studyPlan = {
        study_plan: {
          overall_assessment: `You scored ${scorePercent}%. Focus first on the lowest-accuracy topics, then move to timed mixed practice to improve consistency.`,
          weak_areas: weakTopics,
          strong_areas: strongTopics,
          recommendations: topicBreakdown.slice(0, 4).map(topic => ({
            topic: topic.topic,
            priority: topic.priority,
            current_accuracy: topic.accuracy,
            target_accuracy: topic.accuracy >= 80 ? 90 : topic.accuracy >= 60 ? 80 : 70,
            study_time_hours: topic.priority === 'high' ? 4 : topic.priority === 'medium' ? 3 : 2,
            resources: ['Class notes', 'Solved examples', 'Topic-wise practice set'],
            practice_exercises: ['Rework missed question types', 'Timed MCQ drills', 'Concept recap notes'],
            mistakes_to_fix: topic.action_items
          })),
          timeline: '7-day reset followed by 1 week of timed revision',
          next_steps: [
            'Start with your weakest topic today',
            'Review every missed question from this exam',
            'Take a short timed quiz after two study sessions'
          ],
          daily_plan: [
            { day: 'Day 1', focus: weakTopics[0] || 'Weakest topic review', tasks: ['Read concept notes', 'Solve 5 guided questions', 'Write 3 mistakes you made'] },
            { day: 'Day 2', focus: weakTopics[1] || 'Second weakest topic', tasks: ['Review examples', 'Solve 8 practice questions', 'Check answer patterns'] },
            { day: 'Day 3', focus: 'Error correction', tasks: ['Reattempt missed exam questions', 'Revise formulas or definitions', 'Create a one-page summary'] },
            { day: 'Day 4', focus: strongTopics[0] || 'Maintenance practice', tasks: ['Solve 5 mixed questions', 'Maintain speed', 'Review one tricky concept'] },
            { day: 'Day 5', focus: 'Mixed revision', tasks: ['Attempt a timed mini quiz', 'Review wrong answers', 'Tag recurring mistakes'] },
            { day: 'Day 6', focus: 'Applied practice', tasks: ['Do medium-to-hard questions', 'Compare methods', 'Revise weak sub-concepts'] },
            { day: 'Day 7', focus: 'Checkpoint test', tasks: ['Take a 20-minute mock', 'Review topic accuracy', 'Set next-week priorities'] }
          ]
        }
      };
    }

    const mergedPlan = {
      ...studyPlan.study_plan,
      weak_areas: Array.isArray(studyPlan.study_plan?.weak_areas) && studyPlan.study_plan.weak_areas.length ? studyPlan.study_plan.weak_areas : weakTopics,
      strong_areas: Array.isArray(studyPlan.study_plan?.strong_areas) ? studyPlan.study_plan.strong_areas : strongTopics,
      topic_breakdown: topicBreakdown,
      question_review: questionReview
        .filter(question => !question.is_correct)
        .slice(0, 12),
      daily_plan: Array.isArray(studyPlan.study_plan?.daily_plan) && studyPlan.study_plan.daily_plan.length
        ? studyPlan.study_plan.daily_plan
        : studyPlan.study_plan?.daily_plan || []
    };

    // Save study plan to database
    await pool.query(
      `INSERT INTO ai_assessments (attempt_id, study_plan)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE study_plan = VALUES(study_plan)`,
      [attemptId, JSON.stringify(mergedPlan)]
    );

    res.json({ study_plan: mergedPlan });
  } catch (error) {
    console.error('Error generating study plan:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
};

export const getAIReport = async (req, res) => {
  const { attemptId } = req.params;
  try {
    await ensureAttemptAccess(attemptId, req.user);
    const [reports] = await pool.query('SELECT * FROM ai_assessments WHERE attempt_id = ?', [attemptId]);
    if (reports.length === 0) return res.status(404).json({ error: 'Report not found' });
    res.json(reports[0]);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};

export const saveAIReport = async (req, res) => {
  const { attemptId } = req.params;
  const { risk_score, anomaly_detected, cheat_pattern_report, study_plan } = req.body;
  try {
    await ensureAttemptAccess(attemptId, req.user);
    const serializedCheatPattern = cheat_pattern_report === undefined ? null : JSON.stringify(cheat_pattern_report);
    const serializedStudyPlan = study_plan === undefined ? null : JSON.stringify(study_plan);

    await pool.query(
      `INSERT INTO ai_assessments (attempt_id, risk_score, anomaly_detected, cheat_pattern_report, study_plan) 
       VALUES (?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE 
       risk_score = COALESCE(VALUES(risk_score), risk_score), 
       anomaly_detected = COALESCE(VALUES(anomaly_detected), anomaly_detected), 
       cheat_pattern_report = COALESCE(VALUES(cheat_pattern_report), cheat_pattern_report), 
       study_plan = COALESCE(VALUES(study_plan), study_plan)`,
      [attemptId, risk_score ?? null, anomaly_detected ?? null, serializedCheatPattern, serializedStudyPlan]
    );
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};
