import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { QA } from "@/types";

interface Question {
  linkId: string;
  short: string;
  text: string;
}

interface Props {
  questions: readonly Question[];
  onComplete: (qa: QA[]) => void;
  onCancel: () => void;
}

export function InterviewScreen({ questions, onComplete, onCancel }: Props) {
  const [current, setCurrent] = useState(0);
  const [drafts, setDrafts] = useState<string[]>(() => questions.map(() => ""));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [current]);

  const q = questions[current];
  const total = questions.length;
  const isLast = current === total - 1;
  const value = drafts[current];
  const canAdvance = value.trim().length > 0;

  function setValue(v: string) {
    setDrafts((d) => d.map((x, i) => (i === current ? v : x)));
  }

  function next() {
    if (!canAdvance) return;
    if (isLast) {
      const qa: QA[] = questions.map((question, i) => ({
        link_id: question.linkId,
        question: question.text,
        answer: drafts[i].trim(),
      }));
      onComplete(qa);
    } else {
      setCurrent((c) => c + 1);
    }
  }

  function back() {
    if (current === 0) onCancel();
    else setCurrent((c) => c - 1);
  }

  return (
    <div className="grid gap-8 md:grid-cols-[220px_1fr]">
      {/* Stepper */}
      <nav className="hidden md:block">
        <ol className="space-y-1">
          {questions.map((question, i) => {
            const done = i < current || drafts[i].trim().length > 0;
            const active = i === current;
            return (
              <li key={question.linkId}>
                <button
                  type="button"
                  onClick={() => i <= current && setCurrent(i)}
                  disabled={i > current}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    active && "bg-accent/60 font-medium text-accent-foreground",
                    !active && i <= current && "hover:bg-secondary",
                    i > current && "cursor-default opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                      active && "border-primary bg-primary text-primary-foreground",
                      !active && done && "border-primary/40 bg-primary/10 text-primary",
                      !active && !done && "border-border text-muted-foreground",
                    )}
                  >
                    {!active && done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="truncate">{question.short}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Question panel */}
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>
              Question {current + 1} of {total}
            </span>
            <span className="md:hidden">{q.short}</span>
          </div>
          <Progress value={((current + 1) / total) * 100} />
        </div>

        <Card>
          <CardContent className="space-y-5 p-7">
            <h2 className="text-xl font-semibold leading-snug tracking-tight">{q.text}</h2>
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") next();
              }}
              placeholder="Type the patient's answer…"
            />
            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={back}>
                <ArrowLeft /> {current === 0 ? "Cancel" : "Back"}
              </Button>
              <Button onClick={next} disabled={!canAdvance}>
                {isLast ? "Submit interview" : "Continue"} <ArrowRight />
              </Button>
            </div>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Press <kbd className="rounded border bg-muted px-1">⌘/Ctrl</kbd> +{" "}
          <kbd className="rounded border bg-muted px-1">Enter</kbd> to continue
        </p>
      </div>
    </div>
  );
}
