"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import AnomalyForm from "@/app/(dashboard)/admin/AnomalyForm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const PAGE_SIZE = 10;

const statusBadgeVariant = (status: AuditStatus) => {
  switch (status) {
    case "published":
      return "secondary";
    case "pending":
      return "outline";
    case "processing":
      return "default";
    case "review":
      return "outline";
    default:
      return "outline";
  }
};

const AdminAuditTable = ({ audits }: AdminAuditTableProps) => {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<AuditStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [loadingAuditId, setLoadingAuditId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return audits.filter((audit) => {
      if (statusFilter === "all") {
        return true;
      }
      return audit.status === statusFilter;
    });
  }, [audits, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const updateStatus = async (auditId: string, status: string) => {
    setLoadingAuditId(auditId);
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
      setLoadingAuditId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value: string) => {
            setPage(1);
            setStatusFilter(value as AuditStatus | "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uploaded Files</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.map((audit) => {
              const isLoading = loadingAuditId === audit.id;
              return (
                <TableRow key={audit.id}>
                  <TableCell className="font-medium text-slate-900">
                    {audit.organization_name}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(audit.created_at).toLocaleDateString("en-US")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(audit.status)}>
                      {audit.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {audit.uploaded_files.length === 0 && "No files"}
                    {audit.uploaded_files.length > 0 && (
                      <ul className="space-y-1 text-xs text-slate-600">
                        {audit.uploaded_files.map((file) => (
                          <li key={file.id}>
                            {file.file_name}{" "}
                            <span className="text-slate-400">
                              ({file.file_type})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/audit/${audit.id}`}>
                          <Eye className="mr-1 h-3 w-3" />
                          Preview
                        </Link>
                      </Button>
                      {audit.status !== "processing" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isLoading}
                          onClick={() => updateStatus(audit.id, "processing")}
                        >
                          {isLoading ? "..." : "Processing"}
                        </Button>
                      )}
                      {audit.status !== "review" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isLoading}
                          onClick={() => updateStatus(audit.id, "review")}
                        >
                          {isLoading ? "..." : "Review"}
                        </Button>
                      )}
                      {audit.status !== "published" && (
                        <Button
                          size="sm"
                          disabled={isLoading}
                          onClick={() => updateStatus(audit.id, "published")}
                        >
                          {isLoading ? "..." : "Publish"}
                        </Button>
                      )}
                      <AnomalyForm auditId={audit.id} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {paginated.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-6 text-center text-sm text-slate-500"
                >
                  No audits found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAuditTable;
