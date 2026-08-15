import { useState } from "react";
import { Zap, Plus, ArrowDown, Play, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";

export interface AutomationStep {
  id: string;
  type: "trigger" | "condition" | "action" | "delay";
  name: string;
  config: Record<string, unknown>;
}

export function VisualAutomationBuilder() {
  const [name, setName] = useState("New Member Welcome Flow");
  const [enabled, setEnabled] = useState(true);
  const [steps, setSteps] = useState<AutomationStep[]>([
    {
      id: "step_1",
      type: "trigger",
      name: "When a new member subscribes",
      config: { event: "member.subscribed" },
    },
    {
      id: "step_2",
      type: "condition",
      name: "If membership tier equals 'Premium'",
      config: { field: "tier", operator: "equals", value: "Premium" },
    },
    {
      id: "step_3",
      type: "action",
      name: "Add tag 'vip-member'",
      config: { actionType: "tag_add", tag: "vip-member" },
    },
  ]);

  const addStep = (type: AutomationStep["type"]) => {
    const newStep: AutomationStep = {
      id: `step_${Date.now()}`,
      type,
      name:
        type === "condition"
          ? "If condition matches"
          : type === "action"
            ? "Then execute action"
            : "Wait delay",
      config: {},
    };
    setSteps([...steps, newStep]);
  };

  const removeStep = (id: string) => {
    setSteps(steps.filter((s) => s.id !== id));
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" />
            Visual Automations
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Build event-driven publishing and audience growth workflows visually.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded text-primary focus:ring-primary h-4 w-4"
            />
            {enabled ? "Active" : "Paused"}
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90"
          >
            <Play className="w-4 h-4" />
            Save Automation
          </button>
        </div>
      </div>

      {/* Workflow Metadata */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          Workflow Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm font-medium"
        />
      </div>

      {/* Visual Canvas */}
      <div className="space-y-4 py-4">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex flex-col items-center">
            <div className="w-full max-w-lg p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-md ${
                    step.type === "trigger"
                      ? "bg-amber-100 dark:bg-amber-950/60 text-amber-600"
                      : step.type === "condition"
                        ? "bg-blue-100 dark:bg-blue-950/60 text-blue-600"
                        : "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600"
                  }`}
                >
                  {step.type === "trigger" ? (
                    <Zap className="w-5 h-5" />
                  ) : step.type === "condition" ? (
                    <AlertCircle className="w-5 h-5" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {step.type}
                  </span>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {step.name}
                  </h4>
                </div>
              </div>

              {step.type !== "trigger" && (
                <button
                  type="button"
                  onClick={() => removeStep(step.id)}
                  className="p-1.5 text-slate-400 hover:text-destructive rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {idx < steps.length - 1 && (
              <div className="my-2 text-slate-400 flex flex-col items-center">
                <div className="w-0.5 h-4 bg-slate-300 dark:bg-slate-700" />
                <ArrowDown className="w-4 h-4 my-0.5" />
                <div className="w-0.5 h-4 bg-slate-300 dark:bg-slate-700" />
              </div>
            )}
          </div>
        ))}

        {/* Add Step Node Actions */}
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            type="button"
            onClick={() => addStep("condition")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs font-medium rounded border border-blue-200 dark:border-blue-800 hover:bg-blue-100"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Filter Condition (IF)
          </button>
          <button
            type="button"
            onClick={() => addStep("action")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-medium rounded border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Action (THEN)
          </button>
        </div>
      </div>
    </div>
  );
}
