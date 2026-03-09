import pool from '../config/db.js';
import { analyzeCheatPattern } from '../utils/cheatPattern.js';
import { callClaude } from '../utils/claudeClient.js';

export const generateStudyPlan = async (req, res) => {
  const { attemptId } = req.params;
  try {
    // Get attempt data with questions and answers
    const [attempts] = await pool.query(`
      SELECT sa.*, e.title as exam_title, eq.marks as question_marks, qb.question_text, qb.correct_answer, qb.topic, qb.difficulty
      FROM student_attempts sa
      JOIN exams e ON sa.exam_id = e.id
      LEFT JOIN exam_questions eq ON e.id = eq.exam_id
      LEFT JOIN question_bank qb ON eq.question_bank_id = qb.id
      WHERE sa.id = ?
    `, [attemptId]);
    
    if (attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
    
    const attempt = attempts[0];
    const answers = typeof attempt.answers === 'string' ? JSON.parse(attempt.answers || '{}') : (attempt.answers || {});
    
    // Analyze performance by topic
    const topicPerformance = {};
    attempts.forEach(row => {
      if (!row.topic) return;
      
      if (!topicPerformance[row.topic]) {
        topicPerformance[row.topic] = { total: 0, correct: 0, questions: [] };
      }
      
      topicPerformance[row.topic].total++;
      topicPerformance[row.topic].questions.push({
        question: row.question_text,
        correct: answers[row.question_bank_id] === row.correct_answer,
        difficulty: row.difficulty
      });
      
      if (answers[row.question_bank_id] === row.correct_answer) {
        topicPerformance[row.topic].correct++;
      }
    });

    // Generate study plan using Claude
    const prompt = `Generate a personalized study plan based on this exam performance data:

Exam: ${attempt.exam_title}
Score: ${attempt.score}/${attempt.total_marks} (${Math.round((attempt.score / attempt.total_marks) * 100)}%)
ATI Score: ${attempt.ati_score}

Topic Performance:
${Object.entries(topicPerformance).map(([topic, perf]) => 
  `${topic}: ${perf.correct}/${perf.total} (${Math.round((perf.correct / perf.total) * 100)}%)`
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
        "study_time_hours": 5,
        "resources": ["specific study resources"],
        "practice_exercises": ["types of practice needed"]
      }
    ],
    "timeline": "2-4 week study timeline",
    "next_steps": ["immediate next steps"]
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
      const weakTopics = Object.entries(topicPerformance)
        .filter(([_, perf]) => (perf.correct / perf.total) < 0.6)
        .map(([topic, _]) => topic);
      
      studyPlan = {
        study_plan: {
          overall_assessment: `Score of ${Math.round((attempt.score / attempt.total_marks) * 100)}% shows room for improvement`,
          weak_areas: weakTopics,
          strong_areas: Object.entries(topicPerformance)
            .filter(([_, perf]) => (perf.correct / perf.total) >= 0.8)
            .map(([topic, _]) => topic),
          recommendations: weakTopics.map(topic => ({
            topic,
            priority: 'high',
            study_time_hours: 3,
            resources: ['Textbook review', 'Practice questions', 'Online tutorials'],
            practice_exercises: ['Multiple choice questions', 'Problem sets']
          })),
          timeline: '2-3 weeks',
          next_steps: ['Review weak topics', 'Practice similar questions', 'Take mock tests']
        }
      };
    }

    // Save study plan to database
    await pool.query(
      'UPDATE ai_assessments SET study_plan = ? WHERE attempt_id = ?',
      [JSON.stringify(studyPlan.study_plan), attemptId]
    );

    res.json(studyPlan);
  } catch (error) {
    console.error('Error generating study plan:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getAIReport = async (req, res) => {
  const { attemptId } = req.params;
  try {
    const [reports] = await pool.query('SELECT * FROM ai_assessments WHERE attempt_id = ?', [attemptId]);
    if (reports.length === 0) return res.status(404).json({ error: 'Report not found' });
    res.json(reports[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const saveAIReport = async (req, res) => {
  const { attemptId } = req.params;
  const { risk_score, anomaly_detected, cheat_pattern_report, study_plan } = req.body;
  try {
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
    res.status(500).json({ error: error.message });
  }
};
