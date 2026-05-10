# 🎓 Smart Exam & AI Assessment System

> An AI-powered online examination platform with intelligent assessment, real-time proctoring, and automated feedback generation — built for modern educational institutions.

---

## 📌 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Screens & Navigation Flow](#screens--navigation-flow)
- [AI Capabilities](#ai-capabilities)
- [Project Management](#project-management)
- [Prototype & Design](#prototype--design)
- [Contributing](#contributing)
- [License](#license)

---

## 📖 Overview

The **Smart Exam & AI Assessment System** is a full-stack web application designed to modernize the examination process in educational institutions. It replaces manual, paper-based exams with a secure, intelligent, and scalable digital platform.

The system leverages **Artificial Intelligence** for:
- Auto-generating exam questions from topics
- Detecting and flagging suspicious activity during exams (proctoring)
- Providing personalized performance insights and weak-area recommendations after each exam

Built as part of an end-to-end software project demonstrating **Figma → Jira → GitHub** integration.

---

## ✨ Features

### 👨‍🎓 Student
- Secure login (Email / OTP-based)
- View upcoming and completed exams
- Attempt MCQ, short answer, and long answer exams
- Real-time countdown timer and question navigator
- AI-generated performance report after submission
- Weak area identification and study recommendations

### 👩‍🏫 Faculty / Admin
- Create and manage exams with flexible question types
- AI-assisted question generation from topic/chapter input
- Maintain a reusable question bank (filterable by subject, difficulty, type)
- Monitor live exam sessions and AI proctoring alerts
- View class-wide analytics and score distributions
- Export reports

### 🤖 AI Features
- **Question Generation** — Generate MCQs and subjective questions using AI from a given topic
- **Proctoring** — Detects tab switching, multiple faces, and focus loss in real time
- **Smart Assessment** — Analyses answers and gives topic-level feedback
- **Recommendations** — Suggests chapters/resources based on performance gaps

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (or React.js) |
| Backend | Python (Flask / Django) |
| Database | MySQL / PostgreSQL |
| AI / ML | OpenAI API / Custom NLP Model |
| Proctoring | OpenCV, MediaPipe (Face Detection) |
| Auth | JWT / OTP-based |
| Version Control | Git + GitHub |
| Design | Figma |
| Project Tracking | Jira |

---

## 📁 Project Structure

```
smart-exam-and-ai-assessment/
│
├── frontend/
│   ├── index.html
│   ├── login.html
│   ├── dashboard.html
│   ├── exam.html
│   ├── results.html
│   └── assets/
│       ├── css/
│       └── js/
│
├── backend/
│   ├── app.py                  # Main Flask application
│   ├── config.py               # Configuration settings
│   ├── models/
│   │   ├── user.py
│   │   ├── exam.py
│   │   └── result.py
│   ├── routes/
│   │   ├── auth.py
│   │   ├── exam.py
│   │   └── report.py
│   └── ai/
│       ├── question_generator.py
│       ├── proctoring.py
│       └── assessment.py
│
├── database/
│   └── schema.sql
│
├── tests/
│   └── test_exam.py
│
├── requirements.txt
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- Node.js (if using React frontend)
- MySQL or PostgreSQL
- Git

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/BladeX11/smart-exam-and-ai-assesment.git
cd smart-exam-and-ai-assesment
```

**2. Set up a virtual environment**
```bash
python -m venv venv
source venv/bin/activate      # On Windows: venv\Scripts\activate
```

**3. Install dependencies**
```bash
pip install -r requirements.txt
```

**4. Configure the database**
```bash
# Create the database
mysql -u root -p < database/schema.sql

# Update your DB credentials in config.py
```

**5. Set environment variables**
```bash
cp .env.example .env
# Edit .env with your API keys and DB config
```

**6. Run the application**
```bash
python backend/app.py
```

Visit `http://localhost:5000` in your browser.

---

## 💻 Usage

### Student Flow
```
Login → Dashboard → Select Exam → Attempt Exam → Submit → View AI Result Report
```

### Faculty Flow
```
Login → Faculty Dashboard → Create Exam / Question Bank → Monitor Live Exam → View Reports
```

---

## 🖥 Screens & Navigation Flow

| Screen | Description |
|---|---|
| **Login** | Role-based login (Student / Faculty / Admin) |
| **Student Dashboard** | Upcoming exams, scores, AI feedback summary |
| **Exam Interface** | Timer, question navigator, MCQ / subjective input, proctoring status |
| **Result Screen** | Score gauge, AI insights, question-wise breakdown |
| **Faculty Dashboard** | Stats, live exam monitor, proctoring alerts |
| **Create Exam** | Form to build exams with AI question generation |
| **Question Bank** | Searchable, filterable question library |

**Navigation Flow (Clickable Prototype):**
```
Login
  ├── Student: Dashboard → Start Exam → Exam Interface → Submit → AI Result
  └── Faculty: Dashboard → Create Exam → Question Bank → Publish → View Reports
```

---

## 🤖 AI Capabilities

### 1. AI Question Generator
- Input: Topic name, difficulty level, number of questions
- Output: Ready-to-use MCQ or subjective questions
- Powered by: OpenAI GPT API / Custom NLP pipeline

### 2. AI Proctoring Engine
- Face presence detection (flags if no face or multiple faces)
- Browser tab focus monitoring
- Activity logged with timestamps for review

### 3. Smart Assessment & Feedback
- Analyses student answers at topic/concept level
- Generates a personalised feedback report
- Highlights strong areas and recommends resources for weak areas

---



---


---



## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m "feat: describe your change"`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Open a Pull Request

---

## 📄 License

This project is created for academic purposes as part of a software project course assignment.

---

## 👨‍💻 Author

**BladeX11**
- GitHub: [@BladeX11](https://github.com/BladeX11)

---

> ⭐ If you found this project helpful, consider giving it a star!
