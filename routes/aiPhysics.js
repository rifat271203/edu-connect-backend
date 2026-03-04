async function handlePhysicsQuestion({
  question,
  subject,
  category,
  context,
  callLlmWithProviderFallback,
  normalizeSlug,
}) {
  if (!context || context.length < 100) {
    return {
      status: 200,
      body: {
        answer: "No strong physics context was found in the knowledge base for this question.",
        contextUsed: false,
        subject: normalizeSlug(subject) || "physics",
        category: normalizeSlug(category) || "physics",
      },
    };
  }

  const prompt = `You are an HSC-level physics tutor.

Use the retrieved context below to answer the student's question.

Instructions:
1) Prioritize retrieved context when relevant.
2) Explain concepts with equations, units, and step-by-step reasoning.
3) If needed, include a short numerical derivation.
4) If context is insufficient, answer from general physics knowledge and clearly mention that.
5) Respond in the same language style as the question (Bangla/English).

Retrieved context:
${context}

Question:
${question}

Return a clear final answer.`;

  const data = await callLlmWithProviderFallback(prompt);
  if (data.error) {
    console.error("LLM API error:", data.error);
    return {
      status: 500,
      body: { error: "AI service error while answering physics question" },
    };
  }

  const answer = data?.choices?.[0]?.message?.content || "No answer generated";

  return {
    status: 200,
    body: {
      answer,
      contextUsed: context.length > 0,
      subject: normalizeSlug(subject) || "physics",
      category: normalizeSlug(category) || "physics",
    },
  };
}

module.exports = {
  handlePhysicsQuestion,
};
