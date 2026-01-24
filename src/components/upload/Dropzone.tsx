"use client";

import { useCallback, useRef, useState } from "react";
import Papa from "papaparse";
import { Upload, FileText, X } from "lucide-react";

type DropzoneStatus = "idle" | "hover" | "uploading" | "uploaded" | "error";

type DropzoneProps = {
  auditId: string | null;
  onEnsureAudit?: () => Promise<string>;
  fileType: "usage_logs" | "stripe_export";
  onUploadComplete: () => void;
};

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function Dropzone({
  auditId,
  onEnsureAudit,
  fileType,
  onUploadComplete,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<DropzoneStatus>("idle");
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validateFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return "Only .csv files are accepted.";
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return "The file exceeds the 50MB limit.";
    }
    return null;
  };

  const parseCsv = (file: File) =>
    new Promise<Papa.ParseResult<Record<string, string>>>((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results),
        error: (error) => reject(error),
      });
    });

  const handleUpload = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setStatus("error");
        setErrorMessage(validationError);
        return;
      }

      setStatus("uploading");
      setErrorMessage(null);

      try {
        const results = await parseCsv(file);
        const rows = results.data.filter((row) =>
          Object.values(row).some(
            (value) => value !== null && value !== undefined && value !== ""
          )
        );

        let resolvedAuditId = auditId;
        if (!resolvedAuditId) {
          if (!onEnsureAudit) {
            throw new Error("Unable to create an audit for this upload.");
          }
          resolvedAuditId = await onEnsureAudit();
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("auditId", resolvedAuditId);
        formData.append("fileType", fileType);
        formData.append("rowCount", String(rows.length));

        const response = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error ?? "Upload to storage failed.");
        }

        if (!data?.fileId) {
          throw new Error("Failed to save file record.");
        }

        setStatus("uploaded");
        setUploadedFile({ name: file.name, size: file.size });
        onUploadComplete();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "An error occurred during upload.";
        setStatus("error");
        setErrorMessage(message);
      }
    },
    [auditId, fileType, onEnsureAudit, onUploadComplete]
  );

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      handleUpload(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setStatus("idle");
    handleFiles(event.dataTransfer.files);
  };

  const handleRemove = () => {
    setStatus("idle");
    setUploadedFile(null);
    setErrorMessage(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  // Uploaded state
  if (status === "uploaded" && uploadedFile) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-900">
              {uploadedFile.name}
            </p>
            <p className="text-xs text-slate-500">
              {formatFileSize(uploadedFile.size)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Uploaded</span>
          <button
            type="button"
            onClick={handleRemove}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // Uploading state
  if (status === "uploading") {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
          <span className="text-sm text-slate-600">Uploading...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (status === "error" && errorMessage) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="text-sm text-rose-600">{errorMessage}</p>
        <button
          type="button"
          onClick={handleRemove}
          className="mt-2 text-xs font-medium text-rose-700 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // Default / Hover state
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />
      <div
        className={`flex cursor-pointer items-center justify-center rounded-lg border border-dashed px-4 py-5 transition-colors ${
          status === "hover"
            ? "border-slate-400 bg-slate-100"
            : "border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50"
        }`}
        onDragEnter={() => setStatus("hover")}
        onDragLeave={() => setStatus("idle")}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Upload className="h-4 w-4" />
          <span>
            Drag and drop or{" "}
            <span className="font-medium text-slate-900 underline">
              choose file
            </span>{" "}
            to upload
          </span>
        </div>
      </div>
    </>
  );
}
