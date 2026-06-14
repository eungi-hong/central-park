import { useState } from "react";
import { Database, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runNlQuery, ApiError } from "@/api";
import type { QueryResult } from "@/types";

// Explore: ask in natural language, the agent translates it into a validated,
// read-only FHIR search and runs it. Showcases NL->FHIR query.
const EXAMPLES = [
  "Active conditions across all patients",
  "Patients with diabetes",
  "Urgent service requests",
  "Medication interactions detected",
];

export function ExploreView() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || loading) return;
    setQ(text);
    setLoading(true);
    setError(null);
    try {
      setData(await runNlQuery(text));
    } catch (err) {
      setError((err as ApiError).message ?? "Query failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Explore</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Ask in plain language. The agent writes a validated, read-only FHIR query and runs it.
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(q)}
            placeholder="e.g. patients with diabetes over 65"
            className="pl-9"
          />
        </div>
        <Button onClick={() => ask(q)} disabled={loading || !q.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run"}
        </Button>
      </div>

      {!data && !loading && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => ask(ex)}
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <div className="space-y-3">
          {/* The translated query, shown for transparency. */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Database className="h-4 w-4 text-slate-500" />
              <span className="font-mono text-xs">
                GET /{data.resource_type}
                {Object.keys(data.params).length > 0 &&
                  "?" + Object.entries(data.params).map(([k, v]) => `${k}=${v}`).join("&")}
              </span>
            </div>
            {data.explanation && (
              <p className="mt-1 text-xs text-muted-foreground">{data.explanation}</p>
            )}
          </div>

          {data.error ? (
            <p className="text-sm text-destructive">{data.error}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {data.total} {data.total === 1 ? "result" : "results"}
              </p>
              <ul className="divide-y rounded-lg border">
                {data.results.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {r.type}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.display || r.id}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.id}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
