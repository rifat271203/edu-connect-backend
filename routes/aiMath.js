// =========================
// Math RAG Tutor (Independent Mode)
// =========================

function sanitizeJsonLike(text) {
  return String(text || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00A0/g, " ")
    .replace(/,\s*([}\]])/g, "$1"); // trailing commas
}

function stripCodeFences(raw) {
  return String(raw || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function safeParseJsonObject(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;

  const cleaned = sanitizeJsonLike(stripCodeFences(raw));

  // 1) direct parse
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {}

  // 2) extract first { ... last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  return null;
}

function isSqrtTanQuestion(question) {
  const q = String(question || "");
  return /√\s*tan|sqrt\s*\(?\s*tan|root\s*tan|tan\s*এর\s*বর্গমূল|tan\s*এর\s*মূল/i.test(q);
}

function isLikelyHallucinatedMath(question, parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return true;

  const answerText = String(parsed.answer || "");
  const finalText = String(parsed.final || "");
  const steps = Array.isArray(parsed.steps) ? parsed.steps.map((s) => String(s || "")) : [];
  const joined = [answerText, finalText, ...steps].join("\n");

  // Basic schema sanity
  if (!answerText.trim() && !finalText.trim()) return true;

  // Prevent "integrand swap" for sqrt(tan x) -> tan x
  const questionHasSqrtTan = isSqrtTanQuestion(question);
  if (questionHasSqrtTan) {
    const finalHasIntTanX = /(?:∫|integral)\s*tan\s*x/i.test(finalText);
    const finalHasSqrtTan = /√\s*tan|sqrt\s*\(?\s*tan/i.test(finalText);
    if (finalHasIntTanX && !finalHasSqrtTan) return true;

    // Bad transformations patterns
    const hasDirectSwap =
      /(√\s*\(?\s*tan\s*x\s*\)?|sqrt\s*\(?\s*tan\s*x\s*\)?)[^\n=]{0,60}=\s*\|?\s*tan\s*x\s*\|?/i.test(
        joined
      );
    if (hasDirectSwap) return true;

    const hasSqrtTan2AbsTan =
      /(√\s*\(?\s*tan\s*\^?\s*2|sqrt\s*\(\s*tan\s*\^\s*2)/i.test(joined) &&
      /(\|\s*tan\s*x\s*\||abs\s*\(\s*tan\s*x\s*\))/i.test(joined);
    if (hasSqrtTan2AbsTan) return true;
  }

  // Anti-loop: repeating same step too many times
  const repeated = new Map();
  for (const step of steps) {
    const normalized = step.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) continue;
    const count = (repeated.get(normalized) || 0) + 1;
    repeated.set(normalized, count);
    if (count > 2) return true;
  }

  return false;
}

function normalizeMathJsonSchema(parsed, fallback) {
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};

  const answer =
    typeof obj.answer === "string" && obj.answer.trim()
      ? obj.answer.trim()
      : typeof fallback.rawText === "string" && fallback.rawText.trim()
        ? fallback.rawText.trim()
        : "No answer generated";

  const steps = Array.isArray(obj.steps)
    ? obj.steps.map((s) => String(s || "").trim()).filter(Boolean)
    : [];

  const final = typeof obj.final === "string" && obj.final.trim() ? obj.final.trim() : answer;

  const candidateChunkIds = Array.isArray(obj.usedChunkIds)
    ? obj.usedChunkIds
        .map((id) => String(id || "").trim())
        .filter((id) => Boolean(id) && (fallback.allChunkIds.length === 0 || fallback.allChunkIds.includes(id)))
    : [];

  // IMPORTANT: In independent mode, default should be [] (not fallbackChunkIds),
  // because if the model didn't cite chunks, we shouldn't pretend it used them.
  const usedChunkIds = candidateChunkIds;

  const confidenceRaw = String(obj.confidence || "").trim().toLowerCase();
  const confidence = ["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw : "low";

  const notesRaw = typeof obj.notes === "string" ? obj.notes.trim() : "";

  return {
    answer,
    steps,
    final,
    usedChunkIds,
    confidence,
    notes: notesRaw || fallback.defaultNotes || "",
  };
}

function buildOutOfScopeMathJson(question, notes) {
  const isBanglaQuestion = /[\u0980-\u09FF]/.test(String(question || ""));
  if (isBanglaQuestion) {
    return {
      answer: "এই প্রশ্নটি HSC-এর স্ট্যান্ডার্ড পদ্ধতিতে সরাসরি সমাধানযোগ্য নয় বা এটি নন-এলিমেন্টারি হতে পারে।",
      steps: [],
      final: "HSC level standard methods cannot directly solve this (non-elementary/out-of-scope).",
      usedChunkIds: [],
      confidence: "low",
      notes: notes || "Unable to produce a valid HSC-level solution with high confidence.",
    };
  }

  return {
    answer: "This problem may be non-elementary or out-of-scope for standard HSC methods.",
    steps: [],
    final: "HSC level standard methods cannot directly solve this (non-elementary/out-of-scope).",
    usedChunkIds: [],
    confidence: "low",
    notes: notes || "Unable to produce a valid HSC-level solution with high confidence.",
  };
}

async function repairToJsonOnce(callLlmWithProviderFallback, rawText, allowedChunkIds) {
  const repairSystem = "Return ONLY valid JSON. No markdown. No extra text.";
  const repairUser = `Convert the following content into VALID JSON that matches exactly this schema:
{
  "answer": "...",
  "steps": ["..."],
  "final": "...",
  "usedChunkIds": ["..."],
  "confidence": "high" | "medium" | "low",
  "notes": "..."
}

Rules:
- usedChunkIds MUST be chosen only from this allowed list: ${allowedChunkIds.join(", ") || "(none)"}.
- If you did not use context, set usedChunkIds to [].
- Keep language: Bangla if the question appears Bangla, else English.
- Do not add any text outside JSON.

Content:
${String(rawText || "").trim()}`;

  const repaired = await callLlmWithProviderFallback([
    { role: "system", content: repairSystem },
    { role: "user", content: repairUser },
  ]);

  if (repaired?.error) return "";
  return repaired?.choices?.[0]?.message?.content || "";
}

async function handleMathQuestion({
  question,
  subject,
  category,
  context, // (unused but kept for signature compatibility)
  contextChunks,
  callLlmWithProviderFallback,
  normalizeSlug,
}) {
  const hasContextChunks = Array.isArray(contextChunks) && contextChunks.length > 0;
  const allChunkIds = hasContextChunks
    ? contextChunks.map((c) => String(c?.id || "").trim()).filter(Boolean)
    : [];

  const isBanglaQuestion = /[\u0980-\u09FF]/.test(String(question || ""));

  // ✅ Independent tutor system prompt:
  const systemPrompt = `SYSTEM PROMPT (Math Tutor - Bangladesh HSC, RAG-assisted but Independent)

You are a Bangladesh HSC Higher Math tutor.

Core behavior:
- You may use RetrievedContextChunks if they help.
- You may solve independently if context is insufficient or unrelated.
- You MUST output a single VALID JSON object only. No markdown. No extra text.

Rules:
1) First, quickly check RetrievedContextChunks:
   - If a chunk provides a matching method/example/formula, use that idea and adapt it (do NOT copy verbatim). Include those ids in usedChunkIds.
   - If context does not directly help, solve using your own HSC-level knowledge and set usedChunkIds to [].
2) Do NOT invent chunk ids. usedChunkIds must come from provided ids only.
3) Verification: each algebraic step must preserve equality.
4) If the problem is truly non-elementary/out-of-scope at HSC level, say so clearly in final + notes (still JSON).

JSON schema (must match exactly):
{
  "answer": "Bangla if user asked Bangla; otherwise English.",
  "steps": ["Step 1 ...", "Step 2 ..."],
  "final": "Final answer or non-elementary/out-of-scope statement",
  "usedChunkIds": ["..."],
  "confidence": "high" | "medium" | "low",
  "notes": "Short notes (e.g., why used context or why independent)."
}`;

  const userPrompt = `UserQuestion:
${question}

RetrievedContextChunks:
${JSON.stringify(Array.isArray(contextChunks) ? contextChunks : [], null, 2)}

Instructions:
- Solve HSC-style.
- Use context only if it helps; otherwise solve independently.
- Return JSON only.`;

  const llmMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const data = await callLlmWithProviderFallback(llmMessages);
  if (data?.error) {
    return { status: 500, body: { error: "AI service error while answering math question" } };
  }

  let raw = data?.choices?.[0]?.message?.content || "";
  let parsed = safeParseJsonObject(raw);

  // ✅ If non-JSON, do one repair attempt
  if (!parsed) {
    const repairedRaw = await repairToJsonOnce(callLlmWithProviderFallback, raw, allChunkIds);
    const repairedParsed = safeParseJsonObject(repairedRaw);
    if (repairedParsed) {
      raw = repairedRaw;
      parsed = repairedParsed;
    }
  }

  // If still not parseable, fallback out-of-scope JSON (last resort)
  if (!parsed) {
    return {
      status: 200,
      body: {
        ...buildOutOfScopeMathJson(
          question,
          isBanglaQuestion
            ? "মডেল valid JSON আউটপুট দেয়নি, তাই নিরাপদ fallback রেসপন্স দেওয়া হলো।"
            : "Model did not return valid JSON; safe fallback response applied."
        ),
        contextUsed: hasContextChunks,
        subject: normalizeSlug(subject) || "math",
        category: normalizeSlug(category) || "math",
      },
    };
  }

  let finalParsed = parsed;

  // ✅ Soft hallucination check: if suspicious, use judge to correct or mark out-of-scope
  if (isLikelyHallucinatedMath(question, finalParsed)) {
    const judgeSystemPrompt =
      "You are a strict Bangladesh HSC math judge. Validate the candidate JSON. If invalid, produce a corrected valid JSON solution if possible; otherwise output non-elementary/out-of-scope JSON. Output JSON only.";

    const judgeUserPrompt = `Question:
${question}

Allowed chunk ids:
${allChunkIds.join(", ") || "(none)"}

Candidate JSON:
${JSON.stringify(finalParsed, null, 2)}

Return JSON only with EXACT schema:
{
  "answer": "...",
  "steps": ["..."],
  "final": "...",
  "usedChunkIds": ["..."],
  "confidence": "high" | "medium" | "low",
  "notes": "..."
}

Rules:
- Do not invent chunk ids. Use only allowed ids, or [].
- If context is not clearly used, usedChunkIds must be [].
- Keep HSC-level. If truly non-elementary, state that.
- Keep language: Bangla if question Bangla else English.`;

    const judgeData = await callLlmWithProviderFallback([
      { role: "system", content: judgeSystemPrompt },
      { role: "user", content: judgeUserPrompt },
    ]);

    const judgeRaw = judgeData?.choices?.[0]?.message?.content || "";
    const judgedParsed = !judgeData?.error ? safeParseJsonObject(judgeRaw) : null;

    finalParsed =
      judgedParsed ||
      buildOutOfScopeMathJson(
        question,
        isBanglaQuestion
          ? "সমাধান যাচাইয়ে সমস্যা হয়েছে, তাই out-of-scope fallback দেওয়া হলো।"
          : "Solution failed validation; out-of-scope fallback applied."
      );
  }

  const normalized = normalizeMathJsonSchema(finalParsed, {
    rawText: raw,
    allChunkIds,
    defaultNotes: isBanglaQuestion
      ? "Context প্রাসঙ্গিক হলে ব্যবহার করা হয়েছে; না হলে স্বাধীনভাবে সমাধান করা হয়েছে।"
      : "Used context if relevant; otherwise solved independently.",
  });

  return {
    status: 200,
    body: {
      ...normalized,
      contextUsed: hasContextChunks,
      subject: normalizeSlug(subject) || "math",
      category: normalizeSlug(category) || "math",
    },
  };
}

module.exports = {
  handleMathQuestion,
};