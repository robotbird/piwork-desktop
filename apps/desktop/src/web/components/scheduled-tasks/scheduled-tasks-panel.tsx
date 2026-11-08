// Scheduled tasks panel, ported from piwork/components/scheduled-tasks/scheduled-tasks-panel.tsx.
// DESKTOP-ADAPTED (keep in sync with sync-manifest.json note):
// - data layer: SWR fetches the Electron schedules IPC (listSchedules) instead
//   of /api/scheduled-tasks; the web Task view model is derived from the
//   desktop Schedule + ScheduleRun records (status/lastRunAt/errorMessage are
//   derived from the latest run).
// - actions call window.desktop.{runSchedule,toggleSchedule,deleteSchedule,
//   createSchedule,updateSchedule}; IPC errors are localized in-component.
// - usePreferences() -> useTranslations() + a language prop (desktop mounts
//   only NextIntlClientProvider, see documents/library-page.tsx).
// - composer submit calls onAskAI(prompt): the app opens a fresh chat and
//   auto-sends it (web does location.assign("/?query=")), where the agent's
//   create_scheduled_task tool creates the task.
// - removed: attachments (upload/library picker/preview), SidebarTrigger
//   (mobile-only), next/link (rows open local chats via onOpenChat).
// - TaskEditor adds project/skill/MCP selects (desktop ScheduleInput fields)
//   and defaults the timezone to the local zone.
// - extra run statuses (missed/skipped) and run detail codes are localized
//   with the dictionary below (web catalog has no keys for them).
import {
  ArrowUp,
  Bot,
  CalendarClock,
  ChevronRight,
  Clock3,
  Filter,
  Lightbulb,
  Loader2,
  Mic,
  MoreHorizontal,
  Newspaper,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  Share,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TranslationParams } from "@/lib/i18n";
import { describeSchedule } from "@/lib/scheduler/display";
import { cn, copyTextToClipboard } from "@/lib/utils";
import type {
  LocalSkill,
  McpServer,
  Project,
  Schedule,
  ScheduleInput,
  ScheduleRun,
} from "../../../../shared/types";
import styles from "./scheduled-tasks-page.module.css";

export type ScheduleLanguage = "zh-CN" | "en";

type TaskStatus = "pending" | "running" | "completed" | "failed" | "missed" | "skipped";
type Task = {
  id: string;
  taskType: string;
  prompt: string;
  enabled: boolean;
  schedule: { cron: string; timezone: string };
  status: TaskStatus;
  nextRunAt: number | null;
  lastRunAt: number | null;
  errorMessage: string | null;
  chatId: string | null;
  // DESKTOP-ADAPTED: desktop-only bindings, kept raw for the editor.
  projectId: string | null;
  skillId: string | null;
  mcpId: string | null;
};
type Run = {
  id: string;
  scheduleId: string;
  chatId: string | null;
  status: TaskStatus;
  startedAt: number;
  detail?: string | null;
};
const statusKeys: Partial<Record<TaskStatus, string>> = {
  completed: "scheduledTasks.completed",
  failed: "scheduledTasks.failed",
  pending: "scheduledTasks.pending",
  running: "scheduledTasks.running",
};
// zh/en catalogs are synced verbatim from web and have no keys for the desktop
// run statuses and detail codes, so these stay local like the old page.
const localStrings = {
  "zh-CN": {
    status: { missed: "已错过", skipped: "已跳过" } as Record<string, string>,
    details: {
      gateway_changed: "网关或模型已更改，请编辑任务后重试",
      project_unavailable: "项目目录不可用",
      credentials_unavailable: "无法访问网关密钥",
      skill_unavailable: "技能不可用",
      mcp_unavailable: "MCP 服务不可用",
      start_failed: "无法启动任务",
      agent_failed: "任务执行失败，请检查模型及工具配置",
      agent_stopped: "任务进程意外退出",
      app_stopped: "应用退出导致任务中断",
      timeout: "任务执行超时",
      overlap: "上一次运行尚未结束",
      missed_while_offline: "应用未运行或设备休眠时错过",
      unknown: "任务执行异常",
    },
    errors: {
      "Invalid schedule": "任务信息无效，请检查名称、执行内容、Cron 和时区。",
      "Gateway not configured": "请先在设置中配置模型网关。",
      "Schedule unavailable": "任务不可用或正在运行。",
      "Project not found": "所选项目不存在。",
      "Skill not found": "所选技能不存在或未启用。",
      "MCP not found": "所选 MCP 不存在或未启用。",
    },
    project: "项目（可选）",
    skill: "技能（可选）",
    mcp: "MCP",
    none: "无",
  },
  en: {
    status: { missed: "Missed", skipped: "Skipped" } as Record<string, string>,
    details: {
      gateway_changed: "Gateway or model changed; edit the schedule.",
      project_unavailable: "Project folder unavailable",
      credentials_unavailable: "Gateway credential unavailable",
      skill_unavailable: "Skill unavailable",
      mcp_unavailable: "MCP server unavailable",
      start_failed: "Could not start the task",
      agent_failed: "Task failed; check model and tools",
      agent_stopped: "Task process stopped",
      app_stopped: "Interrupted when the app closed",
      timeout: "Task timed out",
      overlap: "Previous run is still active",
      missed_while_offline: "Missed while the app was inactive or the device was asleep",
      unknown: "Task error",
    },
    errors: {
      "Invalid schedule": "Invalid schedule. Check the name, instructions, cron and timezone.",
      "Gateway not configured": "Configure a model gateway in Settings first.",
      "Schedule unavailable": "The schedule is unavailable or already running.",
      "Project not found": "The selected project does not exist.",
      "Skill not found": "The selected skill does not exist or is disabled.",
      "MCP not found": "The selected MCP server does not exist or is disabled.",
    },
    project: "Project (optional)",
    skill: "Skill (optional)",
    mcp: "MCP",
    none: "None",
  },
} as const;
const templates = [
  {
    description: "scheduledTasks.newsDescription",
    icon: Newspaper,
    query: "scheduledTasks.newsQuery",
    title: "scheduledTasks.newsTitle",
  },
  {
    description: "scheduledTasks.radarDescription",
    icon: Bot,
    query: "scheduledTasks.radarQuery",
    title: "scheduledTasks.radarTitle",
  },
  {
    description: "scheduledTasks.inspirationDescription",
    icon: Lightbulb,
    query: "scheduledTasks.inspirationQuery",
    title: "scheduledTasks.inspirationTitle",
  },
];
const defaultTimezone = "Asia/Shanghai";
const statusText = (
  status: TaskStatus,
  t: (key: string, params?: TranslationParams) => string,
  language: ScheduleLanguage
) => (statusKeys[status] ? t(statusKeys[status] as string) : localStrings[language].status[status] ?? status);
const detailText = (code: string, language: ScheduleLanguage) =>
  localStrings[language].details[code as keyof (typeof localStrings)["zh-CN"]["details"]] ??
  localStrings[language].details.unknown;
function ipcErrorMessage(
  error: unknown,
  language: ScheduleLanguage,
  fallback: string
) {
  const message = error instanceof Error ? error.message : "";
  return localStrings[language].errors[message as keyof (typeof localStrings)["zh-CN"]["errors"]] ?? fallback;
}
const date = (value: number | null, language: string, timezone = "Asia/Shanghai") =>
  value
    ? new Date(value).toLocaleString(language, {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "numeric",
        timeZone: timezone,
      })
    : "—";

const relativeTime = (
  value: number | null,
  t: (key: string, params?: TranslationParams) => string
) => {
  if (!value) {
    return t("scheduledTasks.notScheduled");
  }
  const milliseconds = value - Date.now();
  if (milliseconds <= 0) {
    return t("scheduledTasks.soon");
  }
  const hours = Math.max(1, Math.round(milliseconds / 3_600_000));
  if (hours < 24) {
    return t("scheduledTasks.hoursLater", { count: hours });
  }
  const days = Math.round(hours / 24);
  return t("scheduledTasks.daysLater", { count: days });
};
// DESKTOP-ADAPTED: web Task fields (status/lastRunAt/errorMessage/chatId) are
// derived from the desktop Schedule + its latest ScheduleRun.
function toTask(schedule: Schedule, runs: ScheduleRun[], language: ScheduleLanguage): Task {
  const latest = runs
    .filter((run) => run.scheduleId === schedule.id)
    .sort((a, b) => b.plannedAt - a.plannedAt)[0];
  const status: TaskStatus = latest ? (latest.status as TaskStatus) : "pending";
  return {
    id: schedule.id,
    taskType: schedule.name,
    prompt: schedule.prompt,
    enabled: schedule.enabled,
    schedule: { cron: schedule.cron, timezone: schedule.timezone },
    status,
    nextRunAt: schedule.nextAt,
    lastRunAt: latest
      ? latest.finishedAt ?? latest.startedAt ?? latest.plannedAt
      : null,
    errorMessage:
      status === "failed" && latest?.detail
        ? detailText(latest.detail, language)
        : null,
    chatId: latest?.chatId ?? null,
    projectId: schedule.projectId ?? null,
    skillId: schedule.skillId ?? null,
    mcpId: schedule.mcpId ?? null,
  };
}
function toRun(run: ScheduleRun): Run {
  return {
    id: run.id,
    scheduleId: run.scheduleId,
    chatId: run.chatId ?? null,
    status: run.status as TaskStatus,
    startedAt: run.startedAt ?? run.plannedAt,
    detail: run.detail ?? null,
  };
}

export function Schedules({
  language,
  projects,
  skills,
  mcpServers,
  onOpenChat,
  onAskAI,
}: {
  language: ScheduleLanguage;
  projects: Project[];
  skills: LocalSkill[];
  mcpServers: McpServer[];
  onOpenChat: (id: string) => void;
  onAskAI: (text: string) => void;
}) {
  const t = useTranslations();
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR("schedules", () => window.desktop.listSchedules(), {
    refreshInterval: 5000,
  });
  const runs = useMemo(
    () =>
      (data?.runs ?? [])
        .slice()
        .sort((a, b) => b.plannedAt - a.plannedAt)
        .map(toRun),
    [data]
  );
  const tasks = useMemo(
    () => (data?.schedules ?? []).map((schedule) => toTask(schedule, data?.runs ?? [], language)),
    [data, language]
  );
  const [query, setQuery] = useState("");
  const [multiline, setMultiline] = useState(false);
  const composerRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const composer = composerRef.current;
    if (!textarea || !composer) {
      return;
    }
    const resize = () => {
      // 固定单行可用宽度，避免展开后的宽度变化导致布局反复切换。
      textarea.style.width = `${Math.max(composer.clientWidth - 144, 1)}px`;
      textarea.style.paddingInline = "0px";
      textarea.style.height = "0px";
      const needsMultiline = textarea.scrollHeight > 40;
      textarea.style.width = "";
      textarea.style.paddingInline = "";
      const height = textarea.scrollHeight;
      textarea.style.height = `${Math.min(height, 240)}px`;
      textarea.style.overflowY = height > 240 ? "auto" : "hidden";
      setMultiline(needsMultiline);
    };
    resize();
    let width = composer.clientWidth;
    const observer = new ResizeObserver(() => {
      if (composer.clientWidth !== width) {
        width = composer.clientWidth;
        resize();
      }
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, [query, multiline]);

  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Task | null>(null);
  const [details, setDetails] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  // DESKTOP-ADAPTED: the web page navigates to /?query=… so the chat page
  // auto-sends the first message and the agent's create_scheduled_task tool
  // lands the task; the desktop app opens a fresh chat instead.
  const startChat = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    onAskAI(t("scheduledTasks.createPrompt", { text: trimmed }));
  };
  const change = async (task: Task, action: "run" | "pause" | "resume" | "delete") => {
    setBusy(task.id);
    try {
      if (action === "delete") {
        await window.desktop.deleteSchedule(task.id);
      } else if (action === "run") {
        await window.desktop.runSchedule(task.id);
      } else {
        await window.desktop.toggleSchedule(task.id, action === "resume");
      }
      toast.success(
        action === "run"
          ? t("scheduledTasks.started")
          : action === "pause"
            ? t("scheduledTasks.pauseNotice")
            : action === "resume"
              ? t("scheduledTasks.resumed")
              : t("scheduledTasks.deleted")
      );
      setDeleting(null);
      await mutate();
    } catch (cause) {
      toast.error(ipcErrorMessage(cause, language, t("scheduledTasks.operationFailed")));
    } finally {
      setBusy(null);
    }
  };
  const shareTask = async (task: Task) => {
    const text = `${task.prompt}\n${describeSchedule(task.schedule.cron, t)} · ${task.schedule.timezone || defaultTimezone}`;
    try {
      // Electron has no navigator.share; fall back to the clipboard like the
      // web page does for unsupported browsers.
      const succeeded = await copyTextToClipboard(`${task.taskType}\n${text}`);
      if (!succeeded) {
        throw new Error("clipboard unavailable");
      }
      toast.success(t("scheduledTasks.copied"));
    } catch {
      toast.error(t("scheduledTasks.shareFailed"));
    }
  };
  const visible = tasks.filter(
    (task) =>
      filter === "all" || (filter === "enabled" ? task.enabled : !task.enabled)
  );
  return (
    // DESKTOP-ADAPTED: the web app mounts TooltipProvider globally; the desktop
    // shell does not, so the page provides its own.
    <TooltipProvider>
    <main
      aria-label={t("scheduledTasks.title")}
      className={styles.page}
    >
      <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 md:px-8 md:pt-16">
        {/* DESKTOP-ADAPTED: div instead of header/h1 — the app shell's
            unlayered global CSS sizes bare header/h1/h2/article elements and
            would override the tailwind utilities used here (fixed 58px header
            box, 23px h1, bordered article). */}
        <div className="mb-12 flex items-start justify-between gap-4">
          <div>
            <div className="text-heading-lg">{t("scheduledTasks.title")}</div>
            <p className="mt-1 text-body-lg text-muted-foreground">
              {t("scheduledTasks.description")}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-9 rounded-md bg-muted px-3 text-label-sm shadow-none transition-colors duration-150 hover:bg-accent"
                variant="secondary"
              >
                <Filter className="size-4" />
                {
                  {
                    all: t("scheduledTasks.all"),
                    enabled: t("scheduledTasks.enabled"),
                    paused: t("scheduledTasks.paused"),
                  }[filter]
                }
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {[
                ["all", t("scheduledTasks.all")],
                ["enabled", t("scheduledTasks.enabled")],
                ["paused", t("scheduledTasks.paused")],
              ].map(([value, label]) => (
                <DropdownMenuItem key={value} onClick={() => setFilter(value)}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <form
          className={cn(
            "composer-plain grid min-h-14 grid-cols-[40px_minmax(0,1fr)_32px_32px] items-center gap-x-2 border border-[var(--hairline-strong)] bg-card px-2 py-[7px] shadow-[var(--shadow-whisper)]",
            multiline ? "gap-y-2 rounded-[28px]" : "rounded-full"
          )}
          onSubmit={(event) => {
            event.preventDefault();
            startChat(query);
          }}
          ref={composerRef}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("chat.uploadMenu")}
                className="composer-plus col-start-1 row-start-2 size-10 shrink-0 cursor-pointer rounded-full p-0 text-foreground transition-colors duration-150 hover:bg-muted focus-visible:bg-muted data-[state=open]:bg-muted"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Plus className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-[min(420px,calc(100vw-32px))] rounded-2xl p-2"
              side="bottom"
              sideOffset={12}
            >
              <DropdownMenuItem
                className="gap-3 rounded-xl px-3 py-3"
                onSelect={() => setManual(true)}
              >
                <CalendarClock className="size-5 shrink-0" />
                <span>{t("scheduledTasks.manual")}</span>
                <span className="text-muted-foreground">
                  {t("scheduledTasks.manualHint")}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <textarea
            aria-label={t("scheduledTasks.schedule")}
            className={cn(
              "min-w-0 w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words bg-transparent py-2 text-base leading-6 outline-none placeholder:text-muted-foreground",
              multiline
                ? "col-span-4 col-start-1 row-start-1 px-3"
                : "col-start-2 row-start-2"
            )}
            maxLength={2000}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              ) {
                return;
              }
              event.preventDefault();
              startChat(event.currentTarget.value);
            }}
            placeholder={t("scheduledTasks.schedule")}
            ref={textareaRef}
            rows={1}
            value={query}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("scheduledTasks.voice")}
                className="col-start-3 row-start-2 size-8 shrink-0 rounded-full text-foreground transition-colors duration-150 hover:bg-muted"
                onClick={() => toast.info(t("scheduledTasks.voiceSoon"))}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Mic className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("scheduledTasks.voice")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("scheduledTasks.scheduleWithAI")}
                className="col-start-4 row-start-2 size-8 shrink-0 rounded-full"
                disabled={!query.trim()}
                type="submit"
              >
                <ArrowUp className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("scheduledTasks.scheduleWithAI")}
            </TooltipContent>
          </Tooltip>
        </form>
        <section aria-label={t("scheduledTasks.myTasks")} className="mt-10">
          {Boolean(isLoading) && (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("scheduledTasks.loading")}
            </p>
          )}
          {Boolean(error) && (
            <div className="rounded-xl border p-6 text-sm" role="alert">
              {t("scheduledTasks.loadFailed")}
              <Button onClick={() => mutate()} variant="link">
                {t("scheduledTasks.retry")}
              </Button>
            </div>
          )}
          {!isLoading && !error && visible.length === 0 && (
            <div className="py-10 text-center">
              <Clock3 className="mx-auto mb-3 size-5 text-muted-foreground" />
              <p className="font-medium">
                {tasks.length
                  ? t("scheduledTasks.noMatches")
                  : t("scheduledTasks.empty")}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("scheduledTasks.emptyHint")}
              </p>
            </div>
          )}
          {visible.map((task) => (
            <div
              className="group relative flex min-h-24 items-center gap-3 rounded-md px-4 py-4 transition-colors duration-150 hover:bg-muted"
              key={task.id}
            >
              <div className="flex size-10 shrink-0 items-center justify-center text-muted-foreground">
                <PauseCircle className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <button
                  className="max-w-full truncate text-left text-base font-medium leading-6 hover:underline"
                  onClick={() => setDetails(task)}
                  type="button"
                >
                  {task.taskType}
                </button>
                <p className="flex flex-wrap items-center gap-x-1.5 text-sm leading-5 text-muted-foreground">
                  {task.enabled
                    ? describeSchedule(task.schedule.cron, t)
                    : t("scheduledTasks.paused")}
                  {Boolean(task.enabled) && (
                    <span>
                      {t("scheduledTasks.nextRun", {
                        time: relativeTime(task.nextRunAt, t),
                      })}
                    </span>
                  )}
                </p>
                <p className="mt-1 line-clamp-1 pr-24 text-sm leading-5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                  {task.prompt}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                  <span
                    className={
                      task.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {statusText(task.status, t, language)}
                    {task.lastRunAt
                      ? ` · ${date(task.lastRunAt, language, task.schedule.timezone)}`
                      : ""}
                  </span>
                  {Boolean(task.chatId) && (
                    <button
                      className="inline-flex items-center text-link hover:text-link-deep hover:underline"
                      onClick={() => onOpenChat(task.chatId as string)}
                      type="button"
                    >
                      {t("scheduledTasks.viewResult")}
                      <ChevronRight className="size-3" />
                    </button>
                  )}
                </div>
                {Boolean(task.errorMessage) && (
                  <p className="mt-2 text-xs text-destructive">
                    {task.errorMessage}
                  </p>
                )}
              </div>
              <Button
                aria-label={t("scheduledTasks.editName", {
                  name: task.taskType,
                })}
                className="absolute right-14 top-1/2 size-10 -translate-y-1/2 rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-card hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                disabled={task.status === "running"}
                onClick={() => setEditing(task)}
                size="icon"
                title={t("scheduledTasks.edit")}
                variant="ghost"
              >
                <Pencil className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={t("scheduledTasks.manageName", {
                      name: task.taskType,
                    })}
                    className="absolute right-3 top-1/2 size-10 -translate-y-1/2 rounded-md text-foreground opacity-0 transition-colors duration-150 hover:bg-card group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:bg-card data-[state=open]:opacity-100"
                    disabled={busy === task.id}
                    size="icon"
                    title={t("scheduledTasks.more")}
                    variant="ghost"
                  >
                    <MoreHorizontal className="size-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-48 rounded-md border-border p-1.5 shadow-[var(--shadow-float)]"
                  sideOffset={4}
                >
                  <DropdownMenuItem
                    className="h-10 gap-3 rounded-sm px-3 text-sm"
                    disabled={task.status === "running"}
                    onClick={() => change(task, "run")}
                  >
                    <Play className="size-4" />
                    {t("scheduledTasks.runNow")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="h-10 gap-3 rounded-sm px-3 text-sm"
                    onClick={() => shareTask(task)}
                  >
                    <Share className="size-4" />
                    {t("scheduledTasks.share")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="h-10 gap-3 rounded-sm px-3 text-sm"
                    onClick={() =>
                      change(task, task.enabled ? "pause" : "resume")
                    }
                  >
                    <PauseCircle className="size-4" />
                    {task.enabled
                      ? t("scheduledTasks.pause")
                      : t("scheduledTasks.resume")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="h-10 gap-3 rounded-sm px-3 text-sm text-destructive focus:text-destructive"
                    disabled={task.status === "running"}
                    onClick={() => setDeleting(task)}
                  >
                    <Trash2 className="size-4" />
                    {t("scheduledTasks.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </section>
        <div className="mx-4 my-5 border-t border-dashed border-border" />
        <section
          aria-label={t("scheduledTasks.recommendedTasks")}
          className="pt-2"
        >
          <div className="mb-2 px-4 text-base font-medium text-muted-foreground">
            {t("scheduledTasks.recommended")}
          </div>
          {templates.map((item) => (
            <button
              className="group flex min-h-20 w-full items-center gap-3 rounded-md px-4 py-3 text-left transition-colors duration-150 hover:bg-muted"
              key={t(item.title)}
              onClick={() => startChat(t(item.query))}
              type="button"
            >
              <span className="flex size-10 shrink-0 items-center justify-center text-muted-foreground">
                <item.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium leading-6">
                  {t(item.title)}
                </span>
                <span className="block text-sm leading-5 text-muted-foreground">
                  {t(item.description)}
                </span>
              </span>
              <Plus className="size-5 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground" />
            </button>
          ))}
        </section>
      </div>
      {Boolean(editing || manual) && (
        <TaskEditor
          key={editing?.id || "new"}
          language={language}
          mcpServers={mcpServers}
          onClose={() => {
            setEditing(null);
            setManual(false);
          }}
          onSaved={() => {
            setEditing(null);
            setManual(false);
            mutate().catch(console.error);
          }}
          projects={projects}
          skills={skills}
          task={editing}
        />
      )}
      {details !== null && (
        <TaskHistory
          language={language}
          loading={Boolean(isLoading)}
          loadFailed={Boolean(error)}
          onClose={() => setDetails(null)}
          onOpenChat={onOpenChat}
          runs={runs}
          task={details}
        />
      )}
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        open={!!deleting}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              {t("scheduledTasks.deleteTitle", {
                name: deleting?.taskType ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("scheduledTasks.deleteHint")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDeleting(null)} variant="outline">
              {t("scheduledTasks.cancel")}
            </Button>
            <Button
              disabled={!!busy}
              onClick={() => deleting && change(deleting, "delete")}
              variant="destructive"
            >
              {busy === deleting?.id && (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              )}
              {t("scheduledTasks.deleteTask")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
    </TooltipProvider>
  );
}

function TaskEditor({
  task,
  language,
  projects,
  skills,
  mcpServers,
  onClose,
  onSaved,
}: {
  task: Task | null;
  language: ScheduleLanguage;
  projects: Project[];
  skills: LocalSkill[];
  mcpServers: McpServer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const copy = localStrings[language];
  const [title, setTitle] = useState(task?.taskType || "");
  const [prompt, setPrompt] = useState(task?.prompt || "");
  const [cron, setCron] = useState(task?.schedule.cron || "0 9 * * *");
  const [timezone, setTimezone] = useState(
    task?.schedule.timezone || defaultTimezone
  );
  // DESKTOP-ADAPTED: desktop schedules can bind a project, skill and MCP.
  const [projectId, setProjectId] = useState(task?.projectId ?? "");
  const [skillId, setSkillId] = useState(task?.skillId ?? "");
  const [mcpId, setMcpId] = useState(task?.mcpId ?? "");
  const [saving, setSaving] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const input: ScheduleInput = {
        name: title,
        prompt,
        cron,
        timezone,
        projectId: projectId || null,
        skillId: skillId || null,
        mcpId: mcpId || null,
      };
      if (task) {
        await window.desktop.updateSchedule(task.id, input);
      } else {
        await window.desktop.createSchedule(input);
      }
      toast.success(
        task ? t("scheduledTasks.updated") : t("scheduledTasks.created")
      );
      onSaved();
    } catch (error) {
      toast.error(
        ipcErrorMessage(error, language, t("scheduledTasks.saveFailed"))
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !saving) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>
            {task ? t("scheduledTasks.edit") : t("scheduledTasks.manual")}
          </DialogTitle>
          <DialogDescription>
            {t("scheduledTasks.editorHint")}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <div className="space-y-2">
            <Label htmlFor="task-title">{t("scheduledTasks.name")}</Label>
            <Input
              id="task-title"
              maxLength={64}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-prompt">
              {t("scheduledTasks.instructions")}
            </Label>
            <Textarea
              id="task-prompt"
              maxLength={10_000}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("scheduledTasks.instructionsHint")}
              required
              rows={5}
              value={prompt}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-preset">{t("scheduledTasks.plan")}</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="task-preset"
              onChange={(event) => {
                if (event.target.value !== "custom") {
                  setCron(event.target.value);
                }
              }}
              value={
                ["0 9 * * *", "0 9 * * 1-5", "0 9 * * 1", "0 * * * *"].includes(
                  cron
                )
                  ? cron
                  : "custom"
              }
            >
              <option value="0 9 * * *">
                {t("scheduledTasks.dailyPreset")}
              </option>
              <option value="0 9 * * 1-5">
                {t("scheduledTasks.weekdaysPreset")}
              </option>
              <option value="0 9 * * 1">
                {t("scheduledTasks.mondayPreset")}
              </option>
              <option value="0 * * * *">{t("scheduledTasks.hourly")}</option>
              <option value="custom">{t("scheduledTasks.custom")}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="task-cron">{t("scheduledTasks.cron")}</Label>
              <Input
                id="task-cron"
                onChange={(event) => setCron(event.target.value)}
                required
                value={cron}
              />
              <p className="text-xs text-muted-foreground">
                {t("scheduledTasks.cronHint")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-zone">{t("scheduledTasks.timezone")}</Label>
              <Input
                id="task-zone"
                onChange={(event) => setTimezone(event.target.value)}
                required
                value={timezone}
              />
            </div>
          </div>
          {/* DESKTOP-ADAPTED: project/skill/MCP bindings, native selects styled like the preset select */}
          <div className="space-y-2">
            <Label htmlFor="task-project">{copy.project}</Label>
            <select
              aria-label={copy.project}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="task-project"
              onChange={(event) => setProjectId(event.target.value)}
              value={projectId}
            >
              <option value="">{copy.none}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="task-skill">{copy.skill}</Label>
              <select
                aria-label={copy.skill}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="task-skill"
                onChange={(event) => setSkillId(event.target.value)}
                value={skillId}
              >
                <option value="">{copy.none}</option>
                {skills
                  .filter((skill) => skill.enabled)
                  .map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-mcp">{copy.mcp}</Label>
              <select
                aria-label={copy.mcp}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="task-mcp"
                onChange={(event) => setMcpId(event.target.value)}
                value={mcpId}
              >
                <option value="">{copy.none}</option>
                {mcpServers
                  .filter((server) => server.enabled)
                  .map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              {t("scheduledTasks.cancel")}
            </Button>
            <Button disabled={saving} type="submit">
              {saving ? t("scheduledTasks.saving") : t("scheduledTasks.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskHistory({
  task,
  runs,
  language,
  loading,
  loadFailed,
  onClose,
  onOpenChat,
}: {
  task: Task;
  runs: Run[];
  language: ScheduleLanguage;
  loading: boolean;
  loadFailed: boolean;
  onClose: () => void;
  onOpenChat: (id: string) => void;
}) {
  const t = useTranslations();
  // DESKTOP-ADAPTED: runs come from the panel's shared SWR data (web fetches
  // /api/scheduled-tasks/{id} itself); keep the "最近 20 次运行" contract.
  const history = runs
    .filter((run) => run.scheduleId === task.id)
    .slice(0, 20);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>{task.taskType}</DialogTitle>
          <DialogDescription>
            {t("scheduledTasks.historyTitle", {
              timezone: task.schedule.timezone || defaultTimezone,
            })}
          </DialogDescription>
        </DialogHeader>
        {loading && (
          <p className="text-sm text-muted-foreground">
            {t("scheduledTasks.loadingHistory")}
          </p>
        )}
        {loadFailed && (
          <p className="text-sm text-destructive" role="alert">
            {t("scheduledTasks.historyFailed")}
          </p>
        )}
        {!loading && !loadFailed && history.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("scheduledTasks.noHistory")}
          </p>
        )}
        {history.map((run) => (
          <div className="border-b py-3 last:border-0" key={run.id}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Clock3 size={15} />
                {date(run.startedAt, language, task.schedule.timezone)}
              </span>
              <span
                className={
                  run.status === "failed" ? "text-destructive" : undefined
                }
              >
                {statusText(run.status, t, language)}
              </span>
            </div>
            {Boolean(run.detail) && (
              <p className="mt-2 text-xs text-destructive">
                {detailText(run.detail as string, language)}
              </p>
            )}
            {Boolean(run.chatId) && (
              <button
                className="mt-2 inline-block text-sm text-primary hover:underline"
                onClick={() => onOpenChat(run.chatId as string)}
                type="button"
              >
                {t("scheduledTasks.openResult")}
              </button>
            )}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
