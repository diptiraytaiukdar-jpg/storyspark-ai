// Secure StorySpark AI backend for Netlify Functions.
// Set GEMINI_API_KEY in Netlify's site environment variables.
// The key is intentionally never sent to the browser.
export default async (request) => {
  if (request.method !== "POST") {
    return Response.json({ message: "Use POST for script generation." }, { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({
      message: "The AI backend is missing its GEMINI_API_KEY setting. Add it in Netlify environment variables, then redeploy."
    }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 240) : "";
  const allowedGenres = new Set(["Horror", "Anime", "Fantasy", "Comedy"]);
  const genre = allowedGenres.has(body.genre) ? body.genre : "Horror";
  const duration = Number(body.duration) === 60 ? 60 : 30;

  if (!prompt) {
    return Response.json({ message: "Please enter a story idea first." }, { status: 400 });
  }

  const sceneCount = duration === 60 ? 5 : 3;
  const schema = {
    type: "OBJECT",
    properties: {
      storySummary: { type: "STRING" },
      fullNarration: { type: "STRING" },
      scenes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            timecode: { type: "STRING" },
            pacing: { type: "STRING" },
            visualAction: { type: "STRING" },
            imagePrompt: { type: "STRING" }
          },
          required: ["timecode", "pacing", "visualAction", "imagePrompt"]
        }
      }
    },
    required: ["storySummary", "fullNarration", "scenes"]
  };

  const instruction = `You are StorySpark AI, a creative short-form video writer.
Create a fresh, coherent, original ${duration}-second ${genre} YouTube Short based on this premise:
"${prompt}"

Return ONLY valid JSON matching the supplied schema.
Requirements:
- storySummary: a compelling one- or two-sentence premise summary with a strong hook.
- fullNarration: a natural voiceover script with timestamp labels covering exactly ${duration} seconds. Aim for about ${duration === 30 ? "65–85" : "130–155"} spoken words.
- scenes: exactly ${sceneCount} objects in chronological order, each with timecode, pacing, visualAction, and imagePrompt.
- Use timecodes covering the full duration. For ${duration === 30 ? "30 seconds, use 0:00–0:08, 0:08–0:22, and 0:22–0:30." : "60 seconds, use 0:00–0:10, 0:10–0:25, 0:25–0:40, 0:40–0:52, and 0:52–1:00."}
- Make each scene specific to the user's premise; no generic filler. Give the story a beginning, escalation, payoff/twist, and satisfying ending or loop.
- imagePrompt: detailed vertical 9:16 visual prompt, consistent character details, composition, lighting, and genre-appropriate style. Avoid naming living artists or copying a known franchise's exact style.
- Keep all text suitable for a broad audience.`;

  let apiResponse;
  try {
    apiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: instruction }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0.9,
            maxOutputTokens: 4096
          }
        })
      }
    );
  } catch {
    return Response.json({ message: "Could not reach the AI provider. Check the backend deployment and try again." }, { status: 502 });
  }

  const data = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    const providerMessage = data?.error?.message;
    return Response.json({
      message: providerMessage
        ? `AI provider error: ${String(providerMessage).slice(0, 350)}`
        : `AI provider returned status ${apiResponse.status}. Check your API key and quota.`
    }, { status: 502 });
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
  if (!rawText) {
    return Response.json({ message: "The AI returned an empty response. Please try again." }, { status: 502 });
  }

  let result;
  try {
    result = JSON.parse(rawText);
  } catch {
    return Response.json({ message: "The AI response could not be parsed. Please try again." }, { status: 502 });
  }

  if (
    typeof result.storySummary !== "string" ||
    typeof result.fullNarration !== "string" ||
    !Array.isArray(result.scenes) ||
    result.scenes.length !== sceneCount
  ) {
    return Response.json({ message: "The AI returned an incomplete production kit. Please try again." }, { status: 502 });
  }

  return Response.json(result, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
};

export const config = { path: "/api/generate" };
