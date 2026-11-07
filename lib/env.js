// Loaded first by server.js. Reads this project's .env (a variable already set for the process wins, so tests can pick a PORT).
// PayOut's AI settings are AI_API_KEY / AI_BASE_URL / AI_MODEL (Ollama Cloud) and TAVILY_API_KEY (PayPal docs search).
// Any OPENAI_* variables inherited from the computer are dropped, so they are never read or sent anywhere.
import dotenv from 'dotenv';

for (const k of Object.keys(process.env)) if (/^OPENAI_/i.test(k)) delete process.env[k];
dotenv.config();
