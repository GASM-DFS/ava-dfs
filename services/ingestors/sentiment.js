'use strict';

const { GoogleAuth } = require('google-auth-library');

/**
 * Fetches internet sentiment and injury risk for a player using Vertex AI (Gemini).
 * 
 * @param {Object} params
 * @param {string} params.project - GCP Project ID
 * @param {string} params.location - Vertex AI Location (e.g., us-central1)
 * @param {string} params.player - Player name to search
 * @param {string} params.date - Game date (YYYY-MM-DD)
 * @returns {Promise<Object>} A strict JSON object with sentiment metrics
 */
async function getPlayerSentiment({ project, location, player, date }) {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();

  // We use the Gemini 1.5 Pro model for complex reasoning and web grounding
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/gemini-1.5-pro-preview-0409:generateContent`;

  const prompt = `
    Search the internet for the most recent sports news, beat reporter updates, and injury reports for NBA player ${player} on or around ${date}.
    
    Analyze the context and return a STRICT JSON object with exactly these fields:
    - "SentimentScore": Float between -1.0 (very negative, bad matchup, slumping) and 1.0 (very positive, highly motivated, revenge game).
    - "InjuryRisk": Float between 0.0 (completely healthy) and 1.0 (likely to miss game or heavily restricted minutes).
    - "Narrative": A short, 1-sentence summary of the vibe or context around this player today.
    
    Do NOT wrap the JSON in markdown blocks. Return ONLY the raw JSON string.
  `;

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleSearchRetrieval: {} }],
    generationConfig: {
      temperature: 0.2, // Keep it deterministic
      responseMimeType: 'application/json' // Enforce strict JSON output
    }
  };

  const response = await client.request({ url, method: 'POST', data: requestBody });
  const responseText = response.data.candidates[0].content.parts[0].text;
  
  let sentimentData;
  try {
    sentimentData = JSON.parse(responseText.trim());
  } catch (parseError) {
    sentimentData = {
      SentimentScore: 0.0,
      InjuryRisk: 0.0,
      Narrative: "Failed to parse sentiment data. Defaulting to neutral."
    };
  }

  return {
    Name: player,
    GameDate: date,
    SentimentScore: sentimentData.SentimentScore || 0.0,
    InjuryRisk: sentimentData.InjuryRisk || 0.0,
    Narrative: sentimentData.Narrative || "Neutral"
  };
}

module.exports = { getPlayerSentiment };