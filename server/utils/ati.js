/**
 * ATI (Academic Trust Index) calculation logic
 */
export const calculateATI = (violations) => {
  let score = 100;
  
  const deductions = {
    tab_switches: (violations.tab_switches || 0) * 8,
    window_blurs: (violations.window_blurs || 0) * 3,
    fullscreen_exits: (violations.fullscreen_exits || 0) * 4,
    copy_paste_attempts: (violations.copy_paste_attempts || 0) * 5,
    face_violations: (violations.face_violations || 0) * 10,
    gaze_violations: (violations.gaze_violations || 0) * 4,
    voice_violations: (violations.voice_violations || 0) * 7,
    object_violations: (violations.object_violations || 0) * 12
  };

  for (const key in deductions) {
    score -= deductions[key];
  }

  if (violations.is_suspicious) score -= 15;
  if (violations.multiple_faces) score -= 50;

  return Math.max(0, Math.min(100, score));
};

export const getRiskLevel = (atiScore) => {
  if (atiScore >= 85) return 'low';
  if (atiScore >= 60) return 'medium';
  return 'high';
};
