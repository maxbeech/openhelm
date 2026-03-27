/**
 * ScopeMultiSelect — hierarchical multi-select for credential scopes.
 * Shows projects ▸ goals (indented) ▸ jobs (double-indented).
 * Selecting a parent selects all its children; deselecting a child
 * only removes that child (parent becomes "partial").
 * Selected items are shown as removable tags.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ChevronDown, X, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Project, Goal, Job, CredentialScopeBinding } from "@openhelm/shared";

interface Props {
  projects: Project[];
  goals: Goal[];
  jobs: Job[];
  value: CredentialScopeBinding[];
  onChange: (scopes: CredentialScopeBinding[]) => void;
}

function has(value: CredentialScopeBinding[], type: string, id: string): boolean {
  return value.some((s) => s.scopeType === type && s.scopeId === id);
}

function without(value: CredentialScopeBinding[], type: string, id: string): CredentialScopeBinding[] {
  return value.filter((s) => !(s.scopeType === type && s.scopeId === id));
}

function bindingKey(b: CredentialScopeBinding) {
  return `${b.scopeType}:${b.scopeId}`;
}

/**
 * Check if a goal is effectively selected — either directly or via its parent project.
 */
function isGoalSelected(goal: Goal, value: CredentialScopeBinding[]): boolean {
  return has(value, "goal", goal.id) || has(value, "project", goal.projectId);
}

/**
 * Check if a job is effectively selected — directly, via its goal, or via its project.
 */
function isJobSelected(job: Job, value: CredentialScopeBinding[]): boolean {
  if (has(value, "job", job.id)) return true;
  if (job.goalId && has(value, "goal", job.goalId)) return true;
  return has(value, "project", job.projectId);
}

type CheckState = "none" | "partial" | "all";

function projectCheckState(
  project: Project, goals: Goal[], jobs: Job[], value: CredentialScopeBinding[],
): CheckState {
  if (has(value, "project", project.id)) return "all";
  const pGoals = goals.filter((g) => g.projectId === project.id);
  const pJobs = jobs.filter((j) => j.projectId === project.id);
  const total = pGoals.length + pJobs.length;
  if (total === 0) return "none";
  const selected = pGoals.filter((g) => isGoalSelected(g, value)).length +
    pJobs.filter((j) => isJobSelected(j, value)).length;
  if (selected === 0) return "none";
  if (selected === total) return "all";
  return "partial";
}

function goalCheckState(goal: Goal, jobs: Job[], value: CredentialScopeBinding[]): CheckState {
  if (has(value, "project", goal.projectId)) return "all";
  if (has(value, "goal", goal.id)) return "all";
  const gJobs = jobs.filter((j) => j.goalId === goal.id);
  if (gJobs.length === 0) return "none";
  const selected = gJobs.filter((j) => isJobSelected(j, value)).length;
  if (selected === 0) return "none";
  if (selected === gJobs.length) return "all";
  return "partial";
}

export function ScopeMultiSelect({ projects, goals, jobs, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const lc = search.toLowerCase();
  const filteredProjects = useMemo(() => {
    if (!lc) return projects;
    return projects.filter((p) => {
      if (p.name.toLowerCase().includes(lc)) return true;
      if (goals.some((g) => g.projectId === p.id && g.name.toLowerCase().includes(lc))) return true;
      if (jobs.some((j) => j.projectId === p.id && j.name.toLowerCase().includes(lc))) return true;
      return false;
    });
  }, [projects, goals, jobs, lc]);

  // ── Toggle helpers ────────────────────────────────────────────────────────

  const toggleProject = useCallback(
    (project: Project) => {
      const state = projectCheckState(project, goals, jobs, value);
      // Remove all existing bindings for this project and its children
      const goalIds = new Set(goals.filter((g) => g.projectId === project.id).map((g) => g.id));
      const jobIds = new Set(jobs.filter((j) => j.projectId === project.id).map((j) => j.id));
      const cleaned = value.filter(
        (s) =>
          !(s.scopeType === "project" && s.scopeId === project.id) &&
          !(s.scopeType === "goal" && goalIds.has(s.scopeId)) &&
          !(s.scopeType === "job" && jobIds.has(s.scopeId)),
      );
      if (state !== "all") {
        onChange([...cleaned, { scopeType: "project", scopeId: project.id }]);
      } else {
        onChange(cleaned);
      }
    },
    [goals, jobs, value, onChange],
  );

  const toggleGoal = useCallback(
    (goal: Goal) => {
      const selected = isGoalSelected(goal, value);
      const goalJobIds = new Set(jobs.filter((j) => j.goalId === goal.id).map((j) => j.id));

      if (selected) {
        // Deselecting — if parent project is selected, explode it into sibling bindings
        let next = [...value];
        if (has(value, "project", goal.projectId)) {
          // Remove project binding
          next = without(next, "project", goal.projectId);
          // Add bindings for all sibling goals and standalone jobs EXCEPT this goal
          const siblingGoals = goals.filter((g) => g.projectId === goal.projectId && g.id !== goal.id);
          const standaloneJobs = jobs.filter((j) => j.projectId === goal.projectId && !j.goalId);
          for (const sg of siblingGoals) {
            if (!has(next, "goal", sg.id)) next.push({ scopeType: "goal", scopeId: sg.id });
          }
          for (const sj of standaloneJobs) {
            if (!has(next, "job", sj.id)) next.push({ scopeType: "job", scopeId: sj.id });
          }
        } else {
          // Remove goal binding and any child job bindings
          next = next.filter(
            (s) =>
              !(s.scopeType === "goal" && s.scopeId === goal.id) &&
              !(s.scopeType === "job" && goalJobIds.has(s.scopeId)),
          );
        }
        onChange(next);
      } else {
        // Selecting — add goal binding, remove any child job bindings (goal covers them)
        let next = value.filter((s) => !(s.scopeType === "job" && goalJobIds.has(s.scopeId)));
        next = [...next, { scopeType: "goal", scopeId: goal.id }];
        onChange(next);
      }
    },
    [goals, jobs, value, onChange],
  );

  const toggleJob = useCallback(
    (job: Job) => {
      const selected = isJobSelected(job, value);

      if (selected) {
        // Deselecting — may need to explode parent
        let next = [...value];
        if (job.goalId && has(value, "goal", job.goalId)) {
          // Explode goal into sibling job bindings
          next = without(next, "goal", job.goalId);
          const siblingJobs = jobs.filter((j) => j.goalId === job.goalId && j.id !== job.id);
          for (const sj of siblingJobs) {
            if (!has(next, "job", sj.id)) next.push({ scopeType: "job", scopeId: sj.id });
          }
        } else if (has(value, "project", job.projectId)) {
          // Explode project into sibling goal + job bindings
          next = without(next, "project", job.projectId);
          const siblingGoals = goals.filter((g) => g.projectId === job.projectId);
          const standaloneJobs = jobs.filter((j) => j.projectId === job.projectId && !j.goalId && j.id !== job.id);
          for (const sg of siblingGoals) {
            // If this job belongs to this goal, explode the goal too
            if (sg.id === job.goalId) {
              const goalJobs = jobs.filter((j) => j.goalId === sg.id && j.id !== job.id);
              for (const gj of goalJobs) {
                if (!has(next, "job", gj.id)) next.push({ scopeType: "job", scopeId: gj.id });
              }
            } else {
              if (!has(next, "goal", sg.id)) next.push({ scopeType: "goal", scopeId: sg.id });
            }
          }
          for (const sj of standaloneJobs) {
            if (!has(next, "job", sj.id)) next.push({ scopeType: "job", scopeId: sj.id });
          }
        } else {
          next = without(next, "job", job.id);
        }
        onChange(next);
      } else {
        // Selecting — just add the job binding
        onChange([...value, { scopeType: "job", scopeId: job.id }]);
      }
    },
    [goals, jobs, value, onChange],
  );

  // ── Tag labels ────────────────────────────────────────────────────────────

  const labelFor = useCallback(
    (binding: CredentialScopeBinding): string => {
      if (binding.scopeType === "project") {
        return projects.find((p) => p.id === binding.scopeId)?.name ?? binding.scopeId;
      }
      if (binding.scopeType === "goal") {
        return goals.find((g) => g.id === binding.scopeId)?.name ?? binding.scopeId;
      }
      return jobs.find((j) => j.id === binding.scopeId)?.name ?? binding.scopeId;
    },
    [projects, goals, jobs],
  );

  const triggerLabel =
    value.length === 0
      ? "Global (all projects)"
      : `${value.length} scope${value.length === 1 ? "" : "s"} selected`;

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="relative">
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 px-3 font-normal text-sm"
          onClick={() => setOpen((o) => !o)}
        >
          <span className={value.length === 0 ? "text-muted-foreground" : ""}>
            {triggerLabel}
          </span>
          <ChevronDown className={`ml-2 size-4 shrink-0 opacity-50 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>

        {open && (
          <div className="absolute left-0 right-0 z-50 mt-1 rounded-md border border-border bg-popover shadow-md">
            <div className="flex items-center border-b border-border px-3">
              <Search className="mr-2 size-3.5 shrink-0 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects, goals, jobs…"
                className="h-9 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                autoFocus
              />
            </div>

            <div className="max-h-52 overflow-y-auto py-1">
              {filteredProjects.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">No items found</p>
              )}
              {filteredProjects.map((project) => {
                const pState = projectCheckState(project, goals, jobs, value);
                const projectGoals = goals.filter((g) => g.projectId === project.id);
                const standaloneJobs = jobs.filter((j) => j.projectId === project.id && !j.goalId);

                return (
                  <div key={project.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-accent/50">
                      <Checkbox
                        checked={pState === "all" ? true : pState === "partial" ? "indeterminate" : false}
                        onCheckedChange={() => toggleProject(project)}
                        className="shrink-0"
                      />
                      <span className="text-sm font-medium truncate">{project.name}</span>
                    </label>

                    {projectGoals.map((goal) => {
                      const gState = goalCheckState(goal, jobs, value);
                      const goalJobs = jobs.filter((j) => j.goalId === goal.id);

                      if (lc && !goal.name.toLowerCase().includes(lc) &&
                          !goalJobs.some((j) => j.name.toLowerCase().includes(lc))) return null;

                      return (
                        <div key={goal.id}>
                          <label className="flex cursor-pointer items-center gap-2.5 py-1.5 pl-8 pr-3 hover:bg-accent/50">
                            <Checkbox
                              checked={gState === "all" ? true : gState === "partial" ? "indeterminate" : false}
                              onCheckedChange={() => toggleGoal(goal)}
                              className="shrink-0"
                            />
                            <span className="text-sm truncate text-foreground/80">{goal.name || goal.id}</span>
                          </label>

                          {goalJobs.map((job) => {
                            if (lc && !job.name.toLowerCase().includes(lc)) return null;
                            const checked = isJobSelected(job, value);
                            return (
                              <label
                                key={job.id}
                                className="flex cursor-pointer items-center gap-2.5 py-1.5 pl-14 pr-3 hover:bg-accent/50"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggleJob(job)}
                                  className="shrink-0"
                                />
                                <span className="text-xs truncate text-muted-foreground">{job.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })}

                    {standaloneJobs.map((job) => {
                      if (lc && !job.name.toLowerCase().includes(lc)) return null;
                      const checked = isJobSelected(job, value);
                      return (
                        <label
                          key={job.id}
                          className="flex cursor-pointer items-center gap-2.5 py-1.5 pl-8 pr-3 hover:bg-accent/50"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleJob(job)}
                            className="shrink-0"
                          />
                          <span className="text-xs truncate text-muted-foreground">{job.name}</span>
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Selected tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((binding) => (
            <Badge
              key={bindingKey(binding)}
              variant="secondary"
              className="gap-1 pr-1 text-xs"
            >
              <span className="text-muted-foreground capitalize">{binding.scopeType}:</span>
              {labelFor(binding)}
              <button
                type="button"
                onClick={() => {
                  // For tags, simply remove the binding (no explode needed — user is explicitly removing)
                  onChange(without(value, binding.scopeType, binding.scopeId));
                }}
                className="ml-0.5 rounded-sm hover:bg-muted"
                aria-label={`Remove ${labelFor(binding)}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
