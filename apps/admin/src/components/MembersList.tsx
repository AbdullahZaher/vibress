import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listMembersApi,
  getMemberApi,
  disableMemberApi,
  enableMemberApi,
  revokeMemberSessionsApi,
  listMemberSubscriptionsApi,
  AdminMemberSummary,
} from "../lib/api";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./ui/table";
import { Dialog } from "./ui/dialog";
import { Avatar } from "./ui/avatar";
import { Users, Search, UserX, UserCheck, ShieldAlert } from "lucide-react";

export const MembersList: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "disabled"
  >("all");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const queryParams: { search?: string; status?: string; limit?: number } = {
    limit: 50,
  };
  if (search) queryParams.search = search;
  if (statusFilter !== "all") queryParams.status = statusFilter;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["members", { search, status: statusFilter }],
    queryFn: () => listMembersApi(queryParams),
  });

  const { data: detailData, isLoading: isLoadingDetail } = useQuery({
    queryKey: ["member-detail", selectedMemberId],
    queryFn: () => getMemberApi(selectedMemberId!),
    enabled: !!selectedMemberId,
  });

  const { data: subsData } = useQuery({
    queryKey: ["member-subs", selectedMemberId],
    queryFn: () => listMemberSubscriptionsApi(selectedMemberId!),
    enabled: !!selectedMemberId,
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => disableMemberApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({
        queryKey: ["member-detail", selectedMemberId],
      });
      setActionError(null);
    },
    onError: (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setActionError(e.message);
    },
  });

  const enableMutation = useMutation({
    mutationFn: (id: string) => enableMemberApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({
        queryKey: ["member-detail", selectedMemberId],
      });
      setActionError(null);
    },
    onError: (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setActionError(e.message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeMemberSessionsApi(id),
    onSuccess: (res) => {
      alert(`Revoked ${res.revokedCount} active session(s).`);
      queryClient.invalidateQueries({
        queryKey: ["member-detail", selectedMemberId],
      });
    },
  });

  const members = data?.members || [];
  const memberDetail = detailData?.member;
  const memberSubs = subsData?.subscriptions || [];

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Publication Members
        </h1>
      </div>

      {actionError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {actionError}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          {(["all", "active", "disabled"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-all cursor-pointer ${
                statusFilter === filter
                  ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {filter === "all" ? "All Members" : filter}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs bg-card border-border"
          />
        </div>
      </div>

      {/* Content Table Card */}
      <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Member</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Joined</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  Loading members list...
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-red-500"
                >
                  Failed to load members: {(error as Error)?.message}
                </TableCell>
              </TableRow>
            ) : members.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-36 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center justify-center space-y-1">
                    <Users className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-xs font-medium">No members found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              members.map((member: AdminMemberSummary) => (
                <TableRow
                  key={member.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-medium">
                    <div className="flex items-center gap-3">
                      <Avatar
                        fallback={member.name || member.email}
                        className="h-8 w-8 text-xs shrink-0"
                      />
                      <div className="flex flex-col">
                        <span className="font-semibold text-xs text-foreground">
                          {member.name || "Anonymous Member"}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {member.email}
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    {member.status === "disabled" ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                      >
                        Disabled
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                      >
                        Active
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {new Date(member.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>

                  <TableCell className="text-right pr-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedMemberId(member.id)}
                      className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground cursor-pointer"
                    >
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Member Detail Dialog */}
      <Dialog
        isOpen={!!selectedMemberId}
        onClose={() => setSelectedMemberId(null)}
        title="Member Profile & Management"
      >
        {isLoadingDetail ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Loading member profile...
          </div>
        ) : memberDetail ? (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 border border-border">
              <Avatar
                fallback={memberDetail.name || memberDetail.email}
                className="h-12 w-12 text-sm"
              />
              <div>
                <h3 className="font-bold text-sm text-foreground">
                  {memberDetail.name || "Anonymous Member"}
                </h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {memberDetail.email}
                </p>
                <p className="text-[11px] text-muted-foreground/80 pt-0.5">
                  ID: {memberDetail.id}
                </p>
              </div>
            </div>

            {/* Subscriptions */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Subscriptions
              </h4>
              {memberSubs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No active subscriptions found.
                </p>
              ) : (
                memberSubs.map((sub) => (
                  <div
                    key={sub.id}
                    className="p-3 rounded-lg border border-border bg-card flex justify-between items-center text-xs"
                  >
                    <div>
                      <span className="font-semibold text-foreground">
                        Plan: {sub.planId}
                      </span>
                      <p className="text-[11px] font-mono text-muted-foreground">
                        Status: {sub.status}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono uppercase"
                    >
                      {sub.billingInterval}
                    </Badge>
                  </div>
                ))
              )}
            </div>

            {/* Account Moderation Actions */}
            <div className="space-y-2 pt-2 border-t border-border">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Account Actions
              </h4>
              <div className="flex flex-wrap gap-2">
                {memberDetail.disabledAt !== null ? (
                  <Button
                    size="sm"
                    onClick={() => enableMutation.mutate(memberDetail.id)}
                    className="h-8 text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <UserCheck className="h-3.5 w-3.5" /> Enable Account
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => disableMutation.mutate(memberDetail.id)}
                    className="h-8 text-xs font-semibold gap-1.5 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/10"
                  >
                    <UserX className="h-3.5 w-3.5" /> Disable Account
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => revokeMutation.mutate(memberDetail.id)}
                  className="h-8 text-xs font-semibold gap-1.5 border-border bg-card hover:bg-accent text-foreground"
                >
                  <ShieldAlert className="h-3.5 w-3.5" /> Revoke All Sessions
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
};
