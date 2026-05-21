import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.0';
const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const callGemini = async (prompt, maxTokens = 1500) => {
  if (!geminiClient) {
    throw new Error('Gemini API key not configured.');
  }

  try {
    const response = await geminiClient.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        maxOutputTokens: maxTokens,
        temperature: 0.2,
      },
    });

    const text = response?.text || '';
    if (!text) {
      throw new Error('Gemini response did not return valid text output.');
    }
    return text;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return null;
  }
};

export const callClaude = async (prompt, maxTokens = 1500) => {
  if (geminiClient) {
    const geminiText = await callGemini(prompt, maxTokens);
    if (geminiText) return geminiText;
  }

  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set. AI features will use fallback logic.');
    return null;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Claude API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.content[0]?.text || '';
  } catch (error) {
    console.error('Error calling Claude API:', error);
    return null;
  }
};
