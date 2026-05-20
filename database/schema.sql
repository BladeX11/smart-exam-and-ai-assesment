-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role TEXT CHECK(role IN ('student','faculty')) NOT NULL,
  risk_level TEXT CHECK(risk_level IN ('clean','watchlist','repeat_offender')),
  total_exams_taken INT DEFAULT 0,
  total_violations INT DEFAULT 0,
  flagged_exam_count INT DEFAULT 0,
  last_login DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. QUESTION BANK
CREATE TABLE IF NOT EXISTS question_bank (
  id INT AUTO_INCREMENT PRIMARY KEY,
  created_by INT NOT NULL,
  topic VARCHAR(100),
  subtopic VARCHAR(100),
  question_text TEXT NOT NULL,
  option_a TEXT, option_b TEXT, 
  option_c TEXT, option_d TEXT,
  correct_answer TEXT CHECK(correct_answer IN ('A','B','C','D')),
  question_type TEXT CHECK(question_type IN ('mcq','long_answer')),
  sample_answer TEXT,
  grading_keywords TEXT,
  difficulty TEXT CHECK(difficulty IN ('easy','medium','hard')) NOT NULL,
  marks INT DEFAULT 1,
  version INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  times_used INT DEFAULT 0,
  avg_correct_rate FLOAT DEFAULT 0,
  tags TEXT, -- MySQL stores JSON as TEXT
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 3. QUESTION BANK VERSION HISTORY
CREATE TABLE IF NOT EXISTS question_bank_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_id INT NOT NULL,
  version INT NOT NULL,
  question_text TEXT,
  option_a TEXT, option_b TEXT,
  option_c TEXT, option_d TEXT,
  correct_answer TEXT CHECK(correct_answer IN ('A','B','C','D')),
  changed_by INT,
  change_note VARCHAR(255),
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (question_id) REFERENCES question_bank(id),
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

-- 4. EXAMS
CREATE TABLE IF NOT EXISTS exams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  created_by INT NOT NULL,
  status TEXT CHECK(status IN ('draft','scheduled','active','paused','ended')),
  scheduled_start DATETIME,
  duration_minutes INT NOT NULL,
  grace_period_minutes INT DEFAULT 0,
  total_marks INT NOT NULL,
  passing_marks INT,
  instructions TEXT,
  allow_calculator BOOLEAN DEFAULT FALSE,
  shuffle_questions BOOLEAN DEFAULT TRUE,
  shuffle_options BOOLEAN DEFAULT TRUE,
  show_results_after TEXT CHECK(show_results_after IN ('immediate','after_end','manual')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 5. EXAM SECTIONS
CREATE TABLE IF NOT EXISTS exam_sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  title VARCHAR(100) NOT NULL,
  instructions TEXT,
  duration_minutes INT NOT NULL,
  section_order INT NOT NULL,
  marks_per_question INT DEFAULT 1,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

-- 6. EXAM QUESTIONS
CREATE TABLE IF NOT EXISTS exam_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  section_id INT,
  question_bank_id INT NOT NULL,
  question_order INT,
  marks INT DEFAULT 1,
  bank_version_used INT DEFAULT 1,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES exam_sections(id),
  FOREIGN KEY (question_bank_id) REFERENCES question_bank(id)
);

-- 7. STUDENT ATTEMPTS
CREATE TABLE IF NOT EXISTS student_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  exam_id INT NOT NULL,
  current_section_id INT,
  status TEXT CHECK(status IN ('not_started','in_progress','section_break','paused','submitted','force_ended')),
  answers TEXT,
  long_answers TEXT,
  score FLOAT DEFAULT 0,
  section_times TEXT,
  start_time DATETIME,
  submit_time DATETIME,
  time_remaining_seconds INT,
  current_question_index INT DEFAULT 0,
  tab_switches INT DEFAULT 0,
  window_blurs INT DEFAULT 0,
  copy_paste_attempts INT DEFAULT 0,
  face_violations INT DEFAULT 0,
  voice_violations INT DEFAULT 0,
  object_violations INT DEFAULT 0,
  fullscreen_exits INT DEFAULT 0,
  gaze_violations INT DEFAULT 0,
  internet_disconnects INT DEFAULT 0,
  is_suspicious BOOLEAN DEFAULT FALSE,
  ati_score FLOAT DEFAULT 100,
  risk_level TEXT CHECK(risk_level IN ('low','medium','high')),
  force_end_reason VARCHAR(255),
  last_active_at DATETIME,
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (exam_id) REFERENCES exams(id),
  FOREIGN KEY (current_section_id) REFERENCES exam_sections(id)
);

-- 8. STUDENT ACTIVITY LOG
CREATE TABLE IF NOT EXISTS student_activity (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attempt_id INT NOT NULL,
  student_id INT NOT NULL,
  exam_id INT NOT NULL,
  activity_type VARCHAR(50) NOT NULL,
  description TEXT,
  question_index INT,
  time_into_exam_seconds INT,
  severity TEXT CHECK(severity IN ('info','warning','critical')),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attempt_id) REFERENCES student_attempts(id),
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (exam_id) REFERENCES exams(id)
);

-- 9. MESSAGES
CREATE TABLE IF NOT EXISTS exam_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  student_id INT NOT NULL,
  faculty_id INT,
  sender_role TEXT CHECK(sender_role IN ('student','faculty')) NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT CHECK(message_type IN ('chat','announcement','system')),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id) REFERENCES exams(id),
  FOREIGN KEY (student_id) REFERENCES users(id)
);

-- 10. DOUBT SUBMISSIONS
CREATE TABLE IF NOT EXISTS doubt_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  attempt_id INT NOT NULL,
  student_id INT NOT NULL,
  question_id INT NOT NULL,
  doubt_text TEXT NOT NULL,
  status TEXT CHECK(status IN ('open','acknowledged','resolved','dismissed')),
  faculty_response TEXT,
  announcement_sent BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  FOREIGN KEY (exam_id) REFERENCES exams(id),
  FOREIGN KEY (attempt_id) REFERENCES student_attempts(id),
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (question_id) REFERENCES exam_questions(id)
);

-- 11. AI ASSESSMENTS
CREATE TABLE IF NOT EXISTS ai_assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attempt_id INT UNIQUE NOT NULL,
  risk_score INT DEFAULT 0,
  anomaly_detected BOOLEAN DEFAULT FALSE,
  cheat_pattern_report TEXT,
  behavior_flags TEXT,
  statistical_analysis TEXT,
  performance_summary TEXT,
  study_plan TEXT,
  strengths TEXT,
  weaknesses TEXT,
  topic_scores TEXT,
  difficulty_adjusted_score FLOAT,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attempt_id) REFERENCES student_attempts(id)
);

-- 12. STUDENT RISK PROFILES
CREATE TABLE IF NOT EXISTS student_risk_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNIQUE NOT NULL,
  overall_risk TEXT CHECK(overall_risk IN ('clean','watchlist','repeat_offender')),
  total_exams INT DEFAULT 0,
  total_flagged_exams INT DEFAULT 0,
  total_force_ended INT DEFAULT 0,
  total_tab_switches INT DEFAULT 0,
  total_face_violations INT DEFAULT 0,
  total_voice_violations INT DEFAULT 0,
  total_object_violations INT DEFAULT 0,
  total_copy_attempts INT DEFAULT 0,
  violation_trend TEXT,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  faculty_notes TEXT,
  FOREIGN KEY (student_id) REFERENCES users(id)
);

-- 13. CHEATING HEATMAP DATA
CREATE TABLE IF NOT EXISTS violation_heatmap (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  attempt_id INT NOT NULL,
  violation_type VARCHAR(50) NOT NULL,
  time_bucket_minutes INT NOT NULL,
  count INT DEFAULT 1,
  UNIQUE(exam_id, attempt_id, violation_type, time_bucket_minutes),
  FOREIGN KEY (exam_id) REFERENCES exams(id),
  FOREIGN KEY (attempt_id) REFERENCES student_attempts(id)
);

-- 14. MARKED QUESTIONS
CREATE TABLE IF NOT EXISTS marked_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attempt_id INT NOT NULL,
  question_id INT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES student_attempts(id),
  FOREIGN KEY (question_id) REFERENCES exam_questions(id)
);

-- 15. SECTION ATTEMPTS
CREATE TABLE IF NOT EXISTS section_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attempt_id INT NOT NULL,
  section_id INT NOT NULL,
  status TEXT CHECK(status IN ('not_started','in_progress','completed')),
  start_time DATETIME,
  end_time DATETIME,
  time_remaining_seconds INT,
  score FLOAT DEFAULT 0,
  FOREIGN KEY (attempt_id) REFERENCES student_attempts(id),
  FOREIGN KEY (section_id) REFERENCES exam_sections(id)
);
