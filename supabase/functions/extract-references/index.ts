import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { TRACTATE_NAMES as TRACTATES, isDafInRange, MASECHTOT } from "../_shared/masechtotData.ts";
import { extractWithRegex, numberToHebrewLetter, scoreToLevel, type ConfidenceFactors, type Reference } from "../_shared/extractRegex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// maxDaf lookup
const MAX_DAF: Record<string, number> = Object.fromEntries(MASECHTOT.map(m => [m.name, m.maxDaf]));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, documentId, useAI } = await req.json();
    if (!text || !documentId) {
      return new Response(
        JSON.stringify({ error: "text and documentId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const regexRefs = extractWithRegex(text);

    const aiRefs: Reference[] = [];
    if (useAI) {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (LOVABLE_API_KEY) {
        try {
          const systemPrompt = `אתה מומחה בתלמוד בבלי. מצא את כל ההפניות למסכתות, דפים ועמודים בטקסט הנתון.
רשימת המסכתות: ${TRACTATES.join(", ")}.
קיצורים נפוצים: ב"ק=בבא קמא, ב"מ=בבא מציעא, ב"ב=בבא בתרא, ר"ה=ראש השנה, ע"ז=עבודה זרה.
זהה גם את העמוד (amud) כשמופיע: ע"א=amud "a", ע"ב=amud "b", נקודה=amud "a", נקודתיים=amud "b".
החזר JSON בלבד, ללא markdown.`;

          const userPrompt = `מצא הפניות תלמודיות בטקסט. ציין מסכת, דף (מספר ערבי), עמוד ("a"/"b"/null), טקסט מקורי, ורמת ביטחון.

טקסט:
${text.slice(0, 6000)}

${regexRefs.length > 0 ? `הפניות regex:\n${JSON.stringify(regexRefs.map(r => ({ normalized: r.normalized, amud: r.amud })))}` : ""}

JSON format:
{"references": [{"tractate": "שם מסכת", "daf": "30", "amud": "a"|"b"|null, "raw": "טקסט מקורי", "normalized": "מסכת ל׳.", "confidence": "high"|"medium"|"low"}]}`;

          const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              temperature: 0.1,
            }),
          });

          if (response.ok) {
            const aiData = await response.json();
            const rawText = aiData.choices?.[0]?.message?.content ?? "";
            const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
            try {
              const parsed = JSON.parse(cleaned);
              if (parsed.references?.length) {
                const regexNormalized = new Set(regexRefs.map(r => r.normalized));
                for (const ref of parsed.references) {
                  if (ref.tractate && ref.daf && TRACTATES.includes(ref.tractate)) {
                    const dafNum = parseInt(ref.daf, 10);
                    // גם ל-AI אין רשות להמציא דף שאינו קיים במסכת
                    if (!isNaN(dafNum) && isDafInRange(ref.tractate, dafNum)) {
                      const dafHeb = numberToHebrewLetter(dafNum);
                      const normalizedRef = `${ref.tractate} ${dafHeb}${ref.amud === "a" ? "." : ref.amud === "b" ? ":" : ""}`;
                      if (!regexNormalized.has(normalizedRef)) {
                        let ctxSnippet = '';
                        if (ref.raw && text.includes(ref.raw)) {
                          const idx = text.indexOf(ref.raw);
                          const ls = text.lastIndexOf('\n', idx);
                          const le = text.indexOf('\n', idx + ref.raw.length);
                          const start = ls === -1 ? Math.max(0, idx - 80) : ls + 1;
                          const end = le === -1 ? Math.min(text.length, idx + ref.raw.length + 80) : le;
                          ctxSnippet = text.slice(start, end).trim().slice(0, 300);
                        }
                        const aiConfidence = ref.confidence || "medium";
                        const aiScore = aiConfidence === "high" ? 75 : aiConfidence === "medium" ? 55 : 35;
                        const maxDaf = MAX_DAF[ref.tractate];
                        const dafValid = maxDaf ? (dafNum >= 2 && dafNum <= maxDaf) : true;
                        const aiFactors: ConfidenceFactors = {
                          base_specificity: ref.amud ? 60 : 45,
                          frequency_boost: 0,
                          context_type: "ai_detected",
                          context_boost: 10,
                          source_agreement: false,
                          agreement_boost: 0,
                          proximity_boost: 0,
                          daf_range_valid: dafValid,
                          range_boost: dafValid ? 5 : -20,
                          total: aiScore,
                          capped: Math.min(100, Math.max(0, aiScore)),
                        };
                        aiRefs.push({
                          tractate: ref.tractate,
                          daf: String(dafNum),
                          amud: ref.amud || null,
                          raw: ref.raw || normalizedRef,
                          normalized: normalizedRef,
                          confidence: scoreToLevel(aiFactors.capped),
                          confidence_score: aiFactors.capped,
                          confidence_factors: aiFactors,
                          context_snippet: ctxSnippet || undefined,
                          source: "ai",
                        });
                      }
                    }
                  }
                }
              }
            } catch {
              console.error("Failed to parse AI response");
            }
          }
        } catch (e) {
          console.error("AI extraction error:", e);
        }
      }
    }

    const allRefs = [...regexRefs, ...aiRefs];

    // Apply source agreement boost: if both regex and AI found the same reference
    if (aiRefs.length > 0 && regexRefs.length > 0) {
      const aiNormalized = new Set(aiRefs.map(r => r.normalized));
      for (const ref of allRefs) {
        if (ref.source === "regex" && aiNormalized.has(ref.normalized)) {
          ref.confidence_factors.source_agreement = true;
          ref.confidence_factors.agreement_boost = 15;
          ref.confidence_factors.total += 15;
          ref.confidence_factors.capped = Math.min(100, Math.max(0, ref.confidence_factors.total));
          ref.confidence = scoreToLevel(ref.confidence_factors.capped);
          ref.confidence_score = ref.confidence_factors.capped;
        }
      }
    }

    return new Response(
      JSON.stringify({ references: allRefs, documentId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("extract-references error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
