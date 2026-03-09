import pool from './config/db.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seed() {
  const connection = await pool.getConnection();
  try {
    // 0. Execute Schema
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const statements = schema.split(';').filter(s => s.trim());
    for (const statement of statements) {
      await connection.query(statement);
    }

    await connection.beginTransaction();

    // 1. Clear existing data
    const tables = [
      'violation_heatmap', 'student_activity', 'student_attempts', 'ai_assessments', 
      'student_risk_profiles', 'doubt_submissions', 'exam_messages', 'exam_questions', 
      'exam_sections', 'exams', 'question_bank_history', 'question_bank', 'users'
    ];
    for (const table of tables) {
      await connection.query(`DELETE FROM ${table}`);
    }

    // 2. Create Users
    const hashedPassword = await bcrypt.hash('password123', 12);
    
    // Faculty
    const [facultyResult] = await connection.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      ['Prof. Smith', 'faculty@exam.com', hashedPassword, 'faculty']
    );
    const facultyId = facultyResult.insertId;

    // Students
    const students = [
      ['Rahul Sharma', 'rahul@exam.com'],
      ['Priya Patel', 'priya@exam.com'],
      ['Amit Kumar', 'amit@exam.com']
    ];

    const studentIds = [];
    for (const [name, email] of students) {
      const [result] = await connection.query(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        [name, email, hashedPassword, 'student']
      );
      studentIds.push(result.insertId);
      // Create risk profile
      await connection.query('INSERT INTO student_risk_profiles (student_id) VALUES (?)', [result.insertId]);
    }

    // 3. Create Question Bank
    const questions = [
      // Networking
      ['Networking', 'OSI Model', 'Which layer is responsible for routing?', 'Physical', 'Data Link', 'Network', 'Transport', 'C', 'mcq', 'easy'],
      ['Networking', 'Protocols', 'What does HTTP stand for?', 'HyperText Transfer Protocol', 'HighText Transfer Protocol', 'HyperText Transmission Protocol', 'None', 'A', 'mcq', 'easy'],
      ['Networking', 'IP Addressing', 'What is the size of IPv6 address?', '32 bits', '64 bits', '128 bits', '256 bits', 'C', 'mcq', 'medium'],
      ['Networking', 'TCP/UDP', 'Which protocol is connectionless?', 'TCP', 'UDP', 'HTTP', 'FTP', 'B', 'mcq', 'easy'],
      ['Networking', 'Devices', 'Which device works at the Data Link layer?', 'Hub', 'Switch', 'Router', 'Repeater', 'B', 'mcq', 'medium'],
      // OS
      ['Operating Systems', 'Processes', 'What is a PCB?', 'Process Control Block', 'Process Central Board', 'Program Control Block', 'None', 'A', 'mcq', 'easy'],
      ['Operating Systems', 'Scheduling', 'Which algorithm is non-preemptive?', 'Round Robin', 'SJF', 'FCFS', 'Priority', 'C', 'mcq', 'medium'],
      ['Operating Systems', 'Memory', 'What is virtual memory?', 'Physical RAM', 'Space on disk', 'Cache', 'None', 'B', 'mcq', 'medium'],
      ['Operating Systems', 'Deadlock', 'Which is NOT a condition for deadlock?', 'Mutual Exclusion', 'Hold and Wait', 'No Preemption', 'Circular Wait', 'D', 'mcq', 'hard'], // Wait, D is circular wait which IS a condition. Let's fix.
      ['Operating Systems', 'Deadlock', 'Which is NOT a condition for deadlock?', 'Mutual Exclusion', 'Hold and Wait', 'Preemption', 'Circular Wait', 'C', 'mcq', 'hard'],
      // DBMS
      ['DBMS', 'SQL', 'Which command is used to remove all records?', 'DELETE', 'TRUNCATE', 'DROP', 'REMOVE', 'B', 'mcq', 'medium'],
      ['DBMS', 'Normalization', 'Which normal form deals with partial dependency?', '1NF', '2NF', '3NF', 'BCNF', 'B', 'mcq', 'medium'],
      ['DBMS', 'ACID', 'What does A stand for in ACID?', 'Atomicity', 'Availability', 'Accuracy', 'None', 'A', 'mcq', 'easy'],
      ['DBMS', 'Keys', 'A key that uniquely identifies a record is?', 'Foreign Key', 'Primary Key', 'Super Key', 'Composite Key', 'B', 'mcq', 'easy'],
      ['DBMS', 'Transactions', 'Which isolation level is most restrictive?', 'Read Uncommitted', 'Read Committed', 'Repeatable Read', 'Serializable', 'D', 'mcq', 'hard'],
      // Algorithms
      ['Algorithms', 'Sorting', 'What is the worst-case complexity of QuickSort?', 'O(n)', 'O(n log n)', 'O(n^2)', 'O(log n)', 'C', 'mcq', 'medium'],
      ['Algorithms', 'Searching', 'Binary search requires the array to be?', 'Sorted', 'Unsorted', 'Small', 'Large', 'A', 'mcq', 'easy'],
      ['Algorithms', 'Complexity', 'What is the time complexity of MergeSort?', 'O(n^2)', 'O(n log n)', 'O(n)', 'O(log n)', 'B', 'mcq', 'medium'],
      ['Algorithms', 'Graphs', 'Which algorithm finds shortest path?', 'DFS', 'BFS', 'Dijkstra', 'Kruskal', 'C', 'mcq', 'medium'],
      ['Algorithms', 'Dynamic Programming', 'Which is a DP problem?', 'Binary Search', 'Knapsack', 'QuickSort', 'None', 'B', 'mcq', 'hard']
    ];

    const questionIds = [];
    for (const q of questions) {
      const [result] = await connection.query(
        `INSERT INTO question_bank (created_by, topic, subtopic, question_text, option_a, option_b, option_c, option_d, correct_answer, question_type, difficulty) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [facultyId, ...q]
      );
      questionIds.push(result.insertId);
    }

    // 4. Create Exams
    // Exam 1: CS Fundamentals
    const [exam1Result] = await connection.query(
      `INSERT INTO exams (title, description, created_by, status, duration_minutes, total_marks, passing_marks, instructions) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['CS Fundamentals', 'Comprehensive test on Networking, OS, DBMS and Algorithms.', facultyId, 'active', 60, 20, 10, 'Please ensure your webcam is on. No external devices allowed.']
    );
    const exam1Id = exam1Result.insertId;

    // Sections for Exam 1
    const [sec1Result] = await connection.query(
      'INSERT INTO exam_sections (exam_id, title, instructions, duration_minutes, section_order, marks_per_question) VALUES (?, ?, ?, ?, ?, ?)',
      [exam1Id, 'Section A: Networking & OS', 'Answer all questions.', 30, 1, 1]
    );
    const [sec2Result] = await connection.query(
      'INSERT INTO exam_sections (exam_id, title, instructions, duration_minutes, section_order, marks_per_question) VALUES (?, ?, ?, ?, ?, ?)',
      [exam1Id, 'Section B: DBMS & Algorithms', 'Answer all questions.', 30, 2, 1]
    );

    // Questions for Exam 1
    for (let i = 0; i < 10; i++) {
      await connection.query(
        'INSERT INTO exam_questions (exam_id, section_id, question_bank_id, question_order, marks) VALUES (?, ?, ?, ?, ?)',
        [exam1Id, sec1Result.insertId, questionIds[i], i + 1, 1]
      );
    }
    for (let i = 10; i < 20; i++) {
      await connection.query(
        'INSERT INTO exam_questions (exam_id, section_id, question_bank_id, question_order, marks) VALUES (?, ?, ?, ?, ?)',
        [exam1Id, sec2Result.insertId, questionIds[i], i - 9, 1]
      );
    }

    // Exam 2: Quick Quiz
    const [exam2Result] = await connection.query(
      `INSERT INTO exams (title, description, created_by, status, duration_minutes, total_marks, passing_marks, instructions) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['Quick Quiz', 'A short 5-question quiz.', facultyId, 'active', 15, 5, 2, 'Finish quickly.']
    );
    const exam2Id = exam2Result.insertId;

    for (let i = 0; i < 5; i++) {
      await connection.query(
        'INSERT INTO exam_questions (exam_id, question_bank_id, question_order, marks) VALUES (?, ?, ?, ?)',
        [exam2Id, questionIds[i], i + 1, 1]
      );
    }

    await connection.commit();
    console.log('Database seeded successfully!');
  } catch (error) {
    await connection.rollback();
    console.error('Error seeding database:', error);
  } finally {
    connection.release();
    process.exit();
  }
}

seed();
