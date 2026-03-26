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
import { FileText, Upload, Check } from "lucide-react";

export default function ResumePage() {
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const loadResume = useCallback(async () => {
    const res = await fetch("/api/resume");
    const data = await res.json();
    setResumeText(data.resumeText);
    setUploadedAt(data.uploadedAt);
  }, []);

  useEffect(() => {
    loadResume();
  }, [loadResume]);

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
    </div>
  );
}
