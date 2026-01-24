"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AuditFiltersProps = {
  onSearchChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onStatusChange: (value: string) => void;
};

export function AuditFilters({
  onSearchChange,
  onDateChange,
  onStatusChange,
}: AuditFiltersProps) {
  const [search, setSearch] = useState("");

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearchChange(value);
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Audit ID"
          className="w-60 pl-9"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>
      <Select onValueChange={onDateChange} defaultValue="all">
        <SelectTrigger className="w-60">
          <SelectValue placeholder="Audit time" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All time</SelectItem>
          <SelectItem value="last-30">Last 30 days</SelectItem>
          <SelectItem value="last-90">Last 90 days</SelectItem>
          <SelectItem value="last-year">Last year</SelectItem>
        </SelectContent>
      </Select>
      <Select onValueChange={onStatusChange} defaultValue="all">
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="published">Published</SelectItem>
          <SelectItem value="in_progress">In progress</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
