"use client";

import { useCallback, useRef, useState } from "react";
import Papa from "papaparse";
import {
  AlertCircle,
  CheckCircle,
  FileText,
  Upload,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FileType = "usage_logs" | "stripe_export";

type FileUploaderProps = {
  fileType: FileType;
  auditId: string;
  onUploadComplete: (fileId: string, rowCount: number) => void;
};

const REQUIRED_COLUMNS: Record<FileType, string[]> = {
  usage_logs: [
    "event_id",
    "customer_id",
    "event_type",
    "timestamp",
    "quantity",
  ],
  stripe_export: [
    "id",
    "customer",
    "amount",
    "status",
    "created",
  ],
};

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const FileUploader = ({
  fileType,
  auditId,
  onUploadComplete,
}: FileUploaderProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<
    Record<string, string | number | null>[]
  >([]);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  const resetState = () => {
    setStatus("idle");
    setErrorMessage(null);
    setPreviewRows([]);
    setPreviewHeaders([]);
    setProgress(0);
  };

  const parseCsv = (file: File) =>
    new Promise<Papa.ParseResult<Record<string, string>>>(
      (resolve, reject) => {
        Papa.parse<Record<string, string>>(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results),
          error: (error) => reject(error),
        });
      }
    );

  const validateFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return "Seuls les fichiers .csv sont acceptés.";
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return "Le fichier dépasse la limite de 50MB.";
    }

    return null;
  };

  const startProgress = () => {
    setProgress(10);
    const interval = window.setInterval(() => {
      setProgress((prev) => (prev < 90 ? prev + 5 : prev));
    }, 200);
    return () => window.clearInterval(interval);
  };

  const handleUpload = useCallback(
    async (file: File) => {
      resetState();

      const validationError = validateFile(file);
      if (validationError) {
        setStatus("error");
        setErrorMessage(validationError);
        return;
      }

      setStatus("uploading");
      const stopProgress = startProgress();

      try {
        const results = await parseCsv(file);
        const headers = results.meta.fields ?? [];
        const requiredColumns = REQUIRED_COLUMNS[fileType];
        const missingColumns = requiredColumns.filter(
          (column) => !headers.includes(column)
        );

        if (missingColumns.length > 0) {
          throw new Error(
            `Colonnes manquantes : ${missingColumns.join(", ")}.`
          );
        }

        const rows = results.data.filter((row) =>
          Object.values(row).some(
            (value) => value !== null && value !== undefined && value !== ""
          )
        );

        setPreviewHeaders(headers);
        setPreviewRows(rows.slice(0, 5));

        const supabase = createClient();
        const filePath = `${auditId}/${fileType}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("audit-files")
          .upload(filePath, file, { upsert: false });

        if (uploadError) {
          throw new Error("Échec de l'upload vers le stockage.");
        }

        const { data: uploadedRecord, error: dbError } = await supabase
          .from("uploaded_files")
          .insert({
            audit_id: auditId,
            file_type: fileType,
            file_name: file.name,
            file_path: filePath,
            row_count: rows.length,
            uploaded_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (dbError || !uploadedRecord) {
          throw new Error("Échec de l'enregistrement du fichier.");
        }

        setProgress(100);
        setStatus("success");
        onUploadComplete(uploadedRecord.id, rows.length);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Une erreur est survenue pendant l'upload.";
        setStatus("error");
        setErrorMessage(message);
      } finally {
        stopProgress();
      }
    },
    [auditId, fileType, onUploadComplete]
  );

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) {
      return;
    }
    handleUpload(file);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const handleBrowse = () => {
    inputRef.current?.click();
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold text-slate-900">
          Importer un fichier CSV
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />

        <div
          className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition ${
            isDragging
              ? "border-slate-400 bg-slate-100"
              : "border-slate-200 bg-white"
          } ${status === "uploading" ? "opacity-70" : ""}`}
          onDragEnter={() => setIsDragging(true)}
          onDragLeave={() => setIsDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <Upload className="mb-3 h-8 w-8 text-slate-500" />
          <p className="text-sm font-medium text-slate-700">
            Glissez-déposez votre CSV ici
          </p>
          <p className="mt-1 text-xs text-slate-500">
            ou cliquez pour sélectionner un fichier (max 50MB)
          </p>
          <button
            type="button"
            onClick={handleBrowse}
            className="mt-4 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Choisir un fichier
          </button>
        </div>

        {status === "uploading" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <FileText className="h-4 w-4" />
              Upload en cours...
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200">
              <div
                className="h-2 rounded-full bg-slate-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {status === "success" && (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle className="h-4 w-4" />
            Fichier importé avec succès.
          </div>
        )}

        {status === "error" && errorMessage && (
          <div className="flex items-start gap-2 text-sm text-rose-600">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <span>{errorMessage}</span>
          </div>
        )}

        {previewRows.length > 0 && (
          <div className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              Aperçu des 5 premières lignes
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs text-slate-700">
                <thead className="bg-white">
                  <tr>
                    {previewHeaders.map((header) => (
                      <th
                        key={header}
                        className="border-b border-slate-200 px-3 py-2 text-left font-medium"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={index} className="odd:bg-white even:bg-slate-50">
                      {previewHeaders.map((header) => (
                        <td
                          key={header}
                          className="whitespace-nowrap px-3 py-2 text-slate-600"
                        >
                          {row[header] ?? "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FileUploader;