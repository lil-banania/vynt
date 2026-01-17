"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, Check, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Audit, AuditStatus } from "@/lib/types/database";

type UploadedFileInfo = {
  id: string;
  audit_id: string;
  file_name: string;
  file_type: string;
};

type AuditRow = Audit & {
  organization_name: string;
  uploaded_files: UploadedFileInfo[];
};

type AdminAuditTableProps = {
  audits: AuditRow[];
};

const statusConfig: Record<AuditStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-slate-600" },
  pending: { label: "Pending", color: "bg-amber-600" },
  processing: { label: "Processing", color: "bg-blue-600" },
  review: { label: "Ready", color: "bg-emerald-600" },
  in_progress: { label: "In Progress", color: "bg-blue-600" },
  completed: { label: "Completed", color: "bg-emerald-600" },
  published: { label: "Published", color: "bg-slate-600" },
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatCurrency = (value: number | null) => {
  if (value === null || value === 0) return "$0";
  return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const AdminAuditTable = ({ audits }: AdminAuditTableProps) => {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<string | null>(null);

  const updateStatus = async (auditId: string, status: string) => {
    setLoadingId(auditId);
    setActionType(status);
    try {
      const response = await fetch("/api/audits/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, status }),
      });

      if (response.ok) {
        router.refresh();
      } else {
        const data = await response.json().catch(() => null);
        alert(data?.error ?? "Failed to update status.");
      }
    } catch {
      alert("Failed to update status.");
    } finally {
      setLoadingId(null);
      setActionType(null);
    }
  };

  const deleteAudit = async (auditId: string) => {
    if (!confirm("Are you sure you want to delete this audit?")) return;
    
    setLoadingId(auditId);
    setActionType("delete");
    try {
      const response = await fetch("/api/audits/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId }),
      });

      if (response.ok) {
        router.refresh();
      } else {
        const data = await response.json().catch(() => null);
        alert(data?.error ?? "Failed to delete audit.");
      }
    } catch {
      alert("Failed to delete audit.");
    } finally {
      setLoadingId(null);
      setActionType(null);
    }
  };

  if (audits.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-slate-500">
        No audits found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
            <th className="px-6 py-3">Organization</th>
            <th className="px-6 py-3">Status</th>
            <th className="px-6 py-3">Files</th>
            <th className="px-6 py-3">Anomalies</th>
            <th className="px-6 py-3">Revenue at Risk</th>
            <th className="px-6 py-3">Created</th>
            <th className="px-6 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {audits.map((audit) => {
            const isLoading = loadingId === audit.id;
            const config = statusConfig[audit.status] ?? statusConfig.draft;

            return (
              <tr
                key={audit.id}
                className="transition hover:bg-slate-800/50"
              >
                <td className="px-6 py-4">
                  <div className="font-medium text-white">
                    {audit.organization_name}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium text-white ${config.color}`}
                  >
                    {config.label}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-400">
                  {audit.uploaded_files.length === 0 ? (
                    <span className="text-slate-600">No files</span>
                  ) : (
                    <span>{audit.uploaded_files.length} file(s)</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className="font-medium text-white">
                    {audit.total_anomalies ?? 0}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className="font-medium text-rose-400">
                    {formatCurrency(audit.annual_revenue_at_risk)}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-400">
                  {formatDate(audit.created_at)}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-end gap-2">
                    {/* Preview Button */}
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="text-slate-400 hover:text-white hover:bg-slate-800"
                    >
                      <Link href={`/admin/preview/${audit.id}`}>
                        <Eye className="mr-1 h-4 w-4" />
                        Preview
                      </Link>
                    </Button>

                    {/* Status Actions */}
                    {audit.status !== "published" && (
                      <>
                        {audit.status === "pending" || audit.status === "processing" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isLoading}
                            onClick={() => updateStatus(audit.id, "review")}
                            className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950"
                          >
                            {isLoading && actionType === "review" ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="mr-1 h-4 w-4" />
                            )}
                            Approve
                          </Button>
                        ) : audit.status === "review" ? (
                          <Button
                            size="sm"
                            disabled={isLoading}
                            onClick={() => updateStatus(audit.id, "published")}
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            {isLoading && actionType === "published" ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="mr-1 h-4 w-4" />
                            )}
                            Publish
                          </Button>
                        ) : null}
                      </>
                    )}

                    {/* Delete (only for non-published) */}
                    {audit.status !== "published" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isLoading}
                        onClick={() => deleteAudit(audit.id)}
                        className="text-slate-500 hover:text-rose-400 hover:bg-rose-950"
                      >
                        {isLoading && actionType === "delete" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default AdminAuditTable;
