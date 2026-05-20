import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import examRoutes from './routes/exams.js';
import attemptRoutes from './routes/attempts.js';
import questionBankRoutes from './routes/questionBank.js';
import aiRoutes from './routes/ai.js';
import messageRoutes from './routes/messages.js';
import doubtRoutes from './routes/doubts.js';
import riskProfileRoutes from './routes/riskProfiles.js';
import dashboardRoutes from './routes/dashboard.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const recordingsDir = path.join(__dirname, '../storage/recordings');

if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/question-bank', questionBankRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/doubts', doubtRoutes);
app.use('/api/risk-profiles', riskProfileRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));
app.use('/recordings', express.static(recordingsDir));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SmartAssess AI Server running on http://localhost:${PORT}`);
});
