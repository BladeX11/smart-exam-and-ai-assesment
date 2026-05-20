import { callClaude } from './claudeClient.js';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'their', 'there', 'these', 'this', 'to', 'was', 'were', 'will', 'with'
]);

const tokenize = (text = '') => (
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
);

const getUniqueTokens = (text = '') => Array.from(new Set(tokenize(text)));

const computeJaccard = (leftTokens, rightTokens) => {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }

  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
};

const parseKeywords = (keywords) => {
  if (Array.isArray(keywords)) {
    return keywords.map((keyword) => `${keyword}`.trim()).filter(Boolean);
  }

  if (typeof keywords === 'string' && keywords.trim()) {
    try {
      const parsed = JSON.parse(keywords);
      if (Array.isArray(parsed)) {
        return parsed.map((keyword) => `${keyword}`.trim()).filter(Boolean);
      }
    } catch {
      return keywords.split(/[\n,]/).map((keyword) => keyword.trim()).filter(Boolean);
    }
  }

  return [];
};

const localGradeLongAnswer = ({ questionText, sampleAnswer, gradingKeywords, studentAnswer, marks }) => {
  const normalizedAnswer = (studentAnswer || '').trim();
  if (!normalizedAnswer) {
    return {
      awarded_marks: 0,
      max_marks: marks,
      score_ratio: 0,
      grading_method: 'local_heuristic',
      feedback: 'No answer was provided.',
      matched_keywords: [],
      missing_keywords: parseKeywords(gradingKeywords)
    };
  }

  const answerTokens = getUniqueTokens(normalizedAnswer);
  const sampleTokens = getUniqueTokens(sampleAnswer || '');
  const keywords = parseKeywords(gradingKeywords);
  const fallbackKeywords = keywords.length ? keywords : sampleTokens.slice(0, 10);
  const matchedKeywords = fallbackKeywords.filter((keyword) => {
    const normalizedKeyword = keyword.toLowerCase();
    return normalizedAnswer.toLowerCase().includes(normalizedKeyword);
  });

  const keywordCoverage = fallbackKeywords.length ? matchedKeywords.length / fallbackKeywords.length : 0;
  const semanticSimilarity = computeJaccard(answerTokens, sampleTokens);
  const lengthRatio = sampleTokens.length
    ? Math.min(1, answerTokens.length / Math.max(8, Math.round(sampleTokens.length * 0.55)))
    : Math.min(1, answerTokens.length / 18);

  const scoreRatio = Math.min(
    1,
    Math.max(0, keywordCoverage * 0.55 + semanticSimilarity * 0.3 + lengthRatio * 0.15)
  );

  const awardedMarks = Number((marks * scoreRatio).toFixed(1));
  const missingKeywords = fallbackKeywords.filter((keyword) => !matchedKeywords.includes(keyword));

  return {
    awarded_marks: awardedMarks,
    max_marks: marks,
    score_ratio: Number(scoreRatio.toFixed(3)),
    grading_method: 'local_heuristic',
    feedback:
      matchedKeywords.length
        ? `Covered ${matchedKeywords.length} of ${fallbackKeywords.length} expected concepts. Improve with more precise terminology and complete reasoning.`
        : `The response needs more of the expected concepts from the model answer and keywords.`,
    matched_keywords: matchedKeywords,
    missing_keywords: missingKeywords,
    question_text: questionText
  };
};

export const gradeLongAnswer = async ({
  questionText,
  sampleAnswer,
  gradingKeywords,
  studentAnswer,
  marks
}) => {
  const maxMarks = Number.isFinite(Number(marks)) ? Number(marks) : 1;
  const normalizedAnswer = (studentAnswer || '').trim();
  const normalizedSampleAnswer = (sampleAnswer || '').trim();
  const parsedKeywords = parseKeywords(gradingKeywords);

  if (!normalizedAnswer) {
    return localGradeLongAnswer({
      questionText,
      sampleAnswer: normalizedSampleAnswer,
      gradingKeywords: parsedKeywords,
      studentAnswer: normalizedAnswer,
      marks: maxMarks
    });
  }

  const prompt = `You are grading a student's long-answer exam response.

Question: ${questionText}
Maximum marks: ${maxMarks}
Model answer: ${normalizedSampleAnswer}
Expected keywords: ${parsedKeywords.join(', ') || 'None provided'}
Student answer: ${normalizedAnswer}

Return only valid JSON in this exact format:
{
  "awarded_marks": 3.5,
  "feedback": "One short paragraph explaining the score",
  "matched_keywords": ["keyword 1"],
  "missing_keywords": ["keyword 2"]
}

Rules:
- Award marks between 0 and ${maxMarks}.
- Use the model answer and expected keywords as the grading basis.
- Give partial credit when the concept is partially correct.
- Do not add any text outside the JSON.`;

  try {
    const aiResponse = await callClaude(prompt, 900);
    if (aiResponse) {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const awardedMarks = Math.min(maxMarks, Math.max(0, Number(parsed.awarded_marks) || 0));
        return {
          awarded_marks: Number(awardedMarks.toFixed(1)),
          max_marks: maxMarks,
          score_ratio: maxMarks ? Number((awardedMarks / maxMarks).toFixed(3)) : 0,
          grading_method: 'claude',
          feedback: parsed.feedback || 'Automatically graded from the model answer.',
          matched_keywords: Array.isArray(parsed.matched_keywords) ? parsed.matched_keywords : [],
          missing_keywords: Array.isArray(parsed.missing_keywords) ? parsed.missing_keywords : [],
          question_text: questionText
        };
      }
    }
  } catch (error) {
    console.error('AI long-answer grading failed:', error);
  }

  return localGradeLongAnswer({
    questionText,
    sampleAnswer: normalizedSampleAnswer,
    gradingKeywords: parsedKeywords,
    studentAnswer: normalizedAnswer,
    marks: maxMarks
  });
};
