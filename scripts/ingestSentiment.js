#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Internet Sentiment & Context Ingestor
 * 
 * Usage:
 *   node scripts/ingestSentiment.js --project <project-id> --location <region> --player "LeBron James" --date <YYYY-MM-DD>
 * 
 * Output:
 *   Searches the live web and writes a strict JSON object with sentiment metrics to stdout.
 */

const { GoogleAuth } = require('google-auth-library');

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
        ? argv[++i]
        : true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.project)  die('--project is required');
  if (!args.location) die('--location is required (e.g., us-central1)');
  if (!args.player)   die('--player is required');
  if (!args.date)     die('--date <YYYY-MM-DD> is required');

  try {
    process.stdout.write(`🌐 Initiating live internet search and sentiment analysis for ${args.player}...\n`);
    
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();

    // We use the Gemini 1.5 Pro model for complex reasoning and web grounding
    const url = `https://${args.location}-aiplatform.googleapis.com/v1/projects/${args.project}/locations/${args.location}/publishers/google/models/gemini-1.5-pro-preview-0409:generateContent`;

    const prompt = `
      Search the internet for the most recent sports news, beat reporter updates, and injury reports for NBA player ${args.player} on or around ${args.date}.
      
      Analyze the context and return a STRICT JSON object with exactly these fields:
      - "SentimentScore": Float between -1.0 (very negative, bad matchup, slumping) and 1.0 (very positive, highly motivated, revenge game).
      - "InjuryRisk": Float between 0.0 (completely healthy) and 1.0 (likely to miss game or heavily restricted minutes).
      - "Narrative": A short, 1-sentence summary of the vibe or context around this player today.
      
      Do NOT wrap the JSON in markdown blocks. Return ONLY the raw JSON string.
    `;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [
        {
          // This natively enables Google Search Grounding to search the live web
          googleSearchRetrieval: {} 
        }
      ],
      generationConfig: {
        temperature: 0.2, // Keep it deterministic
        responseMimeType: 'application/json' // Enforce strict JSON output
      }
    };

    const response = await client.request({
      url,
      method: 'POST',
      data: requestBody
    });

    // Parse the LLM output
    const responseText = response.data.candidates[0].content.parts[0].text;
    let sentimentData;
    
    try {
      sentimentData = JSON.parse(responseText.trim());
    } catch (parseError) {
      // Defensive fallback if the LLM hallucinates non-JSON
      sentimentData = {
        SentimentScore: 0.0,
        InjuryRisk: 0.0,
        Narrative: "Failed to parse sentiment data. Defaulting to neutral."
      };
    }

    // Map to our strict Data Contract
    const output = {
      Name: args.player,
      GameDate: args.date,
      SentimentScore: sentimentData.SentimentScore || 0.0,
      InjuryRisk: sentimentData.InjuryRisk || 0.0,
      Narrative: sentimentData.Narrative || "Neutral"
    };

    // Output strict JSON for ingestion into BigQuery Silver layer
    process.stdout.write(JSON.stringify([output], null, 2) + '\n');

  } catch (error) {
    // Defensive Programming: If the API is down, fail loudly but don't break the whole pipeline.
    // We output a fallback neutral score so the data contract remains intact for BigQuery.
    process.stderr.write(`⚠️ Warning: Sentiment analysis failed for ${args.player}: ${error.message}\n`);
    const fallback = [{ Name: args.player, GameDate: args.date, SentimentScore: 0.0, InjuryRisk: 0.0, Narrative: "API Error" }];
    process.stdout.write(JSON.stringify(fallback, null, 2) + '\n');
  }
}

main();