import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Question } from "@/data/questions";
import type { QA } from "@/types";

interface Props {
  questions: readonly Question[];
  onComplete: (qa: QA[]) => void;
  onCancel: () => void;
}

// One draft per question: free text, a chosen scale number, or selected choices.
interface Draft {
  text: string;
  scale: number | null;
  choices: string[];
}

const emptyDraft = (): Draft => ({ text: "", scale: null, choices: [] });

export function InterviewScreen({ questions, onComplete, onCancel }: Props) {
  const [current, setCurrent] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(emptyDraft));
  const textRef = useRef<HTMLTextAreaElement>(null);

  const q = questions[current];
  const total = questions.length;
  const isLast = current === total - 1;
  const draft = drafts[current];

  useEffect(() => {
    if (q.kind === "text") textRef.current?.focus();
  }, [current, q.kind]);

  const answered = (i: number): boolean => {
    const d = drafts[i];
    const k = questions[i].kind;
    if (k === "text") return d.text.trim().length > 0;
    if (k === "scale") return d.scale !== null;
    return d.choices.length > 0;
  };
  const canAdvance = answered(current);

  function update(patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === current ? { ...d, ...patch } : d)));
  }

  function answerString(i: number): string {
    const d = drafts[i];
    const k = questions[i].kind;
    if (k === "scale") return d.scale === null ? "" : `${d.scale} out of 10`;
    if (k === "choices") return d.choices.join(", ");
    return d.text.trim();
  }

  function next() {
    if (!canAdvance) return;
    if (isLast) {
      onComplete(
        questions.map((question, i) => ({
          link_id: question.linkId,
          question: question.prompt,
          answer: answerString(i),
        })),
      );
    } else {
      setCurrent((c) => c + 1);
    }
  }

  function back() {
    if (current === 0) onCancel();
    else setCurrent((c) => c - 1);
  }

  function toggleChoice(option: string, isNone: boolean) {
    if (q.kind !== "choices") return;
    if (isNone) {
      update({ choices: draft.choices.includes(option) ? [] : [option] });
      return;
    }
    const without = draft.choices.filter((c) => c !== q.noneOption);
    update({
      choices: without.includes(option)
        ? without.filter((c) => c !== option)
        : [...without, option],
    });
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-10 md:grid-cols-[160px_1fr]">
      {/* Step rail — plain list, no badges */}
      <nav className="hidden md:block">
        <ol className="space-y-px text-sm">
          {questions.map((question, i) => {
            const done = answered(i) && i !== current;
            const active = i === current;
            return (
              <li key={question.linkId}>
                <button
                  type="button"
                  onClick={() => i <= current && setCurrent(i)}
                  disabled={i > current}
                  className={cn(
                    "flex w-full items-center gap-2 border-l-2 py-1.5 pl-3 text-left transition-colors",
                    active && "border-primary font-medium text-foreground",
                    !active && i < current && "border-transparent text-muted-foreground hover:text-foreground",
                    i > current && "border-transparent text-muted-foreground/50",
                  )}
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : (
                    <span className="w-3.5 shrink-0 text-center text-xs tabular-nums">{i + 1}</span>
                  )}
                  <span className="truncate">{question.short}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Question */}
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Question {current + 1} of {total}
          </p>
          <Progress value={((current + 1) / total) * 100} />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight">{q.prompt}</h2>
          {q.help && <p className="text-sm text-muted-foreground">{q.help}</p>}
        </div>

        {q.kind === "text" && (
          <Textarea
            ref={textRef}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") next();
            }}
            placeholder={q.placeholder}
            className="min-h-28 text-base"
          />
        )}

        {q.kind === "scale" && (
          <div className="space-y-2">
            <div className="grid grid-cols-10 gap-1.5">
              {Array.from({ length: q.max - q.min + 1 }, (_, idx) => q.min + idx).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => update({ scale: n })}
                  className={cn(
                    "h-11 rounded-md border text-sm font-medium tabular-nums transition-colors",
                    draft.scale === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-card hover:border-primary/50 hover:bg-accent/50",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{q.minLabel}</span>
              <span>{q.maxLabel}</span>
            </div>
          </div>
        )}

        {q.kind === "choices" && (
          <div className="space-y-2">
            {[...q.options, q.noneOption].map((option) => {
              const isNone = option === q.noneOption;
              const selected = draft.choices.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleChoice(option, isNone)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm transition-colors",
                    selected
                      ? "border-primary bg-accent/60 font-medium"
                      : "border-input bg-card hover:border-primary/40 hover:bg-accent/30",
                    isNone && "mt-1 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                  {option}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" onClick={back}>
            <ArrowLeft /> {current === 0 ? "Cancel" : "Back"}
          </Button>
          <Button onClick={next} disabled={!canAdvance}>
            {isLast ? "Submit" : "Continue"} <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
