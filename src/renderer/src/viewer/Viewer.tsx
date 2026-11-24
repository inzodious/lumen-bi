/**
 * Published dashboard: the report's reading view (page tabs, slicers, cross-filtering, drill, tooltips, bookmarks)
 * in a plain browser, with a slim header in place of the Desktop shell.
 */
import { useEffect, useState } from "react";
import {
  ArrowMaximizeRegular,
  ArrowMinimizeRegular,
  ArrowResetRegular,
} from "@fluentui/react-icons";
import { useApp, type ExportVisualDataRequest } from "../state/store";
import { useInteraction } from "../state/interaction";
import { ReportView, setReady } from "../report";
import { ContextMenuHost } from "../app/ui/Menu";
import { DialogHost } from "../app/ui/Modal";
import { ToastHost } from "../app/ui/Notify";
import { toCsv } from "../export/data";
import { holdBusy, releaseAfterPaint } from "../app/readiness";
import {
  loadDashboard,
  manifestUrl,
  openDashboard,
  type LoadedDashboard,
} from "./load";

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").trim() || "data";
}

/** A visual's "Export data" in the browser: a CSV download of the summarized data. */
function downloadVisualData(req: ExportVisualDataRequest): void {
  if (!req.data) return;
  const blob = new Blob([toCsv(req.data, { bom: true })], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName(req.title || req.visualName)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** `?embed=1`: shown inside another site's iframe (Lumen Server embedding), so only the report, without the header. */
export const embedded =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("embed") === "1";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export function Viewer() {
  const [state, setState] = useState<
    | { kind: "loading"; progress: number }
    | { kind: "error"; message: string }
    | { kind: "ready"; dashboard: LoadedDashboard }
  >({ kind: "loading", progress: 0 });
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const release = holdBusy("open");
    let cancelled = false;
    loadDashboard(
      manifestUrl(window.location),
      (progress) => !cancelled && setState({ kind: "loading", progress }),
    )
      .then((dashboard) => {
        if (cancelled) return;
        const app = useApp.getState();
        app.setProject(dashboard.project);
        app.setEditMode(false);
        app.setView("report");
        app.setExportVisualDataHandler(downloadVisualData);
        document.title = dashboard.manifest.title;
        setState({ kind: "ready", dashboard });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        setReady(true);
      })
      .finally(() => releaseAfterPaint(release));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  if (state.kind === "loading")
    return (
      <div className="lv-status" role="status">
        <div className="lv-spinner" />
        <div>
          Loading dashboard
          {state.progress > 0 ? ` ${Math.round(state.progress * 100)}%` : "…"}
        </div>
      </div>
    );
  if (state.kind === "error")
    return (
      <div className="lv-status lv-status--error" role="alert">
        <div className="lv-status__title">
          This dashboard could not be opened
        </div>
        <div>{state.message}</div>
      </div>
    );

  const { manifest } = state.dashboard;
  const reset = () => {
    // back to the report as published: saved slicer and filter state, first page
    useInteraction.getState().setFocus(null);
    void openDashboard(manifest, state.dashboard.bytes).then((project) =>
      useApp.getState().setProject(project),
    );
  };
  return (
    <div className={embedded ? "lv-shell lv-shell--embed" : "lv-shell"}>
      {embedded ? null : (
        <header className="lv-header">
          <div className="lv-title" title={manifest.title}>
            {manifest.title}
          </div>
          <div className="lv-meta">
            Published {formatDate(manifest.publishedAt)}
          </div>
          <div className="lv-spacer" />
          <button
            type="button"
            className="lv-btn"
            onClick={reset}
            title="Reset to the published view"
          >
            <ArrowResetRegular fontSize={16} />
            <span>Reset</span>
          </button>
          <button
            type="button"
            className="lv-btn"
            onClick={() =>
              document.fullscreenElement
                ? void document.exitFullscreen()
                : void document.documentElement.requestFullscreen?.()
            }
            title={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen ? (
              <ArrowMinimizeRegular fontSize={16} />
            ) : (
              <ArrowMaximizeRegular fontSize={16} />
            )}
          </button>
        </header>
      )}
      <main className="lv-main">
        <ReportView />
      </main>
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
    </div>
  );
}
