"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Settings, Save, Check } from "lucide-react";

interface ConfigItem {
  key: string;
  value: any;
  description: string | null;
}

const CONFIG_LABELS: Record<string, string> = {
  blocked_publishers: "Blocked Publishers (JSON array)",
  min_comp_top_end: "Minimum Top-End Compensation ($)",
  score_threshold_strong: "Strong Fit Threshold",
  score_threshold_good: "Good Fit Threshold",
  score_threshold_borderline: "Borderline Threshold",
  eval_model: "Claude Model ID",
  eval_concurrency: "Evaluation Concurrency",
  delay_between_fetches_ms: "Delay Between Fetches (ms)",
  max_searches_per_user: "Max Searches Per User",
  max_refreshes_per_hour: "Max Refreshes Per Hour",
  max_results_per_search: "Max Results Per Search",
  email_from_address: "Digest From Address",
};

export default function AdminSettingsPage() {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    const res = await fetch("/api/admin/config");
    const data = await res.json();
    setConfigs(data);
    const values: Record<string, string> = {};
    for (const item of data) {
      values[item.key] = JSON.stringify(item.value);
    }
    setEditValues(values);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function handleSave(key: string) {
    setSaving(key);
    const raw = editValues[key].trim();

    // Parse smartly: try JSON first, then treat as plain string/number
    let value: any;
    if (raw === "") {
      value = null;
    } else {
      try {
        value = JSON.parse(raw);
      } catch {
        // If it looks like a number, parse it as one
        if (/^\d+(\.\d+)?$/.test(raw)) {
          value = Number(raw);
        } else {
          // Treat as a plain string
          value = raw;
        }
      }
    }

    await fetch(`/api/admin/config/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    setSaved(key);
    setTimeout(() => setSaved(null), 3000);
    setSaving(null);
  }

  return (
    <div className="p-6 lg:p-8 h-full overflow-auto max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Global Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure system-wide defaults. Changes take effect immediately.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {configs.map((config) => (
            <Card key={config.key}>
              <CardContent className="p-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">
                      {CONFIG_LABELS[config.key] || config.key}
                    </Label>
                    {config.description && (
                      <p className="text-xs text-muted-foreground mb-1.5">
                        {config.description}
                      </p>
                    )}
                    <Input
                      value={editValues[config.key] || ""}
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          [config.key]: e.target.value,
                        })
                      }
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSave(config.key)}
                    disabled={saving === config.key}
                  >
                    {saved === config.key ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
