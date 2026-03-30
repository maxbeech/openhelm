import {
  Type,
  Hash,
  Calendar,
  CheckSquare,
  List,
  ListChecks,
  Link,
  Mail,
  ArrowUpRight,
  Phone,
  Paperclip,
  Calculator,
  FunctionSquare,
  Clock,
  RefreshCw,
} from "lucide-react";
import type { DataTableColumnType } from "@openhelm/shared";
import { cn } from "@/lib/utils";

interface ColumnTypeIconProps {
  type: DataTableColumnType;
  className?: string;
}

const ICON_MAP: Record<DataTableColumnType, React.ComponentType<{ className?: string }>> = {
  text: Type,
  number: Hash,
  date: Calendar,
  checkbox: CheckSquare,
  select: List,
  multi_select: ListChecks,
  url: Link,
  email: Mail,
  relation: ArrowUpRight,
  phone: Phone,
  files: Paperclip,
  rollup: Calculator,
  formula: FunctionSquare,
  created_time: Clock,
  updated_time: RefreshCw,
};

export function ColumnTypeIcon({ type, className }: ColumnTypeIconProps) {
  const Icon = ICON_MAP[type] ?? Type;
  return <Icon className={cn("size-3.5", className)} />;
}
