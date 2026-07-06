"use client";

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FileText, Upload, Check, Mail, Key, Copy } from "lucide-react";

export default function ResumePage() {
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [keyCreatedAt, setKeyCreatedAt] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [keyStatusKnown, setKeyStatusKnown] = useState(false);

  const loadResume = useCallback(async () => {
    const res = await fetch("/api/resume");
    const data = await res.json();
    setResumeText(data.resumeText);
    setUploadedAt(data.uploadedAt);
    setDigestEnabled(data.emailDigestEnabled ?? true);
  }, []);

  const loadKeyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/extension/key");
      if (!res.ok) return;
      const data = await res.json();
      setHasKey(data.hasKey);
      setKeyCreatedAt(data.createdAt);
      setKeyStatusKnown(true);
    } catch {
      // Status unknown — handleGenerateKey will confirm before overwriting.
    }
  }, []);

  useEffect(() => {
    loadResume();
    loadKeyStatus();
  }, [loadResume, loadKeyStatus]);

  async function handleGenerateKey() {
    // Confirm when a key exists — or when we couldn't load key status and
    // might be about to silently invalidate a working one.
    if (
      (hasKey || !keyStatusKnown) &&
      !confirm(
        "Regenerating will invalidate your current key (if any) — the extension will stop working until you paste the new one. Continue?"
      )
    ) {
      return;
    }
    setKeyBusy(true);
    setKeyCopied(false);
    setKeyError("");
    try {
      const res = await fetch("/api/extension/key", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setKeyError(data.error);
        return;
      }
      setNewKey(data.apiKey);
      setHasKey(true);
      setKeyCreatedAt(new Date().toISOString());
    } catch {
      setKeyError("Failed to generate key — check your connection and try again");
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setSuccess(false);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/resume/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error);
      setUploading(false);
      return;
    }

    setResumeText(data.resumeText);
    setUploadedAt(new Date().toISOString());
    setUploading(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto h-full overflow-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Resume</h1>
        <p className="text-muted-foreground mt-1">
          Upload your resume to enable AI job fit evaluation
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Your Resume
              </CardTitle>
              {uploadedAt && (
                <CardDescription className="mt-1">
                  Last uploaded{" "}
                  {new Date(uploadedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </CardDescription>
              )}
            </div>
            <div className="flex items-center gap-2">
              {success && (
                <span className="flex items-center gap-1 text-sm text-emerald-600">
                  <Check className="h-4 w-4" />
                  Uploaded
                </span>
              )}
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".md,.txt"
                  onChange={handleUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <span
                  className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium h-10 px-4 py-2 ${
                    resumeText
                      ? "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground"
                      : "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                  } ${uploading ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <Upload className="h-4 w-4" />
                  {uploading
                    ? "Uploading..."
                    : resumeText
                    ? "Upload New"
                    : "Upload Resume"}
                </span>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3 mb-4">
              {error}
            </div>
          )}

          {resumeText ? (
            <div className="bg-muted/50 rounded-lg p-6 max-h-[600px] overflow-y-auto prose prose-sm max-w-none prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:leading-relaxed prose-li:leading-relaxed prose-strong:font-semibold">
              <ReactMarkdown>{resumeText}</ReactMarkdown>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No resume uploaded</p>
              <p className="text-sm mt-1">
                Upload a .md or .txt file to get started
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Digest
          </CardTitle>
          <CardDescription>
            Receive an email summary after each scheduled scrape with new jobs
            and your top matches from the last 7 days
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              checked={digestEnabled}
              onCheckedChange={async (checked) => {
                setDigestEnabled(checked);
                await fetch("/api/resume", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ emailDigestEnabled: checked }),
                });
              }}
            />
            <Label>
              {digestEnabled ? "Digest emails enabled" : "Digest emails disabled"}
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Chrome Extension
              </CardTitle>
              <CardDescription className="mt-1">
                Score LinkedIn job listings in place. Generate an API key and
                paste it into the Job Scout extension&apos;s options page.
                {hasKey && keyCreatedAt && !newKey && (
                  <>
                    {" "}
                    Key generated on{" "}
                    {new Date(keyCreatedAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                    .
                  </>
                )}
              </CardDescription>
            </div>
            <Button
              variant={hasKey ? "outline" : "default"}
              onClick={handleGenerateKey}
              disabled={keyBusy}
            >
              {keyBusy
                ? "Generating..."
                : hasKey
                ? "Regenerate Key"
                : "Generate Key"}
            </Button>
          </div>
        </CardHeader>
        {keyError && (
          <CardContent>
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3">
              {keyError}
            </div>
          </CardContent>
        )}
        {newKey && (
          <CardContent>
            <div className="rounded-lg bg-muted/50 p-4">
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm break-all select-all">
                  {newKey}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(newKey);
                    setKeyCopied(true);
                    setTimeout(() => setKeyCopied(false), 3000);
                  }}
                >
                  {keyCopied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {keyCopied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                This key is shown only once — copy it now. Regenerating later
                will invalidate it.
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
