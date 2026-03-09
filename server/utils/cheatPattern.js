import { callClaude } from './claudeClient.js';

export const analyzeCheatPattern = async (attemptData) => {
  const prompt = `You are an academic integrity AI. Analyze this exam attempt data and determine if cheating occurred. Be specific and statistical.

Attempt data: ${JSON.stringify(attemptData)}

Analyze for these patterns:
1. Speed anomaly: score >85% but time_ratio <0.4 (finished too fast)
2. Violation-performance paradox: high violations + high score
3. Inconsistent answering: some questions answered in <5 seconds
4. Topic inconsistency: strong in hard topics, weak in easy ones
5. Burst answering: many answers submitted in rapid succession

Return JSON only:
{
  "cheat_probability": 0-100,
  "verdict": "clean"|"suspicious"|"likely_cheating"|"confirmed_cheating",
  "patterns_detected": [
    {
      "pattern_name": "string",
      "evidence": "string",
      "severity": "low"|"medium"|"high"
    }
  ],
  "statistical_anomalies": ["string"],
  "faculty_recommendation": "string",
  "confidence_level": "low"|"medium"|"high"
}`;

  const response = await callClaude(prompt);
  if (!response) return getRuleBasedFallback(attemptData);

  try {
    // Extract JSON from response if Claude adds extra text
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : response);
  } catch (e) {
    console.error('Failed to parse Claude response:', e);
    return getRuleBasedFallback(attemptData);
  }
};

const getRuleBasedFallback = (data) => {
  const patterns = [];
  let prob = 0;
  
  if (data.score_percentage > 85 && data.time_ratio < 0.4) {
    patterns.push({ pattern_name: 'Speed Anomaly', evidence: 'High score in very short time', severity: 'high' });
    prob += 40;
  }
  
  if (data.tab_switches > 5 || data.face_violations > 5) {
    patterns.push({ pattern_name: 'High Violations', evidence: 'Multiple proctoring alerts', severity: 'medium' });
    prob += 30;
  }

  return {
    cheat_probability: Math.min(100, prob),
    verdict: prob > 60 ? 'likely_cheating' : (prob > 30 ? 'suspicious' : 'clean'),
    patterns_detected: patterns,
    statistical_anomalies: [],
    faculty_recommendation: prob > 60 ? 'Manual review recommended' : 'No immediate action',
    confidence_level: 'low'
  };
};
