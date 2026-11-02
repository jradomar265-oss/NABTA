"use client";

import { useMemo, useState } from "react";

import { updateQuestion } from "@/app/actions/assessments";

/**
 * Question editor.
 *
 * The correct answer is chosen by POSITION, so it must be derived from the options the
 * teacher is currently typing — not from the saved ones. Rendering the picker from the
 * stored options meant that editing the list left a stale "correct answer" pointing at
 * an option that no longer existed, and whatever the picker held was what got submitted.
 */
export function QuestionEditor({
  questionId,
  prompt,
  kind,
  options,
  correctIndex,
  explanation,
}: {
  questionId: string;
  prompt: string;
  kind: "multiple_choice" | "true_false";
  options: string[];
  correctIndex: number;
  explanation: string;
}) {
  const [optionText, setOptionText] = useState(options.join("\n"));
  const [selected, setSelected] = useState(correctIndex);

  const lines = useMemo(
    () => optionText.split("\n").map((line) => line.trim()).filter(Boolean),
    [optionText],
  );

  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const line of lines) {
      const key = line.toLowerCase();
      if (seen.has(key)) repeated.push(line);
      seen.add(key);
    }
    return repeated;
  }, [lines]);

  // Clamp rather than trust: shrinking the list must never leave a dangling index.
  const safeIndex = selected >= 0 && selected < lines.length ? selected : 0;
  const listChanged = lines.length !== options.length || lines.some((line, index) => line !== options[index]);
  const tooFewOptions = lines.length < 2;
  const blocked = tooFewOptions || duplicates.length > 0;

  return (
    <form action={updateQuestion} className="mt-2 space-y-2">
      <input name="questionId" type="hidden" value={questionId} />

      <label className="block text-xs font-semibold text-[#496451]">
        Question
        <textarea
          className="mt-1 min-h-14 w-full rounded-lg border border-[#d5dfd4] px-2 py-1.5 text-sm font-normal"
          defaultValue={prompt}
          maxLength={600}
          name="prompt"
          required
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
        <label className="block text-xs font-semibold text-[#496451]">
          Options <span className="font-normal text-[#7b8c81]">(one per line)</span>
          <textarea
            className="mt-1 min-h-24 w-full rounded-lg border border-[#d5dfd4] px-2 py-1.5 font-mono text-sm font-normal"
            name="options"
            onChange={(event) => setOptionText(event.target.value)}
            required
            value={optionText}
          />
        </label>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[#496451]">
            Format
            <select
              className="mt-1 min-h-9 w-full rounded-lg border border-[#d5dfd4] bg-white px-2 text-sm font-normal"
              defaultValue={kind}
              name="kind"
            >
              <option value="multiple_choice">Multiple choice</option>
              <option value="true_false">True / false</option>
            </select>
          </label>

          <label className="block text-xs font-semibold text-[#496451]">
            Correct answer
            <select
              className="mt-1 min-h-9 w-full rounded-lg border border-[#d5dfd4] bg-white px-2 text-sm font-normal"
              disabled={lines.length === 0}
              name="correctIndex"
              onChange={(event) => setSelected(Number(event.target.value))}
              value={String(safeIndex)}
            >
              {lines.length === 0
                ? <option value="0">Add an option first</option>
                : lines.map((line, index) => (
                  <option key={`${index}-${line}`} value={index}>
                    {index + 1}. {line.slice(0, 28)}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      {listChanged && (
        <p className="rounded-lg bg-[#fff7e6] px-3 py-2 text-xs leading-5 text-[#8a5a13]">
          You changed the options. The saved answer key refers to a position, so check the
          correct answer above before saving.
        </p>
      )}
      {duplicates.length > 0 && (
        <p className="rounded-lg bg-[#fff1e9] px-3 py-2 text-xs leading-5 text-[#9a4324]" role="alert">
          Duplicate option{duplicates.length === 1 ? "" : "s"}: {duplicates.join(", ")}. Options must be distinct.
        </p>
      )}
      {tooFewOptions && (
        <p className="rounded-lg bg-[#fff1e9] px-3 py-2 text-xs leading-5 text-[#9a4324]" role="alert">
          A question needs at least two options.
        </p>
      )}

      <label className="block text-xs font-semibold text-[#496451]">
        Explanation <span className="font-normal text-[#7b8c81]">(shown to the student only after they answer)</span>
        <textarea
          className="mt-1 min-h-12 w-full rounded-lg border border-[#d5dfd4] px-2 py-1.5 text-sm font-normal"
          defaultValue={explanation}
          maxLength={600}
          name="explanation"
          required
        />
      </label>

      <button
        className="min-h-9 rounded-lg border border-[#1f674a] px-3 text-xs font-bold text-[#1f674a] hover:bg-[#edf3e9] disabled:opacity-50"
        disabled={blocked}
        type="submit"
      >
        Save question
      </button>
    </form>
  );
}
