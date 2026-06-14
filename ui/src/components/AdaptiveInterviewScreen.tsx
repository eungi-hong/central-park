import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { QUESTIONS, SEED_QUESTION, toQuestion, type Question } from "@/data/questions";
import { fetchNextQuestion } from "@/api";
import type { QA } from "@/types";

interface Props {
  patientId: string;
  onComplete: (qa: QA[]) => void;
  onCancel: () => void;
}

interface Draft {
  text: string;
  scale: number | null;
  choices: string[];
}

const emptyDraft = (): Draft => ({ text: "", scale: null, choices: [] });

// The patient self-intake, driven by the agent one question at a time. The
// opening complaint is asked client-side (instant, no round-trip); every
// question after that comes from POST /api/interview/next, which reasons over
// the answers so far plus the patient's FHIR record. If the agent is
// unreachable we fall back to the fixed QUESTIONS set so intake never stalls.
export function AdaptiveInterviewScreen({ patientId, onComplete, onCancel }: Props) {
  // Questions answered so far, the question on screen now, and its draft.
  const [answered, setAnswered] = useState<QA[]>([]);
  const [question, setQuestion] = useState<Question>(SEED_QUESTION);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(false);
  // Once the agent path fails we walk the remaining static questions instead.
  const [fallback, setFallback] = useState<Question[] | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const stepNumber = answered.length + 1;

  useEffect(() => {
    if (question.kind === "text") textRef.current?.focus();
  }, [question]);

  function update(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  const canAdvance =
    question.kind === "text"
      ? draft.text.trim().length > 0
      : question.kind === "scale"
        ? draft.scale !== null
        : draft.choices.length > 0;

  function answerString(): string {
    if (question.kind === "scale") return draft.scale === null ? "" : `${draft.scale} out of 10`;
    if (question.kind === "choices") return draft.choices.join(", ");
    return draft.text.trim();
  }

  // Remaining fixed questions we have not asked yet — the fallback queue.
  function remainingStatic(asked: QA[]): Question[] {
    const seen = new Set(asked.map((a) => a.link_id));
    return QUESTIONS.filter((q) => !seen.has(q.linkId));
  }

  async function next() {
    if (!canAdvance || loading) return;
    const nextAnswered: QA[] = [
      ...answered,
      { link_id: question.linkId, question: question.prompt, answer: answerString() },
    ];
    setAnswered(nextAnswered);
    setDraft(emptyDraft());

    // Fallback mode: just walk the remaining fixed questions.
    if (fallback) {
      const [head, ...rest] = fallback;
      if (head) {
        setFallback(rest);
        setQuestion(head);
      } else {
        onComplete(nextAnswered);
      }
      return;
    }

    setLoading(true);
    try {
      const result = await fetchNextQuestion(patientId, nextAnswered);
      if (result.done || !result.question) {
        onComplete(nextAnswered);
        return;
      }
      setQuestion(toQuestion(result.question));
    } catch {
      // Agent unreachable: switch to the fixed question set for whatever we
      // have not asked yet, so the patient can still finish.
      const queue = remainingStatic(nextAnswered);
      if (queue.length === 0) {
        onComplete(nextAnswered);
        return;
      }
      const [head, ...rest] = queue;
      setFallback(rest);
      setQuestion(head);
    } finally {
      setLoading(false);
    }
  }

  function back() {
    if (answered.length === 0) {
      onCancel();
      return;
    }
    // Step back to the previous answer. We re-ask it rather than restoring the
    // exact draft; simpler and the patient just re-enters one short answer.
    const prev = answered[answered.length - 1];
    setAnswered((a) => a.slice(0, -1));
    setDraft(emptyDraft());
    setQuestion(
      QUESTIONS.find((q) => q.linkId === prev.link_id) ?? {
        kind: "text",
        linkId: prev.link_id,
        short: prev.question.slice(0, 24),
        prompt: prev.question,
      },
    );
  }

  function toggleChoice(option: string, isNone: boolean) {
    if (question.kind !== "choices") return;
    if (isNone) {
      update({ choices: draft.choices.includes(option) ? [] : [option] });
      return;
    }
    const without = draft.choices.filter((c) => c !== question.noneOption);
    update({
      choices: without.includes(option)
        ? without.filter((c) => c !== option)
        : [...without, option],
    });
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-10 md:grid-cols-[180px_1fr]">
      {/* Step rail — grows as the agent asks. No fixed total: this is adaptive. */}
      <nav className="hidden md:block">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Adaptive intake
        </p>
        <ol className="space-y-px text-sm">
          {answered.map((a, i) => (
            <li key={`${a.link_id}-${i}`}>
              <span className="flex items-center gap-2 border-l-2 border-transparent py-1.5 pl-3 text-muted-foreground">
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">
                  {QUESTIONS.find((q) => q.linkId === a.link_id)?.short ?? a.question.slice(0, 22)}
                </span>
              </span>
            </li>
          ))}
          <li>
            <span className="flex items-center gap-2 border-l-2 border-primary py-1.5 pl-3 font-medium text-foreground">
              <span className="w-3.5 shrink-0 text-center text-xs tabular-nums">{stepNumber}</span>
              <span className="truncate">{question.short}</span>
            </span>
          </li>
        </ol>
      </nav>

      {/* Question */}
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Question {stepNumber}
            {loading && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-primary">
                <Loader2 className="h-3 w-3 animate-spin" /> choosing the next question…
              </span>
            )}
          </p>
          {/* Indeterminate bar — we don't know the total, so this signals
              progress without a false denominator. */}
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-all duration-500",
                loading && "animate-pulse",
              )}
              style={{ width: `${Math.min(90, 25 + answered.length * 12)}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight">{question.prompt}</h2>
          {question.help && <p className="text-sm text-muted-foreground">{question.help}</p>}
        </div>

        {question.kind === "text" && (
          <Textarea
            ref={textRef}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") next();
            }}
            placeholder={question.placeholder}
            className="min-h-28 text-base"
          />
        )}

        {question.kind === "scale" && (
          <div className="space-y-2">
            <div className="grid grid-cols-10 gap-1.5">
              {Array.from({ length: question.max - question.min + 1 }, (_, idx) => question.min + idx).map(
                (n) => (
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
                ),
              )}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{question.minLabel}</span>
              <span>{question.maxLabel}</span>
            </div>
          </div>
        )}

        {question.kind === "choices" && (
          <div className="space-y-2">
            {[...question.options, question.noneOption].map((option) => {
              const isNone = option === question.noneOption;
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
          <Button variant="ghost" onClick={back} disabled={loading}>
            <ArrowLeft /> {answered.length === 0 ? "Cancel" : "Back"}
          </Button>
          <Button onClick={next} disabled={!canAdvance || loading}>
            {loading ? <Loader2 className="animate-spin" /> : <>Continue <ArrowRight /></>}
          </Button>
        </div>
      </div>
    </div>
  );
}
